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

// Re-export from utils/timezone for backward compatibility
import { INDONESIAN_MONTHS, formatDateWIB, getDataDateComponents, formatForDisplay } from '../utils/timezone';
export { INDONESIAN_MONTHS, formatDateWIB };

import type { Snapshot, BotConfig } from '../types';
import { getLatestDataDay } from '../data/daily-fans';

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
// Name sanitization
// ============================================================

/**
 * Sanitize a trainer name for safe embedding in WhatsApp formatted messages.
 * Escapes WhatsApp formatting characters (*, _, ~) to prevent injection.
 */
export function sanitizeName(name: string): string {
  return name
    .replace(/\*/g, '')
    .replace(/_/g, ' ')
    .replace(/~/g, '-');
}

// ============================================================
// Shared report helpers
// ============================================================

/**
 * Build the snapshot date string from the data day.
 * Uses the snapshot's year/month and the computed data day.
 */
export function buildDateStr(snapshot: Snapshot, dataDay?: number): string {
  if (snapshot.members.length === 0) return 'Unknown-Date';
  const { year, month } = snapshot.members[0];
  const day = dataDay ?? getDataDayFromSnapshot(snapshot);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

import { getDataDayFromSnapshot } from '../data/snapshot';

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
// Message splitting (delegated to utils/format.ts)
// ============================================================

export { splitMessage } from '../utils/format';
