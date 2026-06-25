import { SqliteDatabase } from '../../src/db/database';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

let db: SqliteDatabase;

beforeEach(async () => {
  db = new SqliteDatabase(':memory:');
  await db.initialize();
});

afterEach(async () => {
  await db.close();
});

// Helper to remove a file and its parent dirs if they are empty
function rmrfSync(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('Database initialization', () => {
  it('creates tables without error', async () => {
    const newDb = new SqliteDatabase(':memory:');
    await newDb.initialize();
    // Should not throw
    await newDb.close();
  });

  it('initialization is idempotent', async () => {
    const newDb = new SqliteDatabase(':memory:');
    await newDb.initialize();
    await newDb.initialize(); // second call should not fail
    await newDb.close();
  });

  it('throws when using operations before initialize', async () => {
    const uninitDb = new SqliteDatabase(':memory:');
    await expect(uninitDb.getLastSuccessfulRun('daily')).rejects.toThrow('not initialized');
  });
});

describe('Schedule runs', () => {
  it('returns null when no runs exist', async () => {
    expect(await db.getLastSuccessfulRun('daily')).toBeNull();
  });

  it('records a run and retrieves it', async () => {
    const id = await db.recordRun({
      report_type: 'daily',
      report_date: '2026-06-11',
      scheduled_at: '2026-06-11T15:05:00Z',
      status: 'pending',
      is_catch_up: false,
      target_jid: 'test@g.us',
    });
    expect(id).toBeGreaterThan(0);
  });

  it('finds last successful run by type', async () => {
    await db.recordRun({
      report_type: 'daily',
      report_date: '2026-06-10',
      scheduled_at: '2026-06-10T15:05:00Z',
      status: 'sent',
      is_catch_up: false,
      target_jid: 'group@g.us',
      sent_at: '2026-06-10T15:05:01Z',
    });
    await db.recordRun({
      report_type: 'weekly',
      report_date: '2026-06-10',
      scheduled_at: '2026-06-10T15:05:00Z',
      status: 'sent',
      is_catch_up: false,
      target_jid: 'group@g.us',
      sent_at: '2026-06-10T15:05:01Z',
    });

    const lastDaily = await db.getLastSuccessfulRun('daily');
    expect(lastDaily).not.toBeNull();
    expect(lastDaily!.report_type).toBe('daily');
  });

  it('updates run status to sent', async () => {
    const id = await db.recordRun({
      report_type: 'daily',
      report_date: '2026-06-11',
      scheduled_at: '2026-06-11T15:05:00Z',
      status: 'pending',
      is_catch_up: false,
      target_jid: 'group@g.us',
    });

    await db.updateRunStatus(id, 'sent');
    // Verify by checking last successful run
    const last = await db.getLastSuccessfulRun('daily');
    expect(last).not.toBeNull();
  });

  it('updates run status with error message', async () => {
    const id = await db.recordRun({
      report_type: 'daily',
      report_date: '2026-06-11',
      scheduled_at: '2026-06-11T15:05:00Z',
      status: 'pending',
      is_catch_up: false,
      target_jid: 'group@g.us',
    });

    await db.updateRunStatus(id, 'failed', 'WhatsApp disconnected');
    // Should not appear as successful
    const last = await db.getLastSuccessfulRun('daily');
    expect(last).toBeNull();
  });
});

describe('Alert events', () => {
  it('records alert and checks dedup', async () => {
    const key = 'performance_drop:2026-06-11:12345';
    let keys = await db.getExistingAlertKeys([key]);
    expect(keys.has(key)).toBe(false);

    const id = await db.recordAlert({
      alert_type: 'performance_drop',
      event_key: key,
      member_viewer_id: '12345',
      report_date: '2026-06-11',
      created_at: '2026-06-11T15:05:00Z',
      message: 'Performance drop detected',
    });

    expect(id).toBeGreaterThan(0);
    keys = await db.getExistingAlertKeys([key]);
    expect(keys.has(key)).toBe(false);

    await db.markAlertSent(id);
    keys = await db.getExistingAlertKeys([key]);
    expect(keys.has(key)).toBe(true);
  });

  it('ignores duplicate event_key', async () => {
    const key = 'performance_drop:2026-06-11:12345';

    await db.recordAlert({
      alert_type: 'performance_drop',
      event_key: key,
      member_viewer_id: '12345',
      report_date: '2026-06-11',
      created_at: '2026-06-11T15:05:00Z',
      message: 'First alert',
    });

    // Should not throw due to UNIQUE constraint
    await db.recordAlert({
      alert_type: 'performance_drop',
      event_key: key,
      member_viewer_id: '12345',
      report_date: '2026-06-11',
      created_at: '2026-06-11T15:05:00Z',
      message: 'Duplicate alert',
    });

    let keys = await db.getExistingAlertKeys([key]);
    expect(keys.has(key)).toBe(false);
  });
});

describe('Member history', () => {
  it('upserts a member', async () => {
    await db.upsertMember({
      viewer_id: 12345,
      trainer_name: 'TestPlayer',
      circle_id: 999,
      first_seen: '2026-06-01',
      last_seen: '2026-06-11',
      status: 'active',
    });

    const member = await db.getMember(12345);
    expect(member).not.toBeNull();
    expect(member!.trainer_name).toBe('TestPlayer');
    expect(member!.circle_id).toBe(999);
  });

  it('updates on conflict', async () => {
    await db.upsertMember({
      viewer_id: 12345,
      trainer_name: 'OldName',
      circle_id: 999,
      first_seen: '2026-06-01',
      last_seen: '2026-06-10',
    });

    await db.upsertMember({
      viewer_id: 12345,
      trainer_name: 'NewName',
      circle_id: 999,
      first_seen: '2026-06-01',
      last_seen: '2026-06-11',
    });

    const member = await db.getMember(12345);
    expect(member!.trainer_name).toBe('NewName');
    expect(member!.last_seen).toBe('2026-06-11');
  });

  it('lists members by circle_id', async () => {
    await db.upsertMember({
      viewer_id: 1,
      trainer_name: 'Alice',
      circle_id: 100,
      first_seen: '2026-06-01',
      last_seen: '2026-06-11',
    });
    await db.upsertMember({
      viewer_id: 2,
      trainer_name: 'Bob',
      circle_id: 100,
      first_seen: '2026-06-01',
      last_seen: '2026-06-11',
    });
    await db.upsertMember({
      viewer_id: 3,
      trainer_name: 'Charlie',
      circle_id: 200,
      first_seen: '2026-06-01',
      last_seen: '2026-06-11',
    });

    const members = await db.getMembers(100);
    expect(members).toHaveLength(2);
  });

  it('returns null for nonexistent member', async () => {
    expect(await db.getMember(99999)).toBeNull();
  });

  it('stores transfer info', async () => {
    await db.upsertMember({
      viewer_id: 555,
      trainer_name: 'TransferGuy',
      circle_id: 100,
      first_seen: '2026-06-05',
      last_seen: '2026-06-11',
      previous_circle_id: 200,
      previous_circle_name: 'OldClub',
    });

    const member = await db.getMember(555);
    expect(member!.previous_circle_id).toBe(200);
    expect(member!.previous_circle_name).toBe('OldClub');
  });
});

describe('Rank history', () => {
  it('saves and retrieves rank history', async () => {
    await db.saveRankHistory({
      date: '2026-06-11',
      circle_id: 100,
      monthly_rank: 431,
      monthly_point: 349076587,
      club_rank: 8,
      fans_to_next_tier: 349208495,
      fans_to_lower_tier: 21848493,
    });

    const history = await db.getRankHistory(100, 7);
    expect(history).toHaveLength(1);
    expect(history[0].monthly_rank).toBe(431);
  });

  it('returns empty array for no data', async () => {
    const history = await db.getRankHistory(999, 7);
    expect(history).toHaveLength(0);
  });

  it('upserts on date+circle_id conflict', async () => {
    await db.saveRankHistory({
      date: '2026-06-11',
      circle_id: 100,
      monthly_rank: 431,
      monthly_point: 349076587,
      club_rank: 8,
      fans_to_next_tier: 349208495,
      fans_to_lower_tier: 21848493,
    });

    await db.saveRankHistory({
      date: '2026-06-11',
      circle_id: 100,
      monthly_rank: 420,
      monthly_point: 360000000,
      club_rank: 8,
      fans_to_next_tier: 340000000,
      fans_to_lower_tier: 22000000,
    });

    const history = await db.getRankHistory(100, 7);
    expect(history).toHaveLength(1);
    expect(history[0].monthly_rank).toBe(420);
  });

  it('limits by days parameter', async () => {
    for (let i = 1; i <= 10; i++) {
      await db.saveRankHistory({
        date: `2026-06-${String(i).padStart(2, '0')}`,
        circle_id: 100,
        monthly_rank: 400 + i,
        monthly_point: 300_000_000 + i * 1_000_000,
        club_rank: 8,
        fans_to_next_tier: 349_000_000,
        fans_to_lower_tier: 21_000_000,
      });
    }

    const history = await db.getRankHistory(100, 3);
    expect(history).toHaveLength(3);
  });
});

describe('Persistence round-trip', () => {
  let tmpFile: string;

  beforeEach(() => {
    tmpFile = path.join(os.tmpdir(), `test-persistence-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  });

  afterEach(() => {
    rmrfSync(tmpFile);
  });

  it('data survives close and reopen from disk', async () => {
    // Phase 1: create, populate, save, close
    const db1 = new SqliteDatabase(tmpFile);
    try {
      await db1.initialize();

      await db1.upsertMember({
        viewer_id: 77777,
        trainer_name: 'PersistPlayer',
        circle_id: 500,
        first_seen: '2026-06-01',
        last_seen: '2026-06-20',
      });

      await db1.recordRun({
        report_type: 'weekly',
        report_date: '2026-06-20',
        scheduled_at: '2026-06-20T15:05:00Z',
        status: 'sent',
        is_catch_up: false,
        target_jid: 'group@g.us',
        sent_at: '2026-06-20T15:05:01Z',
      });

      await db1.save();
    } finally {
      await db1.close();
    }

    // Phase 2: reopen with same path and verify
    const db2 = new SqliteDatabase(tmpFile);
    try {
      await db2.initialize();

      const member = await db2.getMember(77777);
      expect(member).not.toBeNull();
      expect(member!.trainer_name).toBe('PersistPlayer');
      expect(member!.circle_id).toBe(500);
      expect(member!.last_seen).toBe('2026-06-20');

      const lastRun = await db2.getLastSuccessfulRun('weekly');
      expect(lastRun).not.toBeNull();
      expect(lastRun!.report_date).toBe('2026-06-20');
      expect(lastRun!.target_jid).toBe('group@g.us');
    } finally {
      await db2.close();
    }
  });

  it('persists multiple members across restart', async () => {
    const db1 = new SqliteDatabase(tmpFile);
    try {
      await db1.initialize();

      await db1.upsertMember({
        viewer_id: 1001,
        trainer_name: 'Alpha',
        circle_id: 600,
        first_seen: '2026-06-01',
        last_seen: '2026-06-15',
      });
      await db1.upsertMember({
        viewer_id: 1002,
        trainer_name: 'Beta',
        circle_id: 600,
        first_seen: '2026-06-05',
        last_seen: '2026-06-18',
      });
      await db1.save();
    } finally {
      await db1.close();
    }

    const db2 = new SqliteDatabase(tmpFile);
    try {
      await db2.initialize();

      const members = await db2.getMembers(600);
      expect(members).toHaveLength(2);
      const names = members.map((m) => m.trainer_name).sort();
      expect(names).toEqual(['Alpha', 'Beta']);
    } finally {
      await db2.close();
    }
  });
});

describe('updateRunStatus sent_at timestamp', () => {
  it('sets sent_at to non-null value when status is sent', async () => {
    const id = await db.recordRun({
      report_type: 'monthly',
      report_date: '2026-06-01',
      scheduled_at: '2026-06-01T15:05:00Z',
      status: 'pending',
      is_catch_up: false,
      target_jid: 'group@g.us',
    });

    await db.updateRunStatus(id, 'sent');

    const last = await db.getLastSuccessfulRun('monthly');
    expect(last).not.toBeNull();
    expect(last!.sent_at).not.toBeNull();
    expect(typeof last!.sent_at).toBe('string');
    // sent_at should be a valid ISO date string
    expect(new Date(last!.sent_at!).getTime()).not.toBeNaN();
  });

  it('does not set sent_at when status is failed', async () => {
    const id = await db.recordRun({
      report_type: 'monthly',
      report_date: '2026-06-01',
      scheduled_at: '2026-06-01T15:05:00Z',
      status: 'pending',
      is_catch_up: false,
      target_jid: 'group@g.us',
    });

    await db.updateRunStatus(id, 'failed', 'timeout');

    const last = await db.getLastSuccessfulRun('monthly');
    expect(last).toBeNull();
  });
});

describe('transaction support', () => {
  it('persists data inserted within a transaction', async () => {
    await db.transaction(async () => {
      await db.recordRun({
        report_type: 'daily',
        report_date: '2026-06-15',
        scheduled_at: '2026-06-15T15:05:00Z',
        status: 'sent',
        is_catch_up: false,
        target_jid: 'test@g.us',
        sent_at: '2026-06-15T15:05:01Z',
      });
    });

    const last = await db.getLastSuccessfulRun('daily');
    expect(last).not.toBeNull();
    expect(last!.report_date).toBe('2026-06-15');
  });

  it('rolls back data when transaction throws', async () => {
    await expect(
      db.transaction(async () => {
        await db.recordRun({
          report_type: 'daily',
          report_date: '2026-06-15',
          scheduled_at: '2026-06-15T15:05:00Z',
          status: 'pending',
          is_catch_up: false,
          target_jid: 'test@g.us',
        });
        throw new Error('Transaction failed');
      })
    ).rejects.toThrow('Transaction failed');

    const last = await db.getLastSuccessfulRun('daily');
    expect(last).toBeNull();
  });
});

describe('error handling', () => {
  it('rejects when operations called on uninitialized db', async () => {
    const uninitDb = new SqliteDatabase(':memory:');
    await expect(uninitDb.getLastSuccessfulRun('daily')).rejects.toThrow('not initialized');
  });

  it('rejects when recordRun called on uninitialized db', async () => {
    const uninitDb = new SqliteDatabase(':memory:');
    await expect(
      uninitDb.recordRun({
        report_type: 'daily',
        report_date: '2026-06-15',
        scheduled_at: '2026-06-15T15:05:00Z',
        status: 'pending',
        is_catch_up: false,
        target_jid: 'test@g.us',
      })
    ).rejects.toThrow('not initialized');
  });
});

describe('getExistingAlertKeys', () => {
  it('returns empty Set for empty array input', async () => {
    const result = await db.getExistingAlertKeys([]);
    expect(result.size).toBe(0);
  });

  it('returns Set with keys that have "sent" status', async () => {
    const id1 = await db.recordAlert({
      alert_type: 'performance_drop',
      event_key: 'key-1',
      member_viewer_id: '123',
      report_date: '2026-06-11',
      created_at: '2026-06-11T15:05:00Z',
      message: 'Alert 1',
    });
    const id2 = await db.recordAlert({
      alert_type: 'performance_drop',
      event_key: 'key-2',
      member_viewer_id: '456',
      report_date: '2026-06-11',
      created_at: '2026-06-11T15:05:00Z',
      message: 'Alert 2',
    });
    await db.markAlertSent(id1);
    await db.markAlertSent(id2);

    const result = await db.getExistingAlertKeys(['key-1', 'key-2', 'key-3']);
    expect(result.size).toBe(2);
    expect(result.has('key-1')).toBe(true);
    expect(result.has('key-2')).toBe(true);
    expect(result.has('key-3')).toBe(false);
  });

  it('does NOT include keys with "pending" status', async () => {
    await db.recordAlert({
      alert_type: 'performance_drop',
      event_key: 'pending-key',
      member_viewer_id: '123',
      report_date: '2026-06-11',
      created_at: '2026-06-11T15:05:00Z',
      message: 'Pending alert',
    });
    // Don't mark as sent — stays "pending"

    const result = await db.getExistingAlertKeys(['pending-key']);
    expect(result.size).toBe(0);
    expect(result.has('pending-key')).toBe(false);
  });

  it('DOES include keys with "suppressed" status', async () => {
    const id = await db.recordAlert({
      alert_type: 'performance_drop',
      event_key: 'suppressed-key',
      member_viewer_id: '123',
      report_date: '2026-06-11',
      created_at: '2026-06-11T15:05:00Z',
      message: 'Suppressed alert',
    });
    await db.markAlertSent(id);
    // Update status to suppressed directly via raw SQL since markAlertSent sets "sent"
    // Instead, record with suppressed status via the status field
    const id2 = await db.recordAlert({
      alert_type: 'performance_drop',
      event_key: 'suppressed-key-2',
      member_viewer_id: '123',
      report_date: '2026-06-11',
      created_at: '2026-06-11T15:05:00Z',
      status: 'suppressed',
      message: 'Suppressed alert 2',
    });

    const result = await db.getExistingAlertKeys(['suppressed-key', 'suppressed-key-2']);
    expect(result.size).toBe(2);
    expect(result.has('suppressed-key')).toBe(true);
    expect(result.has('suppressed-key-2')).toBe(true);
  });

  it('excludes non-existent keys from result', async () => {
    const id = await db.recordAlert({
      alert_type: 'performance_drop',
      event_key: 'real-key',
      member_viewer_id: '123',
      report_date: '2026-06-11',
      created_at: '2026-06-11T15:05:00Z',
      message: 'Real alert',
    });
    await db.markAlertSent(id);

    const result = await db.getExistingAlertKeys(['real-key', 'fake-key-1', 'fake-key-2']);
    expect(result.size).toBe(1);
    expect(result.has('real-key')).toBe(true);
    expect(result.has('fake-key-1')).toBe(false);
    expect(result.has('fake-key-2')).toBe(false);
  });
});

describe('File-based initialize with directory creation', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `test-db-dirs-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  });

  afterEach(() => {
    rmrfSync(tmpDir);
  });

  it('creates nested directories that do not exist', async () => {
    const dbPath = path.join(tmpDir, 'subdir', 'data', 'bot.db');

    // Parent directories do not exist yet
    expect(fs.existsSync(path.join(tmpDir, 'subdir'))).toBe(false);

    const testDb = new SqliteDatabase(dbPath);
    try {
      await testDb.initialize();

      // Directory tree should have been created
      expect(fs.existsSync(path.join(tmpDir, 'subdir', 'data'))).toBe(true);

      // sql.js keeps data in-memory; file only appears after save()
      await testDb.upsertMember({
        viewer_id: 88888,
        trainer_name: 'NestedDirPlayer',
        circle_id: 700,
        first_seen: '2026-06-01',
        last_seen: '2026-06-22',
      });
      await testDb.save();
      expect(fs.existsSync(dbPath)).toBe(true);

      // Reopen and verify data survived
      const db2 = new SqliteDatabase(dbPath);
      try {
        await db2.initialize();
        const member = await db2.getMember(88888);
        expect(member).not.toBeNull();
        expect(member!.trainer_name).toBe('NestedDirPlayer');
      } finally {
        await db2.close();
      }
    } finally {
      await testDb.close();
    }
  });

  it('works when directory already exists', async () => {
    // Pre-create the directory
    fs.mkdirSync(path.join(tmpDir, 'existing'), { recursive: true });
    const dbPath = path.join(tmpDir, 'existing', 'bot.db');

    const testDb = new SqliteDatabase(dbPath);
    try {
      await testDb.initialize();

      await testDb.upsertMember({
        viewer_id: 99999,
        trainer_name: 'ExistingDirPlayer',
        circle_id: 800,
        first_seen: '2026-06-01',
        last_seen: '2026-06-22',
      });
      await testDb.save();
      expect(fs.existsSync(dbPath)).toBe(true);
    } finally {
      await testDb.close();
    }

    // Verify persisted
    const db2 = new SqliteDatabase(dbPath);
    try {
      await db2.initialize();
      const member = await db2.getMember(99999);
      expect(member).not.toBeNull();
      expect(member!.trainer_name).toBe('ExistingDirPlayer');
    } finally {
      await db2.close();
    }
  });
});
