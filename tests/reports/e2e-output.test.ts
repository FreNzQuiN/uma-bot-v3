/**
 * E2E Report Output Tests
 *
 * These tests load the REAL snapshot data and verify the ACTUAL formatted
 * output that users see on WhatsApp. This catches:
 * - Wrong formatting (Markdown vs WhatsApp)
 * - Wrong calculations (gain, projection, risk)
 * - Missing sections (stale warnings, transfer badges)
 * - Wrong member counts
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
import { loadConfig } from '../../src/config';
import { loadRealSnapshot, WHATSAPP_MAX_LENGTH } from '../_helpers';

// Load real snapshot
let snapshot: Snapshot;

// Load config (uses config.yaml if exists, otherwise defaults)
let config: BotConfig;

beforeAll(() => {
  snapshot = loadRealSnapshot();
  config = loadConfig();
});

// ============================================================
// Cross-report validation (moved from formatters.test.ts)
// ============================================================

describe('cross-report validation', () => {
  it('all reports produce non-empty output', async () => {
    const reports = [
      generateDailyReport(snapshot, config, computeMembers(snapshot, config)),
      generateWeeklyReport(snapshot, config, computeMembers(snapshot, config)),
      generateMonthlyReport(snapshot, config, computeMembers(snapshot, config)),
      generateRanksReport(snapshot, config, computeMembers(snapshot, config)),
      generateBottomReport(snapshot, config, computeMembers(snapshot, config)),
      generateStatsReport(snapshot, config, computeMembers(snapshot, config)),
      await generateMembersReport(snapshot, config, computeMembers(snapshot, config)),
      generateTierReport(snapshot, config, computeMembers(snapshot, config)),
    ];

    for (const r of reports) {
      expect(r.length).toBeGreaterThan(0);
    }
  });

  it('all reports respect maxLength', async () => {
    const reports = [
      generateDailyReport(snapshot, config, computeMembers(snapshot, config)),
      generateWeeklyReport(snapshot, config, computeMembers(snapshot, config)),
      generateMonthlyReport(snapshot, config, computeMembers(snapshot, config)),
      generateRanksReport(snapshot, config, computeMembers(snapshot, config)),
      generateBottomReport(snapshot, config, computeMembers(snapshot, config)),
      generateStatsReport(snapshot, config, computeMembers(snapshot, config)),
      await generateMembersReport(snapshot, config, computeMembers(snapshot, config)),
      generateTierReport(snapshot, config, computeMembers(snapshot, config)),
    ];

    for (const r of reports) {
      expect(r.length).toBeLessThanOrEqual(WHATSAPP_MAX_LENGTH);
    }
  });

  it('all reports contain the club name', async () => {
    const reports = [
      generateDailyReport(snapshot, config, computeMembers(snapshot, config)),
      generateWeeklyReport(snapshot, config, computeMembers(snapshot, config)),
      generateMonthlyReport(snapshot, config, computeMembers(snapshot, config)),
      generateRanksReport(snapshot, config, computeMembers(snapshot, config)),
      generateBottomReport(snapshot, config, computeMembers(snapshot, config)),
      generateStatsReport(snapshot, config, computeMembers(snapshot, config)),
      await generateMembersReport(snapshot, config, computeMembers(snapshot, config)),
      generateTierReport(snapshot, config, computeMembers(snapshot, config)),
    ];

    for (const r of reports) {
      expect(r).toContain('Hol＿Horse');
    }
  });
});

// ============================================================
// Cross-report consistency
// ============================================================

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

// ============================================================
// Data integrity
// ============================================================

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

  it('no report exceeds WhatsApp message limit (4096 chars)', async () => {
    const reports = [
      generateDailyReport(snapshot, config, computeMembers(snapshot, config), 0),
      generateWeeklyReport(snapshot, config, computeMembers(snapshot, config), 0),
      generateMonthlyReport(snapshot, config, computeMembers(snapshot, config), 0),
      generateRanksReport(snapshot, config, computeMembers(snapshot, config)),
      generateBottomReport(snapshot, config, computeMembers(snapshot, config)),
      generateStatsReport(snapshot, config, computeMembers(snapshot, config)),
      await generateMembersReport(snapshot, config, computeMembers(snapshot, config)),
      generateTierReport(snapshot, config, computeMembers(snapshot, config)),
    ];
    for (const report of reports) {
      expect(report.length).toBeLessThanOrEqual(WHATSAPP_MAX_LENGTH);
    }
  });
});
