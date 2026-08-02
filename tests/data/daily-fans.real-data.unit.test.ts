/**
 * Integration tests with snapshot data for daily-fans functions.
 *
 * Split from tests/data/daily-fans.unit.test.ts
 */

import {
  getFirstPositiveDay,
  getLatestDataDay,
  getMonthlyGain,
  countActiveDays,
  getDailyGain,
} from "../../src/data/daily-fans";
import { SAIREN_DAILY_FANS, VITOHOW_DAILY_FANS } from "./daily-fans.fixtures";

describe("Integration with snapshot data", () => {
  it("Sairen: getFirstPositiveDay matches real data (day 6)", () => {
    expect(getFirstPositiveDay(SAIREN_DAILY_FANS)).toBe(6);
  });

  it("Sairen: getLatestDataDay matches real data (day 11)", () => {
    expect(getLatestDataDay(SAIREN_DAILY_FANS)).toBe(11);
  });

  it("Sairen: getMonthlyGain computes correctly", () => {
    // First: 424931301 (day 6), Latest: 442813391 (day 11)
    expect(getMonthlyGain(SAIREN_DAILY_FANS)).toBe(442813391 - 424931301);
  });

  it("Sairen: countActiveDays (day 6 baseline, days 7-11 gains)", () => {
    // Day 6: baseline → 0
    // Day 7: 428536838-424931301=3605537
    // Day 8: 434061836-428536838=5524998
    // Day 9: 437507350-434061836=3445514
    // Day 10: 440583122-437507350=3075772
    // Day 11: 442813391-440583122=2230269
    // 5 active days
    expect(countActiveDays(SAIREN_DAILY_FANS)).toBe(5);
  });

  it("VitoHoow: getFirstPositiveDay is 3 (day 2 is zero)", () => {
    expect(getFirstPositiveDay(VITOHOW_DAILY_FANS)).toBe(3);
  });

  it("VitoHoow: getDailyGain day 3 is 0 (baseline, prev is zero)", () => {
    expect(getDailyGain(VITOHOW_DAILY_FANS, 3)).toBe(0);
  });

  it("VitoHoow: getDailyGain day 4 is correct", () => {
    // 286952371 - 285651571 = 1300800
    expect(getDailyGain(VITOHOW_DAILY_FANS, 4)).toBe(1300800);
  });
});
