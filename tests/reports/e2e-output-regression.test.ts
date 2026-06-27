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

describe('Empty snapshot: all generators handle gracefully', () => {
  const emptySnapshot = makeEmptyMembersSnapshot();
  const members = computeMembers(emptySnapshot, config);

  it('all report generators produce non-empty strings without crashing', async () => {
    const results = await Promise.all([
      Promise.resolve(generateDailyReport(emptySnapshot, config, members)),
      Promise.resolve(generateWeeklyReport(emptySnapshot, config, members)),
      Promise.resolve(generateMonthlyReport(emptySnapshot, config, members)),
      Promise.resolve(generateStatsReport(emptySnapshot, config, members)),
      Promise.resolve(generateTierReport(emptySnapshot, config, members)),
      Promise.resolve(generateRanksReport(emptySnapshot, config, members)),
      Promise.resolve(generateBottomReport(emptySnapshot, config, members)),
      generateMembersReport(emptySnapshot, config, members),
    ]);

    for (const result of results) {
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    }
  });

  it('all report generators return helpful message for empty members', async () => {
    const generators = [
      () => generateDailyReport(emptySnapshot, config, members),
      () => generateWeeklyReport(emptySnapshot, config, members),
      () => generateMonthlyReport(emptySnapshot, config, members),
      () => generateStatsReport(emptySnapshot, config, members),
      () => generateTierReport(emptySnapshot, config, members),
      () => generateRanksReport(emptySnapshot, config, members),
      () => generateBottomReport(emptySnapshot, config, members),
      () => generateMembersReport(emptySnapshot, config, members),
    ];

    for (const generate of generators) {
      const result = await generate();
      expect(result).toMatch(/data anggota|Belum ada data|belum tersedia|belum ada kontribusi/i);
    }
  });
});
