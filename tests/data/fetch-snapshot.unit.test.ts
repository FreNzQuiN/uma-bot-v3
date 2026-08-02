/**
 * Tests for fetchAndSaveSnapshot — fetch decision logic and persistence.
 *
 * The retry loop sleeps up to 5 minutes per iteration; most tests keep
 * maxWaitMs at 0 (stale last_updated) or make the fetch succeed on the
 * first attempt, so they never sleep. The backoff regression test uses
 * fake timers to assert the first retry waits 5 minutes, not 5 hours.
 */

import { fetchAndSaveSnapshot } from "../../src/data/fetch-snapshot";
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
): Snapshot {
  return {
    circle: {
      circle_id: circleId,
      name: "TestClub",
      comment: "",
      leader_viewer_id: 1,
      leader_name: "Leader",
      member_count: 1,
      join_style: 0,
      policy: 0,
      created_at: "",
      last_updated: "2020-01-01T00:00:00Z",
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
        circle_id: circleId,
        viewer_id: 1001,
        trainer_name: "Ryu",
        shame_score: null,
        year,
        month,
        daily_fans: new Array(dataDay).fill(1000),
        last_updated: "2020-01-01T00:00:00Z",
      },
    ],
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
    ).rejects.toThrow("disk full");
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
      ).rejects.toThrow("disk full");
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
