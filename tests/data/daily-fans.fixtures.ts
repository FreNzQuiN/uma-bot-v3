/**
 * Shared test fixtures for daily-fans unit tests.
 *
 * Split from tests/data/daily-fans.unit.test.ts
 */

/** Ryu: positive days 1-11, zeros after. Normal member, no transfer. */
export const RYU_DAILY_FANS: number[] = [
  316856492, 319191258, 320992164, 323514848, 327253973,
  328785007, 329925021, 330462154, 331558385, 331992091,
  332207534, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0,
];

/** Zero: negative days 1-2, zero day 3, positive days 4-11. Transfer member. */
export const ZERO_DAILY_FANS: number[] = [
  -297503758, -298399518, 0, 301413137, 304147592,
  306882268, 309426635, 310890886, 312271653, 313515911,
  315534000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0,
];

/** TheTengOne: negative days 1-2, positive from day 3. Transfer member. */
export const THE_TENG_ONE_DAILY_FANS: number[] = [
  -185441175, -185443535, 185443535, 186553700, 187563991,
  189079865, 189082185, 189951320, 190842587, 191775429,
  191778327, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0,
];

/** DOA IBU: only day 1 positive, everything else zero. Minimal data. */
export const DOA_IBU_DAILY_FANS: number[] = [
  293009510, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
];

/** Kuro: positive days 1-2, zeros after. Minimal data. */
export const KURO_DAILY_FANS: number[] = [
  251759384, 251759384, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
];

/** Sairen: negative days 1-3, zeros 4-5, positive from day 6. Transfer, late join. */
export const SAIREN_DAILY_FANS: number[] = [
  -415766823, -418003335, -420131011, 0, 0,
  424931301, 428536838, 434061836, 437507350, 440583122,
  442813391, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0,
];

/** VitoHoow: negative day 1, zero day 2, positive from day 3. Transfer. */
export const VITOHOW_DAILY_FANS: number[] = [
  -285128340, 0, 285651571, 286952371, 287552390,
  288142157, 288726749, 289000998, 290092002, 290948071,
  292101214, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0,
];
