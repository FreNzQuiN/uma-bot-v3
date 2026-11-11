/**
 * Tests for computeMembers — the shared computation engine.
 *
 * Uses the real snapshot from examples/snapshot-june-12.json.
 * Verifies member status classification, gain calculations, and edge cases.
 */

import { Snapshot, ComputedMember, BotConfig } from "../../src/types";
import { getDefaultConfig } from "../../src/config";
import { computeMembers } from "../../src/reports/compute";
import { loadRealSnapshot, makeCumulativeFansSeries } from "../_helpers";

const snapshot: Snapshot = loadRealSnapshot();

const config: BotConfig = getDefaultConfig();

const RYU_VIEWER_ID = 116183149143;

function findMember(members: ComputedMember[], name: string): ComputedMember {
  const m = members.find((m) => m.trainerName === name);
  if (!m) throw new Error(`Member "${name}" not found in computed results`);
  return m;
}

describe("computeMembers", () => {
  let members: ComputedMember[];

  beforeAll(() => {
    members = computeMembers(snapshot, config);
  });

  describe("basic structure", () => {
    it("returns one ComputedMember per snapshot member", () => {
      expect(members).toHaveLength(snapshot.members.length);
    });

    it("preserves viewerId and trainerName from snapshot", () => {
      const ryu = findMember(members, "Ryu");
      expect(ryu.viewerId).toBe(RYU_VIEWER_ID);
      expect(ryu.trainerName).toBe("Ryu");
    });

    it("preserves dailyFans array reference from snapshot", () => {
      const ryu = findMember(members, "Ryu");
      expect(ryu.dailyFans).toBe(
        snapshot.members.find((m) => m.viewer_id === RYU_VIEWER_ID)?.daily_fans,
      );
    });

    it("all members have a 32-element weeklyGains array", () => {
      for (const m of members) {
        expect(m.weeklyGains).toHaveLength(5);
      }
    });
  });

  describe("active members", () => {
    it("classifies Ryu as active", () => {
      const ryu = findMember(members, "Ryu");
      expect(ryu.status).toBe("active");
      expect(ryu.isTransfer).toBe(false);
    });

    it("computes correct latestPositiveDay for Ryu", () => {
      const ryu = findMember(members, "Ryu");
      // Ryu has positive data through index 10 → day 11
      expect(ryu.latestPositiveDay).toBe(11);
    });

    it("computes correct firstPositiveDay for Ryu", () => {
      const ryu = findMember(members, "Ryu");
      // Ryu's first positive is index 0 → day 1
      expect(ryu.firstPositiveDay).toBe(1);
    });

    it("computes correct latestPositiveValue for Ryu", () => {
      const ryu = findMember(members, "Ryu");
      expect(ryu.latestPositiveValue).toBe(332207534);
    });

    it("computes correct firstPositiveValue for Ryu", () => {
      const ryu = findMember(members, "Ryu");
      expect(ryu.firstPositiveValue).toBe(316856492);
    });

    it("computes correct monthlyGain for Ryu", () => {
      const ryu = findMember(members, "Ryu");
      // 332207534 - 316856492 = 15351042
      expect(ryu.monthlyGain).toBe(15351042);
    });

    it("computes correct latestKnownGain for Ryu", () => {
      const ryu = findMember(members, "Ryu");
      // fans[10] - fans[9] = 332207534 - 331992091 = 215443
      expect(ryu.latestKnownGain).toBe(215443);
    });

    it("computes correct weeklyGains for Ryu", () => {
      const ryu = findMember(members, "Ryu");
      // Week 1: 329925021 - 316856492 = 13068529
      expect(ryu.weeklyGains[0]).toBe(13068529);
      // Week 2: 332207534 - 329925021 = 2282513
      expect(ryu.weeklyGains[1]).toBe(2282513);
      // Weeks 3-5: no data → 0
      expect(ryu.weeklyGains[2]).toBe(0);
      expect(ryu.weeklyGains[3]).toBe(0);
      expect(ryu.weeklyGains[4]).toBe(0);
    });

    it("computes correct values for GoldFamily", () => {
      const gf = findMember(members, "GoldFamily");
      expect(gf.status).toBe("active");
      expect(gf.monthlyGain).toBe(27709705);
      // latestKnownGain: 317726222 - 315015625 = 2710597
      expect(gf.latestKnownGain).toBe(2710597);
    });
  });

  describe("transfer members", () => {
    it("classifies Zero as active with isTransfer flag", () => {
      const zero = findMember(members, "Zero");
      expect(zero.status).toBe("active");
      expect(zero.isTransfer).toBe(true);
      expect(zero.previousCircleName).toBe("Advent");
    });

    it("classifies TheTengOne as active with isTransfer flag", () => {
      const tt = findMember(members, "TheTengOne");
      expect(tt.status).toBe("active");
      expect(tt.isTransfer).toBe(true);
      expect(tt.previousCircleName).toBe("Garuda3");
    });

    it("classifies Sairen as active with isTransfer flag (negative daily_fans[0])", () => {
      const s = findMember(members, "Sairen");
      expect(s.status).toBe("active");
      expect(s.isTransfer).toBe(true);
      expect(s.previousCircleName).toBe("Zxyden");
    });

    it("classifies VitoHoow as active with isTransfer flag", () => {
      const v = findMember(members, "VitoHoow");
      expect(v.status).toBe("active");
      expect(v.isTransfer).toBe(true);
      expect(v.previousCircleName).toBe("Madafakars");
    });

    it("classifies Ceciria as active with isTransfer flag", () => {
      const c = findMember(members, "Ceciria");
      expect(c.status).toBe("active");
      expect(c.isTransfer).toBe(true);
      expect(c.previousCircleName).toBe("MejiroStan");
    });

    it("classifies Falkrum as active with isTransfer flag", () => {
      const f = findMember(members, "Falkrum");
      expect(f.status).toBe("active");
      expect(f.isTransfer).toBe(true);
      expect(f.previousCircleName).toBe("KemekMuda");
    });

    it("computes correct gains for Zero despite negative prefix", () => {
      const zero = findMember(members, "Zero");
      // firstPositiveDay = 4 (index 3 = 301413137)
      expect(zero.firstPositiveDay).toBe(4);
      // latestPositiveDay = 11 (index 10 = 315534000)
      expect(zero.latestPositiveDay).toBe(11);
      // monthlyGain = 315534000 - 301413137 = 14120863
      expect(zero.monthlyGain).toBe(14120863);
      // latestKnownGain = 315534000 - 313515911 = 2018089
      expect(zero.latestKnownGain).toBe(2018089);
    });

    it("computes correct gains for Sairen", () => {
      const s = findMember(members, "Sairen");
      // firstPositiveDay = 6 (index 5 = 424931301)
      expect(s.firstPositiveDay).toBe(6);
      // monthlyGain = 442813391 - 424931301 = 17882090
      expect(s.monthlyGain).toBe(17882090);
    });

    it("all 6 transfer members are identified", () => {
      const transfers = members.filter((m) => m.isTransfer);
      expect(transfers).toHaveLength(6);
    });
  });

  describe("stale/left members", () => {
    it("classifies DOA IBU as left (ghost, member_count gap)", () => {
      const d = findMember(members, "DOA IBU");
      expect(d.status).toBe("left");
      expect(d.latestPositiveDay).toBe(1);
    });

    it("classifies Kuro as left (ghost, member_count gap)", () => {
      const k = findMember(members, "Kuro");
      expect(k.status).toBe("left");
      expect(k.latestPositiveDay).toBe(2);
    });

    it("classifies Rowking as left (ghost, member_count gap)", () => {
      const r = findMember(members, "Rowking");
      expect(r.status).toBe("left");
      expect(r.latestPositiveDay).toBe(3);
    });

    it("classifies Lebowski as left (ghost, member_count gap)", () => {
      const l = findMember(members, "Lebowski");
      expect(l.status).toBe("left");
      expect(l.latestPositiveDay).toBe(1);
    });

    it('all 4 ghost members have status "left"', () => {
      const left = members.filter((m) => m.status === "left");
      expect(left).toHaveLength(4);
    });

    it('no members have status "stale" (all 4 ghosts reclassified as left)', () => {
      const stale = members.filter((m) => m.status === "stale");
      expect(stale).toHaveLength(0);
    });
  });

  describe("active status count", () => {
    it("has correct active count (total - left)", () => {
      const active = members.filter((m) => m.status === "active");
      const total = snapshot.members.length;
      const left = members.filter((m) => m.status === "left").length;
      expect(active).toHaveLength(total - left);
    });
  });

  describe("edge cases", () => {
    it("handles member with all-zero daily_fans", () => {
      const minimalSnapshot: Snapshot = {
        ...snapshot,
        members: [
          {
            ...snapshot.members[0],
            viewer_id: 999,
            trainer_name: "GhostMember",
            daily_fans: new Array(32).fill(0),
            previous_circle_id: undefined,
            previous_circle_name: undefined,
          },
        ],
      };

      const result = computeMembers(minimalSnapshot, config);
      expect(result).toHaveLength(1);
      expect(result[0].status).toBe("stale");
      expect(result[0].latestPositiveDay).toBe(0);
      expect(result[0].firstPositiveDay).toBe(0);
      expect(result[0].monthlyGain).toBe(0);
      expect(result[0].latestKnownGain).toBe(0);
      expect(result[0].isTransfer).toBe(false);
    });

    it("handles member with only one day of data", () => {
      const minimalSnapshot: Snapshot = {
        ...snapshot,
        members: [
          {
            ...snapshot.members[0],
            viewer_id: 888,
            trainer_name: "OneDayMember",
            daily_fans: [5000000, ...new Array(31).fill(0)],
            previous_circle_id: undefined,
            previous_circle_name: undefined,
          },
        ],
      };

      const result = computeMembers(minimalSnapshot, config);
      expect(result[0].latestPositiveDay).toBe(1);
      expect(result[0].firstPositiveDay).toBe(1);
      expect(result[0].monthlyGain).toBe(0); // single day = no gain
      expect(result[0].latestKnownGain).toBe(0); // no previous day
    });

    it("handles empty members array", () => {
      const emptySnapshot: Snapshot = {
        ...snapshot,
        members: [],
      };

      const result = computeMembers(emptySnapshot, config);
      expect(result).toHaveLength(0);
    });

    it("detects transfer via negative daily_fans[0] even without previous_circle fields", () => {
      const minimalSnapshot: Snapshot = {
        ...snapshot,
        members: [
          {
            ...snapshot.members[0],
            viewer_id: 777,
            trainer_name: "NegativeStart",
            daily_fans: [-100000, 200000, 300000, ...new Array(29).fill(0)],
            previous_circle_id: undefined,
            previous_circle_name: undefined,
          },
        ],
      };

      const result = computeMembers(minimalSnapshot, config);
      expect(result[0].isTransfer).toBe(true);
      expect(result[0].status).toBe("active");
      // firstPositiveDay should skip the negatives
      expect(result[0].firstPositiveDay).toBe(2);
    });
  });

  describe("custom staleAfterDays", () => {
    it("uses config staleAfterDays value", () => {
      const customConfig: BotConfig = {
        ...config,
        memberStatus: {
          staleAfterDaysDaily: 0,
          staleAfterDaysWeekly: 3,
          staleAfterDaysMonthly: 7,
        },
      };

      const result = computeMembers(snapshot, customConfig);
      const stale = result.filter((m) => m.status === "stale");
      const left = result.filter((m) => m.status === "left");
      expect(stale.length + left.length).toBe(4);
    });
  });

  describe("transfer member with no data", () => {
    it('transfer member with no positive data has status "stale" (latestPositiveDay=0)', () => {
      const staleTransferSnapshot: Snapshot = {
        ...snapshot,
        members: [
          {
            ...snapshot.members[0],
            viewer_id: 111111,
            trainer_name: "StaleTransfer",
            daily_fans: [
              -100000,
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
            ],
            previous_circle_id: 99999,
            previous_circle_name: "OldClub",
          },
        ],
      };

      const result = computeMembers(staleTransferSnapshot, config);
      expect(result).toHaveLength(1);
      expect(result[0].status).toBe("stale");
      expect(result[0].isTransfer).toBe(true);
    });
  });

  describe("real snapshot data validation", () => {
    it("snapshot has 34 members but member_count=30 (4 ghosts)", () => {
      expect(snapshot.members.length).toBe(34);
      expect(snapshot.circle.member_count).toBe(30);
      expect(snapshot.members.length - snapshot.circle.member_count).toBe(4);
    });

    it('the 4 ghost members are classified as "left" via member_count gap', () => {
      const members = computeMembers(snapshot, config);
      const active = members.filter((m) => m.status === "active");
      const left = members.filter((m) => m.status === "left");

      // 30 contributing = active (includes transfers)
      expect(active.length).toBe(snapshot.circle.member_count);
      expect(left.length).toBe(
        snapshot.members.length - snapshot.circle.member_count,
      );

      const leftNames = left.map((m) => m.trainerName).sort();
      expect(leftNames).toEqual(
        ["DOA IBU", "Kuro", "Lebowski", "Rowking"].sort(),
      );
    });

    it("smoke: computes all 5 member pattern types without crashing", () => {
      const members = computeMembers(snapshot, config);
      const names = [
        "Ryu", // active, regular contributor
        "GoldFamily", // active, top contributor
        "Zero", // transfer, joined mid-month
        "DOA IBU", // left (ghost), only day 1 data
        "Kuro", // left (ghost), only days 1-2
      ];

      for (const name of names) {
        const m = members.find((x) => x.trainerName === name);
        expect(m).toBeDefined();
      }
    });
  });

  describe("ghost detection data-day signal", () => {
    function buildGhostSnapshot(
      memberCount: number,
      members: Array<{
        viewerId: number;
        name: string;
        activeDays: number;
        gain: number;
      }>,
    ): Snapshot {
      return {
        ...snapshot,
        circle: { ...snapshot.circle, member_count: memberCount },
        members: members.map((m) => ({
          id: m.viewerId,
          circle_id: snapshot.circle.circle_id,
          viewer_id: m.viewerId,
          trainer_name: m.name,
          shame_score: null,
          year: 2026,
          month: 8,
          daily_fans: makeCumulativeFansSeries(1_000_000, m.gain, m.activeDays),
          last_updated: "2026-08-02T18:21:29Z",
        })),
      };
    }

    it("marks gainful member with no latest-day data as left", () => {
      const s = buildGhostSnapshot(3, [
        { viewerId: 1, name: "ActiveHigh", activeDays: 3, gain: 5_000_000 },
        { viewerId: 2, name: "ActiveLow", activeDays: 3, gain: 495_200 },
        { viewerId: 3, name: "GainfulLeft", activeDays: 2, gain: 2_698_535 },
        { viewerId: 4, name: "ZeroGainLeft", activeDays: 2, gain: 0 },
        { viewerId: 5, name: "ActiveD", activeDays: 3, gain: 1_000_000 },
      ]);
      const members = computeMembers(s, config);
      const byName = new Map(members.map((m) => [m.trainerName, m]));
      expect(byName.get("GainfulLeft")?.status).toBe("left");
      expect(byName.get("ZeroGainLeft")?.status).toBe("left");
      expect(byName.get("ActiveHigh")?.status).toBe("active");
      expect(byName.get("ActiveLow")?.status).toBe("active");
      expect(byName.get("ActiveD")?.status).toBe("active");
    });

    it("uses the upper median for even-length data-day lists", () => {
      const s = buildGhostSnapshot(3, [
        { viewerId: 1, name: "LeftA", activeDays: 2, gain: 0 },
        { viewerId: 2, name: "ActiveBorderline", activeDays: 2, gain: 0 },
        { viewerId: 3, name: "ActiveA", activeDays: 3, gain: 1_000_000 },
        { viewerId: 4, name: "ActiveB", activeDays: 3, gain: 1_000_000 },
      ]);
      const members = computeMembers(s, config);
      const byName = new Map(members.map((m) => [m.trainerName, m]));
      expect(byName.get("LeftA")?.status).toBe("left");
      expect(byName.get("ActiveBorderline")?.status).toBe("active");
      expect(byName.get("ActiveA")?.status).toBe("active");
      expect(byName.get("ActiveB")?.status).toBe("active");
    });

    it("does not reclassify zero-data members (lpd floor)", () => {
      const s = buildGhostSnapshot(3, [
        { viewerId: 1, name: "ActiveA", activeDays: 3, gain: 1_000 },
        { viewerId: 2, name: "ActiveB", activeDays: 3, gain: 1_000 },
        { viewerId: 3, name: "NoData", activeDays: 0, gain: 0 },
        { viewerId: 4, name: "ActiveC", activeDays: 3, gain: 1_000 },
      ]);
      const members = computeMembers(s, config);
      const byName = new Map(members.map((m) => [m.trainerName, m]));
      expect(byName.get("NoData")?.status).toBe("stale");
      expect(byName.get("ActiveA")?.status).toBe("active");
      expect(byName.get("ActiveB")?.status).toBe("active");
      expect(byName.get("ActiveC")?.status).toBe("active");
    });

    it("defers when confirmed candidates are fewer than ghostCount", () => {
      const s = buildGhostSnapshot(4, [
        { viewerId: 1, name: "ActiveA", activeDays: 3, gain: 5_000_000 },
        { viewerId: 2, name: "ActiveB", activeDays: 3, gain: 3_000_000 },
        { viewerId: 3, name: "ActiveC", activeDays: 3, gain: 100 },
        { viewerId: 4, name: "LeftOne", activeDays: 2, gain: 500_000 },
        { viewerId: 5, name: "LeftTwo", activeDays: 2, gain: 400_000 },
        { viewerId: 6, name: "ActiveD", activeDays: 3, gain: 2_000_000 },
        { viewerId: 7, name: "ActiveE", activeDays: 3, gain: 1_000_000 },
      ]);
      const members = computeMembers(s, config);
      const byName = new Map(members.map((m) => [m.trainerName, m]));
      expect(byName.get("LeftOne")?.status).toBe("left");
      expect(byName.get("LeftTwo")?.status).toBe("left");
      expect(byName.get("ActiveA")?.status).toBe("active");
      expect(byName.get("ActiveC")?.status).toBe("active");
      expect(byName.get("ActiveD")?.status).toBe("active");
    });

    it("marks nothing left when all members share the latest data day", () => {
      const s = buildGhostSnapshot(3, [
        { viewerId: 1, name: "ActiveA", activeDays: 3, gain: 5_000_000 },
        { viewerId: 2, name: "ActiveB", activeDays: 3, gain: 3_000_000 },
        { viewerId: 3, name: "ActiveC", activeDays: 3, gain: 100 },
        { viewerId: 4, name: "ActiveD", activeDays: 3, gain: 2_000_000 },
        { viewerId: 5, name: "ActiveE", activeDays: 3, gain: 1_000_000 },
      ]);
      const members = computeMembers(s, config);
      for (const m of members) {
        expect(m.status).toBe("active");
      }
    });

    it("breaks ties deterministically by viewerId", () => {
      const s = buildGhostSnapshot(5, [
        { viewerId: 10, name: "LeftLowId", activeDays: 2, gain: 0 },
        { viewerId: 20, name: "LeftHighId", activeDays: 2, gain: 0 },
        { viewerId: 30, name: "ActiveBorderline", activeDays: 2, gain: 0 },
        { viewerId: 40, name: "ActiveA", activeDays: 3, gain: 1_000_000 },
        { viewerId: 50, name: "ActiveB", activeDays: 3, gain: 1_000_000 },
        { viewerId: 60, name: "ActiveC", activeDays: 3, gain: 1_000_000 },
        { viewerId: 70, name: "ActiveD", activeDays: 3, gain: 1_000_000 },
      ]);
      const members = computeMembers(s, config);
      const byName = new Map(members.map((m) => [m.trainerName, m]));
      expect(byName.get("LeftLowId")?.status).toBe("left");
      expect(byName.get("LeftHighId")?.status).toBe("left");
      expect(byName.get("ActiveBorderline")?.status).toBe("active");
      expect(byName.get("ActiveA")?.status).toBe("active");
      expect(byName.get("ActiveB")?.status).toBe("active");
    });

    it("rejects outlier data-day influence via median reference", () => {
      const s = buildGhostSnapshot(4, [
        { viewerId: 1, name: "Outlier", activeDays: 31, gain: 1_000_000 },
        { viewerId: 2, name: "ActiveA", activeDays: 3, gain: 500_000 },
        { viewerId: 3, name: "ActiveB", activeDays: 3, gain: 500_000 },
        { viewerId: 4, name: "ActiveC", activeDays: 3, gain: 500_000 },
        { viewerId: 5, name: "ActiveD", activeDays: 3, gain: 500_000 },
      ]);
      const members = computeMembers(s, config);
      const byName = new Map(members.map((m) => [m.trainerName, m]));
      expect(byName.get("Outlier")?.status).toBe("active");
      for (const name of ["ActiveA", "ActiveB", "ActiveC", "ActiveD"]) {
        expect(byName.get(name)?.status).toBe("active");
      }
    });
  });
});
