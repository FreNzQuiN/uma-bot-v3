/**
 * Weekly report generator for Uma Club Bot v3.
 *
 * Produces a weekly performance summary showing per-member weekly gains.
 * Week blocks are fixed: W1=d1-7, W2=d8-14, W3=d15-21, W4=d22-28, W5=d29-31.
 */

import { Snapshot, BotConfig, WEEK_BLOCKS, CLUB_TIERS } from '../types';
import type { ComputedMember } from '../types';
import type { Database } from '../db/database';
import { getDataDayFromSnapshot } from '../data/snapshot';
import { formatNumber, formatDateWIB, getStaleDataWarning, buildDateStr, buildFooter, buildDataLine, sanitizeName } from './format';
import { isStaleForReport } from '../data/daily-fans';

interface WeeklyRankedMember {
  rank: number;
  trainerName: string;
  dailyGain: number;
  monthlyGain: number;
  weeklyGain: number;
  isTransfer: boolean;
  previousCircleName?: string;
}

/**
 * Determine which week the data day falls into.
 */
function getWeekForDay(day: number): number {
  for (const block of WEEK_BLOCKS) {
    if (day >= block.start && day <= block.end) {
      return block.week;
    }
  }
  return 5; // default to last week
}

/**
 * Generate the weekly report string.
 *
 * @param snapshot - Raw snapshot data
 * @param config - Bot configuration
 * @param offset - Weeks back from latest (0 = current week)
 */
export function generateWeeklyReport(
  snapshot: Snapshot,
  config: BotConfig,
  computedMembers: ComputedMember[],
  offset: number = 0,
  db?: Database
): string {
  // Guard: empty members
  if (!snapshot.members || snapshot.members.length === 0) {
    return 'ℹ️ *Weekly Report*\nData minggu ini belum tersedia.';
  }

  const latestDataDay = getDataDayFromSnapshot(snapshot);
  const currentWeek = getWeekForDay(latestDataDay);
  const absOffset = Math.abs(offset);
  const targetWeek = Math.max(1, currentWeek - absOffset);
  const block = WEEK_BLOCKS.find((b) => b.week === targetWeek)!;

  // Build ranked members with weekly gain
  const ranked: WeeklyRankedMember[] = computedMembers
    .map((m, i) => ({
      rank: 0,
      trainerName: m.trainerName,
      dailyGain: m.latestDailyGain,
      monthlyGain: m.monthlyGain,
      weeklyGain: m.weeklyGains[targetWeek - 1] || 0,
      isTransfer: m.isTransfer,
      previousCircleName: m.previousCircleName,
    }))
    .sort((a, b) => b.weeklyGain - a.weeklyGain)
    .map((m, i) => ({ ...m, rank: i + 1 }));

  const totalWeeklyGain = ranked.reduce(
    (sum, m) => sum + m.weeklyGain,
    0
  );

  // Club info
  const { circle, fans_to_next_tier, fans_to_lower_tier, club_rank } = snapshot;
  const tierName = CLUB_TIERS[club_rank] || `T${club_rank}`;

  const dateStr = buildDateStr(snapshot);
  const formattedDate = formatDateWIB(dateStr);

  // Contributor stats
  const contributors = ranked.filter((m) => m.weeklyGain > 0);
  const activeCount = computedMembers.filter((m) => m.status === 'active').length;
  const contributorCount = contributors.length;

  // Build report
  const lines: string[] = [];
  lines.push(`📈 *Weekly Report — Minggu ${targetWeek}*`);
  lines.push('');
  lines.push(
    `${circle.name} | ${tierName} (#${circle.monthly_rank})`
  );
  lines.push(buildDataLine(formattedDate));
  lines.push(
    `Periode: Hari ${block.start}-${block.end}`
  );
  lines.push(
    `Promosi: ${formatNumber(fans_to_next_tier)} fans lagi`
  );
  lines.push(
    `Degradasi: buffer ${formatNumber(fans_to_lower_tier)}`
  );
  lines.push('');
  lines.push(
    `👥 ${contributorCount} kontribusi dari ${activeCount} anggota | Total: ${formatNumber(totalWeeklyGain)}`
  );
  lines.push('');

  // Member list (only members with positive gain)
  if (contributors.length > 0) {
    for (const member of contributors) {
      const transferBadge = member.isTransfer ? ' 🔄' : '';
      lines.push(
        `${member.rank}. *${sanitizeName(member.trainerName)}*${transferBadge} — +${formatNumber(member.weeklyGain)}`
      );
    }
  } else {
    lines.push('(Data gain mingguan belum tersedia)');
  }

  // Below requirement
  const weeklyReq = config.requirements.weeklyFans;
  if (weeklyReq > 0) {
    const belowReq = ranked.filter(
      (m) => m.weeklyGain < weeklyReq
    );
    if (belowReq.length > 0) {
      lines.push('');
      lines.push(
        `*⚠️ Di bawah target ${formatNumber(weeklyReq)}/minggu:*`
      );
      for (const m of belowReq) {
        lines.push(`• ${sanitizeName(m.trainerName)}`);
      }
    }
  }

  // Stale members (rolling window: consecutive zero-gain days at end of target week)
  const viewedEndDay = Math.min(block.end, latestDataDay);
  const staleThreshold = config.memberStatus.staleAfterDaysWeekly;
  const staleMembers = computedMembers.filter((m) =>
    m.status === 'active' && isStaleForReport(m.dailyFans, viewedEndDay, staleThreshold)
  );
  if (staleMembers.length > 0) {
    lines.push('');
    lines.push(`*⚠️ Belum aktif minggu ini:*`);
    for (const s of staleMembers) {
      lines.push(`• ${sanitizeName(s.trainerName)}`);
    }
  }

  // Stale data warning
  const { year, month } = snapshot.members[0];
  const staleWarning = getStaleDataWarning(year, month, latestDataDay);
  if (staleWarning) {
    lines.push('');
    lines.push(staleWarning);
  }

  // Sync footer
  lines.push('');
  lines.push(buildFooter(config, buildDateStr(snapshot)));
  return lines.join('\n');
}
