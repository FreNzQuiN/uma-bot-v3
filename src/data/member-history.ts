/**
 * Member history tracking for Uma Club Bot v3.
 *
 * Tracks member join/leave events by comparing snapshots against
 * the member_history database table.
 */

import type { Snapshot, MemberHistoryRow } from '../types';
import type { Database } from '../db/database';
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
 *
 * @param snapshot - The current snapshot
 * @param db - Database instance
 */
export function updateMemberHistory(snapshot: Snapshot, db: Database): void {
  const today = getDataDate();
  const circleId = snapshot.circle.circle_id;
  const currentViewerIds = new Set<number>();

  try {
    db.rawRun('BEGIN');

    for (const member of snapshot.members) {
      currentViewerIds.add(member.viewer_id);

      const existing = db.getMember(member.viewer_id);
      const firstSeen = existing?.first_seen ?? today;

      db.upsertMember({
        viewer_id: member.viewer_id,
        trainer_name: member.trainer_name,
        circle_id: member.circle_id,
        first_seen: firstSeen,
        last_seen: today,
        previous_circle_id: member.previous_circle_id ?? null,
        previous_circle_name: member.previous_circle_name ?? null,
        status: 'active',
      });
    }

    // Mark historical members not in current snapshot as 'left'
    const historicalMembers = db.getMembers(circleId);
    for (const hist of historicalMembers) {
      if (!currentViewerIds.has(hist.viewer_id)) {
        db.upsertMember({
          viewer_id: hist.viewer_id,
          trainer_name: hist.trainer_name,
          circle_id: circleId,
          first_seen: hist.first_seen,
          last_seen: hist.last_seen,
          previous_circle_id: hist.previous_circle_id ?? null,
          previous_circle_name: hist.previous_circle_name ?? null,
          status: 'left',
        });
      }
    }

    db.rawRun('COMMIT');
  } catch (err) {
    db.rawRun('ROLLBACK');
    const msg = err instanceof Error ? err.message : String(err);
    log.error('Snapshot', `updateMemberHistory failed, rolled back: ${msg}`);
    throw err;
  }
}

/**
 * Detect left members by comparing member_history against the current snapshot.
 *
 * A left member is:
 *   member existed in previous history (member_history with same circle_id)
 *   AND member does NOT exist in the current snapshot
 *
 * @param snapshot - The current snapshot
 * @param db - Database instance
 * @returns Array of member_history rows for departed members
 */
export function getLeftMembers(snapshot: Snapshot, db: Database): MemberHistoryRow[] {
  if (snapshot.members.length === 0) return [];

  const circleId = snapshot.circle.circle_id;
  const currentViewerIds = new Set(snapshot.members.map((m) => m.viewer_id));

  // Get all historical members for this circle
  const historicalMembers = db.getMembers(circleId);

  // Filter to those not in the current snapshot
  return historicalMembers.filter(
    (m) => !currentViewerIds.has(m.viewer_id)
  );
}