/**
 * Bottom report generator for Uma Club Bot v3.
 *
 * Shows the members with the lowest monthly contributions.
 * Focuses on members who may need attention or encouragement.
 */

import { Snapshot, BotConfig, RankedMember, CLUB_TIERS } from '../types';
import type { ComputedMember } from '../types';
import { getDataDayFromSnapshot } from '../data/snapshot';
import { formatNumber, sanitizeName } from '../utils/format';
import { formatDateWIB } from '../utils/timezone';
import { buildDateStr, buildFooter, buildDataLine } from './format';
import { isStaleForReport } from '../data/daily-fans';

/**
 * Generate the bottom report string.
 *
 * @param snapshot - Raw snapshot data
 * @param config - Bot configuration
 * @param computedMembers - Pre-computed member data (ComputedMember[])
 */
export function generateBottomReport(
  snapshot: Snapshot,
  config: BotConfig,
  computedMembers: ComputedMember[]
): string {
  if (!snapshot.members || snapshot.members.length === 0) {
    return 'ℹ️ *Perlu Perhatian*\nData anggota belum tersedia untuk analisis.';
  }

  const contributing = computedMembers
    .filter((m) => m.status === 'active')
    .sort((a, b) => a.monthlyGain - b.monthlyGain);

  const { circle, club_rank } = snapshot;
  const tierName = CLUB_TIERS[club_rank] || `T${club_rank}`;

  const dataDay = getDataDayFromSnapshot(snapshot);
  const dateStr = buildDateStr(snapshot, dataDay);
  const formattedDate = formatDateWIB(dateStr);

  const lines: string[] = [];
  lines.push(`📉 *Perlu Perhatian*`);
  lines.push('');
  lines.push(`${circle.name} | ${tierName} (#${circle.monthly_rank})`);
  lines.push(buildDataLine(formattedDate));
  lines.push('');

  const { monthlyFans, weeklyFans } = config.requirements;
  const daysInMonth = new Date(snapshot.members[0].year, snapshot.members[0].month, 0).getDate();
  const daysElapsed = dataDay;
  const monthlyTarget = monthlyFans;

  lines.push(`🎯 Target bulanan: ${formatNumber(monthlyTarget)}`);
  if (weeklyFans > 0) {
    lines.push(`🎯 Target mingguan: ${formatNumber(weeklyFans)}`);
  }
  lines.push('');

  const bottomCount = Math.min(10, contributing.length);
  for (let i = 0; i < bottomCount; i++) {
    const m = contributing[i];
    const transferBadge = m.isTransfer ? ' 🔄' : '';
    const deficit = monthlyTarget - m.monthlyGain;
    const deficitStr = deficit > 0 ? ` (kurang ${formatNumber(deficit)})` : ' ✅';
    const projectedMonthEnd =
      daysElapsed > 0
        ? Math.round((m.monthlyGain / daysElapsed) * daysInMonth)
        : 0;
    const projStr = projectedMonthEnd < monthlyTarget
      ? ` → ~${formatNumber(projectedMonthEnd)}`
      : '';
    lines.push(
      `${i + 1}. *${sanitizeName(m.trainerName)}*${transferBadge} — +${formatNumber(m.monthlyGain)}${deficitStr}${projStr}`
    );
  }

  // Add stale members (rolling window: consecutive zero-gain days at end >= threshold)
  const staleThreshold = config.memberStatus.staleAfterDaysMonthly;
  const staleMembers = computedMembers.filter((m) =>
    m.status === 'active' && isStaleForReport(m.dailyFans, dataDay, staleThreshold)
  );
  if (staleMembers.length > 0) {
    lines.push('');
    lines.push(`*⚠️ Tidak ada data (${staleThreshold}+ hari):*`);
    for (const s of staleMembers) {
      lines.push(`• ${sanitizeName(s.trainerName)}`);
    }
  }

  lines.push('');
  lines.push(buildFooter(config, buildDateStr(snapshot)));
  return lines.join('\n');
}
