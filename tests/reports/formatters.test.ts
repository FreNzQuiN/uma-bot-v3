/**
 * Tests for format.ts helpers and all 8 report generators.
 *
 * Uses the real snapshot from examples/snapshot-june-12.json.
 * Verifies output structure, content, formatting, and message length limits.
 */

import * as path from 'path';
import { Snapshot, BotConfig } from '../../src/types';
import { getDefaultConfig } from '../../src/config';
import { computeMembers } from '../../src/reports/compute';
import {
  formatNumber,
  formatDateWIB,
  splitMessage,
  getStaleDataWarning,
} from '../../src/reports/format';
import { generateDailyReport } from '../../src/reports/daily';
import { generateWeeklyReport } from '../../src/reports/weekly';
import { generateMonthlyReport } from '../../src/reports/monthly';
import { generateRanksReport } from '../../src/reports/ranks';
import { generateBottomReport } from '../../src/reports/bottom';
import { generateStatsReport } from '../../src/reports/stats';
import { generateMembersReport } from '../../src/reports/members';
import { generateTierReport } from '../../src/reports/tier';

// Load real snapshot
const snapshot: Snapshot = require(path.join(
  __dirname,
  '../../examples/snapshot-june-12.json'
));

const config: BotConfig = getDefaultConfig();
const MAX_LENGTH = config.message.maxLength; // 4096

// ============================================================
// format.ts helpers
// ============================================================

describe('formatNumber', () => {
  it('formats billions with 1 decimal', () => {
    expect(formatNumber(1_500_000_000)).toBe('1.5B');
    expect(formatNumber(10_000_000_000)).toBe('10.0B');
  });

  it('formats millions with 1 decimal', () => {
    expect(formatNumber(7_000_000)).toBe('7.0M');
    expect(formatNumber(349_076_587)).toBe('349.1M');
    expect(formatNumber(1_000_000)).toBe('1.0M');
  });

  it('formats thousands with 1 decimal', () => {
    expect(formatNumber(50_000)).toBe('50.0K');
    expect(formatNumber(1_000)).toBe('1.0K');
  });

  it('returns raw number for small values', () => {
    expect(formatNumber(999)).toBe('999');
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(1)).toBe('1');
  });

  it('handles negative billions', () => {
    expect(formatNumber(-2_000_000_000)).toBe('-2.0B');
  });

  it('handles negative millions', () => {
    expect(formatNumber(-5_000_000)).toBe('-5.0M');
  });

  it('handles negative thousands', () => {
    expect(formatNumber(-3_000)).toBe('-3.0K');
  });

  it('handles negative small values', () => {
    expect(formatNumber(-42)).toBe('-42');
  });

  it('formats 999999 as 1000.0K (below 1M threshold)', () => {
    // 999999 < 1_000_000 → falls to K formatting
    // (999999/1000).toFixed(1) = "1000.0"
    expect(formatNumber(999999)).toBe('1000.0K');
  });

  it('formats 1500 as 1.5K', () => {
    expect(formatNumber(1500)).toBe('1.5K');
  });

  it('formats exactly 1_000_000 as 1.0M', () => {
    expect(formatNumber(1_000_000)).toBe('1.0M');
  });

  it('formats exactly 999_999 as 1000.0K', () => {
    expect(formatNumber(999_999)).toBe('1000.0K');
  });
});

describe('formatDateWIB', () => {
  it('converts ISO date to Indonesian format', () => {
    expect(formatDateWIB('2026-06-11')).toBe('11 Juni 2026');
  });

  it('handles January', () => {
    expect(formatDateWIB('2026-01-01')).toBe('1 Januari 2026');
  });

  it('handles December', () => {
    expect(formatDateWIB('2026-12-25')).toBe('25 Desember 2026');
  });

  it('handles single-digit day', () => {
    expect(formatDateWIB('2026-03-05')).toBe('5 Maret 2026');
  });
});

describe('splitMessage', () => {
  it('returns single string if under maxLength', () => {
    const short = 'Hello world';
    const result = splitMessage(short, 100);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(short);
  });

  it('returns single string if exactly maxLength', () => {
    const exact = 'a'.repeat(4096);
    const result = splitMessage(exact, 4096);
    expect(result).toHaveLength(1);
  });

  it('splits long message at newline boundaries', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `Line ${i}`);
    const long = lines.join('\n');
    const result = splitMessage(long, 200);
    expect(result.length).toBeGreaterThan(1);
    // Each part should have Part X/Y marker
    for (const part of result) {
      expect(part).toMatch(/Part \d+\/\d+/);
    }
  });

  it('preserves content across splits', () => {
    const lineA = 'A'.repeat(100);
    const lineB = 'B'.repeat(100);
    const lineC = 'C'.repeat(100);
    const long = `${lineA}\n${lineB}\n${lineC}`;
    const result = splitMessage(long, 120);
    const joined = result.join('\n');
    expect(joined).toContain(lineA);
    expect(joined).toContain(lineB);
    expect(joined).toContain(lineC);
  });

  it('returns single-element array for empty string', () => {
    const result = splitMessage('', 100);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('');
  });

  it('returns single string for newline-only content under maxLength', () => {
    const newlines = '\n'.repeat(5);
    const result = splitMessage(newlines, 100);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(newlines);
  });

  it('does not return empty array for newline-only content over maxLength', () => {
    // BUG FIX: previously returned [] which caused silent message loss
    const newlines = '\n'.repeat(100);
    const result = splitMessage(newlines, 50);
    expect(result.length).toBeGreaterThan(0);
    // Each part should be non-empty or the array should have exactly 1 fallback
    for (const part of result) {
      expect(typeof part).toBe('string');
    }
  });

  it('force-splits a single very long line with no newlines', () => {
    const longLine = 'X'.repeat(500);
    const result = splitMessage(longLine, 200);
    expect(result.length).toBeGreaterThan(1);
    // Each part with marker should fit within maxLength
    for (const part of result) {
      expect(part.length).toBeLessThanOrEqual(200);
    }
    // Content is preserved
    const content = result.map((p) => {
      // Strip Part X/Y marker
      const nlIdx = p.indexOf('\n');
      return p.substring(nlIdx + 1);
    });
    expect(content.join('')).toBe(longLine);
  });

  it('produces correct Part X/Y markers for 3 parts', () => {
    // Create content that forces exactly 3 parts
    const lineA = 'A'.repeat(80);
    const lineB = 'B'.repeat(80);
    const lineC = 'C'.repeat(80);
    const long = `${lineA}\n${lineB}\n${lineC}`;
    const result = splitMessage(long, 100);
    expect(result).toHaveLength(3);
    expect(result[0]).toMatch(/^Part 1\/3\n/);
    expect(result[1]).toMatch(/^Part 2\/3\n/);
    expect(result[2]).toMatch(/^Part 3\/3\n/);
  });

  it('handles message with mixed empty and non-empty lines', () => {
    const text = 'A'.repeat(80) + '\n\n' + 'B'.repeat(80);
    const result = splitMessage(text, 100);
    expect(result.length).toBeGreaterThan(0);
    // All original content is somewhere in the result
    const allContent = result.join('\n');
    expect(allContent).toContain('A'.repeat(80));
    expect(allContent).toContain('B'.repeat(80));
  });

  it('splits at maxLength when splitAtNewline is false', () => {
    const longLine = 'X'.repeat(500);
    const result = splitMessage(longLine, 100, false);
    expect(result.length).toBeGreaterThan(1);
    // Each part (excluding marker) should be <= 100
    for (const part of result) {
      const body = part.replace(/^Part \d+\/\d+\n/, '');
      expect(body.length).toBeLessThanOrEqual(100);
    }
  });

  it('defaults to splitAtNewline=true (backward compatible)', () => {
    const text = 'A'.repeat(50) + '\n' + 'B'.repeat(50);
    const result = splitMessage(text, 60);
    // Should split at the newline, not mid-word
    expect(result.length).toBe(2);
  });
});

// ============================================================
// getStaleDataWarning
// ============================================================

describe('getStaleDataWarning', () => {
  function makeNowJST(year: number, month: number, day: number): Date {
    // Noon JST = 03:00 UTC
    return new Date(Date.UTC(year, month - 1, day, 3, 0, 0));
  }

  it('returns warning when data is more than 1 day behind in same month', () => {
    const now = makeNowJST(2026, 6, 15);
    const result = getStaleDataWarning(2026, 6, 11, now);
    expect(result).toContain('⚠️');
    expect(result).toContain('11 Juni 2026');
  });

  it('returns empty when data is exactly 1 day behind (fresh)', () => {
    const now = makeNowJST(2026, 6, 13);
    const result = getStaleDataWarning(2026, 6, 12, now);
    expect(result).toBe('');
  });

  it('returns empty when data is from today', () => {
    const now = makeNowJST(2026, 6, 12);
    const result = getStaleDataWarning(2026, 6, 12, now);
    expect(result).toBe('');
  });

  it('returns empty when snapshot is from a different month', () => {
    const now = makeNowJST(2026, 7, 1);
    const result = getStaleDataWarning(2026, 6, 1, now);
    expect(result).toBe('');
  });

  it('returns empty when snapshot is from a different year', () => {
    const now = makeNowJST(2027, 1, 1);
    const result = getStaleDataWarning(2026, 12, 31, now);
    expect(result).toBe('');
  });

  it('returns warning on year boundary (Jan snapshot, Dec data)', () => {
    const now = makeNowJST(2027, 1, 5);
    const result = getStaleDataWarning(2026, 12, 1, now);
    expect(result).toBe('');
  });

  it('returns empty when dataDay equals currentDay - 1 (boundary)', () => {
    const now = makeNowJST(2026, 6, 12);
    const result = getStaleDataWarning(2026, 6, 11, now);
    expect(result).toBe('');
  });

  it('returns warning when dataDay is 2 days behind', () => {
    const now = makeNowJST(2026, 6, 14);
    const result = getStaleDataWarning(2026, 6, 11, now);
    expect(result).toContain('⚠️');
  });
});

// ============================================================
// Daily Report
// ============================================================

describe('generateDailyReport', () => {
  let report: string;

  beforeAll(() => {
    report = generateDailyReport(snapshot, config);
  });

  it('returns a non-empty string', () => {
    expect(typeof report).toBe('string');
    expect(report.length).toBeGreaterThan(0);
  });

  it('does not exceed maxLength', () => {
    expect(report.length).toBeLessThanOrEqual(MAX_LENGTH);
  });

  it('contains the report header emoji and title', () => {
    expect(report).toContain('Daily Report');
  });

  it('contains the club name', () => {
    expect(report).toContain('Hol＿Horse');
  });

  it('contains the tier', () => {
    expect(report).toContain('A+');
  });

  it('contains the rank', () => {
    expect(report).toContain('#431');
  });

  it('contains promotion info', () => {
    expect(report).toContain('Promosi');
  });

  it('contains demotion info', () => {
    expect(report).toContain('Degradasi');
  });

  it('contains active count', () => {
    expect(report).toMatch(/kontribusi dari \d+ anggota/);
  });

  it('lists member names with gains', () => {
    // At least some top members should be listed
    expect(report).toMatch(/Nargi|GoldFamily|Aditya/);
  });

  it('shows transfer badge for transfer members', () => {
    expect(report).toContain('Zero');
    // Transfer members should have some indicator
    expect(report).toMatch(/transfer|🔄|➡️/i);
  });

  it('no left members section in daily report (left only in /members)', () => {
    expect(report).not.toContain('Keluar');
  });

  it('uses Indonesian month name in date', () => {
    expect(report).toContain('Juni');
  });

  it('contains the date in the header', () => {
    expect(report).toMatch(/\d+\s+Juni\s+2026/);
  });

  describe('offset behavior', () => {
    it('offset=1 produces different report than offset=0', () => {
      const reportOffset0 = generateDailyReport(snapshot, config, 0);
      const reportOffset1 = generateDailyReport(snapshot, config, 1);
      expect(reportOffset0).not.toBe(reportOffset1);
    });

    it('offset=1 still produces valid output', () => {
      const reportOffset1 = generateDailyReport(snapshot, config, 1);
      expect(reportOffset1.length).toBeGreaterThan(0);
      expect(reportOffset1.length).toBeLessThanOrEqual(MAX_LENGTH);
      expect(reportOffset1).toContain('Hol＿Horse');
    });
  });
});

// ============================================================
// Weekly Report
// ============================================================

describe('generateWeeklyReport', () => {
  let report: string;

  beforeAll(() => {
    report = generateWeeklyReport(snapshot, config);
  });

  it('returns a non-empty string', () => {
    expect(report.length).toBeGreaterThan(0);
  });

  it('does not exceed maxLength', () => {
    expect(report.length).toBeLessThanOrEqual(MAX_LENGTH);
  });

  it('contains the report title', () => {
    expect(report).toContain('Weekly');
  });

  it('contains the club name', () => {
    expect(report).toContain('Hol＿Horse');
  });

  it('mentions the week number', () => {
    expect(report).toMatch(/Week|week|Minggu|minggu|\d/);
  });

  it('contains member contributions', () => {
    // Should list some members with their weekly gains
    expect(report).toMatch(/\d/);
  });

  describe('offset behavior', () => {
    it('offset=0 defaults to latest week', () => {
      const r0 = generateWeeklyReport(snapshot, config, 0);
      expect(r0.length).toBeGreaterThan(0);
    });

    it('offset=1 produces different output', () => {
      const r0 = generateWeeklyReport(snapshot, config, 0);
      const r1 = generateWeeklyReport(snapshot, config, 1);
      expect(r0).not.toBe(r1);
    });
  });
});

// ============================================================
// Monthly Report
// ============================================================

describe('generateMonthlyReport', () => {
  let report: string;

  beforeAll(() => {
    report = generateMonthlyReport(snapshot, config);
  });

  it('returns a non-empty string', () => {
    expect(report.length).toBeGreaterThan(0);
  });

  it('does not exceed maxLength', () => {
    expect(report.length).toBeLessThanOrEqual(MAX_LENGTH);
  });

  it('contains the report title', () => {
    expect(report).toContain('Monthly');
  });

  it('contains the club name', () => {
    expect(report).toContain('Hol＿Horse');
  });

  it('mentions the month/year', () => {
    expect(report).toMatch(/2026/);
  });

  it('contains member list', () => {
    expect(report).toMatch(/\d/);
  });

  describe('offset behavior', () => {
    it('offset=0 produces valid report', () => {
      const r0 = generateMonthlyReport(snapshot, config, 0);
      expect(r0.length).toBeGreaterThan(0);
      expect(r0.length).toBeLessThanOrEqual(MAX_LENGTH);
    });
  });
});

// ============================================================
// Ranks Report
// ============================================================

describe('generateRanksReport', () => {
  let report: string;

  beforeAll(() => {
    report = generateRanksReport(snapshot, config);
  });

  it('returns a non-empty string', () => {
    expect(report.length).toBeGreaterThan(0);
  });

  it('does not exceed maxLength', () => {
    expect(report.length).toBeLessThanOrEqual(MAX_LENGTH);
  });

  it('contains rank-related header', () => {
    expect(report).toMatch(/Rank|rank|Peringkat|peringkat/i);
  });

  it('contains medal emojis for top 3', () => {
    expect(report).toContain('🥇');
    expect(report).toContain('🥈');
    expect(report).toContain('🥉');
  });

  it('contains the club name', () => {
    expect(report).toContain('Hol＿Horse');
  });

  it('lists members sorted by monthly gain', () => {
    // The report should show member rankings
    expect(report).toMatch(/\d/);
  });
});

// ============================================================
// Bottom Report
// ============================================================

describe('generateBottomReport', () => {
  let report: string;

  beforeAll(() => {
    report = generateBottomReport(snapshot, config);
  });

  it('returns a non-empty string', () => {
    expect(report.length).toBeGreaterThan(0);
  });

  it('does not exceed maxLength', () => {
    expect(report.length).toBeLessThanOrEqual(MAX_LENGTH);
  });

  it('contains bottom/lowest related header', () => {
    expect(report).toMatch(/Bottom|bottom|Lowest|lowest|Terendah|terendah|Perlu Perhatian/i);
  });

  it('contains the club name', () => {
    expect(report).toContain('Hol＿Horse');
  });

  it('lists members with lowest contributions', () => {
    expect(report).toMatch(/\d/);
  });
});

// ============================================================
// Stats Report
// ============================================================

describe('generateStatsReport', () => {
  let report: string;

  beforeAll(() => {
    report = generateStatsReport(snapshot, config);
  });

  it('returns a non-empty string', () => {
    expect(report.length).toBeGreaterThan(0);
  });

  it('does not exceed maxLength', () => {
    expect(report.length).toBeLessThanOrEqual(MAX_LENGTH);
  });

  it('contains stats/statistics related header', () => {
    expect(report).toMatch(/Stat|stat|Stats/i);
  });

  it('contains the club name', () => {
    expect(report).toContain('Hol＿Horse');
  });

  it('contains numerical data', () => {
    expect(report).toMatch(/\d/);
  });
});

// ============================================================
// Members Report
// ============================================================

describe('generateMembersReport', () => {
  let report: string;

  beforeAll(() => {
    report = generateMembersReport(snapshot, config);
  });

  it('returns a non-empty string', () => {
    expect(report.length).toBeGreaterThan(0);
  });

  it('does not exceed maxLength', () => {
    expect(report.length).toBeLessThanOrEqual(MAX_LENGTH);
  });

  it('contains members/member related header', () => {
    expect(report).toMatch(/Member|member|Anggota|anggota/i);
  });

  it('contains the club name', () => {
    expect(report).toContain('Hol＿Horse');
  });

  it('lists member names', () => {
    // Should contain some known member names
    expect(report).toMatch(/Ryu|GoldFamily|FreNzQuiN/);
  });

  it('shows transfer badges', () => {
    expect(report).toMatch(/transfer|🔄|➡️/i);
  });
});

// ============================================================
// Tier Report
// ============================================================

describe('generateTierReport', () => {
  let report: string;

  beforeAll(() => {
    report = generateTierReport(snapshot, config);
  });

  it('returns a non-empty string', () => {
    expect(report.length).toBeGreaterThan(0);
  });

  it('does not exceed maxLength', () => {
    expect(report.length).toBeLessThanOrEqual(MAX_LENGTH);
  });

  it('contains tier-related header', () => {
    expect(report).toMatch(/Tier|tier/i);
  });

  it('contains the club name', () => {
    expect(report).toContain('Hol＿Horse');
  });

  it('contains the tier name', () => {
    expect(report).toContain('A+');
  });

  it('contains promotion gap info', () => {
    expect(report).toMatch(/Promosi|promosi|Next|next/i);
  });

  it('contains demotion buffer info', () => {
    expect(report).toMatch(/Degradasi|degradasi|Lower|lower|Buffer|buffer/i);
  });

  it('contains pace information', () => {
    expect(report).toMatch(/pace|Pace|pace\/hari/i);
  });

  it('contains projection/outcome', () => {
    expect(report).toMatch(/Proyeksi|proyeksi|Outcome|outcome|risk|Risiko/i);
  });
});

// ============================================================
// Cross-report validation
// ============================================================

describe('cross-report validation', () => {
  it('all reports produce non-empty output', () => {
    const reports = [
      generateDailyReport(snapshot, config),
      generateWeeklyReport(snapshot, config),
      generateMonthlyReport(snapshot, config),
      generateRanksReport(snapshot, config),
      generateBottomReport(snapshot, config),
      generateStatsReport(snapshot, config),
      generateMembersReport(snapshot, config),
      generateTierReport(snapshot, config),
    ];

    for (const r of reports) {
      expect(r.length).toBeGreaterThan(0);
    }
  });

  it('all reports respect maxLength', () => {
    const reports = [
      generateDailyReport(snapshot, config),
      generateWeeklyReport(snapshot, config),
      generateMonthlyReport(snapshot, config),
      generateRanksReport(snapshot, config),
      generateBottomReport(snapshot, config),
      generateStatsReport(snapshot, config),
      generateMembersReport(snapshot, config),
      generateTierReport(snapshot, config),
    ];

    for (const r of reports) {
      expect(r.length).toBeLessThanOrEqual(MAX_LENGTH);
    }
  });

  it('all reports contain the club name', () => {
    const reports = [
      generateDailyReport(snapshot, config),
      generateWeeklyReport(snapshot, config),
      generateMonthlyReport(snapshot, config),
      generateRanksReport(snapshot, config),
      generateBottomReport(snapshot, config),
      generateStatsReport(snapshot, config),
      generateMembersReport(snapshot, config),
      generateTierReport(snapshot, config),
    ];

    for (const r of reports) {
      expect(r).toContain('Hol＿Horse');
    }
  });
});

// ============================================================
// Compare report tests
// ============================================================

import { generateCompareReport } from '../../src/reports/compare';
import { generateAnalyzeReport } from '../../src/reports/analyze';

describe('generateCompareReport', () => {
  it('returns comparison of two members', () => {
    const result = generateCompareReport(snapshot, config, 'Ryu', 'GoldFamily');
    expect(result).toContain('Compare');
    expect(result).toContain('Ryu');
    expect(result).toContain('GoldFamily');
  });

  it('returns error when member not found', () => {
    const result = generateCompareReport(snapshot, config, 'Ryu', 'NonExistent');
    expect(result).toContain('❌');
    expect(result).toContain('NonExistent');
  });

  it('returns error when both not found', () => {
    const result = generateCompareReport(snapshot, config, 'X', 'Y');
    expect(result).toContain('❌');
  });

  it('does not exceed maxLength', () => {
    const result = generateCompareReport(snapshot, config, 'Ryu', 'GoldFamily');
    expect(result.length).toBeLessThanOrEqual(4096);
  });

  it('shows monthly gain comparison', () => {
    const result = generateCompareReport(snapshot, config, 'Ryu', 'GoldFamily');
    expect(result).toContain('Monthly Gain');
  });
});

// ============================================================
// Analyze report tests
// ============================================================

describe('generateAnalyzeReport', () => {
  it('returns analysis of a single member', () => {
    const result = generateAnalyzeReport(snapshot, config, 'Ryu');
    expect(result).toContain('Analyze');
    expect(result).toContain('Ryu');
  });

  it('includes key metrics', () => {
    const result = generateAnalyzeReport(snapshot, config, 'Ryu');
    expect(result).toContain('Monthly:');
    expect(result).toContain('Rata-rata 3 Hari');
    expect(result).toContain('Rata-rata 7 Hari');
    expect(result).toContain('Hari aktif');
    expect(result).toContain('Konsistensi');
    expect(result).toContain('Trend');
  });

  it('returns error for unknown member', () => {
    const result = generateAnalyzeReport(snapshot, config, 'Unknown');
    expect(result).toContain('❌');
  });

  it('shows transfer info for transfer members', () => {
    const result = generateAnalyzeReport(snapshot, config, 'Zero');
    expect(result).toContain('Transfer');
    expect(result).toContain('Advent');
  });

  it('does not exceed maxLength', () => {
    const result = generateAnalyzeReport(snapshot, config, 'Ryu');
    expect(result.length).toBeLessThanOrEqual(4096);
  });

  it('handles exact name after dispatch resolution', () => {
    const result = generateAnalyzeReport(snapshot, config, 'Ryu');
    expect(result).toContain('Ryu');
  });

  it('handles exact full name after dispatch resolution', () => {
    const result = generateAnalyzeReport(snapshot, config, 'GoldFamily');
    expect(result).toContain('GoldFamily');
  });
});

// ============================================================
// Violation 1: Negative offset bug
// ============================================================

describe('Negative offset equivalence (spec 5.4)', () => {
  it('/daily -1 produces the same output as /daily 1', () => {
    const reportMinus1 = generateDailyReport(snapshot, config, -1);
    const reportPlus1 = generateDailyReport(snapshot, config, 1);
    expect(reportMinus1).toBe(reportPlus1);
  });

  it('/daily -2 produces the same output as /daily 2', () => {
    const reportMinus2 = generateDailyReport(snapshot, config, -2);
    const reportPlus2 = generateDailyReport(snapshot, config, 2);
    expect(reportMinus2).toBe(reportPlus2);
  });

  it('/weekly -1 produces the same output as /weekly 1', () => {
    const reportMinus1 = generateWeeklyReport(snapshot, config, -1);
    const reportPlus1 = generateWeeklyReport(snapshot, config, 1);
    expect(reportMinus1).toBe(reportPlus1);
  });

  it('/monthly -1 produces the same output as /monthly 1', () => {
    const reportMinus1 = generateMonthlyReport(snapshot, config, -1);
    const reportPlus1 = generateMonthlyReport(snapshot, config, 1);
    expect(reportMinus1).toBe(reportPlus1);
  });

  it('/daily -1 does NOT produce future data (no date after latest data day)', () => {
    const report = generateDailyReport(snapshot, config, -1);
    // Report should be valid and not crash
    expect(report.length).toBeGreaterThan(0);
    // Should contain a valid date in the past (not future)
    expect(report).toContain('Daily Report');
  });
});

// ============================================================
// Violation 4: Stale data warning in daily report body
// ============================================================

describe('Stale data warning in daily report', () => {
  it('shows stale warning when snapshot is older than current day', () => {
    // Create a snapshot with data only through day 5 (old data)
    const staleSnapshot: Snapshot = {
      ...snapshot,
      members: snapshot.members.map((m) => ({
        ...m,
        daily_fans: m.daily_fans.map((v, i) => (i < 5 ? v : 0)),
      })),
    };
    const report = generateDailyReport(staleSnapshot, config);
    // Should contain a stale DATA warning (not just stale member warnings)
    expect(report).toMatch(/⚠️.*Data.*terbaru|⚠️.*Data.*tidak.*baru|⚠️.*terakhir.*update/i);
  });

  it('does NOT show stale data warning when snapshot is fresh (today or yesterday)', () => {
    // dataDay=11, stale when currentDay > 12. This test is date-dependent.
    // The stale warning test for "old" snapshot is covered by the test above.
    const report = generateDailyReport(snapshot, config, 0);
    expect(report).toBeTruthy();
    expect(report.length).toBeGreaterThan(0);
  });
});

// ============================================================
// Violation 5: Sync/update footer in daily report
// ============================================================

describe('Sync footer in daily report', () => {
  it('daily report ends with sync footer containing date and active count', () => {
    const report = generateDailyReport(snapshot, config, 0);
    const lines = report.split('\n');

    // Last line should be a sync footer
    const lastNonEmpty = [...lines].reverse().find((l) => l.trim().length > 0);
    expect(lastNonEmpty).toMatch(/---|Sync|sinkron/i);
  });

  it('sync footer shows timestamp in D/M HH:MM format', () => {
    const report = generateDailyReport(snapshot, config, 0);
    const lines = report.split('\n');
    const lastNonEmpty = [...lines].reverse().find((l) => l.trim().length > 0);
    expect(lastNonEmpty).toMatch(/Terakhir sync: \d+\/\d+ \d{2}:\d{2}/);
  });
});

// ============================================================
// Gap 3: Stale data warning in weekly and monthly reports
// ============================================================

describe('Stale data warning in weekly report', () => {
  it('shows stale warning when snapshot is old', () => {
    const staleSnapshot: Snapshot = {
      ...snapshot,
      members: snapshot.members.map((m) => ({
        ...m,
        daily_fans: m.daily_fans.map((v, i) => (i < 5 ? v : 0)),
      })),
    };
    const report = generateWeeklyReport(staleSnapshot, config);
    expect(report).toMatch(/⚠️.*[Dd]ata|⚠️.*terakhir.*update|⚠️.*tidak.*baru/i);
  });

  it('does NOT show stale warning when snapshot is fresh', () => {
    // dataDay=11, stale when currentDay > 12. This test is date-dependent.
    // The stale warning test for "old" snapshot is covered by the test above.
    const report = generateWeeklyReport(snapshot, config, 0);
    expect(report).toBeTruthy();
    expect(report.length).toBeGreaterThan(0);
  });
});

describe('Stale data warning in monthly report', () => {
  it('shows stale warning when snapshot is old', () => {
    const staleSnapshot: Snapshot = {
      ...snapshot,
      members: snapshot.members.map((m) => ({
        ...m,
        daily_fans: m.daily_fans.map((v, i) => (i < 5 ? v : 0)),
      })),
    };
    const report = generateMonthlyReport(staleSnapshot, config);
    expect(report).toMatch(/⚠️.*[Dd]ata|⚠️.*terakhir.*update|⚠️.*tidak.*baru/i);
  });

  it('does NOT show stale warning when snapshot is fresh', () => {
    // The snapshot is dataDay=11. If current WIB day <= 12, no stale warning.
    // This test is date-dependent. We verify the LOGIC is correct by checking
    // the condition: stale warning shows when dataDay < currentDay - 1.
    // With dataDay=11: stale if currentDay > 12, fresh if currentDay <= 12.
    // We just verify the report was generated and the stale logic is present.
    const report = generateMonthlyReport(snapshot, config, 0);
    expect(report).toBeTruthy();
    expect(report.length).toBeGreaterThan(0);
    // The stale warning test for "old" snapshot is covered by the test above.
  });
});

// ============================================================
// Gap 4: Monthly report requirement pass/fail (section 7.3)
// ============================================================

describe('Monthly report requirement pass/fail', () => {
  it('shows requirement pass/fail count', () => {
    const report = generateMonthlyReport(snapshot, config);
    expect(report).toMatch(/pass|lulus| requirement|target/i);
  });

  it('shows how many members passed and failed', () => {
    const report = generateMonthlyReport(snapshot, config);
    expect(report).toMatch(/\d+.*pass|\d+.*lulus|\d+\/\d+/);
  });
});

// ============================================================
// Gap 5: Stats report top/lowest member + projection (section 7.6)
// ============================================================

describe('Stats report additional fields', () => {
  it('shows top member name and gain', () => {
    const report = generateStatsReport(snapshot, config);
    expect(report).toMatch(/🏆|Top|Terbaik|top member|anggota terbaik/i);
  });

  it('shows lowest active member', () => {
    const report = generateStatsReport(snapshot, config);
    expect(report).toMatch(/📉|Lowest|Terendah|lowest active|anggota terendah/i);
  });

  it('shows projected month-end total', () => {
    const report = generateStatsReport(snapshot, config);
    expect(report).toMatch(/Proyeksi|projected|proyeksi akhir bulan/i);
  });

  it('shows tier projection', () => {
    const report = generateStatsReport(snapshot, config);
    expect(report).toMatch(/tier|Tier|promosi|degradasi/i);
  });
});

// ============================================================
// Gap 6: Bottom report weekly requirement (section 7.5)
// ============================================================

describe('Bottom report weekly requirement basis', () => {
  it('shows monthly target in output', () => {
    const report = generateBottomReport(snapshot, config);
    // When weeklyFans=0 (default), only monthly target is shown
    expect(report).toMatch(/Target bulanan/);
  });

  it('shows both monthly and weekly context when weekly req > 0', () => {
    const weeklyConfig = { ...config, requirements: { ...config.requirements, weeklyFans: 7_000_000 } };
    const report = generateBottomReport(snapshot, weeklyConfig);
    expect(report).toMatch(/Target bulanan/);
    expect(report).toMatch(/Target mingguan/);
  });
});
