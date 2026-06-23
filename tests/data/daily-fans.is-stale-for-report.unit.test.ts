/**
 * Tests for isStaleForReport.
 *
 * Split from tests/data/daily-fans.unit.test.ts
 */

import { isStaleForReport } from '../../src/data/daily-fans';
import {
  DOA_IBU_DAILY_FANS,
  RYU_DAILY_FANS,
} from './daily-fans.fixtures';

describe('isStaleForReport', () => {
  // Helper: data with N consecutive zero days at end
  // [100, 110, ..., 100+N*10, 100+N*10, ...] → N zero days after the last positive gain
  // Simpler: use countConsecutiveZeroDaysAtEnd results directly

  it('returns false when threshold is 0 (disabled)', () => {
    // threshold <= 0 → always false, regardless of data
    const dailyFans = [100, 100, 100, 100, 100]; // 4 consecutive zero days
    expect(isStaleForReport(dailyFans, 5, 0)).toBe(false);
  });

  it('returns false when threshold is negative', () => {
    const dailyFans = [100, 100, 100, 100, 100]; // 4 consecutive zero days
    expect(isStaleForReport(dailyFans, 5, -5)).toBe(false);
  });

  it('returns true when consecutive zero days exactly equals threshold', () => {
    // [100, 100, 100, 100, 100] with latestDataDay=5 → 4 consecutive zero days
    const dailyFans = [100, 100, 100, 100, 100];
    expect(isStaleForReport(dailyFans, 5, 4)).toBe(true);
  });

  it('returns false when consecutive zero days is below threshold', () => {
    // [100, 100, 100, 100, 100] with latestDataDay=5 → 4 consecutive zero days
    // threshold=5 > 4 → false
    const dailyFans = [100, 100, 100, 100, 100];
    expect(isStaleForReport(dailyFans, 5, 5)).toBe(false);
  });

  it('returns true when consecutive zero days exceeds threshold', () => {
    // [100, 100, 100, 100, 100] with latestDataDay=5 → 4 consecutive zero days
    // threshold=3 < 4 → true
    const dailyFans = [100, 100, 100, 100, 100];
    expect(isStaleForReport(dailyFans, 5, 3)).toBe(true);
  });

  it('returns false when threshold is very large (100) and data is normal', () => {
    // [100, 110, 120, 130, 140] → 0 consecutive zero days (strictly increasing)
    const dailyFans = [100, 110, 120, 130, 140];
    expect(isStaleForReport(dailyFans, 5, 100)).toBe(false);
  });

  it('returns false for active member (no zero days) with threshold=1', () => {
    // [100, 110, 120, 130, 140] → 0 consecutive zero days
    const dailyFans = [100, 110, 120, 130, 140];
    expect(isStaleForReport(dailyFans, 5, 1)).toBe(false);
  });

  it('returns true for DOA IBU with threshold=5 (30 zero days at end)', () => {
    // DOA_IBU has 30 consecutive zero days → well above threshold of 5
    expect(isStaleForReport(DOA_IBU_DAILY_FANS, 31, 5)).toBe(true);
  });

  it('returns false for Ryu with threshold=21 (20 zero days, below threshold)', () => {
    // RYU has 20 consecutive zero days (day 12-31), threshold=21 → false
    expect(isStaleForReport(RYU_DAILY_FANS, 31, 21)).toBe(false);
  });

  it('returns true for Ryu with threshold=20 (exactly at threshold)', () => {
    // RYU has 20 consecutive zero days → threshold=20 → true
    expect(isStaleForReport(RYU_DAILY_FANS, 31, 20)).toBe(true);
  });
});
