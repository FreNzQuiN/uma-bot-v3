/**
 * Single entry point for fetching and saving snapshots.
 *
 * Every snapshot fetch goes through fetchAndSaveSnapshot(). No direct
 * umaMoe.fetchCircleData() + saveSnapshot() calls elsewhere.
 *
 * Flow: load existing → validate → freshness check → fetch if needed → save
 *
 * For current-month fetches, retries with backoff if the scraper hasn't
 * finished yet (data is behind today's JST date).
 */

import type { Snapshot } from "../types";
import { loadMonthSnapshot, saveSnapshot } from "./snapshot";
import { getDataDateComponents, getDataDay } from "../utils/timezone";
import { getDataDayFromSnapshot } from "./daily-fans";
import { log } from "../utils/logger";

export interface FetchResult {
  snapshot: Snapshot | null;
  saved: boolean;
  reason?: string;
}

/** Structural type for the uma.moe client — keeps the data layer free of api-layer imports. */
export interface UmaMoeClientLike {
  fetchCircleData(
    circleId: number,
    year: number,
    month: number,
  ): Promise<Snapshot>;
}

function p2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Derive file path from snapshot metadata, not clock. Returns null when no member exists to derive from. */
export function getDataDateForFile(snapshot: Snapshot): string | null {
  const member = snapshot.members[0];
  if (!member) return null;
  const day = getDataDayFromSnapshot(snapshot);
  if (day === 0) return `${member.year}-${p2(member.month)}-01`;
  return `${member.year}-${p2(member.month)}-${p2(day)}`;
}

/** Current-month snapshot with dataDay === 0 or dataDay < currentJstDay - 1. */
export function isSnapshotStale(snapshot: Snapshot): boolean {
  const dataDay = getDataDayFromSnapshot(snapshot);
  if (dataDay === 0) return true;
  const currentDay = getDataDay();
  return dataDay < currentDay - 1;
}

/**
 * True if snapshot data covers today or yesterday in JST.
 * Used to decide whether to retry a fetch (scraper might still be running).
 */
function isDataFreshEnough(snapshot: Snapshot): boolean {
  const dataDay = getDataDayFromSnapshot(snapshot);
  if (dataDay === 0) return false;
  const currentDay = getDataDay();
  return dataDay >= currentDay - 1;
}

/** Past-month snapshot: true if data covers the entire month. */
export function isSnapshotComplete(snapshot: Snapshot): boolean {
  if (snapshot.members.length === 0) return false;
  const dataDay = getDataDayFromSnapshot(snapshot);
  if (dataDay === 0) return false;
  const member = snapshot.members[0];
  const daysInMonth = new Date(member.year, member.month, 0).getDate();
  return dataDay >= daysInMonth;
}

/**
 * True if fetched snapshot has strictly more/fresher data than existing.
 * Tiebreakers: member count, then circle.last_updated.
 */
export function isFetchedNewer(fetched: Snapshot, existing: Snapshot): boolean {
  const fetchedDay = getDataDayFromSnapshot(fetched);
  const existingDay = getDataDayFromSnapshot(existing);
  if (fetchedDay > existingDay) return true;
  if (
    fetchedDay === existingDay &&
    fetched.members.length > existing.members.length
  )
    return true;
  if (
    fetchedDay === existingDay &&
    fetched.members.length === existing.members.length
  ) {
    return (
      (fetched.circle.last_updated ?? "") > (existing.circle.last_updated ?? "")
    );
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchOnce(
  umaMoe: UmaMoeClientLike,
  circleId: number,
  year: number,
  month: number,
  existing: Snapshot | null,
): Promise<{ fetched: Snapshot; shouldSave: boolean } | { error: string }> {
  let fetched: Snapshot;
  try {
    fetched = await umaMoe.fetchCircleData(circleId, year, month);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }

  if (fetched.members.length === 0) {
    return { error: "empty_response" };
  }

  if (fetched.circle.circle_id !== circleId) {
    return { error: `circle_mismatch: got ${fetched.circle.circle_id}` };
  }

  if (existing && !isFetchedNewer(fetched, existing)) {
    return { error: "not_newer" };
  }

  return { fetched, shouldSave: true };
}

/**
 * Fetch a snapshot from uma.moe and save it if it's newer than what's on disk.
 *
 * For current-month fetches, retries with backoff if the fetched data is behind
 * today's JST date (scraper might still be running). Retries scale:
 * 5m → 10m → 20m → 25m → ... capped at 1hr per delay, 1hr cumulative max.
 *
 * Returns the snapshot (fresh or existing) and whether a save happened.
 * Never throws — fetch failures return the existing snapshot.
 */
export async function fetchAndSaveSnapshot(
  umaMoe: UmaMoeClientLike,
  circleId: number,
  year: number,
  month: number,
  options?: { rootDir?: string },
): Promise<FetchResult> {
  const rootDir = options?.rootDir ?? process.cwd();
  const monthLabel = `${year}-${p2(month)}`;

  const existing = loadMonthSnapshot(year, month, rootDir);

  // Determine if we need to fetch
  let needFetch = !existing;
  if (existing) {
    if (existing.circle.circle_id !== circleId) {
      log.warn(
        "Snapshot",
        `Circle ID mismatch: cached=${existing.circle.circle_id} requested=${circleId}`,
      );
      needFetch = true;
    } else {
      const { year: curYear, month: curMonth } = getDataDateComponents();
      const isCurrentMonth = curYear === year && curMonth === month;
      if (isCurrentMonth) {
        needFetch = isSnapshotStale(existing);
      } else {
        needFetch = !isSnapshotComplete(existing);
      }
    }
  }

  if (!needFetch) {
    log.debug("Snapshot", `Cache hit for ${monthLabel}, returning existing`);
    return { snapshot: existing, saved: false, reason: "fresh" };
  }

  // Check if existing data is already fresh enough (today or yesterday)
  const { year: curYear, month: curMonth } = getDataDateComponents();
  const isCurrentMonth = curYear === year && curMonth === month;

  if (existing && isCurrentMonth && isDataFreshEnough(existing)) {
    log.debug(
      "Snapshot",
      `Existing data for ${monthLabel} is fresh enough (today/yesterday), skipping fetch`,
    );
    return { snapshot: existing, saved: false, reason: "fresh" };
  }

  // Retry with exponential backoff for current-month data.
  // Max wait = 23h minus data age. If data is 20h old, retry for 3h.
  // If data is 1h old, retry for 22h. If 23h+, stop immediately.
  const HOUR_MS = 60 * 60_000;
  const MAX_RETRY_BUDGET_MS = 23 * HOUR_MS;
  const MAX_DELAY_MS = 60 * HOUR_MS;

  let dataAgeMs = 0;
  if (existing && existing.members.length > 0) {
    const lastUpdated = existing.circle.last_updated;
    if (lastUpdated) {
      dataAgeMs = Date.now() - new Date(lastUpdated).getTime();
    }
  }
  let maxWaitMs = Math.max(0, MAX_RETRY_BUDGET_MS - dataAgeMs);
  // Unparseable last_updated makes dataAgeMs NaN — NaN <= 0 is false, so the
  // budget check below would never trip and the error path would loop forever.
  if (!Number.isFinite(maxWaitMs)) maxWaitMs = 0;

  if (!isCurrentMonth || maxWaitMs <= 0) {
    // Past month or data too old — single attempt, no retry
    const result = await fetchOnce(umaMoe, circleId, year, month, existing);
    if ("fetched" in result) {
      const fileDate = getDataDateForFile(result.fetched);
      if (fileDate) {
        saveSnapshot(result.fetched, fileDate, rootDir);
        log.info(
          "Snapshot",
          `Saved ${monthLabel} (${result.fetched.members.length} members) as ${fileDate}`,
        );
      }
      return { snapshot: result.fetched, saved: fileDate !== null };
    }
    log.warn("Snapshot", `Fetch failed for ${monthLabel}: ${result.error}`);
    return { snapshot: existing, saved: false, reason: result.error };
  }

  let lastError = "";
  let cumulativeWait = 0;
  let delay = 5 * 60_000; // start at 5m
  let attempt = 0;

  while (true) {
    attempt++;
    const result = await fetchOnce(umaMoe, circleId, year, month, existing);

    if ("fetched" in result) {
      const fileDate = getDataDateForFile(result.fetched);
      if (fileDate) {
        saveSnapshot(result.fetched, fileDate, rootDir);
        log.info(
          "Snapshot",
          `Saved ${monthLabel} (${result.fetched.members.length} members) as ${fileDate}`,
        );
      }

      if (!isDataFreshEnough(result.fetched)) {
        const fetchedDay = getDataDayFromSnapshot(result.fetched);
        const expectedDay = getDataDay() - 1;
        log.warn(
          "Snapshot",
          `Data behind for ${monthLabel} (day ${fetchedDay}, need ≥${expectedDay})`,
        );
        if (cumulativeWait + delay <= maxWaitMs) {
          log.info(
            "Snapshot",
            `Retry ${attempt} for ${monthLabel} in ${Math.round(delay / 60_000)}m`,
          );
          await sleep(delay);
          cumulativeWait += delay;
          delay = Math.min(delay * 2, MAX_DELAY_MS);
          continue;
        }
        log.warn(
          "Snapshot",
          `Retry budget exhausted for ${monthLabel} (${Math.round(cumulativeWait / 60_000)}m waited)`,
        );
      }

      return { snapshot: result.fetched, saved: fileDate !== null };
    }

    lastError = result.error;
    log.debug(
      "Snapshot",
      `Attempt ${attempt} for ${monthLabel} failed: ${lastError}`,
    );

    if (cumulativeWait + delay > maxWaitMs) {
      log.warn(
        "Snapshot",
        `Retry budget exhausted for ${monthLabel} (${Math.round(cumulativeWait / 60_000)}m waited): ${lastError}`,
      );
      break;
    }

    log.info(
      "Snapshot",
      `Retry ${attempt} for ${monthLabel} in ${Math.round(delay / 60_000)}m`,
    );
    await sleep(delay);
    cumulativeWait += delay;
    delay = Math.min(delay * 2, MAX_DELAY_MS);
  }

  return {
    snapshot: existing,
    saved: false,
    reason: lastError || "fetch_failed",
  };
}
