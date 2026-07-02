/**
 * uma.moe API client for Uma Club Bot v3.
 *
 * Uses Playwright to solve Cloudflare Turnstile, then fetches data
 * through the browser context (same-origin with cookies).
 *
 * Browser lifecycle:
 * - ensureSession() launches browser + context + page, cached for ~4 minutes
 * - closeSession() tears down in reverse order: page → context → browser → force-kill
 * - Each close step uses timeout to prevent hanging on unresponsive Chrome
 */

import type { Browser, BrowserContext, Page } from 'playwright';
import type { ChildProcess } from 'child_process';
import type { Snapshot } from '../types';
import { log } from '../utils/logger';

const BASE_URL = 'https://uma.moe';
const SESSION_CACHE_MS = 240_000;
const CLOSE_TIMEOUT_MS = 5_000;

export interface UmaMoeClientOptions {
  sessionCacheMs?: number;
}

export class UmaMoeClient {
  private page: Page | null = null;
  private context: BrowserContext | null = null;
  private browser: Browser | null = null;
  private sessionObtainedAt: number = 0;
  private options: UmaMoeClientOptions;
  private pendingSession: Promise<void> | null = null;

  constructor(options?: UmaMoeClientOptions) {
    this.options = options ?? {};
  }

  isSessionValid(): boolean {
    if (!this.page) return false;
    return Date.now() - this.sessionObtainedAt < (this.options.sessionCacheMs ?? SESSION_CACHE_MS);
  }

  async ensureSession(): Promise<void> {
    if (this.isSessionValid()) return;
    if (this.pendingSession) {
      try { await this.pendingSession; } catch (err) {
        log.debug('UmaMoe', 'Previous session attempt failed, retrying', err);
      }
      if (this.isSessionValid()) return;
    }

    this.pendingSession = this._launchSession();
    try {
      await this.pendingSession;
    } finally {
      this.pendingSession = null;
    }
  }

  private async _launchSession(): Promise<void> {
    await this.closeSession();

    const { chromium } = await import('playwright');
    let browser: Browser | null = null;
    let context: BrowserContext | null = null;

    try {
      browser = await chromium.launch({
        headless: true,
        args: ['--disable-blink-features=AutomationControlled'],
      });

      context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      });

      const page = await context.newPage();

      await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30_000 });
      await page.waitForTimeout(5000);

      this.browser = browser;
      this.context = context;
      this.page = page;
      this.sessionObtainedAt = Date.now();
      log.info('UmaMoe', 'Browser session established');
    } catch (err) {
      log.warn('UmaMoe', 'Browser session failed', err);
      await UmaMoeClient.teardownBrowser(context, browser);
      throw err;
    }
  }

  async fetchCircleData(circleId: number, year: number, month: number): Promise<Snapshot> {
    log.debug('UmaMoe', `Fetching circle ${circleId} for ${year}-${String(month).padStart(2, '0')}`);
    await this.ensureSession();

    const url = `${BASE_URL}/api/v4/circles?circle_id=${circleId}&year=${year}&month=${month}`;

    return this._fetchWithRetry(url, 0);
  }

  private async _fetchWithRetry(url: string, attempt: number): Promise<Snapshot> {
    const page = this.page;
    if (!page) throw new Error('No active browser session');

    try {
      const result = await page.evaluate(async (fetchUrl: string) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30_000);
        try {
          const response = await fetch(fetchUrl, { signal: controller.signal });
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
          return response.json();
        } finally {
          clearTimeout(timeout);
        }
      }, url);

      const raw = result as Record<string, unknown>;
      if (!raw || typeof raw !== 'object') {
        throw new Error('Invalid response from uma.moe: not an object');
      }
      if (!raw.circle || typeof raw.circle !== 'object') {
        throw new Error('Invalid snapshot structure from uma.moe: missing or invalid circle');
      }
      if (!Array.isArray(raw.members)) {
        throw new Error('Invalid snapshot structure from uma.moe: members is not an array');
      }

      return result as Snapshot;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < 2 && (msg.includes('HTTP 401') || msg.includes('HTTP 403'))) {
        log.warn('UmaMoe', `Session expired (${msg}), re-authenticating (attempt ${attempt + 1})`);
        this.sessionObtainedAt = 0;
        await this.ensureSession();
        return this._fetchWithRetry(url, attempt + 1);
      }
      throw err;
    }
  }

  async closeSession(): Promise<void> {
    const context = this.context;
    const browser = this.browser;
    this.page = null;
    this.context = null;
    this.browser = null;

    await UmaMoeClient.teardownBrowser(context, browser);
  }

  private static async teardownBrowser(
    context: BrowserContext | null,
    browser: Browser | null,
  ): Promise<void> {
    if (context) {
      try { await withTimeout(context.close(), CLOSE_TIMEOUT_MS); } catch (err) {
        log.debug('UmaMoe', 'Context close failed', err);
      }
    }
    if (browser) {
      try {
        await withTimeout(browser.close(), CLOSE_TIMEOUT_MS);
      } catch (err) {
        log.debug('UmaMoe', 'Browser close timed out, force-killing', err);
        UmaMoeClient.forceKillBrowser(browser);
      }
    }
  }

  private static forceKillBrowser(browser: Browser): void {
    const proc = (browser as Browser & { process(): ChildProcess | null }).process();
    if (proc && !proc.killed) {
      try {
        proc.kill('SIGTERM');
        log.warn('UmaMoe', `Force-killed Chrome process (PID ${proc.pid})`);
      } catch (err) {
        log.debug('UmaMoe', 'SIGTERM failed, process may already be dead', err);
      }
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Operation timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}
