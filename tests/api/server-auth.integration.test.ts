import http from 'http';
import { ApiServer } from '../../src/api/server';
import { getDefaultConfig } from '../../src/config';
import type { Snapshot, BotConfig } from '../../src/types';
import { loadRealSnapshot } from '../_helpers';

const SNAPSHOT: Snapshot = loadRealSnapshot();
const config: BotConfig = getDefaultConfig();
const PORT = 18767;

function fetchWithAuth(
  path: string,
  token?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    http
      .get(`http://127.0.0.1:${PORT}${path}`, { headers }, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: JSON.parse(data),
          });
        });
      })
      .on('error', reject);
  });
}

describe('API Auth & Rate Limiting', () => {
  const TEST_TOKEN = 'test-secret-token-12345';

  describe('Bearer Token Auth', () => {
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

    it('returns 401 without Authorization header on protected endpoint', async () => {
      const res = await fetchWithAuth('/reports/daily');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Unauthorized');
    });

    it('returns 401 with wrong token', async () => {
      const res = await fetchWithAuth('/reports/daily', 'wrong-token');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Unauthorized');
    });

    it('returns 200 with correct token on protected endpoint', async () => {
      const res = await fetchWithAuth('/reports/daily', TEST_TOKEN);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('exempts /healthz from auth — works without token', async () => {
      const res = await fetchWithAuth('/healthz');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('blocks /members without token', async () => {
      const res = await fetchWithAuth('/members');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('allows /members with correct token', async () => {
      const res = await fetchWithAuth('/members', TEST_TOKEN);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('blocks /tier without token', async () => {
      const res = await fetchWithAuth('/tier');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('blocks /snapshots without token', async () => {
      const res = await fetchWithAuth('/snapshots');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('blocks /unknown route without token — 401 not 404', async () => {
      const res = await fetchWithAuth('/nonexistent');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe('Rate Limiting', () => {
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

    it('returns 429 after 50+ rapid requests within 1 second', async () => {
      const requests: Promise<{ status: number; body: Record<string, unknown> }>[] = [];
      for (let i = 0; i < 51; i++) {
        requests.push(fetchWithAuthPort('/health', RL_PORT));
      }
      const results = await Promise.all(requests);

      // The first 50 should succeed
      const successes = results.filter((r) => r.status === 200);
      expect(successes.length).toBeGreaterThanOrEqual(1);

      // At least one should be rate-limited (429)
      const rateLimited = results.filter((r) => r.status === 429);
      expect(rateLimited.length).toBeGreaterThanOrEqual(1);
      expect(rateLimited[0].body.error).toBe('Too many requests');
    });

    it('allows requests again after rate limit window expires', async () => {
      // Wait for the 1-second window to expire
      await new Promise((r) => setTimeout(r, 1100));

      const res = await fetchWithAuthPort('/health', RL_PORT);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});

function fetchWithAuthPort(
  path: string,
  port: number,
  token?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    http
      .get(`http://127.0.0.1:${port}${path}`, { headers }, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: JSON.parse(data),
          });
        });
      })
      .on('error', reject);
  });
}
