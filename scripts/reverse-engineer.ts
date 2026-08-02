/**
 * Reverse engineer uma.moe website to see how they distinguish left members.
 */

import { chromium } from 'playwright';

const CIRCLE_ID = 232229195; // Hol＿Horse
const BASE_URL = 'https://uma.moe';

async function main() {
  console.log('Launching browser...');
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();

  const apiResponses: any[] = [];
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('/api/')) {
      try {
        const body = await response.json();
        apiResponses.push({ url, status: response.status(), body });
      } catch {
        // Not JSON
      }
    }
  });

  console.log('Visiting uma.moe to get Turnstile token...');
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(5000);

  console.log(`Navigating to circle page: ${CIRCLE_ID}`);
  await page.goto(`${BASE_URL}/circle/${CIRCLE_ID}`, {
    waitUntil: 'networkidle',
    timeout: 30000,
  });
  await page.waitForTimeout(3000);

  await page.screenshot({ path: 'data/uma-moe-circle.png', fullPage: true });
  console.log('Screenshot saved to data/uma-moe-circle.png');

  const title = await page.title();
  console.log(`Page title: ${title}`);

  const html = await page.content();
  const fs = require('fs');
  fs.writeFileSync('data/uma-moe-circle.html', html);
  console.log('HTML saved to data/uma-moe-circle.html');

  const memberInfo = await page.evaluate(() => {
    const results: any[] = [];

    const allElements = document.querySelectorAll('*');
    const memberKeywords = ['member', 'trainer', 'player', 'circle-member', 'rank-member'];

    for (const el of allElements) {
      const className = String(el.className || '').toLowerCase();
      const id = String(el.id || '').toLowerCase();

      for (const keyword of memberKeywords) {
        if (className.includes(keyword) || id.includes(keyword)) {
          results.push({
            tag: el.tagName,
            id: el.id,
            className: el.className,
            text: el.textContent?.substring(0, 300),
            childCount: el.children.length,
          });
          break;
        }
      }
    }

    return results;
  });

  console.log('\n--- Member-related elements ---');
  console.log(JSON.stringify(memberInfo, null, 2));

  const statusText = await page.evaluate(() => {
    const bodyText = document.body.innerText;
    const lines = bodyText.split('\n').filter((line) => {
      const lower = line.toLowerCase();
      return (
        lower.includes('left') ||
        lower.includes('inactive') ||
        lower.includes('stale') ||
        lower.includes('departed') ||
        lower.includes('退会') ||
        lower.includes('退出') ||
        lower.includes('member') ||
        lower.includes('trainer')
      );
    });
    return lines.slice(0, 30);
  });

  console.log('\n--- Status-related text ---');
  statusText.forEach((line: string) => console.log(line));

  console.log('\n--- API Responses ---');
  for (const resp of apiResponses) {
    console.log(`\n${resp.status} ${resp.url}`);

    if (resp.body?.members) {
      console.log(`Members count: ${resp.body.members.length}`);

      const firstMember = resp.body.members[0];
      if (firstMember) {
        console.log('First member keys:', Object.keys(firstMember));

        const statusFields = Object.keys(firstMember).filter((key) => {
          const lower = key.toLowerCase();
          return (
            lower.includes('status') ||
            lower.includes('state') ||
            lower.includes('type') ||
            lower.includes('active') ||
            lower.includes('left') ||
            lower.includes('left_')
          );
        });

        if (statusFields.length > 0) {
          console.log('Status fields found:', statusFields);
        }
      }

      const allKeys = new Set<string>();
      for (const member of resp.body.members) {
        for (const key of Object.keys(member)) {
          allKeys.add(key);
        }
      }
      console.log('All member keys:', Array.from(allKeys));
    }
  }

  await browser.close();
  console.log('\nDone!');
}

main().catch(console.error);
