/**
 * Unit tests for WhatsAppClient class.
 *
 * Covers: isConnected, getConnectionState, cacheSentMessage, sendMessage,
 * sendOrEdit, sendMessageWithRetry, and disconnect.
 *
 * createBaileysLogger is NOT exported — tested indirectly through connect().
 */

import { WhatsAppClient } from "../../src/whatsapp/client";
import { getDefaultConfig } from "../../src/config";
import type { BotConfig } from "../../src/types";

jest.mock("../../src/runtime", () => ({
  recordReconnect: jest.fn(),
  recordMessageReceived: jest.fn(),
  recordMessageParsed: jest.fn(),
  recordMessageResponded: jest.fn(),
  recordMessageFailed: jest.fn(),
  recordSocketCreated: jest.fn(),
  recordDisconnect: jest.fn(),
  recordConnectionState: jest.fn(),
  getRuntimeStats: jest.fn(() => ({
    messagesReceived: 0,
    reconnectCount: 0,
    socketCreatedCount: 0,
  })),
}));

jest.mock("../../src/utils/logger", () => ({
  log: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock("../../src/utils/format", () => ({
  splitMessage: jest.fn(),
}));

jest.mock("../../src/whatsapp/auth-cleanup", () => ({
  runAuthCleanup: jest.fn(),
  deleteCorruptedSenderKey: jest.fn().mockReturnValue(false),
}));

import { splitMessage } from "../../src/utils/format";
import { recordMessageResponded, recordMessageFailed } from "../../src/runtime";
import { deleteCorruptedSenderKey } from "../../src/whatsapp/auth-cleanup";

const mockSplitMessage = splitMessage as jest.MockedFunction<
  typeof splitMessage
>;

const getConfig = () => getDefaultConfig();

function makeMockSock(overrides: Record<string, unknown> = {}): any {
  return {
    user: { id: "12345:67890@s.whatsapp.net" },
    sendMessage: jest.fn().mockResolvedValue({ key: { id: "msg-1" } }),
    end: jest.fn(),
    ...overrides,
  };
}

function makeClient(overrides: Record<string, unknown> = {}): {
  client: WhatsAppClient;
  sock: any;
} {
  const client = new WhatsAppClient(getConfig);
  const sock = makeMockSock();
  (client as any).sock = sock;
  (client as any).connectionState = "open";
  // Apply any overrides to the injected sock or client fields
  for (const [key, value] of Object.entries(overrides)) {
    (client as any)[key] = value;
  }
  return { client, sock };
}

describe("WhatsAppClient", () => {
  describe("isConnected", () => {
    it("returns false when sock is null", () => {
      const client = new WhatsAppClient(getConfig);
      // sock is null by default from constructor
      expect(client.isConnected()).toBe(false);
    });

    it("returns false when sock exists but user is undefined", () => {
      const client = new WhatsAppClient(getConfig);
      (client as any).sock = {
        user: undefined,
        sendMessage: jest.fn(),
        end: jest.fn(),
      };
      (client as any).connectionState = "open";
      expect(client.isConnected()).toBe(false);
    });

    it("returns false when connectionState is not open", () => {
      const client = new WhatsAppClient(getConfig);
      (client as any).sock = makeMockSock();
      (client as any).connectionState = "connecting";
      expect(client.isConnected()).toBe(false);
    });

    it("returns true when sock, user, and connectionState=open are all set", () => {
      const { client } = makeClient();
      expect(client.isConnected()).toBe(true);
    });
  });

  describe("getConnectionState", () => {
    it("returns disconnected by default", () => {
      const client = new WhatsAppClient(getConfig);
      expect(client.getConnectionState()).toBe("disconnected");
    });

    it("returns the current connection state", () => {
      const client = new WhatsAppClient(getConfig);
      (client as any).connectionState = "open";
      expect(client.getConnectionState()).toBe("open");
    });

    it("returns connecting when set", () => {
      const client = new WhatsAppClient(getConfig);
      (client as any).connectionState = "connecting";
      expect(client.getConnectionState()).toBe("connecting");
    });
  });

  describe("cacheSentMessage", () => {
    it("caches message when result has key.id and message", () => {
      const { client } = makeClient();
      (client as any).cacheSentMessage({
        key: { id: "abc-123" },
        message: { conversation: "hello" },
      });
      const cache: Map<string, unknown> = (client as any).messageCache;
      expect(cache.size).toBe(1);
      expect(cache.get("abc-123")).toEqual({ conversation: "hello" });
    });

    it("does NOT cache when result is undefined", () => {
      const { client } = makeClient();
      (client as any).cacheSentMessage(undefined);
      const cache: Map<string, unknown> = (client as any).messageCache;
      expect(cache.size).toBe(0);
    });

    it("does NOT cache when key.id is missing", () => {
      const { client } = makeClient();
      (client as any).cacheSentMessage({
        key: { id: null },
        message: { conversation: "hello" },
      });
      const cache: Map<string, unknown> = (client as any).messageCache;
      expect(cache.size).toBe(0);
    });

    it("does NOT cache when message field is missing", () => {
      const { client } = makeClient();
      (client as any).cacheSentMessage({
        key: { id: "abc-123" },
      });
      const cache: Map<string, unknown> = (client as any).messageCache;
      expect(cache.size).toBe(0);
    });

    it("evicts oldest entries when cache exceeds MESSAGE_CACHE_MAX", () => {
      const { client } = makeClient();
      const cache: Map<string, unknown> = (client as any).messageCache;

      // MESSAGE_CACHE_MAX = 2000 (source: src/whatsapp/client.ts)
      const CACHE_MAX = 2000;
      // MESSAGE_CACHE_EVICT = 500 (source: src/whatsapp/client.ts)
      const CACHE_EVICT = 500;

      // Fill cache to exactly MESSAGE_CACHE_MAX
      for (let i = 0; i < CACHE_MAX; i++) {
        cache.set(`msg-${i}`, { text: `part-${i}` });
      }
      expect(cache.size).toBe(CACHE_MAX);

      // Adding one more triggers eviction of MESSAGE_CACHE_EVICT entries
      (client as any).cacheSentMessage({
        key: { id: "msg-overflow" },
        message: { text: "overflow" },
      });

      // Size should be CACHE_MAX + 1 - CACHE_EVICT
      expect(cache.size).toBe(CACHE_MAX + 1 - CACHE_EVICT);
      expect(cache.has("msg-overflow")).toBe(true);
      // Oldest entries should be gone
      expect(cache.has("msg-0")).toBe(false);
      expect(cache.has(`msg-${CACHE_EVICT - 1}`)).toBe(false);
      // Later entries should remain
      expect(cache.has(`msg-${CACHE_EVICT}`)).toBe(true);
    });
  });

  describe("sendMessage", () => {
    it("throws when sock is null", async () => {
      const client = new WhatsAppClient(getConfig);
      // sock is null by default
      await expect(client.sendMessage("12345@g.us", "hello")).rejects.toThrow(
        "WhatsApp client not connected",
      );
    });

    it("calls sock.sendMessage for each split part", async () => {
      const { client, sock } = makeClient();
      mockSplitMessage.mockReturnValue(["Part 1", "Part 2"]);

      await client.sendMessage("12345@g.us", "long message");

      expect(sock.sendMessage).toHaveBeenCalledTimes(2);
      expect(sock.sendMessage).toHaveBeenCalledWith("12345@g.us", {
        text: "Part 1",
      });
      expect(sock.sendMessage).toHaveBeenCalledWith("12345@g.us", {
        text: "Part 2",
      });
    });

    it("caches sent message after sending", async () => {
      const { client, sock } = makeClient();
      mockSplitMessage.mockReturnValue(["hello"]);
      sock.sendMessage.mockResolvedValue({
        key: { id: "sent-msg-1" },
        message: { conversation: "hello" },
      });

      await client.sendMessage("12345@g.us", "hello");

      const cache: Map<string, unknown> = (client as any).messageCache;
      expect(cache.has("sent-msg-1")).toBe(true);
    });

    it("uses config maxLength and splitAtNewline", async () => {
      const { client } = makeClient();
      mockSplitMessage.mockReturnValue(["short"]);

      await client.sendMessage("12345@g.us", "short");

      const config = getConfig();
      expect(mockSplitMessage).toHaveBeenCalledWith(
        "short",
        config.message.maxLength,
        config.message.splitAtNewline,
      );
    });
  });

  describe("sendOrEdit", () => {
    it("throws when sock is null", async () => {
      const client = new WhatsAppClient(getConfig);
      await expect(
        client.sendOrEdit("12345@g.us", null, "hello"),
      ).rejects.toThrow("WhatsApp client not connected");
    });

    it("records messageFailed when sock is null", async () => {
      const client = new WhatsAppClient(getConfig);
      await expect(
        client.sendOrEdit("12345@g.us", null, "hello"),
      ).rejects.toThrow();
      expect(recordMessageFailed).toHaveBeenCalled();
    });

    it("single part + messageId: edits in-place and returns messageId", async () => {
      const { client, sock } = makeClient();
      mockSplitMessage.mockReturnValue(["edited content"]);

      const result = await client.sendOrEdit(
        "12345@g.us",
        "orig-msg-id",
        "edited content",
      );

      expect(result).toBe("orig-msg-id");
      expect(sock.sendMessage).toHaveBeenCalledWith("12345@g.us", {
        text: "edited content",
        edit: { id: "orig-msg-id", remoteJid: "12345@g.us", fromMe: true },
      });
      expect(recordMessageResponded).toHaveBeenCalled();
    });

    it("single part + no messageId: sends new and returns new message ID", async () => {
      const { client, sock } = makeClient();
      mockSplitMessage.mockReturnValue(["new message"]);
      sock.sendMessage.mockResolvedValue({ key: { id: "new-msg-1" } });

      const result = await client.sendOrEdit("12345@g.us", null, "new message");

      expect(result).toBe("new-msg-1");
      expect(sock.sendMessage).toHaveBeenCalledWith("12345@g.us", {
        text: "new message",
      });
    });

    it("single part + messageId + edit fails: falls back to send new", async () => {
      const { client, sock } = makeClient();
      mockSplitMessage.mockReturnValue(["fallback"]);

      // First call (edit) fails, second call (send) succeeds
      sock.sendMessage
        .mockRejectedValueOnce(new Error("edit failed"))
        .mockResolvedValueOnce({ key: { id: "fallback-msg" } });

      const result = await client.sendOrEdit(
        "12345@g.us",
        "orig-id",
        "fallback",
      );

      expect(result).toBe("fallback-msg");
      expect(sock.sendMessage).toHaveBeenCalledTimes(2);
    });

    it("multi-part + messageId: deletes loading message, sends all parts", async () => {
      const { client, sock } = makeClient();
      mockSplitMessage.mockReturnValue(["Part A", "Part B"]);

      let callCount = 0;
      sock.sendMessage.mockImplementation(
        async (_jid: string, content: any) => {
          callCount++;
          if (callCount === 1) {
            // Delete call — no return value needed
            return undefined;
          }
          return { key: { id: `part-${callCount}` } };
        },
      );

      const result = await client.sendOrEdit(
        "12345@g.us",
        "loading-id",
        "multi",
      );

      // First call: delete, then 2 sends
      expect(sock.sendMessage).toHaveBeenCalledTimes(3);
      expect(sock.sendMessage.mock.calls[0][1]).toEqual({
        delete: { id: "loading-id", remoteJid: "12345@g.us", fromMe: true },
      });
      expect(result).toBe("part-3");
    });

    it("multi-part + no messageId: sends all parts without delete", async () => {
      const { client, sock } = makeClient();
      mockSplitMessage.mockReturnValue(["Part 1", "Part 2"]);

      let callCount = 0;
      sock.sendMessage.mockImplementation(async () => {
        callCount++;
        return { key: { id: `multi-${callCount}` } };
      });

      const result = await client.sendOrEdit("12345@g.us", null, "multi");

      expect(sock.sendMessage).toHaveBeenCalledTimes(2);
      expect(result).toBe("multi-2");
    });

    it("multi-part delete failure is swallowed (best effort)", async () => {
      const { client, sock } = makeClient();
      mockSplitMessage.mockReturnValue(["A"]);

      let callCount = 0;
      sock.sendMessage.mockImplementation(
        async (_jid: string, content: any) => {
          callCount++;
          if (callCount === 1) {
            throw new Error("delete failed");
          }
          return { key: { id: "recovered" } };
        },
      );

      const result = await client.sendOrEdit(
        "12345@g.us",
        "loading",
        "content",
      );

      // Despite delete failure, send still succeeds
      expect(result).toBe("recovered");
    });
  });

  describe("sendMessageWithRetry", () => {
    it("calls sock.sendMessage and caches result", async () => {
      const { client, sock } = makeClient();
      sock.sendMessage.mockResolvedValue({
        key: { id: "retry-1" },
        message: { text: "hi" },
      });

      const result = await (client as any).sendMessageWithRetry("12345@g.us", {
        text: "hi",
      });

      expect(result).toEqual({
        key: { id: "retry-1" },
        message: { text: "hi" },
      });
      expect(sock.sendMessage).toHaveBeenCalledWith("12345@g.us", {
        text: "hi",
      });
      const cache: Map<string, unknown> = (client as any).messageCache;
      expect(cache.has("retry-1")).toBe(true);
    });

    it("throws on error", async () => {
      const { client } = makeClient();
      (client as any).sock.sendMessage.mockRejectedValue(
        new Error("network timeout"),
      );

      await expect(
        (client as any).sendMessageWithRetry("12345@g.us", { text: "fail" }),
      ).rejects.toThrow("network timeout");
    });

    it("auto-deletes corrupted sender key for senderMessageKeys error", async () => {
      const { log } = require("../../src/utils/logger");
      const { client } = makeClient();
      (client as any).sock.sendMessage.mockRejectedValue(
        new Error("senderMessageKeys corrupted"),
      );

      await expect(
        (client as any).sendMessageWithRetry("12345@g.us", { text: "fail" }),
      ).rejects.toThrow("senderMessageKeys corrupted");

      expect(log.warn).toHaveBeenCalledWith(
        "WhatsApp",
        expect.stringContaining("auto-deleting"),
      );
      expect(deleteCorruptedSenderKey).toHaveBeenCalledWith(
        expect.any(String),
        "12345@g.us",
      );
    });

    it("auto-deletes corrupted sender key for SenderKeyState error", async () => {
      const { log } = require("../../src/utils/logger");
      const { client } = makeClient();
      (client as any).sock.sendMessage.mockRejectedValue(
        new Error("SenderKeyState not found"),
      );

      await expect(
        (client as any).sendMessageWithRetry("12345@g.us", { text: "fail" }),
      ).rejects.toThrow("SenderKeyState not found");

      expect(log.warn).toHaveBeenCalledWith(
        "WhatsApp",
        expect.stringContaining("auto-deleting"),
      );
      expect(deleteCorruptedSenderKey).toHaveBeenCalledWith(
        expect.any(String),
        "12345@g.us",
      );
    });
  });

  describe("disconnect", () => {
    it("sets connectionState to disconnected", () => {
      const { client } = makeClient();
      client.disconnect();
      expect(client.getConnectionState()).toBe("disconnected");
    });

    it("clears messageCache", () => {
      const { client } = makeClient();
      const cache: Map<string, unknown> = (client as any).messageCache;
      cache.set("msg-1", { text: "cached" });

      client.disconnect();

      expect(cache.size).toBe(0);
    });

    it("calls sock.end()", () => {
      const { client, sock } = makeClient();
      client.disconnect();
      expect(sock.end).toHaveBeenCalledWith(undefined);
    });

    it("sets sock to null", () => {
      const { client } = makeClient();
      client.disconnect();
      expect((client as any).sock).toBeNull();
    });

    it("clears messageHandlers", () => {
      const { client } = makeClient();
      (client as any).messageHandlers = [jest.fn(), jest.fn()];

      client.disconnect();

      expect((client as any).messageHandlers).toEqual([]);
    });

    it("resets reconnectAttempts to 0", () => {
      const { client } = makeClient();
      (client as any).reconnectAttempts = 5;

      client.disconnect();

      expect((client as any).reconnectAttempts).toBe(0);
    });

    it("does not throw when sock is already null", () => {
      const client = new WhatsAppClient(getConfig);
      expect(() => client.disconnect()).not.toThrow();
    });
  });
});
