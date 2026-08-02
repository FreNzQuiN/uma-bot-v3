import { computeMembers } from "../../src/reports/compute";
import { detectAlerts, MIN_STREAK_DAYS } from "../../src/alerts/alerts";
import type { Snapshot } from "../../src/types";
import { loadRealSnapshot, makeConfig, makeMockDb } from "../_helpers";

const realSnapshot: Snapshot = loadRealSnapshot();

const db = makeMockDb();

function makeMemberAFans(): number[] {
  const fans = new Array(32).fill(0);
  fans[0] = 1000;
  for (let i = 1; i < 9; i++) {
    fans[i] = 1000 * (i + 1);
  }
  return fans;
}

describe("countActiveDaysUpTo consecutive streak counting", () => {
  // The function is not exported, so we test via detectAlerts.

  it("reports the streak that just broke (not total active days or max streak)", async () => {
    // Construct data where:
    // - Member A pushes latestDataDay to 9
    // - Member B (StreakTest) has:
    //   Day 1: baseline (1000)
    //   Days 2-6: active (+1000 each, streak of 5)
    //   Day 7: same as day 6 (gain 0, streak breaks)
    //   Days 8-9: 0
    // The streak that just broke = 5 (days 2-6)

    const memberAFans = makeMemberAFans();

    const memberBFans = new Array(32).fill(0);
    memberBFans[0] = 1000; // day 1: baseline
    memberBFans[1] = 2000; // day 2: +1000 (streak start)
    memberBFans[2] = 3000; // day 3: +1000
    memberBFans[3] = 4000; // day 4: +1000
    memberBFans[4] = 5000; // day 5: +1000
    memberBFans[5] = 6000; // day 6: +1000 (streak end = 5)
    memberBFans[6] = 6000; // day 7: +0 (streak breaks)

    const snapshot: Snapshot = {
      ...realSnapshot,
      members: [
        {
          id: 1,
          circle_id: 1,
          viewer_id: 11111,
          trainer_name: "MemberA",
          shame_score: null,
          year: 2026,
          month: 6,
          daily_fans: memberAFans,
          last_updated: "2026-06-12T00:00:00Z",
        },
        {
          id: 2,
          circle_id: 1,
          viewer_id: 99999,
          trainer_name: "StreakTest",
          shame_score: null,
          year: 2026,
          month: 6,
          daily_fans: memberBFans,
          last_updated: "2026-06-12T00:00:00Z",
        },
      ],
    };

    const config = makeConfig({
      alerts: { streakBreak: { enabled: true } },
    });

    const alerts = await detectAlerts(
      computeMembers(snapshot, config),
      snapshot,
      config,
      db,
    );
    const streakAlerts = alerts.filter(
      (a) => a.type === "streak_break" && a.memberViewerId === "99999",
    );

    expect(streakAlerts.length).toBe(1);

    expect(streakAlerts[0].message).toContain("5 hari aktif berturut-turut");
  });

  it("no streak break when broken streak is below threshold", async () => {
    // Fixture encodes a streak below the src threshold — pin it so changes break loudly.
    expect(MIN_STREAK_DAYS).toBe(3);
    // Member had a 1-day streak that broke — below MIN_STREAK_DAYS threshold
    const memberAFans = makeMemberAFans();

    const memberBFans = new Array(32).fill(0);
    memberBFans[0] = 1000; // day 1: baseline
    // day 2: gap (0)
    memberBFans[2] = 2000; // day 3: new data (prev=0, gain=0)
    memberBFans[3] = 3000; // day 4: +1000 (1-day streak)
    memberBFans[4] = 3000; // day 5: +0 (streak breaks, only 1 day)

    const snapshot: Snapshot = {
      ...realSnapshot,
      members: [
        {
          id: 1,
          circle_id: 1,
          viewer_id: 11111,
          trainer_name: "MemberA",
          shame_score: null,
          year: 2026,
          month: 6,
          daily_fans: memberAFans,
          last_updated: "2026-06-12T00:00:00Z",
        },
        {
          id: 2,
          circle_id: 1,
          viewer_id: 99999,
          trainer_name: "ShortStreak",
          shame_score: null,
          year: 2026,
          month: 6,
          daily_fans: memberBFans,
          last_updated: "2026-06-12T00:00:00Z",
        },
      ],
    };

    const config = makeConfig({
      alerts: { streakBreak: { enabled: true } },
    });

    const alerts = await detectAlerts(
      computeMembers(snapshot, config),
      snapshot,
      config,
      db,
    );
    const streakAlerts = alerts.filter(
      (a) => a.type === "streak_break" && a.memberViewerId === "99999",
    );

    expect(streakAlerts.length).toBe(0);
  });
});
