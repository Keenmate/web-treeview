import { test, expect, type Page, nodeByPath } from './fixtures';

/**
 * Search configuration (/test/search-config.html).
 *
 *   1 Europe ── 1.1 London (tags: capital rain), 1.2 Paris (capital croissant)
 *   2 Asia ── 2.1 Tokyo (capital sushi), 2.2 Osaka (city takoyaki)
 *
 * The internal index builds asynchronously, so queries are polled.
 */

const PAGE = '/test/search-config.html';
const ALL = ['Europe', 'London', 'Paris', 'Asia', 'Tokyo', 'Osaka'];

async function load(page: Page, mode: string) {
  await page.goto(`${PAGE}?mode=${mode}`);
  await expect(nodeByPath(page, '2.2')).toBeVisible();
}

const rowNames = (page: Page): Promise<string[]> => page.evaluate(() => (window as any).rowNames());
const found = (page: Page, q: string): Promise<string[]> => page.evaluate((q) => (window as any).found(q), q);

test.describe('search-term attribute', () => {
  test('setting it filters the tree (ancestors kept); removing it restores', async ({ page }) => {
    await load(page, 'member');
    await expect.poll(() => found(page, 'sushi')).toEqual(['Tokyo']);
    await page.evaluate(() => (window as any).tree.setAttribute('search-term', 'sushi'));
    await expect.poll(() => rowNames(page)).toEqual(['Asia', 'Tokyo']);
    await page.evaluate(() => (window as any).tree.removeAttribute('search-term'));
    await expect.poll(() => rowNames(page)).toEqual(ALL);
  });

  test('the searchTerm property works the same', async ({ page }) => {
    await load(page, 'member');
    await expect.poll(() => found(page, 'croissant')).toEqual(['Paris']);
    await page.evaluate(() => { (window as any).tree.searchTerm = 'croissant'; });
    await expect.poll(() => rowNames(page)).toEqual(['Europe', 'Paris']);
  });
});

test('search-value-member: matches the configured field, not the label', async ({ page }) => {
  await load(page, 'member');
  await expect.poll(() => found(page, 'capital')).toEqual(['London', 'Paris', 'Tokyo']);
  expect(await found(page, 'Osaka')).toEqual([]);
});

test('getSearchValueCallback: matches the computed value', async ({ page }) => {
  await load(page, 'callback');
  await expect.poll(() => found(page, 'TYO')).toEqual(['Tokyo']);
  expect(await found(page, 'takoyaki')).toEqual([]);
});

test.describe('filterNodes()', () => {
  test('filters to the matches + their ancestors; empty string clears', async ({ page }) => {
    await load(page, 'member');
    await expect.poll(() => found(page, 'capital')).toHaveLength(3);
    await page.evaluate(() => (window as any).tree.filterNodes('capital'));
    await expect.poll(() => rowNames(page)).toEqual(['Europe', 'London', 'Paris', 'Asia', 'Tokyo']);
    await page.evaluate(() => (window as any).tree.filterNodes(''));
    await expect.poll(() => rowNames(page)).toEqual(ALL);
  });
});

test.describe('use-internal-search-index="false"', () => {
  test('searchNodes returns nothing and filterNodes leaves the tree alone', async ({ page }) => {
    await load(page, 'off');
    await page.waitForTimeout(200);
    expect(await found(page, 'capital')).toEqual([]);
    await page.evaluate(() => (window as any).tree.filterNodes('capital'));
    await page.waitForTimeout(100);
    expect(await rowNames(page)).toEqual(ALL);
  });
});
