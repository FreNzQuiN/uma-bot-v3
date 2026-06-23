/**
 * Tests for left member detection.
 *
 * Left member = existed in previous snapshot AND not in current snapshot.
 * Tests updateMemberHistory and getLeftMembers.
 */

import { updateMemberHistory, getLeftMembers } from '../../src/data/member-history';
import { Database } from '../../src/db/database';
import type { Snapshot, MemberData } from '../../src/types';

let db: Database;

beforeEach(async () => {
  db = new Database(':memory:');
  await db.initialize();
});

afterEach(() => {
  db.close();
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
    makeMember({ viewer_id: 1003, trainer_name: 'Charlie', id: 3 }),
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
  it('inserts all snapshot members into member_history', () => {
    const snapshot = makeSnapshot();
    updateMemberHistory(snapshot, db);

    const members = db.getMembers(100);
    expect(members).toHaveLength(3);
    expect(members.map((m: any) => m.trainer_name).sort()).toEqual(['Alice', 'Bob', 'Charlie']);
  });

  it('sets status to active for all current members', () => {
    const snapshot = makeSnapshot();
    updateMemberHistory(snapshot, db);

    const members = db.getMembers(100);
    for (const member of members) {
      expect(member.status).toBe('active');
    }
  });

  it('marks missing members as left on re-run', () => {
    // First run: Alice, Bob, Charlie
    const snapshot1 = makeSnapshot();
    updateMemberHistory(snapshot1, db);

    // Second run: only Alice, Bob (Charlie not present)
    const snapshot2 = makeSnapshot([
      { viewer_id: 1001, trainer_name: 'Alice' },
      { viewer_id: 1002, trainer_name: 'Bob', id: 2 },
    ]);
    updateMemberHistory(snapshot2, db);

    // Charlie should be marked as 'left' (still in table, not deleted)
    const charlie = db.getMember(1003);
    expect(charlie).not.toBeNull();
    expect(charlie!.status).toBe('left');

    // Alice and Bob should still be active
    const alice = db.getMember(1001);
    expect(alice!.status).toBe('active');
    const bob = db.getMember(1002);
    expect(bob!.status).toBe('active');
  });

  it('stores transfer information when present', () => {
    const snapshot = makeSnapshot([
      { viewer_id: 1001, trainer_name: 'Alice' },
      { viewer_id: 1002, trainer_name: 'NewGuy', id: 2, previous_circle_id: 200, previous_circle_name: 'OldClub' },
    ]);
    updateMemberHistory(snapshot, db);

    const member = db.getMember(1002);
    expect(member).not.toBeNull();
    expect(member!.previous_circle_name).toBe('OldClub');
    expect(member!.previous_circle_id).toBe(200);
  });

  it('marks all members as left when snapshot is empty', () => {
    // First run: insert 3 members
    const snapshot1 = makeSnapshot();
    updateMemberHistory(snapshot1, db);

    // Second run: empty snapshot
    const snapshot2 = makeSnapshot([]);
    updateMemberHistory(snapshot2, db);

    // All members should be marked as 'left'
    const members = db.getMembers(100);
    expect(members).toHaveLength(3);
    for (const m of members) {
      expect(m.status).toBe('left');
    }
  });

  it('uses snapshot circle_id for member_history', () => {
    const snapshot = makeSnapshot([
      { viewer_id: 5001, trainer_name: 'TestMember', circle_id: 999 },
    ]);
    updateMemberHistory(snapshot, db);

    const member = db.getMember(5001);
    expect(member).not.toBeNull();
    expect(member!.circle_id).toBe(999);
  });

  it('preserves first_seen on subsequent updates', () => {
    // First run
    const snapshot1 = makeSnapshot([
      { viewer_id: 1001, trainer_name: 'Alice' },
    ]);
    updateMemberHistory(snapshot1, db);

    const memberBefore = db.getMember(1001);
    const firstSeenBefore = memberBefore!.first_seen;

    // Second run — first_seen should NOT change
    const snapshot2 = makeSnapshot([
      { viewer_id: 1001, trainer_name: 'Alice' },
    ]);
    updateMemberHistory(snapshot2, db);

    const memberAfter = db.getMember(1001);
    expect(memberAfter!.first_seen).toBe(firstSeenBefore);
  });
});

// ============================================================
// getLeftMembers
// ============================================================

describe('getLeftMembers', () => {
  it('detects members who were in history but not in current snapshot', () => {
    // Step 1: Insert 3 members via snapshot
    const snapshot1 = makeSnapshot([
      { viewer_id: 1001, trainer_name: 'Alice' },
      { viewer_id: 1002, trainer_name: 'Bob', id: 2 },
      { viewer_id: 1003, trainer_name: 'Charlie', id: 3 },
    ]);
    updateMemberHistory(snapshot1, db);

    // Step 2: Current snapshot has only Alice and Bob
    const snapshot2 = makeSnapshot([
      { viewer_id: 1001, trainer_name: 'Alice' },
      { viewer_id: 1002, trainer_name: 'Bob', id: 2 },
    ]);

    const left = getLeftMembers(snapshot2, db);
    expect(left).toHaveLength(1);
    expect(left[0].viewer_id).toBe(1003);
    expect(left[0].trainer_name).toBe('Charlie');
  });

  it('returns empty array when no members left', () => {
    // Step 1: Insert 2 members
    const snapshot1 = makeSnapshot([
      { viewer_id: 1001, trainer_name: 'Alice' },
      { viewer_id: 1002, trainer_name: 'Bob', id: 2 },
    ]);
    updateMemberHistory(snapshot1, db);

    // Step 2: Same members present
    const snapshot2 = makeSnapshot([
      { viewer_id: 1001, trainer_name: 'Alice' },
      { viewer_id: 1002, trainer_name: 'Bob', id: 2 },
    ]);

    const left = getLeftMembers(snapshot2, db);
    expect(left).toHaveLength(0);
  });

  it('returns empty array when history is empty', () => {
    const snapshot = makeSnapshot([
      { viewer_id: 1001, trainer_name: 'Alice' },
    ]);

    const left = getLeftMembers(snapshot, db);
    expect(left).toHaveLength(0);
  });

  it('detects multiple left members', () => {
    // Step 1: Insert 5 members
    const snapshot1 = makeSnapshot([
      { viewer_id: 1001, trainer_name: 'Alice' },
      { viewer_id: 1002, trainer_name: 'Bob', id: 2 },
      { viewer_id: 1003, trainer_name: 'Charlie', id: 3 },
      { viewer_id: 1004, trainer_name: 'Diana', id: 4 },
      { viewer_id: 1005, trainer_name: 'Eve', id: 5 },
    ]);
    updateMemberHistory(snapshot1, db);

    // Step 2: Only Alice remains
    const snapshot2 = makeSnapshot([
      { viewer_id: 1001, trainer_name: 'Alice' },
    ]);

    const left = getLeftMembers(snapshot2, db);
    expect(left).toHaveLength(4);
    const leftNames = left.map((m: any) => m.trainer_name).sort();
    expect(leftNames).toEqual(['Bob', 'Charlie', 'Diana', 'Eve']);
  });

  it('handles snapshot with different circle_id', () => {
    // Step 1: Insert members for circle 100
    const snapshot1 = makeSnapshot([
      { viewer_id: 1001, trainer_name: 'Alice' },
      { viewer_id: 1002, trainer_name: 'Bob', id: 2 },
    ]);
    updateMemberHistory(snapshot1, db);

    // Step 2: Current snapshot for circle 200 — no history for circle 200
    const snapshot2 = makeSnapshot([
      { viewer_id: 2001, trainer_name: 'Xavier', circle_id: 200 },
    ]);
    // Override the snapshot's circle_id to 200
    snapshot2.circle = { ...snapshot2.circle, circle_id: 200 };

    const left = getLeftMembers(snapshot2, db);
    expect(left).toHaveLength(0);
  });

  it('does not detect as left when member still exists', () => {
    // Step 1: Insert members
    const snapshot1 = makeSnapshot([
      { viewer_id: 1001, trainer_name: 'Alice' },
      { viewer_id: 1002, trainer_name: 'Bob', id: 2 },
    ]);
    updateMemberHistory(snapshot1, db);

    // Step 2: Same members present (just in different order)
    const snapshot2 = makeSnapshot([
      { viewer_id: 1002, trainer_name: 'Bob', id: 2 },
      { viewer_id: 1001, trainer_name: 'Alice' },
    ]);

    const left = getLeftMembers(snapshot2, db);
    expect(left).toHaveLength(0);
  });

  it('detects left member alongside new member', () => {
    // Step 1: Alice, Bob
    const snapshot1 = makeSnapshot([
      { viewer_id: 1001, trainer_name: 'Alice' },
      { viewer_id: 1002, trainer_name: 'Bob', id: 2 },
    ]);
    updateMemberHistory(snapshot1, db);

    // Step 2: Alice, Charlie (Bob left, Charlie joined)
    const snapshot2 = makeSnapshot([
      { viewer_id: 1001, trainer_name: 'Alice' },
      { viewer_id: 3001, trainer_name: 'Charlie', id: 3 },
    ]);

    const left = getLeftMembers(snapshot2, db);
    expect(left).toHaveLength(1);
    expect(left[0].viewer_id).toBe(1002);
    expect(left[0].trainer_name).toBe('Bob');
  });

  it('handles Unicode member names in left detection', () => {
    // Step 1: Insert with Unicode name
    const snapshot1 = makeSnapshot([
      { viewer_id: 1001, trainer_name: 'Alice' },
      { viewer_id: 1002, trainer_name: '\u30b9\u30bf\u30a4\u30eb', id: 2 },
    ]);
    updateMemberHistory(snapshot1, db);

    // Step 2: Only Alice
    const snapshot2 = makeSnapshot([
      { viewer_id: 1001, trainer_name: 'Alice' },
    ]);

    const left = getLeftMembers(snapshot2, db);
    expect(left).toHaveLength(1);
    expect(left[0].trainer_name).toBe('\u30b9\u30bf\u30a4\u30eb');
  });
});
