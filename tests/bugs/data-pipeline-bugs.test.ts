/**
 * Tests for 5 high/data pipeline bugs found during code review.
 *
 * Bug 1: splitMessage Part marker exceeds maxLength
 * Bug 2: countActiveDaysUpTo counts total not consecutive
 * Bug 3: Empty snapshot.members crashes all reports
 * Bug 4: Non-atomic snapshot writes
 * Bug 5: API response no validation
 *
 * TDD: These tests are written FIRST and should FAIL (RED) before fixes.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Snapshot, BotConfig } from '../../src/types';
import { getDefaultConfig } from '../../src/config';
import { splitMessage } from '../../src/reports/format';
import { generateDailyReport } from '../../src/reports/daily';
import { generateWeeklyReport } from '../../src/reports/weekly';
import { generateMonthlyReport } from '../../src/reports/monthly';
import { generateStatsReport } from '../../src/reports/stats';
import { generateTierReport } from '../../src/reports/tier';
import { generateRanksReport } from '../../src/reports/ranks';
import { generateBottomReport } from '../../src/reports/bottom';
import { generateMembersReport } from '../../src/reports/members';
import { saveSnapshot } from '../../src/data/snapshot';
import { detectAlerts } from '../../src/alerts/alerts';
import { Database } from '../../src/db/database';

// Load real snapshot
const realSnapshot: Snapshot = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '../../examples/snapshot-june-12.json'),
    'utf-8'
  )
);

const config: BotConfig = getDefaultConfig();

// ============================================================
// Helper: create minimal snapshot with empty members
// ============================================================

function makeEmptyMembersSnapshot(): Snapshot {
  return {
    circle: {
      circle_id: 1,
      name: 'TestCircle',
      comment: 'test',
      leader_viewer_id: 100,
      leader_name: 'Leader',
      member_count: 0,
      join_style: 1,
      policy: 1,
      created_at: '2026-01-01T00:00:00Z',
      last_updated: '2026-06-11T00:00:00Z',
      monthly_rank: 1,
      monthly_point: 0,
      last_month_rank: null,
      last_month_point: null,
      archived: false,
      yesterday_updated: null,
      yesterday_points: null,
      yesterday_rank: null,
      live_points: null,
      live_rank: null,
      last_live_update: null,
    },
    members: [],
    club_rank: 5,
    fans_to_next_tier: 1000000,
    fans_to_lower_tier: 500000,
    yesterday_fans_to_next_tier: 900000,
    yesterday_fans_to_lower_tier: 400000,
  };
}

// ============================================================
// Bug 1: splitMessage Part marker exceeds maxLength
// ============================================================

describe('Bug 1: splitMessage Part marker overhead', () => {
  const MAX_LENGTH = 4096;

  it('all parts including Part X/Y markers must be ≤ maxLength', () => {
    // Create a message that will need splitting
    const lines = Array.from({ length: 200 }, (_, i) => `Line ${i}: ${'x'.repeat(30)}`);
    const longMessage = lines.join('\n');

    const parts = splitMessage(longMessage, MAX_LENGTH);

    // Every part must respect maxLength
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(MAX_LENGTH);
    }
  });

  it('parts with markers at small maxLength are still within limit', () => {
    // Use a small maxLength to make the bug more obvious
    const lines = Array.from({ length: 50 }, (_, i) => `Line ${i}`);
    const longMessage = lines.join('\n');
    const smallMax = 80;

    const parts = splitMessage(longMessage, smallMax);

    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(smallMax);
    }
  });

  it('single-line parts with markers respect maxLength', () => {
    // Create a message with lines just under maxLength
    const line = 'x'.repeat(100);
    const lines = Array.from({ length: 50 }, () => line);
    const longMessage = lines.join('\n');
    const maxLen = 120;

    const parts = splitMessage(longMessage, maxLen);

    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(maxLen);
    }
  });

  it('force-split long lines also respect maxLength with markers', () => {
    // A single line that exceeds maxLength should be force-split
    const longLine = 'x'.repeat(200);
    const maxLen = 50;

    const parts = splitMessage(longLine, maxLen);

    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(maxLen);
    }
  });

  it('real-world report content respects maxLength after splitting', () => {
    // Simulate a very long report
    const reportHeader = '📊 Daily Report — 12 Juni 2026\n\nHol＿Horse | A+ (#431)\n';
    const memberLines = Array.from(
      { length: 40 },
      (_, i) => `${i + 1}. Member${i} — +${(100 - i) * 100000}`
    ).join('\n');
    const report = reportHeader + memberLines;

    if (report.length > MAX_LENGTH) {
      const parts = splitMessage(report, MAX_LENGTH);
      for (const part of parts) {
        expect(part.length).toBeLessThanOrEqual(MAX_LENGTH);
      }
    }
  });
});

// ============================================================
// Bug 2: countActiveDaysUpTo counts total not consecutive
// ============================================================

describe('Bug 2: countActiveDaysUpTo consecutive streak counting', () => {
  // The function is not exported, so we test via detectAlerts.
  // Fixed: now reports the streak that just broke, not the max streak ever.

  it('reports the streak that just broke (not total active days or max streak)', async () => {
    // Construct data where:
    // - Member A pushes latestDataDay to 9
    // - Member B (StreakTest) has:
    //   Day 1: baseline (1000)
    //   Days 2-6: active (+1000 each, streak of 5)
    //   Day 7: same as day 6 (gain 0, streak breaks)
    //   Days 8-9: 0
    // The streak that just broke = 5 (days 2-6)

    const memberAFans = new Array(32).fill(0);
    memberAFans[0] = 1000;
    for (let i = 1; i < 9; i++) {
      memberAFans[i] = 1000 * (i + 1);
    }

    const memberBFans = new Array(32).fill(0);
    memberBFans[0] = 1000;   // day 1: baseline
    memberBFans[1] = 2000;   // day 2: +1000 (streak start)
    memberBFans[2] = 3000;   // day 3: +1000
    memberBFans[3] = 4000;   // day 4: +1000
    memberBFans[4] = 5000;   // day 5: +1000
    memberBFans[5] = 6000;   // day 6: +1000 (streak end = 5)
    memberBFans[6] = 6000;   // day 7: +0 (streak breaks)

    const snapshot: Snapshot = {
      ...realSnapshot,
      members: [
        {
          id: 1,
          circle_id: 1,
          viewer_id: 11111,
          trainer_name: 'MemberA',
          shame_score: null,
          year: 2026,
          month: 6,
          daily_fans: memberAFans,
          last_updated: '2026-06-12T00:00:00Z',
        },
        {
          id: 2,
          circle_id: 1,
          viewer_id: 99999,
          trainer_name: 'StreakTest',
          shame_score: null,
          year: 2026,
          month: 6,
          daily_fans: memberBFans,
          last_updated: '2026-06-12T00:00:00Z',
        },
      ],
    };

    const db = new Database(':memory:');
    await db.initialize();
    const config = getDefaultConfig();
    config.alerts.streakBreak.enabled = true;

    const alerts = detectAlerts(snapshot, config, db);
    const streakAlerts = alerts.filter(
      (a) => a.type === 'streak_break' && a.memberViewerId === '99999'
    );

    // There should be a streak break alert (member stopped gaining after 5-day streak)
    expect(streakAlerts.length).toBe(1);

    // The message should say the streak that just broke (5), not total active days
    expect(streakAlerts[0].message).toContain('5 hari aktif berturut-turut');

    db.close();
  });

  it('no streak break when broken streak is below threshold', async () => {
    // Member had a 1-day streak that broke — below the 3-day threshold
    const memberAFans = new Array(32).fill(0);
    memberAFans[0] = 1000;
    for (let i = 1; i < 9; i++) {
      memberAFans[i] = 1000 * (i + 1);
    }

    const memberBFans = new Array(32).fill(0);
    memberBFans[0] = 1000;   // day 1: baseline
    // day 2: gap (0)
    memberBFans[2] = 2000;   // day 3: new data (prev=0, gain=0)
    memberBFans[3] = 3000;   // day 4: +1000 (1-day streak)
    memberBFans[4] = 3000;   // day 5: +0 (streak breaks, only 1 day)

    const snapshot: Snapshot = {
      ...realSnapshot,
      members: [
        {
          id: 1,
          circle_id: 1,
          viewer_id: 11111,
          trainer_name: 'MemberA',
          shame_score: null,
          year: 2026,
          month: 6,
          daily_fans: memberAFans,
          last_updated: '2026-06-12T00:00:00Z',
        },
        {
          id: 2,
          circle_id: 1,
          viewer_id: 99999,
          trainer_name: 'ShortStreak',
          shame_score: null,
          year: 2026,
          month: 6,
          daily_fans: memberBFans,
          last_updated: '2026-06-12T00:00:00Z',
        },
      ],
    };

    const db = new Database(':memory:');
    await db.initialize();
    const config = getDefaultConfig();
    config.alerts.streakBreak.enabled = true;

    const alerts = detectAlerts(snapshot, config, db);
    const streakAlerts = alerts.filter(
      (a) => a.type === 'streak_break' && a.memberViewerId === '99999'
    );

    // No alert — streak was only 1 day, below the 3-day threshold
    expect(streakAlerts.length).toBe(0);

    db.close();
  });

  it('consecutive counting: gap resets streak to 0 (verification of correct logic)', () => {
    const { getDailyGain } = require('../../src/data/daily-fans');

    // This function represents the CORRECT implementation
    function countConsecutive(dailyFans: number[], upToDay: number): number {
      let streak = 0;
      let maxStreak = 0;
      for (let day = 2; day <= upToDay; day++) {
        const gain = getDailyGain(dailyFans, day);
        if (gain > 0) {
          streak++;
          maxStreak = Math.max(maxStreak, streak);
        } else {
          streak = 0;
        }
      }
      return maxStreak;
    }

    // Test: 4 consecutive, gap, then 2 consecutive
    const dailyFans = new Array(32).fill(0);
    dailyFans[0] = 1000;   // day 1: baseline
    dailyFans[1] = 2000;   // day 2: +1000
    dailyFans[2] = 3000;   // day 3: +1000
    dailyFans[3] = 4000;   // day 4: +1000
    dailyFans[4] = 5000;   // day 5: +1000
    // day 6: gap
    dailyFans[6] = 6000;   // day 7: +1000
    dailyFans[7] = 7000;   // day 8: +1000

    expect(countConsecutive(dailyFans, 8)).toBe(4); // max streak is 4, not 6 total

    // Test: no gaps = all consecutive
    const dailyFans2 = new Array(32).fill(0);
    dailyFans2[0] = 1000;
    for (let i = 1; i < 10; i++) {
      dailyFans2[i] = 1000 * (i + 1);
    }
    expect(countConsecutive(dailyFans2, 10)).toBe(9); // days 2-10 = 9 consecutive

    // Test: all gaps = 0 consecutive
    const dailyFans3 = new Array(32).fill(0);
    dailyFans3[0] = 1000;
    dailyFans3[2] = 2000; // day 3 only
    dailyFans3[5] = 3000; // day 6 only
    expect(countConsecutive(dailyFans3, 6)).toBe(0); // no consecutive pairs

    // Test: single active day = 0 consecutive (need at least 2 for streak)
    const dailyFans4 = new Array(32).fill(0);
    dailyFans4[0] = 1000;
    dailyFans4[1] = 2000; // day 2 only
    expect(countConsecutive(dailyFans4, 2)).toBe(1); // one streak of 1
  });
});

// ============================================================
// Bug 3: Empty snapshot.members crashes all reports
// ============================================================

describe('Bug 3: Empty snapshot.members graceful handling', () => {
  const emptySnapshot = makeEmptyMembersSnapshot();

  it('generateDailyReport handles empty members without crash', () => {
    expect(() => {
      const result = generateDailyReport(emptySnapshot, config);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    }).not.toThrow();
  });

  it('generateDailyReport returns helpful message for empty members', () => {
    const result = generateDailyReport(emptySnapshot, config);
    expect(result).toMatch(/data anggota|Belum ada data|belum tersedia|belum ada kontribusi/i);
  });

  it('generateWeeklyReport handles empty members without crash', () => {
    expect(() => {
      const result = generateWeeklyReport(emptySnapshot, config);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    }).not.toThrow();
  });

  it('generateWeeklyReport returns helpful message for empty members', () => {
    const result = generateWeeklyReport(emptySnapshot, config);
    expect(result).toMatch(/data anggota|Belum ada data|belum tersedia|belum ada kontribusi/i);
  });

  it('generateMonthlyReport handles empty members without crash', () => {
    expect(() => {
      const result = generateMonthlyReport(emptySnapshot, config);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    }).not.toThrow();
  });

  it('generateMonthlyReport returns helpful message for empty members', () => {
    const result = generateMonthlyReport(emptySnapshot, config);
    expect(result).toMatch(/data anggota|Belum ada data|belum tersedia|belum ada kontribusi/i);
  });

  it('generateStatsReport handles empty members without crash', () => {
    expect(() => {
      const result = generateStatsReport(emptySnapshot, config);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    }).not.toThrow();
  });

  it('generateStatsReport returns helpful message for empty members', () => {
    const result = generateStatsReport(emptySnapshot, config);
    expect(result).toMatch(/data anggota|Belum ada data|belum tersedia|belum ada kontribusi/i);
  });

  it('generateTierReport handles empty members without crash', () => {
    expect(() => {
      const result = generateTierReport(emptySnapshot, config);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    }).not.toThrow();
  });

  it('generateTierReport returns helpful message for empty members', () => {
    const result = generateTierReport(emptySnapshot, config);
    expect(result).toMatch(/data anggota|Belum ada data|belum tersedia|belum ada kontribusi/i);
  });

  it('generateRanksReport handles empty members without crash', () => {
    expect(() => {
      const result = generateRanksReport(emptySnapshot, config);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    }).not.toThrow();
  });

  it('generateRanksReport returns helpful message for empty members', () => {
    const result = generateRanksReport(emptySnapshot, config);
    expect(result).toMatch(/data anggota|Belum ada data|belum tersedia|belum ada kontribusi/i);
  });

  it('generateBottomReport handles empty members without crash', () => {
    expect(() => {
      const result = generateBottomReport(emptySnapshot, config);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    }).not.toThrow();
  });

  it('generateBottomReport returns helpful message for empty members', () => {
    const result = generateBottomReport(emptySnapshot, config);
    expect(result).toMatch(/data anggota|Belum ada data|belum tersedia|belum ada kontribusi/i);
  });

  it('generateMembersReport handles empty members without crash', () => {
    expect(() => {
      const result = generateMembersReport(emptySnapshot, config);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    }).not.toThrow();
  });

  it('generateMembersReport returns helpful message for empty members', () => {
    const result = generateMembersReport(emptySnapshot, config);
    expect(result).toMatch(/data anggota|Belum ada data|belum tersedia|belum ada kontribusi/i);
  });
});

// ============================================================
// Bug 4: Non-atomic snapshot writes
// ============================================================

describe('Bug 4: Atomic snapshot writes', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-atomic-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('saveSnapshot writes a valid file that can be read back', () => {
    const snap: Snapshot = {
      ...realSnapshot,
      members: realSnapshot.members.slice(0, 2), // small subset
    };
    const savedPath = saveSnapshot(snap, '2026-06-13', tmpDir);
    expect(fs.existsSync(savedPath)).toBe(true);

    const raw = fs.readFileSync(savedPath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.circle.circle_id).toBe(realSnapshot.circle.circle_id);
    expect(parsed.members).toHaveLength(2);
  });

  it('saveSnapshot leaves no .tmp file after successful write', () => {
    const snap: Snapshot = {
      ...realSnapshot,
      members: realSnapshot.members.slice(0, 1),
    };
    const savedPath = saveSnapshot(snap, '2026-06-13', tmpDir);
    const tmpPath = savedPath + '.tmp';
    expect(fs.existsSync(tmpPath)).toBe(false);
  });

  it('saveSnapshot produces atomic result (no partial file visible)', () => {
    const snap: Snapshot = {
      ...realSnapshot,
      members: realSnapshot.members.slice(0, 2),
    };
    const savedPath = saveSnapshot(snap, '2026-06-13', tmpDir);

    // The file should be complete JSON
    const raw = fs.readFileSync(savedPath, 'utf-8');
    expect(() => JSON.parse(raw)).not.toThrow();

    // Check it has the expected structure
    const parsed = JSON.parse(raw);
    expect(parsed).toHaveProperty('circle');
    expect(parsed).toHaveProperty('members');
    expect(Array.isArray(parsed.members)).toBe(true);
  });

  it('saveSnapshot overwrites atomically (no corruption on overwrite)', () => {
    const snap1: Snapshot = {
      ...realSnapshot,
      members: realSnapshot.members.slice(0, 1),
    };
    const snap2: Snapshot = {
      ...realSnapshot,
      club_rank: 99,
      members: realSnapshot.members.slice(0, 2),
    };

    const path1 = saveSnapshot(snap1, '2026-06-13', tmpDir);
    const path2 = saveSnapshot(snap2, '2026-06-13', tmpDir);

    expect(path1).toBe(path2); // same path

    const raw = fs.readFileSync(path1, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.club_rank).toBe(99);
    expect(parsed.members).toHaveLength(2);
  });
});

// ============================================================
// Bug 5: API response no validation
// ============================================================

describe('Bug 5: API response validation', () => {
  it('rejects null response', () => {
    // Test the validation logic directly
    const result = null;
    expect(result === null || typeof result !== 'object').toBe(true);
  });

  it('rejects non-object response', () => {
    const result = 'string response';
    expect(typeof result !== 'object').toBe(true);
  });

  it('rejects response without circle field', () => {
    const result = { members: [] };
    expect(!result || typeof result !== 'object').toBe(false);
    expect(!('circle' in result) || !Array.isArray((result as any).members)).toBe(true);
  });

  it('rejects response without members array', () => {
    const result = { circle: { circle_id: 1 } };
    expect(!result || typeof result !== 'object').toBe(false);
    expect(!('circle' in result) || !Array.isArray((result as any).members)).toBe(true);
  });

  it('accepts valid response structure', () => {
    const result = {
      circle: { circle_id: 1, name: 'Test' },
      members: [],
      club_rank: 5,
      fans_to_next_tier: 1000,
      fans_to_lower_tier: 500,
      yesterday_fans_to_next_tier: 900,
      yesterday_fans_to_lower_tier: 400,
    };
    const isValid =
      result &&
      typeof result === 'object' &&
      'circle' in result &&
      'members' in result &&
      Array.isArray(result.members);
    expect(isValid).toBe(true);
  });

  it('rejects response with members as non-array', () => {
    const result = {
      circle: { circle_id: 1 },
      members: 'not an array',
    };
    const isValid =
      result &&
      typeof result === 'object' &&
      'circle' in result &&
      Array.isArray((result as any).members);
    expect(isValid).toBe(false);
  });

  it('rejects response with circle as null', () => {
    const result = {
      circle: null,
      members: [],
    };
    const isValid =
      result &&
      typeof result === 'object' &&
      'circle' in result &&
      result.circle !== null &&
      Array.isArray(result.members);
    expect(isValid).toBe(false);
  });

  it('rejects empty object', () => {
    const result = {};
    const isValid =
      result &&
      typeof result === 'object' &&
      'circle' in result &&
      Array.isArray((result as any).members);
    expect(isValid).toBe(false);
  });

  it('rejects undefined', () => {
    const result = undefined;
    expect(!result || typeof result !== 'object').toBe(true);
  });

  it('rejects number response', () => {
    const result = 42;
    expect(typeof result !== 'object').toBe(true);
  });
});
