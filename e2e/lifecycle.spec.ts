import { test, expect, type Page, nodeByPath, nodeContent, logLines } from './fixtures';

/**
 * DOM move keeps state (decision D1, e2e-coverage-plan): a re-parent is
 * disconnect → connect, NOT a rebuild (/test/lifecycle.html).
 *
 *   1 A ── 1.1 A1, 1.2 A2
 *   2 B ── 2.1 B1
 */

const PAGE = '/test/lifecycle.html';
const LOG = 'lc-log';

async function load(page: Page) {
  await page.goto(PAGE);
  await expect(nodeByPath(page, '2')).toBeVisible();
}

const rows = (page: Page) => page.locator('.wtv__node[data-tree-path]').evaluateAll((els) => els.map((e) => e.getAttribute('data-tree-path')));
const selected = (page: Page) => page.evaluate(() => [...(window as any).tree.getSelectedPaths()].sort());
const toggleOf = (page: Page, path: string) => nodeByPath(page, path).locator('> .wtv__node-row .wtv__toggle-icon').first();

async function setUpState(page: Page) {
  await toggleOf(page, '1').click();
  await expect(nodeByPath(page, '1.1')).toBeVisible();
  await nodeContent(nodeByPath(page, '1.1')).click();
  await nodeContent(nodeByPath(page, '2')).click({ modifiers: ['Control'] });
  await nodeByPath(page, '1.2').locator('.wtv__checkbox').first().click();
  expect(await selected(page)).toEqual(['1.1', '2']);
}

test('re-parenting keeps expansion, selection, checks and focus', async ({ page }) => {
  test.fail(true, 'NOTES.md #15');
  await load(page);
  await setUpState(page);
  const rowsBefore = await rows(page);
  const focusedBefore = await page.evaluate(() => (window as any).tree.getFocusedNode()?.path);

  await page.evaluate(() => (window as any).moveTo('slot-b'));
  await expect(page.locator('#slot-b web-treeview')).toHaveCount(1);

  expect(await rows(page)).toEqual(rowsBefore);
  expect(await selected(page)).toEqual(['1.1', '2']);
  await expect(nodeContent(nodeByPath(page, '1.1'))).toHaveClass(/wtv__node-content--selected/);
  await expect(nodeByPath(page, '1.2').locator('.wtv__checkbox').first()).toBeChecked();
  expect(await page.evaluate(() => (window as any).tree.getFocusedNode()?.path)).toBe(focusedBefore);
});

test('after a move, clicks and keys still work and fire exactly once', async ({ page }) => {
  await load(page);
  await setUpState(page);
  await page.evaluate(() => (window as any).moveTo('slot-b'));
  await page.evaluate(() => { document.querySelector('[data-testid="lc-log"]')!.textContent = ''; });

  // Root rows only — expansion survival is pinned separately (NOTES.md #15).
  await nodeContent(nodeByPath(page, '2')).click();
  await expect.poll(() => logLines(page, LOG)).toContain('node-click:2');
  await page.waitForTimeout(100);
  const clicks = (await logLines(page, LOG)).filter((l) => l.startsWith('node-click:'));
  expect(clicks).toEqual(['node-click:2']);

  await page.keyboard.press('ArrowUp');
  await expect.poll(() => page.evaluate(() => (window as any).tree.getFocusedNode()?.path)).toBe('1');
});

test('detached for a while then re-attached: state survives, no rebuild flash', async ({ page }) => {
  test.fail(true, 'NOTES.md #15');
  await load(page);
  await setUpState(page);
  const rowsBefore = await rows(page);
  await page.evaluate(() => (window as any).detachFor(100));
  await expect(page.locator('#slot-a web-treeview')).toHaveCount(1);
  expect(await rows(page)).toEqual(rowsBefore);
  expect(await selected(page)).toEqual(['1.1', '2']);
});

test('a config change made while detached is applied on reconnect', async ({ page }) => {
  await load(page);
  await page.evaluate(async () => {
    const t = (window as any).tree;
    const parent = t.parentElement;
    t.remove();
    t.setAttribute('show-checkboxes', 'false');
    await new Promise((r) => setTimeout(r, 50));
    parent.appendChild(t);
  });
  await expect(page.locator('.wtv__checkbox')).toHaveCount(0);
});
