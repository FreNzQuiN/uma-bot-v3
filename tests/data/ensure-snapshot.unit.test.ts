/**
 * Tests for ensureMonthSnapshot — bridges data layer (snapshot I/O)
 * and API layer (uma.moe fetch).
 */

import { ensureMonthSnapshot } from '../../src/data/ensure-snapshot';
import { loadMonthSnapshots, saveSnapshot } from '../../src/data/snapshot';
import { getDataDate, getDataDateComponents } from '../../src/utils/timezone';
import type { UmaMoeClient } from '../../src/api/uma-moe';
import type { Snapshot } from '../../src/types';

jest.mock('../../src/data/snapshot', () => ({
  loadMonthSnapshots: jest.fn(),
  saveSnapshot: jest.fn(),
}));

jest.mock('../../src/utils/timezone', () => ({
  getDataDate: jest.fn(),
  getDataDateComponents: jest.fn(),
}));

const mockedLoad = loadMonthSnapshots as jest.MockedFunction<typeof loadMonthSnapshots>;
const mockedSave = saveSnapshot as jest.MockedFunction<typeof saveSnapshot>;
const mockedGetDataDate = getDataDate as jest.MockedFunction<typeof getDataDate>;
const mockedGetDataDateComponents = getDataDateComponents as jest.MockedFunction<typeof getDataDateComponents>;

// ============================================================
// Helpers
// ============================================================

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

// ============================================================
// Tests
// ============================================================

beforeEach(() => {
  jest.clearAllMocks();
  mockedGetDataDateComponents.mockReturnValue({ year: 2026, month: 6, day: 12 });
  mockedGetDataDate.mockReturnValue('2026-06-12');
});

describe('ensureMonthSnapshot', () => {
  it('returns cached snapshot when cache exists and circle_id matches', async () => {
    const cached = makeSnapshot(100);
    mockedLoad.mockReturnValue([cached]);

    const umaMoe = makeMockUmaMoe(makeSnapshot(100));
    const result = await ensureMonthSnapshot(umaMoe, 100, 2026, 6, '/tmp/test');

    expect(result).toBe(cached);
    expect(mockedLoad).toHaveBeenCalledWith(2026, 6, '/tmp/test');
    expect(umaMoe.fetchCircleData).not.toHaveBeenCalled();
  });

  it('fetches from API when cache is empty', async () => {
    mockedLoad.mockReturnValue([]);

    const apiSnapshot = makeSnapshot(100);
    const umaMoe = makeMockUmaMoe(apiSnapshot);
    mockedSave.mockReturnValue('/tmp/test/data/snapshots/2026/06/12.json');

    const result = await ensureMonthSnapshot(umaMoe, 100, 2026, 6, '/tmp/test');

    expect(result).toBe(apiSnapshot);
    expect(umaMoe.fetchCircleData).toHaveBeenCalledWith(100, 2026, 6);
    expect(mockedSave).toHaveBeenCalled();
  });

  it('fetches from API when cached circle_id does not match', async () => {
    const cached = makeSnapshot(999);
    mockedLoad.mockReturnValue([cached]);

    const apiSnapshot = makeSnapshot(100);
    const umaMoe = makeMockUmaMoe(apiSnapshot);
    mockedSave.mockReturnValue('/tmp/test/data/snapshots/2026/06/12.json');

    const result = await ensureMonthSnapshot(umaMoe, 100, 2026, 6, '/tmp/test');

    expect(result).toBe(apiSnapshot);
    expect(umaMoe.fetchCircleData).toHaveBeenCalledWith(100, 2026, 6);
  });

  it('saves snapshot to disk after fetching', async () => {
    mockedLoad.mockReturnValue([]);

    const apiSnapshot = makeSnapshot(100);
    const umaMoe = makeMockUmaMoe(apiSnapshot);

    await ensureMonthSnapshot(umaMoe, 100, 2026, 6, '/tmp/test');

    expect(mockedSave).toHaveBeenCalledWith(apiSnapshot, '2026-06-12', '/tmp/test');
  });
});
