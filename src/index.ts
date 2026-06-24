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

import { loadConfig } from './config';
import type { BotConfig, Snapshot } from './types';
import { Database } from './db/database';
import { UmaMoeClient } from './api/uma-moe';
import { ApiServer } from './api/server';
import { Scheduler } from './scheduler/scheduler';
import { CatchUpManager } from './scheduler/catchup';
import { WhatsAppClient } from './whatsapp/client';
import { setupCommandHandler } from './whatsapp/dispatch';

import { loadLatestSnapshot, saveSnapshot, getLatestSnapshotDate, staleSnapshotMessage, ensureMonthSnapshot, getDataDayFromSnapshot } from './data/snapshot';
import { updateMemberHistory } from './data/member-history';
import { getDataDate, getDataDateComponents, getTargetMonth } from './utils/timezone';
import { writeFileSync, unlinkSync, mkdirSync, existsSync, statSync, readFileSync } from 'fs';
import { log } from './utils/logger';
import { recordConfigReload, recordSchedulerRestart } from './runtime';
import { computeMembers } from './reports/compute';
import { ReportOrchestrator } from './orchestrator/report-orchestrator';
import { preFetchMonthlySnapshot } from './scheduler/helpers';

const PID_FILE = 'data/bot.pid';

// Global error handlers
process.on('unhandledRejection', (reason) => {
  log.error('Bot', `Unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`);
});

process.on('uncaughtException', (err) => {
  log.error('Bot', `Uncaught exception: ${err.message}`, err);
  process.exit(1);
});

function arraysEqual(a: unknown[], b: unknown[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function configChanged(oldCfg: BotConfig, newCfg: BotConfig): { changed: boolean; scheduleChanged: boolean } {
  const scheduleChanged = (
    oldCfg.schedule.daily.time !== newCfg.schedule.daily.time ||
    oldCfg.schedule.daily.enabled !== newCfg.schedule.daily.enabled ||
    oldCfg.schedule.weekly.time !== newCfg.schedule.weekly.time ||
    oldCfg.schedule.weekly.enabled !== newCfg.schedule.weekly.enabled ||
    !arraysEqual(oldCfg.schedule.weekly.days, newCfg.schedule.weekly.days) ||
    oldCfg.schedule.monthly.time !== newCfg.schedule.monthly.time ||
    oldCfg.schedule.monthly.enabled !== newCfg.schedule.monthly.enabled ||
    oldCfg.schedule.monthly.day !== newCfg.schedule.monthly.day
  );
  const anyChanged = scheduleChanged ||
    !deepEqual(oldCfg.groups, newCfg.groups) ||
    !deepEqual(oldCfg.admins, newCfg.admins) ||
    !deepEqual(oldCfg.alerts, newCfg.alerts) ||
    !deepEqual(oldCfg.requirements, newCfg.requirements) ||
    !deepEqual(oldCfg.catchUp, newCfg.catchUp) ||
    !deepEqual(oldCfg.message, newCfg.message) ||
    !deepEqual(oldCfg.memberStatus, newCfg.memberStatus) ||
    !deepEqual(oldCfg.commands, newCfg.commands) ||
    oldCfg.timezone !== newCfg.timezone ||
    oldCfg.circleId !== newCfg.circleId;
  return { changed: anyChanged, scheduleChanged };
}

async function main() {
  // Save PID for stop script
  try {
    if (!existsSync('data')) mkdirSync('data', { recursive: true });
    writeFileSync(PID_FILE, String(process.pid), 'utf-8');
  } catch (err) {
    log.warn('Bot', `Failed to write PID file: ${err instanceof Error ? err.message : String(err)}`);
  }
  log.info('Bot', 'Uma Club Bot v3 starting...');

  // ── 1. Load config + init DB ──
  let config = loadConfig();
  log.configure({ ...config.logging, timezone: config.timezone });

  const db = new Database('data/bot.db');
  await db.initialize();
  log.info('Bot', `Database initialized`);

  log.info('Bot', `Circle ID: ${config.circleId}`);
  log.info('Bot', `Timezone: ${config.timezone}`);
  log.info('Bot', `Log level: ${config.logging.level}`);

  // ── 1b. Watch config.yaml for manual edits (polling-based, reliable on Windows) ──
  const configPath = require('path').resolve('config.yaml');
  let lastConfigMtime = 0;
  let lastConfigHash = '';
  let initialReadOk = false;
  try {
    lastConfigMtime = statSync(configPath).mtimeMs;
    lastConfigHash = readFileSync(configPath, 'utf-8');
    initialReadOk = true;
  } catch (err) {
    log.warn('Config', `Could not stat config.yaml at startup: ${err instanceof Error ? err.message : String(err)}`);
  }

  const umaMoe = new UmaMoeClient();
  const getSnapshot = () => loadLatestSnapshot();
  const getConfig = () => config;

  // ── 2. WhatsApp client (connect later) ──
  const waClient = new WhatsAppClient(getConfig);

  // ── 3. Report orchestrator ──
  const orchestrator = new ReportOrchestrator({ getConfig, getSnapshot, umaMoe, db, waClient });

  setupCommandHandler(waClient, getConfig, db, getSnapshot, (updatedConfig) => {
    config = updatedConfig;
  }, (year: number, month: number) => ensureMonthSnapshot(umaMoe, config.circleId, year, month));
  log.info('WhatsApp', 'Command dispatch registered');

  // ── 4. Config watcher ──
  let scheduler: Scheduler | undefined;

  setInterval(() => {
    try {
      const currentMtime = statSync(configPath).mtimeMs;
      const currentContent = readFileSync(configPath, 'utf-8');
      const mtimeChanged = currentMtime !== lastConfigMtime;
      const contentChanged = currentContent !== lastConfigHash;

      if (mtimeChanged || contentChanged) {
        lastConfigMtime = currentMtime;
        lastConfigHash = currentContent;

        // If initial read failed, this is the first successful read.
        // Config was already loaded by main() — don't trigger a false reload.
        if (!initialReadOk) {
          initialReadOk = true;
          log.info('Config', 'config.yaml is now accessible (initial read was deferred)');
          return;
        }

        try {
          const oldConfig = config;
          config = loadConfig();
          log.configure({ ...config.logging, timezone: config.timezone });

          const diff = configChanged(oldConfig, config);
          if (!diff.changed) {
            log.debug('Config', 'config.yaml touched but content unchanged (mtime-only change)');
            return;
          }

          log.info('Config', 'Reloaded from config.yaml');
          const changedFields: string[] = [];
          for (const key of Object.keys(config) as (keyof BotConfig)[]) {
            const oldVal = JSON.stringify((oldConfig as unknown as Record<string, unknown>)[key]);
            const newVal = JSON.stringify((config as unknown as Record<string, unknown>)[key]);
            if (oldVal !== newVal) changedFields.push(key);
          }
          if (changedFields.length > 0) {
            log.info('Config', `Changed fields: ${changedFields.join(', ')}`);
          }
          recordConfigReload(changedFields);

          if (diff.scheduleChanged) {
            log.info('Config', 'Schedule changed — restarting scheduler');
          } else {
            log.info('Config', 'Config reloaded from config.yaml');
          }

          // Always restart scheduler on any config change
          if (scheduler) {
            scheduler.stop();
            scheduler.start();
            recordSchedulerRestart();
          }
        } catch (err) {
          log.error('Config', 'Failed to reload config.yaml', err);
        }
      }
    } catch (err) {
      log.warn('Config', `Config watch poll failed (file may be locked by another process): ${err instanceof Error ? err.message : String(err)}`);
    }
  }, 5000);
  log.info('Config', 'Watching config.yaml for changes (polling every 5s)');

  // ── 5. Fetch fresh data if latest snapshot is stale ──
  const todayStr = getDataDate();
  const { year: currentYear, month: currentMonth, day: currentDay } = getDataDateComponents();

  const latestSnap = loadLatestSnapshot();
  let needFetch = true;
  if (latestSnap && latestSnap.members.length > 0) {
    const { year: snapYear, month: snapMonth } = latestSnap.members[0];
    const latestDataDay = getDataDayFromSnapshot(latestSnap);
    if (snapYear === currentYear && snapMonth === currentMonth && latestDataDay >= currentDay - 1) {
      needFetch = false;
      log.debug('Data', `Latest snapshot data day ${latestDataDay} >= ${currentDay - 1}, skipping fetch`);
    }
  }

  if (!needFetch) {
    log.debug('Data', `Data is fresh, skipping fetch`);
  } else {
    try {
      log.info('Data', `No snapshot for ${todayStr} — fetching from uma.moe...`);
      const snapshot = await umaMoe.fetchCircleData(config.circleId, currentYear, currentMonth);
      saveSnapshot(snapshot, todayStr);
      log.info('Data', `Snapshot saved for ${todayStr}`);
    } catch (error) {
      log.error('Data', 'Failed to fetch fresh data', error);
      const latestDate = getLatestSnapshotDate();
      const staleMsg = staleSnapshotMessage(latestDate);
      if (staleMsg) {
        log.warn('Data', staleMsg);
      } else {
        log.debug('Data', 'Using existing snapshots');
      }
    }
  }

  // ── 5a. Ensure previous months are cached (non-fatal) ──
  const offsets = [1, 2];
  for (const offset of offsets) {
    try {
      let prevMonth = currentMonth - offset;
      let prevYear = currentYear;
      while (prevMonth <= 0) { prevMonth += 12; prevYear--; }
      await ensureMonthSnapshot(umaMoe, config.circleId, prevYear, prevMonth);
    } catch (error) {
      log.warn('Data', `Failed to pre-fetch month -${offset}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ── 5b. Update member history + rank history from latest snapshot ──
  const latestSnapshot = loadLatestSnapshot();
  if (latestSnapshot) {
    updateMemberHistory(latestSnapshot, db);
    db.saveRankHistory({
      date: latestSnapshot.circle.last_updated?.split('T')[0] ?? todayStr,
      circle_id: latestSnapshot.circle.circle_id,
      monthly_rank: latestSnapshot.circle.monthly_rank,
      monthly_point: latestSnapshot.circle.monthly_point,
      club_rank: latestSnapshot.club_rank,
      fans_to_next_tier: latestSnapshot.fans_to_next_tier,
      fans_to_lower_tier: latestSnapshot.fans_to_lower_tier,
    });
    log.debug('Data', 'Member history and rank history updated');
  }

  // ── 6. Start API server ──
  const apiPortRaw = parseInt(process.env.API_PORT ?? '3000', 10);
  const apiPort = (apiPortRaw >= 1 && apiPortRaw <= 65535) ? apiPortRaw : 3000;
  const api = new ApiServer(apiPort, getSnapshot, getConfig, {
    isConnected: () => waClient.isConnected(),
    getGroups: () => waClient.getGroups(),
    getChats: () => waClient.getChats(),
  });
  await api.start();

  // ── 7. Start scheduler + Connect WhatsApp ──
  const onDataFetch = async () => {
    try {
      const { year: currentYear, month: currentMonth } = getDataDateComponents();
      const snapshot = await umaMoe.fetchCircleData(config.circleId, currentYear, currentMonth);
      saveSnapshot(snapshot, getDataDate());
      log.info('Data', 'Scheduled data fetch completed');
    } catch (error) {
      log.error('Data', 'Scheduled data fetch failed', error);
    }
  };

  scheduler = new Scheduler(getConfig, db, (type, options) => orchestrator.sendReport(type, options), async (types) => {
    // Combined report: generate all reports and send as one message
    const snapshot = getSnapshot();
    if (!snapshot) return;

    const currentConfig = getConfig();

    // Pre-fetch monthly data if monthly report is in the combined set
    if (types.includes('monthly')) {
      await preFetchMonthlySnapshot(
        (y, m) => ensureMonthSnapshot(umaMoe, currentConfig.circleId, y, m),
        1,
        'combined report'
      );
    }

    const computedMembers = computeMembers(snapshot, currentConfig);
    const combined = orchestrator.generateCombinedReportString(types, snapshot, currentConfig, computedMembers);
    await orchestrator.deliverReport(combined, types.join('+'));

    // Detect alerts for each combined report type
    for (const type of types) {
      await orchestrator.processAlertsForReport(type, snapshot, currentConfig, computedMembers);
    }
  }, onDataFetch);
  scheduler.start();
  log.info('Scheduler', `Started (daily: ${config.schedule.daily.time}, weekly: ${config.schedule.weekly.time} days ${config.schedule.weekly.days.join(',')}, monthly: ${config.schedule.monthly.time} day ${config.schedule.monthly.day})`);

  // Connect WhatsApp (retries forever on network errors, rejects only for
  // loggedOut/badSession which require user action).
  waClient.connect().then(async () => {
    log.info('WhatsApp', 'Connected — running catch-up');

    // Run catch-up with alert aggregation
    if (getConfig().catchUp.enabled) {
      const catchUp = new CatchUpManager(db, getConfig);
      const missed = catchUp.detectMissedReports();
      if (missed.length > 0) {
        log.info('CatchUp', `Detected ${missed.length} missed reports: ${missed.join(', ')}`);

        const sendReportCollectingAlerts = async (type: string, options?: { isCatchUp?: boolean; offset?: number }) => {
          return orchestrator.sendReport(type, { ...options, collectAlerts: true });
        };

        const result = await catchUp.executeCatchUp(sendReportCollectingAlerts, (types) => orchestrator.sendCombinedCatchUp(types));
        log.info('CatchUp', `Complete: ${result.sent} sent, ${result.skipped} skipped, ${result.failed} failed`);

        if (result.alerts.length > 0) {
          await orchestrator.deliverAlerts(result.alerts as import('./alerts/alerts').Alert[], true);
        }
      } else {
        log.debug('CatchUp', 'No missed reports detected');
      }
    }
  }).catch((err) => {
    // Unexpected error — loggedOut/badSession now self-heal via auto-reconnect
    log.error('WhatsApp', `${(err as Error).message}`);
  });

  // ── 8. Graceful shutdown ──
  const cleanup = () => {
    log.info('Bot', 'Shutting down...');
    scheduler?.stop();
    waClient?.disconnect();
    db.close();
    try { unlinkSync(PID_FILE); } catch {}
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('exit', () => { try { db.close(); } catch {} try { unlinkSync(PID_FILE); } catch {} });

  log.info('Bot', 'Uma Club Bot v3 ready');
}

main().catch((error) => {
  log.error('Bot', 'Fatal error', error);
  process.exit(1);
});
