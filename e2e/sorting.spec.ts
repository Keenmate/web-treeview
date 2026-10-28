import { test, expect, type Page } from './fixtures';

/**
 * Sorting (round 3, svelte-treeview parity): `isSortingEnabled` / `enable-sorting`,
 * `sortNodes` / `sortAll` (+ `SortOptions`), `nodes-reorder`, the `sort*` menu built-ins.
 * Fixture: test/sorting.html (`window.make({ attrs, props, nodes })` builds a fresh tree).
 *
 * Base data (input order): roots "Item 10"(o30), "Item 2"(o10), "Item 1"(o20);
 * 1 → "b"(o20), "a"(o10); 1.1 → "y"(o10), "x"(o20).
 */

const PAGE = '/test/sorting.html';

async function make(page: Page, opts: Record<string, unknown> = {}) {
  await page.goto(PAGE);
  await page.evaluate((o) => (window as any).make(o), opts);
}
const children = (page: Page, path: string) => page.evaluate((p) => (window as any).childNames(p), path);
const orders = (page: Page, path: string) => page.evaluate((p) => (window as any).childOrders(p), path);
const rows = (page: Page) => page.evaluate(() => (window as any).rowNames());
const reorders = (page: Page) => page.evaluate(() => (window as any).__reorders);
const call = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => (window as any).tree[f as string](...(a as unknown[])), [fn, args] as const);

test.describe('default sort rule', () => {
  test('display value, numeric-aware (Item 1, Item 2, Item 10)', async ({ page }) => {
    await make(page);
    expect(await children(page, '')).toEqual(['Item 1', 'Item 2', 'Item 10']);
    expect(await children(page, '1')).toEqual(['a', 'b']);
  });

  test('orderMember wins over the display value; sortCallback wins over orderMember', async ({ page }) => {
    await make(page, { props: { orderMember: 'order' } });
    expect(await children(page, '')).toEqual(['Item 2', 'Item 1', 'Item 10']);
    await page.evaluate(() => (window as any).make({
      props: { orderMember: 'order', sortCallback: ({ nodes }: any) => [...nodes].sort((a: any, b: any) => b.data.id - a.data.id) },
    }));
    expect(await children(page, '')).toEqual(['Item 10', 'Item 1', 'Item 2']);
  });
});

test.describe('isSortingEnabled / enable-sorting', () => {
  test('off: the input order is kept; addNode appends', async ({ page }) => {
    await make(page, { attrs: { 'enable-sorting': 'false' } });
    expect(await page.evaluate(() => (window as any).tree.isSortingEnabled)).toBe(false);
    expect(await children(page, '')).toEqual(['Item 10', 'Item 2', 'Item 1']);
    expect(await children(page, '1')).toEqual(['b', 'a']);
    await call(page, 'addNode', '', { id: 4, path: '4', name: 'Item 0' });
    expect(await children(page, '')).toEqual(['Item 10', 'Item 2', 'Item 1', 'Item 0']);
    await expect.poll(() => rows(page)).toEqual(['Item 10', 'Item 2', 'b', 'y', 'x', 'a', 'Item 1', 'Item 0']);
  });

  test('off: insertNode / moveNode / insertBranch keep the exact position', async ({ page }) => {
    await make(page, { props: { isSortingEnabled: false } });
    await call(page, 'insertNode', '2', { id: 5, path: '5', name: 'AAA' }, 'after');
    expect(await children(page, '')).toEqual(['Item 10', 'Item 2', 'Item 1', 'AAA']);
    await call(page, 'insertNode', '3', { id: 6, path: '6', name: 'ZZZ' }, 'before');
    expect(await children(page, '')).toEqual(['ZZZ', 'Item 10', 'Item 2', 'Item 1', 'AAA']);
    await call(page, 'moveNode', '6', '1', 'after');
    expect(await children(page, '')).toEqual(['Item 10', 'Item 2', 'ZZZ', 'Item 1', 'AAA']);
    await call(page, 'insertBranch', '3', [{ id: 7, path: '7', name: 'M2' }, { id: 8, path: '8', name: 'M1' }], 'after');
    expect(await children(page, '')).toEqual(['Item 10', 'M2', 'M1', 'Item 2', 'ZZZ', 'Item 1', 'AAA']);
  });

  test('off + orderMember: the position is exact AND the order value is computed between the neighbours', async ({ page }) => {
    await make(page, { props: { isSortingEnabled: false, orderMember: 'order' } });
    expect(await children(page, '')).toEqual(['Item 10', 'Item 2', 'Item 1']);
    await call(page, 'insertNode', '2', { id: 5, path: '5', name: 'New' }, 'after');
    expect(await children(page, '')).toEqual(['Item 10', 'Item 2', 'Item 1', 'New']);
    const order = await page.evaluate(() => (window as any).tree.getNodeByPath('5').data.order);
    expect(order).toBeGreaterThan(20); // after "Item 1"(20), before "Item 10"(30) by value
    expect(order).toBeLessThan(30);
  });

  test('switching it back on re-sorts the tree', async ({ page }) => {
    await make(page, { props: { isSortingEnabled: false } });
    expect(await children(page, '')).toEqual(['Item 10', 'Item 2', 'Item 1']);
    await page.evaluate(async () => { const t = (window as any).tree; t.isSortingEnabled = true; await t.whenSettled(); });
    expect(await children(page, '')).toEqual(['Item 1', 'Item 2', 'Item 10']);
    expect(await children(page, '1.1')).toEqual(['x', 'y']);
  });
});

test.describe('sortNodes / sortAll', () => {
  test('sortNodes sorts one level; sortAll the subtree; null = whole tree — also with sorting off', async ({ page }) => {
    await make(page, { props: { isSortingEnabled: false } });
    await call(page, 'sortNodes', '1');
    expect(await children(page, '1')).toEqual(['a', 'b']);
    expect(await children(page, '1.1')).toEqual(['y', 'x']); // one level only
    expect(await children(page, '')).toEqual(['Item 10', 'Item 2', 'Item 1']);
    await call(page, 'sortAll', '1');
    expect(await children(page, '1.1')).toEqual(['x', 'y']);
    expect(await children(page, '')).toEqual(['Item 10', 'Item 2', 'Item 1']);
    await call(page, 'sortAll', null);
    expect(await children(page, '')).toEqual(['Item 1', 'Item 2', 'Item 10']);
    await expect.poll(() => rows(page)).toEqual(['Item 1', 'Item 2', 'a', 'b', 'x', 'y', 'Item 10']);
    expect(await reorders(page)).toEqual([]); // no orderMember → never nodes-reorder
  });

  test('compareCallback + direction desc; sortNodes("") sorts the roots', async ({ page }) => {
    await make(page);
    await page.evaluate(() => (window as any).tree.sortNodes('', { compareCallback: ({ a, b }: any) => a.data.id - b.data.id }));
    expect(await children(page, '')).toEqual(['Item 2', 'Item 1', 'Item 10']);
    await call(page, 'sortNodes', '', { direction: 'desc' });
    expect(await children(page, '')).toEqual(['Item 10', 'Item 2', 'Item 1']);
  });

  test('with orderMember: a custom compare rewrites the order values (10, 20, 30) and fires nodes-reorder per parent', async ({ page }) => {
    await make(page, { props: { orderMember: 'order' } });
    await page.evaluate(() => {
      const w = window as any;
      w.__twin = 0;
      w.tree.onNodesReorder = () => w.__twin++;
      w.tree.sortAll(null, { compareCallback: ({ a, b }: any) => a.data.name.localeCompare(b.data.name, undefined, { numeric: true }) });
    });
    expect(await children(page, '')).toEqual(['Item 1', 'Item 2', 'Item 10']);
    expect(await orders(page, '')).toEqual([10, 20, 30]);
    expect(await orders(page, '1')).toEqual([10, 20]);
    const r = await reorders(page);
    expect(r.map((x: any) => x.parentPath).sort()).toEqual(['', '1.1']); // '1' was already a, b (10, 20): no change, no event
    const roots = r.find((x: any) => x.parentPath === '');
    expect(roots.nodes).toEqual(['2', '1', '3']);
    expect(roots.changes).toEqual([
      { path: '2', oldOrder: 20, newOrder: 10 },
      { path: '1', oldOrder: 10, newOrder: 20 },
    ]);
    expect(await page.evaluate(() => (window as any).__twin)).toBe(2);
    // The rewrite persists: a later automatic re-sort keeps the new order.
    await call(page, 'addNode', '', { id: 9, path: '9', name: 'Item 0', order: 99 });
    expect(await children(page, '')).toEqual(['Item 1', 'Item 2', 'Item 10', 'Item 0']);
  });

  test('with orderMember: direction desc rewrites too; the default rule rewrites nothing; isSilent fires no event', async ({ page }) => {
    await make(page, { props: { orderMember: 'order' } });
    await call(page, 'sortNodes', '');
    expect(await reorders(page)).toEqual([]);
    await call(page, 'sortNodes', '', { direction: 'desc', isSilent: true });
    expect(await children(page, '')).toEqual(['Item 10', 'Item 1', 'Item 2']);
    expect(await orders(page, '')).toEqual([10, 20, 30]);
    await expect.poll(() => rows(page)).toEqual(['Item 10', 'Item 1', 'Item 2', 'a', 'b', 'y', 'x']);
    expect(await reorders(page)).toEqual([]);
    await call(page, 'sortNodes', '', { direction: 'desc' });
    expect(await reorders(page)).toHaveLength(1);
  });
});

test.describe('sort menu built-ins', () => {
  async function openMenu(page: Page, path: string) {
    await page.locator(`.wtv__node[data-tree-path="${path}"]`).first()
      .locator('> .wtv__node-row .wtv__node-content').first().click({ button: 'right' });
    await expect(page.locator('.km-menu:not(.km-menu--submenu)').first()).toBeVisible();
  }
  const item = (page: Page, action: string) =>
    page.locator('.km-menu:not(.km-menu--submenu)').first().locator(`.km-menu__item[data-action="${action}"]`);

  test('sort / sort-subtree / sort-all with labels; sort is disabled on a leaf', async ({ page }) => {
    await make(page, { props: { isSortingEnabled: false } });
    await page.evaluate(async () => {
      const t = (window as any).tree;
      t.getContextMenuItemsCallback = () => ['sort', 'sort-subtree', 'sort-all'];
      t.labels = { sortAll: 'Sort everything' };
      await t.whenSettled();
    });
    await openMenu(page, '1.2');
    await expect(item(page, 'sort')).toHaveClass(/km-menu__item--disabled/);
    await page.keyboard.press('Escape');
    await openMenu(page, '1');
    await expect(item(page, 'sort')).toHaveText('Sort');
    await expect(item(page, 'sort-subtree')).toHaveText('Sort subtree');
    await expect(item(page, 'sort-all')).toHaveText('Sort everything');
    await item(page, 'sort').click();
    expect(await children(page, '1')).toEqual(['a', 'b']);
    expect(await children(page, '1.1')).toEqual(['y', 'x']);
    await openMenu(page, '1');
    await item(page, 'sort-subtree').click();
    expect(await children(page, '1.1')).toEqual(['x', 'y']);
    expect(await children(page, '')).toEqual(['Item 10', 'Item 2', 'Item 1']);
    await openMenu(page, '1');
    await item(page, 'sort-all').click();
    expect(await children(page, '')).toEqual(['Item 1', 'Item 2', 'Item 10']);
  });
});
