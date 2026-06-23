/**
 * Ranks report generator for Uma Club Bot v3.
 *
 * Produces a ranked leaderboard sorted by monthly total gain.
 * Uses medal emojis for top 3 positions.
 */

import { Snapshot, BotConfig, CLUB_TIERS } from '../types';
import type { ComputedMember } from '../types';
import { formatNumber, formatDateWIB, buildDateStr, buildFooter, buildDataLine, sanitizeName } from './format';
import { getDataDayFromSnapshot } from '../data/snapshot';

const MEDALS = ['🥇', '🥈', '🥉'];

/**
 * Generate the ranks report string.
 *
 * @param snapshot - Raw snapshot data
 * @param config - Bot configuration
 */
export function generateRanksReport(snapshot: Snapshot, config: BotConfig, computedMembers: ComputedMember[]): string {
  // Guard: empty members
  if (!snapshot.members || snapshot.members.length === 0) {
    return 'ℹ️ *Peringkat*\nData peringkat belum tersedia.';
  }

  // Sort by monthly gain descending, top 10 only
  const sorted = [...computedMembers]
    .filter((m) => m.status === 'active')
    .sort((a, b) => b.monthlyGain - a.monthlyGain)
    .slice(0, 10);

  // Club info
  const { circle, club_rank } = snapshot;
  const tierName = CLUB_TIERS[club_rank] || `T${club_rank}`;

  // Date
  const dataDay = getDataDayFromSnapshot(snapshot);
  const dateStr = buildDateStr(snapshot, dataDay);
  const formattedDate = formatDateWIB(dateStr);

  const lines: string[] = [];
  lines.push(`🏆 *Peringkat Bulanan*`);
  lines.push('');
  lines.push(`${circle.name} | ${tierName} (#${circle.monthly_rank})`);
  lines.push(buildDataLine(formattedDate));
  lines.push('');

  for (let i = 0; i < sorted.length; i++) {
    const m = sorted[i];
    const medal = i < 3 ? MEDALS[i] + ' ' : '';
    const num = i < 3 ? '' : `${i + 1}. `;
    const transferBadge = m.isTransfer ? ' 🔄' : '';
    lines.push(
      `${medal}${num}*${sanitizeName(m.trainerName)}*${transferBadge} — +${formatNumber(m.monthlyGain)}`
    );
  }

  // Sync footer
  lines.push('');
  lines.push(buildFooter(config, buildDateStr(snapshot)));
  return lines.join('\n');
}
