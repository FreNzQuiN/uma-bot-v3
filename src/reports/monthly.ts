/**
 * Monthly report generator for Uma Club Bot v3.
 *
 * Produces a monthly performance summary showing total gains,
 * member counts by status, and per-member monthly contributions.
 */

import { Snapshot, BotConfig, RankedMember } from '../types';
import type { ComputedMember } from '../types';
import { getDataDayFromSnapshot, loadMonthSnapshots } from '../data/snapshot';
import { formatNumber, sanitizeName } from '../utils/format';
import { getStaleDataWarning, buildDateStr, buildFooter, buildReportHeader, buildStaleSection } from './format';
import { INDONESIAN_MONTHS } from '../utils/timezone';
import { computeMembers } from './compute';
import { getTargetMonth } from '../utils/timezone';

function formatMonthYear(month: number, year: number): string {
  return `${INDONESIAN_MONTHS[month - 1]} ${year}`;
}

export function generateMonthlyReport(
  snapshot: Snapshot,
  config: BotConfig,
  computedMembers: ComputedMember[],
  offset: number = 0
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
    const { year: snapYear, month: snapMonth } = snapshot.members[0];
    const { year: targetYear, month: targetMonth } = getTargetMonth(snapYear, snapMonth, offset);
    const prevSnapshots = loadMonthSnapshots(targetYear, targetMonth);
    if (prevSnapshots.length > 0) {
      activeSnapshot = prevSnapshots[prevSnapshots.length - 1]; // latest snapshot for that month
    } else {
      // Target snapshot unavailable — use current with warning
      fallbackWarning = `⚠️ Data bulan ${formatMonthYear(targetYear, targetMonth)} belum tersedia, menampilkan data terkini.\n`;
    }
  }

  // When viewing a historical month, recompute gains from that snapshot
  let effectiveMembers = computedMembers;
  if (activeSnapshot !== snapshot) {
    effectiveMembers = computeMembers(activeSnapshot, config);
  }

  if (activeSnapshot.members.length === 0) {
    return 'ℹ️ *Monthly Report*\nData bulan ini belum tersedia.';
  }

  const { year, month } = activeSnapshot.members[0];

  const ranked: RankedMember[] = effectiveMembers
    .map((m) => ({
      rank: 0,
      trainerName: m.trainerName,
      dailyGain: m.latestKnownGain,
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

  const contributorCount = ranked.filter((m) => m.monthlyGain > 0).length;
  const activeCount = effectiveMembers.filter((m) => m.status === 'active').length;

  const { fans_to_next_tier, fans_to_lower_tier } = activeSnapshot;

  const adjustedDataDay = getDataDayFromSnapshot(activeSnapshot);
  const daysInMonth = new Date(year, month, 0).getDate();
  const daysElapsed = adjustedDataDay;
  const projectedMonthEnd =
    daysElapsed > 0
      ? Math.round((totalMonthlyGain / daysElapsed) * daysInMonth)
      : 0;

  const lines: string[] = [];

  if (fallbackWarning) {
    lines.push(fallbackWarning);
  }

  const header = buildReportHeader(activeSnapshot, `📅 *Monthly Report — ${formatMonthYear(month, year)}*`);
  lines.push(...header);

  lines.push(
    `Promosi: ${formatNumber(fans_to_next_tier)} fans lagi | Degradasi: buffer ${formatNumber(fans_to_lower_tier)}`
  );
  lines.push('');

  lines.push(
    `👥 ${contributorCount} kontribusi dari ${activeCount} anggota | Total: ${formatNumber(totalMonthlyGain)}`
  );

  lines.push(
    `Proyeksi akhir bulan: ~${formatNumber(projectedMonthEnd)}`
  );
  lines.push('');

  const contributors = ranked.filter((m) => m.monthlyGain > 0);
  for (const member of contributors) {
    const transferBadge = member.isTransfer ? ' 🔄' : '';
    lines.push(
      `${member.rank}. *${sanitizeName(member.trainerName)}*${transferBadge} — +${formatNumber(member.monthlyGain)}`
    );
  }

  const monthlyReq = config.requirements.monthlyFans;
  if (monthlyReq > 0) {
    const reqActiveMembers = effectiveMembers.filter((m) => m.status === 'active');
    const passCount = reqActiveMembers.filter((m) => m.monthlyGain >= monthlyReq).length;
    const failCount = reqActiveMembers.length - passCount;
    lines.push('');
    lines.push(`*🎯 Requirement: ${monthlyReq >= 1_000_000 ? formatNumber(monthlyReq) : monthlyReq}/bulan*`);
    lines.push(`✅ ${passCount} pass | ❌ ${failCount} kurang`);
    const failingMembers = reqActiveMembers.filter((m) => m.monthlyGain < monthlyReq);
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
  lines.push(...buildStaleSection(effectiveMembers, adjustedDataDay, staleThreshold, `⚠️ Belum aktif ${staleThreshold} hari terakhir:`));

  const staleWarning = getStaleDataWarning(year, month, getDataDayFromSnapshot(activeSnapshot));
  if (staleWarning) {
    lines.push('');
    lines.push(staleWarning);
  }

  lines.push('');
  lines.push(buildFooter(config, buildDateStr(activeSnapshot)));
  return lines.join('\n');
}
