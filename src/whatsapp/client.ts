/**
 * WhatsApp connection manager for Uma Club Bot v3.
 *
 * Wraps @whiskeysockets/baileys for WhatsApp Web multi-device connection.
 * Handles connection lifecycle, message sending, and message editing.
 */

import type { WASocket } from '@whiskeysockets/baileys';
import type { BotConfig } from '../types';
import { log } from '../utils/logger';
import { recordReconnect, recordMessageReceived, recordMessageParsed, recordMessageResponded, recordMessageFailed, recordSocketCreated, recordDisconnect, getRuntimeStats, recordConnectionState } from '../runtime';

// ============================================================
// Types
// ============================================================

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

export type MessageHandler = (msg: IncomingMessage) => void;

// ============================================================
// WhatsAppClient
// ============================================================

// ============================================================
// libsignal noise suppression
// ============================================================

/**
 * libsignal/src/session_cipher.js writes decryption failures directly to
 * console.error (bypassing pino). These are handled internally by Baileys
 * via retry requests — the console output is redundant noise.
 *
 * This monkey-patch filters out known libsignal patterns while letting all
 * other console.error calls through.
 */
let _libsignalSuppressed = false;
function suppressLibsignalErrors(): void {
  if (_libsignalSuppressed) return;
  _libsignalSuppressed = true;
  const originalConsoleError = console.error.bind(console);
  console.error = (...args: any[]) => {
    const joined = args.join(' ');
    if (
      joined.includes('Failed to decrypt message') ||
      joined.includes('Session error') ||
      joined.includes('Bad MAC')
    ) {
      return;
    }
    originalConsoleError(...args);
  };
}

/**
 * Create a logger adapter for Baileys that routes through our structured logger.
 *
 * Baileys internally logs decryption failures ("failed to decrypt message")
 * at error level, but handles them via automatic retry requests. Treating
 * these as errors is misleading — they are normal operational noise.
 *
 * This adapter silently drops those known-handled errors while routing all
 * other Baileys log output through our structured logger at appropriate levels.
 */
function createBaileysLogger() {
  const suppressPatterns = [
    'failed to decrypt message',
    'unexpected error in',
  ];

  const adapter = {
    level: 'warn',

    fatal: (obj: unknown, msg?: string) => {
      const message = msg || (typeof obj === 'string' ? obj : '');
      log.error('Baileys', message, obj instanceof Error ? obj : undefined);
    },

    error: (obj: unknown, msg?: string) => {
      const message = msg || (typeof obj === 'string' ? obj : '');
      // Suppress known-handled errors — Baileys manages these internally via retry
      for (const pattern of suppressPatterns) {
        if (message.includes(pattern)) return;
      }
      log.warn('Baileys', message);
    },

    warn: (obj: unknown, msg?: string) => {
      const message = msg || (typeof obj === 'string' ? obj : '');
      log.warn('Baileys', message);
    },

    info: (obj: unknown, msg?: string) => {
      const message = msg || (typeof obj === 'string' ? obj : '');
      log.info('Baileys', message);
    },

    debug: (obj: unknown, msg?: string) => {
      const message = msg || (typeof obj === 'string' ? obj : '');
      log.debug('Baileys', message);
    },

    trace: (obj: unknown, msg?: string) => {
      const message = msg || (typeof obj === 'string' ? obj : '');
      log.debug('Baileys', message);
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
  private maxReconnectAttempts = 5;
  private baseReconnectDelay = 1000;
  private connectionState: string = 'disconnected';
  private lastMessageCount = 0;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  constructor(getConfig: () => BotConfig) {
    this.getConfig = getConfig;
  }

  /**
   * Get current connection state for debugging.
   */
  getConnectionState(): string {
    return this.connectionState;
  }

  /**
   * Check if WhatsApp is connected and ready to send messages.
   */
  isConnected(): boolean {
    return this.sock !== null && this.sock.user !== undefined;
  }

  /**
   * Start periodic heartbeat logging to confirm the bot is alive.
   * Logs connection state and message count every 30 seconds.
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      const rt = getRuntimeStats();
      const msgsSinceLast = rt.messagesReceived - this.lastMessageCount;
      this.lastMessageCount = rt.messagesReceived;
      const jidInfo = this.sock?.user?.id ? this.sock.user.id.split(':')[0] : 'no-jid';
      log.info('WhatsApp', `♥ heartbeat: state=${this.connectionState} jid=${jidInfo} msgs=${rt.messagesReceived} (+${msgsSinceLast} since last check) reconnects=${rt.reconnectCount}`);
    }, 30_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Connect to WhatsApp.
   * Resolves only when actually connected (QR scanned + authenticated).
   * Shows QR code in terminal for scanning.
   */
  async connect(): Promise<void> {
    // Suppress libsignal's noisy console.error calls for Bad MAC decryption failures.
    // libsignal/src/session_cipher.js writes directly to console.error (bypassing pino).
    // Baileys handles these internally with retry requests — the console noise is redundant.
    suppressLibsignalErrors();

    // Dynamic imports outside Promise constructor to avoid async antipattern.
    // If any import fails, the outer async method throws properly instead of
    // leaving the inner Promise hanging forever.
    const Baileys = await import('@whiskeysockets/baileys');
    const makeWASocket = Baileys.default;
    const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, normalizeMessageContent } = Baileys;
    const qrcodeTerminal = await import('qrcode-terminal');

    // Ensure auth directory exists
    const { mkdirSync, existsSync } = await import('fs');
    const { join } = await import('path');
    const authDir = process.env.WA_SESSION_DIR ?? 'data/auth';
    if (!existsSync(authDir)) {
      mkdirSync(authDir, { recursive: true });
    }

    // Load auth state — session-*.json files contain Signal protocol sessions
    // for each contact. These are ESSENTIAL for decrypting incoming messages.
    // DO NOT delete them — Baileys handles stale sessions by requesting
    // new key exchanges automatically when needed.
    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    const { version } = await fetchLatestBaileysVersion();

    // Custom logger adapter routing Baileys logs through our structured logger.
    // Baileys logs decryption failures at error level internally, but they are
    // handled via retry — logging them as errors is misleading noise.
    const logger = createBaileysLogger();

    this.sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger,
      syncFullHistory: false,
      shouldIgnoreJid: () => false,
    });
    recordSocketCreated();
    log.debug('WhatsApp', `Socket created (total=${getRuntimeStats().socketCreatedCount})`);
    const sock = this.sock;

    // Handle credentials update
    sock.ev.on('creds.update', saveCreds);

    // Handle incoming messages
    sock.ev.on('messages.upsert', (upt: any) => {
      const upsertType = upt.type;
      log.debug('WhatsApp', `messages.upsert type=${upsertType} count=${upt.messages?.length ?? 0}`);

      if (upsertType !== 'notify') {
        log.debug('WhatsApp', `Non-notify messages.upsert: type=${upsertType} count=${upt.messages?.length ?? 0}`);
        return;
      }

      for (const msg of upt.messages) {
        // Skip status broadcasts
        if (msg.key.remoteJid === 'status@broadcast') continue;
        // Skip own messages
        if (msg.key.fromMe) continue;

        recordMessageReceived();

        // Log raw message structure BEFORE normalize (for debugging protocol changes)
        const rawTypes = msg.message ? Object.keys(msg.message).join(',') : 'no-message';
        log.debug('WhatsApp', `RAW msg from=${msg.key.participant ?? msg.key.remoteJid} chat=${msg.key.remoteJid} pushName=${msg.pushName ?? '?'} types=[${rawTypes}]`);

        // Normalize message content: unwrap ephemeral, view-once, edited wrappers.
        // If the group has disappearing messages, the actual text is nested under
        // msg.message.ephemeralMessage.message.conversation — without this,
        // msg.message.conversation is undefined and commands silently fail.
        msg.message = normalizeMessageContent(msg.message) as any;

        // Log normalized message content
        const normTypes = msg.message ? Object.keys(msg.message).join(',') : 'null';
        const textContent = msg.message?.conversation ?? msg.message?.extendedTextMessage?.text ?? '';
        log.debug('WhatsApp', `NORM msg from=${msg.key.participant ?? msg.key.remoteJid} chat=${msg.key.remoteJid} types=[${normTypes}] text="${textContent.slice(0, 120)}"`);

        if (!textContent) {
          log.warn('WhatsApp', `Empty content after normalize — raw types were [${rawTypes}], norm types are [${normTypes}]`);
        }

        for (const handler of this.messageHandlers) {
          try {
            handler(msg as IncomingMessage);
          } catch (err) {
            recordMessageFailed();
            log.warn('WhatsApp', `Message handler error: ${(err as Error).message}`);
          }
        }
      }
    });

    // Wait for connection — the inner Promise wraps ONLY the event wait,
    // not the imports. If the event throws, reject() is called properly.
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Connection timeout')), 120_000);

      sock.ev.on('connection.update', (update: any) => {
        const { connection, lastDisconnect, qr } = update;

        // Log ALL connection states — intermediate states like 'connecting' are informative
        if (connection) {
          this.connectionState = connection;
          recordConnectionState(connection);
          log.info('WhatsApp', `Connection update: ${connection}${qr ? ' (QR received)' : ''}`);
        }

        if (qr) {
          qrcodeTerminal.generate(qr, { small: true });
          log.info('WhatsApp', 'Scan QR code above to authenticate');
        }

        if (connection === 'open') {
          clearTimeout(timeout);
          log.info('WhatsApp', 'Connected successfully');
          this.reconnectAttempts = 0;
          this.startHeartbeat();
          // Log the connected user ID if available
          if (sock.user?.id) {
            log.info('WhatsApp', `Authenticated as: ${sock.user.id.split(':')[0]}`);
          }
          resolve();
        }

        if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const errMsg = lastDisconnect?.error?.message ?? 'Unknown error';
          const reasonName: string = statusCode !== undefined
            ? (DisconnectReason[statusCode as keyof typeof DisconnectReason] as unknown as string ?? `UNKNOWN(${statusCode})`)
            : 'NO_STATUS';
          log.error('WhatsApp', `Connection closed: reason=${reasonName}, error=${errMsg}`);
          recordDisconnect(reasonName, errMsg);
          this.stopHeartbeat();

          if (statusCode === DisconnectReason.loggedOut) {
            clearTimeout(timeout);
            reject(new Error('Logged out — please re-scan QR code'));
          } else if (statusCode === DisconnectReason.badSession) {
            clearTimeout(timeout);
            log.error('WhatsApp', 'Bad session detected (bad mac) — auth credentials may be corrupt');
            reject(new Error('Bad session — please delete data/auth and re-scan QR code'));
          } else if (statusCode === DisconnectReason.restartRequired) {
            this.reconnectAttempts = 0;
            const delay = this.baseReconnectDelay;
            log.info('WhatsApp', `Restart required, reconnecting in ${delay}ms`);
            clearTimeout(timeout);
            recordReconnect();
            setTimeout(() => this.connect().then(resolve).catch(reject), delay);
          } else if (this.reconnectAttempts < this.maxReconnectAttempts) {
            const delay = this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts);
            this.reconnectAttempts++;
            log.warn('WhatsApp', `Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
            clearTimeout(timeout);
            recordReconnect();
            setTimeout(() => this.connect().then(resolve).catch(reject), delay);
          } else {
            clearTimeout(timeout);
            reject(new Error('Max reconnection attempts reached'));
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
      throw new Error('WhatsApp client not connected');
    }

    const { splitMessage } = await import('../reports/format');
    const config = this.getConfig();
    const parts = splitMessage(text, config.message.maxLength, config.message.splitAtNewline);

    for (const part of parts) {
      await this.sock.sendMessage(jid, { text: part });
    }
  }

  /**
   * Send or edit a message.
   * Used for command responses: send a loading message, then edit to final result.
   *
   * Strategy:
   * - If messageId provided and single part → edit in-place
   * - If messageId provided and multi-part → delete loading, send all parts fresh
   * - If no messageId → send all parts as new messages
   *
   * Returns the message ID of the last sent/edited message for future reference.
   */
  async sendOrEdit(
    jid: string,
    messageId: string | null,
    text: string
  ): Promise<string> {
    if (!this.sock) {
      recordMessageFailed();
      throw new Error('WhatsApp client not connected');
    }

    const { splitMessage } = await import('../reports/format');
    const config = this.getConfig();
    const parts = splitMessage(text, config.message.maxLength, config.message.splitAtNewline);

    const totalParts = parts.length;
    log.debug('WhatsApp', `sendOrEdit: jid=${jid} parts=${totalParts} totalChars=${text.length} splitAtNewline=${config.message.splitAtNewline}`);

    // Single part: try edit in-place
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
          log.warn('WhatsApp', `Edit failed, sending as new message: ${(err as Error).message}`);
          // Fall through to send as new
        }
      }
      const sentMsg = await this.sock.sendMessage(jid, { text: parts[0] });
      recordMessageResponded();
      return sentMsg?.key?.id ?? '';
    }

    // Multi-part: delete loading message if exists, then send all parts fresh
    if (messageId) {
      try {
        const key = { id: messageId, remoteJid: jid, fromMe: true };
        await this.sock.sendMessage(jid, { delete: key });
      } catch {
        // Best effort — loading message might already be gone
      }
    }

    let lastId = '';
    for (const part of parts) {
      const sentMsg = await this.sock.sendMessage(jid, { text: part });
      if (sentMsg?.key?.id) {
        lastId = sentMsg.key.id;
      }
    }
    recordMessageResponded();
    return lastId;
  }

  /**
   * Register a message handler for incoming messages.
   */
  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler);
  }

  /**
   * Disconnect from WhatsApp and clean up.
   */
  disconnect(): void {
    if (this.sock) {
      this.sock.end(undefined);
      this.sock = null;
    }
    this.messageHandlers = [];
    this.reconnectAttempts = 0;
  }
}
