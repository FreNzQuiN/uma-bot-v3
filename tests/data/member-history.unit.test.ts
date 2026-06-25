/**
 * Tests for member-history.ts — updateMemberHistory and getLeftMembers.
 */

import { updateMemberHistory, getLeftMembers } from '../../src/data/member-history';
import { SqliteDatabase } from '../../src/db/database';
import type { Snapshot, MemberData } from '../../src/types';

let db: SqliteDatabase;

beforeEach(async () => {
  db = new SqliteDatabase(':memory:');
  await db.initialize();
});

afterEach(async () => {
  await db.close();
});

// ============================================================
// Helpers
// ============================================================

function makeMember(overrides: Partial<MemberData> = {}): MemberData {
  return {
    id: 1,
    circle_id: 100,
    viewer_id: 1001,
    trainer_name: 'Alice',
    shame_score: null,
    year: 2026,
    month: 6,
    daily_fans: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 100, 200, 300, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    last_updated: '2026-06-12',
    ...overrides,
  };
}

function makeSnapshot(memberOverrides?: Partial<MemberData>[]): Snapshot {
  const defaultMembers: MemberData[] = [
    makeMember({ viewer_id: 1001, trainer_name: 'Alice' }),
    makeMember({ viewer_id: 1002, trainer_name: 'Bob', id: 2 }),
  ];

  const members = memberOverrides !== undefined
    ? memberOverrides.map((o) => makeMember(o))
    : defaultMembers;

  return {
    circle: {
      circle_id: 100,
      name: 'TestClub',
      comment: '',
      leader_viewer_id: 1,
      leader_name: 'Leader',
      member_count: members.length,
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
    members,
    club_rank: 8,
    fans_to_next_tier: 500000,
    fans_to_lower_tier: 50000,
    yesterday_fans_to_next_tier: 600000,
    yesterday_fans_to_lower_tier: 40000,
  };
}

// ============================================================
// updateMemberHistory
// ============================================================

describe('updateMemberHistory', () => {
  it('inserts new members', async () => {
    const snapshot = makeSnapshot();
    await updateMemberHistory(snapshot, db);

    const members = await db.getMembers(100);
    expect(members).toHaveLength(2);
    const names = members.map((m) => m.trainer_name).sort();
    expect(names).toEqual(['Alice', 'Bob']);
  });

  it('updates existing members on re-run', async () => {
    // First run
    const snapshot1 = makeSnapshot([
      { viewer_id: 1001, trainer_name: 'Alice' },
    ]);
    await updateMemberHistory(snapshot1, db);

    const firstSeen = (await db.getMember(1001))!.first_seen;

    // Second run — same viewer_id, updated name
    const snapshot2 = makeSnapshot([
      { viewer_id: 1001, trainer_name: 'AliceUpdated' },
    ]);
    await updateMemberHistory(snapshot2, db);

    const member = await db.getMember(1001);
    expect(member).not.toBeNull();
    expect(member!.trainer_name).toBe('AliceUpdated');
    // first_seen should be preserved from the first insert
    expect(member!.first_seen).toBe(firstSeen);
  });

  it('marks missing members as left', async () => {
    // First run: Alice, Bob
    const snapshot1 = makeSnapshot();
    await updateMemberHistory(snapshot1, db);

    // Second run: only Alice
    const snapshot2 = makeSnapshot([
      { viewer_id: 1001, trainer_name: 'Alice' },
    ]);
    await updateMemberHistory(snapshot2, db);

    const bob = await db.getMember(1002);
    expect(bob).not.toBeNull();
    expect(bob!.status).toBe('left');

    const alice = await db.getMember(1001);
    expect(alice!.status).toBe('active');
  });
});

// ============================================================
// getLeftMembers
// ============================================================

describe('getLeftMembers', () => {
  it('returns members with status left', async () => {
    // First run: Alice, Bob, Charlie
    const snapshot1 = makeSnapshot([
      { viewer_id: 1001, trainer_name: 'Alice' },
      { viewer_id: 1002, trainer_name: 'Bob', id: 2 },
      { viewer_id: 1003, trainer_name: 'Charlie', id: 3 },
    ]);
    await updateMemberHistory(snapshot1, db);

    // Second run: only Alice (Bob and Charlie left)
    const snapshot2 = makeSnapshot([
      { viewer_id: 1001, trainer_name: 'Alice' },
    ]);
    await updateMemberHistory(snapshot2, db);

    const left = await getLeftMembers(snapshot2, db);
    expect(left).toHaveLength(2);
    const leftNames = left.map((m) => m.trainer_name).sort();
    expect(leftNames).toEqual(['Bob', 'Charlie']);
    for (const m of left) {
      expect(m.status).toBe('left');
    }
  });
});
