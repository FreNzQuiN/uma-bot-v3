import { Database } from '../../src/db/database';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

let db: Database;

beforeEach(async () => {
  db = new Database(':memory:');
  await db.initialize();
});

afterEach(() => {
  db.close();
});

// Helper to remove a file and its parent dirs if they are empty
function rmrfSync(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('Database initialization', () => {
  it('creates tables without error', async () => {
    const newDb = new Database(':memory:');
    await newDb.initialize();
    // Should not throw
    newDb.close();
  });

  it('initialization is idempotent', async () => {
    const newDb = new Database(':memory:');
    await newDb.initialize();
    await newDb.initialize(); // second call should not fail
    newDb.close();
  });

  it('throws when using operations before initialize', () => {
    const uninitDb = new Database(':memory:');
    expect(() => uninitDb.getLastSuccessfulRun('daily')).toThrow('not initialized');
  });
});

describe('Schedule runs', () => {
  it('returns null when no runs exist', () => {
    expect(db.getLastSuccessfulRun('daily')).toBeNull();
  });

  it('records a run and retrieves it', () => {
    const id = db.recordRun({
      report_type: 'daily',
      report_date: '2026-06-11',
      scheduled_at: '2026-06-11T15:05:00Z',
      status: 'pending',
      is_catch_up: false,
      target_jid: 'test@g.us',
    });
    expect(id).toBeGreaterThan(0);
  });

  it('finds last successful run by type', () => {
    db.recordRun({
      report_type: 'daily',
      report_date: '2026-06-10',
      scheduled_at: '2026-06-10T15:05:00Z',
      status: 'sent',
      is_catch_up: false,
      target_jid: 'group@g.us',
      sent_at: '2026-06-10T15:05:01Z',
    });
    db.recordRun({
      report_type: 'weekly',
      report_date: '2026-06-10',
      scheduled_at: '2026-06-10T15:05:00Z',
      status: 'sent',
      is_catch_up: false,
      target_jid: 'group@g.us',
      sent_at: '2026-06-10T15:05:01Z',
    });

    const lastDaily = db.getLastSuccessfulRun('daily');
    expect(lastDaily).not.toBeNull();
    expect(lastDaily!.report_type).toBe('daily');
  });

  it('updates run status to sent', () => {
    const id = db.recordRun({
      report_type: 'daily',
      report_date: '2026-06-11',
      scheduled_at: '2026-06-11T15:05:00Z',
      status: 'pending',
      is_catch_up: false,
      target_jid: 'group@g.us',
    });

    db.updateRunStatus(id, 'sent');
    // Verify by checking last successful run
    const last = db.getLastSuccessfulRun('daily');
    expect(last).not.toBeNull();
  });

  it('updates run status with error message', () => {
    const id = db.recordRun({
      report_type: 'daily',
      report_date: '2026-06-11',
      scheduled_at: '2026-06-11T15:05:00Z',
      status: 'pending',
      is_catch_up: false,
      target_jid: 'group@g.us',
    });

    db.updateRunStatus(id, 'failed', 'WhatsApp disconnected');
    // Should not appear as successful
    const last = db.getLastSuccessfulRun('daily');
    expect(last).toBeNull();
  });
});

describe('Alert events', () => {
  it('records alert and checks dedup', () => {
    const key = 'performance_drop:2026-06-11:12345';
    expect(db.isAlertAlreadySent(key)).toBe(false);

    const id = db.recordAlert({
      alert_type: 'performance_drop',
      event_key: key,
      member_viewer_id: '12345',
      report_date: '2026-06-11',
      created_at: '2026-06-11T15:05:00Z',
      message: 'Performance drop detected',
    });

    expect(id).toBeGreaterThan(0);
    expect(db.isAlertAlreadySent(key)).toBe(false);

    db.markAlertSent(id);
    expect(db.isAlertAlreadySent(key)).toBe(true);
  });

  it('ignores duplicate event_key', () => {
    const key = 'performance_drop:2026-06-11:12345';

    db.recordAlert({
      alert_type: 'performance_drop',
      event_key: key,
      member_viewer_id: '12345',
      report_date: '2026-06-11',
      created_at: '2026-06-11T15:05:00Z',
      message: 'First alert',
    });

    // Should not throw due to UNIQUE constraint
    db.recordAlert({
      alert_type: 'performance_drop',
      event_key: key,
      member_viewer_id: '12345',
      report_date: '2026-06-11',
      created_at: '2026-06-11T15:05:00Z',
      message: 'Duplicate alert',
    });

    expect(db.isAlertAlreadySent(key)).toBe(false);
  });
});

describe('Member history', () => {
  it('upserts a member', () => {
    db.upsertMember({
      viewer_id: 12345,
      trainer_name: 'TestPlayer',
      circle_id: 999,
      first_seen: '2026-06-01',
      last_seen: '2026-06-11',
      status: 'active',
    });

    const member = db.getMember(12345);
    expect(member).not.toBeNull();
    expect(member!.trainer_name).toBe('TestPlayer');
    expect(member!.circle_id).toBe(999);
  });

  it('updates on conflict', () => {
    db.upsertMember({
      viewer_id: 12345,
      trainer_name: 'OldName',
      circle_id: 999,
      first_seen: '2026-06-01',
      last_seen: '2026-06-10',
    });

    db.upsertMember({
      viewer_id: 12345,
      trainer_name: 'NewName',
      circle_id: 999,
      first_seen: '2026-06-01',
      last_seen: '2026-06-11',
    });

    const member = db.getMember(12345);
    expect(member!.trainer_name).toBe('NewName');
    expect(member!.last_seen).toBe('2026-06-11');
  });

  it('lists members by circle_id', () => {
    db.upsertMember({
      viewer_id: 1,
      trainer_name: 'Alice',
      circle_id: 100,
      first_seen: '2026-06-01',
      last_seen: '2026-06-11',
    });
    db.upsertMember({
      viewer_id: 2,
      trainer_name: 'Bob',
      circle_id: 100,
      first_seen: '2026-06-01',
      last_seen: '2026-06-11',
    });
    db.upsertMember({
      viewer_id: 3,
      trainer_name: 'Charlie',
      circle_id: 200,
      first_seen: '2026-06-01',
      last_seen: '2026-06-11',
    });

    const members = db.getMembers(100);
    expect(members).toHaveLength(2);
  });

  it('returns null for nonexistent member', () => {
    expect(db.getMember(99999)).toBeNull();
  });

  it('stores transfer info', () => {
    db.upsertMember({
      viewer_id: 555,
      trainer_name: 'TransferGuy',
      circle_id: 100,
      first_seen: '2026-06-05',
      last_seen: '2026-06-11',
      previous_circle_id: 200,
      previous_circle_name: 'OldClub',
    });

    const member = db.getMember(555);
    expect(member!.previous_circle_id).toBe(200);
    expect(member!.previous_circle_name).toBe('OldClub');
  });
});

describe('Rank history', () => {
  it('saves and retrieves rank history', () => {
    db.saveRankHistory({
      date: '2026-06-11',
      circle_id: 100,
      monthly_rank: 431,
      monthly_point: 349076587,
      club_rank: 8,
      fans_to_next_tier: 349208495,
      fans_to_lower_tier: 21848493,
    });

    const history = db.getRankHistory(100, 7);
    expect(history).toHaveLength(1);
    expect(history[0].monthly_rank).toBe(431);
  });

  it('returns empty array for no data', () => {
    const history = db.getRankHistory(999, 7);
    expect(history).toHaveLength(0);
  });

  it('upserts on date+circle_id conflict', () => {
    db.saveRankHistory({
      date: '2026-06-11',
      circle_id: 100,
      monthly_rank: 431,
      monthly_point: 349076587,
      club_rank: 8,
      fans_to_next_tier: 349208495,
      fans_to_lower_tier: 21848493,
    });

    db.saveRankHistory({
      date: '2026-06-11',
      circle_id: 100,
      monthly_rank: 420,
      monthly_point: 360000000,
      club_rank: 8,
      fans_to_next_tier: 340000000,
      fans_to_lower_tier: 22000000,
    });

    const history = db.getRankHistory(100, 7);
    expect(history).toHaveLength(1);
    expect(history[0].monthly_rank).toBe(420);
  });

  it('limits by days parameter', () => {
    for (let i = 1; i <= 10; i++) {
      db.saveRankHistory({
        date: `2026-06-${String(i).padStart(2, '0')}`,
        circle_id: 100,
        monthly_rank: 400 + i,
        monthly_point: 300_000_000 + i * 1_000_000,
        club_rank: 8,
        fans_to_next_tier: 349_000_000,
        fans_to_lower_tier: 21_000_000,
      });
    }

    const history = db.getRankHistory(100, 3);
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
    const db1 = new Database(tmpFile);
    try {
      await db1.initialize();

      db1.upsertMember({
        viewer_id: 77777,
        trainer_name: 'PersistPlayer',
        circle_id: 500,
        first_seen: '2026-06-01',
        last_seen: '2026-06-20',
      });

      db1.recordRun({
        report_type: 'weekly',
        report_date: '2026-06-20',
        scheduled_at: '2026-06-20T15:05:00Z',
        status: 'sent',
        is_catch_up: false,
        target_jid: 'group@g.us',
        sent_at: '2026-06-20T15:05:01Z',
      });

      db1.save();
    } finally {
      db1.close();
    }

    // Phase 2: reopen with same path and verify
    const db2 = new Database(tmpFile);
    try {
      await db2.initialize();

      const member = db2.getMember(77777);
      expect(member).not.toBeNull();
      expect(member!.trainer_name).toBe('PersistPlayer');
      expect(member!.circle_id).toBe(500);
      expect(member!.last_seen).toBe('2026-06-20');

      const lastRun = db2.getLastSuccessfulRun('weekly');
      expect(lastRun).not.toBeNull();
      expect(lastRun!.report_date).toBe('2026-06-20');
      expect(lastRun!.target_jid).toBe('group@g.us');
    } finally {
      db2.close();
    }
  });

  it('persists multiple members across restart', async () => {
    const db1 = new Database(tmpFile);
    try {
      await db1.initialize();

      db1.upsertMember({
        viewer_id: 1001,
        trainer_name: 'Alpha',
        circle_id: 600,
        first_seen: '2026-06-01',
        last_seen: '2026-06-15',
      });
      db1.upsertMember({
        viewer_id: 1002,
        trainer_name: 'Beta',
        circle_id: 600,
        first_seen: '2026-06-05',
        last_seen: '2026-06-18',
      });
      db1.save();
    } finally {
      db1.close();
    }

    const db2 = new Database(tmpFile);
    try {
      await db2.initialize();

      const members = db2.getMembers(600);
      expect(members).toHaveLength(2);
      const names = members.map((m) => m.trainer_name).sort();
      expect(names).toEqual(['Alpha', 'Beta']);
    } finally {
      db2.close();
    }
  });
});

describe('updateRunStatus sent_at timestamp', () => {
  it('sets sent_at to non-null value when status is sent', () => {
    const id = db.recordRun({
      report_type: 'monthly',
      report_date: '2026-06-01',
      scheduled_at: '2026-06-01T15:05:00Z',
      status: 'pending',
      is_catch_up: false,
      target_jid: 'group@g.us',
    });

    db.updateRunStatus(id, 'sent');

    const last = db.getLastSuccessfulRun('monthly');
    expect(last).not.toBeNull();
    expect(last!.sent_at).not.toBeNull();
    expect(typeof last!.sent_at).toBe('string');
    // sent_at should be a valid ISO date string
    expect(new Date(last!.sent_at!).getTime()).not.toBeNaN();
  });

  it('does not set sent_at when status is failed', () => {
    const id = db.recordRun({
      report_type: 'monthly',
      report_date: '2026-06-01',
      scheduled_at: '2026-06-01T15:05:00Z',
      status: 'pending',
      is_catch_up: false,
      target_jid: 'group@g.us',
    });

    db.updateRunStatus(id, 'failed', 'timeout');

    const last = db.getLastSuccessfulRun('monthly');
    expect(last).toBeNull();
  });
});

describe('rawRun transaction support', () => {
  it('persists data inserted within a BEGIN/COMMIT transaction', () => {
    db.rawRun('BEGIN');
    db.rawRun(
      `INSERT INTO schedule_runs
        (report_type, report_date, scheduled_at, sent_at, status, is_catch_up, target_jid, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['daily', '2026-06-15', '2026-06-15T15:05:00Z', '2026-06-15T15:05:01Z', 'sent', 0, 'test@g.us', null]
    );
    db.rawRun('COMMIT');

    const last = db.getLastSuccessfulRun('daily');
    expect(last).not.toBeNull();
    expect(last!.report_date).toBe('2026-06-15');
  });

  it('rolls back data inserted before ROLLBACK', () => {
    db.rawRun('BEGIN');
    db.rawRun(
      `INSERT INTO schedule_runs
        (report_type, report_date, scheduled_at, sent_at, status, is_catch_up, target_jid, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['daily', '2026-06-15', '2026-06-15T15:05:00Z', null, 'pending', 0, 'test@g.us', null]
    );
    db.rawRun('ROLLBACK');

    const last = db.getLastSuccessfulRun('daily');
    expect(last).toBeNull();
  });
});

describe('execSql error handling', () => {
  it('throws when rawRun receives invalid SQL', () => {
    expect(() => {
      db.rawRun('THIS IS NOT VALID SQL');
    }).toThrow();
  });

  it('throws when rawRun references a nonexistent table', () => {
    expect(() => {
      db.rawRun('INSERT INTO nonexistent_table (col) VALUES (?)', ['value']);
    }).toThrow();
  });

  it('getLastSuccessfulRun throws when db is not initialized', () => {
    const uninitDb = new Database(':memory:');
    // Not calling initialize() — should throw
    expect(() => uninitDb.getLastSuccessfulRun('daily')).toThrow('not initialized');
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

    const testDb = new Database(dbPath);
    try {
      await testDb.initialize();

      // Directory tree should have been created
      expect(fs.existsSync(path.join(tmpDir, 'subdir', 'data'))).toBe(true);

      // sql.js keeps data in-memory; file only appears after save()
      testDb.upsertMember({
        viewer_id: 88888,
        trainer_name: 'NestedDirPlayer',
        circle_id: 700,
        first_seen: '2026-06-01',
        last_seen: '2026-06-22',
      });
      testDb.save();
      expect(fs.existsSync(dbPath)).toBe(true);

      // Reopen and verify data survived
      const db2 = new Database(dbPath);
      try {
        await db2.initialize();
        const member = db2.getMember(88888);
        expect(member).not.toBeNull();
        expect(member!.trainer_name).toBe('NestedDirPlayer');
      } finally {
        db2.close();
      }
    } finally {
      testDb.close();
    }
  });

  it('works when directory already exists', async () => {
    // Pre-create the directory
    fs.mkdirSync(path.join(tmpDir, 'existing'), { recursive: true });
    const dbPath = path.join(tmpDir, 'existing', 'bot.db');

    const testDb = new Database(dbPath);
    try {
      await testDb.initialize();

      testDb.upsertMember({
        viewer_id: 99999,
        trainer_name: 'ExistingDirPlayer',
        circle_id: 800,
        first_seen: '2026-06-01',
        last_seen: '2026-06-22',
      });
      testDb.save();
      expect(fs.existsSync(dbPath)).toBe(true);
    } finally {
      testDb.close();
    }

    // Verify persisted
    const db2 = new Database(dbPath);
    try {
      await db2.initialize();
      const member = db2.getMember(99999);
      expect(member).not.toBeNull();
      expect(member!.trainer_name).toBe('ExistingDirPlayer');
    } finally {
      db2.close();
    }
  });
});
