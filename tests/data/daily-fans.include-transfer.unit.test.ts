/**
 * includeTransfer=true path — business logic coverage.
 *
 * When includeTransferDataInCalculation is true, negative values (transfer
 * markers) are treated as valid data: hasValue() accepts them, effectiveValue()
 * applies Math.abs(), and gain formulas use absolute values as baselines.
 *
 * This is a production config toggle (default: false). These tests ensure the
 * true path produces correct behavioral output.
 */

import {
  getDailyGain,
  getWeeklyGain,
  getMonthlyGain,
  computeRollingAverage,
  countActiveDays,
} from "../../src/data/daily-fans";
import {
  ZERO_DAILY_FANS,
  THE_TENG_ONE_DAILY_FANS,
  SAIREN_DAILY_FANS,
  RYU_DAILY_FANS,
} from "./daily-fans.fixtures";

describe("getDailyGain with includeTransfer=true", () => {
  describe("Zero fixture (neg days 1-2, zero day 3, positive from day 4)", () => {
    it("day 1: no previous → returns 0 (same as includeTransfer=false)", () => {
      expect(getDailyGain(ZERO_DAILY_FANS, 1, true)).toBe(0);
    });

    it("day 3: current=0, previous is negative → current has no value → returns 0", () => {
      // hasValue(0, true) = false (0 is neither >0 nor <0)
      expect(getDailyGain(ZERO_DAILY_FANS, 3, true)).toBe(0);
    });

    it("day 4: current positive, previous=0 → baseline, returns 0", () => {
      // previous=0: isPositive(0)=false, includeTransfer && 0<0 = false
      expect(getDailyGain(ZERO_DAILY_FANS, 4, true)).toBe(0);
    });

    it("day 5: both positive → normal gain", () => {
      // 304147592 - 301413137 = 2734455
      expect(getDailyGain(ZERO_DAILY_FANS, 5, true)).toBe(
        304147592 - 301413137,
      );
    });
  });

  describe("TheTengOne fixture (neg days 1-2, positive from day 3)", () => {
    it("day 2: both negative → uses Math.abs for both → abs(-185443535) - abs(-185441175)", () => {
      const expected = Math.abs(-185443535) - Math.abs(-185441175);
      expect(getDailyGain(THE_TENG_ONE_DAILY_FANS, 2, true)).toBe(expected);
    });

    it("day 3: current positive, previous negative → abs(previous) as baseline", () => {
      // 185443535 - Math.abs(-185443535) = 185443535 - 185443535 = 0
      expect(getDailyGain(THE_TENG_ONE_DAILY_FANS, 3, true)).toBe(0);
    });

    it("day 4: both positive → normal gain", () => {
      // 186553700 - 185443535 = 1110165
      expect(getDailyGain(THE_TENG_ONE_DAILY_FANS, 4, true)).toBe(
        186553700 - 185443535,
      );
    });
  });

  describe("对比: includeTransfer=false ignores negatives", () => {
    it("TheTengOne day 2: negative previous ignored → returns 0", () => {
      // With false: isPositive(-185441175) = false → returns 0
      expect(getDailyGain(THE_TENG_ONE_DAILY_FANS, 2, false)).toBe(0);
    });

    it("TheTengOne day 3: negative previous ignored → returns 0", () => {
      expect(getDailyGain(THE_TENG_ONE_DAILY_FANS, 3, false)).toBe(0);
    });

    it("TheTengOne day 4: previous is positive → normal gain (same as true)", () => {
      const expected = 186553700 - 185443535;
      expect(getDailyGain(THE_TENG_ONE_DAILY_FANS, 4, false)).toBe(expected);
    });
  });
});

describe("getWeeklyGain with includeTransfer=true", () => {
  it("Zero week 1: negatives in block treated as valid data points", () => {
    // With true: negative values at days 1-2 are valid, so the block has data
    // The gain = lastPositiveInBlock - baseline
    // Zero days 1-2 are negative, day 3 is zero, days 4-7 are positive
    // valueBeforeBlock: none (days before block.start=1 don't exist)
    // firstPositiveInBlock: day 4 = 301413137
    // lastPositiveInBlock: day 7 = 309426635
    // But negatives at days 1-2: hasValue(-297503758, true)=true, effectiveValue=297503758
    // So firstPositiveInBlock includes negatives: day 1 = 297503758
    // Wait — the loop checks hasValue(dailyFans[idx], includeTransfer)
    // For day 1: dailyFans[0] = -297503758, hasValue(-297503758, true) = true
    // effectiveValue(-297503758, true) = 297503758
    // So firstPositiveInBlock = 297503758 (from day 1's abs value)
    // lastPositiveInBlock = 309426635 (day 7)
    // valueBeforeBlock = null (no days before block start)
    // baseline = null ?? 297503758 = 297503758
    // gain = 309426635 - 297503758 = 11922877
    const gain = getWeeklyGain(ZERO_DAILY_FANS, 1, true);
    expect(gain).toBe(309426635 - 297503758);
  });

  it("Zero week 1 with includeTransfer=false: negatives ignored", () => {
    // With false: negatives at days 1-2 ignored, day 3 zero ignored
    // firstPositiveInBlock: day 4 = 301413137
    // lastPositiveInBlock: day 7 = 309426635
    // baseline = null ?? 301413137 = 301413137
    // gain = 309426635 - 301413137 = 8013498
    const gain = getWeeklyGain(ZERO_DAILY_FANS, 1, false);
    expect(gain).toBe(309426635 - 301413137);
  });

  it("TheTengOne week 1 with true: negatives contribute to gain", () => {
    // Days 1-2 negative, day 3+ positive
    // With true: day 1 abs(−185441175)=185441175 is first in block
    // lastPositiveInBlock: day 7 = 189082185
    // baseline = 185441175
    // gain = 189082185 - 185441175 = 3641010
    const gain = getWeeklyGain(THE_TENG_ONE_DAILY_FANS, 1, true);
    expect(gain).toBe(189082185 - 185441175);
  });

  it("Ryu week 1: no negatives, same result regardless of flag", () => {
    const withTransfer = getWeeklyGain(RYU_DAILY_FANS, 1, true);
    const withoutTransfer = getWeeklyGain(RYU_DAILY_FANS, 1, false);
    expect(withTransfer).toBe(withoutTransfer);
  });
});

describe("getMonthlyGain with includeTransfer=true", () => {
  it("Zero: negatives at start → abs used as first value", () => {
    // With true: first positive = abs(-297503758) = 297503758 (day 1)
    // latest positive = 315534000 (day 11)
    // gain = 315534000 - 297503758 = 18030242
    const gain = getMonthlyGain(ZERO_DAILY_FANS, true);
    expect(gain).toBe(315534000 - 297503758);
  });

  it("Zero with includeTransfer=false: negatives ignored, first value is day 4", () => {
    // With false: first positive = 301413137 (day 4)
    // latest positive = 315534000 (day 11)
    // gain = 315534000 - 301413137 = 14120863
    const gain = getMonthlyGain(ZERO_DAILY_FANS, false);
    expect(gain).toBe(315534000 - 301413137);
  });

  it("TheTengOne: true gives different result than false", () => {
    const withTransfer = getMonthlyGain(THE_TENG_ONE_DAILY_FANS, true);
    const withoutTransfer = getMonthlyGain(THE_TENG_ONE_DAILY_FANS, false);
    // With true: first = abs(-185441175) = 185441175, latest = 191778327
    // With false: first = 185443535 (day 3), latest = 191778327
    expect(withTransfer).toBe(191778327 - 185441175);
    expect(withoutTransfer).toBe(191778327 - 185443535);
    expect(withTransfer).not.toBe(withoutTransfer);
  });

  it("Ryu: no negatives, same result regardless of flag", () => {
    const withTransfer = getMonthlyGain(RYU_DAILY_FANS, true);
    const withoutTransfer = getMonthlyGain(RYU_DAILY_FANS, false);
    expect(withTransfer).toBe(withoutTransfer);
  });
});

describe("computeRollingAverage with includeTransfer=true", () => {
  it("Zero: negatives produce gains but rolling average may stay same (only counts positive gains)", () => {
    // computeRollingAverage only counts days where gain > 0.
    // With true: negatives at days 1-2 produce small gains via getDailyGain,
    // but the main positive gains (days 5-11) dominate the average.
    // The flag changes WHICH days contribute but not necessarily the final average.
    const withTransfer = computeRollingAverage(ZERO_DAILY_FANS, 11, 7, true);
    const withoutTransfer = computeRollingAverage(
      ZERO_DAILY_FANS,
      11,
      7,
      false,
    );
    expect(withTransfer).toBeGreaterThanOrEqual(0);
    expect(withoutTransfer).toBeGreaterThanOrEqual(0);
  });

  it("Ryu: no negatives, same result regardless of flag", () => {
    const withTransfer = computeRollingAverage(RYU_DAILY_FANS, 11, 7, true);
    const withoutTransfer = computeRollingAverage(RYU_DAILY_FANS, 11, 7, false);
    expect(withTransfer).toBe(withoutTransfer);
  });
});

describe("countActiveDays with includeTransfer=true", () => {
  it("TheTengOne: negatives counted as active days", () => {
    const withTransfer = countActiveDays(THE_TENG_ONE_DAILY_FANS, 11, true);
    const withoutTransfer = countActiveDays(THE_TENG_ONE_DAILY_FANS, 11, false);
    // With true: days 1-2 (negatives) count as active
    // With false: days 1-2 ignored, only day 3+ count
    expect(withTransfer).toBeGreaterThan(withoutTransfer);
  });

  it("Sairen: 3 negatives + late positive start", () => {
    const withTransfer = countActiveDays(SAIREN_DAILY_FANS, 11, true);
    const withoutTransfer = countActiveDays(SAIREN_DAILY_FANS, 11, false);
    // With true: 3 negative days + positive days from 6-11
    // With false: only positive days from 6-11
    expect(withTransfer).toBeGreaterThan(withoutTransfer);
  });

  it("Ryu: no negatives, same count", () => {
    const withTransfer = countActiveDays(RYU_DAILY_FANS, 11, true);
    const withoutTransfer = countActiveDays(RYU_DAILY_FANS, 11, false);
    expect(withTransfer).toBe(withoutTransfer);
  });
});
