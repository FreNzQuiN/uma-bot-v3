/**
 * Tests for generateCombinedReport — the thin combiner that joins
 * multiple report types into a single message.
 *
 * Combined reports strip the sync footer from each individual report
 * and emit a single shared footer at the end to avoid duplication.
 */

import { Snapshot, BotConfig, ComputedMember } from "../../src/types";
import { generateCombinedReport } from "../../src/reports/combined";
import { generateDailyReport } from "../../src/reports/daily";
import { generateWeeklyReport } from "../../src/reports/weekly";
import { generateMonthlyReport } from "../../src/reports/monthly";
import { computeMembers } from "../../src/reports/compute";
import { buildFooter, buildDateStr } from "../../src/reports/format";
import { loadRealSnapshot, makeConfig } from "../_helpers";

let snapshot: Snapshot;
let config: BotConfig;
let computedMembers: ComputedMember[];

beforeAll(() => {
  snapshot = loadRealSnapshot();
  config = makeConfig();
  computedMembers = computeMembers(snapshot, config);
});

/** Strip the sync footer (starts with "⸻") from a report string. */
function stripFooter(report: string): string {
  const idx = report.lastIndexOf("⸻");
  return idx === -1 ? report : report.slice(0, idx).trimEnd();
}

/** The shared footer that combined reports should end with. */
function sharedFooter(): string {
  return buildFooter(config, buildDateStr(snapshot));
}

describe("generateCombinedReport", () => {
  it("returns empty string when types array is empty", () => {
    const result = generateCombinedReport(
      [],
      snapshot,
      config,
      computedMembers,
    );
    expect(result).toBe("");
  });

  it("returns empty string when types contains only unknown strings", () => {
    const result = generateCombinedReport(
      ["foo", "bar", "baz"],
      snapshot,
      config,
      computedMembers,
    );
    expect(result).toBe("");
  });

  it('generates daily report when types=["daily"]', () => {
    const result = generateCombinedReport(
      ["daily"],
      snapshot,
      config,
      computedMembers,
    );
    const expected = generateDailyReport(
      snapshot,
      config,
      computedMembers,
      undefined,
    );
    expect(result).toBe(expected);
    expect(result).toContain("Daily");
  });

  it('generates weekly report when types=["weekly"]', () => {
    const result = generateCombinedReport(
      ["weekly"],
      snapshot,
      config,
      computedMembers,
    );
    const expected = generateWeeklyReport(
      snapshot,
      config,
      computedMembers,
      undefined,
    );
    expect(result).toBe(expected);
    expect(result).toContain("Weekly");
  });

  it('generates monthly report with offset=-1 when types=["monthly"]', () => {
    const result = generateCombinedReport(
      ["monthly"],
      snapshot,
      config,
      computedMembers,
    );
    // Monthly in combined always uses offset=-1 (previous month)
    // The shared footer uses the current snapshot date, not the previous month's date
    const monthlyBody = stripFooter(
      generateMonthlyReport(snapshot, config, computedMembers, -1),
    );
    expect(result).toBe(`${monthlyBody}\n\n${sharedFooter()}`);
    expect(result).toContain("Monthly");
  });

  it("joins daily+weekly reports with single shared footer (no duplicates)", () => {
    const result = generateCombinedReport(
      ["daily", "weekly"],
      snapshot,
      config,
      computedMembers,
    );
    const daily = stripFooter(
      generateDailyReport(snapshot, config, computedMembers, undefined),
    );
    const weekly = stripFooter(
      generateWeeklyReport(snapshot, config, computedMembers, undefined),
    );
    const expected = `${daily}\n\n${weekly}\n\n${sharedFooter()}`;
    expect(result).toBe(expected);
  });

  it("ignores unknown types mixed with valid ones", () => {
    const result = generateCombinedReport(
      ["daily", "unknown", "weekly"],
      snapshot,
      config,
      computedMembers,
    );
    const daily = stripFooter(
      generateDailyReport(snapshot, config, computedMembers, undefined),
    );
    const weekly = stripFooter(
      generateWeeklyReport(snapshot, config, computedMembers, undefined),
    );
    // Unknown type is silently skipped — only daily + weekly + shared footer
    expect(result).toBe(`${daily}\n\n${weekly}\n\n${sharedFooter()}`);
  });

  it('generates combined daily+monthly report when types=["daily", "monthly"]', () => {
    const result = generateCombinedReport(
      ["daily", "monthly"],
      snapshot,
      config,
      computedMembers,
    );
    const daily = stripFooter(
      generateDailyReport(snapshot, config, computedMembers, undefined),
    );
    const monthly = stripFooter(
      generateMonthlyReport(snapshot, config, computedMembers, -1),
    );
    expect(result).toBe(`${daily}\n\n${monthly}\n\n${sharedFooter()}`);
  });

  it('generates combined daily+weekly+monthly report when types=["daily", "weekly", "monthly"]', () => {
    const result = generateCombinedReport(
      ["daily", "weekly", "monthly"],
      snapshot,
      config,
      computedMembers,
    );
    const daily = stripFooter(
      generateDailyReport(snapshot, config, computedMembers, undefined),
    );
    const weekly = stripFooter(
      generateWeeklyReport(snapshot, config, computedMembers, undefined),
    );
    const monthly = stripFooter(
      generateMonthlyReport(snapshot, config, computedMembers, -1),
    );
    expect(result).toBe(
      `${daily}\n\n${weekly}\n\n${monthly}\n\n${sharedFooter()}`,
    );
  });

  it("contains exactly one sync footer (no duplication)", () => {
    const result = generateCombinedReport(
      ["daily", "weekly", "monthly"],
      snapshot,
      config,
      computedMembers,
    );
    const footerCount = (result.match(/Terakhir sync:/g) || []).length;
    expect(footerCount).toBe(1);
  });

  it("single report type also has exactly one footer", () => {
    const result = generateCombinedReport(
      ["daily"],
      snapshot,
      config,
      computedMembers,
    );
    const footerCount = (result.match(/Terakhir sync:/g) || []).length;
    expect(footerCount).toBe(1);
  });
});
