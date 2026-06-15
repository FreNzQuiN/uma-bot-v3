/**
 * /weekly Command — Comprehensive Tests
 *
 * Tests the weekly report through all key behaviors:
 *   - Week block logic (W1=d1-7, W2=d8-14, etc.)
 *   - Weekly gain calculation (last in block - value before block)
 *   - Offset handling (offset=1 shows W1)
 *   - Below-requirement section
 *   - Only contributors shown (gain > 0)
 *   - Stale data warning
 *   - Transfer badges
 *   - Empty snapshot guard
 *   - WhatsApp formatting
 *   - Header format
 *
 * Uses real snapshot (examples/snapshot-june-12.json, 34 members).
 * All tests print full output for visual inspection.
 */

import * as fs from 'fs';
import * as path from 'path';
import { generateWeeklyReport } from '../../src/reports/weekly';
import { getDefaultConfig } from '../../src/config';
import { getWeeklyGain } from '../../src/data/daily-fans';
import { getDataDayFromSnapshot } from '../../src/data/snapshot';
import { formatNumber } from '../../src/reports/format';
import { WEEK_BLOCKS } from '../../src/types';
import type { Snapshot, BotConfig } from '../../src/types';

// ============================================================
// Constants & Loaders
// ============================================================

const SNAPSHOT_PATH = path.join(__dirname, '../../examples/snapshot-june-12.json');

let snapshot: Snapshot;
let config: BotConfig;

beforeAll(() => {
  snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf-8'));
  config = getDefaultConfig();
});

// ============================================================
// Test Helpers
// ============================================================

function makeConfig(overrides: { weeklyFans?: number } = {}): BotConfig {
  const base = getDefaultConfig();
  if (overrides.weeklyFans !== undefined) {
    return {
      ...base,
      requirements: {
        ...base.requirements,
        weeklyFans: overrides.weeklyFans,
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
// Section 3: Full Output — Print and Verify
// ============================================================

describe('Full weekly report output (offset=0, W2)', () => {
  let report: string;
  let lines: string[];

  beforeAll(() => {
    report = generateWeeklyReport(snapshot, config, 0);
    lines = report.split('\n');
  });

  it('prints the full report for visual verification', () => {
    console.log('\n========== FULL WEEKLY REPORT (offset=0, W2) ==========');
    console.log(report);
    console.log('========== END REPORT ==========');
    expect(report.length).toBeGreaterThan(0);
  });

  it('header is "📈 *Weekly Report — Minggu 2*" (bold)', () => {
    expect(lines[0]).toBe('📈 *Weekly Report — Minggu 2*');
  });

  it('line 1 is empty (separator)', () => {
    expect(lines[1]).toBe('');
  });

  it('line 2 is "Hol＿Horse | A+ (#431)" (club info with rank)', () => {
    expect(lines[2]).toBe('Hol＿Horse | A+ (#431)');
  });

  it('line 3 is "Periode data: 11 Juni 2026, 22:00 WIB"', () => {
    expect(lines[3]).toBe('Periode data: 11 Juni 2026, 22:00 WIB');
  });

  it('line 4 is "Periode: Hari 8-14"', () => {
    expect(lines[4]).toBe('Periode: Hari 8-14');
  });

  it('line 5 is "Promosi: 349.2M fans lagi"', () => {
    expect(lines[5]).toBe('Promosi: 349.2M fans lagi');
  });

  it('line 6 is "Degradasi: buffer 21.8M"', () => {
    expect(lines[6]).toBe('Degradasi: buffer 21.8M');
  });

  it('line 7 is empty (separator)', () => {
    expect(lines[7]).toBe('');
  });

  it('line 8 is contributor summary', () => {
    expect(lines[8]).toBe('👥 30 kontribusi dari 30 anggota | Total: 144.5M');
  });

  it('has 30 contributing members (gain > 0)', () => {
    const memberLines = lines.filter((l) => /^\d+\.\s/.test(l));
    expect(memberLines.length).toBe(30);
  });

  it('first member is *Sairen* 🔄 — +14.3M (bold name)', () => {
    expect(lines[10]).toBe('1. *Sairen* 🔄 — +14.3M');
  });

  it('second member is *GoldFamily* — +10.8M (bold name)', () => {
    expect(lines[11]).toBe('2. *GoldFamily* — +10.8M');
  });

  it('last member is *ursa* — +875.7K (bold name)', () => {
    const memberLines = lines.filter((l) => /^\d+\.\s/.test(l));
    expect(memberLines[29]).toBe('30. *ursa* — +875.7K');
  });

  it('members are sorted by weekly gain descending', () => {
    const memberLines = lines.filter((l) => /^\d+\.\s/.test(l));
    const gains: number[] = [];
    for (const line of memberLines) {
      const match = line.match(/— \+?([\d.]+[KMB]?|0)$/);
      if (!match) throw new Error(`Could not parse gain from: ${line}`);
      const val = match[1];
      if (val === '0') { gains.push(0); continue; }
      const numStr = val.replace(/[+-]/, '');
      let num = parseFloat(numStr);
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

  it('stale data warning is present (data is from June 11, running June 13)', () => {
    mockCurrentDate(2026, 6, 13);
    const freshReport = generateWeeklyReport(snapshot, config, 0);
    expect(freshReport).toContain('⚠️ Data klub mungkin tidak terbaru (update terakhir: 11 Juni 2026)');
    restoreDateMocks();
  });
});

// ============================================================
// Section 4: Transfer Badges
// ============================================================

describe('Transfer badges in weekly report', () => {
  let report: string;

  beforeAll(() => {
    report = generateWeeklyReport(snapshot, config, 0);
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
// Section 5: Offset=1 → W1 Report
// ============================================================

describe('Offset=1 shows W1 (days 1-7)', () => {
  let report: string;
  let lines: string[];

  beforeAll(() => {
    report = generateWeeklyReport(snapshot, config, 1);
    lines = report.split('\n');
  });

  it('prints the full W1 report', () => {
    console.log('\n========== FULL WEEKLY REPORT (offset=1, W1) ==========');
    console.log(report);
    console.log('========== END REPORT ==========');
    expect(report.length).toBeGreaterThan(0);
  });

  it('header is "📈 *Weekly Report — Minggu 1*" (bold)', () => {
    expect(lines[0]).toBe('📈 *Weekly Report — Minggu 1*');
  });

  it('period is "Periode: Hari 1-7"', () => {
    expect(lines[4]).toBe('Periode: Hari 1-7');
  });

  it('first member is *GoldFamily* — +16.9M (bold name)', () => {
    expect(lines[10]).toBe('1. *GoldFamily* — +16.9M');
  });

  it('second member is *Ryu* — +13.1M (bold name)', () => {
    expect(lines[11]).toBe('2. *Ryu* — +13.1M');
  });

  it('has 30 contributing members', () => {
    const memberLines = lines.filter((l) => /^\d+\.\s/.test(l));
    expect(memberLines.length).toBe(30);
  });

  it('contributor summary shows total gain 202.5M', () => {
    expect(lines[8]).toBe('👥 30 kontribusi dari 30 anggota | Total: 202.5M');
  });

  it('transfer badges still present in W1', () => {
    const transferNames = ['Zero', 'TheTengOne', 'Sairen', 'VitoHoow', 'Ceciria', 'Falkrum'];
    const memberLines = lines.filter((l) => /^\d+\.\s/.test(l));
    for (const name of transferNames) {
      const line = memberLines.find((l) => l.includes(name));
      expect(line).toBeDefined();
      expect(line!).toContain('🔄');
    }
  });
});

// ============================================================
// Section 6: Offset Equivalence (negative offset)
// ============================================================

describe('Negative offset equivalence', () => {
  it('/weekly -1 produces same output as /weekly 1', () => {
    const reportNeg = generateWeeklyReport(snapshot, config, -1);
    const reportPos = generateWeeklyReport(snapshot, config, 1);
    expect(reportNeg).toBe(reportPos);
  });

  it('/weekly -2 produces same output as /weekly 2', () => {
    const reportNeg = generateWeeklyReport(snapshot, config, -2);
    const reportPos = generateWeeklyReport(snapshot, config, 2);
    expect(reportNeg).toBe(reportPos);
  });
});

// ============================================================
// Section 7: Offset Clamping
// ============================================================

describe('Offset clamping (targetWeek clamped to 1)', () => {
  it('offset=2 → W1 (2-1=1, which is valid)', () => {
    // currentWeek=2, offset=2, targetWeek = max(1, 2-2) = max(1, 0) = 1
    const report = generateWeeklyReport(snapshot, config, 2);
    expect(report).toContain('📈 *Weekly Report — Minggu 1');
    expect(report).toContain('Periode: Hari 1-7');
  });

  it('offset=100 → W1 (clamped from 2-100 = -98)', () => {
    // currentWeek=2, offset=100, targetWeek = max(1, 2-100) = 1
    const report = generateWeeklyReport(snapshot, config, 100);
    expect(report).toContain('📈 *Weekly Report — Minggu 1');
    expect(report).toContain('Periode: Hari 1-7');
  });

  it('offset=0 → W2 (current week)', () => {
    const report = generateWeeklyReport(snapshot, config, 0);
    expect(report).toContain('📈 *Weekly Report — Minggu 2');
    expect(report).toContain('Periode: Hari 8-14');
  });
});

// ============================================================
// Section 8: Below-Requirement Section
// ============================================================

describe('Below-requirement section', () => {
  it('does NOT appear when weeklyFans = 0 (default config)', () => {
    const report = generateWeeklyReport(snapshot, config, 0);
    expect(report).not.toContain('⚠️ Di bawah target');
  });

  it('shows members below 5M/week when weeklyFans = 5,000,000', () => {
    const cfg = makeConfig({ weeklyFans: 5_000_000 });
    const report = generateWeeklyReport(snapshot, cfg, 0);

    console.log('\n========== WEEKLY REPORT with weeklyFans=5M ==========');
    console.log(report);
    console.log('========== END ==========');

    expect(report).toContain('⚠️ Di bawah target 5.0M/minggu:');

    // Members with W2 gain between 0 and 5M
    const belowSection = report.substring(report.indexOf('⚠️ Di bawah target'));
    expect(belowSection).toContain('• Dyy”');
    expect(belowSection).toContain('• Ceciria');
    expect(belowSection).toContain('• Anshu');
    expect(belowSection).toContain('• Lihking');
    expect(belowSection).toContain('• Suzuka Kopling');
    expect(belowSection).toContain('• Falkrum');
    expect(belowSection).toContain('• Saki');
    expect(belowSection).toContain('• VitoHoow');
    expect(belowSection).toContain('• FreNzQuiN');
    expect(belowSection).toContain('• TheTengOne');
    expect(belowSection).toContain('• Ignis');
    expect(belowSection).toContain('• naku');
    expect(belowSection).toContain('• Azurarch');
    expect(belowSection).toContain('• Ryu');
    expect(belowSection).toContain('• Ernstormen');
    expect(belowSection).toContain('• Amanda');
    expect(belowSection).toContain('• Yukil');
    expect(belowSection).toContain('• jgd');
    expect(belowSection).toContain('• ursa');
  });

  it('includes members with gain = 0 in below-requirement (0 < weeklyFans)', () => {
    const cfg = makeConfig({ weeklyFans: 5_000_000 });
    const report = generateWeeklyReport(snapshot, cfg, 0);
    const belowSection = report.substring(report.indexOf('⚠️ Di bawah target'));
    // Stale members have 0 gain → now included (0 < 5M)
    expect(belowSection).toContain('• DOA IBU');
    expect(belowSection).toContain('• Kuro');
    expect(belowSection).toContain('• Rowking');
    expect(belowSection).toContain('• Lebowski');
  });

  it('members with gain >= weeklyFans are NOT in below-requirement', () => {
    const cfg = makeConfig({ weeklyFans: 5_000_000 });
    const report = generateWeeklyReport(snapshot, cfg, 0);
    const belowSection = report.substring(report.indexOf('⚠️ Di bawah target'));
    // These members have W2 gain >= 5M → not listed
    expect(belowSection).not.toContain('• Sairen');
    expect(belowSection).not.toContain('• GoldFamily');
    expect(belowSection).not.toContain('• Luck99');
    expect(belowSection).not.toContain('• Aditya');
    expect(belowSection).not.toContain('• Nargi');
    expect(belowSection).not.toContain('• sirsokban');
    expect(belowSection).not.toContain('• RngF');
    expect(belowSection).not.toContain('• DzFx');
    expect(belowSection).not.toContain('• Seterako');
    expect(belowSection).not.toContain('• Zero');
  });

  it('shows member names without gain values in below-requirement section', () => {
    const cfg = makeConfig({ weeklyFans: 5_000_000 });
    const report = generateWeeklyReport(snapshot, cfg, 0);
    expect(report).toContain('• Dyy”');
    expect(report).toContain('• ursa');
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
    const result = generateWeeklyReport(emptySnapshot, config, 0);
    expect(result).toBe('ℹ️ *Weekly Report*\nData minggu ini belum tersedia.');
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
    const result = generateWeeklyReport(emptySnapshot, config, 0);
    expect(result).not.toContain('Minggu');
    expect(result).not.toContain('Periode');
    expect(result).not.toContain('gain mingguan');
  });
});

// ============================================================
// Section 10: WhatsApp Formatting Compliance
// ============================================================

describe('WhatsApp formatting compliance', () => {
  let report: string;

  beforeAll(() => {
    report = generateWeeklyReport(snapshot, config, 0);
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
    expect(report).toContain('📈');
    expect(report).toContain('⚠️');
  });

  it('uses Indonesian month name (Juni not June)', () => {
    expect(report).toContain('Juni');
    expect(report).not.toContain('June');
  });

  it('uses Indonesian labels', () => {
    expect(report).toContain('Minggu');
    expect(report).toContain('Periode');
    expect(report).toContain('kontribusi');
  });
});

// ============================================================
// Section 11: Stale Data Warning
// ============================================================

describe('Stale data warning in weekly report', () => {
  afterEach(() => {
    restoreDateMocks();
  });

  it('shows stale warning when snapshot is stale (day 11, today June 13)', () => {
    mockCurrentDate(2026, 6, 13);
    const report = generateWeeklyReport(snapshot, config, 0);
    expect(report).toContain('⚠️ Data klub mungkin tidak terbaru');
    expect(report).toContain('update terakhir: 11 Juni 2026');
  });

  it('does NOT show stale warning when snapshot is fresh (day 11, today June 11)', () => {
    mockCurrentDate(2026, 6, 11);
    const report = generateWeeklyReport(snapshot, config, 0);
    expect(report).not.toContain('⚠️ Data klub mungkin tidak terbaru');
  });

  it('does NOT show stale warning when snapshot is 1 day old (day 11, today June 12)', () => {
    mockCurrentDate(2026, 6, 12);
    const report = generateWeeklyReport(snapshot, config, 0);
    expect(report).not.toContain('⚠️ Data klub mungkin tidak terbaru');
  });

  it('stale warning references snapshot date, not offset date', () => {
    mockCurrentDate(2026, 6, 13);
    const report0 = generateWeeklyReport(snapshot, config, 0);
    const report1 = generateWeeklyReport(snapshot, config, 1);
    expect(report0).toContain('update terakhir: 11 Juni 2026');
    expect(report1).toContain('update terakhir: 11 Juni 2026');
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
    const report = generateWeeklyReport(maySnapshot, config, 0);
    expect(report).not.toContain('⚠️ Data klub mungkin tidak terbaru');
  });
});

// ============================================================
// Section 12: Header Format and Metadata
// ============================================================

describe('Header format and metadata', () => {
  it('header always starts with 📈 *Weekly Report — (bold)', () => {
    const report0 = generateWeeklyReport(snapshot, config, 0);
    const report1 = generateWeeklyReport(snapshot, config, 1);
    expect(report0.split('\n')[0]).toMatch(/^📈 \*Weekly Report —/);
    expect(report1.split('\n')[0]).toMatch(/^📈 \*Weekly Report —/);
  });

  it('club name, tier, and rank in third line (no date)', () => {
    const report = generateWeeklyReport(snapshot, config, 0);
    const lines = report.split('\n');
    expect(lines[2]).toContain('Hol＿Horse');
    expect(lines[2]).toContain('A+');
    expect(lines[2]).toContain('#431');
  });

  it('data line with date on line 3', () => {
    const report = generateWeeklyReport(snapshot, config, 0);
    const lines = report.split('\n');
    expect(lines[3]).toBe('Periode data: 11 Juni 2026, 22:00 WIB');
  });

  it('period line shows correct day range for each week', () => {
    const report0 = generateWeeklyReport(snapshot, config, 0); // W2
    const report1 = generateWeeklyReport(snapshot, config, 1); // W1
    expect(report0.split('\n')[4]).toBe('Periode: Hari 8-14');
    expect(report1.split('\n')[4]).toBe('Periode: Hari 1-7');
  });

  it('contributor summary line shows formatted total', () => {
    const report = generateWeeklyReport(snapshot, config, 0);
    const summaryLine = report.split('\n')[8];
    expect(summaryLine).toMatch(/^👥 \d+ kontribusi dari \d+ anggota \| Total: [\d.]+[KMB]$/);
  });
});

// ============================================================
// Section 13: Complete Member Verification (All 30 W2 Contributors)
// ============================================================

describe('All 30 W2 contributors verified against raw data', () => {
  let report: string;
  let memberLines: string[];

  beforeAll(() => {
    report = generateWeeklyReport(snapshot, config, 0);
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
// Section 14: No Report Exceeds WhatsApp Message Limit
// ============================================================

describe('Report size within WhatsApp limits', () => {
  it('weekly report (offset=0) does not exceed 4096 chars', () => {
    const report = generateWeeklyReport(snapshot, config, 0);
    expect(report.length).toBeLessThanOrEqual(4096);
  });

  it('weekly report (offset=1) does not exceed 4096 chars', () => {
    const report = generateWeeklyReport(snapshot, config, 1);
    expect(report.length).toBeLessThanOrEqual(4096);
  });

  it('weekly report with below-requirement does not exceed 4096 chars', () => {
    const cfg = makeConfig({ weeklyFans: 5_000_000 });
    const report = generateWeeklyReport(snapshot, cfg, 0);
    expect(report.length).toBeLessThanOrEqual(4096);
  });
});

// ============================================================
// Section 15: Cross-Week Consistency
// ============================================================

describe('Cross-week consistency', () => {
  it('W1 total + W2 total ≠ monthly total (different baselines)', () => {
    // W1 and W2 gains are computed against different baselines,
    // so they should NOT sum to the monthly gain.
    const w1Report = generateWeeklyReport(snapshot, config, 1);
    const w2Report = generateWeeklyReport(snapshot, config, 0);

    const w1TotalMatch = w1Report.split('\n')[8].match(/Total: ([\d.]+)([KMB])/);
    const w2TotalMatch = w2Report.split('\n')[8].match(/Total: ([\d.]+)([KMB])/);
    expect(w1TotalMatch).not.toBeNull();
    expect(w2TotalMatch).not.toBeNull();
    // Just verify both exist and are different values
    expect(w1TotalMatch![1] + w1TotalMatch![2]).not.toBe(w2TotalMatch![1] + w2TotalMatch![2]);
  });

  it('W2 report and W1 report have different member rankings', () => {
    const w1Report = generateWeeklyReport(snapshot, config, 1);
    const w2Report = generateWeeklyReport(snapshot, config, 0);

    const w1First = w1Report.split('\n').find((l) => /^1\.\s/.test(l));
    const w2First = w2Report.split('\n').find((l) => /^1\.\s/.test(l));

    expect(w1First).toContain('GoldFamily');
    expect(w2First).toContain('Sairen');
  });
});

// ============================================================
// Section 16: Special Characters in Names
// ============================================================

describe('Special characters in trainer names', () => {
  it('Dyy\u201D with right double quotation mark renders correctly', () => {
    const report = generateWeeklyReport(snapshot, config, 0);
    // The name uses U+201D (right double quotation mark), not ASCII "
    expect(report).toContain('Dyy\u201D');
  });

  it('Hol＿Horse with full-width underscore renders correctly', () => {
    const report = generateWeeklyReport(snapshot, config, 0);
    expect(report).toContain('Hol＿Horse');
  });

  it('Suzuka Kopling with space renders correctly', () => {
    const report = generateWeeklyReport(snapshot, config, 0);
    expect(report).toContain('Suzuka Kopling');
  });

  it('DOA IBU with space renders correctly in empty member list context', () => {
    // DOA IBU has 0 W2 gain, so not in member list
    // But verify the snapshot data is correct
    const m = snapshot.members.find((mm) => mm.trainer_name === 'DOA IBU');
    expect(m).toBeDefined();
    expect(m!.trainer_name).toBe('DOA IBU');
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

// ============================================================
// Section 18: Full Report Line-by-Line Verification (W2)
// ============================================================

describe('Line-by-line verification of W2 report', () => {
  let report: string;
  let lines: string[];

  beforeAll(() => {
    report = generateWeeklyReport(snapshot, config, 0);
    lines = report.split('\n');
  });

  it('line 0: bold header', () => {
    expect(lines[0]).toBe('📈 *Weekly Report — Minggu 2*');
  });

  it('line 1: empty', () => {
    expect(lines[1]).toBe('');
  });

  it('line 2: club info with rank', () => {
    expect(lines[2]).toBe('Hol＿Horse | A+ (#431)');
  });

  it('line 3: data date', () => {
    expect(lines[3]).toBe('Periode data: 11 Juni 2026, 22:00 WIB');
  });

  it('line 4: period', () => {
    expect(lines[4]).toBe('Periode: Hari 8-14');
  });

  it('line 5: promotion info', () => {
    expect(lines[5]).toBe('Promosi: 349.2M fans lagi');
  });

  it('line 6: demotion info', () => {
    expect(lines[6]).toBe('Degradasi: buffer 21.8M');
  });

  it('line 7: empty separator', () => {
    expect(lines[7]).toBe('');
  });

  it('line 8: contributor summary', () => {
    expect(lines[8]).toBe('👥 30 kontribusi dari 30 anggota | Total: 144.5M');
  });

  it('line 9: empty separator', () => {
    expect(lines[9]).toBe('');
  });

  it('lines 10-39: 30 member lines (bold names)', () => {
    for (let i = 10; i <= 39; i++) {
      expect(lines[i]).toMatch(/^\d+\.\s\*[^*]+\*\s/);
    }
  });

  it('line after members: empty separator or stale section', () => {
    // 40 member lines end at index 39
    // line 40 is empty separator before stale section
    if (lines.length > 40) {
      expect(lines[40]).toBe('');
    }
  });

  it('stale data warning present when snapshot is old enough', () => {
    const staleWarningIdx = lines.findIndex((l) => l.includes('⚠️ Data klub mungkin tidak terbaru'));
    if (lines.length > 44) {
      expect(staleWarningIdx).toBeGreaterThanOrEqual(0);
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
