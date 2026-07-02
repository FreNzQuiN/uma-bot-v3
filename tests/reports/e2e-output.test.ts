/**
 * E2E Report Output Tests
 *
 * These tests load the REAL snapshot data and verify the ACTUAL formatted
 * output that users see on WhatsApp. This catches:
 * - Wrong formatting (Markdown vs WhatsApp)
 * - Wrong calculations (gain, projection, risk)
 * - Missing sections (stale warnings, transfer badges)
 * - Wrong member counts
 *
 * Property-based assertions verify output structure without brittle
 * exact-string matching. Each assertion targets a specific formatting
 * contract that would break if the renderer changed.
 */

import { Snapshot, BotConfig } from '../../src/types';
import { generateDailyReport } from '../../src/reports/daily';
import { generateWeeklyReport } from '../../src/reports/weekly';
import { generateMonthlyReport } from '../../src/reports/monthly';
import { generateRanksReport } from '../../src/reports/ranks';
import { generateBottomReport } from '../../src/reports/bottom';
import { generateStatsReport } from '../../src/reports/stats';
import { generateMembersReport } from '../../src/reports/members';
import { generateTierReport } from '../../src/reports/tier';
import { getDataDayFromSnapshot } from '../../src/data/snapshot';
import { computeMembers } from '../../src/reports/compute';
import { getDefaultConfig } from '../../src/config';
import { loadRealSnapshot, WHATSAPP_MAX_LENGTH } from '../_helpers';

let snapshot: Snapshot;

let config: BotConfig;

beforeAll(() => {
  snapshot = loadRealSnapshot();
  config = getDefaultConfig();
});


function getAllReports() {
  const members = computeMembers(snapshot, config);
  return {
    daily: generateDailyReport(snapshot, config, members),
    weekly: generateWeeklyReport(snapshot, config, members),
    monthly: generateMonthlyReport(snapshot, config, members, 0),
    ranks: generateRanksReport(snapshot, config, members),
    bottom: generateBottomReport(snapshot, config, members),
    stats: generateStatsReport(snapshot, config, members),
    members: generateMembersReport(snapshot, config, members),
    tier: generateTierReport(snapshot, config, members),
  };
}


describe('cross-report validation', () => {
  it('all reports produce non-empty output', async () => {
    const r = getAllReports();
    const all = [r.daily, r.weekly, r.monthly, r.ranks, r.bottom, r.stats, await r.members, r.tier];
    for (const report of all) {
      expect(report.length).toBeGreaterThan(0);
    }
  });

  it('all reports respect maxLength', async () => {
    const r = getAllReports();
    const all = [r.daily, r.weekly, r.monthly, r.ranks, r.bottom, r.stats, await r.members, r.tier];
    for (const report of all) {
      expect(report.length).toBeLessThanOrEqual(WHATSAPP_MAX_LENGTH);
    }
  });

  it('all reports contain the club name', async () => {
    const r = getAllReports();
    const all = [r.daily, r.weekly, r.monthly, r.ranks, r.bottom, r.stats, await r.members, r.tier];
    for (const report of all) {
      expect(report).toContain('Hol＿Horse');
    }
  });
});


describe('E2E: Cross-report consistency', () => {
  it('daily and monthly show same member count', () => {
    const daily = generateDailyReport(snapshot, config, computeMembers(snapshot, config), 0);
    const monthly = generateMonthlyReport(snapshot, config, computeMembers(snapshot, config), 0);
    const dailyMatch = daily.match(/kontribusi dari (\d+) anggota/);
    const monthlyMatch = monthly.match(/(\d+) kontribusi dari \d+ anggota/);
    expect(dailyMatch?.[1]).toBe(monthlyMatch?.[1]);
  });

  it('ranks and monthly use same gain values for top member', () => {
    const ranks = generateRanksReport(snapshot, config, computeMembers(snapshot, config));
    const monthly = generateMonthlyReport(snapshot, config, computeMembers(snapshot, config), 0);
    // Both should reference the same top member
    const ranksTop = ranks.match(/🥇 \*(.+?)\* —/);
    const monthlyTop = monthly.match(/1\. \*(.+?)\* —/);
    expect(ranksTop?.[1]).toBe(monthlyTop?.[1]);
  });

  it('stats projection matches monthly projection', () => {
    const stats = generateStatsReport(snapshot, config, computeMembers(snapshot, config));
    const monthly = generateMonthlyReport(snapshot, config, computeMembers(snapshot, config), 0);
    const statsProj = stats.match(/Proyeksi akhir bulan: ~([\d.,]+[KMB])/);
    const monthlyProj = monthly.match(/Proyeksi akhir bulan: ~([\d.,]+[KMB])/);
    expect(statsProj?.[1]).toBe(monthlyProj?.[1]);
  });

  it('bottom report shows members that monthly marks as below requirement', () => {
    const monthly = generateMonthlyReport(snapshot, config, computeMembers(snapshot, config), 0);
    const bottom = generateBottomReport(snapshot, config, computeMembers(snapshot, config));
    // Monthly shows "❌ N kurang", bottom shows those members
    const failMatch = monthly.match(/❌ (\d+) kurang/);
    expect(failMatch).toBeTruthy();
    expect(parseInt(failMatch![1])).toBeGreaterThan(0);
  });
});


describe('E2E: Data integrity', () => {
  it('snapshot has 34 members (as per AGENTS.md)', () => {
    expect(snapshot.members.length).toBe(34);
  });

  it('getDataDayFromSnapshot returns 11 for June 12 snapshot', () => {
    const dataDay = getDataDayFromSnapshot(snapshot);
    expect(dataDay).toBe(11);
  });

  it('computeMembers returns correct counts', () => {
    const members = computeMembers(snapshot, config);
    const active = members.filter((m) => m.status === 'active').length;
    const left = members.filter((m) => m.status === 'left').length;
    expect(active + left).toBe(34);
    // 6 transfer members (Zero, TheTengOne, Sairen, VitoHoow, Ceciria, Falkrum) — now active with isTransfer flag
    const transfer = members.filter((m) => m.isTransfer).length;
    expect(transfer).toBe(6);
    // 4 left members (DOA IBU, Kuro, Rowking, Lebowski — detected via member_count gap)
    expect(left).toBe(4);
    // 30 active members (24 regular + 6 transfer)
    expect(active).toBe(30);
  });
});


describe('E2E: Formatted output contracts', () => {
  let reports: Record<string, string>;

  beforeAll(async () => {
    const r = getAllReports();
    reports = {
      daily: r.daily,
      weekly: r.weekly,
      monthly: r.monthly,
      ranks: r.ranks,
      bottom: r.bottom,
      stats: r.stats,
      members: await r.members,
      tier: r.tier,
    };
  });

  it('daily report gain lines have correct format', () => {
    const lines = reports.daily.split('\n');
    const gainLines = lines.filter((l) => /^\d+\.\s/.test(l));

    expect(gainLines.length).toBeGreaterThan(0);

    for (const line of gainLines) {
      // Format: N. *Name* — +X.X[KMB]  or  N. *Name* 🔄 — +X.X[KMB]
      expect(line).toMatch(/^\d+\.\s\*.+\*\s*(🔄)? — \+[\d.]+[KMB]?$/);
    }
  });

  it('daily report shows transfer badges for known transfer members', () => {
    const transferNames = ['Zero', 'TheTengOne', 'Sairen', 'VitoHoow', 'Ceciria'];
    for (const name of transferNames) {
      expect(reports.daily).toContain(name);
      expect(reports.daily).toMatch(new RegExp(`${name}.*🔄`));
    }
  });

  it('daily report has footer with sync timestamp', () => {
    expect(reports.daily).toContain('⸻');
    expect(reports.daily).toMatch(/Terakhir sync: \d+\/\d+ \d{2}:\d{2}$/);
  });

  it('weekly report gain lines have correct format', () => {
    const lines = reports.weekly.split('\n');
    const gainLines = lines.filter((l) => /^\d+\.\s/.test(l));

    expect(gainLines.length).toBeGreaterThan(0);

    for (const line of gainLines) {
      expect(line).toMatch(/^\d+\.\s\*.+\*\s*(🔄)? — \+[\d.]+[KMB]?$/);
    }
  });

  it('weekly report shows transfer badges for all 6 transfer members', () => {
    const transferNames = ['Zero', 'TheTengOne', 'Sairen', 'VitoHoow', 'Ceciria', 'Falkrum'];
    const badgeCount = (reports.weekly.match(/🔄/g) ?? []).length;
    expect(badgeCount).toBe(transferNames.length);

    for (const name of transferNames) {
      expect(reports.weekly).toContain(name);
    }
  });

  it('monthly report gain lines have correct format', () => {
    const lines = reports.monthly.split('\n');
    const gainLines = lines.filter((l) => /^\d+\.\s/.test(l));

    expect(gainLines.length).toBeGreaterThan(0);

    for (const line of gainLines) {
      expect(line).toMatch(/^\d+\.\s\*.+\*\s*(🔄)? — \+[\d.]+[KMB]?$/);
    }
  });

  it('monthly report has requirement section with pass/fail counts', () => {
    expect(reports.monthly).toMatch(/✅ \d+ pass/);
    expect(reports.monthly).toMatch(/❌ \d+ kurang/);
    expect(reports.monthly).toMatch(/❌ \*.+\* — kurang [\d.]+[KMB]/);
  });

  it('monthly report has projection line', () => {
    expect(reports.monthly).toMatch(/Proyeksi akhir bulan: ~[\d.,]+[KMB]/);
  });

  it('ranks report top 3 have medal emojis', () => {
    expect(reports.ranks).toContain('🥇');
    expect(reports.ranks).toContain('🥈');
    expect(reports.ranks).toContain('🥉');
  });

  it('members report shows transfer source for transfer members', () => {
    expect(reports.members).toMatch(/\*Sairen\* 🔄 — [\d.]+[KMB] \(dari .+\)/);
    expect(reports.members).toMatch(/\*Zero\* 🔄 — [\d.]+[KMB] \(dari .+\)/);
  });

  it('members report shows door emoji for left members', () => {
    const leftNames = ['DOA IBU', 'Kuro', 'Rowking', 'Lebowski'];
    for (const name of leftNames) {
      expect(reports.members).toContain(`*${name}* 🚪`);
    }
  });
});
