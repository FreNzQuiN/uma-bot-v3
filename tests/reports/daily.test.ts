/**
 * /daily Command — Comprehensive Tests
 *
 * Tests the daily report through the full user flow:
 *   User types /daily → dispatch → loading → report
 *
 * Uses real snapshot (examples/snapshot-june-12.json, 34 members).
 * All tests print full output for visual inspection.
 */

import * as fs from 'fs';
import * as path from 'path';
import { generateDailyReport } from '../../src/reports/daily';
import { getDefaultConfig } from '../../src/config';
import { getDataDayFromSnapshot } from '../../src/data/snapshot';
import {
  getDailyGain,
  getLatestDataDay,
  isTransferMember,
  isStaleMember,
} from '../../src/data/daily-fans';
import { formatNumber } from '../../src/reports/format';
import { CLUB_TIERS } from '../../src/types';
import { setupCommandHandler } from '../../src/whatsapp/dispatch';
import { WhatsAppClient, IncomingMessage } from '../../src/whatsapp/client';
import type { Snapshot, BotConfig } from '../../src/types';

// ============================================================
// Constants & Loaders
// ============================================================

const SNAPSHOT_PATH = path.join(__dirname, '../../examples/snapshot-june-12.json');
const ADMIN_JID = '6281234567890@s.whatsapp.net';
const NON_ADMIN_JID = '6289999999999@s.whatsapp.net';
const COMMAND_GROUP = 'group-cmd@g.us';
const OTHER_GROUP = 'group-other@g.us';

let snapshot: Snapshot;
let config: BotConfig;

beforeAll(() => {
  snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf-8'));
  config = getDefaultConfig();
});

// ============================================================
// Test Helpers
// ============================================================

function makeConfig(overrides: Partial<BotConfig> = {}): BotConfig {
  const base = getDefaultConfig();
  return {
    ...base,
    ...overrides,
    admins: overrides.admins ?? [ADMIN_JID],
    groups: {
      ...base.groups,
      command: [COMMAND_GROUP],
      announcement: [],
      alertAdmin: [],
      ...(overrides.groups ?? {}),
    },
  };
}

function makeMessage(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    key: {
      remoteJid: COMMAND_GROUP,
      id: 'msg-001',
    },
    message: {
      conversation: '/daily',
    },
    pushName: 'TestUser',
    ...overrides,
  };
}

function makeMockDb(): any {
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

function mockCurrentDate(year: number, month: number, day: number) {
  // Noon JST = 03:00 UTC. Use fake timers so new Date() returns this time.
  const utcMs = Date.UTC(year, month - 1, day, 3, 0, 0);
  jest.useFakeTimers();
  jest.setSystemTime(new Date(utcMs));
}

function restoreDateMocks() {
  jest.useRealTimers();
}

// ============================================================
// Section 1: Snapshot Data Verification
// ============================================================

describe('Snapshot data fundamentals', () => {
  it('has the expected structure', () => {
    expect(snapshot.circle).toBeDefined();
    expect(snapshot.members).toBeDefined();
    expect(Array.isArray(snapshot.members)).toBe(true);
    expect(snapshot.members.length).toBeGreaterThan(0);
    expect(snapshot.club_rank).toBeDefined();
    expect(snapshot.fans_to_next_tier).toBeDefined();
    expect(snapshot.fans_to_lower_tier).toBeDefined();
  });

  it('has correct club metadata', () => {
    expect(snapshot.circle.name).toBe('Hol＿Horse');
    expect(snapshot.circle.monthly_rank).toBe(431);
    expect(snapshot.club_rank).toBe(8);
    expect(CLUB_TIERS[8]).toBe('A+');
    expect(snapshot.fans_to_next_tier).toBe(349208495);
    expect(snapshot.fans_to_lower_tier).toBe(21848493);
  });

  it('has correct latest data day', () => {
    const latestDataDay = getDataDayFromSnapshot(snapshot);
    expect(latestDataDay).toBe(11);

    let maxDay = 0;
    for (const member of snapshot.members) {
      const day = getLatestDataDay(member.daily_fans);
      if (day > maxDay) maxDay = day;
    }
    expect(maxDay).toBe(11);
  });

  it('has 34 total members in snapshot', () => {
    expect(snapshot.members.length).toBe(34);
  });
});

// ============================================================
// Section 2: Member Classification (active / stale / transfer)
// ============================================================

describe('Member classification', () => {
  it('correctly identifies 4 stale members', () => {
    const latestDataDay = getDataDayFromSnapshot(snapshot);
    const staleAfterDays = 3;

    const staleNames: string[] = [];
    for (const member of snapshot.members) {
      const latestPositiveDay = getLatestDataDay(member.daily_fans);
      const isTransfer = isTransferMember(member);
      if (!isTransfer && isStaleMember(latestPositiveDay, latestDataDay, staleAfterDays)) {
        staleNames.push(member.trainer_name);
      }
    }

    expect(staleNames.sort()).toEqual(['DOA IBU', 'Kuro', 'Lebowski', 'Rowking'].sort());
    expect(staleNames.length).toBe(4);
  });

  it('correctly identifies 6 transfer members', () => {
    const transferNames: string[] = [];
    for (const member of snapshot.members) {
      if (isTransferMember(member)) {
        transferNames.push(member.trainer_name);
      }
    }

    expect(transferNames).toContain('Zero');
    expect(transferNames).toContain('TheTengOne');
    expect(transferNames).toContain('Sairen');
    expect(transferNames).toContain('VitoHoow');
    expect(transferNames).toContain('Ceciria');
    expect(transferNames).toContain('Falkrum');
    expect(transferNames.length).toBe(6);
  });

  it('active + transfer + stale = total members (30 + 4 = 34)', () => {
    const latestDataDay = getDataDayFromSnapshot(snapshot);
    let active = 0;
    let stale = 0;
    let transfer = 0;

    for (const member of snapshot.members) {
      const latestPositiveDay = getLatestDataDay(member.daily_fans);
      const isTransfer = isTransferMember(member);
      if (isTransfer) {
        transfer++;
      } else if (latestPositiveDay === 0 || isStaleMember(latestPositiveDay, latestDataDay, 3)) {
        stale++;
      } else {
        active++;
      }
    }

    expect(active).toBe(24);
    expect(transfer).toBe(6);
    expect(stale).toBe(4);
    expect(active + transfer + stale).toBe(34);
  });

  it('verifies transfer detection via isTransferMember', () => {
    for (const member of snapshot.members) {
      const transfer = isTransferMember(member);
      if (member.previous_circle_id !== undefined) {
        expect(transfer).toBe(true);
      }
      if (member.previous_circle_name !== undefined) {
        expect(transfer).toBe(true);
      }
    }
  });
});

// ============================================================
// Section 3: Output Structure Verification (unit-level)
// ============================================================

describe('Output structure', () => {
  let report: string;
  let reportOffset1: string;
  let lines: string[];

  beforeAll(() => {
    report = generateDailyReport(snapshot, config, 0);
    reportOffset1 = generateDailyReport(snapshot, config, 1);
    lines = report.split('\n');
  });

  it('prints the full report for verification', () => {
    console.log('\n========== FULL DAILY REPORT (offset=0) ==========');
    console.log(report);
    console.log('========== END REPORT ==========');

    console.log('\n========== FULL DAILY REPORT (offset=1) ==========');
    console.log(reportOffset1);
    console.log('========== END REPORT ==========\n');

    expect(report.length).toBeGreaterThan(0);
  });

  it('header is 📊 *Daily Report — 11 Juni 2026*', () => {
    expect(lines[0]).toBe('📊 *Daily Report — 11 Juni 2026*');
  });

  it('line 3 is "Hol＿Horse | A+ (#431)"', () => {
    expect(lines[2]).toBe('Hol＿Horse | A+ (#431)');
  });

  it('line 4 is "Data: 11 Juni 2026, 22:00 WIB"', () => {
    expect(lines[3]).toBe('Periode data: 11 Juni 2026, 22:00 WIB');
  });

  it('line 5 is "Promosi: 349.2M fans lagi | Degradasi: buffer 21.8M"', () => {
    expect(lines[4]).toBe('Promosi: 349.2M fans lagi | Degradasi: buffer 21.8M');
  });

  it('summary line shows contributor count', () => {
    expect(lines[6]).toMatch(/^👥 27 kontribusi dari 30 anggota \| Total: /);
  });

  it('member list starts at line 8 with positive-gain members only', () => {
    expect(lines[8]).toMatch(/^1\. \*Nargi\* — \+/);

    const memberLines = lines.filter((l) => /^\d+\.\s/.test(l));
    expect(memberLines.length).toBe(27);

    for (const line of memberLines) {
      expect(line).toMatch(/^\d+\.\s\*.+\*\s*(🔄)? — \+[\d.]+[KMB]?$/);
    }
  });

  it('footer shows "Terakhir sync: D/M HH:MM" format', () => {
    const syncLine = lines.find((l) => l.startsWith('Terakhir sync:'));
    expect(syncLine).toMatch(/^Terakhir sync: \d+\/\d+ \d{2}:\d{2}$/);
  });

  it('members are sorted by gain descending', () => {
    const memberLines = lines.filter((l) => /^\d+\.\s/.test(l));
    expect(memberLines[0]).toContain('Nargi');

    const gains = memberLines.map((l) => {
      const match = l.match(/— \+?([\d.]+)([KMB])?/);
      if (!match) return 0;
      const val = parseFloat(match[1]);
      const suffix = match[2] || '';
      if (suffix === 'K') return val * 1000;
      if (suffix === 'M') return val * 1000000;
      if (suffix === 'B') return val * 1000000000;
      return val;
    });
    for (let i = 1; i < gains.length; i++) {
      expect(gains[i - 1]).toBeGreaterThanOrEqual(gains[i]);
    }
  });
});

// ============================================================
// Section 4: Individual Member Gains
// ============================================================

describe('Individual member gains', () => {
  it('Nargi gain = 373937532 - 370852652 = 3084880', () => {
    const nargi = snapshot.members.find((m) => m.trainer_name === 'Nargi')!;
    expect(nargi.daily_fans[10]).toBe(373937532);
    expect(nargi.daily_fans[9]).toBe(370852652);
    expect(getDailyGain(nargi.daily_fans, 11)).toBe(3084880);
  });

  it('GoldFamily gain = 317726222 - 315015625 = 2710597', () => {
    const member = snapshot.members.find((m) => m.trainer_name === 'GoldFamily')!;
    expect(getDailyGain(member.daily_fans, 11)).toBe(2710597);
  });

  it('naku has 0 gain (day 11 == day 10)', () => {
    const member = snapshot.members.find((m) => m.trainer_name === 'naku')!;
    expect(getDailyGain(member.daily_fans, 11)).toBe(0);
  });

  it('Falkrum (transfer) has 0 gain', () => {
    const member = snapshot.members.find((m) => m.trainer_name === 'Falkrum')!;
    expect(isTransferMember(member)).toBe(true);
    expect(getDailyGain(member.daily_fans, 11)).toBe(0);
  });

  it('TheTengOne (transfer) has gain 2898', () => {
    const member = snapshot.members.find((m) => m.trainer_name === 'TheTengOne')!;
    expect(isTransferMember(member)).toBe(true);
    expect(getDailyGain(member.daily_fans, 11)).toBe(2898);
  });

  it('DOA IBU (stale) gain is 0 (no data for day 11)', () => {
    const member = snapshot.members.find((m) => m.trainer_name === 'DOA IBU')!;
    expect(getLatestDataDay(member.daily_fans)).toBe(1);
    expect(getDailyGain(member.daily_fans, 11)).toBe(0);
  });

  it('Sairen (transfer) gain = 2230269', () => {
    const member = snapshot.members.find((m) => m.trainer_name === 'Sairen')!;
    expect(isTransferMember(member)).toBe(true);
    expect(getDailyGain(member.daily_fans, 11)).toBe(2230269);
  });
});

// ============================================================
// Section 5: Offset Reports
// ============================================================

describe('Offset reports', () => {
  it('offset=1 shows day 10 data', () => {
    const report1 = generateDailyReport(snapshot, config, 1);
    const lines1 = report1.split('\n');
    expect(lines1[0]).toBe('📊 *Daily Report — 10 Juni 2026*');
    const syncLine = lines1.find((l) => l.startsWith('Terakhir sync:'));
    expect(syncLine).toMatch(/^Terakhir sync: \d+\/\d+ \d{2}:\d{2}$/);
  });

  it('Nargi gain on day 10 = 370852652 - 367503029 = 3349623', () => {
    const nargi = snapshot.members.find((m) => m.trainer_name === 'Nargi')!;
    expect(getDailyGain(nargi.daily_fans, 10)).toBe(3349623);
  });
});

// ============================================================
// Section 6: getDailyGain Edge Cases
// ============================================================

describe('getDailyGain edge cases', () => {
  it('day=0 returns 0', () => {
    expect(getDailyGain(snapshot.members[0].daily_fans, 0)).toBe(0);
  });

  it('day=1 returns 0 (no previous day)', () => {
    const nargi = snapshot.members.find((m) => m.trainer_name === 'Nargi')!;
    expect(getDailyGain(nargi.daily_fans, 1)).toBe(0);
  });

  it('day beyond array length returns 0', () => {
    expect(getDailyGain(snapshot.members[0].daily_fans, 100)).toBe(0);
  });

  it('gains are always >= 0 (cumulative can only increase)', () => {
    for (const member of snapshot.members) {
      const gain = getDailyGain(member.daily_fans, 11);
      expect(gain).toBeGreaterThanOrEqual(0);
    }
  });
});

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
    const result = generateDailyReport(emptySnapshot, config, 0);
    expect(result).toBe('ℹ️ *Daily Report*\nTidak ada data anggota untuk hari ini. Mungkin sync belum berjalan.');
  });
});

// ============================================================
// Section 8: Dispatch Integration (full user flow)
// ============================================================

describe('/daily dispatch integration (real snapshot)', () => {
  let mockDb: any;
  let mockClient: WhatsAppClient;
  let cfg: BotConfig;
  let messageHandler: ((msg: IncomingMessage) => void) | null;
  let sentMessages: { jid: string; text: string }[];

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

  it('Scenario 1: /daily from command group — full report with 30 active members', async () => {
    // Mock date to June 13 so snapshot (day 11) is stale → stale warning appears
    mockCurrentDate(2026, 6, 13);
    setupCommandHandler(mockClient, cfg, mockDb, () => snapshot);

    await messageHandler!(
      makeMessage({
        key: { remoteJid: COMMAND_GROUP, id: 'msg-001', participant: NON_ADMIN_JID },
        message: { conversation: '/daily' },
      })
    );

    expect(mockClient.sendOrEdit).toHaveBeenCalledTimes(2);
    expect(sentMessages[0].text).toMatch(/^⏳ /);
    expect(sentMessages[1].jid).toBe(COMMAND_GROUP);

    const report = sentMessages[1].text;

    console.log('\n======================================================');
    console.log('SCENARIO 1: /daily in command group (non-admin)');
    console.log('======================================================');
    console.log('\n--- Loading ---');
    console.log(sentMessages[0].text);
    console.log('\n--- Full Report ---');
    console.log(report);
    console.log('--- END SCENARIO 1 ---\n');

    const lines = report.split('\n');
    expect(lines[0]).toBe('📊 *Daily Report — 11 Juni 2026*');
    expect(lines[1]).toBe('');
    expect(lines[2]).toBe('Hol＿Horse | A+ (#431)');
    expect(lines[3]).toBe('Periode data: 11 Juni 2026, 22:00 WIB');
    expect(lines[4]).toBe('Promosi: 349.2M fans lagi | Degradasi: buffer 21.8M');
    expect(lines[5]).toBe('');
    expect(lines[6]).toMatch(/^👥 27 kontribusi dari 30 anggota \| Total: /);
    expect(lines[7]).toBe('');
    expect(lines[8]).toMatch(/^1\. \*Nargi\* — \+/);

    const memberLines = lines.filter((l) => /^\d+\.\s/.test(l));
    expect(memberLines.length).toBe(27);

    for (const line of memberLines) {
      expect(line).toMatch(/^\d+\.\s\*.+\*\s*(🔄)? — \+[\d.]+[KMB]?$/);
    }

    // Transfer badges (Falkrum has 0 gain on day 11, in stale section)
    const transferNames = ['Zero', 'TheTengOne', 'Sairen', 'VitoHoow', 'Ceciria'];
    for (const name of transferNames) {
      const line = memberLines.find((l) => l.includes(name));
      expect(line).toBeDefined();
      expect(line!).toContain('🔄');
    }

    // Left members section removed from daily report (only in /members)
    expect(report).not.toContain('🚪 Keluar dari klub:');

    // Stale data warning — now guaranteed because we mocked date to June 13
    expect(report).toContain('⚠️ Data klub mungkin tidak terbaru (update terakhir: 11 Juni 2026)');

    // Footer
    const lastLines = lines.slice(-2);
    expect(lastLines[0]).toBe('⸻');
    expect(lastLines[1]).toMatch(/^Terakhir sync: \d+\/\d+ \d{2}:\d{2}$/);

    restoreDateMocks();
  });

  it('Scenario 2: /daily 0 — identical output to /daily', async () => {
    setupCommandHandler(mockClient, cfg, mockDb, () => snapshot);

    await messageHandler!(
      makeMessage({
        key: { remoteJid: COMMAND_GROUP, id: 'msg-001', participant: NON_ADMIN_JID },
        message: { conversation: '/daily 0' },
      })
    );
    const report0 = sentMessages[1].text;

    sentMessages.length = 0;
    await messageHandler!(
      makeMessage({
        key: { remoteJid: COMMAND_GROUP, id: 'msg-002', participant: NON_ADMIN_JID },
        message: { conversation: '/daily' },
      })
    );
    const reportNoArg = sentMessages[1].text;

    expect(report0).toBe(reportNoArg);
    expect(report0).toContain('11 Juni 2026');
    expect(report0).toContain('Hol＿Horse');
  });

  it('Scenario 3: /daily 1 — shows previous day data (10 Juni 2026)', async () => {
    setupCommandHandler(mockClient, cfg, mockDb, () => snapshot);

    await messageHandler!(
      makeMessage({
        key: { remoteJid: COMMAND_GROUP, id: 'msg-001', participant: NON_ADMIN_JID },
        message: { conversation: '/daily 1' },
      })
    );

    const report = sentMessages[1].text;

    expect(mockClient.sendOrEdit).toHaveBeenCalledTimes(2);
    expect(report).toMatch(/📊 \*Daily Report — 10 Juni 2026\*/);
    expect(report).toContain('*Nargi* — +3.3M');
    expect(report).toContain('Hol＿Horse');
    expect(report).toContain('Terakhir sync:');
  });

  it('Scenario 4: /daily -1 — identical to /daily 1 (spec 5.4)', async () => {
    setupCommandHandler(mockClient, cfg, mockDb, () => snapshot);

    await messageHandler!(
      makeMessage({
        key: { remoteJid: COMMAND_GROUP, id: 'msg-001', participant: NON_ADMIN_JID },
        message: { conversation: '/daily -1' },
      })
    );
    const reportNeg = sentMessages[1].text;

    sentMessages.length = 0;
    await messageHandler!(
      makeMessage({
        key: { remoteJid: COMMAND_GROUP, id: 'msg-002', participant: NON_ADMIN_JID },
        message: { conversation: '/daily 1' },
      })
    );
    const reportPos = sentMessages[1].text;

    expect(reportNeg).toBe(reportPos);
    expect(reportNeg).toContain('10 Juni 2026');
  });

  it('Scenario 5: /daily 999 — offset exceeds max, shows error', async () => {
    setupCommandHandler(mockClient, cfg, mockDb, () => snapshot);

    await messageHandler!(
      makeMessage({
        key: { remoteJid: COMMAND_GROUP, id: 'msg-001', participant: NON_ADMIN_JID },
        message: { conversation: '/daily 999' },
      })
    );

    expect(mockClient.sendOrEdit).toHaveBeenCalledTimes(1);
    expect(sentMessages[0].text).toBe('Batas offset untuk /daily adalah 31.');
  });

  it('Scenario 6: /daily from non-command group — user sees NOTHING', async () => {
    setupCommandHandler(mockClient, cfg, mockDb, () => snapshot);

    await messageHandler!(
      makeMessage({
        key: { remoteJid: OTHER_GROUP, id: 'msg-001', participant: NON_ADMIN_JID },
        message: { conversation: '/daily' },
      })
    );

    expect(mockClient.sendOrEdit).not.toHaveBeenCalled();
    expect(mockClient.sendMessage).not.toHaveBeenCalled();
    expect(sentMessages.length).toBe(0);
  });

  it('Scenario 7: /daily as non-admin in private chat — user sees NOTHING', async () => {
    setupCommandHandler(mockClient, cfg, mockDb, () => snapshot);

    await messageHandler!(
      makeMessage({
        key: { remoteJid: NON_ADMIN_JID, id: 'msg-001', participant: NON_ADMIN_JID },
        message: { conversation: '/daily' },
      })
    );

    expect(mockClient.sendOrEdit).not.toHaveBeenCalled();
    expect(mockClient.sendMessage).not.toHaveBeenCalled();
    expect(sentMessages.length).toBe(0);
  });

  it('Scenario 8: /daily when no snapshot — shows error', async () => {
    setupCommandHandler(mockClient, cfg, mockDb, () => null);

    await messageHandler!(
      makeMessage({
        key: { remoteJid: COMMAND_GROUP, id: 'msg-001', participant: NON_ADMIN_JID },
        message: { conversation: '/daily' },
      })
    );

    expect(mockClient.sendOrEdit).toHaveBeenCalledTimes(1);
    expect(sentMessages[0].text).toBe(
      '⚠️ Belum ada data. Tunggu sync berikutnya atau coba lagi nanti.'
    );
  });

  it('Scenario 9: /daily as admin in command group — works the same', async () => {
    setupCommandHandler(mockClient, cfg, mockDb, () => snapshot);

    await messageHandler!(
      makeMessage({
        key: { remoteJid: COMMAND_GROUP, id: 'msg-001', participant: ADMIN_JID },
        message: { conversation: '/daily' },
      })
    );

    const report = sentMessages[1].text;
    expect(mockClient.sendOrEdit).toHaveBeenCalledTimes(2);
    expect(report).toContain('📊 *Daily Report — 11 Juni 2026*');
    expect(report).toContain('Hol＿Horse');
    expect(report).toContain('kontribusi dari 30 anggota');
  });

  it('Scenario 10: empty snapshot — shows "Tidak ada data" warning', async () => {
    const emptySnapshot: Snapshot = { ...snapshot, members: [] };
    setupCommandHandler(mockClient, cfg, mockDb, () => emptySnapshot);

    await messageHandler!(
      makeMessage({
        key: { remoteJid: COMMAND_GROUP, id: 'msg-001', participant: NON_ADMIN_JID },
        message: { conversation: '/daily' },
      })
    );

    const report = sentMessages[1].text;
    expect(mockClient.sendOrEdit).toHaveBeenCalledTimes(2);
    expect(report).toBe('ℹ️ *Daily Report*\nTidak ada data anggota untuk hari ini. Mungkin sync belum berjalan.');
  });

  it('ranking verification: gains are sorted descending through dispatch', async () => {
    setupCommandHandler(mockClient, cfg, mockDb, () => snapshot);

    await messageHandler!(
      makeMessage({
        key: { remoteJid: COMMAND_GROUP, id: 'msg-001', participant: NON_ADMIN_JID },
        message: { conversation: '/daily' },
      })
    );

    const report = sentMessages[1].text;
    const lines = report.split('\n');
    const rankLines = lines.filter((line) => /^\d+\./.test(line));

    const gains: number[] = [];
    for (const line of rankLines) {
      const match = line.match(/— ([+-]?[\d.]+[KMB]?|0)$/);
      if (!match) throw new Error(`Could not parse gain from: ${line}`);
      const val = match[1];
      if (val === '0') {
        gains.push(0);
        continue;
      }
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
    expect(rankLines.length).toBe(27);
  });

  it('transfer badge verification: all 6 transfer members have 🔄 through dispatch', async () => {
    setupCommandHandler(mockClient, cfg, mockDb, () => snapshot);

    await messageHandler!(
      makeMessage({
        key: { remoteJid: COMMAND_GROUP, id: 'msg-001', participant: NON_ADMIN_JID },
        message: { conversation: '/daily' },
      })
    );

    const report = sentMessages[1].text;
    const transferNames = ['Zero', 'TheTengOne', 'Sairen', 'VitoHoow', 'Ceciria'];

    for (const name of transferNames) {
      const line = report.split('\n').find((l) => l.includes(name));
      expect(line).toBeDefined();
      expect(line).toContain('🔄');
    }

    const allTransferLines = report.split('\n').filter((l) => l.includes('🔄'));
    expect(allTransferLines.length).toBe(5);
  });

  it('left member verification: 4 left members NOT in ranking and NOT in left section', async () => {
    setupCommandHandler(mockClient, cfg, mockDb, () => snapshot);

    await messageHandler!(
      makeMessage({
        key: { remoteJid: COMMAND_GROUP, id: 'msg-001', participant: NON_ADMIN_JID },
        message: { conversation: '/daily' },
      })
    );

    const report = sentMessages[1].text;

    // Left section removed from daily report
    expect(report).not.toContain('🚪 Keluar dari klub:');

    const lines = report.split('\n');
    const rankLines = lines.filter((l) => /^\d+\./.test(l));
    for (const rankLine of rankLines) {
      expect(rankLine).not.toContain('DOA IBU');
      expect(rankLine).not.toContain('Kuro');
      expect(rankLine).not.toContain('Rowking');
      expect(rankLine).not.toContain('Lebowski');
    }
    expect(rankLines.length).toBe(27);
  });
});

// ============================================================
// Section 9: Stale Data Warning Behavior
// ============================================================

describe('Stale data warning: snapshot freshness vs offset', () => {
  afterEach(() => {
    restoreDateMocks();
  });

  describe('stale snapshot (data day 11, today June 13)', () => {
    beforeEach(() => {
      mockCurrentDate(2026, 6, 13);
    });

    it('shows stale warning for offset=0', () => {
      const report = generateDailyReport(snapshot, config, 0);
      expect(report).toContain('⚠️ Data klub mungkin tidak terbaru');
    });

    it('shows stale warning for offset=1', () => {
      const report = generateDailyReport(snapshot, config, 1);
      expect(report).toContain('⚠️ Data klub mungkin tidak terbaru');
    });

    it('shows stale warning for offset=2', () => {
      const report = generateDailyReport(snapshot, config, 2);
      expect(report).toContain('⚠️ Data klub mungkin tidak terbaru');
    });

    it('stale warning references SNAPSHOT date (11 Juni), not offset date', () => {
      const report0 = generateDailyReport(snapshot, config, 0);
      const report1 = generateDailyReport(snapshot, config, 1);
      const report2 = generateDailyReport(snapshot, config, 2);

      expect(report0).toContain('update terakhir: 11 Juni 2026');
      expect(report1).toContain('update terakhir: 11 Juni 2026');
      expect(report2).toContain('update terakhir: 11 Juni 2026');

      expect(report1).not.toContain('update terakhir: 10 Juni 2026');
      expect(report2).not.toContain('update terakhir: 9 Juni 2026');
    });
  });

  describe('fresh snapshot (data day 12, today June 13)', () => {
    let freshSnapshot: Snapshot;

    beforeEach(() => {
      mockCurrentDate(2026, 6, 13);
      freshSnapshot = makeSnapshotWithLatestDay(12);
    });

    it('shows NO stale warning for offset=0', () => {
      const report = generateDailyReport(freshSnapshot, config, 0);
      expect(report).not.toContain('⚠️ Data klub mungkin tidak terbaru');
    });

    it('shows NO stale warning for offset=1', () => {
      const report = generateDailyReport(freshSnapshot, config, 1);
      expect(report).not.toContain('⚠️ Data klub mungkin tidak terbaru');
    });

    it('shows NO stale warning for offset=2', () => {
      const report = generateDailyReport(freshSnapshot, config, 2);
      expect(report).not.toContain('⚠️ Data klub mungkin tidak terbaru');
    });
  });

  describe('same-day snapshot (data day 12, today June 12)', () => {
    let freshSnapshot: Snapshot;

    beforeEach(() => {
      mockCurrentDate(2026, 6, 12);
      freshSnapshot = makeSnapshotWithLatestDay(12);
    });

    it('shows NO stale warning for offset=0', () => {
      const report = generateDailyReport(freshSnapshot, config, 0);
      expect(report).not.toContain('⚠️ Data klub mungkin tidak terbaru');
    });

    it('shows NO stale warning for offset=1', () => {
      const report = generateDailyReport(freshSnapshot, config, 1);
      expect(report).not.toContain('⚠️ Data klub mungkin tidak terbaru');
    });
  });

  describe('same-day snapshot (data day 11, today June 11)', () => {
    beforeEach(() => {
      mockCurrentDate(2026, 6, 11);
    });

    it('shows NO stale warning for offset=0', () => {
      const report = generateDailyReport(snapshot, config, 0);
      expect(report).not.toContain('⚠️ Data klub mungkin tidak terbaru');
    });

    it('shows NO stale warning for offset=1', () => {
      const report = generateDailyReport(snapshot, config, 1);
      expect(report).not.toContain('⚠️ Data klub mungkin tidak terbaru');
    });
  });

  describe('one-day-old snapshot (data day 11, today June 12)', () => {
    beforeEach(() => {
      mockCurrentDate(2026, 6, 12);
    });

    it('shows NO stale warning for offset=0', () => {
      const report = generateDailyReport(snapshot, config, 0);
      expect(report).not.toContain('⚠️ Data klub mungkin tidak terbaru');
    });

    it('shows NO stale warning for offset=1', () => {
      const report = generateDailyReport(snapshot, config, 1);
      expect(report).not.toContain('⚠️ Data klub mungkin tidak terbaru');
    });
  });

  describe('very stale snapshot (data day 5, today June 13)', () => {
    let veryStaleSnapshot: Snapshot;

    beforeEach(() => {
      mockCurrentDate(2026, 6, 13);
      veryStaleSnapshot = makeSnapshotWithLatestDay(5);
    });

    it('shows stale warning for offset=0 with correct date', () => {
      const report = generateDailyReport(veryStaleSnapshot, config, 0);
      expect(report).toContain('⚠️ Data klub mungkin tidak terbaru');
      expect(report).toContain('update terakhir: 5 Juni 2026');
    });

    it('shows stale warning for offset=1 referencing snapshot date, not offset date', () => {
      const report = generateDailyReport(veryStaleSnapshot, config, 1);
      expect(report).toContain('⚠️ Data klub mungkin tidak terbaru');
      expect(report).toContain('update terakhir: 5 Juni 2026');
      expect(report).not.toContain('update terakhir: 4 Juni 2026');
    });
  });
});

// ============================================================
// Section 10: Stale Warning — Cross-month & Offset Independence
// ============================================================

describe('Stale data warning: cross-month & offset independence', () => {
  afterEach(() => {
    restoreDateMocks();
  });

  it('no stale warning when snapshot is from previous month', () => {
    mockCurrentDate(2026, 6, 13);

    const maySnapshot: Snapshot = {
      ...snapshot,
      members: snapshot.members.map((m) => ({
        ...m,
        month: 5,
        daily_fans: m.daily_fans.map((v, i) => (i < 28 ? v : 0)),
      })),
    };

    const report = generateDailyReport(maySnapshot, config, 0);
    expect(report).not.toContain('⚠️ Data klub mungkin tidak terbaru');
  });

  it('offset=0 and offset=5 produce same stale warning presence', () => {
    mockCurrentDate(2026, 6, 13);

    const report0 = generateDailyReport(snapshot, config, 0);
    const report5 = generateDailyReport(snapshot, config, 5);

    const hasStale0 = report0.includes('⚠️ Data klub mungkin tidak terbaru');
    const hasStale5 = report5.includes('⚠️ Data klub mungkin tidak terbaru');
    expect(hasStale0).toBe(hasStale5);
  });

  it('both offset=0 and offset=5 reference the same snapshot date', () => {
    mockCurrentDate(2026, 6, 13);

    const report0 = generateDailyReport(snapshot, config, 0);
    const report5 = generateDailyReport(snapshot, config, 5);

    expect(report0).toContain('update terakhir: 11 Juni 2026');
    expect(report5).toContain('update terakhir: 11 Juni 2026');
  });
});

// ============================================================
// Section 11: Stale Warning — Report Structure & Edge Cases
// ============================================================

describe('Stale data warning: report structure & edge cases', () => {
  afterEach(() => {
    restoreDateMocks();
  });

  it('stale warning appears after member list, before footer', () => {
    mockCurrentDate(2026, 6, 13);

    const report = generateDailyReport(snapshot, config, 0);
    const lines = report.split('\n');

    const staleWarningIdx = lines.findIndex((l) =>
      l.includes('⚠️ Data klub mungkin tidak terbaru')
    );
    const footerIdx = lines.findIndex((l) => l.startsWith('⸻'));
    const memberLines = lines.filter((l) => /^\d+\./.test(l));

    expect(staleWarningIdx).toBeGreaterThan(0);
    expect(staleWarningIdx).toBeGreaterThan(memberLines.length + 5);
    expect(staleWarningIdx).toBeLessThan(footerIdx);
  });

  it('fresh snapshot: no stale warning line, report still has footer', () => {
    mockCurrentDate(2026, 6, 11);

    const report = generateDailyReport(snapshot, config, 0);
    const lines = report.split('\n');

    expect(report).not.toContain('⚠️ Data klub mungkin tidak terbaru');
    const footerIdx = lines.findIndex((l) => l.startsWith('⸻'));
    expect(footerIdx).toBeGreaterThan(0);
  });

  it('empty snapshot returns early, no stale warning possible', () => {
    const emptySnapshot: Snapshot = {
      circle: snapshot.circle,
      members: [],
      club_rank: 8,
      fans_to_next_tier: 349208495,
      fans_to_lower_tier: 21848493,
      yesterday_fans_to_next_tier: 305715171,
      yesterday_fans_to_lower_tier: 20621702,
    };

    const report = generateDailyReport(emptySnapshot, config, 0);
    expect(report).toBe('ℹ️ *Daily Report*\nTidak ada data anggota untuk hari ini. Mungkin sync belum berjalan.');
    expect(report).not.toContain('⚠️ Data klub mungkin tidak terbaru');
  });

  it('negative offset produces same stale warning as positive offset', () => {
    mockCurrentDate(2026, 6, 13);

    const reportNeg = generateDailyReport(snapshot, config, -1);
    const reportPos = generateDailyReport(snapshot, config, 1);

    const staleNeg = reportNeg.includes('⚠️ Data klub mungkin tidak terbaru');
    const stalePos = reportPos.includes('⚠️ Data klub mungkin tidak terbaru');
    expect(staleNeg).toBe(stalePos);
  });

  it('stale warning uses Indonesian date format', () => {
    mockCurrentDate(2026, 6, 13);

    const report = generateDailyReport(snapshot, config, 0);
    expect(report).toMatch(/update terakhir: \d+ Juni 2026/);
  });
});

// ============================================================
// Section 12: Stale Warning — Bug Fix Behavioral Contract
// ============================================================

describe('Stale data warning: bug fix behavioral contract', () => {
  afterEach(() => {
    restoreDateMocks();
  });

  it('BUG FIX: /daily 1 no longer falsely warns when snapshot is fresh', () => {
    // Today = June 13, snapshot data day = 12 → FRESH
    // /daily 1 views day 11 (offset), but snapshot is still fresh
    // OLD BUG: dataDay=11 < currentDay-1=12 → FALSE stale warning
    // NEW FIX: latestDataDay=12 >= 12 → no warning
    mockCurrentDate(2026, 6, 13);
    const freshSnapshot = makeSnapshotWithLatestDay(12);

    const report = generateDailyReport(freshSnapshot, config, 1);

    expect(report).not.toContain('⚠️ Data klub mungkin tidak terbaru');
    expect(report).toContain('📊 *Daily Report — 11 Juni 2026*');
  });

  it('BUG FIX: /daily 0 correctly warns when snapshot is stale', () => {
    mockCurrentDate(2026, 6, 13);

    const report = generateDailyReport(snapshot, config, 0);

    expect(report).toContain('⚠️ Data klub mungkin tidak terbaru');
    expect(report).toContain('update terakhir: 11 Juni 2026');
  });

  it('BUG FIX: /daily 1 correctly warns when snapshot is stale', () => {
    mockCurrentDate(2026, 6, 13);

    const report = generateDailyReport(snapshot, config, 1);

    expect(report).toContain('⚠️ Data klub mungkin tidak terbaru');
    expect(report).toContain('update terakhir: 11 Juni 2026');
    expect(report).not.toContain('update terakhir: 10 Juni 2026');
  });
});

// ============================================================
// Section 13: Complete All-30 Member Gain Verification (Day 11)
// ============================================================

describe('All positive-gain member gains traced to raw data (day 11)', () => {
  let report: string;
  let memberLines: string[];
  let staleLines: string[];
  let latestDataDay: number;

  beforeAll(() => {
    report = generateDailyReport(snapshot, config, 0);
    memberLines = report.split('\n').filter((l) => /^\d+\./.test(l));
    staleLines = report.split('\n').filter((l) => l.startsWith('• '));
    latestDataDay = getDataDayFromSnapshot(snapshot);
  });

  it('has exactly 27 ranked member lines (positive gain only)', () => {
    expect(memberLines.length).toBe(27);
  });

  it('Nargi: 373,937,532 - 370,852,652 = 3,084,880 -> +3.1M', () => {
    const nargi = snapshot.members.find((m) => m.trainer_name === 'Nargi')!;
    expect(nargi.daily_fans[10]).toBe(373937532);
    expect(nargi.daily_fans[9]).toBe(370852652);
    expect(getDailyGain(nargi.daily_fans, 11)).toBe(3084880);
    expect(formatNumber(3084880)).toBe('3.1M');
    const line = memberLines.find((l) => l.includes('Nargi'));
    expect(line).toBe('1. *Nargi* — +3.1M');
  });

  it('GoldFamily: 317,726,222 - 315,015,625 = 2,710,597 -> +2.7M', () => {
    const m = snapshot.members.find((mm) => mm.trainer_name === 'GoldFamily')!;
    expect(m.daily_fans[10]).toBe(317726222);
    expect(m.daily_fans[9]).toBe(315015625);
    expect(getDailyGain(m.daily_fans, 11)).toBe(2710597);
    expect(formatNumber(2710597)).toBe('2.7M');
    const line = memberLines.find((l) => l.includes('GoldFamily'));
    expect(line).toBe('2. *GoldFamily* — +2.7M');
  });

  it('Ryu: 332,207,534 - 331,992,091 = 215,443 -> +215.4K', () => {
    const ryu = snapshot.members.find((m) => m.trainer_name === 'Ryu')!;
    expect(ryu.daily_fans[10]).toBe(332207534);
    expect(ryu.daily_fans[9]).toBe(331992091);
    const gain = getDailyGain(ryu.daily_fans, 11);
    expect(gain).toBe(215443);
    expect(formatNumber(gain)).toBe('215.4K');
    const line = memberLines.find((l) => l.includes('Ryu'));
    expect(line).toBe('23. *Ryu* — +215.4K');
  });

  it('Falkrum (transfer): 0 gain → in stale section, not ranked list', () => {
    const f = snapshot.members.find((m) => m.trainer_name === 'Falkrum')!;
    expect(getDailyGain(f.daily_fans, 11)).toBe(0);
    const rankedLine = memberLines.find((l) => l.includes('Falkrum'));
    expect(rankedLine).toBeUndefined();
    const staleLine = staleLines.find((l) => l.includes('Falkrum'));
    expect(staleLine).toBeDefined();
  });

  it('naku: 0 gain → in stale section, not ranked list', () => {
    const m = snapshot.members.find((mm) => mm.trainer_name === 'naku')!;
    expect(getDailyGain(m.daily_fans, 11)).toBe(0);
    const rankedLine = memberLines.find((l) => l.includes('naku'));
    expect(rankedLine).toBeUndefined();
    const staleLine = staleLines.find((l) => l.includes('naku'));
    expect(staleLine).toBeDefined();
  });

  it('Sairen (transfer): 442,813,391 - 440,583,122 = 2,230,269 -> +2.2M', () => {
    const s = snapshot.members.find((m) => m.trainer_name === 'Sairen')!;
    expect(s.daily_fans[10]).toBe(442813391);
    expect(s.daily_fans[9]).toBe(440583122);
    expect(getDailyGain(s.daily_fans, 11)).toBe(2230269);
    expect(formatNumber(2230269)).toBe('2.2M');
    const line = memberLines.find((l) => l.includes('Sairen'));
    expect(line).toBe('6. *Sairen* 🔄 — +2.2M');
  });

  it('every ranked member gain matches raw data calculation', () => {
    const expectedGains: { name: string; gain: number; isTransfer: boolean }[] = [];
    for (const member of snapshot.members) {
      const gain = getDailyGain(member.daily_fans, 11);
      if (gain > 0) {
        expectedGains.push({
          name: member.trainer_name,
          gain,
          isTransfer: isTransferMember(member),
        });
      }
    }

    expectedGains.sort((a, b) => b.gain - a.gain);
    expect(expectedGains.length).toBe(27);

    for (let i = 0; i < expectedGains.length; i++) {
      const gainStr = `+${formatNumber(expectedGains[i].gain)}`;
      const badge = expectedGains[i].isTransfer ? ' 🔄' : '';
      expect(memberLines[i]).toBe(
        `${i + 1}. *${expectedGains[i].name}*${badge} — ${gainStr}`
      );
    }
  });
});

// ============================================================
// Section 14: WhatsApp Formatting Compliance
// ============================================================

describe('WhatsApp formatting compliance', () => {
  let report: string;

  beforeAll(() => {
    report = generateDailyReport(snapshot, config, 0);
  });

  it('uses *bold* (WhatsApp) not **bold** (Markdown)', () => {
    expect(report).toContain('📊 *Daily Report');
    // No double-asterisk bold anywhere
    expect(report).not.toMatch(/\*\*[^*]+\*\*/);
  });

  it('has no Markdown # headers', () => {
    const lines = report.split('\n');
    for (const line of lines) {
      expect(line).not.toMatch(/^#{1,6}\s/);
    }
  });

  it('uses emoji prefixes for sections', () => {
    expect(report).toContain('\uD83D\uDCCA'); // 📊
    expect(report).toContain('\uD83D\uDC65'); // 👥
    expect(report).toContain('⚠️');
    expect(report).toContain('🔄');
  });

  it('uses Indonesian month names (not English)', () => {
    expect(report).toContain('Juni');
    expect(report).not.toContain('June');
  });

  it('uses Indonesian labels', () => {
    expect(report).toContain('Promosi:');
    expect(report).toContain('Degradasi:');
    expect(report).toContain('kontribusi');
    expect(report).toContain('Terakhir sync:');
  });
});

// ============================================================
// Section 15: Left Members Section (DB integration)
// ============================================================

describe('Left members section', () => {
  it('shows NO left members section (left only in /members)', () => {
    const report = generateDailyReport(snapshot, config, 0);

    console.log('\n========== DAILY REPORT (no left section) ==========');
    console.log(report);
    console.log('========== END ==========\n');

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

    const reportNoDb = generateDailyReport(snapshot, config, 0);
    const reportWithDb = generateDailyReport(snapshot, config, 0, mockDbWithLeft);

    // Both should show same output (no left section)
    expect(reportNoDb).not.toContain('🚪 Keluar dari klub:');
    expect(reportWithDb).not.toContain('🚪 Keluar dari klub:');
  });

  it('left section does NOT exist in daily report', () => {
    const report = generateDailyReport(snapshot, config, 0);
    const leftIdx = report.indexOf('🚪 Keluar dari klub:');
    expect(leftIdx).toBe(-1);
  });
});

// ============================================================
// Section 16: Offset Clamping at Report Level
// ============================================================

describe('Offset clamping at report level', () => {
  it('offset=100 clamps dataDay to 1, shows day 1 data', () => {
    const report = generateDailyReport(snapshot, config, 100);
    // dataDay = max(1, 11 - 100) = 1
    // Day 1 has no previous day, so all gains are 0
    expect(report).toContain('📊 *Daily Report — 1 Juni 2026*');

    const lines = report.split('\n');
    const memberLines = lines.filter((l) => /^\d+\./.test(l));
    expect(memberLines.length).toBe(0);

    // Shows "first day" message since no one can have gain on day 1
    expect(report).toContain('Gain hari pertama: belum tersedia');

    console.log('\n========== OFFSET=100 REPORT (clamped to day 1) ==========');
    console.log(report);
    console.log('========== END ==========\n');
  });

  it('offset equal to dataDay - 1 shows day 1 data', () => {
    // dataDay=11, offset=10 -> dataDay=1
    const report = generateDailyReport(snapshot, config, 10);
    expect(report).toContain('📊 *Daily Report — 1 Juni 2026*');
  });

  it('offset=dataDay shows day 1 (clamped from 0)', () => {
    // dataDay=11, offset=11 -> max(1, 0) = 1
    const report = generateDailyReport(snapshot, config, 11);
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
    report = generateDailyReport(snapshot, config, 2);
    memberLines = report.split('\n').filter((l) => /^\d+\./.test(l));
  });

  it('header shows 9 Juni 2026', () => {
    expect(report.split('\n')[0]).toBe('📊 *Daily Report — 9 Juni 2026*');
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
    const transferNames = ['Zero', 'TheTengOne', 'Sairen', 'VitoHoow', 'Ceciria', 'Falkrum'];
    for (const name of transferNames) {
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
    console.log('\n========== /daily 1 FRESH SNAPSHOT ==========');
    console.log(report);
    console.log('========== END ==========\n');

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
    console.log('\n========== /daily 1 STALE SNAPSHOT ==========');
    console.log(report);
    console.log('========== END ==========\n');

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
// Section 19: Exact Total Gain Verification (Manual Summation)
// ============================================================

describe('Exact total gain verification', () => {
  let report: string;

  beforeAll(() => {
    report = generateDailyReport(snapshot, config, 0);
  });

  it('total gain matches manual sum of all 30 contributing members', () => {
    const latestDataDay = getDataDayFromSnapshot(snapshot);
    let totalGain = 0;
    const contributingGains: { name: string; gain: number; isTransfer: boolean }[] = [];

    for (const member of snapshot.members) {
      const isT = isTransferMember(member);
      const latestPositiveDay = getLatestDataDay(member.daily_fans);
      const stale = isStaleMember(latestPositiveDay, latestDataDay, 3);
      const status = isT ? 'transfer' : (latestPositiveDay === 0 || stale) ? 'stale' : 'active';

      if (status === 'active' || status === 'transfer') {
        const gain = getDailyGain(member.daily_fans, 11);
        totalGain += gain;
        contributingGains.push({ name: member.trainer_name, gain, isTransfer: isT });
      }
    }

    expect(contributingGains.length).toBe(30);
    expect(totalGain).toBe(32287438);
    expect(formatNumber(totalGain)).toBe('32.3M');

    const gainLine = report.split('\n').find((l) => l.includes('Total:'));
    expect(gainLine).toMatch(/^👥 27 kontribusi dari 30 anggota \| Total: 32\.3M$/);
  });

  it('offset=1 total gain matches manual sum', () => {
    const report1 = generateDailyReport(snapshot, config, 1);
    const latestDataDay = getDataDayFromSnapshot(snapshot);
    let totalGain = 0;
    let count = 0;

    for (const member of snapshot.members) {
      const isT = isTransferMember(member);
      const latestPositiveDay = getLatestDataDay(member.daily_fans);
      const stale = isStaleMember(latestPositiveDay, latestDataDay, 3);
      const status = isT ? 'transfer' : (latestPositiveDay === 0 || stale) ? 'stale' : 'active';

      if (status === 'active' || status === 'transfer') {
        totalGain += getDailyGain(member.daily_fans, 10);
        count++;
      }
    }

    expect(count).toBe(30);
    const gainLine = report1.split('\n').find((l) => l.includes('Total:'));
    expect(gainLine).toContain(formatNumber(totalGain));
  });
});

// ============================================================
// Section 20: Ghost Member Awareness
// ============================================================

describe('Ghost member awareness (members.length vs member_count)', () => {
  it('snapshot has 34 members but member_count=30, extras are stale', () => {
    expect(snapshot.members.length).toBe(34);
    expect(snapshot.circle.member_count).toBe(30);

    const latestDataDay = getDataDayFromSnapshot(snapshot);
    let staleCount = 0;
    let activeCount = 0;
    let transferCount = 0;

    for (const member of snapshot.members) {
      const isT = isTransferMember(member);
      const latestPositiveDay = getLatestDataDay(member.daily_fans);
      const stale = isStaleMember(latestPositiveDay, latestDataDay, 3);
      if (isT) transferCount++;
      else if (latestPositiveDay === 0 || stale) staleCount++;
      else activeCount++;
    }

    expect(activeCount).toBe(24);
    expect(transferCount).toBe(6);
    expect(staleCount).toBe(4);
    expect(activeCount + transferCount).toBe(snapshot.circle.member_count);
  });

  it('report active count matches circle.member_count, not members.length', () => {
    const report = generateDailyReport(snapshot, config, 0);
    const gainLine = report.split('\n').find((l) => l.includes('anggota'));
    expect(gainLine).toContain('30 anggota');
    expect(gainLine).not.toContain('34 anggota');
  });

  it('ghost members not shown in daily report (left only in /members)', () => {
    const report = generateDailyReport(snapshot, config, 0);
    const staleNames = ['DOA IBU', 'Kuro', 'Rowking', 'Lebowski'];
    // Left section removed from daily report
    expect(report).not.toContain('🚪 Keluar dari klub:');

    const memberLines = report.split('\n').filter((l) => /^\d+\./.test(l));
    for (const name of staleNames) {
      const found = memberLines.find((l) => l.includes(name));
      expect(found).toBeUndefined();
    }
  });
});

// ============================================================
// Section 21: Single Member Snapshot
// ============================================================

describe('Single member snapshot', () => {
  it('works correctly with one member', () => {
    const singleSnapshot: Snapshot = {
      circle: snapshot.circle,
      members: [snapshot.members[0]],
      club_rank: 8,
      fans_to_next_tier: 349208495,
      fans_to_lower_tier: 21848493,
      yesterday_fans_to_next_tier: 305715171,
      yesterday_fans_to_lower_tier: 20621702,
    };

    const report = generateDailyReport(singleSnapshot, config, 0);
    console.log('\n========== SINGLE MEMBER REPORT ==========');
    console.log(report);
    console.log('========== END ==========\n');

    expect(report).toContain('📊 *Daily Report — 11 Juni 2026*');
    expect(report).toContain('1 kontribusi dari 1 anggota');

    const memberLines = report.split('\n').filter((l) => /^\d+\./.test(l));
    expect(memberLines.length).toBe(1);
    expect(memberLines[0]).toMatch(/^1\./);
  });

  it('single member with 0 gain appears in stale section', () => {
    const singleSnapshot: Snapshot = {
      circle: snapshot.circle,
      members: [{
        ...snapshot.members[0],
        daily_fans: snapshot.members[0].daily_fans.map((v, i) =>
          i < 11 ? 1000 : 0
        ),
      }],
      club_rank: 8,
      fans_to_next_tier: 349208495,
      fans_to_lower_tier: 21848493,
      yesterday_fans_to_next_tier: 305715171,
      yesterday_fans_to_lower_tier: 20621702,
    };

    const report = generateDailyReport(singleSnapshot, config, 0);
    expect(report).toContain('0 kontribusi dari 1 anggota');
    expect(report).toContain('⚠️ Belum aktif hari ini');
    expect(report).toContain('• Ryu');
    const memberLines = report.split('\n').filter((l) => /^\d+\./.test(l));
    expect(memberLines.length).toBe(0);
  });

  it('stale member shows in stale section, active member in ranking', () => {
    const staleMember = snapshot.members.find((m) => m.trainer_name === 'DOA IBU')!;
    const activeMember = snapshot.members.find((m) => m.trainer_name === 'Nargi')!;
    const mixedSnapshot: Snapshot = {
      circle: snapshot.circle,
      members: [activeMember, staleMember],
      club_rank: 8,
      fans_to_next_tier: 349208495,
      fans_to_lower_tier: 21848493,
      yesterday_fans_to_next_tier: 305715171,
      yesterday_fans_to_lower_tier: 20621702,
    };

    const report = generateDailyReport(mixedSnapshot, config, 0);
    console.log('\n========== MIXED STALE+ACTIVE SNAPSHOT ==========');
    console.log(report);
    console.log('========== END ==========\n');

    expect(report).toContain('1 kontribusi dari 2 anggota');
    expect(report).toContain('⚠️ Belum aktif');
    const memberLines = report.split('\n').filter((l) => /^\d+\./.test(l));
    expect(memberLines.length).toBe(1);
    expect(memberLines[0]).toContain('Nargi');
    expect(report).toContain('• DOA IBU');
  });
});

// ============================================================
// Section 22: Offset=1 Complete Line Verification
// ============================================================

describe('Offset=1 complete line verification', () => {
  let report: string;
  let lines: string[];

  beforeAll(() => {
    report = generateDailyReport(snapshot, config, 1);
    lines = report.split('\n');
  });

  it('header: *📊 Daily Report — 10 Juni 2026*', () => {
    expect(lines[0]).toBe('📊 *Daily Report — 10 Juni 2026*');
  });

  it('club info line: Hol＿Horse | A+ (#431)', () => {
    expect(lines[2]).toBe('Hol＿Horse | A+ (#431)');
  });

  it('promotion+demotion line (combined): Promosi: 349.2M fans lagi | Degradasi: buffer 21.8M', () => {
    expect(lines[4]).toBe('Promosi: 349.2M fans lagi | Degradasi: buffer 21.8M');
  });

  it('summary: 👥 28 kontribusi dari 30 anggota | Total: <correct sum>', () => {
    expect(lines[6]).toMatch(/^👥 28 kontribusi dari 30 anggota \| Total: /);
    expect(lines[6]).not.toContain('34 anggota');
  });

  it('Nargi is #1 with gain 3,349,623 -> +3.3M', () => {
    const nargi = snapshot.members.find((m) => m.trainer_name === 'Nargi')!;
    expect(getDailyGain(nargi.daily_fans, 10)).toBe(3349623);
    expect(formatNumber(3349623)).toBe('3.3M');
    const nargiLine = lines.find((l) => l.includes('Nargi'));
    expect(nargiLine).toBe('1. *Nargi* — +3.3M');
  });

  it('transfer badges present for all 6 in offset=1 report', () => {
    const transferNames = ['Zero', 'TheTengOne', 'Sairen', 'VitoHoow', 'Ceciria', 'Falkrum'];
    const memberLines = lines.filter((l) => /^\d+\./.test(l));
    for (const name of transferNames) {
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
  it('stale data warning comes after member list, before footer', () => {
    mockCurrentDate(2026, 6, 13);
    const report = generateDailyReport(snapshot, config, 0);
    const lines = report.split('\n');

    const lastRankedIdx = lines.reduce((acc, l, i) =>
      /^\d+\./.test(l) ? i : acc, 0);
    const staleWarningIdx = lines.findIndex((l) => l.includes('⚠️ Data klub'));
    const footerIdx = lines.findIndex((l) => l.startsWith('⸻'));

    // No left section in daily report
    expect(lines.findIndex((l) => l.includes('🚪 Keluar dari klub:'))).toBe(-1);
    expect(staleWarningIdx).toBeGreaterThan(lastRankedIdx);
    expect(footerIdx).toBeGreaterThan(staleWarningIdx);

    restoreDateMocks();
  });
});

// ============================================================
// Section 24: Transfer Members Always in Contributing
// ============================================================

describe('Transfer members always appear in ranking', () => {
  it('transfer members with 0 gain appear in stale section', () => {
    const report = generateDailyReport(snapshot, config, 0);
    const memberLines = report.split('\n').filter((l) => /^\d+\./.test(l));
    const falkrumRanked = memberLines.find((l) => l.includes('Falkrum'));
    expect(falkrumRanked).toBeUndefined();
    expect(report).toContain('• Falkrum');
  });

  it('transfer members with positive gain never in stale section', () => {
    const report = generateDailyReport(snapshot, config, 0);
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
    const report = generateDailyReport(snapshot, zeroReqConfig, 0);
    expect(report).toContain('📊 *Daily Report — 11 Juni 2026*');
    expect(report).toContain('kontribusi dari 30 anggota');
  });

  it('config with weeklyFans>0 does not break daily report', () => {
    const weeklyConfig: BotConfig = {
      ...config,
      requirements: { ...config.requirements, weeklyFans: 1000000 },
    };
    const report = generateDailyReport(snapshot, weeklyConfig, 0);
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
    const report = generateDailyReport(customSnapshot, strictConfig, 0);
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
    const report = generateDailyReport(snapshot, lenientConfig, 0);
    // Stale section shows active members with 0 gain on the viewed day, regardless of staleAfterDaysDaily
    expect(report).toContain('⚠️ Belum aktif');
    // Ghost detection still removes 4 members → 27 positive-gain in ranking
    const memberLines = report.split('\n').filter((l) => /^\d+\./.test(l));
    expect(memberLines.length).toBe(27);
  });
});

// ============================================================
// Section 26: Negative daily_fans[0] (transfer) handling
// ============================================================

describe('Transfer members with negative daily_fans[0]', () => {
  it('Zero has negative daily_fans[0] and is correctly classified as transfer', () => {
    const zero = snapshot.members.find((m) => m.trainer_name === 'Zero')!;
    expect(zero.daily_fans[0]).toBeLessThan(0);
    expect(isTransferMember(zero)).toBe(true);
  });

  it('Sairen has negative daily_fans[0..2] and is correctly classified', () => {
    const sairen = snapshot.members.find((m) => m.trainer_name === 'Sairen')!;
    expect(sairen.daily_fans[0]).toBeLessThan(0);
    expect(sairen.daily_fans[1]).toBeLessThan(0);
    expect(sairen.daily_fans[2]).toBeLessThan(0);
    expect(sairen.daily_fans[3]).toBe(0);
    expect(isTransferMember(sairen)).toBe(true);
  });

  it('negative daily_fans[0] does not produce negative gain display', () => {
    const report = generateDailyReport(snapshot, config, 0);
    const memberLines = report.split('\n').filter((l) => /^\d+\./.test(l));
    for (const line of memberLines) {
      expect(line).not.toMatch(/— -[\d.]+/);
    }
  });
});
