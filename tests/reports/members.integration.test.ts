/**
 * Integration tests for members report generator — left members with DB.
 *
 * These tests require real DB interaction because generateMembersReport
 * calls getLeftMembers which calls db.getMembers().
 */

import { generateMembersReport } from '../../src/reports/members';
import { computeMembers } from '../../src/reports/compute';
import { getDefaultConfig } from '../../src/config';
import { updateMemberHistory } from '../../src/data/member-history';
import { SqliteDatabase } from '../../src/db/database';
import type { Snapshot, MemberData } from '../../src/types';


function makeCumulativeFans(dailyValues: number[]): number[] {
  const arr = new Array(32).fill(0);
  for (let i = 0; i < dailyValues.length && i < 32; i++) {
    arr[i] = dailyValues[i];
  }
  return arr;
}

function makeMember(overrides: Partial<MemberData> = {}): MemberData {
  return {
    id: 1,
    circle_id: 100,
    viewer_id: 1001,
    trainer_name: 'Alice',
    shame_score: null,
    year: 2026,
    month: 6,
    daily_fans: makeCumulativeFans([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100]),
    last_updated: '2026-06-12',
    ...overrides,
  };
}

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
      makeMember({ viewer_id: 1001, trainer_name: 'Alice' }),
      makeMember({ viewer_id: 1002, trainer_name: 'Bob', id: 2 }),
    ],
    club_rank: 8,
    fans_to_next_tier: 500000,
    fans_to_lower_tier: 50000,
    yesterday_fans_to_next_tier: 600000,
    yesterday_fans_to_lower_tier: 40000,
    ...overrides,
  };
}


let db: SqliteDatabase;

beforeEach(async () => {
  db = new SqliteDatabase(':memory:');
  await db.initialize();
});

afterEach(() => {
  db.close();
});


describe('left members with DB', () => {
  it('shows left members section when db is provided and left members exist', async () => {
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
    await updateMemberHistory(earlierSnapshot, db);

    const report = await generateMembersReport(snapshot, config, computeMembers(snapshot, config), db);

    expect(report).toContain('Charlie');
    expect(report).toContain('🚪');
  });

  it('shows last_seen date for left members', async () => {
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
    await updateMemberHistory(earlierSnapshot, db);

    const report = await generateMembersReport(snapshot, config, computeMembers(snapshot, config), db);

    expect(report).toContain('Diana');
    expect(report).toContain('terakhir');
  });

  it('does not show left section when no members have left', async () => {
    const snapshot = makeSnapshot();
    const config = getDefaultConfig();

    await updateMemberHistory(snapshot, db);

    const report = await generateMembersReport(snapshot, config, computeMembers(snapshot, config), db);

    expect(report).not.toMatch(/🚪/);
  });

  it('does not show left section when db has no history', async () => {
    const snapshot = makeSnapshot();
    const config = getDefaultConfig();

    const report = await generateMembersReport(snapshot, config, computeMembers(snapshot, config), db);

    expect(report).not.toMatch(/🚪/);
  });

  it('still shows current members when db is provided', async () => {
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
    await updateMemberHistory(earlierSnapshot, db);

    const report = await generateMembersReport(snapshot, config, computeMembers(snapshot, config), db);

    expect(report).toContain('Alice');
    expect(report).toContain('Bob');
    expect(report).toContain('Charlie');
  });

  it('left members section appears after main member list', async () => {
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
    await updateMemberHistory(earlierSnapshot, db);

    const report = await generateMembersReport(snapshot, config, computeMembers(snapshot, config), db);
    const lines = report.split('\n');
    const mainListEnd = lines.findIndex(l => l.includes('🚪'));
    const aliceIdx = lines.findIndex(l => l.includes('Alice'));
    const charlieIdx = lines.findIndex(l => l.includes('Charlie') && l.includes('terakhir'));

    // Alice is in the main list, Charlie is in the left section
    expect(aliceIdx).toBeLessThan(mainListEnd);
    expect(charlieIdx).toBeGreaterThan(mainListEnd);
  });
});
