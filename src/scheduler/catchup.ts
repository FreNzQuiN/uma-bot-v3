/**
 * Catch-up manager for Uma Club Bot v3.
 *
 * Detects which scheduled reports were missed while the bot was offline,
 * and sends them on restart. Respects maxReportsPerStartup limit.
 */

import type { BotConfig } from '../types';
import type { Database } from '../db/database';
import { getDataDate, getDataDay, getDataMonth, getDataYear } from '../utils/timezone';
import { log } from '../utils/logger';
import { groupByCollision } from './helpers';

// ============================================================
// Report types that can be caught up
// ============================================================

const REPORT_TYPES = ['daily', 'weekly', 'monthly'] as const;

// ============================================================
// CatchUpManager
// ============================================================

export class CatchUpManager {
  private db: Database;
  private getConfig: () => BotConfig;

  constructor(db: Database, getConfig: () => BotConfig) {
    this.db = db;
    this.getConfig = getConfig;
  }

  private get config(): BotConfig {
    return this.getConfig();
  }

  /**
   * Detect which report types were missed.
   *
   * For each report type, checks whether the most recent scheduled run
   * has already been completed. Instead of only checking "is today a
   * scheduled day", this checks "was the last successful run before the
   * most recent scheduled day".
   *
   * This handles the case where the bot is off on a scheduled day and
   * restarts on a later day — the missed report is still detected.
   */
  detectMissedReports(): string[] {
    if (!this.config.catchUp.enabled) {
      log.debug('CatchUp', 'Catch-up is disabled');
      return [];
    }

    const missed: string[] = [];

    for (const reportType of REPORT_TYPES) {
      if (!this.isReportEnabled(reportType)) continue;
      if (this.isReportMissed(reportType)) {
        missed.push(reportType);
      }
    }

    log.debug('CatchUp', `Detection complete: ${missed.length > 0 ? missed.join(', ') : 'no missed reports'}`);

    return missed;
  }

  /**
   * Determine if a report type was missed based on last successful run
   * vs the most recent scheduled day.
   */
  private isReportMissed(reportType: string): boolean {
    const lastRun = this.db.getLastSuccessfulRun(reportType);

    switch (reportType) {
      case 'daily': {
        // Daily should run every day. Missed if last run is before today.
        const todayStr = getDataDate();
        if (!lastRun) return true;
        return lastRun.report_date < todayStr;
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
    sendReport: (type: string, options?: { isCatchUp: boolean }) => Promise<unknown>,
    onCombinedReport?: (types: string[]) => Promise<unknown>
  ): Promise<{ sent: number; skipped: number; failed: number }> {
    if (!this.config.catchUp.enabled) {
      return { sent: 0, skipped: 0, failed: 0 };
    }

    const missed = this.detectMissedReports();
    const maxReports = this.config.catchUp.maxReportsPerStartup;
    const today = getDataDate();
    const scheduledAt = new Date().toISOString();
    const targetJid = this.config.groups.announcement[0] ?? '';

    if (!targetJid) {
      log.warn('CatchUp', 'No announcement groups configured, skipping catch-up');
      return { sent: 0, skipped: missed.length, failed: 0 };
    }

    // Group missed reports by collision (same time → combine)
    const groups = groupByCollision(missed, this.config);

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const group of groups) {
      if (sent >= maxReports) {
        skipped += group.length;
        continue;
      }

      if (group.length === 1) {
        // Single report — send individually
        const reportType = group[0];
        const runId = this.db.recordRun({
          report_type: reportType,
          report_date: today,
          scheduled_at: scheduledAt,
          status: 'pending',
          is_catch_up: true,
          target_jid: targetJid,
        });

        try {
          await sendReport(reportType, { isCatchUp: true });
          this.db.updateRunStatus(runId, 'sent');
          this.db.save(); // Persist immediately for crash recovery
          sent++;
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          this.db.updateRunStatus(runId, 'failed', errorMsg);
          failed++;
          log.error('CatchUp', `Failed to send ${reportType} report`, error);
        }
      } else {
        // Combined reports — send as one message
        const combinedKey = group.join('+');

        if (onCombinedReport) {
          let runId: number | undefined;
          try {
            runId = this.db.recordRun({
              report_type: combinedKey,
              report_date: today,
              scheduled_at: scheduledAt,
              status: 'pending',
              is_catch_up: true,
              target_jid: targetJid,
            });
            await onCombinedReport(group);
            this.db.updateRunStatus(runId, 'sent');
            this.db.save(); // Persist immediately for crash recovery
            // Record individual runs so scheduled reports don't duplicate
            for (const type of group) {
              this.db.recordRun({
                report_type: type,
                report_date: today,
                scheduled_at: scheduledAt,
                status: 'sent',
                is_catch_up: true,
                target_jid: targetJid,
              });
            }
            this.db.save(); // Persist individual records for crash recovery
            sent++;
            log.info('CatchUp', `Sent combined report: ${combinedKey}`);
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            if (runId !== undefined) {
              this.db.updateRunStatus(runId, 'failed', errorMsg);
            }
            failed++;
            log.error('CatchUp', `Failed to send combined report ${combinedKey}`, error);
          }
        } else {
          for (const reportType of group) {
            const runId = this.db.recordRun({
              report_type: reportType,
              report_date: today,
              scheduled_at: scheduledAt,
              status: 'pending',
              is_catch_up: true,
              target_jid: targetJid,
            });
            try {
              await sendReport(reportType, { isCatchUp: true });
              this.db.updateRunStatus(runId, 'sent');
              this.db.save(); // Persist immediately for crash recovery
              sent++;
            } catch (error) {
              const errorMsg = error instanceof Error ? error.message : String(error);
              this.db.updateRunStatus(runId, 'failed', errorMsg);
              failed++;
              log.error('CatchUp', `Failed to send ${reportType} report`, error);
            }
          }
        }
      }
    }

    return { sent, skipped, failed };
  }

  // ============================================================
  // Private helpers
  // ============================================================

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
