/**
 * Regression tests for ghost detection against the real Aug-03 scenario.
 *
 * data/snapshots/2026/08/03.json: 30 members vs member_count=25. uma.moe's
 * own export marks isActive=false exactly for {RngF, Rythe, Han, Anshu, jgd}
 * — members whose daily_fans stop before the snapshot's data day. Members
 * with day-3 data (including low-gain Ceciria and zero-gain Nico) must stay
 * active even though their monthly gain is lower than some leavers'.
 */

import { Snapshot, BotConfig } from "../../src/types";
import { getDefaultConfig } from "../../src/config";
import { computeMembers } from "../../src/reports/compute";
import { makeCumulativeFansSeries, loadRealSnapshot } from "../_helpers";

const config: BotConfig = getDefaultConfig();

const LEAVERS = [
  { viewerId: 256732656841, name: "RngF", gain: 2_698_535 },
  { viewerId: 712801789785, name: "Rythe", gain: 0 },
  { viewerId: 317233082684, name: "Han", gain: 0 },
  { viewerId: 436011726069, name: "Anshu", gain: 2_323_567 },
  { viewerId: 653568562728, name: "jgd", gain: 0 },
];

function buildAug03ShapedSnapshot(): Snapshot {
  const base = loadRealSnapshot();
  const actives = Array.from({ length: 23 }, (_, i) => ({
    viewerId: 10000 + i,
    name: `Active${i}`,
    gain: 1_000_000 + i,
  }));
  actives.push({ viewerId: 785312888914, name: "Ceciria", gain: 495_200 });
  actives.push({ viewerId: 422175036098, name: "Nico", gain: 0 });
  actives.sort((a, b) => a.viewerId - b.viewerId);

  const members = [
    ...actives.map((m) => ({
      id: m.viewerId,
      circle_id: base.circle.circle_id,
      viewer_id: m.viewerId,
      trainer_name: m.name,
      shame_score: null,
      year: 2026,
      month: 8,
      daily_fans: makeCumulativeFansSeries(1_000_000, m.gain, 3),
      last_updated: "2026-08-02T18:21:29Z",
    })),
    ...LEAVERS.map((m) => ({
      id: m.viewerId,
      circle_id: base.circle.circle_id,
      viewer_id: m.viewerId,
      trainer_name: m.name,
      shame_score: null,
      year: 2026,
      month: 8,
      daily_fans: makeCumulativeFansSeries(1_000_000, m.gain, 2),
      last_updated: "2026-08-02T03:13:32Z",
    })),
  ];

  return {
    ...base,
    circle: { ...base.circle, member_count: 25 },
    members,
  };
}

describe("ghost detection Aug-03 regression", () => {
  it("classifies exactly the 5 members without day-3 data as left", () => {
    const snap = buildAug03ShapedSnapshot();
    const result = computeMembers(snap, config);
    const byName = new Map(result.map((m) => [m.trainerName, m]));
    expect(result).toHaveLength(30);
    expect(byName.get("RngF")?.status).toBe("left");
    expect(byName.get("Rythe")?.status).toBe("left");
    expect(byName.get("Han")?.status).toBe("left");
    expect(byName.get("Anshu")?.status).toBe("left");
    expect(byName.get("jgd")?.status).toBe("left");
    expect(result.filter((m) => m.status === "left")).toHaveLength(5);
    expect(result.filter((m) => m.status === "active")).toHaveLength(25);
  });

  it("keeps low-gain and zero-gain members with day-3 data active", () => {
    const snap = buildAug03ShapedSnapshot();
    const result = computeMembers(snap, config);
    const byName = new Map(result.map((m) => [m.trainerName, m]));
    expect(byName.get("Ceciria")?.status).toBe("active");
    expect(byName.get("Nico")?.status).toBe("active");
  });
});
