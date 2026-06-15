import {
  getLatestDataDay,
  getFirstPositiveDay,
  getDailyGain,
  getWeeklyGain,
  getMonthlyGain,
  isTransferMember,
  isStaleMember,
  computeRollingAverage,
  countActiveDays,
} from '../../src/data/daily-fans';

// ============================================================
// Real snapshot data for integration-level verification
// ============================================================

/** Ryu: positive days 1-11, zeros after. Normal member, no transfer. */
const RYU_DAILY_FANS: number[] = [
  316856492, 319191258, 320992164, 323514848, 327253973,
  328785007, 329925021, 330462154, 331558385, 331992091,
  332207534, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0,
];

/** Zero: negative days 1-2, zero day 3, positive days 4-11. Transfer member. */
const ZERO_DAILY_FANS: number[] = [
  -297503758, -298399518, 0, 301413137, 304147592,
  306882268, 309426635, 310890886, 312271653, 313515911,
  315534000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0,
];

/** TheTengOne: negative days 1-2, positive from day 3. Transfer member. */
const THE_TENG_ONE_DAILY_FANS: number[] = [
  -185441175, -185443535, 185443535, 186553700, 187563991,
  189079865, 189082185, 189951320, 190842587, 191775429,
  191778327, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0,
];

/** DOA IBU: only day 1 positive, everything else zero. Minimal data. */
const DOA_IBU_DAILY_FANS: number[] = [
  293009510, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
];

/** Kuro: positive days 1-2, zeros after. Minimal data. */
const KURO_DAILY_FANS: number[] = [
  251759384, 251759384, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
];

/** Sairen: negative days 1-3, zeros 4-5, positive from day 6. Transfer, late join. */
const SAIREN_DAILY_FANS: number[] = [
  -415766823, -418003335, -420131011, 0, 0,
  424931301, 428536838, 434061836, 437507350, 440583122,
  442813391, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0,
];

/** VitoHoow: negative day 1, zero day 2, positive from day 3. Transfer. */
const VITOHOW_DAILY_FANS: number[] = [
  -285128340, 0, 285651571, 286952371, 287552390,
  288142157, 288726749, 289000998, 290092002, 290948071,
  292101214, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0,
];

// ============================================================
// 1. getLatestDataDay
// ============================================================

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

// ============================================================
// 2. getFirstPositiveDay
// ============================================================

describe('getFirstPositiveDay', () => {
  // --- Real data tests ---
  it('returns 1 for Ryu (first positive at index 0)', () => {
    expect(getFirstPositiveDay(RYU_DAILY_FANS)).toBe(1);
  });

  it('returns 4 for Zero (first positive at index 3, after negatives and zero)', () => {
    expect(getFirstPositiveDay(ZERO_DAILY_FANS)).toBe(4);
  });

  it('returns 3 for TheTengOne (first positive at index 2)', () => {
    expect(getFirstPositiveDay(THE_TENG_ONE_DAILY_FANS)).toBe(3);
  });

  it('returns 6 for Sairen (first positive at index 5)', () => {
    expect(getFirstPositiveDay(SAIREN_DAILY_FANS)).toBe(6);
  });

  it('returns 3 for VitoHoow (first positive at index 2)', () => {
    expect(getFirstPositiveDay(VITOHOW_DAILY_FANS)).toBe(3);
  });

  // --- Edge cases ---
  it('returns 0 for all-zero array', () => {
    const allZero = new Array(32).fill(0);
    expect(getFirstPositiveDay(allZero)).toBe(0);
  });

  it('returns 0 for all-negative array', () => {
    const allNeg = [-100, -200, -300, ...new Array(29).fill(0)];
    expect(getFirstPositiveDay(allNeg)).toBe(0);
  });

  it('returns 0 for empty array', () => {
    expect(getFirstPositiveDay([])).toBe(0);
  });

  it('returns 1 for positive at start', () => {
    expect(getFirstPositiveDay([50, 100, 200, ...new Array(29).fill(0)])).toBe(1);
  });

  it('returns 10 for first positive at index 9', () => {
    const arr = [
      0, 0, 0, 0, 0, 0, 0, 0, 0,
      1000, 2000, ...new Array(21).fill(0),
    ];
    expect(getFirstPositiveDay(arr)).toBe(10);
  });
});

// ============================================================
// 3. getDailyGain
// ============================================================

describe('getDailyGain', () => {
  // --- Real data tests ---
  it('returns 0 for day 1 of Ryu (no previous day)', () => {
    expect(getDailyGain(RYU_DAILY_FANS, 1)).toBe(0);
  });

  it('returns correct gain for Ryu day 2', () => {
    // 319191258 - 316856492 = 2334766
    expect(getDailyGain(RYU_DAILY_FANS, 2)).toBe(319191258 - 316856492);
  });

  it('returns correct gain for Ryu day 11 (last data day)', () => {
    // 332207534 - 331992091 = 215443
    expect(getDailyGain(RYU_DAILY_FANS, 11)).toBe(332207534 - 331992091);
  });

  it('returns 0 for Ryu day 12 (day is zero)', () => {
    expect(getDailyGain(RYU_DAILY_FANS, 12)).toBe(0);
  });

  it('returns 0 for Zero day 4 (first positive, previous is 0 — baseline)', () => {
    expect(getDailyGain(ZERO_DAILY_FANS, 4)).toBe(0);
  });

  it('returns correct gain for Zero day 5', () => {
    // 304147592 - 301413137 = 2734455
    expect(getDailyGain(ZERO_DAILY_FANS, 5)).toBe(304147592 - 301413137);
  });

  it('returns 0 for Zero day 3 (both zero)', () => {
    expect(getDailyGain(ZERO_DAILY_FANS, 3)).toBe(0);
  });

  // --- Edge cases ---
  it('returns 0 for day 0 (invalid 1-indexed)', () => {
    expect(getDailyGain(RYU_DAILY_FANS, 0)).toBe(0);
  });

  it('returns 0 for negative day', () => {
    expect(getDailyGain(RYU_DAILY_FANS, -1)).toBe(0);
  });

  it('returns 0 when day exceeds array length', () => {
    expect(getDailyGain(RYU_DAILY_FANS, 50)).toBe(0);
  });

  it('returns 0 for empty array', () => {
    expect(getDailyGain([], 1)).toBe(0);
  });

  it('returns 0 when current is negative (transfer marker)', () => {
    expect(getDailyGain(ZERO_DAILY_FANS, 1)).toBe(0);
  });

  it('returns 0 when previous is negative (transfer marker)', () => {
    // Zero day 2: dailyFans[1]=-298399518 (negative), dailyFans[0]=-297503758 (negative)
    // Both non-positive → 0
    expect(getDailyGain(ZERO_DAILY_FANS, 2)).toBe(0);
  });

  it('returns 0 when current positive but previous negative', () => {
    // TheTengOne day 3: dailyFans[2]=185443535, dailyFans[1]=-185443535
    expect(getDailyGain(THE_TENG_ONE_DAILY_FANS, 3)).toBe(0);
  });

  it('handles equal consecutive values (zero gain)', () => {
    // Kuro day 2: dailyFans[1]=251759384, dailyFans[0]=251759384
    expect(getDailyGain(KURO_DAILY_FANS, 2)).toBe(0);
  });
});

// ============================================================
// 4. getWeeklyGain
// ============================================================

describe('getWeeklyGain', () => {
  // --- Real data tests ---
  it('returns correct week 1 gain for Ryu', () => {
    // First positive: 316856492 (day 1), Last positive: 329925021 (day 7)
    // Gain = 329925021 - 316856492 = 13068529
    expect(getWeeklyGain(RYU_DAILY_FANS, 1)).toBe(13068529);
  });

  it('returns correct week 2 gain for Ryu', () => {
    // Spec formula: lastPositiveInBlock - valueBeforeBlock
    // valueBeforeBlock (day 7) = 329925021
    // lastPositiveInBlock (day 11) = 332207534
    // Gain = 332207534 - 329925021 = 2282513
    expect(getWeeklyGain(RYU_DAILY_FANS, 2)).toBe(2282513);
  });

  it('returns 0 for week 3 of Ryu (all zeros)', () => {
    expect(getWeeklyGain(RYU_DAILY_FANS, 3)).toBe(0);
  });

  it('returns 0 for week 4 of Ryu (all zeros)', () => {
    expect(getWeeklyGain(RYU_DAILY_FANS, 4)).toBe(0);
  });

  it('returns 0 for week 5 of Ryu (all zeros)', () => {
    expect(getWeeklyGain(RYU_DAILY_FANS, 5)).toBe(0);
  });

  it('returns correct week 1 gain for Zero (transfer, positive starts day 4)', () => {
    // Week 1 (days 1-7): negatives day 1-2, zero day 3, positives day 4-7
    // First positive: 301413137 (day 4), Last positive: 309426635 (day 7)
    // Gain = 309426635 - 301413137 = 8013498
    expect(getWeeklyGain(ZERO_DAILY_FANS, 1)).toBe(8013498);
  });

  it('returns correct week 2 gain for Zero', () => {
    // Spec formula: lastPositiveInBlock - valueBeforeBlock
    // valueBeforeBlock (day 7) = 309426635
    // lastPositiveInBlock (day 11) = 315534000
    // Gain = 315534000 - 309426635 = 6107365
    expect(getWeeklyGain(ZERO_DAILY_FANS, 2)).toBe(6107365);
  });

  it('returns 0 for week 1 when all values in block are zero or negative', () => {
    const arr = [-100, -200, 0, 0, 0, 0, 0, ...new Array(25).fill(0)];
    expect(getWeeklyGain(arr, 1)).toBe(0);
  });

  it('returns 0 for week 1 with only one positive value (baseline)', () => {
    const arr = [0, 0, 0, 0, 0, 0, 100, ...new Array(25).fill(0)];
    expect(getWeeklyGain(arr, 1)).toBe(0);
  });

  it('handles transfer member who joins mid-block (TheTengOne week 1)', () => {
    // Week 1: negative days 1-2, positive days 3-7
    // First positive: 185443535 (day 3), Last positive: 189082185 (day 7)
    // Gain = 189082185 - 185443535 = 3638650
    expect(getWeeklyGain(THE_TENG_ONE_DAILY_FANS, 1)).toBe(3638650);
  });

  it('handles Sairen week 1 (late join, zeros in block)', () => {
    // Week 1: negative days 1-3, zero days 4-5, positive days 6-7
    // First positive: 424931301 (day 6), Last positive: 428536838 (day 7)
    // Gain = 428536838 - 424931301 = 3605537
    expect(getWeeklyGain(SAIREN_DAILY_FANS, 1)).toBe(3605537);
  });

  it('returns 0 for invalid week number 0', () => {
    expect(getWeeklyGain(RYU_DAILY_FANS, 0)).toBe(0);
  });

  it('returns 0 for invalid week number 6', () => {
    expect(getWeeklyGain(RYU_DAILY_FANS, 6)).toBe(0);
  });

  it('returns 0 for week 5 with no positive data', () => {
    expect(getWeeklyGain(RYU_DAILY_FANS, 5)).toBe(0);
  });

  it('returns correct week 5 gain for a member with late-month data', () => {
    // Create a member with data only in week 5 (days 29-31)
    const arr = new Array(28).fill(0);
    arr.push(100000, 105000, 110000); // days 29, 30, 31
    // First positive: 100000, Last positive: 110000
    // Gain = 10000
    expect(getWeeklyGain(arr, 5)).toBe(10000);
  });
});

// ============================================================
// 5. getMonthlyGain
// ============================================================

describe('getMonthlyGain', () => {
  // --- Real data tests ---
  it('returns correct monthly gain for Ryu', () => {
    // First positive: 316856492 (day 1), Latest positive: 332207534 (day 11)
    // Gain = 332207534 - 316856492 = 15351042
    expect(getMonthlyGain(RYU_DAILY_FANS)).toBe(15351042);
  });

  it('returns correct monthly gain for Zero (transfer member)', () => {
    // First positive: 301413137 (day 4), Latest positive: 315534000 (day 11)
    // Gain = 315534000 - 301413137 = 14120863
    expect(getMonthlyGain(ZERO_DAILY_FANS)).toBe(14120863);
  });

  it('returns correct monthly gain for TheTengOne', () => {
    // First positive: 185443535 (day 3), Latest positive: 191778327 (day 11)
    // Gain = 191778327 - 185443535 = 6334792
    expect(getMonthlyGain(THE_TENG_ONE_DAILY_FANS)).toBe(6334792);
  });

  it('returns 0 for DOA IBU (only one positive day — baseline only)', () => {
    expect(getMonthlyGain(DOA_IBU_DAILY_FANS)).toBe(0);
  });

  it('returns 0 for Kuro (only one positive value, same value both days)', () => {
    // Kuro day 1=251759384, day 2=251759384 → same value, gain = 0
    expect(getMonthlyGain(KURO_DAILY_FANS)).toBe(0);
  });

  // --- Edge cases ---
  it('returns 0 for all-zero array', () => {
    const allZero = new Array(32).fill(0);
    expect(getMonthlyGain(allZero)).toBe(0);
  });

  it('returns 0 for all-negative array', () => {
    const allNeg = [-100, -200, -300, ...new Array(29).fill(0)];
    expect(getMonthlyGain(allNeg)).toBe(0);
  });

  it('returns 0 for empty array', () => {
    expect(getMonthlyGain([])).toBe(0);
  });

  it('returns 0 for single positive value', () => {
    const arr = [500, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    expect(getMonthlyGain(arr)).toBe(0);
  });

  it('returns positive gain when first and last differ', () => {
    const arr = [100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 200, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    expect(getMonthlyGain(arr)).toBe(100);
  });
});

// ============================================================
// 6. isTransferMember
// ============================================================

describe('isTransferMember', () => {
  it('returns true when previous_circle_id is set', () => {
    expect(isTransferMember({
      daily_fans: RYU_DAILY_FANS,
      previous_circle_id: 555894304,
      previous_circle_name: 'Advent',
    })).toBe(true);
  });

  it('returns true when previous_circle_name is set', () => {
    expect(isTransferMember({
      daily_fans: RYU_DAILY_FANS,
      previous_circle_name: 'SomeClub',
    })).toBe(true);
  });

  it('returns true when daily_fans[0] is negative', () => {
    expect(isTransferMember({
      daily_fans: [-100, 200, 300, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    })).toBe(true);
  });

  it('returns true for Zero (both previous info and negative daily_fans)', () => {
    expect(isTransferMember({
      daily_fans: ZERO_DAILY_FANS,
      previous_circle_id: 555894304,
      previous_circle_name: 'Advent',
    })).toBe(true);
  });

  it('returns false for Ryu (no previous info, positive daily_fans)', () => {
    expect(isTransferMember({
      daily_fans: RYU_DAILY_FANS,
    })).toBe(false);
  });

  it('returns false for all-positive daily_fans with no previous info', () => {
    expect(isTransferMember({
      daily_fans: [100, 200, 300, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    })).toBe(false);
  });

  it('returns false for all-zero daily_fans with no previous info', () => {
    expect(isTransferMember({
      daily_fans: new Array(32).fill(0),
    })).toBe(false);
  });

  it('returns false for empty daily_fans with no previous info', () => {
    expect(isTransferMember({
      daily_fans: [],
    })).toBe(false);
  });
});

// ============================================================
// 7. isStaleMember
// ============================================================

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

// ============================================================
// 8. computeRollingAverage
// ============================================================

describe('computeRollingAverage', () => {
  it('computes 7-day average for Ryu correctly', () => {
    // Ryu's gains (day 2-11):
    // day 2: 319191258-316856492 = 2334766
    // day 3: 320992164-319191258 = 1800906
    // day 4: 323514848-320992164 = 2522684
    // day 5: 327253973-323514848 = 3739125
    // day 6: 328785007-327253973 = 1531034
    // day 7: 329925021-328785007 = 1140014
    // day 8: 330462154-329925021 = 537133
    // day 9: 331558385-330462154 = 1096231
    // day 10: 331992091-331558385 = 433706
    // day 11: 332207534-331992091 = 215443
    // Last 7 days (days 5-11): 3739125+1531034+1140014+537133+1096231+433706+215443 = 8692686
    // Average = 8692686 / 7 = 1241812.285...
    const avg = computeRollingAverage(RYU_DAILY_FANS, 11, 7);
    expect(avg).toBe(Math.floor(8692686 / 7));
  });

  it('computes 3-day average for Ryu correctly', () => {
    // Last 3 days (days 9-11): 433706+215443+1096231 = wrong order
    // Last 3 valid gains: day 9=433706, day 10=215443... wait let me recalculate
    // Actually: last 3 days from latestDataDay=11 are days 11, 10, 9
    // day 11: 215443, day 10: 433706, day 9: 1096231
    // Sum = 1745380, avg = 581793.333...
    const avg = computeRollingAverage(RYU_DAILY_FANS, 11, 3);
    expect(avg).toBe(Math.floor((215443 + 433706 + 1096231) / 3));
  });

  it('returns 0 when no valid gain days exist', () => {
    const arr = new Array(32).fill(0);
    expect(computeRollingAverage(arr, 0, 7)).toBe(0);
  });

  it('returns 0 for empty array', () => {
    expect(computeRollingAverage([], 0, 7)).toBe(0);
  });

  it('handles case where fewer days have valid gains than requested window', () => {
    // DOA IBU: only 1 day positive → 0 gains → avg = 0
    expect(computeRollingAverage(DOA_IBU_DAILY_FANS, 1, 7)).toBe(0);
  });

  it('computes correctly when transfer member has limited gain history', () => {
    // Zero: first gain is day 5 (day 4 is baseline)
    // Last 3 days from day 11:
    // day 11: 315534000-313515911 = 2018089
    // day 10: 313515911-312271653 = 1244258
    // day 9: 312271653-310890886 = 1380767
    const avg = computeRollingAverage(ZERO_DAILY_FANS, 11, 3);
    expect(avg).toBe(Math.floor((2018089 + 1244258 + 1380767) / 3));
  });

  it('handles days=1 (single day rolling average)', () => {
    // Ryu day 11 gain = 215443
    const avg = computeRollingAverage(RYU_DAILY_FANS, 11, 1);
    expect(avg).toBe(215443);
  });

  it('handles days larger than available data window', () => {
    // Request 20-day average but only 11 days of data
    // Should only count gains that exist (days 2-11 = 10 gains)
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

// ============================================================
// 9. countActiveDays
// ============================================================

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

// ============================================================
// Additional edge case tests
// ============================================================

describe('Additional edge cases', () => {
  describe('computeRollingAverage: days=0 and negative days', () => {
    it('returns 0 when days=0', () => {
      expect(computeRollingAverage(RYU_DAILY_FANS, 11, 0)).toBe(0);
    });

    it('returns 0 when days is negative', () => {
      expect(computeRollingAverage(RYU_DAILY_FANS, 11, -5)).toBe(0);
    });
  });

  describe('countActiveDays: single-element array', () => {
    it('returns 1 for single-element array with data (day 1 counted)', () => {
      expect(countActiveDays([100])).toBe(1);
    });
  });

  describe('getMonthlyGain: latest value less than first (negative gain)', () => {
    it('returns negative gain when latest < first', () => {
      // first positive day 1=500, latest positive day 3=300 → gain = -200
      const arr = [500, 400, 300, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      expect(getMonthlyGain(arr)).toBe(-200);
    });
  });

  describe('isStaleMember: both inputs are 0', () => {
    it('returns false when both latestPositiveDay and latestDataDay are 0', () => {
      // 0 <= 0 - 3 → 0 <= -3 → false
      expect(isStaleMember(0, 0, 3)).toBe(false);
    });
  });

  describe('getWeeklyGain: transfer member in week 5', () => {
    it('handles transfer member with negatives in week 5 block', () => {
      // Transfer: negative days 1-28, positive days 29-31
      const arr = [
        ...new Array(28).fill(-1000),
        50000, 55000, 60000,
      ];
      // Week 5 (days 29-31): no valueBeforeBlock (all negatives before)
      // firstPositiveInBlock = 50000, lastPositiveInBlock = 60000
      // baseline = firstPositiveInBlock = 50000
      // gain = 60000 - 50000 = 10000
      expect(getWeeklyGain(arr, 5)).toBe(10000);
    });

    it('handles week 5 with valueBeforeBlock from week 4', () => {
      // Positive days 1-28, positive days 29-31
      const arr = [
        ...new Array(28).fill(100000),
        200000, 210000, 220000,
      ];
      // valueBeforeBlock = last positive before day 29 = dailyFans[27] = 100000
      // lastPositiveInBlock = 220000
      // gain = 220000 - 100000 = 120000
      expect(getWeeklyGain(arr, 5)).toBe(120000);
    });
  });

  describe('getDailyGain: exact boundary', () => {
    it('returns 0 for day exactly at array length (padding)', () => {
      // 32-element array, day 32 = index 31 (padding, value 0)
      expect(getDailyGain(RYU_DAILY_FANS, 32)).toBe(0);
    });

    it('returns correct gain for day exactly at array length when last is positive', () => {
      const arr = [100, 200, 300, 400];
      expect(getDailyGain(arr, 4)).toBe(100); // 400 - 300
    });
  });

  describe('computeRollingAverage: all gains are zero', () => {
    it('returns 0 when all consecutive values are equal (zero gains)', () => {
      // All same value → all gains are 0 → no positive gains counted
      const arr = new Array(32).fill(1000);
      expect(computeRollingAverage(arr, 10, 7)).toBe(0);
    });
  });

  describe('getWeeklyGain: single positive value with valueBeforeBlock', () => {
    it('returns 0 when valueBeforeBlock equals the only positive in block', () => {
      // Positive in weeks 1 and 2, same value carried over
      const arr = [
        100, 200, 300, 400, 500, 600, 700,  // week 1
        700, 0, 0, 0, 0, 0, 0,                // week 2 (same value as last of week 1)
        ...new Array(18).fill(0),
      ];
      // valueBeforeBlock (before day 8) = last positive in days 1-7 = 700
      // lastPositiveInBlock = 700 (day 8)
      // baseline = valueBeforeBlock = 700, same as lastPositiveInBlock → gain = 0
      expect(getWeeklyGain(arr, 2)).toBe(0);
    });
  });
});

// ============================================================
// Integration tests with snapshot data
// ============================================================

describe('Integration with snapshot data', () => {
  it('Sairen: getFirstPositiveDay matches real data (day 6)', () => {
    expect(getFirstPositiveDay(SAIREN_DAILY_FANS)).toBe(6);
  });

  it('Sairen: getLatestDataDay matches real data (day 11)', () => {
    expect(getLatestDataDay(SAIREN_DAILY_FANS)).toBe(11);
  });

  it('Sairen: getMonthlyGain computes correctly', () => {
    // First: 424931301 (day 6), Latest: 442813391 (day 11)
    expect(getMonthlyGain(SAIREN_DAILY_FANS)).toBe(442813391 - 424931301);
  });

  it('Sairen: countActiveDays (day 6 baseline, days 7-11 gains)', () => {
    // Day 6: baseline → 0
    // Day 7: 428536838-424931301=3605537
    // Day 8: 434061836-428536838=5524998
    // Day 9: 437507350-434061836=3445514
    // Day 10: 440583122-437507350=3075772
    // Day 11: 442813391-440583122=2230269
    // 5 active days
    expect(countActiveDays(SAIREN_DAILY_FANS)).toBe(5);
  });

  it('VitoHoow: getFirstPositiveDay is 3 (day 2 is zero)', () => {
    expect(getFirstPositiveDay(VITOHOW_DAILY_FANS)).toBe(3);
  });

  it('VitoHoow: getDailyGain day 3 is 0 (baseline, prev is zero)', () => {
    expect(getDailyGain(VITOHOW_DAILY_FANS, 3)).toBe(0);
  });

  it('VitoHoow: getDailyGain day 4 is correct', () => {
    // 286952371 - 285651571 = 1300800
    expect(getDailyGain(VITOHOW_DAILY_FANS, 4)).toBe(1300800);
  });
});
