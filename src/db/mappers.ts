/**
 * Shared row-to-object mappers for database adapters.
 * Both SQLite and MySQL adapters use these to convert raw rows
 * into typed row objects, avoiding duplicated mapping logic.
 */

import type { ScheduleRunRow, MemberHistoryRow, RankHistoryRow } from '../types';

export function mapScheduleRunRow(row: Record<string, unknown>): ScheduleRunRow {
  return {
    id: row.id as number,
    report_type: row.report_type as string,
    report_date: row.report_date as string,
    scheduled_at: row.scheduled_at as string,
    sent_at: row.sent_at as string | null,
    status: row.status as ScheduleRunRow['status'],
    is_catch_up: row.is_catch_up === 1 || row.is_catch_up === true,
    target_jid: row.target_jid as string,
    error_message: row.error_message as string | null,
  };
}

export function mapMemberHistoryRow(row: Record<string, unknown>): MemberHistoryRow {
  return {
    viewer_id: row.viewer_id as number,
    trainer_name: row.trainer_name as string,
    circle_id: row.circle_id as number,
    first_seen: row.first_seen as string,
    last_seen: row.last_seen as string,
    previous_circle_id: row.previous_circle_id as number | null,
    previous_circle_name: row.previous_circle_name as string | null,
    status: row.status as MemberHistoryRow['status'],
  };
}

export function mapRankHistoryRow(row: Record<string, unknown>): RankHistoryRow {
  return {
    date: row.date as string,
    circle_id: row.circle_id as number,
    monthly_rank: row.monthly_rank as number,
    monthly_point: row.monthly_point as number,
    club_rank: row.club_rank as number,
    fans_to_next_tier: row.fans_to_next_tier as number,
    fans_to_lower_tier: row.fans_to_lower_tier as number,
  };
}
