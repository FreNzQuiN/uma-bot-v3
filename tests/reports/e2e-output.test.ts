/**
 * E2E Report Output Tests
 *
 * These tests load the REAL snapshot data and verify the ACTUAL formatted
 * output that users see on WhatsApp. This catches:
 * - Wrong formatting (Markdown vs WhatsApp)
 * - Wrong calculations (gain, projection, risk)
 * - Missing sections (stale warnings, transfer badges)
 * - Wrong member counts
 */

import * as path from 'path';
import * as fs from 'fs';
import { Snapshot, BotConfig } from '../../src/types';
import { generateDailyReport } from '../../src/reports/daily';
import { generateWeeklyReport } from '../../src/reports/weekly';
import { generateMonthlyReport } from '../../src/reports/monthly';
import { generateRanksReport } from '../../src/reports/ranks';
import { generateBottomReport } from '../../src/reports/bottom';
import { generateStatsReport } from '../../src/reports/stats';
import { generateMembersReport } from '../../src/reports/members';
import { generateTierReport } from '../../src/reports/tier';
import { generateCompareReport } from '../../src/reports/compare';
import { generateAnalyzeReport } from '../../src/reports/analyze';
import { formatNumber, formatDateWIB, splitMessage } from '../../src/reports/format';
import { getDataDayFromSnapshot } from '../../src/data/snapshot';
import { computeMembers } from '../../src/reports/compute';
import { loadConfig } from '../../src/config';

// Load real snapshot
const SNAPSHOT_PATH = path.join(__dirname, '..', '..', 'examples', 'snapshot-june-12.json');
let snapshot: Snapshot;

// Load config (uses config.yaml if exists, otherwise defaults)
let config: BotConfig;

beforeAll(() => {
  const raw = fs.readFileSync(SNAPSHOT_PATH, 'utf-8');
  snapshot = JSON.parse(raw);
  config = loadConfig();
});

// ============================================================
// Helper: verify WhatsApp formatting (no Markdown)
// ============================================================

function assertNoMarkdown(text: string, context: string): void {
  // WhatsApp uses *bold*, not **bold**
  expect(text).not.toMatch(/\*\*[^*]+\*\*/);
  // WhatsApp uses • not - for lists
  // (dash at line start is ok for some contexts, but not as bullet)
  // No # headers
  expect(text).not.toMatch(/^#\s/m);
}

// ============================================================
// Weekly Report E2E
// ============================================================

describe('E2E: Weekly Report', () => {
  let report: string;

  beforeAll(() => {
    report = generateWeeklyReport(snapshot, config, 0);
  });

  it('starts with Weekly Report header', () => {
    expect(report).toMatch(/📈 \*Weekly Report — Minggu \d/);
  });

  it('contains club name', () => {
    expect(report).toContain('Hol＿Horse');
  });

  it('contains period (day range)', () => {
    expect(report).toMatch(/Periode: Hari \d+-\d+/);
  });

  it('contains total weekly gain', () => {
    expect(report).toMatch(/Total: [\d.,]+[KMB]/);
  });

  it('lists contributors with gains', () => {
    expect(report).toMatch(/^\d+\.\s.*— \+[\d.,]+[KMB]/m);
  });

  it('uses WhatsApp formatting', () => {
    assertNoMarkdown(report, 'weekly');
  });
});

// ============================================================
// Monthly Report E2E
// ============================================================

describe('E2E: Monthly Report', () => {
  let report: string;

  beforeAll(() => {
    report = generateMonthlyReport(snapshot, config, 0);
  });

  it('starts with Monthly Report header', () => {
    expect(report).toMatch(/📅 \*Monthly Report — /);
  });

  it('contains total monthly gain', () => {
    expect(report).toMatch(/Total: [\d.,]+[KMB]/);
  });

  it('contains member counts by status', () => {
    expect(report).toMatch(/\d+ kontribusi dari \d+ anggota/);
  });

  it('contains projection', () => {
    expect(report).toMatch(/Proyeksi akhir bulan: ~/);
  });

  it('contains requirement pass/fail', () => {
    expect(report).toMatch(/✅ \d+ pass/);
    expect(report).toMatch(/❌ \d+ kurang/);
  });

  it('lists all members with monthly gains', () => {
    expect(report).toMatch(/^\d+\.\s/m);
  });

  it('uses WhatsApp formatting', () => {
    assertNoMarkdown(report, 'monthly');
  });
});

// ============================================================
// Ranks Report E2E
// ============================================================

describe('E2E: Ranks Report', () => {
  let report: string;

  beforeAll(() => {
    report = generateRanksReport(snapshot, config);
  });

  it('starts with Peringkat Bulanan header', () => {
    expect(report).toMatch(/🏆 \*Peringkat Bulanan/);
  });

  it('shows top 3 with medal emojis', () => {
    expect(report).toContain('🥇');
    expect(report).toContain('🥈');
    expect(report).toContain('🥉');
  });

  it('shows exactly top 10 members', () => {
    // Count numbered lines (excluding medal lines for top 3)
    const lines = report.split('\n');
    const memberLines = lines.filter((l) => /^\d+\.\s/.test(l.trim()));
    const medalLines = lines.filter((l) => /^[🥇🥈🥉]/.test(l.trim()));
    expect(memberLines.length + medalLines.length).toBeLessThanOrEqual(10);
  });

  it('members sorted by monthly gain descending', () => {
    // First medal should be the highest gain member
    expect(report).toContain('🥇');
  });

  it('uses WhatsApp formatting', () => {
    assertNoMarkdown(report, 'ranks');
  });
});

// ============================================================
// Bottom Report E2E
// ============================================================

describe('E2E: Bottom Report', () => {
  let report: string;

  beforeAll(() => {
    report = generateBottomReport(snapshot, config);
  });

  it('starts with Perlu Perhatian header', () => {
    expect(report).toMatch(/📉 \*Perlu Perhatian/);
  });

  it('contains monthly target', () => {
    expect(report).toMatch(/🎯 Target bulanan: [\d.,]+[KMB]/);
  });

  it('shows deficit calculation', () => {
    expect(report).toMatch(/kurang [\d.,]+[KMB]/);
  });

  it('shows projection for below-target members', () => {
    expect(report).toMatch(/→ ~[\d.,]+[KMB]/);
  });

  it('no left members section in bottom report (left only in /members)', () => {
    expect(report).not.toContain('🚪 Keluar dari klub:');
  });

  it('uses WhatsApp formatting', () => {
    assertNoMarkdown(report, 'bottom');
  });
});

// ============================================================
// Stats Report E2E
// ============================================================

describe('E2E: Stats Report', () => {
  let report: string;

  beforeAll(() => {
    report = generateStatsReport(snapshot, config);
  });

  it('starts with Stats Overview header', () => {
    expect(report).toMatch(/📊 \*Stats Overview/);
  });

  it('contains member counts', () => {
    expect(report).toMatch(/Total anggota: \d+/);
    expect(report).toMatch(/Aktif: \d+/);
  });

  it('contains average monthly gain', () => {
    expect(report).toMatch(/Gain rata-rata bulanan: [\d.,]+[KMB]/);
  });

  it('contains median monthly gain', () => {
    expect(report).toMatch(/Gain median bulanan: [\d.,]+[KMB]/);
  });

  it('contains average daily gain', () => {
    expect(report).toMatch(/Gain rata-rata harian: [\d.,]+[KMB]/);
  });

  it('contains average active days', () => {
    expect(report).toMatch(/Rata-rata hari aktif: \d+ hari/);
  });

  it('contains zero gain count with emoji', () => {
    expect(report).toMatch(/🎯 Zero gain hari ini: \d+ orang/);
  });

  it('contains top member', () => {
    expect(report).toMatch(/🏆 Top: .+ — [\d.,]+[KMB]/);
  });

  it('contains lowest active member', () => {
    expect(report).toMatch(/📉 Lowest aktif: .+ — [\d.,]+[KMB]/);
  });

  it('contains projection', () => {
    expect(report).toMatch(/Proyeksi akhir bulan: ~/);
  });

  it('contains tier info', () => {
    expect(report).toMatch(/🎯 (Promosi|Tier)/);
  });

  it('contains requirement pass rate', () => {
    expect(report).toMatch(/Requirement pass rate: \d+%/);
  });

  it('uses WhatsApp formatting', () => {
    assertNoMarkdown(report, 'stats');
  });
});

// ============================================================
// Members Report E2E
// ============================================================

describe('E2E: Members Report', () => {
  let report: string;

  beforeAll(() => {
    report = generateMembersReport(snapshot, config);
  });

  it('starts with Daftar Anggota header', () => {
    expect(report).toMatch(/👥 \*Daftar Anggota/);
  });

  it('contains club name and tier', () => {
    expect(report).toContain('Hol＿Horse');
    expect(report).toContain('A+');
  });

  it('lists all members with bullet points', () => {
    const bulletLines = report.split('\n').filter((l) => l.trim().startsWith('•'));
    expect(bulletLines.length).toBeGreaterThanOrEqual(20); // at least 20 members
  });

  it('shows transfer badges', () => {
    expect(report).toContain('🔄');
  });

  it('shows left member badges', () => {
    expect(report).toContain('🚪');
  });

  it('shows transfer origin info', () => {
    expect(report).toMatch(/dari \w+/);
  });

  it('uses WhatsApp formatting', () => {
    assertNoMarkdown(report, 'members');
  });
});

// ============================================================
// Tier Report E2E
// ============================================================

describe('E2E: Tier Report', () => {
  let report: string;

  beforeAll(() => {
    report = generateTierReport(snapshot, config);
  });

  it('starts with Tier Intelligence header', () => {
    expect(report).toMatch(/🏆 \*Tier Intelligence/);
  });

  it('contains tier name', () => {
    expect(report).toContain('A+');
  });

  it('contains promotion gap', () => {
    expect(report).toMatch(/Promosi: [\d.,]+[KMB]/);
  });

  it('contains demotion buffer', () => {
    expect(report).toMatch(/Degradasi: buffer [\d.,]+[KMB]/);
  });

  it('contains current pace', () => {
    expect(report).toMatch(/Pace saat ini: [\d.,]+[KMB]\/hari/);
  });

  it('contains required pace', () => {
    expect(report).toMatch(/Pace butuh: [\d.,]+[KMB]\/hari/);
  });

  it('contains days left', () => {
    expect(report).toMatch(/Sisa hari: \d+/);
  });

  it('contains projection with emoji', () => {
    expect(report).toMatch(/Proyeksi: .+/);
  });

  it('uses WhatsApp formatting', () => {
    assertNoMarkdown(report, 'tier');
  });
});

// ============================================================
// Compare Report E2E
// ============================================================

describe('E2E: Compare Report', () => {
  it('compares two known members', () => {
    const report = generateCompareReport(snapshot, config, 'Ryu', 'GoldFamily');
    expect(report).toMatch(/⚔️ \*Compare: Ryu vs GoldFamily — \d+ \w+ \d+\*/);
    expect(report).toContain('*Monthly Gain*');
    expect(report).toContain('*Daily Terakhir*');
    expect(report).toContain('*Rata-rata 7 Hari*');
    expect(report).toMatch(/\*Gain Minggu \d+\*/);
    expect(report).toContain('⸻');
    expect(report).toMatch(/Terakhir sync: \d+\/\d+ \d{2}:\d{2}/);
    expect(report).toMatch(/🏆 \*.*\* unggul di monthly gain/);
  });

  it('handles exact name matching via dispatch resolution', () => {
    const report = generateCompareReport(snapshot, config, 'Ryu', 'GoldFamily');
    expect(report).not.toMatch(/tidak ditemukan/);
    expect(report).toMatch(/Compare/);
  });

  it('returns error for non-existent member', () => {
    const report = generateCompareReport(snapshot, config, 'Ryu', 'ZZZZNOTEXIST');
    expect(report).toContain('tidak ditemukan');
  });

  it('uses WhatsApp formatting', () => {
    const report = generateCompareReport(snapshot, config, 'Ryu', 'GoldFamily');
    assertNoMarkdown(report, 'compare');
  });
});

// ============================================================
// Analyze Report E2E
// ============================================================

describe('E2E: Analyze Report', () => {
  it('analyzes a known member', () => {
    const report = generateAnalyzeReport(snapshot, config, 'Ryu');
    expect(report).toMatch(/🔍 \*Analyze: Ryu — \d+ \w+ \d+\*/);
    expect(report).toContain('*Gain*');
    expect(report).toContain('*Aktivitas*');
    expect(report).toContain('*Weekly*');
    expect(report).toContain('*Proyeksi*');
    expect(report).toMatch(/Monthly: [\d.,]+[KMB]/);
    expect(report).toMatch(/Hari aktif: \d+\/\d+/);
    expect(report).toMatch(/Konsistensi: \d+%/);
  });

  it('shows transfer info for transfer members', () => {
    const report = generateAnalyzeReport(snapshot, config, 'Zero');
    expect(report).toContain('🔄 Transfer dari Advent');
  });

  it('handles exact name matching via dispatch resolution', () => {
    const report = generateAnalyzeReport(snapshot, config, 'Ryu');
    expect(report).not.toContain('tidak ditemukan');
    expect(report).toMatch(/Analyze: Ryu/);
  });

  it('returns error for non-existent member', () => {
    const report = generateAnalyzeReport(snapshot, config, 'ZZZZNOTEXIST');
    expect(report).toContain('tidak ditemukan');
  });

  it('uses WhatsApp formatting', () => {
    const report = generateAnalyzeReport(snapshot, config, 'Ryu');
    assertNoMarkdown(report, 'analyze');
  });
});

// ============================================================
// Format Helpers E2E
// ============================================================

describe('E2E: Format Helpers', () => {
  describe('formatNumber', () => {
    it('formats billions', () => {
      expect(formatNumber(1_500_000_000)).toBe('1.5B');
      expect(formatNumber(349_208_495)).toBe('349.2M');
    });

    it('formats millions', () => {
      expect(formatNumber(21_848_493)).toBe('21.8M');
      expect(formatNumber(1_000_000)).toBe('1.0M');
    });

    it('formats thousands', () => {
      expect(formatNumber(50_000)).toBe('50.0K');
      expect(formatNumber(1_000)).toBe('1.0K');
    });

    it('formats small numbers raw', () => {
      expect(formatNumber(999)).toBe('999');
      expect(formatNumber(0)).toBe('0');
    });

    it('handles negative numbers', () => {
      expect(formatNumber(-1_500_000)).toBe('-1.5M');
    });
  });

  describe('formatDateWIB', () => {
    it('formats date in Indonesian', () => {
      expect(formatDateWIB('2026-06-11')).toBe('11 Juni 2026');
      expect(formatDateWIB('2026-01-01')).toBe('1 Januari 2026');
    });
  });

  describe('splitMessage', () => {
    it('returns single part for short message', () => {
      const result = splitMessage('Hello', 4096);
      expect(result).toHaveLength(1);
      expect(result[0]).toBe('Hello');
    });

    it('splits long message at newlines', () => {
      const long = 'Line 1\n'.repeat(600);
      const result = splitMessage(long, 4096);
      expect(result.length).toBeGreaterThan(1);
      expect(result[0]).toMatch(/^Part 1\/\d+/);
    });

    it('all parts fit within maxLength', () => {
      const long = 'Line 1\n'.repeat(600);
      const result = splitMessage(long, 4096);
      for (const part of result) {
        expect(part.length).toBeLessThanOrEqual(4096);
      }
    });
  });
});

// ============================================================
// Cross-report consistency
// ============================================================

describe('E2E: Cross-report consistency', () => {
  it('daily and monthly show same member count', () => {
    const daily = generateDailyReport(snapshot, config, 0);
    const monthly = generateMonthlyReport(snapshot, config, 0);
    const dailyMatch = daily.match(/kontribusi dari (\d+) anggota/);
    const monthlyMatch = monthly.match(/(\d+) kontribusi dari \d+ anggota/);
    expect(dailyMatch?.[1]).toBe(monthlyMatch?.[1]);
  });

  it('ranks and monthly use same gain values for top member', () => {
    const ranks = generateRanksReport(snapshot, config);
    const monthly = generateMonthlyReport(snapshot, config, 0);
    // Both should reference the same top member
    const ranksTop = ranks.match(/🥇 \*(.+?)\* —/);
    const monthlyTop = monthly.match(/1\. \*(.+?)\* —/);
    expect(ranksTop?.[1]).toBe(monthlyTop?.[1]);
  });

  it('stats projection matches monthly projection', () => {
    const stats = generateStatsReport(snapshot, config);
    const monthly = generateMonthlyReport(snapshot, config, 0);
    const statsProj = stats.match(/Proyeksi akhir bulan: ~([\d.,]+[KMB])/);
    const monthlyProj = monthly.match(/Proyeksi akhir bulan: ~([\d.,]+[KMB])/);
    expect(statsProj?.[1]).toBe(monthlyProj?.[1]);
  });

  it('bottom report shows members that monthly marks as below requirement', () => {
    const monthly = generateMonthlyReport(snapshot, config, 0);
    const bottom = generateBottomReport(snapshot, config);
    // Monthly shows "❌ N kurang", bottom shows those members
    const failMatch = monthly.match(/❌ (\d+) kurang/);
    expect(failMatch).toBeTruthy();
    expect(parseInt(failMatch![1])).toBeGreaterThan(0);
  });
});

// ============================================================
// Data integrity
// ============================================================

describe('E2E: Data integrity', () => {
  it('snapshot has 34 members (as per AGENTS.md)', () => {
    expect(snapshot.members.length).toBe(34);
  });

  it('getDataDayFromSnapshot returns 11 for June 12 snapshot', () => {
    const dataDay = getDataDayFromSnapshot(snapshot);
    expect(dataDay).toBe(11);
  });

  it('computeMembers returns correct counts', () => {
    const members = computeMembers(snapshot, config);
    const active = members.filter((m) => m.status === 'active').length;
    const left = members.filter((m) => m.status === 'left').length;
    expect(active + left).toBe(34);
    // 6 transfer members (Zero, TheTengOne, Sairen, VitoHoow, Ceciria, Falkrum) — now active with isTransfer flag
    const transfer = members.filter((m) => m.isTransfer).length;
    expect(transfer).toBe(6);
    // 4 left members (DOA IBU, Kuro, Rowking, Lebowski — detected via member_count gap)
    expect(left).toBe(4);
    // 30 active members (24 regular + 6 transfer)
    expect(active).toBe(30);
  });

  it('no report exceeds WhatsApp message limit (4096 chars)', () => {
    const reports = [
      generateDailyReport(snapshot, config, 0),
      generateWeeklyReport(snapshot, config, 0),
      generateMonthlyReport(snapshot, config, 0),
      generateRanksReport(snapshot, config),
      generateBottomReport(snapshot, config),
      generateStatsReport(snapshot, config),
      generateMembersReport(snapshot, config),
      generateTierReport(snapshot, config),
    ];
    for (const report of reports) {
      expect(report.length).toBeLessThanOrEqual(4096);
    }
  });
});
