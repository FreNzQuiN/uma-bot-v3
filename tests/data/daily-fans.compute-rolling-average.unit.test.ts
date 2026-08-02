import { computeRollingAverage } from "../../src/data/daily-fans";
import {
  RYU_DAILY_FANS,
  DOA_IBU_DAILY_FANS,
  ZERO_DAILY_FANS,
} from "./daily-fans.fixtures";

describe("computeRollingAverage", () => {
  it("computes 7-day average for Ryu correctly", () => {
    // Ryu's last-7-day gains (days 5-11):
    // day 5: 327253973-323514848 = 3739125
    // day 6: 328785007-327253973 = 1531034
    // day 7: 329925021-328785007 = 1140014
    // day 8: 330462154-329925021 = 537133
    // day 9: 331558385-330462154 = 1096231
    // day 10: 331992091-331558385 = 433706
    // day 11: 332207534-331992091 = 215443
    // Sum = 8692686, average = 8692686 / 7 = 1241812.285...
    const avg = computeRollingAverage(RYU_DAILY_FANS, 11, 7);
    expect(avg).toBe(Math.floor(8692686 / 7));
  });

  it("computes 3-day average for Ryu correctly", () => {
    // Window iterates backward from day 11: 215443 + 433706 + 1096231 = 1745380.
    const avg = computeRollingAverage(RYU_DAILY_FANS, 11, 3);
    expect(avg).toBe(Math.floor((215443 + 433706 + 1096231) / 3));
  });

  it("returns 0 when no valid gain days exist", () => {
    const arr = new Array(32).fill(0);
    expect(computeRollingAverage(arr, 0, 7)).toBe(0);
  });

  it("returns 0 for empty array", () => {
    expect(computeRollingAverage([], 0, 7)).toBe(0);
  });

  it("handles case where fewer days have valid gains than requested window", () => {
    expect(computeRollingAverage(DOA_IBU_DAILY_FANS, 1, 7)).toBe(0);
  });

  it("computes correctly when transfer member has limited gain history", () => {
    // Zero: first gain is day 5 (day 4 is baseline)
    // Last 3 days from day 11:
    // day 11: 315534000-313515911 = 2018089
    // day 10: 313515911-312271653 = 1244258
    // day 9: 312271653-310890886 = 1380767
    const avg = computeRollingAverage(ZERO_DAILY_FANS, 11, 3);
    expect(avg).toBe(Math.floor((2018089 + 1244258 + 1380767) / 3));
  });

  it("handles days=1 (single day rolling average)", () => {
    const avg = computeRollingAverage(RYU_DAILY_FANS, 11, 1);
    expect(avg).toBe(215443);
  });

  it("handles days larger than available data window", () => {
    const gains = [
      319191258 - 316856492, // day 2
      320992164 - 319191258, // day 3
      323514848 - 320992164, // day 4
      327253973 - 323514848, // day 5
      328785007 - 327253973, // day 6
      329925021 - 328785007, // day 7
      330462154 - 329925021, // day 8
      331558385 - 330462154, // day 9
      331992091 - 331558385, // day 10
      332207534 - 331992091, // day 11
    ];
    const sum = gains.reduce((a, b) => a + b, 0);
    const avg = computeRollingAverage(RYU_DAILY_FANS, 11, 20);
    expect(avg).toBe(Math.floor(sum / 10));
  });
});
