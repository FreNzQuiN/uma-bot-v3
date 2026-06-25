/**
 * Member comparison report generator for Uma Club Bot v3.
 *
 * Compares two members side by side on various metrics.
 * Uses WhatsApp formatting (*bold*, not Markdown).
 */

import type { Snapshot, BotConfig, ComputedMember } from '../types';
import { WEEK_BLOCKS } from '../types';
import { getDataDayFromSnapshot } from '../data/snapshot';
import { formatNumber, sanitizeName } from '../utils/format';
import { formatDateWIB } from '../utils/timezone';
import { buildDateStr, buildFooter } from './format';
import { computeRollingAverage } from '../data/daily-fans';

/**
 * Generate the compare report string.
 *
 * @param snapshot - Raw snapshot data
 * @param config - Bot configuration
 * @param computedMembers - Pre-computed member data (ComputedMember[])
 * @param nameA - First member name to compare
 * @param nameB - Second member name to compare
 */
export function generateCompareReport(
  snapshot: Snapshot,
  config: BotConfig,
  computedMembers: ComputedMember[],
  nameA: string,
  nameB: string
): string {
  const latestDataDay = getDataDayFromSnapshot(snapshot);

  const memberA = computedMembers.find((m) => m.trainerName === nameA) ?? null;
  const memberB = computedMembers.find((m) => m.trainerName === nameB) ?? null;

  if (!memberA && !memberB) {
    return `❌ "${nameA}" dan "${nameB}" tidak ditemukan. Cek ejaan nama.`;
  }
  if (!memberA) {
    return `❌ "${nameA}" tidak ditemukan. Cek ejaan nama.`;
  }
  if (!memberB) {
    return `❌ "${nameB}" tidak ditemukan. Cek ejaan nama.`;
  }

  const avgA = computeRollingAverage(memberA.dailyFans, latestDataDay, 7, config.requirements.includeTransferDataInCalculation);
  const avgB = computeRollingAverage(memberB.dailyFans, latestDataDay, 7, config.requirements.includeTransferDataInCalculation);

  // Show current week's gain only (not total of all weeks)
  const currentWeekBlock = WEEK_BLOCKS.find(b => latestDataDay >= b.start && latestDataDay <= b.end);
  const currentWeekNum = currentWeekBlock ? currentWeekBlock.week : 5;
  const weeklyGainA = memberA.weeklyGains[currentWeekNum - 1] || 0;
  const weeklyGainB = memberB.weeklyGains[currentWeekNum - 1] || 0;

  const badgeA = memberA.isTransfer ? ' 🔄' : '';
  const badgeB = memberB.isTransfer ? ' 🔄' : '';
  const boldA = `*${sanitizeName(memberA.trainerName)}*${badgeA}`;
  const boldB = `*${sanitizeName(memberB.trainerName)}*${badgeB}`;

  const dateStr = buildDateStr(snapshot, latestDataDay);
  const formattedDate = formatDateWIB(dateStr);

  const lines: string[] = [];
  lines.push(`⚔️ *Compare: ${sanitizeName(memberA.trainerName)} vs ${sanitizeName(memberB.trainerName)} — ${formattedDate}*`);
  lines.push('');
  lines.push(`*Monthly Gain*`);
  lines.push(`• ${boldA}: ${formatNumber(memberA.monthlyGain)}`);
  lines.push(`• ${boldB}: ${formatNumber(memberB.monthlyGain)}`);
  lines.push('');
  lines.push(`*Daily Terakhir*`);
  lines.push(`• ${boldA}: ${formatNumber(memberA.latestDailyGain)}`);
  lines.push(`• ${boldB}: ${formatNumber(memberB.latestDailyGain)}`);
  lines.push('');
  lines.push(`*Rata-rata 7 Hari*`);
  lines.push(`• ${boldA}: ${formatNumber(avgA)}`);
  lines.push(`• ${boldB}: ${formatNumber(avgB)}`);
  lines.push('');
  lines.push(`*Gain Minggu ${currentWeekNum}*`);
  lines.push(`• ${boldA}: ${formatNumber(weeklyGainA)}`);
  lines.push(`• ${boldB}: ${formatNumber(weeklyGainB)}`);
  lines.push('');

  // Requirement status
  const monthlyReq = config.requirements.monthlyFans;
  if (monthlyReq > 0) {
    const reqA = memberA.monthlyGain >= monthlyReq
      ? `✅ ${formatNumber(memberA.monthlyGain)} / ${formatNumber(monthlyReq)}`
      : `❌ kurang ${formatNumber(monthlyReq - memberA.monthlyGain)}`;
    const reqB = memberB.monthlyGain >= monthlyReq
      ? `✅ ${formatNumber(memberB.monthlyGain)} / ${formatNumber(monthlyReq)}`
      : `❌ kurang ${formatNumber(monthlyReq - memberB.monthlyGain)}`;
    lines.push(`*Requirement (${formatNumber(monthlyReq)}/bulan)*`);
    lines.push(`• ${boldA}: ${reqA}`);
    lines.push(`• ${boldB}: ${reqB}`);
    lines.push('');
  }

  // Winner
  if (memberA.monthlyGain > memberB.monthlyGain) {
    lines.push(`🏆 *${sanitizeName(memberA.trainerName)}* unggul di monthly gain`);
  } else if (memberB.monthlyGain > memberA.monthlyGain) {
    lines.push(`🏆 *${sanitizeName(memberB.trainerName)}* unggul di monthly gain`);
  } else {
    lines.push('🤝 *Seri* di monthly gain');
  }

  lines.push('');
  lines.push(buildFooter(config, buildDateStr(snapshot)));
  return lines.join('\n');
}
