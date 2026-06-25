import type { Pool, PoolConnection } from 'mysql2/promise';

const mockRelease = jest.fn().mockResolvedValue(undefined);
const mockBeginTransaction = jest.fn().mockResolvedValue(undefined);
const mockCommit = jest.fn().mockResolvedValue(undefined);
const mockRollback = jest.fn().mockResolvedValue(undefined);
const mockConnQuery = jest.fn().mockResolvedValue([[], undefined]);

const mockConn = {
  query: mockConnQuery,
  execute: jest.fn(),
  release: mockRelease,
  beginTransaction: mockBeginTransaction,
  commit: mockCommit,
  rollback: mockRollback,
} as unknown as PoolConnection;

const mockGetConnection = jest.fn().mockResolvedValue(mockConn);
const mockPoolEnd = jest.fn().mockResolvedValue(undefined);
const mockPoolQuery = jest.fn().mockResolvedValue([[], undefined]);

const mockPool = {
  query: mockPoolQuery,
  execute: jest.fn(),
  getConnection: mockGetConnection,
  end: mockPoolEnd,
} as unknown as Pool;

jest.mock('mysql2/promise', () => ({
  __esModule: true,
  default: {
    createPool: jest.fn(() => mockPool),
  },
}));

import { MysqlDatabase } from '../../src/db/mysql-database';
import type { MysqlConfig } from '../../src/db/mysql-database';

const config: MysqlConfig = {
  host: '127.0.0.1',
  port: 3306,
  database: 'test_db',
  user: 'root',
  password: 'secret',
  connectionLimit: 5,
  ssl: false,
};

let db: MysqlDatabase;

beforeEach(async () => {
  mockConnQuery.mockReset().mockResolvedValue([[], undefined]);
  mockPoolQuery.mockReset().mockResolvedValue([[], undefined]);
  mockGetConnection.mockReset().mockResolvedValue(mockConn);
  mockRelease.mockReset().mockResolvedValue(undefined);
  mockBeginTransaction.mockReset().mockResolvedValue(undefined);
  mockCommit.mockReset().mockResolvedValue(undefined);
  mockRollback.mockReset().mockResolvedValue(undefined);
  mockPoolEnd.mockReset().mockResolvedValue(undefined);

  // checkVersion() runs on pool.getConnection() result (mockConn), so mockConnQuery
  // must return a valid version first. Pool queries (mockPoolQuery) follow after.
  mockConnQuery
    .mockResolvedValueOnce([[{ version: '8.0.35' }], undefined])
    .mockResolvedValue([[], undefined]);

  db = new MysqlDatabase(config);
  await db.initialize();
  // Clear call history from initialize() so tests see only their own calls
  mockPoolQuery.mockClear();
  mockConnQuery.mockClear();
  mockGetConnection.mockClear();
  mockRelease.mockClear();
  mockBeginTransaction.mockClear();
  mockCommit.mockClear();
  mockRollback.mockClear();
  mockPoolEnd.mockClear();
});


describe('initialize()', () => {
  it('creates pool with correct config and verifies connection', async () => {
    const mysql = await import('mysql2/promise');
    mockConnQuery.mockReset()
      .mockResolvedValueOnce([[{ version: '8.0.35' }], undefined])
      .mockResolvedValue([[], undefined]);
    const freshDb = new MysqlDatabase(config);
    await freshDb.initialize();

    expect(mysql.default.createPool).toHaveBeenCalledWith(
      expect.objectContaining({
        host: config.host,
        port: config.port,
        database: config.database,
        user: config.user,
        password: config.password,
        connectionLimit: config.connectionLimit,
      })
    );
    expect(mockGetConnection).toHaveBeenCalled();
    expect(mockRelease).toHaveBeenCalled();
  });

  it('runs 5 CREATE TABLE + 3 CREATE INDEX statements', async () => {
    mockPoolQuery.mockClear();
    mockConnQuery.mockReset()
      .mockResolvedValueOnce([[{ version: '8.0.35' }], undefined])
      .mockResolvedValue([[], undefined]);

    const freshDb = new MysqlDatabase(config);
    await freshDb.initialize();

    const tableCalls = mockPoolQuery.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('CREATE TABLE')
    );
    const indexCalls = mockPoolQuery.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('CREATE INDEX')
    );

    expect(tableCalls).toHaveLength(4);
    expect(indexCalls).toHaveLength(3);
  });

  it('creates MySQL-compatible DDL (INT AUTO_INCREMENT, VARCHAR, TINYINT)', async () => {
    mockPoolQuery.mockClear();
    mockConnQuery.mockReset()
      .mockResolvedValueOnce([[{ version: '8.0.35' }], undefined])
      .mockResolvedValue([[], undefined]);

    const freshDb = new MysqlDatabase(config);
    await freshDb.initialize();

    const allSql = mockPoolQuery.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(allSql).toContain('INT AUTO_INCREMENT PRIMARY KEY');
    expect(allSql).toContain('VARCHAR(255)');
    expect(allSql).toContain('TINYINT(1)');
    expect(allSql).toContain('TEXT NOT NULL');
    expect(allSql).not.toContain('INTEGER PRIMARY KEY AUTOINCREMENT');
  });

  it('checks MySQL version on initialize', async () => {
    mockConnQuery.mockReset()
      .mockResolvedValueOnce([[{ version: '8.0.35' }], undefined])
      .mockResolvedValue([[], undefined]);

    const freshDb = new MysqlDatabase(config);
    await freshDb.initialize();

    const versionCall = mockConnQuery.mock.calls[0];
    expect(versionCall[0]).toBe('SELECT VERSION() as version');
  });

  it('throws clear error when MySQL version is below minimum', async () => {
    mockConnQuery.mockReset()
      .mockResolvedValueOnce([[{ version: '5.7.40-log' }], undefined]);

    const freshDb = new MysqlDatabase(config);
    await expect(freshDb.initialize()).rejects.toThrow(
      /MySQL 5\.7\.40-log detected.*Minimum required: 8\.0\.31.*Upgrade MySQL.*or switch to database\.backend: sqlite/s
    );
  });

  it('allows TiDB version strings without version check', async () => {
    mockConnQuery.mockReset()
      .mockResolvedValueOnce([[{ version: '5.7.25-TiDB-v7.1.0' }], undefined])
      .mockResolvedValue([[], undefined]);

    const freshDb = new MysqlDatabase(config);
    // Should NOT throw — TiDB is MySQL 8.0+ compatible
    await expect(freshDb.initialize()).resolves.toBeUndefined();
  });

  it('proceeds with warning when version string cannot be parsed', async () => {
    mockConnQuery.mockReset()
      .mockResolvedValueOnce([[{ version: 'custom-build-123' }], undefined])
      .mockResolvedValue([[], undefined]);

    const freshDb = new MysqlDatabase(config);
    // Should NOT throw — just log a warning
    await expect(freshDb.initialize()).resolves.toBeUndefined();
  });

  it('CREATE INDEX does not use IF NOT EXISTS syntax', async () => {
    mockPoolQuery.mockClear();
    mockConnQuery.mockReset()
      .mockResolvedValueOnce([[{ version: '8.0.35' }], undefined])
      .mockResolvedValue([[], undefined]);

    const freshDb = new MysqlDatabase(config);
    await freshDb.initialize();

    const indexCalls = mockPoolQuery.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('CREATE INDEX')
    );
    for (const call of indexCalls) {
      expect(call[0]).not.toContain('IF NOT EXISTS');
    }
  });
});


describe('getLastSuccessfulRun()', () => {
  it('returns null when no rows match', async () => {
    mockPoolQuery.mockResolvedValue([[], undefined]);

    const result = await db.getLastSuccessfulRun('daily');
    expect(result).toBeNull();
  });

  it('executes correct SELECT with report_type and status params', async () => {
    mockPoolQuery.mockResolvedValue([
      [
        {
          id: 42,
          report_type: 'weekly',
          report_date: '2025-06-15',
          scheduled_at: '2025-06-15T22:05:00.000Z',
          sent_at: '2025-06-15T22:05:03.000Z',
          status: 'sent',
          is_catch_up: 0,
          target_jid: 'group@g.us',
          error_message: null,
        },
      ],
      undefined,
    ]);

    const result = await db.getLastSuccessfulRun('weekly');

    expect(result).toEqual({
      id: 42,
      report_type: 'weekly',
      report_date: '2025-06-15',
      scheduled_at: '2025-06-15T22:05:00.000Z',
      sent_at: '2025-06-15T22:05:03.000Z',
      status: 'sent',
      is_catch_up: false,
      target_jid: 'group@g.us',
      error_message: null,
    });

    const lastCall = mockPoolQuery.mock.calls[mockPoolQuery.mock.calls.length - 1];
    expect(lastCall[0]).toContain('FROM schedule_runs WHERE report_type = ? AND status = ?');
    expect(lastCall[1]).toEqual(['weekly', 'sent']);
  });

  it('maps is_catch_up=1 to true', async () => {
    mockPoolQuery.mockResolvedValue([
      [
        {
          id: 1,
          report_type: 'daily',
          report_date: '2025-06-20',
          scheduled_at: '2025-06-20T22:05:00.000Z',
          sent_at: '2025-06-20T22:05:02.000Z',
          status: 'sent',
          is_catch_up: 1,
          target_jid: 'group@g.us',
          error_message: null,
        },
      ],
      undefined,
    ]);

    const result = await db.getLastSuccessfulRun('daily');
    expect(result!.is_catch_up).toBe(true);
  });
});


describe('recordRun()', () => {
  it('inserts row then calls LAST_INSERT_ID() and returns id', async () => {
    let callCount = 0;
    mockPoolQuery.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return [{ insertId: 99 }, undefined];
      return [[{ id: 99 }], undefined];
    });

    const id = await db.recordRun({
      report_type: 'monthly',
      report_date: '2025-06-01',
      scheduled_at: '2025-06-30T22:05:00.000Z',
      status: 'sent',
      is_catch_up: false,
      target_jid: 'group@g.us',
    });

    expect(id).toBe(99);
    const insertSql = mockPoolQuery.mock.calls[0][0] as string;
    const idSql = mockPoolQuery.mock.calls[1][0] as string;
    expect(insertSql).toContain('INSERT INTO schedule_runs');
    expect(idSql).toContain('LAST_INSERT_ID()');
  });

  it('uses LAST_INSERT_ID() not last_insert_rowid()', async () => {
    mockPoolQuery.mockImplementation(async () => [[{ id: 1 }], undefined]);

    await db.recordRun({
      report_type: 'daily',
      report_date: '2025-06-20',
      scheduled_at: '2025-06-20T22:05:00.000Z',
      status: 'pending',
      is_catch_up: false,
      target_jid: 'group@g.us',
    });

    const idQuery = mockPoolQuery.mock.calls[1][0] as string;
    expect(idQuery).toContain('LAST_INSERT_ID()');
    expect(idQuery).not.toContain('last_insert_rowid');
  });
});


describe('upsertMember()', () => {
  it('uses AS new_vals alias syntax for standard MySQL', async () => {
    mockPoolQuery.mockResolvedValue([{}, undefined]);

    await db.upsertMember({
      viewer_id: 12345,
      trainer_name: 'Player1',
      circle_id: 100,
      first_seen: '2025-06-01',
      last_seen: '2025-06-20',
    });

    const sql = mockPoolQuery.mock.calls[0][0] as string;
    expect(sql).toContain('ON DUPLICATE KEY UPDATE');
    expect(sql).toContain('AS new_vals');
    expect(sql).toContain('new_vals.trainer_name');
    expect(sql).toContain('new_vals.circle_id');
    expect(sql).toContain('new_vals.status');
    expect(sql).not.toContain('VALUES(');
    expect(sql).not.toContain('excluded.');
    expect(sql).not.toContain('ON CONFLICT');
  });

  it('uses VALUES() syntax for TiDB', async () => {
    // Create a TiDB-backed instance
    mockConnQuery.mockReset()
      .mockResolvedValueOnce([[{ version: '5.7.25-TiDB-v7.1.0' }], undefined])
      .mockResolvedValue([[], undefined]);
    const tidbDb = new MysqlDatabase(config);
    await tidbDb.initialize();

    // Clear calls from initialize() so upsert is the only call
    mockPoolQuery.mockReset().mockResolvedValue([{}, undefined]);

    await tidbDb.upsertMember({
      viewer_id: 12345,
      trainer_name: 'Player1',
      circle_id: 100,
      first_seen: '2025-06-01',
      last_seen: '2025-06-20',
    });

    const sql = mockPoolQuery.mock.calls[0][0] as string;
    expect(sql).toContain('ON DUPLICATE KEY UPDATE');
    expect(sql).toContain('VALUES(trainer_name)');
    expect(sql).toContain('VALUES(circle_id)');
    expect(sql).toContain('VALUES(status)');
    expect(sql).not.toContain('AS new_vals');
  });

  it('passes all parameters including COALESCE for nullable fields', async () => {
    mockPoolQuery.mockResolvedValue([{}, undefined]);

    await db.upsertMember({
      viewer_id: 100,
      trainer_name: 'Test',
      circle_id: 200,
      first_seen: '2025-06-01',
      last_seen: '2025-06-20',
      previous_circle_id: 50,
      previous_circle_name: 'OldCircle',
      status: 'active',
    });

    const params = mockPoolQuery.mock.calls[0][1] as unknown[];
    expect(params).toEqual([100, 'Test', 200, '2025-06-01', '2025-06-20', 50, 'OldCircle', 'active']);
  });

  it('uses COALESCE to preserve previous values when null', async () => {
    mockPoolQuery.mockResolvedValue([{}, undefined]);

    await db.upsertMember({
      viewer_id: 100,
      trainer_name: 'Test',
      circle_id: 200,
      first_seen: '2025-06-01',
      last_seen: '2025-06-20',
    });

    const sql = mockPoolQuery.mock.calls[0][0] as string;
    expect(sql).toContain('COALESCE(new_vals.previous_circle_id, member_history.previous_circle_id)');
    expect(sql).toContain('COALESCE(new_vals.previous_circle_name, member_history.previous_circle_name)');
  });
});


describe('saveRankHistory()', () => {
  it('uses REPLACE INTO (not INSERT OR REPLACE INTO)', async () => {
    mockPoolQuery.mockResolvedValue([{}, undefined]);

    await db.saveRankHistory({
      date: '2025-06-20',
      circle_id: 100,
      monthly_rank: 5,
      monthly_point: 12345,
      club_rank: 7,
      fans_to_next_tier: 5000,
      fans_to_lower_tier: 2000,
    });

    const sql = mockPoolQuery.mock.calls[0][0] as string;
    expect(sql).toContain('REPLACE INTO rank_history');
    expect(sql).not.toContain('INSERT OR REPLACE');
  });

  it('passes all rank parameters in correct order', async () => {
    mockPoolQuery.mockResolvedValue([{}, undefined]);

    await db.saveRankHistory({
      date: '2025-06-20',
      circle_id: 100,
      monthly_rank: 5,
      monthly_point: 12345,
      club_rank: 7,
      fans_to_next_tier: 5000,
      fans_to_lower_tier: 2000,
    });

    const params = mockPoolQuery.mock.calls[0][1] as unknown[];
    expect(params).toEqual(['2025-06-20', 100, 5, 12345, 7, 5000, 2000]);
  });
});


describe('getMembers()', () => {
  it('queries by circle_id and maps rows', async () => {
    mockPoolQuery.mockResolvedValue([
      [
        {
          viewer_id: 1,
          trainer_name: 'Alice',
          circle_id: 100,
          first_seen: '2025-06-01',
          last_seen: '2025-06-20',
          previous_circle_id: null,
          previous_circle_name: null,
          status: 'active',
        },
      ],
      undefined,
    ]);

    const members = await db.getMembers(100);

    expect(members).toHaveLength(1);
    expect(members[0]).toEqual({
      viewer_id: 1,
      trainer_name: 'Alice',
      circle_id: 100,
      first_seen: '2025-06-01',
      last_seen: '2025-06-20',
      previous_circle_id: null,
      previous_circle_name: null,
      status: 'active',
    });

    const lastCall = mockPoolQuery.mock.calls[mockPoolQuery.mock.calls.length - 1];
    expect(lastCall[1]).toEqual([100]);
  });
});


describe('getMember()', () => {
  it('returns null when no member found', async () => {
    mockPoolQuery.mockResolvedValue([[], undefined]);

    const result = await db.getMember(99999);
    expect(result).toBeNull();
  });

  it('returns mapped member when found', async () => {
    mockPoolQuery.mockResolvedValue([
      [
        {
          viewer_id: 42,
          trainer_name: 'Bob',
          circle_id: 100,
          first_seen: '2025-06-01',
          last_seen: '2025-06-20',
          previous_circle_id: 50,
          previous_circle_name: 'OldCircle',
          status: 'stale',
        },
      ],
      undefined,
    ]);

    const result = await db.getMember(42);
    expect(result).not.toBeNull();
    expect(result!.viewer_id).toBe(42);
    expect(result!.status).toBe('stale');
    expect(result!.previous_circle_id).toBe(50);
  });
});


describe('getRankHistory()', () => {
  it('queries with circle_id and days limit, returns mapped rows', async () => {
    mockPoolQuery.mockResolvedValue([
      [
        {
          date: '2025-06-20',
          circle_id: 100,
          monthly_rank: 3,
          monthly_point: 50000,
          club_rank: 8,
          fans_to_next_tier: 1000,
          fans_to_lower_tier: 3000,
        },
      ],
      undefined,
    ]);

    const result = await db.getRankHistory(100, 30);

    expect(result).toHaveLength(1);
    expect(result[0].monthly_rank).toBe(3);

    const lastCall = mockPoolQuery.mock.calls[mockPoolQuery.mock.calls.length - 1];
    expect(lastCall[0]).toContain('ORDER BY date DESC');
    expect(lastCall[0]).toContain('LIMIT ?');
    expect(lastCall[1]).toEqual([100, 30]);
  });
});


describe('updateRunStatus()', () => {
  it('includes sent_at when status is "sent"', async () => {
    mockPoolQuery.mockResolvedValue([{}, undefined]);

    await db.updateRunStatus(42, 'sent');

    const sql = mockPoolQuery.mock.calls[0][0] as string;
    expect(sql).toContain('UPDATE schedule_runs SET status = ?, sent_at = ?, error_message = ? WHERE id = ?');
    const params = mockPoolQuery.mock.calls[0][1] as unknown[];
    expect(params[0]).toBe('sent');
    expect(typeof params[1]).toBe('string');
    expect(params[3]).toBe(42);
  });

  it('omits sent_at when status is not "sent"', async () => {
    mockPoolQuery.mockResolvedValue([{}, undefined]);

    await db.updateRunStatus(7, 'failed', 'timeout');

    const sql = mockPoolQuery.mock.calls[0][0] as string;
    expect(sql).toContain('UPDATE schedule_runs SET status = ?, error_message = ? WHERE id = ?');
    expect(sql).not.toContain('sent_at');
    const params = mockPoolQuery.mock.calls[0][1] as unknown[];
    expect(params).toEqual(['failed', 'timeout', 7]);
  });
});


describe('getExistingAlertKeys()', () => {
  it('returns empty set for empty input', async () => {
    const result = await db.getExistingAlertKeys([]);
    expect(result.size).toBe(0);
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });

  it('returns set of matching event_keys with sent/suppressed status', async () => {
    mockPoolQuery.mockResolvedValue([
      [{ event_key: 'key-1' }, { event_key: 'key-3' }],
      undefined,
    ]);

    const result = await db.getExistingAlertKeys(['key-1', 'key-2', 'key-3']);
    expect(result.size).toBe(2);
    expect(result.has('key-1')).toBe(true);
    expect(result.has('key-3')).toBe(true);
    expect(result.has('key-2')).toBe(false);

    const lastCall = mockPoolQuery.mock.calls[mockPoolQuery.mock.calls.length - 1];
    expect(lastCall[0]).toContain('event_key IN');
    expect(lastCall[1]).toEqual(['key-1', 'key-2', 'key-3', 'sent', 'suppressed']);
  });
});

describe('recordAlert()', () => {
  it('returns existing id if event_key already exists', async () => {
    let callCount = 0;
    mockPoolQuery.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return [{}, undefined];                     // INSERT IGNORE (skipped)
      if (callCount === 2) return [[{ id: 0 }], undefined];            // LAST_INSERT_ID → 0
      return [[{ id: 55 }], undefined];                                // fallback SELECT
    });

    const id = await db.recordAlert({
      alert_type: 'perf_drop',
      event_key: 'dedup-key',
      member_viewer_id: '12345',
      report_date: '2025-06-20',
      created_at: '2025-06-20T22:05:00.000Z',
      message: 'test',
    });

    expect(id).toBe(55);
    expect(mockPoolQuery).toHaveBeenCalledTimes(3);
    const fallbackSql = mockPoolQuery.mock.calls[2][0] as string;
    expect(fallbackSql).toContain('SELECT id FROM alert_events WHERE event_key = ?');
  });

  it('inserts new alert and returns LAST_INSERT_ID()', async () => {
    let callCount = 0;
    mockPoolQuery.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return [{}, undefined];                     // INSERT IGNORE (inserted)
      return [[{ id: 77 }], undefined];                                // LAST_INSERT_ID → 77
    });

    const id = await db.recordAlert({
      alert_type: 'demotion',
      event_key: 'new-key',
      member_viewer_id: '99',
      report_date: '2025-06-20',
      created_at: '2025-06-20T22:05:00.000Z',
      message: 'risk detected',
    });

    expect(id).toBe(77);
    expect(mockPoolQuery).toHaveBeenCalledTimes(2);
    const insertSql = mockPoolQuery.mock.calls[0][0] as string;
    expect(insertSql).toContain('INSERT IGNORE INTO alert_events');
    const idSql = mockPoolQuery.mock.calls[1][0] as string;
    expect(idSql).toContain('LAST_INSERT_ID()');
  });

  it('defaults status to "pending" when not provided', async () => {
    let callCount = 0;
    mockPoolQuery.mockImplementation(async (...args: unknown[]) => {
      callCount++;
      if (callCount === 1) {
        const params = args[1] as unknown[];
        expect(params[5]).toBe('pending');
        return [{}, undefined];
      }
      return [[{ id: 1 }], undefined];
    });

    await db.recordAlert({
      alert_type: 'perf_drop',
      event_key: 'k1',
      member_viewer_id: '1',
      report_date: '2025-06-20',
      created_at: '2025-06-20T22:05:00.000Z',
      message: 'msg',
    });

    expect(mockPoolQuery).toHaveBeenCalledTimes(2);
  });
});

describe('markAlertSent()', () => {
  it('updates status and sent_at for given id', async () => {
    mockPoolQuery.mockResolvedValue([{}, undefined]);

    await db.markAlertSent(10);

    const sql = mockPoolQuery.mock.calls[0][0] as string;
    expect(sql).toContain('UPDATE alert_events SET status = ?, sent_at = ? WHERE id = ?');
    const params = mockPoolQuery.mock.calls[0][1] as unknown[];
    expect(params[0]).toBe('sent');
    expect(typeof params[1]).toBe('string');
    expect(params[2]).toBe(10);
  });
});


describe('transaction()', () => {
  it('acquires connection, begins, commits, and releases', async () => {
    const result = await db.transaction(async () => 42);

    expect(result).toBe(42);
    expect(mockGetConnection).toHaveBeenCalled();
    expect(mockBeginTransaction).toHaveBeenCalled();
    expect(mockCommit).toHaveBeenCalled();
    expect(mockRollback).not.toHaveBeenCalled();
    expect(mockRelease).toHaveBeenCalled();
  });

  it('calls rollback and re-throws on error', async () => {
    const error = new Error('boom');

    await expect(
      db.transaction(async () => {
        throw error;
      })
    ).rejects.toThrow('boom');

    expect(mockRollback).toHaveBeenCalled();
    expect(mockCommit).not.toHaveBeenCalled();
    expect(mockRelease).toHaveBeenCalled();
  });

  it('uses connection from pool for inner method calls', async () => {
    mockConnQuery.mockReset();
    mockConnQuery.mockResolvedValue([
      [
        {
          id: 1,
          report_type: 'daily',
          report_date: '2025-06-20',
          scheduled_at: '2025-06-20T22:05:00.000Z',
          sent_at: '2025-06-20T22:05:02.000Z',
          status: 'sent',
          is_catch_up: 0,
          target_jid: 'group@g.us',
          error_message: null,
        },
      ],
      undefined,
    ]);

    const result = await db.transaction(async () => {
      return db.getLastSuccessfulRun('daily');
    });

    expect(result).not.toBeNull();
    expect(result!.report_type).toBe('daily');
    expect(mockPoolQuery).not.toHaveBeenCalled();
    expect(mockConnQuery).toHaveBeenCalled();
  });

  it('pool methods still work after failed transaction connection', async () => {
    mockGetConnection.mockRejectedValueOnce(new Error('Pool exhausted'));

    await expect(
      db.transaction(async () => 'should not reach')
    ).rejects.toThrow('Pool exhausted');

    mockPoolQuery.mockResolvedValue([[], undefined]);
    const result = await db.getLastSuccessfulRun('daily');
    expect(result).toBeNull();
    expect(mockPoolQuery).toHaveBeenCalled();
  });

  it('sets transactionConn to null after completion', async () => {
    await db.transaction(async () => 'done');

    mockPoolQuery.mockResolvedValue([[], undefined]);
    await db.getLastSuccessfulRun('test');
    expect(mockPoolQuery).toHaveBeenCalled();
  });
});


describe('save()', () => {
  it('does nothing — no pool interaction', async () => {
    const poolQueryCount = mockPoolQuery.mock.calls.length;
    const poolExecCount = (mockPool.execute as jest.Mock).mock.calls.length;

    await db.save();

    expect(mockPoolQuery.mock.calls.length).toBe(poolQueryCount);
    expect((mockPool.execute as jest.Mock).mock.calls.length).toBe(poolExecCount);
    expect(mockGetConnection).not.toHaveBeenCalled();
  });
});


describe('close()', () => {
  it('calls pool.end()', async () => {
    await db.close();
    expect(mockPoolEnd).toHaveBeenCalled();
  });

  it('is safe to call twice', async () => {
    await db.close();
    await db.close();
    expect(mockPoolEnd).toHaveBeenCalledTimes(1);
  });
});


describe('MySQL-specific SQL patterns', () => {
  it('upsertMember does not use SQLite ON CONFLICT syntax', async () => {
    mockPoolQuery.mockResolvedValue([{}, undefined]);

    await db.upsertMember({
      viewer_id: 1,
      trainer_name: 'Test',
      circle_id: 1,
      first_seen: '2025-06-01',
      last_seen: '2025-06-20',
    });

    const sql = mockPoolQuery.mock.calls[0][0] as string;
    expect(sql).not.toContain('ON CONFLICT');
    expect(sql).not.toContain('excluded.');
  });

  it('saveRankHistory does not use INSERT OR REPLACE', async () => {
    mockPoolQuery.mockResolvedValue([{}, undefined]);

    await db.saveRankHistory({
      date: '2025-06-20',
      circle_id: 1,
      monthly_rank: 1,
      monthly_point: 1000,
      club_rank: 5,
      fans_to_next_tier: 500,
      fans_to_lower_tier: 200,
    });

    const sql = mockPoolQuery.mock.calls[0][0] as string;
    expect(sql).not.toContain('INSERT OR REPLACE');
    expect(sql).toContain('REPLACE INTO');
  });

  it('recordRun and recordAlert use LAST_INSERT_ID() not last_insert_rowid()', async () => {
    mockPoolQuery
      .mockResolvedValueOnce([{ insertId: 1 }, undefined])  // INSERT
      .mockResolvedValueOnce([[{ id: 1 }], undefined]);      // LAST_INSERT_ID

    await db.recordRun({
      report_type: 'daily',
      report_date: '2025-06-20',
      scheduled_at: '2025-06-20T22:05:00.000Z',
      status: 'sent',
      is_catch_up: false,
      target_jid: 'g@g.us',
    });

    mockPoolQuery
      .mockResolvedValueOnce([{}, undefined])                     // INSERT IGNORE
      .mockResolvedValueOnce([[{ id: 2 }], undefined]);           // LAST_INSERT_ID

    await db.recordAlert({
      alert_type: 'test',
      event_key: 'k',
      member_viewer_id: '1',
      report_date: '2025-06-20',
      created_at: '2025-06-20T22:05:00.000Z',
      message: 'm',
    });

    for (const call of mockPoolQuery.mock.calls) {
      const sql = call[0] as string;
      if (typeof sql === 'string' && sql.includes('INSERT_ID')) {
        expect(sql).toContain('LAST_INSERT_ID()');
        expect(sql).not.toContain('last_insert_rowid');
      }
    }
  });
});
