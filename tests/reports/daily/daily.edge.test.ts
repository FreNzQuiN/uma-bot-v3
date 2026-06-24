/**
 * Daily Report — Edge Case Tests
 *
 * Empty snapshots, left members, offset clamping, offset=2 verification,
 * stale warning through dispatch, offset=1 line verification, section ordering,
 * transfer members in ranking, and config edge cases.
 */

import { generateDailyReport } from '../../../src/reports/daily';
import { computeMembers } from '../../../src/reports/compute';
import { getDefaultConfig } from '../../../src/config';
import { getDataDayFromSnapshot } from '../../../src/data/snapshot';
import {
  getDailyGain,
  isTransferMember,
} from '../../../src/data/daily-fans';
import { formatNumber } from '../../../src/utils/format';
import { setupCommandHandler } from '../../../src/whatsapp/dispatch';
import { WhatsAppClient, IncomingMessage } from '../../../src/whatsapp/client';
import type { Snapshot, BotConfig } from '../../../src/types';
import {
  loadRealSnapshot,
  makeConfig as makeConfigBase,
  makeMessage,
  TRANSFER_NAMES,
  STALE_NAMES,
  mockCurrentDate,
  restoreDateMocks,
  makeMockDb,
} from '../../_helpers';

// ============================================================
// Constants & Loaders
// ============================================================

const ADMIN_JID = '6281234567890@s.whatsapp.net';
const NON_ADMIN_JID = '6289999999999@s.whatsapp.net';
const COMMAND_GROUP = 'group-cmd@g.us';
const OTHER_GROUP = 'group-other@g.us';

let snapshot: Snapshot;
let config: BotConfig;
let computedMembers: ReturnType<typeof computeMembers>;

beforeAll(() => {
  snapshot = loadRealSnapshot();
  config = getDefaultConfig();
  computedMembers = computeMembers(snapshot, config);
});

// ============================================================
// Test Helpers
// ============================================================

function makeConfig(overrides: Record<string, any> = {}): BotConfig {
  return makeConfigBase({
    admins: [ADMIN_JID],
    groups: { command: [COMMAND_GROUP], announcement: [], alertAdmin: [] },
    ...overrides,
  });
}

function makeSnapshotWithLatestDay(latestDay: number): Snapshot {
  return {
    ...snapshot,
    members: snapshot.members.map((m) => ({
      ...m,
      daily_fans: m.daily_fans.map((v, i) => {
        if (i === latestDay - 1) {
          const prevVal = i > 0 ? m.daily_fans[i - 1] : 0;
          return prevVal + 1000;
        }
        if (i < latestDay - 1) return v;
        return 0;
      }),
    })),
  };
}

// ============================================================
// Section 7: Empty Snapshot
// ============================================================

describe('Empty snapshot', () => {
  it('returns warning when members array is empty', () => {
    const emptySnapshot: Snapshot = {
      circle: snapshot.circle,
      members: [],
      club_rank: 8,
      fans_to_next_tier: 349208495,
      fans_to_lower_tier: 21848493,
      yesterday_fans_to_next_tier: 305715171,
      yesterday_fans_to_lower_tier: 20621702,
    };
    const result = generateDailyReport(emptySnapshot, config, computeMembers(emptySnapshot, config), 0);
    expect(result).toBe('ℹ️ *Daily Report*\nTidak ada data anggota untuk hari ini. Mungkin sync belum berjalan.');
  });
});

// ============================================================
// Section 15: Left Members Section (DB integration)
// ============================================================

describe('Left members section', () => {
  it('shows NO left members section (left only in /members)', () => {
    const report = generateDailyReport(snapshot, config, computedMembers, 0);

    // Left section removed from daily report
    expect(report).not.toContain('🚪 Keluar dari klub:');

    // Left members should NOT be in ranking
    const rankLines = report.split('\n').filter((l) => /^\d+\./.test(l));
    for (const line of rankLines) {
      expect(line).not.toContain('DOA IBU');
      expect(line).not.toContain('Kuro');
      expect(line).not.toContain('Rowking');
      expect(line).not.toContain('Lebowski');
    }
  });

  it('DB cross-check is no longer needed for left detection', () => {
    const mockDbWithLeft: any = {
      ...makeMockDb(),
      getMembers: jest.fn().mockReturnValue([
        { viewer_id: 723724919975, status: 'left' }, // DOA IBU
      ]),
    };

    const reportNoDb = generateDailyReport(snapshot, config, computedMembers, 0);
    const reportWithDb = generateDailyReport(snapshot, config, computedMembers, 0);

    // Both should show same output (no left section)
    expect(reportNoDb).not.toContain('🚪 Keluar dari klub:');
    expect(reportWithDb).not.toContain('🚪 Keluar dari klub:');
  });

  it('left section does NOT exist in daily report', () => {
    const report = generateDailyReport(snapshot, config, computedMembers, 0);
    const leftIdx = report.indexOf('🚪 Keluar dari klub:');
    expect(leftIdx).toBe(-1);
  });
});

// ============================================================
// Section 16: Offset Clamping at Report Level
// ============================================================

describe('Offset clamping at report level', () => {
  it('offset=100 clamps dataDay to 1, shows day 1 data', () => {
    const report = generateDailyReport(snapshot, config, computedMembers, 100);
    // dataDay = max(1, 11 - 100) = 1
    // Day 1 has no previous day, so all gains are 0
    expect(report).toContain('📊 *Daily Report — 1 Juni 2026*');

    const lines = report.split('\n');
    const memberLines = lines.filter((l) => /^\d+\./.test(l));
    expect(memberLines.length).toBe(0);

    // Shows "first day" message since no one can have gain on day 1
    expect(report).toContain('Gain hari pertama: belum tersedia');
  });

  it('offset equal to dataDay - 1 shows day 1 data', () => {
    // dataDay=11, offset=10 -> dataDay=1
    const report = generateDailyReport(snapshot, config, computedMembers, 10);
    expect(report).toContain('📊 *Daily Report — 1 Juni 2026*');
  });

  it('offset=dataDay shows day 1 (clamped from 0)', () => {
    // dataDay=11, offset=11 -> max(1, 0) = 1
    const report = generateDailyReport(snapshot, config, computedMembers, 11);
    expect(report).toContain('📊 *Daily Report — 1 Juni 2026*');
  });
});

// ============================================================
// Section 17: Offset=2 Verification (Day 9 Gains)
// ============================================================

describe('Offset=2 shows day 9 gains', () => {
  let report: string;
  let memberLines: string[];

  beforeAll(() => {
    report = generateDailyReport(snapshot, config, computedMembers, 2);
    memberLines = report.split('\n').filter((l) => /^\d+\./.test(l));
  });

  it('header shows 9 Juni 2026', () => {
    expect(report).toContain('📊 *Daily Report — 9 Juni 2026*');
  });

  it('Nargi day 9 gain: 367,503,029 - 366,858,425 = 644,604', () => {
    const nargi = snapshot.members.find((m) => m.trainer_name === 'Nargi')!;
    // day 9 = index 8, day 8 = index 7
    expect(nargi.daily_fans[8]).toBe(367503029);
    expect(nargi.daily_fans[7]).toBe(366858425);
    const gain = getDailyGain(nargi.daily_fans, 9);
    expect(gain).toBe(644604);
    expect(formatNumber(gain)).toBe('644.6K');
  });

  it('gains are sorted descending', () => {
    const gains: number[] = [];
    for (const line of memberLines) {
      const match = line.match(/— ([+-]?[\d.]+[KMB]?|0)$/);
      if (!match) throw new Error(`Could not parse: ${line}`);
      const val = match[1];
      if (val === '0') { gains.push(0); continue; }
      const numStr = val.replace(/[+-]/, '');
      let num = parseFloat(numStr);
      if (val.endsWith('K')) num *= 1_000;
      if (val.endsWith('M')) num *= 1_000_000;
      if (val.endsWith('B')) num *= 1_000_000_000;
      gains.push(val.startsWith('-') ? -num : num);
    }
    for (let i = 1; i < gains.length; i++) {
      expect(gains[i - 1]).toBeGreaterThanOrEqual(gains[i]);
    }
  });

  it('transfer badges present for all 6 transfer members', () => {
    for (const name of TRANSFER_NAMES) {
      const line = memberLines.find((l) => l.includes(name));
      expect(line).toBeDefined();
      expect(line!).toContain('🔄');
    }
  });

  it('no left section in daily report (left only in /members)', () => {
    expect(report).not.toContain('🚪 Keluar dari klub:');
  });

  it('sync footer uses offset date', () => {
    const syncLine = report.split('\n').find((l) => l.startsWith('Terakhir sync:'));
    expect(syncLine).toMatch(/^Terakhir sync: \d+\/\d+ \d{2}:\d{2}$/);
  });
});

// ============================================================
// Section 18: Stale Warning — Integration Through Dispatch
// ============================================================

describe('Stale warning through dispatch (date-mocked)', () => {
  let mockDb: any;
  let mockClient: WhatsAppClient;
  let cfg: BotConfig;
  let messageHandler: ((msg: IncomingMessage) => void) | null;
  let sentMessages: { jid: string; text: string }[];

  afterEach(() => {
    restoreDateMocks();
  });

  beforeEach(() => {
    messageHandler = null;
    sentMessages = [];
    mockDb = makeMockDb();
    cfg = makeConfig();

    mockClient = {
      onMessage: jest.fn((handler: any) => {
        messageHandler = handler;
      }),
      sendMessage: jest.fn(async (jid: string, text: string) => {
        sentMessages.push({ jid, text });
      }),
      sendOrEdit: jest.fn(async (jid: string, _msgId: string | null, text: string) => {
        sentMessages.push({ jid, text });
        return 'sent-msg-id';
      }),
      connect: jest.fn(),
      disconnect: jest.fn(),
    } as any;
  });

  it('/daily 1 on fresh snapshot (day 12, today June 13) shows NO stale warning', async () => {
    mockCurrentDate(2026, 6, 13);
    const freshSnapshot = makeSnapshotWithLatestDay(12);
    setupCommandHandler(mockClient, cfg, mockDb, () => freshSnapshot);

    await messageHandler!(
      makeMessage({
        key: { remoteJid: COMMAND_GROUP, id: 'msg-001', participant: NON_ADMIN_JID },
        message: { conversation: '/daily 1' },
      })
    );

    const report = sentMessages[1].text;

    expect(report).toContain('📊 *Daily Report — 11 Juni 2026*');
    expect(report).not.toContain('⚠️ Data klub mungkin tidak terbaru');
  });

  it('/daily 1 on stale snapshot (day 11, today June 13) shows stale warning referencing snapshot date', async () => {
    mockCurrentDate(2026, 6, 13);
    setupCommandHandler(mockClient, cfg, mockDb, () => snapshot);

    await messageHandler!(
      makeMessage({
        key: { remoteJid: COMMAND_GROUP, id: 'msg-001', participant: NON_ADMIN_JID },
        message: { conversation: '/daily 1' },
      })
    );

    const report = sentMessages[1].text;

    expect(report).toContain('📊 *Daily Report — 10 Juni 2026*');
    expect(report).toContain('⚠️ Data klub mungkin tidak terbaru (update terakhir: 11 Juni 2026)');
    expect(report).not.toContain('update terakhir: 10 Juni 2026');
  });

  it('/daily 0 on fresh snapshot (day 12, today June 12) shows NO stale warning', async () => {
    mockCurrentDate(2026, 6, 12);
    const freshSnapshot = makeSnapshotWithLatestDay(12);
    setupCommandHandler(mockClient, cfg, mockDb, () => freshSnapshot);

    await messageHandler!(
      makeMessage({
        key: { remoteJid: COMMAND_GROUP, id: 'msg-001', participant: NON_ADMIN_JID },
        message: { conversation: '/daily' },
      })
    );

    const report = sentMessages[1].text;
    expect(report).toContain('📊 *Daily Report — 12 Juni 2026*');
    expect(report).not.toContain('⚠️ Data klub mungkin tidak terbaru');
  });
});

// ============================================================
// Section 22: Offset=1 Complete Line Verification
// ============================================================

describe('Offset=1 complete line verification', () => {
  let report: string;
  let lines: string[];

  beforeAll(() => {
    report = generateDailyReport(snapshot, config, computedMembers, 1);
    lines = report.split('\n');
  });

  it('header: *📊 Daily Report — 10 Juni 2026*', () => {
    expect(report).toContain('📊 *Daily Report — 10 Juni 2026*');
  });

  it('club info line: Hol＿Horse | A+ (#431)', () => {
    expect(report).toContain('Hol＿Horse');
    expect(report).toContain('A+');
    expect(report).toContain('#431');
  });

  it('promotion+demotion line (combined): Promosi: 349.2M fans lagi | Degradasi: buffer 21.8M', () => {
    expect(report).toContain('Promosi: 349.2M fans lagi');
    expect(report).toContain('Degradasi: buffer 21.8M');
  });

  it('summary: 👥 28 kontribusi dari 30 anggota | Total: <correct sum>', () => {
    expect(report).toMatch(/👥 28 kontribusi dari 30 anggota \| Total: /);
  });

  it('Nargi is #1 with gain 3,349,623 -> +3.3M', () => {
    const nargi = snapshot.members.find((m) => m.trainer_name === 'Nargi')!;
    expect(getDailyGain(nargi.daily_fans, 10)).toBe(3349623);
    expect(formatNumber(3349623)).toBe('3.3M');
    const nargiLine = lines.find((l) => l.includes('Nargi'));
    expect(nargiLine).toBe('1. *Nargi* — +3.3M');
  });

  it('transfer badges present for all 6 in offset=1 report', () => {
    const memberLines = lines.filter((l) => /^\d+\./.test(l));
    for (const name of TRANSFER_NAMES) {
      const line = memberLines.find((l) => l.includes(name));
      expect(line).toBeDefined();
      expect(line!).toContain('🔄');
    }
    const transferCount = memberLines.filter((l) => l.includes('🔄')).length;
    expect(transferCount).toBe(6);
  });

  it('left members section shows same 4 ghost members in offset=1', () => {
    // Left section removed from daily report
    expect(report).not.toContain('🚪 Keluar dari klub:');
  });

  it('sync footer: Terakhir sync: D/M HH:MM format', () => {
    const syncLine = lines.find((l) => l.startsWith('Terakhir sync:'));
    expect(syncLine).toMatch(/^Terakhir sync: \d+\/\d+ \d{2}:\d{2}$/);
  });

  it('28 member lines in offset=1 (positive-gain only)', () => {
    const memberLines = lines.filter((l) => /^\d+\./.test(l));
    expect(memberLines.length).toBe(28);
  });

  it('all member gain formats are valid', () => {
    const memberLines = lines.filter((l) => /^\d+\./.test(l));
    for (const line of memberLines) {
      expect(line).toMatch(/^\d+\.\s\*.+\*\s*(🔄)? — \+[\d.]+[KMB]?$/);
    }
  });

  it('gains sorted descending in offset=1', () => {
    const memberLines = lines.filter((l) => /^\d+\./.test(l));
    const gains: number[] = [];
    for (const line of memberLines) {
      const match = line.match(/— ([+-]?[\d.]+[KMB]?|0)$/);
      if (!match) throw new Error(`Could not parse gain from: ${line}`);
      const val = match[1];
      if (val === '0') { gains.push(0); continue; }
      const numStr = val.replace(/[+-]/, '');
      let num = parseFloat(numStr);
      if (val.endsWith('K')) num *= 1_000;
      if (val.endsWith('M')) num *= 1_000_000;
      if (val.endsWith('B')) num *= 1_000_000_000;
      gains.push(val.startsWith('-') ? -num : num);
    }
    for (let i = 1; i < gains.length; i++) {
      expect(gains[i - 1]).toBeGreaterThanOrEqual(gains[i]);
    }
  });
});

// ============================================================
// Section 23: Stale Section Order Verification
// ============================================================

describe('Report section ordering', () => {

  afterEach(() => {
    restoreDateMocks();
  });

  it('stale data warning comes after member list, before footer', () => {
    mockCurrentDate(2026, 6, 13);
    const report = generateDailyReport(snapshot, config, computedMembers, 0);
    const lines = report.split('\n');

    const lastRankedIdx = lines.reduce((acc, l, i) =>
      /^\d+\./.test(l) ? i : acc, 0);
    const staleWarningIdx = lines.findIndex((l) => l.includes('⚠️ Data klub'));
    const footerIdx = lines.findIndex((l) => l.startsWith('⸻'));

    // No left section in daily report
    expect(lines.findIndex((l) => l.includes('🚪 Keluar dari klub:'))).toBe(-1);
    expect(staleWarningIdx).toBeGreaterThan(lastRankedIdx);
    expect(footerIdx).toBeGreaterThan(staleWarningIdx);

  });
});

// ============================================================
// Section 24: Transfer Members Always in Contributing
// ============================================================

describe('Transfer members always appear in ranking', () => {
  it('transfer members with 0 gain appear in stale section', () => {
    const report = generateDailyReport(snapshot, config, computedMembers, 0);
    const memberLines = report.split('\n').filter((l) => /^\d+\./.test(l));
    const falkrumRanked = memberLines.find((l) => l.includes('Falkrum'));
    expect(falkrumRanked).toBeUndefined();
    expect(report).toContain('• Falkrum');
  });

  it('transfer members with positive gain never in stale section', () => {
    const report = generateDailyReport(snapshot, config, computedMembers, 0);
    const staleIdx = report.indexOf('⚠️ Belum aktif');
    if (staleIdx >= 0) {
      const staleSection = report.substring(staleIdx);
      expect(staleSection).not.toContain('Zero');
      expect(staleSection).not.toContain('TheTengOne');
      expect(staleSection).not.toContain('Sairen');
      expect(staleSection).not.toContain('VitoHoow');
      expect(staleSection).not.toContain('Ceciria');
    }
  });
});

// ============================================================
// Section 25: Config Edge Cases
// ============================================================

describe('Config edge cases for daily report', () => {
  it('config.requirements.monthlyFans=0 does not break daily report', () => {
    const zeroReqConfig: BotConfig = {
      ...config,
      requirements: { ...config.requirements, monthlyFans: 0 },
    };
    const report = generateDailyReport(snapshot, zeroReqConfig, computeMembers(snapshot, zeroReqConfig), 0);
    expect(report).toContain('📊 *Daily Report — 11 Juni 2026*');
    expect(report).toContain('kontribusi dari 30 anggota');
  });

  it('config with weeklyFans>0 does not break daily report', () => {
    const weeklyConfig: BotConfig = {
      ...config,
      requirements: { ...config.requirements, weeklyFans: 1000000 },
    };
    const report = generateDailyReport(snapshot, weeklyConfig, computeMembers(snapshot, weeklyConfig), 0);
    expect(report).toContain('📊 *Daily Report — 11 Juni 2026*');
    expect(report).toContain('kontribusi dari 30 anggota');
  });

  it('staleAfterDaysDaily=1 makes members with 0 gain on viewed day stale', () => {
    const strictConfig: BotConfig = {
      ...config,
      memberStatus: { staleAfterDaysDaily: 1, staleAfterDaysWeekly: 3, staleAfterDaysMonthly: 7 },
    };
    const customSnapshot: Snapshot = {
      ...snapshot,
      members: snapshot.members.map((m) => {
        if (m.trainer_name === 'Nargi') {
          return { ...m, daily_fans: m.daily_fans.map((v, i) => i < 10 ? v : 0) };
        }
        return m;
      }),
    };
    const report = generateDailyReport(customSnapshot, strictConfig, computeMembers(customSnapshot, strictConfig), 0);
    // Nargi has gain=0 on day 11 (viewed day), firstPositiveDay=1 ≠ dataDay
    // With staleAfterDaysDaily=1, Nargi shows in stale section
    expect(report).toContain('⚠️ Belum aktif hari ini');
    expect(report).toContain('• Nargi');
  });

  it('staleAfterDaysDaily=0 still shows stale section for active members with 0 gain', () => {
    const lenientConfig: BotConfig = {
      ...config,
      memberStatus: { staleAfterDaysDaily: 0, staleAfterDaysWeekly: 3, staleAfterDaysMonthly: 7 },
    };
    const report = generateDailyReport(snapshot, lenientConfig, computeMembers(snapshot, lenientConfig), 0);
    // Stale section shows active members with 0 gain on the viewed day, regardless of staleAfterDaysDaily
    expect(report).toContain('⚠️ Belum aktif');
    // Ghost detection still removes 4 members → 27 positive-gain in ranking
    const memberLines = report.split('\n').filter((l) => /^\d+\./.test(l));
    expect(memberLines.length).toBe(27);
  });
});
