import type { BotConfig } from "../types";
import type { IDatabase } from "../db/types";
import { log } from "../utils/logger";
import { getTargetMonth } from "../utils/timezone";

/**
 * Canonical scheduled report types shared by the scheduler and catch-up.
 *
 * Single source of truth so the two modules can't drift apart when a
 * 4th report type is added.
 */
export const SCHEDULED_DAILY = "daily" as const;
export const SCHEDULED_WEEKLY = "weekly" as const;
export const SCHEDULED_MONTHLY = "monthly" as const;
export const SCHEDULED_REPORT_TYPES = [
  SCHEDULED_DAILY,
  SCHEDULED_WEEKLY,
  SCHEDULED_MONTHLY,
] as const;
export type ScheduledReportType = (typeof SCHEDULED_REPORT_TYPES)[number];

export const PREV_MONTH_OFFSET = -1;

function groupByTime(
  entries: Array<{ type: string; time: string }>,
): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const { type, time } of entries) {
    if (!groups.has(time)) groups.set(time, []);
    groups.get(time)!.push(type);
  }
  return groups;
}

export function getCollidingTypes(
  dayOfMonth: number,
  config: BotConfig,
): string[] {
  const schedule = config.schedule;
  const enabled: Array<{ type: string; time: string }> = [];
  if (schedule.daily.enabled)
    enabled.push({ type: "daily", time: schedule.daily.time });
  if (schedule.weekly.enabled && schedule.weekly.days.includes(dayOfMonth))
    enabled.push({ type: "weekly", time: schedule.weekly.time });
  if (schedule.monthly.enabled && schedule.monthly.day === dayOfMonth)
    enabled.push({ type: "monthly", time: schedule.monthly.time });

  const groups = groupByTime(enabled);

  const dailyGroup = Array.from(groups.values()).find((g) =>
    g.includes(SCHEDULED_DAILY),
  );
  if (dailyGroup) return dailyGroup;

  const sorted = Array.from(groups.values()).sort(
    (a, b) => b.length - a.length,
  );
  return sorted[0] ?? [];
}

export function groupByCollision(
  types: string[],
  config: BotConfig,
): string[][] {
  const schedule = config.schedule;
  const entries: Array<{ type: string; time: string }> = [];
  for (const reportType of types) {
    let time: string | undefined;
    if (reportType === SCHEDULED_DAILY) time = schedule.daily.time;
    else if (reportType === SCHEDULED_WEEKLY) time = schedule.weekly.time;
    else if (reportType === SCHEDULED_MONTHLY) time = schedule.monthly.time;
    if (time) entries.push({ type: reportType, time });
  }
  const timeMap = groupByTime(entries);
  const groups: string[][] = [];
  for (const [, grouped] of timeMap) {
    grouped.sort(
      (a, b) =>
        SCHEDULED_REPORT_TYPES.indexOf(a as ScheduledReportType) -
        SCHEDULED_REPORT_TYPES.indexOf(b as ScheduledReportType),
    );
    groups.push(grouped);
  }
  return groups;
}

/**
 * True when the daily handler will already send the combined report for
 * reportType at the same scheduled time, so this handler must skip.
 */
export function dailyHandlerWillCombine(
  collidingTypes: string[],
  reportType: string,
  dailyEnabled: boolean,
): boolean {
  return (
    dailyEnabled &&
    collidingTypes.includes(SCHEDULED_DAILY) &&
    collidingTypes.includes(reportType)
  );
}

export async function recordIndividualRuns(
  db: IDatabase,
  types: string[],
  today: string,
  scheduledAt: string,
  targetJid: string,
  isCatchUp: boolean,
): Promise<void> {
  for (const type of types) {
    await db.recordRun({
      report_type: type,
      report_date: today,
      scheduled_at: scheduledAt,
      status: "sent",
      is_catch_up: isCatchUp,
      target_jid: targetJid,
    });
  }
}

export async function preFetchMonthlySnapshot(
  fetcher: (year: number, month: number) => Promise<unknown>,
  offset: number,
  context: string,
  baseYear: number,
  baseMonth: number,
): Promise<void> {
  const { year: targetYear, month: targetMonth } = getTargetMonth(
    baseYear,
    baseMonth,
    offset,
  );
  try {
    await fetcher(targetYear, targetMonth);
  } catch (err) {
    log.warn(
      "Report",
      `Failed to pre-fetch month ${targetYear}-${targetMonth} for ${context}`,
      err,
    );
  }
}
