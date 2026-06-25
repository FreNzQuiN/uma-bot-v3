/**
 * Tests for isStaleForReport.
 *
 * Split from tests/data/daily-fans.unit.test.ts
 */

import { isStaleForReport } from '../../src/data/daily-fans';

describe('isStaleForReport', () => {
  it('returns false when threshold is 0 (disabled)', () => {
    expect(isStaleForReport([100, 200, 300], 3, 0)).toBe(false);
  });

  it('returns false when threshold is negative', () => {
    expect(isStaleForReport([100, 200, 300], 3, -1)).toBe(false);
  });

  it('returns false when latestDataDay is 0', () => {
    expect(isStaleForReport([], 0, 3)).toBe(false);
  });

  it('returns false when all days have positive gain', () => {
    // Day 3: 300-200=100 > 0 → break, count=0
    expect(isStaleForReport([100, 200, 300], 3, 3)).toBe(false);
  });

  it('returns true when consecutive zero-gain days equal threshold', () => {
    // Days: [100, 200, 200, 200]
    // Day 4 gain: 200-200=0, day 3 gain: 200-200=0, day 2 gain: 200-100=100 > 0 → break
    // count=2, threshold=2
    expect(isStaleForReport([100, 200, 200, 200], 4, 2)).toBe(true);
  });

  it('returns true when consecutive zero-gain days exceed threshold', () => {
    // Days: [100, 200, 200, 200, 200]
    // Day 5: 0, day 4: 0, day 3: 0, day 2: 100 > 0 → break
    // count=3, threshold=2
    expect(isStaleForReport([100, 200, 200, 200, 200], 5, 2)).toBe(true);
  });

  it('handles gap with non-positive previous value', () => {
    // Days: [100, 200, 0, 300]
    // Day 4 current=300 positive, previous=0 not positive → gain=0
    // Day 3 current=0 not positive → gain=0
    // Day 2 gain=200-100=100 > 0 → break
    // count=2, threshold=2
    expect(isStaleForReport([100, 200, 0, 300], 4, 2)).toBe(true);
  });

  it('returns false when gap is smaller than threshold', () => {
    // Days: [100, 200, 200, 300]
    // Day 4 gain=300-200=100 > 0 → break, count=0
    expect(isStaleForReport([100, 200, 200, 300], 4, 3)).toBe(false);
  });

  it('returns true when all values are identical for many days', () => {
    // All same → all gains are 0 → count = numberOfDays-1 (day 1 has no gain)
    // 10 values: days 2-10 all gain=0 → count=9
    expect(isStaleForReport(new Array(10).fill(1000), 10, 9)).toBe(true);
  });
});
