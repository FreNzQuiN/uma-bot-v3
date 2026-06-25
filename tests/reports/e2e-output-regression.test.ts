import type { Snapshot, BotConfig } from '../../src/types';
import { getDefaultConfig } from '../../src/config';
import { generateDailyReport } from '../../src/reports/daily';
import { generateWeeklyReport } from '../../src/reports/weekly';
import { generateMonthlyReport } from '../../src/reports/monthly';
import { generateStatsReport } from '../../src/reports/stats';
import { generateTierReport } from '../../src/reports/tier';
import { computeMembers } from '../../src/reports/compute';
import { generateRanksReport } from '../../src/reports/ranks';
import { generateBottomReport } from '../../src/reports/bottom';
import { generateMembersReport } from '../../src/reports/members';

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

describe('Bug 3: Empty snapshot.members graceful handling', () => {
  const emptySnapshot = makeEmptyMembersSnapshot();

  it('generateDailyReport handles empty members without crash', () => {
    expect(() => {
      const result = generateDailyReport(emptySnapshot, config, computeMembers(emptySnapshot, config));
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    }).not.toThrow();
  });

  it('generateDailyReport returns helpful message for empty members', () => {
    const result = generateDailyReport(emptySnapshot, config, computeMembers(emptySnapshot, config));
    expect(result).toMatch(/data anggota|Belum ada data|belum tersedia|belum ada kontribusi/i);
  });

  it('generateWeeklyReport handles empty members without crash', () => {
    expect(() => {
      const result = generateWeeklyReport(emptySnapshot, config, computeMembers(emptySnapshot, config));
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    }).not.toThrow();
  });

  it('generateWeeklyReport returns helpful message for empty members', () => {
    const result = generateWeeklyReport(emptySnapshot, config, computeMembers(emptySnapshot, config));
    expect(result).toMatch(/data anggota|Belum ada data|belum tersedia|belum ada kontribusi/i);
  });

  it('generateMonthlyReport handles empty members without crash', () => {
    expect(() => {
      const result = generateMonthlyReport(emptySnapshot, config, computeMembers(emptySnapshot, config));
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    }).not.toThrow();
  });

  it('generateMonthlyReport returns helpful message for empty members', () => {
    const result = generateMonthlyReport(emptySnapshot, config, computeMembers(emptySnapshot, config));
    expect(result).toMatch(/data anggota|Belum ada data|belum tersedia|belum ada kontribusi/i);
  });

  it('generateStatsReport handles empty members without crash', () => {
    expect(() => {
      const result = generateStatsReport(emptySnapshot, config, computeMembers(emptySnapshot, config));
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    }).not.toThrow();
  });

  it('generateStatsReport returns helpful message for empty members', () => {
    const result = generateStatsReport(emptySnapshot, config, computeMembers(emptySnapshot, config));
    expect(result).toMatch(/data anggota|Belum ada data|belum tersedia|belum ada kontribusi/i);
  });

  it('generateTierReport handles empty members without crash', () => {
    expect(() => {
      const result = generateTierReport(emptySnapshot, config, computeMembers(emptySnapshot, config));
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    }).not.toThrow();
  });

  it('generateTierReport returns helpful message for empty members', () => {
    const result = generateTierReport(emptySnapshot, config, computeMembers(emptySnapshot, config));
    expect(result).toMatch(/data anggota|Belum ada data|belum tersedia|belum ada kontribusi/i);
  });

  it('generateRanksReport handles empty members without crash', () => {
    expect(() => {
      const result = generateRanksReport(emptySnapshot, config, computeMembers(emptySnapshot, config));
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    }).not.toThrow();
  });

  it('generateRanksReport returns helpful message for empty members', () => {
    const result = generateRanksReport(emptySnapshot, config, computeMembers(emptySnapshot, config));
    expect(result).toMatch(/data anggota|Belum ada data|belum tersedia|belum ada kontribusi/i);
  });

  it('generateBottomReport handles empty members without crash', () => {
    expect(() => {
      const result = generateBottomReport(emptySnapshot, config, computeMembers(emptySnapshot, config));
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    }).not.toThrow();
  });

  it('generateBottomReport returns helpful message for empty members', () => {
    const result = generateBottomReport(emptySnapshot, config, computeMembers(emptySnapshot, config));
    expect(result).toMatch(/data anggota|Belum ada data|belum tersedia|belum ada kontribusi/i);
  });

  it('generateMembersReport handles empty members without crash', async () => {
    await expect(async () => {
      const result = await generateMembersReport(emptySnapshot, config, computeMembers(emptySnapshot, config));
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    }).not.toThrow();
  });

  it('generateMembersReport returns helpful message for empty members', async () => {
    const result = await generateMembersReport(emptySnapshot, config, computeMembers(emptySnapshot, config));
    expect(result).toMatch(/data anggota|Belum ada data|belum tersedia|belum ada kontribusi/i);
  });
});
