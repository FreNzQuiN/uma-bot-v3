/**
 * Alert detection and deduplication for Uma Club Bot v3.
 *
 * Detects: performance drops, demotion risk, streak breaks, new transfers, rank drops.
 * Deduplicates via Database event_key uniqueness.
 * All alerts are admin-only by default.
 */

import type { Snapshot, BotConfig, ComputedMember } from '../types';
import { getDataDayFromSnapshot } from '../data/snapshot';
import { computeTierData } from '../reports/compute';
import { formatNumber } from '../utils/format';
import {
  computeRollingAverage,
  getDailyGain,
  getLatestDataDay,
} from '../data/daily-fans';
import type { Database } from '../db/database';
import { getDataDate } from '../utils/timezone';
import { log } from '../utils/logger';

// ============================================================
// Alert types
// ============================================================

export interface Alert {
  type:
    | 'performance_drop'
    | 'demotion_risk'
    | 'streak_break'
    | 'new_transfer'
    | 'rank_drop';
  eventKey: string;
  memberViewerId: string;
  message: string;
  reportDate: string;
}

// ============================================================
// Detection
// ============================================================

export function detectAlerts(
  computedMembers: ComputedMember[],
  snapshot: Snapshot,
  config: BotConfig,
  db: Database
): Alert[] {
  if (!config.alerts.enabled) return [];

  log.debug('Alert', `Running alert detection (performanceDrop=${config.alerts.performanceDrop.enabled}, demotionRisk=${config.alerts.demotionRisk.enabled}, streakBreak=${config.alerts.streakBreak.enabled}, newTransfer=${config.alerts.newTransfer.enabled}, rankDrop=${config.alerts.rankDrop.enabled})`);

  const alerts: Alert[] = [];
  const latestDataDay = getDataDayFromSnapshot(snapshot);
  const reportDate = snapshot.circle.last_updated
    ? snapshot.circle.last_updated.split('T')[0]
    : getDataDate();

  // --- Performance drop ---
  if (config.alerts.performanceDrop.enabled) {
    const minHistory = config.alerts.performanceDrop.minHistoryDays;
    const threshold = config.alerts.performanceDrop.thresholdPercent / 100;

    for (const member of computedMembers) {
      if (member.status !== 'active') continue;
      if (member.isTransfer) continue; // transfer baseline inflates avg
      const avg7d = computeRollingAverage(
        member.dailyFans,
        latestDataDay,
        minHistory,
        config.requirements.includeTransferDataInCalculation
      );
      if (avg7d <= 0) continue;

      const todayGain = member.latestDailyGain;
      if (todayGain < avg7d * threshold) {
        const eventKey = `performance_drop:${reportDate}:${member.viewerId}`;
        if (!db.isAlertAlreadySent(eventKey)) {
          alerts.push({
            type: 'performance_drop',
            eventKey,
            memberViewerId: String(member.viewerId),
            message: `${member.trainerName} — gain hari ini ${formatNumber(todayGain)} (rata-rata ${minHistory} hari: ${formatNumber(avg7d)})`,
            reportDate,
          });
        }
      }
    }
  }

  // --- Demotion risk ---
  if (config.alerts.demotionRisk.enabled) {
    const tierData = computeTierData(snapshot);
    if (tierData.riskLevel === 'HIGH') {
      const eventKey = `demotion_risk:${reportDate}`;
      if (!db.isAlertAlreadySent(eventKey)) {
        alerts.push({
          type: 'demotion_risk',
          eventKey,
          memberViewerId: 'club',
          message: `Degradasi risk! Buffer ${formatNumber(tierData.demotionBuffer)} — kurang dari ${config.alerts.demotionRisk.bufferDays} hari pace`,
          reportDate,
        });
      }
    }
  }

  // --- Streak break ---
  if (config.alerts.streakBreak.enabled) {
    for (const member of computedMembers) {
      if (member.status !== 'active') continue;
      if (member.isTransfer) continue; // transfer baselines not a real streak
      if (member.latestDailyGain > 0) continue; // still gaining

      // Had gains before (active days > 0) but latest is zero
      const activeDays = countActiveDaysUpTo(member, member.latestPositiveDay);
      if (activeDays < 3) continue; // not enough history for a streak

      const eventKey = `streak_break:${reportDate}:${member.viewerId}`;
      if (!db.isAlertAlreadySent(eventKey)) {
        alerts.push({
          type: 'streak_break',
          eventKey,
          memberViewerId: String(member.viewerId),
            message: `${member.trainerName} — streak terputus setelah ${activeDays} hari aktif berturut-turut`,
          reportDate,
        });
      }
    }
  }

  // --- New transfer ---
  if (config.alerts.newTransfer.enabled) {
    for (const member of computedMembers) {
      if (!member.isTransfer) continue;
      const eventKey = `new_transfer:${reportDate}:${member.viewerId}`;
      if (!db.isAlertAlreadySent(eventKey)) {
        const from = member.previousCircleName
          ? ` dari ${member.previousCircleName}`
          : '';
        alerts.push({
          type: 'new_transfer',
          eventKey,
          memberViewerId: String(member.viewerId),
            message: `${member.trainerName} — transfer baru terdeteksi${from}`,
          reportDate,
        });
      }
    }
  }

  // --- Rank drop ---
  if (config.alerts.rankDrop.enabled) {
    const diff =
      (snapshot.circle.yesterday_rank ?? 0) > 0
        ? snapshot.circle.monthly_rank - snapshot.circle.yesterday_rank!
        : 0;

    if (diff > config.alerts.rankDrop.positions) {
      const eventKey = `rank_drop:${reportDate}`;
      if (!db.isAlertAlreadySent(eventKey)) {
        alerts.push({
          type: 'rank_drop',
          eventKey,
          memberViewerId: 'club',
          message: `Rank turun ${diff} posisi — peringatan: pergerakan signifikan (${snapshot.circle.yesterday_rank} → ${snapshot.circle.monthly_rank})`,
          reportDate,
        });
      }
    }
  }

  // --- Quiet hours filter ---
  if (config.alerts.quietHours.enabled && alerts.length > 0) {
    const now = new Date();
    const displayParts = new Intl.DateTimeFormat('en-US', {
      timeZone: config.timezone,
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
    const currentHour = parseInt(displayParts.find((p) => p.type === 'hour')!.value, 10);

    const startHour = parseInt(config.alerts.quietHours.start.split(':')[0], 10);
    const endHour = parseInt(config.alerts.quietHours.end.split(':')[0], 10);

    let isQuiet = false;
    if (startHour <= endHour) {
      isQuiet = currentHour >= startHour && currentHour < endHour;
    } else {
      // Wraps midnight (e.g., 23:00 - 06:00)
      isQuiet = currentHour >= startHour || currentHour < endHour;
    }

    if (isQuiet) {
      // Record alerts for dedup so they don't re-fire after quiet hours end
      for (const alert of alerts) {
        if (!db.isAlertAlreadySent(alert.eventKey)) {
          db.recordAlert({
            alert_type: alert.type,
            event_key: alert.eventKey,
            member_viewer_id: alert.memberViewerId,
            report_date: alert.reportDate,
            created_at: new Date().toISOString(),
            status: 'suppressed',
            message: alert.message,
          });
        }
      }
      log.info('Alert', `${alerts.length} alert(s) suppressed during quiet hours (${startHour}:00-${endHour}:00)`);
      return [];
    }
  }

  return alerts;
}

// ============================================================
// Deduplication
// ============================================================

export function deduplicateAlerts(alerts: Alert[], db: Database): Alert[] {
  return alerts.filter((a) => !db.isAlertAlreadySent(a.eventKey));
}

// ============================================================
// Formatting
// ============================================================

export function formatAlerts(alerts: Alert[], isCatchUp: boolean): string {
  if (alerts.length === 0) return '';

  const header = isCatchUp ? '_[catch-up alerts]_' : '*⚠️ Alerts*';

  const grouped: Record<string, Alert[]> = {};
  for (const alert of alerts) {
    if (!grouped[alert.type]) grouped[alert.type] = [];
    grouped[alert.type].push(alert);
  }

  const lines: string[] = [header, ''];

  const typeLabels: Record<string, string> = {
    performance_drop: 'Penurunan performa',
    demotion_risk: 'Risiko degradasi',
    streak_break: 'Streak terputus',
    new_transfer: 'Transfer baru',
    rank_drop: 'Rank turun',
  };

  for (const [type, typeAlerts] of Object.entries(grouped)) {
    if (typeAlerts.length === 1) {
      lines.push(typeAlerts[0].message);
    } else {
      lines.push(`${typeAlerts.length} ${typeLabels[type] ?? type} terdeteksi`);
      for (const a of typeAlerts) {
        lines.push(`  • ${a.message}`);
      }
    }
  }

  return lines.join('\n');
}

// ============================================================
// Catch-up alert aggregation
// ============================================================

const AGGREGATE_LABELS: Record<string, string> = {
  performance_drop: 'penurunan performa',
  demotion_risk: 'hari risiko degradasi',
  streak_break: 'streak terputus',
  new_transfer: 'transfer baru',
  rank_drop: 'rank turun',
};

/**
 * Aggregate alerts into a single grouped summary message for catch-up.
 * Groups by type and counts occurrences, using singular/plural forms.
 *
 * Example output:
 *   [catch-up alerts]
 *   3 performance drops detected
 *   1 new transfer detected
 */
export function aggregateAlerts(alerts: Alert[]): string {
  if (alerts.length === 0) return '';

  const grouped: Record<string, number> = {};
  for (const alert of alerts) {
    grouped[alert.type] = (grouped[alert.type] ?? 0) + 1;
  }

  const lines: string[] = ['_[catch-up alerts]_'];

  for (const [type, count] of Object.entries(grouped)) {
    const label = AGGREGATE_LABELS[type] ?? type;
    lines.push(`${count} ${label} terdeteksi`);
  }

  return lines.join('\n');
}

// ============================================================
// Helpers
// ============================================================

/**
 * Count the consecutive active days of the streak that just broke.
 * upToDay is the member's latest day with 0 gain.
 * Finds the last active day before the break, then counts backwards.
 */
function countActiveDaysUpTo(member: ComputedMember, upToDay: number): number {
  // Find the last day with positive gain before the break
  let lastActiveDay = -1;
  for (let day = upToDay - 1; day >= 2; day--) {
    if (getDailyGain(member.dailyFans, day) > 0) {
      lastActiveDay = day;
      break;
    }
  }
  if (lastActiveDay === -1) return 0;

  // Count the streak ending at lastActiveDay
  let streak = 0;
  for (let day = lastActiveDay; day >= 2; day--) {
    if (getDailyGain(member.dailyFans, day) > 0) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}
