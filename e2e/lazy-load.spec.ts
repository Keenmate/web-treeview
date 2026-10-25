import { test, expect, type Page, nodeByPath, nodeContent, logLines } from './fixtures';

/**
 * Lazy trees via `has-children-member` (/test/lazy-load.html).
 *
 *   1 Remote      (hasChildren: true, no children loaded)
 *   2 Local leaf  (hasChildren: false)
 *
 * The page's handler calls `insertBranch` (after a simulated fetch) when an
 * expanded node flagged hasChildren has no children yet. `insertBranch` places
 * each row by its own path (1.1, 1.2); rows are found by label.
 */

const PAGE = '/test/lazy-load.html';
const LOG = 'll-log';

async function load(page: Page, via: 'click' | 'change' = 'click') {
  await page.goto(`${PAGE}?via=${via}`);
  await expect(nodeByPath(page, '2')).toBeVisible();
}

const label = (page: Page, text: string) => page.locator('.wtv__node-label', { hasText: text });

const toggleOf = (page: Page, path: string) =>
  nodeByPath(page, path).locator('> .wtv__node-row .wtv__toggle-icon').first();

test('a childless node flagged hasChildren shows an expand toggle; a plain leaf does not', async ({ page }) => {
  await load(page);
  await expect(toggleOf(page, '1')).toHaveClass(/wtv__toggle-icon--expand/);
  await expect(toggleOf(page, '1')).toHaveClass(/wtv__clickable/);
  await expect(toggleOf(page, '2')).not.toHaveClass(/wtv__toggle-icon--expand/);
  expect(await page.locator('.wtv__node[data-tree-path^="1."]').count()).toBe(0);
});

test('clicking the row expands it; the handler inserts the branch and the children render', async ({ page }) => {
  await load(page, 'click');
  await nodeContent(nodeByPath(page, '1')).click();
  await expect(label(page, 'Remote child A')).toBeVisible();
  await expect(label(page, 'Remote child B')).toBeVisible();
  await expect(toggleOf(page, '1')).toHaveClass(/expanded/);
  expect(await logLines(page, LOG)).toEqual(['load:1', 'inserted:1:2']);
});

test('the loaded branch collapses and re-expands without loading again', async ({ page }) => {
  await load(page, 'click');
  await nodeContent(nodeByPath(page, '1')).click();
  await expect(label(page, 'Remote child A')).toBeVisible();
  await toggleOf(page, '1').click();
  await expect(label(page, 'Remote child A')).toHaveCount(0);
  await toggleOf(page, '1').click();
  await expect(label(page, 'Remote child A')).toBeVisible();
  expect(await logLines(page, LOG)).toEqual(['load:1', 'inserted:1:2']);
});

test('expanding via the toggle is observable (tree-change) so the branch can load', async ({ page }) => {
  await load(page, 'change');
  await toggleOf(page, '1').click();
  await expect(label(page, 'Remote child A')).toBeVisible();
  expect(await logLines(page, LOG)).toEqual(['load:1', 'inserted:1:2']);
});
