/**
 * Timezone utilities using Node.js Intl API.
 *
 * Architecture:
 * - Data source (uma.moe) scrapes at 00:00 JST → 'Asia/Tokyo' is the data timezone
 * - Display timezone comes from config (default: 'Asia/Jakarta' / WIB)
 * - All internal date logic uses the data timezone (JST)
 * - Display conversion uses the configured display timezone
 *
 * Uses Intl.DateTimeFormat with IANA timezone names — handles DST and rules correctly.
 * No hardcoded UTC offsets.
 */

const DATA_TIMEZONE = 'Asia/Tokyo';

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/**
 * Extract date components in a specific IANA timezone.
 * Returns { year, month (1-12), day, hour, minute } in the given timezone.
 */
function extractInTimezone(
  date: Date,
  tz: string
): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const get = (type: string) => {
    const part = parts.find((p) => p.type === type);
    return parseInt(part?.value ?? '0', 10);
  };

  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
  };
}

function formatDateInTimezone(date: Date, tz: string): string {
  const { year, month, day } = extractInTimezone(date, tz);
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** Get the JST date string for a given Date (or now). */
export function getDataDate(date?: Date): string {
  return formatDateInTimezone(date ?? new Date(), DATA_TIMEZONE);
}

/** Get JST date components for a given Date (or now). */
export function getDataDateComponents(
  date?: Date
): { year: number; month: number; day: number } {
  const { year, month, day } = extractInTimezone(
    date ?? new Date(),
    DATA_TIMEZONE
  );
  return { year, month, day };
}

/** Get JST day of month (1-31). */
export function getDataDay(date?: Date): number {
  return extractInTimezone(date ?? new Date(), DATA_TIMEZONE).day;
}

/** Get day of month in a specific display timezone. */
export function getDisplayDay(displayTimezone: string, date?: Date): number {
  return extractInTimezone(date ?? new Date(), displayTimezone).day;
}

/** Get JST month (1-12). */
export function getDataMonth(date?: Date): number {
  return extractInTimezone(date ?? new Date(), DATA_TIMEZONE).month;
}

export function getDataYear(date?: Date): number {
  return extractInTimezone(date ?? new Date(), DATA_TIMEZONE).year;
}

/**
 * Calculate a target month by applying an offset to a base year/month.
 *
 * @param curYear  - Base year (e.g. current JST year)
 * @param curMonth - Base month 1-12 (e.g. current JST month)
 * @param offsetMonths - Number of months to go back (positive = past, negative = future)
 * @returns { year, month } of the target month
 *
 * @example getTargetMonth(2026, 1, 2)  → { year: 2025, month: 11 }
 * @example getTargetMonth(2026, 6, 1)  → { year: 2026, month: 5 }
 */
export function getTargetMonth(
  curYear: number,
  curMonth: number,
  offsetMonths: number
): { year: number; month: number } {
  const absOffset = Math.abs(offsetMonths);
  let targetMonth = curMonth - absOffset;
  let targetYear = curYear;
  while (targetMonth <= 0) {
    targetMonth += 12;
    targetYear--;
  }
  return { year: targetYear, month: targetMonth };
}

export const INDONESIAN_MONTHS = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

/**
 * Convert an ISO date string (YYYY-MM-DD) to Indonesian format.
 *
 * @example formatDateWIB('2026-06-11') → '11 Juni 2026'
 */
export function formatDateWIB(dateStr: string): string {
  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  const day = parseInt(dayStr, 10);
  const month = parseInt(monthStr, 10);
  const year = parseInt(yearStr, 10);
  return `${day} ${INDONESIAN_MONTHS[month - 1]} ${year}`;
}

/**
 * Format a Date for display in the configured timezone as "D/M HH:MM".
 * Used for the footer sync timestamp.
 */
export function formatForDisplay(
  date: Date,
  displayTimezone: string
): string {
  const { day, month, hour, minute } = extractInTimezone(date, displayTimezone);
  return `${day}/${month} ${pad2(hour)}:${pad2(minute)}`;
}


