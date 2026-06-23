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
import { detectAlerts, formatAlerts, aggregateAlerts } from './alerts/alerts';
import { loadLatestSnapshot, saveSnapshot, getLatestSnapshotDate, staleSnapshotMessage, snapshotExists, updateMemberHistory, ensureMonthSnapshot, getDataDayFromSnapshot } from './data/snapshot';
import { getDataDate, getDataDateComponents } from './utils/timezone';
import { writeFileSync, unlinkSync, mkdirSync, existsSync, statSync, readFileSync } from 'fs';
import { log } from './utils/logger';
import { recordConfigReload, recordSchedulerRestart, getRuntimeStats } from './runtime';

import { generateDailyReport } from './reports/daily';
import { generateWeeklyReport } from './reports/weekly';
import { generateMonthlyReport } from './reports/monthly';
import { generateRanksReport } from './reports/ranks';
import { generateBottomReport } from './reports/bottom';
import { generateStatsReport } from './reports/stats';
import { generateMembersReport } from './reports/members';
import { generateTierReport } from './reports/tier';
import { generateCombinedReport } from './reports/combined';

const PID_FILE = 'data/bot.pid';

// Global error handlers
process.on('unhandledRejection', (reason) => {
  log.error('Bot', `Unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`);
});

process.on('uncaughtException', (err) => {
  log.error('Bot', `Uncaught exception: ${err.message}`, err);
  process.exit(1);
});

function configChanged(oldCfg: BotConfig, newCfg: BotConfig): { changed: boolean; scheduleChanged: boolean } {
  const scheduleChanged = (
    oldCfg.schedule.daily.time !== newCfg.schedule.daily.time ||
    oldCfg.schedule.daily.enabled !== newCfg.schedule.daily.enabled ||
    oldCfg.schedule.weekly.time !== newCfg.schedule.weekly.time ||
    oldCfg.schedule.weekly.enabled !== newCfg.schedule.weekly.enabled ||
    JSON.stringify(oldCfg.schedule.weekly.days) !== JSON.stringify(newCfg.schedule.weekly.days) ||
    oldCfg.schedule.monthly.time !== newCfg.schedule.monthly.time ||
    oldCfg.schedule.monthly.enabled !== newCfg.schedule.monthly.enabled ||
    oldCfg.schedule.monthly.day !== newCfg.schedule.monthly.day
  );
  const anyChanged = scheduleChanged ||
    JSON.stringify(oldCfg.groups) !== JSON.stringify(newCfg.groups) ||
    JSON.stringify(oldCfg.admins) !== JSON.stringify(newCfg.admins) ||
    JSON.stringify(oldCfg.alerts) !== JSON.stringify(newCfg.alerts) ||
    JSON.stringify(oldCfg.requirements) !== JSON.stringify(newCfg.requirements) ||
    JSON.stringify(oldCfg.catchUp) !== JSON.stringify(newCfg.catchUp) ||
    JSON.stringify(oldCfg.message) !== JSON.stringify(newCfg.message) ||
    JSON.stringify(oldCfg.memberStatus) !== JSON.stringify(newCfg.memberStatus) ||
    JSON.stringify(oldCfg.commands) !== JSON.stringify(newCfg.commands) ||
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
          // This ensures cron expressions, groups, and all config values
          // are picked up immediately by scheduled tasks.
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

  const umaMoe = new UmaMoeClient();
  const getSnapshot = () => loadLatestSnapshot();
  const getConfig = () => config;

  // ── 2. WhatsApp client (connect later) ──
  const waClient = new WhatsAppClient(getConfig);
  setupCommandHandler(waClient, getConfig, db, getSnapshot, (updatedConfig) => {
    config = updatedConfig;
  }, (year: number, month: number) => ensureMonthSnapshot(umaMoe, config.circleId, year, month));
  log.info('WhatsApp', 'Command dispatch registered');

  // ── 3. Report delivery function ──
  // Throws on delivery failure so callers know the true status.
  async function deliverReport(reportText: string, type: string) {
    const currentConfig = getConfig();
    if (!waClient.isConnected()) {
      log.debug('Report', `${type} report generated (${reportText.length} chars) — WhatsApp not connected, skipping delivery`);
      if (currentConfig.groups.announcement.length > 0) {
        throw new Error('WhatsApp not connected');
      }
      return;
    }
    let delivered = false;
    for (const groupJid of currentConfig.groups.announcement) {
      try {
        await waClient.sendMessage(groupJid, reportText);
        log.info('Report', `${type} report sent to ${groupJid}`);
        delivered = true;
      } catch (err) {
        log.error('Report', `Failed to send ${type} report to ${groupJid}`, err);
      }
    }
    if (!delivered && currentConfig.groups.announcement.length > 0) {
      throw new Error(`Failed to deliver ${type} report to all announcement groups`);
    }
  }

  async function deliverAlerts(alerts: ReturnType<typeof detectAlerts>, isCatchUp: boolean) {
    if (!waClient.isConnected() || alerts.length === 0) return;

    const alertMessage = formatAlerts(alerts, isCatchUp);
    if (!alertMessage) return;

    const currentConfig = getConfig();
    const alertTargets = currentConfig.alerts.defaultRecipients === 'admin'
      ? currentConfig.admins
      : currentConfig.groups.alertAdmin;

    for (const target of alertTargets) {
      try {
        await waClient.sendMessage(target, alertMessage);
        log.info('Alert', `Alerts sent to ${target}`);
      } catch (err) {
        log.error('Alert', `Failed to send alerts to ${target}`, err);
      }
    }
  }

  // ── 4a. Helper functions for sendReport ──

  // Month-alignment + stale data pre-fetch.
  // If the snapshot is from a different month, or data is 2+ days behind,
  // fetch fresh data from uma.moe. Returns the (possibly refreshed) snapshot.
  async function alignSnapshotToMonth(
    type: string,
    snapshot: Snapshot,
    currentConfig: BotConfig
  ): Promise<Snapshot> {
    // ════════════════════════════════════════════════════════════════
    // Month-alignment guard for daily/weekly (Step 4)
    // ════════════════════════════════════════════════════════════════
    // If the snapshot is from a different month, fetch fresh data
    if (type === 'daily' || type === 'weekly') {
      const { year: snapYear, month: snapMonth } = snapshot.members[0];
      const { year: curYear, month: curMonth } = getDataDateComponents();
      if (snapYear !== curYear || snapMonth !== curMonth) {
        try {
          log.info('Report', `Snapshot is from ${snapYear}-${snapMonth}, fetching current month ${curYear}-${curMonth}`);
          const freshSnapshot = await umaMoe.fetchCircleData(currentConfig.circleId, curYear, curMonth);
          saveSnapshot(freshSnapshot, getDataDate());
          snapshot = freshSnapshot;
          log.info('Report', `Fresh data fetched for ${type} report`);
        } catch (err) {
          log.warn('Report', `Cannot fetch fresh data for ${type} report (snapshot is from previous month)`, err);
          throw new Error(`Tidak ada data untuk ${type} report bulan ini. Data terakhir: ${snapYear}-${snapMonth}`);
        }
      }
    }

    // ════════════════════════════════════════════════════════════════
    // Stale data pre-fetch for daily/weekly (Step 5)
    // ════════════════════════════════════════════════════════════════
    // Same-month: if data is 2+ days behind, try refreshing
    if ((type === 'daily' || type === 'weekly') && snapshot) {
      const dataDay = getDataDayFromSnapshot(snapshot);
      const { year: snapYear, month: snapMonth } = snapshot.members[0];
      const { year: curYear, month: curMonth, day: curDay } = getDataDateComponents();
      if (snapYear === curYear && snapMonth === curMonth && dataDay < curDay - 1) {
        try {
          log.info('Report', `Snapshot data day ${dataDay} is stale (current day ${curDay}), fetching fresh`);
          const freshSnapshot = await umaMoe.fetchCircleData(currentConfig.circleId, curYear, curMonth);
          saveSnapshot(freshSnapshot, getDataDate());
          snapshot = freshSnapshot;
        } catch (err) {
          log.warn('Report', `Failed to refresh stale data, using existing snapshot`, err);
        }
      }
    }

    return snapshot;
  }

  // Report generation dispatch + catch-up prefix.
  // Returns the formatted report string, or undefined for unknown report types.
  function generateReportString(
    type: string,
    snapshot: Snapshot,
    currentConfig: BotConfig,
    options?: { offset?: number; isCatchUp?: boolean }
  ): string | undefined {
    let report: string;
    switch (type) {
      case 'daily': report = generateDailyReport(snapshot, currentConfig, options?.offset, db); break;
      case 'weekly': report = generateWeeklyReport(snapshot, currentConfig, options?.offset, db); break;
      case 'monthly': report = generateMonthlyReport(snapshot, currentConfig, options?.offset, db); break;
      case 'ranks': report = generateRanksReport(snapshot, currentConfig); break;
      case 'bottom': report = generateBottomReport(snapshot, currentConfig, db); break;
      case 'stats': report = generateStatsReport(snapshot, currentConfig, db); break;
      case 'members': report = generateMembersReport(snapshot, currentConfig, db); break;
      case 'tier': report = generateTierReport(snapshot, currentConfig, db); break;
      default: log.error('Report', `Unknown report type: ${type}`); return undefined;
    }

    if (options?.isCatchUp) {
      report = `[Mode catch-up — memulihkan laporan yang terlewat]\n${report}`;
    }

    return report;
  }

  // Alert detection + recording + delivery.
  // Returns collected alerts when options.collectAlerts is true (for catch-up aggregation).
  async function processAlertsForReport(
    type: string,
    snapshot: Snapshot,
    currentConfig: BotConfig,
    options?: { isCatchUp?: boolean; collectAlerts?: boolean }
  ): Promise<import('./alerts/alerts').Alert[]> {
    // Detect and record alerts (non-critical — wrapped in try-catch)
    let alerts: import('./alerts/alerts').Alert[] = [];
    try {
      alerts = detectAlerts(snapshot, currentConfig, db);
      if (alerts.length > 0) {
        log.info('Alert', `${alerts.length} alerts detected for ${type} report`);
        const alertIds: number[] = [];
        for (const alert of alerts) {
          const alertId = db.recordAlert({
            alert_type: alert.type,
            event_key: alert.eventKey,
            member_viewer_id: alert.memberViewerId,
            report_date: alert.reportDate,
            created_at: new Date().toISOString(),
            status: 'pending',
            message: alert.message,
          });
          alertIds.push(alertId);
        }

        if (!options?.collectAlerts) {
          await deliverAlerts(alerts, options?.isCatchUp ?? false);
          for (const alertId of alertIds) {
            db.markAlertSent(alertId);
          }
        }
      }
    } catch (err) {
      log.error('Alert', `Alert processing failed for ${type} report (report was delivered)`, err);
    }

    // Return alerts for aggregation when requested (catch-up)
    if (options?.collectAlerts && alerts.length > 0) {
      return alerts;
    }
    return [];
  }

  // ── 4. SendReport: generates report + detects alerts ──
  // Returns collected alerts when options.collectAlerts is true (for catch-up aggregation)
  // Throws when no snapshot is available so callers (scheduler, catchup) know it failed.
  async function sendReport(
    type: string,
    options?: { offset?: number; isCatchUp?: boolean; collectAlerts?: boolean }
  ): Promise<import('./alerts/alerts').Alert[]> {
    let snapshot = getSnapshot();
    if (!snapshot) {
      throw new Error(`No snapshot available for ${type} report`);
    }
    if (snapshot.members.length === 0) {
      throw new Error(`Snapshot has no members for ${type} report`);
    }

    const currentConfig = getConfig();

    // ════════════════════════════════════════════════════════════════
    // Month-alignment + stale data pre-fetch (Steps 4+5)
    // ════════════════════════════════════════════════════════════════
    snapshot = await alignSnapshotToMonth(type, snapshot, currentConfig);

    // Pre-fetch target month for monthly reports with offset (Step 1a)
    if (type === 'monthly' && Math.abs(options?.offset ?? 0) > 0) {
      const absOffset = Math.abs(options!.offset!);
      const { year: curYear, month: curMonth } = getDataDateComponents();
      let targetMonth = curMonth - absOffset;
      let targetYear = curYear;
      while (targetMonth <= 0) {
        targetMonth += 12;
        targetYear--;
      }
      // Only pre-fetch if target differs from the already-loaded snapshot month
      const { year: snapYear, month: snapMonth } = snapshot.members[0];
      if (targetYear !== snapYear || targetMonth !== snapMonth) {
        try {
          await ensureMonthSnapshot(umaMoe, currentConfig.circleId, targetYear, targetMonth);
        } catch (err) {
          log.warn('Report', `Failed to pre-fetch month ${targetYear}-${targetMonth} for offset report: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    // Generate report string
    const report = generateReportString(type, snapshot, currentConfig, options);
    if (report === undefined) return [];
    log.info('Report', `${type} report generated (${report.length} chars)`);

    // Deliver report first — this is the primary deliverable
    await deliverReport(report, type);

    // Detect, record, and deliver alerts
    return processAlertsForReport(type, snapshot, currentConfig, options);
  }

  // ── 5. Fetch fresh data if latest snapshot is stale ──
  const todayStr = getDataDate();
  const { year: currentYear, month: currentMonth, day: currentDay } = getDataDateComponents();

  const latestSnap = loadLatestSnapshot();
  let needFetch = true;
  if (latestSnap && latestSnap.members.length > 0) {
    const { year: snapYear, month: snapMonth } = latestSnap.members[0];
    const latestDataDay = getDataDayFromSnapshot(latestSnap);
    // Data is fresh if: same month AND (today's data exists OR yesterday's data exists and today hasn't completed yet)
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
  const api = new ApiServer(apiPort, getSnapshot, getConfig);
  api.setWhatsAppConnected(() => waClient.isConnected());
  api.setWhatsAppGroups(() => waClient.getGroups());
  api.setWhatsAppChats(() => waClient.getChats());
  await api.start();

  // ── 7. Start scheduler + Connect WhatsApp ──
  // Scheduler starts immediately. It handles WA-not-connected gracefully:
  // deliverReport throws, scheduler marks the run as 'failed'. Reports deliver
  // normally once WA reconnects — no restart needed.
  let scheduler: Scheduler | undefined;

  // Define scheduled data fetch callback
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

  scheduler = new Scheduler(getConfig, db, sendReport, async (types) => {
    // Combined report: generate all reports and send as one message
    const snapshot = getSnapshot();
    if (!snapshot) return;

    const currentConfig = getConfig();

    // Pre-fetch monthly data if monthly report is in the combined set
    // On day 1, target previous month (offset=-1) for monthly
    if (types.includes('monthly')) {
      const { year: curYear, month: curMonth } = getDataDateComponents();
      let targetMonth = curMonth - 1;
      let targetYear = curYear;
      while (targetMonth <= 0) { targetMonth += 12; targetYear--; }
      try {
        await ensureMonthSnapshot(umaMoe, currentConfig.circleId, targetYear, targetMonth);
      } catch (err) {
        log.warn('Report', `Failed to pre-fetch month ${targetYear}-${targetMonth} for combined report`, err);
      }
    }

    const combined = generateCombinedReport(types, snapshot, currentConfig, db);
    await deliverReport(combined, types.join('+'));
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

        // Collect alerts from all catch-up reports
        const allCatchUpAlerts: import('./alerts/alerts').Alert[] = [];
        const sendReportCollectingAlerts = async (type: string, options?: { isCatchUp?: boolean }) => {
          const reportOptions: { isCatchUp?: boolean; collectAlerts?: boolean; offset?: number } = { ...options, collectAlerts: true };
          if (type === 'monthly') {
            reportOptions.offset = -1;
          }
          const alerts = await sendReport(type, reportOptions);
          allCatchUpAlerts.push(...alerts);
        };

        const result = await catchUp.executeCatchUp(sendReportCollectingAlerts, async (types) => {
          const snapshot = getSnapshot();
          if (!snapshot) throw new Error('No snapshot available for combined catch-up report');
          const currentConfig = getConfig();
          const combined = generateCombinedReport(types, snapshot, currentConfig, db);
          await deliverReport(`[Mode catch-up — memulihkan laporan yang terlewat]\n${combined}`, types.join('+'));
        });
        log.info('CatchUp', `Complete: ${result.sent} sent, ${result.skipped} skipped, ${result.failed} failed`);

        // Send aggregated catch-up alerts
        if (allCatchUpAlerts.length > 0) {
          const aggregated = aggregateAlerts(allCatchUpAlerts);
          if (aggregated) {
            const currentConfig = getConfig();
            const alertTargets = currentConfig.alerts.defaultRecipients === 'admin'
              ? currentConfig.admins
              : currentConfig.groups.alertAdmin;
            for (const target of alertTargets) {
              try {
                await waClient.sendMessage(target, aggregated);
                log.info('CatchUp', `Aggregated alerts sent to ${target}`);
              } catch (err) {
                log.error('CatchUp', `Failed to send catch-up alerts to ${target}`, err);
              }
            }
          }
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
