import { definePlaywrightConfig, devices } from '@keenmate/web-components-devkit/playwright';

/**
 * Playwright config for end-to-end tests against the dev server.
 *
 * Specs live in e2e/ and target the fixture pages under test/*.html. baseURL and
 * the `npm run dev` web server come from package.json#kmwc.ports.dev (the devkit
 * preset), so the port can't drift from vite.config / the Makefile.
 *
 * Run:
 *   npm run test:e2e:install   # one-time: download chromium browser binary
 *   npm run test:e2e           # headless run (chromium)
 *   npm run test:e2e:all       # chromium + firefox + webkit
 *   npm run test:e2e:ui        # Playwright Test UI (debugging)
 *   npm run test:e2e:headed    # watch the browser do its thing
 */
const viewport = { width: 1440, height: 1024 };

export default definePlaywrightConfig({
  // Warm every fixture page first — Vite compiles on first request.
  globalSetup: './e2e/global-setup.ts',
  timeout: 45_000,
  expect: { timeout: 20_000 },
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 1 : 4,

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport } },
    // Same suite on Gecko and WebKit (Safari's engine): `npm run test:e2e:all`.
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport } },
  ],
});
