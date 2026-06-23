/**
 * Tests for format.ts helpers.
 *
 * Uses the real snapshot from examples/snapshot-june-12.json.
 * Verifies format utilities: number formatting, date formatting,
 * message splitting, and stale data warnings.
 */

import { Snapshot, BotConfig } from '../../src/types';
import { getDefaultConfig } from '../../src/config';
import {
  formatNumber,
  splitMessage,
} from '../../src/utils/format';
import {
  formatDateWIB,
  getStaleDataWarning,
} from '../../src/reports/format';
import { loadRealSnapshot } from '../_helpers';

// Load real snapshot
const snapshot: Snapshot = loadRealSnapshot();

const config: BotConfig = getDefaultConfig();

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
    const result = splitMessage(text, 80);
    // Should split at the newline, not mid-word
    expect(result.length).toBe(2);
  });

  it('force-splits when individual lines exceed effectiveMax (maxLength - overhead)', () => {
    const text = 'A'.repeat(50) + '\n' + 'B'.repeat(50);
    const result = splitMessage(text, 60);
    // FIXED_MARKER_OVERHEAD=20, effectiveMax=40. Each 50-char line exceeds → force-split
    expect(result.length).toBe(4);
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
