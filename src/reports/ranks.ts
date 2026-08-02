/**
 * Ranks report generator for Uma Club Bot v3.
 *
 * Produces a ranked leaderboard sorted by monthly total gain.
 * Uses medal emojis for top 3 positions.
 */

import { Snapshot, BotConfig } from "../types";
import type { ComputedMember } from "../types";
import { formatNumber, sanitizeName } from "../utils/format";
import { buildDateStr, buildFooter, buildReportHeader } from "./format";
import { TOP_N } from "./helpers";

const MEDALS = ["🥇", "🥈", "🥉"];

export function generateRanksReport(
  snapshot: Snapshot,
  config: BotConfig,
  computedMembers: ComputedMember[],
): string {
  if (!snapshot.members || snapshot.members.length === 0) {
    return "ℹ️ *Peringkat*\nData peringkat belum tersedia.";
  }

  const sorted = [...computedMembers]
    .filter((m) => m.status === "active")
    .sort((a, b) => b.monthlyGain - a.monthlyGain)
    .slice(0, TOP_N);

  const lines: string[] = [];
  const header = buildReportHeader(snapshot, `🏆 *Peringkat Bulanan*`);
  lines.push(...header);
  lines.push("");

  for (let i = 0; i < sorted.length; i++) {
    const m = sorted[i];
    const medal = i < 3 ? MEDALS[i] + " " : "";
    const num = i < 3 ? "" : `${i + 1}. `;
    const transferBadge = m.isTransfer ? " 🔄" : "";
    lines.push(
      `${medal}${num}*${sanitizeName(m.trainerName)}*${transferBadge} — +${formatNumber(m.monthlyGain)}`,
    );
  }

  lines.push("");
  lines.push(buildFooter(config, buildDateStr(snapshot)));
  return lines.join("\n");
}
