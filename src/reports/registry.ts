/**
 * Report type → generator registry for Uma Club Bot v3.
 *
 * Single source of truth for mapping report type strings to their
 * generator functions. Used by dispatch.ts and report-orchestrator.ts.
 */

import type { Snapshot, BotConfig, ComputedMember } from '../types';
import type { Database } from '../db/database';
import { generateDailyReport } from './daily';
import { generateWeeklyReport } from './weekly';
import { generateMonthlyReport } from './monthly';
import { generateRanksReport } from './ranks';
import { generateBottomReport } from './bottom';
import { generateStatsReport } from './stats';
import { generateMembersReport } from './members';
import { generateTierReport } from './tier';

export const REPORT_TYPES = ['daily', 'weekly', 'monthly', 'ranks', 'bottom', 'stats', 'members', 'tier'] as const;

/**
 * Generate a report string for a given report type.
 * Returns the formatted string, or undefined for unknown types.
 */
export function generateReportString(
  type: string,
  snapshot: Snapshot,
  config: BotConfig,
  computedMembers: ComputedMember[],
  options?: { offset?: number; db?: Database }
): string | undefined {
  switch (type) {
    case 'daily': return generateDailyReport(snapshot, config, computedMembers, options?.offset ?? 0);
    case 'weekly': return generateWeeklyReport(snapshot, config, computedMembers, options?.offset ?? 0);
    case 'monthly': return generateMonthlyReport(snapshot, config, computedMembers, options?.offset ?? 0);
    case 'ranks': return generateRanksReport(snapshot, config, computedMembers);
    case 'bottom': return generateBottomReport(snapshot, config, computedMembers);
    case 'stats': return generateStatsReport(snapshot, config, computedMembers);
    case 'members': return generateMembersReport(snapshot, config, computedMembers, options?.db);
    case 'tier': return generateTierReport(snapshot, config, computedMembers);
    default: return undefined;
  }
}
