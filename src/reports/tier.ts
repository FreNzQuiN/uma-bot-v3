/**
 * Tier intelligence report generator for Uma Club Bot v3.
 *
 * Shows promotion/demotion gap, current pace, required pace,
 * and projected outcome based on remaining days.
 */

import { Snapshot, BotConfig, CLUB_TIERS } from '../types';
import type { ComputedMember } from '../types';
import { formatNumber } from '../utils/format';
import { buildDateStr, buildFooter, buildReportHeader } from './format';
import { computeTierData } from '../data/daily-fans';

export function generateTierReport(snapshot: Snapshot, config: BotConfig, computedMembers: ComputedMember[]): string {
  if (!snapshot.members || snapshot.members.length === 0) {
    return 'ℹ️ *Tier Intelligence*\nData tier belum tersedia.';
  }

  const tier = computeTierData(snapshot);

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
  const header = buildReportHeader(snapshot, `🏆 *Tier Intelligence*`);
  lines.push(...header);
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

  lines.push('');
  lines.push(buildFooter(config, buildDateStr(snapshot)));
  return lines.join('\n');
}
