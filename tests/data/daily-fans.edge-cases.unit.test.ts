import {
  computeRollingAverage,
  countActiveDays,
  getMonthlyGain,
  isStaleForReport,
  getWeeklyGain,
  getDailyGain,
} from "../../src/data/daily-fans";
import { RYU_DAILY_FANS } from "./daily-fans.fixtures";

describe("Additional edge cases", () => {
  describe("computeRollingAverage: days=0 and negative days", () => {
    it("returns 0 when days=0", () => {
      expect(computeRollingAverage(RYU_DAILY_FANS, 11, 0)).toBe(0);
    });

    it("returns 0 when days is negative", () => {
      expect(computeRollingAverage(RYU_DAILY_FANS, 11, -5)).toBe(0);
    });
  });

  describe("countActiveDays: single-element array", () => {
    it("returns 1 for single-element array with data (day 1 counted)", () => {
      expect(countActiveDays([100])).toBe(1);
    });
  });

  describe("getMonthlyGain: latest value less than first (negative gain)", () => {
    it("returns negative gain when latest < first", () => {
      const arr = [
        500, 400, 300, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      ];
      expect(getMonthlyGain(arr)).toBe(-200);
    });
  });

  describe("isStaleForReport: both inputs are 0", () => {
    it("returns false when latestDataDay is 0", () => {
      expect(isStaleForReport([], 0, 3)).toBe(false);
    });
  });

  describe("getWeeklyGain: transfer member in week 5", () => {
    it("handles transfer member with negatives in week 5 block", () => {
      const arr = [...new Array(28).fill(-1000), 50000, 55000, 60000];
      // No valueBeforeBlock (all negatives before week 5) → baseline = firstPositiveInBlock = 50000.
      expect(getWeeklyGain(arr, 5)).toBe(10000);
    });

    it("handles week 5 with valueBeforeBlock from week 4", () => {
      const arr = [...new Array(28).fill(100000), 200000, 210000, 220000];
      // valueBeforeBlock = last positive before day 29 = dailyFans[27] = 100000.
      expect(getWeeklyGain(arr, 5)).toBe(120000);
    });
  });

  describe("getDailyGain: exact boundary", () => {
    it("returns 0 for day exactly at array length (padding)", () => {
      expect(getDailyGain(RYU_DAILY_FANS, 32)).toBe(0);
    });

    it("returns correct gain for day exactly at array length when last is positive", () => {
      const arr = [100, 200, 300, 400];
      expect(getDailyGain(arr, 4)).toBe(100);
    });
  });

  describe("computeRollingAverage: all gains are zero", () => {
    it("returns 0 when all consecutive values are equal (zero gains)", () => {
      const arr = new Array(32).fill(1000);
      expect(computeRollingAverage(arr, 10, 7)).toBe(0);
    });
  });

  describe("getWeeklyGain: single positive value with valueBeforeBlock", () => {
    it("returns 0 when valueBeforeBlock equals the only positive in block", () => {
      // Positive in weeks 1 and 2, same value carried over
      const arr = [
        100,
        200,
        300,
        400,
        500,
        600,
        700, // week 1
        700,
        0,
        0,
        0,
        0,
        0,
        0, // week 2 (same value as last of week 1)
        ...new Array(18).fill(0),
      ];
      // valueBeforeBlock (before day 8) = last positive in days 1-7 = 700
      // lastPositiveInBlock = 700 (day 8)
      // baseline = valueBeforeBlock = 700, same as lastPositiveInBlock → gain = 0
      expect(getWeeklyGain(arr, 2)).toBe(0);
    });
  });
});
