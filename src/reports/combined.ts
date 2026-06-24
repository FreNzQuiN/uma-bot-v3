/**
 * Combined report generator.
 *
 * Generates multiple report types into a single joined message.
 * Shared between scheduler and catch-up to eliminate duplication.
 */

import type { BotConfig, Snapshot, ComputedMember } from '../types';
import { generateDailyReport } from './daily';
import { generateWeeklyReport } from './weekly';
import { generateMonthlyReport } from './monthly';

/**
 * Generate a combined report string from multiple report types.
 *
 * @param types - Report types to include (e.g. ['daily', 'weekly', 'monthly'])
 * @param snapshot - Snapshot data
 * @param config - Bot configuration
 * @param computedMembers - Pre-computed member data (ComputedMember[])
 * @returns Joined report string, or empty string if no types matched
 */
export function generateCombinedReport(
  types: string[],
  snapshot: Snapshot,
  config: BotConfig,
  computedMembers: ComputedMember[]
): string {
  const parts: string[] = [];
  for (const type of types) {
    switch (type) {
      case 'daily':
        parts.push(generateDailyReport(snapshot, config, computedMembers, undefined));
        break;
      case 'weekly':
        parts.push(generateWeeklyReport(snapshot, config, computedMembers, undefined));
        break;
      case 'monthly':
        // Monthly in combined reports always uses offset=-1 (previous month)
        parts.push(generateMonthlyReport(snapshot, config, computedMembers, -1));
        break;
    }
  }
  return parts.join('\n\n');
}
