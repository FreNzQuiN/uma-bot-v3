import { writeFileSync, unlinkSync, mkdirSync, rmSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getDefaultConfig, validateConfig, loadConfig, updateConfig, saveConfig } from '../src/config';

const TEMP_DIR = join(__dirname, '../../tests/temp-config');

beforeAll(() => {
  mkdirSync(TEMP_DIR, { recursive: true });
});

afterAll(() => {
  rmSync(TEMP_DIR, { recursive: true, force: true });
});

describe('getDefaultConfig', () => {
  it('returns a valid config', () => {
    const config = getDefaultConfig();
    expect(config.circleId).toBeDefined();
    expect(config.timezone).toBe('Asia/Jakarta');
    expect(Array.isArray(config.admins)).toBe(true);
    expect(config.message.maxLength).toBe(4096);
  });

  it('has default prefix "/"', () => {
    const config = getDefaultConfig();
    expect(config.commands.prefixes).toContain('/');
  });

  it('has default requirements', () => {
    const config = getDefaultConfig();
    expect(config.requirements.monthlyFans).toBe(20_000_000);
    expect(config.requirements.weeklyFans).toBe(0);
  });

  it('has catch-up enabled by default', () => {
    const config = getDefaultConfig();
    expect(config.catchUp.enabled).toBe(true);
    expect(config.catchUp.maxReportsPerStartup).toBe(10);
  });
});

describe('validateConfig', () => {
  it('accepts valid complete config', () => {
    const config = validateConfig({ circleId: 12345 });
    expect(config.circleId).toBe(12345);
  });

  it('fills defaults for missing fields', () => {
    const config = validateConfig({ circleId: 12345 });
    expect(config.timezone).toBe('Asia/Jakarta');
    expect(config.commands.prefixes).toEqual(['/']);
    expect(config.alerts.enabled).toBe(true);
  });

  it('accepts empty object (uses defaults including circleId)', () => {
    const config = validateConfig({});
    expect(config.circleId).toBe(232229195);
  });

  it('rejects negative circleId', () => {
    expect(() => validateConfig({ circleId: -1 })).toThrow();
  });

  it('rejects non-number circleId', () => {
    expect(() => validateConfig({ circleId: 'abc' })).toThrow();
  });

  it('validates nested alert config', () => {
    const config = validateConfig({
      circleId: 1,
      alerts: {
        performanceDrop: {
          enabled: true,
          thresholdPercent: 75,
          minHistoryDays: 7,
        },
      },
    });
    expect(config.alerts.performanceDrop.thresholdPercent).toBe(75);
  });

  it('rejects invalid threshold percent', () => {
    expect(() =>
      validateConfig({
        circleId: 1,
        alerts: {
          enabled: true,
          defaultRecipients: 'admin',
          performanceDrop: {
            enabled: true,
            thresholdPercent: 150,
            minHistoryDays: 7,
          },
          demotionRisk: { enabled: true, bufferDays: 3 },
          streakBreak: { enabled: true },
          newTransfer: { enabled: true },
          rankDrop: { enabled: false, positions: 10 },
          quietHours: { enabled: false, start: '23:00', end: '06:00' },
        },
      })
    ).toThrow();
  });
});

describe('loadConfig', () => {
  it('returns default config when file does not exist', () => {
    const config = loadConfig(join(TEMP_DIR, 'nonexistent.yaml'));
    expect(config.timezone).toBe('Asia/Jakarta');
  });

  it('loads from valid YAML file', () => {
    const yaml = `circleId: 99999
timezone: Asia/Tokyo
admins:
  - "test@s.whatsapp.net"
`;
    const path = join(TEMP_DIR, 'valid.yaml');
    writeFileSync(path, yaml, 'utf-8');

    const config = loadConfig(path);
    expect(config.circleId).toBe(99999);
    expect(config.timezone).toBe('Asia/Tokyo');
    expect(config.admins).toContain('test@s.whatsapp.net');
  });

  it('loads complete YAML with all fields', () => {
    const yaml = `circleId: 232229195
timezone: Asia/Jakarta
commands:
  prefixes: ["/"]
  maxDailyOffset: 15
admins: ["628xxx@s.whatsapp.net"]
groups:
  command: ["group1@g.us"]
  announcement: ["group2@g.us"]
  alertAdmin: ["group3@g.us"]
requirements:
  monthlyFans: 30000000
  weeklyFans: 8000000
  weeksInMonthEquivalent: 4
schedule:
  daily:
    enabled: true
    time: "22:05"
  weekly:
    enabled: true
    days: [7, 14, 21, 28]
    time: "22:05"
  monthly:
    enabled: true
    day: 1
    time: "22:12"
catchUp:
  enabled: true
  maxReportsPerStartup: 10
alerts:
  enabled: true
  defaultRecipients: admin
  performanceDrop:
    enabled: true
    thresholdPercent: 50
  demotionRisk:
    enabled: true
    bufferDays: 3
message:
  maxLength: 4096
  splitAtNewline: true
  language: id
`;
    const path = join(TEMP_DIR, 'complete.yaml');
    writeFileSync(path, yaml, 'utf-8');

    const config = loadConfig(path);
    expect(config.circleId).toBe(232229195);
    expect(config.requirements.monthlyFans).toBe(30_000_000);
    expect(config.schedule.weekly.days).toEqual([7, 14, 21, 28]);
  });
});

describe('updateConfig', () => {
  it('returns a new object', () => {
    const original = getDefaultConfig();
    const updated = updateConfig(original, { circleId: 99999 });
    expect(updated).not.toBe(original);
    expect(updated.circleId).toBe(99999);
  });

  it('does not mutate original', () => {
    const original = getDefaultConfig();
    const originalCircleId = original.circleId;
    updateConfig(original, { circleId: 99999 });
    expect(original.circleId).toBe(originalCircleId);
  });

  it('deep merges nested objects', () => {
    const original = getDefaultConfig();
    const updated = updateConfig(original, {
      alerts: {
        ...original.alerts,
        performanceDrop: {
          ...original.alerts.performanceDrop,
          thresholdPercent: 75,
        },
      },
    });
    expect(updated.alerts.performanceDrop.thresholdPercent).toBe(75);
    // Other alert fields preserved
    expect(updated.alerts.demotionRisk.bufferDays).toBe(
      original.alerts.demotionRisk.bufferDays
    );
  });

  it('updates admins array (replaces, not merges)', () => {
    const original = getDefaultConfig();
    const updated = updateConfig(original, {
      admins: ['new-admin@s.whatsapp.net'],
    });
    expect(updated.admins).toEqual(['new-admin@s.whatsapp.net']);
  });

  it('deep merges partial nested update preserving siblings (BUG-6)', () => {
    const original = getDefaultConfig();
    // Only update schedule.daily.enabled — weekly and monthly must be preserved
    const updated = updateConfig(original, {
      schedule: {
        daily: { enabled: false },
      } as typeof original.schedule,
    });
    expect(updated.schedule.daily.enabled).toBe(false);
    expect(updated.schedule.weekly.enabled).toBe(original.schedule.weekly.enabled);
    expect(updated.schedule.weekly.days).toEqual(original.schedule.weekly.days);
    expect(updated.schedule.monthly.enabled).toBe(original.schedule.monthly.enabled);
    expect(updated.schedule.monthly.day).toBe(original.schedule.monthly.day);
  });

  it('replaces arrays, does not merge them', () => {
    const original = getDefaultConfig();
    const updated = updateConfig(original, {
      admins: ['only-one@s.whatsapp.net'],
    });
    expect(updated.admins).toEqual(['only-one@s.whatsapp.net']);
    expect(updated.admins.length).toBe(1);
  });
});

describe('validateConfig - time format (BUG-2)', () => {
  it('rejects invalid time format "abc"', () => {
    expect(() =>
      validateConfig({
        circleId: 1,
        schedule: { daily: { time: 'abc' } },
      })
    ).toThrow();
  });

  it('rejects invalid time format "25:00"', () => {
    expect(() =>
      validateConfig({
        circleId: 1,
        schedule: { daily: { time: '25:00' } },
      })
    ).toThrow();
  });

  it('rejects invalid time format "22:5" (no leading zero)', () => {
    expect(() =>
      validateConfig({
        circleId: 1,
        schedule: { daily: { time: '22:5' } },
      })
    ).toThrow();
  });

  it('rejects invalid quietHours time format', () => {
    expect(() =>
      validateConfig({
        circleId: 1,
        alerts: {
          enabled: true,
          defaultRecipients: 'admin',
          quietHours: { enabled: true, start: 'abc', end: '06:00' },
          performanceDrop: { enabled: true, thresholdPercent: 50, minHistoryDays: 7 },
          demotionRisk: { enabled: true, bufferDays: 3 },
          streakBreak: { enabled: true },
          newTransfer: { enabled: true },
          rankDrop: { enabled: false, positions: 10 },
        },
      })
    ).toThrow();
  });

  it('accepts valid time format "22:05"', () => {
    const config = validateConfig({
      circleId: 1,
      schedule: { daily: { time: '22:05' } },
    });
    expect(config.schedule.daily.time).toBe('22:05');
  });
});

describe('saveConfig round-trip (TEST-GAP-5)', () => {
  it('preserves all values across save/load cycle', () => {
    const original = validateConfig({
      circleId: 99999,
      timezone: 'Asia/Tokyo',
      commands: { prefixes: ['!', '?'], maxDailyOffset: 20 },
      admins: ['admin@s.whatsapp.net'],
      requirements: { monthlyFans: 30000000, weeklyFans: 5000000, weeksInMonthEquivalent: 5 },
    });

    const filePath = join(TEMP_DIR, 'roundtrip.yaml');
    saveConfig(original, filePath);

    const loaded = loadConfig(filePath);
    expect(loaded.circleId).toBe(original.circleId);
    expect(loaded.timezone).toBe(original.timezone);
    expect(loaded.commands.prefixes).toEqual(original.commands.prefixes);
    expect(loaded.commands.maxDailyOffset).toBe(original.commands.maxDailyOffset);
    expect(loaded.admins).toEqual(original.admins);
    expect(loaded.requirements.monthlyFans).toBe(original.requirements.monthlyFans);
    expect(loaded.requirements.weeklyFans).toBe(original.requirements.weeklyFans);
    expect(loaded.requirements.weeksInMonthEquivalent).toBe(original.requirements.weeksInMonthEquivalent);
  });
});

describe('saveConfig temp file collision recovery', () => {
  it('overwrites orphaned .tmp file and completes successfully', () => {
    const filePath = join(TEMP_DIR, 'tmp-collision.yaml');
    const tmpPath = filePath + '.tmp';

    // Write the real config file first so saveConfig can read existing YAML
    writeFileSync(filePath, 'circleId: 11111\n', 'utf-8');

    // Create an orphaned .tmp file (simulates a previous crash)
    writeFileSync(tmpPath, 'orphaned content that should be overwritten', 'utf-8');
    expect(existsSync(tmpPath)).toBe(true);

    const config = validateConfig({ circleId: 99999 });

    // Should not throw — flag:'w' overwrites the orphaned .tmp
    saveConfig(config, filePath);

    // Verify config was saved correctly
    const loaded = loadConfig(filePath);
    expect(loaded.circleId).toBe(99999);

    // .tmp should no longer exist after renameSync
    expect(existsSync(tmpPath)).toBe(false);
  });
});
