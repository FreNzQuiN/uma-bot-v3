/**
 * Shared computation engine for all reports.
 *
 * Transforms raw snapshot member data into ComputedMember[] with
 * pre-calculated gains, status classifications, and weekly breakdowns.
 */

import {
  Snapshot,
  ComputedMember,
  MemberStatus,
  BotConfig,
  WEEK_BLOCKS,
} from "../types";
import {
  getLatestDataDay,
  getFirstPositiveDay,
  getDailyGain,
  getWeeklyGain,
  getMonthlyGain,
  isTransferMember,
} from "../data/daily-fans";
import { log } from "../utils/logger";
export { computeTierData } from "../data/daily-fans";

// Ghost-gap sanity cap: gaps above this ratio mean member_count is a data error, not leavers
const GHOST_GAP_MAX_RATIO = 0.5;

function getReferenceDataDay(members: ComputedMember[]): number {
  const days = members
    .map((m) => m.latestPositiveDay)
    .filter((d) => d >= 1)
    .sort((a, b) => a - b);
  if (days.length === 0) return 0;
  return days[Math.floor(days.length / 2)];
}

/**
 * Stale is computed per-report using report-specific thresholds,
 * NOT globally here. The only status assignments in this function are:
 * - 'stale' when latestPositiveDay === 0 (no data at all)
 * - 'left' from ghost detection (member_count gap)
 */
export function computeMembers(
  snapshot: Snapshot,
  config: BotConfig,
): ComputedMember[] {
  const membersWithGain: ComputedMember[] = snapshot.members.map((member) => {
    const dailyFans = member.daily_fans;
    const latestPositiveDay = getLatestDataDay(dailyFans);
    const firstPositiveDay = getFirstPositiveDay(dailyFans);
    const latestPositiveValue =
      latestPositiveDay > 0 ? dailyFans[latestPositiveDay - 1] : 0;
    const firstPositiveValue =
      firstPositiveDay > 0 ? dailyFans[firstPositiveDay - 1] : 0;

    const isTransfer = isTransferMember(member);

    let status: MemberStatus = "active";
    if (latestPositiveDay === 0) status = "stale";

    const includeTransfer =
      config.requirements.includeTransferDataInCalculation;
    const monthlyGain = getMonthlyGain(dailyFans, includeTransfer);
    const latestKnownGain = getDailyGain(
      dailyFans,
      latestPositiveDay,
      includeTransfer,
    );
    const weeklyGains = WEEK_BLOCKS.map((wb) =>
      getWeeklyGain(dailyFans, wb.week, includeTransfer),
    );

    return {
      viewerId: member.viewer_id,
      trainerName: member.trainer_name,
      status,
      isTransfer,
      previousCircleName: member.previous_circle_name,
      dailyFans,
      latestPositiveDay,
      latestPositiveValue,
      firstPositiveDay,
      firstPositiveValue,
      monthlyGain,
      latestKnownGain,
      weeklyGains,
    };
  });

  const memberCount = snapshot.circle.member_count;
  const ghostCount =
    memberCount > 0 ? Math.max(0, snapshot.members.length - memberCount) : 0;

  if (
    ghostCount > 0 &&
    ghostCount < snapshot.members.length * GHOST_GAP_MAX_RATIO
  ) {
    const referenceDay = getReferenceDataDay(membersWithGain);
    const candidates = membersWithGain
      .filter(
        (m) => m.latestPositiveDay >= 1 && m.latestPositiveDay < referenceDay,
      )
      .sort(
        (a, b) =>
          a.latestPositiveDay - b.latestPositiveDay ||
          a.monthlyGain - b.monthlyGain ||
          a.viewerId - b.viewerId,
      );

    const toReclassify = candidates.slice(0, ghostCount);
    if (toReclassify.length < ghostCount) {
      log.warn(
        "Report",
        `Ghost detection deferred: ${toReclassify.length} confirmed of ${ghostCount} gap (referenceDay=${referenceDay})`,
      );
    }
    const reclassifyIds = new Set(toReclassify.map((m) => m.viewerId));

    for (const m of membersWithGain) {
      if (reclassifyIds.has(m.viewerId)) {
        m.status = "left";
      }
    }
  }

  return membersWithGain;
}
