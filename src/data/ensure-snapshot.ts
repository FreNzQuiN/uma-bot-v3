/**
 * Ensure a snapshot exists for a given year/month on disk.
 *
 * Delegates to fetchAndSaveSnapshot() which handles fetch, validation,
 * freshness checks, and save. Throws only if no snapshot is available at all.
 */

import type { UmaMoeClient } from "../api/uma-moe";
import type { Snapshot } from "../types";
import { fetchAndSaveSnapshot } from "./fetch-snapshot";

export async function ensureMonthSnapshot(
  umaMoe: UmaMoeClient,
  circleId: number,
  year: number,
  month: number,
  rootDir?: string,
): Promise<Snapshot> {
  const result = await fetchAndSaveSnapshot(umaMoe, circleId, year, month, {
    rootDir,
  });
  if (!result.snapshot) {
    throw new Error(
      `No snapshot available for ${year}-${String(month).padStart(2, "0")}`,
    );
  }
  return result.snapshot;
}
