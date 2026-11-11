/**
 * Tests for fetchAndSaveSnapshot — fetch decision logic and persistence.
 *
 * The retry loop sleeps up to 5 minutes per iteration; most tests keep
 * maxWaitMs at 0 (stale last_updated) or make the fetch succeed on the
 * first attempt, so they never sleep. The backoff regression test uses
 * fake timers to assert the first retry waits 5 minutes, not 5 hours.
 */

import {
  fetchAndSaveSnapshot,
  SnapshotSaveError,
} from "../../src/data/fetch-snapshot";
import type { Snapshot } from "../../src/types";

jest.mock("../../src/data/snapshot");
jest.mock("../../src/utils/timezone");

import { loadMonthSnapshot, saveSnapshot } from "../../src/data/snapshot";
import { getDataDateComponents, getDataDay } from "../../src/utils/timezone";

const mockedLoad = loadMonthSnapshot as jest.MockedFunction<
  typeof loadMonthSnapshot
>;
const mockedSave = saveSnapshot as jest.MockedFunction<typeof saveSnapshot>;
const mockedComponents = getDataDateComponents as jest.MockedFunction<
  typeof getDataDateComponents
>;
const mockedDay = getDataDay as jest.MockedFunction<typeof getDataDay>;

function makeSnapshot(
  year: number,
  month: number,
  dataDay: number,
  circleId = 100,
  lastUpdated = "2020-01-01T00:00:00Z",
  memberCount = 1,
): Snapshot {
  return {
    circle: {
      circle_id: circleId,
      name: "TestClub",
      comment: "",
      leader_viewer_id: 1,
      leader_name: "Leader",
      member_count: memberCount,
      join_style: 0,
      policy: 0,
      created_at: "",
      last_updated: lastUpdated,
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
    members: Array.from({ length: memberCount }, (_, i) => ({
      id: i + 1,
      circle_id: circleId,
      viewer_id: 1001 + i,
      trainer_name: `Ryu${i}`,
      shame_score: null,
      year,
      month,
      daily_fans: new Array(dataDay).fill(1000),
      last_updated: lastUpdated,
    })),
    club_rank: 8,
    fans_to_next_tier: 500000,
    fans_to_lower_tier: 50000,
    yesterday_fans_to_next_tier: 600000,
    yesterday_fans_to_lower_tier: 40000,
  };
}

const umaMoe = {
  fetchCircleData: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  // clearAllMocks resets calls but not implementations set by earlier tests
  mockedSave.mockImplementation(() => "");
  // "Now" is June 2026, JST day 12.
  mockedComponents.mockReturnValue({ year: 2026, month: 6, day: 12 });
  mockedDay.mockReturnValue(12);
});

describe("fetchAndSaveSnapshot", () => {
  it("saves a fetched current-month snapshot using the data-derived file date", async () => {
    mockedLoad.mockReturnValue(null);
    const fetched = makeSnapshot(2026, 6, 11);
    umaMoe.fetchCircleData.mockResolvedValue(fetched);

    const result = await fetchAndSaveSnapshot(umaMoe, 100, 2026, 6, {
      rootDir: "/tmp/test",
    });

    expect(result.saved).toBe(true);
    expect(result.snapshot).toBe(fetched);
    expect(mockedSave).toHaveBeenCalledWith(fetched, "2026-06-11", "/tmp/test");
  });

  it("saves a past-month snapshot on a single attempt", async () => {
    mockedLoad.mockReturnValue(null);
    const fetched = makeSnapshot(2026, 5, 31);
    umaMoe.fetchCircleData.mockResolvedValue(fetched);

    const result = await fetchAndSaveSnapshot(umaMoe, 100, 2026, 5, {
      rootDir: "/tmp/test",
    });

    expect(result.saved).toBe(true);
    expect(mockedSave).toHaveBeenCalledWith(fetched, "2026-05-31", "/tmp/test");
  });

  it("returns the existing snapshot without saving when the fetch fails", async () => {
    const existing = makeSnapshot(2026, 6, 5);
    mockedLoad.mockReturnValue(existing);
    umaMoe.fetchCircleData.mockRejectedValue(new Error("network down"));

    const result = await fetchAndSaveSnapshot(umaMoe, 100, 2026, 6, {
      rootDir: "/tmp/test",
    });

    expect(result.saved).toBe(false);
    expect(result.snapshot).toBe(existing);
    expect(mockedSave).not.toHaveBeenCalled();
  });

  it("propagates save failures instead of swallowing them", async () => {
    mockedLoad.mockReturnValue(null);
    const fetched = makeSnapshot(2026, 6, 11);
    umaMoe.fetchCircleData.mockResolvedValue(fetched);
    mockedSave.mockImplementation(() => {
      throw new Error("disk full");
    });

    await expect(
      fetchAndSaveSnapshot(umaMoe, 100, 2026, 6, { rootDir: "/tmp/test" }),
    ).rejects.toThrow(SnapshotSaveError);
  });

  describe("force mode", () => {
    it("always contacts uma.moe even when the cached snapshot is fresh", async () => {
      // dataDay 11 with JST day 12 → normal path would return "fresh" without fetching
      const existing = makeSnapshot(2026, 6, 11);
      mockedLoad.mockReturnValue(existing);
      const fetched = makeSnapshot(2026, 6, 12);
      umaMoe.fetchCircleData.mockResolvedValue(fetched);

      const result = await fetchAndSaveSnapshot(umaMoe, 100, 2026, 6, {
        rootDir: "/tmp/test",
        force: true,
      });

      expect(umaMoe.fetchCircleData).toHaveBeenCalledTimes(1);
      expect(result.saved).toBe(true);
      expect(mockedSave).toHaveBeenCalledWith(
        fetched,
        "2026-06-12",
        "/tmp/test",
      );
    });

    it("makes a single attempt without sleeping when data is behind", async () => {
      jest.useFakeTimers();
      try {
        // 1h-old data → normal path would enter the retry loop and sleep 5m
        const existing = makeSnapshot(2026, 6, 5);
        existing.circle.last_updated = new Date(
          Date.now() - 60 * 60_000,
        ).toISOString();
        mockedLoad.mockReturnValue(existing);
        const stale = makeSnapshot(2026, 6, 6);
        umaMoe.fetchCircleData.mockResolvedValue(stale);

        const promise = fetchAndSaveSnapshot(umaMoe, 100, 2026, 6, {
          rootDir: "/tmp/test",
          force: true,
        });
        await jest.advanceTimersByTimeAsync(5 * 60_000);
        await promise;

        expect(umaMoe.fetchCircleData).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });

    it("does not save when uma.moe returns data older than the existing snapshot", async () => {
      const existing = makeSnapshot(2026, 6, 12);
      mockedLoad.mockReturnValue(existing);
      const older = makeSnapshot(2026, 6, 11);
      umaMoe.fetchCircleData.mockResolvedValue(older);

      const result = await fetchAndSaveSnapshot(umaMoe, 100, 2026, 6, {
        rootDir: "/tmp/test",
        force: true,
      });

      expect(result.saved).toBe(false);
      expect(result.reason).toBe("not_newer");
      expect(result.snapshot).toBe(existing);
      expect(mockedSave).not.toHaveBeenCalled();
    });

    it("returns the existing snapshot without saving when the fetch throws", async () => {
      const existing = makeSnapshot(2026, 6, 11);
      mockedLoad.mockReturnValue(existing);
      umaMoe.fetchCircleData.mockRejectedValue(new Error("network down"));

      const result = await fetchAndSaveSnapshot(umaMoe, 100, 2026, 6, {
        rootDir: "/tmp/test",
        force: true,
      });

      expect(result.saved).toBe(false);
      expect(result.snapshot).toBe(existing);
      expect(result.reason).toBe("network down");
      expect(mockedSave).not.toHaveBeenCalled();
    });

    it("never falls back to a wrong-circle existing snapshot in force mode", async () => {
      const wrong = makeSnapshot(2026, 6, 12, 999);
      mockedLoad.mockReturnValue(wrong);
      umaMoe.fetchCircleData.mockRejectedValue(new Error("network down"));

      const result = await fetchAndSaveSnapshot(umaMoe, 100, 2026, 6, {
        rootDir: "/tmp/test",
        force: true,
      });

      expect(result.snapshot).toBeNull();
      expect(result.saved).toBe(false);
      expect(result.reason).toBe("network down");
    });

    it("still propagates save failures", async () => {
      mockedLoad.mockReturnValue(null);
      const fetched = makeSnapshot(2026, 6, 12);
      umaMoe.fetchCircleData.mockResolvedValue(fetched);
      mockedSave.mockImplementation(() => {
        throw new Error("disk full");
      });

      await expect(
        fetchAndSaveSnapshot(umaMoe, 100, 2026, 6, {
          rootDir: "/tmp/test",
          force: true,
        }),
      ).rejects.toThrow(SnapshotSaveError);
    });
  });

  describe("isFetchedNewer timestamp ordering", () => {
    it("treats a newer refresh timestamp as newer even when the data day is lower", async () => {
      const existing = makeSnapshot(2026, 6, 11, 100, "2026-06-10T00:00:00Z");
      mockedLoad.mockReturnValue(existing);
      const fetched = makeSnapshot(2026, 6, 10, 100, "2026-06-10T12:00:00Z");
      umaMoe.fetchCircleData.mockResolvedValue(fetched);

      const result = await fetchAndSaveSnapshot(umaMoe, 100, 2026, 6, {
        rootDir: "/tmp/test",
        force: true,
      });

      expect(result.saved).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("saves an equal-timestamp snapshot with a higher data day", async () => {
      const existing = makeSnapshot(2026, 6, 10, 100, "2026-06-10T12:00:00Z");
      mockedLoad.mockReturnValue(existing);
      const fetched = makeSnapshot(2026, 6, 11, 100, "2026-06-10T12:00:00Z");
      umaMoe.fetchCircleData.mockResolvedValue(fetched);

      const result = await fetchAndSaveSnapshot(umaMoe, 100, 2026, 6, {
        rootDir: "/tmp/test",
        force: true,
      });

      expect(result.saved).toBe(true);
    });

    it("saves an equal-timestamp, equal-day snapshot with more members", async () => {
      const existing = makeSnapshot(2026, 6, 11, 100, "2026-06-10T12:00:00Z");
      mockedLoad.mockReturnValue(existing);
      const fetched = makeSnapshot(2026, 6, 11, 100, "2026-06-10T12:00:00Z", 2);
      umaMoe.fetchCircleData.mockResolvedValue(fetched);

      const result = await fetchAndSaveSnapshot(umaMoe, 100, 2026, 6, {
        rootDir: "/tmp/test",
        force: true,
      });

      expect(result.saved).toBe(true);
    });

    it("rejects an older timestamp even when the data day is higher", async () => {
      // A snapshot can only gain a day after the refresh that published it,
      // so a higher day with an older timestamp means uma.moe served a
      // stale/cached payload — never replace the newer disk snapshot.
      const existing = makeSnapshot(2026, 6, 10, 100, "2026-06-10T12:00:00Z");
      mockedLoad.mockReturnValue(existing);
      const fetched = makeSnapshot(2026, 6, 12, 100, "2026-06-10T00:00:00Z");
      umaMoe.fetchCircleData.mockResolvedValue(fetched);

      const result = await fetchAndSaveSnapshot(umaMoe, 100, 2026, 6, {
        rootDir: "/tmp/test",
        force: true,
      });

      expect(result.saved).toBe(false);
      expect(result.reason).toBe("not_newer");
      expect(result.snapshot).toBe(existing);
    });

    it("saves an equal-day fetch when the existing timestamp is unparseable", async () => {
      // Regression lock: a non-parseable existing timestamp must never make
      // a valid fetched one lose the comparison (the old `?? ""` string
      // compare could drop a correct save).
      const existing = makeSnapshot(2026, 6, 10, 100, "bogus");
      mockedLoad.mockReturnValue(existing);
      const fetched = makeSnapshot(2026, 6, 10, 100, "2026-06-10T12:00:00Z");
      umaMoe.fetchCircleData.mockResolvedValue(fetched);

      const result = await fetchAndSaveSnapshot(umaMoe, 100, 2026, 6, {
        rootDir: "/tmp/test",
        force: true,
      });

      expect(result.saved).toBe(true);
    });

    it("rejects when both timestamps are unparseable and days are equal", async () => {
      const existing = makeSnapshot(2026, 6, 11, 100, "bogus");
      mockedLoad.mockReturnValue(existing);
      const fetched = makeSnapshot(2026, 6, 11, 100, "garbage");
      umaMoe.fetchCircleData.mockResolvedValue(fetched);

      const result = await fetchAndSaveSnapshot(umaMoe, 100, 2026, 6, {
        rootDir: "/tmp/test",
        force: true,
      });

      expect(result.saved).toBe(false);
      expect(result.reason).toBe("not_newer");
    });

    it("saves more members when both timestamps are unparseable and days are equal", async () => {
      const existing = makeSnapshot(2026, 6, 11, 100, "bogus");
      mockedLoad.mockReturnValue(existing);
      const fetched = makeSnapshot(2026, 6, 11, 100, "garbage", 2);
      umaMoe.fetchCircleData.mockResolvedValue(fetched);

      const result = await fetchAndSaveSnapshot(umaMoe, 100, 2026, 6, {
        rootDir: "/tmp/test",
        force: true,
      });

      expect(result.saved).toBe(true);
    });

    it("saves a higher data day when both timestamps are unparseable", async () => {
      const existing = makeSnapshot(2026, 6, 10, 100, "bogus");
      mockedLoad.mockReturnValue(existing);
      const fetched = makeSnapshot(2026, 6, 11, 100, "garbage");
      umaMoe.fetchCircleData.mockResolvedValue(fetched);

      const result = await fetchAndSaveSnapshot(umaMoe, 100, 2026, 6, {
        rootDir: "/tmp/test",
        force: true,
      });

      expect(result.saved).toBe(true);
    });

    it("saves when only the circle timestamp advanced", async () => {
      // Circle bumps on roster/tier changes even when member rows lag —
      // the max(members, circle) helper must treat that as a refresh.
      const existing = makeSnapshot(2026, 6, 11, 100, "2026-06-10T10:00:00Z");
      existing.circle.last_updated = "2026-06-10T12:00:00Z";
      mockedLoad.mockReturnValue(existing);
      const fetched = makeSnapshot(2026, 6, 11, 100, "2026-06-10T10:00:00Z");
      fetched.circle.last_updated = "2026-06-10T13:00:00Z";
      umaMoe.fetchCircleData.mockResolvedValue(fetched);

      const result = await fetchAndSaveSnapshot(umaMoe, 100, 2026, 6, {
        rootDir: "/tmp/test",
        force: true,
      });

      expect(result.saved).toBe(true);
    });

    it("treats identical instants in different offset formats as equal", async () => {
      // 2026-06-10T00:00:00+09:00 == 2026-06-09T15:00:00Z — a naive string
      // compare orders them wrong; numeric compare must not.
      const existing = makeSnapshot(2026, 6, 9, 100, "2026-06-09T15:00:00Z");
      mockedLoad.mockReturnValue(existing);
      const fetched = makeSnapshot(
        2026,
        6,
        9,
        100,
        "2026-06-10T00:00:00+09:00",
      );
      umaMoe.fetchCircleData.mockResolvedValue(fetched);

      const result = await fetchAndSaveSnapshot(umaMoe, 100, 2026, 6, {
        rootDir: "/tmp/test",
        force: true,
      });

      expect(result.saved).toBe(false);
      expect(result.reason).toBe("not_newer");
    });

    it("rejects an unparseable fetched timestamp even when the data day is higher", async () => {
      // Discriminates against the old day-first ordering, which would have
      // saved day 12 > day 10 without consulting the timestamp.
      const existing = makeSnapshot(2026, 6, 10, 100, "2026-06-10T12:00:00Z");
      mockedLoad.mockReturnValue(existing);
      const fetched = makeSnapshot(2026, 6, 12, 100, "bogus");
      umaMoe.fetchCircleData.mockResolvedValue(fetched);

      const result = await fetchAndSaveSnapshot(umaMoe, 100, 2026, 6, {
        rootDir: "/tmp/test",
        force: true,
      });

      expect(result.saved).toBe(false);
      expect(result.reason).toBe("not_newer");
    });
  });

  it("waits 5 minutes (not hours) before the first retry when data is behind", async () => {
    jest.useFakeTimers();
    try {
      const existing = makeSnapshot(2026, 6, 5);
      // 1h-old data → retry budget ~22h, so the loop actually sleeps
      existing.circle.last_updated = new Date(
        Date.now() - 60 * 60_000,
      ).toISOString();
      mockedLoad.mockReturnValue(existing);
      const stale = makeSnapshot(2026, 6, 6);
      const fresh = makeSnapshot(2026, 6, 11);
      // Timestamps must be monotone: a day-advancing payload is published
      // after the existing one, so its refresh time is newer.
      stale.circle.last_updated = new Date(
        Date.now() - 59 * 60_000,
      ).toISOString();
      fresh.circle.last_updated = new Date(Date.now()).toISOString();
      umaMoe.fetchCircleData
        .mockResolvedValueOnce(stale)
        .mockResolvedValue(fresh);

      const promise = fetchAndSaveSnapshot(umaMoe, 100, 2026, 6, {
        rootDir: "/tmp/test",
      });
      await jest.advanceTimersByTimeAsync(5 * 60_000 - 1);
      expect(umaMoe.fetchCircleData).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);
      expect(umaMoe.fetchCircleData).toHaveBeenCalledTimes(2);
      await promise;
    } finally {
      jest.useRealTimers();
    }
  });
});
