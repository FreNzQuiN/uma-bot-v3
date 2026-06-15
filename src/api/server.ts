/**
 * REST API server for Uma Club Bot v3.
 *
 * Serves reports and data over HTTP on localhost only.
 * Uses Node.js built-in http module (no Express).
 * All responses use standard envelope format.
 */

import http from 'http';
import type { Snapshot, BotConfig } from '../types';
import { getDataDayFromSnapshot } from '../data/snapshot';
import { computeMembers } from '../reports/compute';
import { computeTierData } from '../reports/tier';
import { log } from '../utils/logger';
import { getRuntimeStats, getUptimeMs } from '../runtime';

// ============================================================
// Response envelope
// ============================================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  meta?: Record<string, unknown>;
}

export function createResponse(
  res: http.ServerResponse,
  status: number,
  body: ApiResponse
): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// ============================================================
// API Server
// ============================================================

export class ApiServer {
  private port: number;
  private snapshotLoader: () => Snapshot | null;
  private configLoader: () => BotConfig;
  private waConnected: () => boolean = () => false;
  private server: http.Server | null = null;

  constructor(
    port: number,
    snapshotLoader: () => Snapshot | null,
    config: BotConfig | (() => BotConfig)
  ) {
    this.port = port;
    this.snapshotLoader = snapshotLoader;
    this.configLoader = typeof config === 'function' ? config : () => config;
  }

  setWhatsAppConnected(check: () => boolean): void {
    this.waConnected = check;
  }

  private get config(): BotConfig {
    return this.configLoader();
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });
      this.server.timeout = 30_000; // 30 second timeout

      // Bind to localhost only (security requirement from spec)
      this.server.listen(this.port, '127.0.0.1', () => {
        log.info('API', `Server listening on http://127.0.0.1:${this.port}`);
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  private handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): void {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const path = url.pathname;

    // CORS headers for local dev
    res.setHeader('Access-Control-Allow-Origin', '*');

    try {
      if (path === '/health') {
        return this.handleHealth(res);
      }

      const snapshot = this.snapshotLoader();
      if (!snapshot) {
        return createResponse(res, 503, {
          success: false,
          error: 'No snapshot available',
        });
      }

      if (path === '/reports/daily') {
        return this.handleReport(res, snapshot, 'daily');
      }
      if (path === '/reports/weekly') {
        return this.handleReport(res, snapshot, 'weekly');
      }
      if (path === '/reports/monthly') {
        return this.handleReport(res, snapshot, 'monthly');
      }
      if (path === '/reports/stats') {
        return this.handleReport(res, snapshot, 'stats');
      }
      if (path === '/reports/bottom') {
        return this.handleReport(res, snapshot, 'bottom');
      }
      if (path === '/reports/ranks') {
        return this.handleReport(res, snapshot, 'ranks');
      }
      if (path === '/reports/members' || path === '/members') {
        return this.handleMembers(res, snapshot);
      }
      if (path.startsWith('/members/')) {
        const viewerId = path.split('/')[2];
        return this.handleMemberDetail(res, snapshot, viewerId);
      }
      if (path === '/tier') {
        return this.handleTier(res, snapshot);
      }
      if (path === '/snapshots') {
        return this.handleSnapshots(res);
      }

      createResponse(res, 404, {
        success: false,
        error: 'Not found',
      });
    } catch (error) {
      log.error('API', 'Request handler error', error);
      createResponse(res, 500, {
        success: false,
        error: 'Internal server error',
      });
    }
  }

  private handleHealth(res: http.ServerResponse): void {
    const rt = getRuntimeStats();
    createResponse(res, 200, {
      success: true,
      data: {
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptimeMs: getUptimeMs(),
        waConnected: this.waConnected(),
        waState: rt.connectionState,
        configReloads: rt.configReloadCount,
        schedulerRestarts: rt.schedulerRestartCount,
        reconnects: rt.reconnectCount,
        messagesReceived: rt.messagesReceived,
        messagesParsed: rt.messagesParsed,
        messagesResponded: rt.messagesResponded,
        messagesFailed: rt.messagesFailed,
        lastDisconnect: rt.lastDisconnectReason,
        lastDisconnectTime: rt.lastDisconnectTime,
        socketCreatedCount: rt.socketCreatedCount,
      },
    });
  }

  private handleReport(
    res: http.ServerResponse,
    snapshot: Snapshot,
    reportType: string
  ): void {
    const dataDay = getDataDayFromSnapshot(snapshot);
    const members = computeMembers(snapshot, this.config);

    const meta = {
      snapshotDate: snapshot.circle.last_updated?.split('T')[0] ?? 'unknown',
      timezone: this.config.timezone,
      stale: false,
      dataDay,
    };

    // Return raw computed data — the WhatsApp layer handles formatting
    const reportData: Record<string, unknown> = {
      reportType,
      circle: {
        name: snapshot.circle.name,
        rank: snapshot.circle.monthly_rank,
        monthlyPoint: snapshot.circle.monthly_point,
      },
      members: members.map((m) => ({
        name: m.trainerName,
        status: m.status,
        monthlyGain: m.monthlyGain,
        latestDailyGain: m.latestDailyGain,
        isTransfer: m.isTransfer,
      })),
    };

    createResponse(res, 200, { success: true, data: reportData, meta });
  }

  private handleMembers(res: http.ServerResponse, snapshot: Snapshot): void {
    const members = computeMembers(snapshot, this.config);
    const dataDay = getDataDayFromSnapshot(snapshot);

    createResponse(res, 200, {
      success: true,
      data: members.map((m) => ({
        viewerId: m.viewerId,
        name: m.trainerName,
        status: m.status,
        monthlyGain: m.monthlyGain,
        latestDailyGain: m.latestDailyGain,
        isTransfer: m.isTransfer,
        previousCircleName: m.previousCircleName,
      })),
      meta: {
        total: members.length,
        active: members.filter((m) => m.status === 'active').length,
        dataDay,
      },
    });
  }

  private handleMemberDetail(
    res: http.ServerResponse,
    snapshot: Snapshot,
    viewerId: string
  ): void {
    const members = computeMembers(snapshot, this.config);
    const member = members.find((m) => String(m.viewerId) === viewerId);

    if (!member) {
      return createResponse(res, 404, {
        success: false,
        error: `Member ${viewerId} not found`,
      });
    }

    createResponse(res, 200, {
      success: true,
      data: {
        viewerId: member.viewerId,
        name: member.trainerName,
        status: member.status,
        monthlyGain: member.monthlyGain,
        latestDailyGain: member.latestDailyGain,
        isTransfer: member.isTransfer,
        previousCircleName: member.previousCircleName,
        weeklyGains: member.weeklyGains,
      },
    });
  }

  private handleTier(res: http.ServerResponse, snapshot: Snapshot): void {
    const tierData = computeTierData(snapshot);

    createResponse(res, 200, {
      success: true,
      data: tierData,
      meta: {
        snapshotDate: snapshot.circle.last_updated?.split('T')[0] ?? 'unknown',
      },
    });
  }

  private handleSnapshots(res: http.ServerResponse): void {
    const snapshot = this.snapshotLoader();
    const available = snapshot
      ? [snapshot.circle.last_updated?.split('T')[0] ?? 'unknown']
      : [];

    createResponse(res, 200, {
      success: true,
      data: available,
      meta: { total: available.length },
    });
  }
}
