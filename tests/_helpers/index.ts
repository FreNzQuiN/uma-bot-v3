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

// ============================================================
// Constants
// ============================================================

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

// ============================================================
// Snapshot & Config Loading
// ============================================================

/** Load the real snapshot from the fixture file (parsed from JSON) */
export function loadRealSnapshot(): Snapshot {
  return JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf-8'));
}

/**
 * Build a BotConfig with optional overrides (shallow merge).
 *
 * For specialized configs (e.g. deep-merge of schedule, requirements),
 * build on top of this or keep a local helper in your test file.
 */
export function makeConfig(overrides: Partial<BotConfig> = {}): BotConfig {
  return { ...getDefaultConfig(), ...overrides };
}

// ============================================================
// Date Mocking
// ============================================================

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

// ============================================================
// Snapshot Builders
// ============================================================

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

// ============================================================
// Gain String Parsing
// ============================================================

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

// ============================================================
// Mock Database
// ============================================================

/**
 * Create a mock database object with common jest.fn() stubs.
 * Returns a plain object (not a Database instance) suitable for
 * dispatch integration tests and command handler tests.
 */
export function makeMockDb() {
  return {
    isAlertAlreadySent: jest.fn().mockReturnValue(false),
    recordAlert: jest.fn(),
    getMembers: jest.fn().mockReturnValue([]),
    getMember: jest.fn().mockReturnValue(null),
    upsertMember: jest.fn(),
    saveRankHistory: jest.fn(),
    getLastSuccessfulRun: jest.fn().mockReturnValue(null),
    recordRun: jest.fn(),
    updateRunStatus: jest.fn(),
  };
}
