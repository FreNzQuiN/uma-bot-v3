/**
 * Uma Club Bot v3 — Entry Point
 *
 * Startup order:
 * 1. Load config + init DB
 * 2. Fetch fresh data
 * 3. Start API server
 * 4. Connect WhatsApp (non-blocking, QR scan needed)
 * 5. Once connected → run catch-up + start scheduler
 */

import { loadConfig } from "./config";
import type { BotConfig, Snapshot } from "./types";
import { createDatabase } from "./db/factory";
import { UmaMoeClient } from "./api/uma-moe";
import { ApiServer } from "./api/server";
import { Scheduler } from "./scheduler/scheduler";
import { CatchUpManager } from "./scheduler/catchup";
import { WhatsAppClient } from "./whatsapp/client";
import {
  setupCommandHandler,
  type ForceFetchResult,
} from "./whatsapp/dispatch";

import {
  loadLatestSnapshot,
  ensureMonthSnapshot,
  getCachedSnapshot,
  setCachedSnapshot,
} from "./data/snapshot";
import { fetchAndSaveSnapshot } from "./data/fetch-snapshot";
import { getDataDayFromSnapshot } from "./data/daily-fans";
import { updateMemberHistory } from "./data/member-history";
import {
  getDataDate,
  getDataDateComponents,
  getTargetMonth,
} from "./utils/timezone";
import {
  writeFileSync,
  unlinkSync,
  mkdirSync,
  existsSync,
  statSync,
  readFileSync,
} from "fs";
import { resolve } from "path";
import { log } from "./utils/logger";
import { recordConfigReload, recordSchedulerRestart } from "./runtime";

import { ReportOrchestrator } from "./orchestrator/report-orchestrator";

const PID_FILE = "data/bot.pid";

/** Warn when the bot hasn't run successfully for a week — WhatsApp revokes sessions after ~14 days offline. */
const INACTIVITY_WARNING_MS = 7 * 24 * 60 * 60 * 1000;
const EXIT_DELAY_MS = 6_000;
const CONFIG_POLL_MS = 5_000;
const CONNECT_POLL_MS = 1_000;
const PREFETCH_OFFSETS = [1, 2];

let emergencyCleanup: (() => Promise<void>) | null = null;

process.on("unhandledRejection", (reason) => {
  log.error(
    "Bot",
    `Unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`,
  );
});

process.on("uncaughtException", (err) => {
  log.error("Bot", `Uncaught exception: ${err.message}`, err);
  if (emergencyCleanup) emergencyCleanup().catch(() => {});
  setTimeout(() => process.exit(1), EXIT_DELAY_MS);
});

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a as Record<string, unknown>);
  const keysB = Object.keys(b as Record<string, unknown>);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) =>
    deepEqual(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key],
    ),
  );
}

function configChanged(
  oldCfg: BotConfig,
  newCfg: BotConfig,
): { changed: boolean; scheduleChanged: boolean } {
  const changed = JSON.stringify(oldCfg) !== JSON.stringify(newCfg);
  if (!changed) return { changed: false, scheduleChanged: false };

  const scheduleChanged =
    JSON.stringify(oldCfg.schedule) !== JSON.stringify(newCfg.schedule);
  return { changed: true, scheduleChanged };
}

async function main() {
  try {
    if (!existsSync("data")) mkdirSync("data", { recursive: true });
    writeFileSync(PID_FILE, String(process.pid), "utf-8");
  } catch (err) {
    log.warn("Bot", "Failed to write PID file", err);
  }
  log.info("Bot", "Uma Club Bot v3 starting...");

  let config = loadConfig();
  log.configure({ ...config.logging, timezone: config.timezone });

  const db = await createDatabase(config.database);
  log.info("Bot", `Database initialized`);

  log.info("Bot", `Circle ID: ${config.circleId}`);
  log.info("Bot", `Timezone: ${config.timezone}`);
  log.info("Bot", `Log level: ${config.logging.level}`);

  // Polling instead of fs.watch — more reliable on Windows
  const configPath = resolve("config.yaml");
  let lastConfigMtime = 0;
  let lastConfigHash = "";
  let initialReadOk = false;
  try {
    lastConfigMtime = statSync(configPath).mtimeMs;
    lastConfigHash = readFileSync(configPath, "utf-8");
    initialReadOk = true;
  } catch (err) {
    log.warn("Config", "Could not stat config.yaml at startup", err);
  }

  const umaMoe = new UmaMoeClient();
  emergencyCleanup = () => umaMoe.closeSession();
  const getSnapshot = (): Snapshot | null => {
    const cached = getCachedSnapshot();
    if (cached) return cached;
    log.debug("Snapshot", "Cache miss — reading from disk");
    const snapshot = loadLatestSnapshot();
    if (snapshot) setCachedSnapshot(snapshot);
    return snapshot;
  };
  const getConfig = () => config;

  const waClient = new WhatsAppClient(getConfig);

  const orchestrator = new ReportOrchestrator({
    getConfig,
    getSnapshot,
    umaMoe,
    db,
    waClient,
  });

  setupCommandHandler(
    waClient,
    getConfig,
    db,
    getSnapshot,
    (updatedConfig) => {
      config = updatedConfig;
    },
    (year: number, month: number) =>
      ensureMonthSnapshot(umaMoe, config.circleId, year, month),
    async (): Promise<ForceFetchResult> => {
      const { year, month } = getDataDateComponents();
      const current = await fetchAndSaveSnapshot(
        umaMoe,
        getConfig().circleId,
        year,
        month,
        { force: true },
      );
      if (current.snapshot) setCachedSnapshot(current.snapshot);

      const currentDay = current.snapshot
        ? getDataDayFromSnapshot(current.snapshot)
        : null;
      if (current.snapshot !== null && currentDay !== 0) return { current };

      // No usable current-month data (month just rolled) — backfill the
      // previous month so /fetch returns the latest real data, not an empty slot.
      let prevMonth = month - 1;
      let prevYear = year;
      while (prevMonth <= 0) {
        prevMonth += 12;
        prevYear--;
      }
      const previous = await fetchAndSaveSnapshot(
        umaMoe,
        getConfig().circleId,
        prevYear,
        prevMonth,
        { force: true },
      );
      if (previous.snapshot) setCachedSnapshot(previous.snapshot);
      return { current, previous };
    },
  );
  log.info("WhatsApp", "Command dispatch registered");

  let scheduler: Scheduler | undefined;

  setInterval(() => {
    try {
      const currentMtime = statSync(configPath).mtimeMs;
      const currentContent = readFileSync(configPath, "utf-8");
      const mtimeChanged = currentMtime !== lastConfigMtime;
      const contentChanged = currentContent !== lastConfigHash;

      if (mtimeChanged || contentChanged) {
        lastConfigMtime = currentMtime;
        lastConfigHash = currentContent;

        // First read after initial failure — don't trigger false reload
        if (!initialReadOk) {
          initialReadOk = true;
          log.info(
            "Config",
            "config.yaml is now accessible (initial read was deferred)",
          );
          return;
        }

        try {
          const oldConfig = config;
          config = loadConfig();
          log.configure({ ...config.logging, timezone: config.timezone });

          const diff = configChanged(oldConfig, config);
          if (!diff.changed) {
            log.debug(
              "Config",
              "config.yaml touched but content unchanged (mtime-only change)",
            );
            return;
          }

          log.info("Config", "Reloaded from config.yaml");
          const changedFields: string[] = [];
          for (const key of Object.keys(config) as (keyof BotConfig)[]) {
            const oldVal = JSON.stringify(
              (oldConfig as unknown as Record<string, unknown>)[key],
            );
            const newVal = JSON.stringify(
              (config as unknown as Record<string, unknown>)[key],
            );
            if (oldVal !== newVal) changedFields.push(key);
          }
          if (changedFields.length > 0) {
            log.info("Config", `Changed fields: ${changedFields.join(", ")}`);
          }
          recordConfigReload(changedFields);

          if (diff.scheduleChanged) {
            log.info("Config", "Schedule changed — restarting scheduler");
          } else {
            log.info("Config", "Config reloaded from config.yaml");
          }

          if (!deepEqual(oldConfig.database, config.database)) {
            log.warn(
              "Config",
              "Database config changed — restart required to apply new database settings",
            );
          }

          if (scheduler) {
            scheduler.stop();
            scheduler.start();
            recordSchedulerRestart();
          }
        } catch (err) {
          log.error("Config", "Failed to reload config.yaml", err);
        }
      }
    } catch (err) {
      log.warn(
        "Config",
        "Config watch poll failed (file may be locked by another process)",
        err,
      );
    }
  }, CONFIG_POLL_MS);
  log.info(
    "Config",
    `Watching config.yaml for changes (polling every ${CONFIG_POLL_MS / 1000}s)`,
  );

  const { year: currentYear, month: currentMonth } = getDataDateComponents();
  const todayStr = getDataDate();

  const currentResult = await fetchAndSaveSnapshot(
    umaMoe,
    config.circleId,
    currentYear,
    currentMonth,
  );
  if (currentResult.snapshot) setCachedSnapshot(currentResult.snapshot);

  for (const offset of PREFETCH_OFFSETS) {
    try {
      let prevMonth = currentMonth - offset;
      let prevYear = currentYear;
      while (prevMonth <= 0) {
        prevMonth += 12;
        prevYear--;
      }
      await fetchAndSaveSnapshot(umaMoe, config.circleId, prevYear, prevMonth);
    } catch (error) {
      log.warn("Data", `Failed to pre-fetch month -${offset}`, error);
    }
  }

  // Load latest for member history + rank history
  const latestSnapshot = loadLatestSnapshot();
  if (latestSnapshot && latestSnapshot.members.length > 0)
    setCachedSnapshot(latestSnapshot);
  if (latestSnapshot) {
    try {
      await updateMemberHistory(latestSnapshot, db);
      await db.saveRankHistory({
        date: latestSnapshot.circle.last_updated?.split("T")[0] ?? todayStr,
        circle_id: latestSnapshot.circle.circle_id,
        monthly_rank: latestSnapshot.circle.monthly_rank,
        monthly_point: latestSnapshot.circle.monthly_point,
        club_rank: latestSnapshot.club_rank,
        fans_to_next_tier: latestSnapshot.fans_to_next_tier,
        fans_to_lower_tier: latestSnapshot.fans_to_lower_tier,
      });
      log.debug("Data", "Member history and rank history updated");
    } catch (err) {
      log.warn("Data", "Failed to update member/rank history", err);
    }
  }

  const apiPortRaw = parseInt(process.env.API_PORT ?? "3000", 10);
  const apiPort = apiPortRaw >= 1 && apiPortRaw <= 65535 ? apiPortRaw : 3000;
  const api = new ApiServer(
    apiPort,
    getSnapshot,
    getConfig,
    {
      isConnected: () => waClient.isConnected(),
      getGroups: () => waClient.getGroups(),
      getChats: () => waClient.getChats(),
    },
    db,
  );
  await api.start();

  const onDataFetch = async () => {
    try {
      const { year, month } = getDataDateComponents();
      const result = await fetchAndSaveSnapshot(
        umaMoe,
        getConfig().circleId,
        year,
        month,
      );
      if (result.snapshot) {
        setCachedSnapshot(result.snapshot);
      }
      log.info(
        "Data",
        `Scheduled data fetch: ${result.saved ? "saved" : result.reason}`,
      );
    } catch (error) {
      log.error("Data", "Scheduled data fetch failed", error);
    }
  };

  scheduler = new Scheduler(
    getConfig,
    db,
    (type, options) => orchestrator.sendReport(type, options),
    (types) => orchestrator.sendScheduledCombinedReport(types),
    onDataFetch,
  );
  scheduler.start();
  log.info(
    "Scheduler",
    `Started (daily: ${config.schedule.daily.time}, weekly: ${config.schedule.weekly.time} days ${config.schedule.weekly.days.join(",")}, monthly: ${config.schedule.monthly.time} day ${config.schedule.monthly.day})`,
  );

  // Retries forever on network errors; rejects on pre-open close so the
  // promise never hangs. Internal reconnects continue regardless — the poll
  // below starts catch-up after the first successful "open" of any attempt.
  waClient.connect().catch((err) => {
    log.error(
      "WhatsApp",
      "Connection error during startup — reconnecting in background",
      err,
    );
  });

  const runPostConnectTasks = async () => {
    while (!waClient.isConnected()) {
      await new Promise((resolve) => setTimeout(resolve, CONNECT_POLL_MS));
    }
    log.info("WhatsApp", "Connected — running catch-up");

    try {
      const catchUp = new CatchUpManager(db, getConfig);
      const missed = await catchUp.detectMissedReports();

      if (getConfig().catchUp.enabled) {
        if (missed.length > 0) {
          log.info(
            "CatchUp",
            `Detected ${missed.length} missed reports: ${missed.join(", ")}`,
          );

          const sendReportCollectingAlerts = async (
            type: string,
            options?: { isCatchUp?: boolean; offset?: number },
          ) => {
            return orchestrator.sendReport(type, {
              ...options,
              collectAlerts: true,
            });
          };

          const result = await catchUp.executeCatchUp(
            sendReportCollectingAlerts,
            (types) => orchestrator.sendCombinedCatchUp(types),
          );
          log.info(
            "CatchUp",
            `Complete: ${result.sent} sent, ${result.skipped} skipped, ${result.failed} failed`,
          );

          if (result.alerts.length > 0) {
            const alerts = result.alerts as import("./alerts/alerts").Alert[];
            await orchestrator.deliverAlerts(alerts, true);
            await orchestrator.markAlertsByEventKeys(
              alerts.map((a) => a.eventKey),
            );
          }
        } else {
          log.debug("CatchUp", "No missed reports detected");
        }
      } else if (missed.length > 0) {
        // Catch-up disabled — record skipped so future detection won't re-trigger
        await catchUp.recordSkippedReports(missed);
      }

      // Post-catch-up: participants are now known, so session pruning can't
      // hit active members' files.
      try {
        await waClient.runAuthMaintenance();
      } catch (err) {
        log.warn("WhatsApp", "Auth maintenance after catch-up failed", err);
      }

      try {
        const lastDaily = await db.getLastSuccessfulRun("daily");
        let lastActivityTs: number | null = null;
        if (lastDaily) {
          lastActivityTs = new Date(
            lastDaily.sent_at ?? lastDaily.scheduled_at,
          ).getTime();
        }
        if (
          lastActivityTs === null ||
          Date.now() - lastActivityTs > INACTIVITY_WARNING_MS
        ) {
          log.warn(
            "WhatsApp",
            "Bot was inactive >7 days — WhatsApp revokes sessions after ~14 days offline; QR rescan may be required",
          );
        }
      } catch (err) {
        log.warn("WhatsApp", "Failed to check last activity", err);
      }
    } catch (err) {
      // Unexpected error — connection drops self-heal via auto-reconnect
      log.error("WhatsApp", "Post-connect tasks failed", err);
    }
  };

  void runPostConnectTasks();

  const cleanup = async () => {
    log.info("Bot", "Shutting down...");
    scheduler?.stop();
    try {
      await umaMoe.closeSession();
      log.debug("Bot", "Playwright browser session closed");
    } catch (err) {
      log.warn("Bot", "Failed to close Playwright session", err);
    }
    waClient?.disconnect();
    await db.close();
    try {
      unlinkSync(PID_FILE);
    } catch {}
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  process.on("exit", () => {
    try {
      unlinkSync(PID_FILE);
    } catch {}
  });

  log.info("Bot", "Uma Club Bot v3 ready");
}

main().catch((error) => {
  log.error("Bot", "Fatal error", error);
  process.exit(1);
});
