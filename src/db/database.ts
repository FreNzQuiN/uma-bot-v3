/**
 * SQLite database adapter for Uma Club Bot v3.
 *
 * Uses sql.js (pure WASM, no native deps).
 * Implements IDatabase for pluggable backend support.
 */

import type {
  ScheduleRunRow,
  MemberHistoryRow,
  RankHistoryRow,
} from "../types";
import type {
  IDatabase,
  ScheduleRunInsert,
  AlertEventInsert,
  MemberHistoryInsert,
  RankHistoryInsert,
} from "./types";
import {
  mapScheduleRunRow,
  mapMemberHistoryRow,
  mapRankHistoryRow,
} from "./mappers";
import initSqlJs, {
  Database as SqlJsDatabase,
  QueryExecResult,
  BindParams,
} from "sql.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import * as path from "path";
import { log } from "../utils/logger";

export class SqliteDatabase implements IDatabase {
  private db: SqlJsDatabase | null = null;
  private dbPath: string;
  private saveTimer: ReturnType<typeof setInterval> | null = null;
  private autoSaveMs: number;
  private dirty = false;

  constructor(dbPath?: string, autoSaveMs?: number) {
    this.dbPath = dbPath ?? "data/bot.db";
    this.autoSaveMs = autoSaveMs ?? 30_000;
  }

  async initialize(): Promise<void> {
    const SQL = await initSqlJs();

    if (this.dbPath === ":memory:") {
      this.db = new SQL.Database();
    } else {
      const dir = path.dirname(this.dbPath);
      if (dir && !existsSync(dir)) {
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

    if (this.dbPath !== ":memory:") {
      this.saveTimer = setInterval(() => {
        this.save().catch((err) => {
          log.error(
            "DB",
            `Auto-save failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      }, this.autoSaveMs);
    }
  }

  private ensureDb(): SqlJsDatabase {
    if (!this.db) {
      throw new Error("Database not initialized. Call initialize() first.");
    }
    return this.db;
  }

  private execSql(sql: string, params?: BindParams): QueryExecResult[] {
    try {
      const result = this.ensureDb().exec(sql, params);
      this.dirty = true;
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error("DB", `SQL error: ${msg} | SQL: ${sql.substring(0, 100)}`);
      throw err;
    }
  }

  private runSql(sql: string, params?: BindParams): void {
    try {
      this.ensureDb().run(sql, params);
      this.dirty = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error("DB", `SQL error: ${msg} | SQL: ${sql.substring(0, 100)}`);
      throw err;
    }
  }

  private rawRun(sql: string, params?: BindParams): void {
    try {
      this.ensureDb().run(sql, params);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error("DB", `Transaction command failed: ${msg} | SQL: ${sql}`);
      throw err;
    }
  }

  private createTables(): void {
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

    this.runSql(
      "CREATE INDEX IF NOT EXISTS idx_member_history_circle_id ON member_history(circle_id)",
    );
    this.runSql(
      "CREATE INDEX IF NOT EXISTS idx_rank_history_circle_date ON rank_history(circle_id, date DESC)",
    );
    this.runSql(
      "CREATE INDEX IF NOT EXISTS idx_schedule_runs_type_status ON schedule_runs(report_type, status, id DESC)",
    );
  }

  async getLastSuccessfulRun(
    reportType: string,
  ): Promise<ScheduleRunRow | null> {
    const result = this.execSql(
      "SELECT id, report_type, report_date, scheduled_at, sent_at, status, is_catch_up, target_jid, error_message FROM schedule_runs WHERE report_type = ? AND status = ? ORDER BY id DESC LIMIT 1",
      [reportType, "sent"],
    );
    if (result.length === 0 || result[0].values.length === 0) {
      return null;
    }
    return this.rowToScheduleRun(result[0]);
  }

  async getLastRun(reportType: string): Promise<ScheduleRunRow | null> {
    const result = this.execSql(
      "SELECT id, report_type, report_date, scheduled_at, sent_at, status, is_catch_up, target_jid, error_message FROM schedule_runs WHERE report_type = ? AND status IN (?, ?) ORDER BY id DESC LIMIT 1",
      [reportType, "sent", "skipped"],
    );
    if (result.length === 0 || result[0].values.length === 0) {
      return null;
    }
    return this.rowToScheduleRun(result[0]);
  }

  async recordRun(run: ScheduleRunInsert): Promise<number> {
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
      ],
    );
    const result = this.execSql("SELECT last_insert_rowid() as id");
    return result[0].values[0][0] as number;
  }

  async updateRunStatus(
    id: number,
    status: string,
    errorMessage?: string,
  ): Promise<void> {
    if (status === "sent") {
      const now = new Date().toISOString();
      this.runSql(
        "UPDATE schedule_runs SET status = ?, sent_at = ?, error_message = ? WHERE id = ?",
        [status, now, errorMessage ?? null, id],
      );
    } else {
      this.runSql(
        "UPDATE schedule_runs SET status = ?, error_message = ? WHERE id = ?",
        [status, errorMessage ?? null, id],
      );
    }
  }

  async getExistingAlertKeys(eventKeys: string[]): Promise<Set<string>> {
    if (eventKeys.length === 0) return new Set();
    const placeholders = eventKeys.map(() => "?").join(",");
    const result = this.execSql(
      `SELECT event_key FROM alert_events WHERE event_key IN (${placeholders}) AND status IN (?, ?)`,
      [...eventKeys, "sent", "suppressed"],
    );
    if (result.length === 0) return new Set();
    return new Set(result[0].values.map((row) => row[0] as string));
  }

  async recordAlert(alert: AlertEventInsert): Promise<number> {
    // NOTE: This check-then-insert is not atomic (TOCTOU). Safe in single-process
    // mode due to SQLite file-level locking. For multi-process scenarios, use the
    // MySQL adapter's INSERT IGNORE pattern instead.
    const existing = this.execSql(
      "SELECT id FROM alert_events WHERE event_key = ?",
      [alert.event_key],
    );
    if (existing.length > 0 && existing[0].values.length > 0) {
      return existing[0].values[0][0] as number;
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
        alert.status ?? "pending",
        alert.message,
      ],
    );
    const result = this.execSql("SELECT last_insert_rowid() as id");
    return result[0].values[0][0] as number;
  }

  async markAlertSent(id: number): Promise<void> {
    const now = new Date().toISOString();
    this.runSql(
      "UPDATE alert_events SET status = ?, sent_at = ? WHERE id = ?",
      ["sent", now, id],
    );
  }

  async recordAlerts(alerts: AlertEventInsert[]): Promise<number[]> {
    if (alerts.length === 0) return [];
    return this.transaction(async () => {
      const ids: number[] = [];
      for (const alert of alerts) {
        ids.push(await this.recordAlert(alert));
      }
      return ids;
    });
  }

  async markAlertsSent(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    const now = new Date().toISOString();
    const placeholders = ids.map(() => "?").join(",");
    this.runSql(
      `UPDATE alert_events SET status = ?, sent_at = ? WHERE id IN (${placeholders})`,
      ["sent", now, ...ids],
    );
  }

  async markAlertsByEventKeys(eventKeys: string[]): Promise<void> {
    if (eventKeys.length === 0) return;
    const now = new Date().toISOString();
    const placeholders = eventKeys.map(() => "?").join(",");
    this.runSql(
      `UPDATE alert_events SET status = ?, sent_at = ? WHERE event_key IN (${placeholders})`,
      ["sent", now, ...eventKeys],
    );
  }

  async upsertMember(member: MemberHistoryInsert): Promise<void> {
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
        member.status ?? "active",
      ],
    );
  }

  async upsertMembers(members: MemberHistoryInsert[]): Promise<void> {
    if (members.length === 0) return;
    await this.transaction(async () => {
      for (const member of members) {
        await this.upsertMember(member);
      }
    });
  }

  async getMembers(circleId: number): Promise<MemberHistoryRow[]> {
    const result = this.execSql(
      "SELECT viewer_id, trainer_name, circle_id, first_seen, last_seen, previous_circle_id, previous_circle_name, status FROM member_history WHERE circle_id = ? ORDER BY trainer_name",
      [circleId],
    );
    if (result.length === 0) return [];
    return this.rowsToMemberHistory(result[0]);
  }

  async getMember(viewerId: number): Promise<MemberHistoryRow | null> {
    const result = this.execSql(
      "SELECT viewer_id, trainer_name, circle_id, first_seen, last_seen, previous_circle_id, previous_circle_name, status FROM member_history WHERE viewer_id = ?",
      [viewerId],
    );
    if (result.length === 0 || result[0].values.length === 0) return null;
    return this.rowToMemberHistory(result[0]);
  }

  async saveRankHistory(row: RankHistoryInsert): Promise<void> {
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
      ],
    );
  }

  async getRankHistory(
    circleId: number,
    days: number,
  ): Promise<RankHistoryRow[]> {
    const result = this.execSql(
      `SELECT date, circle_id, monthly_rank, monthly_point, club_rank, fans_to_next_tier, fans_to_lower_tier FROM rank_history
       WHERE circle_id = ?
       ORDER BY date DESC
       LIMIT ?`,
      [circleId, days],
    );
    if (result.length === 0) return [];
    return this.rowsToRankHistory(result[0]);
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    this.ensureDb();
    this.rawRun("BEGIN");
    try {
      const result = await fn();
      this.rawRun("COMMIT");
      return result;
    } catch (err) {
      try {
        this.rawRun("ROLLBACK");
      } catch (rollbackErr) {
        log.error(
          "DB",
          `Rollback failed: ${rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)}`,
        );
      }
      throw err;
    }
  }

  async save(): Promise<void> {
    if (!this.dirty) return;
    const db = this.ensureDb();
    const data = db.export();
    const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    writeFileSync(this.dbPath, buffer);
    this.dirty = false;
  }

  async close(): Promise<void> {
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.db) {
      if (this.dbPath !== ":memory:") {
        await this.save();
      }
      this.db.close();
      this.db = null;
    }
  }

  private rowToScheduleRun(result: {
    columns: string[];
    values: unknown[][];
  }): ScheduleRunRow | null {
    if (result.values.length === 0) return null;
    return mapScheduleRunRow(this.rowToObj(result));
  }

  private rowToObj(
    result: { columns: string[]; values: unknown[][] },
    index: number = 0,
  ): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    result.columns.forEach((col, i) => {
      obj[col] = result.values[index][i];
    });
    return obj;
  }

  private rowToMemberHistory(result: {
    columns: string[];
    values: unknown[][];
  }): MemberHistoryRow | null {
    if (result.values.length === 0) return null;
    return mapMemberHistoryRow(this.rowToObj(result));
  }

  private rowsToMemberHistory(result: {
    columns: string[];
    values: unknown[][];
  }): MemberHistoryRow[] {
    return result.values.map((_, idx) =>
      mapMemberHistoryRow(this.rowToObj(result, idx)),
    );
  }

  private rowsToRankHistory(result: {
    columns: string[];
    values: unknown[][];
  }): RankHistoryRow[] {
    return result.values.map((_, idx) =>
      mapRankHistoryRow(this.rowToObj(result, idx)),
    );
  }
}
