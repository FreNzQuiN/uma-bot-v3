import type { BotConfig } from "../types";
import { log } from "../utils/logger";
import { getTargetMonth } from "../utils/timezone";

/**
 * Canonical scheduled report types shared by the scheduler and catch-up.
 *
 * Single source of truth so the two modules can't drift apart when a
 * 4th report type is added.
 */
export const SCHEDULED_REPORT_TYPES = ["daily", "weekly", "monthly"] as const;
export type ScheduledReportType = (typeof SCHEDULED_REPORT_TYPES)[number];

export const SCHEDULED_DAILY: ScheduledReportType = SCHEDULED_REPORT_TYPES[0];
export const SCHEDULED_WEEKLY: ScheduledReportType = SCHEDULED_REPORT_TYPES[1];
export const SCHEDULED_MONTHLY: ScheduledReportType = SCHEDULED_REPORT_TYPES[2];

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

  const groups = new Map<string, string[]>();
  for (const { type, time } of enabled) {
    if (!groups.has(time)) groups.set(time, []);
    groups.get(time)!.push(type);
  }

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
  const timeMap = new Map<string, string[]>();
  for (const reportType of types) {
    let time: string | undefined;
    if (reportType === SCHEDULED_DAILY) time = schedule.daily.time;
    else if (reportType === SCHEDULED_WEEKLY) time = schedule.weekly.time;
    else if (reportType === SCHEDULED_MONTHLY) time = schedule.monthly.time;
    if (!time) continue;
    if (!timeMap.has(time)) timeMap.set(time, []);
    timeMap.get(time)!.push(reportType);
  }
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
