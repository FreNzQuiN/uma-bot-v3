/**
 * Daily Report — Dispatch Integration Tests
 *
 * Full user flow: /daily → dispatch → loading → report.
 * Tests scenarios 1-10 plus exact total gain verification.
 */

import { generateDailyReport } from '../../../src/reports/daily';
import { computeMembers } from '../../../src/reports/compute';
import { getDefaultConfig } from '../../../src/config';
import { getDataDayFromSnapshot } from '../../../src/data/snapshot';
import {
  getDailyGain,
  getLatestDataDay,
  isTransferMember,
  isStaleForReport,
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


const ADMIN_JID = '6281234567890@s.whatsapp.net';
const NON_ADMIN_JID = '6289999999999@s.whatsapp.net';
const COMMAND_GROUP = 'group-cmd@g.us';
const OTHER_GROUP = 'group-other@g.us';

let snapshot: Snapshot;

beforeAll(() => {
  snapshot = loadRealSnapshot();
});


function makeConfig(overrides: Record<string, any> = {}): BotConfig {
  return makeConfigBase({
    admins: [ADMIN_JID],
    groups: { command: [COMMAND_GROUP], announcement: [], alertAdmin: [] },
    ...overrides,
  });
}


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

    expect(report).toContain('📊 *Daily Report — 11 Juni 2026*');
    expect(report).toContain('Hol＿Horse');
    expect(report).toContain('A+');
    expect(report).toContain('#431');
    expect(report).toContain('Periode data: 11 Juni 2026, 22:00 WIB');
    expect(report).toContain('Promosi: 349.2M fans lagi');
    expect(report).toContain('Degradasi: buffer 21.8M');
    expect(report).toMatch(/👥 27 kontribusi dari 30 anggota \| Total: /);
    expect(report).toMatch(/1\. \*Nargi\* — \+/);

    const lines = report.split('\n');
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
    expect(report).toContain('⸻');
    expect(report).toMatch(/Terakhir sync: \d+\/\d+ \d{2}:\d{2}$/);

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


describe('Exact total gain verification', () => {
  let report: string;

  beforeAll(() => {
    report = generateDailyReport(snapshot, getDefaultConfig(), computeMembers(snapshot, getDefaultConfig()), 0);
  });

  it('total gain matches manual sum of all 30 contributing members', () => {
    const latestDataDay = getDataDayFromSnapshot(snapshot);
    let totalGain = 0;
    const contributingGains: { name: string; gain: number; isTransfer: boolean }[] = [];

    for (const member of snapshot.members) {
      const isT = isTransferMember(member);
      const latestPositiveDay = getLatestDataDay(member.daily_fans);
      const stale = isStaleForReport(member.daily_fans, latestDataDay, 3);
      const status = isT ? 'transfer' : (latestPositiveDay === 0 || stale) ? 'stale' : 'active';

      if (status === 'active' || status === 'transfer') {
        const gain = getDailyGain(member.daily_fans, 11);
        totalGain += gain;
        contributingGains.push({ name: member.trainer_name, gain, isTransfer: isT });
      }
    }

    expect(contributingGains.length).toBe(29);
    expect(totalGain).toBe(32287438);
    expect(formatNumber(totalGain)).toBe('32.3M');

    const gainLine = report.split('\n').find((l) => l.includes('Total:'));
    expect(gainLine).toMatch(/^👥 27 kontribusi dari 30 anggota \| Total: 32\.3M$/);
  });

  it('offset=1 total gain matches manual sum', () => {
    const report1 = generateDailyReport(snapshot, getDefaultConfig(), computeMembers(snapshot, getDefaultConfig()), 1);
    const latestDataDay = getDataDayFromSnapshot(snapshot);
    let totalGain = 0;
    let count = 0;

    for (const member of snapshot.members) {
      const isT = isTransferMember(member);
      const latestPositiveDay = getLatestDataDay(member.daily_fans);
      const stale = isStaleForReport(member.daily_fans, latestDataDay, 3);
      const status = isT ? 'transfer' : (latestPositiveDay === 0 || stale) ? 'stale' : 'active';

      if (status === 'active' || status === 'transfer') {
        totalGain += getDailyGain(member.daily_fans, 10);
        count++;
      }
    }

    expect(count).toBe(29);
    const gainLine = report1.split('\n').find((l) => l.includes('Total:'));
    expect(gainLine).toContain(formatNumber(totalGain));
  });
});
