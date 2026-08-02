/**
 * WhatsApp connection manager for Uma Club Bot v3.
 *
 * Wraps @whiskeysockets/baileys for WhatsApp Web multi-device connection.
 * Handles connection lifecycle, message sending, and message editing.
 */

import type { WASocket } from "@whiskeysockets/baileys";
import type { BotConfig } from "../types";
import { log } from "../utils/logger";
import { splitMessage } from "../utils/format";
import { rmSync, existsSync, readdirSync } from "node:fs";
import {
  recordReconnect,
  recordMessageReceived,
  recordMessageParsed,
  recordMessageResponded,
  recordMessageFailed,
  recordSocketCreated,
  recordDisconnect,
  getRuntimeStats,
  recordConnectionState,
} from "../runtime";
import {
  runAuthCleanup,
  deleteCorruptedSenderKey,
  backupCreds,
  restoreCredsBackup,
  isCredsUsable,
  resetSignalState,
  pruneStaleSignalState,
  pruneStaleSenderKeys,
  resolveProtectedLids,
  shouldPurgeSignalState,
  writeLastConnect,
} from "./auth-cleanup";

/** badSession attempts within this window escalate: reconnect → reset → wipe. */
const BAD_SESSION_WINDOW_MS = 60 * 60 * 1000;

/** Maintenance cadence while connected. */
const AUTH_MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** 3rd badSession in the window triggers the full wipe. */
const BAD_SESSION_WIPE_THRESHOLD = 3;

/** Liveness heartbeat log interval — 30 seconds. */
const HEARTBEAT_INTERVAL_MS = 30_000;

/** Timeout for the initial connection (QR scan + auth). */
const CONNECT_TIMEOUT_MS = 120_000;

/** Delay before reconnecting after a logout or badSession reset. */
const RECONNECT_AFTER_RESET_MS = 2000;

/** Reconnect backoff cap — 5 minutes. */
const MAX_RECONNECT_DELAY_MS = 300_000;

/** Milliseconds per day, for retention-based age math. */
const DAY_MS = 24 * 60 * 60 * 1000;

export type BadSessionAction = "reconnect" | "reset-signal" | "wipe";

export interface BadSessionDecision {
  action: BadSessionAction;
  count: number;
}

/**
 * Escalation ladder for badSession (500) disconnects.
 *
 * Within the 1h window: 1st → plain reconnect, 2nd → surgical signal state
 * reset, 3rd → full wipe + QR. After the window expires the count restarts.
 */
export function getBadSessionDecision(
  currentCount: number,
  firstTs: number | null,
  now: number,
): BadSessionDecision {
  const inWindow = firstTs !== null && now - firstTs <= BAD_SESSION_WINDOW_MS;
  const count = inWindow ? currentCount + 1 : 1;
  let action: BadSessionAction;
  if (count >= BAD_SESSION_WIPE_THRESHOLD) action = "wipe";
  else if (count === 2) action = "reset-signal";
  else action = "reconnect";
  return { action, count };
}

export interface IncomingMessage {
  key: {
    remoteJid: string;
    id: string;
    participant?: string;
  };
  message?: {
    conversation?: string;
    extendedTextMessage?: {
      text?: string;
    };
  };
  pushName?: string;
}

export type MessageHandler = (msg: IncomingMessage) => Promise<void>;

/**
 * libsignal/src/session_cipher.js writes decryption failures directly to
 * console.error (bypassing pino). These are handled internally by Baileys
 * via retry requests — the console output is redundant noise.
 */
let _libsignalSuppressed = false;
function suppressLibsignalErrors(): void {
  if (_libsignalSuppressed) return;
  _libsignalSuppressed = true;
  const originalConsoleError = console.error.bind(console);
  console.error = (...args: any[]) => {
    const joined = args.join(" ");
    if (
      joined.includes("Failed to decrypt message") ||
      joined.includes("Session error") ||
      joined.includes("Bad MAC")
    ) {
      log.debug("WhatsApp", `libsignal noise suppressed: ${joined}`);
      return;
    }
    originalConsoleError(...args);
  };
}

/**
 * Baileys logs decryption failures ("failed to decrypt message") at error
 * level but handles them via automatic retry requests — treating them as
 * errors is misleading, they are normal operational noise.
 */
function createBaileysLogger() {
  const suppressPatterns = ["failed to decrypt message", "unexpected error in"];

  const adapter = {
    level: "warn",

    fatal: (obj: unknown, msg?: string) => {
      const message = msg || (typeof obj === "string" ? obj : "");
      log.error("Baileys", message, obj instanceof Error ? obj : undefined);
    },

    error: (obj: unknown, msg?: string) => {
      const message = msg || (typeof obj === "string" ? obj : "");
      for (const pattern of suppressPatterns) {
        if (message.includes(pattern)) return;
      }
      log.warn("Baileys", message);
    },

    warn: (obj: unknown, msg?: string) => {
      const message = msg || (typeof obj === "string" ? obj : "");
      log.warn("Baileys", message);
    },

    info: (obj: unknown, msg?: string) => {
      const message = msg || (typeof obj === "string" ? obj : "");
      log.info("Baileys", message);
    },

    debug: (obj: unknown, msg?: string) => {
      const message = msg || (typeof obj === "string" ? obj : "");
      log.debug("Baileys", message);
    },

    trace: (obj: unknown, msg?: string) => {
      const message = msg || (typeof obj === "string" ? obj : "");
      log.debug("Baileys", message);
    },

    child: () => adapter,
  };

  return adapter;
}

export class WhatsAppClient {
  private sock: WASocket | null = null;
  private getConfig: () => BotConfig;
  private messageHandlers: MessageHandler[] = [];
  private reconnectAttempts = 0;
  private baseReconnectDelay = 1000;
  private connectionState: string = "disconnected";
  private lastMessageCount = 0;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private authDir = process.env.WA_SESSION_DIR ?? "data/auth";
  private badSessionCount = 0;
  private firstBadSessionTs: number | null = null;
  private authMaintenanceTimer: ReturnType<typeof setInterval> | null = null;
  private authMaintenanceRunning = false;
  private authFileCount = 0;
  private chats = new Map<
    string,
    { jid: string; name: string; type: "dm" | "group" }
  >();

  /**
   * Cache of recently sent outgoing messages, keyed by message ID.
   * Used by the getMessage callback so Baileys can re-encrypt and resend
   * when a recipient device requests a retry (fixes "Waiting for this message").
   */
  private messageCache = new Map<string, Record<string, unknown>>();
  static readonly MESSAGE_CACHE_MAX = 2000;
  static readonly MESSAGE_CACHE_EVICT = 500;

  constructor(getConfig: () => BotConfig) {
    this.getConfig = getConfig;
  }

  getConnectionState(): string {
    return this.connectionState;
  }

  isConnected(): boolean {
    return (
      this.sock !== null &&
      this.sock.user !== undefined &&
      this.connectionState === "open"
    );
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      const rt = getRuntimeStats();
      const msgsSinceLast = rt.messagesReceived - this.lastMessageCount;
      this.lastMessageCount = rt.messagesReceived;
      const jidInfo = this.sock?.user?.id
        ? this.sock.user.id.split(":")[0]
        : "no-jid";
      const mem = process.memoryUsage();
      log.info(
        "WhatsApp",
        `♥ heartbeat: state=${this.connectionState} jid=${jidInfo} msgs=${rt.messagesReceived} (+${msgsSinceLast} since last check) reconnects=${rt.reconnectCount} authFiles=${this.authFileCount} rss=${(mem.rss / 1048576).toFixed(0)}MB heap=${(mem.heapUsed / 1048576).toFixed(0)}MB`,
      );
    }, HEARTBEAT_INTERVAL_MS);
  }

  /**
   * Refresh the cached auth file count.
   *
   * Called on connect, after auth maintenance, and after a wipe. The heartbeat
   * logs this instead of readdirSync on a 3.6k-file directory every 30s.
   */
  private refreshAuthFileCount(): void {
    try {
      this.authFileCount = readdirSync(this.authDir).length;
    } catch {
      // auth dir can be absent between wipe and reconnect — not an error
      this.authFileCount = 0;
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    this.stopAuthMaintenance();
  }

  /**
   * Resolves only when actually connected (QR scanned + authenticated).
   */
  async connect(): Promise<void> {
    // End any existing socket before creating a new one.
    // Without this, the old socket's creds.update handler still calls its
    // saveCreds, writing to data/auth/ concurrently with the new socket's
    // saveCreds — corrupting creds.json (causes badSession / bad mac).
    if (this.sock) {
      this.sock.end(undefined);
      this.sock = null;
    }

    suppressLibsignalErrors();

    // Imports stay outside the connection-wait Promise below: an import
    // failure throws through the outer async method instead of hanging the
    // Promise forever, and the Promise wraps only the event wait.
    const Baileys = await import("@whiskeysockets/baileys");
    const makeWASocket = Baileys.default;
    const {
      useMultiFileAuthState,
      DisconnectReason,
      fetchLatestBaileysVersion,
      normalizeMessageContent,
    } = Baileys;
    // @ts-expect-error — no type declarations available for qrcode-terminal
    const qrcodeTerminal = await import("qrcode-terminal");

    const { mkdirSync, existsSync } = await import("fs");
    const { join } = await import("path");
    const authDir = this.authDir;
    if (!existsSync(authDir)) {
      mkdirSync(authDir, { recursive: true });
    }

    runAuthCleanup(authDir);

    // creds.json is the only file whose loss forces a QR re-scan. runAuthCleanup
    // already backs it up when usable; only restore here, when corrupt at startup.
    if (!isCredsUsable(authDir) && restoreCredsBackup(authDir)) {
      log.info("WhatsApp", "restored creds.json from backup");
    }

    // Long downtime → every Signal session is stale (members changed devices,
    // sessions rotated, LID migration happened). Keeping them guarantees
    // decrypt failures against the queued backlog. Purge all signal state so
    // the bot starts fresh: sessions/sender-keys/identity-keys re-establish
    // on demand via pre-key exchange. creds.json (identity, no QR) and
    // pre-keys (needed to decrypt sessions established while offline) are kept.
    if (shouldPurgeSignalState(authDir, this.getConfig().auth.purgeAfterDays)) {
      const reset = resetSignalState(authDir);
      log.info(
        "WhatsApp",
        `Long downtime detected — purged ${reset.deleted} stale signal files, starting fresh`,
      );
      this.refreshAuthFileCount();
    }

    // creds.json provides identity keys; session-*.json contain Signal
    // Protocol sessions for DM and group contacts.
    // Sessions are pruned by age (auth.retentionDays) once group
    // participants are known, and re-established automatically via pre-key
    // exchange when a message arrives — rc13's enableAutoSessionRecreation
    // + MessageRetryManager handle missing sessions on demand.
    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    const { version } = await fetchLatestBaileysVersion();

    const logger = createBaileysLogger();

    this.sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger,
      syncFullHistory: false,
      shouldIgnoreJid: () => false,
      /**
       * getMessage: Called by Baileys when a recipient device requests a retry
       * (can't decrypt our message). Baileys re-encrypts with a fresh session
       * and resends. Without this, Baileys logs "message not available" and the
       * recipient sees "Waiting for this message. This may take a while."
       *
       * See: lib/Socket/messages-recv.js sendMessagesAgain()
       * See: Types/Socket.d.ts getMessage docs
       */
      getMessage: async (key) => {
        return this.messageCache.get(key.id!) || undefined;
      },
      /**
       * patchMessageBeforeSending: Ensure pre-keys are uploaded to WhatsApp
       * servers before each send. This prevents "Waiting for this message"
       * caused by pre-key exhaustion — if the bot runs out of pre-keys,
       * new sessions cannot be established and messages can't be decrypted.
       *
       * See: https://github.com/WhiskeySockets/Baileys/issues/1006
       */
      patchMessageBeforeSending: async (msg) => {
        await this.sock!.uploadPreKeysToServerIfRequired();
        return msg;
      },
    });
    recordSocketCreated();
    log.debug(
      "WhatsApp",
      `Socket created (total=${getRuntimeStats().socketCreatedCount})`,
    );
    this.chats.clear();
    const sock = this.sock;

    sock.ev.on("creds.update", saveCreds);

    // Accumulate chats for /chats API endpoint
    sock.ev.on("chats.upsert", (newChats: any[]) => {
      for (const chat of newChats) {
        const jid: string = chat.id;
        if (!jid) continue;
        const isGroup = jid.endsWith("@g.us");
        this.chats.set(jid, {
          jid,
          name: chat.name ?? chat.subject ?? "",
          type: isGroup ? "group" : "dm",
        });
      }
    });

    sock.ev.on("messages.upsert", async (upt: any) => {
      const upsertType = upt.type;
      log.debug(
        "WhatsApp",
        `messages.upsert type=${upsertType} count=${upt.messages?.length ?? 0}`,
      );

      if (upsertType !== "notify") {
        log.debug(
          "WhatsApp",
          `Non-notify messages.upsert: type=${upsertType} count=${upt.messages?.length ?? 0}`,
        );
        return;
      }

      if (!upt?.messages || !Array.isArray(upt.messages)) {
        log.warn("WhatsApp", "messages.upsert event has no messages array");
        return;
      }

      for (const msg of upt.messages) {
        if (msg.key.remoteJid === "status@broadcast") continue;
        if (msg.key.fromMe) continue;

        recordMessageReceived();

        // Log raw message structure BEFORE normalize (for debugging protocol changes)
        const rawTypes = msg.message
          ? Object.keys(msg.message).join(",")
          : "no-message";
        log.debug(
          "WhatsApp",
          `RAW msg chat=${(msg.key.remoteJid ?? "").replace(/\d+/, "***")} pushName=${(msg.pushName ?? "?").substring(0, 20)} types=[${rawTypes}]`,
        );

        // Normalize message content: unwrap ephemeral, view-once, edited wrappers.
        // If the group has disappearing messages, the actual text is nested under
        // msg.message.ephemeralMessage.message.conversation — without this,
        // msg.message.conversation is undefined and commands silently fail.
        msg.message = normalizeMessageContent(msg.message) as any;

        const normTypes = msg.message
          ? Object.keys(msg.message).join(",")
          : "null";
        const extMsg = msg.message?.extendedTextMessage as
          Record<string, unknown> | undefined;
        // Use || not ?? — protobuf-decoded messages have conversation:"" (empty string),
        // which ?? treats as non-nullish, short-circuiting before reaching extendedTextMessage.text
        const textContent =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          (extMsg?.displayText as string) ||
          "";
        log.debug(
          "WhatsApp",
          `NORM msg chat=${(msg.key.remoteJid ?? "").replace(/\d+/, "***")} types=[${normTypes}] cmd="${textContent
            .split(/\s+/)[0]
            .slice(0, 20)
            .replace(/[\r\n]/g, " ")}"`,
        );

        if (!textContent) {
          log.warn(
            "WhatsApp",
            `Empty content after normalize — raw types were [${rawTypes}], norm types are [${normTypes}]`,
          );
        }

        for (const handler of this.messageHandlers) {
          try {
            await handler(msg as IncomingMessage);
          } catch (err) {
            recordMessageFailed();
            log.warn("WhatsApp", "Message handler error", err);
          }
        }
      }
    });

    // Wait for the connection event — imports above stay outside this Promise.
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Connection timeout")),
        CONNECT_TIMEOUT_MS,
      );

      sock.ev.on("connection.update", (update: any) => {
        const { connection, lastDisconnect, qr } = update;

        // Log ALL connection states — intermediate states like 'connecting' are informative
        if (connection) {
          this.connectionState = connection;
          recordConnectionState(connection);
          log.info(
            "WhatsApp",
            `Connection update: ${connection}${qr ? " (QR received)" : ""}`,
          );
        }

        if (qr) {
          qrcodeTerminal.generate(qr, { small: true });
          log.info("WhatsApp", "Scan QR code above to authenticate");
        }

        if (connection === "open") {
          clearTimeout(timeout);
          log.info("WhatsApp", "Connected successfully");
          this.reconnectAttempts = 0;
          this.badSessionCount = 0;
          this.firstBadSessionTs = null;
          this.startHeartbeat();
          // Started here (not after the connect() await) so a socket that opens
          // after the 120s connect timeout still gets the 24h maintenance cycle.
          this.startAuthMaintenance();
          // Connection rewrote creds.json via creds.update events — capture the
          // now-verified-good state before the socket can crash mid-write.
          if (isCredsUsable(authDir)) {
            backupCreds(authDir);
          }
          // Record the successful connection so the next startup can measure
          // genuine downtime (creds.json mtime is rewritten every connect and
          // would mask weeks-old sessions after repeated restarts).
          writeLastConnect(authDir);
          this.refreshAuthFileCount();
          if (sock.user?.id) {
            log.info(
              "WhatsApp",
              `Authenticated as: ${sock.user.id.split(":")[0]}`,
            );
          }
          resolve();
        }

        if (connection === "close") {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const errMsg = lastDisconnect?.error?.message ?? "Unknown error";
          const reasonName: string =
            statusCode !== undefined
              ? ((DisconnectReason[
                  statusCode as keyof typeof DisconnectReason
                ] as unknown as string) ?? `UNKNOWN(${statusCode})`)
              : "NO_STATUS";
          log.error(
            "WhatsApp",
            `Connection closed: reason=${reasonName}, error=${errMsg}`,
          );
          recordDisconnect(reasonName, errMsg);
          this.stopHeartbeat();

          // Settle the connect() promise when the socket closes before "open".
          // No-op after a successful open (promise already resolved). Without
          // this, a pre-open close hangs connect() forever and index.ts's
          // post-connect flow (catch-up) never runs for that boot.
          if (!(lastDisconnect?.error instanceof Error)) {
            reject(
              new Error(
                `Connection closed before open: ${reasonName} — ${errMsg}`,
              ),
            );
          } else {
            reject(lastDisconnect.error);
          }

          if (statusCode === DisconnectReason.loggedOut) {
            // Session revoked on the server (phone or WhatsApp Web devices).
            // No local state can fix this — wipe and force a fresh QR login.
            clearTimeout(timeout);
            this.sock = null;
            log.error(
              "WhatsApp",
              "Session revoked server-side — QR rescan required",
            );
            this.badSessionCount = 0;
            this.firstBadSessionTs = null;
            this.wipeAuthDir("logout");
            setTimeout(() => {
              this.connect().catch((err) => {
                log.error("WhatsApp", `Reconnection after logout failed`, err);
              });
            }, RECONNECT_AFTER_RESET_MS);
          } else if (statusCode === DisconnectReason.badSession) {
            // Bad sessions are often transient — wiping on the first
            // occurrence forces an avoidable QR scan.
            clearTimeout(timeout);
            this.sock = null;
            const decision = getBadSessionDecision(
              this.badSessionCount,
              this.firstBadSessionTs,
              Date.now(),
            );
            this.badSessionCount = decision.count;
            if (decision.count === 1) {
              this.firstBadSessionTs = Date.now();
            }
            if (decision.action === "reset-signal") {
              const reset = resetSignalState(this.authDir);
              log.warn(
                "WhatsApp",
                `badSession (attempt ${decision.count}/${BAD_SESSION_WIPE_THRESHOLD}) — surgical signal state reset (deleted ${reset.deleted} files)`,
              );
            } else if (decision.action === "wipe") {
              log.error(
                "WhatsApp",
                `badSession (attempt ${decision.count}/${BAD_SESSION_WIPE_THRESHOLD}) — full session wipe, QR rescan required`,
              );
              this.wipeAuthDir("badSession");
              this.badSessionCount = 0;
              this.firstBadSessionTs = null;
            } else {
              log.warn(
                "WhatsApp",
                `badSession (attempt ${decision.count}/${BAD_SESSION_WIPE_THRESHOLD}) — reconnecting without state reset`,
              );
            }
            setTimeout(() => {
              this.connect().catch((err) => {
                log.error(
                  "WhatsApp",
                  `Reconnection after badSession failed`,
                  err,
                );
              });
            }, RECONNECT_AFTER_RESET_MS);
          } else if (statusCode === DisconnectReason.restartRequired) {
            this.reconnectAttempts = 0;
            const delay = this.baseReconnectDelay;
            log.info(
              "WhatsApp",
              `Restart required, reconnecting in ${delay}ms`,
            );
            clearTimeout(timeout);
            recordReconnect();
            this.sock = null;
            setTimeout(() => {
              this.connect().catch((err) => {
                log.error(
                  "WhatsApp",
                  "Reconnection after restartRequired failed",
                  err,
                );
              });
            }, delay);
          } else {
            // connectionReplaced: another client took over — nothing local
            // to fix, just reconnect and keep going.
            if (statusCode === DisconnectReason.connectionReplaced) {
              log.warn(
                "WhatsApp",
                "Another connection replaced this session — plain reconnect",
              );
            }
            const delay = Math.min(
              this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts),
              MAX_RECONNECT_DELAY_MS,
            );
            this.reconnectAttempts++;
            log.warn(
              "WhatsApp",
              `Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`,
            );
            clearTimeout(timeout);
            recordReconnect();
            this.sock = null;
            setTimeout(() => {
              this.connect().catch((err) => {
                log.error("WhatsApp", "Reconnection failed", err);
              });
            }, delay);
          }
        }
      });
    });
  }

  /**
   * Send a text message to a JID.
   * Automatically splits long messages using the configured maxLength.
   */
  async sendMessage(jid: string, text: string): Promise<void> {
    if (!this.sock) {
      throw new Error("WhatsApp client not connected");
    }

    const config = this.getConfig();
    const parts = splitMessage(
      text,
      config.message.maxLength,
      config.message.splitAtNewline,
    );

    for (const part of parts) {
      const result = await this.sock.sendMessage(jid, { text: part });
      this.cacheSentMessage(result);
    }
  }

  /**
   * Send or edit a message.
   * Used for command responses: send a loading message, then edit to final result.
   */
  async sendOrEdit(
    jid: string,
    messageId: string | null,
    text: string,
  ): Promise<string> {
    if (!this.sock) {
      recordMessageFailed();
      throw new Error("WhatsApp client not connected");
    }

    const config = this.getConfig();
    const parts = splitMessage(
      text,
      config.message.maxLength,
      config.message.splitAtNewline,
    );

    const totalParts = parts.length;
    log.debug(
      "WhatsApp",
      `sendOrEdit: jid=${jid} parts=${totalParts} totalChars=${text.length} splitAtNewline=${config.message.splitAtNewline}`,
    );

    if (parts.length === 1) {
      if (messageId) {
        try {
          const key = { id: messageId, remoteJid: jid, fromMe: true };
          await this.sock.sendMessage(jid, {
            text: parts[0],
            edit: key,
          });
          recordMessageResponded();
          return messageId;
        } catch (err) {
          log.warn("WhatsApp", "Edit failed, sending as new message", err);
          // Fall through to send as new
        }
      }
      const sentMsg = await this.sendMessageWithRetry(jid, { text: parts[0] });
      recordMessageResponded();
      return sentMsg?.key?.id ?? "";
    }

    if (messageId) {
      try {
        const key = { id: messageId, remoteJid: jid, fromMe: true };
        await this.sock.sendMessage(jid, { delete: key });
      } catch (err) {
        log.debug(
          "WhatsApp",
          "Failed to delete loading message (best effort)",
          err,
        );
      }
    }

    let lastId = "";
    for (const part of parts) {
      const sentMsg = await this.sendMessageWithRetry(jid, { text: part });
      if (sentMsg?.key?.id) {
        lastId = sentMsg.key.id;
      }
    }
    recordMessageResponded();
    return lastId;
  }

  /**
   * Send a message with error handling for corrupted sender key records.
   * Automatically deletes the corrupted sender-key file so Baileys
   * recreates it on the next group message attempt.
   */
  private async sendMessageWithRetry(
    jid: string,
    content: Record<string, unknown>,
  ): Promise<{ key?: { id?: string | null } } | undefined> {
    try {
      const result = await this.sock!.sendMessage(jid, content as any);
      this.cacheSentMessage(result);
      return result;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("senderMessageKeys") || msg.includes("SenderKeyState")) {
        log.warn(
          "WhatsApp",
          `Corrupted sender key for ${jid.replace(/\d+/, "***")} — auto-deleting, will retry on next send`,
        );
        deleteCorruptedSenderKey(this.authDir, jid);
      }
      throw err;
    }
  }

  /**
   * Cache a sent message for Baileys getMessage retry recovery
   * (see the getMessage callback doc above).
   */
  private cacheSentMessage(
    result: { key?: { id?: string | null }; message?: any } | undefined,
  ): void {
    if (result?.key?.id && result.message) {
      this.messageCache.set(
        result.key.id,
        result.message as Record<string, unknown>,
      );
      if (this.messageCache.size > WhatsAppClient.MESSAGE_CACHE_MAX) {
        const evictCount = WhatsAppClient.MESSAGE_CACHE_EVICT;
        let evicted = 0;
        for (const key of this.messageCache.keys()) {
          if (evicted >= evictCount) break;
          this.messageCache.delete(key);
          evicted++;
        }
        log.debug(
          "WhatsApp",
          `Message cache evicted ${evicted} entries (cache size: ${this.messageCache.size})`,
        );
      }
    }
  }

  async getGroups(): Promise<
    Array<{ id: string; name: string; participants: number }>
  > {
    if (!this.sock) return [];
    const result = await this.sock.groupFetchAllParticipating();
    return Object.values(result).map((g) => ({
      id: g.id,
      name: g.subject,
      participants: g.participants.length,
    }));
  }

  /**
   * Get all chats seen since bot started (accumulated from chats.upsert events).
   */
  getChats(): Array<{ jid: string; name: string; type: "dm" | "group" }> {
    return Array.from(this.chats.values());
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler);
  }

  /**
   * Delete the entire auth directory.
   * Only for terminal states (loggedOut, 3rd badSession) — forces QR re-scan.
   */
  private wipeAuthDir(reasonLabel: string): void {
    try {
      if (existsSync(this.authDir)) {
        rmSync(this.authDir, { recursive: true, force: true });
        log.info(
          "WhatsApp",
          `Deleted stale session (${reasonLabel}) — reconnecting for QR scan`,
        );
      }
      this.refreshAuthFileCount();
    } catch (error) {
      log.warn("WhatsApp", "Failed to delete stale auth directory", error);
    }
  }

  /**
   * Periodic auth maintenance while connected: age-prune signal state.
   * Protected sets come from config + live group participants.
   *
   * When groupFetchAllParticipating throws, session/identity pruning is
   * skipped (without participant info we can't tell active members from
   * stale ones); sender-key pruning still runs with config groups.
   */
  async runAuthMaintenance(): Promise<void> {
    if (!this.isConnected() || this.authMaintenanceRunning) return;
    this.authMaintenanceRunning = true;
    try {
      const config = this.getConfig();
      const protectedGroups = new Set<string>([
        ...config.groups.command,
        ...config.groups.announcement,
        ...config.groups.alertAdmin,
      ]);
      const protectedJids = new Set<string>();
      for (const lid of resolveProtectedLids(this.authDir, config.admins)) {
        protectedJids.add(lid);
      }

      let participantsLoaded = false;
      try {
        const groups = await this.sock!.groupFetchAllParticipating();
        for (const group of Object.values(groups)) {
          protectedGroups.add(group.id);
          for (const participant of group.participants ?? []) {
            const numeric = participant.id.replace(/@.*/, "");
            if (numeric) protectedJids.add(numeric);
          }
        }
        participantsLoaded = true;
      } catch (err) {
        log.warn(
          "WhatsApp",
          "groupFetchAllParticipating failed — session pruning skipped this cycle, sender-key pruning with config groups only",
          err,
        );
      }

      const maxAgeMs = config.auth.retentionDays * DAY_MS;
      if (participantsLoaded) {
        const signalResult = pruneStaleSignalState(
          this.authDir,
          protectedJids,
          protectedGroups,
          maxAgeMs,
        );
        log.info(
          "WhatsApp",
          `Auth maintenance: pruned ${signalResult.deleted} stale signal files (${signalResult.errors} errors)`,
        );
      } else {
        const senderResult = pruneStaleSenderKeys(
          this.authDir,
          protectedGroups,
          maxAgeMs,
        );
        log.info(
          "WhatsApp",
          `Auth maintenance (degraded): pruned ${senderResult.deleted} stale sender-keys (${senderResult.errors} errors)`,
        );
      }
      this.refreshAuthFileCount();
    } finally {
      this.authMaintenanceRunning = false;
    }
  }

  private startAuthMaintenance(): void {
    this.stopAuthMaintenance();
    this.authMaintenanceTimer = setInterval(() => {
      this.runAuthMaintenance().catch((err) => {
        log.warn("WhatsApp", "Auth maintenance failed", err);
      });
    }, AUTH_MAINTENANCE_INTERVAL_MS);
  }

  private stopAuthMaintenance(): void {
    if (this.authMaintenanceTimer) {
      clearInterval(this.authMaintenanceTimer);
      this.authMaintenanceTimer = null;
    }
  }

  disconnect(): void {
    this.stopHeartbeat();
    this.stopAuthMaintenance();
    this.connectionState = "disconnected";
    this.messageCache.clear();
    if (this.sock) {
      this.sock.end(undefined);
      this.sock = null;
    }
    this.messageHandlers = [];
    this.reconnectAttempts = 0;
  }
}
