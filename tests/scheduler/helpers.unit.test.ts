import { preFetchMonthlySnapshot } from '../../src/scheduler/helpers';
import { mockCurrentDate, restoreDateMocks } from '../_helpers';

describe('preFetchMonthlySnapshot', () => {
  afterEach(() => restoreDateMocks());

  it('fetches target month derived from baseYear/baseMonth, not current date', async () => {
    mockCurrentDate(2026, 7, 1);
    const fetcher = jest.fn().mockResolvedValue(undefined);

    await preFetchMonthlySnapshot(fetcher, -1, 'test', 2026, 6);

    expect(fetcher).toHaveBeenCalledWith(2026, 5);
  });

  it('fetches offset=1 (previous month) from snapshot base', async () => {
    mockCurrentDate(2026, 7, 1);
    const fetcher = jest.fn().mockResolvedValue(undefined);

    await preFetchMonthlySnapshot(fetcher, 1, 'test', 2026, 6);

    expect(fetcher).toHaveBeenCalledWith(2026, 5);
  });

  it('does NOT use current date when snapshot base differs', async () => {
    mockCurrentDate(2026, 12, 15);
    const fetcher = jest.fn().mockResolvedValue(undefined);

    await preFetchMonthlySnapshot(fetcher, -1, 'test', 2026, 6);

    expect(fetcher).toHaveBeenCalledWith(2026, 5);
  });

  it('handles year boundary (offset from January)', async () => {
    const fetcher = jest.fn().mockResolvedValue(undefined);

    await preFetchMonthlySnapshot(fetcher, 1, 'test', 2026, 1);

    expect(fetcher).toHaveBeenCalledWith(2025, 12);
  });
});
