import { isStaleForReport } from "../../src/data/daily-fans";
import { DOA_IBU_DAILY_FANS, RYU_DAILY_FANS } from "./daily-fans.fixtures";

describe("isStaleForReport", () => {
  it("returns false when threshold is 0 (disabled)", () => {
    const dailyFans = [100, 100, 100, 100, 100]; // 4 consecutive zero days
    expect(isStaleForReport(dailyFans, 5, 0)).toBe(false);
  });

  it("returns false when threshold is negative", () => {
    const dailyFans = [100, 100, 100, 100, 100]; // 4 consecutive zero days
    expect(isStaleForReport(dailyFans, 5, -5)).toBe(false);
  });

  it("returns true when consecutive zero days exactly equals threshold", () => {
    const dailyFans = [100, 100, 100, 100, 100]; // 4 consecutive zero days
    expect(isStaleForReport(dailyFans, 5, 4)).toBe(true);
  });

  it("returns false when consecutive zero days is below threshold", () => {
    const dailyFans = [100, 100, 100, 100, 100]; // 4 consecutive zero days
    expect(isStaleForReport(dailyFans, 5, 5)).toBe(false);
  });

  it("returns true when consecutive zero days exceeds threshold", () => {
    const dailyFans = [100, 100, 100, 100, 100]; // 4 consecutive zero days
    expect(isStaleForReport(dailyFans, 5, 3)).toBe(true);
  });

  it("returns false when threshold is very large (100) and data is normal", () => {
    // [100, 110, 120, 130, 140] → 0 consecutive zero days (strictly increasing)
    const dailyFans = [100, 110, 120, 130, 140];
    expect(isStaleForReport(dailyFans, 5, 100)).toBe(false);
  });

  it("returns false for active member (no zero days) with threshold=1", () => {
    const dailyFans = [100, 110, 120, 130, 140];
    expect(isStaleForReport(dailyFans, 5, 1)).toBe(false);
  });

  it("returns true for DOA IBU with threshold=5 (30 zero days at end)", () => {
    expect(isStaleForReport(DOA_IBU_DAILY_FANS, 31, 5)).toBe(true);
  });

  it("returns false for Ryu with threshold=21 (20 zero days, below threshold)", () => {
    expect(isStaleForReport(RYU_DAILY_FANS, 31, 21)).toBe(false);
  });

  it("returns true for Ryu with threshold=20 (exactly at threshold)", () => {
    expect(isStaleForReport(RYU_DAILY_FANS, 31, 20)).toBe(true);
  });
});
