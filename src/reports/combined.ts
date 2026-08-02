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

import type { BotConfig, Snapshot, ComputedMember } from "../types";
import { generateDailyReport } from "./daily";
import { generateWeeklyReport } from "./weekly";
import { generateMonthlyReport } from "./monthly";
import { buildFooter, buildDateStr } from "./format";

const FOOTER_MARKER = "⸻";

/**
 * Strip the sync footer from a report string.
 * Footer always starts with FOOTER_MARKER on its own line, spans to end of string.
 */
function stripFooter(report: string): string {
  const markerIdx = report.lastIndexOf(FOOTER_MARKER);
  if (markerIdx === -1) return report;
  return report.slice(0, markerIdx).trimEnd();
}

export function generateCombinedReport(
  types: string[],
  snapshot: Snapshot,
  config: BotConfig,
  computedMembers: ComputedMember[],
): string {
  const parts: string[] = [];
  for (const type of types) {
    let report: string | undefined;
    switch (type) {
      case "daily":
        report = generateDailyReport(
          snapshot,
          config,
          computedMembers,
          undefined,
        );
        break;
      case "weekly":
        report = generateWeeklyReport(
          snapshot,
          config,
          computedMembers,
          undefined,
        );
        break;
      case "monthly":
        // Monthly in combined reports always uses offset=-1 (previous month)
        report = generateMonthlyReport(snapshot, config, computedMembers, -1);
        break;
    }
    if (report) {
      parts.push(stripFooter(report));
    }
  }
  if (parts.length === 0) return "";

  parts.push(buildFooter(config, buildDateStr(snapshot)));
  return parts.join("\n\n");
}
