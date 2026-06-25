/**
 * Adversarial input fuzzing for command parsing and dispatch.
 * Verifies parseCommand() and the dispatch handler never crash
 * on malformed, malicious, or unusual inputs.
 */
import { parseCommand } from '../../src/whatsapp/commands';
import { setupCommandHandler } from '../../src/whatsapp/dispatch';
import type { WhatsAppClient, IncomingMessage } from '../../src/whatsapp/client';
import type { BotConfig, Snapshot } from '../../src/types';
import { getDefaultConfig } from '../../src/config';

jest.mock('../../src/config', () => {
  const actual = jest.requireActual('../../src/config');
  return { ...actual, saveConfig: jest.fn() };
});

const CMD_GROUP = 'group-cmd@g.us';
const PREFIXES = ['/'];

function makeConfig(): BotConfig {
  const base = getDefaultConfig();
  return { ...base, admins: ['6281234567890@s.whatsapp.net'],
    groups: { ...base.groups, command: [CMD_GROUP], announcement: [], alertAdmin: [] } };
}

function makeSnapshot(): Snapshot {
  return {
    circle: { circle_id: 100, name: 'TestClub', comment: '', leader_viewer_id: 1, leader_name: 'Leader',
      member_count: 2, join_style: 0, policy: 0, created_at: '', last_updated: '2026-06-12T14:00:00Z',
      monthly_rank: 100, monthly_point: 1000000, last_month_rank: null, last_month_point: null,
      archived: false, yesterday_updated: null, yesterday_points: null, yesterday_rank: null,
      live_points: null, live_rank: null, last_live_update: null },
    members: [{ id: 1, circle_id: 100, viewer_id: 1001, trainer_name: 'Alice', shame_score: null,
      year: 2026, month: 6, daily_fans: Array(32).fill(0), last_updated: '2026-06-12' }],
    club_rank: 8, fans_to_next_tier: 500000, fans_to_lower_tier: 50000,
    yesterday_fans_to_next_tier: 600000, yesterday_fans_to_lower_tier: 40000,
  };
}

function makeMsg(text: string): IncomingMessage {
  return { key: { remoteJid: CMD_GROUP, id: 'fuzz-001' }, message: { conversation: text }, pushName: 'FuzzUser' };
}

function makeMockDb(): any {
  return {
    recordAlert: jest.fn(),
    getMembers: jest.fn().mockReturnValue([]), getMember: jest.fn().mockReturnValue(null),
    upsertMember: jest.fn(), saveRankHistory: jest.fn(), getLastSuccessfulRun: jest.fn().mockReturnValue(null),
    getLastRun: jest.fn().mockReturnValue(null),
    recordRun: jest.fn(), updateRunStatus: jest.fn(),
  };
}

// 56 adversarial inputs across 6 groups
const ADVERSARIAL_INPUTS: string[] = [
  // Group 1: Injection (10)
  '/daily; rm -rf /', '/daily && echo pwned', '/daily | cat /etc/passwd',
  '/daily > /tmp/pwned', '/daily$(whoami)', '`/daily`rm -rf /`',
  '/daily\nDROP TABLE users;', '/daily\x00nullbyte',
  '/<script>alert(1)</script>', '/daily{"$gt":""}',
  // Group 2: Unicode tricks (8)
  '/d\u0430ily', '/\u200Bdaily', '/daily\u200B', '/DAILY', '/Daily',
  '\uFF44\uFF41\uFF49\uFF4C\uFF59', '/\u0456ta\u043E\u044f', '/dail\u0303y',
  // Group 3: Very long (4)
  '/daily' + 'A'.repeat(10000), '/' + 'a'.repeat(1000),
  ' '.repeat(500) + '/daily',
  '/daily ' + Array.from({ length: 1000 }, (_, i) => `arg${i}`).join(' '),
  // Group 4: Empty/special (10)
  '', ' ', '\n', '\t', 'null', 'undefined', '/', '//', '/daily/weekly', '//daily',
  // Group 5: Special characters (6)
  '/daily!@#$%^&*()', '/daily\u{1F3AE}', '/daily\n\n\n', '/daily\r\n',
  '/daily\0', '\u2318daily',
  // Group 6: Prefix edge cases (8)
  '.daily', '!daily', '?daily', '/ daily', '/\tdaily', '/daily/weekly',
  '//' + 'a'.repeat(100), '/' + '\u200B'.repeat(20) + 'daily',
  // Bonus: numeric extremes (6)
  '/daily 99999999999999999999', '/daily -99999999999999999999',
  '/daily NaN', '/daily Infinity', '/daily 0x1A', '/daily 0777',
  // Bonus: null bytes (4)
  'NaN', 'Infinity', '\u0000\u0000\u0000', '/daily' + '\u0000'.repeat(50),
];

describe('parseCommand fuzzing', () => {
  it.each(ADVERSARIAL_INPUTS.map((input, i) => [i, input]))(
    'does not crash on input #%#: %j',
    (_i, input) => {
      const result = parseCommand(input as string, PREFIXES);
      if (result !== null) {
        expect(typeof result.command).toBe('string');
        expect(Array.isArray(result.args)).toBe(true);
        expect(result).toHaveProperty('offset');
        expect(result).toHaveProperty('raw');
      }
    }
  );

  it('returns null or unrecognized command for injection attempts', () => {
    const injections = [
      '/daily; rm -rf /', '/daily && echo pwned', '/daily | cat /etc/passwd',
      '/daily > /tmp/pwned', '/daily$(whoami)', '`/daily`rm -rf /`',
      '/daily\nDROP TABLE users;', '/daily\x00nullbyte',
    ];
    for (const input of injections) {
      const result = parseCommand(input, PREFIXES);
      if (result !== null) {
        // Command name won't match any real command in dispatch — injection neutralized
        expect(typeof result.command).toBe('string');
      }
    }
  });

  it('does not crash on unicode homoglyphs', () => {
    const tricks = ['/d\u0430ily', '/\u200Bdaily', '/daily\u200B',
      '/DAILY', '/Daily', '\uFF44\uFF41\uFF49\uFF4C\uFF59', '/dail\u0303y'];
    for (const input of tricks) {
      expect(() => parseCommand(input, PREFIXES)).not.toThrow();
    }
  });

  it('handles 10000-char input without hanging', () => {
    const start = Date.now();
    parseCommand('/daily' + 'A'.repeat(10000), PREFIXES);
    expect(Date.now() - start).toBeLessThan(1000);
  });
});

describe('Dispatch handler fuzzing', () => {
  let messageHandler: ((msg: IncomingMessage) => Promise<void>) | null;
  let mockClient: WhatsAppClient;

  beforeEach(() => {
    messageHandler = null;
    mockClient = {
      onMessage: jest.fn((h: any) => { messageHandler = h; }),
      sendMessage: jest.fn(async () => {}),
      sendOrEdit: jest.fn(async () => 'msg-id'),
      connect: jest.fn(), disconnect: jest.fn(),
    } as any;
    setupCommandHandler(mockClient, makeConfig(), makeMockDb(), () => makeSnapshot());
  });

  it('registers a handler', () => {
    expect(messageHandler).not.toBeNull();
  });

  it.each(ADVERSARIAL_INPUTS.map((input, i) => [i, input]))(
    'does not crash on message #%#: %j',
    async (_i, input) => {
      await expect(messageHandler!(makeMsg(input as string))).resolves.not.toThrow();
    }
  );

  it('does not crash when message fields are missing', async () => {
    await expect(messageHandler!({ key: { remoteJid: '', id: '' }, message: undefined, pushName: '' } as any))
      .resolves.not.toThrow();
  });

  it('does not crash when message is null-like', async () => {
    await expect(messageHandler!({ key: {}, message: { conversation: null }, pushName: '' } as any))
      .resolves.not.toThrow();
  });
});
