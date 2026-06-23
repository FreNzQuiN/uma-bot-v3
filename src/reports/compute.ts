/**
 * Shared computation engine for all reports.
 *
 * Transforms raw snapshot member data into ComputedMember[] with
 * pre-calculated gains, status classifications, and weekly breakdowns.
 */

import { Snapshot, ComputedMember, MemberStatus, BotConfig, WEEK_BLOCKS, TierData, CLUB_TIERS } from '../types';
import {
  getLatestDataDay,
  getFirstPositiveDay,
  getDailyGain,
  getWeeklyGain,
  getMonthlyGain,
  isTransferMember,
} from '../data/daily-fans';
import { getDataDayFromSnapshot } from '../data/snapshot';

/**
 * Compute derived data for every member in the snapshot.
 *
 * Each ComputedMember contains:
 * - Status classification (active / stale / left)
 * - Latest and first positive day values
 * - Monthly, daily, and weekly gains
 * - Transfer information (boolean attribute, not a status)
 *
 * Stale is computed per-report using report-specific thresholds,
 * NOT globally here. The only status assignments in this function are:
 * - 'stale' when latestPositiveDay === 0 (no data at all)
 * - 'left' from ghost detection (member_count gap)
 */
export function computeMembers(
  snapshot: Snapshot,
  config: BotConfig
): ComputedMember[] {
  const latestDataDay = getDataDayFromSnapshot(snapshot);

  // First pass: compute raw status for every member
  const membersWithGain: (ComputedMember & { monthlyGain: number })[] =
    snapshot.members.map((member) => {
      const dailyFans = member.daily_fans;
      const latestPositiveDay = getLatestDataDay(dailyFans);
      const firstPositiveDay = getFirstPositiveDay(dailyFans);
      const latestPositiveValue =
        latestPositiveDay > 0 ? dailyFans[latestPositiveDay - 1] : 0;
      const firstPositiveValue =
        firstPositiveDay > 0 ? dailyFans[firstPositiveDay - 1] : 0;

      const isTransfer = isTransferMember(member);

      // Status = activity only. 'stale' only when no data at all.
      // Report-specific stale is computed per-report.
      let status: MemberStatus = 'active';
      if (latestPositiveDay === 0) status = 'stale';

      const includeTransfer = config.requirements.includeTransferDataInCalculation;
      const monthlyGain = getMonthlyGain(dailyFans, includeTransfer);
      const latestDailyGain = getDailyGain(dailyFans, latestPositiveDay, includeTransfer);
      const weeklyGains = WEEK_BLOCKS.map((wb) =>
        getWeeklyGain(dailyFans, wb.week, includeTransfer)
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
        latestDailyGain,
        weeklyGains,
      };
    });

  // Second pass: ghost detection via member_count
  // If snapshot has more members than member_count, the extra members are
  // ghosts who left the club. Among all active members, the bottom
  // ghostCount by monthly gain are reclassified as 'left'.
  const ghostCount = Math.max(
    0,
    snapshot.members.length - snapshot.circle.member_count
  );

  if (ghostCount > 0) {
    // Among non-left members, find the bottom N by monthlyGain to reclassify as left.
    // These are the likely ghosts — members present in snapshot but not actually in the club.
    const candidates = [...membersWithGain]
      .sort((a, b) => a.monthlyGain - b.monthlyGain);

    const toReclassify = candidates.slice(0, ghostCount);
    const reclassifyIds = new Set(toReclassify.map((m) => m.viewerId));

    for (const m of membersWithGain) {
      if (reclassifyIds.has(m.viewerId)) {
        m.status = 'left';
      }
    }
  }

  return membersWithGain;
}

/**
 * Compute tier intelligence data from a snapshot.
 */
export function computeTierData(snapshot: Snapshot): TierData {
  const { club_rank, fans_to_next_tier, fans_to_lower_tier } = snapshot;
  const tierName = CLUB_TIERS[club_rank] || `T${club_rank}`;

  const dataDay = getDataDayFromSnapshot(snapshot);
  const daysInMonth = snapshot.members.length > 0
    ? new Date(snapshot.members[0].year, snapshot.members[0].month, 0).getDate()
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
  let riskLevel: TierData['riskLevel'] = 'LOW';
  let projectedOutcome: TierData['projectedOutcome'] = 'unknown';

  if (fans_to_lower_tier > 0 && currentPace > 0) {
    // Buffer in days of current pace
    const bufferDays = fans_to_lower_tier / currentPace;
    if (bufferDays < 3) {
      riskLevel = 'HIGH';
      projectedOutcome = 'demotion_risk';
    } else if (bufferDays < 7) {
      riskLevel = 'MEDIUM';
      projectedOutcome = 'stay';
    } else {
      riskLevel = 'LOW';
    }
  }

  // Projection
  if (fans_to_next_tier > 0 && daysLeft > 0) {
    if (currentPace >= requiredPace) {
      projectedOutcome = 'promote';
    } else if (projectedOutcome !== 'demotion_risk') {
      projectedOutcome = 'stay';
    }
  } else if (fans_to_next_tier === 0 && projectedOutcome !== 'demotion_risk') {
    projectedOutcome = 'stay'; // already at top tier
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
