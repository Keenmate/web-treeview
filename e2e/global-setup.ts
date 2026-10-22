import { chromium, FullConfig } from '@playwright/test';

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

  const routes = [
    '/test/basic.html',
    '/test/expand-collapse.html',
    '/test/interaction.html',
    '/test/theming.html',
    '/test/keyboard-nav.html',
    '/test/search.html',
    '/test/search-deep.html',
    '/test/member-props.html',
    '/test/data.html',
    '/test/context-menu.html',
    '/test/silent-selection.html',
    '/test/drag-esc-cancel.html',
    '/test/drag-drop.html',
    '/test/branch-operations.html',
    '/test/exclusive-expand.html'
  ];

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
