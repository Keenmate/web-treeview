import { test, expect, type Page, type Locator } from './fixtures';

/**
 * The core interaction model (web-components-core `/actions`, SPEC §12.5 / §12.12):
 *   - context-menu entries are core action items: built-ins by name (`'copy'`, `'expand'`, …),
 *     custom items by `id`, dividers, `getIsToggledCallback`, lazy `getChildrenCallback`
 *   - one `action` event (+ `onAction`) per activation, in the order
 *     beforeActionCallback → onClick → built-in → onAction → action event
 *   - single-ctx callbacks carry `controller` / `element` (non-enumerable)
 *   - `on*` twins receive the detail; a checkbox toggle is not a node click
 *
 * Fixture: test/interaction-model.html.
 */

const PAGE = '/test/interaction-model.html';

function node(page: Page, path: string): Locator {
  return page.locator(`.wtv__node[data-tree-path="${path}"]`).first();
}
function menu(page: Page): Locator {
  return page.locator('.km-menu:not(.km-menu--submenu)').first();
}
function item(page: Page, selector: string): Locator {
  return menu(page).locator(`.km-menu__item${selector}`);
}
async function openMenu(page: Page, path: string): Promise<void> {
  await node(page, path).locator('> .wtv__node-row .wtv__node-content').first().click({ button: 'right' });
  await expect(menu(page)).toBeVisible();
}
const log = (page: Page) => page.evaluate(() => (window as any).__log as string[]);
const details = (page: Page) => page.evaluate(() => (window as any).__details as any[]);

test.beforeEach(async ({ page }) => {
  await page.goto(PAGE);
  await expect(node(page, '1')).toBeVisible();
});

test('per-node callbacks get one ctx with a non-enumerable controller + element', async ({ page }) => {
  await expect(node(page, '2')).toHaveClass(/js-images/);
  const seen = await page.evaluate(() => (window as any).__ctxSeen);
  expect(seen.hasController).toBe(true);
  expect(seen.elementIsHost).toBe(true);
  expect(seen.keys).toEqual(['node']);
});

test('menu items render from core action items: built-in defaults, data-action / data-id, icon, toggled, hidden, dividers', async ({ page }) => {
  await openMenu(page, '1');
  await expect(item(page, '[data-action="copy"]')).toHaveText('Copy');
  // 'expand' is disabled on an already-expanded node; 'paste' with an empty clipboard.
  await expect(item(page, '[data-action="expand"]')).toHaveClass(/km-menu__item--disabled/);
  await expect(item(page, '[data-action="paste"]')).toHaveClass(/km-menu__item--disabled/);
  await expect(item(page, '[data-action="delete"]')).toHaveClass(/km-menu__item--danger/);
  const rename = item(page, '[data-action="custom"][data-id="rename"]');
  await expect(rename.locator('.km-menu__icon')).toHaveText('✎');
  await expect(item(page, '[data-id="toggle"]')).toHaveAttribute('role', 'menuitemcheckbox');
  await expect(item(page, '[data-id="toggle"]')).toHaveAttribute('aria-checked', 'true');
  await expect(item(page, '[data-id="toggle"]')).toHaveClass(/km-menu__item--toggled/);
  await expect(item(page, '[data-action="copy"]')).toHaveAttribute('role', 'menuitem');
  await expect(item(page, '[data-id="hidden"]')).toHaveCount(0);
  await expect(menu(page).locator('.km-menu__divider')).toHaveCount(1);
});

test('built-in menu item texts come from labels', async ({ page }) => {
  await page.evaluate(() => { (document.querySelector('web-treeview') as any).labels = { copy: 'Kopírovat', delete: 'Smazat' }; });
  await openMenu(page, '1');
  await expect(item(page, '[data-action="copy"]')).toHaveText('Kopírovat');
  await expect(item(page, '[data-action="delete"]')).toHaveText('Smazat');
  await expect(item(page, '[data-action="paste"]')).toHaveText('Paste');
});

test('a custom item: before → onClick → onAction → event; the detail carries the node and the context', async ({ page }) => {
  await openMenu(page, '1.1');
  await item(page, '[data-id="rename"]').click();
  await expect.poll(() => log(page)).toEqual(['before:custom', 'onClick:rename:1.1', 'onAction:custom', 'event:custom']);
  const [d] = await details(page);
  expect(d.json).toMatchObject({ action: 'custom', id: 'rename', source: 'context-menu', path: '1.1' });
  expect(d.nodePath).toBe('1.1');
  expect(d.hasController).toBe(true);
  expect(d.elementIsHost).toBe(true);
  expect(d.json).not.toHaveProperty('controller');
  expect(d.composed).toBe(false);
  await expect(menu(page)).toBeHidden(); // a leaf closes the menu
});

test('a built-in runs before the event: collapse — the listener sees the collapsed node', async ({ page }) => {
  await openMenu(page, '1');
  await item(page, '[data-action="collapse"]').click();
  await expect.poll(() => log(page)).toEqual(['before:collapse', 'onAction:collapse', 'event:collapse']);
  const [d] = await details(page);
  expect(d.nodeIsExpanded).toBe(false); // the event fired after the built-in collapsed it
  await expect(node(page, '1.1')).toBeHidden();
});

test('beforeActionCallback returning false cancels the event and the built-in', async ({ page }) => {
  await page.evaluate(() => { (window as any).__vetoBuiltIns = true; });
  await openMenu(page, '1');
  await item(page, '[data-action="collapse"]').click();
  await page.waitForTimeout(50);
  expect(await log(page)).toEqual(['before:collapse']);
  await expect(node(page, '1.1')).toBeVisible();
});

test('copy + paste built-ins act on the node', async ({ page }) => {
  await openMenu(page, '1.2');
  await item(page, '[data-action="copy"]').click();
  await openMenu(page, '2');
  await expect(item(page, '[data-action="paste"]')).not.toHaveClass(/km-menu__item--disabled/);
  await item(page, '[data-action="paste"]').click();
  await expect.poll(() => page.locator('web-treeview').evaluate((el: any) => el.getChildren('2').length)).toBe(1);
});

test('getChildrenCallback loads a submenu lazily with the menu ctx', async ({ page }) => {
  await openMenu(page, '1.1');
  await item(page, '[data-id="more"]').hover();
  const sub = page.locator('.km-menu--submenu');
  await expect(sub.locator('.km-menu__item[data-id="lazy"]')).toHaveText('Lazy 1.1');
});

test('on* twins receive the detail; a checkbox toggle fires checked-change, not node-click', async ({ page }) => {
  await node(page, '2').locator('> .wtv__node-row .wtv__node-content').first().click();
  await expect.poll(() => log(page)).toEqual(['onNodeClick:2:false', 'node-click:2']);
  await page.evaluate(() => { (window as any).__log = []; });
  await node(page, '1.2').locator('.wtv__checkbox').first().click();
  await expect.poll(() => log(page)).toEqual(['checked-change:1.2']);
});

test('el.controller is the public facade (and the one on every detail)', async ({ page }) => {
  const r = await page.locator('web-treeview').evaluate((el: any) => {
    el.controller.collapseAll();
    const afterCollapse = el.controller.expandedPaths.length;
    el.controller.expandAll();
    return {
      afterCollapse,
      afterExpand: el.controller.expandedPaths.length,
      ref: el.controller.getNodeRef('1.1').parent?.path,
      noEngine: typeof el.getController,
    };
  });
  expect(r.afterCollapse).toBe(0);
  expect(r.afterExpand).toBeGreaterThan(0);
  expect(r.ref).toBe('1');
  expect(r.noEngine).toBe('undefined');
});
