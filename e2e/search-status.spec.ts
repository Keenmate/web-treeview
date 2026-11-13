import { test, expect } from '@playwright/test';

/**
 * Search status API on /test/search-status.html: search-result-limit truncation detection,
 * search-status-change, index-progress, and a tree that STARTS with a search-term.
 * Mirrors svelte-treeview's e2e/search-status.spec.ts.
 * Fixture: 20 groups × 10 leaves ("Group g", "Leaf g-l") = 220 nodes.
 * status text = `${searchTerm}|${matchCount}|${isLimited}|${limit}`.
 */

const PAGE = '/test/search-status.html';

test('a tree that STARTS with a search-term shows its matches once the index is built', async ({ page }) => {
  await page.goto(`${PAGE}?term=Leaf 7-3`);
  await expect(page.getByTestId('index-complete')).toHaveText('true');
  // The filter first ran against an empty index; the completion re-filter must reveal the match.
  await expect(page.locator('#tree .wtv__node[data-tree-path="7.3"]')).toHaveCount(1);
  // …and typing a new term still filters against the real data.
  await page.getByTestId('term').fill('Leaf 4-2');
  await expect(page.locator('#tree .wtv__node[data-tree-path="4.2"]')).toHaveCount(1);
});

test("default limit is no longer FlexSearch's silent 100", async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.getByTestId('index-complete')).toHaveText('true');
  await page.getByTestId('term').fill('Leaf');
  await expect(page.getByTestId('status')).toHaveText('Leaf|200|false|1000');
});

test('search-result-limit truncates and reports isLimited', async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.getByTestId('index-complete')).toHaveText('true');
  await page.getByTestId('term').fill('Leaf');
  await page.getByTestId('limit-5').click();
  await expect(page.getByTestId('status')).toHaveText('Leaf|5|true|5');
  await page.getByTestId('limit-default').click();
  await expect(page.getByTestId('status')).toHaveText('Leaf|200|false|1000');
});

test('index-progress reports completion with processed === total', async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.getByTestId('index-complete')).toHaveText('true');
  await expect(page.getByTestId('index-progress')).toHaveText('220/220');
});
