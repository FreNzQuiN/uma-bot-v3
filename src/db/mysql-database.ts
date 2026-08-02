/**
 * MySQL database adapter for Uma Club Bot v3.
 *
 * Uses mysql2/promise with connection pooling.
 * Implements IDatabase for pluggable backend support.
 * Query SQL is intentionally duplicated with database.ts where
 * dialect-specific; shared row mapping lives in ./mappers.
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
import mysql from "mysql2/promise";
import { log } from "../utils/logger";

export interface MysqlConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  connectionLimit: number;
  ssl: boolean;
}

export class MysqlDatabase implements IDatabase {
  private pool: mysql.Pool | null = null;
  private transactionConn: mysql.PoolConnection | null = null;
  private config: MysqlConfig;
  private isTiDB = false;

  constructor(config: MysqlConfig) {
    this.config = config;
  }

  /** Minimum MySQL version required. CREATE INDEX IF NOT EXISTS needs 8.0.31+. */
  private static readonly MIN_MYSQL_VERSION = { major: 8, minor: 0, patch: 31 };

  async initialize(): Promise<void> {
    const poolConfig: mysql.PoolOptions = {
      host: this.config.host,
      port: this.config.port,
      database: this.config.database,
      user: this.config.user,
      password: this.config.password,
      connectionLimit: this.config.connectionLimit,
      waitForConnections: true,
      queueLimit: 0,
    };

    if (this.config.ssl) {
      poolConfig.ssl = { rejectUnauthorized: true };
    }

    this.pool = mysql.createPool(poolConfig);

    const conn = await this.pool.getConnection();

    await this.checkVersion(conn);

    conn.release();

    await this.createTables();
    log.info(
      "DB",
      `MySQL connected at ${this.config.host}:${this.config.port}/${this.config.database}`,
    );
  }

  private getConn(): mysql.PoolConnection | mysql.Pool {
    return this.transactionConn ?? this.pool!;
  }

  private async checkVersion(conn: mysql.PoolConnection): Promise<void> {
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT VERSION() as version",
    );
    const versionStr = rows[0].version as string;

    // Handle TiDB version strings like "5.7.25-TiDB-v7.1.0" — TiDB is MySQL 8.0+ compatible
    if (versionStr.toLowerCase().includes("tidb")) {
      this.isTiDB = true;
      log.info(
        "DB",
        `TiDB detected: ${versionStr} — using TiDB-compatible SQL syntax`,
      );
      return;
    }

    const match = versionStr.match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!match) {
      log.warn(
        "DB",
        `Could not parse MySQL version "${versionStr}" — proceeding without version check`,
      );
      return;
    }

    const [, majorStr, minorStr, patchStr] = match;
    const major = parseInt(majorStr, 10);
    const minor = parseInt(minorStr, 10);
    const patch = parseInt(patchStr, 10);

    const min = MysqlDatabase.MIN_MYSQL_VERSION;
    const isUnsupported =
      major < min.major ||
      (major === min.major && minor < min.minor) ||
      (major === min.major && minor === min.minor && patch < min.patch);

    if (isUnsupported) {
      throw new Error(
        `MySQL ${versionStr} detected. Minimum required: ${min.major}.${min.minor}.${min.patch}.\n` +
          `Reason: CREATE INDEX IF NOT EXISTS requires MySQL ${min.major}.${min.minor}.${min.patch}+.\n` +
          `Fix: Upgrade MySQL to ${min.major}.${min.minor}.${min.patch}+ or switch to database.backend: sqlite in config.yaml`,
      );
    }
  }

  /**
   * Create index without using CREATE INDEX IF NOT EXISTS (requires MySQL 8.0.31+).
   * Instead, catches ER_DUP_KEYNAME (1061) which means the index already exists.
   */
  private async createIndexSafe(
    conn: mysql.PoolConnection | mysql.Pool,
    sql: string,
  ): Promise<void> {
    try {
      await conn.query(sql);
    } catch (err: unknown) {
      // ER_DUP_KEYNAME = 1061 — index already exists, safe to ignore
      const mysqlErr = err as { code?: string; errno?: number };
      if (mysqlErr.errno === 1061 || mysqlErr.code === "ER_DUP_KEYNAME") {
        return;
      }
      throw err;
    }
  }

  private async createTables(): Promise<void> {
    const conn = this.getConn();

    await conn.query(`
      CREATE TABLE IF NOT EXISTS schedule_runs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        report_type VARCHAR(255) NOT NULL,
        report_date VARCHAR(255) NOT NULL,
        scheduled_at VARCHAR(255) NOT NULL,
        sent_at VARCHAR(255),
        status VARCHAR(255) NOT NULL DEFAULT 'pending',
        is_catch_up TINYINT(1) NOT NULL DEFAULT 0,
        target_jid VARCHAR(255) NOT NULL,
        error_message TEXT
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS alert_events (
        id INT AUTO_INCREMENT PRIMARY KEY,
        alert_type VARCHAR(255) NOT NULL,
        event_key VARCHAR(255) NOT NULL UNIQUE,
        member_viewer_id VARCHAR(255) NOT NULL,
        report_date VARCHAR(255) NOT NULL,
        created_at VARCHAR(255) NOT NULL,
        sent_at VARCHAR(255),
        status VARCHAR(255) NOT NULL DEFAULT 'pending',
        message TEXT NOT NULL
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS member_history (
        viewer_id BIGINT PRIMARY KEY,
        trainer_name VARCHAR(255) NOT NULL,
        circle_id BIGINT NOT NULL,
        first_seen VARCHAR(255) NOT NULL,
        last_seen VARCHAR(255) NOT NULL,
        previous_circle_id BIGINT,
        previous_circle_name VARCHAR(255),
        status VARCHAR(255) NOT NULL DEFAULT 'active'
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS rank_history (
        date VARCHAR(255) NOT NULL,
        circle_id BIGINT NOT NULL,
        monthly_rank INT NOT NULL,
        monthly_point BIGINT NOT NULL,
        club_rank INT NOT NULL,
        fans_to_next_tier BIGINT NOT NULL,
        fans_to_lower_tier BIGINT NOT NULL,
        PRIMARY KEY (date, circle_id)
      )
    `);

    await this.createIndexSafe(
      conn,
      "CREATE INDEX idx_member_history_circle_id ON member_history(circle_id)",
    );
    await this.createIndexSafe(
      conn,
      "CREATE INDEX idx_rank_history_circle_date ON rank_history(circle_id, date DESC)",
    );
    await this.createIndexSafe(
      conn,
      "CREATE INDEX idx_schedule_runs_type_status ON schedule_runs(report_type, status, id DESC)",
    );
  }

  async getLastSuccessfulRun(
    reportType: string,
  ): Promise<ScheduleRunRow | null> {
    const conn = this.getConn();
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT id, report_type, report_date, scheduled_at, sent_at, status, is_catch_up, target_jid, error_message FROM schedule_runs WHERE report_type = ? AND status = ? ORDER BY id DESC LIMIT 1",
      [reportType, "sent"],
    );
    if (rows.length === 0) return null;
    return mapScheduleRunRow(rows[0] as Record<string, unknown>);
  }

  async getLastRun(reportType: string): Promise<ScheduleRunRow | null> {
    const conn = this.getConn();
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT id, report_type, report_date, scheduled_at, sent_at, status, is_catch_up, target_jid, error_message FROM schedule_runs WHERE report_type = ? AND status IN (?, ?) ORDER BY id DESC LIMIT 1",
      [reportType, "sent", "skipped"],
    );
    if (rows.length === 0) return null;
    return mapScheduleRunRow(rows[0] as Record<string, unknown>);
  }

  async recordRun(run: ScheduleRunInsert): Promise<number> {
    const conn = this.getConn();
    await conn.query(
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
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT LAST_INSERT_ID() as id",
    );
    return rows[0].id as number;
  }

  async updateRunStatus(
    id: number,
    status: string,
    errorMessage?: string,
  ): Promise<void> {
    const conn = this.getConn();
    if (status === "sent") {
      const now = new Date().toISOString();
      await conn.query(
        "UPDATE schedule_runs SET status = ?, sent_at = ?, error_message = ? WHERE id = ?",
        [status, now, errorMessage ?? null, id],
      );
    } else {
      await conn.query(
        "UPDATE schedule_runs SET status = ?, error_message = ? WHERE id = ?",
        [status, errorMessage ?? null, id],
      );
    }
  }

  async getExistingAlertKeys(eventKeys: string[]): Promise<Set<string>> {
    if (eventKeys.length === 0) return new Set();
    const conn = this.getConn();
    const placeholders = eventKeys.map(() => "?").join(",");
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT event_key FROM alert_events WHERE event_key IN (${placeholders}) AND status IN (?, ?)`,
      [...eventKeys, "sent", "suppressed"],
    );
    return new Set(rows.map((row) => row.event_key as string));
  }

  async recordAlert(alert: AlertEventInsert): Promise<number> {
    const conn = this.getConn();

    // INSERT IGNORE is atomic — no TOCTOU race condition
    await conn.query(
      `INSERT IGNORE INTO alert_events
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

    // LAST_INSERT_ID() returns 0 if INSERT IGNORE skipped (duplicate)
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT LAST_INSERT_ID() as id",
    );
    const lastId = rows[0].id as number;
    if (lastId > 0) return lastId;

    // Duplicate — fetch existing ID
    const [existing] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT id FROM alert_events WHERE event_key = ?",
      [alert.event_key],
    );
    return existing[0].id as number;
  }

  async markAlertSent(id: number): Promise<void> {
    const conn = this.getConn();
    const now = new Date().toISOString();
    await conn.query(
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
    const conn = this.getConn();
    const now = new Date().toISOString();
    const placeholders = ids.map(() => "?").join(",");
    await conn.query(
      `UPDATE alert_events SET status = ?, sent_at = ? WHERE id IN (${placeholders})`,
      ["sent", now, ...ids],
    );
  }

  async markAlertsByEventKeys(eventKeys: string[]): Promise<void> {
    if (eventKeys.length === 0) return;
    const conn = this.getConn();
    const now = new Date().toISOString();
    const placeholders = eventKeys.map(() => "?").join(",");
    await conn.query(
      `UPDATE alert_events SET status = ?, sent_at = ? WHERE event_key IN (${placeholders})`,
      ["sent", now, ...eventKeys],
    );
  }

  async upsertMember(member: MemberHistoryInsert): Promise<void> {
    const conn = this.getConn();
    const params = [
      member.viewer_id,
      member.trainer_name,
      member.circle_id,
      member.first_seen,
      member.last_seen,
      member.previous_circle_id ?? null,
      member.previous_circle_name ?? null,
      member.status ?? "active",
    ];

    // TiDB requires VALUES() syntax; standard MySQL 8.0.20+ uses AS new_vals alias.
    const sql = this.isTiDB
      ? `INSERT INTO member_history
          (viewer_id, trainer_name, circle_id, first_seen, last_seen, previous_circle_id, previous_circle_name, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
          trainer_name = VALUES(trainer_name),
          circle_id = VALUES(circle_id),
          last_seen = VALUES(last_seen),
          previous_circle_id = COALESCE(VALUES(previous_circle_id), member_history.previous_circle_id),
          previous_circle_name = COALESCE(VALUES(previous_circle_name), member_history.previous_circle_name),
          status = VALUES(status)`
      : `INSERT INTO member_history
          (viewer_id, trainer_name, circle_id, first_seen, last_seen, previous_circle_id, previous_circle_name, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         AS new_vals
         ON DUPLICATE KEY UPDATE
          trainer_name = new_vals.trainer_name,
          circle_id = new_vals.circle_id,
          last_seen = new_vals.last_seen,
          previous_circle_id = COALESCE(new_vals.previous_circle_id, member_history.previous_circle_id),
          previous_circle_name = COALESCE(new_vals.previous_circle_name, member_history.previous_circle_name),
          status = new_vals.status`;

    await conn.query(sql, params);
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
    const conn = this.getConn();
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT viewer_id, trainer_name, circle_id, first_seen, last_seen, previous_circle_id, previous_circle_name, status FROM member_history WHERE circle_id = ? ORDER BY trainer_name",
      [circleId],
    );
    return rows.map((row) =>
      mapMemberHistoryRow(row as Record<string, unknown>),
    );
  }

  async getMember(viewerId: number): Promise<MemberHistoryRow | null> {
    const conn = this.getConn();
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT viewer_id, trainer_name, circle_id, first_seen, last_seen, previous_circle_id, previous_circle_name, status FROM member_history WHERE viewer_id = ?",
      [viewerId],
    );
    if (rows.length === 0) return null;
    return mapMemberHistoryRow(rows[0] as Record<string, unknown>);
  }

  async saveRankHistory(row: RankHistoryInsert): Promise<void> {
    const conn = this.getConn();
    await conn.query(
      `REPLACE INTO rank_history
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
    const conn = this.getConn();
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT date, circle_id, monthly_rank, monthly_point, club_rank, fans_to_next_tier, fans_to_lower_tier FROM rank_history
       WHERE circle_id = ?
       ORDER BY date DESC
       LIMIT ?`,
      [circleId, days],
    );
    return rows.map((row) => mapRankHistoryRow(row as Record<string, unknown>));
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const conn = await this.pool!.getConnection();
    this.transactionConn = conn;
    try {
      await conn.beginTransaction();
      const result = await fn();
      await conn.commit();
      return result;
    } catch (err) {
      try {
        await conn.rollback();
      } catch (rollbackErr) {
        log.error(
          "DB",
          `Rollback failed: ${rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)}`,
        );
      }
      throw err;
    } finally {
      this.transactionConn = null;
      conn.release();
    }
  }

  async save(): Promise<void> {
    // No-op: MySQL auto-persists
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }
}
