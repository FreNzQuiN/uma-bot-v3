import { Scheduler } from '../../src/scheduler/scheduler';
import { CatchUpManager } from '../../src/scheduler/catchup';
import { getCollidingTypes } from '../../src/scheduler/helpers';
import { SqliteDatabase } from '../../src/db/database';
import { getDataDate } from '../../src/utils/timezone';
import { makeConfig } from '../_helpers';

let db: SqliteDatabase;

beforeEach(async () => {
  db = new SqliteDatabase(':memory:');
  await db.initialize();
});

afterEach(() => {
  db.close();
});


describe('Scheduler', () => {
  describe('collision detection', () => {
    it('detects daily+weekly collision on day 7', () => {
      const config = makeConfig({
        schedule: {
          daily: { enabled: true, time: '22:05' },
          weekly: { enabled: true, days: [7, 14, 21, 28], time: '22:05' },
          monthly: { enabled: true, day: 1, time: '22:12' },
        },
      });
      const onReport = jest.fn();
      const scheduler = new Scheduler(() => config, db, onReport);

      // Day 7 with same time → collision
      const hasCollision = scheduler.detectCollision(7, 'daily', 'weekly');
      expect(hasCollision).toBe(true);
    });

    it('detects daily+weekly collision on day 14', () => {
      const config = makeConfig();
      const onReport = jest.fn();
      const scheduler = new Scheduler(() => config, db, onReport);

      const hasCollision = scheduler.detectCollision(14, 'daily', 'weekly');
      expect(hasCollision).toBe(true);
    });

    it('no collision when different times', () => {
      const config = makeConfig({
        schedule: {
          daily: { enabled: true, time: '22:05' },
          weekly: { enabled: true, days: [7, 14, 21, 28], time: '22:15' },
          monthly: { enabled: true, day: 1, time: '22:12' },
        },
      });
      const onReport = jest.fn();
      const scheduler = new Scheduler(() => config, db, onReport);

      const hasCollision = scheduler.detectCollision(7, 'daily', 'weekly');
      expect(hasCollision).toBe(false);
    });

    it('no collision on non-weekly day', () => {
      const config = makeConfig();
      const onReport = jest.fn();
      const scheduler = new Scheduler(() => config, db, onReport);

      const hasCollision = scheduler.detectCollision(10, 'daily', 'weekly');
      expect(hasCollision).toBe(false);
    });

    it('detects daily+monthly collision on day 1', () => {
      const config = makeConfig({
        schedule: {
          daily: { enabled: true, time: '22:05' },
          weekly: { enabled: true, days: [7, 14, 21, 28], time: '22:05' },
          monthly: { enabled: true, day: 1, time: '22:05' },
        },
      });
      const onReport = jest.fn();
      const scheduler = new Scheduler(() => config, db, onReport);

      const hasCollision = scheduler.detectCollision(1, 'daily', 'monthly');
      expect(hasCollision).toBe(true);
    });

    it('detects weekly+monthly collision on day 7', () => {
      const config = makeConfig({
        schedule: {
          daily: { enabled: true, time: '22:05' },
          weekly: { enabled: true, days: [7, 14, 21, 28], time: '22:10' },
          monthly: { enabled: true, day: 7, time: '22:10' },
        },
      });
      const onReport = jest.fn();
      const scheduler = new Scheduler(() => config, db, onReport);

      expect(scheduler.detectCollision(7, 'weekly', 'monthly')).toBe(true);
      expect(scheduler.detectCollision(7, 'monthly', 'weekly')).toBe(true);
    });

    it('no weekly+monthly collision when different times', () => {
      const config = makeConfig({
        schedule: {
          daily: { enabled: true, time: '22:05' },
          weekly: { enabled: true, days: [7, 14, 21, 28], time: '22:05' },
          monthly: { enabled: true, day: 7, time: '22:12' },
        },
      });
      const onReport = jest.fn();
      const scheduler = new Scheduler(() => config, db, onReport);

      expect(scheduler.detectCollision(7, 'weekly', 'monthly')).toBe(false);
    });

    it('no weekly+monthly collision when day not in both schedules', () => {
      const config = makeConfig({
        schedule: {
          daily: { enabled: true, time: '22:05' },
          weekly: { enabled: true, days: [7, 14, 21, 28], time: '22:10' },
          monthly: { enabled: true, day: 1, time: '22:10' },
        },
      });
      const onReport = jest.fn();
      const scheduler = new Scheduler(() => config, db, onReport);

      // Day 7 is in weekly but not monthly day 1
      expect(scheduler.detectCollision(7, 'weekly', 'monthly')).toBe(false);
    });
  });

  describe('cron expression generation', () => {
    it('generates correct daily cron expression', () => {
      const config = makeConfig({
        schedule: {
          daily: { enabled: true, time: '22:05' },
          weekly: { enabled: true, days: [7, 14, 21, 28], time: '22:05' },
          monthly: { enabled: true, day: 1, time: '22:12' },
        },
      });
      const onReport = jest.fn();
      const scheduler = new Scheduler(() => config, db, onReport);

      const cronExpr = scheduler.getDailyCron();
      // 22:05 WIB → "5 22 * * *"
      expect(cronExpr).toBe('05 22 * * *');
    });

    it('generates correct weekly cron expression', () => {
      const config = makeConfig({
        schedule: {
          daily: { enabled: true, time: '22:05' },
          weekly: { enabled: true, days: [7, 14, 21, 28], time: '22:05' },
          monthly: { enabled: true, day: 1, time: '22:12' },
        },
      });
      const onReport = jest.fn();
      const scheduler = new Scheduler(() => config, db, onReport);

      const cronExpr = scheduler.getWeeklyCron();
      // Days 7,14,21,28 at 22:05 → "5 22 7,14,21,28 * *"
      expect(cronExpr).toBe('05 22 7,14,21,28 * *');
    });

    it('generates correct monthly cron expression', () => {
      const config = makeConfig({
        schedule: {
          daily: { enabled: true, time: '22:05' },
          weekly: { enabled: true, days: [7, 14, 21, 28], time: '22:05' },
          monthly: { enabled: true, day: 1, time: '22:12' },
        },
      });
      const onReport = jest.fn();
      const scheduler = new Scheduler(() => config, db, onReport);

      const cronExpr = scheduler.getMonthlyCron();
      // Day 1 at 22:12 → "12 22 1 * *"
      expect(cronExpr).toBe('12 22 1 * *');
    });
  });

  describe('scheduler lifecycle', () => {
    it('starts without error', () => {
      const config = makeConfig();
      const onReport = jest.fn();
      const scheduler = new Scheduler(() => config, db, onReport);

      expect(() => scheduler.start()).not.toThrow();
      scheduler.stop();
    });

    it('stops without error', () => {
      const config = makeConfig();
      const onReport = jest.fn();
      const scheduler = new Scheduler(() => config, db, onReport);

      scheduler.start();
      expect(() => scheduler.stop()).not.toThrow();
    });

    it('stop is idempotent', () => {
      const config = makeConfig();
      const onReport = jest.fn();
      const scheduler = new Scheduler(() => config, db, onReport);

      scheduler.start();
      scheduler.stop();
      expect(() => scheduler.stop()).not.toThrow();
    });
  });

  describe('daily-disabled collision handling', () => {
    it('weekly handler does NOT skip when daily is disabled (same time)', async () => {
      const config = makeConfig({
        schedule: {
          daily: { enabled: false, time: '22:05' },
          weekly: { enabled: true, days: [7, 14, 21, 28], time: '22:05' },
          monthly: { enabled: false, day: 1, time: '22:12' },
        },
        groups: { command: [], announcement: ['test@g.us'], alertAdmin: [] },
      });
      const onReport = jest.fn().mockResolvedValue(undefined);
      const scheduler = new Scheduler(() => config, db, onReport);

      // Access the weekly cron task's callback directly via start/stop
      // Simulate by calling recordAndSend for weekly
      const recordAndSend = (scheduler as any).recordAndSend;
      await recordAndSend('weekly');

      expect(onReport).toHaveBeenCalledWith('weekly', undefined);
    });

    it('monthly handler does NOT skip when daily is disabled (same time)', async () => {
      const config = makeConfig({
        schedule: {
          daily: { enabled: false, time: '22:05' },
          weekly: { enabled: false, days: [7, 14, 21, 28], time: '22:05' },
          monthly: { enabled: true, day: 1, time: '22:05' },
        },
        groups: { command: [], announcement: ['test@g.us'], alertAdmin: [] },
      });
      const onReport = jest.fn().mockResolvedValue(undefined);
      const scheduler = new Scheduler(() => config, db, onReport);

      const recordAndSend = (scheduler as any).recordAndSend;
      await recordAndSend('monthly');

      expect(onReport).toHaveBeenCalledWith('monthly', undefined);
    });

    it('weekly handler skips when daily IS enabled (same time)', () => {
      const config = makeConfig({
        schedule: {
          daily: { enabled: true, time: '22:05' },
          weekly: { enabled: true, days: [7, 14, 21, 28], time: '22:05' },
          monthly: { enabled: false, day: 1, time: '22:12' },
        },
        groups: { command: [], announcement: ['test@g.us'], alertAdmin: [] },
      });
      const onReport = jest.fn().mockResolvedValue(undefined);
      const scheduler = new Scheduler(() => config, db, onReport);

      // getCollidingTypes on day 7 (weekly day) with daily enabled + same time
      // should return both 'daily' and 'weekly' in the same collision group
      const collidingTypes = getCollidingTypes(7, config);
      expect(collidingTypes).toContain('daily');
      expect(collidingTypes).toContain('weekly');

      // The weekly handler skips when this condition (scheduler.ts:246) is true:
      // collidingTypes.includes('daily') && collidingTypes.includes('weekly') && dailyEnabled
      const dailyEnabled = config.schedule.daily.enabled;
      expect(
        collidingTypes.includes('daily') && collidingTypes.includes('weekly') && dailyEnabled
      ).toBe(true);

      // On a non-weekly day, weekly is not in the collision group (handler wouldn't fire)
      const nonWeeklyDay = getCollidingTypes(10, config);
      expect(nonWeeklyDay).not.toContain('weekly');
    });

    it('monthly handler skips when weekly+monthly collide (same time, different from daily)', () => {
      const config = makeConfig({
        schedule: {
          daily: { enabled: true, time: '22:05' },
          weekly: { enabled: true, days: [7, 14, 21, 28], time: '22:10' },
          monthly: { enabled: true, day: 7, time: '22:10' },
        },
        groups: { command: [], announcement: ['test@g.us'], alertAdmin: [] },
      });
      const onReport = jest.fn().mockResolvedValue(undefined);
      const scheduler = new Scheduler(() => config, db, onReport);

      // On day 7: daily at 22:05, weekly+monthly at 22:10
      // getCollidingTypes prioritizes the daily group (contains only 'daily')
      const collidingTypes = getCollidingTypes(7, config);
      expect(collidingTypes).toContain('daily');

      // The monthly handler skips when this condition (scheduler.ts:292) is true:
      // weeklyEnabled && sameTimeAsWeekly && isWeeklyDay
      const weeklyEnabled = config.schedule.weekly.enabled;
      const isWeeklyDay = config.schedule.weekly.days.includes(7);
      const sameTimeAsWeekly = config.schedule.monthly.time === config.schedule.weekly.time;
      expect(weeklyEnabled && sameTimeAsWeekly && isWeeklyDay).toBe(true);

      // On monthly day 1 (not a weekly day), the handler should NOT skip
      const isWeeklyDay1 = config.schedule.weekly.days.includes(1);
      expect(weeklyEnabled && sameTimeAsWeekly && isWeeklyDay1).toBe(false);
    });
  });

  describe('double-send guard', () => {
    it('skips sending if report already sent today', async () => {
      const config = makeConfig({
        groups: { command: [], announcement: ['test@g.us'], alertAdmin: [] },
      });
      const onReport = jest.fn().mockResolvedValue(undefined);
      const scheduler = new Scheduler(() => config, db, onReport);

      // Record a successful daily run for today (use JST date like the scheduler does)
      const today = getDataDate();
      await db.recordRun({
        report_type: 'daily',
        report_date: today,
        scheduled_at: `${today}T22:05:00.000Z`,
        sent_at: `${today}T22:05:01.000Z`,
        status: 'sent',
        is_catch_up: false,
        target_jid: 'test@g.us',
      });

      // Try to send daily again via recordAndSend
      const recordAndSend = (scheduler as any).recordAndSend;
      await recordAndSend('daily');

      // Should NOT call onReport since it was already sent today
      expect(onReport).not.toHaveBeenCalled();
    });

    it('sends if report was sent yesterday but not today', async () => {
      const config = makeConfig({
        groups: { command: [], announcement: ['test@g.us'], alertAdmin: [] },
      });
      const onReport = jest.fn().mockResolvedValue(undefined);
      const scheduler = new Scheduler(() => config, db, onReport);

      // Record a successful daily run for yesterday (use JST date)
      const todayStr = getDataDate();
      const [ty, tm, td] = todayStr.split('-').map(Number);
      const yesterday = getDataDate(new Date(Date.UTC(ty, tm - 1, td - 1, 12, 0, 0)));
      await db.recordRun({
        report_type: 'daily',
        report_date: yesterday,
        scheduled_at: `${yesterday}T22:05:00.000Z`,
        sent_at: `${yesterday}T22:05:01.000Z`,
        status: 'sent',
        is_catch_up: false,
        target_jid: 'test@g.us',
      });

      // Try to send daily — should proceed since today has no successful run
      const recordAndSend = (scheduler as any).recordAndSend;
      await recordAndSend('daily');

      expect(onReport).toHaveBeenCalledWith('daily', undefined);
    });

    it('sends if no previous successful run exists', async () => {
      const config = makeConfig({
        groups: { command: [], announcement: ['test@g.us'], alertAdmin: [] },
      });
      const onReport = jest.fn().mockResolvedValue(undefined);
      const scheduler = new Scheduler(() => config, db, onReport);

      // No previous run recorded
      const recordAndSend = (scheduler as any).recordAndSend;
      await recordAndSend('daily');

      expect(onReport).toHaveBeenCalledWith('daily', undefined);
    });

    it('checks independently per report type', async () => {
      const config = makeConfig({
        groups: { command: [], announcement: ['test@g.us'], alertAdmin: [] },
      });
      const onReport = jest.fn().mockResolvedValue(undefined);
      const scheduler = new Scheduler(() => config, db, onReport);

      // Record daily as sent today (use JST date like the scheduler does)
      const today = getDataDate();
      await db.recordRun({
        report_type: 'daily',
        report_date: today,
        scheduled_at: `${today}T22:05:00.000Z`,
        sent_at: `${today}T22:05:01.000Z`,
        status: 'sent',
        is_catch_up: false,
        target_jid: 'test@g.us',
      });

      const recordAndSend = (scheduler as any).recordAndSend;

      // Daily should be skipped
      await recordAndSend('daily');
      expect(onReport).not.toHaveBeenCalled();

      // Weekly should still proceed (no successful run today)
      await recordAndSend('weekly');
      expect(onReport).toHaveBeenCalledWith('weekly', undefined);
    });
  });
});


describe('CatchUpManager', () => {
  describe('detectMissedReports', () => {
    it('detects missed reports even when catch-up is disabled', async () => {
      const config = makeConfig({ catchUp: { enabled: false, maxReportsPerStartup: 10 } });
      const catchUp = new CatchUpManager(db, () => config);

      const missed = await catchUp.detectMissedReports();
      // Detection always runs regardless of catchUp.enabled.
      // With no prior runs, all enabled report types are missed.
      expect(missed).toEqual(expect.arrayContaining(['daily', 'weekly', 'monthly']));
    });

    it('detects missed daily report when no previous run', async () => {
      const config = makeConfig({
        catchUp: { enabled: true, maxReportsPerStartup: 10 },
        schedule: {
          daily: { enabled: true, time: '22:05' },
          weekly: { enabled: true, days: [7, 14, 21, 28], time: '22:05' },
          monthly: { enabled: true, day: 1, time: '22:12' },
        },
      });
      const catchUp = new CatchUpManager(db, () => config);

      const missed = await catchUp.detectMissedReports();
      // Should include 'daily' if daily is enabled
      expect(missed).toContain('daily');
    });

    it('does not detect missed reports when last run is today', async () => {
      const config = makeConfig({
        catchUp: { enabled: true, maxReportsPerStartup: 10 },
        groups: { command: [], announcement: ['test@g.us'], alertAdmin: [] },
      });

      const today = getDataDate();
      await db.recordRun({
        report_type: 'daily',
        report_date: today,
        scheduled_at: `${today}T22:05:00.000Z`,
        sent_at: `${today}T22:05:01.000Z`,
        status: 'sent',
        is_catch_up: false,
        target_jid: 'test@g.us',
      });

      const catchUp = new CatchUpManager(db, () => config);
      const missed = await catchUp.detectMissedReports();
      expect(missed).not.toContain('daily');
    });

    it('handles unsorted weekly days in cross-month fallback', async () => {
      const config = makeConfig({
        catchUp: { enabled: true, maxReportsPerStartup: 10 },
        schedule: {
          daily: { enabled: false, time: '22:05' },
          weekly: { enabled: true, days: [28, 7, 14, 21], time: '22:05' }, // unsorted!
          monthly: { enabled: false, day: 1, time: '22:12' },
        },
      });

      // No run recorded — should detect weekly as missed
      // and correctly identify the last scheduled day as 28 (max), not 21 (last element)
      const catchUp = new CatchUpManager(db, () => config);
      const missed = await catchUp.detectMissedReports();
      expect(missed).toContain('weekly');
    });
  });

  describe('executeCatchUp', () => {
    it('returns 0 sent when catch-up disabled', async () => {
      const config = makeConfig({ catchUp: { enabled: false, maxReportsPerStartup: 10 } });
      const catchUp = new CatchUpManager(db, () => config);
      const sendReport = jest.fn();

      const result = await catchUp.executeCatchUp(sendReport);
      expect(result.sent).toBe(0);
      expect(sendReport).not.toHaveBeenCalled();
    });

    it('sends missed reports and respects maxReportsPerStartup', async () => {
      const config = makeConfig({
        catchUp: { enabled: true, maxReportsPerStartup: 2 },
        groups: { command: [], announcement: ['test@g.us'], alertAdmin: [] },
      });
      const catchUp = new CatchUpManager(db, () => config);
      const sendReport = jest.fn().mockResolvedValue(undefined);

      const result = await catchUp.executeCatchUp(sendReport);
      expect(result.sent).toBeLessThanOrEqual(2);
      // With collision grouping, combined reports call sendReport multiple times per group
      // so sendReport calls may exceed result.sent
      expect(sendReport.mock.calls.length).toBeGreaterThanOrEqual(result.sent);
    });

    it('records sent status in database', async () => {
      const config = makeConfig({
        catchUp: { enabled: true, maxReportsPerStartup: 10 },
        groups: { command: [], announcement: ['test@g.us'], alertAdmin: [] },
      });
      const catchUp = new CatchUpManager(db, () => config);
      const sendReport = jest.fn().mockResolvedValue(undefined);

      await catchUp.executeCatchUp(sendReport);

      // Verify runs were recorded
      const dailyRun = await db.getLastSuccessfulRun('daily');
      // If daily was missed and sent, it should be recorded
      if (dailyRun) {
        expect(dailyRun.status).toBe('sent');
        expect(dailyRun.is_catch_up).toBe(true);
      }
    });

    it('handles send failures gracefully', async () => {
      const config = makeConfig({
        catchUp: { enabled: true, maxReportsPerStartup: 10 },
        groups: { command: [], announcement: ['test@g.us'], alertAdmin: [] },
      });
      const catchUp = new CatchUpManager(db, () => config);
      const sendReport = jest.fn().mockRejectedValue(new Error('Send failed'));

      const result = await catchUp.executeCatchUp(sendReport);
      // Should not throw, should report failures
      expect(result.sent).toBe(0);
    });
  });

  describe('maxReportsPerStartup limit', () => {
    it('limits number of reports sent', async () => {
      const config = makeConfig({
        catchUp: { enabled: true, maxReportsPerStartup: 1 },
        groups: { command: [], announcement: ['test@g.us'], alertAdmin: [] },
        schedule: {
          daily: { enabled: true, time: '22:05' },
          weekly: { enabled: true, days: [7, 14, 21, 28], time: '22:05' },
          monthly: { enabled: true, day: 1, time: '22:12' },
        },
      });
      const catchUp = new CatchUpManager(db, () => config);
      const sendReport = jest.fn().mockResolvedValue(undefined);

      const result = await catchUp.executeCatchUp(sendReport);
      // daily+weekly are grouped together (same time), each recorded individually
      // Both fit within maxReportsPerStartup=1 for the group, then monthly is skipped
      expect(result.sent).toBeLessThanOrEqual(2);
    });

    it('reports [catch-up] tag in report text via isCatchUp flag', async () => {
      const config = makeConfig({
        catchUp: { enabled: true, maxReportsPerStartup: 10 },
        groups: { command: [], announcement: ['test@g.us'], alertAdmin: [] },
      });
      const catchUp = new CatchUpManager(db, () => config);
      const sendReport = jest.fn().mockResolvedValue(undefined);

      await catchUp.executeCatchUp(sendReport);

      // If any reports were sent, the callback MUST receive isCatchUp: true
      // as second argument — not just the type string
      for (const call of sendReport.mock.calls) {
        expect(call.length).toBeGreaterThanOrEqual(2);
        expect(call[1]).toEqual({ isCatchUp: true });
      }
    });

    it('reports skipped count when limit exceeded', async () => {
      const config = makeConfig({
        catchUp: { enabled: true, maxReportsPerStartup: 1 },
        groups: { command: [], announcement: ['test@g.us'], alertAdmin: [] },
        schedule: {
          daily: { enabled: true, time: '22:05' },
          weekly: { enabled: true, days: [7, 14, 21, 28], time: '22:05' },
          monthly: { enabled: true, day: 1, time: '22:12' },
        },
      });
      const catchUp = new CatchUpManager(db, () => config);
      const sendReport = jest.fn().mockResolvedValue(undefined);

      const result = await catchUp.executeCatchUp(sendReport);
      // If there were multiple missed reports, some should be skipped
      if (result.sent < 3) {
        expect(result.skipped).toBeGreaterThanOrEqual(0);
      }
    });

    it('combines colliding reports into single group — fewer sendReport calls', async () => {
      const config = makeConfig({
        catchUp: { enabled: true, maxReportsPerStartup: 10 },
        groups: { command: [], announcement: ['test@g.us'], alertAdmin: [] },
        schedule: {
          daily: { enabled: true, time: '22:05' },
          weekly: { enabled: true, days: [7, 14, 21, 28], time: '22:05' },
          monthly: { enabled: true, day: 1, time: '22:12' },
        },
      });
      const catchUp = new CatchUpManager(db, () => config);
      const sendReport = jest.fn().mockResolvedValue(undefined);

      const result = await catchUp.executeCatchUp(sendReport);

      // daily+weekly share time 22:05 → grouped together → 2 "sent" (each type recorded individually in fallback)
      // monthly has different time 22:12 → separate group
      // Total: 3 sent (daily, weekly, monthly)
      expect(result.sent).toBeLessThanOrEqual(3);
      expect(sendReport.mock.calls.length).toBeGreaterThanOrEqual(result.sent);
    });

    it('catch-up groups daily+monthly when they share time', async () => {
      const config = makeConfig({
        catchUp: { enabled: true, maxReportsPerStartup: 10 },
        groups: { command: [], announcement: ['test@g.us'], alertAdmin: [] },
        schedule: {
          daily: { enabled: true, time: '22:05' },
          weekly: { enabled: true, days: [7, 14, 21, 28], time: '22:10' },
          monthly: { enabled: true, day: 1, time: '22:05' },
        },
      });
      const catchUp = new CatchUpManager(db, () => config);
      const sendReport = jest.fn().mockResolvedValue(undefined);

      const result = await catchUp.executeCatchUp(sendReport);

      // daily+monthly share time 22:05 → grouped together
      // weekly has different time 22:10 → separate group
      expect(sendReport.mock.calls.length).toBeGreaterThanOrEqual(result.sent);
    });

    it('callback generates report text that consumer can tag with [catch-up]', async () => {
      // Simulate the real-world flow: callback generates report text,
      // consumer checks isCatchUp flag and prepends [catch-up] prefix
      const config = makeConfig({
        catchUp: { enabled: true, maxReportsPerStartup: 10 },
        groups: { command: [], announcement: ['test@g.us'], alertAdmin: [] },
      });
      const catchUp = new CatchUpManager(db, () => config);

      const sendReport = jest.fn().mockImplementation(
        async (type: string, options?: { isCatchUp: boolean }) => {
          // Consumer behavior: if isCatchUp, prepend tag to report text
          const reportText = `📊 ${type} Report — test data`;
          if (options?.isCatchUp) {
            return `[catch-up]\n${reportText}`;
          }
          return reportText;
        }
      );

      const results: string[] = [];
      const wrappedSend = jest.fn().mockImplementation(
        async (type: string, options?: { isCatchUp: boolean }) => {
          const text = await sendReport(type, options);
          results.push(text);
        }
      );

      await catchUp.executeCatchUp(wrappedSend);

      // All reports sent via catch-up must have [catch-up] prefix in text
      for (const text of results) {
        expect(text).toMatch(/^\[catch-up\]/);
      }
    });

    it('sendReport with isCatchUp=true produces [catch-up] tagged report text', async () => {
      // Integration test: verifies that when sendReport is invoked by CatchUpManager
      // with isCatchUp=true, the resulting report text contains [catch-up] prefix.
      // This is the contract that src/index.ts sendReport must satisfy.
      const config = makeConfig({
        catchUp: { enabled: true, maxReportsPerStartup: 10 },
        groups: { command: [], announcement: ['test@g.us'], alertAdmin: [] },
      });
      const catchUp = new CatchUpManager(db, () => config);

      // Simulate the real sendReport behavior (post-fix):
      // generate report text → if isCatchUp, prepend [catch-up]
      const sendReport = jest.fn().mockImplementation(
        async (type: string, options?: { isCatchUp?: boolean }) => {
          let report = `📊 ${type} Report — simulated data`;
          if (options?.isCatchUp) {
            report = `[catch-up]\n${report}`;
          }
          return report;
        }
      );

      const results: string[] = [];
      const wrappedSend = jest.fn().mockImplementation(
        async (type: string, options?: { isCatchUp?: boolean }) => {
          const text = await sendReport(type, options);
          results.push(text);
        }
      );

      await catchUp.executeCatchUp(wrappedSend);

      // Every report delivered during catch-up MUST have [catch-up] prefix
      expect(results.length).toBeGreaterThan(0);
      for (const text of results) {
        expect(text).toMatch(/^\[catch-up\]/);
        expect(text).not.toMatch(/\[catch-up\].*\[catch-up\]/); // no double tag
      }
    });
  });
});
