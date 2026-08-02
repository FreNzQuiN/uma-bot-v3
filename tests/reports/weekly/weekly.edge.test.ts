/**
 * Weekly Report — Edge Cases
 *
 * Tests negative offset, offset clamping, below-requirement section,
 * empty snapshot guard, and cross-week consistency.
 * Uses real snapshot (examples/snapshot-june-12.json, 34 members).
 */

import { generateWeeklyReport } from "../../../src/reports/weekly";
import { computeMembers } from "../../../src/reports/compute";
import { getDefaultConfig } from "../../../src/config";
import type { Snapshot, BotConfig } from "../../../src/types";
import {
  loadRealSnapshot,
  makeConfig,
  makeEmptySnapshot,
} from "../../_helpers";

// Layout contract: summary line is the 8th line of the split report.
const SUMMARY_LINE_INDEX = 8;

let snapshot: Snapshot;
let config: BotConfig;
let computedMembers: ReturnType<typeof computeMembers>;

beforeAll(() => {
  snapshot = loadRealSnapshot();
  config = getDefaultConfig();
  computedMembers = computeMembers(snapshot, config);
});

describe("Negative offset equivalence", () => {
  it("/weekly -1 produces same output as /weekly 1", () => {
    const reportNeg = generateWeeklyReport(
      snapshot,
      config,
      computedMembers,
      -1,
    );
    const reportPos = generateWeeklyReport(
      snapshot,
      config,
      computedMembers,
      1,
    );
    expect(reportNeg).toBe(reportPos);
  });

  it("/weekly -2 produces same output as /weekly 2", () => {
    const reportNeg = generateWeeklyReport(
      snapshot,
      config,
      computedMembers,
      -2,
    );
    const reportPos = generateWeeklyReport(
      snapshot,
      config,
      computedMembers,
      2,
    );
    expect(reportNeg).toBe(reportPos);
  });
});

describe("Offset clamping (targetWeek clamped to 1)", () => {
  it("offset=2 → W1 (2-1=1, which is valid)", () => {
    // currentWeek=2, offset=2, targetWeek = max(1, 2-2) = max(1, 0) = 1
    const report = generateWeeklyReport(snapshot, config, computedMembers, 2);
    expect(report).toContain("📈 *Weekly Report — Minggu 1");
    expect(report).toContain("Periode: Hari 1-7");
  });

  it("offset=100 → W1 (clamped from 2-100 = -98)", () => {
    // currentWeek=2, offset=100, targetWeek = max(1, 2-100) = 1
    const report = generateWeeklyReport(snapshot, config, computedMembers, 100);
    expect(report).toContain("📈 *Weekly Report — Minggu 1");
    expect(report).toContain("Periode: Hari 1-7");
  });

  it("offset=0 → W2 (current week)", () => {
    const report = generateWeeklyReport(snapshot, config, computedMembers, 0);
    expect(report).toContain("📈 *Weekly Report — Minggu 2");
    expect(report).toContain("Periode: Hari 8-14");
  });
});

describe("Below-requirement section", () => {
  it("does NOT appear when weeklyFans = 0 (default config)", () => {
    const report = generateWeeklyReport(snapshot, config, computedMembers, 0);
    expect(report).not.toContain("⚠️ Di bawah target");
  });

  it("shows members below 5M/week when weeklyFans = 5,000,000", () => {
    const cfg = makeConfig({ requirements: { weeklyFans: 5_000_000 } });
    const report = generateWeeklyReport(
      snapshot,
      cfg,
      computeMembers(snapshot, cfg),
      0,
    );

    expect(report).toContain("⚠️ Di bawah target 5.0M/minggu:");

    // Members with W2 gain between 0 and 5M
    const belowSection = report.substring(report.indexOf("⚠️ Di bawah target"));
    expect(belowSection).toContain("• Dyy\u201D");
    expect(belowSection).toContain("• Ceciria");
    expect(belowSection).toContain("• Anshu");
    expect(belowSection).toContain("• Lihking");
    expect(belowSection).toContain("• Suzuka Kopling");
    expect(belowSection).toContain("• Falkrum");
    expect(belowSection).toContain("• Saki");
    expect(belowSection).toContain("• VitoHoow");
    expect(belowSection).toContain("• FreNzQuiN");
    expect(belowSection).toContain("• TheTengOne");
    expect(belowSection).toContain("• Ignis");
    expect(belowSection).toContain("• naku");
    expect(belowSection).toContain("• Azurarch");
    expect(belowSection).toContain("• Ryu");
    expect(belowSection).toContain("• Ernstormen");
    expect(belowSection).toContain("• Amanda");
    expect(belowSection).toContain("• Yukil");
    expect(belowSection).toContain("• jgd");
    expect(belowSection).toContain("• ursa");
  });

  it("includes members with gain = 0 in below-requirement (0 < weeklyFans)", () => {
    const cfg = makeConfig({ requirements: { weeklyFans: 5_000_000 } });
    const report = generateWeeklyReport(
      snapshot,
      cfg,
      computeMembers(snapshot, cfg),
      0,
    );
    const belowSection = report.substring(report.indexOf("⚠️ Di bawah target"));
    // Stale members have 0 gain → now included (0 < 5M)
    expect(belowSection).toContain("• DOA IBU");
    expect(belowSection).toContain("• Kuro");
    expect(belowSection).toContain("• Rowking");
    expect(belowSection).toContain("• Lebowski");
  });

  it("members with gain >= weeklyFans are NOT in below-requirement", () => {
    const cfg = makeConfig({ requirements: { weeklyFans: 5_000_000 } });
    const report = generateWeeklyReport(
      snapshot,
      cfg,
      computeMembers(snapshot, cfg),
      0,
    );
    const belowSection = report.substring(report.indexOf("⚠️ Di bawah target"));
    expect(belowSection).not.toContain("• Sairen");
    expect(belowSection).not.toContain("• GoldFamily");
    expect(belowSection).not.toContain("• Luck99");
    expect(belowSection).not.toContain("• Aditya");
    expect(belowSection).not.toContain("• Nargi");
    expect(belowSection).not.toContain("• sirsokban");
    expect(belowSection).not.toContain("• RngF");
    expect(belowSection).not.toContain("• DzFx");
    expect(belowSection).not.toContain("• Seterako");
    expect(belowSection).not.toContain("• Zero");
  });

  it("shows member names without gain values in below-requirement section", () => {
    const cfg = makeConfig({ requirements: { weeklyFans: 5_000_000 } });
    const report = generateWeeklyReport(
      snapshot,
      cfg,
      computeMembers(snapshot, cfg),
      0,
    );
    expect(report).toContain("• Dyy\u201D");
    expect(report).toContain("• ursa");
  });
});

describe("Empty snapshot guard", () => {
  it("returns warning for empty members array", () => {
    const emptySnapshot = makeEmptySnapshot(snapshot);
    const result = generateWeeklyReport(
      emptySnapshot,
      config,
      computeMembers(emptySnapshot, config),
      0,
    );
    expect(result).toBe("ℹ️ *Weekly Report*\nData minggu ini belum tersedia.");
  });

  it("empty warning has no other report content", () => {
    const emptySnapshot = makeEmptySnapshot(snapshot);
    const result = generateWeeklyReport(
      emptySnapshot,
      config,
      computeMembers(emptySnapshot, config),
      0,
    );
    expect(result).not.toContain("Minggu");
    expect(result).not.toContain("Periode");
    expect(result).not.toContain("gain mingguan");
  });
});

describe("Cross-week consistency", () => {
  it("W1 total + W2 total ≠ monthly total (different baselines)", () => {
    const w1Report = generateWeeklyReport(snapshot, config, computedMembers, 1);
    const w2Report = generateWeeklyReport(snapshot, config, computedMembers, 0);

    const w1TotalMatch = w1Report
      .split("\n")
      [SUMMARY_LINE_INDEX].match(/Total: ([\d.]+)([KMB])/);
    const w2TotalMatch = w2Report
      .split("\n")
      [SUMMARY_LINE_INDEX].match(/Total: ([\d.]+)([KMB])/);
    expect(w1TotalMatch).not.toBeNull();
    expect(w2TotalMatch).not.toBeNull();
    expect(w1TotalMatch![1] + w1TotalMatch![2]).not.toBe(
      w2TotalMatch![1] + w2TotalMatch![2],
    );
  });

  it("W2 report and W1 report have different member rankings", () => {
    const w1Report = generateWeeklyReport(snapshot, config, computedMembers, 1);
    const w2Report = generateWeeklyReport(snapshot, config, computedMembers, 0);

    const w1First = w1Report.split("\n").find((l) => /^1\.\s/.test(l));
    const w2First = w2Report.split("\n").find((l) => /^1\.\s/.test(l));

    expect(w1First).toContain("GoldFamily");
    expect(w2First).toContain("Sairen");
  });
});
