/**
 * Tests for left member detection.
 *
 * Left member = existed in previous snapshot AND not in current snapshot.
 * Tests updateMemberHistory and getLeftMembers.
 */

import {
  updateMemberHistory,
  getLeftMembers,
} from "../../src/data/member-history";
import { SqliteDatabase } from "../../src/db/database";
import type { Snapshot, MemberData, MemberHistoryRow } from "../../src/types";
import { makeMember, makeSnapshot as makeSnapshotBase } from "../_helpers";

let db: SqliteDatabase;

beforeEach(async () => {
  db = new SqliteDatabase(":memory:");
  await db.initialize();
});

afterEach(async () => {
  await db.close();
});

function makeSnapshot(memberOverrides?: Partial<MemberData>[]): Snapshot {
  const overrides =
    memberOverrides !== undefined
      ? memberOverrides
      : [
          { viewer_id: 1001, trainer_name: "Alice" },
          { viewer_id: 1002, trainer_name: "Bob", id: 2 },
          { viewer_id: 1003, trainer_name: "Charlie", id: 3 },
        ];
  return makeSnapshotBase({ members: overrides.map((o) => makeMember(o)) });
}

describe("updateMemberHistory", () => {
  it("inserts all snapshot members into member_history", async () => {
    const snapshot = makeSnapshot();
    await updateMemberHistory(snapshot, db);

    const members = await db.getMembers(100);
    expect(members).toHaveLength(3);
    expect(members.map((m: MemberHistoryRow) => m.trainer_name).sort()).toEqual(
      ["Alice", "Bob", "Charlie"],
    );
  });

  it("sets status to active for all current members", async () => {
    const snapshot = makeSnapshot();
    await updateMemberHistory(snapshot, db);

    const members = await db.getMembers(100);
    for (const member of members) {
      expect(member.status).toBe("active");
    }
  });

  it("marks missing members as left on re-run", async () => {
    const snapshot1 = makeSnapshot();
    await updateMemberHistory(snapshot1, db);

    const snapshot2 = makeSnapshot([
      { viewer_id: 1001, trainer_name: "Alice" },
      { viewer_id: 1002, trainer_name: "Bob", id: 2 },
    ]);
    await updateMemberHistory(snapshot2, db);

    // Charlie should be marked as 'left' (still in table, not deleted)
    const charlie = await db.getMember(1003);
    expect(charlie).not.toBeNull();
    expect(charlie!.status).toBe("left");

    const alice = await db.getMember(1001);
    expect(alice!.status).toBe("active");
    const bob = await db.getMember(1002);
    expect(bob!.status).toBe("active");
  });

  it("stores transfer information when present", async () => {
    const snapshot = makeSnapshot([
      { viewer_id: 1001, trainer_name: "Alice" },
      {
        viewer_id: 1002,
        trainer_name: "NewGuy",
        id: 2,
        previous_circle_id: 200,
        previous_circle_name: "OldClub",
      },
    ]);
    await updateMemberHistory(snapshot, db);

    const member = await db.getMember(1002);
    expect(member).not.toBeNull();
    expect(member!.previous_circle_name).toBe("OldClub");
    expect(member!.previous_circle_id).toBe(200);
  });

  it("marks all members as left when snapshot is empty", async () => {
    const snapshot1 = makeSnapshot();
    await updateMemberHistory(snapshot1, db);

    const snapshot2 = makeSnapshot([]);
    await updateMemberHistory(snapshot2, db);

    const members = await db.getMembers(100);
    expect(members).toHaveLength(3);
    for (const m of members) {
      expect(m.status).toBe("left");
    }
  });

  it("uses snapshot circle_id for member_history", async () => {
    const snapshot = makeSnapshot([
      { viewer_id: 5001, trainer_name: "TestMember", circle_id: 999 },
    ]);
    await updateMemberHistory(snapshot, db);

    const member = await db.getMember(5001);
    expect(member).not.toBeNull();
    expect(member!.circle_id).toBe(999);
  });

  it("preserves first_seen on subsequent updates", async () => {
    const snapshot1 = makeSnapshot([
      { viewer_id: 1001, trainer_name: "Alice" },
    ]);
    await updateMemberHistory(snapshot1, db);

    const memberBefore = await db.getMember(1001);
    const firstSeenBefore = memberBefore!.first_seen;

    const snapshot2 = makeSnapshot([
      { viewer_id: 1001, trainer_name: "Alice" },
    ]);
    await updateMemberHistory(snapshot2, db);

    const memberAfter = await db.getMember(1001);
    expect(memberAfter!.first_seen).toBe(firstSeenBefore);
  });
});

describe("getLeftMembers", () => {
  it("detects members who were in history but not in current snapshot", async () => {
    const snapshot1 = makeSnapshot([
      { viewer_id: 1001, trainer_name: "Alice" },
      { viewer_id: 1002, trainer_name: "Bob", id: 2 },
      { viewer_id: 1003, trainer_name: "Charlie", id: 3 },
    ]);
    await updateMemberHistory(snapshot1, db);

    const snapshot2 = makeSnapshot([
      { viewer_id: 1001, trainer_name: "Alice" },
      { viewer_id: 1002, trainer_name: "Bob", id: 2 },
    ]);

    const left = await getLeftMembers(snapshot2, db);
    expect(left).toHaveLength(1);
    expect(left[0].viewer_id).toBe(1003);
    expect(left[0].trainer_name).toBe("Charlie");
  });

  it("returns empty array when no members left", async () => {
    const snapshot1 = makeSnapshot([
      { viewer_id: 1001, trainer_name: "Alice" },
      { viewer_id: 1002, trainer_name: "Bob", id: 2 },
    ]);
    await updateMemberHistory(snapshot1, db);

    const snapshot2 = makeSnapshot([
      { viewer_id: 1001, trainer_name: "Alice" },
      { viewer_id: 1002, trainer_name: "Bob", id: 2 },
    ]);

    const left = await getLeftMembers(snapshot2, db);
    expect(left).toHaveLength(0);
  });

  it("returns empty array when history is empty", async () => {
    const snapshot = makeSnapshot([{ viewer_id: 1001, trainer_name: "Alice" }]);

    const left = await getLeftMembers(snapshot, db);
    expect(left).toHaveLength(0);
  });

  it("detects multiple left members", async () => {
    const snapshot1 = makeSnapshot([
      { viewer_id: 1001, trainer_name: "Alice" },
      { viewer_id: 1002, trainer_name: "Bob", id: 2 },
      { viewer_id: 1003, trainer_name: "Charlie", id: 3 },
      { viewer_id: 1004, trainer_name: "Diana", id: 4 },
      { viewer_id: 1005, trainer_name: "Eve", id: 5 },
    ]);
    await updateMemberHistory(snapshot1, db);

    const snapshot2 = makeSnapshot([
      { viewer_id: 1001, trainer_name: "Alice" },
    ]);

    const left = await getLeftMembers(snapshot2, db);
    expect(left).toHaveLength(4);
    const leftNames = left.map((m: MemberHistoryRow) => m.trainer_name).sort();
    expect(leftNames).toEqual(["Bob", "Charlie", "Diana", "Eve"]);
  });

  it("handles snapshot with different circle_id", async () => {
    const snapshot1 = makeSnapshot([
      { viewer_id: 1001, trainer_name: "Alice" },
      { viewer_id: 1002, trainer_name: "Bob", id: 2 },
    ]);
    await updateMemberHistory(snapshot1, db);

    const snapshot2 = makeSnapshot([
      { viewer_id: 2001, trainer_name: "Xavier", circle_id: 200 },
    ]);
    // Override the snapshot's circle_id to 200
    snapshot2.circle = { ...snapshot2.circle, circle_id: 200 };

    const left = await getLeftMembers(snapshot2, db);
    expect(left).toHaveLength(0);
  });

  it("does not detect as left when member still exists", async () => {
    const snapshot1 = makeSnapshot([
      { viewer_id: 1001, trainer_name: "Alice" },
      { viewer_id: 1002, trainer_name: "Bob", id: 2 },
    ]);
    await updateMemberHistory(snapshot1, db);

    // Step 2: Same members present (just in different order)
    const snapshot2 = makeSnapshot([
      { viewer_id: 1002, trainer_name: "Bob", id: 2 },
      { viewer_id: 1001, trainer_name: "Alice" },
    ]);

    const left = await getLeftMembers(snapshot2, db);
    expect(left).toHaveLength(0);
  });

  it("detects left member alongside new member", async () => {
    const snapshot1 = makeSnapshot([
      { viewer_id: 1001, trainer_name: "Alice" },
      { viewer_id: 1002, trainer_name: "Bob", id: 2 },
    ]);
    await updateMemberHistory(snapshot1, db);

    const snapshot2 = makeSnapshot([
      { viewer_id: 1001, trainer_name: "Alice" },
      { viewer_id: 3001, trainer_name: "Charlie", id: 3 },
    ]);

    const left = await getLeftMembers(snapshot2, db);
    expect(left).toHaveLength(1);
    expect(left[0].viewer_id).toBe(1002);
    expect(left[0].trainer_name).toBe("Bob");
  });

  it("handles Unicode member names in left detection", async () => {
    // Step 1: Insert with Unicode name
    const snapshot1 = makeSnapshot([
      { viewer_id: 1001, trainer_name: "Alice" },
      { viewer_id: 1002, trainer_name: "\u30b9\u30bf\u30a4\u30eb", id: 2 },
    ]);
    await updateMemberHistory(snapshot1, db);

    const snapshot2 = makeSnapshot([
      { viewer_id: 1001, trainer_name: "Alice" },
    ]);

    const left = await getLeftMembers(snapshot2, db);
    expect(left).toHaveLength(1);
    expect(left[0].trainer_name).toBe("\u30b9\u30bf\u30a4\u30eb");
  });
});
