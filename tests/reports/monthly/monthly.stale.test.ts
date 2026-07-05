/**
 * Monthly Report — Stale Data Warning Tests
 *
 * Tests stale data warning behavior across different date scenarios.
 * Uses real snapshot (examples/snapshot-june-12.json, 34 members).
 */

import { generateMonthlyReport } from '../../../src/reports/monthly';
import { computeMembers } from '../../../src/reports/compute';
import { getDefaultConfig } from '../../../src/config';
import type { Snapshot, BotConfig } from '../../../src/types';
import {
  loadRealSnapshot,
  mockCurrentDate,
  restoreDateMocks,
} from '../../_helpers';


let snapshot: Snapshot;
let config: BotConfig;
let computedMembers: ReturnType<typeof computeMembers>;
let loadMonthSnapshotSpy: jest.SpyInstance;

beforeAll(() => {
  snapshot = loadRealSnapshot();
  config = getDefaultConfig();
  computedMembers = computeMembers(snapshot, config);
  loadMonthSnapshotSpy = jest.spyOn(
    require('../../../src/data/snapshot'), 'loadMonthSnapshot'
  ).mockReturnValue(null);
});

afterAll(() => {
  loadMonthSnapshotSpy.mockRestore();
});


describe('Stale data warning in monthly report', () => {
  afterEach(() => {
    restoreDateMocks();
  });

  it('shows stale warning when snapshot is stale (day 11, today June 13)', () => {
    mockCurrentDate(2026, 6, 13);
    const report = generateMonthlyReport(snapshot, config, computedMembers, 0);
    expect(report).toContain('⚠️ Data klub mungkin tidak terbaru');
    expect(report).toContain('update terakhir: 11 Juni 2026');
  });

  it('does NOT show stale warning when snapshot is fresh (day 11, today June 11)', () => {
    mockCurrentDate(2026, 6, 11);
    const report = generateMonthlyReport(snapshot, config, computedMembers, 0);
    expect(report).not.toContain('⚠️ Data klub mungkin tidak terbaru');
  });

  it('does NOT show stale warning when snapshot is 1 day old (day 11, today June 12)', () => {
    mockCurrentDate(2026, 6, 12);
    const report = generateMonthlyReport(snapshot, config, computedMembers, 0);
    expect(report).not.toContain('⚠️ Data klub mungkin tidak terbaru');
  });

  it('stale warning references snapshot date, not offset date', () => {
    mockCurrentDate(2026, 6, 13);
    const report0 = generateMonthlyReport(snapshot, config, computedMembers, 0);
    const report1 = generateMonthlyReport(snapshot, config, computedMembers, 1);
    expect(report0).toContain('update terakhir: 11 Juni 2026');
    expect(report1).toContain('update terakhir: 11 Juni 2026');
  });

  it('no stale warning when snapshot is from a different month', () => {
    mockCurrentDate(2026, 6, 13);
    const maySnapshot: Snapshot = {
      ...snapshot,
      members: snapshot.members.map((m) => ({
        ...m,
        month: 5,
        daily_fans: m.daily_fans.map((v, i) => (i < 28 ? v : 0)),
      })),
    };
    const report = generateMonthlyReport(maySnapshot, config, computeMembers(maySnapshot, config), 0);
    expect(report).not.toContain('⚠️ Data klub mungkin tidak terbaru');
  });
});
