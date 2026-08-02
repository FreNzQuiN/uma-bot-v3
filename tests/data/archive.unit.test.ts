/**
 * Unit tests for ensureMonthSnapshot — the archive/retrieval gate.
 *
 * This function is the sole access point for monthly snapshot data:
 *   1. Check disk cache → if present and circle_id matches → return latest
 *   2. Cache miss / circle_id mismatch → fetch from uma.moe API
 *   3. Save to disk: current month uses getDataDate(), past months use the last day
 *   4. Return the snapshot
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Snapshot } from "../../src/types";
import { ensureMonthSnapshot, saveSnapshot } from "../../src/data/snapshot";
import { UmaMoeClient } from "../../src/api/uma-moe";
import * as timezone from "../../src/utils/timezone";

function makeSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    circle: {
      circle_id: 1,
      name: "TestCircle",
      comment: "test",
      leader_viewer_id: 100,
      leader_name: "Leader",
      member_count: 1,
      join_style: 1,
      policy: 1,
      created_at: "2026-01-01T00:00:00Z",
      last_updated: "2026-06-11T00:00:00Z",
      monthly_rank: 1,
      monthly_point: 1000,
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
        circle_id: 1,
        viewer_id: 200,
        trainer_name: "Trainer1",
        shame_score: null,
        year: 2026,
        month: 6,
        daily_fans: new Array(32).fill(0),
        last_updated: "2026-06-11T00:00:00Z",
      },
    ],
    club_rank: 5,
    fans_to_next_tier: 1000000,
    fans_to_lower_tier: 500000,
    yesterday_fans_to_next_tier: 900000,
    yesterday_fans_to_lower_tier: 400000,
    ...overrides,
  };
}

function createFilledFans(lastPositiveDay: number): number[] {
  const fans = new Array(32).fill(0);
  for (let i = 0; i < lastPositiveDay; i++) {
    fans[i] = (i + 1) * 1000;
  }
  return fans;
}

/** April 2026 snapshot for circle 12345 with the given club rank. */
function makeAprilSnap(clubRank: number): Snapshot {
  return makeSnapshot({
    circle: { ...makeSnapshot().circle, circle_id: 12345 },
    members: [
      {
        ...makeSnapshot().members[0],
        year: 2026,
        month: 4,
        daily_fans: createFilledFans(30),
      },
    ],
    club_rank: clubRank,
  });
}

/** "Now" is June 15, 2026 JST — June is the current month for the boundary tests. */
function mockJstDate(): void {
  jest.spyOn(timezone, "getDataDateComponents").mockReturnValue({
    year: 2026,
    month: 6,
    day: 15,
  });
  jest.spyOn(timezone, "getDataDay").mockReturnValue(15);
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "archive-test-"));
  jest.spyOn(timezone, "getDataDay").mockReturnValue(15);
});

afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("ensureMonthSnapshot", () => {
  test("cacheHit_returnsCachedSnapshot", async () => {
    const snap1 = makeAprilSnap(10);
    const snap2 = makeAprilSnap(25);
    saveSnapshot(snap1, "2026-04-10", tmpDir);
    saveSnapshot(snap2, "2026-04-25", tmpDir);

    const mockClient = {
      fetchCircleData: jest
        .fn<Promise<Snapshot>, [number, number, number]>()
        .mockRejectedValue(new Error("should not be called")),
    } as unknown as UmaMoeClient;

    const result = await ensureMonthSnapshot(
      mockClient,
      12345,
      2026,
      4,
      tmpDir,
    );

    // Should return the latest cached snapshot (day 25)
    expect(result.club_rank).toBe(25);
    expect(mockClient.fetchCircleData).not.toHaveBeenCalled();
  });

  test("cacheHit_validatesCircleId", async () => {
    const cachedSnap = makeSnapshot({
      circle: { ...makeSnapshot().circle, circle_id: 999 },
      members: [
        {
          ...makeSnapshot().members[0],
          year: 2026,
          month: 4,
          daily_fans: createFilledFans(30),
        },
      ],
    });
    saveSnapshot(cachedSnap, "2026-04-25", tmpDir);

    const baseSnap = makeSnapshot();
    const apiSnap: Snapshot = {
      ...baseSnap,
      circle: {
        ...baseSnap.circle,
        circle_id: 12345,
        last_updated: "2026-06-12T14:00:00Z",
      },
      members: [
        {
          id: 1,
          circle_id: 12345,
          viewer_id: 200,
          trainer_name: "Trainer1",
          shame_score: null,
          year: 2026,
          month: 4,
          daily_fans: createFilledFans(30),
          last_updated: "2026-06-12T14:00:00Z",
        },
      ],
      club_rank: 42,
    };
    const mockClient = {
      fetchCircleData: jest
        .fn<Promise<Snapshot>, [number, number, number]>()
        .mockResolvedValue(apiSnap),
    } as unknown as UmaMoeClient;

    const result = await ensureMonthSnapshot(
      mockClient,
      12345,
      2026,
      4,
      tmpDir,
    );

    expect(mockClient.fetchCircleData).toHaveBeenCalledWith(12345, 2026, 4);
    expect(result).toBe(apiSnap);
    expect(result.club_rank).toBe(42);
  });

  test("cacheMiss_fetchesAndSavesPastMonth", async () => {
    // Lock timezone so April is treated as a past month
    mockJstDate();

    const apiSnap = makeSnapshot({
      circle: { ...makeSnapshot().circle, circle_id: 12345 },
      members: [
        {
          ...makeSnapshot().members[0],
          year: 2026,
          month: 4,
          daily_fans: createFilledFans(30),
        },
      ],
    });
    const mockClient = {
      fetchCircleData: jest
        .fn<Promise<Snapshot>, [number, number, number]>()
        .mockResolvedValue(apiSnap),
    } as unknown as UmaMoeClient;

    const result = await ensureMonthSnapshot(
      mockClient,
      12345,
      2026,
      4,
      tmpDir,
    );

    // April has 30 days — past month saves on the last day
    const expectedPath = path.join(
      tmpDir,
      "data",
      "snapshots",
      "2026",
      "04",
      "30.json",
    );
    expect(fs.existsSync(expectedPath)).toBe(true);
    expect(result).toBe(apiSnap);
    expect(result.club_rank).toBe(5);
    expect(mockClient.fetchCircleData).toHaveBeenCalledTimes(1);
  });

  test("cacheMiss_fetchesAndSavesCurrentMonth", async () => {
    // Lock timezone so June is treated as the current month
    mockJstDate();

    const apiSnap = makeSnapshot({
      circle: { ...makeSnapshot().circle, circle_id: 12345 },
      members: [
        {
          ...makeSnapshot().members[0],
          year: 2026,
          month: 6,
          daily_fans: createFilledFans(15),
        },
      ],
    });
    const mockClient = {
      fetchCircleData: jest
        .fn<Promise<Snapshot>, [number, number, number]>()
        .mockResolvedValue(apiSnap),
    } as unknown as UmaMoeClient;

    const result = await ensureMonthSnapshot(
      mockClient,
      12345,
      2026,
      6,
      tmpDir,
    );

    // Current month: file path derived from snapshot data (day 15)
    const expectedPath = path.join(
      tmpDir,
      "data",
      "snapshots",
      "2026",
      "06",
      "15.json",
    );
    expect(fs.existsSync(expectedPath)).toBe(true);
    expect(result).toBe(apiSnap);
    expect(mockClient.fetchCircleData).toHaveBeenCalledTimes(1);
  });

  test("cacheMiss_throwsWhenApiFails", async () => {
    const mockClient = {
      fetchCircleData: jest
        .fn<Promise<Snapshot>, [number, number, number]>()
        .mockRejectedValue(new Error("API is down")),
    } as unknown as UmaMoeClient;

    await expect(
      ensureMonthSnapshot(mockClient, 12345, 2026, 4, tmpDir),
    ).rejects.toThrow("No snapshot available for 2026-04");

    expect(mockClient.fetchCircleData).toHaveBeenCalledTimes(1);
  });

  test("handlesDecemberToJanuaryBoundary", async () => {
    // Lock timezone to June 2026 — Jan 2027 is a past month
    mockJstDate();

    const apiSnap = makeSnapshot({
      circle: { ...makeSnapshot().circle, circle_id: 12345 },
      members: [
        {
          ...makeSnapshot().members[0],
          year: 2027,
          month: 1,
          daily_fans: createFilledFans(31),
        },
      ],
    });
    const mockClient = {
      fetchCircleData: jest
        .fn<Promise<Snapshot>, [number, number, number]>()
        .mockResolvedValue(apiSnap),
    } as unknown as UmaMoeClient;

    const result = await ensureMonthSnapshot(
      mockClient,
      12345,
      2027,
      1,
      tmpDir,
    );

    // January has 31 days, past month with full data → saves on Jan 31
    const expectedPath = path.join(
      tmpDir,
      "data",
      "snapshots",
      "2027",
      "01",
      "31.json",
    );
    expect(fs.existsSync(expectedPath)).toBe(true);
    expect(result).toBe(apiSnap);
    expect(mockClient.fetchCircleData).toHaveBeenCalledTimes(1);
  });
});
