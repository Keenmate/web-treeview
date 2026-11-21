import { test, expect, type Page } from './fixtures';

/**
 * The `locale` input (rulebook C-CA-38): the numbers in labels (`{count}` in the search announcement
 * `ariaLabels.searchResults`, core `formatNumber`) follow the element's `locale` → the page-wide
 * `window.components.locale.locale` → the browser. `'auto'` = unset (core `resolveLocale`). The same option on a
 * bare `TreeViewEngine` (default `null`, one source: the input table).
 *
 * Fixture: test/announce.html (the page's polite `[data-km-announcer]` region); each test builds its own
 * 1,234-node tree / engine on it.
 */

const PAGE = '/test/announce.html';
const region = (page: Page) => page.locator('[data-km-announcer="polite"]');

test.beforeEach(async ({ page }) => {
  await page.goto(PAGE);
  await page.waitForFunction(() => (window as any).__ready === true);
});

test.afterEach(async ({ page }) => {
  await page.evaluate(() => { (window as any).components.locale = null; });
});

/** A fresh search for `Item` on a <web-treeview> (clear first so the same term announces again). */
const searchElement = (page: Page) =>
  page.evaluate(async () => {
    const el = document.getElementById('big') as any;
    el.searchTerm = null;
    await el.whenSettled();
    el.searchTerm = 'Item';
  });

test('locale="de" formats {count}; unset follows window.components.locale.locale; the element wins; auto = unset', async ({ page }) => {
  await page.evaluate(() => {
    const el = document.createElement('web-treeview') as any;
    el.id = 'big';
    el.setAttribute('locale', 'de');
    el.setAttribute('use-internal-search-index', 'true');
    el.setAttribute('search-result-limit', '5000');
    el.displayValueMember = 'name';
    el.searchValueMember = 'name';
    el.nodes = Array.from({ length: 1234 }, (_, i) => ({ id: i + 1, path: String(i + 1), name: `Item ${i + 1}` }));
    document.getElementById('host')!.appendChild(el);
  });
  expect(await page.evaluate(() => (document.getElementById('big') as any).locale)).toBe('de');

  await searchElement(page);
  await expect(region(page)).toHaveText('1.234 results');

  // Unset → the page locale.
  await page.evaluate(() => {
    (window as any).components.locale = { locale: 'en-US' };
    document.getElementById('big')!.removeAttribute('locale');
  });
  await searchElement(page);
  await expect(region(page)).toHaveText('1,234 results');

  // The element's own locale (property) beats the page one.
  await page.evaluate(() => { (window as any).components.locale = { locale: 'en-US' }; (document.getElementById('big') as any).locale = 'de-DE'; });
  await searchElement(page);
  await expect(region(page)).toHaveText('1.234 results');

  // 'auto' is unset: the page locale again.
  await page.evaluate(() => { (document.getElementById('big') as any).locale = 'auto'; });
  await searchElement(page);
  await expect(region(page)).toHaveText('1,234 results');
});

test('a TreeViewEngine without the element: the locale option (default null = page locale), setOptions({ locale })', async ({ page }) => {
  const defaults = await page.evaluate(async () => {
    const { TreeViewEngine } = await import('/src/index.ts' as string);
    const box = document.createElement('div');
    box.id = 'big-engine';
    document.body.appendChild(box);
    (window as any).components.locale = { locale: 'de-DE' };
    (window as any).bigEngine = new TreeViewEngine(box, {
      nodes: Array.from({ length: 1234 }, (_, i) => ({ id: i + 1, path: String(i + 1), name: `Item ${i + 1}` })),
      displayValueMember: 'name', searchValueMember: 'name', searchResultLimit: 5000,
    });
    const { ENGINE_DEFAULTS } = await import('/src/inputs.ts' as string);
    return { hasKey: 'locale' in ENGINE_DEFAULTS, value: ENGINE_DEFAULTS.locale };
  });
  expect(defaults).toEqual({ hasKey: true, value: null });

  const search = () => page.evaluate(() => {
    const engine = (window as any).bigEngine;
    engine.setOptions({ searchTerm: null });
    engine.setOptions({ searchTerm: 'Item' });
  });

  await search();
  await expect(region(page)).toHaveText('1.234 results'); // unset → the page locale

  await page.evaluate(() => (window as any).bigEngine.setOptions({ locale: 'en-US' }));
  await search();
  await expect(region(page)).toHaveText('1,234 results'); // the engine's own locale wins
  // A partial update keeps the tree (it maps the merged options, not just the partial).
  await page.evaluate(() => (window as any).bigEngine.setOptions({ searchTerm: null }));
  await expect(page.locator('#big-engine .wtv__node-label').first()).toHaveText('Item 1');
});
