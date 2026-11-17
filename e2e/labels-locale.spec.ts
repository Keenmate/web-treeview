import { test, expect, type Page, nodeByPath } from './fixtures';

/**
 * Page-wide labels through core `/locale` (D-NC-24): per key the instance `labels` →
 * `window.components.locale.labels['web-treeview']` → English, and assigning
 * `window.components.locale` re-renders live trees (core `localeChanged()` → `refreshLabels()`,
 * tree state kept). Reuses /test/drag-visuals.html, /test/render-callbacks.html and /test/data.html.
 */

const setPageLocale = (page: Page, locale: unknown) =>
  page.evaluate((l) => { (window as any).components.locale = l; }, locale);

test.afterEach(async ({ page }) => {
  await setPageLocale(page, null);
});

const step = (page: Page, fn: 'start' | 'over' | 'end', path?: string, fx?: number) =>
  page.evaluate(([fn, path, fx]) => (window as any).drag[fn as string](path, fx), [fn, path, fx] as const);

test('page-wide labels text the floating drop pads; the instance labels win per key', async ({ page }) => {
  await page.goto('/test/drag-visuals.html?drop-zone-mode=floating');
  await expect(nodeByPath(page, '4')).toBeVisible();
  const pads = page.locator('.wtv__drop-zones .wtv__drop-zone');

  await step(page, 'start', '4');
  await step(page, 'over', '1', 0.8);
  await expect(pads).toHaveText(['Before', 'After', 'Child']);
  await step(page, 'end');

  await setPageLocale(page, { labels: { 'web-treeview': { dropBefore: 'Před', dropAfter: 'Za', dropChild: 'Dovnitř' } } });
  await page.locator('web-treeview').evaluate((el: any) => { el.labels = { dropChild: 'Pod' }; });
  await step(page, 'start', '4');
  await step(page, 'over', '1', 0.8);
  await expect(pads).toHaveText(['Před', 'Za', 'Pod']);
  await step(page, 'end');
});

test('assigning window.components.locale re-renders live texts (localeChanged); formatLabelCallback formats them', async ({ page }) => {
  await page.goto('/test/render-callbacks.html');
  const plain = page.locator('web-treeview#empty-default .wtv__empty-state');
  const own = page.locator('web-treeview#empty-text .wtv__empty-state');
  await expect(plain).toHaveText('No data');

  await setPageLocale(page, { labels: { 'web-treeview': { noData: 'Žádná data' } } });
  await expect(plain).toHaveText('Žádná data');
  await expect(own).toHaveText('Nothing here'); // the instance labels.noData wins

  await page.evaluate(() => {
    (window as any).components.locale = {
      formatLabelCallback: ({ component, key, template }: any) => `${component}.${key}: ${template}`,
    };
  });
  await expect(plain).toHaveText('web-treeview.noData: No data');

  await setPageLocale(page, null);
  await expect(plain).toHaveText('No data');
});

test('a page-wide noDisplayValue repaints the node labels live; the tree state is kept', async ({ page }) => {
  await page.goto('/test/data.html');
  const card = page.locator('.card').filter({ has: page.locator('h2', { hasText: 'Display Value Fallback' }) }).first();
  const tree = card.locator('.tree-container').first();
  await expect(nodeByPath(tree, '1.1')).toBeVisible();
  await card.locator('web-treeview').evaluate((el: any) => { el.labels = {}; });
  await expect(nodeByPath(tree, '1')).toContainText('[N/A]');

  await setPageLocale(page, { labels: { 'web-treeview': { noDisplayValue: '(bez názvu)' } } });
  await expect(nodeByPath(tree, '1')).toContainText('(bez názvu)');
  await expect(nodeByPath(tree, '1.1')).toContainText('(bez názvu)');
  await expect(nodeByPath(tree, '1.1')).toBeVisible(); // still expanded
});
