/**
 * Snapshot save/load functionality for the Uma Club Bot.
 *
 * Snapshots are raw uma.moe API responses saved as JSON files.
 * Path format: data/snapshots/YYYY/MM/DD.json
 */

import * as fs from "fs";
import * as path from "path";
import { Snapshot } from "../types";
import { formatDateWIB } from "../utils/timezone";
import { log } from "../utils/logger";

const SNAPSHOTS_DIR = "data/snapshots";

let cachedLatestSnapshot: Snapshot | null = null;

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
    const changed =
      !prev ||
      prev.circle.circle_id !== snapshot.circle.circle_id ||
      prev.circle.last_updated !== snapshot.circle.last_updated;
    if (changed) {
      log.debug(
        "Snapshot",
        `Cache updated: circle=${snapshot.circle.circle_id} updated=${snapshot.circle.last_updated ?? "unknown"}`,
      );
    }
  }
  cachedLatestSnapshot = snapshot;
}

function buildSnapshotPath(dataDay: string, rootDir: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataDay)) {
    throw new Error(
      `Invalid dataDay format: "${dataDay}". Expected YYYY-MM-DD`,
    );
  }
  const [year, month, day] = dataDay.split("-");
  return path.join(rootDir, SNAPSHOTS_DIR, year, month, `${day}.json`);
}

function isValidSnapshot(data: unknown): data is Snapshot {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  return (
    typeof obj.circle === "object" &&
    obj.circle !== null &&
    Array.isArray(obj.members)
  );
}

/**
 * Save a snapshot to disk and return the written path.
 * @param rootDir - base project directory (for testing; defaults to process.cwd())
 */
export function saveSnapshot(
  snapshot: Snapshot,
  dataDay: string,
  rootDir: string = process.cwd(),
): string {
  const filePath = buildSnapshotPath(dataDay, rootDir);
  const dir = path.dirname(filePath);

  fs.mkdirSync(dir, { recursive: true });

  // Prevents corrupt files if the process crashes mid-write.
  const tmpPath = filePath + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(snapshot, null, 2), "utf-8");
  fs.renameSync(tmpPath, filePath);

  log.debug(
    "Snapshot",
    `Saved ${dataDay} (${(snapshot.members ?? []).length} members) to ${filePath}`,
  );

  return filePath;
}

/**
 * Load a snapshot from disk.
 * @param rootDir - base project directory (for testing; defaults to process.cwd())
 * @returns parsed Snapshot, or null if the file doesn't exist or is invalid
 */
export function loadSnapshot(
  dataDay: string,
  rootDir: string = process.cwd(),
): Snapshot | null {
  const filePath = buildSnapshotPath(dataDay, rootDir);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    if (!raw || raw.trim() === "") return null;

    const parsed: unknown = JSON.parse(raw);

    if (!isValidSnapshot(parsed)) {
      return null;
    }

    return parsed;
  } catch (err) {
    log.debug(
      "Snapshot",
      `Failed to load ${dataDay}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/**
 * Load the most recent snapshot by date from disk.
 * @param rootDir - base project directory (for testing; defaults to process.cwd())
 * @returns the latest Snapshot, or null if none exist
 */
export function loadLatestSnapshot(
  rootDir: string = process.cwd(),
): Snapshot | null {
  const dates = listSnapshotDates(rootDir);
  if (dates.length === 0) return null;

  dates.sort((a, b) => b.localeCompare(a));
  return loadSnapshot(dates[0], rootDir);
}

/**
 * Load the latest snapshot for a given year/month.
 * @param year - e.g. 2026
 * @param month - 1-12, not zero-padded (e.g. 6)
 * @param rootDir - base project directory (for testing; defaults to process.cwd())
 * @returns the latest Snapshot for the month, or null if none exist
 */
export function loadMonthSnapshot(
  year: number,
  month: number,
  rootDir: string = process.cwd(),
): Snapshot | null {
  const monthDir = path.join(
    rootDir,
    SNAPSHOTS_DIR,
    String(year),
    String(month).padStart(2, "0"),
  );
  if (!fs.existsSync(monthDir)) return null;

  const files = fs
    .readdirSync(monthDir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  if (files.length === 0) return null;

  const latestFile = files[files.length - 1];
  const day = latestFile.replace(".json", "");
  const dataDay = `${year}-${String(month).padStart(2, "0")}-${day}`;
  return loadSnapshot(dataDay, rootDir);
}

export function snapshotExists(
  dataDay: string,
  rootDir: string = process.cwd(),
): boolean {
  const filePath = buildSnapshotPath(dataDay, rootDir);
  return fs.existsSync(filePath);
}

function listSnapshotDates(rootDir: string): string[] {
  const snapshotsDir = path.join(rootDir, SNAPSHOTS_DIR);
  if (!fs.existsSync(snapshotsDir)) return [];

  const dates: string[] = [];
  const years = listDirs(snapshotsDir);
  for (const year of years) {
    const months = listDirs(path.join(snapshotsDir, year));
    for (const month of months) {
      const monthDir = path.join(snapshotsDir, year, month);
      const files = fs
        .readdirSync(monthDir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.replace(".json", ""));
      for (const day of files) {
        dates.push(`${year}-${month}-${day}`);
      }
    }
  }
  return dates;
}

function listDirs(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) return [];

  return fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

export function getLatestSnapshotDate(
  rootDir: string = process.cwd(),
): string | null {
  const dates = listSnapshotDates(rootDir);
  if (dates.length === 0) return null;

  dates.sort((a, b) => b.localeCompare(a));
  return dates[0];
}

export function staleSnapshotMessage(snapshotDate: string | null): string {
  if (!snapshotDate) return "";

  const formatted = formatDateWIB(snapshotDate);
  return `Data uma.moe lagi tidak bisa diambil.\nAku pakai snapshot terakhir: ${formatted}.`;
}

// The function itself lives in ./ensure-snapshot.ts to avoid a data → api dependency.
// This re-export closes a CJS cycle (snapshot → ensure-snapshot → fetch-snapshot → snapshot),
// benign only while cross-cycle symbols stay function-body-scoped.
export { ensureMonthSnapshot } from "./ensure-snapshot";

// Re-export for backward compatibility — function now lives in daily-fans.ts
export { getDataDayFromSnapshot } from "./daily-fans";
