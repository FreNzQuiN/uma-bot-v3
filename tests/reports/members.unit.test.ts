/**
 * Tests for members report generator.
 *
 * Covers: basic report generation, edge cases (no DB, empty members,
 * Unicode names), badge logic, sort order against real snapshot data,
 * and plain-text formatting.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { generateMembersReport } from "../../src/reports/members";
import { computeMembers } from "../../src/reports/compute";
import { formatNumber } from "../../src/utils/format";
import { getDefaultConfig } from "../../src/config";
import type { Snapshot, BotConfig, MemberData } from "../../src/types";
import { makeCumulativeFans, makeSnapshot } from "../_helpers";

const ROOT = join(__dirname, "..");

function makeTransferMember(
  overrides: Partial<MemberData> & { viewer_id: number; trainer_name: string },
): MemberData {
  return {
    id: overrides.id ?? 9000,
    circle_id: 100,
    shame_score: null,
    year: 2026,
    month: 6,
    daily_fans: makeCumulativeFans([100, 200, 300]),
    last_updated: "2026-06-12",
    previous_circle_id: 200,
    previous_circle_name: "OldClub",
    ...overrides,
  };
}

function makeStaleMember(
  overrides: Partial<MemberData> & { viewer_id: number; trainer_name: string },
): MemberData {
  return {
    id: overrides.id ?? 9100,
    circle_id: 100,
    shame_score: null,
    year: 2026,
    month: 6,
    daily_fans: makeCumulativeFans([100, 100]),
    last_updated: "2026-06-01",
    ...overrides,
  };
}

describe("generateMembersReport", () => {
  it("includes club name and tier in header", async () => {
    const snapshot = makeSnapshot();
    const config = getDefaultConfig();
    const report = await generateMembersReport(
      snapshot,
      config,
      computeMembers(snapshot, config),
    );

    expect(report).toContain("TestClub");
    expect(report).toContain("A+"); // club_rank 8 = A+
  });

  it("lists all current members", async () => {
    const snapshot = makeSnapshot();
    const config = getDefaultConfig();
    const report = await generateMembersReport(
      snapshot,
      config,
      computeMembers(snapshot, config),
    );

    expect(report).toContain("Alice");
    expect(report).toContain("Bob");
  });

  it("shows transfer badge for transfer members", async () => {
    const snapshot = makeSnapshot({
      members: [makeTransferMember({ viewer_id: 1001, trainer_name: "Alice" })],
    });
    const config = getDefaultConfig();
    const report = await generateMembersReport(
      snapshot,
      config,
      computeMembers(snapshot, config),
    );

    expect(report).toContain("🔄");
    expect(report).toContain("OldClub");
  });

  it("does not show left members section when no db provided", async () => {
    const snapshot = makeSnapshot();
    const config = getDefaultConfig();
    const report = await generateMembersReport(
      snapshot,
      config,
      computeMembers(snapshot, config),
    );

    expect(report).not.toMatch(/🚪|keluar/i);
  });

  it("returns warning for empty members array", async () => {
    const snapshot = makeSnapshot({ members: [] });
    const config = getDefaultConfig();
    const report = await generateMembersReport(
      snapshot,
      config,
      computeMembers(snapshot, config),
    );

    expect(report).toContain("Daftar Anggota");
    expect(report).toContain("Data anggota belum tersedia");
  });

  it("handles single member", async () => {
    const snapshot = makeSnapshot({
      members: [makeSnapshot().members[0]],
    });
    const config = getDefaultConfig();
    const report = await generateMembersReport(
      snapshot,
      config,
      computeMembers(snapshot, config),
    );
    const memberLines = report.split("\n").filter((l) => l.startsWith("•"));

    expect(memberLines).toHaveLength(1);
    expect(memberLines[0]).toContain("Alice");
  });

  it("handles all active members (no transfers, no stale)", async () => {
    const snapshot = makeSnapshot();
    const config = getDefaultConfig();
    const report = await generateMembersReport(
      snapshot,
      config,
      computeMembers(snapshot, config),
    );

    expect(report).not.toContain("🔄");
    expect(report).not.toContain("⚠️");
    expect(report).not.toContain("🚪");
  });

  it("uses plain text formatting (no Markdown bold or headers)", async () => {
    const snapshot = makeSnapshot();
    const config = getDefaultConfig();
    const report = await generateMembersReport(
      snapshot,
      config,
      computeMembers(snapshot, config),
    );

    expect(report).not.toMatch(/\*\*[^*]+\*\*/);
    expect(report).not.toMatch(/^#/m);
  });

  it("handles Unicode club names", async () => {
    const snapshot = makeSnapshot({
      circle: { ...makeSnapshot().circle, name: "テストクラブ" },
    });
    const config = getDefaultConfig();
    const report = await generateMembersReport(
      snapshot,
      config,
      computeMembers(snapshot, config),
    );

    expect(report).toContain("テストクラブ");
  });

  it("handles Unicode member names", async () => {
    const snapshot = makeSnapshot({
      members: [
        {
          ...makeSnapshot().members[0],
          trainer_name: "ゆうき",
          daily_fans: makeCumulativeFans([100, 200]),
          last_updated: "2026-06-12",
        },
      ],
    });
    const config = getDefaultConfig();
    const report = await generateMembersReport(
      snapshot,
      config,
      computeMembers(snapshot, config),
    );

    expect(report).toContain("ゆうき");
  });

  it('shows "0" for zero monthly gain', async () => {
    const snapshot = makeSnapshot({
      members: [
        {
          id: 1,
          circle_id: 100,
          viewer_id: 1001,
          trainer_name: "ZeroGain",
          shame_score: null,
          year: 2026,
          month: 6,
          daily_fans: makeCumulativeFans([100]),
          last_updated: "2026-06-01",
        },
      ],
    });
    const config = getDefaultConfig();
    const report = await generateMembersReport(
      snapshot,
      config,
      computeMembers(snapshot, config),
    );

    expect(report).toContain("• *ZeroGain* — 0");
  });

  describe("badge logic", () => {
    it("active member has no badge", async () => {
      const snapshot = makeSnapshot();
      const config = getDefaultConfig();
      const report = await generateMembersReport(
        snapshot,
        config,
        computeMembers(snapshot, config),
      );
      const lines = report.split("\n").filter((l) => l.startsWith("•"));

      for (const line of lines) {
        expect(line).not.toContain("🔄");
        expect(line).not.toContain("⚠️");
      }
    });

    it("transfer member has 🔄 badge and (dari X) info", async () => {
      const snapshot = makeSnapshot({
        members: [
          makeTransferMember({
            viewer_id: 1001,
            trainer_name: "T1",
            previous_circle_name: "OriginClub",
          }),
        ],
      });
      const config = getDefaultConfig();
      const report = await generateMembersReport(
        snapshot,
        config,
        computeMembers(snapshot, config),
      );

      expect(report).toContain("• *T1* 🔄 — 200 (dari OriginClub)");
    });

    it("stale member has ⚠️ badge (no positive data)", async () => {
      const snapshot = makeSnapshot({
        members: [
          {
            id: 999,
            circle_id: 100,
            viewer_id: 9999,
            trainer_name: "Reference",
            shame_score: null,
            year: 2026,
            month: 6,
            daily_fans: makeCumulativeFans([
              100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100,
            ]),
            last_updated: "2026-06-12",
          },
          {
            id: 9100,
            circle_id: 100,
            viewer_id: 9100,
            trainer_name: "OldMember",
            shame_score: null,
            year: 2026,
            month: 6,
            daily_fans: new Array(32).fill(0), // no positive data → status='stale'
            last_updated: "2026-06-01",
          },
        ],
      });
      const config = getDefaultConfig();
      const report = await generateMembersReport(
        snapshot,
        config,
        computeMembers(snapshot, config),
      );

      expect(report).toContain("• *OldMember* ⚠️");
    });

    it("transfer member without previous_circle_name shows no (dari X)", async () => {
      const snapshot = makeSnapshot({
        members: [
          {
            id: 1,
            circle_id: 100,
            viewer_id: 1001,
            trainer_name: "T1",
            shame_score: null,
            year: 2026,
            month: 6,
            daily_fans: makeCumulativeFans([-100, 0, 200]),
            last_updated: "2026-06-12",
          },
        ],
      });
      const config = getDefaultConfig();
      const report = await generateMembersReport(
        snapshot,
        config,
        computeMembers(snapshot, config),
      );

      expect(report).toContain("• *T1* 🔄");
      expect(report).not.toContain("(dari");
    });

    it("stale member stays stale when ghost count is zero", async () => {
      const snapshot = makeSnapshot({
        members: [
          {
            id: 1,
            circle_id: 100,
            viewer_id: 1001,
            trainer_name: "Ghost",
            shame_score: null,
            year: 2026,
            month: 6,
            daily_fans: new Array(32).fill(0),
            last_updated: "2026-06-01",
          },
        ],
      });
      const config = getDefaultConfig();
      const report = await generateMembersReport(
        snapshot,
        config,
        computeMembers(snapshot, config),
      );

      // ghostCount = max(0, 1 - 2) = 0 → status stays 'stale', not 'left'
      expect(report).toContain("• *Ghost* ⚠️");
    });
  });

  describe("sort order", () => {
    it("active members sorted by monthlyGain descending", async () => {
      const snapshot = makeSnapshot({
        members: [
          {
            id: 1,
            circle_id: 100,
            viewer_id: 1001,
            trainer_name: "LowGain",
            shame_score: null,
            year: 2026,
            month: 6,
            daily_fans: makeCumulativeFans([100, 200]),
            last_updated: "2026-06-12",
          },
          {
            id: 2,
            circle_id: 100,
            viewer_id: 1002,
            trainer_name: "HighGain",
            shame_score: null,
            year: 2026,
            month: 6,
            daily_fans: makeCumulativeFans([100, 500, 900]),
            last_updated: "2026-06-12",
          },
        ],
      });
      const config = getDefaultConfig();
      const report = await generateMembersReport(
        snapshot,
        config,
        computeMembers(snapshot, config),
      );
      const lines = report.split("\n").filter((l) => l.startsWith("•"));

      expect(lines[0]).toContain("HighGain");
      expect(lines[1]).toContain("LowGain");
    });

    it("active members (including transfers) sorted by monthlyGain descending", async () => {
      const snapshot = makeSnapshot({
        members: [
          makeTransferMember({
            viewer_id: 1001,
            trainer_name: "TransferHigh",
            daily_fans: makeCumulativeFans([100, 500, 900]),
          }),
          {
            id: 2,
            circle_id: 100,
            viewer_id: 1002,
            trainer_name: "ActiveLow",
            shame_score: null,
            year: 2026,
            month: 6,
            daily_fans: makeCumulativeFans([100, 200, 300]),
            last_updated: "2026-06-12",
          },
        ],
      });
      const config = getDefaultConfig();
      const report = await generateMembersReport(
        snapshot,
        config,
        computeMembers(snapshot, config),
      );
      const lines = report.split("\n").filter((l) => l.startsWith("•"));

      // Transfers count as active members with badge
      expect(lines[0]).toContain("TransferHigh");
      expect(lines[1]).toContain("ActiveLow");
    });

    it("transfer members appear before stale members", async () => {
      const snapshot = makeSnapshot({
        members: [
          makeStaleMember({ viewer_id: 1001, trainer_name: "StaleMember" }),
          makeTransferMember({
            viewer_id: 1002,
            trainer_name: "TransferMember",
          }),
          {
            id: 999,
            circle_id: 100,
            viewer_id: 9999,
            trainer_name: "Reference",
            shame_score: null,
            year: 2026,
            month: 6,
            daily_fans: makeCumulativeFans([
              100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100,
            ]),
            last_updated: "2026-06-12",
          },
        ],
      });
      const config = getDefaultConfig();
      const report = await generateMembersReport(
        snapshot,
        config,
        computeMembers(snapshot, config),
      );
      const lines = report.split("\n").filter((l) => l.startsWith("•"));

      const transferIdx = lines.findIndex((l) => l.includes("TransferMember"));
      const staleIdx = lines.findIndex((l) => l.includes("StaleMember"));
      expect(transferIdx).toBeLessThan(staleIdx);
    });

    it("transfer members sorted by monthlyGain desc within group", async () => {
      const snapshot = makeSnapshot({
        members: [
          makeTransferMember({
            viewer_id: 1001,
            trainer_name: "LowTransfer",
            daily_fans: makeCumulativeFans([100, 200, 300]),
          }),
          makeTransferMember({
            id: 9001,
            viewer_id: 1002,
            trainer_name: "HighTransfer",
            daily_fans: makeCumulativeFans([100, 500, 900]),
          }),
        ],
      });
      const config = getDefaultConfig();
      const report = await generateMembersReport(
        snapshot,
        config,
        computeMembers(snapshot, config),
      );
      const lines = report.split("\n").filter((l) => l.startsWith("•"));

      expect(lines[0]).toContain("HighTransfer");
      expect(lines[1]).toContain("LowTransfer");
    });
  });

  describe("real snapshot verification", () => {
    const snapshot: Snapshot = JSON.parse(
      readFileSync(join(ROOT, "examples", "snapshot-june-12.json"), "utf-8"),
    );
    const config = getDefaultConfig();

    it("generates report with 34 member lines", async () => {
      const report = await generateMembersReport(
        snapshot,
        config,
        computeMembers(snapshot, config),
      );
      const memberLines = report.split("\n").filter((l) => l.startsWith("•"));
      expect(memberLines).toHaveLength(34);
    });

    it("first member is GoldFamily at 27.7M", async () => {
      const report = await generateMembersReport(
        snapshot,
        config,
        computeMembers(snapshot, config),
      );
      const firstMemberLine = report
        .split("\n")
        .filter((l) => l.startsWith("•"))[0];
      expect(firstMemberLine).toBe("• *GoldFamily* — 27.7M");
    });

    it("last active member is Yukil at 4.6M", async () => {
      const report = await generateMembersReport(
        snapshot,
        config,
        computeMembers(snapshot, config),
      );
      const members = computeMembers(snapshot, config);
      const activeCount = members.filter((m) => m.status === "active").length;
      const memberLines = report.split("\n").filter((l) => l.startsWith("•"));
      const lastActiveLine = memberLines[activeCount - 1];
      expect(lastActiveLine).toBe("• *Yukil* — 4.6M");
    });

    it("all 6 transfer members have 🔄 badge and correct origin", async () => {
      const report = await generateMembersReport(
        snapshot,
        config,
        computeMembers(snapshot, config),
      );
      const transferLines = report.split("\n").filter((l) => l.includes("🔄"));

      expect(transferLines).toHaveLength(6);
      expect(transferLines).toEqual(
        expect.arrayContaining([
          expect.stringContaining("*Sairen* 🔄"),
          expect.stringContaining("(dari Zxyden)"),
        ]),
      );
      expect(transferLines).toEqual(
        expect.arrayContaining([
          expect.stringContaining("*Zero* 🔄"),
          expect.stringContaining("(dari Advent)"),
        ]),
      );
      expect(transferLines).toEqual(
        expect.arrayContaining([
          expect.stringContaining("*Ceciria* 🔄"),
          expect.stringContaining("(dari MejiroStan)"),
        ]),
      );
      expect(transferLines).toEqual(
        expect.arrayContaining([
          expect.stringContaining("*Falkrum* 🔄"),
          expect.stringContaining("(dari KemekMuda)"),
        ]),
      );
      expect(transferLines).toEqual(
        expect.arrayContaining([
          expect.stringContaining("*VitoHoow* 🔄"),
          expect.stringContaining("(dari Madafakars)"),
        ]),
      );
      expect(transferLines).toEqual(
        expect.arrayContaining([
          expect.stringContaining("*TheTengOne* 🔄"),
          expect.stringContaining("(dari Garuda3)"),
        ]),
      );
    });

    it("all 4 left members have 🚪 badge", async () => {
      const report = await generateMembersReport(
        snapshot,
        config,
        computeMembers(snapshot, config),
      );
      const leftLines = report.split("\n").filter((l) => l.includes("🚪"));

      expect(leftLines).toHaveLength(4);
      expect(leftLines).toEqual(
        expect.arrayContaining([expect.stringContaining("*DOA IBU* 🚪")]),
      );
      expect(leftLines).toEqual(
        expect.arrayContaining([expect.stringContaining("*Kuro* 🚪")]),
      );
      expect(leftLines).toEqual(
        expect.arrayContaining([expect.stringContaining("*Rowking* 🚪")]),
      );
      expect(leftLines).toEqual(
        expect.arrayContaining([expect.stringContaining("*Lebowski* 🚪")]),
      );
    });

    it("sort order: active (desc) → stale → left", async () => {
      const report = await generateMembersReport(
        snapshot,
        config,
        computeMembers(snapshot, config),
      );
      const memberLines = report.split("\n").filter((l) => l.startsWith("•"));

      const firstLeftIdx = memberLines.findIndex((l) => l.includes("🚪"));
      expect(firstLeftIdx).toBe(30); // 30 active members (24 regular + 6 transfer)
    });

    it("active members sorted by monthlyGain desc", () => {
      const members = computeMembers(snapshot, config);
      const active = members
        .filter((m) => m.status === "active")
        .sort((a, b) => b.monthlyGain - a.monthlyGain);

      for (let i = 1; i < active.length; i++) {
        expect(active[i - 1].monthlyGain).toBeGreaterThanOrEqual(
          active[i].monthlyGain,
        );
      }
    });

    it("transfer members sorted by monthlyGain desc", () => {
      const members = computeMembers(snapshot, config);
      const transfers = members
        .filter((m) => m.isTransfer)
        .sort((a, b) => b.monthlyGain - a.monthlyGain);

      for (let i = 1; i < transfers.length; i++) {
        expect(transfers[i - 1].monthlyGain).toBeGreaterThanOrEqual(
          transfers[i].monthlyGain,
        );
      }
    });

    it("header shows club name and tier", async () => {
      const report = await generateMembersReport(
        snapshot,
        config,
        computeMembers(snapshot, config),
      );
      expect(report).toContain("Hol＿Horse");
      expect(report).toContain("A+");
    });

    it("report starts with 👥 Daftar Anggota", async () => {
      const report = await generateMembersReport(
        snapshot,
        config,
        computeMembers(snapshot, config),
      );
      expect(report.substring(0, 100)).toContain("👥 *Daftar Anggota");
    });

    it("no Markdown bold or headers in output", async () => {
      const report = await generateMembersReport(
        snapshot,
        config,
        computeMembers(snapshot, config),
      );
      expect(report).not.toMatch(/\*\*[^*]+\*\*/);
      expect(report).not.toMatch(/^#/m);
    });
  });
});
