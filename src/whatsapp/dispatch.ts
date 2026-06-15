/**
 * Command dispatch handler for Uma Club Bot v3.
 *
 * Wires together: message parsing → access control → report generation → sending.
 * Registers as a message handler on WhatsAppClient.
 */

import type { BotConfig, Snapshot } from '../types';
import type { Database } from '../db/database';
import type { WhatsAppClient, IncomingMessage } from './client';
import { parseCommand, resolveMemberName } from './commands';
import { canUseCommand, isAdmin } from './access';
import { handleSetReq, handleConfig, handleStatus, handleCatchUp, handleAlerts } from './admin';
import { computeMembers } from '../reports/compute';
import { log } from '../utils/logger';
import { getRuntimeStats, getUptimeMs, recordMessageParsed, recordMessageResponded, recordMessageFailed } from '../runtime';

// ============================================================
// Loading messages (Bourbon-flavored rotation)
// ============================================================

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

// ============================================================
// Dispatch function
// ============================================================

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
  db: Database,
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
  db: Database,
  getSnapshot: () => Snapshot | null,
  msg: IncomingMessage,
  prefetchSnapshot?: (year: number, month: number) => Promise<Snapshot>,
  onConfigUpdate?: (config: BotConfig) => void
): Promise<void> {
  // Extract message text
  const text =
    msg.message?.conversation ??
    msg.message?.extendedTextMessage?.text ??
    '';
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
  log.debug('Dispatch', `Parsed command: /${parsed.command} args=[${parsed.args.join(', ')}] offset=${parsed.offset}`);

  // Determine sender and chat JIDs
  const senderJid = msg.key.participant ?? msg.key.remoteJid;
  const chatJid = msg.key.remoteJid;

  // Access control — silently ignore unauthorized sources
  if (!canUseCommand(parsed.command, senderJid, chatJid, config)) {
    log.debug('Dispatch', `Access denied: /${parsed.command} sender=${senderJid} chat=${chatJid}`);
    return;
  }

  // Dispatch to report generator or admin handler
  await generateAndSend(client, config, db, getSnapshot, parsed, chatJid, senderJid, prefetchSnapshot, onConfigUpdate);
}

/**
 * Generate the appropriate report and send it.
 */
async function generateAndSend(
  client: WhatsAppClient,
  config: BotConfig,
  db: Database,
  getSnapshot: () => Snapshot | null,
  parsed: { command: string; args: string[]; offset: number | null; raw: string },
  chatJid: string,
  senderJid: string,
  prefetchSnapshot?: (year: number, month: number) => Promise<Snapshot>,
  onConfigUpdate?: (config: BotConfig) => void
): Promise<void> {
  const { command, args, offset } = parsed;

  // Ping command — immediate response, no snapshot needed, follows access control
  if (command === 'ping') {
    const uptimeStr = formatUptime();
    await client.sendOrEdit(chatJid, null, `🏓 pong — bot aktif | uptime: ${uptimeStr}`);
    return;
  }

  // Help command — no snapshot needed, follows access control
  if (command === 'help') {
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
      lines.push('`/setreq` — Lihat/atur requirement');
      lines.push('`/config` — Lihat konfigurasi');
      lines.push('`/status` — Status bot');
      lines.push('`/catchup on|off` — Toggle catch-up');
      lines.push('`/alerts on|off` — Toggle alerts');
      lines.push('`/schedule` — Pengaturan jadwal');
      lines.push('`/debug` — Info debug bot');
      lines.push('`/admin` — Info perintah admin');
    }

    const helpText = lines.join('\n');

    await client.sendOrEdit(chatJid, null, helpText);
    return;
  }

  // Admin command reference — admin-only, no snapshot needed
  if (command === 'admin') {
    const lines = [
      '⚙️ *Admin Commands*',
      '',
      '`/setreq` — Lihat/atur requirement',
      '`/config` — Lihat konfigurasi',
      '`/status` — Status bot',
      '`/catchup on|off` — Toggle catch-up',
      '`/alerts on|off` — Toggle alerts',
      '`/schedule` — Pengaturan jadwal',
      '`/debug` — Info debug bot',
    ];
    await client.sendOrEdit(chatJid, null, lines.join('\n'));
    return;
  }

  // Check if snapshot is needed for report commands
  const REPORT_COMMANDS = new Set([
    'daily', 'weekly', 'monthly', 'ranks', 'bottom',
    'stats', 'members', 'tier', 'compare', 'analyze',
  ]);

  if (REPORT_COMMANDS.has(command)) {
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
      const absOffset = Math.abs(offset);
      const { year: snapYear, month: snapMonth } = snapshot.members[0];
      let targetMonth = snapMonth - absOffset;
      let targetYear = snapYear;
      while (targetMonth <= 0) {
        targetMonth += 12;
        targetYear--;
      }
      if (targetYear !== snapYear || targetMonth !== snapMonth) {
        try {
          await prefetchSnapshot(targetYear, targetMonth);
        } catch (err) {
          log.warn('Dispatch', `Failed to pre-fetch month ${targetYear}-${targetMonth} for /monthly ${offset}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    const report = await generateReport(command, args, offset, snapshot, config, db);

    await client.sendOrEdit(chatJid, loadingMsgId, report);
    return;
  }

  // Admin commands
  const ADMIN_COMMANDS = new Set(['setreq', 'config', 'status', 'catchup', 'alerts', 'schedule', 'debug']);

  if (ADMIN_COMMANDS.has(command)) {
    const result = handleAdminCommand(command, args, config, db);

    // Admin commands that modify config already wrote to config.yaml via saveConfig().
    // Update in-memory config immediately; the watcher will also detect the file change.
    if (typeof result === 'object' && 'config' in result && onConfigUpdate) {
      onConfigUpdate(result.config);
    }

    const message = typeof result === 'string' ? result : result.message;

    await client.sendOrEdit(chatJid, null, message);
    return;
  }

  // Unknown command
  const reply = `❌ Perintah /${command} tidak dikenal. Coba /help untuk lihat daftar.`;
  await client.sendOrEdit(chatJid, null, reply);
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
  db?: Database
): Promise<string> {
  // Dynamic imports to avoid circular dependencies and keep bundle size small
  switch (command) {
    case 'daily': {
      const { generateDailyReport } = await import('../reports/daily');
      return generateDailyReport(snapshot, config, offset ?? 0, db);
    }
    case 'weekly': {
      const { generateWeeklyReport } = await import('../reports/weekly');
      return generateWeeklyReport(snapshot, config, offset ?? 0, db);
    }
    case 'monthly': {
      const { generateMonthlyReport } = await import('../reports/monthly');
      return generateMonthlyReport(snapshot, config, offset ?? 0, db);
    }
    case 'ranks': {
      const { generateRanksReport } = await import('../reports/ranks');
      return generateRanksReport(snapshot, config);
    }
    case 'bottom': {
      const { generateBottomReport } = await import('../reports/bottom');
      return generateBottomReport(snapshot, config, db);
    }
    case 'stats': {
      const { generateStatsReport } = await import('../reports/stats');
      return generateStatsReport(snapshot, config, db);
    }
    case 'members': {
      const { generateMembersReport } = await import('../reports/members');
      return generateMembersReport(snapshot, config, db);
    }
    case 'tier': {
      const { generateTierReport } = await import('../reports/tier');
      return generateTierReport(snapshot, config, db);
    }
    case 'compare': {
      const { generateCompareReport } = await import('../reports/compare');
      const nameA = args[0] ?? '';
      const nameB = args[1] ?? '';
      if (!nameA || !nameB) {
        return '❌ Cara pakai: /compare <AnggotaA> <AnggotaB>';
      }
      // 5-step member resolution via resolveMemberName
      const members = computeMembers(snapshot, config, db);
      const resolvedA = resolveMemberName(nameA, members);
      const resolvedB = resolveMemberName(nameB, members);
      if (!resolvedA && !resolvedB) {
        return `❌ "${nameA}" dan "${nameB}" tidak ditemukan. Cek ejaan nama.`;
      }
      if (!resolvedA) {
        return `❌ "${nameA}" tidak ditemukan. Cek ejaan nama.`;
      }
      if (!resolvedB) {
        return `❌ "${nameB}" tidak ditemukan. Cek ejaan nama.`;
      }
      return generateCompareReport(snapshot, config, resolvedA.trainerName, resolvedB.trainerName);
    }
    case 'analyze': {
      const { generateAnalyzeReport } = await import('../reports/analyze');
      const name = args.join(' ');
      if (!name) {
        return '❌ Cara pakai: /analyze <NamaAnggota>';
      }
      // 5-step member resolution via resolveMemberName
      const members = computeMembers(snapshot, config, db);
      const resolved = resolveMemberName(name, members);
      if (!resolved) {
        return `❌ "${name}" tidak ditemukan. Cek ejaan nama.`;
      }
      return generateAnalyzeReport(snapshot, config, resolved.trainerName);
    }
    default:
      return `❌ Perintah /${command} tidak dikenal. Cek /help.`;
  }
}

/**
 * Handle admin commands. Returns either a plain message string
 * or { config, message } when the command modifies config.
 */
function handleAdminCommand(
  command: string,
  args: string[],
  config: BotConfig,
  db: Database
): string | { config: BotConfig; message: string } {
  switch (command) {
    case 'setreq': {
      return handleSetReq(args, config);
    }
    case 'config': {
      return handleConfig(config);
    }
    case 'status': {
      const lastDaily = db.getLastSuccessfulRun('daily');
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
