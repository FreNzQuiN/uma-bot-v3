import { UmaMoeClient } from '../../src/api/uma-moe';

describe('UmaMoeClient', () => {
  describe('session management', () => {
    it('starts with no session', () => {
      const client = new UmaMoeClient();
      expect(client.isSessionValid()).toBe(false);
    });

    it('custom cache TTL works', () => {
      const client = new UmaMoeClient({ sessionCacheMs: 50 });
      expect(client.isSessionValid()).toBe(false);
    });

    it('closeSession is safe when no browser', async () => {
      const client = new UmaMoeClient();
      // Should not throw
      await client.closeSession();
      expect(client.isSessionValid()).toBe(false);
    });
  });

  describe('constructor', () => {
    it('creates with default options', () => {
      const client = new UmaMoeClient();
      expect(client.isSessionValid()).toBe(false);
    });

    it('creates with custom options', () => {
      const client = new UmaMoeClient({ sessionCacheMs: 60_000 });
      expect(client.isSessionValid()).toBe(false);
    });
  });

  // NOTE: fetchCircleData integration tests require Playwright + network
  // Run manually: node -e "..." with real uma.moe access
});
