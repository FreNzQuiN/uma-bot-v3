import http from "http";
import { ApiServer, createResponse } from "../../src/api/server";
import { getDefaultConfig } from "../../src/config";
import type { Snapshot, BotConfig } from "../../src/types";
import type { IDatabase } from "../../src/db/types";
import { loadRealSnapshot } from "../_helpers";
import { fetchJson } from "../_helpers/http";

const SNAPSHOT: Snapshot = loadRealSnapshot();

const config: BotConfig = getDefaultConfig();
const PORT = 18765;

const MEMBER_COUNT = 34;
const DATA_DAY = 11;
const TRANSFER_COUNT = 6;
const WEEKLY_GAINS_LENGTH = 5;

let server: ApiServer;

beforeAll(async () => {
  server = new ApiServer(PORT, () => SNAPSHOT, config);
  await server.start();
});

afterAll(async () => {
  await server.stop();
});

describe("REST API", () => {
  describe("GET /health", () => {
    it("returns 200 with status ok", async () => {
      const res = await fetchJson("/health", PORT);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect((res.body.data as Record<string, unknown>).status).toBe("ok");
    });

    it("includes timestamp", async () => {
      const res = await fetchJson("/health", PORT);
      const data = res.body.data as Record<string, unknown>;
      expect(data.timestamp).toBeDefined();
    });
  });

  describe("GET /reports/daily", () => {
    it("returns 200 with report data", async () => {
      const res = await fetchJson("/reports/daily", PORT);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.meta).toBeDefined();
    });

    it("includes circle info", async () => {
      const res = await fetchJson("/reports/daily", PORT);
      const data = res.body.data as Record<string, unknown>;
      expect(data.circle).toBeDefined();
      expect((data.circle as Record<string, unknown>).name).toBe("Hol＿Horse");
    });

    it("includes members array with correct count", async () => {
      const res = await fetchJson("/reports/daily", PORT);
      const data = res.body.data as Record<string, unknown>;
      expect(Array.isArray(data.members)).toBe(true);
      expect((data.members as unknown[]).length).toBe(MEMBER_COUNT);
    });

    it("each member has required fields", async () => {
      const res = await fetchJson("/reports/daily", PORT);
      const data = res.body.data as Record<string, unknown>;
      const members = data.members as Record<string, unknown>[];
      for (const member of members) {
        expect(typeof member.name).toBe("string");
        expect(typeof member.status).toBe("string");
        expect(typeof member.monthlyGain).toBe("number");
        expect(typeof member.latestKnownGain).toBe("number");
        expect(typeof member.isTransfer).toBe("boolean");
      }
    });

    it("meta contains dataDay and timezone", async () => {
      const res = await fetchJson("/reports/daily", PORT);
      const meta = res.body.meta as Record<string, unknown>;
      expect(meta.dataDay).toBe(DATA_DAY);
      expect(meta.timezone).toBe("Asia/Jakarta");
    });
  });

  describe("GET /reports/weekly", () => {
    it("returns 200", async () => {
      const res = await fetchJson("/reports/weekly", PORT);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe("GET /reports/monthly", () => {
    it("returns 200", async () => {
      const res = await fetchJson("/reports/monthly", PORT);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe("GET /reports/stats", () => {
    it("returns 200", async () => {
      const res = await fetchJson("/reports/stats", PORT);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe("GET /reports/bottom", () => {
    it("returns 200", async () => {
      const res = await fetchJson("/reports/bottom", PORT);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe("GET /reports/ranks", () => {
    it("returns 200", async () => {
      const res = await fetchJson("/reports/ranks", PORT);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe("GET /members", () => {
    it("returns member list with count", async () => {
      const res = await fetchJson("/members", PORT);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      const meta = res.body.meta as Record<string, unknown>;
      expect(meta.total).toBe(MEMBER_COUNT);
      expect(meta.active).toBeGreaterThanOrEqual(20);
    });

    it("each member has viewerId and name", async () => {
      const res = await fetchJson("/members", PORT);
      const members = res.body.data as Record<string, unknown>[];
      for (const member of members) {
        expect(typeof member.viewerId).toBe("number");
        expect(typeof member.name).toBe("string");
        expect(member.name).not.toBe("");
      }
    });

    it("transfer members have isTransfer=true", async () => {
      const res = await fetchJson("/members", PORT);
      const members = res.body.data as Record<string, unknown>[];
      const transfers = members.filter((m) => m.isTransfer === true);
      expect(transfers.length).toBe(TRANSFER_COUNT);
      // Zero (viewer_id 318068745765) is a transfer
      const zero = members.find((m) => m.viewerId === 318068745765);
      expect(zero?.isTransfer).toBe(true);
    });
  });

  describe("GET /members/:viewerId", () => {
    it("returns specific member with all fields", async () => {
      const res = await fetchJson("/members/116183149143", PORT); // Ryu
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const data = res.body.data as Record<string, unknown>;
      expect(data.name).toBe("Ryu");
      expect(data.status).toBe("active");
      expect(typeof data.monthlyGain).toBe("number");
      expect(typeof data.latestKnownGain).toBe("number");
      expect(Array.isArray(data.weeklyGains)).toBe(true);
      expect(data.weeklyGains).toHaveLength(WEEKLY_GAINS_LENGTH);
    });

    it("returns transfer member with previousCircleName", async () => {
      const res = await fetchJson("/members/318068745765", PORT); // Zero
      expect(res.status).toBe(200);
      const data = res.body.data as Record<string, unknown>;
      expect(data.name).toBe("Zero");
      expect(data.isTransfer).toBe(true);
      expect(data.previousCircleName).toBe("Advent");
    });

    it("returns 404 for unknown member", async () => {
      const res = await fetchJson("/members/99999999", PORT);
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe("GET /tier", () => {
    it("returns tier intelligence data with correct values", async () => {
      const res = await fetchJson("/tier", PORT);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const data = res.body.data as Record<string, unknown>;
      expect(data.tierName).toBe("A+");
      expect(data.clubRank).toBe(8);
      expect(data.promotionGap).toBe(349208495);
      expect(data.demotionBuffer).toBe(21848493);
      expect(typeof data.currentPace).toBe("number");
      expect(typeof data.requiredPace).toBe("number");
      expect(typeof data.daysLeft).toBe("number");
      expect(["LOW", "MEDIUM", "HIGH"]).toContain(data.riskLevel);
      expect(["promote", "stay", "demotion_risk", "unknown"]).toContain(
        data.projectedOutcome,
      );
    });
  });

  describe("GET /snapshots", () => {
    it("returns snapshot list", async () => {
      const res = await fetchJson("/snapshots", PORT);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe("Unknown routes", () => {
    it("returns 404", async () => {
      const res = await fetchJson("/unknown", PORT);
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe("Response envelope", () => {
    it("always has success field", async () => {
      const res = await fetchJson("/health", PORT);
      expect(typeof res.body.success).toBe("boolean");
    });

    it("includes meta with snapshotDate on report endpoints", async () => {
      const res = await fetchJson("/reports/daily", PORT);
      const meta = res.body.meta as Record<string, unknown>;
      expect(meta.snapshotDate).toBeDefined();
      expect(meta.timezone).toBe("Asia/Jakarta");
    });
  });
});

describe("Health endpoint with DB failure", () => {
  let failingDbServer: ApiServer;
  const FAIL_DB_PORT = 18769;

  beforeAll(async () => {
    const mockDb = {
      getLastSuccessfulRun: jest
        .fn()
        .mockRejectedValue(new Error("DB connection failed")),
      getLastRun: jest
        .fn()
        .mockRejectedValue(new Error("DB connection failed")),
    } as unknown as IDatabase;
    failingDbServer = new ApiServer(
      FAIL_DB_PORT,
      () => SNAPSHOT,
      config,
      undefined,
      mockDb,
    );
    await failingDbServer.start();
  });

  afterAll(async () => {
    await failingDbServer.stop();
  });

  it("returns 503 with dbConnected false when DB fails", async () => {
    const res = await fetchJson("/health", FAIL_DB_PORT);

    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
    const data = res.body.data as Record<string, unknown>;
    expect(data.dbConnected).toBe(false);
    expect(data.status).toBe("degraded");
  });
});

describe("createResponse", () => {
  it("writes correct status and JSON", () => {
    const mockRes = {
      setHeader: jest.fn(),
      writeHead: jest.fn(),
      end: jest.fn(),
    } as unknown as http.ServerResponse;

    createResponse(mockRes, 200, { success: true, data: "test" });

    expect(mockRes.setHeader).toHaveBeenCalledWith(
      "X-Content-Type-Options",
      "nosniff",
    );
    expect(mockRes.setHeader).toHaveBeenCalledWith("X-Frame-Options", "DENY");
    expect(mockRes.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "application/json",
    });
    expect(mockRes.end).toHaveBeenCalledWith(
      JSON.stringify({ success: true, data: "test" }),
    );
  });
});

describe("No snapshot server", () => {
  let noSnapshotServer: ApiServer;
  const NO_SNAP_PORT = 18766;

  beforeAll(async () => {
    noSnapshotServer = new ApiServer(NO_SNAP_PORT, () => null, config);
    await noSnapshotServer.start();
  });

  afterAll(async () => {
    await noSnapshotServer.stop();
  });

  it("returns 503 when no snapshot available", async () => {
    const res = await fetchJson("/reports/daily", NO_SNAP_PORT);

    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
  });
});
