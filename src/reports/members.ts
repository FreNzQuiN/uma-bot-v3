/**
 * Members report generator for Uma Club Bot v3.
 *
 * Produces a comprehensive member listing with status badges,
 * monthly gains, and transfer information.
 * Optionally shows left members with "last seen" info when DB is provided.
 */

import { Snapshot, BotConfig, CLUB_TIERS } from '../types';
import type { ComputedMember } from '../types';
import type { Database } from '../db/database';
import { formatNumber, formatDateWIB, sanitizeName, buildFooter, buildDateStr } from './format';
import { getLeftMembers } from '../data/snapshot';

/**
 * Generate the members report string.
 *
 * @param snapshot - Raw snapshot data
 * @param config - Bot configuration
 * @param computedMembers - Pre-computed member data (ComputedMember[])
 * @param db - Optional database for querying left members history
 */
export function generateMembersReport(
  snapshot: Snapshot,
  config: BotConfig,
  computedMembers: ComputedMember[],
  db?: Database
): string {
  // Guard: empty members
  if (!snapshot.members || snapshot.members.length === 0) {
    return 'ℹ️ *Daftar Anggota*\nData anggota belum tersedia.';
  }

  // Club info
  const { circle, club_rank } = snapshot;
  const tierName = CLUB_TIERS[club_rank] || `T${club_rank}`;

  // Sort: active first (by monthly gain desc), then stale, then left
  const statusOrder = { active: 0, stale: 1, left: 2 };
  const sorted = [...computedMembers].sort((a, b) => {
    const sa = statusOrder[a.status] ?? 3;
    const sb = statusOrder[b.status] ?? 3;
    if (sa !== sb) return sa - sb;
    return b.monthlyGain - a.monthlyGain;
  });

  const lines: string[] = [];
  lines.push(`👥 *Daftar Anggota*`);
  lines.push('');
  lines.push(`${circle.name} | ${tierName} (#${circle.monthly_rank})`);
  lines.push('');

  for (const m of sorted) {
    let badge = '';
    if (m.isTransfer) badge = ' 🔄';
    else if (m.status === 'stale') badge = ' ⚠️';
    else if (m.status === 'left') badge = ' 🚪';

    const gainStr =
      m.monthlyGain > 0 ? formatNumber(m.monthlyGain) : '0';
    const transferInfo = m.previousCircleName
      ? ` (dari ${m.previousCircleName})`
      : '';

    lines.push(
      `• *${sanitizeName(m.trainerName)}*${badge} — ${gainStr}${transferInfo}`
    );
  }

  // Append left members section if DB is provided
  if (db) {
    const leftMembers = getLeftMembers(snapshot, db);
    if (leftMembers.length > 0) {
      lines.push('');
      lines.push('*🚪 Anggota yang sudah keluar:*');
      lines.push('');
      for (const lm of leftMembers) {
        const lastSeen = formatDateWIB(lm.last_seen);
        lines.push(`• ${sanitizeName(lm.trainer_name)} (terakhir: ${lastSeen})`);
      }
    }
  }

  // Sync footer
  lines.push('');
  lines.push(buildFooter(config, buildDateStr(snapshot)));
  return lines.join('\n');
}
