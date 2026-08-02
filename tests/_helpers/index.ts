/**
 * Shared test helpers for Uma Club Bot v3 test suite.
 *
 * Eliminates code duplication across test files for:
 * - Snapshot & config loading
 * - Date mocking
 * - Mock database
 * - Gain string parsing
 * - Empty snapshot construction
 * - Common constants (transfer names, stale names)
 *
 * Usage:
 *   import { loadRealSnapshot, makeConfig, TRANSFER_NAMES } from '../_helpers';
 */

import * as fs from "fs";
import * as path from "path";
import { getDefaultConfig } from "../../src/config";
import type { Snapshot, BotConfig, MemberData } from "../../src/types";
import type { IncomingMessage } from "../../src/whatsapp/client";
import type { IDatabase } from "../../src/db/types";

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends (infer U)[]
    ? U[]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};

/** Path to the real snapshot fixture */
export const SNAPSHOT_PATH = path.join(
  __dirname,
  "..",
  "examples",
  "snapshot-june-12.json",
);

/** Names of the 6 transfer members in the June 12 snapshot */
export const TRANSFER_NAMES = [
  "Zero",
  "TheTengOne",
  "Sairen",
  "VitoHoow",
  "Ceciria",
  "Falkrum",
] as const;

/** Names of the 4 stale/left members in the June 12 snapshot */
export const STALE_NAMES = ["DOA IBU", "Kuro", "Rowking", "Lebowski"] as const;

/** WhatsApp message character limit */
export const WHATSAPP_MAX_LENGTH = 4096;

export function loadRealSnapshot(): Snapshot {
  return JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf-8"));
}

/**
 * Build a BotConfig with optional overrides.
 *
 * Deep-merges nested objects (schedule, groups, requirements, catchUp,
 * alerts, memberStatus, commands) so partial overrides don't clobber
 * sibling fields. Example:
 *
 *   makeConfig({ schedule: { daily: { enabled: false } } })
 *   // weekly and monthly schedule preserved from defaults
 */
export function makeConfig(overrides: DeepPartial<BotConfig> = {}): BotConfig {
  const base = getDefaultConfig();
  return {
    circleId: overrides.circleId ?? base.circleId,
    timezone: overrides.timezone ?? base.timezone,

    commands: {
      prefixes: overrides.commands?.prefixes ?? base.commands.prefixes,
      maxDailyOffset:
        overrides.commands?.maxDailyOffset ?? base.commands.maxDailyOffset,
      maxWeeklyOffset:
        overrides.commands?.maxWeeklyOffset ?? base.commands.maxWeeklyOffset,
      maxMonthlyOffset:
        overrides.commands?.maxMonthlyOffset ?? base.commands.maxMonthlyOffset,
      maxAnalyzeOffset:
        overrides.commands?.maxAnalyzeOffset ?? base.commands.maxAnalyzeOffset,
    },

    admins: overrides.admins ?? base.admins,

    groups: {
      command: overrides.groups?.command ?? base.groups.command,
      announcement: overrides.groups?.announcement ?? base.groups.announcement,
      alertAdmin: overrides.groups?.alertAdmin ?? base.groups.alertAdmin,
    },

    requirements: {
      monthlyFans:
        overrides.requirements?.monthlyFans ?? base.requirements.monthlyFans,
      weeklyFans:
        overrides.requirements?.weeklyFans ?? base.requirements.weeklyFans,
      weeksInMonthEquivalent:
        overrides.requirements?.weeksInMonthEquivalent ??
        base.requirements.weeksInMonthEquivalent,
      includeTransferDataInCalculation:
        overrides.requirements?.includeTransferDataInCalculation ??
        base.requirements.includeTransferDataInCalculation,
    },

    schedule: {
      daily: {
        enabled:
          overrides.schedule?.daily?.enabled ?? base.schedule.daily.enabled,
        time: overrides.schedule?.daily?.time ?? base.schedule.daily.time,
      },
      weekly: {
        enabled:
          overrides.schedule?.weekly?.enabled ?? base.schedule.weekly.enabled,
        days: overrides.schedule?.weekly?.days ?? base.schedule.weekly.days,
        time: overrides.schedule?.weekly?.time ?? base.schedule.weekly.time,
      },
      monthly: {
        enabled:
          overrides.schedule?.monthly?.enabled ?? base.schedule.monthly.enabled,
        day: overrides.schedule?.monthly?.day ?? base.schedule.monthly.day,
        time: overrides.schedule?.monthly?.time ?? base.schedule.monthly.time,
      },
    },

    catchUp: {
      enabled: overrides.catchUp?.enabled ?? base.catchUp.enabled,
      maxReportsPerStartup:
        overrides.catchUp?.maxReportsPerStartup ??
        base.catchUp.maxReportsPerStartup,
    },

    alerts: {
      enabled: overrides.alerts?.enabled ?? base.alerts.enabled,
      defaultRecipients:
        overrides.alerts?.defaultRecipients ?? base.alerts.defaultRecipients,
      performanceDrop: {
        enabled:
          overrides.alerts?.performanceDrop?.enabled ??
          base.alerts.performanceDrop.enabled,
        thresholdPercent:
          overrides.alerts?.performanceDrop?.thresholdPercent ??
          base.alerts.performanceDrop.thresholdPercent,
        minHistoryDays:
          overrides.alerts?.performanceDrop?.minHistoryDays ??
          base.alerts.performanceDrop.minHistoryDays,
      },
      demotionRisk: {
        enabled:
          overrides.alerts?.demotionRisk?.enabled ??
          base.alerts.demotionRisk.enabled,
        bufferDays:
          overrides.alerts?.demotionRisk?.bufferDays ??
          base.alerts.demotionRisk.bufferDays,
      },
      streakBreak: {
        enabled:
          overrides.alerts?.streakBreak?.enabled ??
          base.alerts.streakBreak.enabled,
      },
      newTransfer: {
        enabled:
          overrides.alerts?.newTransfer?.enabled ??
          base.alerts.newTransfer.enabled,
      },
      rankDrop: {
        enabled:
          overrides.alerts?.rankDrop?.enabled ?? base.alerts.rankDrop.enabled,
        positions:
          overrides.alerts?.rankDrop?.positions ??
          base.alerts.rankDrop.positions,
      },
      quietHours: {
        enabled:
          overrides.alerts?.quietHours?.enabled ??
          base.alerts.quietHours.enabled,
        start:
          overrides.alerts?.quietHours?.start ?? base.alerts.quietHours.start,
        end: overrides.alerts?.quietHours?.end ?? base.alerts.quietHours.end,
      },
    },

    memberStatus: {
      staleAfterDaysDaily:
        overrides.memberStatus?.staleAfterDaysDaily ??
        base.memberStatus.staleAfterDaysDaily,
      staleAfterDaysWeekly:
        overrides.memberStatus?.staleAfterDaysWeekly ??
        base.memberStatus.staleAfterDaysWeekly,
      staleAfterDaysMonthly:
        overrides.memberStatus?.staleAfterDaysMonthly ??
        base.memberStatus.staleAfterDaysMonthly,
    },

    message: {
      maxLength: overrides.message?.maxLength ?? base.message.maxLength,
      splitAtNewline:
        overrides.message?.splitAtNewline ?? base.message.splitAtNewline,
      language: overrides.message?.language ?? base.message.language,
    },

    logging: {
      level: overrides.logging?.level ?? base.logging.level,
      logFile: overrides.logging?.logFile ?? base.logging.logFile,
      maxSizeMB: overrides.logging?.maxSizeMB ?? base.logging.maxSizeMB,
      maxFiles: overrides.logging?.maxFiles ?? base.logging.maxFiles,
      console: overrides.logging?.console ?? base.logging.console,
    },

    database: {
      backend: overrides.database?.backend ?? base.database.backend,
      sqlite: {
        path: overrides.database?.sqlite?.path ?? base.database.sqlite.path,
        autoSaveMs:
          overrides.database?.sqlite?.autoSaveMs ??
          base.database.sqlite.autoSaveMs,
      },
      mysql: {
        host: overrides.database?.mysql?.host ?? base.database.mysql.host,
        port: overrides.database?.mysql?.port ?? base.database.mysql.port,
        database:
          overrides.database?.mysql?.database ?? base.database.mysql.database,
        user: overrides.database?.mysql?.user ?? base.database.mysql.user,
        password:
          overrides.database?.mysql?.password ?? base.database.mysql.password,
        connectionLimit:
          overrides.database?.mysql?.connectionLimit ??
          base.database.mysql.connectionLimit,
        ssl: overrides.database?.mysql?.ssl ?? base.database.mysql.ssl,
      },
    },

    auth: {
      retentionDays: overrides.auth?.retentionDays ?? base.auth.retentionDays,
      purgeAfterDays:
        overrides.auth?.purgeAfterDays ?? base.auth.purgeAfterDays,
    },
  };
}

/**
 * Mock the current date/time using Jest fake timers.
 * Sets time to noon JST (03:00 UTC) on the given date.
 */
export function mockCurrentDate(
  year: number,
  month: number,
  day: number,
): void {
  const utcMs = Date.UTC(year, month - 1, day, 3, 0, 0);
  jest.useFakeTimers();
  jest.setSystemTime(new Date(utcMs));
}

export function restoreDateMocks(): void {
  jest.useRealTimers();
}

/**
 * Build an empty snapshot (members: []) using the real snapshot's metadata.
 * Useful for testing empty-snapshot guard behavior.
 */
export function makeEmptySnapshot(realSnapshot: Snapshot): Snapshot {
  return {
    circle: realSnapshot.circle,
    members: [],
    club_rank: realSnapshot.club_rank,
    fans_to_next_tier: realSnapshot.fans_to_next_tier,
    fans_to_lower_tier: realSnapshot.fans_to_lower_tier,
    yesterday_fans_to_next_tier: realSnapshot.yesterday_fans_to_next_tier,
    yesterday_fans_to_lower_tier: realSnapshot.yesterday_fans_to_lower_tier,
  };
}

/**
 * Parse a formatted gain string like "+2.7M", "+215.4K", "+1.5B", "-3.1M"
 * back to a number. Handles K (thousands), M (millions), B (billions).
 */
export function parseFormattedGain(formatted: string): number {
  const cleaned = formatted.replace(/^[+-]/, "");
  const numStr = cleaned.replace(/[KMB]/g, "");
  let num = parseFloat(numStr);
  if (cleaned.endsWith("K")) num *= 1_000;
  if (cleaned.endsWith("M")) num *= 1_000_000;
  if (cleaned.endsWith("B")) num *= 1_000_000_000;
  return formatted.startsWith("-") ? -num : num;
}

/**
 * Create a mock database object with common jest.fn() stubs.
 * Returns a plain object (not a Database instance) suitable for
 * dispatch integration tests and command handler tests.
 */
export function makeMockDb(): IDatabase {
  const db: IDatabase = {
    initialize: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    save: jest.fn().mockResolvedValue(undefined),
    getExistingAlertKeys: jest.fn().mockResolvedValue(new Set<string>()),
    recordAlert: jest.fn().mockResolvedValue(1),
    recordAlerts: jest.fn().mockResolvedValue([1]),
    getMembers: jest.fn().mockResolvedValue([]),
    getMember: jest.fn().mockResolvedValue(null),
    upsertMember: jest.fn().mockResolvedValue(undefined),
    upsertMembers: jest.fn().mockResolvedValue(undefined),
    saveRankHistory: jest.fn().mockResolvedValue(undefined),
    getRankHistory: jest.fn().mockResolvedValue([]),
    getLastSuccessfulRun: jest.fn().mockResolvedValue(null),
    getLastRun: jest.fn().mockResolvedValue(null),
    recordRun: jest.fn().mockResolvedValue(1),
    updateRunStatus: jest.fn().mockResolvedValue(undefined),
    markAlertSent: jest.fn().mockResolvedValue(undefined),
    markAlertsSent: jest.fn().mockResolvedValue(undefined),
    markAlertsByEventKeys: jest.fn().mockResolvedValue(undefined),
    transaction: jest.fn().mockImplementation((fn: () => Promise<any>) => fn()),
  };
  return db;
}

export function makeMessage(
  overrides: DeepPartial<IncomingMessage> = {},
): IncomingMessage {
  return {
    key: {
      remoteJid: overrides.key?.remoteJid ?? "group-cmd@g.us",
      id: overrides.key?.id ?? "msg-001",
      participant: overrides.key?.participant,
    },
    message: overrides.message ?? { conversation: "/daily" },
    pushName: overrides.pushName ?? "TestUser",
  };
}

/**
 * Build a 32-element cumulative daily_fans array from an array of daily values.
 * dailyValues[0] = day1 total, dailyValues[1] = day2 total, etc.
 * Remaining entries are 0.
 */
export function makeCumulativeFans(dailyValues: number[]): number[] {
  const arr = new Array(32).fill(0);
  for (let i = 0; i < dailyValues.length && i < 32; i++) {
    arr[i] = dailyValues[i];
  }
  return arr;
}

/**
 * 32-entry cumulative daily_fans series: entry i = startValue + i * dailyGain
 * while i < activeDays, then zero-filled.
 */
export function makeCumulativeFansSeries(
  startValue: number,
  dailyGain: number,
  activeDays: number,
): number[] {
  const fans: number[] = [];
  let current = startValue;
  for (let i = 0; i < 32; i++) {
    if (i < activeDays) {
      fans.push(current);
      current += dailyGain;
    } else {
      fans.push(0);
    }
  }
  return fans;
}

export function makeMember(overrides: Partial<MemberData> = {}): MemberData {
  return {
    id: 1,
    circle_id: 100,
    viewer_id: 1001,
    trainer_name: "Alice",
    shame_score: null,
    year: 2026,
    month: 6,
    daily_fans: makeCumulativeFans([
      100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100,
    ]),
    last_updated: "2026-06-12",
    ...overrides,
  };
}

export function makeSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    circle: {
      circle_id: 100,
      name: "TestClub",
      comment: "",
      leader_viewer_id: 1,
      leader_name: "Leader",
      member_count: 2,
      join_style: 0,
      policy: 0,
      created_at: "",
      last_updated: "2026-06-12T14:00:00Z",
      monthly_rank: 100,
      monthly_point: 1000000,
      last_month_rank: null,
      last_month_point: null,
      archived: false,
      yesterday_updated: null,
      yesterday_points: null,
      yesterday_rank: null,
      live_points: null,
      live_rank: null,
      last_live_update: null,
    },
    members: [
      makeMember({ viewer_id: 1001, trainer_name: "Alice" }),
      makeMember({ viewer_id: 1002, trainer_name: "Bob", id: 2 }),
    ],
    club_rank: 8,
    fans_to_next_tier: 500000,
    fans_to_lower_tier: 50000,
    yesterday_fans_to_next_tier: 600000,
    yesterday_fans_to_lower_tier: 40000,
    ...overrides,
  };
}
