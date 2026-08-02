/**
 * REST API server for Uma Club Bot v3.
 *
 * Serves reports and data over HTTP on localhost only.
 * Uses Node.js built-in http module (no Express).
 * All responses use standard envelope format.
 */

import http from "http";
import crypto from "crypto";
import type { Snapshot, BotConfig } from "../types";
import type { IDatabase } from "../db/types";
import { getDataDayFromSnapshot } from "../data/snapshot";
import { computeMembers, computeTierData } from "../reports/compute";
import { log } from "../utils/logger";
import { getRuntimeStats, getUptimeMs } from "../runtime";
import { getDataDateComponents } from "../utils/timezone";

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  meta?: Record<string, unknown>;
}

export function createResponse(
  res: http.ServerResponse,
  status: number,
  body: ApiResponse,
): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cache-Control", "no-store, no-cache");
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

export interface WhatsAppCapabilities {
  isConnected: () => boolean;
  getGroups: () => Promise<
    Array<{ id: string; name: string; participants: number }>
  >;
  getChats: () => Array<{ jid: string; name: string; type: "dm" | "group" }>;
}

export class ApiServer {
  private port: number;
  private snapshotLoader: () => Snapshot | null;
  private configLoader: () => BotConfig;
  private waConnected: () => boolean = () => false;
  private waGroups: () => Promise<
    Array<{ id: string; name: string; participants: number }>
  > = async () => [];
  private waChats: () => Array<{
    jid: string;
    name: string;
    type: "dm" | "group";
  }> = () => [];
  private db: IDatabase | null = null;
  private requestTimestamps: Map<string, number[]> = new Map();
  private server: http.Server | null = null;
  private apiToken: string | undefined;

  constructor(
    port: number,
    snapshotLoader: () => Snapshot | null,
    config: BotConfig | (() => BotConfig),
    whatsapp?: WhatsAppCapabilities,
    db?: IDatabase,
  ) {
    this.port = port;
    this.snapshotLoader = snapshotLoader;
    this.configLoader = typeof config === "function" ? config : () => config;
    this.apiToken = process.env.API_TOKEN || undefined;
    this.db = db ?? null;
    if (whatsapp) {
      this.waConnected = whatsapp.isConnected;
      this.waGroups = whatsapp.getGroups;
      this.waChats = whatsapp.getChats;
    }
  }

  private get config(): BotConfig {
    return this.configLoader();
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });
      this.server.timeout = 30_000;

      // Bind to localhost only (security requirement from spec)
      this.server.listen(this.port, "127.0.0.1", () => {
        log.info("API", `Server listening on http://127.0.0.1:${this.port}`);
        if (!this.apiToken) {
          log.warn(
            "API",
            "No API_TOKEN set — API endpoints are unauthenticated. This is acceptable for localhost-only use.",
          );
        }
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
    res: http.ServerResponse,
  ): void {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const path = url.pathname;

    log.debug("API", `${req.method} ${path}`);

    const clientIp = req.socket.remoteAddress ?? "127.0.0.1";
    if (this.isRateLimited(clientIp)) {
      createResponse(res, 429, { success: false, error: "Too many requests" });
      return;
    }

    // Minimal liveness probe — always unauthenticated, no operational data
    if (path === "/healthz") {
      createResponse(res, 200, {
        success: true,
        data: { status: "ok", timestamp: new Date().toISOString() },
      });
      return;
    }

    if (this.apiToken) {
      const authHeader = req.headers.authorization;
      const expected = `Bearer ${this.apiToken}`;
      if (
        !authHeader ||
        authHeader.length !== expected.length ||
        !crypto.timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected))
      ) {
        createResponse(res, 401, { success: false, error: "Unauthorized" });
        return;
      }
    }

    try {
      if (path === "/health") {
        this.handleHealth(res).catch((err) => {
          log.error("API", "health handler error", err);
          createResponse(res, 500, {
            success: false,
            error: "Internal server error",
          });
        });
        return;
      }

      if (path === "/groups") {
        this.handleGroups(res).catch((err) => {
          log.error("API", "groups handler error", err);
          createResponse(res, 500, {
            success: false,
            error: "Internal server error",
          });
        });
        return;
      }

      if (path === "/chats") {
        return this.handleChats(res);
      }

      const snapshot = this.snapshotLoader();
      if (!snapshot) {
        return createResponse(res, 503, {
          success: false,
          error: "No snapshot available",
        });
      }

      if (path === "/reports/daily") {
        return this.handleReport(res, snapshot, "daily");
      }
      if (path === "/reports/weekly") {
        return this.handleReport(res, snapshot, "weekly");
      }
      if (path === "/reports/monthly") {
        return this.handleReport(res, snapshot, "monthly");
      }
      if (path === "/reports/stats") {
        return this.handleReport(res, snapshot, "stats");
      }
      if (path === "/reports/bottom") {
        return this.handleReport(res, snapshot, "bottom");
      }
      if (path === "/reports/ranks") {
        return this.handleReport(res, snapshot, "ranks");
      }
      if (path === "/reports/members" || path === "/members") {
        return this.handleMembers(res, snapshot);
      }
      if (path.startsWith("/members/")) {
        const rawId = path.split("/")[2];
        if (!rawId || !/^\d{1,15}$/.test(rawId)) {
          return createResponse(res, 400, {
            success: false,
            error: "Invalid viewerId format",
          });
        }
        return this.handleMemberDetail(res, snapshot, rawId);
      }
      if (path === "/tier") {
        return this.handleTier(res, snapshot);
      }
      if (path === "/snapshots") {
        return this.handleSnapshots(res);
      }

      createResponse(res, 404, {
        success: false,
        error: "Not found",
      });
    } catch (error) {
      log.error("API", "Request handler error", error);
      createResponse(res, 500, {
        success: false,
        error: "Internal server error",
      });
    }
  }

  private async handleHealth(res: http.ServerResponse): Promise<void> {
    const rt = getRuntimeStats();
    let dbOk = true;
    if (this.db) {
      try {
        await this.db.getLastSuccessfulRun("_health_check");
      } catch (err) {
        log.debug("API", "Health check DB probe failed", err);
        dbOk = false;
      }
    }
    createResponse(res, dbOk ? 200 : 503, {
      success: dbOk,
      data: {
        status: dbOk ? "ok" : "degraded",
        timestamp: new Date().toISOString(),
        uptimeMs: getUptimeMs(),
        dbConnected: dbOk,
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

  private async handleGroups(res: http.ServerResponse): Promise<void> {
    if (!this.waConnected()) {
      return createResponse(res, 503, {
        success: false,
        error: "WhatsApp not connected",
      });
    }
    try {
      const groups = await this.waGroups();
      createResponse(res, 200, { success: true, data: groups });
    } catch (error) {
      log.error("API", "handleGroups error", error);
      createResponse(res, 500, {
        success: false,
        error: "Internal server error",
      });
    }
  }

  private handleChats(res: http.ServerResponse): void {
    if (!this.waConnected()) {
      return createResponse(res, 503, {
        success: false,
        error: "WhatsApp not connected",
      });
    }
    const chats = this.waChats();
    createResponse(res, 200, {
      success: true,
      data: chats,
      meta: { count: chats.length },
    });
  }

  private isRateLimited(ip: string): boolean {
    const now = Date.now();
    const windowMs = 1000;
    const maxRequests = 50;
    const timestamps = this.requestTimestamps.get(ip) ?? [];
    const recent = timestamps.filter((t) => now - t < windowMs);
    if (recent.length >= maxRequests) return true;
    recent.push(now);
    this.requestTimestamps.set(ip, recent);
    return false;
  }

  private handleReport(
    res: http.ServerResponse,
    snapshot: Snapshot,
    reportType: string,
  ): void {
    const dataDay = getDataDayFromSnapshot(snapshot);
    const members = computeMembers(snapshot, this.config);

    const snapshotYear = snapshot.members[0]?.year;
    const snapshotMonth = snapshot.members[0]?.month;
    const {
      year: currentYear,
      month: currentMonth,
      day: currentDay,
    } = getDataDateComponents();
    const stale =
      snapshotYear === currentYear &&
      snapshotMonth === currentMonth &&
      dataDay < currentDay - 1;

    const meta = {
      snapshotDate: snapshot.circle.last_updated?.split("T")[0] ?? "unknown",
      timezone: this.config.timezone,
      stale,
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
        latestKnownGain: m.latestKnownGain,
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
        latestKnownGain: m.latestKnownGain,
        isTransfer: m.isTransfer,
        previousCircleName: m.previousCircleName,
      })),
      meta: {
        total: members.length,
        active: members.filter((m) => m.status === "active").length,
        dataDay,
      },
    });
  }

  private handleMemberDetail(
    res: http.ServerResponse,
    snapshot: Snapshot,
    viewerId: string,
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
        latestKnownGain: member.latestKnownGain,
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
        snapshotDate: snapshot.circle.last_updated?.split("T")[0] ?? "unknown",
      },
    });
  }

  private handleSnapshots(res: http.ServerResponse): void {
    const snapshot = this.snapshotLoader();
    const available = snapshot
      ? [snapshot.circle.last_updated?.split("T")[0] ?? "unknown"]
      : [];

    createResponse(res, 200, {
      success: true,
      data: available,
      meta: { total: available.length },
    });
  }
}
