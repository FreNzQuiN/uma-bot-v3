/**
 * uma.moe API client for Uma Club Bot v3.
 *
 * Uses Playwright to solve Cloudflare Turnstile, then fetches data
 * through the browser context (same-origin with cookies).
 */

import type { Browser, Page } from 'playwright';
import type { Snapshot } from '../types';
import { log } from '../utils/logger';

const BASE_URL = 'https://uma.moe';
const SESSION_CACHE_MS = 240_000; // 4 minutes

export interface UmaMoeClientOptions {
  tokenCacheMs?: number;
}

export class UmaMoeClient {
  private page: Page | null = null;
  private browser: Browser | null = null;
  private sessionObtainedAt: number = 0;
  private options: UmaMoeClientOptions;

  constructor(options?: UmaMoeClientOptions) {
    this.options = options ?? {};
  }

  isSessionValid(): boolean {
    if (!this.page) return false;
    return Date.now() - this.sessionObtainedAt < (this.options.tokenCacheMs ?? SESSION_CACHE_MS);
  }

  /**
   * Open a Playwright browser session to uma.moe.
   * Turnstile solves automatically and sets warmup cookie.
   */
  async ensureSession(): Promise<void> {
    if (this.isSessionValid()) return;

    // Close old browser if any
    await this.closeSession();

    const { chromium } = await import('playwright');

    this.browser = await chromium.launch({
      headless: true,
      args: ['--disable-blink-features=AutomationControlled'],
    });

    const context = await this.browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    this.page = await context.newPage();

    // Visit the site to trigger Turnstile and get warmup cookie
    await this.page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30_000 });

    // Wait for Turnstile to solve
    await this.page.waitForTimeout(5000);

    this.sessionObtainedAt = Date.now();
  }

  /**
   * Fetch circle data through the browser context.
   * Same-origin requests automatically include the warmup cookie.
   */
  async fetchCircleData(circleId: number, year: number, month: number): Promise<Snapshot> {
    log.debug('UmaMoe', `Fetching circle ${circleId} for ${year}-${String(month).padStart(2, '0')}`);
    await this.ensureSession();

    const url = `${BASE_URL}/api/v4/circles?circle_id=${circleId}&year=${year}&month=${month}`;

    const page = this.page!;
    const result = await page.evaluate(async (fetchUrl: string) => {
      const response = await fetch(fetchUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response.json();
    }, url);

    // Validate response structure
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
  }

  /**
   * Close the browser session.
   */
  async closeSession(): Promise<void> {
    if (this.browser) {
      try {
        await this.browser.close();
      } catch {
        // Ignore close errors
      }
      this.browser = null;
      this.page = null;
    }
  }
}
