/**
 * Daily Report — Stale Data Warning Tests
 *
 * Tests stale data warning behavior: snapshot freshness vs offset,
 * cross-month independence, report structure, and bug fix behavioral contract.
 */

import { generateDailyReport } from "../../../src/reports/daily";
import { computeMembers } from "../../../src/reports/compute";
import { getDefaultConfig } from "../../../src/config";
import type { Snapshot, BotConfig } from "../../../src/types";
import {
  loadRealSnapshot,
  mockCurrentDate,
  restoreDateMocks,
} from "../../_helpers";

let snapshot: Snapshot;
let config: BotConfig;
let computedMembers: ReturnType<typeof computeMembers>;

beforeAll(() => {
  snapshot = loadRealSnapshot();
  config = getDefaultConfig();
  computedMembers = computeMembers(snapshot, config);
});

function makeSnapshotWithLatestDay(latestDay: number): Snapshot {
  return {
    ...snapshot,
    members: snapshot.members.map((m) => ({
      ...m,
      daily_fans: m.daily_fans.map((v, i) => {
        if (i === latestDay - 1) {
          const prevVal = i > 0 ? m.daily_fans[i - 1] : 0;
          return prevVal + 1000;
        }
        if (i < latestDay - 1) return v;
        return 0;
      }),
    })),
  };
}

describe("Stale data warning: snapshot freshness vs offset", () => {
  afterEach(() => {
    restoreDateMocks();
  });

  describe("stale snapshot (data day 11, today June 13)", () => {
    beforeEach(() => {
      mockCurrentDate(2026, 6, 13);
    });

    it("shows stale warning for offset=0", () => {
      const report = generateDailyReport(snapshot, config, computedMembers, 0);
      expect(report).toContain("⚠️ Data klub mungkin tidak terbaru");
    });

    it("shows stale warning for offset=1", () => {
      const report = generateDailyReport(snapshot, config, computedMembers, 1);
      expect(report).toContain("⚠️ Data klub mungkin tidak terbaru");
    });

    it("shows stale warning for offset=2", () => {
      const report = generateDailyReport(snapshot, config, computedMembers, 2);
      expect(report).toContain("⚠️ Data klub mungkin tidak terbaru");
    });

    it("stale warning references SNAPSHOT date (11 Juni), not offset date", () => {
      const report0 = generateDailyReport(snapshot, config, computedMembers, 0);
      const report1 = generateDailyReport(snapshot, config, computedMembers, 1);
      const report2 = generateDailyReport(snapshot, config, computedMembers, 2);

      expect(report0).toContain("update terakhir: 11 Juni 2026");
      expect(report1).toContain("update terakhir: 11 Juni 2026");
      expect(report2).toContain("update terakhir: 11 Juni 2026");

      expect(report1).not.toContain("update terakhir: 10 Juni 2026");
      expect(report2).not.toContain("update terakhir: 9 Juni 2026");
    });
  });

  describe("fresh snapshot (data day 12, today June 13)", () => {
    let freshSnapshot: Snapshot;

    beforeEach(() => {
      mockCurrentDate(2026, 6, 13);
      freshSnapshot = makeSnapshotWithLatestDay(12);
    });

    it("shows NO stale warning for offset=0", () => {
      const report = generateDailyReport(
        freshSnapshot,
        config,
        computeMembers(freshSnapshot, config),
        0,
      );
      expect(report).not.toContain("⚠️ Data klub mungkin tidak terbaru");
    });

    it("shows NO stale warning for offset=1", () => {
      const report = generateDailyReport(
        freshSnapshot,
        config,
        computeMembers(freshSnapshot, config),
        1,
      );
      expect(report).not.toContain("⚠️ Data klub mungkin tidak terbaru");
    });

    it("shows NO stale warning for offset=2", () => {
      const report = generateDailyReport(
        freshSnapshot,
        config,
        computeMembers(freshSnapshot, config),
        2,
      );
      expect(report).not.toContain("⚠️ Data klub mungkin tidak terbaru");
    });
  });

  describe("same-day snapshot (data day 12, today June 12)", () => {
    let freshSnapshot: Snapshot;

    beforeEach(() => {
      mockCurrentDate(2026, 6, 12);
      freshSnapshot = makeSnapshotWithLatestDay(12);
    });

    it("shows NO stale warning for offset=0", () => {
      const report = generateDailyReport(
        freshSnapshot,
        config,
        computeMembers(freshSnapshot, config),
        0,
      );
      expect(report).not.toContain("⚠️ Data klub mungkin tidak terbaru");
    });

    it("shows NO stale warning for offset=1", () => {
      const report = generateDailyReport(
        freshSnapshot,
        config,
        computeMembers(freshSnapshot, config),
        1,
      );
      expect(report).not.toContain("⚠️ Data klub mungkin tidak terbaru");
    });
  });

  describe("same-day snapshot (data day 11, today June 11)", () => {
    beforeEach(() => {
      mockCurrentDate(2026, 6, 11);
    });

    it("shows NO stale warning for offset=0", () => {
      const report = generateDailyReport(snapshot, config, computedMembers, 0);
      expect(report).not.toContain("⚠️ Data klub mungkin tidak terbaru");
    });

    it("shows NO stale warning for offset=1", () => {
      const report = generateDailyReport(snapshot, config, computedMembers, 1);
      expect(report).not.toContain("⚠️ Data klub mungkin tidak terbaru");
    });
  });

  describe("one-day-old snapshot (data day 11, today June 12)", () => {
    beforeEach(() => {
      mockCurrentDate(2026, 6, 12);
    });

    it("shows NO stale warning for offset=0", () => {
      const report = generateDailyReport(snapshot, config, computedMembers, 0);
      expect(report).not.toContain("⚠️ Data klub mungkin tidak terbaru");
    });

    it("shows NO stale warning for offset=1", () => {
      const report = generateDailyReport(snapshot, config, computedMembers, 1);
      expect(report).not.toContain("⚠️ Data klub mungkin tidak terbaru");
    });
  });

  describe("very stale snapshot (data day 5, today June 13)", () => {
    let veryStaleSnapshot: Snapshot;

    beforeEach(() => {
      mockCurrentDate(2026, 6, 13);
      veryStaleSnapshot = makeSnapshotWithLatestDay(5);
    });

    it("shows stale warning for offset=0 with correct date", () => {
      const report = generateDailyReport(
        veryStaleSnapshot,
        config,
        computeMembers(veryStaleSnapshot, config),
        0,
      );
      expect(report).toContain("⚠️ Data klub mungkin tidak terbaru");
      expect(report).toContain("update terakhir: 5 Juni 2026");
    });

    it("shows stale warning for offset=1 referencing snapshot date, not offset date", () => {
      const report = generateDailyReport(
        veryStaleSnapshot,
        config,
        computeMembers(veryStaleSnapshot, config),
        1,
      );
      expect(report).toContain("⚠️ Data klub mungkin tidak terbaru");
      expect(report).toContain("update terakhir: 5 Juni 2026");
      expect(report).not.toContain("update terakhir: 4 Juni 2026");
    });
  });
});

describe("Stale data warning: cross-month & offset independence", () => {
  afterEach(() => {
    restoreDateMocks();
  });

  it("no stale warning when snapshot is from previous month", () => {
    mockCurrentDate(2026, 6, 13);

    const maySnapshot: Snapshot = {
      ...snapshot,
      members: snapshot.members.map((m) => ({
        ...m,
        month: 5,
        daily_fans: m.daily_fans.map((v, i) => (i < 28 ? v : 0)),
      })),
    };

    const report = generateDailyReport(
      maySnapshot,
      config,
      computeMembers(maySnapshot, config),
      0,
    );
    expect(report).not.toContain("⚠️ Data klub mungkin tidak terbaru");
  });

  it("offset=0 and offset=5 produce same stale warning presence", () => {
    mockCurrentDate(2026, 6, 13);

    const report0 = generateDailyReport(snapshot, config, computedMembers, 0);
    const report5 = generateDailyReport(snapshot, config, computedMembers, 5);

    const hasStale0 = report0.includes("⚠️ Data klub mungkin tidak terbaru");
    const hasStale5 = report5.includes("⚠️ Data klub mungkin tidak terbaru");
    expect(hasStale0).toBe(hasStale5);
  });

  it("both offset=0 and offset=5 reference the same snapshot date", () => {
    mockCurrentDate(2026, 6, 13);

    const report0 = generateDailyReport(snapshot, config, computedMembers, 0);
    const report5 = generateDailyReport(snapshot, config, computedMembers, 5);

    expect(report0).toContain("update terakhir: 11 Juni 2026");
    expect(report5).toContain("update terakhir: 11 Juni 2026");
  });
});

describe("Stale data warning: report structure & edge cases", () => {
  afterEach(() => {
    restoreDateMocks();
  });

  it("stale warning appears after member list, before footer", () => {
    mockCurrentDate(2026, 6, 13);

    const report = generateDailyReport(snapshot, config, computedMembers, 0);
    const lines = report.split("\n");

    const staleWarningIdx = lines.findIndex((l) =>
      l.includes("⚠️ Data klub mungkin tidak terbaru"),
    );
    const footerIdx = lines.findIndex((l) => l.startsWith("⸻"));
    const memberLines = lines.filter((l) => /^\d+\./.test(l));

    expect(staleWarningIdx).toBeGreaterThan(0);
    expect(staleWarningIdx).toBeGreaterThan(memberLines.length + 5);
    expect(staleWarningIdx).toBeLessThan(footerIdx);
  });

  it("fresh snapshot: no stale warning line, report still has footer", () => {
    mockCurrentDate(2026, 6, 11);

    const report = generateDailyReport(snapshot, config, computedMembers, 0);
    const lines = report.split("\n");

    expect(report).not.toContain("⚠️ Data klub mungkin tidak terbaru");
    const footerIdx = lines.findIndex((l) => l.startsWith("⸻"));
    expect(footerIdx).toBeGreaterThan(0);
  });

  it("empty snapshot returns early, no stale warning possible", () => {
    const emptySnapshot: Snapshot = {
      circle: snapshot.circle,
      members: [],
      club_rank: 8,
      fans_to_next_tier: 349208495,
      fans_to_lower_tier: 21848493,
      yesterday_fans_to_next_tier: 305715171,
      yesterday_fans_to_lower_tier: 20621702,
    };

    const report = generateDailyReport(
      emptySnapshot,
      config,
      computeMembers(emptySnapshot, config),
      0,
    );
    expect(report).toBe(
      "ℹ️ *Daily Report*\nTidak ada data anggota untuk hari ini. Mungkin sync belum berjalan.",
    );
    expect(report).not.toContain("⚠️ Data klub mungkin tidak terbaru");
  });

  it("negative offset produces same stale warning as positive offset", () => {
    mockCurrentDate(2026, 6, 13);

    const reportNeg = generateDailyReport(
      snapshot,
      config,
      computedMembers,
      -1,
    );
    const reportPos = generateDailyReport(snapshot, config, computedMembers, 1);

    const staleNeg = reportNeg.includes("⚠️ Data klub mungkin tidak terbaru");
    const stalePos = reportPos.includes("⚠️ Data klub mungkin tidak terbaru");
    expect(staleNeg).toBe(stalePos);
  });

  it("stale warning uses Indonesian date format", () => {
    mockCurrentDate(2026, 6, 13);

    const report = generateDailyReport(snapshot, config, computedMembers, 0);
    expect(report).toMatch(/update terakhir: \d+ Juni 2026/);
  });
});

describe("Stale data warning: bug fix behavioral contract", () => {
  afterEach(() => {
    restoreDateMocks();
  });

  it("BUG FIX: /daily 1 no longer falsely warns when snapshot is fresh", () => {
    // OLD BUG: dataDay < currentDay-1 → false stale warning
    // NEW FIX: latestDataDay >= currentDay-1 → no warning
    mockCurrentDate(2026, 6, 13);
    const freshSnapshot = makeSnapshotWithLatestDay(12);

    const report = generateDailyReport(
      freshSnapshot,
      config,
      computeMembers(freshSnapshot, config),
      1,
    );

    expect(report).not.toContain("⚠️ Data klub mungkin tidak terbaru");
    expect(report).toContain("📊 *Daily Report — 11 Juni 2026*");
  });

  it("BUG FIX: /daily 0 correctly warns when snapshot is stale", () => {
    mockCurrentDate(2026, 6, 13);

    const report = generateDailyReport(snapshot, config, computedMembers, 0);

    expect(report).toContain("⚠️ Data klub mungkin tidak terbaru");
    expect(report).toContain("update terakhir: 11 Juni 2026");
  });

  it("BUG FIX: /daily 1 correctly warns when snapshot is stale", () => {
    mockCurrentDate(2026, 6, 13);

    const report = generateDailyReport(snapshot, config, computedMembers, 1);

    expect(report).toContain("⚠️ Data klub mungkin tidak terbaru");
    expect(report).toContain("update terakhir: 11 Juni 2026");
    expect(report).not.toContain("update terakhir: 10 Juni 2026");
  });
});
