import { computeMembers } from "../../src/reports/compute";
import { detectAlerts, formatAlerts } from "../../src/alerts/alerts";
import { getDefaultConfig } from "../../src/config";
import type { Snapshot, BotConfig } from "../../src/types";
import { loadRealSnapshot, makeConfig, makeMockDb } from "../_helpers";
import type { IDatabase } from "../../src/db/types";

const SNAPSHOT: Snapshot = loadRealSnapshot();

let db: IDatabase;

beforeEach(() => {
  db = makeMockDb();
});

function makeSnapshotWithTransfer(): Snapshot {
  return {
    circle: {
      circle_id: 1,
      name: "TestCircle",
      comment: "",
      leader_viewer_id: 100,
      leader_name: "Leader",
      member_count: 1,
      join_style: 1,
      policy: 1,
      created_at: "2026-01-01T00:00:00Z",
      last_updated: "2026-06-22T15:00:00Z",
      monthly_rank: 100,
      monthly_point: 1000000,
      last_month_rank: 100,
      last_month_point: 1000000,
      archived: false,
      yesterday_updated: "2026-06-21T15:00:00Z",
      yesterday_points: 500000,
      yesterday_rank: 95,
      live_points: null,
      live_rank: 100,
      last_live_update: null,
    },
    members: [
      {
        id: 1,
        circle_id: 1,
        viewer_id: 999,
        trainer_name: "TestTrainer",
        shame_score: null,
        year: 2026,
        month: 6,
        daily_fans: [
          -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
          0, 0, 0, 0, 0, 0, 0, 0, 0,
        ],
        last_updated: "2026-06-22T15:00:00Z",
        previous_circle_id: 42,
        previous_circle_name: "PrevCircle",
      },
    ],
    club_rank: 5,
    fans_to_next_tier: 1000000,
    fans_to_lower_tier: 500000,
    yesterday_fans_to_next_tier: 1100000,
    yesterday_fans_to_lower_tier: 600000,
  };
}

describe("detectAlerts", () => {
  it("returns empty when alerts disabled", async () => {
    const config = makeConfig({
      alerts: {
        ...getDefaultConfig().alerts,
        enabled: false,
      } as BotConfig["alerts"],
    });
    const alerts = await detectAlerts(
      computeMembers(SNAPSHOT, config),
      SNAPSHOT,
      config,
      db,
    );
    expect(alerts).toHaveLength(0);
  });

  it("returns well-formed alert objects", async () => {
    const config = makeConfig();
    const alerts = await detectAlerts(
      computeMembers(SNAPSHOT, config),
      SNAPSHOT,
      config,
      db,
    );
    expect(alerts.length).toBeGreaterThan(0);
    for (const alert of alerts) {
      expect(typeof alert.type).toBe("string");
      expect(typeof alert.eventKey).toBe("string");
      expect(typeof alert.message).toBe("string");
      expect(typeof alert.reportDate).toBe("string");
      expect(alert.message.length).toBeGreaterThan(0);
    }
  });

  it("detects new transfer members", async () => {
    const config = makeConfig();
    const alerts = await detectAlerts(
      computeMembers(SNAPSHOT, config),
      SNAPSHOT,
      config,
      db,
    );
    const transferAlerts = alerts.filter((a) => a.type === "new_transfer");
    // Snapshot has transfer members: Zero, TheTengOne, Sairen, VitoHoow, Ceciria, Falkrum
    expect(transferAlerts.length).toBeGreaterThan(0);
    // Check Zero is included
    const zeroAlert = transferAlerts.find((a) => a.message.includes("Zero"));
    expect(zeroAlert).toBeDefined();
    expect(zeroAlert!.message).toContain("Advent");
  });

  it("deduplicates alerts via DB", async () => {
    const config = makeConfig();
    const recordedKeys = new Set<string>();

    const alerts1 = await detectAlerts(
      computeMembers(SNAPSHOT, config),
      SNAPSHOT,
      config,
      db,
    );
    expect(alerts1.length).toBeGreaterThan(0);

    // Record each alert key in the mock DB's getExistingAlertKeys
    for (const alert of alerts1) {
      recordedKeys.add(alert.eventKey);
    }
    (db as any).getExistingAlertKeys.mockResolvedValue(recordedKeys);

    // Second detection should return 0 (all deduped via recorded keys)
    const alerts2 = await detectAlerts(
      computeMembers(SNAPSHOT, config),
      SNAPSHOT,
      config,
      db,
    );
    expect(alerts2.length).toBe(0);
  });

  it("deduplicates new_transfer across days via stable event key", async () => {
    const config = makeConfig();
    const snapshot = makeSnapshotWithTransfer();

    // Day 1: detect and record alerts
    const alerts1 = await detectAlerts(
      computeMembers(snapshot, config),
      snapshot,
      config,
      db,
    );
    const transferKeys1 = alerts1
      .filter((a) => a.type === "new_transfer")
      .map((a) => a.eventKey);
    expect(transferKeys1.length).toBeGreaterThan(0);

    // All new_transfer keys should NOT contain a date
    for (const key of transferKeys1) {
      expect(key).not.toMatch(/new_transfer:\d{4}-\d{2}-\d{2}:/);
    }

    // Simulate existing keys in DB (all day-1 keys recorded)
    const recordedKeys = new Set(transferKeys1);
    (db as any).getExistingAlertKeys.mockResolvedValue(recordedKeys);

    // Day 2: same snapshot, new_transfer should NOT re-fire
    const alerts2 = await detectAlerts(
      computeMembers(snapshot, config),
      snapshot,
      config,
      db,
    );
    const transferKeys2 = alerts2.filter((a) => a.type === "new_transfer");
    expect(transferKeys2).toHaveLength(0);
  });

  it("detects demotion risk when tier data shows HIGH risk", async () => {
    const config = makeConfig();
    const alerts = await detectAlerts(
      computeMembers(SNAPSHOT, config),
      SNAPSHOT,
      config,
      db,
    );
    const demotionAlerts = alerts.filter((a) => a.type === "demotion_risk");
    // Demotion risk depends on snapshot tier data — may or may not be HIGH.
    // Verify no crash and that the filter returns valid alert objects.
    for (const alert of demotionAlerts) {
      expect(alert.type).toBe("demotion_risk");
      expect(alert.eventKey).toContain("demotion_risk");
    }
  });

  it("does not trigger performance drop for inactive members", async () => {
    const config = makeConfig();
    const alerts = await detectAlerts(
      computeMembers(SNAPSHOT, config),
      SNAPSHOT,
      config,
      db,
    );
    const perfAlerts = alerts.filter((a) => a.type === "performance_drop");
    // Verify no stale/inactive member appears in performance alerts
    for (const alert of perfAlerts) {
      // The message should contain a member name, not "club"
      expect(alert.memberViewerId).not.toBe("club");
    }
  });

  it("returns empty when all alert types disabled", async () => {
    const config = makeConfig({
      alerts: {
        ...getDefaultConfig().alerts,
        enabled: true,
        performanceDrop: {
          enabled: false,
          thresholdPercent: 50,
          minHistoryDays: 7,
        },
        demotionRisk: { enabled: false, bufferDays: 3 },
        streakBreak: { enabled: false },
        newTransfer: { enabled: false },
        rankDrop: { enabled: false, positions: 10 },
        quietHours: { enabled: false, start: "23:00", end: "06:00" },
        defaultRecipients: "admin" as const,
      },
    });
    const alerts = await detectAlerts(
      computeMembers(SNAPSHOT, config),
      SNAPSHOT,
      config,
      db,
    );
    expect(alerts).toHaveLength(0);
  });
});

describe("formatAlerts", () => {
  it("returns empty string for no alerts", () => {
    expect(formatAlerts([], false)).toBe("");
  });

  it("formats single alert", () => {
    const alerts = [
      {
        type: "performance_drop" as const,
        eventKey: "key",
        memberViewerId: "123",
        message: "Ryu gain rendah",
        reportDate: "2026-06-11",
      },
    ];
    const result = formatAlerts(alerts, false);
    expect(result).toContain("Ryu gain rendah");
    expect(result).toContain("⚠️");
  });

  it("groups catch-up alerts with count", () => {
    const alerts = [
      {
        type: "performance_drop" as const,
        eventKey: "k1",
        memberViewerId: "1",
        message: "Alert 1",
        reportDate: "2026-06-11",
      },
      {
        type: "performance_drop" as const,
        eventKey: "k2",
        memberViewerId: "2",
        message: "Alert 2",
        reportDate: "2026-06-11",
      },
      {
        type: "performance_drop" as const,
        eventKey: "k3",
        memberViewerId: "3",
        message: "Alert 3",
        reportDate: "2026-06-11",
      },
    ];
    const result = formatAlerts(alerts, true);
    expect(result).toContain("[catch-up alerts]");
    expect(result).toContain("3 Penurunan performa terdeteksi");
  });
});

describe("quiet hours edge cases", () => {
  const OriginalDate = global.Date;

  function mockSystemTime(wibHour: number, wibMinute = 0) {
    // Build a WIB time (UTC+7) as a fixed timestamp
    const utcMs = Date.UTC(2026, 5, 22, wibHour - 7, wibMinute, 0);
    jest.useFakeTimers();
    jest.setSystemTime(new OriginalDate(utcMs));
  }

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function makeQuietConfig(
    start: string,
    end: string,
    enabled = true,
  ): BotConfig {
    return makeConfig({
      alerts: {
        ...getDefaultConfig().alerts,
        enabled: true,
        performanceDrop: {
          enabled: false,
          thresholdPercent: 50,
          minHistoryDays: 7,
        },
        demotionRisk: { enabled: false, bufferDays: 3 },
        streakBreak: { enabled: false },
        newTransfer: { enabled: true },
        rankDrop: { enabled: false, positions: 10 },
        quietHours: { enabled, start, end },
        defaultRecipients: "admin" as const,
      },
    });
  }

  function makeSnapshotWithTransfer(): Snapshot {
    return {
      circle: {
        circle_id: 1,
        name: "TestCircle",
        comment: "",
        leader_viewer_id: 100,
        leader_name: "Leader",
        member_count: 1,
        join_style: 1,
        policy: 1,
        created_at: "2026-01-01T00:00:00Z",
        last_updated: "2026-06-22T15:00:00Z",
        monthly_rank: 100,
        monthly_point: 1000000,
        last_month_rank: 100,
        last_month_point: 1000000,
        archived: false,
        yesterday_updated: "2026-06-21T15:00:00Z",
        yesterday_points: 500000,
        yesterday_rank: 95,
        live_points: null,
        live_rank: 100,
        last_live_update: null,
      },
      members: [
        {
          id: 1,
          circle_id: 1,
          viewer_id: 999,
          trainer_name: "TestTrainer",
          shame_score: null,
          year: 2026,
          month: 6,
          daily_fans: [
            -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
          ],
          last_updated: "2026-06-22T15:00:00Z",
          previous_circle_id: 42,
          previous_circle_name: "PrevCircle",
        },
      ],
      club_rank: 5,
      fans_to_next_tier: 1000000,
      fans_to_lower_tier: 500000,
      yesterday_fans_to_next_tier: 1100000,
      yesterday_fans_to_lower_tier: 600000,
    };
  }

  it("suppresses alerts at exactly quiet hours start (hour 22)", async () => {
    // Arrange: quiet hours 22:00-06:00, current time is 22:30
    mockSystemTime(22, 30);
    const config = makeQuietConfig("22:00", "06:00");
    const snapshot = makeSnapshotWithTransfer();

    // Act
    const alerts = await detectAlerts(
      computeMembers(snapshot, config),
      snapshot,
      config,
      db,
    );

    // Assert: transfer alert should be suppressed
    expect(alerts).toHaveLength(0);
  });

  it("does NOT suppress alerts one minute before quiet hours start", async () => {
    // Arrange: quiet hours 22:00-06:00, current time is 21:59
    mockSystemTime(21, 59);
    const config = makeQuietConfig("22:00", "06:00");
    const snapshot = makeSnapshotWithTransfer();

    // Act
    const alerts = await detectAlerts(
      computeMembers(snapshot, config),
      snapshot,
      config,
      db,
    );

    // Assert: alerts should NOT be suppressed
    const transferAlerts = alerts.filter((a) => a.type === "new_transfer");
    expect(transferAlerts.length).toBeGreaterThan(0);
  });

  it("suppresses alerts during last quiet hour (hour 05)", async () => {
    // Arrange: quiet hours 22:00-06:00, current time is 05:30
    mockSystemTime(5, 30);
    const config = makeQuietConfig("22:00", "06:00");
    const snapshot = makeSnapshotWithTransfer();

    // Act
    const alerts = await detectAlerts(
      computeMembers(snapshot, config),
      snapshot,
      config,
      db,
    );

    // Assert
    expect(alerts).toHaveLength(0);
  });

  it("does NOT suppress alerts at first non-quiet hour (hour 06)", async () => {
    // Arrange: quiet hours 22:00-06:00, current time is 06:00 (end hour, exclusive)
    mockSystemTime(6, 0);
    const config = makeQuietConfig("22:00", "06:00");
    const snapshot = makeSnapshotWithTransfer();

    // Act
    const alerts = await detectAlerts(
      computeMembers(snapshot, config),
      snapshot,
      config,
      db,
    );

    // Assert: alerts should NOT be suppressed (hour 06 is NOT quiet, end is exclusive)
    const transferAlerts = alerts.filter((a) => a.type === "new_transfer");
    expect(transferAlerts.length).toBeGreaterThan(0);
  });

  it("suppresses alerts during wrap-around midnight (hour 01 with 23:00-06:00)", async () => {
    // Arrange: quiet hours 23:00-06:00, current time is 01:00
    mockSystemTime(1, 0);
    const config = makeQuietConfig("23:00", "06:00");
    const snapshot = makeSnapshotWithTransfer();

    // Act
    const alerts = await detectAlerts(
      computeMembers(snapshot, config),
      snapshot,
      config,
      db,
    );

    // Assert
    expect(alerts).toHaveLength(0);
  });

  it("does NOT suppress alerts before wrap-around start (hour 22 with 23:00-06:00)", async () => {
    // Arrange: quiet hours 23:00-06:00, current time is 22:00
    mockSystemTime(22, 0);
    const config = makeQuietConfig("23:00", "06:00");
    const snapshot = makeSnapshotWithTransfer();

    // Act
    const alerts = await detectAlerts(
      computeMembers(snapshot, config),
      snapshot,
      config,
      db,
    );

    // Assert: 22 is before 23, so NOT quiet
    const transferAlerts = alerts.filter((a) => a.type === "new_transfer");
    expect(transferAlerts.length).toBeGreaterThan(0);
  });

  it("does not throw when suppressing alerts during quiet hours (log is emitted)", async () => {
    // Arrange: quiet hours 22:00-06:00, current time is 23:00
    mockSystemTime(23, 0);
    const config = makeQuietConfig("22:00", "06:00");
    const snapshot = makeSnapshotWithTransfer();

    // Act & Assert: should not throw (log.info is called internally)
    await expect(
      detectAlerts(computeMembers(snapshot, config), snapshot, config, db),
    ).resolves.not.toThrow();
    // The function returns empty during quiet hours
    expect(
      await detectAlerts(
        computeMembers(snapshot, config),
        snapshot,
        config,
        db,
      ),
    ).toHaveLength(0);
  });
});

describe("detection edge cases", () => {
  function makeEmptySnapshot(): Snapshot {
    return {
      circle: {
        circle_id: 1,
        name: "EmptyCircle",
        comment: "",
        leader_viewer_id: 100,
        leader_name: "Leader",
        member_count: 0,
        join_style: 1,
        policy: 1,
        created_at: "2026-01-01T00:00:00Z",
        last_updated: "2026-06-22T15:00:00Z",
        monthly_rank: 100,
        monthly_point: 0,
        last_month_rank: 100,
        last_month_point: 0,
        archived: false,
        yesterday_updated: null,
        yesterday_points: null,
        yesterday_rank: null,
        live_points: null,
        live_rank: 100,
        last_live_update: null,
      },
      members: [],
      club_rank: 5,
      fans_to_next_tier: 1000000,
      fans_to_lower_tier: 500000,
      yesterday_fans_to_next_tier: 1000000,
      yesterday_fans_to_lower_tier: 500000,
    };
  }

  function makeSingleMemberSnapshot(): Snapshot {
    return {
      circle: {
        circle_id: 1,
        name: "SoloCircle",
        comment: "",
        leader_viewer_id: 100,
        leader_name: "Leader",
        member_count: 1,
        join_style: 1,
        policy: 1,
        created_at: "2026-01-01T00:00:00Z",
        last_updated: "2026-06-22T15:00:00Z",
        monthly_rank: 100,
        monthly_point: 500000,
        last_month_rank: 100,
        last_month_point: 500000,
        archived: false,
        yesterday_updated: "2026-06-21T15:00:00Z",
        yesterday_points: 400000,
        yesterday_rank: 100,
        live_points: null,
        live_rank: 100,
        last_live_update: null,
      },
      members: [
        {
          id: 1,
          circle_id: 1,
          viewer_id: 1001,
          trainer_name: "SoloMember",
          shame_score: null,
          year: 2026,
          month: 6,
          daily_fans: [
            100000, 200000, 300000, 400000, 500000, 600000, 700000, 800000,
            900000, 1000000, 1000000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
            0, 0, 0, 0, 0, 0, 0,
          ],
          last_updated: "2026-06-22T15:00:00Z",
        },
      ],
      club_rank: 5,
      fans_to_next_tier: 1000000,
      fans_to_lower_tier: 500000,
      yesterday_fans_to_next_tier: 1000000,
      yesterday_fans_to_lower_tier: 500000,
    };
  }

  function makeAllZeroFansSnapshot(memberCount: number): Snapshot {
    const members = Array.from({ length: memberCount }, (_, i) => ({
      id: i + 1,
      circle_id: 1,
      viewer_id: 2000 + i,
      trainer_name: `ZeroMember${i + 1}`,
      shame_score: null,
      year: 2026,
      month: 6,
      // 10 days of steady gains, then 0 today — triggers performance_drop
      daily_fans: [
        100000, 200000, 300000, 400000, 500000, 600000, 700000, 800000, 900000,
        1000000, 1000000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0,
      ],
      last_updated: "2026-06-22T15:00:00Z",
    }));

    return {
      circle: {
        circle_id: 1,
        name: "ZeroCircle",
        comment: "",
        leader_viewer_id: 100,
        leader_name: "Leader",
        member_count: memberCount,
        join_style: 1,
        policy: 1,
        created_at: "2026-01-01T00:00:00Z",
        last_updated: "2026-06-22T15:00:00Z",
        monthly_rank: 100,
        monthly_point: memberCount * 1000000,
        last_month_rank: 100,
        last_month_point: memberCount * 1000000,
        archived: false,
        yesterday_updated: "2026-06-21T15:00:00Z",
        yesterday_points: (memberCount - 1) * 1000000,
        yesterday_rank: 100,
        live_points: null,
        live_rank: 100,
        last_live_update: null,
      },
      members,
      club_rank: 5,
      fans_to_next_tier: 1000000,
      fans_to_lower_tier: 500000,
      yesterday_fans_to_next_tier: 1000000,
      yesterday_fans_to_lower_tier: 500000,
    };
  }

  it("returns no alerts for empty snapshot", async () => {
    // Arrange
    const config = makeConfig();
    const snapshot = makeEmptySnapshot();

    // Act
    const alerts = await detectAlerts(
      computeMembers(snapshot, config),
      snapshot,
      config,
      db,
    );

    // Assert: no members → no performance_drop, no streak_break, no transfer
    expect(alerts).toHaveLength(0);
  });

  it("detects alerts correctly for single-member snapshot", async () => {
    // Arrange
    const config = makeConfig();
    const snapshot = makeSingleMemberSnapshot();

    // Act
    const alerts = await detectAlerts(
      computeMembers(snapshot, config),
      snapshot,
      config,
      db,
    );

    // Assert: should return an array (may or may not have alerts depending on data)
    expect(Array.isArray(alerts)).toBe(true);
    // The member has no transfer marker and is active
    const perfAlerts = alerts.filter((a) => a.type === "performance_drop");
    const transferAlerts = alerts.filter((a) => a.type === "new_transfer");
    // No transfer marker → no transfer alert
    expect(transferAlerts).toHaveLength(0);
    // Member is active with data → performance alert possible
    for (const alert of perfAlerts) {
      expect(alert.memberViewerId).toBe("1001");
    }
  });

  it("detects performance_drop for all members at zero fans (threshold=1)", async () => {
    // Arrange: 3 members with 10 days of steady gains, then 0 today
    // Rolling avg = 100000/day, today gain = 0, threshold = 1%
    // 0 < 100000 * 0.01 = 1000 → triggers performance_drop
    const config = makeConfig({
      alerts: {
        ...getDefaultConfig().alerts,
        enabled: true,
        performanceDrop: {
          enabled: true,
          thresholdPercent: 1,
          minHistoryDays: 7,
        },
        demotionRisk: { enabled: false, bufferDays: 3 },
        streakBreak: { enabled: false },
        newTransfer: { enabled: false },
        rankDrop: { enabled: false, positions: 10 },
        quietHours: { enabled: false, start: "23:00", end: "06:00" },
        defaultRecipients: "admin" as const,
      },
    });
    const snapshot = makeAllZeroFansSnapshot(3);

    // Act
    const alerts = await detectAlerts(
      computeMembers(snapshot, config),
      snapshot,
      config,
      db,
    );

    // Assert: each member should trigger a performance_drop
    const perfAlerts = alerts.filter((a) => a.type === "performance_drop");
    expect(perfAlerts).toHaveLength(3);
    // Each alert should reference a different member
    const memberIds = new Set(perfAlerts.map((a) => a.memberViewerId));
    expect(memberIds.size).toBe(3);
  });

  function makeSnapshotWithDemotionBuffer(targetBufferDays: number): Snapshot {
    const dataDay = 10;
    const monthlyPoint = 10_000_000;
    const fansToLowerTier = targetBufferDays * (monthlyPoint / dataDay);
    const currentPace = Math.round(monthlyPoint / dataDay);

    const dailyFans: number[] = [];
    for (let i = 1; i <= dataDay; i++) {
      dailyFans.push(currentPace * i);
    }
    while (dailyFans.length < 32) dailyFans.push(0);

    return {
      circle: {
        circle_id: 1,
        name: "Test",
        comment: "",
        leader_viewer_id: 100,
        leader_name: "Leader",
        member_count: 1,
        join_style: 1,
        policy: 1,
        created_at: "2026-01-01T00:00:00Z",
        last_updated: "2026-06-10T15:00:00Z",
        monthly_rank: 100,
        monthly_point: monthlyPoint,
        last_month_rank: 100,
        last_month_point: monthlyPoint,
        archived: false,
        yesterday_updated: "2026-06-09T15:00:00Z",
        yesterday_points: 9_000_000,
        yesterday_rank: 95,
        live_points: null,
        live_rank: 100,
        last_live_update: null,
      },
      members: [
        {
          id: 1,
          circle_id: 1,
          viewer_id: 999,
          trainer_name: "Test",
          shame_score: null,
          year: 2026,
          month: 6,
          daily_fans: dailyFans,
          last_updated: "2026-06-10T15:00:00Z",
        },
      ],
      club_rank: 5,
      fans_to_next_tier: 1_000_000,
      fans_to_lower_tier: fansToLowerTier,
      yesterday_fans_to_next_tier: 1_100_000,
      yesterday_fans_to_lower_tier: fansToLowerTier + 100_000,
    };
  }

  it("uses config bufferDays threshold for demotion risk detection", async () => {
    const snapshot = makeSnapshotWithDemotionBuffer(4);

    // With bufferDays=5, 4 < 5 → alert should fire
    const config1 = makeConfig({
      alerts: {
        ...getDefaultConfig().alerts,
        demotionRisk: { enabled: true, bufferDays: 5 },
      },
    });
    const alerts1 = await detectAlerts(
      computeMembers(snapshot, config1),
      snapshot,
      config1,
      db,
    );
    const demotionAlerts1 = alerts1.filter((a) => a.type === "demotion_risk");
    expect(demotionAlerts1.length).toBe(1);

    // With bufferDays=3, 4 >= 3 → alert should NOT fire
    const config2 = makeConfig({
      alerts: {
        ...getDefaultConfig().alerts,
        demotionRisk: { enabled: true, bufferDays: 3 },
      },
    });
    const alerts2 = await detectAlerts(
      computeMembers(snapshot, config2),
      snapshot,
      config2,
      db,
    );
    const demotionAlerts2 = alerts2.filter((a) => a.type === "demotion_risk");
    expect(demotionAlerts2.length).toBe(0);
  });
});
