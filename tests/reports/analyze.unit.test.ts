/**
 * Analyze Report — Dedicated Tests
 *
 * full test coverage for generateAnalyzeReport():
 * - Happy path: valid member found, full analysis output
 * - Error path: member not found
 * - Transfer members, trend detection, projection math
 * - WhatsApp formatting compliance and size limits
 * - Edge cases: zero fans, special names, consistency
 *
 * Uses real snapshot (examples/snapshot-june-12.json, 34 members).
 */

import { generateAnalyzeReport } from "../../src/reports/analyze";
import { getDefaultConfig } from "../../src/config";
import { computeMembers } from "../../src/reports/compute";
import { getDataDayFromSnapshot } from "../../src/data/snapshot";
import { countActiveDays } from "../../src/data/daily-fans";
import { formatNumber } from "../../src/utils/format";
import type { Snapshot, BotConfig } from "../../src/types";
import {
  loadRealSnapshot,
  WHATSAPP_MAX_LENGTH,
  makeCumulativeFansSeries,
} from "../_helpers";

const MIN_ANALYSIS_LENGTH = 300;
const TEST_CIRCLE_ID = 99999;
const VIEWER_ID_OFFSET = 1_000_000;

let snapshot: Snapshot;
let config: BotConfig;

beforeAll(() => {
  snapshot = loadRealSnapshot();
  config = getDefaultConfig();
});

function buildSnapshotWithMembers(members: Snapshot["members"]): Snapshot {
  return { ...snapshot, members };
}

let memberIdCounter = 1;
function buildMember(
  name: string,
  dailyFans: number[],
  overrides: Partial<Snapshot["members"][0]> = {},
): Snapshot["members"][0] {
  return {
    id: memberIdCounter++,
    circle_id: TEST_CIRCLE_ID,
    viewer_id: memberIdCounter + VIEWER_ID_OFFSET,
    trainer_name: name,
    shame_score: null,
    year: 2026,
    month: 6,
    daily_fans: dailyFans,
    last_updated: "2026-06-11T17:01:16Z",
    ...overrides,
  };
}

function reportFor(name: string, offset = 0): string {
  return generateAnalyzeReport(
    snapshot,
    config,
    computeMembers(snapshot, config),
    name,
    offset,
  );
}

describe("generateAnalyzeReport — valid member found", () => {
  it("produces analysis with member name in header", () => {
    const report = reportFor("Ryu");

    expect(report).toContain("🔍");
    expect(report).toContain("Ryu");
    expect(report).toMatch(/Analyze: Ryu —/);
  });

  it("contains all expected metric sections", () => {
    const report = reportFor("Ryu");

    expect(report).toContain("*Gain*");
    expect(report).toContain("*Aktivitas*");
    expect(report).toContain("*Weekly*");
    expect(report).toContain("*Proyeksi*");
  });

  it("shows gain metrics with proper labels", () => {
    const report = reportFor("Ryu");

    expect(report).toMatch(/• Monthly: [\d.,]+[KMB]?/);
    expect(report).toMatch(/• Daily terakhir: [\d.,]+[KMB]?/);
    expect(report).toMatch(/• Rata-rata 3 Hari: [\d.,]+[KMB]?/);
    expect(report).toMatch(/• Rata-rata 7 Hari: [\d.,]+[KMB]?/);
  });

  it("shows activity metrics", () => {
    const report = reportFor("Ryu");

    expect(report).toMatch(/• Hari aktif: \d+\/\d+/);
    expect(report).toMatch(/• Konsistensi: \d+%/);
    expect(report).toMatch(/• Trend: [📈📉➡️]/);
  });

  it("shows weekly breakdown", () => {
    const report = reportFor("Ryu");

    expect(report).toMatch(/• W\d+:/);
  });

  it("shows projection and requirement status", () => {
    const report = reportFor("Ryu");

    expect(report).toMatch(/• Target: [\d.,]+[KMB]?/);
    expect(report).toMatch(/• Status: (✅|❌)/);
    expect(report).toMatch(/• Proyeksi akhir bulan: ~/);
  });

  it("includes sync footer", () => {
    const report = reportFor("Ryu");

    expect(report).toContain("⸻");
    expect(report).toMatch(/Terakhir sync:/);
  });
});

describe("generateAnalyzeReport — member not found", () => {
  it("returns error message when member does not exist", () => {
    const report = reportFor("ZZZZNOTEXIST");

    expect(report).toContain("❌");
    expect(report).toContain("ZZZZNOTEXIST");
    expect(report).toContain("tidak ditemukan");
    expect(report).not.toContain("*Gain*");
    expect(report).not.toContain("*Aktivitas*");
  });

  it("error message uses Indonesian wording", () => {
    const report = reportFor("GhostPlayer");

    expect(report).toMatch(/tidak ditemukan/);
    expect(report).toMatch(/Cek ejaan nama/);
  });

  it("error message includes the queried name", () => {
    const report = reportFor("PhantomX");

    expect(report).toContain("PhantomX");
  });
});

describe("generateAnalyzeReport — transfer members", () => {
  it("shows transfer info for transfer member", () => {
    // Zero transferred from Advent
    const report = reportFor("Zero");

    expect(report).toContain("🔄");
    expect(report).toContain("Transfer dari Advent");
  });

  it("shows transfer badge in title for transfer member", () => {
    const report = reportFor("Zero");

    expect(report).toMatch(/Analyze: Zero 🔄/);
  });

  it("does not show transfer line for non-transfer member", () => {
    const report = reportFor("Ryu");

    // Ryu is not a transfer — no "Transfer dari" line
    expect(report).not.toContain("Transfer dari");
  });

  it("shows correct previous circle name for different transfers", () => {
    // TheTengOne transferred from Garuda3
    const report = reportFor("TheTengOne");

    expect(report).toContain("Transfer dari Garuda3");
  });
});

describe("generateAnalyzeReport — trend detection", () => {
  it("shows upward trend when recent days are significantly higher than 7-day avg", () => {
    // Days 1-7: small gains, Days 8-11: big gains → 3-day avg > 7-day avg * 1.1
    const fans = [
      1_000_000,
      1_100_000,
      1_200_000,
      1_300_000,
      1_400_000,
      1_500_000,
      1_600_000,
      2_000_000,
      2_500_000,
      3_000_000,
      3_500_000,
      ...new Array(21).fill(0),
    ];
    const member = buildMember("RisingStar", fans);
    const customSnapshot = buildSnapshotWithMembers([member]);

    const report = generateAnalyzeReport(
      customSnapshot,
      config,
      computeMembers(customSnapshot, config),
      "RisingStar",
    );

    expect(report).toMatch(/Trend: 📈 naik/);
  });

  it("shows downward trend when recent days are significantly lower than 7-day avg", () => {
    // Days 1-7: big gains, Days 8-11: tiny gains → 3-day avg < 7-day avg * 0.9
    const fans = [
      1_000_000,
      1_500_000,
      2_000_000,
      2_500_000,
      3_000_000,
      3_500_000,
      4_000_000,
      4_100_000,
      4_200_000,
      4_300_000,
      4_400_000,
      ...new Array(21).fill(0),
    ];
    const member = buildMember("FallingStar", fans);
    const customSnapshot = buildSnapshotWithMembers([member]);

    const report = generateAnalyzeReport(
      customSnapshot,
      config,
      computeMembers(customSnapshot, config),
      "FallingStar",
    );

    expect(report).toMatch(/Trend: 📉 turun/);
  });

  it("shows stable trend when 3-day avg is within threshold of 7-day avg", () => {
    const fans = makeCumulativeFansSeries(1_000_000, 100_000, 11);
    const member = buildMember("SteadyEddie", fans);
    const customSnapshot = buildSnapshotWithMembers([member]);

    const report = generateAnalyzeReport(
      customSnapshot,
      config,
      computeMembers(customSnapshot, config),
      "SteadyEddie",
    );

    expect(report).toMatch(/Trend: ➡️ stabil/);
  });
});

describe("generateAnalyzeReport — consistency", () => {
  it("shows 100% consistency when member was active every day", () => {
    const fans = makeCumulativeFansSeries(1_000_000, 100_000, 11);
    const member = buildMember("PerfectPlayer", fans);
    const customSnapshot = buildSnapshotWithMembers([member]);

    const report = generateAnalyzeReport(
      customSnapshot,
      config,
      computeMembers(customSnapshot, config),
      "PerfectPlayer",
    );

    expect(report).toContain("Konsistensi: 100%");
  });

  it("shows 0% consistency when member was never active", () => {
    const fans = new Array(32).fill(0);
    const member = buildMember("LazyPlayer", fans);
    const customSnapshot = buildSnapshotWithMembers([member]);

    const report = generateAnalyzeReport(
      customSnapshot,
      config,
      computeMembers(customSnapshot, config),
      "LazyPlayer",
    );

    expect(report).toContain("Konsistensi: 0%");
  });

  it("calculates partial consistency correctly", () => {
    // Helper member is active all 10 days → snapshot data day = 10; test
    // member active only days 1-5 → consistency = 5/10 = 50%.
    // countActiveDays: day 1 counts if hasValue(fans[0]), days 2+ if
    // getDailyGain > 0 (current > prev > 0).
    const testFans = [
      1_000_000,
      1_100_000,
      1_200_000,
      1_300_000,
      1_400_000,
      1_400_000,
      1_400_000,
      1_400_000,
      1_400_000,
      1_400_000,
      ...new Array(22).fill(0),
    ];
    const helperFans = makeCumulativeFansSeries(1_000_000, 100_000, 10);
    const testMember = buildMember("PartTimer", testFans);
    const helperMember = buildMember("Helper", helperFans);
    const customSnapshot = buildSnapshotWithMembers([testMember, helperMember]);

    const report = generateAnalyzeReport(
      customSnapshot,
      config,
      computeMembers(customSnapshot, config),
      "PartTimer",
    );

    expect(report).toContain("Konsistensi: 50%");
  });
});

describe("generateAnalyzeReport — requirement status", () => {
  it("shows checkmark when member meets monthly requirement", () => {
    const fans = makeCumulativeFansSeries(0, 10_000_000, 11);
    const member = buildMember("Overachiever", fans);
    const customSnapshot = buildSnapshotWithMembers([member]);

    const report = generateAnalyzeReport(
      customSnapshot,
      config,
      computeMembers(customSnapshot, config),
      "Overachiever",
    );

    expect(report).toMatch(/Status: ✅/);
  });

  it("shows X when member does not meet monthly requirement", () => {
    const fans = new Array(32).fill(0);
    const member = buildMember("UnderPerformer", fans);
    const customSnapshot = buildSnapshotWithMembers([member]);

    const report = generateAnalyzeReport(
      customSnapshot,
      config,
      computeMembers(customSnapshot, config),
      "UnderPerformer",
    );

    expect(report).toMatch(/Status: ❌/);
    expect(report).toContain("Kurang");
  });
});

describe("generateAnalyzeReport — projection", () => {
  it("projects month-end based on current pace", () => {
    const fans = makeCumulativeFansSeries(0, 1_000_000, 10);
    const member = buildMember("Pacer", fans);
    const customSnapshot = buildSnapshotWithMembers([member]);

    const report = generateAnalyzeReport(
      customSnapshot,
      config,
      computeMembers(customSnapshot, config),
      "Pacer",
    );

    expect(report).toMatch(/Proyeksi akhir bulan: ~/);
    expect(report).toContain("Target:");
  });

  it("shows zero projection when no data days", () => {
    // all zeros → no data → daysElapsed = 0 → projection = 0
    const fans = new Array(32).fill(0);
    const member = buildMember("ZeroData", fans);
    const customSnapshot = buildSnapshotWithMembers([member]);

    const report = generateAnalyzeReport(
      customSnapshot,
      config,
      computeMembers(customSnapshot, config),
      "ZeroData",
    );

    expect(report).toContain("Proyeksi akhir bulan: ~0");
  });
});

describe("generateAnalyzeReport — WhatsApp formatting", () => {
  it("does not contain Markdown syntax (##, ```, ---)", () => {
    const report = reportFor("Ryu");

    expect(report).not.toMatch(/^#{1,6}\s/m);
    expect(report).not.toContain("```");
    expect(report).not.toMatch(/^---+$/m);
  });

  it("uses WhatsApp bold syntax (*text*) for emphasis", () => {
    const report = reportFor("Ryu");

    expect(report).toMatch(/\*Gain\*/);
    expect(report).toMatch(/\*Aktivitas\*/);
    expect(report).toMatch(/\*Weekly\*/);
    expect(report).toMatch(/\*Proyeksi\*/);
  });

  it("uses bullet points with • character", () => {
    const report = reportFor("Ryu");

    expect(report).toContain("•");
  });

  it("is under 4096 characters (WhatsApp message limit)", () => {
    const report = reportFor("Ryu");

    expect(report.length).toBeLessThanOrEqual(WHATSAPP_MAX_LENGTH);
  });

  it("report length is reasonable for an analysis (at least 300 chars)", () => {
    const report = reportFor("Ryu");

    expect(report.length).toBeGreaterThan(MIN_ANALYSIS_LENGTH);
  });
});

describe("generateAnalyzeReport — numerical accuracy", () => {
  it("formats large numbers with K/M/B suffixes", () => {
    const report = reportFor("Ryu");

    // Members have gains in millions — should show as M
    expect(report).toMatch(/[\d.]+M/);
  });

  it("monthly gain value matches computeMembers output", () => {
    const members = computeMembers(snapshot, config);
    const ryu = members.find((m) => m.trainerName === "Ryu");
    expect(ryu).toBeDefined();

    const report = reportFor("Ryu");

    expect(report).toContain(formatNumber(ryu!.monthlyGain));
  });

  it("active days count is consistent with daily_fans data", () => {
    const members = computeMembers(snapshot, config);
    const ryu = members.find((m) => m.trainerName === "Ryu");
    expect(ryu).toBeDefined();

    const latestDataDay = getDataDayFromSnapshot(snapshot);
    const expectedActive = countActiveDays(
      ryu!.dailyFans,
      latestDataDay,
      config.requirements.includeTransferDataInCalculation,
    );

    const report = reportFor("Ryu");

    expect(report).toContain(`Hari aktif: ${expectedActive}/${latestDataDay}`);
  });
});

describe("generateAnalyzeReport — edge cases", () => {
  it("handles member with all-zero daily fans", () => {
    const fans = new Array(32).fill(0);
    const member = buildMember("GhostMember", fans);
    const customSnapshot = buildSnapshotWithMembers([member]);

    const report = generateAnalyzeReport(
      customSnapshot,
      config,
      computeMembers(customSnapshot, config),
      "GhostMember",
    );

    expect(report).toContain("🔍");
    expect(report).toContain("GhostMember");
    expect(report).toContain("*Gain*");
    expect(report).toContain("Konsistensi: 0%");
    expect(report).toContain("Hari aktif: 0/");
  });

  it("handles member with only 1 active day", () => {
    const fans = [
      5_000_000,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      ...new Array(21).fill(0),
    ];
    const member = buildMember("SoloPlayer", fans);
    const customSnapshot = buildSnapshotWithMembers([member]);

    const report = generateAnalyzeReport(
      customSnapshot,
      config,
      computeMembers(customSnapshot, config),
      "SoloPlayer",
    );

    expect(report).toContain("🔍");
    expect(report).toContain("Hari aktif: 1/");
    expect(report).toContain("Konsistensi:");
  });

  it("handles members with special characters in names", () => {
    // "DOA IBU" exercises the space-in-name path
    const report = reportFor("DOA IBU");

    expect(report).toContain("🔍");
    expect(report).toContain("DOA IBU");
    expect(report).toContain("*Gain*");
    expect(report.length).toBeLessThanOrEqual(WHATSAPP_MAX_LENGTH);
  });

  it("report is deterministic (same inputs → same output)", () => {
    const report1 = reportFor("Ryu");
    const report2 = reportFor("Ryu");

    expect(report1).toBe(report2);
  });

  it("handles member with unicode characters in name", () => {
    // Dyy\u201D has a Unicode right double quotation mark (U+201D)
    const report = reportFor("Dyy\u201D");

    expect(report).toContain("🔍");
    expect(report).toContain("*Gain*");
    expect(report.length).toBeLessThanOrEqual(WHATSAPP_MAX_LENGTH);
  });
});

describe("generateAnalyzeReport — weekly gains", () => {
  it("shows all 5 weeks in the weekly section", () => {
    const report = reportFor("Ryu");

    expect(report).toMatch(/W1: [\d.,]+[KMB]?/);
    expect(report).toMatch(/W2: [\d.,]+[KMB]?/);
    expect(report).toMatch(/W3: [\d.,]+[KMB]?/);
    expect(report).toMatch(/W4: [\d.,]+[KMB]?/);
    expect(report).toMatch(/W5: [\d.,]+[KMB]?/);
  });

  it("weekly gains are separated by pipe character", () => {
    const report = reportFor("Ryu");

    expect(report).toMatch(/W\d+: [\d.,]+[KMB]? \| W\d+:/);
  });
});

jest.mock("../../src/data/snapshot", () => {
  const actual = jest.requireActual("../../src/data/snapshot");
  return { ...actual, loadMonthSnapshot: jest.fn() };
});

import { loadMonthSnapshot } from "../../src/data/snapshot";

const mockLoadMonthSnapshots = loadMonthSnapshot as jest.MockedFunction<
  typeof loadMonthSnapshot
>;

describe("generateAnalyzeReport — offset support", () => {
  afterEach(() => {
    mockLoadMonthSnapshots.mockReset();
  });

  it("offset=0 produces identical output to current behavior (regression)", () => {
    const withOffset = reportFor("Ryu", 0);
    const withoutOffset = reportFor("Ryu");

    expect(withOffset).toBe(withoutOffset);
  });

  it("offset=-1 loads previous month snapshot and generates report", () => {
    const prevMember = {
      ...snapshot.members.find((m) => m.trainer_name === "Ryu")!,
      year: 2026,
      month: 5,
    };
    const prevSnapshot: Snapshot = {
      ...snapshot,
      members: [prevMember],
    };
    mockLoadMonthSnapshots.mockReturnValue(prevSnapshot);

    const report = reportFor("Ryu", -1);

    expect(report).toContain("Analyze: Ryu");
    expect(report).toContain("*Gain*");
    expect(mockLoadMonthSnapshots).toHaveBeenCalledWith(2026, 5);
  });

  it("member not found in previous month → error message", () => {
    const prevMember = {
      id: 99,
      circle_id: 99999,
      viewer_id: 999999,
      trainer_name: "OtherGuy",
      shame_score: null,
      year: 2026,
      month: 5,
      daily_fans: makeCumulativeFansSeries(0, 100_000, 10),
      last_updated: "2026-05-10",
    };
    const prevSnapshot: Snapshot = {
      ...snapshot,
      members: [prevMember],
    };
    mockLoadMonthSnapshots.mockReturnValue(prevSnapshot);

    const report = reportFor("Ryu", -1);

    expect(report).toContain("❌");
    expect(report).toContain("Ryu");
    expect(report).toContain("tidak ditemukan");
  });

  it("previous month snapshot unavailable → fallback to current data", () => {
    mockLoadMonthSnapshots.mockReturnValue(null);

    const report = reportFor("Ryu", -1);

    expect(report).toContain("Analyze: Ryu");
    expect(report).toContain("*Gain*");
  });

  it("previous month snapshot has empty members → info message", () => {
    const emptySnapshot: Snapshot = {
      ...snapshot,
      members: [],
    };
    mockLoadMonthSnapshots.mockReturnValue(emptySnapshot);

    const report = reportFor("Ryu", -1);

    expect(report).toContain("ℹ️");
    expect(report).toContain("Data belum tersedia");
    expect(report).not.toContain("Analyze");
  });
});
