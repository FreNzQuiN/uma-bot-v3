/**
 * Tests for command dispatch logic.
 *
 * Verifies the dispatch flow: parse message → check access → generate report → send.
 * Uses mocked WhatsApp client, config, and snapshot.
 *
 * For group commands, sendOrEdit is called twice:
 *   1. Loading message (null messageId → returns messageId)
 *   2. Final report (with messageId → edits the loading message)
 */

import { setupCommandHandler } from "../../src/whatsapp/dispatch";
import {
  WhatsAppClient,
  IncomingMessage,
  MessageHandler,
} from "../../src/whatsapp/client";
import { getDefaultConfig } from "../../src/config";
import type { BotConfig, Snapshot } from "../../src/types";
import type { IDatabase } from "../../src/db/types";
import type { DeepPartial } from "../_helpers";
import { makeConfig as makeConfigBase, makeMessage } from "../_helpers";

// Prevent admin command tests from writing to the actual config.yaml
jest.mock("../../src/config", () => {
  const actual = jest.requireActual("../../src/config");
  return { ...actual, saveConfig: jest.fn() };
});

// Mock loadMonthSnapshot for /analyze offset tests
jest.mock("../../src/data/snapshot", () => {
  const actual = jest.requireActual("../../src/data/snapshot");
  return { ...actual, loadMonthSnapshot: jest.fn() };
});

import { loadMonthSnapshot } from "../../src/data/snapshot";
const mockLoadMonthSnapshots = loadMonthSnapshot as jest.MockedFunction<
  typeof loadMonthSnapshot
>;

const ADMIN_JID = "6281234567890@s.whatsapp.net";
const NON_ADMIN_JID = "6289999999999@s.whatsapp.net";
const COMMAND_GROUP = "group-cmd@g.us";
const OTHER_GROUP = "group-other@g.us";
const PRIVATE_CHAT = "6281111111111@s.whatsapp.net";

const MONTHLY_REQUIREMENT = 30_000_000;
const SNAPSHOT_MONTHLY_POINT = 1_000_000;
const FANS_TO_NEXT_TIER = 500_000;
const FANS_TO_LOWER_TIER = 50_000;
const YESTERDAY_FANS_TO_NEXT_TIER = 600_000;
const YESTERDAY_FANS_TO_LOWER_TIER = 40_000;

function makeConfig(overrides: DeepPartial<BotConfig> = {}): BotConfig {
  return makeConfigBase({
    admins: [ADMIN_JID],
    groups: { command: [COMMAND_GROUP], announcement: [], alertAdmin: [] },
    ...overrides,
  });
}

function makeSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    circle: {
      circle_id: 100,
      name: "TestClub",
      comment: "",
      leader_viewer_id: 1,
      leader_name: "Leader",
      member_count: 2,
      join_style: 0,
      policy: 0,
      created_at: "",
      last_updated: "2026-06-12T14:00:00Z",
      monthly_rank: 100,
      monthly_point: SNAPSHOT_MONTHLY_POINT,
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
        circle_id: 100,
        viewer_id: 1001,
        trainer_name: "Alice",
        shame_score: null,
        year: 2026,
        month: 6,
        daily_fans: [
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 100, 200, 300, 0, 0, 0, 0, 0, 0, 0, 0,
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ],
        last_updated: "2026-06-12",
      },
      {
        id: 2,
        circle_id: 100,
        viewer_id: 1002,
        trainer_name: "Bob",
        shame_score: null,
        year: 2026,
        month: 6,
        daily_fans: [
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 50, 100, 150, 0, 0, 0, 0, 0, 0, 0, 0, 0,
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ],
        last_updated: "2026-06-12",
      },
    ],
    club_rank: 8,
    fans_to_next_tier: FANS_TO_NEXT_TIER,
    fans_to_lower_tier: FANS_TO_LOWER_TIER,
    yesterday_fans_to_next_tier: YESTERDAY_FANS_TO_NEXT_TIER,
    yesterday_fans_to_lower_tier: YESTERDAY_FANS_TO_LOWER_TIER,
    ...overrides,
  };
}

function makeMockDb(): IDatabase {
  return {
    recordAlert: jest.fn(),
    getMembers: jest.fn().mockReturnValue([]),
    getMember: jest.fn().mockReturnValue(null),
    upsertMember: jest.fn(),
    saveRankHistory: jest.fn(),
    getLastSuccessfulRun: jest.fn().mockReturnValue(null),
    getLastRun: jest.fn().mockReturnValue(null),
    recordRun: jest.fn(),
    updateRunStatus: jest.fn(),
  } as unknown as IDatabase;
}

describe("setupCommandHandler", () => {
  let mockDb: IDatabase;
  let mockClient: jest.Mocked<WhatsAppClient>;
  let config: BotConfig;
  let snapshot: Snapshot;
  let messageHandler: ((msg: IncomingMessage) => void) | null;
  let sentMessages: { jid: string; text: string }[];

  beforeEach(() => {
    messageHandler = null;
    sentMessages = [];
    mockDb = makeMockDb();
    config = makeConfig();
    snapshot = makeSnapshot();

    mockClient = {
      onMessage: jest.fn((handler: MessageHandler) => {
        messageHandler = handler;
      }),
      sendMessage: jest.fn(async (jid: string, text: string) => {
        sentMessages.push({ jid, text });
      }),
      sendOrEdit: jest.fn(
        async (jid: string, _msgId: string | null, text: string) => {
          sentMessages.push({ jid, text });
          return "sent-msg-id";
        },
      ),
      connect: jest.fn(),
      disconnect: jest.fn(),
    } as unknown as jest.Mocked<WhatsAppClient>;
  });

  it("can be called without errors (wiring smoke test)", () => {
    const getSnapshot = () => snapshot;
    expect(() =>
      setupCommandHandler(mockClient, config, mockDb, getSnapshot),
    ).not.toThrow();
  });

  it("registers a message handler on the client", () => {
    const getSnapshot = () => snapshot;
    setupCommandHandler(mockClient, config, mockDb, getSnapshot);
    expect(mockClient.onMessage).toHaveBeenCalledTimes(1);
    expect(messageHandler).not.toBeNull();
  });

  it("parses and dispatches /daily command", async () => {
    const getSnapshot = () => snapshot;
    setupCommandHandler(mockClient, config, mockDb, getSnapshot);

    const msg = makeMessage({ message: { conversation: "/daily" } });
    await messageHandler!(msg);

    expect(mockClient.sendOrEdit).toHaveBeenCalledTimes(2);
    expect(sentMessages[0].text).toMatch(/^⏳ /);
    expect(sentMessages[1].text).toContain("Daily");
    expect(sentMessages[1].jid).toBe(COMMAND_GROUP);
  });

  it("parses and dispatches /weekly command", async () => {
    const getSnapshot = () => snapshot;
    setupCommandHandler(mockClient, config, mockDb, getSnapshot);

    const msg = makeMessage({ message: { conversation: "/weekly" } });
    await messageHandler!(msg);

    expect(mockClient.sendOrEdit).toHaveBeenCalledTimes(2);
    expect(sentMessages[1].text).toContain("Weekly");
  });

  it("parses and dispatches /monthly command", async () => {
    const getSnapshot = () => snapshot;
    setupCommandHandler(mockClient, config, mockDb, getSnapshot);

    const msg = makeMessage({ message: { conversation: "/monthly" } });
    await messageHandler!(msg);

    expect(mockClient.sendOrEdit).toHaveBeenCalledTimes(2);
    expect(sentMessages[1].text).toContain("Monthly");
  });

  it("parses and dispatches /ranks command", async () => {
    const getSnapshot = () => snapshot;
    setupCommandHandler(mockClient, config, mockDb, getSnapshot);

    const msg = makeMessage({ message: { conversation: "/ranks" } });
    await messageHandler!(msg);

    expect(mockClient.sendOrEdit).toHaveBeenCalledTimes(2);
    expect(sentMessages[1].text).toMatch(/Rank|Peringkat/i);
  });

  it("parses and dispatches /stats command", async () => {
    const getSnapshot = () => snapshot;
    setupCommandHandler(mockClient, config, mockDb, getSnapshot);

    const msg = makeMessage({ message: { conversation: "/stats" } });
    await messageHandler!(msg);

    expect(mockClient.sendOrEdit).toHaveBeenCalledTimes(2);
    expect(sentMessages[1].text).toContain("Stat");
  });

  it("parses and dispatches /bottom command", async () => {
    const getSnapshot = () => snapshot;
    setupCommandHandler(mockClient, config, mockDb, getSnapshot);

    const msg = makeMessage({ message: { conversation: "/bottom" } });
    await messageHandler!(msg);

    expect(mockClient.sendOrEdit).toHaveBeenCalledTimes(2);
    expect(sentMessages[1].text).toMatch(/Bottom|Perlu Perhatian/i);
  });

  it("parses and dispatches /members command", async () => {
    const getSnapshot = () => snapshot;
    setupCommandHandler(mockClient, config, mockDb, getSnapshot);

    const msg = makeMessage({ message: { conversation: "/members" } });
    await messageHandler!(msg);

    expect(mockClient.sendOrEdit).toHaveBeenCalledTimes(2);
    expect(sentMessages[1].text).toMatch(/Member|Anggota/i);
  });

  it("parses and dispatches /tier command", async () => {
    const getSnapshot = () => snapshot;
    setupCommandHandler(mockClient, config, mockDb, getSnapshot);

    const msg = makeMessage({ message: { conversation: "/tier" } });
    await messageHandler!(msg);

    expect(mockClient.sendOrEdit).toHaveBeenCalledTimes(2);
    expect(sentMessages[1].text).toContain("Tier");
  });

  it("silently ignores non-admin using admin command /setreq in command group", async () => {
    const getSnapshot = () => snapshot;
    setupCommandHandler(mockClient, config, mockDb, getSnapshot);

    const msg = makeMessage({
      key: {
        remoteJid: COMMAND_GROUP,
        id: "msg-001",
        participant: NON_ADMIN_JID,
      },
      message: { conversation: "/setreq" },
    });
    await messageHandler!(msg);

    expect(mockClient.sendOrEdit).not.toHaveBeenCalled();
  });

  it("allows admin using /setreq in command group", async () => {
    const getSnapshot = () => snapshot;
    setupCommandHandler(mockClient, config, mockDb, getSnapshot);

    const msg = makeMessage({
      key: { remoteJid: COMMAND_GROUP, id: "msg-001", participant: ADMIN_JID },
      message: { conversation: "/setreq" },
    });
    await messageHandler!(msg);

    expect(mockClient.sendOrEdit).toHaveBeenCalledTimes(1);
    expect(sentMessages[0].text).toContain("Requirement");
  });

  it("allows admin using /config in command group", async () => {
    const getSnapshot = () => snapshot;
    setupCommandHandler(mockClient, config, mockDb, getSnapshot);

    const msg = makeMessage({
      key: { remoteJid: COMMAND_GROUP, id: "msg-001", participant: ADMIN_JID },
      message: { conversation: "/config" },
    });
    await messageHandler!(msg);

    expect(mockClient.sendOrEdit).toHaveBeenCalledTimes(1);
    expect(sentMessages[0].text).toContain("System Config");
  });

  it("allows admin using /status in command group", async () => {
    const getSnapshot = () => snapshot;
    setupCommandHandler(mockClient, config, mockDb, getSnapshot);

    const msg = makeMessage({
      key: { remoteJid: COMMAND_GROUP, id: "msg-001", participant: ADMIN_JID },
      message: { conversation: "/status" },
    });
    await messageHandler!(msg);

    expect(mockClient.sendOrEdit).toHaveBeenCalledTimes(1);
    expect(sentMessages[0].text).toContain("Status");
  });

  it("ignores non-command messages", async () => {
    const getSnapshot = () => snapshot;
    setupCommandHandler(mockClient, config, mockDb, getSnapshot);

    const msg = makeMessage({ message: { conversation: "Hello everyone!" } });
    await messageHandler!(msg);

    expect(mockClient.sendOrEdit).not.toHaveBeenCalled();
    expect(mockClient.sendMessage).not.toHaveBeenCalled();
  });

  it("silently ignores report command from non-command group for non-admin", async () => {
    const getSnapshot = () => snapshot;
    setupCommandHandler(mockClient, config, mockDb, getSnapshot);

    const msg = makeMessage({
      key: {
        remoteJid: OTHER_GROUP,
        id: "msg-001",
        participant: NON_ADMIN_JID,
      },
      message: { conversation: "/daily" },
    });
    await messageHandler!(msg);

    expect(mockClient.sendOrEdit).not.toHaveBeenCalled();
  });

  it("returns error when no snapshot available", async () => {
    const getSnapshot = () => null;
    setupCommandHandler(mockClient, config, mockDb, getSnapshot);

    const msg = makeMessage({ message: { conversation: "/daily" } });
    await messageHandler!(msg);

    expect(mockClient.sendOrEdit).toHaveBeenCalledTimes(1);
    expect(sentMessages[0].text).toMatch(
      /tidak ada data|belum ada data|snapshot/i,
    );
  });

  it("sends loading message first, then edits to result", async () => {
    const getSnapshot = () => snapshot;
    setupCommandHandler(mockClient, config, mockDb, getSnapshot);

    const msg = makeMessage({
      key: { remoteJid: COMMAND_GROUP, id: "msg-001" },
      message: { conversation: "/daily" },
    });
    await messageHandler!(msg);

    expect(mockClient.sendOrEdit).toHaveBeenCalledTimes(2);
    expect(mockClient.sendOrEdit).toHaveBeenNthCalledWith(
      1,
      COMMAND_GROUP,
      null,
      expect.stringMatching(/^⏳ /),
    );
    expect(mockClient.sendOrEdit).toHaveBeenNthCalledWith(
      2,
      COMMAND_GROUP,
      "sent-msg-id",
      expect.stringContaining("Daily"),
    );
  });

  it("handles /compare with two member names", async () => {
    const getSnapshot = () => snapshot;
    setupCommandHandler(mockClient, config, mockDb, getSnapshot);

    const msg = makeMessage({
      message: { conversation: "/compare Alice Bob" },
    });
    await messageHandler!(msg);

    expect(mockClient.sendOrEdit).toHaveBeenCalledTimes(2);
    expect(sentMessages[1].text).toContain("Compare");
  });

  it("handles /analyze with a member name", async () => {
    const getSnapshot = () => snapshot;
    setupCommandHandler(mockClient, config, mockDb, getSnapshot);

    const msg = makeMessage({ message: { conversation: "/analyze Alice" } });
    await messageHandler!(msg);

    expect(mockClient.sendOrEdit).toHaveBeenCalledTimes(2);
    expect(sentMessages[1].text).toContain("Analyze");
  });

  it("handles unknown command gracefully", async () => {
    const getSnapshot = () => snapshot;
    setupCommandHandler(mockClient, config, mockDb, getSnapshot);

    const msg = makeMessage({ message: { conversation: "/unknown" } });
    await messageHandler!(msg);

    // Unknown command: 1 call (no loading, just the error message)
    expect(mockClient.sendOrEdit).toHaveBeenCalledTimes(1);
    expect(sentMessages[0].text).toMatch(
      /tidak dikenal|tidak tersedia|unknown/i,
    );
  });

  it("uses sender JID from participant for group messages", async () => {
    const getSnapshot = () => snapshot;
    setupCommandHandler(mockClient, config, mockDb, getSnapshot);

    const msg = makeMessage({
      key: {
        remoteJid: COMMAND_GROUP,
        id: "msg-001",
        participant: NON_ADMIN_JID,
      },
      message: { conversation: "/daily" },
    });
    await messageHandler!(msg);

    // Non-admin in command group: allowed for report commands
    expect(mockClient.sendOrEdit).toHaveBeenCalledTimes(2);
    expect(sentMessages[1].text).toContain("Daily");
  });

  it("handles /daily with offset", async () => {
    const getSnapshot = () => snapshot;
    setupCommandHandler(mockClient, config, mockDb, getSnapshot);

    const msg = makeMessage({ message: { conversation: "/daily 1" } });
    await messageHandler!(msg);

    expect(mockClient.sendOrEdit).toHaveBeenCalledTimes(2);
    expect(sentMessages[1].text).toContain("Daily");
  });

  it("handles empty message text gracefully", async () => {
    const getSnapshot = () => snapshot;
    setupCommandHandler(mockClient, config, mockDb, getSnapshot);

    const msg = makeMessage({ message: { conversation: "" } });
    await messageHandler!(msg);

    expect(mockClient.sendOrEdit).not.toHaveBeenCalled();
    expect(mockClient.sendMessage).not.toHaveBeenCalled();
  });

  it("handles message with no conversation or extendedTextMessage", async () => {
    const getSnapshot = () => snapshot;
    setupCommandHandler(mockClient, config, mockDb, getSnapshot);

    const msg = makeMessage({ message: {} });
    await messageHandler!(msg);

    expect(mockClient.sendOrEdit).not.toHaveBeenCalled();
    expect(mockClient.sendMessage).not.toHaveBeenCalled();
  });

  it("admin command /setreq shows current requirements when no args", async () => {
    const getSnapshot = () => snapshot;
    setupCommandHandler(mockClient, config, mockDb, getSnapshot);

    const msg = makeMessage({
      key: { remoteJid: COMMAND_GROUP, id: "msg-001", participant: ADMIN_JID },
      message: { conversation: "/setreq" },
    });
    await messageHandler!(msg);

    expect(mockClient.sendOrEdit).toHaveBeenCalledTimes(1);
    expect(sentMessages[0].text).toContain("Monthly");
    expect(sentMessages[0].text).toContain("Weekly");
  });

  it("admin command /catchup on/off", async () => {
    const getSnapshot = () => snapshot;
    setupCommandHandler(mockClient, config, mockDb, getSnapshot);

    const msg = makeMessage({
      key: { remoteJid: COMMAND_GROUP, id: "msg-001", participant: ADMIN_JID },
      message: { conversation: "/catchup on" },
    });
    await messageHandler!(msg);

    expect(mockClient.sendOrEdit).toHaveBeenCalledTimes(1);
    expect(sentMessages[0].text).toContain("diaktifkan");
  });

  it("admin command /alerts on/off", async () => {
    const getSnapshot = () => snapshot;
    setupCommandHandler(mockClient, config, mockDb, getSnapshot);

    const msg = makeMessage({
      key: { remoteJid: COMMAND_GROUP, id: "msg-001", participant: ADMIN_JID },
      message: { conversation: "/alerts off" },
    });
    await messageHandler!(msg);

    expect(mockClient.sendOrEdit).toHaveBeenCalledTimes(1);
    expect(sentMessages[0].text).toContain("dinonaktifkan");
  });

  it("admin /compare with missing args shows usage", async () => {
    const getSnapshot = () => snapshot;
    setupCommandHandler(mockClient, config, mockDb, getSnapshot);

    const msg = makeMessage({
      message: { conversation: "/compare" },
    });
    await messageHandler!(msg);

    expect(mockClient.sendOrEdit).toHaveBeenCalledTimes(2);
    expect(sentMessages[1].text).toContain("Cara pakai");
  });

  it("admin /analyze with missing name shows usage", async () => {
    const getSnapshot = () => snapshot;
    setupCommandHandler(mockClient, config, mockDb, getSnapshot);

    const msg = makeMessage({
      message: { conversation: "/analyze" },
    });
    await messageHandler!(msg);

    expect(mockClient.sendOrEdit).toHaveBeenCalledTimes(2);
    expect(sentMessages[1].text).toContain("Cara pakai");
  });

  it("rejects /daily offset exceeding maxDailyOffset", async () => {
    const cfg = makeConfig({
      commands: {
        prefixes: ["/"],
        maxDailyOffset: 3,
        maxWeeklyOffset: 5,
        maxMonthlyOffset: 12,
      },
    });
    const getSnapshot = () => snapshot;
    setupCommandHandler(mockClient, cfg, mockDb, getSnapshot);

    const msg = makeMessage({ message: { conversation: "/daily 10" } });
    await messageHandler!(msg);

    // Group: 1 call (error, no loading because it's before report generation)
    expect(mockClient.sendOrEdit).toHaveBeenCalledTimes(1);
    expect(sentMessages[0].text).toMatch(/maksimal|max|Offset/i);
  });

  it("accepts /daily offset within maxDailyOffset", async () => {
    const cfg = makeConfig({
      commands: {
        prefixes: ["/"],
        maxDailyOffset: 31,
        maxWeeklyOffset: 5,
        maxMonthlyOffset: 12,
      },
    });
    const getSnapshot = () => snapshot;
    setupCommandHandler(mockClient, cfg, mockDb, getSnapshot);

    const msg = makeMessage({ message: { conversation: "/daily 2" } });
    await messageHandler!(msg);

    // Should produce report, not error
    expect(mockClient.sendOrEdit).toHaveBeenCalledTimes(2);
    expect(sentMessages[1].text).toContain("Daily");
  });

  it("rejects /weekly offset exceeding maxWeeklyOffset", async () => {
    const cfg = makeConfig({
      commands: {
        prefixes: ["/"],
        maxDailyOffset: 31,
        maxWeeklyOffset: 2,
        maxMonthlyOffset: 12,
      },
    });
    const getSnapshot = () => snapshot;
    setupCommandHandler(mockClient, cfg, mockDb, getSnapshot);

    const msg = makeMessage({ message: { conversation: "/weekly 5" } });
    await messageHandler!(msg);

    expect(mockClient.sendOrEdit).toHaveBeenCalledTimes(1);
    expect(sentMessages[0].text).toMatch(/maksimal|max|Offset/i);
  });

  it("rejects /monthly offset exceeding maxMonthlyOffset", async () => {
    const cfg = makeConfig({
      commands: {
        prefixes: ["/"],
        maxDailyOffset: 31,
        maxWeeklyOffset: 5,
        maxMonthlyOffset: 2,
      },
    });
    const getSnapshot = () => snapshot;
    setupCommandHandler(mockClient, cfg, mockDb, getSnapshot);

    const msg = makeMessage({ message: { conversation: "/monthly 10" } });
    await messageHandler!(msg);

    expect(mockClient.sendOrEdit).toHaveBeenCalledTimes(1);
    expect(sentMessages[0].text).toMatch(/maksimal|max|Offset/i);
  });

  it("rejects negative offset exceeding max (uses absolute value)", async () => {
    const cfg = makeConfig({
      commands: {
        prefixes: ["/"],
        maxDailyOffset: 3,
        maxWeeklyOffset: 5,
        maxMonthlyOffset: 12,
      },
    });
    const getSnapshot = () => snapshot;
    setupCommandHandler(mockClient, cfg, mockDb, getSnapshot);

    const msg = makeMessage({ message: { conversation: "/daily -10" } });
    await messageHandler!(msg);

    expect(mockClient.sendOrEdit).toHaveBeenCalledTimes(1);
    expect(sentMessages[0].text).toMatch(/maksimal|max|Offset/i);
  });

  it("resolves case-insensitive name for /analyze via dispatch", async () => {
    const getSnapshot = () => snapshot;
    setupCommandHandler(mockClient, config, mockDb, getSnapshot);

    const msg = makeMessage({ message: { conversation: "/analyze alice" } });
    await messageHandler!(msg);

    expect(mockClient.sendOrEdit).toHaveBeenCalledTimes(2);
    expect(sentMessages[1].text).toContain("Analyze");
    expect(sentMessages[1].text).toContain("Alice");
  });

  it("resolves partial name for /analyze via dispatch", async () => {
    const getSnapshot = () => snapshot;
    setupCommandHandler(mockClient, config, mockDb, getSnapshot);

    // 'Ali' is a unique prefix of 'Alice'
    const msg = makeMessage({ message: { conversation: "/analyze Ali" } });
    await messageHandler!(msg);

    expect(mockClient.sendOrEdit).toHaveBeenCalledTimes(2);
    expect(sentMessages[1].text).toContain("Analyze");
    expect(sentMessages[1].text).toContain("Alice");
  });

  it("resolves fuzzy name for /analyze via dispatch", async () => {
    const getSnapshot = () => snapshot;
    setupCommandHandler(mockClient, config, mockDb, getSnapshot);

    // 'Aice' is NOT a substring of 'Alice' but is within Levenshtein distance 1
    // This requires step 4 (fuzzy) in resolveMemberName, not step 3 (partial)
    const msg = makeMessage({ message: { conversation: "/analyze Aice" } });
    await messageHandler!(msg);

    expect(mockClient.sendOrEdit).toHaveBeenCalledTimes(2);
    expect(sentMessages[1].text).toContain("Analyze");
    expect(sentMessages[1].text).toContain("Alice");
  });

  it("/analyze Alice -1 extracts offset from last arg and generates report", async () => {
    const prevSnapshot: Snapshot = {
      ...snapshot,
      members: [
        {
          ...snapshot.members[0],
          year: 2026,
          month: 5,
          daily_fans: [
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 50, 100, 150, 0, 0, 0, 0, 0, 0, 0, 0,
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
          ],
        },
      ],
    };
    mockLoadMonthSnapshots.mockReturnValue(prevSnapshot);

    const getSnapshot = () => snapshot;
    setupCommandHandler(mockClient, config, mockDb, getSnapshot);

    const msg = makeMessage({ message: { conversation: "/analyze Alice -1" } });
    await messageHandler!(msg);

    expect(mockClient.sendOrEdit).toHaveBeenCalledTimes(2);
    expect(sentMessages[1].text).toContain("Analyze");
    expect(sentMessages[1].text).toContain("Alice");
    expect(mockLoadMonthSnapshots).toHaveBeenCalledWith(2026, 5);
  });

  it("/analyze Alice -99 rejected when exceeding maxAnalyzeOffset", async () => {
    const getSnapshot = () => snapshot;
    setupCommandHandler(mockClient, config, mockDb, getSnapshot);

    const msg = makeMessage({
      message: { conversation: "/analyze Alice -99" },
    });
    await messageHandler!(msg);

    expect(mockClient.sendOrEdit).toHaveBeenCalledTimes(1);
    expect(sentMessages[0].text).toMatch(/maksimal|max|Offset/i);
  });

  it("/analyze Alice (no offset) still works — regression guard", async () => {
    const getSnapshot = () => snapshot;
    setupCommandHandler(mockClient, config, mockDb, getSnapshot);

    const msg = makeMessage({ message: { conversation: "/analyze Alice" } });
    await messageHandler!(msg);

    expect(mockClient.sendOrEdit).toHaveBeenCalledTimes(2);
    expect(sentMessages[1].text).toContain("Analyze");
    expect(sentMessages[1].text).toContain("Alice");
  });

  it("/analyze Alice -1 -2 — only last numeric arg is offset", async () => {
    const getSnapshot = () => snapshot;
    setupCommandHandler(mockClient, config, mockDb, getSnapshot);

    const msg = makeMessage({
      message: { conversation: "/analyze Alice -1 -2" },
    });
    await messageHandler!(msg);

    expect(mockClient.sendOrEdit).toHaveBeenCalledTimes(2);
    expect(sentMessages[1].text).toContain("tidak ditemukan");
  });

  it("/analyze Alice -1 where Alice not in previous month → tidak ditemukan", async () => {
    const prevSnapshot: Snapshot = {
      ...snapshot,
      members: [
        {
          ...snapshot.members.find((m) => m.trainer_name === "Bob")!,
          year: 2026,
          month: 5,
        },
      ],
    };
    mockLoadMonthSnapshots.mockReturnValue(prevSnapshot);

    const getSnapshot = () => snapshot;
    setupCommandHandler(mockClient, config, mockDb, getSnapshot);

    const msg = makeMessage({ message: { conversation: "/analyze Alice -1" } });
    await messageHandler!(msg);

    expect(mockClient.sendOrEdit).toHaveBeenCalledTimes(2);
    expect(sentMessages[1].text).toContain("tidak ditemukan");
  });

  it("resolves case-insensitive names for /compare via dispatch", async () => {
    const getSnapshot = () => snapshot;
    setupCommandHandler(mockClient, config, mockDb, getSnapshot);

    const msg = makeMessage({
      message: { conversation: "/compare alice bob" },
    });
    await messageHandler!(msg);

    expect(mockClient.sendOrEdit).toHaveBeenCalledTimes(2);
    expect(sentMessages[1].text).toContain("Compare");
    expect(sentMessages[1].text).toContain("Alice");
    expect(sentMessages[1].text).toContain("Bob");
  });

  it("applies config change from /setreq monthly and uses it in subsequent reports", async () => {
    const cfg = makeConfig();
    const getSnapshot = () => snapshot;

    setupCommandHandler(mockClient, cfg, mockDb, getSnapshot);

    const setReqMsg = makeMessage({
      key: { remoteJid: COMMAND_GROUP, id: "msg-001", participant: ADMIN_JID },
      message: { conversation: `/setreq monthly ${MONTHLY_REQUIREMENT}` },
    });
    await messageHandler!(setReqMsg);

    expect(sentMessages[0].text).toContain("30.0M");

    // Verify the change was applied internally
    sentMessages.length = 0;
    const configMsg = makeMessage({
      key: { remoteJid: COMMAND_GROUP, id: "msg-002", participant: ADMIN_JID },
      message: { conversation: "/config" },
    });
    await messageHandler!(configMsg);

    expect(sentMessages[0].text).toContain("30.0M");
  });

  it("applies config change from /catchup on", async () => {
    const cfg = makeConfig({
      catchUp: { enabled: false, maxReportsPerStartup: 10 },
    });
    const getSnapshot = () => snapshot;

    setupCommandHandler(mockClient, cfg, mockDb, getSnapshot);

    const msg = makeMessage({
      key: { remoteJid: COMMAND_GROUP, id: "msg-001", participant: ADMIN_JID },
      message: { conversation: "/catchup on" },
    });
    await messageHandler!(msg);

    expect(sentMessages[0].text).toContain("diaktifkan");

    sentMessages.length = 0;
    const configMsg = makeMessage({
      key: { remoteJid: COMMAND_GROUP, id: "msg-002", participant: ADMIN_JID },
      message: { conversation: "/config" },
    });
    await messageHandler!(configMsg);

    expect(sentMessages[0].text).toMatch(
      /Catch-up.*yes|Catch-up.*on|Enabled.*yes/i,
    );
  });

  it("applies config change from /alerts off", async () => {
    const cfg = makeConfig({
      alerts: { ...getDefaultConfig().alerts, enabled: true },
    });
    const getSnapshot = () => snapshot;

    setupCommandHandler(mockClient, cfg, mockDb, getSnapshot);

    const msg = makeMessage({
      key: { remoteJid: COMMAND_GROUP, id: "msg-001", participant: ADMIN_JID },
      message: { conversation: "/alerts off" },
    });
    await messageHandler!(msg);

    expect(sentMessages[0].text).toContain("dinonaktifkan");

    sentMessages.length = 0;
    const configMsg = makeMessage({
      key: { remoteJid: COMMAND_GROUP, id: "msg-002", participant: ADMIN_JID },
      message: { conversation: "/config" },
    });
    await messageHandler!(configMsg);

    expect(sentMessages[0].text).toMatch(/Alerts.*no|Alerts.*off|Enabled.*no/i);
  });

  it("dispatches /help for admin in command group", async () => {
    const getSnapshot = () => snapshot;
    setupCommandHandler(mockClient, config, mockDb, getSnapshot);

    const msg = makeMessage({
      key: { remoteJid: COMMAND_GROUP, id: "msg-001", participant: ADMIN_JID },
      message: { conversation: "/help" },
    });
    await messageHandler!(msg);

    // Help: 1 call (no loading, no snapshot needed)
    expect(mockClient.sendOrEdit).toHaveBeenCalledTimes(1);
    expect(sentMessages[0].text).toContain("Command Registry");
    expect(sentMessages[0].text).toContain("Admin");
  });

  it("dispatches /help for non-admin in command group", async () => {
    const getSnapshot = () => snapshot;
    setupCommandHandler(mockClient, config, mockDb, getSnapshot);

    const msg = makeMessage({
      key: {
        remoteJid: COMMAND_GROUP,
        id: "msg-001",
        participant: NON_ADMIN_JID,
      },
      message: { conversation: "/help" },
    });
    await messageHandler!(msg);

    expect(mockClient.sendOrEdit).toHaveBeenCalledTimes(1);
    expect(sentMessages[0].text).toContain("Command Registry");
    // Non-admin should NOT see admin section
    expect(sentMessages[0].text).not.toContain("*Admin Only:*");
  });

  it("blocks /help for non-admin in unconfigured group", async () => {
    const getSnapshot = () => snapshot;
    setupCommandHandler(mockClient, config, mockDb, getSnapshot);

    const msg = makeMessage({
      key: {
        remoteJid: OTHER_GROUP,
        id: "msg-001",
        participant: NON_ADMIN_JID,
      },
      message: { conversation: "/help" },
    });
    await messageHandler!(msg);

    // No bypass — unconfigured groups silently ignore all commands
    expect(mockClient.sendOrEdit).not.toHaveBeenCalled();
  });

  it("blocks /help for non-admin in private chat", async () => {
    const getSnapshot = () => snapshot;
    setupCommandHandler(mockClient, config, mockDb, getSnapshot);

    const msg = makeMessage({
      key: { remoteJid: PRIVATE_CHAT, id: "msg-001" },
      message: { conversation: "/help" },
    });
    await messageHandler!(msg);

    expect(mockClient.sendOrEdit).not.toHaveBeenCalled();
  });

  it("/help does not require snapshot (in command group)", async () => {
    const getSnapshot = () => null;
    setupCommandHandler(mockClient, config, mockDb, getSnapshot);

    const msg = makeMessage({
      key: {
        remoteJid: COMMAND_GROUP,
        id: "msg-001",
        participant: NON_ADMIN_JID,
      },
      message: { conversation: "/help" },
    });
    await messageHandler!(msg);

    expect(mockClient.sendOrEdit).toHaveBeenCalledTimes(1);
    expect(sentMessages[0].text).toContain("Command Registry");
  });
});
