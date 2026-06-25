import { ReportOrchestrator } from '../../src/orchestrator/report-orchestrator';
import { makeConfig, loadRealSnapshot, mockCurrentDate, restoreDateMocks } from '../_helpers';
import type { Alert } from '../../src/alerts/alerts';

// ── Module-level mocks ─────────────────────────────────────
jest.mock('../../src/data/snapshot', () => {
  const actual = jest.requireActual('../../src/data/snapshot');
  return { ...actual, saveSnapshot: jest.fn() };
});

// ── Mock factories ────────────────────────────────────────────

function makeWaClient(overrides: Partial<Record<string, jest.Mock>> = {}) {
  return {
    isConnected: jest.fn().mockReturnValue(true),
    sendMessage: jest.fn().mockResolvedValue(undefined),
    sendOrEdit: jest.fn().mockResolvedValue('msg-id'),
    connect: jest.fn(),
    disconnect: jest.fn(),
    ...overrides,
  } as any;
}

function makeOrchestrator(opts: {
  config?: ReturnType<typeof makeConfig>;
  waClient?: ReturnType<typeof makeWaClient>;
} = {}) {
  const config = opts.config ?? makeConfig({
    groups: { command: [], announcement: ['group1@g.us', 'group2@g.us'], alertAdmin: [] },
  });
  const waClient = opts.waClient ?? makeWaClient();

  const orch = new ReportOrchestrator({
    getConfig: jest.fn().mockReturnValue(config),
    getSnapshot: jest.fn().mockReturnValue(null),
    umaMoe: {} as any,
    db: {} as any,
    waClient,
  });

  return { orch, config, waClient };
}

// ── Tests ─────────────────────────────────────────────────────

describe('ReportOrchestrator — deliverReport', () => {
  const REPORT_TEXT = '== Laporan Harian ==\nTop: Player1\nTotal: 50000';
  const REPORT_TYPE = 'daily';

  it('sends report text to all announcement groups', async () => {
    const { orch, waClient } = makeOrchestrator();

    await orch.deliverReport(REPORT_TEXT, REPORT_TYPE);

    expect(waClient.sendMessage).toHaveBeenCalledTimes(2);
    expect(waClient.sendMessage).toHaveBeenCalledWith('group1@g.us', REPORT_TEXT);
    expect(waClient.sendMessage).toHaveBeenCalledWith('group2@g.us', REPORT_TEXT);
  });

  it('throws when WA not connected and announcement groups exist', async () => {
    const { orch, waClient } = makeOrchestrator({
      waClient: makeWaClient({ isConnected: jest.fn().mockReturnValue(false) }),
    });

    await expect(orch.deliverReport(REPORT_TEXT, REPORT_TYPE)).rejects.toThrow(
      'WhatsApp not connected'
    );
  });

  it('returns silently when WA not connected and no announcement groups', async () => {
    const { orch, waClient } = makeOrchestrator({
      config: makeConfig({
        groups: { command: [], announcement: [], alertAdmin: [] },
      }),
      waClient: makeWaClient({ isConnected: jest.fn().mockReturnValue(false) }),
    });

    // Should not throw
    await orch.deliverReport(REPORT_TEXT, REPORT_TYPE);

    expect(waClient.sendMessage).not.toHaveBeenCalled();
  });

  it('throws when all sends fail', async () => {
    const { orch, waClient } = makeOrchestrator({
      waClient: makeWaClient({
        sendMessage: jest.fn().mockRejectedValue(new Error('network error')),
      }),
    });

    await expect(orch.deliverReport(REPORT_TEXT, REPORT_TYPE)).rejects.toThrow(
      'Failed to deliver daily report to all announcement groups'
    );
  });

  it('does not throw when some sends fail but at least one succeeds', async () => {
    const { orch, waClient } = makeOrchestrator();

    // First group fails, second succeeds
    waClient.sendMessage
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce(undefined);

    // Should NOT throw
    await orch.deliverReport(REPORT_TEXT, REPORT_TYPE);

    expect(waClient.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('calls sendMessage for each group Jid on success', async () => {
    const { orch, waClient } = makeOrchestrator({
      config: makeConfig({
        groups: { command: [], announcement: ['a@g.us', 'b@g.us', 'c@g.us'], alertAdmin: [] },
      }),
    });

    await orch.deliverReport(REPORT_TEXT, REPORT_TYPE);

    expect(waClient.sendMessage).toHaveBeenCalledTimes(3);
    expect(waClient.sendMessage).toHaveBeenNthCalledWith(1, 'a@g.us', REPORT_TEXT);
    expect(waClient.sendMessage).toHaveBeenNthCalledWith(2, 'b@g.us', REPORT_TEXT);
    expect(waClient.sendMessage).toHaveBeenNthCalledWith(3, 'c@g.us', REPORT_TEXT);
  });
});


describe('ReportOrchestrator — deliverAlerts', () => {
  const sampleAlerts: Alert[] = [{
    type: 'performance_drop',
    eventKey: 'perf-123',
    memberViewerId: '12345',
    reportDate: '2025-06-12',
    message: 'Test alert message',
  }];

  it('sends formatted alert message to admin recipients', async () => {
    const baseConfig = makeConfig({
      groups: { command: [], announcement: [], alertAdmin: [] },
      admins: ['admin1@s.whatsapp.net', 'admin2@s.whatsapp.net'],
    });
    // Override just defaultRecipients
    const config = { ...baseConfig, alerts: { ...baseConfig.alerts, defaultRecipients: 'admin' as const } };
    const { orch, waClient } = makeOrchestrator({ config });

    await orch.deliverAlerts(sampleAlerts, false);

    expect(waClient.sendMessage).toHaveBeenCalledTimes(2);
    expect(waClient.sendMessage).toHaveBeenCalledWith('admin1@s.whatsapp.net', expect.any(String));
    expect(waClient.sendMessage).toHaveBeenCalledWith('admin2@s.whatsapp.net', expect.any(String));
  });

  it('sends to alertAdmin recipients when defaultRecipients is group', async () => {
    const baseConfig = makeConfig({
      groups: { command: [], announcement: [], alertAdmin: ['alert1@g.us'] },
      admins: ['admin1@s.whatsapp.net'],
    });
    const config = { ...baseConfig, alerts: { ...baseConfig.alerts, defaultRecipients: 'group' as const } };
    const { orch, waClient } = makeOrchestrator({ config });

    await orch.deliverAlerts(sampleAlerts, false);

    expect(waClient.sendMessage).toHaveBeenCalledTimes(1);
    expect(waClient.sendMessage).toHaveBeenCalledWith('alert1@g.us', expect.any(String));
  });

  it('returns silently when WA not connected', async () => {
    const { orch, waClient } = makeOrchestrator({
      waClient: makeWaClient({ isConnected: jest.fn().mockReturnValue(false) }),
    });

    await orch.deliverAlerts(sampleAlerts, false);

    expect(waClient.sendMessage).not.toHaveBeenCalled();
  });

  it('returns silently when alerts array is empty', async () => {
    const { orch, waClient } = makeOrchestrator();

    await orch.deliverAlerts([], false);

    expect(waClient.sendMessage).not.toHaveBeenCalled();
  });

  it('continues when some sends fail', async () => {
    const baseConfig = makeConfig({
      groups: { command: [], announcement: [], alertAdmin: [] },
      admins: ['admin1@s.whatsapp.net', 'admin2@s.whatsapp.net'],
    });
    const config = { ...baseConfig, alerts: { ...baseConfig.alerts, defaultRecipients: 'admin' as const } };
    const { orch, waClient } = makeOrchestrator({ config });

    waClient.sendMessage
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce(undefined);

    await orch.deliverAlerts(sampleAlerts, false);

    expect(waClient.sendMessage).toHaveBeenCalledTimes(2);
  });
});


describe('ReportOrchestrator — alignSnapshotToMonth', () => {
  afterEach(() => restoreDateMocks());

  it('returns snapshot unchanged for monthly type', async () => {
    mockCurrentDate(2026, 6, 15);
    const { orch } = makeOrchestrator();
    const snapshot = loadRealSnapshot();

    const result = await orch.alignSnapshotToMonth('monthly', snapshot, makeConfig());

    expect(result).toBe(snapshot);
  });

  it('returns snapshot unchanged when daily snapshot month matches current', async () => {
    mockCurrentDate(2026, 6, 12);
    const { orch, config } = makeOrchestrator();
    const snapshot = loadRealSnapshot();

    const result = await orch.alignSnapshotToMonth('daily', snapshot, config);

    expect(result).toBe(snapshot);
  });

  it('fetches fresh data when daily snapshot is from different month', async () => {
    mockCurrentDate(2026, 7, 5);
    const freshSnapshot = loadRealSnapshot();
    const mockFetch = jest.fn().mockResolvedValue(freshSnapshot);
    const { orch, config } = makeOrchestrator();
    (orch as any).umaMoe = { fetchCircleData: mockFetch };
    const snapshot = loadRealSnapshot();

    const result = await orch.alignSnapshotToMonth('daily', snapshot, config);

    expect(mockFetch).toHaveBeenCalled();
    expect(result).toBe(freshSnapshot);
  });

  it('fetches fresh data when weekly snapshot is from different month', async () => {
    mockCurrentDate(2026, 7, 5);
    const freshSnapshot = loadRealSnapshot();
    const mockFetch = jest.fn().mockResolvedValue(freshSnapshot);
    const { orch, config } = makeOrchestrator();
    (orch as any).umaMoe = { fetchCircleData: mockFetch };
    const snapshot = loadRealSnapshot();

    await orch.alignSnapshotToMonth('weekly', snapshot, config);

    expect(mockFetch).toHaveBeenCalled();
  });

  it('does NOT fetch when snapshot month matches for ranks type', async () => {
    mockCurrentDate(2026, 6, 12);
    const mockFetch = jest.fn();
    const { orch, config } = makeOrchestrator();
    (orch as any).umaMoe = { fetchCircleData: mockFetch };
    const snapshot = loadRealSnapshot();

    await orch.alignSnapshotToMonth('ranks', snapshot, config);

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws when fresh data fetch fails for month misalignment', async () => {
    mockCurrentDate(2026, 7, 5);
    const mockFetch = jest.fn().mockRejectedValue(new Error('network error'));
    const { orch, config } = makeOrchestrator();
    (orch as any).umaMoe = { fetchCircleData: mockFetch };
    const snapshot = loadRealSnapshot();

    await expect(orch.alignSnapshotToMonth('daily', snapshot, config))
      .rejects.toThrow('Tidak ada data untuk daily report bulan ini');
  });
});


describe('ReportOrchestrator — buildReportString', () => {
  it('returns report string for known type', async () => {
    const { orch } = makeOrchestrator();
    const snapshot = loadRealSnapshot();
    const config = makeConfig();
    const { computeMembers } = require('../../src/reports/compute');
    const members = computeMembers(snapshot, config);

    const result = await orch.buildReportString('daily', snapshot, config, members);

    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
    expect(result!.length).toBeGreaterThan(0);
  });

  it('returns undefined for unknown type', async () => {
    const { orch } = makeOrchestrator();
    const snapshot = loadRealSnapshot();
    const config = makeConfig();
    const { computeMembers } = require('../../src/reports/compute');
    const members = computeMembers(snapshot, config);

    const result = await orch.buildReportString('nonexistent', snapshot, config, members);

    expect(result).toBeUndefined();
  });

  it('inserts catch-up tag below title when isCatchUp is true', async () => {
    const { orch } = makeOrchestrator();
    const snapshot = loadRealSnapshot();
    const config = makeConfig();
    const { computeMembers } = require('../../src/reports/compute');
    const members = computeMembers(snapshot, config);

    const result = await orch.buildReportString('daily', snapshot, config, members, { isCatchUp: true });

    expect(result).toBeDefined();
    expect(result).toContain('*⚠️ Catch-up*');
    // Tag should appear after the title line (second line, after blank line)
    const lines = result!.split('\n');
    expect(lines[0]).toMatch(/^\📊/);
    expect(lines[2]).toBe('*⚠️ Catch-up*');
  });

  it('does not insert catch-up tag when isCatchUp is false', async () => {
    const { orch } = makeOrchestrator();
    const snapshot = loadRealSnapshot();
    const config = makeConfig();
    const { computeMembers } = require('../../src/reports/compute');
    const members = computeMembers(snapshot, config);

    const result = await orch.buildReportString('daily', snapshot, config, members, { isCatchUp: false });

    expect(result).toBeDefined();
    expect(result).not.toContain('Catch-up');
  });
});

describe('ReportOrchestrator — generateCombinedReportString', () => {
  it('returns combined report string', () => {
    const { orch } = makeOrchestrator();
    const snapshot = loadRealSnapshot();
    const config = makeConfig();
    const { computeMembers } = require('../../src/reports/compute');
    const members = computeMembers(snapshot, config);

    const result = orch.generateCombinedReportString(['daily', 'weekly'], snapshot, config, members);

    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});


// Module-level mock for detectAlerts — controlled per test via mockReturnValue
const mockDetectAlerts = jest.fn().mockResolvedValue([]);
jest.mock('../../src/alerts/alerts', () => {
  const actual = jest.requireActual('../../src/alerts/alerts');
  return { ...actual, detectAlerts: (...args: any[]) => mockDetectAlerts(...args) };
});

const sampleAlert: Alert = {
  type: 'performance_drop',
  eventKey: 'perf-123',
  memberViewerId: '12345',
  reportDate: '2025-06-12',
  message: 'Test alert message',
};

describe('ReportOrchestrator — processAlertsForReport', () => {
  beforeEach(() => {
    mockDetectAlerts.mockReset();
    mockDetectAlerts.mockResolvedValue([]);
  });

  it('returns empty array when no alerts detected', async () => {
    const { orch } = makeOrchestrator();
    const snapshot = loadRealSnapshot();
    const config = makeConfig();

    const result = await orch.processAlertsForReport('daily', snapshot, config, [] as any);

    expect(result).toEqual([]);
  });

  it('records each alert in DB when alerts exist', async () => {
    const mockRecordAlert = jest.fn().mockResolvedValue(1);
    const mockMarkAlertSent = jest.fn().mockResolvedValue(undefined);
    const { orch } = makeOrchestrator();
    (orch as any).db = { recordAlert: mockRecordAlert, markAlertSent: mockMarkAlertSent };
    mockDetectAlerts.mockResolvedValue([sampleAlert]);

    await orch.processAlertsForReport('daily', loadRealSnapshot(), makeConfig(), [] as any);

    expect(mockRecordAlert).toHaveBeenCalled();
    expect(mockMarkAlertSent).toHaveBeenCalled();
  });

  it('does not deliver alerts when collectAlerts is true', async () => {
    const mockSendMessage = jest.fn();
    const baseConfig = makeConfig({
      groups: { command: [], announcement: [], alertAdmin: ['alert@g.us'] },
      admins: [],
    });
    const config = { ...baseConfig, alerts: { ...baseConfig.alerts, defaultRecipients: 'group' as const } };
    const { orch } = makeOrchestrator({
      waClient: makeWaClient({ sendMessage: mockSendMessage }),
      config,
    });
    (orch as any).db = { recordAlert: jest.fn().mockResolvedValue(1), markAlertSent: jest.fn().mockResolvedValue(undefined) };
    mockDetectAlerts.mockResolvedValue([sampleAlert]);

    const result = await orch.processAlertsForReport('daily', loadRealSnapshot(), config, [] as any, { collectAlerts: true });

    expect(result.length).toBe(1);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('returns empty array when collectAlerts is true but no alerts', async () => {
    const { orch } = makeOrchestrator();

    const result = await orch.processAlertsForReport('daily', loadRealSnapshot(), makeConfig(), [] as any, { collectAlerts: true });

    expect(result).toEqual([]);
  });

  it('continues when alert processing encounters an error', async () => {
    const { orch } = makeOrchestrator();
    (orch as any).db = { recordAlert: jest.fn().mockImplementation(async () => { throw new Error('DB error'); }), markAlertSent: jest.fn().mockResolvedValue(undefined) };
    mockDetectAlerts.mockResolvedValue([sampleAlert]);

    // Should not throw — error is caught internally
    const result = await orch.processAlertsForReport('daily', loadRealSnapshot(), makeConfig(), [] as any);

    expect(result).toEqual([]);
  });
});


describe('ReportOrchestrator — sendCombinedCatchUp', () => {
  it('calls processAlertsForReport for each type in the combined set', async () => {
    const snapshot = loadRealSnapshot();
    const { orch, config, waClient } = makeOrchestrator({
      waClient: makeWaClient(),
    });
    (orch as any).getSnapshot = jest.fn().mockReturnValue(snapshot);

    const spy = jest.spyOn(orch, 'processAlertsForReport').mockResolvedValue([]);

    await orch.sendCombinedCatchUp(['daily', 'weekly']);

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledWith('daily', snapshot, config, expect.any(Array), { isCatchUp: true, collectAlerts: true });
    expect(spy).toHaveBeenCalledWith('weekly', snapshot, config, expect.any(Array), { isCatchUp: true, collectAlerts: true });

    spy.mockRestore();
  });

  it('aggregates alerts from all combined types', async () => {
    const snapshot = loadRealSnapshot();
    const { orch, waClient } = makeOrchestrator({
      waClient: makeWaClient(),
    });
    (orch as any).getSnapshot = jest.fn().mockReturnValue(snapshot);

    const alertA: Alert = { type: 'performance_drop', eventKey: 'a', memberViewerId: '1', reportDate: '2025-06-12', message: 'A' };
    const alertB: Alert = { type: 'streak_break', eventKey: 'b', memberViewerId: '2', reportDate: '2025-06-12', message: 'B' };

    const spy = jest.spyOn(orch, 'processAlertsForReport')
      .mockResolvedValueOnce([alertA])
      .mockResolvedValueOnce([alertB]);

    const result = await orch.sendCombinedCatchUp(['daily', 'weekly']);

    expect(result).toHaveLength(2);
    expect(result).toContainEqual(alertA);
    expect(result).toContainEqual(alertB);

    spy.mockRestore();
  });
});


describe('ReportOrchestrator — sendReport', () => {
  it('throws when no snapshot available', async () => {
    const { orch } = makeOrchestrator();

    await expect(orch.sendReport('daily')).rejects.toThrow('No snapshot available');
  });

  it('throws when snapshot has no members', async () => {
    const { orch } = makeOrchestrator();
    (orch as any).getSnapshot = jest.fn().mockReturnValue({ members: [], circle: {} });

    await expect(orch.sendReport('daily')).rejects.toThrow('Snapshot has no members');
  });

  it('delivers report to announcement groups', async () => {
    const snapshot = loadRealSnapshot();
    const mockSendMessage = jest.fn().mockResolvedValue(undefined);
    const { orch, config } = makeOrchestrator({
      waClient: makeWaClient({ sendMessage: mockSendMessage }),
    });
    (orch as any).getSnapshot = jest.fn().mockReturnValue(snapshot);

    await orch.sendReport('daily');

    expect(mockSendMessage).toHaveBeenCalled();
    const firstCall = mockSendMessage.mock.calls[0];
    expect(firstCall[0]).toMatch(/@/);
    expect(typeof firstCall[1]).toBe('string');
  });

  it('returns empty array for unknown report type', async () => {
    const snapshot = loadRealSnapshot();
    const { orch } = makeOrchestrator();
    (orch as any).getSnapshot = jest.fn().mockReturnValue(snapshot);

    const result = await orch.sendReport('nonexistent');

    expect(result).toEqual([]);
  });
});
