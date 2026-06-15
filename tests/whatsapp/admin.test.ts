import { handleSetReq, handleConfig, handleStatus, handleCatchUp, handleAlerts } from '../../src/whatsapp/admin';
import { getDefaultConfig } from '../../src/config';

jest.mock('../../src/config', () => {
  const actual = jest.requireActual('../../src/config');
  return { ...actual, saveConfig: jest.fn() };
});

const config = getDefaultConfig();

describe('handleSetReq', () => {
  it('shows current requirements when no args', () => {
    const result = handleSetReq([], config);
    expect(result.message).toContain('Monthly');
    expect(result.message).toContain('Weekly');
    expect(result.config).toBe(config); // no change
  });

  it('sets monthly requirement', () => {
    const result = handleSetReq(['monthly', '30000000'], config);
    expect(result.config.requirements.monthlyFans).toBe(30_000_000);
    expect(result.message).toContain('30.0M');
    expect(result.message).toContain('Monthly');
  });

  it('sets weekly requirement', () => {
    const result = handleSetReq(['weekly', '10000000'], config);
    expect(result.config.requirements.weeklyFans).toBe(10_000_000);
    expect(result.message).toContain('10.0M');
  });

  it('rejects invalid sub-command', () => {
    const result = handleSetReq(['daily', '1000'], config);
    expect(result.message).toContain('Usage');
  });

  it('rejects non-numeric value', () => {
    const result = handleSetReq(['monthly', 'abc'], config);
    expect(result.message).toContain('angka');
  });

  it('rejects negative value', () => {
    const result = handleSetReq(['monthly', '-1000'], config);
    expect(result.message).toContain('angka');
  });

  it('does not mutate original config', () => {
    const original = config.requirements.monthlyFans;
    handleSetReq(['monthly', '99999'], config);
    expect(config.requirements.monthlyFans).toBe(original);
  });
});

describe('handleConfig', () => {
  it('returns configuration summary', () => {
    const result = handleConfig(config);
    expect(result).toContain('Circle ID');
    expect(result).toContain('Requirements');
    expect(result).toContain('Schedule');
    expect(result).toContain('Alerts');
    expect(result).toContain('Catch-up');
  });

  it('shows schedule times', () => {
    const result = handleConfig(config);
    expect(result).toContain('22:05');
    expect(result).toContain('22:12');
  });

  it('shows requirement values', () => {
    const result = handleConfig(config);
    expect(result).toContain('20.0M'); // monthlyFans default
    expect(result).toContain('Weekly: 0');  // weeklyFans default (disabled)
  });
});

describe('handleStatus', () => {
  it('returns status summary', () => {
    const result = handleStatus(config);
    expect(result).toContain('System Status');
    expect(result).toContain('Circle');
  });

  it('shows last fetch when provided', () => {
    const result = handleStatus(config, { lastFetch: '2026-06-11 22:00' });
    expect(result).toContain('2026-06-11 22:00');
  });

  it('shows "never" when no info', () => {
    const result = handleStatus(config);
    expect(result).toContain('never');
  });

  it('shows snapshot day when provided', () => {
    const result = handleStatus(config, { snapshotDay: 11 });
    expect(result).toContain('11');
  });

  it('shows group counts', () => {
    const result = handleStatus(config);
    expect(result).toContain('Admins');
    expect(result).toContain('Command groups');
    expect(result).toContain('Announcement groups');
  });
});

// ============================================================
// handleCatchUp
// ============================================================

describe('handleCatchUp', () => {
  it('shows current status when no args', () => {
    const result = handleCatchUp([], config);
    expect(result.message).toContain('Catch-up');
    expect(result.config).toBe(config); // no change
  });

  it('enables catch-up with "on"', () => {
    const result = handleCatchUp(['on'], config);
    expect(result.config.catchUp.enabled).toBe(true);
    expect(result.message).toContain('diaktifkan');
  });

  it('disables catch-up with "off"', () => {
    const result = handleCatchUp(['off'], config);
    expect(result.config.catchUp.enabled).toBe(false);
    expect(result.message).toContain('dinonaktifkan');
  });

  it('rejects invalid argument', () => {
    const result = handleCatchUp(['maybe'], config);
    expect(result.message).toContain('Usage');
    expect(result.config).toBe(config); // no change
  });

  it('does not mutate original config', () => {
    const original = config.catchUp.enabled;
    handleCatchUp(['off'], config);
    expect(config.catchUp.enabled).toBe(original);
  });
});

// ============================================================
// handleAlerts
// ============================================================

describe('handleAlerts', () => {
  it('shows current status when no args', () => {
    const result = handleAlerts([], config);
    expect(result.message).toContain('Alerts');
    expect(result.config).toBe(config); // no change
  });

  it('enables alerts with "on"', () => {
    const result = handleAlerts(['on'], config);
    expect(result.config.alerts.enabled).toBe(true);
    expect(result.message).toContain('diaktifkan');
  });

  it('disables alerts with "off"', () => {
    const result = handleAlerts(['off'], config);
    expect(result.config.alerts.enabled).toBe(false);
    expect(result.message).toContain('dinonaktifkan');
  });

  it('rejects invalid argument', () => {
    const result = handleAlerts(['maybe'], config);
    expect(result.message).toContain('Usage');
    expect(result.config).toBe(config); // no change
  });

  it('does not mutate original config', () => {
    const original = config.alerts.enabled;
    handleAlerts(['off'], config);
    expect(config.alerts.enabled).toBe(original);
  });
});
