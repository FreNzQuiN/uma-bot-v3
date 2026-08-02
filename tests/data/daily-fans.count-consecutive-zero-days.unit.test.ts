/**
 * Tests for countConsecutiveZeroDaysAtEnd.
 *
 * Split from tests/data/daily-fans.unit.test.ts
 */

import { countConsecutiveZeroDaysAtEnd } from "../../src/data/daily-fans";
import {
  RYU_DAILY_FANS,
  SAIREN_DAILY_FANS,
  DOA_IBU_DAILY_FANS,
} from "./daily-fans.fixtures";

describe("countConsecutiveZeroDaysAtEnd", () => {
  it("returns 4 for all-zero tail (constant value from day 2 to day 5)", () => {
    // dailyFans: [100, 100, 100, 100, 100]
    // Day 5: gain = 100-100 = 0 → count=1
    // Day 4: gain = 100-100 = 0 → count=2
    // Day 3: gain = 100-100 = 0 → count=3
    // Day 2: gain = 100-100 = 0 → count=4
    const dailyFans = [100, 100, 100, 100, 100];
    expect(countConsecutiveZeroDaysAtEnd(dailyFans, 5)).toBe(4);
  });

  it("returns 1 when positive gain at day 4 interrupts the streak", () => {
    // dailyFans: [100, 100, 100, 110, 110]
    // Day 5: gain = 110-110 = 0 → count=1
    // Day 4: gain = 110-100 = 10 > 0 → break
    const dailyFans = [100, 100, 100, 110, 110];
    expect(countConsecutiveZeroDaysAtEnd(dailyFans, 5)).toBe(1);
  });

  it("returns 0 for strictly increasing array", () => {
    // dailyFans: [100, 110, 120, 130, 140]
    // Day 5: gain = 140-130 = 10 > 0 → break immediately
    const dailyFans = [100, 110, 120, 130, 140];
    expect(countConsecutiveZeroDaysAtEnd(dailyFans, 5)).toBe(0);
  });

  it("stops iteration at day 2 (boundary)", () => {
    // dailyFans: [100, 100, 100, 100, 100] with latestDataDay=2
    // Day 2: gain = 100-100 = 0 → count=1
    // day-- → 1, which is < 2 → loop ends
    const dailyFans = [100, 100, 100, 100, 100];
    expect(countConsecutiveZeroDaysAtEnd(dailyFans, 2)).toBe(1);
  });

  it("returns 0 for single element array (latestDataDay=1, loop never runs)", () => {
    // latestDataDay=1, loop condition: day >= 2 → false, loop body never executes
    const dailyFans = [100];
    expect(countConsecutiveZeroDaysAtEnd(dailyFans, 1)).toBe(0);
  });

  it("counts zero days down to day 2 when day 2 is the only zero at boundary", () => {
    // dailyFans: [100, 100, 110, 120, 130] with latestDataDay=2
    // Day 2: gain = 100-100 = 0 → count=1
    // day-- → 1 < 2 → loop ends
    // Day 3+ have positive gains but we never reach them (iteration goes downward)
    const dailyFans = [100, 100, 110, 120, 130];
    expect(countConsecutiveZeroDaysAtEnd(dailyFans, 2)).toBe(1);
  });

  it("returns 3 for three trailing zero days then a positive gain", () => {
    // dailyFans: [100, 110, 110, 110, 110]
    // Day 5: gain = 110-110 = 0 → count=1
    // Day 4: gain = 110-110 = 0 → count=2
    // Day 3: gain = 110-110 = 0 → count=3
    // Day 2: gain = 110-100 = 10 > 0 → break
    const dailyFans = [100, 110, 110, 110, 110];
    expect(countConsecutiveZeroDaysAtEnd(dailyFans, 5)).toBe(3);
  });

  it("handles Ryu real data: 21 zero days at end (day 12 to day 31 are zeros)", () => {
    // RYU_DAILY_FANS has positive values through day 11, then zeros.
    // latestDataDay=31, iterate from day 31 down:
    // Days 31-12: all zero (20 iterations), day 11: gain = 332207534-331992091 > 0 → break
    // Count = 20
    expect(countConsecutiveZeroDaysAtEnd(RYU_DAILY_FANS, 31)).toBe(20);
  });

  it("handles Sairen real data: 20 zero days at end (day 12 to day 31)", () => {
    // SAIREN_DAILY_FANS has positive values through day 11, then zeros.
    // Same pattern as Ryu: days 31-12 zero, day 11 positive → count=20
    expect(countConsecutiveZeroDaysAtEnd(SAIREN_DAILY_FANS, 31)).toBe(20);
  });

  it("handles DOA IBU: 30 zero days at end (day 2 to day 31)", () => {
    // DOA_IBU_DAILY_FANS: only day 1 positive (293009510), everything else 0
    // Day 31: gain = 0-0 = 0, ..., Day 2: gain = 0-293009510 → not positive, gain=0
    // Wait: getDailyGain checks if current is positive. Day 2: current=0, not positive → return 0
    // So all days 2-31 have gain=0 → count=30
    expect(countConsecutiveZeroDaysAtEnd(DOA_IBU_DAILY_FANS, 31)).toBe(30);
  });
});
