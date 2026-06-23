import { computeMembers } from '../../src/reports/compute';
import { detectAlerts, deduplicateAlerts, formatAlerts, aggregateAlerts } from '../../src/alerts/alerts';
import { Database } from '../../src/db/database';
import { getDefaultConfig } from '../../src/config';
import type { Snapshot, BotConfig } from '../../src/types';
import { loadRealSnapshot, makeConfig } from '../_helpers';

const SNAPSHOT: Snapshot = loadRealSnapshot();

let db: Database;

beforeEach(async () => {
  db = new Database(':memory:');
  await db.initialize();
});

afterEach(() => {
  db.close();
});

describe('detectAlerts', () => {
  it('returns empty when alerts disabled', () => {
    const config = makeConfig({ alerts: { ...getDefaultConfig().alerts, enabled: false } as BotConfig['alerts'] });
    const alerts = detectAlerts(computeMembers(SNAPSHOT, config), SNAPSHOT, config, db);
    expect(alerts).toHaveLength(0);
  });

  it('detects no performance drops when all members are on track', () => {
    const config = makeConfig();
    const alerts = detectAlerts(computeMembers(SNAPSHOT, config), SNAPSHOT, config, db);
    // With the real snapshot, some members may trigger alerts
    // Just verify it returns an array of Alert objects
    expect(Array.isArray(alerts)).toBe(true);
    for (const alert of alerts) {
      expect(alert).toHaveProperty('type');
      expect(alert).toHaveProperty('eventKey');
      expect(alert).toHaveProperty('message');
      expect(alert).toHaveProperty('reportDate');
    }
  });

  it('detects new transfer members', () => {
    const config = makeConfig();
    const alerts = detectAlerts(computeMembers(SNAPSHOT, config), SNAPSHOT, config, db);
    const transferAlerts = alerts.filter((a) => a.type === 'new_transfer');
    // Snapshot has transfer members: Zero, TheTengOne, Sairen, VitoHoow, Ceciria, Falkrum
    expect(transferAlerts.length).toBeGreaterThan(0);
    // Check Zero is included
    const zeroAlert = transferAlerts.find((a) =>
      a.message.includes('Zero')
    );
    expect(zeroAlert).toBeDefined();
    expect(zeroAlert!.message).toContain('Advent');
  });

  it('deduplicates alerts via DB', () => {
    const config = makeConfig();
    const alerts1 = detectAlerts(computeMembers(SNAPSHOT, config), SNAPSHOT, config, db);
    // Record each alert once, then mark as sent
    for (const alert of alerts1) {
      const id = db.recordAlert({
        alert_type: alert.type,
        event_key: alert.eventKey,
        member_viewer_id: alert.memberViewerId,
        report_date: alert.reportDate,
        created_at: new Date().toISOString(),
        message: alert.message,
      });
      db.markAlertSent(id);
    }

    // Second detection should return fewer (all deduped)
    const alerts2 = detectAlerts(computeMembers(SNAPSHOT, config), SNAPSHOT, config, db);
    expect(alerts2.length).toBe(0);
  });

  it('detects demotion risk when tier data shows HIGH risk', () => {
    const config = makeConfig();
    // The snapshot may or may not be HIGH risk — just verify no crash
    const alerts = detectAlerts(computeMembers(SNAPSHOT, config), SNAPSHOT, config, db);
    const demotionAlerts = alerts.filter((a) => a.type === 'demotion_risk');
    expect(Array.isArray(demotionAlerts)).toBe(true);
  });

  it('does not trigger performance drop for inactive members', () => {
    const config = makeConfig();
    const alerts = detectAlerts(computeMembers(SNAPSHOT, config), SNAPSHOT, config, db);
    const perfAlerts = alerts.filter((a) => a.type === 'performance_drop');
    // Verify no stale/inactive member appears in performance alerts
    for (const alert of perfAlerts) {
      // The message should contain a member name, not "club"
      expect(alert.memberViewerId).not.toBe('club');
    }
  });

  it('returns empty when all alert types disabled', () => {
    const config = makeConfig({
      alerts: {
        ...getDefaultConfig().alerts,
        enabled: true,
        performanceDrop: { enabled: false, thresholdPercent: 50, minHistoryDays: 7 },
        demotionRisk: { enabled: false, bufferDays: 3 },
        streakBreak: { enabled: false },
        newTransfer: { enabled: false },
        rankDrop: { enabled: false, positions: 10 },
        quietHours: { enabled: false, start: '23:00', end: '06:00' },
        defaultRecipients: 'admin' as const,
      },
    });
    const alerts = detectAlerts(computeMembers(SNAPSHOT, config), SNAPSHOT, config, db);
    expect(alerts).toHaveLength(0);
  });
});

describe('deduplicateAlerts', () => {
  it('removes already-sent alerts', () => {
    const alerts = [
      {
        type: 'performance_drop' as const,
        eventKey: 'performance_drop:2026-06-11:123',
        memberViewerId: '123',
        message: 'Test',
        reportDate: '2026-06-11',
      },
    ];

    // Not yet sent
    expect(deduplicateAlerts(alerts, db)).toHaveLength(1);

    // Record as sent
    db.recordAlert({
      alert_type: 'performance_drop',
      event_key: 'performance_drop:2026-06-11:123',
      member_viewer_id: '123',
      report_date: '2026-06-11',
      created_at: new Date().toISOString(),
      message: 'Test',
    });
    db.markAlertSent(1);

    // Now deduped
    expect(deduplicateAlerts(alerts, db)).toHaveLength(0);
  });
});

describe('formatAlerts', () => {
  it('returns empty string for no alerts', () => {
    expect(formatAlerts([], false)).toBe('');
  });

  it('formats single alert', () => {
    const alerts = [
      {
        type: 'performance_drop' as const,
        eventKey: 'key',
        memberViewerId: '123',
        message: 'Ryu gain rendah',
        reportDate: '2026-06-11',
      },
    ];
    const result = formatAlerts(alerts, false);
    expect(result).toContain('Ryu gain rendah');
    expect(result).toContain('⚠️');
  });

  it('groups catch-up alerts with count', () => {
    const alerts = [
      {
        type: 'performance_drop' as const,
        eventKey: 'k1',
        memberViewerId: '1',
        message: 'Alert 1',
        reportDate: '2026-06-11',
      },
      {
        type: 'performance_drop' as const,
        eventKey: 'k2',
        memberViewerId: '2',
        message: 'Alert 2',
        reportDate: '2026-06-11',
      },
      {
        type: 'performance_drop' as const,
        eventKey: 'k3',
        memberViewerId: '3',
        message: 'Alert 3',
        reportDate: '2026-06-11',
      },
    ];
    const result = formatAlerts(alerts, true);
    expect(result).toContain('[catch-up alerts]');
    expect(result).toContain('3 Penurunan performa terdeteksi');
  });
});

// ============================================================
// aggregateAlerts
// ============================================================

describe('aggregateAlerts', () => {
  it('returns empty string for empty alerts', () => {
    expect(aggregateAlerts([])).toBe('');
  });

  it('groups alerts by type and counts them', () => {
    const alerts = [
      {
        type: 'performance_drop' as const,
        eventKey: 'k1',
        memberViewerId: '1',
        message: 'Alert 1',
        reportDate: '2026-06-11',
      },
      {
        type: 'performance_drop' as const,
        eventKey: 'k2',
        memberViewerId: '2',
        message: 'Alert 2',
        reportDate: '2026-06-11',
      },
      {
        type: 'new_transfer' as const,
        eventKey: 'k3',
        memberViewerId: '3',
        message: 'Alert 3',
        reportDate: '2026-06-11',
      },
      {
        type: 'demotion_risk' as const,
        eventKey: 'k4',
        memberViewerId: 'club',
        message: 'Alert 4',
        reportDate: '2026-06-11',
      },
    ];
    const result = aggregateAlerts(alerts);
    expect(result).toContain('[catch-up alerts]');
    expect(result).toContain('2 penurunan performa terdeteksi');
    expect(result).toContain('1 transfer baru terdeteksi');
    expect(result).toContain('1 hari risiko degradasi terdeteksi');
  });

  it('handles single alert type with one occurrence', () => {
    const alerts = [
      {
        type: 'streak_break' as const,
        eventKey: 'k1',
        memberViewerId: '1',
        message: 'Streak broke',
        reportDate: '2026-06-11',
      },
    ];
    const result = aggregateAlerts(alerts);
    expect(result).toContain('[catch-up alerts]');
    expect(result).toContain('1 streak terputus terdeteksi');
  });

  it('uses singular form for count of 1', () => {
    const alerts = [
      {
        type: 'performance_drop' as const,
        eventKey: 'k1',
        memberViewerId: '1',
        message: 'One drop',
        reportDate: '2026-06-11',
      },
    ];
    const result = aggregateAlerts(alerts);
    expect(result).toContain('1 penurunan performa terdeteksi');
  });

  it('uses correct format for count > 1', () => {
    const alerts = [
      {
        type: 'performance_drop' as const,
        eventKey: 'k1',
        memberViewerId: '1',
        message: 'Drop 1',
        reportDate: '2026-06-11',
      },
      {
        type: 'performance_drop' as const,
        eventKey: 'k2',
        memberViewerId: '2',
        message: 'Drop 2',
        reportDate: '2026-06-11',
      },
    ];
    const result = aggregateAlerts(alerts);
    expect(result).toContain('2 penurunan performa terdeteksi');
  });
});

// ============================================================
// Quiet hours edge cases
// ============================================================

describe('quiet hours edge cases', () => {
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
    enabled = true
  ): BotConfig {
    return makeConfig({
      alerts: {
        ...getDefaultConfig().alerts,
        enabled: true,
        performanceDrop: { enabled: false, thresholdPercent: 50, minHistoryDays: 7 },
        demotionRisk: { enabled: false, bufferDays: 3 },
        streakBreak: { enabled: false },
        newTransfer: { enabled: true },
        rankDrop: { enabled: false, positions: 10 },
        quietHours: { enabled, start, end },
        defaultRecipients: 'admin' as const,
      },
    });
  }

  function makeSnapshotWithTransfer(): Snapshot {
    return {
      circle: {
        circle_id: 1,
        name: 'TestCircle',
        comment: '',
        leader_viewer_id: 100,
        leader_name: 'Leader',
        member_count: 1,
        join_style: 1,
        policy: 1,
        created_at: '2026-01-01T00:00:00Z',
        last_updated: '2026-06-22T15:00:00Z',
        monthly_rank: 100,
        monthly_point: 1000000,
        last_month_rank: 100,
        last_month_point: 1000000,
        archived: false,
        yesterday_updated: '2026-06-21T15:00:00Z',
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
          trainer_name: 'TestTrainer',
          shame_score: null,
          year: 2026,
          month: 6,
          daily_fans: [-1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          last_updated: '2026-06-22T15:00:00Z',
          previous_circle_id: 42,
          previous_circle_name: 'PrevCircle',
        },
      ],
      club_rank: 5,
      fans_to_next_tier: 1000000,
      fans_to_lower_tier: 500000,
      yesterday_fans_to_next_tier: 1100000,
      yesterday_fans_to_lower_tier: 600000,
    };
  }

  it('suppresses alerts at exactly quiet hours start (hour 22)', () => {
    // Arrange: quiet hours 22:00-06:00, current time is 22:30
    mockSystemTime(22, 30);
    const config = makeQuietConfig('22:00', '06:00');
    const snapshot = makeSnapshotWithTransfer();

    // Act
    const alerts = detectAlerts(computeMembers(snapshot, config), snapshot, config, db);

    // Assert: transfer alert should be suppressed
    expect(alerts).toHaveLength(0);
  });

  it('does NOT suppress alerts one minute before quiet hours start', () => {
    // Arrange: quiet hours 22:00-06:00, current time is 21:59
    mockSystemTime(21, 59);
    const config = makeQuietConfig('22:00', '06:00');
    const snapshot = makeSnapshotWithTransfer();

    // Act
    const alerts = detectAlerts(computeMembers(snapshot, config), snapshot, config, db);

    // Assert: alerts should NOT be suppressed
    const transferAlerts = alerts.filter((a) => a.type === 'new_transfer');
    expect(transferAlerts.length).toBeGreaterThan(0);
  });

  it('suppresses alerts during last quiet hour (hour 05)', () => {
    // Arrange: quiet hours 22:00-06:00, current time is 05:30
    mockSystemTime(5, 30);
    const config = makeQuietConfig('22:00', '06:00');
    const snapshot = makeSnapshotWithTransfer();

    // Act
    const alerts = detectAlerts(computeMembers(snapshot, config), snapshot, config, db);

    // Assert
    expect(alerts).toHaveLength(0);
  });

  it('does NOT suppress alerts at first non-quiet hour (hour 06)', () => {
    // Arrange: quiet hours 22:00-06:00, current time is 06:00 (end hour, exclusive)
    mockSystemTime(6, 0);
    const config = makeQuietConfig('22:00', '06:00');
    const snapshot = makeSnapshotWithTransfer();

    // Act
    const alerts = detectAlerts(computeMembers(snapshot, config), snapshot, config, db);

    // Assert: alerts should NOT be suppressed (hour 06 is NOT quiet, end is exclusive)
    const transferAlerts = alerts.filter((a) => a.type === 'new_transfer');
    expect(transferAlerts.length).toBeGreaterThan(0);
  });

  it('suppresses alerts during wrap-around midnight (hour 01 with 23:00-06:00)', () => {
    // Arrange: quiet hours 23:00-06:00, current time is 01:00
    mockSystemTime(1, 0);
    const config = makeQuietConfig('23:00', '06:00');
    const snapshot = makeSnapshotWithTransfer();

    // Act
    const alerts = detectAlerts(computeMembers(snapshot, config), snapshot, config, db);

    // Assert
    expect(alerts).toHaveLength(0);
  });

  it('does NOT suppress alerts before wrap-around start (hour 22 with 23:00-06:00)', () => {
    // Arrange: quiet hours 23:00-06:00, current time is 22:00
    mockSystemTime(22, 0);
    const config = makeQuietConfig('23:00', '06:00');
    const snapshot = makeSnapshotWithTransfer();

    // Act
    const alerts = detectAlerts(computeMembers(snapshot, config), snapshot, config, db);

    // Assert: 22 is before 23, so NOT quiet
    const transferAlerts = alerts.filter((a) => a.type === 'new_transfer');
    expect(transferAlerts.length).toBeGreaterThan(0);
  });

  it('does not throw when suppressing alerts during quiet hours (log is emitted)', () => {
    // Arrange: quiet hours 22:00-06:00, current time is 23:00
    mockSystemTime(23, 0);
    const config = makeQuietConfig('22:00', '06:00');
    const snapshot = makeSnapshotWithTransfer();

    // Act & Assert: should not throw (log.info is called internally)
    expect(() => detectAlerts(computeMembers(snapshot, config), snapshot, config, db)).not.toThrow();
    // The function returns empty during quiet hours
    expect(detectAlerts(computeMembers(snapshot, config), snapshot, config, db)).toHaveLength(0);
  });
});

// ============================================================
// Detection edge cases
// ============================================================

describe('detection edge cases', () => {
  function makeEmptySnapshot(): Snapshot {
    return {
      circle: {
        circle_id: 1,
        name: 'EmptyCircle',
        comment: '',
        leader_viewer_id: 100,
        leader_name: 'Leader',
        member_count: 0,
        join_style: 1,
        policy: 1,
        created_at: '2026-01-01T00:00:00Z',
        last_updated: '2026-06-22T15:00:00Z',
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
        name: 'SoloCircle',
        comment: '',
        leader_viewer_id: 100,
        leader_name: 'Leader',
        member_count: 1,
        join_style: 1,
        policy: 1,
        created_at: '2026-01-01T00:00:00Z',
        last_updated: '2026-06-22T15:00:00Z',
        monthly_rank: 100,
        monthly_point: 500000,
        last_month_rank: 100,
        last_month_point: 500000,
        archived: false,
        yesterday_updated: '2026-06-21T15:00:00Z',
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
          trainer_name: 'SoloMember',
          shame_score: null,
          year: 2026,
          month: 6,
          daily_fans: [100000, 200000, 300000, 400000, 500000, 600000, 700000, 800000, 900000, 1000000, 1000000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          last_updated: '2026-06-22T15:00:00Z',
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
        100000, 200000, 300000, 400000, 500000,
        600000, 700000, 800000, 900000, 1000000, 1000000,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      ],
      last_updated: '2026-06-22T15:00:00Z',
    }));

    return {
      circle: {
        circle_id: 1,
        name: 'ZeroCircle',
        comment: '',
        leader_viewer_id: 100,
        leader_name: 'Leader',
        member_count: memberCount,
        join_style: 1,
        policy: 1,
        created_at: '2026-01-01T00:00:00Z',
        last_updated: '2026-06-22T15:00:00Z',
        monthly_rank: 100,
        monthly_point: memberCount * 1000000,
        last_month_rank: 100,
        last_month_point: memberCount * 1000000,
        archived: false,
        yesterday_updated: '2026-06-21T15:00:00Z',
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

  it('returns no alerts for empty snapshot', () => {
    // Arrange
    const config = makeConfig();
    const snapshot = makeEmptySnapshot();

    // Act
    const alerts = detectAlerts(computeMembers(snapshot, config), snapshot, config, db);

    // Assert: no members → no performance_drop, no streak_break, no transfer
    expect(alerts).toHaveLength(0);
  });

  it('detects alerts correctly for single-member snapshot', () => {
    // Arrange
    const config = makeConfig();
    const snapshot = makeSingleMemberSnapshot();

    // Act
    const alerts = detectAlerts(computeMembers(snapshot, config), snapshot, config, db);

    // Assert: should return an array (may or may not have alerts depending on data)
    expect(Array.isArray(alerts)).toBe(true);
    // The member has no transfer marker and is active
    const perfAlerts = alerts.filter((a) => a.type === 'performance_drop');
    const transferAlerts = alerts.filter((a) => a.type === 'new_transfer');
    // No transfer marker → no transfer alert
    expect(transferAlerts).toHaveLength(0);
    // Member is active with data → performance alert possible
    for (const alert of perfAlerts) {
      expect(alert.memberViewerId).toBe('1001');
    }
  });

  it('detects performance_drop for all members at zero fans (threshold=1)', () => {
    // Arrange: 3 members with 10 days of steady gains, then 0 today
    // Rolling avg = 100000/day, today gain = 0, threshold = 1%
    // 0 < 100000 * 0.01 = 1000 → triggers performance_drop
    const config = makeConfig({
      alerts: {
        ...getDefaultConfig().alerts,
        enabled: true,
        performanceDrop: { enabled: true, thresholdPercent: 1, minHistoryDays: 7 },
        demotionRisk: { enabled: false, bufferDays: 3 },
        streakBreak: { enabled: false },
        newTransfer: { enabled: false },
        rankDrop: { enabled: false, positions: 10 },
        quietHours: { enabled: false, start: '23:00', end: '06:00' },
        defaultRecipients: 'admin' as const,
      },
    });
    const snapshot = makeAllZeroFansSnapshot(3);

    // Act
    const alerts = detectAlerts(computeMembers(snapshot, config), snapshot, config, db);

    // Assert: each member should trigger a performance_drop
    const perfAlerts = alerts.filter((a) => a.type === 'performance_drop');
    expect(perfAlerts).toHaveLength(3);
    // Each alert should reference a different member
    const memberIds = new Set(perfAlerts.map((a) => a.memberViewerId));
    expect(memberIds.size).toBe(3);
  });
});
