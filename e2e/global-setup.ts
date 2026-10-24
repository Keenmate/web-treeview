import { chromium, FullConfig } from '@playwright/test';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Pre-warm the Vite dev server by visiting every fixture page the suite uses.
 *
 * Vite compiles modules on demand on first request, and that competes with the
 * page's own startup work (custom-element registration, initial render). Hitting
 * each route once up-front pushes all compile cost into setup so the actual
 * tests see warm caches.
 */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use?.baseURL ?? 'http://localhost:21111';

  // Every fixture page under test/ — read from disk so new fixtures are warmed
  // without editing this list.
  const testDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'test');
  const routes = readdirSync(testDir)
    .filter((f) => f.endsWith('.html'))
    .sort()
    .map((f) => `/test/${f}`);

  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const route of routes) {
    try {
      await page.goto(`${baseURL}${route}`, { waitUntil: 'load', timeout: 30_000 });
      await page.waitForTimeout(500);
    } catch {
      // If the page fails to warm we ignore it; the actual test will surface
      // the real error with more context.
    }
  }
  await browser.close();
}
