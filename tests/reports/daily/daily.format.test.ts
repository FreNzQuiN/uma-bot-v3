/**
 * Daily Report — Format Tests
 *
 * Output structure verification, WhatsApp formatting compliance,
 * ghost member awareness, and single member snapshot behavior.
 */

import { generateDailyReport } from "../../../src/reports/daily";
import { computeMembers } from "../../../src/reports/compute";
import { getDefaultConfig } from "../../../src/config";
import { getDataDayFromSnapshot } from "../../../src/data/snapshot";
import {
  getLatestDataDay,
  isTransferMember,
  isStaleForReport,
} from "../../../src/data/daily-fans";
import type { Snapshot, BotConfig } from "../../../src/types";
import { loadRealSnapshot, STALE_NAMES } from "../../_helpers";

let snapshot: Snapshot;
let config: BotConfig;
let computedMembers: ReturnType<typeof computeMembers>;

beforeAll(() => {
  snapshot = loadRealSnapshot();
  config = getDefaultConfig();
  computedMembers = computeMembers(snapshot, config);
});

describe("Output structure", () => {
  let report: string;
  let reportOffset1: string;
  let lines: string[];

  beforeAll(() => {
    report = generateDailyReport(snapshot, config, computedMembers, 0);
    reportOffset1 = generateDailyReport(snapshot, config, computedMembers, 1);
    lines = report.split("\n");
  });

  it("prints the full report for verification", () => {
    expect(report.length).toBeGreaterThan(0);
  });

  it("report starts with Daily Report header for June 11", () => {
    expect(report).toContain("📊 *Daily Report — 11 Juni 2026*");
  });

  it("report shows club name, tier, and rank", () => {
    expect(report).toContain("Hol＿Horse");
    expect(report).toContain("A+");
    expect(report).toContain("#431");
  });

  it("report shows data period date", () => {
    expect(report).toContain("Periode data: 11 Juni 2026, 22:00 WIB");
  });

  it("report shows promotion and demotion info", () => {
    expect(report).toContain("Promosi: 349.2M fans lagi");
    expect(report).toContain("Degradasi: buffer 21.8M");
  });

  it("summary line shows contributor count", () => {
    expect(report).toMatch(/👥 27 kontribusi dari 30 anggota \| Total: /);
  });

  it("member list contains positive-gain members only", () => {
    expect(report).toMatch(/1\. \*Nargi\* — \+/);

    const memberLines = lines.filter((l) => /^\d+\.\s/.test(l));
    expect(memberLines.length).toBe(27);

    for (const line of memberLines) {
      expect(line).toMatch(/^\d+\.\s\*.+\*\s*(🔄)? — \+[\d.]+[KMB]?$/);
    }
  });

  it('footer shows "Terakhir sync: D/M HH:MM" format', () => {
    const syncLine = lines.find((l) => l.startsWith("Terakhir sync:"));
    expect(syncLine).toMatch(/^Terakhir sync: \d+\/\d+ \d{2}:\d{2}$/);
  });

  it("members are sorted by gain descending", () => {
    const memberLines = lines.filter((l) => /^\d+\.\s/.test(l));
    expect(memberLines[0]).toContain("Nargi");

    const gains = memberLines.map((l) => {
      const match = l.match(/— \+?([\d.]+)([KMB])?/);
      if (!match) return 0;
      const val = parseFloat(match[1]);
      const suffix = match[2] || "";
      if (suffix === "K") return val * 1000;
      if (suffix === "M") return val * 1000000;
      if (suffix === "B") return val * 1000000000;
      return val;
    });
    for (let i = 1; i < gains.length; i++) {
      expect(gains[i - 1]).toBeGreaterThanOrEqual(gains[i]);
    }
  });
});

describe("WhatsApp formatting compliance", () => {
  let report: string;

  beforeAll(() => {
    report = generateDailyReport(snapshot, config, computedMembers, 0);
  });

  it("uses *bold* (WhatsApp) not **bold** (Markdown)", () => {
    expect(report).toContain("📊 *Daily Report");
    expect(report).not.toMatch(/\*\*[^*]+\*\*/);
  });

  it("has no Markdown # headers", () => {
    const lines = report.split("\n");
    for (const line of lines) {
      expect(line).not.toMatch(/^#{1,6}\s/);
    }
  });

  it("uses emoji prefixes for sections", () => {
    expect(report).toContain("\uD83D\uDCCA"); // 📊
    expect(report).toContain("\uD83D\uDC65"); // 👥
    expect(report).toContain("⚠️");
    expect(report).toContain("🔄");
  });

  it("uses Indonesian month names (not English)", () => {
    expect(report).toContain("Juni");
    expect(report).not.toContain("June");
  });

  it("uses Indonesian labels", () => {
    expect(report).toContain("Promosi:");
    expect(report).toContain("Degradasi:");
    expect(report).toContain("kontribusi");
    expect(report).toContain("Terakhir sync:");
  });
});

describe("Ghost member awareness (members.length vs member_count)", () => {
  it("snapshot has 34 members but member_count=30, extras are stale", () => {
    expect(snapshot.members.length).toBe(34);
    expect(snapshot.circle.member_count).toBe(30);

    const latestDataDay = getDataDayFromSnapshot(snapshot);
    let staleCount = 0;
    let activeCount = 0;
    let transferCount = 0;

    for (const member of snapshot.members) {
      const isT = isTransferMember(member);
      const latestPositiveDay = getLatestDataDay(member.daily_fans);
      const stale = isStaleForReport(member.daily_fans, latestDataDay, 3);
      if (isT) transferCount++;
      else if (latestPositiveDay === 0 || stale) staleCount++;
      else activeCount++;
    }

    expect(activeCount).toBe(23);
    expect(transferCount).toBe(6);
    expect(staleCount).toBe(5);
    expect(activeCount + transferCount + staleCount).toBe(
      snapshot.members.length,
    );
  });

  it("report active count matches circle.member_count, not members.length", () => {
    const report = generateDailyReport(snapshot, config, computedMembers, 0);
    const gainLine = report.split("\n").find((l) => l.includes("anggota"));
    expect(gainLine).toContain("30 anggota");
    expect(gainLine).not.toContain("34 anggota");
  });

  it("ghost members not shown in daily report (left only in /members)", () => {
    const report = generateDailyReport(snapshot, config, computedMembers, 0);
    const staleNames = [...STALE_NAMES];
    expect(report).not.toContain("🚪 Keluar dari klub:");

    const memberLines = report.split("\n").filter((l) => /^\d+\./.test(l));
    for (const name of staleNames) {
      const found = memberLines.find((l) => l.includes(name));
      expect(found).toBeUndefined();
    }
  });
});

describe("Single member snapshot", () => {
  it("works correctly with one member", () => {
    const singleSnapshot: Snapshot = {
      circle: snapshot.circle,
      members: [snapshot.members[0]],
      club_rank: 8,
      fans_to_next_tier: 349208495,
      fans_to_lower_tier: 21848493,
      yesterday_fans_to_next_tier: 305715171,
      yesterday_fans_to_lower_tier: 20621702,
    };

    const report = generateDailyReport(
      singleSnapshot,
      config,
      computeMembers(singleSnapshot, config),
      0,
    );

    expect(report).toContain("📊 *Daily Report — 11 Juni 2026*");
    expect(report).toContain("1 kontribusi dari 1 anggota");

    const memberLines = report.split("\n").filter((l) => /^\d+\./.test(l));
    expect(memberLines.length).toBe(1);
    expect(memberLines[0]).toMatch(/^1\./);
  });

  it("single member with 0 gain appears in stale section", () => {
    const singleSnapshot: Snapshot = {
      circle: snapshot.circle,
      members: [
        {
          ...snapshot.members[0],
          daily_fans: snapshot.members[0].daily_fans.map((v, i) =>
            i < 11 ? 1000 : 0,
          ),
        },
      ],
      club_rank: 8,
      fans_to_next_tier: 349208495,
      fans_to_lower_tier: 21848493,
      yesterday_fans_to_next_tier: 305715171,
      yesterday_fans_to_lower_tier: 20621702,
    };

    const report = generateDailyReport(
      singleSnapshot,
      config,
      computeMembers(singleSnapshot, config),
      0,
    );
    expect(report).toContain("0 kontribusi dari 1 anggota");
    expect(report).toContain("⚠️ Belum aktif hari ini");
    expect(report).toContain("• Ryu");
    const memberLines = report.split("\n").filter((l) => /^\d+\./.test(l));
    expect(memberLines.length).toBe(0);
  });

  it("stale member shows in stale section, active member in ranking", () => {
    const staleMember = snapshot.members.find(
      (m) => m.trainer_name === "DOA IBU",
    )!;
    const activeMember = snapshot.members.find(
      (m) => m.trainer_name === "Nargi",
    )!;
    const mixedSnapshot: Snapshot = {
      circle: snapshot.circle,
      members: [activeMember, staleMember],
      club_rank: 8,
      fans_to_next_tier: 349208495,
      fans_to_lower_tier: 21848493,
      yesterday_fans_to_next_tier: 305715171,
      yesterday_fans_to_lower_tier: 20621702,
    };

    const report = generateDailyReport(
      mixedSnapshot,
      config,
      computeMembers(mixedSnapshot, config),
      0,
    );

    expect(report).toContain("1 kontribusi dari 2 anggota");
    expect(report).toContain("⚠️ Belum aktif");
    const memberLines = report.split("\n").filter((l) => /^\d+\./.test(l));
    expect(memberLines.length).toBe(1);
    expect(memberLines[0]).toContain("Nargi");
    expect(report).toContain("• DOA IBU");
  });
});
