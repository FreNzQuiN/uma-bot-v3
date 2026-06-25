/**
 * Combined report generator.
 *
 * Generates multiple report types into a single joined message.
 * Shared between scheduler and catch-up to eliminate duplication.
 *
 * Each individual report includes its own sync footer. When combining,
 * we strip the footer from each report and emit a single shared footer
 * at the end to avoid duplication.
 */

import type { BotConfig, Snapshot, ComputedMember } from '../types';
import { generateDailyReport } from './daily';
import { generateWeeklyReport } from './weekly';
import { generateMonthlyReport } from './monthly';
import { buildFooter, buildDateStr } from './format';

/** Footer marker that appears at the start of every report's sync footer. */
const FOOTER_MARKER = '⸻';

/**
 * Strip the sync footer from a report string.
 * The footer always starts with FOOTER_MARKER ("⸻") on its own line
 * and spans to the end of the string.
 */
function stripFooter(report: string): string {
  const markerIdx = report.lastIndexOf(FOOTER_MARKER);
  if (markerIdx === -1) return report;
  // Trim the footer and any trailing whitespace before it
  return report.slice(0, markerIdx).trimEnd();
}

/**
 * Generate a combined report string from multiple report types.
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
    let report: string | undefined;
    switch (type) {
      case 'daily':
        report = generateDailyReport(snapshot, config, computedMembers, undefined);
        break;
      case 'weekly':
        report = generateWeeklyReport(snapshot, config, computedMembers, undefined);
        break;
      case 'monthly':
        // Monthly in combined reports always uses offset=-1 (previous month)
        report = generateMonthlyReport(snapshot, config, computedMembers, -1);
        break;
    }
    if (report) {
      parts.push(stripFooter(report));
    }
  }
  if (parts.length === 0) return '';

  // Single shared footer for the whole combined report
  parts.push(buildFooter(config, buildDateStr(snapshot)));
  return parts.join('\n\n');
}
