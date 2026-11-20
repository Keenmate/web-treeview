import { test, expect, type Page, nodeByPath } from './fixtures';

/**
 * Page-wide labels through core `/locale` (D-NC-24): per key the instance `labels` →
 * the element's own `translateCallback` → the page-wide one →
 * the flat page dictionary `window.components.locale.labels['web-treeview.<key>']` → English, and assigning
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

  await setPageLocale(page, { labels: { 'web-treeview.labels.dropBefore': 'Před', 'web-treeview.labels.dropAfter': 'Za', 'web-treeview.labels.dropChild': 'Dovnitř' } });
  await page.locator('web-treeview').evaluate((el: any) => { el.labels = { 'labels.dropChild': 'Pod' }; });
  await step(page, 'start', '4');
  await step(page, 'over', '1', 0.8);
  await expect(pads).toHaveText(['Před', 'Za', 'Pod']);
  await step(page, 'end');
});

test('assigning window.components.locale re-renders live texts (localeChanged); translateCallback translates them', async ({ page }) => {
  await page.goto('/test/render-callbacks.html');
  const plain = page.locator('web-treeview#empty-default .wtv__empty-state');
  const own = page.locator('web-treeview#empty-text .wtv__empty-state');
  await expect(plain).toHaveText('No data');

  await setPageLocale(page, { labels: { 'web-treeview.messages.noData': 'Žádná data' } });
  await expect(plain).toHaveText('Žádná data');
  await expect(own).toHaveText('Nothing here'); // the instance messages.noData wins
  // The instance labels also take the full key.
  await page.locator('web-treeview#empty-text').evaluate((el: any) => { el.labels = { 'web-treeview.messages.noData': 'Plný klíč' }; });
  await expect(own).toHaveText('Plný klíč');

  await page.evaluate(() => {
    (window as any).components.locale = {
      translateCallback: ({ component, key, template }: any) => (component === 'web-treeview' ? `${key}: ${template}` : null),
    };
  });
  await expect(plain).toHaveText('web-treeview.messages.noData: No data');

  await setPageLocale(page, null);
  await expect(plain).toHaveText('No data');
});

test("the element's own translateCallback beats the page-wide one; null passes on; instance labels beat both", async ({ page }) => {
  await page.goto('/test/render-callbacks.html');
  const plain = page.locator('web-treeview#empty-default .wtv__empty-state');
  const own = page.locator('web-treeview#empty-text .wtv__empty-state');
  await expect(plain).toHaveText('No data');

  await page.evaluate(() => {
    (window as any).components.locale = {
      translateCallback: ({ key }: any) => (key === 'web-treeview.messages.noData' ? 'page' : null),
    };
  });
  await expect(plain).toHaveText('page');

  // The element's own hook wins (assigning it re-renders live) …
  await page.locator('web-treeview#empty-default').evaluate((el: any) => {
    el.translateCallback = ({ key }: any) => (key === 'web-treeview.messages.noData' ? 'element' : null);
  });
  await expect(plain).toHaveText('element');
  // … `null` = not mine → the page-wide hook decides.
  await page.locator('web-treeview#empty-default').evaluate((el: any) => { el.translateCallback = () => null; });
  await expect(plain).toHaveText('page');

  // The instance labels beat both hooks.
  await page.locator('web-treeview#empty-text').evaluate((el: any) => { el.translateCallback = () => 'element'; });
  await expect(own).toHaveText('Nothing here');

  await page.locator('web-treeview#empty-default').evaluate((el: any) => { el.translateCallback = null; });
  await setPageLocale(page, null);
  await expect(plain).toHaveText('No data');
});

test('a page-wide labels.noDisplayValue repaints the node labels live; the tree state is kept', async ({ page }) => {
  await page.goto('/test/data.html');
  const card = page.locator('.card').filter({ has: page.locator('h2', { hasText: 'Display Value Fallback' }) }).first();
  const tree = card.locator('.tree-container').first();
  await expect(nodeByPath(tree, '1.1')).toBeVisible();
  await card.locator('web-treeview').evaluate((el: any) => { el.labels = {}; });
  await expect(nodeByPath(tree, '1')).toContainText('[N/A]');

  await setPageLocale(page, { labels: { 'web-treeview.labels.noDisplayValue': '(bez názvu)' } });
  await expect(nodeByPath(tree, '1')).toContainText('(bez názvu)');
  await expect(nodeByPath(tree, '1.1')).toContainText('(bez názvu)');
  await expect(nodeByPath(tree, '1.1')).toBeVisible(); // still expanded
});
