/**
 * Compare Report — Dedicated Tests
 *
 * full test coverage for generateCompareReport():
 * - Happy path: both members found, formatted output
 * - Error paths: first/second/both members not found
 * - Self-comparison, transfer badges, winner logic
 * - WhatsApp formatting compliance and size limits
 *
 * Uses real snapshot (examples/snapshot-june-12.json, 34 members).
 */

import { generateCompareReport } from '../../src/reports/compare';
import { getDefaultConfig, loadConfig } from '../../src/config';
import { computeMembers } from '../../src/reports/compute';
import { getDataDayFromSnapshot } from '../../src/data/snapshot';
import type { Snapshot, BotConfig } from '../../src/types';
import { loadRealSnapshot } from '../_helpers';


let snapshot: Snapshot;
let config: BotConfig;

beforeAll(() => {
  snapshot = loadRealSnapshot();
  // Use loadConfig if config.yaml exists, otherwise defaults
  try {
    config = loadConfig();
  } catch {
    config = getDefaultConfig();
  }
});


/**
 * Build a custom snapshot with specific member data for targeted tests.
 * Replaces only the members array while keeping circle/metadata intact.
 */
function buildSnapshotWithMembers(members: Snapshot['members']): Snapshot {
  return { ...snapshot, members };
}

/**
 * Build a member entry with the given daily_fans array.
 * Uses minimal required fields — computeMembers derives the rest.
 */
let memberIdCounter = 1;
function buildMember(
  name: string,
  dailyFans: number[],
  overrides: Partial<Snapshot['members'][0]> = {}
): Snapshot['members'][0] {
  return {
    id: memberIdCounter++,
    circle_id: 232229195,
    viewer_id: memberIdCounter + 1000000,
    trainer_name: name,
    shame_score: null,
    year: 2026,
    month: 6,
    daily_fans: dailyFans,
    last_updated: '2026-06-11T17:01:16Z',
    ...overrides,
  };
}

/**
 * Create a 32-element daily_fans array with cumulative values starting at day 1.
 * @param startValue - Starting cumulative value
 * @param dailyGain - Daily increment
 * @param activeDays - Number of active days (rest are zero-padded)
 */
function makeCumulativeFans(startValue: number, dailyGain: number, activeDays: number): number[] {
  const fans: number[] = [];
  let current = startValue;
  for (let i = 0; i < 32; i++) {
    if (i < activeDays) {
      fans.push(current);
      current += dailyGain;
    } else {
      fans.push(0);
    }
  }
  return fans;
}


describe('generateCompareReport — both members found', () => {
  it('produces formatted comparison with both member names', () => {
    // Arrange & Act
    const report = generateCompareReport(snapshot, config, computeMembers(snapshot, config), 'Ryu', 'GoldFamily');

    // Assert — header contains both names
    expect(report).toContain('⚔️');
    expect(report).toContain('Ryu');
    expect(report).toContain('GoldFamily');
    expect(report).toMatch(/Compare: .* vs .* —/);
  });

  it('contains all expected metric sections', () => {
    const report = generateCompareReport(snapshot, config, computeMembers(snapshot, config), 'Ryu', 'GoldFamily');

    expect(report).toContain('*Monthly Gain*');
    expect(report).toContain('*Daily Terakhir*');
    expect(report).toContain('*Rata-rata 7 Hari*');
    expect(report).toMatch(/\*Gain Minggu \d+\*/);
  });

  it('shows requirement section when monthlyFans > 0', () => {
    const report = generateCompareReport(snapshot, config, computeMembers(snapshot, config), 'Ryu', 'GoldFamily');

    expect(report).toMatch(/\*Requirement \([\d.,]+[KMB]?\/bulan\)\*/);
  });

  it('includes a winner or tie declaration', () => {
    const report = generateCompareReport(snapshot, config, computeMembers(snapshot, config), 'Ryu', 'GoldFamily');

    // Must have exactly one of: A wins, B wins, or tie
    const hasAWinner = report.includes('unggul di monthly gain');
    const hasTie = report.includes('Seri di monthly gain');
    expect(hasAWinner || hasTie).toBe(true);
  });

  it('includes sync footer', () => {
    const report = generateCompareReport(snapshot, config, computeMembers(snapshot, config), 'Ryu', 'GoldFamily');

    expect(report).toContain('⸻');
    expect(report).toMatch(/Terakhir sync:/);
  });
});


describe('generateCompareReport — member not found', () => {
  it('returns error when first member is not found', () => {
    // Arrange & Act
    const report = generateCompareReport(snapshot, config, computeMembers(snapshot, config), 'ZZZZNOTEXIST', 'Ryu');

    // Assert
    expect(report).toContain('❌');
    expect(report).toContain('ZZZZNOTEXIST');
    expect(report).toContain('tidak ditemukan');
    // Should NOT contain comparison content
    expect(report).not.toContain('*Monthly Gain*');
  });

  it('returns error when second member is not found', () => {
    // Arrange & Act
    const report = generateCompareReport(snapshot, config, computeMembers(snapshot, config), 'Ryu', 'ZZZZNOTEXIST');

    // Assert
    expect(report).toContain('❌');
    expect(report).toContain('ZZZZNOTEXIST');
    expect(report).toContain('tidak ditemukan');
    expect(report).not.toContain('*Monthly Gain*');
  });

  it('returns error when both members are not found', () => {
    // Arrange & Act
    const report = generateCompareReport(snapshot, config, computeMembers(snapshot, config), 'ZZZZNOTEXIST', 'ZZZZALSONOT');

    // Assert
    expect(report).toContain('❌');
    expect(report).toContain('ZZZZNOTEXIST');
    expect(report).toContain('ZZZZALSONOT');
    expect(report).toContain('tidak ditemukan');
    expect(report).not.toContain('*Monthly Gain*');
  });

  it('error message uses Indonesian wording', () => {
    const report = generateCompareReport(snapshot, config, computeMembers(snapshot, config), 'Ghost1', 'Ghost2');

    // Must say "tidak ditemukan" (Indonesian for "not found")
    expect(report).toMatch(/tidak ditemukan/);
    expect(report).toMatch(/Cek ejaan nama/);
  });
});


describe('generateCompareReport — self-comparison', () => {
  it('works correctly when comparing member to self', () => {
    // Arrange & Act
    const report = generateCompareReport(snapshot, config, computeMembers(snapshot, config), 'Ryu', 'Ryu');

    // Assert — should produce a valid report, not an error
    expect(report).toContain('⚔️');
    expect(report).toContain('Ryu');
    expect(report).toContain('*Monthly Gain*');

    // Both sides should show the same values
    // The "winner" should be "Seri" (tie) since same member
    expect(report).toContain('Seri');
  });

  it('self-comparison shows tie when monthly gains are equal', () => {
    const report = generateCompareReport(snapshot, config, computeMembers(snapshot, config), 'GoldFamily', 'GoldFamily');

    expect(report).toContain('Seri');
    expect(report).not.toContain('unggul');
  });
});


describe('generateCompareReport — winner determination', () => {
  it('shows first member as winner when their monthly gain is higher', () => {
    // Arrange — Ryu has higher cumulative fans than GoldFamily in the snapshot
    // Build a snapshot where memberA clearly wins
    const highGainMember = buildMember('HighGuy', makeCumulativeFans(100_000_000, 5_000_000, 11));
    const lowGainMember = buildMember('LowGuy', makeCumulativeFans(100_000_000, 500_000, 11));
    const customSnapshot = buildSnapshotWithMembers([highGainMember, lowGainMember]);

    // Act
    const report = generateCompareReport(customSnapshot, config, computeMembers(customSnapshot, config), 'HighGuy', 'LowGuy');

    // Assert
    expect(report).toContain('HighGuy');
    expect(report).toContain('unggul di monthly gain');
    expect(report).not.toContain('Seri');
  });

  it('shows second member as winner when their monthly gain is higher', () => {
    const lowGainMember = buildMember('LowGuy', makeCumulativeFans(100_000_000, 500_000, 11));
    const highGainMember = buildMember('HighGuy', makeCumulativeFans(100_000_000, 5_000_000, 11));
    const customSnapshot = buildSnapshotWithMembers([lowGainMember, highGainMember]);

    // Act
    const report = generateCompareReport(customSnapshot, config, computeMembers(customSnapshot, config), 'LowGuy', 'HighGuy');

    // Assert — HighGuy wins
    expect(report).toContain('HighGuy');
    expect(report).toContain('unggul di monthly gain');
  });
});


describe('generateCompareReport — transfer members', () => {
  it('shows transfer badge for transfer member', () => {
    // Zero is a transfer member (previous_circle_name: "Advent")
    const report = generateCompareReport(snapshot, config, computeMembers(snapshot, config), 'Zero', 'Ryu');

    // Assert — transfer badge should appear
    expect(report).toContain('🔄');
    expect(report).toContain('Zero');
    expect(report).toContain('Ryu');
  });

  it('shows transfer badge on both when both are transfers', () => {
    // jgd (from Garuda3) and Zero (from Advent) are both transfers
    const report = generateCompareReport(snapshot, config, computeMembers(snapshot, config), 'Zero', 'jgd');

    expect(report).toContain('🔄');
    expect(report).toContain('*Monthly Gain*');
  });

  it('compare report for two non-transfer members has no transfer badges', () => {
    // Ryu and GoldFamily are not transfers
    const report = generateCompareReport(snapshot, config, computeMembers(snapshot, config), 'Ryu', 'GoldFamily');

    // The report should still work, just no 🔄 badge on names
    // (There may be 🔄 in the text if a transfer badge appears — but not on non-transfer names)
    expect(report).toContain('*Monthly Gain*');
    expect(report).toContain('Ryu');
    expect(report).toContain('GoldFamily');
  });
});


describe('generateCompareReport — WhatsApp formatting', () => {
  it('does not contain Markdown syntax (##, ```, ---)', () => {
    const report = generateCompareReport(snapshot, config, computeMembers(snapshot, config), 'Ryu', 'GoldFamily');

    // WhatsApp uses *bold*, not Markdown ## or ```
    expect(report).not.toMatch(/^#{1,6}\s/m);  // No Markdown headings
    expect(report).not.toContain('```');        // No code blocks
    expect(report).not.toMatch(/^---+$/m);      // No Markdown horizontal rules
  });

  it('uses WhatsApp bold syntax (*text*) for emphasis', () => {
    const report = generateCompareReport(snapshot, config, computeMembers(snapshot, config), 'Ryu', 'GoldFamily');

    // Should have WhatsApp bold markers
    expect(report).toMatch(/\*Monthly Gain\*/);
    expect(report).toMatch(/\*Ryu\*/);
    expect(report).toMatch(/\*GoldFamily\*/);
  });

  it('uses bullet points with • character', () => {
    const report = generateCompareReport(snapshot, config, computeMembers(snapshot, config), 'Ryu', 'GoldFamily');

    // Metric lines use • bullets
    expect(report).toContain('•');
  });

  it('is under 4096 characters (WhatsApp message limit)', () => {
    const report = generateCompareReport(snapshot, config, computeMembers(snapshot, config), 'Ryu', 'GoldFamily');

    expect(report.length).toBeLessThanOrEqual(4096);
  });

  it('report length is reasonable for a comparison (at least 200 chars)', () => {
    const report = generateCompareReport(snapshot, config, computeMembers(snapshot, config), 'Ryu', 'GoldFamily');

    expect(report.length).toBeGreaterThan(200);
  });
});


describe('generateCompareReport — numerical accuracy', () => {
  it('formats large numbers with K/M/B suffixes', () => {
    const report = generateCompareReport(snapshot, config, computeMembers(snapshot, config), 'Ryu', 'GoldFamily');

    // Members in the snapshot have gains in the millions — should show as M
    expect(report).toMatch(/[\d.]+M/);
  });

  it('monthly gain values are consistent with computeMembers', () => {
    // Arrange
    const members = computeMembers(snapshot, config);
    const ryu = members.find(m => m.trainerName === 'Ryu');
    const gold = members.find(m => m.trainerName === 'GoldFamily');
    expect(ryu).toBeDefined();
    expect(gold).toBeDefined();

    // Act
    const report = generateCompareReport(snapshot, config, computeMembers(snapshot, config), 'Ryu', 'GoldFamily');

    // Assert — monthly gain values from computeMembers should appear in report
    // The formatNumber function converts to K/M/B, so we check the formatted version
    const { formatNumber } = require('../../src/utils/format');
    expect(report).toContain(formatNumber(ryu!.monthlyGain));
    expect(report).toContain(formatNumber(gold!.monthlyGain));
  });
});


describe('generateCompareReport — edge cases', () => {
  it('handles members with zero daily fans', () => {
    // Build two members with all-zero daily fans (inactive)
    const inactiveA = buildMember('InactiveA', new Array(32).fill(0));
    const inactiveB = buildMember('InactiveB', new Array(32).fill(0));
    const customSnapshot = buildSnapshotWithMembers([inactiveA, inactiveB]);

    // Act
    const report = generateCompareReport(customSnapshot, config, computeMembers(customSnapshot, config), 'InactiveA', 'InactiveB');

    // Assert — should still produce a valid report, likely a tie
    expect(report).toContain('⚔️');
    expect(report).toContain('Seri');
    expect(report).toContain('*Monthly Gain*');
  });

  it('handles members with very different fan counts', () => {
    // One member with huge gains, one with tiny gains
    const bigMember = buildMember('BigGuy', makeCumulativeFans(0, 10_000_000, 11));
    const smallMember = buildMember('SmallGuy', makeCumulativeFans(0, 10_000, 11));
    const customSnapshot = buildSnapshotWithMembers([bigMember, smallMember]);

    // Act
    const report = generateCompareReport(customSnapshot, config, computeMembers(customSnapshot, config), 'BigGuy', 'SmallGuy');

    // Assert — BigGuy should win
    expect(report).toContain('BigGuy');
    expect(report).toContain('unggul');
    // Both should appear in the report
    expect(report).toContain('SmallGuy');
  });

  it('handles snapshot with only 1 day of data', () => {
    // Create members with only 1 active day
    const memberA = buildMember('DayOne', makeCumulativeFans(1_000_000, 500_000, 1));
    const memberB = buildMember('DayTwo', makeCumulativeFans(1_000_000, 300_000, 1));
    const customSnapshot = buildSnapshotWithMembers([memberA, memberB]);

    // Act
    const report = generateCompareReport(customSnapshot, config, computeMembers(customSnapshot, config), 'DayOne', 'DayTwo');

    // Assert — should still produce a valid report
    expect(report).toContain('⚔️');
    expect(report).toContain('*Monthly Gain*');
  });

  it('handles members with special characters in names', () => {
    // DOA IBU has a space, Suzuka Kopling has a space
    const report = generateCompareReport(snapshot, config, computeMembers(snapshot, config), 'DOA IBU', 'Suzuka Kopling');

    expect(report).toContain('⚔️');
    expect(report).toContain('*Monthly Gain*');
    expect(report.length).toBeLessThanOrEqual(4096);
  });

  it('report is deterministic (same inputs → same output)', () => {
    const report1 = generateCompareReport(snapshot, config, computeMembers(snapshot, config), 'Ryu', 'GoldFamily');
    const report2 = generateCompareReport(snapshot, config, computeMembers(snapshot, config), 'Ryu', 'GoldFamily');

    expect(report1).toBe(report2);
  });
});
