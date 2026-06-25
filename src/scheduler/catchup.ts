/**
 * Catch-up manager for Uma Club Bot v3.
 *
 * Detects which scheduled reports were missed while the bot was offline,
 * and sends them on restart. Respects maxReportsPerStartup limit.
 *
 * When catch-up is disabled, detection still runs and missed reports are
 * recorded as 'skipped' in the database. This prevents stale catch-up
 * triggers when catch-up is later re-enabled.
 */

import type { BotConfig } from '../types';
import type { IDatabase } from '../db/types';
import { getDataDate, getDataDay, getDataMonth, getDataYear, getDataDateComponents } from '../utils/timezone';
import { log } from '../utils/logger';
import { groupByCollision } from './helpers';

const REPORT_TYPES = ['daily', 'weekly', 'monthly'] as const;

/**
 * Calculate yesterday's date in YYYY-MM-DD (data timezone: JST).
 */
function getYesterdayDate(): string {
  const { year, month, day } = getDataDateComponents();
  const d = new Date(year, month - 1, day - 1);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const dd = d.getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

export class CatchUpManager {
  private db: IDatabase;
  private getConfig: () => BotConfig;

  constructor(db: IDatabase, getConfig: () => BotConfig) {
    this.db = db;
    this.getConfig = getConfig;
  }

  private get config(): BotConfig {
    return this.getConfig();
  }

  /**
   * Detect which report types were missed.
   *
   * Always runs regardless of catchUp.enabled — the caller decides
   * whether to execute catch-up or just record skipped runs.
   *
   * For each report type, checks whether the most recent run (sent or
   * skipped) covers the most recent scheduled day. A report is missed
   * only when the last run predates the most recent scheduled day.
   */
  async detectMissedReports(): Promise<string[]> {
    const missed: string[] = [];

    for (const reportType of REPORT_TYPES) {
      if (!this.isReportEnabled(reportType)) continue;
      if (await this.isReportMissed(reportType)) {
        missed.push(reportType);
      }
    }

    log.debug('CatchUp', `Detection complete: ${missed.length > 0 ? missed.join(', ') : 'no missed reports'}`);

    return missed;
  }

  /**
   * Record missed reports as 'skipped' in the database.
   *
   * Called when catch-up is disabled — marks each missed report type
   * so future detection won't treat those days as still pending.
   */
  async recordSkippedReports(missed: string[]): Promise<void> {
    if (missed.length === 0) return;

    const today = getDataDate();
    const scheduledAt = new Date().toISOString();
    const targetJid = this.config.groups.announcement[0] ?? '';

    for (const reportType of missed) {
      await this.db.recordRun({
        report_type: reportType,
        report_date: today,
        scheduled_at: scheduledAt,
        status: 'skipped',
        is_catch_up: false,
        target_jid: targetJid,
      });
    }
    await this.db.save();
    log.info('CatchUp', `Recorded ${missed.length} skipped report(s): ${missed.join(', ')}`);
  }

  /**
   * Determine if a report type was missed based on last run (sent or skipped)
   * vs the most recent scheduled day.
   *
   * Uses `< yesterday` instead of `< today` so that a run recorded on the
   * day the bot starts (even as 'skipped') prevents stale catch-up triggers.
   */
  private async isReportMissed(reportType: string): Promise<boolean> {
    const lastRun = await this.db.getLastRun(reportType);

    switch (reportType) {
      case 'daily': {
        // Daily should run every day. Missed if last run is before yesterday.
        // A run on today or yesterday means the report is covered.
        const yesterdayStr = getYesterdayDate();
        if (!lastRun) return true;
        return lastRun.report_date < yesterdayStr;
      }

      case 'weekly': {
        const todayDay = getDataDay();
        const weeklyDays = this.config.schedule.weekly.days;

        // Find the most recent scheduled day that has passed (today or before)
        let mostRecentScheduledDay = 0;
        for (const day of [...weeklyDays].sort((a, b) => b - a)) {
          if (day <= todayDay) {
            mostRecentScheduledDay = day;
            break;
          }
        }

        // If no scheduled day has passed this month yet, check last month
        if (mostRecentScheduledDay === 0) {
          const lastDay = Math.max(...weeklyDays);
          const jstYear = getDataYear();
          const jstMonth = getDataMonth();
          const prevMonth = jstMonth === 1 ? 12 : jstMonth - 1;
          const prevYear = jstMonth === 1 ? jstYear - 1 : jstYear;
          const lastScheduledDate = `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
          if (!lastRun) return true;
          return lastRun.report_date < lastScheduledDate;
        }

        const thisMonth = `${getDataYear()}-${String(getDataMonth()).padStart(2, '0')}-${String(mostRecentScheduledDay).padStart(2, '0')}`;
        if (!lastRun) return true;
        return lastRun.report_date < thisMonth;
      }

      case 'monthly': {
        const monthlyDay = this.config.schedule.monthly.day;

        // If today >= monthlyDay, check if we ran this month
        if (getDataDay() >= monthlyDay) {
          const thisMonth = `${getDataYear()}-${String(getDataMonth()).padStart(2, '0')}-${String(monthlyDay).padStart(2, '0')}`;
          if (!lastRun) return true;
          return lastRun.report_date < thisMonth;
        }

        // If today < monthlyDay, check if we ran last month
        const jstYear = getDataYear();
        const jstMonth = getDataMonth();
        const prevMonth = jstMonth === 1 ? 12 : jstMonth - 1;
        const prevYear = jstMonth === 1 ? jstYear - 1 : jstYear;
        const lastMonthStr = `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(monthlyDay).padStart(2, '0')}`;
        if (!lastRun) return true;
        return lastRun.report_date < lastMonthStr;
      }

      default:
        return false;
    }
  }

  /**
   * Execute catch-up by sending missed reports.
   *
   * Sends reports oldest-first (daily → weekly → monthly).
   * Combines colliding reports (same time) into single messages.
   * Respects maxReportsPerStartup limit.
   * Records each attempt in the database.
   */
  async executeCatchUp(
    sendReport: (type: string, options?: { isCatchUp: boolean; offset?: number }) => Promise<unknown>,
    onCombinedReport?: (types: string[]) => Promise<unknown>
  ): Promise<{ sent: number; skipped: number; failed: number; alerts: unknown[] }> {
    if (!this.config.catchUp.enabled) {
      return { sent: 0, skipped: 0, failed: 0, alerts: [] };
    }

    const missed = await this.detectMissedReports();
    const maxReports = this.config.catchUp.maxReportsPerStartup;
    const today = getDataDate();
    const scheduledAt = new Date().toISOString();
    const targetJid = this.config.groups.announcement[0] ?? '';

    if (!targetJid) {
      log.warn('CatchUp', 'No announcement groups configured, skipping catch-up');
      return { sent: 0, skipped: missed.length, failed: 0, alerts: [] };
    }

    // Group missed reports by collision (same time → combine)
    const groups = groupByCollision(missed, this.config);

    let sent = 0;
    let skipped = 0;
    let failed = 0;
    const alerts: unknown[] = [];

    for (const group of groups) {
      if (sent >= maxReports) {
        skipped += group.length;
        continue;
      }

      if (group.length === 1) {
        // Single report — send individually
        const reportType = group[0];
        const runId = await this.db.recordRun({
          report_type: reportType,
          report_date: today,
          scheduled_at: scheduledAt,
          status: 'pending',
          is_catch_up: true,
          target_jid: targetJid,
        });

        try {
          const result = await sendReport(reportType, { isCatchUp: true });
          if (Array.isArray(result)) alerts.push(...result);
          await this.db.updateRunStatus(runId, 'sent');
          await this.db.save(); // Persist immediately for crash recovery
          sent++;
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          await this.db.updateRunStatus(runId, 'failed', errorMsg);
          failed++;
          log.error('CatchUp', `Failed to send ${reportType} report`, error);
        }
      } else {
        // Combined reports — send as one message
        const combinedKey = group.join('+');

        if (onCombinedReport) {
          let runId: number | undefined;
          try {
            runId = await this.db.recordRun({
              report_type: combinedKey,
              report_date: today,
              scheduled_at: scheduledAt,
              status: 'pending',
              is_catch_up: true,
              target_jid: targetJid,
            });
            const result = await onCombinedReport(group);
            if (Array.isArray(result)) alerts.push(...result);
            await this.db.updateRunStatus(runId, 'sent');
            // Record individual runs so scheduled reports don't duplicate
            for (const type of group) {
              await this.db.recordRun({
                report_type: type,
                report_date: today,
                scheduled_at: scheduledAt,
                status: 'sent',
                is_catch_up: true,
                target_jid: targetJid,
              });
            }
            await this.db.save(); // Persist individual records for crash recovery
            sent++;
            log.info('CatchUp', `Sent combined report: ${combinedKey}`);
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            if (runId !== undefined) {
              await this.db.updateRunStatus(runId, 'failed', errorMsg);
            }
            failed++;
            log.error('CatchUp', `Failed to send combined report ${combinedKey}`, error);
          }
        } else {
          for (const reportType of group) {
            const runId = await this.db.recordRun({
              report_type: reportType,
              report_date: today,
              scheduled_at: scheduledAt,
              status: 'pending',
              is_catch_up: true,
              target_jid: targetJid,
            });
            try {
              const result = await sendReport(reportType, { isCatchUp: true });
              if (Array.isArray(result)) alerts.push(...result);
              await this.db.updateRunStatus(runId, 'sent');
              await this.db.save(); // Persist immediately for crash recovery
              sent++;
            } catch (error) {
              const errorMsg = error instanceof Error ? error.message : String(error);
              await this.db.updateRunStatus(runId, 'failed', errorMsg);
              failed++;
              log.error('CatchUp', `Failed to send ${reportType} report`, error);
            }
          }
        }
      }
    }

    return { sent, skipped, failed, alerts };
  }

  private isReportEnabled(reportType: string): boolean {
    switch (reportType) {
      case 'daily':
        return this.config.schedule.daily.enabled;
      case 'weekly':
        return this.config.schedule.weekly.enabled;
      case 'monthly':
        return this.config.schedule.monthly.enabled;
      default:
        return false;
    }
  }

}
