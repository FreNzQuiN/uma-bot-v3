/**
 * Shared formatting helpers for Uma Club Bot v3 reports.
 *
 * All reports use these helpers for consistent number formatting,
 * date localization, and message splitting for WhatsApp limits.
 */

// ============================================================
// Number formatting
// ============================================================

/**
 * Format a number for compact display in reports.
 *
 * - >= 1B → "1.5B"
 * - >= 1M → "349.1M"
 * - >= 1K → "50.0K"
 * - < 1K  → raw integer string
 */
export function formatNumber(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) {
    return (n / 1_000_000_000).toFixed(1) + 'B';
  }
  if (abs >= 1_000_000) {
    return (n / 1_000_000).toFixed(1) + 'M';
  }
  if (abs >= 1_000) {
    return (n / 1_000).toFixed(1) + 'K';
  }
  return String(n);
}

// ============================================================
// Date formatting
// ============================================================

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

import type { Snapshot, BotConfig } from '../types';
import { getLatestDataDay } from '../data/daily-fans';
import { getDataDateComponents, formatForDisplay } from '../utils/timezone';

// ============================================================
// Stale data warning
// ============================================================

/**
 * Check if a snapshot's data is stale (more than 1 day behind current data day).
 * Returns a warning string if stale, empty string if fresh.
 *
 * @param snapshotYear - Year from snapshot
 * @param snapshotMonth - Month from snapshot
 * @param dataDay - Latest data day number from snapshot
 * @param now - Optional Date override for testing (defaults to current time)
 */
export function getStaleDataWarning(
  snapshotYear: number,
  snapshotMonth: number,
  dataDay: number,
  now?: Date
): string {
  const { year: currentYear, month: currentMonth, day: currentDay } = getDataDateComponents(now);

  if (snapshotYear === currentYear && snapshotMonth === currentMonth) {
    if (dataDay < currentDay - 1) {
      const dateStr = `${snapshotYear}-${String(snapshotMonth).padStart(2, '0')}-${String(dataDay).padStart(2, '0')}`;
      const formattedDate = formatDateWIB(dateStr);
      return `⚠️ Data klub mungkin tidak terbaru (update terakhir: ${formattedDate})`;
    }
  }

  return '';
}

// ============================================================
// Shared report helpers
// ============================================================

/**
 * Build the snapshot date string from the data day.
 * Uses the snapshot's year/month and the computed data day.
 */
export function buildDateStr(snapshot: Snapshot, dataDay?: number): string {
  const { year, month } = snapshot.members[0];
  const day = dataDay ?? getDataDayFromSnapshot(snapshot);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getDataDayFromSnapshot(snapshot: Snapshot): number {
  let maxDay = 0;
  for (const member of snapshot.members) {
    const d = getLatestDataDay(member.daily_fans);
    if (d > maxDay) maxDay = d;
  }
  return maxDay;
}

/**
 * Build the sync footer for reports.
 * @param snapshotDate - Optional date string (YYYY-MM-DD) to show instead of current time.
 */
export function buildFooter(config: BotConfig, snapshotDate?: string): string {
  const parsed = snapshotDate && /^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)
    ? new Date(snapshotDate + 'T22:00:00+07:00')
    : new Date();
  const dateToUse = isNaN(parsed.getTime()) ? new Date() : parsed;
  return `⸻\nTerakhir sync: ${formatForDisplay(dateToUse, config.timezone)}`;
}

// ============================================================
// Data update line
// ============================================================

const DATA_UPDATE_STRING = '22:00 WIB';

export function buildDataLine(formattedDate: string): string {
  return `Periode data: ${formattedDate}, ${DATA_UPDATE_STRING}`;
}

// ============================================================
// Message splitting
// ============================================================

/**
 * Split a message into parts that fit within maxLength.
 * Splits at newline boundaries and adds "Part X/Y" markers.
 *
 * Uses a two-pass approach:
 * 1. Split content into chunks that fit (maxLength - markerOverhead)
 * 2. Prepend "Part X/Y\n" markers
 *
 * The marker overhead is estimated at 20 chars (covers "Part XX/XX\n").
 */
export function splitMessage(text: string, maxLength: number, splitAtNewline = true): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  if (!splitAtNewline) {
    const parts: string[] = [];
    let remaining = text;
    while (remaining.length > maxLength) {
      const markerLen = `Part ${Math.ceil(remaining.length / maxLength) + 1}/${Math.ceil(remaining.length / maxLength)}\n`.length;
      const effectiveMax = Math.max(1, maxLength - markerLen);
      parts.push(remaining.slice(0, effectiveMax));
      remaining = remaining.slice(effectiveMax);
    }
    if (remaining) parts.push(remaining);
    return parts.map((part, i) => `Part ${i + 1}/${parts.length}\n${part}`);
  }

  const lines = text.split('\n');
  const parts: string[] = [];
  let current = '';

  for (const line of lines) {
    const candidate = current ? current + '\n' + line : line;

    // Reserve space for Part marker
    const estimatedParts = parts.length + 2;
    const markerLen = `Part ${estimatedParts}/${estimatedParts}\n`.length;
    const effectiveMax = Math.max(1, maxLength - markerLen);

    if (candidate.length <= effectiveMax) {
      current = candidate;
    } else {
      if (current) {
        parts.push(current);
      }
      if (line.length > effectiveMax) {
        let remaining = line;
        while (remaining.length > effectiveMax) {
          parts.push(remaining.slice(0, effectiveMax));
          remaining = remaining.slice(effectiveMax);
        }
        current = remaining;
      } else {
        current = line;
      }
    }
  }

  if (current) {
    parts.push(current);
  }

  if (parts.length === 0) {
    return [text];
  }

  if (parts.length <= 1) {
    return parts;
  }

  // Final pass: compute exact markers now that we know total count
  return parts.map((part, i) => `Part ${i + 1}/${parts.length}\n${part}`);
}
