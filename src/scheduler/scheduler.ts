/**
 * Auto-delivery scheduler for Uma Club Bot v3.
 *
 * Schedules daily, weekly, and monthly reports using node-cron.
 * Handles collision detection (daily + weekly on same day/time).
 * Delegates report sending to the provided callback.
 */

import cron, { ScheduledTask } from 'node-cron';
import type { BotConfig } from '../types';
import type { IDatabase } from '../db/types';
import { getDataDate, getDataDay } from '../utils/timezone';
import { log } from '../utils/logger';
import { getCollidingTypes, isScheduledToday } from './helpers';

export class Scheduler {
  private getConfig: () => BotConfig;
  private db: IDatabase;
  private onDataFetch?: () => Promise<void>;
  private onReport: (type: string, options?: { offset?: number }) => Promise<unknown>;
  private onCombinedReport?: (types: string[], options?: { offset?: number }) => Promise<void>;
  private tasks: ScheduledTask[] = [];

  constructor(
    getConfig: () => BotConfig,
    db: IDatabase,
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

  private recordAndSend = async (reportType: string, options?: { offset?: number }): Promise<void> => {
    const targetJid = this.config.groups.announcement[0] ?? '';
    if (!targetJid) {
      log.warn('Scheduler', `No announcement groups configured, skipping ${reportType}`);
      return;
    }

    const today = getDataDate();

    // Check if already sent today (catch-up or previous scheduler run)
    const lastRun = await this.db.getLastSuccessfulRun(reportType);
    if (lastRun && lastRun.report_date === today) {
      log.debug('Scheduler', `${reportType} already sent today, skipping`);
      return;
    }

    const scheduledAt = new Date().toISOString();

    const runId = await this.db.recordRun({
      report_type: reportType,
      report_date: today,
      scheduled_at: scheduledAt,
      status: 'pending',
      is_catch_up: false,
      target_jid: targetJid,
    });

    try {
      await this.onReport(reportType, options);
      await this.db.updateRunStatus(runId, 'sent');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      await this.db.updateRunStatus(runId, 'failed', errorMsg);
      throw error;
    }
  };

  private recordAndSendCombined = async (types: string[], options?: { offset?: number }): Promise<void> => {
    const targetJid = this.config.groups.announcement[0] ?? '';
    if (!targetJid) {
      log.warn('Scheduler', `No announcement groups configured, skipping combined report`);
      return;
    }

    const today = getDataDate();

    const pending: string[] = [];
    for (const t of types) {
      const lastRun = await this.db.getLastSuccessfulRun(t);
      if (!lastRun || lastRun.report_date !== today) {
        pending.push(t);
      }
    }

    if (pending.length === 0) {
      log.debug('Scheduler', 'Combined reports already sent today, skipping');
      return;
    }

    const scheduledAt = new Date().toISOString();

    const runId = await this.db.recordRun({
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
      await this.db.updateRunStatus(runId, 'sent');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      await this.db.updateRunStatus(runId, 'failed', errorMsg);
      throw error;
    }
  };

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

  getDailyCron(): string {
    const [hour, minute] = this.config.schedule.daily.time.split(':');
    return `${minute} ${hour} * * *`;
  }

  getWeeklyCron(): string {
    const [hour, minute] = this.config.schedule.weekly.time.split(':');
    const days = this.config.schedule.weekly.days.join(',');
    return `${minute} ${hour} ${days} * *`;
  }

  getMonthlyCron(): string {
    const [hour, minute] = this.config.schedule.monthly.time.split(':');
    const day = this.config.schedule.monthly.day;
    return `${minute} ${hour} ${day} * *`;
  }

  start(): void {
    this.stop(); // clear any existing tasks

    const scheduledDays = new Set([
      ...this.config.schedule.weekly.days,
      this.config.schedule.monthly.day,
    ]);

    // Data fetch task — registered FIRST
    this.scheduleDataFetch();

    if (this.config.schedule.daily.enabled) {
      const dailyCron = this.getDailyCron();
      try {
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
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error('Scheduler', `Failed to schedule daily: ${msg}`);
      }
    }

    // Weekly schedule — skip only when daily is enabled AND same time (daily handler combines them)
    if (this.config.schedule.weekly.enabled) {
      const weeklyCron = this.getWeeklyCron();
      try {
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
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error('Scheduler', `Failed to schedule weekly: ${msg}`);
      }
    }

    // Monthly schedule — skip only when daily is enabled AND same time (daily handler combines them)
    if (this.config.schedule.monthly.enabled) {
      const monthlyCron = this.getMonthlyCron();
      try {
        const task = cron.schedule(monthlyCron, async () => {
          try {
            const today = getDataDay();
            const collidingTypes = getCollidingTypes(today, this.config);
            const dailyEnabled = this.config.schedule.daily.enabled;

            // Skip if daily handler will combine with monthly (same time)
            if (collidingTypes.includes('daily') && collidingTypes.includes('monthly') && dailyEnabled) {
              return;
            }

            // Skip if weekly handler already sends combined weekly+monthly (same time)
            const weeklyEnabled = this.config.schedule.weekly.enabled;
            const isWeeklyDay = this.config.schedule.weekly.days.includes(today);
            const sameTimeAsWeekly =
              this.config.schedule.monthly.time === this.config.schedule.weekly.time;
            if (weeklyEnabled && sameTimeAsWeekly && isWeeklyDay) {
              return;
            }

            await this.recordAndSend('monthly', { offset: -1 });
          } catch (error) {
            log.error('Scheduler', 'Monthly report failed', error);
          }
        });
        this.tasks.push(task);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error('Scheduler', `Failed to schedule monthly: ${msg}`);
      }
    }
  }

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
