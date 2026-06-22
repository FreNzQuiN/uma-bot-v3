/**
 * Analyze Report — Dedicated Tests
 *
 * Comprehensive test coverage for generateAnalyzeReport():
 * - Happy path: valid member found, full analysis output
 * - Error path: member not found
 * - Transfer members, trend detection, projection math
 * - WhatsApp formatting compliance and size limits
 * - Edge cases: zero fans, special names, consistency
 *
 * Uses real snapshot (examples/snapshot-june-12.json, 34 members).
 */

import { generateAnalyzeReport } from '../../src/reports/analyze';
import { getDefaultConfig, loadConfig } from '../../src/config';
import { computeMembers } from '../../src/reports/compute';
import { getDataDayFromSnapshot } from '../../src/data/snapshot';
import type { Snapshot, BotConfig } from '../../src/types';
import { loadRealSnapshot } from '../_helpers';

// ============================================================
// Constants & Loaders
// ============================================================

let snapshot: Snapshot;
let config: BotConfig;

beforeAll(() => {
  snapshot = loadRealSnapshot();
  try {
    config = loadConfig();
  } catch {
    config = getDefaultConfig();
  }
});

// ============================================================
// Test Helpers
// ============================================================

function buildSnapshotWithMembers(members: Snapshot['members']): Snapshot {
  return { ...snapshot, members };
}

function buildMember(
  name: string,
  dailyFans: number[],
  overrides: Partial<Snapshot['members'][0]> = {}
): Snapshot['members'][0] {
  return {
    id: Math.floor(Math.random() * 1e9),
    circle_id: 232229195,
    viewer_id: Math.floor(Math.random() * 1e9),
    trainer_name: name,
    shame_score: null,
    year: 2026,
    month: 6,
    daily_fans: dailyFans,
    last_updated: '2026-06-11T17:01:16Z',
    ...overrides,
  };
}

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

// ============================================================
// Section 1: Valid Member Found
// ============================================================

describe('generateAnalyzeReport — valid member found', () => {
  it('produces analysis with member name in header', () => {
    // Arrange & Act
    const report = generateAnalyzeReport(snapshot, config, 'Ryu');

    // Assert
    expect(report).toContain('🔍');
    expect(report).toContain('Ryu');
    expect(report).toMatch(/Analyze: Ryu —/);
  });

  it('contains all expected metric sections', () => {
    const report = generateAnalyzeReport(snapshot, config, 'Ryu');

    expect(report).toContain('*Gain*');
    expect(report).toContain('*Aktivitas*');
    expect(report).toContain('*Weekly*');
    expect(report).toContain('*Proyeksi*');
  });

  it('shows gain metrics with proper labels', () => {
    const report = generateAnalyzeReport(snapshot, config, 'Ryu');

    expect(report).toMatch(/• Monthly: [\d.,]+[KMB]?/);
    expect(report).toMatch(/• Daily terakhir: [\d.,]+[KMB]?/);
    expect(report).toMatch(/• Rata-rata 3 Hari: [\d.,]+[KMB]?/);
    expect(report).toMatch(/• Rata-rata 7 Hari: [\d.,]+[KMB]?/);
  });

  it('shows activity metrics', () => {
    const report = generateAnalyzeReport(snapshot, config, 'Ryu');

    expect(report).toMatch(/• Hari aktif: \d+\/\d+/);
    expect(report).toMatch(/• Konsistensi: \d+%/);
    expect(report).toMatch(/• Trend: [📈📉➡️]/);
  });

  it('shows weekly breakdown', () => {
    const report = generateAnalyzeReport(snapshot, config, 'Ryu');

    // Should contain W1, W2, etc. with values
    expect(report).toMatch(/• W\d+:/);
  });

  it('shows projection and requirement status', () => {
    const report = generateAnalyzeReport(snapshot, config, 'Ryu');

    expect(report).toMatch(/• Target: [\d.,]+[KMB]?/);
    expect(report).toMatch(/• Status: (✅|❌)/);
    expect(report).toMatch(/• Proyeksi akhir bulan: ~/);
  });

  it('includes sync footer', () => {
    const report = generateAnalyzeReport(snapshot, config, 'Ryu');

    expect(report).toContain('⸻');
    expect(report).toMatch(/Terakhir sync:/);
  });
});

// ============================================================
// Section 2: Member Not Found
// ============================================================

describe('generateAnalyzeReport — member not found', () => {
  it('returns error message when member does not exist', () => {
    // Arrange & Act
    const report = generateAnalyzeReport(snapshot, config, 'ZZZZNOTEXIST');

    // Assert
    expect(report).toContain('❌');
    expect(report).toContain('ZZZZNOTEXIST');
    expect(report).toContain('tidak ditemukan');
    // Should NOT contain analysis content
    expect(report).not.toContain('*Gain*');
    expect(report).not.toContain('*Aktivitas*');
  });

  it('error message uses Indonesian wording', () => {
    const report = generateAnalyzeReport(snapshot, config, 'GhostPlayer');

    expect(report).toMatch(/tidak ditemukan/);
    expect(report).toMatch(/Cek ejaan nama/);
  });

  it('error message includes the queried name', () => {
    const report = generateAnalyzeReport(snapshot, config, 'PhantomX');

    expect(report).toContain('PhantomX');
  });
});

// ============================================================
// Section 3: Transfer Members
// ============================================================

describe('generateAnalyzeReport — transfer members', () => {
  it('shows transfer info for transfer member', () => {
    // Zero transferred from Advent
    const report = generateAnalyzeReport(snapshot, config, 'Zero');

    expect(report).toContain('🔄');
    expect(report).toContain('Transfer dari Advent');
  });

  it('shows transfer badge in title for transfer member', () => {
    const report = generateAnalyzeReport(snapshot, config, 'Zero');

    expect(report).toMatch(/Analyze: Zero 🔄/);
  });

  it('does not show transfer line for non-transfer member', () => {
    const report = generateAnalyzeReport(snapshot, config, 'Ryu');

    // Ryu is not a transfer — no "Transfer dari" line
    expect(report).not.toContain('Transfer dari');
  });

  it('shows correct previous circle name for different transfers', () => {
    // TheTengOne transferred from Garuda3
    const report = generateAnalyzeReport(snapshot, config, 'TheTengOne');

    expect(report).toContain('Transfer dari Garuda3');
  });
});

// ============================================================
// Section 4: Trend Detection
// ============================================================

describe('generateAnalyzeReport — trend detection', () => {
  it('shows upward trend when recent days are significantly higher than 7-day avg', () => {
    // Arrange — create a member with accelerating gains
    // Days 1-7: small gains, Days 8-11: big gains → 3-day avg > 7-day avg * 1.1
    const fans = [
      1_000_000, 1_100_000, 1_200_000, 1_300_000, 1_400_000, 1_500_000, 1_600_000,
      2_000_000, 2_500_000, 3_000_000, 3_500_000,
      ...new Array(21).fill(0),
    ];
    const member = buildMember('RisingStar', fans);
    const customSnapshot = buildSnapshotWithMembers([member]);

    // Act
    const report = generateAnalyzeReport(customSnapshot, config, 'RisingStar');

    // Assert — trend should be upward
    expect(report).toMatch(/Trend: 📈 naik/);
  });

  it('shows downward trend when recent days are significantly lower than 7-day avg', () => {
    // Arrange — create a member with decelerating gains
    // Days 1-7: big gains, Days 8-11: tiny gains → 3-day avg < 7-day avg * 0.9
    const fans = [
      1_000_000, 1_500_000, 2_000_000, 2_500_000, 3_000_000, 3_500_000, 4_000_000,
      4_100_000, 4_200_000, 4_300_000, 4_400_000,
      ...new Array(21).fill(0),
    ];
    const member = buildMember('FallingStar', fans);
    const customSnapshot = buildSnapshotWithMembers([member]);

    // Act
    const report = generateAnalyzeReport(customSnapshot, config, 'FallingStar');

    // Assert — trend should be downward
    expect(report).toMatch(/Trend: 📉 turun/);
  });

  it('shows stable trend when 3-day avg is within threshold of 7-day avg', () => {
    // Arrange — consistent daily gains → 3-day avg ≈ 7-day avg
    const fans = makeCumulativeFans(1_000_000, 100_000, 11);
    const member = buildMember('SteadyEddie', fans);
    const customSnapshot = buildSnapshotWithMembers([member]);

    // Act
    const report = generateAnalyzeReport(customSnapshot, config, 'SteadyEddie');

    // Assert — trend should be stable
    expect(report).toMatch(/Trend: ➡️ stabil/);
  });
});

// ============================================================
// Section 5: Consistency Calculation
// ============================================================

describe('generateAnalyzeReport — consistency', () => {
  it('shows 100% consistency when member was active every day', () => {
    // Arrange — active all 11 data days
    const fans = makeCumulativeFans(1_000_000, 100_000, 11);
    const member = buildMember('PerfectPlayer', fans);
    const customSnapshot = buildSnapshotWithMembers([member]);

    // Act
    const report = generateAnalyzeReport(customSnapshot, config, 'PerfectPlayer');

    // Assert
    expect(report).toContain('Konsistensi: 100%');
  });

  it('shows 0% consistency when member was never active', () => {
    // Arrange — all zeros
    const fans = new Array(32).fill(0);
    const member = buildMember('LazyPlayer', fans);
    const customSnapshot = buildSnapshotWithMembers([member]);

    // Act
    const report = generateAnalyzeReport(customSnapshot, config, 'LazyPlayer');

    // Assert
    expect(report).toContain('Konsistensi: 0%');
  });

  it('calculates partial consistency correctly', () => {
    // Arrange — need a snapshot where getDataDayFromSnapshot returns 10,
    // and the test member has only 5 active days out of those 10.
    //
    // countActiveDays counts day 1 if hasValue(fans[0])=true, then days 2+
    // where getDailyGain > 0 (current > prev > 0).
    //
    // Member A (test): days 1-5 active, days 6-10 flat (gain=0)
    // Member B (helper): ensures snapshot data day = 10
    const testFans = [
      1_000_000, 1_100_000, 1_200_000, 1_300_000, 1_400_000,
      1_400_000, 1_400_000, 1_400_000, 1_400_000, 1_400_000,
      ...new Array(22).fill(0),
    ];
    const helperFans = makeCumulativeFans(1_000_000, 100_000, 10);
    const testMember = buildMember('PartTimer', testFans);
    const helperMember = buildMember('Helper', helperFans);
    const customSnapshot = buildSnapshotWithMembers([testMember, helperMember]);

    // Act
    const report = generateAnalyzeReport(customSnapshot, config, 'PartTimer');

    // Assert — 5 active out of 10 data days = 50%
    expect(report).toContain('Konsistensi: 50%');
  });
});

// ============================================================
// Section 6: Requirement Status
// ============================================================

describe('generateAnalyzeReport — requirement status', () => {
  it('shows checkmark when member meets monthly requirement', () => {
    // Arrange — create a member with very high gains
    const fans = makeCumulativeFans(0, 10_000_000, 11);
    const member = buildMember('Overachiever', fans);
    const customSnapshot = buildSnapshotWithMembers([member]);

    // Act
    const report = generateAnalyzeReport(customSnapshot, config, 'Overachiever');

    // Assert — should show ✅ since monthlyGain >> monthlyFans requirement
    expect(report).toMatch(/Status: ✅/);
  });

  it('shows X when member does not meet monthly requirement', () => {
    // Arrange — create a member with zero gains
    const fans = new Array(32).fill(0);
    const member = buildMember('UnderPerformer', fans);
    const customSnapshot = buildSnapshotWithMembers([member]);

    // Act
    const report = generateAnalyzeReport(customSnapshot, config, 'UnderPerformer');

    // Assert — should show ❌ since monthlyGain is 0
    expect(report).toMatch(/Status: ❌/);
    expect(report).toContain('Kurang');
  });
});

// ============================================================
// Section 7: Projection
// ============================================================

describe('generateAnalyzeReport — projection', () => {
  it('projects month-end based on current pace', () => {
    // Arrange — create a member with known gains
    const fans = makeCumulativeFans(0, 1_000_000, 10);
    const member = buildMember('Pacer', fans);
    const customSnapshot = buildSnapshotWithMembers([member]);

    // Act
    const report = generateAnalyzeReport(customSnapshot, config, 'Pacer');

    // Assert — projection should be shown
    expect(report).toMatch(/Proyeksi akhir bulan: ~/);
    // The projection should be a formatted number
    expect(report).toContain('Target:');
  });

  it('shows zero projection when no data days', () => {
    // Arrange — all zeros → no data → daysElapsed = 0 → projection = 0
    const fans = new Array(32).fill(0);
    const member = buildMember('ZeroData', fans);
    const customSnapshot = buildSnapshotWithMembers([member]);

    // Act
    const report = generateAnalyzeReport(customSnapshot, config, 'ZeroData');

    // Assert — projection should show 0
    expect(report).toContain('Proyeksi akhir bulan: ~0');
  });
});

// ============================================================
// Section 8: WhatsApp Formatting Compliance
// ============================================================

describe('generateAnalyzeReport — WhatsApp formatting', () => {
  it('does not contain Markdown syntax (##, ```, ---)', () => {
    const report = generateAnalyzeReport(snapshot, config, 'Ryu');

    expect(report).not.toMatch(/^#{1,6}\s/m);
    expect(report).not.toContain('```');
    expect(report).not.toMatch(/^---+$/m);
  });

  it('uses WhatsApp bold syntax (*text*) for emphasis', () => {
    const report = generateAnalyzeReport(snapshot, config, 'Ryu');

    expect(report).toMatch(/\*Gain\*/);
    expect(report).toMatch(/\*Aktivitas\*/);
    expect(report).toMatch(/\*Weekly\*/);
    expect(report).toMatch(/\*Proyeksi\*/);
  });

  it('uses bullet points with • character', () => {
    const report = generateAnalyzeReport(snapshot, config, 'Ryu');

    expect(report).toContain('•');
  });

  it('is under 4096 characters (WhatsApp message limit)', () => {
    const report = generateAnalyzeReport(snapshot, config, 'Ryu');

    expect(report.length).toBeLessThanOrEqual(4096);
  });

  it('report length is reasonable for an analysis (at least 300 chars)', () => {
    const report = generateAnalyzeReport(snapshot, config, 'Ryu');

    expect(report.length).toBeGreaterThan(300);
  });
});

// ============================================================
// Section 9: Numerical Accuracy
// ============================================================

describe('generateAnalyzeReport — numerical accuracy', () => {
  it('formats large numbers with K/M/B suffixes', () => {
    const report = generateAnalyzeReport(snapshot, config, 'Ryu');

    // Members have gains in millions — should show as M
    expect(report).toMatch(/[\d.]+M/);
  });

  it('monthly gain value matches computeMembers output', () => {
    // Arrange
    const members = computeMembers(snapshot, config);
    const ryu = members.find(m => m.trainerName === 'Ryu');
    expect(ryu).toBeDefined();

    // Act
    const report = generateAnalyzeReport(snapshot, config, 'Ryu');

    // Assert
    const { formatNumber } = require('../../src/reports/format');
    expect(report).toContain(formatNumber(ryu!.monthlyGain));
  });

  it('active days count is consistent with daily_fans data', () => {
    // Arrange
    const members = computeMembers(snapshot, config);
    const ryu = members.find(m => m.trainerName === 'Ryu');
    expect(ryu).toBeDefined();

    const latestDataDay = getDataDayFromSnapshot(snapshot);
    const { countActiveDays } = require('../../src/data/daily-fans');
    const expectedActive = countActiveDays(
      ryu!.dailyFans,
      latestDataDay,
      config.requirements.includeTransferDataInCalculation
    );

    // Act
    const report = generateAnalyzeReport(snapshot, config, 'Ryu');

    // Assert — should contain "Hari aktif: X/Y"
    expect(report).toContain(`Hari aktif: ${expectedActive}/${latestDataDay}`);
  });
});

// ============================================================
// Section 10: Edge Cases
// ============================================================

describe('generateAnalyzeReport — edge cases', () => {
  it('handles member with all-zero daily fans', () => {
    // Arrange
    const fans = new Array(32).fill(0);
    const member = buildMember('GhostMember', fans);
    const customSnapshot = buildSnapshotWithMembers([member]);

    // Act
    const report = generateAnalyzeReport(customSnapshot, config, 'GhostMember');

    // Assert — should produce a valid report (not crash)
    expect(report).toContain('🔍');
    expect(report).toContain('GhostMember');
    expect(report).toContain('*Gain*');
    expect(report).toContain('Konsistensi: 0%');
    expect(report).toContain('Hari aktif: 0/');
  });

  it('handles member with only 1 active day', () => {
    const fans = [
      5_000_000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      ...new Array(21).fill(0),
    ];
    const member = buildMember('SoloPlayer', fans);
    const customSnapshot = buildSnapshotWithMembers([member]);

    // Act
    const report = generateAnalyzeReport(customSnapshot, config, 'SoloPlayer');

    // Assert
    expect(report).toContain('🔍');
    expect(report).toContain('Hari aktif: 1/');
    expect(report).toContain('Konsistensi:');
  });

  it('handles members with special characters in names', () => {
    // DOA IBU has a space, Suzuka Kopling has a space
    const report = generateAnalyzeReport(snapshot, config, 'DOA IBU');

    expect(report).toContain('🔍');
    expect(report).toContain('DOA IBU');
    expect(report).toContain('*Gain*');
    expect(report.length).toBeLessThanOrEqual(4096);
  });

  it('report is deterministic (same inputs → same output)', () => {
    const report1 = generateAnalyzeReport(snapshot, config, 'Ryu');
    const report2 = generateAnalyzeReport(snapshot, config, 'Ryu');

    expect(report1).toBe(report2);
  });

  it('handles member with unicode characters in name', () => {
    // Dyy\u201D has a Unicode right double quotation mark (U+201D)
    const report = generateAnalyzeReport(snapshot, config, 'Dyy\u201D');

    expect(report).toContain('🔍');
    expect(report).toContain('*Gain*');
    expect(report.length).toBeLessThanOrEqual(4096);
  });
});

// ============================================================
// Section 11: Weekly Gains Display
// ============================================================

describe('generateAnalyzeReport — weekly gains', () => {
  it('shows all 5 weeks in the weekly section', () => {
    const report = generateAnalyzeReport(snapshot, config, 'Ryu');

    // Should contain W1 through W5
    expect(report).toMatch(/W1: [\d.,]+[KMB]?/);
    expect(report).toMatch(/W2: [\d.,]+[KMB]?/);
    expect(report).toMatch(/W3: [\d.,]+[KMB]?/);
    expect(report).toMatch(/W4: [\d.,]+[KMB]?/);
    expect(report).toMatch(/W5: [\d.,]+[KMB]?/);
  });

  it('weekly gains are separated by pipe character', () => {
    const report = generateAnalyzeReport(snapshot, config, 'Ryu');

    // Weekly gains are joined with " | "
    expect(report).toMatch(/W\d+: [\d.,]+[KMB]? \| W\d+:/);
  });
});
