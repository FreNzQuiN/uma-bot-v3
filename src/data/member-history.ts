/**
 * Member history tracking for Uma Club Bot v3.
 *
 * Tracks member join/leave events by comparing snapshots against
 * the member_history database table.
 */

import type { Snapshot, MemberHistoryRow } from '../types';
import type { IDatabase, MemberHistoryInsert } from '../db/types';
import { getDataDate } from '../utils/timezone';
import { log } from '../utils/logger';

/**
 * Upsert all current snapshot members into member_history.
 *
 * For each member in the snapshot:
 * - If viewer_id already exists: update trainer_name, circle_id, last_seen, transfer fields, status='active'
 * - If viewer_id is new: insert with first_seen=last_seen=today
 *
 * Historical members not in the current snapshot are marked status='left'.
 *
 * This must be called before getLeftMembers so history is populated.
 */
export async function updateMemberHistory(snapshot: Snapshot, db: IDatabase): Promise<void> {
  const today = getDataDate();
  const circleId = snapshot.circle.circle_id;
  const currentViewerIds = new Set<number>();

  // Single fetch of all existing members, keyed by viewer_id
  const existingMembers = await db.getMembers(circleId);
  const existingMap = new Map(existingMembers.map((m) => [m.viewer_id, m]));

  const inserts: MemberHistoryInsert[] = [];
  for (const member of snapshot.members) {
    currentViewerIds.add(member.viewer_id);
    const existing = existingMap.get(member.viewer_id);

    inserts.push({
      viewer_id: member.viewer_id,
      trainer_name: member.trainer_name,
      circle_id: member.circle_id,
      first_seen: existing?.first_seen ?? today,
      last_seen: today,
      previous_circle_id: member.previous_circle_id ?? null,
      previous_circle_name: member.previous_circle_name ?? null,
      status: 'active',
    });
  }

  await db.upsertMembers(inserts);

  const leftInserts: MemberHistoryInsert[] = existingMembers
    .filter((m) => !currentViewerIds.has(m.viewer_id))
    .map((m) => ({
      viewer_id: m.viewer_id,
      trainer_name: m.trainer_name,
      circle_id: circleId,
      first_seen: m.first_seen,
      last_seen: m.last_seen,
      previous_circle_id: m.previous_circle_id ?? null,
      previous_circle_name: m.previous_circle_name ?? null,
      status: 'left' as const,
    }));

  await db.upsertMembers(leftInserts);
}

/**
 * Detect left members by comparing member_history against the current snapshot.
 *
 * A left member is:
 *   member existed in previous history (member_history with same circle_id)
 *   AND member does NOT exist in the current snapshot
 * @returns Array of member_history rows for departed members
 */
export async function getLeftMembers(snapshot: Snapshot, db: IDatabase): Promise<MemberHistoryRow[]> {
  if (snapshot.members.length === 0) return [];

  const circleId = snapshot.circle.circle_id;
  const currentViewerIds = new Set(snapshot.members.map((m) => m.viewer_id));

  const historicalMembers = await db.getMembers(circleId);

  return historicalMembers.filter(
    (m) => !currentViewerIds.has(m.viewer_id)
  );
}