/**
 * Tests for getDailyGain.
 *
 * Split from tests/data/daily-fans.unit.test.ts
 */

import { getDailyGain } from "../../src/data/daily-fans";
import {
  RYU_DAILY_FANS,
  ZERO_DAILY_FANS,
  THE_TENG_ONE_DAILY_FANS,
  KURO_DAILY_FANS,
} from "./daily-fans.fixtures";

describe("getDailyGain", () => {
  // --- Real data tests ---
  it("returns 0 for day 1 of Ryu (no previous day)", () => {
    expect(getDailyGain(RYU_DAILY_FANS, 1)).toBe(0);
  });

  it("returns correct gain for Ryu day 2", () => {
    // 319191258 - 316856492 = 2334766
    expect(getDailyGain(RYU_DAILY_FANS, 2)).toBe(319191258 - 316856492);
  });

  it("returns correct gain for Ryu day 11 (last data day)", () => {
    // 332207534 - 331992091 = 215443
    expect(getDailyGain(RYU_DAILY_FANS, 11)).toBe(332207534 - 331992091);
  });

  it("returns 0 for Ryu day 12 (day is zero)", () => {
    expect(getDailyGain(RYU_DAILY_FANS, 12)).toBe(0);
  });

  it("returns 0 for Zero day 4 (first positive, previous is 0 — baseline)", () => {
    expect(getDailyGain(ZERO_DAILY_FANS, 4)).toBe(0);
  });

  it("returns correct gain for Zero day 5", () => {
    // 304147592 - 301413137 = 2734455
    expect(getDailyGain(ZERO_DAILY_FANS, 5)).toBe(304147592 - 301413137);
  });

  it("returns 0 for Zero day 3 (both zero)", () => {
    expect(getDailyGain(ZERO_DAILY_FANS, 3)).toBe(0);
  });

  // --- Edge cases ---
  it("returns 0 for day 0 (invalid 1-indexed)", () => {
    expect(getDailyGain(RYU_DAILY_FANS, 0)).toBe(0);
  });

  it("returns 0 for negative day", () => {
    expect(getDailyGain(RYU_DAILY_FANS, -1)).toBe(0);
  });

  it("returns 0 when day exceeds array length", () => {
    expect(getDailyGain(RYU_DAILY_FANS, 50)).toBe(0);
  });

  it("returns 0 for empty array", () => {
    expect(getDailyGain([], 1)).toBe(0);
  });

  it("returns 0 when current is negative (transfer marker)", () => {
    expect(getDailyGain(ZERO_DAILY_FANS, 1)).toBe(0);
  });

  it("returns 0 when previous is negative (transfer marker)", () => {
    // Zero day 2: dailyFans[1]=-298399518 (negative), dailyFans[0]=-297503758 (negative)
    // Both non-positive → 0
    expect(getDailyGain(ZERO_DAILY_FANS, 2)).toBe(0);
  });

  it("returns 0 when current positive but previous negative", () => {
    // TheTengOne day 3: dailyFans[2]=185443535, dailyFans[1]=-185443535
    expect(getDailyGain(THE_TENG_ONE_DAILY_FANS, 3)).toBe(0);
  });

  it("handles equal consecutive values (zero gain)", () => {
    // Kuro day 2: dailyFans[1]=251759384, dailyFans[0]=251759384
    expect(getDailyGain(KURO_DAILY_FANS, 2)).toBe(0);
  });
});
