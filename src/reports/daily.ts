/**
 * Daily report generator for Uma Club Bot v3.
 *
 * Produces a concise daily performance summary in Indonesian.
 * Shows per-member daily gains ranked, stale warnings, and club tier info.
 */

import { Snapshot, BotConfig, RankedMember, CLUB_TIERS } from '../types';
import type { ComputedMember } from '../types';
import { getDataDayFromSnapshot } from '../data/snapshot';
import { getDailyGain } from '../data/daily-fans';
import { formatNumber, sanitizeName } from '../utils/format';
import { formatDateWIB } from '../utils/timezone';
import { getStaleDataWarning, buildDateStr, buildFooter, buildDataLine } from './format';

/**
 * Generate the daily report string.
 *
 * @param snapshot - Raw snapshot data
 * @param config - Bot configuration
 * @param computedMembers - Pre-computed member data (ComputedMember[])
 * @param offset - Days back from latest data day (0 = latest)
 */
export function generateDailyReport(
  snapshot: Snapshot,
  config: BotConfig,
  computedMembers: ComputedMember[],
  offset: number = 0
): string {
  // Guard: empty members
  if (!snapshot.members || snapshot.members.length === 0) {
    return 'ℹ️ *Daily Report*\nTidak ada data anggota untuk hari ini. Mungkin sync belum berjalan.';
  }

  const latestDataDay = getDataDayFromSnapshot(snapshot);
  const absOffset = Math.abs(offset);
  const adjustedDataDay = Math.max(1, latestDataDay - absOffset);

  // Compute gains for the SPECIFIC offset day, not the latest
  const memberGains = computedMembers.map((m) => ({
    ...m,
    dailyGain: getDailyGain(m.dailyFans, adjustedDataDay, config.requirements.includeTransferDataInCalculation),
  }));

  // Filter active members (not stale/left)
  const contributing = memberGains.filter(
    (m) => m.status === 'active'
  );

  // Sort by offset day's daily gain descending
  const sorted = [...contributing].sort(
    (a, b) => b.dailyGain - a.dailyGain
  );

  // Build RankedMember list
  const ranked: RankedMember[] = sorted.map((m, i) => ({
    rank: i + 1,
    trainerName: m.trainerName,
    dailyGain: m.dailyGain,
    monthlyGain: m.monthlyGain,
    isTransfer: m.isTransfer,
    previousCircleName: m.previousCircleName,
  }));

  // Stale members: active member with 0 gain on the viewed day who has been active before
  const staleMembers = memberGains.filter((m) => {
    if (m.status !== 'active') return false;
    if (m.firstPositiveDay >= adjustedDataDay) return false;
    return m.dailyGain === 0;
  });

  // Stats
  const activeCount = contributing.length;
  const contributorCount = sorted.filter((m) => m.dailyGain > 0).length;
  const totalDailyGain = contributing.reduce(
    (sum, m) => sum + m.dailyGain,
    0
  );

  // Club info
  const { circle, fans_to_next_tier, fans_to_lower_tier, club_rank } =
    snapshot;
  const tierName = CLUB_TIERS[club_rank] || `T${club_rank}`;

  // Format date
  const dateStr = buildDateStr(snapshot, adjustedDataDay);
  const formattedDate = formatDateWIB(dateStr);

  // Build report
  const lines: string[] = [];
  lines.push(`📊 *Daily Report — ${formattedDate}*`);
  lines.push('');
  lines.push(
    `${circle.name} | ${tierName} (#${circle.monthly_rank})`
  );
  lines.push(buildDataLine(formattedDate));
  lines.push(
    `Promosi: ${formatNumber(fans_to_next_tier)} fans lagi | Degradasi: buffer ${formatNumber(fans_to_lower_tier)}`
  );
  lines.push('');
  lines.push(
    `👥 ${contributorCount} kontribusi dari ${activeCount} anggota | Total: ${formatNumber(totalDailyGain)}`
  );
  lines.push('');

  // Member list (only members with positive gain — zero-gain members go to stale section)
  const rankedPositive = ranked.filter((m) => m.dailyGain > 0);
  for (const member of rankedPositive) {
    const gainStr = `+${formatNumber(member.dailyGain)}`;
    const transferBadge = member.isTransfer ? ' 🔄' : '';
    lines.push(
      `${member.rank}. *${sanitizeName(member.trainerName)}*${transferBadge} — ${gainStr}`
    );
  }

  // Stale section: zero-gain members shown here, not in ranked list
  if (staleMembers.length > 0) {
    lines.push('');
    if (contributorCount === 0 && adjustedDataDay <= 1) {
      lines.push('ℹ️ Gain hari pertama: belum tersedia karena tidak ada data sebelumnya');
    } else {
      lines.push('*⚠️ Belum aktif hari ini:*');
      for (const s of staleMembers) {
        lines.push(`• ${sanitizeName(s.trainerName)}`);
      }
    }
  } else if (contributorCount === 0 && activeCount > 0) {
    lines.push('');
    if (adjustedDataDay <= 1) {
      lines.push('ℹ️ Gain hari pertama: belum tersedia karena tidak ada data sebelumnya');
    } else {
      lines.push('ℹ️ Hari ini: belum ada kontribusi tercatat');
    }
  }

  // Stale data warning: check if the SNAPSHOT is stale, not the viewed day
  // Use latestDataDay (snapshot's actual latest) instead of offset-adjusted adjustedDataDay
  const { year: snapYear, month: snapMonth } = snapshot.members[0];
  const staleWarning = getStaleDataWarning(snapYear, snapMonth, latestDataDay);
  if (staleWarning) {
    lines.push('');
    lines.push(staleWarning);
  }

  // Sync footer
  lines.push('');
  lines.push(buildFooter(config, buildDateStr(snapshot, latestDataDay)));
  return lines.join('\n');
}
