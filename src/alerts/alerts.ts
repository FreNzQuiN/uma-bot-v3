/**
 * Alert detection and deduplication for Uma Club Bot v3.
 *
 * Detects: performance drops, demotion risk, streak breaks, new transfers, rank drops.
 * Deduplicates via Database event_key uniqueness.
 * All alerts are admin-only by default.
 */

import type { Snapshot, BotConfig, ComputedMember } from "../types";
import { getDataDayFromSnapshot } from "../data/snapshot";
import { computeTierData } from "../data/daily-fans";
import { formatNumber } from "../utils/format";
import { computeRollingAverage, getDailyGain } from "../data/daily-fans";
import type { IDatabase } from "../db/types";
import { getDataDate } from "../utils/timezone";
import { log } from "../utils/logger";

export interface Alert {
  type:
    | "performance_drop"
    | "demotion_risk"
    | "streak_break"
    | "new_transfer"
    | "rank_drop";
  eventKey: string;
  memberViewerId: string;
  message: string;
  reportDate: string;
}

function detectPerformanceDrops(
  computedMembers: ComputedMember[],
  latestDataDay: number,
  reportDate: string,
  config: BotConfig,
): { keys: string[]; alerts: Alert[] } {
  const keys: string[] = [];
  const alerts: Alert[] = [];
  const minHistory = config.alerts.performanceDrop.minHistoryDays;
  const threshold = config.alerts.performanceDrop.thresholdPercent / 100;

  for (const member of computedMembers) {
    if (member.status !== "active") continue;
    if (member.isTransfer) continue;
    const avg7d = computeRollingAverage(
      member.dailyFans,
      latestDataDay,
      minHistory,
      config.requirements.includeTransferDataInCalculation,
    );
    if (avg7d <= 0) continue;

    const knownGain = member.latestKnownGain;
    if (knownGain < avg7d * threshold) {
      const eventKey = `performance_drop:${reportDate}:${member.viewerId}`;
      keys.push(eventKey);
      alerts.push({
        type: "performance_drop",
        eventKey,
        memberViewerId: String(member.viewerId),
        message: `${member.trainerName} — gain terakhir ${formatNumber(knownGain)} (rata-rata ${minHistory} hari: ${formatNumber(avg7d)})`,
        reportDate,
      });
    }
  }

  return { keys, alerts };
}

function detectDemotionRisk(
  snapshot: Snapshot,
  reportDate: string,
  config: BotConfig,
): { keys: string[]; alerts: Alert[] } {
  const keys: string[] = [];
  const alerts: Alert[] = [];

  const tierData = computeTierData(snapshot);

  // Use configurable threshold instead of computeTierData's hardcoded 'HIGH'
  if (tierData.demotionBuffer > 0 && tierData.currentPace > 0) {
    const bufferDays = tierData.demotionBuffer / tierData.currentPace;
    if (bufferDays < config.alerts.demotionRisk.bufferDays) {
      const eventKey = `demotion_risk:${reportDate}`;
      keys.push(eventKey);
      alerts.push({
        type: "demotion_risk",
        eventKey,
        memberViewerId: "club",
        message: `Degradasi risk! Buffer ${formatNumber(tierData.demotionBuffer)} — kurang dari ${config.alerts.demotionRisk.bufferDays} hari pace`,
        reportDate,
      });
    }
  }

  return { keys, alerts };
}

export const MIN_STREAK_DAYS = 3;

function detectStreakBreaks(
  computedMembers: ComputedMember[],
  reportDate: string,
): { keys: string[]; alerts: Alert[] } {
  const keys: string[] = [];
  const alerts: Alert[] = [];

  for (const member of computedMembers) {
    if (member.status !== "active") continue;
    if (member.isTransfer) continue;
    if (member.latestKnownGain > 0) continue;

    const activeDays = countActiveDaysUpTo(member, member.latestPositiveDay);
    if (activeDays < MIN_STREAK_DAYS) continue;

    const eventKey = `streak_break:${reportDate}:${member.viewerId}`;
    keys.push(eventKey);
    alerts.push({
      type: "streak_break",
      eventKey,
      memberViewerId: String(member.viewerId),
      message: `${member.trainerName} — streak terputus setelah ${activeDays} hari aktif berturut-turut`,
      reportDate,
    });
  }

  return { keys, alerts };
}

function detectNewTransfers(
  computedMembers: ComputedMember[],
  reportDate: string,
): { keys: string[]; alerts: Alert[] } {
  const keys: string[] = [];
  const alerts: Alert[] = [];

  for (const member of computedMembers) {
    if (!member.isTransfer) continue;
    const eventKey = `new_transfer:${member.viewerId}`;
    keys.push(eventKey);
    const from = member.previousCircleName
      ? ` dari ${member.previousCircleName}`
      : "";
    alerts.push({
      type: "new_transfer",
      eventKey,
      memberViewerId: String(member.viewerId),
      message: `${member.trainerName} — transfer baru terdeteksi${from}`,
      reportDate,
    });
  }

  return { keys, alerts };
}

function detectRankDrop(
  snapshot: Snapshot,
  reportDate: string,
  config: BotConfig,
): { keys: string[]; alerts: Alert[] } {
  const keys: string[] = [];
  const alerts: Alert[] = [];

  const yesterdayRank = snapshot.circle.yesterday_rank ?? 0;
  const diff =
    yesterdayRank > 0 ? snapshot.circle.monthly_rank - yesterdayRank : 0;

  if (diff > config.alerts.rankDrop.positions) {
    const eventKey = `rank_drop:${reportDate}`;
    keys.push(eventKey);
    alerts.push({
      type: "rank_drop",
      eventKey,
      memberViewerId: "club",
      message: `Rank turun ${diff} posisi — peringatan: pergerakan signifikan (${snapshot.circle.yesterday_rank} → ${snapshot.circle.monthly_rank})`,
      reportDate,
    });
  }

  return { keys, alerts };
}

// Returns true if alerts were suppressed (caller should return [])
async function suppressDuringQuietHours(
  alerts: Alert[],
  existingKeys: Set<string>,
  config: BotConfig,
  db: IDatabase,
): Promise<boolean> {
  if (!config.alerts.quietHours.enabled || alerts.length === 0) return false;

  const now = new Date();
  const displayParts = new Intl.DateTimeFormat("en-US", {
    timeZone: config.timezone,
    minute: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const currentHour = parseInt(
    displayParts.find((p) => p.type === "hour")!.value,
    10,
  );
  const currentMinute = parseInt(
    displayParts.find((p) => p.type === "minute")!.value,
    10,
  );

  const startParts = config.alerts.quietHours.start.split(":");
  const endParts = config.alerts.quietHours.end.split(":");
  const startTotal =
    parseInt(startParts[0], 10) * 60 + parseInt(startParts[1] ?? "0", 10);
  const endTotal =
    parseInt(endParts[0], 10) * 60 + parseInt(endParts[1] ?? "0", 10);
  const currentTotal = currentHour * 60 + currentMinute;

  let isQuiet = false;
  if (startTotal <= endTotal) {
    isQuiet = currentTotal >= startTotal && currentTotal < endTotal;
  } else {
    // Wraps midnight (e.g., 23:30 - 06:30)
    isQuiet = currentTotal >= startTotal || currentTotal < endTotal;
  }

  if (!isQuiet) return false;

  // Record alerts for dedup so they don't re-fire after quiet hours end
  for (const alert of alerts) {
    await db.recordAlert({
      alert_type: alert.type,
      event_key: alert.eventKey,
      member_viewer_id: alert.memberViewerId,
      report_date: alert.reportDate,
      created_at: new Date().toISOString(),
      status: "suppressed",
      message: alert.message,
    });
  }
  log.info(
    "Alert",
    `${alerts.length} alert(s) suppressed during quiet hours (${config.alerts.quietHours.start}-${config.alerts.quietHours.end})`,
  );
  return true;
}

export async function detectAlerts(
  computedMembers: ComputedMember[],
  snapshot: Snapshot,
  config: BotConfig,
  db: IDatabase,
): Promise<Alert[]> {
  if (!config.alerts.enabled) return [];

  log.debug(
    "Alert",
    `Running alert detection (performanceDrop=${config.alerts.performanceDrop.enabled}, demotionRisk=${config.alerts.demotionRisk.enabled}, streakBreak=${config.alerts.streakBreak.enabled}, newTransfer=${config.alerts.newTransfer.enabled}, rankDrop=${config.alerts.rankDrop.enabled})`,
  );

  const latestDataDay = getDataDayFromSnapshot(snapshot);
  const reportDate = snapshot.circle.last_updated
    ? snapshot.circle.last_updated.split("T")[0]
    : getDataDate();

  const detectors: { keys: string[]; alerts: Alert[] }[] = [];
  if (config.alerts.performanceDrop.enabled) {
    detectors.push(
      detectPerformanceDrops(
        computedMembers,
        latestDataDay,
        reportDate,
        config,
      ),
    );
  }
  if (config.alerts.demotionRisk.enabled) {
    detectors.push(detectDemotionRisk(snapshot, reportDate, config));
  }
  if (config.alerts.streakBreak.enabled) {
    detectors.push(detectStreakBreaks(computedMembers, reportDate));
  }
  if (config.alerts.newTransfer.enabled) {
    detectors.push(detectNewTransfers(computedMembers, reportDate));
  }
  if (config.alerts.rankDrop.enabled) {
    detectors.push(detectRankDrop(snapshot, reportDate, config));
  }

  const candidateKeys: string[] = [];
  const candidateAlerts: Alert[] = [];
  for (const result of detectors) {
    candidateKeys.push(...result.keys);
    candidateAlerts.push(...result.alerts);
  }

  const existingKeys =
    candidateKeys.length > 0
      ? await db.getExistingAlertKeys(candidateKeys)
      : new Set<string>();
  const alerts = candidateAlerts.filter((a) => !existingKeys.has(a.eventKey));

  if (await suppressDuringQuietHours(alerts, existingKeys, config, db)) {
    return [];
  }

  return alerts;
}

export function formatAlerts(alerts: Alert[], isCatchUp: boolean): string {
  if (alerts.length === 0) return "";

  const header = isCatchUp ? "_[catch-up alerts]_" : "*⚠️ Alerts*";

  const grouped: Record<string, Alert[]> = {};
  for (const alert of alerts) {
    if (!grouped[alert.type]) grouped[alert.type] = [];
    grouped[alert.type].push(alert);
  }

  const lines: string[] = [header, ""];

  const typeLabels: Record<string, string> = {
    performance_drop: "Penurunan performa",
    demotion_risk: "Risiko degradasi",
    streak_break: "Streak terputus",
    new_transfer: "Transfer baru",
    rank_drop: "Rank turun",
  };

  for (const [type, typeAlerts] of Object.entries(grouped)) {
    if (typeAlerts.length === 1) {
      lines.push(typeAlerts[0].message);
    } else {
      lines.push(`${typeAlerts.length} ${typeLabels[type] ?? type} terdeteksi`);
      for (const a of typeAlerts) {
        lines.push(`  • ${a.message}`);
      }
    }
  }

  return lines.join("\n");
}

/**
 * Count the consecutive active days of the streak that just broke.
 * upToDay is the member's latest day with 0 gain.
 * Finds the last active day before the break, then counts backwards.
 */
function countActiveDaysUpTo(member: ComputedMember, upToDay: number): number {
  let lastActiveDay = -1;
  for (let day = upToDay - 1; day >= 2; day--) {
    if (getDailyGain(member.dailyFans, day) > 0) {
      lastActiveDay = day;
      break;
    }
  }
  if (lastActiveDay === -1) return 0;

  let streak = 0;
  for (let day = lastActiveDay; day >= 2; day--) {
    if (getDailyGain(member.dailyFans, day) > 0) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}
