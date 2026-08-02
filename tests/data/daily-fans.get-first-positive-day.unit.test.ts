/**
 * Tests for getFirstPositiveDay.
 *
 * Split from tests/data/daily-fans.unit.test.ts
 */

import { getFirstPositiveDay } from "../../src/data/daily-fans";
import {
  RYU_DAILY_FANS,
  ZERO_DAILY_FANS,
  THE_TENG_ONE_DAILY_FANS,
  SAIREN_DAILY_FANS,
  VITOHOW_DAILY_FANS,
} from "./daily-fans.fixtures";

describe("getFirstPositiveDay", () => {
  // --- Real data tests ---
  it("returns 1 for Ryu (first positive at index 0)", () => {
    expect(getFirstPositiveDay(RYU_DAILY_FANS)).toBe(1);
  });

  it("returns 4 for Zero (first positive at index 3, after negatives and zero)", () => {
    expect(getFirstPositiveDay(ZERO_DAILY_FANS)).toBe(4);
  });

  it("returns 3 for TheTengOne (first positive at index 2)", () => {
    expect(getFirstPositiveDay(THE_TENG_ONE_DAILY_FANS)).toBe(3);
  });

  it("returns 6 for Sairen (first positive at index 5)", () => {
    expect(getFirstPositiveDay(SAIREN_DAILY_FANS)).toBe(6);
  });

  it("returns 3 for VitoHoow (first positive at index 2)", () => {
    expect(getFirstPositiveDay(VITOHOW_DAILY_FANS)).toBe(3);
  });

  // --- Edge cases ---
  it("returns 0 for all-zero array", () => {
    const allZero = new Array(32).fill(0);
    expect(getFirstPositiveDay(allZero)).toBe(0);
  });

  it("returns 0 for all-negative array", () => {
    const allNeg = [-100, -200, -300, ...new Array(29).fill(0)];
    expect(getFirstPositiveDay(allNeg)).toBe(0);
  });

  it("returns 0 for empty array", () => {
    expect(getFirstPositiveDay([])).toBe(0);
  });

  it("returns 1 for positive at start", () => {
    expect(getFirstPositiveDay([50, 100, 200, ...new Array(29).fill(0)])).toBe(
      1,
    );
  });

  it("returns 10 for first positive at index 9", () => {
    const arr = [
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      1000,
      2000,
      ...new Array(21).fill(0),
    ];
    expect(getFirstPositiveDay(arr)).toBe(10);
  });
});
