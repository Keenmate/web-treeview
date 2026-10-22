import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for end-to-end tests against the dev server.
 *
 * Dev server runs on port 21111 (see package.json `dev` script). Playwright
 * spins it up automatically before tests and reuses an already-running server
 * if one is detected.
 *
 * Run:
 *   npm run test:e2e:install   # one-time: download chromium browser binary
 *   npm run test:e2e           # headless run
 *   npm run test:e2e:ui        # Playwright Test UI (debugging)
 *   npm run test:e2e:headed    # watch the browser do its thing
 */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 45_000,
  expect: { timeout: 20_000 },

  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 1 : 4,

  reporter: process.env.CI ? 'github' : 'list',

  use: {
    baseURL: 'http://localhost:21111',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 1024 }
      }
    },
    {
      // Same suite on Gecko and WebKit (Safari's engine): `npm run test:e2e:all`.
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        viewport: { width: 1440, height: 1024 }
      }
    },
    {
      name: 'webkit',
      use: {
        ...devices['Desktop Safari'],
        viewport: { width: 1440, height: 1024 }
      }
    }
  ],

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:21111',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe'
  }
});
