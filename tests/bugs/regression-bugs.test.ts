/**
 * Tests for 5 regression bugs found during code review.
 *
 * Bug 1: Catch-up only detects missed reports for current day
 * Bug 2: new Promise(async) antipattern in WhatsApp client
 * Bug 3: projectedOutcome overwrite for max-tier clubs
 * Bug 4: recordAlert returns wrong ID on INSERT OR IGNORE
 * Bug 5: require() instead of import for CLUB_TIERS
 *
 * TDD: These tests are written FIRST and should FAIL (RED) before fixes.
 */

import * as fs from 'fs';
import * as path from 'path';
import { CatchUpManager } from '../../src/scheduler/catchup';
import { Database } from '../../src/db/database';
import { getDefaultConfig } from '../../src/config';
import { computeTierData } from '../../src/reports/tier';
import type { BotConfig, Snapshot } from '../../src/types';
import { CLUB_TIERS } from '../../src/types';
import { loadRealSnapshot } from '../_helpers';

// Load real snapshot for tier test
const realSnapshot: Snapshot = loadRealSnapshot();

function makeConfig(overrides: Partial<BotConfig> = {}): BotConfig {
  const base = getDefaultConfig();
  return {
    ...base,
    ...overrides,
    schedule: {
      ...base.schedule,
      ...(overrides.schedule ?? {}),
      daily: {
        ...base.schedule.daily,
        ...(overrides.schedule?.daily ?? {}),
      },
      weekly: {
        ...base.schedule.weekly,
        ...(overrides.schedule?.weekly ?? {}),
        days: overrides.schedule?.weekly?.days ?? base.schedule.weekly.days,
      },
      monthly: {
        ...base.schedule.monthly,
        ...(overrides.schedule?.monthly ?? {}),
      },
    },
    catchUp: {
      ...base.catchUp,
      ...(overrides.catchUp ?? {}),
    },
    groups: {
      ...base.groups,
      ...(overrides.groups ?? {}),
    },
  };
}

// ============================================================
// Bug 1: Catch-up only detects for current day
// ============================================================

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

// ============================================================
// Bug 2: new Promise(async) antipattern
// ============================================================

describe('Bug 2: WhatsApp client connect method', () => {
  it('connect method should be a plain async function, not new Promise(async)', () => {
    // Read the source file and check for the antipattern
    const sourcePath = path.join(__dirname, '../../src/whatsapp/client.ts');
    const source = fs.readFileSync(sourcePath, 'utf-8');

    // The method should NOT contain new Promise(async (resolve, reject) => {
    // This is the antipattern — async code inside new Promise constructor
    expect(source).not.toMatch(
      /new\s+Promise\s*\(\s*async\s*\(\s*resolve\s*,\s*reject\s*\)\s*=>/
    );
  });
});

// ============================================================
// Bug 3: projectedOutcome overwrite for max-tier clubs
// ============================================================

describe('Bug 3: Tier projectedOutcome for max-tier clubs', () => {
  it('max-tier club with low demotion buffer should show demotion_risk, not stay', () => {
    // Create a snapshot where:
    // - club_rank = 11 (SS tier, highest) → fans_to_next_tier = 0
    // - fans_to_lower_tier is very small (low buffer)
    // - current pace is high enough that buffer < 3 days → HIGH risk
    const snapshot: Snapshot = {
      ...realSnapshot,
      club_rank: 11, // SS tier — max tier, fans_to_next_tier = 0
      fans_to_next_tier: 0, // Already at top
      fans_to_lower_tier: 100000, // Small buffer
      circle: {
        ...realSnapshot.circle,
        monthly_point: 500000000, // High total fans
      },
      members: realSnapshot.members.map((m) => ({
        ...m,
        daily_fans: (() => {
          // Create high daily gains to make currentPace large
          // so that bufferDays = fans_to_lower_tier / currentPace < 3
          const fans = new Array(32).fill(0);
          fans[0] = 100000000;
          for (let i = 1; i < 12; i++) {
            fans[i] = 100000000 * (i + 1);
          }
          return fans;
        })(),
      })),
    };

    const tierData = computeTierData(snapshot);

    // With low buffer and high pace, risk should be HIGH
    // projectedOutcome should be demotion_risk, NOT stay
    expect(tierData.riskLevel).toBe('HIGH');
    expect(tierData.projectedOutcome).toBe('demotion_risk');
  });

  it('max-tier club with high buffer shows LOW risk and stay', () => {
    // club_rank = 11, fans_to_next_tier = 0, large buffer
    const snapshot: Snapshot = {
      ...realSnapshot,
      club_rank: 11,
      fans_to_next_tier: 0,
      fans_to_lower_tier: 100000000, // Huge buffer
      circle: {
        ...realSnapshot.circle,
        monthly_point: 1000000,
      },
      members: realSnapshot.members.map((m) => ({
        ...m,
        daily_fans: (() => {
          const fans = new Array(32).fill(0);
          fans[0] = 10000;
          for (let i = 1; i < 12; i++) {
            fans[i] = 10000 * (i + 1);
          }
          return fans;
        })(),
      })),
    };

    const tierData = computeTierData(snapshot);

    // Large buffer with low pace → bufferDays >= 7 → LOW risk → stay
    expect(tierData.riskLevel).toBe('LOW');
    expect(tierData.projectedOutcome).toBe('stay');
  });
});

// ============================================================
// Bug 4: recordAlert returns wrong ID on INSERT OR IGNORE
// ============================================================

describe('Bug 4: recordAlert returns correct ID', () => {
  let db: Database;

  beforeEach(async () => {
    db = new Database(':memory:');
    await db.initialize();
  });

  afterEach(() => {
    db.close();
  });

  it('returns correct ID when inserting a new alert', () => {
    const id1 = db.recordAlert({
      alert_type: 'performance_drop',
      event_key: 'perf:2026-06-12:11111',
      member_viewer_id: '11111',
      report_date: '2026-06-12',
      created_at: '2026-06-12T15:05:00Z',
      message: 'Alert 1',
    });

    const id2 = db.recordAlert({
      alert_type: 'performance_drop',
      event_key: 'perf:2026-06-12:22222',
      member_viewer_id: '22222',
      report_date: '2026-06-12',
      created_at: '2026-06-12T15:05:00Z',
      message: 'Alert 2',
    });

    // IDs should be sequential and unique
    expect(id1).toBeGreaterThan(0);
    expect(id2).toBe(id1 + 1);
  });

  it('returns existing ID when duplicate event_key inserted', () => {
    const id1 = db.recordAlert({
      alert_type: 'performance_drop',
      event_key: 'perf:2026-06-12:33333',
      member_viewer_id: '33333',
      report_date: '2026-06-12',
      created_at: '2026-06-12T15:05:00Z',
      message: 'First',
    });

    const id2 = db.recordAlert({
      alert_type: 'performance_drop',
      event_key: 'perf:2026-06-12:33333', // same key
      member_viewer_id: '33333',
      report_date: '2026-06-12',
      created_at: '2026-06-12T15:06:00Z',
      message: 'Duplicate',
    });

    // First insert should return valid ID
    expect(id1).toBeGreaterThan(0);
    // Duplicate returns the existing ID so caller can mark it sent
    expect(id2).toBe(id1);
  });

  it('markAlertSent on duplicate alert marks the original as sent', () => {
    const id1 = db.recordAlert({
      alert_type: 'performance_drop',
      event_key: 'perf:2026-06-12:44444',
      member_viewer_id: '44444',
      report_date: '2026-06-12',
      created_at: '2026-06-12T15:05:00Z',
      message: 'Original',
    });

    // Duplicate returns same ID
    const id2 = db.recordAlert({
      alert_type: 'performance_drop',
      event_key: 'perf:2026-06-12:44444',
      member_viewer_id: '44444',
      report_date: '2026-06-12',
      created_at: '2026-06-12T15:06:00Z',
      message: 'Duplicate',
    });

    // id2 === id1, so marking it sent marks the original
    expect(id2).toBe(id1);
    expect(() => db.markAlertSent(id2)).not.toThrow();
    expect(db.isAlertAlreadySent('perf:2026-06-12:44444')).toBe(true);
  });
});

// ============================================================
// Bug 5: require() instead of import for CLUB_TIERS
// ============================================================

describe('Bug 5: CLUB_TIERS uses ES import, not require()', () => {
  const reportFiles = [
    'daily.ts',
    'weekly.ts',
    'monthly.ts',
    'ranks.ts',
    'bottom.ts',
    'stats.ts',
    'members.ts',
    'tier.ts',
  ];

  for (const file of reportFiles) {
    it(`${file} should not use require() for CLUB_TIERS`, () => {
      const filePath = path.join(__dirname, `../../src/reports/${file}`);
      const source = fs.readFileSync(filePath, 'utf-8');

      // Should NOT contain require('../types') for CLUB_TIERS
      expect(source).not.toMatch(/require\s*\(\s*['"]\.\.\/types['"]\s*\)/);
      expect(source).not.toMatch(/require\s*\(\s*['"]\.\.\/types\.js['"]\s*\)/);

      // CLUB_TIERS should be accessed via the ES import at top of file
      // Check that CLUB_TIERS is used somewhere (it should be in the file)
      expect(source).toContain('CLUB_TIERS');
    });
  }

  it('CLUB_TIERS constant is properly exported from types', () => {
    expect(CLUB_TIERS).toBeDefined();
    expect(CLUB_TIERS[11]).toBe('SS');
    expect(CLUB_TIERS[8]).toBe('A+');
    expect(CLUB_TIERS[1]).toBe('D');
  });
});
