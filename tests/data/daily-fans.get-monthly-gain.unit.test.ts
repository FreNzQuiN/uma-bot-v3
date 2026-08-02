/**
 * Tests for getMonthlyGain.
 *
 * Split from tests/data/daily-fans.unit.test.ts
 */

import { getMonthlyGain } from "../../src/data/daily-fans";
import {
  RYU_DAILY_FANS,
  ZERO_DAILY_FANS,
  THE_TENG_ONE_DAILY_FANS,
  DOA_IBU_DAILY_FANS,
  KURO_DAILY_FANS,
} from "./daily-fans.fixtures";

describe("getMonthlyGain", () => {
  // --- Real data tests ---
  it("returns correct monthly gain for Ryu", () => {
    // First positive: 316856492 (day 1), Latest positive: 332207534 (day 11)
    // Gain = 332207534 - 316856492 = 15351042
    expect(getMonthlyGain(RYU_DAILY_FANS)).toBe(15351042);
  });

  it("returns correct monthly gain for Zero (transfer member)", () => {
    // First positive: 301413137 (day 4), Latest positive: 315534000 (day 11)
    // Gain = 315534000 - 301413137 = 14120863
    expect(getMonthlyGain(ZERO_DAILY_FANS)).toBe(14120863);
  });

  it("returns correct monthly gain for TheTengOne", () => {
    // First positive: 185443535 (day 3), Latest positive: 191778327 (day 11)
    // Gain = 191778327 - 185443535 = 6334792
    expect(getMonthlyGain(THE_TENG_ONE_DAILY_FANS)).toBe(6334792);
  });

  it("returns 0 for DOA IBU (only one positive day — baseline only)", () => {
    expect(getMonthlyGain(DOA_IBU_DAILY_FANS)).toBe(0);
  });

  it("returns 0 for Kuro (only one positive value, same value both days)", () => {
    // Kuro day 1=251759384, day 2=251759384 → same value, gain = 0
    expect(getMonthlyGain(KURO_DAILY_FANS)).toBe(0);
  });

  // --- Edge cases ---
  it("returns 0 for all-zero array", () => {
    const allZero = new Array(32).fill(0);
    expect(getMonthlyGain(allZero)).toBe(0);
  });

  it("returns 0 for all-negative array", () => {
    const allNeg = [-100, -200, -300, ...new Array(29).fill(0)];
    expect(getMonthlyGain(allNeg)).toBe(0);
  });

  it("returns 0 for empty array", () => {
    expect(getMonthlyGain([])).toBe(0);
  });

  it("returns 0 for single positive value", () => {
    const arr = [
      500, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0,
    ];
    expect(getMonthlyGain(arr)).toBe(0);
  });

  it("returns positive gain when first and last differ", () => {
    const arr = [
      100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 200, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0,
    ];
    expect(getMonthlyGain(arr)).toBe(100);
  });
});
