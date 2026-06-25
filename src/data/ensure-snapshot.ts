/**
 * Ensure a snapshot exists for a given year/month on disk.
 *
 * This function bridges data layer (snapshot I/O) and API layer (uma.moe fetch),
 * so it lives here rather than in snapshot.ts to avoid a data → api dependency.
 *
 * Flow:
 * 1. Check disk cache — if snapshots exist for the month, return the latest.
 * 2. Cache miss — fetch from the uma.moe API.
 * 3. Determine save date: current month uses getDataDate(), past months use the last day.
 * 4. Save to disk and return the snapshot.
 */

import type { UmaMoeClient } from '../api/uma-moe';
import type { Snapshot } from '../types';
import { loadMonthSnapshots, saveSnapshot } from './snapshot';
import { getDataDate, getDataDateComponents } from '../utils/timezone';
import { log } from '../utils/logger';

/**
 * Ensure a snapshot exists for the given year/month on disk.
 * @returns The Snapshot (from cache or freshly fetched)
 */
export async function ensureMonthSnapshot(
  umaMoe: UmaMoeClient,
  circleId: number,
  year: number,
  month: number,
  rootDir?: string
): Promise<Snapshot> {
  const resolvedRoot = rootDir ?? process.cwd();

  const cached = loadMonthSnapshots(year, month, resolvedRoot);
  if (cached.length > 0) {
    const latest = cached[cached.length - 1];
    // Validate that cached snapshot matches the requested circle
    if (latest.circle.circle_id === circleId) {
      log.debug('Snapshot', `Cache hit for ${year}-${String(month).padStart(2, '0')}, returning latest cached snapshot`);
      return latest;
    }
    log.warn('Snapshot', `Cached snapshot circle_id ${latest.circle.circle_id} doesn't match requested ${circleId}, fetching fresh`);
  }

  log.info('Snapshot', `Cache miss for ${year}-${String(month).padStart(2, '0')}, fetching from uma.moe`);
  const snapshot = await umaMoe.fetchCircleData(circleId, year, month);

  const { year: currYear, month: currMonth } = getDataDateComponents();
  const isCurrentMonth = currYear === year && currMonth === month;
  const dataDay = isCurrentMonth
    ? getDataDate()
    : `${year}-${String(month).padStart(2, '0')}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`;

  saveSnapshot(snapshot, dataDay, resolvedRoot);

  return snapshot;
}
