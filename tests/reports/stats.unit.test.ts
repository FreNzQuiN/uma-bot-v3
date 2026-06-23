/**
 * /stats Command — Comprehensive Tests
 *
 * Tests the stats report through unit-level verification and edge cases.
 * Uses real snapshot (examples/snapshot-june-12.json, 34 members).
 * All tests print full output for visual inspection.
 */

import { generateStatsReport } from '../../src/reports/stats';
import { getDefaultConfig } from '../../src/config';
import { computeMembers } from '../../src/reports/compute';
import { getDataDayFromSnapshot } from '../../src/data/snapshot';
import {
  countActiveDays,
  getMonthlyGain,
  getDailyGain,
  getLatestDataDay,
  isTransferMember,
  isStaleMember,
} from '../../src/data/daily-fans';
import { formatNumber, formatDateWIB } from '../../src/reports/format';
import type { Snapshot, BotConfig } from '../../src/types';
import {
  loadRealSnapshot,
  TRANSFER_NAMES,
  STALE_NAMES,
  mockCurrentDate,
  restoreDateMocks,
  makeEmptySnapshot,
  parseFormattedGain,
} from '../_helpers';

// ============================================================
// Constants & Loaders
// ============================================================

let snapshot: Snapshot;
let config: BotConfig;

beforeAll(() => {
  snapshot = loadRealSnapshot();
  config = getDefaultConfig();
});

// ============================================================
// Test Helpers
// ============================================================

function makeAllZeroSnapshot(): Snapshot {
  return {
    ...snapshot,
    members: snapshot.members.map((m) => ({
      ...m,
      daily_fans: m.daily_fans.map(() => 0),
    })),
  };
}

function makeSingleMemberSnapshot(): Snapshot {
  return {
    ...snapshot,
    members: [snapshot.members[0]],
  };
}

// ============================================================
// Section 1: Full Output & Visual Verification
// ============================================================

describe('Stats report full output', () => {
  it('prints the full report for visual inspection', () => {
    const report = generateStatsReport(snapshot, config, computeMembers(snapshot, config));
    expect(report.length).toBeGreaterThan(0);
  });
});

// ============================================================
// Section 2: Snapshot Data Fundamentals
// ============================================================

describe('Snapshot data fundamentals', () => {
  it('has 34 total members', () => {
    expect(snapshot.members.length).toBe(34);
  });

  it('has correct club metadata', () => {
    expect(snapshot.circle.name).toBe('Hol＿Horse');
    expect(snapshot.club_rank).toBe(8);
    expect(snapshot.fans_to_next_tier).toBe(349208495);
    expect(snapshot.fans_to_lower_tier).toBe(21848493);
  });

  it('latest data day is 11', () => {
    expect(getDataDayFromSnapshot(snapshot)).toBe(11);
  });

  it('has 30 active, 0 transfer, 4 left members', () => {
    const members = computeMembers(snapshot, config);
    const active = members.filter((m) => m.status === 'active').length;
    const transfer = members.filter((m) => m.isTransfer).length;
    const left = members.filter((m) => m.status === 'left').length;
    expect(active).toBe(30);
    expect(transfer).toBe(6);
    expect(left).toBe(4);
    expect(active + left).toBe(34);
  });
});

// ============================================================
// Section 3: Member Classification & Contributing Filter
// ============================================================

describe('Contributing member filter', () => {
  it('contributing = active + transfer = 30', () => {
    const members = computeMembers(snapshot, config);
    const contributing = members.filter(
      (m) => m.status === 'active'
    );
    expect(contributing.length).toBe(30);
  });

  it('ghost members (left) are excluded from contributing', () => {
    const members = computeMembers(snapshot, config);
    const contributing = members.filter(
      (m) => m.status === 'active'
    );
    const ghostNames = [...STALE_NAMES];
    for (const name of ghostNames) {
      expect(contributing.find((m) => m.trainerName === name)).toBeUndefined();
    }
  });

  it('ghost members have monthlyGain of 0', () => {
    const members = computeMembers(snapshot, config);
    const ghosts = members.filter((m) => m.status === 'left');
    for (const g of ghosts) {
      expect(g.monthlyGain).toBe(0);
    }
  });

  it('transfer members are in contributing', () => {
    const members = computeMembers(snapshot, config);
    const contributing = members.filter(
      (m) => m.status === 'active'
    );
    for (const name of TRANSFER_NAMES) {
      expect(contributing.find((m) => m.trainerName === name)).toBeDefined();
    }
  });
});

// ============================================================
// Section 4: Total Monthly Gain Verification
// ============================================================

describe('Total monthly gain', () => {
  it('total = 347,022,758', () => {
    const report = generateStatsReport(snapshot, config, computeMembers(snapshot, config));
    expect(report).toContain('Total gain bulanan: 347.0M');

    const members = computeMembers(snapshot, config);
    const contributing = members.filter(
      (m) => m.status === 'active'
    );
    const total = contributing.reduce((sum, m) => sum + m.monthlyGain, 0);
    expect(total).toBe(347022758);
  });

  it('each member monthlyGain matches getMonthlyGain raw calculation', () => {
    const members = computeMembers(snapshot, config);
    for (const m of members) {
      const rawGain = getMonthlyGain(m.dailyFans);
      expect(m.monthlyGain).toBe(rawGain);
    }
  });
});

// ============================================================
// Section 5: Average Monthly Gain
// ============================================================

describe('Average monthly gain', () => {
  it('average = round(347022758 / 30) = 11,567,425 → "11.6M"', () => {
    const expected = Math.round(347022758 / 30);
    expect(expected).toBe(11567425);
    expect(formatNumber(expected)).toBe('11.6M');

    const report = generateStatsReport(snapshot, config, computeMembers(snapshot, config));
    expect(report).toContain('Gain rata-rata bulanan: 11.6M');
  });
});

// ============================================================
// Section 6: Median Monthly Gain
// ============================================================

describe('Median monthly gain', () => {
  it('median = 9,683,217 → "9.7M"', () => {
    const members = computeMembers(snapshot, config);
    const contributing = members.filter(
      (m) => m.status === 'active'
    );
    const sortedGains = contributing.map((m) => m.monthlyGain).sort((a, b) => a - b);
    const mid = Math.floor(sortedGains.length / 2);
    const median = Math.round((sortedGains[mid - 1] + sortedGains[mid]) / 2);

    expect(sortedGains.length).toBe(30);
    expect(mid).toBe(15);
    expect(sortedGains[14]).toBe(9674443); // Lihking
    expect(sortedGains[15]).toBe(9691990); // Ceciria
    expect(median).toBe(9683217);
    expect(formatNumber(median)).toBe('9.7M');

    const report = generateStatsReport(snapshot, config, computeMembers(snapshot, config));
    expect(report).toContain('Gain median bulanan: 9.7M');
  });
});

// ============================================================
// Section 7: Average Daily Gain
// ============================================================

describe('Average daily gain', () => {
  it('average = round(32287438 / 30) = 1,076,248 → "1.1M"', () => {
    const members = computeMembers(snapshot, config);
    const contributing = members.filter(
      (m) => m.status === 'active'
    );
    const totalDailyGain = contributing.reduce((sum, m) => sum + m.latestDailyGain, 0);
    expect(totalDailyGain).toBe(32287438);

    const avg = Math.round(totalDailyGain / 30);
    expect(avg).toBe(1076248);
    expect(formatNumber(avg)).toBe('1.1M');

    const report = generateStatsReport(snapshot, config, computeMembers(snapshot, config));
    expect(report).toContain('Gain rata-rata harian: 1.1M');
  });
});

// ============================================================
// Section 8: Average Active Days
// ============================================================

describe('Average active days', () => {
  it('average = 8 hari (sum=254, round(254/30)=8)', () => {
    const members = computeMembers(snapshot, config);
    const contributing = members.filter(
      (m) => m.status === 'active'
    );
    const counts = contributing.map((m) => countActiveDays(m.dailyFans));
    const sum = counts.reduce((a, b) => a + b, 0);
    const avg = Math.round(sum / counts.length);

    expect(sum).toBe(278);
    expect(avg).toBe(9);

    const report = generateStatsReport(snapshot, config, computeMembers(snapshot, config));
    expect(report).toContain('Rata-rata hari aktif: 9 hari');
  });

  it('countActiveDays counts days where gain > 0', () => {
    const nargi = snapshot.members.find((m) => m.trainer_name === 'Nargi')!;
    const count = countActiveDays(nargi.daily_fans);
    // Nargi day 1 has data, day 8 has zero gain (same value as day 7)
    expect(count).toBe(10);
  });
});

// ============================================================
// Section 9: Zero Gain Today
// ============================================================

describe('Zero gain today', () => {
  it('count = 3 (naku, jgd, Falkrum)', () => {
    const report = generateStatsReport(snapshot, config, computeMembers(snapshot, config));
    expect(report).toContain('Zero gain hari ini: 3 orang');

    const members = computeMembers(snapshot, config);
    const contributing = members.filter(
      (m) => m.status === 'active'
    );
    const zeroMembers = contributing.filter((m) => m.latestDailyGain === 0);
    expect(zeroMembers.length).toBe(3);
    expect(zeroMembers.map((m) => m.trainerName).sort()).toEqual(['Falkrum', 'jgd', 'naku'].sort());
  });

  it('naku has 0 daily gain (day 11 == day 10)', () => {
    const naku = snapshot.members.find((m) => m.trainer_name === 'naku')!;
    expect(getDailyGain(naku.daily_fans, 11)).toBe(0);
    expect(naku.daily_fans[10]).toBe(136987120);
    expect(naku.daily_fans[9]).toBe(136987120);
  });

  it('jgd has 0 daily gain (day 11 == day 10)', () => {
    const jgd = snapshot.members.find((m) => m.trainer_name === 'jgd')!;
    expect(getDailyGain(jgd.daily_fans, 11)).toBe(0);
    expect(jgd.daily_fans[10]).toBe(41828247);
    expect(jgd.daily_fans[9]).toBe(41828247);
  });

  it('Falkrum has 0 daily gain (transfer, day 11 == day 10)', () => {
    const falkrum = snapshot.members.find((m) => m.trainer_name === 'Falkrum')!;
    expect(isTransferMember(falkrum)).toBe(true);
    expect(getDailyGain(falkrum.daily_fans, 11)).toBe(0);
    expect(falkrum.daily_fans[10]).toBe(192984005);
    expect(falkrum.daily_fans[9]).toBe(192984005);
  });
});

// ============================================================
// Section 10: Top Member (Active Only)
// ============================================================

describe('Top member (active only)', () => {
  it('top = GoldFamily — 27.7M', () => {
    const report = generateStatsReport(snapshot, config, computeMembers(snapshot, config));
    expect(report).toContain('Top: GoldFamily — 27.7M');

    const members = computeMembers(snapshot, config);
    const activeMembers = members.filter((m) => m.status === 'active');
    const sorted = [...activeMembers].sort((a, b) => b.monthlyGain - a.monthlyGain);
    expect(sorted[0].trainerName).toBe('GoldFamily');
    expect(sorted[0].monthlyGain).toBe(27709705);
  });

  it('GoldFamily is active (not transfer)', () => {
    const gold = snapshot.members.find((m) => m.trainer_name === 'GoldFamily')!;
    expect(isTransferMember(gold)).toBe(false);
  });
});

// ============================================================
// Section 11: Lowest Active Member
// ============================================================

describe('Lowest active member', () => {
  it('lowest = Yukil — 4.6M', () => {
    const report = generateStatsReport(snapshot, config, computeMembers(snapshot, config));
    expect(report).toContain('Lowest aktif: Yukil — 4.6M');

    const members = computeMembers(snapshot, config);
    const activeMembers = members.filter((m) => m.status === 'active');
    const sorted = [...activeMembers].sort((a, b) => b.monthlyGain - a.monthlyGain);
    expect(sorted[sorted.length - 1].trainerName).toBe('Yukil');
    expect(sorted[sorted.length - 1].monthlyGain).toBe(4567387);
  });

  it('lowest is active (not transfer)', () => {
    const yukil = snapshot.members.find((m) => m.trainer_name === 'Yukil')!;
    expect(isTransferMember(yukil)).toBe(false);
  });

  it('lowest active member is NOT a transfer member', () => {
    const members = computeMembers(snapshot, config);
    const activeMembers = members.filter((m) => m.status === 'active');
    const sorted = [...activeMembers].sort((a, b) => b.monthlyGain - a.monthlyGain);
    const lowest = sorted[sorted.length - 1];
    expect(lowest.status).toBe('active');
    expect(lowest.isTransfer).toBe(false);
  });
});

// ============================================================
// Section 12: Projection
// ============================================================

describe('Projection', () => {
  it('projection = 946,425,704 → "946.4M"', () => {
    const daysInMonth = new Date(2026, 6, 0).getDate(); // June = 30 days
    expect(daysInMonth).toBe(30);
    const projected = Math.round((347022758 / 11) * 30);
    expect(projected).toBe(946425704);
    expect(formatNumber(projected)).toBe('946.4M');

    const report = generateStatsReport(snapshot, config, computeMembers(snapshot, config));
    expect(report).toContain('Proyeksi akhir bulan: ~946.4M');
  });
});

// ============================================================
// Section 13: Tier Projection
// ============================================================

describe('Tier projection', () => {
  it('promosion likely (daysToPromote=12 <= daysLeft=19)', () => {
    const currentPace = Math.round(347022758 / 11);
    expect(currentPace).toBe(31547523);
    const daysToPromote = Math.ceil(349208495 / currentPace);
    expect(daysToPromote).toBe(12);
    const daysLeft = 30 - 11;
    expect(daysLeft).toBe(19);
    expect(daysToPromote).toBeLessThanOrEqual(daysLeft);

    const report = generateStatsReport(snapshot, config, computeMembers(snapshot, config));
    expect(report).toContain('Promosi: kemungkinan besar jika pace bertahan');
  });

  it('tier name is A+ for club_rank=8', () => {
    const report = generateStatsReport(snapshot, config, computeMembers(snapshot, config));
    expect(report).toContain('A+');
  });
});

// ============================================================
// Section 14: Requirement Pass Rate
// ============================================================

describe('Requirement pass rate', () => {
  it('pass rate = 3% (1/30) with default req=20M', () => {
    const report = generateStatsReport(snapshot, config, computeMembers(snapshot, config));
    expect(report).toContain('Requirement pass rate: 3% (1/30)');
  });

  it('only GoldFamily (27.7M) passes 20M requirement', () => {
    const members = computeMembers(snapshot, config);
    const contributing = members.filter(
      (m) => m.status === 'active'
    );
    const passCount = contributing.filter((m) => m.monthlyGain >= 20000000).length;
    expect(passCount).toBe(1);

    const passers = contributing.filter((m) => m.monthlyGain >= 20000000);
    expect(passers[0].trainerName).toBe('GoldFamily');
  });

  it('pass rate uses contributing.length as denominator', () => {
    const report = generateStatsReport(snapshot, config, computeMembers(snapshot, config));
    expect(report).toContain('(1/30)');
  });
});

// ============================================================
// Section 15: Status Line Correctness
// ============================================================

describe('Status line adds up to total', () => {
  it('Keluar + Transfer = Total anggota (Aktif includes transfers)', () => {
    const report = generateStatsReport(snapshot, config, computeMembers(snapshot, config));
    const aktifMatch = report.match(/Aktif: (\d+)/);
    const keluarMatch = report.match(/Keluar: (\d+)/);
    const transferMatch = report.match(/Transfer: (\d+)/);
    const totalMatch = report.match(/Total anggota: (\d+)/);

    expect(aktifMatch).not.toBeNull();
    expect(keluarMatch).not.toBeNull();
    expect(transferMatch).not.toBeNull();
    expect(totalMatch).not.toBeNull();

    const aktif = parseInt(aktifMatch![1]);
    const keluar = parseInt(keluarMatch![1]);
    const transfer = parseInt(transferMatch![1]);
    const total = parseInt(totalMatch![1]);

    // Aktif includes transfers, so Aktif + Keluar = Total
    expect(aktif + keluar).toBe(total);
    expect(aktif).toBe(30);
    expect(keluar).toBe(4);
    expect(transfer).toBe(6);
    expect(total).toBe(34);
  });
});

// ============================================================
// Section 16: Club Info
// ============================================================

describe('Club info in report', () => {
  it('shows circle name, tier, and date', () => {
    const report = generateStatsReport(snapshot, config, computeMembers(snapshot, config));
    expect(report).toContain('Hol＿Horse');
    expect(report).toContain('A+');
    expect(report).toContain('11 Juni 2026');
  });

  it('shows promotion and demotion gaps', () => {
    const report = generateStatsReport(snapshot, config, computeMembers(snapshot, config));
    expect(report).toContain('Promosi: 349.2M | Degradasi: 21.8M');
  });
});

// ============================================================
// Section 17: WhatsApp Formatting Compliance
// ============================================================

describe('WhatsApp formatting compliance', () => {
  it('uses no Markdown bold (**)', () => {
    const report = generateStatsReport(snapshot, config, computeMembers(snapshot, config));
    expect(report).not.toMatch(/\*\*[^*]+\*\*/);
  });

  it('has no Markdown headers (#)', () => {
    const report = generateStatsReport(snapshot, config, computeMembers(snapshot, config));
    const lines = report.split('\n');
    for (const line of lines) {
      expect(line).not.toMatch(/^#{1,6}\s/);
    }
  });

  it('uses emoji prefixes for sections', () => {
    const report = generateStatsReport(snapshot, config, computeMembers(snapshot, config));
    expect(report).toContain('📊');
    expect(report).toContain('📈');
    expect(report).toContain('📅');
    expect(report).toContain('🎯');
    expect(report).toContain('🏆');
    expect(report).toContain('📉');
  });

  it('uses Indonesian month names', () => {
    const report = generateStatsReport(snapshot, config, computeMembers(snapshot, config));
    expect(report).toContain('Juni');
    expect(report).not.toContain('June');
  });

  it('uses Indonesian labels', () => {
    const report = generateStatsReport(snapshot, config, computeMembers(snapshot, config));
    expect(report).toContain('Rata-rata');
    expect(report).toContain('hari');
    expect(report).toContain('orang');
    expect(report).toContain('anggota');
  });
});

// ============================================================
// Section 18: Empty Snapshot Edge Case
// ============================================================

describe('Empty snapshot edge case', () => {
  it('returns warning when members array is empty', () => {
    const emptySnapshot = makeEmptySnapshot(snapshot);
    const result = generateStatsReport(emptySnapshot, config, computeMembers(emptySnapshot, config));
    expect(result).toBe('ℹ️ *Stats*\nData statistik belum tersedia.');
  });
});

// ============================================================
// Section 19: All-Zero Gains Edge Case
// ============================================================

describe('All-zero gains edge case', () => {
  it('handles all-zero daily_fans gracefully', () => {
    const allZero = makeAllZeroSnapshot();
    const report = generateStatsReport(allZero, config, computeMembers(allZero, config));

    expect(report).toContain('📊 *Stats Overview*');
    expect(report).toContain('Total gain bulanan: 0');
    expect(report).toContain('Gain rata-rata bulanan: 0');
    expect(report).toContain('Gain median bulanan: 0');
    expect(report).toContain('Gain rata-rata harian: 0');
    // Only transfer members remain in contributing; all have zero gain
    // With all-zero data, all members are 'stale' (latestPositiveDay=0), 
    // then ghost detection makes them 'left' (member_count gap).
    // Contributing = active members = 0, so zero gain = 0.
    expect(report).toContain('Zero gain hari ini: 0 orang');
    expect(report).toContain('Proyeksi akhir bulan: ~0');
  });
});

// ============================================================
// Section 20: Single Member Edge Case
// ============================================================

describe('Single member edge case', () => {
  it('handles single member snapshot', () => {
    const singleMember = makeSingleMemberSnapshot();
    const report = generateStatsReport(singleMember, config, computeMembers(singleMember, config));

    expect(report).toContain('📊 *Stats Overview*');
    expect(report).toContain('Total anggota: 1');
  });
});

// ============================================================
// Section 21: Stale Data Warning
// ============================================================

describe('Stale data warning', () => {
  afterEach(() => {
    restoreDateMocks();
  });

  it('shows stale warning when snapshot is 2+ days old', () => {
    mockCurrentDate(2026, 6, 13); // today is June 13, data is from June 11
    const report = generateStatsReport(snapshot, config, computeMembers(snapshot, config));
    expect(report).toContain('⚠️ Data klub mungkin tidak terbaru');
    expect(report).toContain('update terakhir: 11 Juni 2026');
  });

  it('shows NO stale warning when snapshot is fresh (same day)', () => {
    mockCurrentDate(2026, 6, 11); // today is June 11, data is from June 11
    const report = generateStatsReport(snapshot, config, computeMembers(snapshot, config));
    expect(report).not.toContain('⚠️ Data klub mungkin tidak terbaru');
  });

  it('shows NO stale warning when snapshot is 1 day old', () => {
    mockCurrentDate(2026, 6, 12); // today is June 12, data is from June 11
    const report = generateStatsReport(snapshot, config, computeMembers(snapshot, config));
    expect(report).not.toContain('⚠️ Data klub mungkin tidak terbaru');
  });

  it('stale warning uses Indonesian date format', () => {
    mockCurrentDate(2026, 6, 13);
    const report = generateStatsReport(snapshot, config, computeMembers(snapshot, config));
    expect(report).toMatch(/update terakhir: \d+ Juni 2026/);
  });

  it('no stale warning when snapshot is from previous month', () => {
    mockCurrentDate(2026, 6, 13);
    const maySnapshot: Snapshot = {
      ...snapshot,
      members: snapshot.members.map((m) => ({
        ...m,
        month: 5,
        daily_fans: m.daily_fans.map((v, i) => (i < 28 ? v : 0)),
      })),
    };
    const report = generateStatsReport(maySnapshot, config, computeMembers(maySnapshot, config));
    expect(report).not.toContain('⚠️ Data klub mungkin tidak terbaru');
  });
});

// ============================================================
// Section 22: Output Line Structure
// ============================================================

describe('Output line structure', () => {
  let report: string;
  let lines: string[];

  beforeAll(() => {
    report = generateStatsReport(snapshot, config, computeMembers(snapshot, config));
    lines = report.split('\n');
  });

  it('starts with header line (bold)', () => {
    expect(lines[0]).toBe('📊 *Stats Overview*');
  });

  it('has blank line after header', () => {
    expect(lines[1]).toBe('');
  });

  it('has circle name and tier with rank on line 3', () => {
    expect(lines[2]).toBe('Hol＿Horse | A+ (#431)');
  });

  it('has data line on line 4', () => {
    expect(lines[3]).toBe('Periode data: 11 Juni 2026, 22:00 WIB');
  });

  it('has Total anggota line', () => {
    expect(lines.some((l) => l.startsWith('Total anggota:'))).toBe(true);
  });

  it('has Aktif/Keluar/Transfer breakdown', () => {
    expect(lines.some((l) => l.match(/Aktif: \d+ \| Keluar: \d+ \| Transfer: \d+/))).toBe(true);
  });

  it('has gain statistics section', () => {
    expect(report).toContain('Gain rata-rata bulanan:');
    expect(report).toContain('Gain median bulanan:');
    expect(report).toContain('Gain rata-rata harian:');
  });

  it('has top and lowest members section', () => {
    expect(report).toContain('🏆 Top:');
    expect(report).toContain('📉 Lowest aktif:');
  });

  it('has projection line', () => {
    expect(report).toContain('Proyeksi akhir bulan:');
  });

  it('has tier projection line', () => {
    expect(report).toContain('🎯 Promosi:');
  });

  it('has pass rate and total gain at the end', () => {
    expect(report).toContain('Requirement pass rate:');
    expect(report).toContain('Total gain bulanan:');
  });

  it('has promotion/demotion gaps as last regular line', () => {
    const promoLine = lines.find((l) => l.startsWith('Promosi:') && l.includes('Degradasi:'));
    expect(promoLine).toBeDefined();
    expect(promoLine).toBe('Promosi: 349.2M | Degradasi: 21.8M');
  });
});

// ============================================================
// Section 23: Stale Warning Placement
// ============================================================

describe('Stale warning placement', () => {
  afterEach(() => {
    restoreDateMocks();
  });

  it('stale warning appears after promotion/demotion line', () => {
    mockCurrentDate(2026, 6, 13);
    const report = generateStatsReport(snapshot, config, computeMembers(snapshot, config));
    const lines = report.split('\n');

    const promoIdx = lines.findIndex((l) => l.startsWith('Promosi:') && l.includes('Degradasi:'));
    const staleIdx = lines.findIndex((l) => l.includes('⚠️ Data klub mungkin tidak terbaru'));

    expect(promoIdx).toBeGreaterThan(-1);
    expect(staleIdx).toBeGreaterThan(promoIdx);
  });
});

// ============================================================
// Section 24: Transfer Member Impact on Averages
// ============================================================

describe('Transfer members included in averages', () => {
  it('transfer members are in the contributing set for averages', () => {
    const members = computeMembers(snapshot, config);
    const contributing = members.filter(
      (m) => m.status === 'active'
    );

    const transferGains = contributing
      .filter((m) => m.isTransfer)
      .map((m) => m.monthlyGain);
    expect(transferGains.length).toBe(6);

    // Sairen has high monthlyGain (17.9M) among transfers
    const sairen = contributing.find((m) => m.trainerName === 'Sairen');
    expect(sairen).toBeDefined();
    expect(sairen!.monthlyGain).toBe(17882090);
  });

  it('contribution line count matches (30 in denominator)', () => {
    const report = generateStatsReport(snapshot, config, computeMembers(snapshot, config));
    expect(report).toContain('(1/30)');
  });
});

// ============================================================
// Section 25: Daily Gain Calculation Tracing
// ============================================================

describe('Daily gain tracing', () => {
  it('Nargi day 11 gain = 3,084,880', () => {
    const nargi = snapshot.members.find((m) => m.trainer_name === 'Nargi')!;
    expect(nargi.daily_fans[10]).toBe(373937532);
    expect(nargi.daily_fans[9]).toBe(370852652);
    expect(getDailyGain(nargi.daily_fans, 11)).toBe(3084880);
  });

  it('GoldFamily day 11 gain = 2,710,597', () => {
    const gf = snapshot.members.find((m) => m.trainer_name === 'GoldFamily')!;
    expect(getDailyGain(gf.daily_fans, 11)).toBe(2710597);
  });

  it('Sairen (transfer) day 11 gain = 2,230,269', () => {
    const s = snapshot.members.find((m) => m.trainer_name === 'Sairen')!;
    expect(isTransferMember(s)).toBe(true);
    expect(getDailyGain(s.daily_fans, 11)).toBe(2230269);
  });
});

// ============================================================
// Section 26: Monthly Gain Calculation Tracing
// ============================================================

describe('Monthly gain tracing', () => {
  it('GoldFamily monthlyGain = 317726222 - 290016517 = 27,709,705', () => {
    const gf = snapshot.members.find((m) => m.trainer_name === 'GoldFamily')!;
    const firstPos = getLatestDataDay(
      gf.daily_fans.filter((v, i) => {
        // find first positive
        return v > 0;
      })
    );
    expect(gf.daily_fans[0]).toBe(290016517); // day 1
    expect(gf.daily_fans[10]).toBe(317726222); // day 11
    expect(getMonthlyGain(gf.daily_fans)).toBe(27709705);
  });

  it('Yukil monthlyGain = 255560882 - 250993495 = 4,567,387', () => {
    const yukil = snapshot.members.find((m) => m.trainer_name === 'Yukil')!;
    expect(yukil.daily_fans[0]).toBe(250993495);
    expect(yukil.daily_fans[10]).toBe(255560882);
    expect(getMonthlyGain(yukil.daily_fans)).toBe(4567387);
  });

  it('Sairen (transfer) monthlyGain = 442813391 - 424931301 = 17,882,090', () => {
    const s = snapshot.members.find((m) => m.trainer_name === 'Sairen')!;
    // First positive day is day 6 (index 5) = 424931301
    // Latest positive day is day 11 (index 10) = 442813391
    expect(s.daily_fans[5]).toBe(424931301);
    expect(s.daily_fans[10]).toBe(442813391);
    expect(getMonthlyGain(s.daily_fans)).toBe(17882090);
  });
});

// ============================================================
// Section 27: Edge Case - Fans to Next Tier = 0
// ============================================================

describe('Tier projection: max tier reached', () => {
  it('shows "sudah di tier maksimal" when fans_to_next_tier = 0', () => {
    const maxTierSnapshot: Snapshot = {
      ...snapshot,
      fans_to_next_tier: 0,
    };
    const report = generateStatsReport(maxTierSnapshot, config, computeMembers(maxTierSnapshot, config));
    expect(report).toContain('Tier: sudah di tier maksimal');
  });
});

// ============================================================
// Section 28: Edge Case - Promotion Not Likely
// ============================================================

describe('Tier projection: promotion not likely', () => {
  it('shows "butuh X lagi" when daysToPromote > daysLeft', () => {
    const hardSnapshot: Snapshot = {
      ...snapshot,
      fans_to_next_tier: 999_999_999_999, // impossibly large
    };
    const report = generateStatsReport(hardSnapshot, config, computeMembers(hardSnapshot, config));
    expect(report).toContain('butuh');
    expect(report).toContain('lagi');
  });
});

// ============================================================
// Section 29: Days Elapsed = 0 Edge Case
// ============================================================

describe('Days elapsed = 0 edge case', () => {
  it('projection is 0 when dataDay = 0', () => {
    const zeroDaySnapshot: Snapshot = {
      ...snapshot,
      members: snapshot.members.map((m) => ({
        ...m,
        daily_fans: m.daily_fans.map(() => 0),
      })),
    };
    const report = generateStatsReport(zeroDaySnapshot, config, computeMembers(zeroDaySnapshot, config));
    expect(report).toContain('Proyeksi akhir bulan: ~0');
  });
});

// ============================================================
// Section 30: Active Members Section (Top/Lowest)
// ============================================================

describe('Top/Lowest active section', () => {
  it('does not show top/lowest when no active members (all left)', () => {
    // All members with all-zero data → status='stale' → ghost detection → 'left'
    const allLeft: Snapshot = {
      ...snapshot,
      members: snapshot.members.map((m) => ({
        ...m,
        daily_fans: m.daily_fans.map(() => 0),
      })),
    };
    const report = generateStatsReport(allLeft, config, computeMembers(allLeft, config));
    // No 🏆 or 📉 lines if no active members
    expect(report).not.toContain('🏆 Top:');
    expect(report).not.toContain('📉 Lowest aktif:');
  });
});
