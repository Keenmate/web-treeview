import { test, expect, type Page, nodeByPath, nodeContent, logLines } from './fixtures';

/**
 * Lazy trees + expand/collapse events (/test/lazy-load.html).
 *
 *   1 Remote      (hasChildren: true, children loaded by beforeExpandCallback)
 *   2 Local leaf
 *   3 Remote 2    (hasChildren: true, lazy)
 *   4 Folder ──── 4.1 Folder child (already loaded)
 *
 * The documented pattern: `beforeExpandCallback` inserts the branch
 * (`ctx.controller.insertBranch`) and resolves; while it's pending the node shows
 * a loading state and ignores repeat toggles. Log lines: before:<path> (hook),
 * inserted:<path>:<n>, expand:<path> / collapse:<path> (node-expand / node-collapse).
 */

const PAGE = '/test/lazy-load.html';
const LOG = 'll-log';

async function load(page: Page, mode: 'load' | 'manual' | 'reject' | 'cancel' = 'load') {
  await page.goto(`${PAGE}?mode=${mode}`);
  await expect(nodeByPath(page, '4')).toBeVisible();
}

const label = (page: Page, text: string) => page.locator('.wtv__node-label', { hasText: text });
const log = (page: Page) => logLines(page, LOG);
const focused = (page: Page) => page.evaluate(() => (window as any).tree.focusedNode?.path ?? null);

const toggleOf = (page: Page, path: string) =>
  nodeByPath(page, path).locator('> .wtv__node-row .wtv__toggle-icon').first();

test('a childless node flagged hasChildren shows an expand toggle; a plain leaf does not', async ({ page }) => {
  await load(page);
  await expect(toggleOf(page, '1')).toHaveClass(/wtv__toggle-icon--expand/);
  await expect(toggleOf(page, '1')).toHaveClass(/wtv__clickable/);
  await expect(toggleOf(page, '2')).not.toHaveClass(/wtv__toggle-icon--expand/);
  expect(await page.locator('.wtv__node[data-tree-path^="1."]').count()).toBe(0);
});

test('async load: clicking the row runs the hook, inserts the children, then expands', async ({ page }) => {
  await load(page);
  await nodeContent(nodeByPath(page, '1')).click();
  await expect(label(page, 'Remote child A')).toBeVisible();
  await expect(label(page, 'Remote child B')).toBeVisible();
  await expect(toggleOf(page, '1')).toHaveClass(/expanded/);
  expect(await log(page)).toEqual(['before:1', 'inserted:1:2', 'expand:1']);
});

test('the loaded branch collapses and re-expands without loading again', async ({ page }) => {
  await load(page);
  await toggleOf(page, '1').click();
  await expect(label(page, 'Remote child A')).toBeVisible();
  await toggleOf(page, '1').click();
  await expect(label(page, 'Remote child A')).toHaveCount(0);
  await toggleOf(page, '1').click();
  await expect(label(page, 'Remote child A')).toBeVisible();
  expect(await log(page)).toEqual(['before:1', 'inserted:1:2', 'expand:1', 'collapse:1', 'before:1', 'expand:1']);
});

test('returning false keeps the node collapsed (no expand event)', async ({ page }) => {
  await load(page, 'cancel');
  await toggleOf(page, '4').click();
  await page.waitForTimeout(100);
  await expect(toggleOf(page, '4')).not.toHaveClass(/expanded/);
  await expect(label(page, 'Folder child')).toHaveCount(0);
  expect(await log(page)).toEqual(['before:4']);
});

test('a rejected load keeps the node collapsed, clears the loading state and logs an error', async ({ page }) => {
  // core's runBeforeCallbackEager reports the rejection through the element's logger (error level)
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await load(page, 'reject');
  await toggleOf(page, '1').click();
  await expect.poll(() => errors.some((e) => e.includes('[TREEVIEW:UI]') && e.includes('beforeExpandCallback threw'))).toBe(true);
  await expect(toggleOf(page, '1')).not.toHaveClass(/wtv__toggle-icon--loading/);
  await expect(toggleOf(page, '1')).not.toHaveClass(/expanded/);
  await expect(nodeByPath(page, '1')).not.toHaveAttribute('aria-busy', 'true');
  expect(await log(page)).toEqual(['before:1']);
});

test('while the load is pending the node shows a spinner + aria-busy; it clears on expand', async ({ page }) => {
  await load(page, 'manual');
  await toggleOf(page, '1').click();
  await expect(toggleOf(page, '1')).toHaveClass(/wtv__toggle-icon--loading/);
  await expect(nodeByPath(page, '1')).toHaveAttribute('aria-busy', 'true');
  await expect(toggleOf(page, '1')).not.toHaveClass(/expanded/);

  await page.evaluate(() => (window as any).finishLoad());
  await expect(label(page, 'Remote child A')).toBeVisible();
  await expect(toggleOf(page, '1')).not.toHaveClass(/wtv__toggle-icon--loading/);
  await expect(toggleOf(page, '1')).toHaveClass(/expanded/);
  await expect(nodeByPath(page, '1')).not.toHaveAttribute('aria-busy', 'true');
});

test('repeated toggles of a pending node are ignored (one hook call, ends expanded)', async ({ page }) => {
  await load(page, 'manual');
  await toggleOf(page, '1').click();
  await expect(toggleOf(page, '1')).toHaveClass(/wtv__toggle-icon--loading/);
  await toggleOf(page, '1').click();
  await toggleOf(page, '1').click();
  await page.evaluate(() => (window as any).tree.expandNodes('1'));
  expect(await log(page)).toEqual(['before:1']);

  await page.evaluate(() => (window as any).finishLoad());
  await expect(label(page, 'Remote child A')).toBeVisible();
  expect(await log(page)).toEqual(['before:1', 'inserted:1:2', 'expand:1']);
});

test('keyboard: ArrowRight / Backspace / Space fire node-expand / node-collapse (through the hook)', async ({ page }) => {
  await load(page);
  await nodeContent(nodeByPath(page, '2')).click(); // leaf: just focuses
  await page.keyboard.press('ArrowDown'); // → 3
  await page.keyboard.press('ArrowDown'); // → 4
  await expect.poll(() => focused(page)).toBe('4');

  await page.keyboard.press('ArrowRight'); // expand 4 (sync hook) + into 4.1
  await expect.poll(() => focused(page)).toBe('4.1');
  await page.keyboard.press('Backspace'); // collapse 4, focus 4
  await expect.poll(() => focused(page)).toBe('4');
  await page.keyboard.press('Space'); // toggle → expand 4
  await expect(label(page, 'Folder child')).toBeVisible();
  expect(await log(page)).toEqual(['before:4', 'expand:4', 'collapse:4', 'before:4', 'expand:4']);
});

test('keyboard ArrowRight on a lazy node waits for the load, then moves into the first child', async ({ page }) => {
  await load(page);
  await nodeContent(nodeByPath(page, '2')).click();
  await page.keyboard.press('ArrowUp'); // → 1
  await expect.poll(() => focused(page)).toBe('1');
  await page.keyboard.press('ArrowRight');
  await expect(label(page, 'Remote child A')).toBeVisible();
  await expect.poll(() => focused(page)).toBe('1.1');
  expect(await log(page)).toEqual(['before:1', 'inserted:1:2', 'expand:1']);
});

test('API: expandNodes runs the hook (async load) and fires node-expand; collapseNodes fires node-collapse', async ({ page }) => {
  await load(page);
  await page.evaluate(() => (window as any).tree.expandNodes('3'));
  await expect(label(page, 'Remote 2 child')).toBeVisible();
  await page.evaluate(() => (window as any).tree.collapseNodes('3'));
  await expect(label(page, 'Remote 2 child')).toHaveCount(0);
  expect(await log(page)).toEqual(['before:3', 'inserted:3:1', 'expand:3', 'collapse:3']);
});

test('expandAll / collapseAll skip the hook and fire no per-node events (tree-change only)', async ({ page }) => {
  await load(page);
  const changes = await page.evaluate(() => {
    const t = (window as any).tree;
    let n = 0;
    t.addEventListener('tree-change', () => n++);
    t.expandAll();
    return new Promise<number>((r) => setTimeout(() => r(n), 50));
  });
  await expect(label(page, 'Folder child')).toBeVisible();
  expect(changes).toBeGreaterThan(0);
  await page.evaluate(() => (window as any).tree.collapseAll());
  await expect(label(page, 'Folder child')).toHaveCount(0);
  expect(await log(page)).toEqual([]);
});
