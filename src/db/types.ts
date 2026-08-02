/**
 * Database abstraction layer — interface and insert parameter types.
 *
 * All adapters (SQLite, MySQL, future PostgreSQL) implement IDatabase.
 * Consumer code depends only on this interface.
 */

import type {
  ScheduleRunRow,
  MemberHistoryRow,
  RankHistoryRow,
} from "../types";

export const STATUS_SENT = "sent";
export const STATUS_SKIPPED = "skipped";
export const STATUS_SUPPRESSED = "suppressed";
export const STATUS_PENDING = "pending";
export const STATUS_ACTIVE = "active";
export const FIND_ALERT_ID_BY_EVENT_KEY =
  "SELECT id FROM alert_events WHERE event_key = ?";

export interface ScheduleRunInsert {
  report_type: string;
  report_date: string;
  scheduled_at: string;
  sent_at?: string | null;
  status: string;
  is_catch_up: boolean;
  target_jid: string;
  error_message?: string | null;
}

export interface AlertEventInsert {
  alert_type: string;
  event_key: string;
  member_viewer_id: string;
  report_date: string;
  created_at: string;
  status?: string;
  message: string;
}

export interface MemberHistoryInsert {
  viewer_id: number;
  trainer_name: string;
  circle_id: number;
  first_seen: string;
  last_seen: string;
  previous_circle_id?: number | null;
  previous_circle_name?: string | null;
  status?: string;
}

export interface RankHistoryInsert {
  date: string;
  circle_id: number;
  monthly_rank: number;
  monthly_point: number;
  club_rank: number;
  fans_to_next_tier: number;
  fans_to_lower_tier: number;
}

export interface IDatabase {
  initialize(): Promise<void>;
  close(): Promise<void>;
  /** Persist to disk (no-op for external databases). */
  save(): Promise<void>;

  getLastSuccessfulRun(reportType: string): Promise<ScheduleRunRow | null>;
  /** Any terminal status (sent, skipped); used by catch-up detection. */
  getLastRun(reportType: string): Promise<ScheduleRunRow | null>;
  recordRun(run: ScheduleRunInsert): Promise<number>;
  updateRunStatus(
    id: number,
    status: string,
    errorMessage?: string,
  ): Promise<void>;

  getExistingAlertKeys(eventKeys: string[]): Promise<Set<string>>;
  recordAlert(alert: AlertEventInsert): Promise<number>;
  recordAlerts(alerts: AlertEventInsert[]): Promise<number[]>;
  markAlertSent(id: number): Promise<void>;
  markAlertsSent(ids: number[]): Promise<void>;
  /** For deferred delivery after catch-up. */
  markAlertsByEventKeys(eventKeys: string[]): Promise<void>;

  upsertMember(member: MemberHistoryInsert): Promise<void>;
  upsertMembers(members: MemberHistoryInsert[]): Promise<void>;
  getMembers(circleId: number): Promise<MemberHistoryRow[]>;
  getMember(viewerId: number): Promise<MemberHistoryRow | null>;

  saveRankHistory(row: RankHistoryInsert): Promise<void>;
  getRankHistory(circleId: number, days: number): Promise<RankHistoryRow[]>;

  // Replaces manual BEGIN/COMMIT/ROLLBACK
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}
