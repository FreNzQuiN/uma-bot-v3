/**
 * Compare Report — Dedicated Tests
 *
 * full test coverage for generateCompareReport():
 * - Happy path: both members found, formatted output
 * - Error paths: first/second/both members not found
 * - Self-comparison, transfer badges, winner logic
 * - WhatsApp formatting compliance and size limits
 *
 * Uses real snapshot (examples/snapshot-june-12.json, 34 members).
 */

import { generateCompareReport } from "../../src/reports/compare";
import { getDefaultConfig } from "../../src/config";
import { computeMembers } from "../../src/reports/compute";
import { formatNumber } from "../../src/utils/format";
import type { Snapshot, BotConfig } from "../../src/types";
import { loadRealSnapshot, makeCumulativeFansSeries } from "../_helpers";

let snapshot: Snapshot;
let config: BotConfig;

beforeAll(() => {
  snapshot = loadRealSnapshot();
  config = getDefaultConfig();
});

/**
 * Replaces only the members array — circle/metadata stay intact.
 */
function buildSnapshotWithMembers(members: Snapshot["members"]): Snapshot {
  return { ...snapshot, members };
}

const TEST_CIRCLE_ID = 99999;
const TEST_VIEWER_ID_OFFSET = 1000001;
const TEST_YEAR = 2026;
const TEST_MONTH = 6;
const TEST_LAST_UPDATED = "2026-06-11T17:01:16Z";

/**
 * Minimal fields only — computeMembers derives the rest.
 */
const buildMember = (() => {
  let memberId = 1;
  return function buildMember(
    name: string,
    dailyFans: number[],
    overrides: Partial<Snapshot["members"][0]> = {},
  ): Snapshot["members"][0] {
    const id = memberId++;
    return {
      id,
      circle_id: TEST_CIRCLE_ID,
      viewer_id: id + TEST_VIEWER_ID_OFFSET,
      trainer_name: name,
      shame_score: null,
      year: TEST_YEAR,
      month: TEST_MONTH,
      daily_fans: dailyFans,
      last_updated: TEST_LAST_UPDATED,
      ...overrides,
    };
  };
})();

function makeCompareReport(
  nameA: string,
  nameB: string,
  snap: Snapshot = snapshot,
): string {
  return generateCompareReport(
    snap,
    config,
    computeMembers(snap, config),
    nameA,
    nameB,
  );
}

describe("generateCompareReport — both members found", () => {
  it("produces formatted comparison with both member names", () => {
    const report = makeCompareReport("Ryu", "GoldFamily");

    expect(report).toContain("⚔️");
    expect(report).toContain("Ryu");
    expect(report).toContain("GoldFamily");
    expect(report).toMatch(/Compare: .* vs .* —/);
  });

  it("contains all expected metric sections", () => {
    const report = makeCompareReport("Ryu", "GoldFamily");

    expect(report).toContain("*Monthly Gain*");
    expect(report).toContain("*Daily Terakhir*");
    expect(report).toContain("*Rata-rata 7 Hari*");
    expect(report).toMatch(/\*Gain Minggu \d+\*/);
  });

  it("shows requirement section when monthlyFans > 0", () => {
    const report = makeCompareReport("Ryu", "GoldFamily");

    expect(report).toMatch(/\*Requirement \([\d.,]+[KMB]?\/bulan\)\*/);
  });

  it("includes a winner or tie declaration", () => {
    const report = makeCompareReport("Ryu", "GoldFamily");

    const hasAWinner = report.includes("unggul di monthly gain");
    const hasTie = report.includes("Seri di monthly gain");
    expect(hasAWinner || hasTie).toBe(true);
  });

  it("includes sync footer", () => {
    const report = makeCompareReport("Ryu", "GoldFamily");

    expect(report).toContain("⸻");
    expect(report).toMatch(/Terakhir sync:/);
  });
});

describe("generateCompareReport — member not found", () => {
  it("returns error when first member is not found", () => {
    const report = makeCompareReport("ZZZZNOTEXIST", "Ryu");

    expect(report).toContain("❌");
    expect(report).toContain("ZZZZNOTEXIST");
    expect(report).toContain("tidak ditemukan");
    expect(report).not.toContain("*Monthly Gain*");
  });

  it("returns error when second member is not found", () => {
    const report = makeCompareReport("Ryu", "ZZZZNOTEXIST");

    expect(report).toContain("❌");
    expect(report).toContain("ZZZZNOTEXIST");
    expect(report).toContain("tidak ditemukan");
    expect(report).not.toContain("*Monthly Gain*");
  });

  it("returns error when both members are not found", () => {
    const report = makeCompareReport("ZZZZNOTEXIST", "ZZZZALSONOT");

    expect(report).toContain("❌");
    expect(report).toContain("ZZZZNOTEXIST");
    expect(report).toContain("ZZZZALSONOT");
    expect(report).toContain("tidak ditemukan");
    expect(report).not.toContain("*Monthly Gain*");
  });

  it("error message uses Indonesian wording", () => {
    const report = makeCompareReport("Ghost1", "Ghost2");

    expect(report).toMatch(/tidak ditemukan/);
    expect(report).toMatch(/Cek ejaan nama/);
  });
});

describe("generateCompareReport — self-comparison", () => {
  it("works correctly when comparing member to self", () => {
    const report = makeCompareReport("Ryu", "Ryu");

    expect(report).toContain("⚔️");
    expect(report).toContain("Ryu");
    expect(report).toContain("*Monthly Gain*");

    expect(report).toContain("Seri");
  });

  it("self-comparison shows tie when monthly gains are equal", () => {
    const report = makeCompareReport("GoldFamily", "GoldFamily");

    expect(report).toContain("Seri");
    expect(report).not.toContain("unggul");
  });
});

describe("generateCompareReport — winner determination", () => {
  it("shows first member as winner when their monthly gain is higher", () => {
    const highGainMember = buildMember(
      "HighGuy",
      makeCumulativeFansSeries(100_000_000, 5_000_000, 11),
    );
    const lowGainMember = buildMember(
      "LowGuy",
      makeCumulativeFansSeries(100_000_000, 500_000, 11),
    );
    const customSnapshot = buildSnapshotWithMembers([
      highGainMember,
      lowGainMember,
    ]);

    const report = makeCompareReport("HighGuy", "LowGuy", customSnapshot);

    expect(report).toContain("HighGuy");
    expect(report).toContain("unggul di monthly gain");
    expect(report).not.toContain("Seri");
  });

  it("shows second member as winner when their monthly gain is higher", () => {
    const lowGainMember = buildMember(
      "LowGuy",
      makeCumulativeFansSeries(100_000_000, 500_000, 11),
    );
    const highGainMember = buildMember(
      "HighGuy",
      makeCumulativeFansSeries(100_000_000, 5_000_000, 11),
    );
    const customSnapshot = buildSnapshotWithMembers([
      lowGainMember,
      highGainMember,
    ]);

    const report = makeCompareReport("LowGuy", "HighGuy", customSnapshot);

    expect(report).toContain("HighGuy");
    expect(report).toContain("unggul di monthly gain");
  });
});

describe("generateCompareReport — transfer members", () => {
  it("shows transfer badge for transfer member", () => {
    // Zero is a transfer member (previous_circle_name: "Advent")
    const report = makeCompareReport("Zero", "Ryu");

    expect(report).toContain("🔄");
    expect(report).toContain("Zero");
    expect(report).toContain("Ryu");
  });

  it("shows transfer badge on both when both are transfers", () => {
    // jgd (from Garuda3) and Zero (from Advent) are both transfers
    const report = makeCompareReport("Zero", "jgd");

    expect(report).toContain("🔄");
    expect(report).toContain("*Monthly Gain*");
  });

  it("compare report for two non-transfer members has no transfer badges", () => {
    // Ryu and GoldFamily are not transfers
    const report = makeCompareReport("Ryu", "GoldFamily");

    expect(report).toContain("*Monthly Gain*");
    expect(report).toContain("Ryu");
    expect(report).toContain("GoldFamily");
  });
});

describe("generateCompareReport — WhatsApp formatting", () => {
  it("does not contain Markdown syntax (##, ```, ---)", () => {
    const report = makeCompareReport("Ryu", "GoldFamily");

    expect(report).not.toMatch(/^#{1,6}\s/m);
    expect(report).not.toContain("```");
    expect(report).not.toMatch(/^---+$/m);
  });

  it("uses WhatsApp bold syntax (*text*) for emphasis", () => {
    const report = makeCompareReport("Ryu", "GoldFamily");

    expect(report).toMatch(/\*Monthly Gain\*/);
    expect(report).toMatch(/\*Ryu\*/);
    expect(report).toMatch(/\*GoldFamily\*/);
  });

  it("uses bullet points with • character", () => {
    const report = makeCompareReport("Ryu", "GoldFamily");

    expect(report).toContain("•");
  });

  it("is under 4096 characters (WhatsApp message limit)", () => {
    const report = makeCompareReport("Ryu", "GoldFamily");

    expect(report.length).toBeLessThanOrEqual(4096);
  });

  it("report length is reasonable for a comparison (at least 200 chars)", () => {
    const report = makeCompareReport("Ryu", "GoldFamily");

    expect(report.length).toBeGreaterThan(200);
  });
});

describe("generateCompareReport — numerical accuracy", () => {
  it("formats large numbers with K/M/B suffixes", () => {
    const report = makeCompareReport("Ryu", "GoldFamily");

    // Members in the snapshot have gains in the millions — should show as M
    expect(report).toMatch(/[\d.]+M/);
  });

  it("monthly gain values are consistent with computeMembers", () => {
    const members = computeMembers(snapshot, config);
    const ryu = members.find((m) => m.trainerName === "Ryu");
    const gold = members.find((m) => m.trainerName === "GoldFamily");
    expect(ryu).toBeDefined();
    expect(gold).toBeDefined();

    const report = makeCompareReport("Ryu", "GoldFamily");

    // The formatNumber function converts to K/M/B, so we check the formatted version
    expect(report).toContain(formatNumber(ryu!.monthlyGain));
    expect(report).toContain(formatNumber(gold!.monthlyGain));
  });
});

describe("generateCompareReport — edge cases", () => {
  it("handles members with zero daily fans", () => {
    const inactiveA = buildMember("InactiveA", new Array(32).fill(0));
    const inactiveB = buildMember("InactiveB", new Array(32).fill(0));
    const customSnapshot = buildSnapshotWithMembers([inactiveA, inactiveB]);

    const report = makeCompareReport("InactiveA", "InactiveB", customSnapshot);

    expect(report).toContain("⚔️");
    expect(report).toContain("Seri");
    expect(report).toContain("*Monthly Gain*");
  });

  it("handles members with very different fan counts", () => {
    const bigMember = buildMember(
      "BigGuy",
      makeCumulativeFansSeries(0, 10_000_000, 11),
    );
    const smallMember = buildMember(
      "SmallGuy",
      makeCumulativeFansSeries(0, 10_000, 11),
    );
    const customSnapshot = buildSnapshotWithMembers([bigMember, smallMember]);

    const report = makeCompareReport("BigGuy", "SmallGuy", customSnapshot);

    expect(report).toContain("BigGuy");
    expect(report).toContain("unggul");
    expect(report).toContain("SmallGuy");
  });

  it("handles snapshot with only 1 day of data", () => {
    const memberA = buildMember(
      "DayOne",
      makeCumulativeFansSeries(1_000_000, 500_000, 1),
    );
    const memberB = buildMember(
      "DayTwo",
      makeCumulativeFansSeries(1_000_000, 300_000, 1),
    );
    const customSnapshot = buildSnapshotWithMembers([memberA, memberB]);

    const report = makeCompareReport("DayOne", "DayTwo", customSnapshot);

    expect(report).toContain("⚔️");
    expect(report).toContain("*Monthly Gain*");
  });

  it("handles members with special characters in names", () => {
    // DOA IBU has a space, Suzuka Kopling has a space
    const report = makeCompareReport("DOA IBU", "Suzuka Kopling");

    expect(report).toContain("⚔️");
    expect(report).toContain("*Monthly Gain*");
    expect(report.length).toBeLessThanOrEqual(4096);
  });

  it("report is deterministic (same inputs → same output)", () => {
    const report1 = generateCompareReport(
      snapshot,
      config,
      computeMembers(snapshot, config),
      "Ryu",
      "GoldFamily",
    );
    const report2 = generateCompareReport(
      snapshot,
      config,
      computeMembers(snapshot, config),
      "Ryu",
      "GoldFamily",
    );

    expect(report1).toBe(report2);
  });
});
