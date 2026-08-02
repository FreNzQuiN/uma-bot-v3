import { countConsecutiveZeroDaysAtEnd } from "../../src/data/daily-fans";
import {
  RYU_DAILY_FANS,
  SAIREN_DAILY_FANS,
  DOA_IBU_DAILY_FANS,
} from "./daily-fans.fixtures";

describe("countConsecutiveZeroDaysAtEnd", () => {
  it("returns 4 for all-zero tail (constant value from day 2 to day 5)", () => {
    const dailyFans = [100, 100, 100, 100, 100];
    expect(countConsecutiveZeroDaysAtEnd(dailyFans, 5)).toBe(4);
  });

  it("returns 1 when positive gain at day 4 interrupts the streak", () => {
    const dailyFans = [100, 100, 100, 110, 110];
    expect(countConsecutiveZeroDaysAtEnd(dailyFans, 5)).toBe(1);
  });

  it("returns 0 for strictly increasing array", () => {
    const dailyFans = [100, 110, 120, 130, 140];
    expect(countConsecutiveZeroDaysAtEnd(dailyFans, 5)).toBe(0);
  });

  it("stops iteration at day 2 (boundary)", () => {
    const dailyFans = [100, 100, 100, 100, 100];
    expect(countConsecutiveZeroDaysAtEnd(dailyFans, 2)).toBe(1);
  });

  it("returns 0 for single element array (latestDataDay=1, loop never runs)", () => {
    const dailyFans = [100];
    expect(countConsecutiveZeroDaysAtEnd(dailyFans, 1)).toBe(0);
  });

  it("counts zero days down to day 2 when day 2 is the only zero at boundary", () => {
    const dailyFans = [100, 100, 110, 120, 130];
    expect(countConsecutiveZeroDaysAtEnd(dailyFans, 2)).toBe(1);
  });

  it("returns 3 for three trailing zero days then a positive gain", () => {
    const dailyFans = [100, 110, 110, 110, 110];
    expect(countConsecutiveZeroDaysAtEnd(dailyFans, 5)).toBe(3);
  });

  it("handles Ryu real data: 20 zero days at end (day 12 to day 31 are zeros)", () => {
    // RYU_DAILY_FANS has positive values through day 11, then zeros.
    // latestDataDay=31, iterate from day 31 down:
    // Days 31-12: all zero (20 iterations), day 11: gain = 332207534-331992091 > 0 → break
    // Count = 20
    expect(countConsecutiveZeroDaysAtEnd(RYU_DAILY_FANS, 31)).toBe(20);
  });

  it("handles Sairen real data: 20 zero days at end (day 12 to day 31)", () => {
    expect(countConsecutiveZeroDaysAtEnd(SAIREN_DAILY_FANS, 31)).toBe(20);
  });

  it("handles DOA IBU: 30 zero days at end (day 2 to day 31)", () => {
    // getDailyGain returns 0 when current=0 even if previous is positive → all gains 0.
    expect(countConsecutiveZeroDaysAtEnd(DOA_IBU_DAILY_FANS, 31)).toBe(30);
  });
});
