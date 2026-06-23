/**
 * Tier intelligence report generator for Uma Club Bot v3.
 *
 * Shows promotion/demotion gap, current pace, required pace,
 * and projected outcome based on remaining days.
 */

import { Snapshot, BotConfig, TierData, CLUB_TIERS } from '../types';
import type { ComputedMember } from '../types';
import type { Database } from '../db/database';
import { getDataDayFromSnapshot } from '../data/snapshot';
import { formatNumber, formatDateWIB, buildDateStr, buildFooter, buildDataLine } from './format';

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

/**
 * Generate the tier report string.
 *
 * @param snapshot - Raw snapshot data
 * @param computedMembers - Pre-computed member data (ComputedMember[])
 */
export function generateTierReport(snapshot: Snapshot, config: BotConfig, computedMembers: ComputedMember[], db?: Database): string {
  // Guard: empty members
  if (!snapshot.members || snapshot.members.length === 0) {
    return 'ℹ️ *Tier Intelligence*\nData tier belum tersedia.';
  }

  const tier = computeTierData(snapshot);
  const { circle } = snapshot;

  const riskEmoji: Record<string, string> = {
    LOW: '✅',
    MEDIUM: '⚠️',
    HIGH: '🚨',
  };

  const outcomeText: Record<string, string> = {
    promote: 'Promosi 🎉',
    stay: 'Bertahan',
    demotion_risk: 'Degradasi risk ⚠️',
    unknown: 'Belum pasti',
  };

  const lines: string[] = [];
  lines.push(`🏆 *Tier Intelligence*`);
  lines.push('');

  // Date
  const dataDay = getDataDayFromSnapshot(snapshot);
  const dateStr = buildDateStr(snapshot, dataDay);
  const formattedDate = formatDateWIB(dateStr);

  lines.push(
    `${circle.name} | ${tier.tierName} (#${circle.monthly_rank})`
  );
  lines.push(buildDataLine(formattedDate));
  lines.push('');
  lines.push(
    `Promosi: ${formatNumber(tier.promotionGap)} fans lagi`
  );
  lines.push(
    `Degradasi: buffer ${formatNumber(tier.demotionBuffer)}`
  );
  lines.push('');
  lines.push(`Pace saat ini: ${formatNumber(tier.currentPace)}/hari`);
  lines.push(`Pace butuh: ${formatNumber(tier.requiredPace)}/hari`);
  lines.push('');
  lines.push(`Sisa hari: ${tier.daysLeft}`);
  lines.push(
    `${riskEmoji[tier.riskLevel]} Proyeksi: ${outcomeText[tier.projectedOutcome]}`
  );

  // Sync footer
  lines.push('');
  lines.push(buildFooter(config, buildDateStr(snapshot)));
  return lines.join('\n');
}
