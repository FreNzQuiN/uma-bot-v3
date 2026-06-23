import { Database } from '../../src/db/database';

describe('Bug 4: recordAlert returns correct ID', () => {
  let db: Database;

  beforeEach(async () => {
    db = new Database(':memory:');
    await db.initialize();
  });

  afterEach(() => {
    db.close();
  });

  it('returns correct ID when inserting a new alert', () => {
    const id1 = db.recordAlert({
      alert_type: 'performance_drop',
      event_key: 'perf:2026-06-12:11111',
      member_viewer_id: '11111',
      report_date: '2026-06-12',
      created_at: '2026-06-12T15:05:00Z',
      message: 'Alert 1',
    });

    const id2 = db.recordAlert({
      alert_type: 'performance_drop',
      event_key: 'perf:2026-06-12:22222',
      member_viewer_id: '22222',
      report_date: '2026-06-12',
      created_at: '2026-06-12T15:05:00Z',
      message: 'Alert 2',
    });

    // IDs should be sequential and unique
    expect(id1).toBeGreaterThan(0);
    expect(id2).toBe(id1 + 1);
  });

  it('returns existing ID when duplicate event_key inserted', () => {
    const id1 = db.recordAlert({
      alert_type: 'performance_drop',
      event_key: 'perf:2026-06-12:33333',
      member_viewer_id: '33333',
      report_date: '2026-06-12',
      created_at: '2026-06-12T15:05:00Z',
      message: 'First',
    });

    const id2 = db.recordAlert({
      alert_type: 'performance_drop',
      event_key: 'perf:2026-06-12:33333', // same key
      member_viewer_id: '33333',
      report_date: '2026-06-12',
      created_at: '2026-06-12T15:06:00Z',
      message: 'Duplicate',
    });

    // First insert should return valid ID
    expect(id1).toBeGreaterThan(0);
    // Duplicate returns the existing ID so caller can mark it sent
    expect(id2).toBe(id1);
  });

  it('markAlertSent on duplicate alert marks the original as sent', () => {
    const id1 = db.recordAlert({
      alert_type: 'performance_drop',
      event_key: 'perf:2026-06-12:44444',
      member_viewer_id: '44444',
      report_date: '2026-06-12',
      created_at: '2026-06-12T15:05:00Z',
      message: 'Original',
    });

    // Duplicate returns same ID
    const id2 = db.recordAlert({
      alert_type: 'performance_drop',
      event_key: 'perf:2026-06-12:44444',
      member_viewer_id: '44444',
      report_date: '2026-06-12',
      created_at: '2026-06-12T15:06:00Z',
      message: 'Duplicate',
    });

    // id2 === id1, so marking it sent marks the original
    expect(id2).toBe(id1);
    expect(() => db.markAlertSent(id2)).not.toThrow();
    expect(db.isAlertAlreadySent('perf:2026-06-12:44444')).toBe(true);
  });
});
