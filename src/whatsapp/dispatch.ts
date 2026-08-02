/**
 * Command dispatch handler for Uma Club Bot v3.
 *
 * Wires together: message parsing → access control → report generation → sending.
 * Registers as a message handler on WhatsAppClient.
 */

import type { BotConfig, Snapshot } from "../types";
import type { IDatabase } from "../db/types";
import type { WhatsAppClient, IncomingMessage } from "./client";
import { parseCommand, parseStrictInt, resolveMemberName } from "./commands";
import {
  canUseCommand,
  isAdmin,
  ADMIN_COMMANDS,
  ADMIN_COMMAND_HELP,
} from "./access";
import {
  handleSetReq,
  handleConfig,
  handleStatus,
  handleCatchUp,
  handleAlerts,
} from "./admin";
import { computeMembers } from "../reports/compute";
import { generateReportString } from "../reports/registry";
// Two-tier dispatch: registry handles standard types (daily, weekly, etc.)
// These handle name-resolution types (compare/analyze) that need fuzzy member matching.
import { generateCompareReport } from "../reports/compare";
import { generateAnalyzeReport } from "../reports/analyze";
import { log } from "../utils/logger";
import {
  getRuntimeStats,
  getUptimeMs,
  recordMessageParsed,
  recordMessageResponded,
  recordMessageFailed,
} from "../runtime";
import { getTargetMonth, getDataDateComponents } from "../utils/timezone";
import { preFetchMonthlySnapshot } from "../scheduler/helpers";

interface DispatchContext {
  client: WhatsAppClient;
  config: BotConfig;
  db: IDatabase;
  getSnapshot: () => Snapshot | null;
  prefetchSnapshot?: (year: number, month: number) => Promise<Snapshot>;
  onConfigUpdate?: (config: BotConfig) => void;
}

const REPORT_COMMANDS = new Set([
  "daily",
  "weekly",
  "monthly",
  "ranks",
  "bottom",
  "stats",
  "members",
  "tier",
  "compare",
  "analyze",
]);

const LOADING_MESSAGES = [
  "⏳ Accessing club data...",
  "⏳ Processing mission parameters...",
  "⏳ Retrieving member records...",
  "⏳ Running analysis module...",
  "⏳ Calculating projections...",
  "⏳ Compiling report data...",
  "⏳ Crunching numbers...",
];

const LOG_PREVIEW_LENGTH = 80;

function pickLoadingMessage(): string {
  return LOADING_MESSAGES[Math.floor(Math.random() * LOADING_MESSAGES.length)];
}

function formatUptime(): string {
  const totalSec = Math.floor(getUptimeMs() / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  if (totalSec < 3600) return `${Math.floor(totalSec / 60)}m ${totalSec % 60}s`;
  return `${Math.floor(totalSec / 3600)}h ${Math.floor((totalSec % 3600) / 60)}m`;
}

export function setupCommandHandler(
  client: WhatsAppClient,
  configOrGetter: BotConfig | (() => BotConfig),
  db: IDatabase,
  getSnapshot: () => Snapshot | null,
  onConfigUpdate?: (config: BotConfig) => void,
  prefetchSnapshot?: (year: number, month: number) => Promise<Snapshot>,
  fetchIfStale?: () => Promise<void>,
): void {
  const isGetter = typeof configOrGetter === "function";
  let localConfig: BotConfig | undefined = isGetter
    ? undefined
    : configOrGetter;
  const getConfig: () => BotConfig = isGetter
    ? (configOrGetter as () => BotConfig)
    : () => localConfig!;

  client.onMessage(async (msg: IncomingMessage) => {
    try {
      const ctx: DispatchContext = {
        client,
        config: getConfig(),
        db,
        getSnapshot,
        prefetchSnapshot,
        onConfigUpdate: (updated) => {
          if (isGetter) {
            onConfigUpdate?.(updated);
          } else {
            localConfig = updated;
          }
        },
      };
      await dispatchMessage(ctx, msg);
    } catch (error) {
      log.error("Dispatch", "Error handling message", error);
    }
  });
}

async function dispatchMessage(
  ctx: DispatchContext,
  msg: IncomingMessage,
): Promise<void> {
  // Use || not ?? — protobuf decodes a missing text field as "" (not null),
  // which ?? treats as non-nullish and short-circuits the fallback chain.
  const extMsg = msg.message?.extendedTextMessage as
    Record<string, unknown> | undefined;
  const text =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    (extMsg?.displayText as string) ||
    "";
  if (!text) {
    log.debug("Dispatch", "Empty message text — skipping");
    return;
  }

  const parsed = parseCommand(text, ctx.config.commands.prefixes);
  if (!parsed) {
    log.debug(
      "Dispatch",
      `No command prefix match for: "${text.slice(0, LOG_PREVIEW_LENGTH)}"`,
    );
    return;
  }

  recordMessageParsed();
  log.debug(
    "Dispatch",
    `Parsed command: /${parsed.command} args=[${parsed.args.join(", ").replace(/[\r\n]/g, " ")}] offset=${parsed.offset}`,
  );

  // Use || not ?? — protobuf decodes a missing participant as "" (not null),
  // which ?? treats as non-nullish and skips the remoteJid fallback.
  const senderJid = msg.key.participant || msg.key.remoteJid;
  const chatJid = msg.key.remoteJid;

  // Fail silently — no reply, so unauthorized users can't probe the command surface.
  if (!canUseCommand(parsed.command, senderJid, chatJid, ctx.config)) {
    log.debug(
      "Dispatch",
      `Access denied: /${parsed.command} sender=${senderJid} chat=${chatJid}`,
    );
    return;
  }

  await generateAndSend(ctx, parsed, chatJid, senderJid);
}

async function handlePingCommand(
  client: WhatsAppClient,
  chatJid: string,
): Promise<void> {
  const uptimeStr = formatUptime();
  await client.sendOrEdit(
    chatJid,
    null,
    `🏓 pong — bot aktif | uptime: ${uptimeStr}`,
  );
}

async function handleHelpCommand(
  client: WhatsAppClient,
  chatJid: string,
  senderJid: string,
  config: BotConfig,
): Promise<void> {
  const senderIsAdmin = isAdmin(senderJid, config);

  const lines = [
    "📋 *Command Registry*",
    "",
    "*Laporan:*",
    "`/daily` `/d` [offset] — Laporan harian",
    "`/weekly` `/w` [offset] — Laporan mingguan",
    "`/monthly` `/m` [offset] — Laporan bulanan",
    "`/ranks` — Peringkat top 10",
    "`/bottom` — Perlu perhatian",
    "`/stats` — Statistik klub",
    "`/members` — Daftar anggota",
    "`/tier` — Tier intelligence",
    "`/compare` A B — Bandingkan 2 anggota",
    "`/analyze` Nama [offset] — Analisis anggota",
    "",
    "*Lainnya:*",
    "`/ping` — Cek apakah bot aktif",
  ];

  if (senderIsAdmin) {
    lines.push("", "*Admin Only:*");
    for (const cmd of ADMIN_COMMANDS) {
      const help = ADMIN_COMMAND_HELP[cmd];
      if (help) lines.push(help);
    }
  }

  const helpText = lines.join("\n");
  await client.sendOrEdit(chatJid, null, helpText);
}

async function handleAdminReferenceCommand(
  client: WhatsAppClient,
  chatJid: string,
): Promise<void> {
  const lines = ["⚙️ *Admin Commands*", ""];
  for (const cmd of ADMIN_COMMANDS) {
    const help = ADMIN_COMMAND_HELP[cmd];
    if (help) lines.push(help);
  }
  await client.sendOrEdit(chatJid, null, lines.join("\n"));
}

async function handleReportCommand(
  ctx: DispatchContext,
  parsed: {
    command: string;
    args: string[];
    offset: number | null;
    raw: string;
  },
  chatJid: string,
): Promise<void> {
  const { command, args, offset } = parsed;

  // For name-based commands (analyze), offset is the last arg, not the first.
  // Extract it early so validation and pre-fetch use the correct value.
  let effectiveOffset = offset;
  let effectiveArgs = args;
  if (command === "analyze" && effectiveOffset === null && args.length > 1) {
    const lastArg = args[args.length - 1];
    const parsedLast = parseStrictInt(lastArg);
    if (parsedLast !== null) {
      effectiveOffset = parsedLast;
      effectiveArgs = args.slice(0, -1);
    }
  }

  // Reject invalid offsets before the loading message — no "processing…" then an error.
  if (effectiveOffset !== null) {
    const MAX_OFFSETS: Record<string, number> = {
      daily: ctx.config.commands.maxDailyOffset,
      weekly: ctx.config.commands.maxWeeklyOffset,
      monthly: ctx.config.commands.maxMonthlyOffset,
      analyze: ctx.config.commands.maxAnalyzeOffset,
    };
    const maxOffset = MAX_OFFSETS[command] ?? null;
    if (maxOffset !== null && Math.abs(effectiveOffset) > maxOffset) {
      await ctx.client.sendOrEdit(
        chatJid,
        null,
        `Batas offset untuk /${command} adalah ${maxOffset}.`,
      );
      return;
    }
  }

  // Don't send a loading message we'd immediately replace with an error.
  const snapshot = ctx.getSnapshot();
  if (!snapshot) {
    await ctx.client.sendOrEdit(
      chatJid,
      null,
      "⚠️ Belum ada data. Tunggu sync berikutnya atau coba lagi nanti.",
    );
    return;
  }

  const loadingMsgId = await ctx.client.sendOrEdit(
    chatJid,
    null,
    pickLoadingMessage(),
  );

  if (
    (command === "monthly" || command === "analyze") &&
    effectiveOffset !== null &&
    Math.abs(effectiveOffset) > 0 &&
    ctx.prefetchSnapshot &&
    snapshot.members.length > 0
  ) {
    const { year: snapYear, month: snapMonth } = snapshot.members[0];
    await preFetchMonthlySnapshot(
      ctx.prefetchSnapshot,
      effectiveOffset,
      `/${command} ${effectiveOffset}`,
      snapYear,
      snapMonth,
    );
  }

  let report: string;
  try {
    report = await generateReport(
      command,
      effectiveArgs,
      effectiveOffset,
      snapshot,
      ctx.config,
      ctx.db,
    );
  } catch (err) {
    log.error("Dispatch", `Report generation failed for /${command}`, err);
    await ctx.client.sendOrEdit(
      chatJid,
      loadingMsgId,
      "⚠️ Gagal memproses laporan. Coba lagi.",
    );
    return;
  }
  await ctx.client.sendOrEdit(chatJid, loadingMsgId, report);
}

async function handleAdminCommand(
  ctx: DispatchContext,
  command: string,
  args: string[],
  chatJid: string,
): Promise<void> {
  const result = await processAdminCommand(command, args, ctx.config, ctx.db);

  // Admin commands that modify config already wrote to config.yaml via saveConfig().
  // Update in-memory config immediately; the watcher will also detect the file change.
  if (typeof result === "object" && "config" in result && ctx.onConfigUpdate) {
    ctx.onConfigUpdate(result.config);
  }

  const message = typeof result === "string" ? result : result.message;
  await ctx.client.sendOrEdit(chatJid, null, message);
}

async function generateAndSend(
  ctx: DispatchContext,
  parsed: {
    command: string;
    args: string[];
    offset: number | null;
    raw: string;
  },
  chatJid: string,
  senderJid: string,
): Promise<void> {
  const { command, args } = parsed;

  if (command === "ping") return handlePingCommand(ctx.client, chatJid);
  if (command === "help")
    return handleHelpCommand(ctx.client, chatJid, senderJid, ctx.config);
  if (command === "admin")
    return handleAdminReferenceCommand(ctx.client, chatJid);
  if (REPORT_COMMANDS.has(command))
    return handleReportCommand(ctx, parsed, chatJid);
  if (ADMIN_COMMANDS.has(command))
    return handleAdminCommand(ctx, command, args, chatJid);

  await ctx.client.sendOrEdit(
    chatJid,
    null,
    `❌ Perintah /${command} tidak dikenal. Coba /help untuk lihat daftar.`,
  );
}

async function generateReport(
  command: string,
  args: string[],
  offset: number | null,
  snapshot: Snapshot,
  config: BotConfig,
  db?: IDatabase,
): Promise<string> {
  const computedMembers = computeMembers(snapshot, config);

  const registryResult = await generateReportString(
    command,
    snapshot,
    config,
    computedMembers,
    { offset: offset ?? 0, db },
  );
  if (registryResult !== undefined) return registryResult;

  switch (command) {
    case "compare": {
      const nameA = args[0] ?? "";
      const nameB = args[1] ?? "";
      if (!nameA || !nameB) {
        return "❌ Cara pakai: /compare <AnggotaA> <AnggotaB>";
      }
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
      return generateCompareReport(
        snapshot,
        config,
        computedMembers,
        resolvedA.trainerName,
        resolvedB.trainerName,
      );
    }
    case "analyze": {
      const name = args.join(" ");
      if (!name) {
        return "❌ Cara pakai: /analyze <NamaAnggota> [offset]";
      }
      const resolved = resolveMemberName(name, computedMembers);
      if (!resolved) {
        return `❌ "${name}" tidak ditemukan. Cek ejaan nama.`;
      }
      return generateAnalyzeReport(
        snapshot,
        config,
        computedMembers,
        resolved.trainerName,
        offset ?? 0,
      );
    }
    default:
      return `❌ Perintah /${command} tidak dikenal. Cek /help.`;
  }
}

async function processAdminCommand(
  command: string,
  args: string[],
  config: BotConfig,
  db: IDatabase,
): Promise<string | { config: BotConfig; message: string }> {
  switch (command) {
    case "setreq": {
      return handleSetReq(args, config);
    }
    case "config": {
      return handleConfig(config);
    }
    case "status": {
      const lastDaily = await db.getLastSuccessfulRun("daily");
      const lastReport = lastDaily?.sent_at ?? undefined;
      const lastFetch = lastDaily?.scheduled_at ?? undefined;
      const rt = getRuntimeStats();
      const uptimeStr = formatUptime();
      return handleStatus(config, {
        lastFetch,
        lastReport,
        uptime: uptimeStr,
        reconnects: rt.reconnectCount,
        configReloads: rt.configReloadCount,
        schedulerRestarts: rt.schedulerRestartCount,
        lastChangeFields: rt.lastConfigChangeFields,
      });
    }
    case "catchup": {
      return handleCatchUp(args, config);
    }
    case "alerts": {
      return handleAlerts(args, config);
    }
    case "schedule": {
      return "Pengaturan jadwal: segera hadir.";
    }
    case "debug": {
      const rt = getRuntimeStats();
      const uptimeStr = formatUptime();
      const lines = [
        "🔍 *Debug Info*",
        "",
        `Uptime: ${uptimeStr}`,
        `Sockets created: ${rt.socketCreatedCount}`,
        `Reconnects: ${rt.reconnectCount}`,
        `Config reloads: ${rt.configReloadCount}`,
        `Scheduler restarts: ${rt.schedulerRestartCount}`,
        "",
        "*Messages:*",
        `Received: ${rt.messagesReceived}`,
        `Parsed: ${rt.messagesParsed}`,
        `Responded: ${rt.messagesResponded}`,
        `Failed: ${rt.messagesFailed}`,
        `Last msg: ${rt.lastMessageTimestamp ?? "never"}`,
        "",
        "*Connection:*",
        `State: ${rt.connectionState}`,
        `Last disconnect: ${rt.lastDisconnectReason ?? "none"} at ${rt.lastDisconnectTime ?? "never"}`,
        `Last disconnect error: ${rt.lastDisconnectError ?? "none"}`,
        `Last socket: ${rt.lastSocketCreatedTime ?? "never"}`,
        "",
        "*Config:*",
        `Reloads: ${rt.configReloadCount}`,
        `Last change: ${rt.lastConfigChangeFields.length > 0 ? rt.lastConfigChangeFields.join(", ") : "none"}`,
      ];
      return lines.join("\n");
    }
    default:
      return `❌ Perintah admin /${command} tidak dikenal.`;
  }
}
