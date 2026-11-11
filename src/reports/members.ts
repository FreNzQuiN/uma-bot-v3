/**
 * Members report generator for Uma Club Bot v3.
 *
 * Produces a member listing with status badges,
 * monthly gains, and transfer information.
 * Optionally shows left members with "last seen" info when DB is provided.
 */

import { Snapshot, BotConfig } from "../types";
import type { ComputedMember } from "../types";
import type { IDatabase } from "../db/types";
import { formatNumber, sanitizeName } from "../utils/format";
import { formatDateWIB } from "../utils/timezone";
import { buildFooter, buildReportHeader } from "./format";
import { getLeftMembers } from "../data/member-history";

export async function generateMembersReport(
  snapshot: Snapshot,
  config: BotConfig,
  computedMembers: ComputedMember[],
  db?: IDatabase,
): Promise<string> {
  if (!snapshot.members || snapshot.members.length === 0) {
    return "ℹ️ *Daftar Anggota*\nData anggota belum tersedia.";
  }

  const statusOrder = { active: 0, stale: 1, left: 2 };
  const sorted = [...computedMembers].sort((a, b) => {
    const sa = statusOrder[a.status] ?? 3;
    const sb = statusOrder[b.status] ?? 3;
    if (sa !== sb) return sa - sb;
    return b.monthlyGain - a.monthlyGain;
  });

  const lines: string[] = [];
  const header = buildReportHeader(snapshot, `👥 *Daftar Anggota*`, false);
  lines.push(...header);
  lines.push("");

  for (const m of sorted) {
    let badge = "";
    if (m.isTransfer) badge = " 🔄";
    else if (m.status === "stale") badge = " ⚠️";
    else if (m.status === "left") badge = " 🚪";

    const gainStr = m.monthlyGain > 0 ? formatNumber(m.monthlyGain) : "0";
    const transferInfo = m.previousCircleName
      ? ` (dari ${m.previousCircleName})`
      : "";

    lines.push(
      `• *${sanitizeName(m.trainerName)}*${badge} — ${gainStr}${transferInfo}`,
    );
  }

  if (db) {
    const leftMembers = await getLeftMembers(snapshot, db);
    if (leftMembers.length > 0) {
      lines.push("");
      lines.push("*🚪 Anggota yang sudah keluar:*");
      lines.push("");
      for (const lm of leftMembers) {
        const lastSeen = formatDateWIB(lm.last_seen);
        lines.push(
          `• ${sanitizeName(lm.trainer_name)} (terakhir: ${lastSeen})`,
        );
      }
    }
  }

  lines.push("");
  lines.push(buildFooter(config, snapshot));
  return lines.join("\n");
}
