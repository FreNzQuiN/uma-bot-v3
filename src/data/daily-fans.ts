/**
 * Daily fans calculation helpers for the Uma Club Bot's core data model.
 *
 * The core data is a `daily_fans` array — 32 cumulative integers
 * representing each day's total fans for one member in a month.
 *
 * - Index 0 = Day 1, Index 30 = Day 31, Index 31 = unused padding
 * - Positive = cumulative total at end of day
 * - Zero = no usable data
 * - Negative = transfer indicator (not negative performance)
 */

import { Snapshot, WEEK_BLOCKS, TierData, CLUB_TIERS } from "../types";

/** Negative values are transfer markers, zero means no data. */
function isPositive(value: number | undefined): boolean {
  return typeof value === "number" && value > 0;
}

function hasValue(v: number | undefined, includeTransfer: boolean): boolean {
  if (typeof v !== "number") return false;
  return v > 0 || (includeTransfer && v < 0);
}

function effectiveValue(v: number, includeTransfer: boolean): number {
  return includeTransfer && v < 0 ? Math.abs(v) : v;
}

/**
 * Returns the latest 1-indexed day that has a positive cumulative value.
 * Returns 0 if no positive values exist.
 * Ignores negative (transfer markers) and zero values.
 */
export function getLatestDataDay(dailyFans: number[]): number {
  const maxIndex = Math.min(dailyFans.length, 31) - 1;
  for (let i = maxIndex; i >= 0; i--) {
    if (isPositive(dailyFans[i])) {
      return i + 1;
    }
  }
  return 0;
}

/**
 * Returns the first 1-indexed day with a positive value.
 * Returns 0 if no positive values.
 * Ignores negative values.
 */
export function getFirstPositiveDay(dailyFans: number[]): number {
  for (let i = 0; i < dailyFans.length; i++) {
    if (isPositive(dailyFans[i])) {
      return i + 1;
    }
  }
  return 0;
}

/**
 * Compute the daily gain for a given 1-indexed day.
 *
 * Gain = dailyFans[day-1] - dailyFans[day-2]
 * Both current and previous must be positive → return the difference.
 * Current positive but previous is 0, missing, or negative → return 0 (baseline).
 * Both zero or any non-positive combination → return 0.
 */
export function getDailyGain(
  dailyFans: number[],
  day: number,
  includeTransfer: boolean = false,
): number {
  if (day < 1 || day > dailyFans.length) {
    return 0;
  }

  const current = dailyFans[day - 1];
  if (!hasValue(current, includeTransfer)) {
    return 0;
  }
  const effectiveCurrent = effectiveValue(current, includeTransfer);

  if (day < 2) {
    return 0;
  }

  const previous = dailyFans[day - 2];
  if (isPositive(previous)) {
    return effectiveCurrent - previous;
  }
  if (includeTransfer && typeof previous === "number" && previous < 0) {
    return effectiveCurrent - Math.abs(previous);
  }

  return 0;
}

/**
 * Gain = last positive value in block - first positive value in block.
 * Returns 0 if no positive values or only one positive value in the block.
 */
export function getWeeklyGain(
  dailyFans: number[],
  weekNumber: number,
  includeTransfer: boolean = false,
): number {
  const block = WEEK_BLOCKS.find((b) => b.week === weekNumber);
  if (!block) {
    return 0;
  }

  let valueBeforeBlock: number | null = null;
  for (let day = 1; day < block.start; day++) {
    const idx = day - 1;
    if (idx < dailyFans.length && hasValue(dailyFans[idx], includeTransfer)) {
      valueBeforeBlock = effectiveValue(dailyFans[idx], includeTransfer);
    }
  }

  let lastPositiveInBlock: number | null = null;
  let firstPositiveInBlock: number | null = null;
  for (let day = block.start; day <= block.end; day++) {
    const idx = day - 1;
    if (idx < dailyFans.length && hasValue(dailyFans[idx], includeTransfer)) {
      const val = effectiveValue(dailyFans[idx], includeTransfer);
      if (firstPositiveInBlock === null) {
        firstPositiveInBlock = val;
      }
      lastPositiveInBlock = val;
    }
  }

  if (lastPositiveInBlock === null) {
    return 0;
  }

  const baseline = valueBeforeBlock ?? firstPositiveInBlock;

  if (baseline === null || baseline === lastPositiveInBlock) {
    return 0;
  }

  return lastPositiveInBlock - baseline;
}

/** Returns 0 if no positive values or only one (baseline only). */
export function getMonthlyGain(
  dailyFans: number[],
  includeTransfer: boolean = false,
): number {
  let firstDay = 0;
  let firstValue = 0;
  for (let i = 0; i < dailyFans.length; i++) {
    if (hasValue(dailyFans[i], includeTransfer)) {
      firstDay = i + 1;
      firstValue = effectiveValue(dailyFans[i], includeTransfer);
      break;
    }
  }

  let latestDay = 0;
  let latestValue = 0;
  for (let i = dailyFans.length - 1; i >= 0; i--) {
    if (hasValue(dailyFans[i], includeTransfer)) {
      latestDay = i + 1;
      latestValue = effectiveValue(dailyFans[i], includeTransfer);
      break;
    }
  }

  if (firstDay === 0 || latestDay === 0 || firstDay === latestDay) {
    return 0;
  }

  return latestValue - firstValue;
}

/**
 * Determine if a member is a transfer member.
 * True if previous_circle_id or previous_circle_name exist,
 * OR if daily_fans[0] < 0.
 */
export function isTransferMember(member: {
  daily_fans: number[];
  previous_circle_id?: number;
  previous_circle_name?: string;
}): boolean {
  if (member.previous_circle_id != null) {
    return true;
  }
  if (member.previous_circle_name != null) {
    return true;
  }
  if (member.daily_fans.length > 0 && member.daily_fans[0] < 0) {
    return true;
  }
  return false;
}

/**
 * Compute the rolling average of the last N days of gains.
 * Only counts days where gain can be computed (both current and previous positive).
 * Returns 0 if no valid gain days.
 */
export function computeRollingAverage(
  dailyFans: number[],
  latestDataDay: number,
  days: number,
  includeTransfer: boolean = false,
): number {
  if (days <= 0 || latestDataDay <= 0 || dailyFans.length === 0) {
    return 0;
  }

  // Collect gains from the last `days` days ending at latestDataDay
  const gains: number[] = [];
  const startDay = Math.max(2, latestDataDay - days + 1); // earliest day we check (day 1 can't have gain)

  for (let day = startDay; day <= latestDataDay; day++) {
    const gain = getDailyGain(dailyFans, day, includeTransfer);
    if (gain > 0) {
      gains.push(gain);
    }
  }

  if (gains.length === 0) {
    return 0;
  }

  const sum = gains.reduce((acc, g) => acc + g, 0);
  return Math.floor(sum / gains.length);
}

/**
 * Count active days: day 1 counts when it has data (no baseline exists to
 * compute a gain), later days count when gain > 0.
 */
export function countActiveDays(
  dailyFans: number[],
  latestDataDay?: number,
  includeTransfer: boolean = false,
): number {
  // Cap at 31 to avoid scanning the unused padding element at index 31
  const maxDay = latestDataDay ?? Math.min(dailyFans.length, 31);
  let count = 0;
  if (
    maxDay >= 1 &&
    dailyFans.length >= 1 &&
    hasValue(dailyFans[0], includeTransfer)
  ) {
    count++;
  }
  for (let day = 2; day <= maxDay; day++) {
    const gain = getDailyGain(dailyFans, day, includeTransfer);
    if (gain > 0) {
      count++;
    }
  }
  return count;
}

/** Resets the counter on any day with positive gain. */
export function countConsecutiveZeroDaysAtEnd(
  dailyFans: number[],
  latestDataDay: number,
): number {
  let count = 0;
  for (let day = latestDataDay; day >= 2; day--) {
    const gain = getDailyGain(dailyFans, day);
    if (gain > 0) break;
    count++;
  }
  return count;
}

/**
 * Check if a member is stale for a specific report type.
 * Uses rolling window of consecutive zero-gain days.
 * @param threshold - Number of consecutive zero days needed to be stale.
 *                    If <= 0, stale check is disabled.
 */
export function isStaleForReport(
  dailyFans: number[],
  latestDataDay: number,
  threshold: number,
): boolean {
  if (threshold <= 0) return false;
  return countConsecutiveZeroDaysAtEnd(dailyFans, latestDataDay) >= threshold;
}

/** Returns the max latest data day across all members. */
export function getDataDayFromSnapshot(snapshot: Snapshot): number {
  let maxDay = 0;

  for (const member of snapshot.members) {
    const day = getLatestDataDay(member.daily_fans);
    if (day > maxDay) {
      maxDay = day;
    }
  }

  return maxDay;
}

export function computeTierData(snapshot: Snapshot): TierData {
  const { club_rank, fans_to_next_tier, fans_to_lower_tier } = snapshot;
  const tierName = CLUB_TIERS[club_rank] || `T${club_rank}`;

  const dataDay = getDataDayFromSnapshot(snapshot);
  const daysInMonth =
    snapshot.members.length > 0
      ? new Date(
          snapshot.members[0].year,
          snapshot.members[0].month,
          0,
        ).getDate()
      : 30;
  const daysLeft = Math.max(0, daysInMonth - dataDay);

  // Current pace: total fans accumulated / days elapsed
  const totalFans = snapshot.circle.monthly_point;
  const currentPace = dataDay > 0 ? Math.round(totalFans / dataDay) : 0;

  // Required pace: promotion gap / days left
  const requiredPace =
    daysLeft > 0 ? Math.round(fans_to_next_tier / daysLeft) : 0;

  // Risk assessment per spec:
  // LOW = buffer >= 7 days of current pace
  // MEDIUM = buffer >= 3 and < 7 days of current pace
  // HIGH = buffer < 3 days of current pace
  let riskLevel: TierData["riskLevel"] = "LOW";
  let projectedOutcome: TierData["projectedOutcome"] = "unknown";

  if (fans_to_lower_tier > 0 && currentPace > 0) {
    const bufferDays = fans_to_lower_tier / currentPace;
    if (bufferDays < 3) {
      riskLevel = "HIGH";
      projectedOutcome = "demotion_risk";
    } else if (bufferDays < 7) {
      riskLevel = "MEDIUM";
      projectedOutcome = "stay";
    } else {
      riskLevel = "LOW";
    }
  }

  if (fans_to_next_tier > 0 && daysLeft > 0) {
    if (currentPace >= requiredPace && projectedOutcome !== "demotion_risk") {
      projectedOutcome = "promote";
    } else if (projectedOutcome !== "demotion_risk") {
      projectedOutcome = "stay";
    }
  } else if (fans_to_next_tier > 0 && daysLeft === 0) {
    if (projectedOutcome !== "demotion_risk") {
      projectedOutcome = "stay";
    }
  } else if (fans_to_next_tier === 0 && projectedOutcome !== "demotion_risk") {
    projectedOutcome = "stay"; // already at top tier
  }

  return {
    clubRank: club_rank,
    tierName,
    promotionGap: fans_to_next_tier,
    demotionBuffer: fans_to_lower_tier,
    requiredPace,
    currentPace,
    daysLeft,
    riskLevel,
    projectedOutcome,
  };
}
