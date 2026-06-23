/**
 * Stats report generator for Uma Club Bot v3.
 *
 * Produces an aggregate statistics overview: total fans, averages,
 * consistency metrics, and club-wide performance indicators.
 */

import { Snapshot, BotConfig, CLUB_TIERS } from '../types';
import type { ComputedMember } from '../types';
import type { Database } from '../db/database';
import { getDataDayFromSnapshot } from '../data/snapshot';
import { computeRollingAverage, countActiveDays } from '../data/daily-fans';
import { formatNumber, formatDateWIB, getStaleDataWarning, buildDateStr, buildFooter, buildDataLine } from './format';

/**
 * Generate the stats report string.
 *
 * @param snapshot - Raw snapshot data
 * @param config - Bot configuration
 * @param computedMembers - Pre-computed member data (ComputedMember[])
 */
export function generateStatsReport(
  snapshot: Snapshot,
  config: BotConfig,
  computedMembers: ComputedMember[],
  db?: Database
): string {
  // Guard: empty members
  if (!snapshot.members || snapshot.members.length === 0) {
    return 'ℹ️ *Stats*\nData statistik belum tersedia.';
  }

  const dataDay = getDataDayFromSnapshot(snapshot);

  const contributing = computedMembers.filter(
    (m) => m.status === 'active'
  );

  // Aggregate stats
  const totalMonthlyGain = contributing.reduce(
    (sum, m) => sum + m.monthlyGain,
    0
  );
  const avgMonthlyGain =
    contributing.length > 0 ? Math.round(totalMonthlyGain / contributing.length) : 0;

  // Median monthly gain
  const sortedGains = contributing.map((m) => m.monthlyGain).sort((a, b) => a - b);
  const mid = Math.floor(sortedGains.length / 2);
  const medianMonthlyGain =
    sortedGains.length > 0
      ? sortedGains.length % 2 === 0
        ? Math.round((sortedGains[mid - 1] + sortedGains[mid]) / 2)
        : sortedGains[mid]
      : 0;

  const totalDailyGain = contributing.reduce(
    (sum, m) => sum + m.latestDailyGain,
    0
  );
  const avgDailyGain =
    contributing.length > 0 ? Math.round(totalDailyGain / contributing.length) : 0;

  // Requirement pass rate
  const monthlyReq = config.requirements.monthlyFans;
  const passCount = contributing.filter((m) => m.monthlyGain >= monthlyReq).length;
  const passRate =
    contributing.length > 0
      ? Math.round((passCount / contributing.length) * 100)
      : 0;

  // Active days distribution
  const activeDayCounts = contributing.map((m) => countActiveDays(m.dailyFans, undefined, config.requirements.includeTransferDataInCalculation));
  const avgActiveDays =
    activeDayCounts.length > 0
      ? Math.round(
          activeDayCounts.reduce((a, b) => a + b, 0) / activeDayCounts.length
        )
      : 0;

  // Members with zero daily gain today
  const zeroGainToday = contributing.filter(
    (m) => m.latestDailyGain === 0
  ).length;

  // Club info
  const { circle, club_rank, fans_to_next_tier, fans_to_lower_tier } =
    snapshot;
  const tierName = CLUB_TIERS[club_rank] || `T${club_rank}`;

  const { year, month } = snapshot.members[0];
  const dateStr = buildDateStr(snapshot, dataDay);
  const formattedDate = formatDateWIB(dateStr);

  const lines: string[] = [];
  lines.push(`📊 *Stats Overview*`);
  lines.push('');
  lines.push(`${circle.name} | ${tierName} (#${circle.monthly_rank})`);
  lines.push(buildDataLine(formattedDate));
  lines.push('');
  const activeCount = computedMembers.filter((m) => m.status === 'active').length;
  const leftCount = computedMembers.filter((m) => m.status === 'left').length;
  const staleCount = computedMembers.filter((m) => m.status === 'stale').length;

  lines.push(`Total anggota: ${computedMembers.length}`);
  lines.push(`Aktif: ${activeCount} | Keluar: ${leftCount} | Transfer: ${computedMembers.filter((m) => m.isTransfer).length}`);
  lines.push('');
  lines.push(`📈 Gain rata-rata bulanan: ${formatNumber(avgMonthlyGain)}`);
  lines.push(`📈 Gain median bulanan: ${formatNumber(medianMonthlyGain)}`);
  lines.push(`📈 Gain rata-rata harian: ${formatNumber(avgDailyGain)}`);
  lines.push(`📅 Rata-rata hari aktif: ${avgActiveDays} hari`);
  lines.push(`🎯 Zero gain hari ini: ${zeroGainToday} orang`);
  lines.push('');

  // Top member and lowest active member
  const activeMembers = contributing.filter((m) => m.status === 'active');
  if (activeMembers.length > 0) {
    const sortedByGain = [...activeMembers].sort((a, b) => b.monthlyGain - a.monthlyGain);
    const topMember = sortedByGain[0];
    const lowestMember = sortedByGain[sortedByGain.length - 1];
    lines.push(`🏆 Top: ${topMember.trainerName} — ${formatNumber(topMember.monthlyGain)}`);
    lines.push(`📉 Lowest aktif: ${lowestMember.trainerName} — ${formatNumber(lowestMember.monthlyGain)}`);
    lines.push('');
  }

  // Projected month-end total
  const daysInMonth = new Date(year, month, 0).getDate();
  const daysElapsed = dataDay;
  const projectedMonthEnd =
    daysElapsed > 0
      ? Math.round((totalMonthlyGain / daysElapsed) * daysInMonth)
      : 0;
  lines.push(`📅 Proyeksi akhir bulan: ~${formatNumber(projectedMonthEnd)}`);

  // Tier projection
  const daysLeft = daysInMonth - daysElapsed;
  const currentPace = daysElapsed > 0 ? Math.round(totalMonthlyGain / daysElapsed) : 0;
  if (fans_to_next_tier > 0 && currentPace > 0) {
    const daysToPromote = Math.ceil(fans_to_next_tier / currentPace);
    if (daysToPromote <= daysLeft) {
      lines.push(`🎯 Promosi: kemungkinan besar jika pace bertahan`);
    } else {
      lines.push(`🎯 Promosi: butuh ${formatNumber(fans_to_next_tier)} lagi (${daysLeft} hari tersisa)`);
    }
  } else if (fans_to_next_tier === 0) {
    lines.push(`🎯 Tier: sudah di tier maksimal`);
  } else {
    lines.push(`🎯 Tier: pace ${formatNumber(currentPace)}/hari, gap ${formatNumber(fans_to_next_tier)}`);
  }

  lines.push('');
  lines.push(`🎯 Requirement pass rate: ${passRate}% (${passCount}/${contributing.length})`);
  lines.push(`🎯 Total gain bulanan: ${formatNumber(totalMonthlyGain)}`);
  lines.push(
    `Promosi: ${formatNumber(fans_to_next_tier)} | Degradasi: ${formatNumber(fans_to_lower_tier)}`
  );

  // Stale data warning
  const staleWarning = getStaleDataWarning(year, month, dataDay);
  if (staleWarning) {
    lines.push('');
    lines.push(staleWarning);
  }

  // Sync footer
  lines.push('');
  lines.push(buildFooter(config, buildDateStr(snapshot)));
  return lines.join('\n');
}
