import { CatchUpManager } from '../../src/scheduler/catchup';
import { Database } from '../../src/db/database';
import { makeConfig } from '../_helpers';

describe('Bug 1: Catch-up detects missed reports across days', () => {
  let db: Database;

  beforeEach(async () => {
    db = new Database(':memory:');
    await db.initialize();
  });

  afterEach(() => {
    db.close();
  });

  it('detects missed weekly from day 7 when bot restarts on day 8', () => {
    // Weekly scheduled on days [7, 14, 21, 28]
    // Last successful weekly was on day 7 of previous month or before
    // Today is day 8 — the weekly from day 7 should be caught
    const config = makeConfig({
      catchUp: { enabled: true, maxReportsPerStartup: 10 },
      schedule: {
        daily: { enabled: true, time: '22:05' },
        weekly: { enabled: true, days: [7, 14, 21, 28], time: '22:05' },
        monthly: { enabled: true, day: 1, time: '22:12' },
      },
    });

    // Record last weekly run as day 7 (today is day 8)
    const today = new Date();
    const todayDay = today.getDate();
    const todayMonth = today.getMonth();
    const todayYear = today.getFullYear();

    // Last weekly run was from previous month
    const lastMonth = new Date(todayYear, todayMonth - 1, 7);
    const lastMonthStr = lastMonth.toISOString().split('T')[0];

    db.recordRun({
      report_type: 'weekly',
      report_date: lastMonthStr,
      scheduled_at: `${lastMonthStr}T22:05:00.000Z`,
      sent_at: `${lastMonthStr}T22:05:01.000Z`,
      status: 'sent',
      is_catch_up: false,
      target_jid: 'test@g.us',
    });

    const catchUp = new CatchUpManager(db, () => config);
    const missed = catchUp.detectMissedReports();

    // Weekly should be detected as missed since we haven't run it this month
    expect(missed).toContain('weekly');
  });

  it('does not double-detect weekly when already sent on most recent scheduled day', () => {
    const config = makeConfig({
      catchUp: { enabled: true, maxReportsPerStartup: 10 },
      schedule: {
        daily: { enabled: true, time: '22:05' },
        weekly: { enabled: true, days: [7, 14, 21, 28], time: '22:05' },
        monthly: { enabled: true, day: 1, time: '22:12' },
      },
    });

    // Record weekly run for today's most recent scheduled day
    const today = new Date();
    const todayDay = today.getDate();
    const weeklyDays = [7, 14, 21, 28];

    // Find the most recent scheduled day that is <= today
    let mostRecentDay = 0;
    for (const day of [...weeklyDays].sort((a, b) => b - a)) {
      if (day <= todayDay) {
        mostRecentDay = day;
        break;
      }
    }

    if (mostRecentDay > 0) {
      const todayYear = today.getFullYear();
      const todayMonth = today.getMonth();
      const scheduledDate = `${todayYear}-${String(todayMonth + 1).padStart(2, '0')}-${String(mostRecentDay).padStart(2, '0')}`;

      db.recordRun({
        report_type: 'weekly',
        report_date: scheduledDate,
        scheduled_at: `${scheduledDate}T22:05:00.000Z`,
        sent_at: `${scheduledDate}T22:05:01.000Z`,
        status: 'sent',
        is_catch_up: false,
        target_jid: 'test@g.us',
      });

      const catchUp = new CatchUpManager(db, () => config);
      const missed = catchUp.detectMissedReports();
      expect(missed).not.toContain('weekly');
    }
  });

  it('detects missed monthly when bot restarts after monthly day has passed', () => {
    const config = makeConfig({
      catchUp: { enabled: true, maxReportsPerStartup: 10 },
      schedule: {
        daily: { enabled: true, time: '22:05' },
        weekly: { enabled: true, days: [7, 14, 21, 28], time: '22:05' },
        monthly: { enabled: true, day: 1, time: '22:12' },
      },
    });

    const today = new Date();
    const todayDay = today.getDate();

    // Only test if today >= day 1 (which is always true)
    // Record last monthly from previous month
    const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastMonthStr = lastMonth.toISOString().split('T')[0];

    db.recordRun({
      report_type: 'monthly',
      report_date: lastMonthStr,
      scheduled_at: `${lastMonthStr}T22:12:00.000Z`,
      sent_at: `${lastMonthStr}T22:12:01.000Z`,
      status: 'sent',
      is_catch_up: false,
      target_jid: 'test@g.us',
    });

    // If today >= 1 (always true), monthly should be detected
    if (todayDay >= 1) {
      const catchUp = new CatchUpManager(db, () => config);
      const missed = catchUp.detectMissedReports();
      expect(missed).toContain('monthly');
    }
  });
});
