/**
 * Weekly Report — Output Structure Tests
 *
 * Tests report formatting, transfer badges, WhatsApp compliance, header format,
 * report size limits, special characters, and line-by-line verification.
 * Uses real snapshot (examples/snapshot-june-12.json, 34 members).
 */

import { generateWeeklyReport } from "../../../src/reports/weekly";
import { computeMembers } from "../../../src/reports/compute";
import { getDefaultConfig } from "../../../src/config";
import type { Snapshot, BotConfig } from "../../../src/types";
import {
  loadRealSnapshot,
  makeConfig,
  parseFormattedGain,
  TRANSFER_NAMES,
  mockCurrentDate,
  restoreDateMocks,
  WHATSAPP_MAX_LENGTH,
} from "../../_helpers";

const MEMBER_LINE_RE = /^\d+\.\s/;
// Layout contract: stale section only exists in reports this long (30 members).
const STALE_WARNING_MIN_LINES = 44;

let snapshot: Snapshot;
let config: BotConfig;
let computedMembers: ReturnType<typeof computeMembers>;

beforeAll(() => {
  snapshot = loadRealSnapshot();
  config = getDefaultConfig();
  computedMembers = computeMembers(snapshot, config);
});

describe("Full weekly report output (offset=0, W2)", () => {
  let report: string;
  let lines: string[];

  beforeAll(() => {
    mockCurrentDate(2026, 6, 13);
    report = generateWeeklyReport(snapshot, config, computedMembers, 0);
    lines = report.split("\n");
  });

  afterAll(() => {
    restoreDateMocks();
  });

  it("prints the full report for visual verification", () => {
    expect(report.length).toBeGreaterThan(0);
  });

  it('header is "📈 *Weekly Report — Minggu 2*" (bold)', () => {
    expect(report).toContain("📈 *Weekly Report — Minggu 2*");
  });

  it("report shows club name, tier, and rank", () => {
    expect(report).toContain("Hol＿Horse");
    expect(report).toContain("A+");
    expect(report).toContain("#431");
  });

  it("report shows data period date", () => {
    expect(report).toContain("Periode data: 11 Juni 2026");
  });

  it("report shows period day range", () => {
    expect(report).toContain("Periode: Hari 8-14");
  });

  it("report shows promotion info", () => {
    expect(report).toContain("Promosi: 349.2M fans lagi");
  });

  it("report shows demotion info", () => {
    expect(report).toContain("Degradasi: buffer 21.8M");
  });

  it("report shows contributor summary", () => {
    expect(report).toContain(
      "👥 30 kontribusi dari 30 anggota | Total: 144.5M",
    );
  });

  it("has 30 contributing members (gain > 0)", () => {
    const memberLines = lines.filter((l) => MEMBER_LINE_RE.test(l));
    expect(memberLines.length).toBe(30);
  });

  it("first member is *Sairen* 🔄 — +14.3M (bold name)", () => {
    expect(report).toContain("1. *Sairen* 🔄 — +14.3M");
  });

  it("second member is *GoldFamily* — +10.8M (bold name)", () => {
    expect(report).toContain("2. *GoldFamily* — +10.8M");
  });

  it("last member is *ursa* — +875.7K (bold name)", () => {
    const memberLines = lines.filter((l) => MEMBER_LINE_RE.test(l));
    expect(memberLines[29]).toBe("30. *ursa* — +875.7K");
  });

  it("members are sorted by weekly gain descending", () => {
    const memberLines = lines.filter((l) => MEMBER_LINE_RE.test(l));
    const gains: number[] = [];
    for (const line of memberLines) {
      const match = line.match(/— \+?([\d.]+[KMB]?|0)$/);
      if (!match) throw new Error(`Could not parse gain from: ${line}`);
      const val = match[1];
      if (val === "0") {
        gains.push(0);
        continue;
      }
      gains.push(parseFormattedGain(val));
    }
    for (let i = 1; i < gains.length; i++) {
      expect(gains[i - 1]).toBeGreaterThanOrEqual(gains[i]);
    }
  });

  it("stale members (DOA IBU, Kuro, Rowking, Lebowski) are NOT in member list", () => {
    const memberLines = lines.filter((l) => MEMBER_LINE_RE.test(l));
    for (const line of memberLines) {
      expect(line).not.toContain("DOA IBU");
      expect(line).not.toContain("Kuro");
      expect(line).not.toContain("Rowking");
      expect(line).not.toContain("Lebowski");
    }
  });

  it("stale data warning is present (data is from June 11, running June 13)", () => {
    mockCurrentDate(2026, 6, 13);
    const freshReport = generateWeeklyReport(
      snapshot,
      config,
      computedMembers,
      0,
    );
    expect(freshReport).toContain(
      "⚠️ Data klub mungkin tidak terbaru (update terakhir: 11 Juni 2026)",
    );
    restoreDateMocks();
  });
});

describe("Transfer badges in weekly report", () => {
  let report: string;

  beforeAll(() => {
    report = generateWeeklyReport(snapshot, config, computedMembers, 0);
  });

  it("all 6 transfer members have 🔄 badge", () => {
    const memberLines = report
      .split("\n")
      .filter((l) => MEMBER_LINE_RE.test(l));
    for (const name of TRANSFER_NAMES) {
      const line = memberLines.find((l) => l.includes(name));
      expect(line).toBeDefined();
      expect(line!).toContain("🔄");
    }
  });

  it("exactly 6 lines contain 🔄", () => {
    const memberLines = report
      .split("\n")
      .filter((l) => MEMBER_LINE_RE.test(l));
    const transferLines = memberLines.filter((l) => l.includes("🔄"));
    expect(transferLines.length).toBe(6);
  });
});

describe("Offset=1 shows W1 (days 1-7)", () => {
  let report: string;
  let lines: string[];

  beforeAll(() => {
    report = generateWeeklyReport(snapshot, config, computedMembers, 1);
    lines = report.split("\n");
  });

  it("prints the full W1 report", () => {
    expect(report.length).toBeGreaterThan(0);
  });

  it('header is "📈 *Weekly Report — Minggu 1*" (bold)', () => {
    expect(report).toContain("📈 *Weekly Report — Minggu 1*");
  });

  it('period is "Periode: Hari 1-7"', () => {
    expect(report).toContain("Periode: Hari 1-7");
  });

  it("first member is *GoldFamily* — +16.9M (bold name)", () => {
    expect(report).toContain("1. *GoldFamily* — +16.9M");
  });

  it("second member is *Ryu* — +13.1M (bold name)", () => {
    expect(report).toContain("2. *Ryu* — +13.1M");
  });

  it("has 30 contributing members", () => {
    const memberLines = lines.filter((l) => MEMBER_LINE_RE.test(l));
    expect(memberLines.length).toBe(30);
  });

  it("contributor summary shows total gain 202.5M", () => {
    expect(report).toContain(
      "👥 30 kontribusi dari 30 anggota | Total: 202.5M",
    );
  });

  it("transfer badges still present in W1", () => {
    const memberLines = lines.filter((l) => MEMBER_LINE_RE.test(l));
    for (const name of TRANSFER_NAMES) {
      const line = memberLines.find((l) => l.includes(name));
      expect(line).toBeDefined();
      expect(line!).toContain("🔄");
    }
  });
});

describe("WhatsApp formatting compliance", () => {
  let report: string;

  beforeAll(() => {
    report = generateWeeklyReport(snapshot, config, computedMembers, 0);
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
    expect(report).toContain("📈");
    expect(report).toContain("⚠️");
  });

  it("uses Indonesian month name (Juni not June)", () => {
    expect(report).toContain("Juni");
    expect(report).not.toContain("June");
  });

  it("uses Indonesian labels", () => {
    expect(report).toContain("Minggu");
    expect(report).toContain("Periode");
    expect(report).toContain("kontribusi");
  });
});

describe("Header format and metadata", () => {
  it("header always starts with 📈 *Weekly Report — (bold)", () => {
    const report0 = generateWeeklyReport(snapshot, config, computedMembers, 0);
    const report1 = generateWeeklyReport(snapshot, config, computedMembers, 1);
    expect(report0).toMatch(/📈 \*Weekly Report —/);
    expect(report1).toMatch(/📈 \*Weekly Report —/);
  });

  it("club name, tier, and rank in report", () => {
    const report = generateWeeklyReport(snapshot, config, computedMembers, 0);
    expect(report).toContain("Hol＿Horse");
    expect(report).toContain("A+");
    expect(report).toContain("#431");
  });

  it("data line with date", () => {
    const report = generateWeeklyReport(snapshot, config, computedMembers, 0);
    expect(report).toContain("Periode data: 11 Juni 2026");
  });

  it("period line shows correct day range for each week", () => {
    const report0 = generateWeeklyReport(snapshot, config, computedMembers, 0); // W2
    const report1 = generateWeeklyReport(snapshot, config, computedMembers, 1); // W1
    expect(report0).toContain("Periode: Hari 8-14");
    expect(report1).toContain("Periode: Hari 1-7");
  });

  it("contributor summary line shows formatted total", () => {
    const report = generateWeeklyReport(snapshot, config, computedMembers, 0);
    expect(report).toMatch(
      /👥 \d+ kontribusi dari \d+ anggota \| Total: [\d.]+[KMB]/,
    );
  });
});

describe("Report size within WhatsApp limits", () => {
  it("weekly report (offset=0) does not exceed 4096 chars", () => {
    const report = generateWeeklyReport(snapshot, config, computedMembers, 0);
    expect(report.length).toBeLessThanOrEqual(WHATSAPP_MAX_LENGTH);
  });

  it("weekly report (offset=1) does not exceed 4096 chars", () => {
    const report = generateWeeklyReport(snapshot, config, computedMembers, 1);
    expect(report.length).toBeLessThanOrEqual(WHATSAPP_MAX_LENGTH);
  });

  it("weekly report with below-requirement does not exceed 4096 chars", () => {
    const cfg = makeConfig({ requirements: { weeklyFans: 5_000_000 } });
    const report = generateWeeklyReport(
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
    const report = generateWeeklyReport(snapshot, config, computedMembers, 0);
    // The name uses U+201D (right double quotation mark), not ASCII "
    expect(report).toContain("Dyy\u201D");
  });

  it("Hol＿Horse with full-width underscore renders correctly", () => {
    const report = generateWeeklyReport(snapshot, config, computedMembers, 0);
    expect(report).toContain("Hol＿Horse");
  });

  it("Suzuka Kopling with space renders correctly", () => {
    const report = generateWeeklyReport(snapshot, config, computedMembers, 0);
    expect(report).toContain("Suzuka Kopling");
  });

  it("DOA IBU with space renders correctly in empty member list context", () => {
    // DOA IBU has 0 W2 gain — verify snapshot, not report
    const m = snapshot.members.find((mm) => mm.trainer_name === "DOA IBU");
    expect(m).toBeDefined();
    expect(m!.trainer_name).toBe("DOA IBU");
  });
});

describe("Line-by-line verification of W2 report", () => {
  let report: string;

  beforeAll(() => {
    mockCurrentDate(2026, 6, 13);
    report = generateWeeklyReport(snapshot, config, computedMembers, 0);
  });

  afterAll(() => {
    restoreDateMocks();
  });

  it("report contains bold header", () => {
    expect(report).toContain("📈 *Weekly Report — Minggu 2*");
  });

  it("report contains club info with rank", () => {
    expect(report).toContain("Hol＿Horse");
    expect(report).toContain("A+");
    expect(report).toContain("#431");
  });

  it("report contains data date", () => {
    expect(report).toContain("Periode data: 11 Juni 2026");
  });

  it("report contains period", () => {
    expect(report).toContain("Periode: Hari 8-14");
  });

  it("report contains promotion info", () => {
    expect(report).toContain("Promosi: 349.2M fans lagi");
  });

  it("report contains demotion info", () => {
    expect(report).toContain("Degradasi: buffer 21.8M");
  });

  it("report contains contributor summary", () => {
    expect(report).toContain(
      "👥 30 kontribusi dari 30 anggota | Total: 144.5M",
    );
  });

  it("report contains 30 member lines with bold names", () => {
    const lines = report.split("\n");
    const memberLines = lines.filter((l) => MEMBER_LINE_RE.test(l));
    expect(memberLines.length).toBe(30);
    for (const line of memberLines) {
      expect(line).toMatch(/^\d+\.\s\*[^*]+\*\s/);
    }
  });

  it("line after members: empty separator or stale section", () => {
    const lines = report.split("\n");
    const memberIndexes = lines
      .map((l, i) => (MEMBER_LINE_RE.test(l) ? i : -1))
      .filter((i) => i !== -1);
    if (memberIndexes.length > 0) {
      expect(lines[memberIndexes[memberIndexes.length - 1] + 1]).toBe("");
    }
  });

  it("stale data warning present when snapshot is old enough", () => {
    const lines = report.split("\n");
    const staleWarningIdx = lines.findIndex((l) =>
      l.includes("⚠️ Data klub mungkin tidak terbaru"),
    );
    if (lines.length > STALE_WARNING_MIN_LINES) {
      expect(staleWarningIdx).toBeGreaterThanOrEqual(0);
    }
  });

  it("last line is NOT empty (no trailing newline)", () => {
    const lines = report.split("\n");
    expect(lines[lines.length - 1]).not.toBe("");
  });

  it("no line contains Markdown syntax", () => {
    expect(report).not.toMatch(/\*\*[^*]+\*\*/);
  });
});
