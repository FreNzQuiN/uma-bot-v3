/**
 * Tests for getWeeklyGain.
 *
 * Split from tests/data/daily-fans.unit.test.ts
 */

import { getWeeklyGain } from "../../src/data/daily-fans";
import {
  RYU_DAILY_FANS,
  ZERO_DAILY_FANS,
  THE_TENG_ONE_DAILY_FANS,
  SAIREN_DAILY_FANS,
} from "./daily-fans.fixtures";

describe("getWeeklyGain", () => {
  // --- Real data tests ---
  it("returns correct week 1 gain for Ryu", () => {
    // First positive: 316856492 (day 1), Last positive: 329925021 (day 7)
    // Gain = 329925021 - 316856492 = 13068529
    expect(getWeeklyGain(RYU_DAILY_FANS, 1)).toBe(13068529);
  });

  it("returns correct week 2 gain for Ryu", () => {
    // Spec formula: lastPositiveInBlock - valueBeforeBlock
    // valueBeforeBlock (day 7) = 329925021
    // lastPositiveInBlock (day 11) = 332207534
    // Gain = 332207534 - 329925021 = 2282513
    expect(getWeeklyGain(RYU_DAILY_FANS, 2)).toBe(2282513);
  });

  it("returns 0 for week 3 of Ryu (all zeros)", () => {
    expect(getWeeklyGain(RYU_DAILY_FANS, 3)).toBe(0);
  });

  it("returns 0 for week 4 of Ryu (all zeros)", () => {
    expect(getWeeklyGain(RYU_DAILY_FANS, 4)).toBe(0);
  });

  it("returns 0 for week 5 of Ryu (all zeros)", () => {
    expect(getWeeklyGain(RYU_DAILY_FANS, 5)).toBe(0);
  });

  it("returns correct week 1 gain for Zero (transfer, positive starts day 4)", () => {
    // Week 1 (days 1-7): negatives day 1-2, zero day 3, positives day 4-7
    // First positive: 301413137 (day 4), Last positive: 309426635 (day 7)
    // Gain = 309426635 - 301413137 = 8013498
    expect(getWeeklyGain(ZERO_DAILY_FANS, 1)).toBe(8013498);
  });

  it("returns correct week 2 gain for Zero", () => {
    // Spec formula: lastPositiveInBlock - valueBeforeBlock
    // valueBeforeBlock (day 7) = 309426635
    // lastPositiveInBlock (day 11) = 315534000
    // Gain = 315534000 - 309426635 = 6107365
    expect(getWeeklyGain(ZERO_DAILY_FANS, 2)).toBe(6107365);
  });

  it("returns 0 for week 1 when all values in block are zero or negative", () => {
    const arr = [-100, -200, 0, 0, 0, 0, 0, ...new Array(25).fill(0)];
    expect(getWeeklyGain(arr, 1)).toBe(0);
  });

  it("returns 0 for week 1 with only one positive value (baseline)", () => {
    const arr = [0, 0, 0, 0, 0, 0, 100, ...new Array(25).fill(0)];
    expect(getWeeklyGain(arr, 1)).toBe(0);
  });

  it("handles transfer member who joins mid-block (TheTengOne week 1)", () => {
    // Week 1: negative days 1-2, positive days 3-7
    // First positive: 185443535 (day 3), Last positive: 189082185 (day 7)
    // Gain = 189082185 - 185443535 = 3638650
    expect(getWeeklyGain(THE_TENG_ONE_DAILY_FANS, 1)).toBe(3638650);
  });

  it("handles Sairen week 1 (late join, zeros in block)", () => {
    // Week 1: negative days 1-3, zero days 4-5, positive days 6-7
    // First positive: 424931301 (day 6), Last positive: 428536838 (day 7)
    // Gain = 428536838 - 424931301 = 3605537
    expect(getWeeklyGain(SAIREN_DAILY_FANS, 1)).toBe(3605537);
  });

  it("returns 0 for invalid week number 0", () => {
    expect(getWeeklyGain(RYU_DAILY_FANS, 0)).toBe(0);
  });

  it("returns 0 for invalid week number 6", () => {
    expect(getWeeklyGain(RYU_DAILY_FANS, 6)).toBe(0);
  });

  it("returns 0 for week 5 with no positive data", () => {
    expect(getWeeklyGain(RYU_DAILY_FANS, 5)).toBe(0);
  });

  it("returns correct week 5 gain for a member with late-month data", () => {
    // Create a member with data only in week 5 (days 29-31)
    const arr = new Array(28).fill(0);
    arr.push(100000, 105000, 110000); // days 29, 30, 31
    // First positive: 100000, Last positive: 110000
    // Gain = 10000
    expect(getWeeklyGain(arr, 5)).toBe(10000);
  });
});
