/**
 * Weekly Report — Data Logic Tests
 *
 * Tests gain calculation, snapshot verification, member verification, and edge cases.
 * Uses real snapshot (examples/snapshot-june-12.json, 34 members).
 */

import { generateWeeklyReport } from '../../../src/reports/weekly';
import { computeMembers } from '../../../src/reports/compute';
import { getDefaultConfig } from '../../../src/config';
import { getWeeklyGain } from '../../../src/data/daily-fans';
import { getDataDayFromSnapshot } from '../../../src/data/snapshot';
import { formatNumber } from '../../../src/reports/format';
import { WEEK_BLOCKS } from '../../../src/types';
import type { Snapshot, BotConfig } from '../../../src/types';
import {
  loadRealSnapshot,
  TRANSFER_NAMES,
} from '../../_helpers';

// ============================================================
// Constants & Loaders
// ============================================================

let snapshot: Snapshot;
let config: BotConfig;
let computedMembers: ReturnType<typeof computeMembers>;

beforeAll(() => {
  snapshot = loadRealSnapshot();
  config = getDefaultConfig();
  computedMembers = computeMembers(snapshot, config);
});

// ============================================================
// Test Helpers
// ============================================================

/**
 * Manually compute weekly gain for a member in a given week block.
 * Mirrors the logic in src/data/daily-fans.ts getWeeklyGain().
 */
function manualWeeklyGain(dailyFans: number[], weekNumber: number): number {
  const block = WEEK_BLOCKS.find((b) => b.week === weekNumber)!;

  // Find last positive before block
  let valueBeforeBlock: number | null = null;
  for (let day = 1; day < block.start; day++) {
    const idx = day - 1;
    if (idx < dailyFans.length && dailyFans[idx] > 0) {
      valueBeforeBlock = dailyFans[idx];
    }
  }

  // Find last positive in block
  let lastPositiveInBlock: number | null = null;
  let firstPositiveInBlock: number | null = null;
  for (let day = block.start; day <= block.end; day++) {
    const idx = day - 1;
    if (idx < dailyFans.length && dailyFans[idx] > 0) {
      if (firstPositiveInBlock === null) firstPositiveInBlock = dailyFans[idx];
      lastPositiveInBlock = dailyFans[idx];
    }
  }

  if (lastPositiveInBlock === null) return 0;

  const baseline = valueBeforeBlock ?? firstPositiveInBlock;
  if (baseline === null || baseline === lastPositiveInBlock) return 0;

  return lastPositiveInBlock - baseline;
}

// ============================================================
// Section 1: Snapshot Data Verification
// ============================================================

describe('Snapshot data for weekly tests', () => {
  it('has correct latest data day = 11', () => {
    expect(getDataDayFromSnapshot(snapshot)).toBe(11);
  });

  it('has 34 members', () => {
    expect(snapshot.members.length).toBe(34);
  });

  it('day 11 falls in W2 (days 8-14)', () => {
    const day = getDataDayFromSnapshot(snapshot);
    const block = WEEK_BLOCKS.find((b) => day >= b.start && day <= b.end);
    expect(block).toBeDefined();
    expect(block!.week).toBe(2);
  });

  it('WEEK_BLOCKS has 5 blocks', () => {
    expect(WEEK_BLOCKS.length).toBe(5);
    expect(WEEK_BLOCKS[0]).toEqual({ week: 1, start: 1, end: 7 });
    expect(WEEK_BLOCKS[1]).toEqual({ week: 2, start: 8, end: 14 });
    expect(WEEK_BLOCKS[2]).toEqual({ week: 3, start: 15, end: 21 });
    expect(WEEK_BLOCKS[3]).toEqual({ week: 4, start: 22, end: 28 });
    expect(WEEK_BLOCKS[4]).toEqual({ week: 5, start: 29, end: 31 });
  });
});

// ============================================================
// Section 2: Weekly Gain Calculation (Manual Verification)
// ============================================================

describe('Weekly gain calculation — manual verification from raw data', () => {
  describe('W2 gains (offset=0)', () => {
    it('Ryu: day7=329,925,021, day11=332,207,534 → gain=2,282,513 → +2.3M', () => {
      const ryu = snapshot.members.find((m) => m.trainer_name === 'Ryu')!;
      expect(ryu.daily_fans[6]).toBe(329925021); // day 7
      expect(ryu.daily_fans[10]).toBe(332207534); // day 11
      const gain = getWeeklyGain(ryu.daily_fans, 2);
      expect(gain).toBe(2282513);
      expect(formatNumber(gain)).toBe('2.3M');
    });

    it('GoldFamily: day7=306,908,237, day11=317,726,222 → gain=10,817,985 → +10.8M', () => {
      const m = snapshot.members.find((mm) => mm.trainer_name === 'GoldFamily')!;
      expect(m.daily_fans[6]).toBe(306908237);
      expect(m.daily_fans[10]).toBe(317726222);
      const gain = getWeeklyGain(m.daily_fans, 2);
      expect(gain).toBe(10817985);
      expect(formatNumber(gain)).toBe('10.8M');
    });

    it('Sairen (transfer): day7=428,536,838, day11=442,813,391 → gain=14,276,553 → +14.3M', () => {
      const s = snapshot.members.find((m) => m.trainer_name === 'Sairen')!;
      expect(s.daily_fans[6]).toBe(428536838);
      expect(s.daily_fans[10]).toBe(442813391);
      const gain = getWeeklyGain(s.daily_fans, 2);
      expect(gain).toBe(14276553);
      expect(formatNumber(gain)).toBe('14.3M');
    });

    it('Nargi: day7=366,858,425, day11=373,937,532 → gain=7,079,107 → +7.1M', () => {
      const n = snapshot.members.find((m) => m.trainer_name === 'Nargi')!;
      expect(n.daily_fans[6]).toBe(366858425);
      expect(n.daily_fans[10]).toBe(373937532);
      const gain = getWeeklyGain(n.daily_fans, 2);
      expect(gain).toBe(7079107);
      expect(formatNumber(gain)).toBe('7.1M');
    });

    it('ursa: day7=217,707,892, day11=218,583,555 → gain=875,663 → +875.7K', () => {
      const u = snapshot.members.find((m) => m.trainer_name === 'ursa')!;
      expect(u.daily_fans[6]).toBe(217707892);
      expect(u.daily_fans[10]).toBe(218583555);
      const gain = getWeeklyGain(u.daily_fans, 2);
      expect(gain).toBe(875663);
      expect(formatNumber(gain)).toBe('875.7K');
    });

    it('DzFx: day7=363,096,002, day11=369,974,968 → gain=6,878,966 → +6.9M', () => {
      const d = snapshot.members.find((m) => m.trainer_name === 'DzFx')!;
      expect(d.daily_fans[6]).toBe(363096002);
      expect(d.daily_fans[10]).toBe(369974968);
      const gain = getWeeklyGain(d.daily_fans, 2);
      expect(gain).toBe(6878966);
      expect(formatNumber(gain)).toBe('6.9M');
    });
  });

  describe('W1 gains (offset=1)', () => {
    it('Ryu: day1=316,856,492, day7=329,925,021 → gain=13,068,529 → +13.1M', () => {
      const ryu = snapshot.members.find((m) => m.trainer_name === 'Ryu')!;
      expect(ryu.daily_fans[0]).toBe(316856492); // day 1
      expect(ryu.daily_fans[6]).toBe(329925021); // day 7
      const gain = getWeeklyGain(ryu.daily_fans, 1);
      expect(gain).toBe(13068529);
      expect(formatNumber(gain)).toBe('13.1M');
    });

    it('GoldFamily: day1=290,016,517, day7=306,908,237 → gain=16,891,720 → +16.9M', () => {
      const m = snapshot.members.find((mm) => mm.trainer_name === 'GoldFamily')!;
      expect(m.daily_fans[0]).toBe(290016517);
      expect(m.daily_fans[6]).toBe(306908237);
      const gain = getWeeklyGain(m.daily_fans, 1);
      expect(gain).toBe(16891720);
      expect(formatNumber(gain)).toBe('16.9M');
    });

    it('Zero (transfer): day4=301,413,137, day7=309,426,635 → gain=8,013,498 → +8.0M', () => {
      // Zero has negative days 1-2, 0 on day 3, first positive on day 4
      // For W1, valueBeforeBlock is null (block starts at day 1)
      // baseline = firstPositiveInBlock = daily_fans[3] = 301,413,137 (day 4)
      // lastPositiveInBlock = daily_fans[6] = 309,426,635 (day 7)
      const z = snapshot.members.find((m) => m.trainer_name === 'Zero')!;
      expect(z.daily_fans[3]).toBe(301413137); // day 4
      expect(z.daily_fans[6]).toBe(309426635); // day 7
      const gain = getWeeklyGain(z.daily_fans, 1);
      expect(gain).toBe(8013498);
      expect(formatNumber(gain)).toBe('8.0M');
    });
  });

  describe('Stale members have 0 gain in W2', () => {
    it('DOA IBU: only day1 has data → W2 gain = 0', () => {
      const m = snapshot.members.find((mm) => mm.trainer_name === 'DOA IBU')!;
      expect(getWeeklyGain(m.daily_fans, 2)).toBe(0);
    });

    it('Kuro: only days 1-2 have data → W2 gain = 0', () => {
      const m = snapshot.members.find((mm) => mm.trainer_name === 'Kuro')!;
      expect(getWeeklyGain(m.daily_fans, 2)).toBe(0);
    });

    it('Rowking: only days 1-3 have data → W2 gain = 0', () => {
      const m = snapshot.members.find((mm) => mm.trainer_name === 'Rowking')!;
      expect(getWeeklyGain(m.daily_fans, 2)).toBe(0);
    });

    it('Lebowski: only day1 has data → W2 gain = 0', () => {
      const m = snapshot.members.find((mm) => mm.trainer_name === 'Lebowski')!;
      expect(getWeeklyGain(m.daily_fans, 2)).toBe(0);
    });
  });

  describe('W3-W5 returns 0 (no data yet in snapshot)', () => {
    it('Ryu W3 = 0 (no data days 15-21)', () => {
      const ryu = snapshot.members.find((m) => m.trainer_name === 'Ryu')!;
      expect(getWeeklyGain(ryu.daily_fans, 3)).toBe(0);
    });

    it('Ryu W4 = 0 (no data days 22-28)', () => {
      const ryu = snapshot.members.find((m) => m.trainer_name === 'Ryu')!;
      expect(getWeeklyGain(ryu.daily_fans, 4)).toBe(0);
    });

    it('Ryu W5 = 0 (no data days 29-31)', () => {
      const ryu = snapshot.members.find((m) => m.trainer_name === 'Ryu')!;
      expect(getWeeklyGain(ryu.daily_fans, 5)).toBe(0);
    });
  });
});

// ============================================================
// Section 13: Complete Member Verification (All 30 W2 Contributors)
// ============================================================

describe('All 30 W2 contributors verified against raw data', () => {
  let report: string;
  let memberLines: string[];

  beforeAll(() => {
    report = generateWeeklyReport(snapshot, config, computedMembers, 0);
    memberLines = report.split('\n').filter((l) => /^\d+\.\s/.test(l));
  });

  it('has exactly 30 ranked member lines', () => {
    expect(memberLines.length).toBe(30);
  });

  it('every ranked member gain matches manual getWeeklyGain calculation', () => {
    // Build expected gains from raw data
    const expectedGains: { name: string; gain: number; isTransfer: boolean }[] = [];
    for (const member of snapshot.members) {
      const gain = getWeeklyGain(member.daily_fans, 2);
      if (gain > 0) {
        expectedGains.push({
          name: member.trainer_name,
          gain,
          isTransfer: !!(member.previous_circle_id || member.previous_circle_name),
        });
      }
    }
    expectedGains.sort((a, b) => b.gain - a.gain);
    expect(expectedGains.length).toBe(30);

    for (let i = 0; i < expectedGains.length; i++) {
      const gainStr = `+${formatNumber(expectedGains[i].gain)}`;
      const badge = expectedGains[i].isTransfer ? ' 🔄' : '';
      expect(memberLines[i]).toBe(
        `${i + 1}. *${expectedGains[i].name}*${badge} — ${gainStr}`
      );
    }
  });

  it('total weekly gain matches sum of all contributor gains', () => {
    let expectedTotal = 0;
    for (const member of snapshot.members) {
      expectedTotal += getWeeklyGain(member.daily_fans, 2);
    }
    // Summary line is at index 8: "👥 30 kontribusi dari 30 anggota | Total: 144.5M"
    const summaryLine = report.split('\n')[8];
    const match = summaryLine.match(/Total: ([\d.]+)([KMB])/);
    expect(match).not.toBeNull();

    let reportedTotal: number;
    const num = parseFloat(match![1]);
    if (match![2] === 'K') reportedTotal = num * 1_000;
    else if (match![2] === 'M') reportedTotal = num * 1_000_000;
    else if (match![2] === 'B') reportedTotal = num * 1_000_000_000;
    else reportedTotal = num;

    // Allow 0.1M rounding tolerance
    expect(Math.abs(reportedTotal - expectedTotal)).toBeLessThan(100_000);
  });
});

// ============================================================
// Section 17: getWeeklyGain Edge Cases
// ============================================================

describe('getWeeklyGain edge cases', () => {
  it('returns 0 for week number not in WEEK_BLOCKS', () => {
    const ryu = snapshot.members.find((m) => m.trainer_name === 'Ryu')!;
    expect(getWeeklyGain(ryu.daily_fans, 0)).toBe(0);
    expect(getWeeklyGain(ryu.daily_fans, 99)).toBe(0);
    expect(getWeeklyGain(ryu.daily_fans, -1)).toBe(0);
  });

  it('returns 0 for all-zero daily_fans', () => {
    const zeros = new Array(32).fill(0);
    expect(getWeeklyGain(zeros, 1)).toBe(0);
    expect(getWeeklyGain(zeros, 2)).toBe(0);
  });

  it('returns 0 when only one positive value in block (same as baseline)', () => {
    // If member has day 1 = 100 and day 7 = 100 (no change in W1)
    const fans = [100, 100, 100, 100, 100, 100, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    expect(getWeeklyGain(fans, 1)).toBe(0);
  });

  it('returns gain when block values differ from baseline', () => {
    // day1 = 100, day7 = 200 → W1 gain = 100
    const fans = [100, 120, 140, 160, 180, 190, 200, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    expect(getWeeklyGain(fans, 1)).toBe(100);
  });

  it('handles member joining mid-block (first positive is inside block)', () => {
    // No data before day 8, first positive on day 10
    // W2: baseline = firstPositiveInBlock (no valueBeforeBlock)
    const fans = [0, 0, 0, 0, 0, 0, 0, 0, 0, 1000, 1500, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    // valueBeforeBlock = null (no positive days 1-7)
    // firstPositiveInBlock = 1000 (day 10)
    // lastPositiveInBlock = 1500 (day 11)
    // baseline = firstPositiveInBlock = 1000
    // gain = 1500 - 1000 = 500
    expect(getWeeklyGain(fans, 2)).toBe(500);
  });

  it('handles transfer member with negative prefix correctly', () => {
    // Zero's actual data: negative days 1-2, 0 day 3, positive days 4+
    const z = snapshot.members.find((m) => m.trainer_name === 'Zero')!;
    // W2 gain should work correctly despite negative prefix
    const gain = getWeeklyGain(z.daily_fans, 2);
    expect(gain).toBe(6107365); // 315,534,000 - 309,426,635
  });
});
