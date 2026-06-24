/**
 * Monthly report generator for Uma Club Bot v3.
 *
 * Produces a monthly performance summary showing total gains,
 * member counts by status, and per-member monthly contributions.
 */

import { Snapshot, BotConfig, RankedMember, CLUB_TIERS } from '../types';
import type { ComputedMember } from '../types';
import type { Database } from '../db/database';
import { getDataDayFromSnapshot, loadMonthSnapshots } from '../data/snapshot';
import { formatNumber, sanitizeName } from '../utils/format';
import { formatDateWIB, getStaleDataWarning, buildDateStr, buildFooter, buildDataLine } from './format';
import { INDONESIAN_MONTHS } from '../utils/timezone';
import { isStaleForReport } from '../data/daily-fans';
import { getDataDateComponents, getTargetMonth } from '../utils/timezone';

/**
 * Format month+year in Indonesian: "Juni 2026".
 */
function formatMonthYear(month: number, year: number): string {
  return `${INDONESIAN_MONTHS[month - 1]} ${year}`;
}

/**
 * Generate the monthly report string.
 *
 * @param snapshot - Raw snapshot data
 * @param config - Bot configuration
 * @param computedMembers - Pre-computed member data (ComputedMember[])
 * @param offset - Months back (0 = current month)
 */
export function generateMonthlyReport(
  snapshot: Snapshot,
  config: BotConfig,
  computedMembers: ComputedMember[],
  offset: number = 0,
  db?: Database
): string {
  // Guard: empty members
  if (!snapshot.members || snapshot.members.length === 0) {
    return 'ℹ️ *Monthly Report*\nData bulan ini belum tersedia.';
  }

  // Handle offset by loading previous month snapshot if available
  let activeSnapshot = snapshot;
  let fallbackWarning = '';
  const absOffset = Math.abs(offset);
  if (absOffset > 0) {
    const { year: curYear, month: curMonth } = getDataDateComponents();
    const { year: targetYear, month: targetMonth } = getTargetMonth(curYear, curMonth, offset);
    const prevSnapshots = loadMonthSnapshots(targetYear, targetMonth);
    if (prevSnapshots.length > 0) {
      activeSnapshot = prevSnapshots[prevSnapshots.length - 1]; // latest snapshot for that month
    } else {
      // Target snapshot unavailable — use current with warning
      fallbackWarning = `⚠️ Data bulan ${formatMonthYear(targetYear, targetMonth)} belum tersedia, menampilkan data terkini.\n`;
    }
  }

  const { year, month } = activeSnapshot.members[0];

  // Build ranked members sorted by monthly gain descending
  const ranked: RankedMember[] = computedMembers
    .map((m) => ({
      rank: 0,
      trainerName: m.trainerName,
      dailyGain: m.latestDailyGain,
      monthlyGain: m.monthlyGain,
      isTransfer: m.isTransfer,
      previousCircleName: m.previousCircleName,
    }))
    .sort((a, b) => b.monthlyGain - a.monthlyGain)
    .map((m, i) => ({ ...m, rank: i + 1 }));

  const totalMonthlyGain = ranked.reduce(
    (sum, m) => sum + m.monthlyGain,
    0
  );

  // Contributor count (members with monthlyGain > 0)
  const contributorCount = ranked.filter((m) => m.monthlyGain > 0).length;
  const activeCount = computedMembers.filter((m) => m.status === 'active').length;

  // Club info
  const { circle, fans_to_next_tier, fans_to_lower_tier, club_rank } = activeSnapshot;
  const tierName = CLUB_TIERS[club_rank] || `T${club_rank}`;

  const dateStr = buildDateStr(activeSnapshot);
  const formattedDate = formatDateWIB(dateStr);

  // Projected month end (extrapolate based on current pace)
  const adjustedDataDay = getDataDayFromSnapshot(activeSnapshot);
  const daysInMonth = new Date(year, month, 0).getDate();
  const daysElapsed = adjustedDataDay;
  const projectedMonthEnd =
    daysElapsed > 0
      ? Math.round((totalMonthlyGain / daysElapsed) * daysInMonth)
      : 0;

  // Build report
  const lines: string[] = [];

  // Fallback warning (prepended when target month snapshot unavailable)
  if (fallbackWarning) {
    lines.push(fallbackWarning);
  }

  // Title (bold with emoji inside)
  lines.push(`📅 *Monthly Report — ${formatMonthYear(month, year)}*`);
  lines.push('');

  // Club info with rank in parens
  lines.push(
    `${circle.name} | ${tierName} (#${circle.monthly_rank})`
  );

  // Data line
  lines.push(buildDataLine(formattedDate));

  // Tier context
  lines.push(
    `Promosi: ${formatNumber(fans_to_next_tier)} fans lagi | Degradasi: buffer ${formatNumber(fans_to_lower_tier)}`
  );
  lines.push('');

  // Summary line
  lines.push(
    `👥 ${contributorCount} kontribusi dari ${activeCount} anggota | Total: ${formatNumber(totalMonthlyGain)}`
  );

  // Projected month end
  lines.push(
    `Proyeksi akhir bulan: ~${formatNumber(projectedMonthEnd)}`
  );
  lines.push('');

  // Member rankings (only members with positive gain)
  const contributors = ranked.filter((m) => m.monthlyGain > 0);
  for (const member of contributors) {
    const transferBadge = member.isTransfer ? ' 🔄' : '';
    lines.push(
      `${member.rank}. *${sanitizeName(member.trainerName)}*${transferBadge} — +${formatNumber(member.monthlyGain)}`
    );
  }

  // Requirement pass/fail
  const monthlyReq = config.requirements.monthlyFans;
  if (monthlyReq > 0) {
    const activeMembers = computedMembers.filter((m) => m.status === 'active');
    const passCount = activeMembers.filter((m) => m.monthlyGain >= monthlyReq).length;
    const failCount = activeMembers.length - passCount;
    lines.push('');
    lines.push(`*🎯 Requirement: ${monthlyReq >= 1_000_000 ? formatNumber(monthlyReq) : monthlyReq}/bulan*`);
    lines.push(`✅ ${passCount} pass | ❌ ${failCount} kurang`);
    const failingMembers = activeMembers.filter((m) => m.monthlyGain < monthlyReq);
    if (failingMembers.length > 0) {
      for (const m of failingMembers) {
        const deficit = monthlyReq - m.monthlyGain;
        const transferBadge = m.isTransfer ? ' 🔄' : '';
        lines.push(`❌ *${sanitizeName(m.trainerName)}*${transferBadge} — kurang ${formatNumber(deficit)}`);
      }
    }
  }

  // Stale members (rolling window: consecutive zero-gain days at end >= threshold)
  const staleThreshold = config.memberStatus.staleAfterDaysMonthly;
  const staleMembers = computedMembers.filter((m) =>
    m.status === 'active' && isStaleForReport(m.dailyFans, adjustedDataDay, staleThreshold)
  );
  if (staleMembers.length > 0) {
    lines.push('');
    lines.push(`*⚠️ Belum aktif bulan ini:*`);
    for (const s of staleMembers) {
      lines.push(`• ${sanitizeName(s.trainerName)}`);
    }
  }

  // Stale data warning
  const staleWarning = getStaleDataWarning(year, month, getDataDayFromSnapshot(activeSnapshot));
  if (staleWarning) {
    lines.push('');
    lines.push(staleWarning);
  }

  // Sync footer
  lines.push('');
  lines.push(buildFooter(config, buildDateStr(activeSnapshot)));
  return lines.join('\n');
}
