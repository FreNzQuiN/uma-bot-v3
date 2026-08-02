/**
 * Shared formatting helpers for Uma Club Bot v3 reports.
 *
 * Report-specific helpers only. Pure utilities live in utils/format.ts,
 * timezone helpers in utils/timezone.ts.
 */

import {
  formatDateWIB,
  getDataDateComponents,
  formatForDisplay,
} from "../utils/timezone";
import type { Snapshot, BotConfig, ComputedMember } from "../types";
import { CLUB_TIERS } from "../types";
import { getLatestDataDay, isStaleForReport } from "../data/daily-fans";
import { getDataDayFromSnapshot } from "../data/snapshot";
import { sanitizeName } from "../utils/format";
import { STALE_DAY_TOLERANCE } from "./helpers";

/**
 * @param now - Optional Date override for testing (defaults to current time)
 */
export function getStaleDataWarning(
  snapshotYear: number,
  snapshotMonth: number,
  dataDay: number,
  now?: Date,
): string {
  const {
    year: currentYear,
    month: currentMonth,
    day: currentDay,
  } = getDataDateComponents(now);

  if (snapshotYear === currentYear && snapshotMonth === currentMonth) {
    if (dataDay < currentDay - STALE_DAY_TOLERANCE) {
      const dateStr = `${snapshotYear}-${String(snapshotMonth).padStart(2, "0")}-${String(dataDay).padStart(2, "0")}`;
      const formattedDate = formatDateWIB(dateStr);
      return `⚠️ Data klub mungkin tidak terbaru (update terakhir: ${formattedDate})`;
    }
  }

  return "";
}

export function buildDateStr(snapshot: Snapshot, dataDay?: number): string {
  if (snapshot.members.length === 0) return "Unknown-Date";
  const { year, month } = snapshot.members[0];
  const day = dataDay ?? getDataDayFromSnapshot(snapshot);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function buildFooter(config: BotConfig, snapshotDate?: string): string {
  const parsed =
    snapshotDate && /^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)
      ? new Date(snapshotDate + DATA_UPDATE_OFFSET)
      : new Date();
  const dateToUse = isNaN(parsed.getTime()) ? new Date() : parsed;
  return `⸻\nTerakhir sync: ${formatForDisplay(dateToUse, config.timezone)}`;
}

// Pins the data-update instant: 22:00 WIB = 00:00 JST, matches DATA_UPDATE_STRING
const DATA_UPDATE_OFFSET = "T22:00:00+07:00";
const DATA_UPDATE_STRING = "22:00 WIB";

function buildDataLine(formattedDate: string): string {
  return `Periode data: ${formattedDate}, ${DATA_UPDATE_STRING}`;
}

/**
 * Lines without trailing empty line; callers push separators themselves.
 */
export function buildReportHeader(
  snapshot: Snapshot,
  title: string,
  includeDataLine: boolean = true,
): string[] {
  const { circle, club_rank } = snapshot;
  const tierName = CLUB_TIERS[club_rank] || `T${club_rank}`;

  const lines: string[] = [];
  lines.push(`${title}`);
  lines.push("");
  lines.push(`${circle.name} | ${tierName} (#${circle.monthly_rank})`);
  if (includeDataLine) {
    const dateStr = buildDateStr(snapshot);
    const formattedDate = formatDateWIB(dateStr);
    lines.push(buildDataLine(formattedDate));
  }
  return lines;
}

/**
 * Section listing active members stale as of dataDay: trailing zero-gain
 * streak from dataDay reaching staleThreshold (contract in isStaleForReport).
 * Returns [] when no stale members.
 */
export function buildStaleSection(
  computedMembers: ComputedMember[],
  dataDay: number,
  staleThreshold: number,
  headerText: string,
): string[] {
  const staleMembers = computedMembers.filter(
    (m) =>
      m.status === "active" &&
      isStaleForReport(m.dailyFans, dataDay, staleThreshold),
  );
  if (staleMembers.length === 0) return [];
  const lines = ["", `*${headerText}*`];
  for (const s of staleMembers) {
    lines.push(`• ${sanitizeName(s.trainerName)}`);
  }
  return lines;
}
