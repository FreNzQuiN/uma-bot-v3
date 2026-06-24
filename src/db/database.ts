/**
 * SQLite database for Uma Club Bot v3 operational state.
 *
 * Uses sql.js (pure WASM, no native deps).
 * Handles settings, schedule runs, alert events, member history, rank history.
 */

import type { ScheduleRunRow, MemberHistoryRow, RankHistoryRow } from '../types';
import initSqlJs, { Database as SqlJsDatabase, QueryExecResult } from 'sql.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import * as path from 'path';
import { log } from '../utils/logger';

export class Database {
  private db: SqlJsDatabase | null = null;
  private dbPath: string;
  private saveTimer: ReturnType<typeof setInterval> | null = null;
  private autoSaveMs: number;

  constructor(dbPath?: string, autoSaveMs?: number) {
    this.dbPath = dbPath ?? 'data/bot.db';
    this.autoSaveMs = autoSaveMs ?? 30_000;
  }

  async initialize(): Promise<void> {
    const SQL = await initSqlJs();

    if (this.dbPath === ':memory:') {
      this.db = new SQL.Database();
    } else {
      const dir = path.dirname(this.dbPath);
      if (dir && !existsSync(dir)) {
        const { mkdirSync } = await import('fs');
        mkdirSync(dir, { recursive: true });
      }

      if (existsSync(this.dbPath)) {
        const buffer = readFileSync(this.dbPath);
        this.db = new SQL.Database(buffer);
      } else {
        this.db = new SQL.Database();
      }
    }

    this.createTables();

    if (this.dbPath !== ':memory:') {
      this.saveTimer = setInterval(() => {
        this.save();
      }, this.autoSaveMs);
    }
  }

  private ensureDb(): SqlJsDatabase {
    if (!this.db) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    return this.db;
  }

  private execSql(sql: string, params?: unknown[]): QueryExecResult[] {
    try {
      return this.ensureDb().exec(sql, params);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('DB', `SQL error: ${msg} | SQL: ${sql.substring(0, 100)}`);
      throw err;
    }
  }

  private runSql(sql: string, params?: unknown[]): void {
    try {
      this.ensureDb().run(sql, params);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('DB', `SQL error: ${msg} | SQL: ${sql.substring(0, 100)}`);
      throw err;
    }
  }

  /**
   * Execute raw SQL without error logging. Intended for transaction control
   * (BEGIN/COMMIT/ROLLBACK). sql.js is synchronous — no interleaving possible.
   */
  rawRun(sql: string, params?: unknown[]): void {
    this.ensureDb().run(sql, params);
  }

  private createTables(): void {
    const db = this.ensureDb();

    this.runSql(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    this.runSql(`
      CREATE TABLE IF NOT EXISTS schedule_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        report_type TEXT NOT NULL,
        report_date TEXT NOT NULL,
        scheduled_at TEXT NOT NULL,
        sent_at TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        is_catch_up INTEGER NOT NULL DEFAULT 0,
        target_jid TEXT NOT NULL,
        error_message TEXT
      )
    `);

    this.runSql(`
      CREATE TABLE IF NOT EXISTS alert_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        alert_type TEXT NOT NULL,
        event_key TEXT NOT NULL UNIQUE,
        member_viewer_id TEXT NOT NULL,
        report_date TEXT NOT NULL,
        created_at TEXT NOT NULL,
        sent_at TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        message TEXT NOT NULL
      )
    `);

    this.runSql(`
      CREATE TABLE IF NOT EXISTS member_history (
        viewer_id INTEGER PRIMARY KEY,
        trainer_name TEXT NOT NULL,
        circle_id INTEGER NOT NULL,
        first_seen TEXT NOT NULL,
        last_seen TEXT NOT NULL,
        previous_circle_id INTEGER,
        previous_circle_name TEXT,
        status TEXT NOT NULL DEFAULT 'active'
      )
    `);

    this.runSql(`
      CREATE TABLE IF NOT EXISTS rank_history (
        date TEXT NOT NULL,
        circle_id INTEGER NOT NULL,
        monthly_rank INTEGER NOT NULL,
        monthly_point INTEGER NOT NULL,
        club_rank INTEGER NOT NULL,
        fans_to_next_tier INTEGER NOT NULL,
        fans_to_lower_tier INTEGER NOT NULL,
        PRIMARY KEY (date, circle_id)
      )
    `);

    // Performance indexes
    this.runSql('CREATE INDEX IF NOT EXISTS idx_member_history_circle_id ON member_history(circle_id)');
    this.runSql('CREATE INDEX IF NOT EXISTS idx_rank_history_circle_date ON rank_history(circle_id, date DESC)');
    this.runSql('CREATE INDEX IF NOT EXISTS idx_schedule_runs_type_status ON schedule_runs(report_type, status, id DESC)');
  }

  // ============================================================
  // Schedule runs
  // ============================================================

  getLastSuccessfulRun(reportType: string): ScheduleRunRow | null {
    const db = this.ensureDb();
    const result = this.execSql(
      'SELECT id, report_type, report_date, scheduled_at, sent_at, status, is_catch_up, target_jid, error_message FROM schedule_runs WHERE report_type = ? AND status = ? ORDER BY id DESC LIMIT 1',
      [reportType, 'sent']
    );
    if (result.length === 0 || result[0].values.length === 0) {
      return null;
    }
    return this.rowToScheduleRun(result[0]);
  }

  recordRun(run: {
    report_type: string;
    report_date: string;
    scheduled_at: string;
    sent_at?: string | null;
    status: string;
    is_catch_up: boolean;
    target_jid: string;
    error_message?: string | null;
  }): number {
    const db = this.ensureDb();
    this.runSql(
      `INSERT INTO schedule_runs
        (report_type, report_date, scheduled_at, sent_at, status, is_catch_up, target_jid, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        run.report_type,
        run.report_date,
        run.scheduled_at,
        run.sent_at ?? null,
        run.status,
        run.is_catch_up ? 1 : 0,
        run.target_jid,
        run.error_message ?? null,
      ]
    );
    const result = this.execSql('SELECT last_insert_rowid() as id');
    return result[0].values[0][0] as number;
  }

  updateRunStatus(id: number, status: string, errorMessage?: string): void {
    const db = this.ensureDb();
    if (status === 'sent') {
      const now = new Date().toISOString();
      this.runSql(
        'UPDATE schedule_runs SET status = ?, sent_at = ?, error_message = ? WHERE id = ?',
        [status, now, errorMessage ?? null, id]
      );
    } else {
      this.runSql(
        'UPDATE schedule_runs SET status = ?, error_message = ? WHERE id = ?',
        [status, errorMessage ?? null, id]
      );
    }
  }

  // ============================================================
  // Alert events
  // ============================================================

  isAlertAlreadySent(eventKey: string): boolean {
    const db = this.ensureDb();
    const result = this.execSql(
      'SELECT id FROM alert_events WHERE event_key = ? AND status IN (?, ?)',
      [eventKey, 'sent', 'suppressed']
    );
    return result.length > 0 && result[0].values.length > 0;
  }

  recordAlert(alert: {
    alert_type: string;
    event_key: string;
    member_viewer_id: string;
    report_date: string;
    created_at: string;
    status?: string;
    message: string;
  }): number {
    const db = this.ensureDb();

    // Check if this event_key already exists
    const existing = this.execSql('SELECT id FROM alert_events WHERE event_key = ?', [alert.event_key]);
    if (existing.length > 0 && existing[0].values.length > 0) {
      return existing[0].values[0][0] as number; // return existing ID
    }

    this.runSql(
      `INSERT INTO alert_events
        (alert_type, event_key, member_viewer_id, report_date, created_at, status, message)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        alert.alert_type,
        alert.event_key,
        alert.member_viewer_id,
        alert.report_date,
        alert.created_at,
        alert.status ?? 'pending',
        alert.message,
      ]
    );
    const result = this.execSql('SELECT last_insert_rowid() as id');
    return result[0].values[0][0] as number;
  }

  markAlertSent(id: number): void {
    const db = this.ensureDb();
    const now = new Date().toISOString();
    this.runSql(
      'UPDATE alert_events SET status = ?, sent_at = ? WHERE id = ?',
      ['sent', now, id]
    );
  }

  // ============================================================
  // Member history
  // ============================================================

  upsertMember(member: {
    viewer_id: number;
    trainer_name: string;
    circle_id: number;
    first_seen: string;
    last_seen: string;
    previous_circle_id?: number | null;
    previous_circle_name?: string | null;
    status?: string;
  }): void {
    const db = this.ensureDb();
    this.runSql(
      `INSERT INTO member_history
        (viewer_id, trainer_name, circle_id, first_seen, last_seen, previous_circle_id, previous_circle_name, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(viewer_id) DO UPDATE SET
        trainer_name = excluded.trainer_name,
        circle_id = excluded.circle_id,
        last_seen = excluded.last_seen,
        previous_circle_id = COALESCE(excluded.previous_circle_id, member_history.previous_circle_id),
        previous_circle_name = COALESCE(excluded.previous_circle_name, member_history.previous_circle_name),
        status = excluded.status`,
      [
        member.viewer_id,
        member.trainer_name,
        member.circle_id,
        member.first_seen,
        member.last_seen,
        member.previous_circle_id ?? null,
        member.previous_circle_name ?? null,
        member.status ?? 'active',
      ]
    );
  }

  getMembers(circleId: number): MemberHistoryRow[] {
    const db = this.ensureDb();
    const result = this.execSql(
      'SELECT viewer_id, trainer_name, circle_id, first_seen, last_seen, previous_circle_id, previous_circle_name, status FROM member_history WHERE circle_id = ? ORDER BY trainer_name',
      [circleId]
    );
    if (result.length === 0) return [];
    return this.rowsToMemberHistory(result[0]);
  }

  getMember(viewerId: number): MemberHistoryRow | null {
    const db = this.ensureDb();
    const result = this.execSql(
      'SELECT viewer_id, trainer_name, circle_id, first_seen, last_seen, previous_circle_id, previous_circle_name, status FROM member_history WHERE viewer_id = ?',
      [viewerId]
    );
    if (result.length === 0 || result[0].values.length === 0) return null;
    return this.rowToMemberHistory(result[0]);
  }

  // ============================================================
  // Rank history
  // ============================================================

  saveRankHistory(row: {
    date: string;
    circle_id: number;
    monthly_rank: number;
    monthly_point: number;
    club_rank: number;
    fans_to_next_tier: number;
    fans_to_lower_tier: number;
  }): void {
    const db = this.ensureDb();
    this.runSql(
      `INSERT OR REPLACE INTO rank_history
        (date, circle_id, monthly_rank, monthly_point, club_rank, fans_to_next_tier, fans_to_lower_tier)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        row.date,
        row.circle_id,
        row.monthly_rank,
        row.monthly_point,
        row.club_rank,
        row.fans_to_next_tier,
        row.fans_to_lower_tier,
      ]
    );
  }

  getRankHistory(circleId: number, days: number): RankHistoryRow[] {
    const db = this.ensureDb();
    const result = this.execSql(
      `SELECT date, circle_id, monthly_rank, monthly_point, club_rank, fans_to_next_tier, fans_to_lower_tier FROM rank_history
       WHERE circle_id = ?
       ORDER BY date DESC
       LIMIT ?`,
      [circleId, days]
    );
    if (result.length === 0) return [];
    return this.rowsToRankHistory(result[0]);
  }

  // ============================================================
  // Persistence
  // ============================================================

  save(): void {
    const db = this.ensureDb();
    const data = db.export();
    const buffer = Buffer.from(data);
    writeFileSync(this.dbPath, buffer);
  }

  close(): void {
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.db) {
      if (this.dbPath !== ':memory:') {
        this.save();
      }
      this.db.close();
      this.db = null;
    }
  }

  // ============================================================
  // Helpers
  // ============================================================

  private rowToScheduleRun(result: { columns: string[]; values: unknown[][] }): ScheduleRunRow | null {
    if (result.values.length === 0) return null;
    const obj: Record<string, unknown> = {};
    result.columns.forEach((col, i) => {
      obj[col] = result.values[0][i];
    });
    return {
      id: obj.id as number,
      report_type: obj.report_type as string,
      report_date: obj.report_date as string,
      scheduled_at: obj.scheduled_at as string,
      sent_at: obj.sent_at as string | null,
      status: obj.status as ScheduleRunRow['status'],
      is_catch_up: obj.is_catch_up === 1 || obj.is_catch_up === true,
      target_jid: obj.target_jid as string,
      error_message: obj.error_message as string | null,
    };
  }

  private mapColumns<T>(
    result: { columns: string[]; values: unknown[][] },
    mapper: (obj: Record<string, unknown>) => T,
    index: number = 0
  ): T {
    const obj: Record<string, unknown> = {};
    result.columns.forEach((col, i) => {
      obj[col] = result.values[index][i];
    });
    return mapper(obj);
  }

  private rowToMemberHistory(result: { columns: string[]; values: unknown[][] }): MemberHistoryRow | null {
    if (result.values.length === 0) return null;
    return this.mapColumns(result, (obj) => ({
      viewer_id: obj.viewer_id as number,
      trainer_name: obj.trainer_name as string,
      circle_id: obj.circle_id as number,
      first_seen: obj.first_seen as string,
      last_seen: obj.last_seen as string,
      previous_circle_id: obj.previous_circle_id as number | null,
      previous_circle_name: obj.previous_circle_name as string | null,
      status: obj.status as MemberHistoryRow['status'],
    }));
  }

  private rowsToMemberHistory(result: { columns: string[]; values: unknown[][] }): MemberHistoryRow[] {
    return result.values.map((_, idx) =>
      this.mapColumns<MemberHistoryRow>(result, (obj) => ({
        viewer_id: obj.viewer_id as number,
        trainer_name: obj.trainer_name as string,
        circle_id: obj.circle_id as number,
        first_seen: obj.first_seen as string,
        last_seen: obj.last_seen as string,
        previous_circle_id: obj.previous_circle_id as number | null,
        previous_circle_name: obj.previous_circle_name as string | null,
        status: obj.status as MemberHistoryRow['status'],
      }), idx)
    );
  }

  private rowsToRankHistory(result: { columns: string[]; values: unknown[][] }): RankHistoryRow[] {
    return result.values.map((_, idx) =>
      this.mapColumns<RankHistoryRow>(result, (obj) => ({
        date: obj.date as string,
        circle_id: obj.circle_id as number,
        monthly_rank: obj.monthly_rank as number,
        monthly_point: obj.monthly_point as number,
        club_rank: obj.club_rank as number,
        fans_to_next_tier: obj.fans_to_next_tier as number,
        fans_to_lower_tier: obj.fans_to_lower_tier as number,
      }), idx)
    );
  }
}
