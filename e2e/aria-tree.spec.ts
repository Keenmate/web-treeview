import { test, expect, type Page, nodeByPath, nodeContent } from './fixtures';

/**
 * ARIA tree semantics (WAI-ARIA tree pattern). Focus stays on the `role="tree"` body
 * (rows are virtual); the active row is `aria-activedescendant`, owned by core `/a11y`
 * `createActiveDescendant` in ARIA-only mode — the tree keeps all its own keys.
 *
 * Fixture: test/aria-tree.html
 *   #tree   — 1 Fruit (1.1 Apple, 1.2 Banana, 1.3 Cherry) · 2 Veg (2.1 Carrot) · 3 Leaf; single selection
 *   #multi  — same data, selection-mode="multiple", labels['ariaLabels.tree'] = "Food"
 *   #checks — same data, checkboxes, checkbox-mode="cascade"
 *   #big    — virtual scroll, 50 roots × 99 children
 */

const PAGE = '/test/aria-tree.html';

const body = (page: Page, id: string) => page.locator(`#${id} .wtv__tree`);

/** The tree body's `aria-activedescendant` resolved to the row's `data-tree-path` (null = none / dangling). */
async function activePath(page: Page, id: string): Promise<string | null> {
  return page.evaluate((i) => {
    const root = document.getElementById(i)!.shadowRoot!;
    const ref = root.querySelector('.wtv__tree')!.getAttribute('aria-activedescendant');
    if (!ref) return null;
    return root.getElementById(ref)?.getAttribute('data-tree-path') ?? null;
  }, id);
}

test.beforeEach(async ({ page }) => {
  await page.goto(PAGE);
  await page.waitForFunction(() => (window as any).__ready === true);
});

test('the body is a labelled tree; aria-multiselectable only in multiple mode', async ({ page }) => {
  await expect(body(page, 'tree')).toHaveAttribute('role', 'tree');
  await expect(body(page, 'tree')).toHaveAttribute('aria-label', 'Tree');
  await expect(body(page, 'tree')).not.toHaveAttribute('aria-multiselectable', /.*/);
  await expect(body(page, 'multi')).toHaveAttribute('aria-multiselectable', 'true');
  await expect(body(page, 'multi')).toHaveAttribute('aria-label', 'Food');
  // A labels change applies live.
  await page.evaluate(() => { (window as any).tree.labels = { 'ariaLabels.tree': 'Pantry' }; });
  await expect(body(page, 'tree')).toHaveAttribute('aria-label', 'Pantry');
});

test('rows are treeitems with level, set position, expanded (parents only) and selected', async ({ page }) => {
  const t = page.locator('#tree');
  const fruit = nodeByPath(t, '1');
  const banana = nodeByPath(t, '1.2');
  const leaf = nodeByPath(t, '3');
  await expect(fruit).toHaveAttribute('role', 'treeitem');
  await expect(fruit).toHaveAttribute('aria-level', '1');
  await expect(fruit).toHaveAttribute('aria-posinset', '1');
  await expect(fruit).toHaveAttribute('aria-setsize', '3');
  await expect(fruit).toHaveAttribute('aria-expanded', 'true');
  await expect(nodeByPath(t, '2')).toHaveAttribute('aria-expanded', 'true');
  await expect(banana).toHaveAttribute('aria-level', '2');
  await expect(banana).toHaveAttribute('aria-posinset', '2');
  await expect(banana).toHaveAttribute('aria-setsize', '3');
  await expect(leaf).toHaveAttribute('aria-posinset', '3');
  await expect(leaf).not.toHaveAttribute('aria-expanded', /.*/);
  await expect(banana).not.toHaveAttribute('aria-expanded', /.*/);
  // No checkboxes → no aria-checked.
  await expect(banana).not.toHaveAttribute('aria-checked', /.*/);

  await expect(banana).toHaveAttribute('aria-selected', 'false');
  await nodeContent(banana).click();
  await expect(banana).toHaveAttribute('aria-selected', 'true');
  await nodeContent(leaf).click();
  await expect(banana).toHaveAttribute('aria-selected', 'false');
  await expect(leaf).toHaveAttribute('aria-selected', 'true');

  // Collapsing updates aria-expanded; the hidden children leave the DOM.
  await page.evaluate(() => (window as any).tree.collapseNodes('1'));
  await expect(fruit).toHaveAttribute('aria-expanded', 'false');
  await expect(nodeByPath(t, '1.2')).toHaveCount(0);
});

test('aria-activedescendant follows ArrowDown / ArrowRight while focus stays on the body', async ({ page }) => {
  await nodeContent(nodeByPath(page.locator('#tree'), '1')).click();
  await expect.poll(() => activePath(page, 'tree')).toBe('1');
  expect(await page.evaluate(() => document.getElementById('tree')!.shadowRoot!.activeElement?.classList.contains('wtv__tree'))).toBe(true);

  // ArrowDown = next node at the same level.
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => activePath(page, 'tree')).toBe('2');
  // Collapse Veg with Enter, then ArrowRight expands it and moves to its first child.
  await page.keyboard.press('Enter');
  await expect(nodeByPath(page.locator('#tree'), '2')).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(() => activePath(page, 'tree')).toBe('2');
  await page.keyboard.press('ArrowRight');
  await expect(nodeByPath(page.locator('#tree'), '2')).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(() => activePath(page, 'tree')).toBe('2.1');
  expect(await page.evaluate(() => document.getElementById('tree')!.shadowRoot!.activeElement?.classList.contains('wtv__tree'))).toBe(true);
});

test('virtual scroll: posinset / setsize count all siblings, not the rendered window', async ({ page }) => {
  const big = page.locator('#big');
  // Scroll ~ row 2000 (root 21 is visible-row 2000 = 20 × 100).
  await page.evaluate(() => {
    const b = document.getElementById('big')!.shadowRoot!.querySelector('.wtv__tree') as HTMLElement;
    const h = (b.querySelector('.wtv__node') as HTMLElement).offsetHeight;
    b.scrollTop = 2000 * h;
  });
  const root = nodeByPath(big, '21');
  await expect(root).toBeAttached();
  await expect(root).toHaveAttribute('aria-posinset', '21');
  await expect(root).toHaveAttribute('aria-setsize', '50');
  await expect(root).toHaveAttribute('aria-level', '1');
  const child = nodeByPath(big, '21.5');
  await expect(child).toHaveAttribute('aria-posinset', '5');
  await expect(child).toHaveAttribute('aria-setsize', '99');
  await expect(child).toHaveAttribute('aria-level', '2');
  // The first rows are no longer rendered.
  await expect(nodeByPath(big, '1')).toHaveCount(0);

  // End reveals the last row; aria-activedescendant points at it.
  await nodeContent(root).click();
  await expect.poll(() => activePath(page, 'big')).toBe('21');
  await page.keyboard.press('End');
  await expect.poll(() => activePath(page, 'big')).toBe('50.99');
  await expect(nodeByPath(big, '50.99')).toHaveAttribute('aria-posinset', '99');
});

test('checkboxes: aria-checked true / false / mixed (cascade)', async ({ page }) => {
  const c = page.locator('#checks');
  const fruit = nodeByPath(c, '1');
  const apple = nodeByPath(c, '1.1');
  await expect(fruit).toHaveAttribute('aria-checked', 'false');
  await expect(apple).toHaveAttribute('aria-checked', 'false');

  await apple.locator('.wtv__checkbox').click();
  await expect(apple).toHaveAttribute('aria-checked', 'true');
  await expect(fruit).toHaveAttribute('aria-checked', 'mixed');
  await expect(nodeByPath(c, '1.2')).toHaveAttribute('aria-checked', 'false');

  await nodeByPath(c, '1.2').locator('.wtv__checkbox').click();
  await nodeByPath(c, '1.3').locator('.wtv__checkbox').click();
  await expect(fruit).toHaveAttribute('aria-checked', 'true');

  await fruit.locator('.wtv__checkbox').click();
  await expect(fruit).toHaveAttribute('aria-checked', 'false');
  await expect(apple).toHaveAttribute('aria-checked', 'false');
});

test('a pasted copy keeps its source id but gets its own row id; aria-activedescendant hits the right row', async ({ page }) => {
  const t = page.locator('#tree');
  // Copy Banana (id 12) into Veg — no transform, so the copy keeps node id 12.
  const pasteError = await page.evaluate(() => {
    const tree = (window as any).tree;
    tree.copyNodes(['1.2']);
    const r = tree.pasteNodes('2');
    return r.success ? null : r.error;
  });
  expect(pasteError).toBeNull();
  const rows = t.locator('.wtv__node').filter({ hasText: 'Banana' });
  await expect(rows).toHaveCount(2);
  const info = await rows.evaluateAll((els) => els.map((e) => ({ id: e.id, path: e.getAttribute('data-tree-path')! })));
  const original = info.find((r) => r.path === '1.2')!;
  const copy = info.find((r) => r.path !== '1.2')!;
  expect(original.id).toBeTruthy();
  expect(copy.id).toBeTruthy();
  expect(copy.id).not.toBe(original.id);
  // Every rendered row id is unique.
  const ids = await t.locator('.wtv__node').evaluateAll((els) => els.map((e) => e.id));
  expect(new Set(ids).size).toBe(ids.length);

  await nodeContent(nodeByPath(t, copy.path)).click();
  await expect.poll(() => activePath(page, 'tree')).toBe(copy.path);
  await expect(body(page, 'tree')).toHaveAttribute('aria-activedescendant', copy.id);
  await nodeContent(nodeByPath(t, '1.2')).click();
  await expect.poll(() => activePath(page, 'tree')).toBe('1.2');
  await expect(body(page, 'tree')).toHaveAttribute('aria-activedescendant', original.id);
});
