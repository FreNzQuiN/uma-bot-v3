import {
  ApiServer,
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_MS,
} from "../../src/api/server";
import { getDefaultConfig } from "../../src/config";
import type { Snapshot, BotConfig } from "../../src/types";
import { loadRealSnapshot } from "../_helpers";
import { fetchJson } from "../_helpers/http";

const SNAPSHOT: Snapshot = loadRealSnapshot();
const config: BotConfig = getDefaultConfig();
const PORT = 18767;

describe("API Auth & Rate Limiting", () => {
  const TEST_TOKEN = "test-secret-token-12345";

  describe("Bearer Token Auth", () => {
    let server: ApiServer;

    beforeAll(async () => {
      process.env.API_TOKEN = TEST_TOKEN;
      server = new ApiServer(PORT, () => SNAPSHOT, config);
      await server.start();
    });

    afterAll(async () => {
      await server.stop();
      delete process.env.API_TOKEN;
    });

    it("returns 401 without Authorization header on protected endpoint", async () => {
      const res = await fetchJson("/reports/daily", PORT);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe("Unauthorized");
    });

    it("returns 401 with wrong token", async () => {
      const res = await fetchJson("/reports/daily", PORT, "wrong-token");
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe("Unauthorized");
    });

    it("returns 200 with correct token on protected endpoint", async () => {
      const res = await fetchJson("/reports/daily", PORT, TEST_TOKEN);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("exempts /healthz from auth — works without token", async () => {
      const res = await fetchJson("/healthz", PORT);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("blocks /members without token", async () => {
      const res = await fetchJson("/members", PORT);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it("allows /members with correct token", async () => {
      const res = await fetchJson("/members", PORT, TEST_TOKEN);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("blocks /tier without token", async () => {
      const res = await fetchJson("/tier", PORT);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it("blocks /snapshots without token", async () => {
      const res = await fetchJson("/snapshots", PORT);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it("blocks /unknown route without token — 401 not 404", async () => {
      const res = await fetchJson("/nonexistent", PORT);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe("Rate Limiting", () => {
    // Use a dedicated port so rate-limit burst doesn't interfere with auth tests
    const RL_PORT = 18768;
    let rlServer: ApiServer;

    beforeAll(async () => {
      // No API_TOKEN — rate limiter runs before auth, so this doesn't matter
      delete process.env.API_TOKEN;
      rlServer = new ApiServer(RL_PORT, () => SNAPSHOT, config);
      await rlServer.start();
    });

    afterAll(async () => {
      await rlServer.stop();
    });

    it("returns 429 after 50+ rapid requests within 1 second", async () => {
      const requests: Promise<{
        status: number;
        body: Record<string, unknown>;
      }>[] = [];
      for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS + 1; i++) {
        requests.push(fetchJson("/health", RL_PORT));
      }
      const results = await Promise.all(requests);

      const successes = results.filter((r) => r.status === 200);
      expect(successes.length).toBeGreaterThanOrEqual(1);
      expect(successes.length).toBeLessThanOrEqual(RATE_LIMIT_MAX_REQUESTS);

      const rateLimited = results.filter((r) => r.status === 429);
      expect(rateLimited.length).toBeGreaterThanOrEqual(1);
      expect(rateLimited[0].body.error).toBe("Too many requests");
    });

    it("allows requests again after rate limit window expires", async () => {
      // Wait for the 1-second window to expire
      await new Promise((r) => setTimeout(r, RATE_LIMIT_WINDOW_MS + 100));

      const res = await fetchJson("/health", RL_PORT);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
