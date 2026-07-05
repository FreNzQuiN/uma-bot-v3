/**
 * Tests for ensureMonthSnapshot — bridges data layer (snapshot I/O)
 * and API layer (uma.moe fetch).
 *
 * ensureMonthSnapshot delegates to fetchAndSaveSnapshot, so we mock
 * that module directly.
 */

import { ensureMonthSnapshot } from '../../src/data/ensure-snapshot';
import { fetchAndSaveSnapshot } from '../../src/data/fetch-snapshot';
import type { UmaMoeClient } from '../../src/api/uma-moe';
import type { Snapshot } from '../../src/types';

jest.mock('../../src/data/fetch-snapshot');

const mockedFetch = fetchAndSaveSnapshot as jest.MockedFunction<typeof fetchAndSaveSnapshot>;


function makeSnapshot(circleId: number = 100): Snapshot {
  return {
    circle: {
      circle_id: circleId,
      name: 'TestClub',
      comment: '',
      leader_viewer_id: 1,
      leader_name: 'Leader',
      member_count: 0,
      join_style: 0,
      policy: 0,
      created_at: '',
      last_updated: '2026-06-12T14:00:00Z',
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
    members: [],
    club_rank: 8,
    fans_to_next_tier: 500000,
    fans_to_lower_tier: 50000,
    yesterday_fans_to_next_tier: 600000,
    yesterday_fans_to_lower_tier: 40000,
  };
}

function makeMockUmaMoe(apiSnapshot: Snapshot): UmaMoeClient {
  return {
    fetchCircleData: jest.fn().mockResolvedValue(apiSnapshot),
    ensureSession: jest.fn(),
    closeSession: jest.fn(),
    isSessionValid: jest.fn().mockReturnValue(true),
  } as unknown as UmaMoeClient;
}


beforeEach(() => {
  jest.clearAllMocks();
});

describe('ensureMonthSnapshot', () => {
  it('returns cached snapshot when fetchAndSaveSnapshot returns existing', async () => {
    const cached = makeSnapshot(100);
    mockedFetch.mockResolvedValue({ snapshot: cached, saved: false, reason: 'fresh' });

    const umaMoe = makeMockUmaMoe(makeSnapshot(100));
    const result = await ensureMonthSnapshot(umaMoe, 100, 2026, 6, '/tmp/test');

    expect(result).toBe(cached);
    expect(mockedFetch).toHaveBeenCalledWith(umaMoe, 100, 2026, 6, { rootDir: '/tmp/test' });
  });

  it('returns fetched snapshot when fetchAndSaveSnapshot saves new data', async () => {
    const fresh = makeSnapshot(100);
    mockedFetch.mockResolvedValue({ snapshot: fresh, saved: true });

    const umaMoe = makeMockUmaMoe(fresh);
    const result = await ensureMonthSnapshot(umaMoe, 100, 2026, 6, '/tmp/test');

    expect(result).toBe(fresh);
  });

  it('throws when fetchAndSaveSnapshot returns null snapshot', async () => {
    mockedFetch.mockResolvedValue({ snapshot: null, saved: false, reason: 'fetch_failed' });

    const umaMoe = makeMockUmaMoe(makeSnapshot(100));

    await expect(ensureMonthSnapshot(umaMoe, 100, 2026, 6, '/tmp/test'))
      .rejects.toThrow('No snapshot available for 2026-06');
  });

  it('passes rootDir through to fetchAndSaveSnapshot', async () => {
    mockedFetch.mockResolvedValue({ snapshot: makeSnapshot(100), saved: false });

    const umaMoe = makeMockUmaMoe(makeSnapshot(100));
    await ensureMonthSnapshot(umaMoe, 100, 2026, 6, '/custom/path');

    expect(mockedFetch).toHaveBeenCalledWith(umaMoe, 100, 2026, 6, { rootDir: '/custom/path' });
  });
});
