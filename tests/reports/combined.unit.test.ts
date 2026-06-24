/**
 * Tests for generateCombinedReport — the thin combiner that joins
 * multiple report types into a single message.
 */

import { Snapshot, BotConfig, ComputedMember } from '../../src/types';
import { generateCombinedReport } from '../../src/reports/combined';
import { generateDailyReport } from '../../src/reports/daily';
import { generateWeeklyReport } from '../../src/reports/weekly';
import { generateMonthlyReport } from '../../src/reports/monthly';
import { computeMembers } from '../../src/reports/compute';
import { loadRealSnapshot, makeConfig } from '../_helpers';

let snapshot: Snapshot;
let config: BotConfig;
let computedMembers: ComputedMember[];

beforeAll(() => {
  snapshot = loadRealSnapshot();
  config = makeConfig();
  computedMembers = computeMembers(snapshot, config);
});

describe('generateCombinedReport', () => {
  it('returns empty string when types array is empty', () => {
    const result = generateCombinedReport([], snapshot, config, computedMembers);
    expect(result).toBe('');
  });

  it('returns empty string when types contains only unknown strings', () => {
    const result = generateCombinedReport(['foo', 'bar', 'baz'], snapshot, config, computedMembers);
    expect(result).toBe('');
  });

  it('generates daily report when types=["daily"]', () => {
    const result = generateCombinedReport(['daily'], snapshot, config, computedMembers);
    const expected = generateDailyReport(snapshot, config, computedMembers, undefined);
    expect(result).toBe(expected);
    expect(result).toContain('Daily');
  });

  it('generates weekly report when types=["weekly"]', () => {
    const result = generateCombinedReport(['weekly'], snapshot, config, computedMembers);
    const expected = generateWeeklyReport(snapshot, config, computedMembers, undefined);
    expect(result).toBe(expected);
    expect(result).toContain('Weekly');
  });

  it('generates monthly report with offset=-1 when types=["monthly"]', () => {
    const result = generateCombinedReport(['monthly'], snapshot, config, computedMembers);
    // Monthly in combined always uses offset=-1 (previous month)
    const expected = generateMonthlyReport(snapshot, config, computedMembers, -1);
    expect(result).toBe(expected);
  });

  it('joins multiple reports with \\n\\n separator', () => {
    const result = generateCombinedReport(['daily', 'weekly'], snapshot, config, computedMembers);
    const daily = generateDailyReport(snapshot, config, computedMembers, undefined);
    const weekly = generateWeeklyReport(snapshot, config, computedMembers, undefined);
    // \n\n is the join separator between the two report parts
    expect(result).toBe(`${daily}\n\n${weekly}`);
  });

  it('ignores unknown types mixed with valid ones', () => {
    const result = generateCombinedReport(['daily', 'unknown', 'weekly'], snapshot, config, computedMembers);
    const daily = generateDailyReport(snapshot, config, computedMembers, undefined);
    const weekly = generateWeeklyReport(snapshot, config, computedMembers, undefined);
    // Unknown type is silently skipped — only daily + weekly in output
    expect(result).toBe(`${daily}\n\n${weekly}`);
  });
});
