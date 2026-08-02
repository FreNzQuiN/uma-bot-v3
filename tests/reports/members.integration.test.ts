/**
 * Integration tests for members report generator — left members with DB.
 *
 * These tests require real DB interaction because generateMembersReport
 * calls getLeftMembers which calls db.getMembers().
 */

import { generateMembersReport } from "../../src/reports/members";
import { computeMembers } from "../../src/reports/compute";
import { getDefaultConfig } from "../../src/config";
import { updateMemberHistory } from "../../src/data/member-history";
import { SqliteDatabase } from "../../src/db/database";
import { makeCumulativeFans, makeSnapshot } from "../_helpers";
import type { MemberData } from "../../src/types";

let db: SqliteDatabase;

beforeEach(async () => {
  db = new SqliteDatabase(":memory:");
  await db.initialize();
});

afterEach(() => {
  db.close();
});

async function seedLeftMember(
  db: SqliteDatabase,
  overrides: Partial<MemberData> = {},
): Promise<void> {
  const snapshot = makeSnapshot();
  await updateMemberHistory(
    makeSnapshot({
      members: [
        ...snapshot.members,
        {
          id: 3,
          circle_id: 100,
          viewer_id: 1003,
          trainer_name: "Charlie",
          shame_score: null,
          year: 2026,
          month: 6,
          daily_fans: makeCumulativeFans([100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
          last_updated: "2026-06-10",
          ...overrides,
        },
      ],
    }),
    db,
  );
}

describe("left members with DB", () => {
  it("shows left members section when db is provided and left members exist", async () => {
    const snapshot = makeSnapshot();
    const config = getDefaultConfig();

    await seedLeftMember(db);

    const report = await generateMembersReport(
      snapshot,
      config,
      computeMembers(snapshot, config),
      db,
    );

    expect(report).toContain("Charlie");
    expect(report).toContain("🚪");
  });

  it("shows last_seen date for left members", async () => {
    const snapshot = makeSnapshot();
    const config = getDefaultConfig();

    await seedLeftMember(db, {
      id: 4,
      viewer_id: 1004,
      trainer_name: "Diana",
      daily_fans: makeCumulativeFans([50, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      last_updated: "2026-06-08",
    });

    const report = await generateMembersReport(
      snapshot,
      config,
      computeMembers(snapshot, config),
      db,
    );

    expect(report).toContain("Diana");
    expect(report).toContain("terakhir");
  });

  it("does not show left section when no members have left", async () => {
    const snapshot = makeSnapshot();
    const config = getDefaultConfig();

    await updateMemberHistory(snapshot, db);

    const report = await generateMembersReport(
      snapshot,
      config,
      computeMembers(snapshot, config),
      db,
    );

    expect(report).not.toMatch(/🚪/);
  });

  it("does not show left section when db has no history", async () => {
    const snapshot = makeSnapshot();
    const config = getDefaultConfig();

    const report = await generateMembersReport(
      snapshot,
      config,
      computeMembers(snapshot, config),
      db,
    );

    expect(report).not.toMatch(/🚪/);
  });

  it("still shows current members when db is provided", async () => {
    const snapshot = makeSnapshot();
    const config = getDefaultConfig();

    await seedLeftMember(db);

    const report = await generateMembersReport(
      snapshot,
      config,
      computeMembers(snapshot, config),
      db,
    );

    expect(report).toContain("Alice");
    expect(report).toContain("Bob");
    expect(report).toContain("Charlie");
  });

  it("left members section appears after main member list", async () => {
    const snapshot = makeSnapshot();
    const config = getDefaultConfig();

    await seedLeftMember(db);

    const report = await generateMembersReport(
      snapshot,
      config,
      computeMembers(snapshot, config),
      db,
    );
    const lines = report.split("\n");
    const mainListEnd = lines.findIndex((l) => l.includes("🚪"));
    const aliceIdx = lines.findIndex((l) => l.includes("Alice"));
    const charlieIdx = lines.findIndex(
      (l) => l.includes("Charlie") && l.includes("terakhir"),
    );

    expect(aliceIdx).toBeLessThan(mainListEnd);
    expect(charlieIdx).toBeGreaterThan(mainListEnd);
  });
});
