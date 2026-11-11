/**
 * Shared helpers for report generators that load historical snapshots
 * by offset from the current snapshot's month.
 */

import type { Snapshot, BotConfig, ComputedMember } from "../types";
import { loadMonthSnapshot } from "../data/snapshot";
import { getTargetMonth } from "../utils/timezone";
import { computeMembers } from "./compute";

// Top-N list size for leaderboard-style reports
export const TOP_N = 10;

// Allow 1 day of data lag (refreshes can land as late as the next JST day)
export const STALE_DAY_TOLERANCE = 1;

interface HistoricalSnapshotResult {
  activeSnapshot: Snapshot;
  effectiveMembers: ComputedMember[];
  fallbackWarning: string;
}

/**
 * Load a historical snapshot by month offset from the current snapshot.
 * Returns the original snapshot and members when offset is 0 or target is unavailable.
 */
export function loadHistoricalSnapshot(
  snapshot: Snapshot,
  computedMembers: ComputedMember[],
  config: BotConfig,
  offset: number,
  formatMonthYear?: (month: number, year: number) => string,
): HistoricalSnapshotResult {
  const absOffset = Math.abs(offset);
  if (absOffset === 0 || snapshot.members.length === 0) {
    return {
      activeSnapshot: snapshot,
      effectiveMembers: computedMembers,
      fallbackWarning: "",
    };
  }

  const { year: snapYear, month: snapMonth } = snapshot.members[0];
  const { year: targetYear, month: targetMonth } = getTargetMonth(
    snapYear,
    snapMonth,
    offset,
  );
  const prevSnapshot = loadMonthSnapshot(targetYear, targetMonth);

  if (prevSnapshot) {
    return {
      activeSnapshot: prevSnapshot,
      effectiveMembers: computeMembers(prevSnapshot, config),
      fallbackWarning: "",
    };
  }

  const fallbackWarning = formatMonthYear
    ? `⚠️ Data bulan ${formatMonthYear(targetYear, targetMonth)} belum tersedia, menampilkan data terkini.\n`
    : "";
  return {
    activeSnapshot: snapshot,
    effectiveMembers: computedMembers,
    fallbackWarning,
  };
}
