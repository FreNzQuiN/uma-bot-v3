/**
 * Auto-delivery scheduler for Uma Club Bot v3.
 *
 * Schedules daily, weekly, and monthly reports using node-cron.
 * Handles collision detection (daily + weekly on same day/time).
 * Delegates report sending to the provided callback.
 */

import cron, { ScheduledTask } from 'node-cron';
import type { BotConfig } from '../types';
import type { Database } from '../db/database';
import { getDataDate, getDataDay } from '../utils/timezone';
import { log } from '../utils/logger';
import { getCollidingTypes, isScheduledToday } from './helpers';

// ============================================================
// Scheduler
// ============================================================

export class Scheduler {
  private getConfig: () => BotConfig;
  private db: Database;
  private onDataFetch?: () => Promise<void>;
  private onReport: (type: string, options?: { offset?: number }) => Promise<unknown>;
  private onCombinedReport?: (types: string[], options?: { offset?: number }) => Promise<void>;
  private tasks: ScheduledTask[] = [];

  constructor(
    getConfig: () => BotConfig,
    db: Database,
    onReport?: (type: string, options?: { offset?: number }) => Promise<unknown>,
    onCombinedReport?: (types: string[], options?: { offset?: number }) => Promise<void>,
    onDataFetch?: () => Promise<void>
  ) {
    this.getConfig = getConfig;
    this.db = db;
    this.onReport = onReport ?? (async () => {});
    this.onCombinedReport = onCombinedReport;
    this.onDataFetch = onDataFetch;
  }

  private get config(): BotConfig {
    return this.getConfig();
  }

  /**
   * Record a schedule run in the database.
   * Returns the run ID for status updates.
   */
  private recordAndSend = async (reportType: string, options?: { offset?: number }): Promise<void> => {
    const targetJid = this.config.groups.announcement[0] ?? '';
    if (!targetJid) {
      log.warn('Scheduler', `No announcement groups configured, skipping ${reportType}`);
      return;
    }

    const today = getDataDate();

    // Check if already sent today (catch-up or previous scheduler run)
    const lastRun = this.db.getLastSuccessfulRun(reportType);
    if (lastRun && lastRun.report_date === today) {
      log.debug('Scheduler', `${reportType} already sent today, skipping`);
      return;
    }

    const scheduledAt = new Date().toISOString();

    const runId = this.db.recordRun({
      report_type: reportType,
      report_date: today,
      scheduled_at: scheduledAt,
      status: 'pending',
      is_catch_up: false,
      target_jid: targetJid,
    });

    try {
      await this.onReport(reportType, options);
      this.db.updateRunStatus(runId, 'sent');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.db.updateRunStatus(runId, 'failed', errorMsg);
      throw error;
    }
  };

  /**
   * Send multiple report types as one combined message.
   * Skips types already sent today. Records a single combined run.
   */
  private recordAndSendCombined = async (types: string[], options?: { offset?: number }): Promise<void> => {
    const targetJid = this.config.groups.announcement[0] ?? '';
    if (!targetJid) {
      log.warn('Scheduler', `No announcement groups configured, skipping combined report`);
      return;
    }

    const today = getDataDate();

    // Filter out types already sent today
    const pending = types.filter((t) => {
      const lastRun = this.db.getLastSuccessfulRun(t);
      return !lastRun || lastRun.report_date !== today;
    });

    if (pending.length === 0) {
      log.debug('Scheduler', 'Combined reports already sent today, skipping');
      return;
    }

    const scheduledAt = new Date().toISOString();

    const runId = this.db.recordRun({
      report_type: pending.join('+'),
      report_date: today,
      scheduled_at: scheduledAt,
      status: 'pending',
      is_catch_up: false,
      target_jid: targetJid,
    });

    try {
      if (this.onCombinedReport) {
        await this.onCombinedReport(pending, options);
      } else {
        // Fallback: send individually
        for (const type of pending) {
          await this.onReport(type, options);
        }
      }
      this.db.updateRunStatus(runId, 'sent');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.db.updateRunStatus(runId, 'failed', errorMsg);
      throw error;
    }
  };

  /**
   * Detect if two report types collide (same day and same time).
   */
  detectCollision(dayOfMonth: number, typeA: string, typeB: string): boolean {
    const schedule = this.config.schedule;
    const times: Record<string, string | undefined> = {
      daily: schedule.daily.time,
      weekly: schedule.weekly.time,
      monthly: schedule.monthly.time,
    };
    if (times[typeA] !== times[typeB]) return false;
    const aScheduled = isScheduledToday(typeA, dayOfMonth, this.config);
    const bScheduled = isScheduledToday(typeB, dayOfMonth, this.config);
    return aScheduled && bScheduled;
  }

  /**
   * Schedule a silent data fetch at the daily report time.
   */
  private scheduleDataFetch(): void {
    const dailyCron = this.getDailyCron();
    const task = cron.schedule(dailyCron, async () => {
      try {
        await this.onDataFetch?.();
        log.debug('Scheduler', 'Scheduled data fetch completed');
      } catch (error) {
        log.error('Scheduler', 'Scheduled data fetch failed', error);
      }
    });
    this.tasks.push(task);
  }

  /**
   * Generate the cron expression for daily reports.
   */
  getDailyCron(): string {
    const [hour, minute] = this.config.schedule.daily.time.split(':');
    return `${minute} ${hour} * * *`;
  }

  /**
   * Generate the cron expression for weekly reports.
   */
  getWeeklyCron(): string {
    const [hour, minute] = this.config.schedule.weekly.time.split(':');
    const days = this.config.schedule.weekly.days.join(',');
    return `${minute} ${hour} ${days} * *`;
  }

  /**
   * Generate the cron expression for monthly reports.
   */
  getMonthlyCron(): string {
    const [hour, minute] = this.config.schedule.monthly.time.split(':');
    const day = this.config.schedule.monthly.day;
    return `${minute} ${hour} ${day} * *`;
  }

  /**
   * Start all enabled scheduled tasks.
   */
  start(): void {
    this.stop(); // clear any existing tasks

    const scheduledDays = new Set([
      ...this.config.schedule.weekly.days,
      this.config.schedule.monthly.day,
    ]);

    // Data fetch task — registered FIRST
    this.scheduleDataFetch();

    // Daily schedule
    if (this.config.schedule.daily.enabled) {
      const dailyCron = this.getDailyCron();
      const task = cron.schedule(dailyCron, async () => {
        try {
          const today = getDataDay();
          const collidingTypes = getCollidingTypes(today, this.config);

          if (collidingTypes.length > 1) {
            await this.recordAndSendCombined(collidingTypes);
          } else {
            await this.recordAndSend('daily');
          }
        } catch (error) {
          log.error('Scheduler', 'Daily report failed', error);
        }
      });
      this.tasks.push(task);
    }

    // Weekly schedule — skip only when daily is enabled AND same time (daily handler combines them)
    if (this.config.schedule.weekly.enabled) {
      const weeklyCron = this.getWeeklyCron();
      const task = cron.schedule(weeklyCron, async () => {
        try {
          const today = getDataDay();
          const collidingTypes = getCollidingTypes(today, this.config);
          const dailyEnabled = this.config.schedule.daily.enabled;

          if (collidingTypes.includes('daily') && collidingTypes.includes('weekly') && dailyEnabled) {
            return;
          }

          const monthlyEnabled = this.config.schedule.monthly.enabled;
          const isMonthlyDay = this.config.schedule.monthly.day === today;
          const sameTimeAsMonthly =
            this.config.schedule.monthly.time === this.config.schedule.weekly.time;

          if (monthlyEnabled && sameTimeAsMonthly && isMonthlyDay) {
            await this.recordAndSendCombined(['weekly', 'monthly']);
            return;
          }

          await this.recordAndSend('weekly');
        } catch (error) {
          log.error('Scheduler', 'Weekly report failed', error);
        }
      });
      this.tasks.push(task);
    }

    // Monthly schedule — skip only when daily is enabled AND same time (daily handler combines them)
    if (this.config.schedule.monthly.enabled) {
      const monthlyCron = this.getMonthlyCron();
      const task = cron.schedule(monthlyCron, async () => {
        try {
          const today = getDataDay();
          const collidingTypes = getCollidingTypes(today, this.config);
          const dailyEnabled = this.config.schedule.daily.enabled;

          if (collidingTypes.includes('daily') && collidingTypes.includes('monthly') && dailyEnabled) {
            return;
          }

          await this.recordAndSend('monthly', { offset: -1 });
        } catch (error) {
          log.error('Scheduler', 'Monthly report failed', error);
        }
      });
      this.tasks.push(task);
    }
  }

  /**
   * Stop all scheduled tasks.
   */
  stop(): void {
    if (this.tasks.length > 0) {
      log.debug('Scheduler', `Stopping ${this.tasks.length} task(s)`);
    }
    for (const task of this.tasks) {
      task.stop();
    }
    this.tasks = [];
  }
}
