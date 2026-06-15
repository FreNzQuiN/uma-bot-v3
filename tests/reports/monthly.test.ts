/**
 * /monthly Command — Comprehensive Tests
 *
 * Tests the monthly report through all key behaviors:
 *   - Monthly gain calculation (latestPositiveValue - firstPositiveValue)
 *   - Member ranking sorted by monthlyGain descending
 *   - Active/inactive/transfer counts
 *   - Projected month-end extrapolation
 *   - Requirement pass/fail section
 *   - Offset handling (graceful fallback when no previous month data)
 *   - Transfer badges
 *   - Empty snapshot guard
 *   - WhatsApp formatting compliance
 *   - Stale data warning
 *   - Header format
 *   - Only contributors with gain > 0 shown
 *
 * Uses real snapshot (examples/snapshot-june-12.json, 34 members).
 * All tests print full output for visual inspection.
 */

import * as fs from 'fs';
import * as path from 'path';
import { generateMonthlyReport } from '../../src/reports/monthly';
import { getDefaultConfig } from '../../src/config';
import { getMonthlyGain } from '../../src/data/daily-fans';
import { getDataDayFromSnapshot } from '../../src/data/snapshot';
import { formatNumber } from '../../src/reports/format';
import type { Snapshot, BotConfig } from '../../src/types';

// ============================================================
// Constants & Loaders
// ============================================================

const SNAPSHOT_PATH = path.join(__dirname, '../../examples/snapshot-june-12.json');

let snapshot: Snapshot;
let config: BotConfig;
let loadMonthSnapshotsSpy: jest.SpyInstance;

beforeAll(() => {
  snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf-8'));
  config = getDefaultConfig();
  // Mock loadMonthSnapshots globally to return empty by default,
  // preventing tests from depending on disk data which may have
  // out-of-range data days (e.g. May snapshot with day 32).
  // Individual tests can override via mockImplementation/mockReturnValue
  // but must NOT call mockRestore() — that would remove the global mock.
  loadMonthSnapshotsSpy = jest.spyOn(
    require('../../src/data/snapshot'), 'loadMonthSnapshots'
  ).mockReturnValue([]);
});

afterAll(() => {
  loadMonthSnapshotsSpy.mockRestore();
});

// ============================================================
// Test Helpers
// ============================================================

function makeConfig(overrides: { monthlyFans?: number } = {}): BotConfig {
  const base = getDefaultConfig();
  if (overrides.monthlyFans !== undefined) {
    return {
      ...base,
      requirements: {
        ...base.requirements,
        monthlyFans: overrides.monthlyFans,
      },
    };
  }
  return base;
}

function mockCurrentDate(year: number, month: number, day: number) {
  // Noon JST = 03:00 UTC. Use fake timers so new Date() returns this time.
  const utcMs = Date.UTC(year, month - 1, day, 3, 0, 0);
  jest.useFakeTimers();
  jest.setSystemTime(new Date(utcMs));
}

function restoreDateMocks() {
  jest.useRealTimers();
}

/**
 * Build the expected gains for all members from raw snapshot data.
 * Returns sorted by monthlyGain descending (only gain > 0).
 */
function buildExpectedGains(): { name: string; gain: number; isTransfer: boolean }[] {
  const gains: { name: string; gain: number; isTransfer: boolean }[] = [];
  for (const member of snapshot.members) {
    const gain = getMonthlyGain(member.daily_fans);
    if (gain > 0) {
      gains.push({
        name: member.trainer_name,
        gain,
        isTransfer: !!(member.previous_circle_id || member.previous_circle_name),
      });
    }
  }
  gains.sort((a, b) => b.gain - a.gain);
  return gains;
}

// ============================================================
// Section 1: Snapshot Data Verification
// ============================================================

describe('Snapshot data for monthly tests', () => {
  it('has correct latest data day = 11', () => {
    expect(getDataDayFromSnapshot(snapshot)).toBe(11);
  });

  it('has 34 members', () => {
    expect(snapshot.members.length).toBe(34);
  });

  it('all members have year=2026 and month=6', () => {
    for (const member of snapshot.members) {
      expect(member.year).toBe(2026);
      expect(member.month).toBe(6);
    }
  });

  it('club_rank = 8 maps to A+', () => {
    expect(snapshot.club_rank).toBe(8);
  });
});

// ============================================================
// Section 2: Monthly Gain Calculation (Manual Verification)
// ============================================================

describe('Monthly gain calculation — manual verification from raw data', () => {
  it('Ryu: first=316,856,492 (day1), latest=332,207,534 (day11) → gain=15,351,042 → 15.4M', () => {
    const ryu = snapshot.members.find((m) => m.trainer_name === 'Ryu')!;
    expect(ryu.daily_fans[0]).toBe(316856492); // day 1
    expect(ryu.daily_fans[10]).toBe(332207534); // day 11
    const gain = getMonthlyGain(ryu.daily_fans);
    expect(gain).toBe(332207534 - 316856492); // 15,351,042
    expect(formatNumber(gain)).toBe('15.4M');
  });

  it('GoldFamily: first=290,016,517 (day1), latest=317,726,222 (day11) → gain=27,709,705 → 27.7M', () => {
    const m = snapshot.members.find((mm) => mm.trainer_name === 'GoldFamily')!;
    expect(m.daily_fans[0]).toBe(290016517);
    expect(m.daily_fans[10]).toBe(317726222);
    const gain = getMonthlyGain(m.daily_fans);
    expect(gain).toBe(317726222 - 290016517); // 27,709,705
    expect(formatNumber(gain)).toBe('27.7M');
  });

  it('Sairen (transfer): first=424,931,301 (day6), latest=442,813,391 (day11) → gain=17,882,090 → 17.9M', () => {
    const s = snapshot.members.find((m) => m.trainer_name === 'Sairen')!;
    // Sairen has negative days 1-3, zeros day 4-5, first positive day 6
    expect(s.daily_fans[5]).toBe(424931301); // day 6
    expect(s.daily_fans[10]).toBe(442813391); // day 11
    const gain = getMonthlyGain(s.daily_fans);
    expect(gain).toBe(442813391 - 424931301); // 17,882,090
    expect(formatNumber(gain)).toBe('17.9M');
  });

  it('DzFx: first=351,811,026 (day1), latest=369,974,968 (day11) → gain=18,163,942 → 18.2M', () => {
    const d = snapshot.members.find((m) => m.trainer_name === 'DzFx')!;
    expect(d.daily_fans[0]).toBe(351811026);
    expect(d.daily_fans[10]).toBe(369974968);
    const gain = getMonthlyGain(d.daily_fans);
    expect(gain).toBe(369974968 - 351811026); // 18,163,942
    expect(formatNumber(gain)).toBe('18.2M');
  });

  it('Nargi: first=363,625,667 (day1), latest=373,937,532 (day11) → gain=10,311,865 → 10.3M', () => {
    const n = snapshot.members.find((m) => m.trainer_name === 'Nargi')!;
    expect(n.daily_fans[0]).toBe(363625667);
    expect(n.daily_fans[10]).toBe(373937532);
    const gain = getMonthlyGain(n.daily_fans);
    expect(gain).toBe(373937532 - 363625667); // 10,311,865
    expect(formatNumber(gain)).toBe('10.3M');
  });

  it('Zero (transfer): first=301,413,137 (day4), latest=315,534,000 (day11) → gain=14,120,863 → 14.1M', () => {
    const z = snapshot.members.find((m) => m.trainer_name === 'Zero')!;
    // Negative days 1-2, zero day 3, first positive day 4
    expect(z.daily_fans[3]).toBe(301413137); // day 4
    expect(z.daily_fans[10]).toBe(315534000); // day 11
    const gain = getMonthlyGain(z.daily_fans);
    expect(gain).toBe(315534000 - 301413137); // 14,120,863
    expect(formatNumber(gain)).toBe('14.1M');
  });

  it('DOA IBU: only day1 has data → gain = 0 (single data point)', () => {
    const m = snapshot.members.find((mm) => mm.trainer_name === 'DOA IBU')!;
    expect(m.daily_fans[0]).toBe(293009510);
    expect(m.daily_fans[1]).toBe(0); // day 2 is 0
    const gain = getMonthlyGain(m.daily_fans);
    expect(gain).toBe(0);
  });

  it('Kuro: days 1-2 same value → gain = 0', () => {
    const m = snapshot.members.find((mm) => mm.trainer_name === 'Kuro')!;
    expect(m.daily_fans[0]).toBe(251759384);
    expect(m.daily_fans[1]).toBe(251759384);
    const gain = getMonthlyGain(m.daily_fans);
    expect(gain).toBe(0);
  });

  it('Rowking: days 1-3 same value → gain = 0', () => {
    const m = snapshot.members.find((mm) => mm.trainer_name === 'Rowking')!;
    expect(m.daily_fans[0]).toBe(695961708);
    expect(m.daily_fans[2]).toBe(695961708);
    const gain = getMonthlyGain(m.daily_fans);
    expect(gain).toBe(0);
  });

  it('Lebowski: only day1 has data → gain = 0 (single data point)', () => {
    const m = snapshot.members.find((mm) => mm.trainer_name === 'Lebowski')!;
    expect(m.daily_fans[0]).toBe(104711754);
    expect(m.daily_fans[1]).toBe(0);
    const gain = getMonthlyGain(m.daily_fans);
    expect(gain).toBe(0);
  });

  it('Falkrum (transfer): first=184,624,471 (day4), latest=192,984,005 (day11) → gain=8,359,534 → 8.4M', () => {
    const f = snapshot.members.find((m) => m.trainer_name === 'Falkrum')!;
    expect(f.daily_fans[3]).toBe(184624471); // day 4
    expect(f.daily_fans[10]).toBe(192984005); // day 11
    const gain = getMonthlyGain(f.daily_fans);
    expect(gain).toBe(192984005 - 184624471); // 8,359,534
    expect(formatNumber(gain)).toBe('8.4M');
  });
});

// ============================================================
// Section 3: Full Output — Print and Verify
// ============================================================

describe('Full monthly report output (offset=0)', () => {
  let report: string;
  let lines: string[];

  beforeAll(() => {
    report = generateMonthlyReport(snapshot, config, 0);
    lines = report.split('\n');
  });

  it('prints the full report for visual verification', () => {
    console.log('\n========== FULL MONTHLY REPORT (offset=0) ==========');
    console.log(report);
    console.log('========== END REPORT ==========');
    expect(report.length).toBeGreaterThan(0);
  });

  it('header is bold with emoji: "📅 *Monthly Report — Juni 2026*"', () => {
    expect(lines[0]).toBe('📅 *Monthly Report — Juni 2026*');
  });

  it('line 1 is empty (separator)', () => {
    expect(lines[1]).toBe('');
  });

  it('line 2 is club info with rank: "Hol＿Horse | A+ (#431)"', () => {
    expect(lines[2]).toBe('Hol＿Horse | A+ (#431)');
  });

  it('line 3 is data line', () => {
    expect(lines[3]).toBe('Periode data: 11 Juni 2026, 22:00 WIB');
  });

  it('line 4 is Promosi | Degradasi (combined)', () => {
    expect(lines[4]).toMatch(/^Promosi: [\d.]+[KMB] fans lagi \| Degradasi: buffer [\d.]+[KMB]$/);
  });

  it('line 5 is empty (separator before summary)', () => {
    expect(lines[5]).toBe('');
  });

  it('line 6 is summary line', () => {
    expect(lines[6]).toBe('👥 30 kontribusi dari 30 anggota | Total: 347.0M');
  });

  it('line 7 is projected month-end', () => {
    expect(lines[7]).toMatch(/^Proyeksi akhir bulan: ~/);
  });

  it('line 8 is empty (before member rankings)', () => {
    expect(lines[8]).toBe('');
  });

  it('has 30 contributing members (gain > 0)', () => {
    const memberLines = lines.filter((l) => /^\d+\.\s/.test(l));
    expect(memberLines.length).toBe(30);
  });

  it('first member is *GoldFamily* — +27.7M', () => {
    const memberLines = lines.filter((l) => /^\d+\.\s/.test(l));
    expect(memberLines[0]).toBe('1. *GoldFamily* — +27.7M');
  });

  it('second member is *RngF* — +19.2M', () => {
    const memberLines = lines.filter((l) => /^\d+\.\s/.test(l));
    expect(memberLines[1]).toBe('2. *RngF* — +19.2M');
  });

  it('members are sorted by monthly gain descending', () => {
    const memberLines = lines.filter((l) => /^\d+\.\s/.test(l));
    const gains: number[] = [];
    for (const line of memberLines) {
      const match = line.match(/— \+?([\d.]+[KMB]?|0)$/);
      if (!match) throw new Error(`Could not parse gain from: ${line}`);
      const val = match[1];
      if (val === '0') { gains.push(0); continue; }
      let num = parseFloat(val);
      if (val.endsWith('K')) num *= 1_000;
      if (val.endsWith('M')) num *= 1_000_000;
      if (val.endsWith('B')) num *= 1_000_000_000;
      gains.push(num);
    }
    for (let i = 1; i < gains.length; i++) {
      expect(gains[i - 1]).toBeGreaterThanOrEqual(gains[i]);
    }
  });

  it('stale members (DOA IBU, Kuro, Rowking, Lebowski) are NOT in member list', () => {
    const memberLines = lines.filter((l) => /^\d+\.\s/.test(l));
    for (const line of memberLines) {
      expect(line).not.toContain('DOA IBU');
      expect(line).not.toContain('Kuro');
      expect(line).not.toContain('Rowking');
      expect(line).not.toContain('Lebowski');
    }
  });
});

// ============================================================
// Section 4: Transfer Badges
// ============================================================

describe('Transfer badges in monthly report', () => {
  let report: string;

  beforeAll(() => {
    report = generateMonthlyReport(snapshot, config, 0);
  });

  it('all 6 transfer members have 🔄 badge', () => {
    const transferNames = ['Zero', 'TheTengOne', 'Sairen', 'VitoHoow', 'Ceciria', 'Falkrum'];
    const memberLines = report.split('\n').filter((l) => /^\d+\.\s/.test(l));
    for (const name of transferNames) {
      const line = memberLines.find((l) => l.includes(name));
      expect(line).toBeDefined();
      expect(line!).toContain('🔄');
    }
  });

  it('exactly 6 lines contain 🔄', () => {
    const memberLines = report.split('\n').filter((l) => /^\d+\.\s/.test(l));
    const transferLines = memberLines.filter((l) => l.includes('🔄'));
    expect(transferLines.length).toBe(6);
  });
});

// ============================================================
// Section 5: Active / Inactive / Transfer Counts
// ============================================================

describe('Member counts', () => {
  it('summary shows contributor count and total', () => {
    const report = generateMonthlyReport(snapshot, config, 0);
    expect(report).toContain('👥 30 kontribusi dari 30 anggota | Total: 347.0M');
  });

  it('transfer count is reflected in badge count', () => {
    const report = generateMonthlyReport(snapshot, config, 0);
    const memberLines = report.split('\n').filter((l) => /^\d+\.\s/.test(l));
    const transferLines = memberLines.filter((l) => l.includes('🔄'));
    expect(transferLines.length).toBe(6);
  });

  it('stale members have latestPositiveDay <= dataDay - staleAfterDays (7)', () => {
    // dataDay = 11, staleAfterDays = 7, so stale if latestPositiveDay <= 4
    const staleNames = ['DOA IBU', 'Kuro', 'Rowking', 'Lebowski'];
    for (const name of staleNames) {
      const m = snapshot.members.find((mm) => mm.trainer_name === name)!;
      // getLatestDataDay from their daily_fans
      const fans = m.daily_fans;
      let latest = 0;
      for (let i = fans.length - 1; i >= 0; i--) {
        if (typeof fans[i] === 'number' && fans[i] > 0) {
          latest = i + 1;
          break;
        }
      }
      expect(latest).toBeLessThanOrEqual(4);
    }
  });
});

// ============================================================
// Section 6: Projected Month-End
// ============================================================

describe('Projected month-end calculation', () => {
  it('projection = (totalGain / 11) * 30 rounded', () => {
    const report = generateMonthlyReport(snapshot, config, 0);
    const expectedGains = buildExpectedGains();
    let totalGain = 0;
    for (const g of expectedGains) totalGain += g.gain;
    const daysElapsed = 11;
    const daysInMonth = 30; // June has 30 days
    const projected = Math.round((totalGain / daysElapsed) * daysInMonth);
    const projectedStr = formatNumber(projected);

    expect(report).toContain(`Proyeksi akhir bulan: ~${projectedStr}`);
  });

  it('projection line uses ~ prefix', () => {
    const report = generateMonthlyReport(snapshot, config, 0);
    expect(report).toMatch(/Proyeksi akhir bulan: ~/);
  });
});

// ============================================================
// Section 7: Requirement Pass/Fail
// ============================================================

describe('Requirement section', () => {
  it('shows requirement line with formatted monthlyFans', () => {
    const report = generateMonthlyReport(snapshot, config, 0);
    expect(report).toContain('*🎯 Requirement: 20.0M/bulan*');
  });

  it('shows pass/fail counts with "kurang" (not "gagal")', () => {
    const report = generateMonthlyReport(snapshot, config, 0);
    expect(report).toMatch(/✅ \d+ pass \| ❌ \d+ kurang/);
  });

  it('only GoldFamily passes 20M requirement', () => {
    const report = generateMonthlyReport(snapshot, config, 0);
    // GoldFamily = 27.7M >= 20M, next is RngF = 19.2M < 20M
    expect(report).toContain('✅ 1 pass | ❌ 29 kurang');
  });

  it('when monthlyFans = 0, requirement section is not shown', () => {
    const cfg = makeConfig({ monthlyFans: 0 });
    const report = generateMonthlyReport(snapshot, cfg, 0);
    expect(report).not.toContain('🎯 Requirement');
    expect(report).not.toContain('pass |');
  });

  it('when monthlyFans = 10M, more members pass', () => {
    const cfg = makeConfig({ monthlyFans: 10_000_000 });
    const report = generateMonthlyReport(snapshot, cfg, 0);
    console.log('\n========== MONTHLY REPORT with monthlyFans=10M ==========');
    console.log(report);
    console.log('========== END ==========');

    // Members with monthlyGain >= 10M:
    // GoldFamily: 27.7M, RngF: 19.2M, Aditya: 18.6M, DzFx: 18.2M,
    // Sairen: 17.9M, sirsokban: 17.1M, Luck99: 16.8M, Anshu: 16.1M,
    // Ryu: 15.4M, Seterako: 15.3M, Zero: 14.1M, Dyy": 13.1M, Nargi: 10.3M
    // = 13 pass
    expect(report).toContain('✅ 13 pass | ❌ 17 kurang');
  });
});

// ============================================================
// Section 8: Offset Handling
// ============================================================

describe('Offset handling', () => {
  // loadMonthSnapshots is already mocked globally to return []
  // so historical month data won't be loaded from disk

  it('offset=0 uses current snapshot', () => {
    const report0 = generateMonthlyReport(snapshot, config, 0);
    expect(report0).toContain('📅 *Monthly Report — Juni 2026*');
    expect(report0).toContain('11 Juni 2026');
  });

  it('offset=1 falls back to current month when no previous month snapshot exists', () => {
    const report1 = generateMonthlyReport(snapshot, config, 1);
    // Falls back to current (June) snapshot
    expect(report1).toContain('📅 *Monthly Report — Juni 2026*');
  });

  it('offset=-1 produces same output as offset=1', () => {
    const reportNeg = generateMonthlyReport(snapshot, config, -1);
    const reportPos = generateMonthlyReport(snapshot, config, 1);
    expect(reportNeg).toBe(reportPos);
  });

  it('offset=2 also falls back to current month', () => {
    const report2 = generateMonthlyReport(snapshot, config, 2);
    // Falls back to current (June) snapshot
    expect(report2).toContain('📅 *Monthly Report — Juni 2026*');
  });
});

// ============================================================
// Section 8b: Calendar-Month Offset Calculation (Step 1b fix)
// ============================================================

describe('Calendar-month offset calculation', () => {
  let dataComponentsSpy: jest.SpyInstance;

  afterEach(() => {
    if (dataComponentsSpy) {
      dataComponentsSpy.mockRestore();
      dataComponentsSpy = undefined as unknown as jest.SpyInstance;
    }
    // Reset loadMonthSnapshots back to global default (return [])
    // DO NOT call mockRestore() — that would remove the global mock.
    loadMonthSnapshotsSpy.mockReturnValue([]);
  });

  it('offset=-1 on July 1 calculates target as June', () => {
    // Mock: current date is July 1
    dataComponentsSpy = jest.spyOn(
      require('../../src/utils/timezone'), 'getDataDateComponents'
    ).mockReturnValue({ year: 2026, month: 7, day: 1 });
    // Override global mock: return our snapshot for June
    loadMonthSnapshotsSpy.mockImplementation((...args: unknown[]) => {
      const year = args[0] as number;
      const month = args[1] as number;
      if (year === 2026 && month === 6) return [snapshot];
      return [];
    });

    const report = generateMonthlyReport(snapshot, config, -1);
    // offset=-1 with curMonth=7 → targetMonth=6 → mock returns our snapshot
    expect(report).toContain('📅 *Monthly Report — Juni 2026*');
    expect(report).toContain('11 Juni 2026');
  });

  it('offset=-1 on January 1 calculates target as December previous year', () => {
    // Mock: current date is January 1, 2027
    dataComponentsSpy = jest.spyOn(
      require('../../src/utils/timezone'), 'getDataDateComponents'
    ).mockReturnValue({ year: 2027, month: 1, day: 1 });
    // Global loadMonthSnapshots already returns [], so Dec 2026 is empty.
    // Falls back to current (June 2026)
    const report = generateMonthlyReport(snapshot, config, -1);
    expect(report).toContain('📅 *Monthly Report — Juni 2026*');
  });

  it('offset=0 still uses current snapshot regardless of calendar date', () => {
    dataComponentsSpy = jest.spyOn(
      require('../../src/utils/timezone'), 'getDataDateComponents'
    ).mockReturnValue({ year: 2026, month: 7, day: 1 });

    const report = generateMonthlyReport(snapshot, config, 0);
    // offset=0 means absOffset=0, skip offset block entirely
    expect(report).toContain('📅 *Monthly Report — Juni 2026*');
  });
});

// ============================================================
// Section 9: Empty Snapshot Guard
// ============================================================

describe('Empty snapshot guard', () => {
  it('returns warning for empty members array', () => {
    const emptySnapshot: Snapshot = {
      circle: snapshot.circle,
      members: [],
      club_rank: 8,
      fans_to_next_tier: 349208495,
      fans_to_lower_tier: 21848493,
      yesterday_fans_to_next_tier: 305715171,
      yesterday_fans_to_lower_tier: 20621702,
    };
    const result = generateMonthlyReport(emptySnapshot, config, 0);
    expect(result).toBe('ℹ️ *Monthly Report*\nData bulan ini belum tersedia.');
  });

  it('empty warning has no other report content', () => {
    const emptySnapshot: Snapshot = {
      circle: snapshot.circle,
      members: [],
      club_rank: 8,
      fans_to_next_tier: 349208495,
      fans_to_lower_tier: 21848493,
      yesterday_fans_to_next_tier: 305715171,
      yesterday_fans_to_lower_tier: 20621702,
    };
    const result = generateMonthlyReport(emptySnapshot, config, 0);
    expect(result).not.toContain('Total');
    expect(result).not.toContain('Proyeksi');
  });
});

// ============================================================
// Section 10: WhatsApp Formatting Compliance
// ============================================================

describe('WhatsApp formatting compliance', () => {
  let report: string;

  beforeAll(() => {
    report = generateMonthlyReport(snapshot, config, 0);
  });

  it('has no Markdown # headers', () => {
    const lines = report.split('\n');
    for (const line of lines) {
      expect(line).not.toMatch(/^#{1,6}\s/);
    }
  });

  it('has no Markdown **bold** syntax', () => {
    expect(report).not.toMatch(/\*\*[^*]+\*\*/);
  });

  it('uses emoji for section markers', () => {
    expect(report).toContain('📅');
    expect(report).toContain('👥');
    expect(report).toContain('🎯');
    expect(report).toContain('✅');
    expect(report).toContain('❌');
  });

  it('uses Indonesian month name (Juni not June)', () => {
    expect(report).toContain('Juni');
    expect(report).not.toContain('June');
  });

  it('uses Indonesian labels', () => {
    expect(report).toContain('Proyeksi akhir bulan');
    expect(report).toContain('kontribusi');
    expect(report).toContain('kurang');
  });
});

// ============================================================
// Section 11: Stale Data Warning
// ============================================================

describe('Stale data warning in monthly report', () => {
  afterEach(() => {
    restoreDateMocks();
  });

  it('shows stale warning when snapshot is stale (day 11, today June 13)', () => {
    mockCurrentDate(2026, 6, 13);
    const report = generateMonthlyReport(snapshot, config, 0);
    expect(report).toContain('⚠️ Data klub mungkin tidak terbaru');
    expect(report).toContain('update terakhir: 11 Juni 2026');
  });

  it('does NOT show stale warning when snapshot is fresh (day 11, today June 11)', () => {
    mockCurrentDate(2026, 6, 11);
    const report = generateMonthlyReport(snapshot, config, 0);
    expect(report).not.toContain('⚠️ Data klub mungkin tidak terbaru');
  });

  it('does NOT show stale warning when snapshot is 1 day old (day 11, today June 12)', () => {
    mockCurrentDate(2026, 6, 12);
    const report = generateMonthlyReport(snapshot, config, 0);
    expect(report).not.toContain('⚠️ Data klub mungkin tidak terbaru');
  });

  it('stale warning references snapshot date, not offset date', () => {
    mockCurrentDate(2026, 6, 13);
    const report0 = generateMonthlyReport(snapshot, config, 0);
    const report1 = generateMonthlyReport(snapshot, config, 1);
    expect(report0).toContain('update terakhir: 11 Juni 2026');
    expect(report1).toContain('update terakhir: 11 Juni 2026');
  });

  it('no stale warning when snapshot is from a different month', () => {
    mockCurrentDate(2026, 6, 13);
    const maySnapshot: Snapshot = {
      ...snapshot,
      members: snapshot.members.map((m) => ({
        ...m,
        month: 5,
        daily_fans: m.daily_fans.map((v, i) => (i < 28 ? v : 0)),
      })),
    };
    const report = generateMonthlyReport(maySnapshot, config, 0);
    expect(report).not.toContain('⚠️ Data klub mungkin tidak terbaru');
  });
});

// ============================================================
// Section 12: Header Format and Metadata
// ============================================================

describe('Header format and metadata', () => {
  it('header always starts with 📅 *Monthly Report —', () => {
    const report0 = generateMonthlyReport(snapshot, config, 0);
    const report1 = generateMonthlyReport(snapshot, config, 1);
    expect(report0.split('\n')[0]).toMatch(/^📅 \*Monthly Report —/);
    expect(report1.split('\n')[0]).toMatch(/^📅 \*Monthly Report —/);
  });

  it('header shows "Juni 2026" format (month+year)', () => {
    const report = generateMonthlyReport(snapshot, config, 0);
    expect(report.split('\n')[0]).toBe('📅 *Monthly Report — Juni 2026*');
  });

  it('club name with rank in third line', () => {
    const report = generateMonthlyReport(snapshot, config, 0);
    const lines = report.split('\n');
    expect(lines[2]).toContain('Hol＿Horse');
    expect(lines[2]).toContain('A+');
    expect(lines[2]).toContain('#431');
  });

  it('data line on line 3', () => {
    const report = generateMonthlyReport(snapshot, config, 0);
    const lines = report.split('\n');
    expect(lines[3]).toBe('Periode data: 11 Juni 2026, 22:00 WIB');
  });

  it('summary line on line 6', () => {
    const report = generateMonthlyReport(snapshot, config, 0);
    const lines = report.split('\n');
    expect(lines[6]).toMatch(/^👥 \d+ kontribusi dari \d+ anggota \| Total: /);
  });

  it('formatDateWIB formats correctly', () => {
    // Header uses month+year format
    const report = generateMonthlyReport(snapshot, config, 0);
    expect(report).toContain('Juni 2026');
  });
});

// ============================================================
// Section 13: Complete Member Verification (All 30 Contributors)
// ============================================================

describe('All 30 monthly contributors verified against raw data', () => {
  let report: string;
  let memberLines: string[];

  beforeAll(() => {
    report = generateMonthlyReport(snapshot, config, 0);
    memberLines = report.split('\n').filter((l) => /^\d+\.\s/.test(l));
  });

  it('has exactly 30 ranked member lines', () => {
    expect(memberLines.length).toBe(30);
  });

  it('every ranked member gain matches manual getMonthlyGain calculation', () => {
    const expectedGains = buildExpectedGains();
    expect(expectedGains.length).toBe(30);

    for (let i = 0; i < expectedGains.length; i++) {
      const gainStr = formatNumber(expectedGains[i].gain);
      const badge = expectedGains[i].isTransfer ? ' 🔄' : '';
      expect(memberLines[i]).toBe(
        `${i + 1}. *${expectedGains[i].name}*${badge} — +${gainStr}`
      );
    }
  });

  it('total monthly gain matches sum of all contributor gains', () => {
    let expectedTotal = 0;
    for (const member of snapshot.members) {
      expectedTotal += getMonthlyGain(member.daily_fans);
    }
    const totalLine = report.split('\n')[6];
    const match = totalLine.match(/Total: ([\d.]+)([KMB])/);
    expect(match).not.toBeNull();

    let reportedTotal: number;
    const num = parseFloat(match![1]);
    if (match![2] === 'K') reportedTotal = num * 1_000;
    else if (match![2] === 'M') reportedTotal = num * 1_000_000;
    else if (match![2] === 'B') reportedTotal = num * 1_000_000_000;
    else reportedTotal = num;

    // Allow rounding tolerance
    expect(Math.abs(reportedTotal - expectedTotal)).toBeLessThan(100_000);
  });
});

// ============================================================
// Section 14: No Report Exceeds WhatsApp Message Limit
// ============================================================

describe('Report size within WhatsApp limits', () => {
  it('monthly report (offset=0) does not exceed 4096 chars', () => {
    const report = generateMonthlyReport(snapshot, config, 0);
    expect(report.length).toBeLessThanOrEqual(4096);
  });

  it('monthly report (offset=1) does not exceed 4096 chars', () => {
    const report = generateMonthlyReport(snapshot, config, 1);
    expect(report.length).toBeLessThanOrEqual(4096);
  });

  it('monthly report with 10M requirement does not exceed 4096 chars', () => {
    const cfg = makeConfig({ monthlyFans: 10_000_000 });
    const report = generateMonthlyReport(snapshot, cfg, 0);
    expect(report.length).toBeLessThanOrEqual(4096);
  });
});

// ============================================================
// Section 15: Special Characters in Names
// ============================================================

describe('Special characters in trainer names', () => {
  it('Dyy\u201D with right double quotation mark renders correctly', () => {
    const report = generateMonthlyReport(snapshot, config, 0);
    // The name uses U+201D (right double quotation mark), not ASCII "
    expect(report).toContain('Dyy\u201D');
  });

  it('Hol＿Horse with full-width underscore renders correctly', () => {
    const report = generateMonthlyReport(snapshot, config, 0);
    expect(report).toContain('Hol＿Horse');
  });

  it('Suzuka Kopling with space renders correctly', () => {
    const report = generateMonthlyReport(snapshot, config, 0);
    expect(report).toContain('Suzuka Kopling');
  });

  it('DOA IBU with space renders correctly in snapshot data', () => {
    const m = snapshot.members.find((mm) => mm.trainer_name === 'DOA IBU');
    expect(m).toBeDefined();
    expect(m!.trainer_name).toBe('DOA IBU');
  });
});

// ============================================================
// Section 16: Line-by-Line Verification
// ============================================================

describe('Line-by-line verification of monthly report', () => {
  let report: string;
  let lines: string[];

  beforeAll(() => {
    report = generateMonthlyReport(snapshot, config, 0);
    lines = report.split('\n');
  });

  it('line 0: header (bold with emoji)', () => {
    expect(lines[0]).toBe('📅 *Monthly Report — Juni 2026*');
  });

  it('line 1: empty', () => {
    expect(lines[1]).toBe('');
  });

  it('line 2: club info with rank', () => {
    expect(lines[2]).toBe('Hol＿Horse | A+ (#431)');
  });

  it('line 3: data line', () => {
    expect(lines[3]).toBe('Periode data: 11 Juni 2026, 22:00 WIB');
  });

  it('line 4: Promosi | Degradasi (combined)', () => {
    expect(lines[4]).toMatch(/^Promosi: [\d.]+[KMB] fans lagi \| Degradasi: buffer [\d.]+[KMB]$/);
  });

  it('line 5: empty (before summary)', () => {
    expect(lines[5]).toBe('');
  });

  it('line 6: summary with contributor count and total', () => {
    expect(lines[6]).toBe('👥 30 kontribusi dari 30 anggota | Total: 347.0M');
  });

  it('line 7: projected month-end', () => {
    expect(lines[7]).toMatch(/^Proyeksi akhir bulan: ~/);
  });

  it('line 8: empty (before member rankings)', () => {
    expect(lines[8]).toBe('');
  });

  it('lines 9-38: 30 contributor lines', () => {
    for (let i = 9; i <= 38; i++) {
      expect(lines[i]).toMatch(/^\d+\.\s\*[^*]+\*/);
    }
  });

  it('line 39: empty (before requirement section)', () => {
    expect(lines[39]).toBe('');
  });

  it('line 40: requirement header (bold)', () => {
    expect(lines[40]).toBe('*🎯 Requirement: 20.0M/bulan*');
  });

  it('line 41: pass/fail counts', () => {
    expect(lines[41]).toBe('✅ 1 pass | ❌ 29 kurang');
  });

  it('lines 42-70: 29 failing member lines (❌ format with bold name)', () => {
    for (let i = 42; i <= 70; i++) {
      expect(lines[i]).toMatch(/^❌ \*[^*]+\*( 🔄)? — kurang /);
    }
  });

  it('last line is NOT empty (no trailing newline)', () => {
    expect(lines[lines.length - 1]).not.toBe('');
  });

  it('no line contains Markdown syntax', () => {
    for (const line of lines) {
      expect(line).not.toMatch(/^#{1,6}\s/);
      expect(line).not.toMatch(/\*\*[^*]+\*\*/);
    }
  });
});

// ============================================================
// Section 17: Top 5 Members — Detailed Verification
// ============================================================

describe('Top 5 members verified against raw snapshot data', () => {
  it('1. GoldFamily — 27.7M', () => {
    const m = snapshot.members.find((mm) => mm.trainer_name === 'GoldFamily')!;
    const gain = m.daily_fans[10] - m.daily_fans[0]; // day 11 - day 1
    expect(gain).toBe(27709705);
    expect(formatNumber(gain)).toBe('27.7M');
  });

  it('2. RngF — 19.2M', () => {
    const m = snapshot.members.find((mm) => mm.trainer_name === 'RngF')!;
    const gain = m.daily_fans[10] - m.daily_fans[0];
    expect(gain).toBe(19244182);
    expect(formatNumber(gain)).toBe('19.2M');
  });

  it('3. Aditya — 18.6M', () => {
    const m = snapshot.members.find((mm) => mm.trainer_name === 'Aditya')!;
    const gain = m.daily_fans[10] - m.daily_fans[0];
    expect(gain).toBe(18554473);
    expect(formatNumber(gain)).toBe('18.6M');
  });

  it('4. DzFx — 18.2M', () => {
    const m = snapshot.members.find((mm) => mm.trainer_name === 'DzFx')!;
    const gain = m.daily_fans[10] - m.daily_fans[0];
    expect(gain).toBe(18163942);
    expect(formatNumber(gain)).toBe('18.2M');
  });

  it('5. Sairen 🔄 — 17.9M', () => {
    const m = snapshot.members.find((mm) => mm.trainer_name === 'Sairen')!;
    const gain = m.daily_fans[10] - m.daily_fans[5]; // first positive = day 6
    expect(gain).toBe(17882090);
    expect(formatNumber(gain)).toBe('17.9M');
  });
});

// ============================================================
// Section 18: getMonthlyGain Edge Cases
// ============================================================

describe('getMonthlyGain edge cases', () => {
  it('returns 0 for all-zero daily_fans', () => {
    const zeros = new Array(32).fill(0);
    expect(getMonthlyGain(zeros)).toBe(0);
  });

  it('returns 0 for single positive data point', () => {
    const fans = [1000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    expect(getMonthlyGain(fans)).toBe(0);
  });

  it('returns 0 when first and latest values are identical', () => {
    const fans = [500, 500, 500, 500, 500, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    expect(getMonthlyGain(fans)).toBe(0);
  });

  it('returns correct gain when values increase', () => {
    const fans = [100, 200, 300, 400, 500, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    expect(getMonthlyGain(fans)).toBe(400); // 500 - 100
  });

  it('handles transfer member with negative prefix', () => {
    const fans = [-500, -400, 0, 1000, 1500, 2000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    // firstPositiveDay = 4 (1000), latestPositiveDay = 6 (2000)
    expect(getMonthlyGain(fans)).toBe(1000); // 2000 - 1000
  });

  it('returns 0 for empty array', () => {
    expect(getMonthlyGain([])).toBe(0);
  });

  it('handles member joining mid-month', () => {
    // No data for first 15 days, then data from day 16 onwards
    const fans = [
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      1000, 1100, 1200, 1300, 1400, 1500, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    ];
    // firstPositiveDay = 16 (1000), latestPositiveDay = 21 (1500)
    expect(getMonthlyGain(fans)).toBe(500); // 1500 - 1000
  });
});

// ============================================================
// Section 19: Total Gain Summation
// ============================================================

describe('Total gain summation', () => {
  it('total gain = sum of all member monthlyGain values (including zero-gain members)', () => {
    let total = 0;
    for (const member of snapshot.members) {
      total += getMonthlyGain(member.daily_fans);
    }
    // Total should be a large number (sum of all 34 members)
    expect(total).toBeGreaterThan(0);

    const report = generateMonthlyReport(snapshot, config, 0);
    const totalLine = report.split('\n')[6];
    const match = totalLine.match(/Total: ([\d.]+)([KMB])/);
    expect(match).not.toBeNull();

    let reportedTotal: number;
    const num = parseFloat(match![1]);
    if (match![2] === 'K') reportedTotal = num * 1_000;
    else if (match![2] === 'M') reportedTotal = num * 1_000_000;
    else if (match![2] === 'B') reportedTotal = num * 1_000_000_000;
    else reportedTotal = num;

    // Allow rounding tolerance
    expect(Math.abs(reportedTotal - total)).toBeLessThan(100_000);
  });
});
