/**
 * Tests for isStaleMember.
 *
 * Split from tests/data/daily-fans.unit.test.ts
 */

import { isStaleMember } from '../../src/data/daily-fans';

describe('isStaleMember', () => {
  it('returns false when latestPositiveDay equals latestDataDay', () => {
    expect(isStaleMember(11, 11, 3)).toBe(false);
  });

  it('returns false when latestPositiveDay is 1 less than latestDataDay', () => {
    expect(isStaleMember(10, 11, 3)).toBe(false);
  });

  it('returns false when gap is less than staleAfterDays', () => {
    // latestPositiveDay=9, latestDataDay=11, staleAfterDays=3 → gap=2 < 3
    expect(isStaleMember(9, 11, 3)).toBe(false);
  });

  it('returns true when gap equals staleAfterDays', () => {
    // latestPositiveDay=8, latestDataDay=11, staleAfterDays=3 → gap=3 >= 3
    expect(isStaleMember(8, 11, 3)).toBe(true);
  });

  it('returns true when gap exceeds staleAfterDays', () => {
    // latestPositiveDay=5, latestDataDay=11, staleAfterDays=3 → gap=6 >= 3
    expect(isStaleMember(5, 11, 3)).toBe(true);
  });

  it('returns true when latestPositiveDay is 0 (no positive data)', () => {
    expect(isStaleMember(0, 11, 3)).toBe(true);
  });

  it('uses default staleAfterDays=3 when not provided', () => {
    expect(isStaleMember(8, 11)).toBe(true); // gap=3
    expect(isStaleMember(9, 11)).toBe(false); // gap=2
  });

  it('returns true when staleAfterDays is 0 (any gap or same-day is stale)', () => {
    // staleAfterDays=0 → latestPositiveDay <= latestDataDay - 0 → always stale
    expect(isStaleMember(11, 11, 0)).toBe(true);  // 11 <= 11
    expect(isStaleMember(10, 11, 0)).toBe(true);  // 10 <= 11
  });

  it('returns false when staleAfterDays is very large', () => {
    expect(isStaleMember(0, 11, 100)).toBe(false);
  });
});
