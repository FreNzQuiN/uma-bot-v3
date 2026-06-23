/**
 * Tests for getLatestDataDay.
 *
 * Split from tests/data/daily-fans.unit.test.ts
 */

import { getLatestDataDay } from '../../src/data/daily-fans';
import {
  RYU_DAILY_FANS,
  ZERO_DAILY_FANS,
  THE_TENG_ONE_DAILY_FANS,
  DOA_IBU_DAILY_FANS,
  KURO_DAILY_FANS,
  SAIREN_DAILY_FANS,
} from './daily-fans.fixtures';

describe('getLatestDataDay', () => {
  // --- Real data tests ---
  it('returns 11 for Ryu (real data through day 11)', () => {
    expect(getLatestDataDay(RYU_DAILY_FANS)).toBe(11);
  });

  it('returns 11 for Zero (real data, positive starts day 4 through 11)', () => {
    expect(getLatestDataDay(ZERO_DAILY_FANS)).toBe(11);
  });

  it('returns 11 for TheTengOne (real data, positive starts day 3 through 11)', () => {
    expect(getLatestDataDay(THE_TENG_ONE_DAILY_FANS)).toBe(11);
  });

  it('returns 1 for DOA IBU (only day 1 positive)', () => {
    expect(getLatestDataDay(DOA_IBU_DAILY_FANS)).toBe(1);
  });

  it('returns 2 for Kuro (positive days 1-2 only)', () => {
    expect(getLatestDataDay(KURO_DAILY_FANS)).toBe(2);
  });

  it('returns 11 for Sairen (positive starts day 6 through 11)', () => {
    expect(getLatestDataDay(SAIREN_DAILY_FANS)).toBe(11);
  });

  // --- Edge cases ---
  it('returns 0 for all-zero array', () => {
    const allZero = new Array(32).fill(0);
    expect(getLatestDataDay(allZero)).toBe(0);
  });

  it('returns 0 for all-negative array (transfer markers only)', () => {
    const allNeg = [-100, -200, -300, ...new Array(29).fill(0)];
    expect(getLatestDataDay(allNeg)).toBe(0);
  });

  it('returns 1 for single positive at index 0', () => {
    expect(getLatestDataDay([100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])).toBe(1);
  });

  it('returns 0 for positive only at index 31 (padding, ignored)', () => {
    const arr = new Array(31).fill(0);
    arr.push(100); // index 31 = padding
    expect(getLatestDataDay(arr)).toBe(0);
  });

  it('returns 0 for empty array', () => {
    expect(getLatestDataDay([])).toBe(0);
  });

  it('ignores zeros between positives and returns last positive', () => {
    // day 1=100, day 2=0, day 3=300, day 4=0, day 5=500
    const arr = [100, 0, 300, 0, 500, ...new Array(27).fill(0)];
    expect(getLatestDataDay(arr)).toBe(5);
  });
});
