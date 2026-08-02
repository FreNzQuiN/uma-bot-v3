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

const DATA_TIMEZONE = "Asia/Tokyo";

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/**
 * Extract date components in a specific IANA timezone.
 * Returns { year, month (1-12), day, hour, minute } in the given timezone.
 */
function extractInTimezone(
  date: Date,
  tz: string,
): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const get = (type: string) => {
    const part = parts.find((p) => p.type === type);
    return parseInt(part?.value ?? "0", 10);
  };

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

function formatDateInTimezone(date: Date, tz: string): string {
  const { year, month, day } = extractInTimezone(date, tz);
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** JST date as YYYY-MM-DD (defaults to now). */
export function getDataDate(date?: Date): string {
  return formatDateInTimezone(date ?? new Date(), DATA_TIMEZONE);
}

export function getDataDateComponents(date?: Date): {
  year: number;
  month: number;
  day: number;
} {
  const { year, month, day } = extractInTimezone(
    date ?? new Date(),
    DATA_TIMEZONE,
  );
  return { year, month, day };
}

export function getDataDay(date?: Date): number {
  return extractInTimezone(date ?? new Date(), DATA_TIMEZONE).day;
}

export function getDisplayDay(displayTimezone: string, date?: Date): number {
  return extractInTimezone(date ?? new Date(), displayTimezone).day;
}

export function getDataMonth(date?: Date): number {
  return extractInTimezone(date ?? new Date(), DATA_TIMEZONE).month;
}

export function getDataYear(date?: Date): number {
  return extractInTimezone(date ?? new Date(), DATA_TIMEZONE).year;
}

/**
 * Target month by offset from a base year/month.
 * Always goes backwards — absolute value of offset is used.
 *
 * @example getTargetMonth(2026, 1, 2) → { year: 2025, month: 11 }
 * @example getTargetMonth(2026, 6, 1) → { year: 2026, month: 5 }
 */
export function getTargetMonth(
  curYear: number,
  curMonth: number,
  offsetMonths: number,
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
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

/**
 * Format an ISO date (YYYY-MM-DD) as Indonesian, e.g. '11 Juni 2026'.
 */
export function formatDateWIB(dateStr: string): string {
  const [yearStr, monthStr, dayStr] = dateStr.split("-");
  const day = parseInt(dayStr, 10);
  const month = parseInt(monthStr, 10);
  const year = parseInt(yearStr, 10);
  return `${day} ${INDONESIAN_MONTHS[month - 1]} ${year}`;
}

/**
 * Format a Date for display in the configured timezone as "D/M HH:MM".
 * Used for the footer sync timestamp.
 */
export function formatForDisplay(date: Date, displayTimezone: string): string {
  const { day, month, hour, minute } = extractInTimezone(date, displayTimezone);
  return `${day}/${month} ${pad2(hour)}:${pad2(minute)}`;
}
