/**
 * Report orchestration for Uma Club Bot v3.
 *
 * Encapsulates report generation, delivery, and alert processing.
 * Extracted from index.ts to separate business logic from composition root.
 */

import type { BotConfig, Snapshot, ComputedMember } from '../types';
import type { IDatabase } from '../db/types';
import type { UmaMoeClient } from '../api/uma-moe';
import type { WhatsAppClient } from '../whatsapp/client';
import { detectAlerts, formatAlerts, type Alert } from '../alerts/alerts';
import { saveSnapshot, ensureMonthSnapshot, getDataDayFromSnapshot, setCachedSnapshot } from '../data/snapshot';
import { getDataDate, getDataDateComponents, getTargetMonth } from '../utils/timezone';
import { computeMembers } from '../reports/compute';
import { generateCombinedReport } from '../reports/combined';
import { generateReportString } from '../reports/registry';
import { log } from '../utils/logger';
import { preFetchMonthlySnapshot } from '../scheduler/helpers';

export interface ReportOrchestratorDeps {
  getConfig: () => BotConfig;
  getSnapshot: () => Snapshot | null;
  umaMoe: UmaMoeClient;
  db: IDatabase;
  waClient: WhatsAppClient;
}

export class ReportOrchestrator {
  private getConfig: () => BotConfig;
  private getSnapshot: () => Snapshot | null;
  private umaMoe: UmaMoeClient;
  private db: IDatabase;
  private waClient: WhatsAppClient;

  constructor(deps: ReportOrchestratorDeps) {
    this.getConfig = deps.getConfig;
    this.getSnapshot = deps.getSnapshot;
    this.umaMoe = deps.umaMoe;
    this.db = deps.db;
    this.waClient = deps.waClient;
  }

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

  /**
   * Mark alerts as sent by their event keys.
   * Used after deferred delivery in catch-up flows.
   */
  async markAlertsByEventKeys(eventKeys: string[]): Promise<void> {
    if (eventKeys.length === 0) return;
    await this.db.markAlertsByEventKeys(eventKeys);
  }

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
    if (snapshot.members.length === 0) return snapshot;

    if (type === 'daily' || type === 'weekly') {
      const { year: snapYear, month: snapMonth } = snapshot.members[0];
      const { year: curYear, month: curMonth } = getDataDateComponents();
      if (snapYear !== curYear || snapMonth !== curMonth) {
        try {
          log.info('Report', `Snapshot is from ${snapYear}-${snapMonth}, fetching current month ${curYear}-${curMonth}`);
          const freshSnapshot = await this.umaMoe.fetchCircleData(config.circleId, curYear, curMonth);
          if (freshSnapshot.members.length > 0) {
            saveSnapshot(freshSnapshot, getDataDate());
            setCachedSnapshot(freshSnapshot);
            snapshot = freshSnapshot;
            log.info('Report', `Fresh data fetched for ${type} report`);
          } else {
            log.warn('Report', 'Fresh fetch returned empty snapshot, keeping existing data');
          }
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
          if (freshSnapshot.members.length > 0) {
            saveSnapshot(freshSnapshot, getDataDate());
            setCachedSnapshot(freshSnapshot);
            snapshot = freshSnapshot;
          } else {
            log.warn('Report', 'Stale refresh returned empty snapshot, keeping existing data');
          }
        } catch (err) {
          log.warn('Report', `Failed to refresh stale data, using existing snapshot`, err);
        }
      }
    }

    return snapshot;
  }

  async buildReportString(
    type: string,
    snapshot: Snapshot,
    config: BotConfig,
    computedMembers: ComputedMember[],
    options?: { offset?: number; isCatchUp?: boolean }
  ): Promise<string | undefined> {
    let report: string | undefined = await generateReportString(type, snapshot, config, computedMembers, { offset: options?.offset, db: this.db });
    if (report === undefined) {
      log.error('Report', `Unknown report type: ${type}`);
      return undefined;
    }

    if (options?.isCatchUp) {
      const lines = report.split('\n');
      lines.splice(1, 0, '', '*⚠️ Catch-up*');
      report = lines.join('\n');
    }

    return report;
  }

  generateCombinedReportString(
    types: string[],
    snapshot: Snapshot,
    config: BotConfig,
    computedMembers: ComputedMember[]
  ): string {
    return generateCombinedReport(types, snapshot, config, computedMembers);
  }

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
      alerts = await detectAlerts(computedMembers, snapshot, config, this.db);
      if (alerts.length > 0) {
        log.info('Alert', `${alerts.length} alerts detected for ${type} report`);

        const alertIds = await this.db.recordAlerts(alerts.map((a) => ({
          alert_type: a.type,
          event_key: a.eventKey,
          member_viewer_id: a.memberViewerId,
          report_date: a.reportDate,
          created_at: new Date().toISOString(),
          status: 'pending',
          message: a.message,
        })));

        if (!options?.collectAlerts) {
          await this.deliverAlerts(alerts, options?.isCatchUp ?? false);
          await this.db.markAlertsSent(alertIds);
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

  async sendCombinedCatchUp(types: string[]): Promise<Alert[]> {
    const snapshot = this.getSnapshot();
    if (!snapshot) throw new Error('No snapshot available for combined catch-up report');
    if (snapshot.members.length === 0) {
      throw new Error('Snapshot has no members for combined catch-up report');
    }
    const config = this.getConfig();

    if (types.includes('monthly')) {
      const { year: snapYear, month: snapMonth } = snapshot.members[0];
      await preFetchMonthlySnapshot(
        (y, m) => ensureMonthSnapshot(this.umaMoe, config.circleId, y, m),
        1,
        'combined catch-up report',
        snapYear,
        snapMonth
      );
    }

    const computedMembers = computeMembers(snapshot, config);
    const combined = this.generateCombinedReportString(types, snapshot, config, computedMembers);
    const lines = combined.split('\n');
    lines.splice(1, 0, '', '*⚠️ Catch-up*');
    await this.deliverReport(lines.join('\n'), types.join('+'));

    const allAlerts: Alert[] = [];
    for (const type of types) {
      const alerts = await this.processAlertsForReport(type, snapshot, config, computedMembers, { isCatchUp: true, collectAlerts: true });
      allAlerts.push(...alerts);
    }
    return allAlerts;
  }

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

    snapshot = await this.alignSnapshotToMonth(type, snapshot, config);

    if (type === 'monthly' && Math.abs(options?.offset ?? 0) > 0) {
      const { year: snapYear, month: snapMonth } = snapshot.members[0];
      const { year: targetYear, month: targetMonth } = getTargetMonth(snapYear, snapMonth, options!.offset!);
      if (targetYear !== snapYear || targetMonth !== snapMonth) {
        await preFetchMonthlySnapshot(
          (y, m) => ensureMonthSnapshot(this.umaMoe, config.circleId, y, m),
          options!.offset!,
          'offset report',
          snapYear,
          snapMonth
        );
      }
    }

    const computedMembers = computeMembers(snapshot, config);
    const report = await this.buildReportString(type, snapshot, config, computedMembers, options);
    if (report === undefined) return [];
    log.info('Report', `${type} report generated (${report.length} chars)`);

    // Deliver report first — this is the primary deliverable
    await this.deliverReport(report, type);

    // Detect, record, and deliver alerts in background — don't block report delivery
    // for the next user command. collectAlerts mode still returns results for catch-up.
    if (options?.collectAlerts) {
      return this.processAlertsForReport(type, snapshot, config, computedMembers, options);
    }
    log.debug('Alert', `Deferring alert processing for ${type} report to background`);
    this.processAlertsForReport(type, snapshot, config, computedMembers, options)
      .catch((err) => log.error('Alert', `Background alert processing failed for ${type}`, err));
    return [];
  }
}
