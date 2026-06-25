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

import * as fs from 'fs';
import * as path from 'path';
import { getDefaultConfig } from '../../src/config';
import type { Snapshot, BotConfig } from '../../src/types';
import type { IncomingMessage } from '../../src/whatsapp/client';
import type { IDatabase } from '../../src/db/types';


/** Path to the real snapshot fixture */
export const SNAPSHOT_PATH = path.join(__dirname, '..', 'examples', 'snapshot-june-12.json');

/** Names of the 6 transfer members in the June 12 snapshot */
export const TRANSFER_NAMES = [
  'Zero', 'TheTengOne', 'Sairen', 'VitoHoow', 'Ceciria', 'Falkrum',
] as const;

/** Names of the 4 stale/left members in the June 12 snapshot */
export const STALE_NAMES = ['DOA IBU', 'Kuro', 'Rowking', 'Lebowski'] as const;

/** WhatsApp message character limit */
export const WHATSAPP_MAX_LENGTH = 4096;


/** Load the real snapshot from the fixture file (parsed from JSON) */
export function loadRealSnapshot(): Snapshot {
  return JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf-8'));
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
export function makeConfig(overrides: Record<string, any> = {}): BotConfig {
  const base = getDefaultConfig();
  return {
    ...base,
    ...overrides,
    schedule: {
      ...base.schedule,
      ...(overrides.schedule ?? {}),
      daily: {
        ...base.schedule.daily,
        ...(overrides.schedule?.daily ?? {}),
      },
      weekly: {
        ...base.schedule.weekly,
        ...(overrides.schedule?.weekly ?? {}),
        days: overrides.schedule?.weekly?.days ?? base.schedule.weekly.days,
      },
      monthly: {
        ...base.schedule.monthly,
        ...(overrides.schedule?.monthly ?? {}),
      },
    },
    groups: {
      ...base.groups,
      ...(overrides.groups ?? {}),
    },
    requirements: {
      ...base.requirements,
      ...(overrides.requirements ?? {}),
    },
    catchUp: {
      ...base.catchUp,
      ...(overrides.catchUp ?? {}),
    },
    alerts: {
      ...base.alerts,
      ...(overrides.alerts ?? {}),
      performanceDrop: {
        ...base.alerts.performanceDrop,
        ...(overrides.alerts?.performanceDrop ?? {}),
      },
      demotionRisk: {
        ...base.alerts.demotionRisk,
        ...(overrides.alerts?.demotionRisk ?? {}),
      },
      streakBreak: {
        ...base.alerts.streakBreak,
        ...(overrides.alerts?.streakBreak ?? {}),
      },
      newTransfer: {
        ...base.alerts.newTransfer,
        ...(overrides.alerts?.newTransfer ?? {}),
      },
      rankDrop: {
        ...base.alerts.rankDrop,
        ...(overrides.alerts?.rankDrop ?? {}),
      },
      quietHours: {
        ...base.alerts.quietHours,
        ...(overrides.alerts?.quietHours ?? {}),
      },
    },
    memberStatus: {
      ...base.memberStatus,
      ...(overrides.memberStatus ?? {}),
    },
    commands: {
      ...base.commands,
      ...(overrides.commands ?? {}),
    },
  };
}


/**
 * Mock the current date/time using Jest fake timers.
 * Sets time to noon JST (03:00 UTC) on the given date.
 */
export function mockCurrentDate(year: number, month: number, day: number): void {
  const utcMs = Date.UTC(year, month - 1, day, 3, 0, 0);
  jest.useFakeTimers();
  jest.setSystemTime(new Date(utcMs));
}

/** Restore real timers after mocking */
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
  const cleaned = formatted.replace(/^[+-]/, '');
  const numStr = cleaned.replace(/[KMB]/g, '');
  let num = parseFloat(numStr);
  if (cleaned.endsWith('K')) num *= 1_000;
  if (cleaned.endsWith('M')) num *= 1_000_000;
  if (cleaned.endsWith('B')) num *= 1_000_000_000;
  return formatted.startsWith('-') ? -num : num;
}


/**
 * Create a mock database object with common jest.fn() stubs.
 * Returns a plain object (not a Database instance) suitable for
 * dispatch integration tests and command handler tests.
 */
export function makeMockDb() {
  return {
    initialize: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    save: jest.fn().mockResolvedValue(undefined),
    getExistingAlertKeys: jest.fn().mockResolvedValue(new Set<string>()),
    recordAlert: jest.fn().mockResolvedValue(1),
    getMembers: jest.fn().mockResolvedValue([]),
    getMember: jest.fn().mockResolvedValue(null),
    upsertMember: jest.fn().mockResolvedValue(undefined),
    saveRankHistory: jest.fn().mockResolvedValue(undefined),
    getRankHistory: jest.fn().mockResolvedValue([]),
    getLastSuccessfulRun: jest.fn().mockResolvedValue(null),
    getLastRun: jest.fn().mockResolvedValue(null),
    recordRun: jest.fn().mockResolvedValue(1),
    updateRunStatus: jest.fn().mockResolvedValue(undefined),
    markAlertSent: jest.fn().mockResolvedValue(undefined),
    transaction: jest.fn().mockImplementation((fn: () => Promise<any>) => fn()),
  } as unknown as IDatabase;
}


/**
 * Build a mock IncomingMessage with sensible defaults.
 * Override any field via the overrides parameter.
 */
export function makeMessage(overrides: Record<string, any> = {}): IncomingMessage {
  return {
    key: {
      remoteJid: 'group-cmd@g.us',
      id: 'msg-001',
      ...overrides.key,
    },
    message: {
      conversation: '/daily',
      ...overrides.message,
    },
    pushName: 'TestUser',
    ...overrides,
  };
}
