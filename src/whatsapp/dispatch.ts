/**
 * Command dispatch handler for Uma Club Bot v3.
 *
 * Wires together: message parsing → access control → report generation → sending.
 * Registers as a message handler on WhatsAppClient.
 */

import type { BotConfig, Snapshot } from '../types';
import type { IDatabase } from '../db/types';
import type { WhatsAppClient, IncomingMessage } from './client';
import { parseCommand, resolveMemberName } from './commands';
import { canUseCommand, isAdmin, ADMIN_COMMANDS, ADMIN_COMMAND_HELP } from './access';
import { handleSetReq, handleConfig, handleStatus, handleCatchUp, handleAlerts } from './admin';
import { computeMembers } from '../reports/compute';
import { generateReportString } from '../reports/registry';
import { generateCompareReport } from '../reports/compare';
import { generateAnalyzeReport } from '../reports/analyze';
import { log } from '../utils/logger';
import { getRuntimeStats, getUptimeMs, recordMessageParsed, recordMessageResponded, recordMessageFailed } from '../runtime';
import { getTargetMonth, getDataDateComponents } from '../utils/timezone';
import { preFetchMonthlySnapshot } from '../scheduler/helpers';

const REPORT_COMMANDS = new Set([
  'daily', 'weekly', 'monthly', 'ranks', 'bottom',
  'stats', 'members', 'tier', 'compare', 'analyze',
]);

const LOADING_MESSAGES = [
  '⏳ Accessing club data...',
  '⏳ Processing mission parameters...',
  '⏳ Retrieving member records...',
  '⏳ Running analysis module...',
  '⏳ Calculating projections...',
  '⏳ Compiling report data...',
  '⏳ Crunching numbers...',
];

function pickLoadingMessage(): string {
  return LOADING_MESSAGES[Math.floor(Math.random() * LOADING_MESSAGES.length)];
}

function formatUptime(): string {
  const totalSec = Math.floor(getUptimeMs() / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  if (totalSec < 3600) return `${Math.floor(totalSec / 60)}m ${totalSec % 60}s`;
  return `${Math.floor(totalSec / 3600)}h ${Math.floor((totalSec % 3600) / 60)}m`;
}

/**
 * Set up the command handler on the WhatsApp client.
 *
 * @param client - WhatsApp client instance
 * @param config - Bot configuration
 * @param db - Database instance
 * @param getSnapshot - Function to load the latest snapshot
 */
export function setupCommandHandler(
  client: WhatsAppClient,
  configOrGetter: BotConfig | (() => BotConfig),
  db: IDatabase,
  getSnapshot: () => Snapshot | null,
  onConfigUpdate?: (config: BotConfig) => void,
  prefetchSnapshot?: (year: number, month: number) => Promise<Snapshot>,
  fetchIfStale?: () => Promise<void>
): void {
  const isGetter = typeof configOrGetter === 'function';
  let localConfig: BotConfig | undefined = isGetter ? undefined : configOrGetter;
  const getConfig: () => BotConfig = isGetter
    ? (configOrGetter as () => BotConfig)
    : () => localConfig!;

  client.onMessage(async (msg: IncomingMessage) => {
    try {
      const config = getConfig();
      await dispatchMessage(client, config, db, getSnapshot, msg, prefetchSnapshot, (updated) => {
        if (isGetter) {
          onConfigUpdate?.(updated);
        } else {
          localConfig = updated;
        }
      });
    } catch (error) {
      log.error('Dispatch', 'Error handling message', error);
    }
  });
}

/**
 * Core dispatch logic — extracted for testability.
 */
async function dispatchMessage(
  client: WhatsAppClient,
  config: BotConfig,
  db: IDatabase,
  getSnapshot: () => Snapshot | null,
  msg: IncomingMessage,
  prefetchSnapshot?: (year: number, month: number) => Promise<Snapshot>,
  onConfigUpdate?: (config: BotConfig) => void
): Promise<void> {
  // Extract message text
  // Use || not ?? — protobuf-decoded messages have conversation:"" (empty string),
  // which ?? treats as non-nullish, short-circuiting before reaching extendedTextMessage.text
  const extMsg = msg.message?.extendedTextMessage as Record<string, unknown> | undefined;
  const text =
    msg.message?.conversation
    || msg.message?.extendedTextMessage?.text
    || (extMsg?.displayText as string)
    || '';
  if (!text) {
    log.debug('Dispatch', 'Empty message text — skipping');
    return;
  }

  // Parse the command
  const parsed = parseCommand(text, config.commands.prefixes);
  if (!parsed) {
    log.debug('Dispatch', `No command prefix match for: "${text.slice(0, 80)}"`);
    return;
  }

  recordMessageParsed();
  log.debug('Dispatch', `Parsed command: /${parsed.command} args=[${parsed.args.join(', ').replace(/[\r\n]/g, ' ')}] offset=${parsed.offset}`);

  // Determine sender and chat JIDs
  // Use || not ?? — protobuf-decoded messages set participant to "" (empty string)
  // for DMs, which ?? treats as non-nullish, leaving senderJid empty.
  const senderJid = msg.key.participant || msg.key.remoteJid;
  const chatJid = msg.key.remoteJid;

  // Access control — silently ignore unauthorized sources
  if (!canUseCommand(parsed.command, senderJid, chatJid, config)) {
    log.debug('Dispatch', `Access denied: /${parsed.command} sender=${senderJid} chat=${chatJid}`);
    return;
  }

  // Dispatch to report generator or admin handler
  await generateAndSend(client, config, db, getSnapshot, parsed, chatJid, senderJid, prefetchSnapshot, onConfigUpdate);
}

async function handlePingCommand(
  client: WhatsAppClient,
  chatJid: string
): Promise<void> {
  const uptimeStr = formatUptime();
  await client.sendOrEdit(chatJid, null, `🏓 pong — bot aktif | uptime: ${uptimeStr}`);
}

async function handleHelpCommand(
  client: WhatsAppClient,
  chatJid: string,
  senderJid: string,
  config: BotConfig
): Promise<void> {
  const senderIsAdmin = isAdmin(senderJid, config);

  const lines = [
    '📋 *Command Registry*',
    '',
    '*Laporan:*',
    '`/daily` [offset] — Laporan harian',
    '`/weekly` [offset] — Laporan mingguan',
    '`/monthly` [offset] — Laporan bulanan',
    '`/ranks` — Peringkat top 10',
    '`/bottom` — Perlu perhatian',
    '`/stats` — Statistik klub',
    '`/members` — Daftar anggota',
    '`/tier` — Tier intelligence',
    '`/compare` A B — Bandingkan 2 anggota',
    '`/analyze` Nama — Analisis anggota',
    '',
    '*Lainnya:*',
    '`/ping` — Cek apakah bot aktif',
  ];

  if (senderIsAdmin) {
    lines.push('', '*Admin Only:*');
    for (const cmd of ADMIN_COMMANDS) {
      const help = ADMIN_COMMAND_HELP[cmd];
      if (help) lines.push(help);
    }
  }

  const helpText = lines.join('\n');
  await client.sendOrEdit(chatJid, null, helpText);
}

async function handleAdminReferenceCommand(
  client: WhatsAppClient,
  chatJid: string
): Promise<void> {
  const lines = [
    '⚙️ *Admin Commands*',
    '',
  ];
  for (const cmd of ADMIN_COMMANDS) {
    const help = ADMIN_COMMAND_HELP[cmd];
    if (help) lines.push(help);
  }
  await client.sendOrEdit(chatJid, null, lines.join('\n'));
}

async function handleReportCommand(
  client: WhatsAppClient,
  config: BotConfig,
  db: IDatabase,
  getSnapshot: () => Snapshot | null,
  parsed: { command: string; args: string[]; offset: number | null; raw: string },
  chatJid: string,
  prefetchSnapshot?: (year: number, month: number) => Promise<Snapshot>
): Promise<void> {
  const { command, args, offset } = parsed;

  const snapshot = getSnapshot();
  if (!snapshot) {
    const reply = '⚠️ Belum ada data. Tunggu sync berikutnya atau coba lagi nanti.';
    await client.sendOrEdit(chatJid, null, reply);
    return;
  }

  // Send loading message (both group and private chat)
  let loadingMsgId: string | null = null;

  // Validate offset before sending loading message
  if (offset !== null) {
    const maxOffset = command === 'daily' ? config.commands.maxDailyOffset
      : command === 'weekly' ? config.commands.maxWeeklyOffset
      : command === 'monthly' ? config.commands.maxMonthlyOffset
      : null;
    if (maxOffset !== null && Math.abs(offset) > maxOffset) {
      const reply = `Batas offset untuk /${command} adalah ${maxOffset}.`;
      await client.sendOrEdit(chatJid, null, reply);
      return;
    }
  }

  loadingMsgId = await client.sendOrEdit(chatJid, null, pickLoadingMessage());

  // Pre-fetch target month for /monthly with offset > 0
  if (command === 'monthly' && offset !== null && Math.abs(offset) > 0 && prefetchSnapshot) {
    await preFetchMonthlySnapshot(prefetchSnapshot, offset, `/monthly ${offset}`);
  }

  let report: string;
  try {
    report = await generateReport(command, args, offset, snapshot, config, db);
  } catch (err) {
    log.error('Dispatch', `Report generation failed for /${command}`, err);
    await client.sendOrEdit(chatJid, loadingMsgId, '⚠️ Gagal memproses laporan. Coba lagi.');
    return;
  }
  await client.sendOrEdit(chatJid, loadingMsgId, report);
}

async function handleAdminCommand(
  client: WhatsAppClient,
  command: string,
  args: string[],
  config: BotConfig,
  db: IDatabase,
  chatJid: string,
  onConfigUpdate?: (config: BotConfig) => void
): Promise<void> {
  const result = await processAdminCommand(command, args, config, db);

  // Admin commands that modify config already wrote to config.yaml via saveConfig().
  // Update in-memory config immediately; the watcher will also detect the file change.
  if (typeof result === 'object' && 'config' in result && onConfigUpdate) {
    onConfigUpdate(result.config);
  }

  const message = typeof result === 'string' ? result : result.message;
  await client.sendOrEdit(chatJid, null, message);
}

/**
 * Route a parsed command to the appropriate handler.
 */
async function generateAndSend(
  client: WhatsAppClient,
  config: BotConfig,
  db: IDatabase,
  getSnapshot: () => Snapshot | null,
  parsed: { command: string; args: string[]; offset: number | null; raw: string },
  chatJid: string,
  senderJid: string,
  prefetchSnapshot?: (year: number, month: number) => Promise<Snapshot>,
  onConfigUpdate?: (config: BotConfig) => void
): Promise<void> {
  const { command, args } = parsed;

  if (command === 'ping') return handlePingCommand(client, chatJid);
  if (command === 'help') return handleHelpCommand(client, chatJid, senderJid, config);
  if (command === 'admin') return handleAdminReferenceCommand(client, chatJid);
  if (REPORT_COMMANDS.has(command)) return handleReportCommand(client, config, db, getSnapshot, parsed, chatJid, prefetchSnapshot);
  if (ADMIN_COMMANDS.has(command)) return handleAdminCommand(client, command, args, config, db, chatJid, onConfigUpdate);

  // Unknown command
  await client.sendOrEdit(chatJid, null, `❌ Perintah /${command} tidak dikenal. Coba /help untuk lihat daftar.`);
}

/**
 * Generate a report string for the given command.
 */
async function generateReport(
  command: string,
  args: string[],
  offset: number | null,
  snapshot: Snapshot,
  config: BotConfig,
  db?: IDatabase
): Promise<string> {
  const computedMembers = computeMembers(snapshot, config);

  // Try standard report types from registry
  const registryResult = await generateReportString(command, snapshot, config, computedMembers, { offset: offset ?? 0, db });
  if (registryResult !== undefined) return registryResult;

  // Dispatch-specific commands requiring member resolution
  switch (command) {
    case 'compare': {
      const nameA = args[0] ?? '';
      const nameB = args[1] ?? '';
      if (!nameA || !nameB) {
        return '❌ Cara pakai: /compare <AnggotaA> <AnggotaB>';
      }
      // 5-step member resolution via resolveMemberName
      const resolvedA = resolveMemberName(nameA, computedMembers);
      const resolvedB = resolveMemberName(nameB, computedMembers);
      if (!resolvedA && !resolvedB) {
        return `❌ "${nameA}" dan "${nameB}" tidak ditemukan. Cek ejaan nama.`;
      }
      if (!resolvedA) {
        return `❌ "${nameA}" tidak ditemukan. Cek ejaan nama.`;
      }
      if (!resolvedB) {
        return `❌ "${nameB}" tidak ditemukan. Cek ejaan nama.`;
      }
      return generateCompareReport(snapshot, config, computedMembers, resolvedA.trainerName, resolvedB.trainerName);
    }
    case 'analyze': {
      const name = args.join(' ');
      if (!name) {
        return '❌ Cara pakai: /analyze <NamaAnggota>';
      }
      // 5-step member resolution via resolveMemberName
      const resolved = resolveMemberName(name, computedMembers);
      if (!resolved) {
        return `❌ "${name}" tidak ditemukan. Cek ejaan nama.`;
      }
      return generateAnalyzeReport(snapshot, config, computedMembers, resolved.trainerName);
    }
    default:
      return `❌ Perintah /${command} tidak dikenal. Cek /help.`;
  }
}

/**
 * Process admin commands. Returns either a plain message string
 * or { config, message } when the command modifies config.
 */
async function processAdminCommand(
  command: string,
  args: string[],
  config: BotConfig,
  db: IDatabase
): Promise<string | { config: BotConfig; message: string }> {
  switch (command) {
    case 'setreq': {
      return handleSetReq(args, config);
    }
    case 'config': {
      return handleConfig(config);
    }
    case 'status': {
      const lastDaily = await db.getLastSuccessfulRun('daily');
      const lastReport = lastDaily?.sent_at ?? undefined;
      const lastFetch = lastDaily?.scheduled_at ?? undefined;
      const rt = getRuntimeStats();
      const uptimeStr = formatUptime();
      return handleStatus(config, {
        lastFetch,
        lastReport,
        snapshotDay: undefined,
        uptime: uptimeStr,
        reconnects: rt.reconnectCount,
        configReloads: rt.configReloadCount,
        schedulerRestarts: rt.schedulerRestartCount,
        lastChangeFields: rt.lastConfigChangeFields,
      });
    }
    case 'catchup': {
      return handleCatchUp(args, config);
    }
    case 'alerts': {
      return handleAlerts(args, config);
    }
    case 'schedule': {
      return 'Pengaturan jadwal: segera hadir.';
    }
    case 'debug': {
      const rt = getRuntimeStats();
      const uptimeStr = formatUptime();
      const lines = [
        '🔍 *Debug Info*',
        '',
        `Uptime: ${uptimeStr}`,
        `Sockets created: ${rt.socketCreatedCount}`,
        `Reconnects: ${rt.reconnectCount}`,
        `Config reloads: ${rt.configReloadCount}`,
        `Scheduler restarts: ${rt.schedulerRestartCount}`,
        '',
        '*Messages:*',
        `Received: ${rt.messagesReceived}`,
        `Parsed: ${rt.messagesParsed}`,
        `Responded: ${rt.messagesResponded}`,
        `Failed: ${rt.messagesFailed}`,
        `Last msg: ${rt.lastMessageTimestamp ?? 'never'}`,
        '',
        '*Connection:*',
        `State: ${rt.connectionState}`,
        `Last disconnect: ${rt.lastDisconnectReason ?? 'none'} at ${rt.lastDisconnectTime ?? 'never'}`,
        `Last disconnect error: ${rt.lastDisconnectError ?? 'none'}`,
        `Last socket: ${rt.lastSocketCreatedTime ?? 'never'}`,
        '',
        '*Config:*',
        `Reloads: ${rt.configReloadCount}`,
        `Last change: ${rt.lastConfigChangeFields.length > 0 ? rt.lastConfigChangeFields.join(', ') : 'none'}`,
      ];
      return lines.join('\n');
    }
    default:
      return `❌ Perintah admin /${command} tidak dikenal.`;
  }
}
