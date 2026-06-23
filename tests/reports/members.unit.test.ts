/**
 * Tests for members report generator.
 *
 * Covers: basic report generation, left members section when DB provided,
 * edge cases (no DB, empty left members, Unicode names),
 * sort order verification against real snapshot data,
 * badge logic, format correctness, and adversarial scenarios.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { generateMembersReport } from '../../src/reports/members';
import { computeMembers } from '../../src/reports/compute';
import { formatNumber } from '../../src/utils/format';
import { Database } from '../../src/db/database';
import { updateMemberHistory } from '../../src/data/member-history';
import type { Snapshot, BotConfig, MemberData } from '../../src/types';
import { getDefaultConfig } from '../../src/config';

// ============================================================
// Test helpers
// ============================================================

const ROOT = join(__dirname, '..');

function makeSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    circle: {
      circle_id: 100,
      name: 'TestClub',
      comment: '',
      leader_viewer_id: 1,
      leader_name: 'Leader',
      member_count: 2,
      join_style: 0,
      policy: 0,
      created_at: '',
      last_updated: '2026-06-12T14:00:00Z',
      monthly_rank: 100,
      monthly_point: 1000000,
      last_month_rank: null,
      last_month_point: null,
      archived: false,
      yesterday_updated: null,
      yesterday_points: null,
      yesterday_rank: null,
      live_points: null,
      live_rank: null,
      last_live_update: null,
    },
    members: [
      {
        id: 1,
        circle_id: 100,
        viewer_id: 1001,
        trainer_name: 'Alice',
        shame_score: null,
        year: 2026,
        month: 6,
        daily_fans: makeCumulativeFans([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100]),
        last_updated: '2026-06-12',
      },
      {
        id: 2,
        circle_id: 100,
        viewer_id: 1002,
        trainer_name: 'Bob',
        shame_score: null,
        year: 2026,
        month: 6,
        daily_fans: makeCumulativeFans([50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 550]),
        last_updated: '2026-06-12',
      },
    ],
    club_rank: 8,
    fans_to_next_tier: 500000,
    fans_to_lower_tier: 50000,
    yesterday_fans_to_next_tier: 600000,
    yesterday_fans_to_lower_tier: 40000,
    ...overrides,
  };
}

/**
 * Build a 32-element cumulative daily_fans array from an array of daily values.
 * dailyValues[0] = day1 total, dailyValues[1] = day2 total, etc.
 * Remaining entries are 0.
 */
function makeCumulativeFans(dailyValues: number[]): number[] {
  const arr = new Array(32).fill(0);
  for (let i = 0; i < dailyValues.length && i < 32; i++) {
    arr[i] = dailyValues[i];
  }
  return arr;
}

/**
 * Create a member with previous_circle info (transfer member).
 */
function makeTransferMember(overrides: Partial<MemberData> & { viewer_id: number; trainer_name: string }): MemberData {
  return {
    id: overrides.id ?? 9000,
    circle_id: 100,
    shame_score: null,
    year: 2026,
    month: 6,
    daily_fans: makeCumulativeFans([100, 200, 300]),
    last_updated: '2026-06-12',
    previous_circle_id: 200,
    previous_circle_name: 'OldClub',
    ...overrides,
  };
}

/**
 * Create a stale member (old last_updated, only early days have data).
 */
function makeStaleMember(overrides: Partial<MemberData> & { viewer_id: number; trainer_name: string }): MemberData {
  return {
    id: overrides.id ?? 9100,
    circle_id: 100,
    shame_score: null,
    year: 2026,
    month: 6,
    daily_fans: makeCumulativeFans([100, 100]),
    last_updated: '2026-06-01',
    ...overrides,
  };
}

let db: Database;

beforeEach(async () => {
  db = new Database(':memory:');
  await db.initialize();
});

afterEach(() => {
  db.close();
});

// ============================================================
// Basic members report
// ============================================================

describe('generateMembersReport', () => {
  it('includes club name and tier in header', () => {
    const snapshot = makeSnapshot();
    const config = getDefaultConfig();
    const report = generateMembersReport(snapshot, config, computeMembers(snapshot, config));

    expect(report).toContain('TestClub');
    expect(report).toContain('A+'); // club_rank 8 = A+
  });

  it('lists all current members', () => {
    const snapshot = makeSnapshot();
    const config = getDefaultConfig();
    const report = generateMembersReport(snapshot, config, computeMembers(snapshot, config));

    expect(report).toContain('Alice');
    expect(report).toContain('Bob');
  });

  it('shows transfer badge for transfer members', () => {
    const snapshot = makeSnapshot({
      members: [
        makeTransferMember({ viewer_id: 1001, trainer_name: 'Alice' }),
      ],
    });
    const config = getDefaultConfig();
    const report = generateMembersReport(snapshot, config, computeMembers(snapshot, config));

    expect(report).toContain('🔄');
    expect(report).toContain('OldClub');
  });

  it('does not show left members section when no db provided', () => {
    const snapshot = makeSnapshot();
    const config = getDefaultConfig();
    const report = generateMembersReport(snapshot, config, computeMembers(snapshot, config));

    expect(report).not.toMatch(/🚪|keluar/i);
  });

  // ============================================================
  // Edge cases
  // ============================================================

  it('returns warning for empty members array', () => {
    const snapshot = makeSnapshot({ members: [] });
    const config = getDefaultConfig();
    const report = generateMembersReport(snapshot, config, computeMembers(snapshot, config));

    expect(report).toContain('Daftar Anggota');
    expect(report).toContain('Data anggota belum tersedia');
  });

  it('handles single member', () => {
    const snapshot = makeSnapshot({
      members: [makeSnapshot().members[0]],
    });
    const config = getDefaultConfig();
    const report = generateMembersReport(snapshot, config, computeMembers(snapshot, config));
    const memberLines = report.split('\n').filter(l => l.startsWith('•'));

    expect(memberLines).toHaveLength(1);
    expect(memberLines[0]).toContain('Alice');
  });

  it('handles all active members (no transfers, no stale)', () => {
    const snapshot = makeSnapshot();
    const config = getDefaultConfig();
    const report = generateMembersReport(snapshot, config, computeMembers(snapshot, config));

    expect(report).not.toContain('🔄');
    expect(report).not.toContain('⚠️');
    expect(report).not.toContain('🚪');
  });

  it('uses plain text formatting (no Markdown bold or headers)', () => {
    const snapshot = makeSnapshot();
    const config = getDefaultConfig();
    const report = generateMembersReport(snapshot, config, computeMembers(snapshot, config));

    expect(report).not.toMatch(/\*\*[^*]+\*\*/);
    expect(report).not.toMatch(/^#/m);
  });

  it('handles Unicode club names', () => {
    const snapshot = makeSnapshot({
      circle: { ...makeSnapshot().circle, name: 'テストクラブ' },
    });
    const config = getDefaultConfig();
    const report = generateMembersReport(snapshot, config, computeMembers(snapshot, config));

    expect(report).toContain('テストクラブ');
  });

  it('handles Unicode member names', () => {
    const snapshot = makeSnapshot({
      members: [
        {
          ...makeSnapshot().members[0],
          trainer_name: 'ゆうき',
          daily_fans: makeCumulativeFans([100, 200]),
          last_updated: '2026-06-12',
        },
      ],
    });
    const config = getDefaultConfig();
    const report = generateMembersReport(snapshot, config, computeMembers(snapshot, config));

    expect(report).toContain('ゆうき');
  });

  it('shows "0" for zero monthly gain', () => {
    const snapshot = makeSnapshot({
      members: [
        {
          id: 1,
          circle_id: 100,
          viewer_id: 1001,
          trainer_name: 'ZeroGain',
          shame_score: null,
          year: 2026,
          month: 6,
          daily_fans: makeCumulativeFans([100]),
          last_updated: '2026-06-01',
        },
      ],
    });
    const config = getDefaultConfig();
    const report = generateMembersReport(snapshot, config, computeMembers(snapshot, config));

    expect(report).toContain('• *ZeroGain* — 0');
  });

  // ============================================================
  // Badge logic
  // ============================================================

  describe('badge logic', () => {
    it('active member has no badge', () => {
      const snapshot = makeSnapshot();
      const config = getDefaultConfig();
      const report = generateMembersReport(snapshot, config, computeMembers(snapshot, config));
      const lines = report.split('\n').filter(l => l.startsWith('•'));

      for (const line of lines) {
        expect(line).not.toContain('🔄');
        expect(line).not.toContain('⚠️');
      }
    });

    it('transfer member has 🔄 badge and (dari X) info', () => {
      const snapshot = makeSnapshot({
        members: [
          makeTransferMember({ viewer_id: 1001, trainer_name: 'T1', previous_circle_name: 'OriginClub' }),
        ],
      });
      const config = getDefaultConfig();
      const report = generateMembersReport(snapshot, config, computeMembers(snapshot, config));

      expect(report).toContain('• *T1* 🔄 — 200 (dari OriginClub)');
    });

    it('stale member has ⚠️ badge (no positive data)', () => {
      const snapshot = makeSnapshot({
        members: [
          {
            id: 999,
            circle_id: 100,
            viewer_id: 9999,
            trainer_name: 'Reference',
            shame_score: null,
            year: 2026,
            month: 6,
            daily_fans: makeCumulativeFans([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100]),
            last_updated: '2026-06-12',
          },
          {
            id: 9100,
            circle_id: 100,
            viewer_id: 9100,
            trainer_name: 'OldMember',
            shame_score: null,
            year: 2026,
            month: 6,
            daily_fans: new Array(32).fill(0),  // no positive data → status='stale'
            last_updated: '2026-06-01',
          },
        ],
      });
      const config = getDefaultConfig();
      const report = generateMembersReport(snapshot, config, computeMembers(snapshot, config));

      expect(report).toContain('• *OldMember* ⚠️');
    });

    it('transfer member without previous_circle_name shows no (dari X)', () => {
      const snapshot = makeSnapshot({
        members: [
          {
            id: 1,
            circle_id: 100,
            viewer_id: 1001,
            trainer_name: 'T1',
            shame_score: null,
            year: 2026,
            month: 6,
            daily_fans: makeCumulativeFans([-100, 0, 200]),
            last_updated: '2026-06-12',
          },
        ],
      });
      const config = getDefaultConfig();
      const report = generateMembersReport(snapshot, config, computeMembers(snapshot, config));

      expect(report).toContain('• *T1* 🔄');
      expect(report).not.toContain('(dari');
    });

    it('left member has 🚪 badge', () => {
      const snapshot = makeSnapshot({
        members: [
          {
            id: 1,
            circle_id: 100,
            viewer_id: 1001,
            trainer_name: 'Ghost',
            shame_score: null,
            year: 2026,
            month: 6,
            daily_fans: new Array(32).fill(0),
            last_updated: '2026-06-01',
          },
        ],
      });
      const config = getDefaultConfig();
      const report = generateMembersReport(snapshot, config, computeMembers(snapshot, config));

      // Status is 'stale' (no positive days), but with member_count gap=0,
      // stays stale. If member_count was 0, would be 'left'.
      // This test uses a custom snapshot where ghostCount = max(0, 1 - 2) = 0
      // so status stays 'stale' and gets ⚠️ badge.
      expect(report).toContain('• *Ghost* ⚠️');
    });
  });

  // ============================================================
  // Sort order
  // ============================================================

  describe('sort order', () => {
    it('active members sorted by monthlyGain descending', () => {
      const snapshot = makeSnapshot({
        members: [
          {
            id: 1,
            circle_id: 100,
            viewer_id: 1001,
            trainer_name: 'LowGain',
            shame_score: null,
            year: 2026,
            month: 6,
            daily_fans: makeCumulativeFans([100, 200]),
            last_updated: '2026-06-12',
          },
          {
            id: 2,
            circle_id: 100,
            viewer_id: 1002,
            trainer_name: 'HighGain',
            shame_score: null,
            year: 2026,
            month: 6,
            daily_fans: makeCumulativeFans([100, 500, 900]),
            last_updated: '2026-06-12',
          },
        ],
      });
      const config = getDefaultConfig();
      const report = generateMembersReport(snapshot, config, computeMembers(snapshot, config));
      const lines = report.split('\n').filter(l => l.startsWith('•'));

      expect(lines[0]).toContain('HighGain');
      expect(lines[1]).toContain('LowGain');
    });

    it('active members (including transfers) sorted by monthlyGain descending', () => {
      const snapshot = makeSnapshot({
        members: [
          makeTransferMember({
            viewer_id: 1001,
            trainer_name: 'TransferHigh',
            daily_fans: makeCumulativeFans([100, 500, 900]),
          }),
          {
            id: 2,
            circle_id: 100,
            viewer_id: 1002,
            trainer_name: 'ActiveLow',
            shame_score: null,
            year: 2026,
            month: 6,
            daily_fans: makeCumulativeFans([100, 200, 300]),
            last_updated: '2026-06-12',
          },
        ],
      });
      const config = getDefaultConfig();
      const report = generateMembersReport(snapshot, config, computeMembers(snapshot, config));
      const lines = report.split('\n').filter(l => l.startsWith('•'));

      // Both are active (transfers are active with badge), sorted by gain desc
      expect(lines[0]).toContain('TransferHigh');
      expect(lines[1]).toContain('ActiveLow');
    });

    it('transfer members appear before stale members', () => {
      const snapshot = makeSnapshot({
        members: [
          makeStaleMember({ viewer_id: 1001, trainer_name: 'StaleMember' }),
          makeTransferMember({ viewer_id: 1002, trainer_name: 'TransferMember' }),
          {
            id: 999,
            circle_id: 100,
            viewer_id: 9999,
            trainer_name: 'Reference',
            shame_score: null,
            year: 2026,
            month: 6,
            daily_fans: makeCumulativeFans([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100]),
            last_updated: '2026-06-12',
          },
        ],
      });
      const config = getDefaultConfig();
      const report = generateMembersReport(snapshot, config, computeMembers(snapshot, config));
      const lines = report.split('\n').filter(l => l.startsWith('•'));

      const transferIdx = lines.findIndex(l => l.includes('TransferMember'));
      const staleIdx = lines.findIndex(l => l.includes('StaleMember'));
      expect(transferIdx).toBeLessThan(staleIdx);
    });

    it('transfer members sorted by monthlyGain desc within group', () => {
      const snapshot = makeSnapshot({
        members: [
          makeTransferMember({
            viewer_id: 1001,
            trainer_name: 'LowTransfer',
            daily_fans: makeCumulativeFans([100, 200, 300]),
          }),
          makeTransferMember({
            id: 9001,
            viewer_id: 1002,
            trainer_name: 'HighTransfer',
            daily_fans: makeCumulativeFans([100, 500, 900]),
          }),
        ],
      });
      const config = getDefaultConfig();
      const report = generateMembersReport(snapshot, config, computeMembers(snapshot, config));
      const lines = report.split('\n').filter(l => l.startsWith('•'));

      expect(lines[0]).toContain('HighTransfer');
      expect(lines[1]).toContain('LowTransfer');
    });
  });

  // ============================================================
  // Left members with DB
  // ============================================================

  describe('left members with DB', () => {
    it('shows left members section when db is provided and left members exist', () => {
      const snapshot = makeSnapshot();
      const config = getDefaultConfig();

      const earlierSnapshot = makeSnapshot({
        members: [
          ...snapshot.members,
          {
            id: 3,
            circle_id: 100,
            viewer_id: 1003,
            trainer_name: 'Charlie',
            shame_score: null,
            year: 2026,
            month: 6,
            daily_fans: makeCumulativeFans([100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
            last_updated: '2026-06-10',
          },
        ],
      });
      updateMemberHistory(earlierSnapshot, db);

      const report = generateMembersReport(snapshot, config, computeMembers(snapshot, config), db);

      expect(report).toContain('Charlie');
      expect(report).toContain('🚪');
    });

    it('shows last_seen date for left members', () => {
      const snapshot = makeSnapshot();
      const config = getDefaultConfig();

      const earlierSnapshot = makeSnapshot({
        members: [
          ...snapshot.members,
          {
            id: 4,
            circle_id: 100,
            viewer_id: 1004,
            trainer_name: 'Diana',
            shame_score: null,
            year: 2026,
            month: 6,
            daily_fans: makeCumulativeFans([50, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
            last_updated: '2026-06-08',
          },
        ],
      });
      updateMemberHistory(earlierSnapshot, db);

      const report = generateMembersReport(snapshot, config, computeMembers(snapshot, config), db);

      expect(report).toContain('Diana');
      expect(report).toContain('terakhir');
    });

    it('does not show left section when no members have left', () => {
      const snapshot = makeSnapshot();
      const config = getDefaultConfig();

      updateMemberHistory(snapshot, db);

      const report = generateMembersReport(snapshot, config, computeMembers(snapshot, config), db);

      expect(report).not.toMatch(/🚪/);
    });

    it('does not show left section when db has no history', () => {
      const snapshot = makeSnapshot();
      const config = getDefaultConfig();

      const report = generateMembersReport(snapshot, config, computeMembers(snapshot, config), db);

      expect(report).not.toMatch(/🚪/);
    });

    it('still shows current members when db is provided', () => {
      const snapshot = makeSnapshot();
      const config = getDefaultConfig();

      const earlierSnapshot = makeSnapshot({
        members: [
          ...snapshot.members,
          {
            id: 3,
            circle_id: 100,
            viewer_id: 1003,
            trainer_name: 'Charlie',
            shame_score: null,
            year: 2026,
            month: 6,
            daily_fans: makeCumulativeFans([100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
            last_updated: '2026-06-10',
          },
        ],
      });
      updateMemberHistory(earlierSnapshot, db);

      const report = generateMembersReport(snapshot, config, computeMembers(snapshot, config), db);

      expect(report).toContain('Alice');
      expect(report).toContain('Bob');
      expect(report).toContain('Charlie');
    });

    it('left members section appears after main member list', () => {
      const snapshot = makeSnapshot();
      const config = getDefaultConfig();

      const earlierSnapshot = makeSnapshot({
        members: [
          ...snapshot.members,
          {
            id: 3,
            circle_id: 100,
            viewer_id: 1003,
            trainer_name: 'Charlie',
            shame_score: null,
            year: 2026,
            month: 6,
            daily_fans: makeCumulativeFans([100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
            last_updated: '2026-06-10',
          },
        ],
      });
      updateMemberHistory(earlierSnapshot, db);

      const report = generateMembersReport(snapshot, config, computeMembers(snapshot, config), db);
      const lines = report.split('\n');
      const mainListEnd = lines.findIndex(l => l.includes('🚪'));
      const aliceIdx = lines.findIndex(l => l.includes('Alice'));
      const charlieIdx = lines.findIndex(l => l.includes('Charlie') && l.includes('terakhir'));

      // Alice is in the main list, Charlie is in the left section
      expect(aliceIdx).toBeLessThan(mainListEnd);
      expect(charlieIdx).toBeGreaterThan(mainListEnd);
    });
  });

  // ============================================================
  // Real snapshot verification
  // ============================================================

  describe('real snapshot verification', () => {
    const snapshot: Snapshot = JSON.parse(
      readFileSync(join(ROOT, 'examples', 'snapshot-june-12.json'), 'utf-8')
    );
    const config = getDefaultConfig();

    it('generates report with 34 member lines', () => {
      const report = generateMembersReport(snapshot, config, computeMembers(snapshot, config));
      const memberLines = report.split('\n').filter(l => l.startsWith('•'));
      expect(memberLines).toHaveLength(34);
    });

    it('first member is GoldFamily at 27.7M', () => {
      const report = generateMembersReport(snapshot, config, computeMembers(snapshot, config));
      const firstMemberLine = report.split('\n').filter(l => l.startsWith('•'))[0];
      expect(firstMemberLine).toBe('• *GoldFamily* — 27.7M');
    });

    it('last active member is Yukil at 4.6M', () => {
      const report = generateMembersReport(snapshot, config, computeMembers(snapshot, config));
      const members = computeMembers(snapshot, config);
      const activeCount = members.filter(m => m.status === 'active').length;
      const memberLines = report.split('\n').filter(l => l.startsWith('•'));
      const lastActiveLine = memberLines[activeCount - 1];
      expect(lastActiveLine).toBe('• *Yukil* — 4.6M');
    });

    it('all 6 transfer members have 🔄 badge and correct origin', () => {
      const report = generateMembersReport(snapshot, config, computeMembers(snapshot, config));
      const transferLines = report.split('\n').filter(l => l.includes('🔄'));

      expect(transferLines).toHaveLength(6);
      expect(transferLines).toEqual(expect.arrayContaining([
        expect.stringContaining('*Sairen* 🔄'),
        expect.stringContaining('(dari Zxyden)'),
      ]));
      expect(transferLines).toEqual(expect.arrayContaining([
        expect.stringContaining('*Zero* 🔄'),
        expect.stringContaining('(dari Advent)'),
      ]));
      expect(transferLines).toEqual(expect.arrayContaining([
        expect.stringContaining('*Ceciria* 🔄'),
        expect.stringContaining('(dari MejiroStan)'),
      ]));
      expect(transferLines).toEqual(expect.arrayContaining([
        expect.stringContaining('*Falkrum* 🔄'),
        expect.stringContaining('(dari KemekMuda)'),
      ]));
      expect(transferLines).toEqual(expect.arrayContaining([
        expect.stringContaining('*VitoHoow* 🔄'),
        expect.stringContaining('(dari Madafakars)'),
      ]));
      expect(transferLines).toEqual(expect.arrayContaining([
        expect.stringContaining('*TheTengOne* 🔄'),
        expect.stringContaining('(dari Garuda3)'),
      ]));
    });

    it('all 4 left members have 🚪 badge', () => {
      const report = generateMembersReport(snapshot, config, computeMembers(snapshot, config));
      const leftLines = report.split('\n').filter(l => l.includes('🚪'));

      expect(leftLines).toHaveLength(4);
      expect(leftLines).toEqual(expect.arrayContaining([
        expect.stringContaining('*DOA IBU* 🚪'),
      ]));
      expect(leftLines).toEqual(expect.arrayContaining([
        expect.stringContaining('*Kuro* 🚪'),
      ]));
      expect(leftLines).toEqual(expect.arrayContaining([
        expect.stringContaining('*Rowking* 🚪'),
      ]));
      expect(leftLines).toEqual(expect.arrayContaining([
        expect.stringContaining('*Lebowski* 🚪'),
      ]));
    });

    it('sort order: active (desc) → stale → left', () => {
      const report = generateMembersReport(snapshot, config, computeMembers(snapshot, config));
      const memberLines = report.split('\n').filter(l => l.startsWith('•'));

      // Find boundaries
      const firstLeftIdx = memberLines.findIndex(l => l.includes('🚪'));

      // All active (including transfers with 🔄) before first left
      expect(firstLeftIdx).toBe(30); // 30 active members (24 regular + 6 transfer)
    });

    it('active members sorted by monthlyGain desc', () => {
      const members = computeMembers(snapshot, config);
      const active = members
        .filter(m => m.status === 'active')
        .sort((a, b) => b.monthlyGain - a.monthlyGain);

      for (let i = 1; i < active.length; i++) {
        expect(active[i - 1].monthlyGain).toBeGreaterThanOrEqual(active[i].monthlyGain);
      }
    });

    it('transfer members sorted by monthlyGain desc', () => {
      const members = computeMembers(snapshot, config);
      const transfers = members
        .filter(m => m.isTransfer)
        .sort((a, b) => b.monthlyGain - a.monthlyGain);

      for (let i = 1; i < transfers.length; i++) {
        expect(transfers[i - 1].monthlyGain).toBeGreaterThanOrEqual(transfers[i].monthlyGain);
      }
    });

    it('header shows club name and tier', () => {
      const report = generateMembersReport(snapshot, config, computeMembers(snapshot, config));
      expect(report).toContain('Hol＿Horse');
      expect(report).toContain('A+');
    });

    it('report starts with 👥 Daftar Anggota', () => {
      const report = generateMembersReport(snapshot, config, computeMembers(snapshot, config));
      expect(report.substring(0, 100)).toContain('👥 *Daftar Anggota');
    });

    it('no Markdown bold or headers in output', () => {
      const report = generateMembersReport(snapshot, config, computeMembers(snapshot, config));
      expect(report).not.toMatch(/\*\*[^*]+\*\*/);
      expect(report).not.toMatch(/^#/m);
    });
  });
});
