import { test, expect, type Page, nodeByPath } from './fixtures';

/**
 * Container render callbacks + cosmetic container options
 * (/test/render-callbacks.html — one tree per feature, by id).
 */

const PAGE = '/test/render-callbacks.html';
const tree = (page: Page, id: string) => page.locator(`web-treeview#${id}`);

test.beforeEach(async ({ page }) => {
  await page.goto(PAGE);
  await expect(nodeByPath(tree(page, 'chrome'), '1.1')).toBeVisible();
});

test.describe('empty tree', () => {
  test('default empty state reads "No data"', async ({ page }) => {
    await expect(tree(page, 'empty-default').locator('.wtv__empty-state')).toHaveText('No data');
  });

  test('labels.noData (JSON attribute) replaces the default text', async ({ page }) => {
    await expect(tree(page, 'empty-text').locator('.wtv__empty-state')).toHaveText('Nothing here');
  });

  test('labels are live: assigning el.labels re-texts the empty state; an unset key falls back to English', async ({ page }) => {
    const t = tree(page, 'empty-text');
    await t.evaluate((el: any) => { el.labels = { noData: 'Prázdné' }; });
    await expect(t.locator('.wtv__empty-state')).toHaveText('Prázdné');
    await t.evaluate((el: any) => { el.labels = { copy: 'Kopírovat' }; });
    await expect(t.locator('.wtv__empty-state')).toHaveText('No data');
  });

  test("a '' label renders nothing (deliberately empty); a missing key is the English default", async ({ page }) => {
    const t = tree(page, 'empty-text');
    await t.evaluate((el: any) => { el.labels = { noData: '' }; });
    await expect(t.locator('.wtv__empty-state')).toHaveText('');
    await t.evaluate((el: any) => { el.labels = {}; });
    await expect(t.locator('.wtv__empty-state')).toHaveText('No data');
  });

  test('labels.dropHere texts the default empty drop zone (live)', async ({ page }) => {
    const t = tree(page, 'empty-zone-labels');
    await expect(t.locator('.wtv__empty-zone-content')).toHaveText('Drop it');
    await t.evaluate((el: any) => el.removeAttribute('labels'));
    await expect(t.locator('.wtv__empty-zone-content')).toHaveText('Drop here');
  });

  test('renderEmptyStateCallback renders into the empty-state container', async ({ page }) => {
    await expect(tree(page, 'empty-cb').locator('.wtv__empty-state .custom-empty')).toHaveText('Custom empty');
  });

  test('show-empty-drop-placeholder keeps the drop zone up instead of the empty state', async ({ page }) => {
    const t = tree(page, 'empty-zone');
    await expect(t.locator('.wtv__empty-zone')).toBeVisible();
    await expect(t.locator('.wtv__empty-state')).toHaveCount(0);
  });

  test('renderEmptyZoneCallback (assigned after markup upgrade) fills the zone', async ({ page }) => {
    const t = tree(page, 'empty-zone');
    await expect(t.locator('.wtv__empty-zone .custom-zone')).toHaveText('Paste or drop here', { timeout: 2000 });
  });
});

test.describe('loading', () => {
  test('loading shows the loading overlay (and no empty state)', async ({ page }) => {
    const t = tree(page, 'loading');
    await expect(t.locator('.wtv__loading-overlay')).toBeVisible();
    await expect(t.locator('.wtv__empty-state')).toHaveCount(0);
  });

  test('the loading overlay is a status with labels.loading as its accessible name (live)', async ({ page }) => {
    const t = tree(page, 'loading');
    const overlay = t.locator('.wtv__loading-overlay');
    await expect(overlay).toHaveAttribute('role', 'status');
    await expect(overlay).toHaveAttribute('aria-label', 'Loading…');
    await t.evaluate((el: any) => { el.labels = { loading: 'Načítám…' }; });
    await expect(overlay).toHaveAttribute('aria-label', 'Načítám…');
  });

  test('turning loading off hides the overlay and shows the empty state', async ({ page }) => {
    const t = tree(page, 'loading');
    await t.evaluate((el) => el.removeAttribute('loading'));
    await expect(t.locator('.wtv__loading-overlay')).toBeHidden();
    await expect(t.locator('.wtv__empty-state')).toHaveText('No data');
  });

  test('renderLoadingCallback renders the loading content', async ({ page }) => {
    await expect(tree(page, 'loading-cb').locator('.custom-loading')).toHaveText('Loading…', { timeout: 2000 });
  });
});

test.describe('header / footer / styles', () => {
  test('renderHeaderCallback and renderFooterCallback fill the header and footer', async ({ page }) => {
    const t = tree(page, 'chrome');
    await expect(t.locator('.wtv__header .custom-header')).toHaveText('Header');
    await expect(t.locator('.wtv__footer .custom-footer')).toHaveText('Footer');
  });

  test('getCustomStylesCallback CSS lands in the shadow root and applies', async ({ page }) => {
    const t = tree(page, 'chrome');
    expect(await t.evaluate((el) => !!el.shadowRoot?.querySelector('style.tv-custom-styles'))).toBe(true);
    // not leaked to the document
    expect(await page.evaluate(() => document.head.querySelector('style.tv-custom-styles'))).toBeNull();
    const ls = await nodeByPath(t, '1.1').locator('.wtv__node-label').evaluate((el) => getComputedStyle(el).letterSpacing);
    expect(ls).toBe('3px');
  });

  test('body-class lands on the tree body; leaf-icon-class on leaf toggles only', async ({ page }) => {
    const t = tree(page, 'chrome');
    await expect(t.locator('.wtv__tree')).toHaveClass(/\bmy-body\b/);
    await expect(nodeByPath(t, '1.1').locator('.wtv__toggle-icon').first()).toHaveClass(/\bmy-leaf\b/);
    await expect(nodeByPath(t, '1').locator('> .wtv__node-row .wtv__toggle-icon').first()).not.toHaveClass(/\bmy-leaf\b/);
  });
});

test.describe('align-node-icons (default on)', () => {
  test('align-node-icons="false": a node with no icon has no icon element', async ({ page }) => {
    const t = tree(page, 'icons');
    await expect(nodeByPath(t, '1.1').locator('.wtv__node-icon')).toHaveCount(1);
    await expect(nodeByPath(t, '1.2').locator('.wtv__node-icon')).toHaveCount(0);
  });

  test('default: every row reserves the icon column (labels line up)', async ({ page }) => {
    const t = tree(page, 'icons-aligned');
    await expect(nodeByPath(t, '1.2').locator('.wtv__node-icon')).toHaveCount(1);
    const x = async (p: string) => (await nodeByPath(t, p).locator('.wtv__node-label').boundingBox())!.x;
    expect(Math.abs((await x('1.1')) - (await x('1.2')))).toBeLessThan(1);
  });
});
