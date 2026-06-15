import { parseCommand, resolveMemberName } from '../../src/whatsapp/commands';
import type { ComputedMember } from '../../src/types';

// ============================================================
// Test helpers
// ============================================================

function makeMember(overrides: Partial<ComputedMember> = {}): ComputedMember {
  return {
    viewerId: 1001,
    trainerName: 'Ryu Zero',
    status: 'active',
    isTransfer: false,
    dailyFans: [],
    latestPositiveDay: 0,
    latestPositiveValue: 0,
    firstPositiveDay: 0,
    firstPositiveValue: 0,
    monthlyGain: 0,
    latestDailyGain: 0,
    weeklyGains: [0, 0, 0, 0, 0],
    ...overrides,
  };
}

const DEFAULT_PREFIXES = ['/'];

// ============================================================
// parseCommand
// ============================================================

describe('parseCommand', () => {
  describe('basic command parsing', () => {
    it('parses /daily with no args', () => {
      const result = parseCommand('/daily', DEFAULT_PREFIXES);
      expect(result).toEqual({
        command: 'daily',
        args: [],
        offset: null,
        raw: '/daily',
      });
    });

    it('parses /daily with positive offset', () => {
      const result = parseCommand('/daily 1', DEFAULT_PREFIXES);
      expect(result).toEqual({
        command: 'daily',
        args: ['1'],
        offset: 1,
        raw: '/daily 1',
      });
    });

    it('parses /daily with negative offset', () => {
      const result = parseCommand('/daily -1', DEFAULT_PREFIXES);
      expect(result).toEqual({
        command: 'daily',
        args: ['-1'],
        offset: -1,
        raw: '/daily -1',
      });
    });

    it('parses /weekly', () => {
      const result = parseCommand('/weekly', DEFAULT_PREFIXES);
      expect(result).toEqual({
        command: 'weekly',
        args: [],
        offset: null,
        raw: '/weekly',
      });
    });

    it('parses /weekly with offset', () => {
      const result = parseCommand('/weekly 2', DEFAULT_PREFIXES);
      expect(result).toEqual({
        command: 'weekly',
        args: ['2'],
        offset: 2,
        raw: '/weekly 2',
      });
    });

    it('parses /monthly', () => {
      const result = parseCommand('/monthly', DEFAULT_PREFIXES);
      expect(result).toEqual({
        command: 'monthly',
        args: [],
        offset: null,
        raw: '/monthly',
      });
    });

    it('parses /monthly with offset', () => {
      const result = parseCommand('/monthly -2', DEFAULT_PREFIXES);
      expect(result).toEqual({
        command: 'monthly',
        args: ['-2'],
        offset: -2,
        raw: '/monthly -2',
      });
    });

    it('parses /ranks', () => {
      const result = parseCommand('/ranks', DEFAULT_PREFIXES);
      expect(result).toEqual({
        command: 'ranks',
        args: [],
        offset: null,
        raw: '/ranks',
      });
    });

    it('parses /bottom', () => {
      const result = parseCommand('/bottom', DEFAULT_PREFIXES);
      expect(result).toEqual({
        command: 'bottom',
        args: [],
        offset: null,
        raw: '/bottom',
      });
    });

    it('parses /stats', () => {
      const result = parseCommand('/stats', DEFAULT_PREFIXES);
      expect(result).toEqual({
        command: 'stats',
        args: [],
        offset: null,
        raw: '/stats',
      });
    });

    it('parses /members', () => {
      const result = parseCommand('/members', DEFAULT_PREFIXES);
      expect(result).toEqual({
        command: 'members',
        args: [],
        offset: null,
        raw: '/members',
      });
    });

    it('parses /tier', () => {
      const result = parseCommand('/tier', DEFAULT_PREFIXES);
      expect(result).toEqual({
        command: 'tier',
        args: [],
        offset: null,
        raw: '/tier',
      });
    });
  });

  describe('commands with arguments', () => {
    it('parses /compare with two names', () => {
      const result = parseCommand('/compare Ryu Zero', DEFAULT_PREFIXES);
      expect(result).toEqual({
        command: 'compare',
        args: ['Ryu', 'Zero'],
        offset: null,
        raw: '/compare Ryu Zero',
      });
    });

    it('parses /analyze with a name', () => {
      const result = parseCommand('/analyze Ryu Zero', DEFAULT_PREFIXES);
      expect(result).toEqual({
        command: 'analyze',
        args: ['Ryu', 'Zero'],
        offset: null,
        raw: '/analyze Ryu Zero',
      });
    });

    it('parses /setreq with a numeric value', () => {
      const result = parseCommand('/setreq 20000000', DEFAULT_PREFIXES);
      expect(result).toEqual({
        command: 'setreq',
        args: ['20000000'],
        offset: 20000000,
        raw: '/setreq 20000000',
      });
    });

    it('parses /compare with single-word names', () => {
      const result = parseCommand('/compare Ryu Zero', DEFAULT_PREFIXES);
      expect(result?.args).toHaveLength(2);
      expect(result?.args[0]).toBe('Ryu');
      expect(result?.args[1]).toBe('Zero');
    });
  });

  describe('prefix matching', () => {
    it('parses command with ! prefix', () => {
      const result = parseCommand('!daily', ['!']);
      expect(result).not.toBeNull();
      expect(result?.command).toBe('daily');
    });

    it('parses command with multiple prefixes configured', () => {
      const result = parseCommand('.daily', ['/', '.', '!']);
      expect(result).not.toBeNull();
      expect(result?.command).toBe('daily');
    });

    it('returns null for non-matching prefix', () => {
      const result = parseCommand('!daily', ['/']);
      expect(result).toBeNull();
    });

    it('returns null for message without any prefix', () => {
      const result = parseCommand('daily', DEFAULT_PREFIXES);
      expect(result).toBeNull();
    });

    it('returns null for empty string', () => {
      const result = parseCommand('', DEFAULT_PREFIXES);
      expect(result).toBeNull();
    });

    it('returns null for whitespace-only string', () => {
      const result = parseCommand('   ', DEFAULT_PREFIXES);
      expect(result).toBeNull();
    });

    it('handles command with extra whitespace', () => {
      const result = parseCommand('/daily   1', DEFAULT_PREFIXES);
      expect(result).not.toBeNull();
      expect(result?.command).toBe('daily');
      expect(result?.args).toEqual(['1']);
      expect(result?.offset).toBe(1);
    });

    it('handles command with leading/trailing whitespace', () => {
      const result = parseCommand('  /daily  ', DEFAULT_PREFIXES);
      expect(result).not.toBeNull();
      expect(result?.command).toBe('daily');
    });
  });

  describe('non-command messages', () => {
    it('returns null for regular chat message', () => {
      const result = parseCommand('Hello everyone!', DEFAULT_PREFIXES);
      expect(result).toBeNull();
    });

    it('returns null for message that contains prefix but not at start', () => {
      const result = parseCommand('Try /daily for report', DEFAULT_PREFIXES);
      expect(result).toBeNull();
    });

    it('returns null for URL-like content', () => {
      const result = parseCommand('https://uma.moe/data', DEFAULT_PREFIXES);
      expect(result).toBeNull();
    });

    it('returns null for emoji-only message', () => {
      const result = parseCommand('🎉', DEFAULT_PREFIXES);
      expect(result).toBeNull();
    });
  });

  describe('unknown commands', () => {
    it('parses unknown command names', () => {
      const result = parseCommand('/unknown', DEFAULT_PREFIXES);
      expect(result).toEqual({
        command: 'unknown',
        args: [],
        offset: null,
        raw: '/unknown',
      });
    });

    it('parses unknown command with args', () => {
      const result = parseCommand('/foo bar baz', DEFAULT_PREFIXES);
      expect(result).toEqual({
        command: 'foo',
        args: ['bar', 'baz'],
        offset: null,
        raw: '/foo bar baz',
      });
    });
  });

  describe('edge cases', () => {
    it('handles very long command text', () => {
      const longArgs = Array(100).fill('word').join(' ');
      const result = parseCommand(`/analyze ${longArgs}`, DEFAULT_PREFIXES);
      expect(result).not.toBeNull();
      expect(result?.command).toBe('analyze');
      expect(result?.args).toHaveLength(100);
    });

    it('handles special characters in args', () => {
      const result = parseCommand('/compare Ryu&Zero Team-One', DEFAULT_PREFIXES);
      expect(result).not.toBeNull();
      expect(result?.args).toContain('Ryu&Zero');
      expect(result?.args).toContain('Team-One');
    });

    it('handles Unicode in args', () => {
      const result = parseCommand('/analyze \u30b9\u30bf\u30a4\u30eb', DEFAULT_PREFIXES);
      expect(result).not.toBeNull();
      expect(result?.command).toBe('analyze');
      expect(result?.args).toEqual(['\u30b9\u30bf\u30a4\u30eb']);
    });
  });
});

// ============================================================
// resolveMemberName
// ============================================================

describe('resolveMemberName', () => {
  const members = [
    makeMember({ viewerId: 1001, trainerName: 'Ryu Zero' }),
    makeMember({ viewerId: 1002, trainerName: 'Ryu One' }),
    makeMember({ viewerId: 1003, trainerName: 'Tanaka' }),
    makeMember({ viewerId: 1004, trainerName: 'Sakura Han' }),
    makeMember({ viewerId: 1005, trainerName: '\u30b9\u30bf\u30a4\u30eb' }),
  ];

  describe('exact match', () => {
    it('finds member by exact case-sensitive name', () => {
      const result = resolveMemberName('Ryu Zero', members);
      expect(result).not.toBeNull();
      expect(result?.viewerId).toBe(1001);
    });

    it('finds member by exact case-insensitive name', () => {
      const result = resolveMemberName('ryu zero', members);
      expect(result).not.toBeNull();
      expect(result?.viewerId).toBe(1001);
    });

    it('finds member with exact mixed case', () => {
      const result = resolveMemberName('RYU ZERO', members);
      expect(result).not.toBeNull();
      expect(result?.viewerId).toBe(1001);
    });
  });

  describe('partial match', () => {
    it('finds unique partial match', () => {
      const result = resolveMemberName('Tanaka', members);
      expect(result).not.toBeNull();
      expect(result?.viewerId).toBe(1003);
    });

    it('finds member by partial prefix', () => {
      const result = resolveMemberName('Sak', members);
      expect(result).not.toBeNull();
      expect(result?.viewerId).toBe(1004);
    });
  });

  describe('ambiguous match', () => {
    it('returns null when multiple members match', () => {
      const result = resolveMemberName('Ryu', members);
      expect(result).toBeNull();
    });

    it('returns null when partial matches two members', () => {
      const result = resolveMemberName('Ry', members);
      expect(result).toBeNull();
    });
  });

  describe('fuzzy match', () => {
    it('finds member with Levenshtein distance <= 2', () => {
      // "Ryu Zer" is distance 1 from "Ryu Zero" (missing 'o')
      const result = resolveMemberName('Ryu Zer', members);
      expect(result).not.toBeNull();
      expect(result?.viewerId).toBe(1001);
    });

    it('finds member with typo within threshold', () => {
      // "Tnaka" is distance 1 from "Tanaka" (missing 'a')
      const result = resolveMemberName('Tnaka', members);
      expect(result).not.toBeNull();
      expect(result?.viewerId).toBe(1003);
    });

    it('returns null when fuzzy match is too far', () => {
      const result = resolveMemberName('xyzxyz', members);
      expect(result).toBeNull();
    });
  });

  describe('empty and edge cases', () => {
    it('returns null for empty string', () => {
      const result = resolveMemberName('', members);
      expect(result).toBeNull();
    });

    it('returns null for empty members array', () => {
      const result = resolveMemberName('Ryu Zero', []);
      expect(result).toBeNull();
    });

    it('returns null for whitespace-only input', () => {
      const result = resolveMemberName('   ', members);
      expect(result).toBeNull();
    });

    it('handles Unicode member names', () => {
      const result = resolveMemberName('\u30b9\u30bf\u30a4\u30eb', members);
      expect(result).not.toBeNull();
      expect(result?.viewerId).toBe(1005);
    });
  });
});
