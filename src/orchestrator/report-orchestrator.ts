/**
 * Report orchestration for Uma Club Bot v3.
 *
 * Encapsulates report generation, delivery, and alert processing.
 * Extracted from index.ts to separate business logic from composition root.
 */

import type { BotConfig, Snapshot, ComputedMember } from '../types';
import type { Database } from '../db/database';
import type { UmaMoeClient } from '../api/uma-moe';
import type { WhatsAppClient } from '../whatsapp/client';
import { detectAlerts, formatAlerts, type Alert } from '../alerts/alerts';
import { saveSnapshot, ensureMonthSnapshot, getDataDayFromSnapshot } from '../data/snapshot';
import { getDataDate, getDataDateComponents } from '../utils/timezone';
import { computeMembers } from '../reports/compute';
import { generateCombinedReport } from '../reports/combined';
import { log } from '../utils/logger';

// Report generator imports
import { generateDailyReport } from '../reports/daily';
import { generateWeeklyReport } from '../reports/weekly';
import { generateMonthlyReport } from '../reports/monthly';
import { generateRanksReport } from '../reports/ranks';
import { generateBottomReport } from '../reports/bottom';
import { generateStatsReport } from '../reports/stats';
import { generateMembersReport } from '../reports/members';
import { generateTierReport } from '../reports/tier';

export interface ReportOrchestratorDeps {
  getConfig: () => BotConfig;
  getSnapshot: () => Snapshot | null;
  umaMoe: UmaMoeClient;
  db: Database;
  waClient: WhatsAppClient;
}

export class ReportOrchestrator {
  private getConfig: () => BotConfig;
  private getSnapshot: () => Snapshot | null;
  private umaMoe: UmaMoeClient;
  private db: Database;
  private waClient: WhatsAppClient;

  constructor(deps: ReportOrchestratorDeps) {
    this.getConfig = deps.getConfig;
    this.getSnapshot = deps.getSnapshot;
    this.umaMoe = deps.umaMoe;
    this.db = deps.db;
    this.waClient = deps.waClient;
  }

  // ── Delivery ──────────────────────────────────────────────

  /**
   * Deliver a report text to all announcement groups.
   * Throws on delivery failure so callers know the true status.
   */
  async deliverReport(reportText: string, type: string): Promise<void> {
    const config = this.getConfig();
    if (!this.waClient.isConnected()) {
      log.debug('Report', `${type} report generated (${reportText.length} chars) — WhatsApp not connected, skipping delivery`);
      if (config.groups.announcement.length > 0) {
        throw new Error('WhatsApp not connected');
      }
      return;
    }
    let delivered = false;
    for (const groupJid of config.groups.announcement) {
      try {
        await this.waClient.sendMessage(groupJid, reportText);
        log.info('Report', `${type} report sent to ${groupJid}`);
        delivered = true;
      } catch (err) {
        log.error('Report', `Failed to send ${type} report to ${groupJid}`, err);
      }
    }
    if (!delivered && config.groups.announcement.length > 0) {
      throw new Error(`Failed to deliver ${type} report to all announcement groups`);
    }
  }

  /**
   * Deliver alerts to admin/alertAdmin targets.
   */
  async deliverAlerts(alerts: Alert[], isCatchUp: boolean): Promise<void> {
    if (!this.waClient.isConnected() || alerts.length === 0) return;

    const alertMessage = formatAlerts(alerts, isCatchUp);
    if (!alertMessage) return;

    const config = this.getConfig();
    const alertTargets = config.alerts.defaultRecipients === 'admin'
      ? config.admins
      : config.groups.alertAdmin;

    for (const target of alertTargets) {
      try {
        await this.waClient.sendMessage(target, alertMessage);
        log.info('Alert', `Alerts sent to ${target}`);
      } catch (err) {
        log.error('Alert', `Failed to send alerts to ${target}`, err);
      }
    }
  }

  // ── Snapshot alignment ────────────────────────────────────

  /**
   * Month-alignment + stale data pre-fetch.
   * If the snapshot is from a different month, or data is 2+ days behind,
   * fetch fresh data from uma.moe. Returns the (possibly refreshed) snapshot.
   */
  async alignSnapshotToMonth(
    type: string,
    snapshot: Snapshot,
    config: BotConfig
  ): Promise<Snapshot> {
    if (type === 'daily' || type === 'weekly') {
      const { year: snapYear, month: snapMonth } = snapshot.members[0];
      const { year: curYear, month: curMonth } = getDataDateComponents();
      if (snapYear !== curYear || snapMonth !== curMonth) {
        try {
          log.info('Report', `Snapshot is from ${snapYear}-${snapMonth}, fetching current month ${curYear}-${curMonth}`);
          const freshSnapshot = await this.umaMoe.fetchCircleData(config.circleId, curYear, curMonth);
          saveSnapshot(freshSnapshot, getDataDate());
          snapshot = freshSnapshot;
          log.info('Report', `Fresh data fetched for ${type} report`);
        } catch (err) {
          log.warn('Report', `Cannot fetch fresh data for ${type} report (snapshot is from previous month)`, err);
          throw new Error(`Tidak ada data untuk ${type} report bulan ini. Data terakhir: ${snapYear}-${snapMonth}`);
        }
      }
    }

    if ((type === 'daily' || type === 'weekly') && snapshot) {
      const dataDay = getDataDayFromSnapshot(snapshot);
      const { year: snapYear, month: snapMonth } = snapshot.members[0];
      const { year: curYear, month: curMonth, day: curDay } = getDataDateComponents();
      if (snapYear === curYear && snapMonth === curMonth && dataDay < curDay - 1) {
        try {
          log.info('Report', `Snapshot data day ${dataDay} is stale (current day ${curDay}), fetching fresh`);
          const freshSnapshot = await this.umaMoe.fetchCircleData(config.circleId, curYear, curMonth);
          saveSnapshot(freshSnapshot, getDataDate());
          snapshot = freshSnapshot;
        } catch (err) {
          log.warn('Report', `Failed to refresh stale data, using existing snapshot`, err);
        }
      }
    }

    return snapshot;
  }

  // ── Report generation ─────────────────────────────────────

  /**
   * Generate a report string for a single report type.
   * Returns the formatted report string, or undefined for unknown types.
   */
  generateReportString(
    type: string,
    snapshot: Snapshot,
    config: BotConfig,
    computedMembers: ComputedMember[],
    options?: { offset?: number; isCatchUp?: boolean }
  ): string | undefined {
    let report: string;
    switch (type) {
      case 'daily': report = generateDailyReport(snapshot, config, computedMembers, options?.offset, this.db); break;
      case 'weekly': report = generateWeeklyReport(snapshot, config, computedMembers, options?.offset, this.db); break;
      case 'monthly': report = generateMonthlyReport(snapshot, config, computedMembers, options?.offset, this.db); break;
      case 'ranks': report = generateRanksReport(snapshot, config, computedMembers); break;
      case 'bottom': report = generateBottomReport(snapshot, config, computedMembers, this.db); break;
      case 'stats': report = generateStatsReport(snapshot, config, computedMembers, this.db); break;
      case 'members': report = generateMembersReport(snapshot, config, computedMembers, this.db); break;
      case 'tier': report = generateTierReport(snapshot, config, computedMembers, this.db); break;
      default: log.error('Report', `Unknown report type: ${type}`); return undefined;
    }

    if (options?.isCatchUp) {
      report = `[Mode catch-up — memulihkan laporan yang terlewat]\n${report}`;
    }

    return report;
  }

  /**
   * Generate a combined report string from multiple report types.
   */
  generateCombinedReportString(
    types: string[],
    snapshot: Snapshot,
    config: BotConfig,
    computedMembers: ComputedMember[]
  ): string {
    return generateCombinedReport(types, snapshot, config, computedMembers, this.db);
  }

  // ── Alert processing ──────────────────────────────────────

  /**
   * Detect, record, and deliver alerts for a report.
   * Returns collected alerts when options.collectAlerts is true (for catch-up aggregation).
   */
  async processAlertsForReport(
    type: string,
    snapshot: Snapshot,
    config: BotConfig,
    computedMembers: ComputedMember[],
    options?: { isCatchUp?: boolean; collectAlerts?: boolean }
  ): Promise<Alert[]> {
    let alerts: Alert[] = [];
    try {
      alerts = detectAlerts(computedMembers, snapshot, config, this.db);
      if (alerts.length > 0) {
        log.info('Alert', `${alerts.length} alerts detected for ${type} report`);
        const alertIds: number[] = [];
        for (const alert of alerts) {
          const alertId = this.db.recordAlert({
            alert_type: alert.type,
            event_key: alert.eventKey,
            member_viewer_id: alert.memberViewerId,
            report_date: alert.reportDate,
            created_at: new Date().toISOString(),
            status: 'pending',
            message: alert.message,
          });
          alertIds.push(alertId);
        }

        if (!options?.collectAlerts) {
          await this.deliverAlerts(alerts, options?.isCatchUp ?? false);
          for (const alertId of alertIds) {
            this.db.markAlertSent(alertId);
          }
        }
      }
    } catch (err) {
      log.error('Alert', `Alert processing failed for ${type} report (report was delivered)`, err);
    }

    if (options?.collectAlerts && alerts.length > 0) {
      return alerts;
    }
    return [];
  }

  // ── Full send pipeline ────────────────────────────────────

  /**
   * Generate a report, deliver it, and process alerts.
   * Returns collected alerts when options.collectAlerts is true (for catch-up aggregation).
   * Throws when no snapshot is available so callers know it failed.
   */
  async sendReport(
    type: string,
    options?: { offset?: number; isCatchUp?: boolean; collectAlerts?: boolean }
  ): Promise<Alert[]> {
    let snapshot = this.getSnapshot();
    if (!snapshot) {
      throw new Error(`No snapshot available for ${type} report`);
    }
    if (snapshot.members.length === 0) {
      throw new Error(`Snapshot has no members for ${type} report`);
    }

    const config = this.getConfig();

    // Month-alignment + stale data pre-fetch
    snapshot = await this.alignSnapshotToMonth(type, snapshot, config);

    // Pre-fetch target month for monthly reports with offset
    if (type === 'monthly' && Math.abs(options?.offset ?? 0) > 0) {
      const absOffset = Math.abs(options!.offset!);
      const { year: curYear, month: curMonth } = getDataDateComponents();
      let targetMonth = curMonth - absOffset;
      let targetYear = curYear;
      while (targetMonth <= 0) {
        targetMonth += 12;
        targetYear--;
      }
      const { year: snapYear, month: snapMonth } = snapshot.members[0];
      if (targetYear !== snapYear || targetMonth !== snapMonth) {
        try {
          await ensureMonthSnapshot(this.umaMoe, config.circleId, targetYear, targetMonth);
        } catch (err) {
          log.warn('Report', `Failed to pre-fetch month ${targetYear}-${targetMonth} for offset report: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    // Compute once, use everywhere
    const computedMembers = computeMembers(snapshot, config);
    const report = this.generateReportString(type, snapshot, config, computedMembers, options);
    if (report === undefined) return [];
    log.info('Report', `${type} report generated (${report.length} chars)`);

    // Deliver report first — this is the primary deliverable
    await this.deliverReport(report, type);

    // Detect, record, and deliver alerts
    return this.processAlertsForReport(type, snapshot, config, computedMembers, options);
  }
}
