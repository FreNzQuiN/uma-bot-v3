/**
 * Tier intelligence report generator for Uma Club Bot v3.
 *
 * Shows promotion/demotion gap, current pace, required pace,
 * and projected outcome based on remaining days.
 */

import { Snapshot, BotConfig, CLUB_TIERS } from '../types';
import type { ComputedMember } from '../types';
import { getDataDayFromSnapshot } from '../data/snapshot';
import { formatNumber } from '../utils/format';
import { formatDateWIB } from '../utils/timezone';
import { buildDateStr, buildFooter, buildDataLine } from './format';
import { computeTierData } from '../data/daily-fans';

export { computeTierData, CLUB_TIERS };

/**
 * Generate the tier report string.
 *
 * @param snapshot - Raw snapshot data
 * @param computedMembers - Pre-computed member data (ComputedMember[])
 */
export function generateTierReport(snapshot: Snapshot, config: BotConfig, computedMembers: ComputedMember[]): string {
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
