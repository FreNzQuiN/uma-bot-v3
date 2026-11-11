/**
 * Stats report generator for Uma Club Bot v3.
 *
 * Produces an aggregate statistics overview: total fans, averages,
 * consistency metrics, and club-wide performance indicators.
 */

import { Snapshot, BotConfig } from "../types";
import type { ComputedMember } from "../types";
import { getDataDayFromSnapshot } from "../data/snapshot";
import { countActiveDays } from "../data/daily-fans";
import { formatNumber, sanitizeName } from "../utils/format";
import { getStaleDataWarning, buildFooter, buildReportHeader } from "./format";

export function generateStatsReport(
  snapshot: Snapshot,
  config: BotConfig,
  computedMembers: ComputedMember[],
): string {
  if (!snapshot.members || snapshot.members.length === 0) {
    return "ℹ️ *Stats*\nData statistik belum tersedia.";
  }

  const actualDataDay = getDataDayFromSnapshot(snapshot);

  const contributing = computedMembers.filter((m) => m.status === "active");

  const totalMonthlyGain = contributing.reduce(
    (sum, m) => sum + m.monthlyGain,
    0,
  );
  const avgMonthlyGain =
    contributing.length > 0
      ? Math.round(totalMonthlyGain / contributing.length)
      : 0;

  const sortedGains = contributing
    .map((m) => m.monthlyGain)
    .sort((a, b) => a - b);
  const mid = Math.floor(sortedGains.length / 2);
  const medianMonthlyGain =
    sortedGains.length > 0
      ? sortedGains.length % 2 === 0
        ? Math.round((sortedGains[mid - 1] + sortedGains[mid]) / 2)
        : sortedGains[mid]
      : 0;

  const totalDailyGain = contributing.reduce(
    (sum, m) => sum + m.latestKnownGain,
    0,
  );
  const avgDailyGain =
    contributing.length > 0
      ? Math.round(totalDailyGain / contributing.length)
      : 0;

  const monthlyReq = config.requirements.monthlyFans;
  const passCount = contributing.filter(
    (m) => m.monthlyGain >= monthlyReq,
  ).length;
  const passRate =
    contributing.length > 0
      ? Math.round((passCount / contributing.length) * 100)
      : 0;

  const activeDayCounts = contributing.map((m) =>
    countActiveDays(
      m.dailyFans,
      undefined,
      config.requirements.includeTransferDataInCalculation,
    ),
  );
  const avgActiveDays =
    activeDayCounts.length > 0
      ? Math.round(
          activeDayCounts.reduce((a, b) => a + b, 0) / activeDayCounts.length,
        )
      : 0;

  const zeroGainToday = contributing.filter(
    (m) => m.latestKnownGain === 0,
  ).length;

  const { fans_to_next_tier, fans_to_lower_tier } = snapshot;

  const { year, month } = snapshot.members[0];

  const lines: string[] = [];
  const header = buildReportHeader(snapshot, `📊 *Stats Overview*`);
  lines.push(...header);
  lines.push("");
  const activeCount = computedMembers.filter(
    (m) => m.status === "active",
  ).length;
  const leftCount = computedMembers.filter((m) => m.status === "left").length;
  const staleCount = computedMembers.filter((m) => m.status === "stale").length;

  lines.push(`Total anggota: ${computedMembers.length}`);
  lines.push(
    `Aktif: ${activeCount} | Keluar: ${leftCount} | Transfer: ${computedMembers.filter((m) => m.isTransfer).length}`,
  );
  lines.push("");
  lines.push(`📈 Gain rata-rata bulanan: ${formatNumber(avgMonthlyGain)}`);
  lines.push(`📈 Gain median bulanan: ${formatNumber(medianMonthlyGain)}`);
  lines.push(`📈 Gain rata-rata harian: ${formatNumber(avgDailyGain)}`);
  lines.push(`📅 Rata-rata hari aktif: ${avgActiveDays} hari`);
  lines.push(`🎯 Zero gain hari ini: ${zeroGainToday} orang`);
  lines.push("");

  if (contributing.length > 0) {
    const sortedByGain = [...contributing].sort(
      (a, b) => b.monthlyGain - a.monthlyGain,
    );
    const topMember = sortedByGain[0];
    const lowestMember = sortedByGain[sortedByGain.length - 1];
    lines.push(
      `🏆 Top: ${sanitizeName(topMember.trainerName)} — ${formatNumber(topMember.monthlyGain)}`,
    );
    lines.push(
      `📉 Lowest aktif: ${sanitizeName(lowestMember.trainerName)} — ${formatNumber(lowestMember.monthlyGain)}`,
    );
    lines.push("");
  }

  const daysInMonth = new Date(year, month, 0).getDate();
  const daysElapsed = actualDataDay;
  const projectedMonthEnd =
    daysElapsed > 0
      ? Math.round((totalMonthlyGain / daysElapsed) * daysInMonth)
      : 0;
  lines.push(`📅 Proyeksi akhir bulan: ~${formatNumber(projectedMonthEnd)}`);

  const daysLeft = daysInMonth - daysElapsed;
  const currentPace =
    daysElapsed > 0 ? Math.round(totalMonthlyGain / daysElapsed) : 0;
  if (fans_to_next_tier > 0 && currentPace > 0) {
    const daysToPromote = Math.ceil(fans_to_next_tier / currentPace);
    if (daysToPromote <= daysLeft) {
      lines.push(`🎯 Promosi: kemungkinan besar jika pace bertahan`);
    } else {
      lines.push(
        `🎯 Promosi: butuh ${formatNumber(fans_to_next_tier)} lagi (${daysLeft} hari tersisa)`,
      );
    }
  } else if (fans_to_next_tier === 0) {
    lines.push(`🎯 Tier: sudah di tier maksimal`);
  } else {
    lines.push(
      `🎯 Tier: pace ${formatNumber(currentPace)}/hari, gap ${formatNumber(fans_to_next_tier)}`,
    );
  }

  lines.push("");
  lines.push(
    `🎯 Requirement pass rate: ${passRate}% (${passCount}/${contributing.length})`,
  );
  lines.push(`🎯 Total gain bulanan: ${formatNumber(totalMonthlyGain)}`);
  lines.push(
    `Promosi: ${formatNumber(fans_to_next_tier)} | Degradasi: ${formatNumber(fans_to_lower_tier)}`,
  );

  const staleWarning = getStaleDataWarning(year, month, actualDataDay);
  if (staleWarning) {
    lines.push("");
    lines.push(staleWarning);
  }

  lines.push("");
  lines.push(buildFooter(config, snapshot));
  return lines.join("\n");
}
