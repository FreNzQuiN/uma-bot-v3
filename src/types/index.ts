/**
 * Uma Club Bot v3 — Core Type Definitions
 *
 * Based on uma.moe API response shapes and v3-spec-2.md data model.
 */

// ============================================================
// Snapshot (raw uma.moe API response, immutable once saved)
// ============================================================

export interface CircleData {
  circle_id: number;
  name: string;
  comment: string;
  leader_viewer_id: number;
  leader_name: string;
  member_count: number;
  join_style: number;
  policy: number;
  created_at: string;
  last_updated: string;
  monthly_rank: number;
  monthly_point: number;
  last_month_rank: number | null;
  last_month_point: number | null;
  archived: boolean;
  yesterday_updated: string | null;
  yesterday_points: number | null;
  yesterday_rank: number | null;
  live_points: number | null;
  live_rank: number | null;
  last_live_update: string | null;
}

export interface MemberData {
  id: number;
  circle_id: number;
  viewer_id: number;
  trainer_name: string;
  shame_score: number | null;
  year: number;
  month: number;
  /**
   * 32-element cumulative daily fans array.
   * Index 0 = Day 1, Index 30 = Day 31, Index 31 = unused padding.
   * Positive = cumulative total at end of day.
   * Zero = no usable data.
   * Negative = transfer indicator (not negative performance).
   */
  daily_fans: number[];
  last_updated: string;
  previous_circle_id?: number;
  previous_circle_name?: string;
  next_month_start?: number;
}

export interface Snapshot {
  circle: CircleData;
  members: MemberData[];
  club_rank: number;
  fans_to_next_tier: number;
  fans_to_lower_tier: number;
  yesterday_fans_to_next_tier: number;
  yesterday_fans_to_lower_tier: number;
}

// ============================================================
// Derived / computed types
// ============================================================

export type MemberStatus = 'active' | 'stale' | 'left';

export interface ComputedMember {
  viewerId: number;
  trainerName: string;
  status: MemberStatus;
  isTransfer: boolean;
  previousCircleName?: string;
  dailyFans: number[];
  latestPositiveDay: number;    // 1-indexed day number, 0 = no data
  latestPositiveValue: number;
  firstPositiveDay: number;     // 1-indexed day number, 0 = no data
  firstPositiveValue: number;
  monthlyGain: number;
  latestDailyGain: number;
  weeklyGains: number[];        // gains per week block
}

export interface DailyReportData {
  snapshotDate: string;         // WIB date string e.g. "2026-06-11"
  dataUpdateTime: string;      // "11 June 2026, 22:00 WIB"
  clubName: string;
  tier: string;
  rank: number;
  promotionGap: number;
  demotionBuffer: number;
  activeCount: number;
  totalDailyGain: number;
  members: RankedMember[];
  staleWarnings: string[];
  isStale: boolean;
}

export interface RankedMember {
  rank: number;
  trainerName: string;
  dailyGain: number;
  monthlyGain: number;
  isTransfer: boolean;
  previousCircleName?: string;
}

export interface WeeklyReportData {
  snapshotDate: string;
  clubName: string;
  weekNumber: number;           // 1-5
  weekStart: number;            // day number
  weekEnd: number;              // day number
  totalWeeklyGain: number;
  members: RankedMember[];
  belowRequirement: RankedMember[];
}

export interface MonthlyReportData {
  snapshotDate: string;
  clubName: string;
  month: number;
  year: number;
  totalMonthlyGain: number;
  activeCount: number;
  inactiveCount: number;
  leftCount: number;
  members: RankedMember[];
  projectedMonthEnd: number;
}

export interface TierData {
  clubRank: number;
  tierName: string;
  promotionGap: number;
  demotionBuffer: number;
  requiredPace: number;
  currentPace: number;
  daysLeft: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  projectedOutcome: 'promote' | 'stay' | 'demotion_risk' | 'unknown';
}

export interface MemberAnalysis {
  trainerName: string;
  monthlyGain: number;
  latestDailyGain: number;
  avg3Day: number;
  avg7Day: number;
  consistencyScore: number;
  activeDays: number;
  projectedMonthEnd: number;
  requirementStatus: string;
  isTransfer: boolean;
  trendDirection: 'up' | 'down' | 'stable';
}

export interface CompareData {
  memberA: MemberAnalysis;
  memberB: MemberAnalysis;
  winner: 'A' | 'B' | 'tie';
  period: 'monthly' | 'weekly' | 'daily';
}

// ============================================================
// Configuration
// ============================================================

export interface BotConfig {
  circleId: number;
  timezone: string;

  commands: {
    prefixes: string[];
    maxDailyOffset: number;
    maxWeeklyOffset: number;
    maxMonthlyOffset: number;
  };

  admins: string[];

  groups: {
    command: string[];
    announcement: string[];
    alertAdmin: string[];
  };

  requirements: {
    monthlyFans: number;
    weeklyFans: number;
    weeksInMonthEquivalent: number;
    includeTransferDataInCalculation: boolean;
  };

  schedule: {
    daily: { enabled: boolean; time: string };
    weekly: { enabled: boolean; days: number[]; time: string };
    monthly: { enabled: boolean; day: number; time: string };
  };

  catchUp: {
    enabled: boolean;
    maxReportsPerStartup: number;
  };

  alerts: {
    enabled: boolean;
    defaultRecipients: 'admin' | 'group';
    performanceDrop: {
      enabled: boolean;
      thresholdPercent: number;
      minHistoryDays: number;
    };
    demotionRisk: {
      enabled: boolean;
      bufferDays: number;
    };
    streakBreak: { enabled: boolean };
    newTransfer: { enabled: boolean };
    rankDrop: { enabled: boolean; positions: number };
    quietHours: {
      enabled: boolean;
      start: string;
      end: string;
    };
  };

  memberStatus: {
    staleAfterDaysDaily: number;
    staleAfterDaysWeekly: number;
    staleAfterDaysMonthly: number;
  };

  message: {
    maxLength: number;
    splitAtNewline: boolean;
    language: string;
  };

  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    logFile: string;
    maxSizeMB: number;
    maxFiles: number;
    console: boolean;
  };

  database: {
    backend: 'sqlite' | 'mysql';
    sqlite: {
      path: string;
      autoSaveMs: number;
    };
    mysql: {
      host: string;
      port: number;
      database: string;
      user: string;
      password: string;
      connectionLimit: number;
      ssl: boolean;
    };
  };
}

// ============================================================
// Database models
// ============================================================

export interface SettingsRow {
  key: string;
  value: string;
  updated_at: string;
}

export interface ScheduleRunRow {
  id: number;
  report_type: string;
  report_date: string;
  scheduled_at: string;
  sent_at: string | null;
  status: 'pending' | 'sent' | 'failed' | 'skipped';
  is_catch_up: boolean;
  target_jid: string;
  error_message: string | null;
}

export interface AlertEventRow {
  id: number;
  alert_type: string;
  event_key: string;
  member_viewer_id: string;
  report_date: string;
  created_at: string;
  sent_at: string | null;
  status: 'pending' | 'sent' | 'suppressed';
  message: string;
}

export interface MemberHistoryRow {
  viewer_id: number;
  trainer_name: string;
  circle_id: number;
  first_seen: string;
  last_seen: string;
  previous_circle_id: number | null;
  previous_circle_name: string | null;
  status: 'active' | 'stale' | 'left';
}

export interface RankHistoryRow {
  date: string;
  circle_id: number;
  monthly_rank: number;
  monthly_point: number;
  club_rank: number;
  fans_to_next_tier: number;
  fans_to_lower_tier: number;
}

// ============================================================
// Enums / constants
// ============================================================

export const CLUB_TIERS: Record<number, string> = {
  11: 'SS',
  10: 'S+',
  9: 'S',
  8: 'A+',
  7: 'A',
  6: 'B+',
  5: 'B',
  4: 'C+',
  3: 'C',
  2: 'D+',
  1: 'D',
};

/** Week block definitions (1-indexed day ranges) */
export const WEEK_BLOCKS = [
  { week: 1, start: 1, end: 7 },
  { week: 2, start: 8, end: 14 },
  { week: 3, start: 15, end: 21 },
  { week: 4, start: 22, end: 28 },
  { week: 5, start: 29, end: 31 },
];
