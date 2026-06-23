/**
 * Tests for countActiveDays.
 *
 * Split from tests/data/daily-fans.unit.test.ts
 */

import { countActiveDays } from '../../src/data/daily-fans';
import {
  RYU_DAILY_FANS,
  ZERO_DAILY_FANS,
  DOA_IBU_DAILY_FANS,
  KURO_DAILY_FANS,
  THE_TENG_ONE_DAILY_FANS,
} from './daily-fans.fixtures';

describe('countActiveDays', () => {
  // --- Real data tests ---
  it('counts active days for Ryu (11 days with data, days 1-11)', () => {
    // Day 1 has data → counted
    // Gains: day 2=2334766, day 3=1800906, day 4=2522684, day 5=3739125,
    // day 6=1531034, day 7=1140014, day 8=537133, day 9=1096231,
    // day 10=433706, day 11=215443
    // All are positive → 11 active days (day 1 + 10 gain days)
    expect(countActiveDays(RYU_DAILY_FANS)).toBe(11);
  });

  it('counts active days for Zero (days 5-11, day 4 is baseline)', () => {
    // Day 4: baseline (prev is 0) → gain 0
    // Day 5: 304147592-301413137=2734455
    // Day 6: 306882268-304147592=2734676
    // Day 7: 309426635-306882268=2544367
    // Day 8: 310890886-309426635=1464251
    // Day 9: 312271653-310890886=1380767
    // Day 10: 313515911-312271653=1244258
    // Day 11: 315534000-313515911=2018089
    // 7 active days (day 5-11)
    expect(countActiveDays(ZERO_DAILY_FANS)).toBe(7);
  });

  it('returns 0 for all-zero array', () => {
    const allZero = new Array(32).fill(0);
    expect(countActiveDays(allZero)).toBe(0);
  });

  it('returns 0 for all-negative array', () => {
    const allNeg = [-100, -200, -300, ...new Array(29).fill(0)];
    expect(countActiveDays(allNeg)).toBe(0);
  });

  it('returns 0 for empty array', () => {
    expect(countActiveDays([])).toBe(0);
  });

  it('returns 1 for DOA IBU (day 1 has data, no gains)', () => {
    expect(countActiveDays(DOA_IBU_DAILY_FANS)).toBe(1);
  });

  it('returns 1 when all consecutive values are equal (day 1 counted)', () => {
    expect(countActiveDays(KURO_DAILY_FANS)).toBe(1);
  });

  it('counts correctly when gains alternate positive and zero', () => {
    // [100, 200, 200, 400, 400, 500, ...] → day 1 counted, gains: +100, 0, +200, 0, +100 → 4 active
    const arr = [100, 200, 200, 400, 400, 500, ...new Array(26).fill(0)];
    expect(countActiveDays(arr)).toBe(4);
  });

  it('counts TheTengOne active days (day 3 baseline, day 4+ gains)', () => {
    // Day 3: first positive → baseline → gain 0
    // Day 4: 186553700-185443535=1110165
    // Day 5: 187563991-186553700=1010291
    // Day 6: 189079865-187563991=1515874
    // Day 7: 189082185-189079865=2320
    // Day 8: 189951320-189082185=869135
    // Day 9: 190842587-189951320=891267
    // Day 10: 191775429-190842587=932842
    // Day 11: 191778327-191775429=2898
    // 8 active days (days 4-11)
    expect(countActiveDays(THE_TENG_ONE_DAILY_FANS)).toBe(8);
  });
});
