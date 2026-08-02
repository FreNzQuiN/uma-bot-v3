/**
 * /ranks Report - full Tests
 *
 * Tests the ranks (monthly leaderboard) report.
 * Uses real snapshot (examples/snapshot-june-12.json, 34 members).
 */

import { generateRanksReport } from "../../src/reports/ranks";
import { getDataDayFromSnapshot } from "../../src/data/snapshot";
import {
  getLatestDataDay,
  getFirstPositiveDay,
  getMonthlyGain,
  isTransferMember,
  isStaleForReport,
} from "../../src/data/daily-fans";
import { computeMembers } from "../../src/reports/compute";
import { formatNumber } from "../../src/utils/format";
import { CLUB_TIERS } from "../../src/types";
import { getDefaultConfig } from "../../src/config";
import type { Snapshot } from "../../src/types";
import { loadRealSnapshot, STALE_NAMES } from "../_helpers";

let snapshot: Snapshot;
const config = getDefaultConfig();

// jgd is stale at report threshold 3 but has non-zero gain, so it is not in STALE_NAMES.
const STALE_NAMES_AT_REPORT_THRESHOLD = [...STALE_NAMES, "jgd"];

beforeAll(() => {
  snapshot = loadRealSnapshot();
});

function parseFormattedGain(formatted: string): number {
  const numStr = formatted.replace(/[KMB]/g, "");
  let num = parseFloat(numStr);
  if (formatted.endsWith("K")) num *= 1_000;
  if (formatted.endsWith("M")) num *= 1_000_000;
  if (formatted.endsWith("B")) num *= 1_000_000_000;
  return num;
}

describe("Snapshot data fundamentals", () => {
  it("has correct club metadata", () => {
    expect(snapshot.circle.name).toBe("Hol＿Horse");
    expect(snapshot.club_rank).toBe(8);
    expect(CLUB_TIERS[8]).toBe("A+");
  });
});

describe("Member classification for ranks", () => {
  it("identifies 4 stale non-transfer members (excluded from ranks)", () => {
    const latestDataDay = getDataDayFromSnapshot(snapshot);
    const staleNames: string[] = [];
    for (const member of snapshot.members) {
      const day = getLatestDataDay(member.daily_fans);
      if (
        !isTransferMember(member) &&
        isStaleForReport(member.daily_fans, latestDataDay, 3)
      ) {
        staleNames.push(member.trainer_name);
      }
    }
    expect(staleNames.sort()).toEqual(
      [...STALE_NAMES_AT_REPORT_THRESHOLD].sort(),
    );
  });

  it("identifies 6 transfer members", () => {
    const names = snapshot.members
      .filter((m) => isTransferMember(m))
      .map((m) => m.trainer_name)
      .sort();
    expect(names).toEqual([
      "Ceciria",
      "Falkrum",
      "Sairen",
      "TheTengOne",
      "VitoHoow",
      "Zero",
    ]);
  });

  it("active(23) + transfer(6) + stale(5) = 34 total", () => {
    const latestDataDay = getDataDayFromSnapshot(snapshot);
    let active = 0,
      stale = 0,
      transfer = 0;
    for (const m of snapshot.members) {
      const day = getLatestDataDay(m.daily_fans);
      if (isTransferMember(m)) {
        transfer++;
      } else if (
        day === 0 ||
        isStaleForReport(m.daily_fans, latestDataDay, 3)
      ) {
        stale++;
      } else {
        active++;
      }
    }
    expect(active).toBe(23);
    expect(transfer).toBe(6);
    expect(stale).toBe(5);
  });
});

type Top10Expectation =
  | {
      name: string;
      gain: number;
      transfer: boolean;
      first: number;
      last: number;
    }
  | {
      name: string;
      gain: number;
      transfer: boolean;
      firstDay: number;
      lastDay: number;
      firstIdx: number;
      lastIdx: number;
      first: number;
      last: number;
    };

describe("Monthly gain verification for top 10", () => {
  const expectedTop10: Top10Expectation[] = [
    {
      name: "GoldFamily",
      gain: 27709705,
      transfer: false,
      first: 290016517,
      last: 317726222,
    },
    {
      name: "RngF",
      gain: 19244182,
      transfer: false,
      first: 306729695,
      last: 325973877,
    },
    {
      name: "Aditya",
      gain: 18554473,
      transfer: false,
      first: 326664887,
      last: 345219360,
    },
    {
      name: "DzFx",
      gain: 18163942,
      transfer: false,
      first: 351811026,
      last: 369974968,
    },
    {
      name: "Sairen",
      gain: 17882090,
      transfer: true,
      firstDay: 6,
      lastDay: 11,
      firstIdx: 5,
      lastIdx: 10,
      first: 424931301,
      last: 442813391,
    },
    {
      name: "sirsokban",
      gain: 17143575,
      transfer: false,
      first: 334518178,
      last: 351661753,
    },
    {
      name: "Luck99",
      gain: 16844551,
      transfer: false,
      first: 260345667,
      last: 277190218,
    },
    {
      name: "Anshu",
      gain: 16053087,
      transfer: false,
      first: 162481826,
      last: 178534913,
    },
    {
      name: "Ryu",
      gain: 15351042,
      transfer: false,
      first: 316856492,
      last: 332207534,
    },
    {
      name: "Seterako",
      gain: 15290296,
      transfer: false,
      first: 336718420,
      last: 352008716,
    },
  ];

  for (const expected of expectedTop10) {
    it(`${expected.name}: gain = ${expected.gain.toLocaleString()}`, () => {
      const m = snapshot.members.find(
        (mm) => mm.trainer_name === expected.name,
      )!;
      expect(m).toBeDefined();
      expect(isTransferMember(m)).toBe(expected.transfer);
      expect(getMonthlyGain(m.daily_fans)).toBe(expected.gain);

      if ("firstIdx" in expected) {
        expect(m.daily_fans[expected.firstIdx]).toBe(expected.first);
        expect(m.daily_fans[expected.lastIdx]).toBe(expected.last);
        expect(getFirstPositiveDay(m.daily_fans)).toBe(expected.firstDay);
        expect(getLatestDataDay(m.daily_fans)).toBe(expected.lastDay);
      } else {
        expect(m.daily_fans[0]).toBe(expected.first);
        expect(m.daily_fans[10]).toBe(expected.last);
      }
    });
  }

  it("11th place (Zero transfer): gain = 14,120,863 (not in top 10)", () => {
    const m = snapshot.members.find((mm) => mm.trainer_name === "Zero")!;
    expect(isTransferMember(m)).toBe(true);
    expect(getFirstPositiveDay(m.daily_fans)).toBe(4);
    expect(m.daily_fans[3]).toBe(301413137);
    expect(m.daily_fans[10]).toBe(315534000);
    expect(getMonthlyGain(m.daily_fans)).toBe(14120863);
  });

  it("stale members have 0 monthly gain", () => {
    for (const name of STALE_NAMES) {
      const m = snapshot.members.find((mm) => mm.trainer_name === name)!;
      expect(getMonthlyGain(m.daily_fans)).toBe(0);
    }
  });
});

describe("Report header structure", () => {
  let report: string;
  let lines: string[];

  beforeAll(() => {
    report = generateRanksReport(
      snapshot,
      config,
      computeMembers(snapshot, config),
    );
    lines = report.split("\n");
  });

  it("produces a non-empty report (smoke test)", () => {
    expect(report.length).toBeGreaterThan(0);
  });

  it("line 0: Peringkat Bulanan header (bold)", () => {
    expect(lines[0]).toBe("🏆 *Peringkat Bulanan*");
  });

  it("line 1: blank", () => {
    expect(lines[1]).toBe("");
  });

  it("line 2: club name + tier + rank", () => {
    expect(lines[2]).toBe("Hol＿Horse | A+ (#431)");
  });

  it("line 3: data line", () => {
    expect(lines[3]).toBe("Periode data: 11 Juni 2026, 22:00 WIB");
  });

  it("line 4: blank", () => {
    expect(lines[4]).toBe("");
  });

  it("has exactly 10 member lines (5 header + 10 members + 3 footer = 18 total)", () => {
    const memberLines = lines.filter((l) => /^🥇|^🥈|^🥉|^\d+\.\s/.test(l));
    expect(memberLines.length).toBe(10);
    expect(lines.length).toBe(18);
  });
});

describe("Medal positions (top 3)", () => {
  let lines: string[];

  beforeAll(() => {
    lines = generateRanksReport(
      snapshot,
      config,
      computeMembers(snapshot, config),
    ).split("\n");
  });

  it("line 5: medal GoldFamily - 27.7M (bold name, +prefix)", () => {
    expect(lines[5]).toBe("🥇 *GoldFamily* — +27.7M");
    expect(formatNumber(27709705)).toBe("27.7M");
  });

  it("line 6: medal RngF - 19.2M", () => {
    expect(lines[6]).toBe("🥈 *RngF* — +19.2M");
    expect(formatNumber(19244182)).toBe("19.2M");
  });

  it("line 7: medal Aditya - 18.6M", () => {
    expect(lines[7]).toBe("🥉 *Aditya* — +18.6M");
    expect(formatNumber(18554473)).toBe("18.6M");
  });

  it("medals have NO number prefix", () => {
    for (const idx of [5, 6, 7]) {
      expect(lines[idx]).not.toMatch(/^\d+\./);
    }
  });

  it("medals start with emoji", () => {
    expect(lines[5]).toMatch(/^🥇/);
    expect(lines[6]).toMatch(/^🥈/);
    expect(lines[7]).toMatch(/^🥉/);
  });
});

describe("Numbered positions (4-10)", () => {
  let lines: string[];

  beforeAll(() => {
    lines = generateRanksReport(
      snapshot,
      config,
      computeMembers(snapshot, config),
    ).split("\n");
  });

  it("4. DzFx - 18.2M", () => {
    expect(lines[8]).toBe("4. *DzFx* — +18.2M");
    expect(formatNumber(18163942)).toBe("18.2M");
  });

  it("5. Sairen (transfer) - 17.9M", () => {
    expect(lines[9]).toBe("5. *Sairen* 🔄 — +17.9M");
    const m = snapshot.members.find((mm) => mm.trainer_name === "Sairen")!;
    expect(isTransferMember(m)).toBe(true);
    expect(formatNumber(17882090)).toBe("17.9M");
  });

  it("6. sirsokban - 17.1M", () => {
    expect(lines[10]).toBe("6. *sirsokban* — +17.1M");
  });

  it("7. Luck99 - 16.8M", () => {
    expect(lines[11]).toBe("7. *Luck99* — +16.8M");
  });

  it("8. Anshu - 16.1M", () => {
    expect(lines[12]).toBe("8. *Anshu* — +16.1M");
  });

  it("9. Ryu - 15.4M", () => {
    expect(lines[13]).toBe("9. *Ryu* — +15.4M");
  });

  it("10. Seterako - 15.3M", () => {
    expect(lines[14]).toBe("10. *Seterako* — +15.3M");
  });

  it("all numbered lines start with digit + dot + space", () => {
    for (let i = 8; i <= 14; i++) {
      expect(lines[i]).toMatch(/^\d+\.\s/);
    }
  });
});

describe("Sorting order (monthlyGain descending)", () => {
  it("gains are strictly non-increasing from top to bottom", () => {
    const lines = generateRanksReport(
      snapshot,
      config,
      computeMembers(snapshot, config),
    ).split("\n");
    const memberLines = lines.filter((l) => /^🥇|^🥈|^🥉|^\d+\.\s/.test(l));

    const gains: number[] = [];
    for (const line of memberLines) {
      const match = line.match(/— \+?([\d.]+[KMB]?)$/);
      expect(match).not.toBeNull();
      gains.push(parseFormattedGain(match![1]));
    }

    for (let i = 1; i < gains.length; i++) {
      expect(gains[i - 1]).toBeGreaterThanOrEqual(gains[i]);
    }

    // Specifically check top 3 are strictly decreasing (medal positions)
    expect(gains[0]).toBeGreaterThan(gains[1]);
    expect(gains[1]).toBeGreaterThan(gains[2]);
  });
});

describe("Transfer badge", () => {
  it("Sairen has badge in report", () => {
    const lines = generateRanksReport(
      snapshot,
      config,
      computeMembers(snapshot, config),
    ).split("\n");
    const sairenLine = lines.find((l) => l.includes("Sairen"));
    expect(sairenLine).toBeDefined();
    expect(sairenLine).toContain("🔄");
  });

  it("only Sairen and Zero from transfer members are in top 10", () => {
    const lines = generateRanksReport(
      snapshot,
      config,
      computeMembers(snapshot, config),
    ).split("\n");
    const memberLines = lines.filter((l) => /^🥇|^🥈|^🥉|^\d+\.\s/.test(l));

    // Transfer members in top 10: Sairen (rank 5), Zero is rank 11 (excluded)
    const transferInReport = memberLines.filter((l) => l.includes("🔄"));
    expect(transferInReport.length).toBe(1);
    expect(transferInReport[0]).toContain("Sairen");
  });

  it("Zero (rank 11) is NOT in report since report shows top 10 only", () => {
    const lines = generateRanksReport(
      snapshot,
      config,
      computeMembers(snapshot, config),
    ).split("\n");
    const memberLines = lines.filter((l) => /^🥇|^🥈|^🥉|^\d+\.\s/.test(l));
    const zeroLine = memberLines.find((l) => l.includes("Zero"));
    expect(zeroLine).toBeUndefined();
  });
});

describe("Stale members excluded from report", () => {
  it("no stale member appears in report", () => {
    const report = generateRanksReport(
      snapshot,
      config,
      computeMembers(snapshot, config),
    );
    const staleNames = [...STALE_NAMES];
    for (const name of staleNames) {
      expect(report).not.toContain(name);
    }
  });
});

describe("Empty snapshot", () => {
  it("returns warning when members array is empty", () => {
    const emptySnapshot: Snapshot = {
      circle: snapshot.circle,
      members: [],
      club_rank: 8,
      fans_to_next_tier: 349208495,
      fans_to_lower_tier: 21848493,
      yesterday_fans_to_next_tier: 305715171,
      yesterday_fans_to_lower_tier: 20621702,
    };
    const result = generateRanksReport(
      emptySnapshot,
      config,
      computeMembers(emptySnapshot, config),
    );
    expect(result).toBe("ℹ️ *Peringkat*\nData peringkat belum tersedia.");
  });
});

describe("WhatsApp formatting compliance", () => {
  it("no Markdown bold (**...**)", () => {
    const report = generateRanksReport(
      snapshot,
      config,
      computeMembers(snapshot, config),
    );
    expect(report).not.toMatch(/\*\*[^*]+\*\*/);
  });

  it("no Markdown headers (#)", () => {
    const report = generateRanksReport(
      snapshot,
      config,
      computeMembers(snapshot, config),
    );
    const lines = report.split("\n");
    for (const line of lines) {
      expect(line).not.toMatch(/^#{1,6}\s/);
    }
  });

  it("uses em-dash not hyphen for separator", () => {
    const report = generateRanksReport(
      snapshot,
      config,
      computeMembers(snapshot, config),
    );
    const memberLines = report
      .split("\n")
      .filter((l) => /^🥇|^🥈|^🥉|^\d+\.\s/.test(l));
    for (const line of memberLines) {
      expect(line).toContain(" — ");
    }
  });
});

describe("Complete line-by-line verification against raw data", () => {
  it("every report line matches expected raw data calculation", () => {
    const report = generateRanksReport(
      snapshot,
      config,
      computeMembers(snapshot, config),
    );
    const lines = report.split("\n");

    const latestDataDay = getDataDayFromSnapshot(snapshot);
    const candidates: { name: string; gain: number; isTransfer: boolean }[] =
      [];
    for (const m of snapshot.members) {
      const day = getLatestDataDay(m.daily_fans);
      const isT = isTransferMember(m);
      const stale = !isT && isStaleForReport(m.daily_fans, latestDataDay, 3);
      if (!stale) {
        candidates.push({
          name: m.trainer_name,
          gain: getMonthlyGain(m.daily_fans),
          isTransfer: isT,
        });
      }
    }
    candidates.sort((a, b) => b.gain - a.gain);
    const top10 = candidates.slice(0, 10);

    expect(lines[0]).toBe("🏆 *Peringkat Bulanan*");
    expect(lines[1]).toBe("");
    expect(lines[2]).toBe("Hol＿Horse | A+ (#431)");
    expect(lines[3]).toBe("Periode data: 11 Juni 2026, 22:00 WIB");
    expect(lines[4]).toBe("");

    // Member lines sit at indices 5-14, after the 5 header lines.
    for (let i = 0; i < top10.length; i++) {
      const member = top10[i];
      const gainStr = formatNumber(member.gain);
      const transferBadge = member.isTransfer ? " 🔄" : "";

      if (i < 3) {
        const medals = ["🥇", "🥈", "🥉"];
        expect(lines[5 + i]).toBe(
          `${medals[i]} *${member.name}*${transferBadge} — +${gainStr}`,
        );
      } else {
        expect(lines[5 + i]).toBe(
          `${i + 1}. *${member.name}*${transferBadge} — +${gainStr}`,
        );
      }
    }

    expect(lines.length).toBe(18);
  });
});

describe("formatNumber for ranks display", () => {
  it("formats gains in millions correctly", () => {
    expect(formatNumber(27709705)).toBe("27.7M");
    expect(formatNumber(19244182)).toBe("19.2M");
    expect(formatNumber(18554473)).toBe("18.6M");
  });

  it("formats gains in thousands correctly", () => {
    expect(formatNumber(9839713)).toBe("9.8M");
    expect(formatNumber(500000)).toBe("500.0K");
    expect(formatNumber(1234)).toBe("1.2K");
  });

  it("formats zero correctly", () => {
    expect(formatNumber(0)).toBe("0");
  });
});
