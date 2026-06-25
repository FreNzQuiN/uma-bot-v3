/**
 * Member analysis report generator for Uma Club Bot v3.
 *
 * Deep-dive analysis of a single member's performance.
 * Uses WhatsApp formatting (*bold*, not Markdown).
 */

import type { Snapshot, BotConfig, ComputedMember } from '../types';
import { getDataDayFromSnapshot } from '../data/snapshot';
import { formatNumber, sanitizeName } from '../utils/format';
import { formatDateWIB } from '../utils/timezone';
import { buildDateStr, buildFooter } from './format';
import {
  computeRollingAverage,
  countActiveDays,
} from '../data/daily-fans';

const TREND_UP_THRESHOLD = 1.1;   // 10% above 7-day avg = upward trend
const TREND_DOWN_THRESHOLD = 0.9; // 10% below 7-day avg = downward trend

/**
 * Generate the analyze report string.
 */
export function generateAnalyzeReport(
  snapshot: Snapshot,
  config: BotConfig,
  computedMembers: ComputedMember[],
  name: string
): string {
  const latestDataDay = getDataDayFromSnapshot(snapshot);

  const member = computedMembers.find((m) => m.trainerName === name) ?? null;
  if (!member) {
    return `❌ "${name}" tidak ditemukan. Cek ejaan nama.`;
  }

  const avg3d = computeRollingAverage(member.dailyFans, latestDataDay, 3, config.requirements.includeTransferDataInCalculation);
  const avg7d = computeRollingAverage(member.dailyFans, latestDataDay, 7, config.requirements.includeTransferDataInCalculation);
  const daysInMonth = latestDataDay;

  const activeDays = countActiveDays(member.dailyFans, latestDataDay, config.requirements.includeTransferDataInCalculation);

  const consistency = daysInMonth > 0
    ? Math.round((activeDays / daysInMonth) * 100)
    : 0;

  let trend: 'naik' | 'turun' | 'stabil' = 'stabil';
  if (avg3d > avg7d * TREND_UP_THRESHOLD) trend = 'naik';
  else if (avg3d < avg7d * TREND_DOWN_THRESHOLD) trend = 'turun';
  const trendEmoji = { naik: '📈', turun: '📉', stabil: '➡️' };

  const monthlyReq = config.requirements.monthlyFans;
  const reqStatus = member.monthlyGain >= monthlyReq
    ? `✅ Memenuhi (${formatNumber(member.monthlyGain)} / ${formatNumber(monthlyReq)})`
    : `❌ Kurang ${formatNumber(monthlyReq - member.monthlyGain)} lagi`;

  const { year, month } = snapshot.members[0];
  const daysInFullMonth = new Date(year, month, 0).getDate();
  const daysElapsed = daysInMonth;
  const projected = daysElapsed > 0
    ? Math.round((member.monthlyGain / daysElapsed) * daysInFullMonth)
    : 0;

  const dateStr = buildDateStr(snapshot, latestDataDay);
  const formattedDate = formatDateWIB(dateStr);

  const transferBadge = member.isTransfer ? ' 🔄' : '';

  const weekLabels = member.weeklyGains.map((_, i) => `W${i + 1}`);
  const weeklyStr = member.weeklyGains
    .map((g, i) => `${weekLabels[i]}: ${formatNumber(g)}`)
    .join(' | ');

  const lines: string[] = [];
  lines.push(`🔍 *Analyze: ${sanitizeName(member.trainerName)}${transferBadge} — ${formattedDate}*`);
  if (member.isTransfer) {
    lines.push(`🔄 Transfer dari ${member.previousCircleName ?? 'unknown'}`);
  }
  lines.push('');
  lines.push(`*Gain*`);
  lines.push(`• Monthly: ${formatNumber(member.monthlyGain)}`);
  lines.push(`• Daily terakhir: ${formatNumber(member.latestDailyGain)}`);
  lines.push(`• Rata-rata 3 Hari: ${formatNumber(avg3d)}`);
  lines.push(`• Rata-rata 7 Hari: ${formatNumber(avg7d)}`);
  lines.push('');
  lines.push(`*Aktivitas*`);
  lines.push(`• Hari aktif: ${activeDays}/${daysInMonth}`);
  lines.push(`• Konsistensi: ${consistency}%`);
  lines.push(`• Trend: ${trendEmoji[trend]} ${trend}`);
  lines.push('');
  lines.push(`*Weekly*`);
  lines.push(`• ${weeklyStr}`);
  lines.push('');
  lines.push(`*Proyeksi*`);
  lines.push(`• Target: ${formatNumber(monthlyReq)}`);
  lines.push(`• Status: ${reqStatus}`);
  lines.push(`• Proyeksi akhir bulan: ~${formatNumber(projected)}`);

  lines.push('');
  lines.push(buildFooter(config, buildDateStr(snapshot)));
  return lines.join('\n');
}
