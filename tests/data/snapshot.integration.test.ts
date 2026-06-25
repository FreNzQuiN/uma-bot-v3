import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Snapshot, MemberData } from '../../src/types';
import {
  saveSnapshot,
  loadSnapshot,
  loadLatestSnapshot,
  loadMonthSnapshots,
  snapshotExists,
  getDataDayFromSnapshot,
  staleSnapshotMessage,
  getLatestSnapshotDate,
} from '../../src/data/snapshot';


/** Create a minimal valid Snapshot for testing. */
function makeSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    circle: {
      circle_id: 1,
      name: 'TestCircle',
      comment: 'test',
      leader_viewer_id: 100,
      leader_name: 'Leader',
      member_count: 1,
      join_style: 1,
      policy: 1,
      created_at: '2026-01-01T00:00:00Z',
      last_updated: '2026-06-11T00:00:00Z',
      monthly_rank: 1,
      monthly_point: 1000,
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
      {
        id: 1,
        circle_id: 1,
        viewer_id: 200,
        trainer_name: 'Trainer1',
        shame_score: null,
        year: 2026,
        month: 6,
        daily_fans: new Array(32).fill(0),
        last_updated: '2026-06-11T00:00:00Z',
      },
    ],
    club_rank: 5,
    fans_to_next_tier: 1000000,
    fans_to_lower_tier: 500000,
    yesterday_fans_to_next_tier: 900000,
    yesterday_fans_to_lower_tier: 400000,
    ...overrides,
  };
}


const realSnapshot: Snapshot = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '../examples/snapshot-june-12.json'),
    'utf-8'
  )
);

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});


describe('saveSnapshot', () => {
  test('saves snapshot to correct path', () => {
    const snap = makeSnapshot();
    const savedPath = saveSnapshot(snap, '2026-06-11', tmpDir);
    const expectedPath = path.join(tmpDir, 'data', 'snapshots', '2026', '06', '11.json');
    expect(savedPath).toBe(expectedPath);
    expect(fs.existsSync(expectedPath)).toBe(true);
  });

  test('creates nested directories if they do not exist', () => {
    const snap = makeSnapshot();
    const savedPath = saveSnapshot(snap, '2026-01-15', tmpDir);
    expect(fs.existsSync(savedPath)).toBe(true);
    const dir = path.dirname(savedPath);
    expect(fs.existsSync(dir)).toBe(true);
  });

  test('saves valid JSON that can be parsed back', () => {
    const snap = makeSnapshot();
    const savedPath = saveSnapshot(snap, '2026-06-11', tmpDir);
    const raw = fs.readFileSync(savedPath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.circle.name).toBe('TestCircle');
    expect(parsed.members).toHaveLength(1);
  });

  test('overwrites existing file', () => {
    const snap1 = makeSnapshot({ club_rank: 5 });
    const snap2 = makeSnapshot({ club_rank: 8 });
    const savedPath = saveSnapshot(snap1, '2026-06-11', tmpDir);
    saveSnapshot(snap2, '2026-06-11', tmpDir);
    const parsed = JSON.parse(fs.readFileSync(savedPath, 'utf-8'));
    expect(parsed.club_rank).toBe(8);
  });

  test('saves real snapshot data correctly', () => {
    const savedPath = saveSnapshot(realSnapshot, '2026-06-12', tmpDir);
    const parsed: Snapshot = JSON.parse(fs.readFileSync(savedPath, 'utf-8'));
    expect(parsed.circle.circle_id).toBe(232229195);
    expect(parsed.members.length).toBeGreaterThan(20);
    expect(parsed.club_rank).toBe(8);
  });

  test('handles different months', () => {
    const snap = makeSnapshot();
    const savedPath = saveSnapshot(snap, '2025-12-25', tmpDir);
    expect(savedPath).toContain(path.join('2025', '12', '25.json'));
    expect(fs.existsSync(savedPath)).toBe(true);
  });

  test('pads single-digit month/day', () => {
    const snap = makeSnapshot();
    const savedPath = saveSnapshot(snap, '2026-03-05', tmpDir);
    expect(savedPath).toContain(path.join('2026', '03', '05.json'));
  });
});


describe('loadSnapshot', () => {
  test('loads a saved snapshot', () => {
    const snap = makeSnapshot();
    saveSnapshot(snap, '2026-06-11', tmpDir);
    const loaded = loadSnapshot('2026-06-11', tmpDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.circle.name).toBe('TestCircle');
    expect(loaded!.club_rank).toBe(5);
  });

  test('returns null for non-existent date', () => {
    const loaded = loadSnapshot('2026-06-11', tmpDir);
    expect(loaded).toBeNull();
  });

  test('loads real snapshot data', () => {
    saveSnapshot(realSnapshot, '2026-06-12', tmpDir);
    const loaded = loadSnapshot('2026-06-12', tmpDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.circle.circle_id).toBe(232229195);
    expect(loaded!.members.length).toBe(realSnapshot.members.length);
  });

  test('returns null for corrupt JSON', () => {
    const dir = path.join(tmpDir, 'data', 'snapshots', '2026', '06');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '11.json'), '{corrupt!!');
    const loaded = loadSnapshot('2026-06-11', tmpDir);
    expect(loaded).toBeNull();
  });

  test('returns null for JSON missing required fields', () => {
    const dir = path.join(tmpDir, 'data', 'snapshots', '2026', '06');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '11.json'), JSON.stringify({ foo: 'bar' }));
    const loaded = loadSnapshot('2026-06-11', tmpDir);
    expect(loaded).toBeNull();
  });

  test('returns null for empty file', () => {
    const dir = path.join(tmpDir, 'data', 'snapshots', '2026', '06');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '11.json'), '');
    const loaded = loadSnapshot('2026-06-11', tmpDir);
    expect(loaded).toBeNull();
  });

  test('returns null when circle present but members missing', () => {
    const dir = path.join(tmpDir, 'data', 'snapshots', '2026', '06');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, '11.json'),
      JSON.stringify({ circle: { circle_id: 1 }, members: undefined })
    );
    const loaded = loadSnapshot('2026-06-11', tmpDir);
    expect(loaded).toBeNull();
  });

  test('returns null when members present but circle missing', () => {
    const dir = path.join(tmpDir, 'data', 'snapshots', '2026', '06');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, '11.json'),
      JSON.stringify({ members: [] })
    );
    const loaded = loadSnapshot('2026-06-11', tmpDir);
    expect(loaded).toBeNull();
  });
});


describe('loadLatestSnapshot', () => {
  test('returns null when no snapshots exist', () => {
    const loaded = loadLatestSnapshot(tmpDir);
    expect(loaded).toBeNull();
  });

  test('returns the most recent snapshot', () => {
    const snap1 = makeSnapshot({ club_rank: 1 });
    const snap2 = makeSnapshot({ club_rank: 2 });
    const snap3 = makeSnapshot({ club_rank: 3 });

    saveSnapshot(snap1, '2026-06-10', tmpDir);
    saveSnapshot(snap2, '2026-06-11', tmpDir);
    saveSnapshot(snap3, '2026-06-12', tmpDir);

    const loaded = loadLatestSnapshot(tmpDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.club_rank).toBe(3);
  });

  test('returns correct snapshot when only one exists', () => {
    const snap = makeSnapshot({ club_rank: 42 });
    saveSnapshot(snap, '2026-06-01', tmpDir);
    const loaded = loadLatestSnapshot(tmpDir);
    expect(loaded!.club_rank).toBe(42);
  });

  test('handles snapshots across month boundaries', () => {
    const snap1 = makeSnapshot({ club_rank: 1 });
    const snap2 = makeSnapshot({ club_rank: 2 });

    saveSnapshot(snap1, '2026-05-31', tmpDir);
    saveSnapshot(snap2, '2026-06-01', tmpDir);

    const loaded = loadLatestSnapshot(tmpDir);
    expect(loaded!.club_rank).toBe(2);
  });

  test('returns snapshot with special characters in names', () => {
    const snap = makeSnapshot({
      circle: {
        ...makeSnapshot().circle,
        name: 'Horse＿Club_日本語_🎉',
      },
    });
    saveSnapshot(snap, '2026-06-12', tmpDir);
    const loaded = loadLatestSnapshot(tmpDir);
    expect(loaded!.circle.name).toBe('Horse＿Club_日本語_🎉');
  });
});


describe('loadMonthSnapshots', () => {
  test('returns empty array when no snapshots exist', () => {
    const result = loadMonthSnapshots(2026, 6, tmpDir);
    expect(result).toEqual([]);
  });

  test('returns only snapshots for the given month', () => {
    const snap1 = makeSnapshot({ club_rank: 1 });
    const snap2 = makeSnapshot({ club_rank: 2 });
    const snap3 = makeSnapshot({ club_rank: 3 });

    saveSnapshot(snap1, '2026-06-10', tmpDir);
    saveSnapshot(snap2, '2026-06-11', tmpDir);
    saveSnapshot(snap3, '2026-07-01', tmpDir);

    const result = loadMonthSnapshots(2026, 6, tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].club_rank).toBe(2); // latest (June 11)
  });

  test('returns snapshots sorted by date ascending', () => {
    const snap1 = makeSnapshot({ club_rank: 1 });
    const snap2 = makeSnapshot({ club_rank: 2 });
    const snap3 = makeSnapshot({ club_rank: 3 });

    // Save in non-sequential order
    saveSnapshot(snap3, '2026-06-15', tmpDir);
    saveSnapshot(snap1, '2026-06-05', tmpDir);
    saveSnapshot(snap2, '2026-06-10', tmpDir);

    const result = loadMonthSnapshots(2026, 6, tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].club_rank).toBe(3); // June 15 (latest)
  });

  test('returns empty for month with no data', () => {
    saveSnapshot(makeSnapshot(), '2026-06-11', tmpDir);
    const result = loadMonthSnapshots(2026, 8, tmpDir);
    expect(result).toEqual([]);
  });
});


describe('snapshotExists', () => {
  test('returns true when snapshot exists', () => {
    const snap = makeSnapshot();
    saveSnapshot(snap, '2026-06-11', tmpDir);
    expect(snapshotExists('2026-06-11', tmpDir)).toBe(true);
  });

  test('returns false when snapshot does not exist', () => {
    expect(snapshotExists('2026-06-11', tmpDir)).toBe(false);
  });

  test('returns true for different months', () => {
    const snap = makeSnapshot();
    saveSnapshot(snap, '2026-01-01', tmpDir);
    expect(snapshotExists('2026-01-01', tmpDir)).toBe(true);
    expect(snapshotExists('2026-02-01', tmpDir)).toBe(false);
  });
});


describe('getDataDayFromSnapshot', () => {
  test('returns max data day across all members', () => {
    // Member 1 has data up to day 11, Member 2 up to day 5
    const fans1 = new Array(32).fill(0);
    fans1[10] = 1000; // day 11 (1-indexed)
    const fans2 = new Array(32).fill(0);
    fans2[4] = 500; // day 5

    const snap = makeSnapshot({
      members: [
        { ...makeSnapshot().members[0], daily_fans: fans1 },
        { ...makeSnapshot().members[0], id: 2, viewer_id: 300, trainer_name: 'T2', daily_fans: fans2 },
      ],
    });

    const result = getDataDayFromSnapshot(snap);
    expect(result).toBe(11);
  });

  test('returns 0 when no member has positive data', () => {
    const snap = makeSnapshot();
    expect(getDataDayFromSnapshot(snap)).toBe(0);
  });

  test('returns correct day for real snapshot', () => {
    // Real snapshot has data up to day 11 (index 10 is the last positive)
    const result = getDataDayFromSnapshot(realSnapshot);
    expect(result).toBeGreaterThanOrEqual(11);
  });

  test('handles single member', () => {
    const fans = new Array(32).fill(0);
    fans[0] = 100;
    fans[1] = 200;
    fans[2] = 300;
    const snap = makeSnapshot({
      members: [{ ...makeSnapshot().members[0], daily_fans: fans }],
    });
    expect(getDataDayFromSnapshot(snap)).toBe(3);
  });

  test('handles transfer members with negative early values', () => {
    // Transfer: first days negative, then positive
    const fans = new Array(32).fill(0);
    fans[0] = -100000000;
    fans[1] = -100000000;
    fans[2] = 100000000;
    fans[3] = 200000000;
    fans[10] = 300000000;

    const snap = makeSnapshot({
      members: [{ ...makeSnapshot().members[0], daily_fans: fans }],
    });
    expect(getDataDayFromSnapshot(snap)).toBe(11);
  });
});


describe('staleSnapshotMessage', () => {
  test('returns Indonesian message with formatted date', () => {
    const result = staleSnapshotMessage('2026-06-10');
    expect(result).toContain('Data uma.moe lagi tidak bisa diambil');
    expect(result).toContain('10 Juni 2026');
  });

  test('returns empty string when no snapshot date', () => {
    const result = staleSnapshotMessage(null);
    expect(result).toBe('');
  });

  test('formats different dates correctly', () => {
    const result = staleSnapshotMessage('2026-01-05');
    expect(result).toContain('5 Januari 2026');
  });

  test('handles single-digit day and month', () => {
    const result = staleSnapshotMessage('2026-03-01');
    expect(result).toContain('1 Maret 2026');
  });
});


describe('getLatestSnapshotDate', () => {
  test('returns null when no snapshots exist', () => {
    expect(getLatestSnapshotDate(tmpDir)).toBeNull();
  });

  test('returns latest date string when snapshots exist', () => {
    saveSnapshot(makeSnapshot(), '2026-06-10', tmpDir);
    saveSnapshot(makeSnapshot(), '2026-06-12', tmpDir);
    saveSnapshot(makeSnapshot(), '2026-06-11', tmpDir);
    expect(getLatestSnapshotDate(tmpDir)).toBe('2026-06-12');
  });

  test('returns single date when only one snapshot exists', () => {
    saveSnapshot(makeSnapshot(), '2026-06-10', tmpDir);
    expect(getLatestSnapshotDate(tmpDir)).toBe('2026-06-10');
  });
});
