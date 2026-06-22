/**
 * Monthly Report — Edge Cases
 *
 * Tests offset handling, calendar-month offset calculation, and empty snapshot guard.
 * Uses real snapshot (examples/snapshot-june-12.json, 34 members).
 */

import { generateMonthlyReport } from '../../../src/reports/monthly';
import { getDefaultConfig } from '../../../src/config';
import type { Snapshot, BotConfig } from '../../../src/types';
import {
  loadRealSnapshot,
} from '../../_helpers';

// ============================================================
// Constants & Loaders
// ============================================================

let snapshot: Snapshot;
let config: BotConfig;
let loadMonthSnapshotsSpy: jest.SpyInstance;

beforeAll(() => {
  snapshot = loadRealSnapshot();
  config = getDefaultConfig();
  loadMonthSnapshotsSpy = jest.spyOn(
    require('../../../src/data/snapshot'), 'loadMonthSnapshots'
  ).mockReturnValue([]);
});

afterAll(() => {
  loadMonthSnapshotsSpy.mockRestore();
});

// ============================================================
// Section 8: Offset Handling
// ============================================================

describe('Offset handling', () => {
  // loadMonthSnapshots is already mocked globally to return []
  // so historical month data won't be loaded from disk

  it('offset=0 uses current snapshot', () => {
    const report0 = generateMonthlyReport(snapshot, config, 0);
    expect(report0).toContain('📅 *Monthly Report — Juni 2026*');
    expect(report0).toContain('11 Juni 2026');
  });

  it('offset=1 falls back to current month when no previous month snapshot exists', () => {
    const report1 = generateMonthlyReport(snapshot, config, 1);
    // Falls back to current (June) snapshot
    expect(report1).toContain('📅 *Monthly Report — Juni 2026*');
  });

  it('offset=-1 produces same output as offset=1', () => {
    const reportNeg = generateMonthlyReport(snapshot, config, -1);
    const reportPos = generateMonthlyReport(snapshot, config, 1);
    expect(reportNeg).toBe(reportPos);
  });

  it('offset=2 also falls back to current month', () => {
    const report2 = generateMonthlyReport(snapshot, config, 2);
    // Falls back to current (June) snapshot
    expect(report2).toContain('📅 *Monthly Report — Juni 2026*');
  });
});

// ============================================================
// Section 8b: Calendar-Month Offset Calculation (Step 1b fix)
// ============================================================

describe('Calendar-month offset calculation', () => {
  let dataComponentsSpy: jest.SpyInstance;

  afterEach(() => {
    if (dataComponentsSpy) {
      dataComponentsSpy.mockRestore();
      dataComponentsSpy = undefined as unknown as jest.SpyInstance;
    }
    // Reset loadMonthSnapshots back to global default (return [])
    // DO NOT call mockRestore() — that would remove the global mock.
    loadMonthSnapshotsSpy.mockReturnValue([]);
  });

  it('offset=-1 on July 1 calculates target as June', () => {
    // Mock: current date is July 1
    dataComponentsSpy = jest.spyOn(
      require('../../../src/utils/timezone'), 'getDataDateComponents'
    ).mockReturnValue({ year: 2026, month: 7, day: 1 });
    // Override global mock: return our snapshot for June
    loadMonthSnapshotsSpy.mockImplementation((...args: unknown[]) => {
      const year = args[0] as number;
      const month = args[1] as number;
      if (year === 2026 && month === 6) return [snapshot];
      return [];
    });

    const report = generateMonthlyReport(snapshot, config, -1);
    // offset=-1 with curMonth=7 → targetMonth=6 → mock returns our snapshot
    expect(report).toContain('📅 *Monthly Report — Juni 2026*');
    expect(report).toContain('11 Juni 2026');
  });

  it('offset=-1 on January 1 calculates target as December previous year', () => {
    // Mock: current date is January 1, 2027
    dataComponentsSpy = jest.spyOn(
      require('../../../src/utils/timezone'), 'getDataDateComponents'
    ).mockReturnValue({ year: 2027, month: 1, day: 1 });
    // Global loadMonthSnapshots already returns [], so Dec 2026 is empty.
    // Falls back to current (June 2026)
    const report = generateMonthlyReport(snapshot, config, -1);
    expect(report).toContain('📅 *Monthly Report — Juni 2026*');
  });

  it('offset=0 still uses current snapshot regardless of calendar date', () => {
    dataComponentsSpy = jest.spyOn(
      require('../../../src/utils/timezone'), 'getDataDateComponents'
    ).mockReturnValue({ year: 2026, month: 7, day: 1 });

    const report = generateMonthlyReport(snapshot, config, 0);
    // offset=0 means absOffset=0, skip offset block entirely
    expect(report).toContain('📅 *Monthly Report — Juni 2026*');
  });
});

// ============================================================
// Section 9: Empty Snapshot Guard
// ============================================================

describe('Empty snapshot guard', () => {
  it('returns warning for empty members array', () => {
    const emptySnapshot: Snapshot = {
      circle: snapshot.circle,
      members: [],
      club_rank: 8,
      fans_to_next_tier: 349208495,
      fans_to_lower_tier: 21848493,
      yesterday_fans_to_next_tier: 305715171,
      yesterday_fans_to_lower_tier: 20621702,
    };
    const result = generateMonthlyReport(emptySnapshot, config, 0);
    expect(result).toBe('ℹ️ *Monthly Report*\nData bulan ini belum tersedia.');
  });

  it('empty warning has no other report content', () => {
    const emptySnapshot: Snapshot = {
      circle: snapshot.circle,
      members: [],
      club_rank: 8,
      fans_to_next_tier: 349208495,
      fans_to_lower_tier: 21848493,
      yesterday_fans_to_next_tier: 305715171,
      yesterday_fans_to_lower_tier: 20621702,
    };
    const result = generateMonthlyReport(emptySnapshot, config, 0);
    expect(result).not.toContain('Total');
    expect(result).not.toContain('Proyeksi');
  });
});
