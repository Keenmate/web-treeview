import { test, expect, type Page, nodeByPath } from './fixtures';

/**
 * Virtual scroll, flat rendering and progressive batches (/test/virtual-scroll.html).
 *
 * mode=virtual: 50 roots × 99 children = 5000 visible rows, 400px viewport,
 * overscan 5. mode=progressive: 2000 rows, initial-batch-size 10.
 * mode=flat: 3-level chain, flat-indent-size 30px.
 */

const PAGE = '/test/virtual-scroll.html';

const rowPaths = (page: Page): Promise<string[]> => page.evaluate(() => (window as any).rowPaths());
const body = (page: Page) => page.locator('.wtv__virtual-scroll').first();

async function loadVirtual(page: Page) {
  await page.goto(`${PAGE}?mode=virtual`);
  await expect(nodeByPath(page, '1')).toBeVisible();
}

test.describe('virtual-scroll', () => {
  test('only ≈ viewport + overscan rows are in the DOM out of 5000', async ({ page }) => {
    await loadVirtual(page);
    await expect.poll(async () => (await rowPaths(page)).length).toBeGreaterThan(5);
    const rows = await rowPaths(page);
    const rowH = await nodeByPath(page, '1').evaluate((el) => el.getBoundingClientRect().height);
    const viewport = await body(page).evaluate((el) => el.clientHeight);
    expect(viewport).toBeGreaterThan(300);
    expect(viewport).toBeLessThanOrEqual(400);
    // ceil(viewport/rowH) + overscan below (start index clamps at 0 at the top).
    const expected = Math.ceil(viewport / rowH) + 5;
    expect(rows.length).toBeGreaterThanOrEqual(expected - 2);
    expect(rows.length).toBeLessThanOrEqual(expected + 2);
    expect(rows[0]).toBe('1');
    // The spacer is sized for all 5000 rows.
    const scrollH = await body(page).evaluate((el) => el.scrollHeight);
    expect(scrollH).toBeGreaterThan(rowH * 4900);
  });

  test('scrolling renders a new window of rows and drops the old ones', async ({ page }) => {
    await loadVirtual(page);
    await expect(nodeByPath(page, '1.1')).toBeAttached();
    const rowH = await nodeByPath(page, '1').evaluate((el) => el.getBoundingClientRect().height);
    // Row index 2500 → root 26 (index 2500 = 25*100) .
    await body(page).evaluate((el, top) => { el.scrollTop = top; el.dispatchEvent(new Event('scroll')); }, rowH * 2500);
    await expect(nodeByPath(page, '26')).toBeVisible();
    await expect(nodeByPath(page, '1.1')).toHaveCount(0);
    const rows = await rowPaths(page);
    expect(rows.length).toBeLessThan(60);
  });

  test('scrollToPath on a far row brings it into the DOM and into view', async ({ page }) => {
    await loadVirtual(page);
    await expect(nodeByPath(page, '50.99')).toHaveCount(0);
    const ok = await page.evaluate(() => (window as any).tree.scrollToPath('48.50'));
    expect(ok).toBe(true);
    await expect(nodeByPath(page, '48.50')).toBeInViewport();
  });

  test('collapsing a root shrinks the scroll height', async ({ page }) => {
    await loadVirtual(page);
    const before = await body(page).evaluate((el) => el.scrollHeight);
    await page.evaluate(() => (window as any).tree.collapseNodes(['1', '2', '3']));
    await expect.poll(() => body(page).evaluate((el) => el.scrollHeight)).toBeLessThan(before);
  });
});

test.describe('enable-flat-rendering', () => {
  test('rows are siblings, indented by (level − 1) × flat-indent-size', async ({ page }) => {
    await page.goto(`${PAGE}?mode=flat`);
    await expect(nodeByPath(page, '1.1.1')).toBeVisible();
    const pad = (p: string) => nodeByPath(page, p).evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft));
    expect(await pad('1')).toBe(0);
    expect(await pad('1.1')).toBeCloseTo(30, 0);
    expect(await pad('1.1.1')).toBeCloseTo(60, 0);
    // flat: no row is nested inside another row
    expect(await page.locator('.wtv__node .wtv__node').count()).toBe(0);
  });

  test('changing flat-indent-size at runtime re-indents the rows', async ({ page }) => {
    await page.goto(`${PAGE}?mode=flat`);
    await expect(nodeByPath(page, '1.1.1')).toBeVisible();
    await page.evaluate(() => (window as any).tree.setAttribute('flat-indent-size', '10px'));
    await expect
      .poll(() => nodeByPath(page, '1.1.1').evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft)))
      .toBeCloseTo(20, 0);
  });
});

test.describe('progressive-render', () => {
  test('a large tree renders in growing batches until every row is in the DOM', async ({ page }) => {
    await page.goto(`${PAGE}?mode=progressive`);
    await expect.poll(async () => (await rowPaths(page)).length, { timeout: 8_000 }).toBe(2000);
    const counts: number[] = await page.evaluate(() => (window as any).rowCounts);
    const nonZero = counts.filter((n) => n > 0);
    // First painted frame holds only a batch, not the whole tree …
    expect(nonZero[0]).toBeLessThan(2000);
    // … and the count only ever grows, over several frames.
    for (let i = 1; i < nonZero.length; i++) expect(nonZero[i]).toBeGreaterThanOrEqual(nonZero[i - 1]);
    expect(new Set(nonZero).size).toBeGreaterThan(2);
  });
  test('a tree change while batches are pending loses no rows (NOTES #10)', async ({ page }) => {
    await page.goto(`${PAGE}?mode=progressive`);
    await expect.poll(async () => (await rowPaths(page)).length).toBeGreaterThan(0);
    // re-run the progressive pass mid-flight (collapse + expand → new trackers)
    await page.evaluate(() => { const t = (window as any).tree; t.collapseNodes('1'); t.expandNodes('1'); });
    await expect.poll(async () => (await rowPaths(page)).length, { timeout: 8_000 }).toBe(2000);
  });

  test('progressive-render can be switched at runtime (NOTES #9)', async ({ page }) => {
    await page.goto(`${PAGE}?mode=progressive`);
    await expect.poll(async () => (await rowPaths(page)).length, { timeout: 8_000 }).toBe(2000);
    await page.evaluate(() => (window as any).tree.setAttribute('progressive-render', 'false'));
    await page.evaluate(() => (window as any).tree.expandNodes('1'));
    await page.evaluate(() => (window as any).tree.collapseNodes('1'));
    await expect.poll(async () => (await rowPaths(page)).length).toBe(1901);
  });
});
