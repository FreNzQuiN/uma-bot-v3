/**
 * Monthly Report — Output Structure Tests
 *
 * Tests report formatting, transfer badges, member counts, projection,
 * requirements, WhatsApp compliance, header format, report size, and special characters.
 * Uses real snapshot (examples/snapshot-june-12.json, 34 members).
 */

import { generateMonthlyReport } from "../../../src/reports/monthly";
import { computeMembers } from "../../../src/reports/compute";
import { getDefaultConfig } from "../../../src/config";
import { getLatestDataDay, getMonthlyGain } from "../../../src/data/daily-fans";
import { getDataDayFromSnapshot } from "../../../src/data/snapshot";
import { formatNumber } from "../../../src/utils/format";
import type { Snapshot, BotConfig } from "../../../src/types";
import {
  loadRealSnapshot,
  makeConfig,
  TRANSFER_NAMES,
  STALE_NAMES,
  WHATSAPP_MAX_LENGTH,
} from "../../_helpers";

let snapshot: Snapshot;
let config: BotConfig;
let computedMembers: ReturnType<typeof computeMembers>;
let loadMonthSnapshotSpy: jest.SpyInstance;

beforeAll(() => {
  snapshot = loadRealSnapshot();
  config = getDefaultConfig();
  computedMembers = computeMembers(snapshot, config);
  loadMonthSnapshotSpy = jest
    .spyOn(require("../../../src/data/snapshot"), "loadMonthSnapshot")
    .mockReturnValue(null);
});

afterAll(() => {
  loadMonthSnapshotSpy.mockRestore();
});

/**
 * Build the expected gains for all members from raw snapshot data.
 * Returns sorted by monthlyGain descending (only gain > 0).
 */
function buildExpectedGains(): {
  name: string;
  gain: number;
  isTransfer: boolean;
}[] {
  const gains: { name: string; gain: number; isTransfer: boolean }[] = [];
  for (const member of snapshot.members) {
    const gain = getMonthlyGain(member.daily_fans);
    if (gain > 0) {
      gains.push({
        name: member.trainer_name,
        gain,
        isTransfer: !!(
          member.previous_circle_id || member.previous_circle_name
        ),
      });
    }
  }
  gains.sort((a, b) => b.gain - a.gain);
  return gains;
}

describe("Full monthly report output (offset=0)", () => {
  let report: string;
  let lines: string[];

  beforeAll(() => {
    report = generateMonthlyReport(snapshot, config, computedMembers, 0);
    lines = report.split("\n");
  });

  it("prints the full report for visual verification", () => {
    expect(report.length).toBeGreaterThan(0);
  });

  it('header is bold with emoji: "📅 *Monthly Report — Juni 2026*"', () => {
    expect(report).toContain("📅 *Monthly Report — Juni 2026*");
  });

  it("report shows club name, tier, and rank", () => {
    expect(report).toContain("Hol＿Horse");
    expect(report).toContain("A+");
    expect(report).toContain("#431");
  });

  it("report shows data period date", () => {
    expect(report).toContain("Periode data: 11 Juni 2026");
  });

  it("report shows promotion and demotion info", () => {
    expect(report).toMatch(
      /Promosi: [\d.]+[KMB] fans lagi \| Degradasi: buffer [\d.]+[KMB]/,
    );
  });

  it("report shows summary line", () => {
    expect(report).toContain(
      "👥 30 kontribusi dari 30 anggota | Total: 347.0M",
    );
  });

  it("report shows projected month-end", () => {
    expect(report).toMatch(/Proyeksi akhir bulan: ~/);
  });

  it("has 30 contributing members (gain > 0)", () => {
    const memberLines = lines.filter((l) => /^\d+\.\s/.test(l));
    expect(memberLines.length).toBe(30);
  });

  it("first member is *GoldFamily* — +27.7M", () => {
    expect(report).toContain("1. *GoldFamily* — +27.7M");
  });

  it("second member is *RngF* — +19.2M", () => {
    expect(report).toContain("2. *RngF* — +19.2M");
  });

  it("members are sorted by monthly gain descending", () => {
    const memberLines = lines.filter((l) => /^\d+\.\s/.test(l));
    const gains: number[] = [];
    for (const line of memberLines) {
      const match = line.match(/— \+?([\d.]+[KMB]?|0)$/);
      if (!match) throw new Error(`Could not parse gain from: ${line}`);
      const val = match[1];
      if (val === "0") {
        gains.push(0);
        continue;
      }
      let num = parseFloat(val);
      if (val.endsWith("K")) num *= 1_000;
      if (val.endsWith("M")) num *= 1_000_000;
      if (val.endsWith("B")) num *= 1_000_000_000;
      gains.push(num);
    }
    for (let i = 1; i < gains.length; i++) {
      expect(gains[i - 1]).toBeGreaterThanOrEqual(gains[i]);
    }
  });

  it("stale members (DOA IBU, Kuro, Rowking, Lebowski) are NOT in member list", () => {
    const memberLines = lines.filter((l) => /^\d+\.\s/.test(l));
    for (const line of memberLines) {
      expect(line).not.toContain("DOA IBU");
      expect(line).not.toContain("Kuro");
      expect(line).not.toContain("Rowking");
      expect(line).not.toContain("Lebowski");
    }
  });
});

describe("Transfer badges in monthly report", () => {
  let report: string;

  beforeAll(() => {
    report = generateMonthlyReport(snapshot, config, computedMembers, 0);
  });

  it("all 6 transfer members have 🔄 badge", () => {
    const memberLines = report.split("\n").filter((l) => /^\d+\.\s/.test(l));
    for (const name of TRANSFER_NAMES) {
      const line = memberLines.find((l) => l.includes(name));
      expect(line).toBeDefined();
      expect(line!).toContain("🔄");
    }
  });

  it("exactly 6 lines contain 🔄", () => {
    const memberLines = report.split("\n").filter((l) => /^\d+\.\s/.test(l));
    const transferLines = memberLines.filter((l) => l.includes("🔄"));
    expect(transferLines.length).toBe(6);
  });
});

describe("Member counts", () => {
  it("summary shows contributor count and total", () => {
    const report = generateMonthlyReport(snapshot, config, computedMembers, 0);
    expect(report).toContain(
      "👥 30 kontribusi dari 30 anggota | Total: 347.0M",
    );
  });

  it("transfer count is reflected in badge count", () => {
    const report = generateMonthlyReport(snapshot, config, computedMembers, 0);
    const memberLines = report.split("\n").filter((l) => /^\d+\.\s/.test(l));
    const transferLines = memberLines.filter((l) => l.includes("🔄"));
    expect(transferLines.length).toBe(6);
  });

  it("stale members have latestPositiveDay <= dataDay - staleAfterDays (7)", () => {
    // dataDay = 11, staleAfterDays = 7, so stale if latestPositiveDay <= 4
    const staleNames = [...STALE_NAMES];
    for (const name of staleNames) {
      const m = snapshot.members.find((mm) => mm.trainer_name === name)!;
      const latest = getLatestDataDay(m.daily_fans);
      expect(latest).toBeLessThanOrEqual(4);
    }
  });
});

describe("Projected month-end calculation", () => {
  it("projection = (totalGain / 11) * 30 rounded", () => {
    const report = generateMonthlyReport(snapshot, config, computedMembers, 0);
    const expectedGains = buildExpectedGains();
    let totalGain = 0;
    for (const g of expectedGains) totalGain += g.gain;
    const daysElapsed = 11;
    const daysInMonth = 30; // June has 30 days
    const projected = Math.round((totalGain / daysElapsed) * daysInMonth);
    const projectedStr = formatNumber(projected);

    expect(report).toContain(`Proyeksi akhir bulan: ~${projectedStr}`);
  });

  it("projection line uses ~ prefix", () => {
    const report = generateMonthlyReport(snapshot, config, computedMembers, 0);
    expect(report).toMatch(/Proyeksi akhir bulan: ~/);
  });
});

describe("Requirement section", () => {
  it("shows requirement line with formatted monthlyFans", () => {
    const report = generateMonthlyReport(snapshot, config, computedMembers, 0);
    expect(report).toContain("*🎯 Requirement: 20.0M/bulan*");
  });

  it('shows pass/fail counts with "kurang" (not "gagal")', () => {
    const report = generateMonthlyReport(snapshot, config, computedMembers, 0);
    expect(report).toMatch(/✅ \d+ pass \| ❌ \d+ kurang/);
  });

  it("only GoldFamily passes 20M requirement", () => {
    const report = generateMonthlyReport(snapshot, config, computedMembers, 0);
    // GoldFamily = 27.7M >= 20M, next is RngF = 19.2M < 20M
    expect(report).toContain("✅ 1 pass | ❌ 29 kurang");
  });

  it("when monthlyFans = 0, requirement section is not shown", () => {
    const cfg = makeConfig({ requirements: { monthlyFans: 0 } });
    const report = generateMonthlyReport(
      snapshot,
      cfg,
      computeMembers(snapshot, cfg),
      0,
    );
    expect(report).not.toContain("🎯 Requirement");
    expect(report).not.toContain("pass |");
  });

  it("when monthlyFans = 10M, more members pass", () => {
    const cfg = makeConfig({ requirements: { monthlyFans: 10_000_000 } });
    const report = generateMonthlyReport(
      snapshot,
      cfg,
      computeMembers(snapshot, cfg),
      0,
    );

    // 13 members ≥ 10M: GoldFamily 27.7M … Nargi 10.3M
    expect(report).toContain("✅ 13 pass | ❌ 17 kurang");
  });
});

describe("WhatsApp formatting compliance", () => {
  let report: string;

  beforeAll(() => {
    report = generateMonthlyReport(snapshot, config, computedMembers, 0);
  });

  it("has no Markdown # headers", () => {
    const lines = report.split("\n");
    for (const line of lines) {
      expect(line).not.toMatch(/^#{1,6}\s/);
    }
  });

  it("has no Markdown **bold** syntax", () => {
    expect(report).not.toMatch(/\*\*[^*]+\*\*/);
  });

  it("uses emoji for section markers", () => {
    expect(report).toContain("📅");
    expect(report).toContain("👥");
    expect(report).toContain("🎯");
    expect(report).toContain("✅");
    expect(report).toContain("❌");
  });

  it("uses Indonesian month name (Juni not June)", () => {
    expect(report).toContain("Juni");
    expect(report).not.toContain("June");
  });

  it("uses Indonesian labels", () => {
    expect(report).toContain("Proyeksi akhir bulan");
    expect(report).toContain("kontribusi");
    expect(report).toContain("kurang");
  });
});

describe("Header format and metadata", () => {
  it("header always starts with 📅 *Monthly Report —", () => {
    const report0 = generateMonthlyReport(snapshot, config, computedMembers, 0);
    const report1 = generateMonthlyReport(snapshot, config, computedMembers, 1);
    expect(report0).toMatch(/📅 \*Monthly Report —/);
    expect(report1).toMatch(/📅 \*Monthly Report —/);
  });

  it('header shows "Juni 2026" format (month+year)', () => {
    const report = generateMonthlyReport(snapshot, config, computedMembers, 0);
    expect(report).toContain("📅 *Monthly Report — Juni 2026*");
  });

  it("club name with rank in report", () => {
    const report = generateMonthlyReport(snapshot, config, computedMembers, 0);
    expect(report).toContain("Hol＿Horse");
    expect(report).toContain("A+");
    expect(report).toContain("#431");
  });

  it("data line with date", () => {
    const report = generateMonthlyReport(snapshot, config, computedMembers, 0);
    expect(report).toContain("Periode data: 11 Juni 2026");
  });

  it("summary line shows formatted total", () => {
    const report = generateMonthlyReport(snapshot, config, computedMembers, 0);
    expect(report).toMatch(/👥 \d+ kontribusi dari \d+ anggota \| Total: /);
  });

  it("header shows month+year format", () => {
    const report = generateMonthlyReport(snapshot, config, computedMembers, 0);
    expect(report).toContain("Juni 2026");
  });
});

describe("Report size within WhatsApp limits", () => {
  it("monthly report (offset=0) does not exceed 4096 chars", () => {
    const report = generateMonthlyReport(snapshot, config, computedMembers, 0);
    expect(report.length).toBeLessThanOrEqual(WHATSAPP_MAX_LENGTH);
  });

  it("monthly report (offset=1) does not exceed 4096 chars", () => {
    const report = generateMonthlyReport(snapshot, config, computedMembers, 1);
    expect(report.length).toBeLessThanOrEqual(WHATSAPP_MAX_LENGTH);
  });

  it("monthly report with 10M requirement does not exceed 4096 chars", () => {
    const cfg = makeConfig({ requirements: { monthlyFans: 10_000_000 } });
    const report = generateMonthlyReport(
      snapshot,
      cfg,
      computeMembers(snapshot, cfg),
      0,
    );
    expect(report.length).toBeLessThanOrEqual(WHATSAPP_MAX_LENGTH);
  });
});

describe("Special characters in trainer names", () => {
  it("Dyy\u201D with right double quotation mark renders correctly", () => {
    const report = generateMonthlyReport(snapshot, config, computedMembers, 0);
    // The name uses U+201D (right double quotation mark), not ASCII "
    expect(report).toContain("Dyy\u201D");
  });

  it("Hol＿Horse with full-width underscore renders correctly", () => {
    const report = generateMonthlyReport(snapshot, config, computedMembers, 0);
    expect(report).toContain("Hol＿Horse");
  });

  it("Suzuka Kopling with space renders correctly", () => {
    const report = generateMonthlyReport(snapshot, config, computedMembers, 0);
    expect(report).toContain("Suzuka Kopling");
  });

  it("DOA IBU with space renders correctly in snapshot data", () => {
    const m = snapshot.members.find((mm) => mm.trainer_name === "DOA IBU");
    expect(m).toBeDefined();
    expect(m!.trainer_name).toBe("DOA IBU");
  });
});
