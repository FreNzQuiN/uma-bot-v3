/**
 * Monthly Report — Data Logic Tests
 *
 * Tests gain calculation, snapshot verification, member verification,
 * line-by-line structure, top 5 members, edge cases, and total summation.
 * Uses real snapshot (examples/snapshot-june-12.json, 34 members).
 */

import { generateMonthlyReport } from '../../../src/reports/monthly';
import { computeMembers } from '../../../src/reports/compute';
import { getDefaultConfig } from '../../../src/config';
import { getMonthlyGain } from '../../../src/data/daily-fans';
import { getDataDayFromSnapshot } from '../../../src/data/snapshot';
import { formatNumber } from '../../../src/utils/format';
import type { Snapshot, BotConfig } from '../../../src/types';
import {
  loadRealSnapshot,
  TRANSFER_NAMES,
  STALE_NAMES,
} from '../../_helpers';


let snapshot: Snapshot;
let config: BotConfig;
let computedMembers: ReturnType<typeof computeMembers>;
let loadMonthSnapshotsSpy: jest.SpyInstance;

beforeAll(() => {
  snapshot = loadRealSnapshot();
  config = getDefaultConfig();
  computedMembers = computeMembers(snapshot, config);
  loadMonthSnapshotsSpy = jest.spyOn(
    require('../../../src/data/snapshot'), 'loadMonthSnapshots'
  ).mockReturnValue([]);
});

afterAll(() => {
  loadMonthSnapshotsSpy.mockRestore();
});


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


describe('All 30 monthly contributors verified against raw data', () => {
  let report: string;
  let memberLines: string[];

  beforeAll(() => {
    report = generateMonthlyReport(snapshot, config, computedMembers, 0);
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


describe('Line-by-line verification of monthly report', () => {
  let report: string;
  let lines: string[];

  beforeAll(() => {
    report = generateMonthlyReport(snapshot, config, computedMembers, 0);
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


describe('Total gain summation', () => {
  it('total gain = sum of all member monthlyGain values (including zero-gain members)', () => {
    let total = 0;
    for (const member of snapshot.members) {
      total += getMonthlyGain(member.daily_fans);
    }
    // Total should be a large number (sum of all 34 members)
    expect(total).toBeGreaterThan(0);

    const report = generateMonthlyReport(snapshot, config, computedMembers, 0);
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
