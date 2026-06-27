/**
 * Snapshot save/load functionality for the Uma Club Bot.
 *
 * Snapshots are raw uma.moe API responses saved as JSON files.
 * Path format: data/snapshots/YYYY/MM/DD.json
 */

import * as fs from 'fs';
import * as path from 'path';
import { Snapshot } from '../types';
import { formatDateWIB } from '../utils/timezone';
import { log } from '../utils/logger';

/** Base directory name under which snapshots are stored (relative to root). */
const SNAPSHOTS_DIR = 'data/snapshots';

let cachedLatestSnapshot: Snapshot | null = null;

/**
 * Get the cached latest snapshot (no disk I/O).
 * Returns null if cache is empty (e.g., before first load).
 */
export function getCachedSnapshot(): Snapshot | null {
  return cachedLatestSnapshot;
}

/**
 * Update the in-memory snapshot cache.
 * Called after every saveSnapshot() and after initial load.
 */
export function setCachedSnapshot(snapshot: Snapshot | null): void {
  if (snapshot) {
    const prev = cachedLatestSnapshot;
    const changed = !prev
      || prev.circle.circle_id !== snapshot.circle.circle_id
      || prev.circle.last_updated !== snapshot.circle.last_updated;
    if (changed) {
      log.debug('Snapshot', `Cache updated: circle=${snapshot.circle.circle_id} updated=${snapshot.circle.last_updated ?? 'unknown'}`);
    }
  }
  cachedLatestSnapshot = snapshot;
}

/**
 * Invalidate the snapshot cache. Next getSnapshot() call will re-read from disk.
 */
export function invalidateSnapshotCache(): void {
  if (cachedLatestSnapshot) {
    log.debug('Snapshot', 'Cache invalidated');
  }
  cachedLatestSnapshot = null;
}

/**
 * Build the full path for a snapshot file.
 * @param dataDay WIB date string e.g. "2026-06-11"
 * @param rootDir Base directory (default: project root)
 */
function buildSnapshotPath(dataDay: string, rootDir: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataDay)) {
    throw new Error(`Invalid dataDay format: "${dataDay}". Expected YYYY-MM-DD`);
  }
  const [year, month, day] = dataDay.split('-');
  return path.join(rootDir, SNAPSHOTS_DIR, year, month, `${day}.json`);
}

function isValidSnapshot(data: unknown): data is Snapshot {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;
  return (
    typeof obj.circle === 'object' &&
    obj.circle !== null &&
    Array.isArray(obj.members)
  );
}

/**
 * Save a snapshot to disk.
 *
 * @param dataDay - WIB date string like "2026-06-11"
 * @param rootDir - Base project directory (for testing; defaults to process.cwd())
 * @returns The file path that was saved
 */
export function saveSnapshot(
  snapshot: Snapshot,
  dataDay: string,
  rootDir: string = process.cwd()
): string {
  const filePath = buildSnapshotPath(dataDay, rootDir);
  const dir = path.dirname(filePath);

  fs.mkdirSync(dir, { recursive: true });

  // Write to temp file then rename for atomicity.
  // This prevents corrupt files if the process crashes mid-write.
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(snapshot, null, 2), 'utf-8');
  fs.renameSync(tmpPath, filePath);

  log.debug('Snapshot', `Saved ${dataDay} (${(snapshot.members ?? []).length} members) to ${filePath}`);

  return filePath;
}

/**
 * Load a snapshot from disk.
 *
 * @param dataDay - WIB date string like "2026-06-11"
 * @param rootDir - Base project directory (for testing; defaults to process.cwd())
 * @returns Parsed Snapshot or null if file doesn't exist or is invalid
 */
export function loadSnapshot(
  dataDay: string,
  rootDir: string = process.cwd()
): Snapshot | null {
  const filePath = buildSnapshotPath(dataDay, rootDir);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    if (!raw || raw.trim() === '') return null;

    const parsed: unknown = JSON.parse(raw);

    if (!isValidSnapshot(parsed)) {
      return null;
    }

    return parsed;
  } catch (err) {
    // Corrupt JSON or any parse error
    log.debug('Snapshot', `Failed to load ${dataDay}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Load the most recent snapshot from disk.
 * Scans all YYYY/MM/DD.json files and returns the latest by date.
 *
 * @param rootDir - Base project directory (for testing; defaults to process.cwd())
 * @returns The latest Snapshot or null if none exist
 */
export function loadLatestSnapshot(
  rootDir: string = process.cwd()
): Snapshot | null {
  const dates = listSnapshotDates(rootDir);
  if (dates.length === 0) return null;

  dates.sort((a, b) => b.localeCompare(a));
  return loadSnapshot(dates[0], rootDir);
}

/**
 * Load all snapshots for a given year/month, sorted by date ascending.
 *
 * @param year - e.g. 2026
 * @param month - e.g. 6
 * @param rootDir - Base project directory (for testing; defaults to process.cwd())
 * @returns Array of Snapshots sorted by date ascending
 */
export function loadMonthSnapshots(
  year: number,
  month: number,
  rootDir: string = process.cwd()
): Snapshot[] {
  const monthDir = path.join(rootDir, SNAPSHOTS_DIR, String(year), String(month).padStart(2, '0'));
  if (!fs.existsSync(monthDir)) return [];

  const files = fs.readdirSync(monthDir).filter((f) => f.endsWith('.json')).sort();
  if (files.length === 0) return [];

  // Only read the latest snapshot — callers only use the last element
  const latestFile = files[files.length - 1];
  const day = latestFile.replace('.json', '');
  const dataDay = `${year}-${String(month).padStart(2, '0')}-${day}`;
  const snap = loadSnapshot(dataDay, rootDir);
  return snap ? [snap] : [];
}

/**
 * Check if a snapshot file exists for the given date.
 *
 * @param dataDay - WIB date string like "2026-06-11"
 * @param rootDir - Base project directory (for testing; defaults to process.cwd())
 * @returns true if file exists
 */
export function snapshotExists(
  dataDay: string,
  rootDir: string = process.cwd()
): boolean {
  const filePath = buildSnapshotPath(dataDay, rootDir);
  return fs.existsSync(filePath);
}

/**
 * Scan the snapshots directory and return all date strings (YYYY-MM-DD)
 * for which a JSON file exists.
 */
function listSnapshotDates(rootDir: string): string[] {
  const snapshotsDir = path.join(rootDir, SNAPSHOTS_DIR);
  if (!fs.existsSync(snapshotsDir)) return [];

  const dates: string[] = [];
  const years = listDirs(snapshotsDir);
  for (const year of years) {
    const months = listDirs(path.join(snapshotsDir, year));
    for (const month of months) {
      const monthDir = path.join(snapshotsDir, year, month);
      const files = fs.readdirSync(monthDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.replace('.json', ''));
      for (const day of files) {
        dates.push(`${year}-${month}-${day}`);
      }
    }
  }
  return dates;
}

/**
 * List subdirectories in a given path.
 * Returns directory names only (not files).
 */
function listDirs(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) return [];

  return fs.readdirSync(dirPath, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

/**
 * Get the latest snapshot date string (YYYY-MM-DD) from disk.
 *
 * @param rootDir - Base project directory (for testing; defaults to process.cwd())
 * @returns The latest date string or null if no snapshots exist
 */
export function getLatestSnapshotDate(
  rootDir: string = process.cwd()
): string | null {
  const dates = listSnapshotDates(rootDir);
  if (dates.length === 0) return null;

  dates.sort((a, b) => b.localeCompare(a));
  return dates[0];
}

/**
 * Build the user-facing stale snapshot message in Indonesian.
 * Returns empty string if no snapshot date is available.
 *
 * @param snapshotDate - WIB date string like "2026-06-10" or null
 * @returns Indonesian message or empty string
 */
export function staleSnapshotMessage(snapshotDate: string | null): string {
  if (!snapshotDate) return '';

  const formatted = formatDateWIB(snapshotDate);
  return `Data uma.moe lagi tidak bisa diambil.\nAku pakai snapshot terakhir: ${formatted}.`;
}

// Re-export ensureMonthSnapshot from its dedicated module to preserve the public API.
// The function itself lives in ./ensure-snapshot.ts to avoid a data → api dependency.
export { ensureMonthSnapshot } from './ensure-snapshot';

// Re-export for backward compatibility — function now lives in daily-fans.ts
export { getDataDayFromSnapshot } from './daily-fans';
