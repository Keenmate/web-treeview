import { test, expect, type Page, nodeByPath, nodeContent } from './fixtures';

/**
 * svelte-treeview parity additions (docs/parity.md). Fixture: test/parity.html
 * (`window.make({ attrs, props, nodes })` builds a fresh tree; `window.__events` logs
 * render-* / container-resize / selection-change).
 *
 * Base data: 1 Alpha (o20, canDrop) ── 1.1 Alpha child (o10), 1.2 Alpha other (o20);
 *            2 Beta (o10, canDrop false); 3 Gamma (o30).
 */

const PAGE = '/test/parity.html';

async function make(page: Page, opts: Record<string, unknown> = {}) {
  await page.goto(PAGE);
  await page.evaluate((o) => (window as any).make(o), opts);
}
const call = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => (window as any).tree[f as string](...(a as unknown[])), [fn, args] as const);
const prop = (page: Page, name: string) => page.evaluate((n) => (window as any).tree[n], name);
const events = (page: Page) => page.evaluate(() => (window as any).__events);
const rows = (page: Page) => page.evaluate(() => (window as any).rowNames());

test.describe('search index default', () => {
  test('shouldUseInternalSearchIndex defaults to true: searchNodes finds without opting in', async ({ page }) => {
    await make(page, { props: { searchValueMember: 'name' } });
    expect(await prop(page, 'shouldUseInternalSearchIndex')).toBe(null); // unset → the engine default (on)
    await expect.poll(async () => ((await call(page, 'searchNodes', 'gamma')) as any[]).length).toBe(1);
  });

  test('searchNodes / filterNodes pass searchOptions through', async ({ page }) => {
    await make(page, { props: { searchValueMember: 'name' } });
    await expect.poll(async () => ((await call(page, 'searchNodes', 'alpha')) as any[]).length).toBe(3);
    expect(((await call(page, 'searchNodes', 'alpha', { limit: 1 })) as any[]).length).toBe(1);
    await call(page, 'filterNodes', 'alpha', { limit: 1 });
    await expect.poll(() => rows(page)).toEqual(['Alpha']);
  });

  test('initializeIndexCallback supplies the index; changing it rebuilds the index', async ({ page }) => {
    await make(page, { attrs: { 'expand-level': '9' }, props: { searchValueMember: 'name' } });
    await page.evaluate(() => {
      const w = window as any;
      w.__factoryCalls = 0;
      w.tree.initializeIndexCallback = () => {
        w.__factoryCalls++;
        return new w.FlexSearch.Index({ tokenize: 'forward' });
      };
    });
    await expect.poll(() => page.evaluate(() => (window as any).__factoryCalls)).toBe(1);
    await expect.poll(async () => ((await call(page, 'searchNodes', 'gam')) as any[]).length).toBe(1);
    // the tree (state included) survives the rebuild
    expect(await rows(page)).toEqual(['Alpha', 'Alpha child', 'Alpha other', 'Beta', 'Gamma']);
  });
});

test.describe('refreshNode / refreshSiblings', () => {
  test('refreshNode re-renders a node whose data object changed in place', async ({ page }) => {
    await make(page);
    await page.evaluate(() => { (window as any).tree.getNodeByPath('3').data.name = 'Gamma renamed'; });
    await call(page, 'refreshNode', '3');
    await expect.poll(() => rows(page)).toContain('Gamma renamed');
  });

  test('refreshSiblings re-sorts one parent after order values changed in place', async ({ page }) => {
    await make(page, { props: { orderMember: 'order' } });
    expect(await rows(page)).toEqual(['Beta', 'Alpha', 'Gamma']);
    await page.evaluate(() => { (window as any).tree.getNodeByPath('3').data.order = 1; });
    await call(page, 'refreshSiblings', '');
    await expect.poll(() => rows(page)).toEqual(['Gamma', 'Beta', 'Alpha']);
    // also on the controller facade
    expect(await page.evaluate(() => typeof (window as any).tree.controller.refreshSiblings)).toBe('function');
  });
});

test.describe('isNodeDropAllowed', () => {
  test('evaluates isDropAllowedMember; false for an unknown path', async ({ page }) => {
    await make(page, { props: { isDropAllowedMember: 'canDrop' } });
    expect(await call(page, 'isNodeDropAllowed', '1')).toBe(true);
    expect(await call(page, 'isNodeDropAllowed', '2')).toBe(false);
    expect(await call(page, 'isNodeDropAllowed', 'nope')).toBe(false);
  });

  test('getIsDropAllowedCallback wins (element + controller)', async ({ page }) => {
    await make(page, { props: { isDropAllowedMember: 'canDrop' } });
    await page.evaluate(() => { (window as any).tree.getIsDropAllowedCallback = ({ node }: any) => node.path === '2'; });
    expect(await call(page, 'isNodeDropAllowed', '2')).toBe(true);
    expect(await page.evaluate(() => (window as any).tree.controller.isNodeDropAllowed('1'))).toBe(false);
  });
});

test.describe('progressive render events', () => {
  test('render-start → render-progress → render-complete; isRendering true only in between', async ({ page }) => {
    await page.goto(PAGE);
    await page.evaluate(() => (window as any).make({ nodes: (window as any).manyNodes(300), attrs: { 'initial-batch-size': '20' } }));
    await expect.poll(async () => (await page.evaluate(() => (window as any).eventNames())).includes('render-complete')).toBe(true);
    const log = ((await events(page)) as any[]).filter((e) => e.name.startsWith('render-'));
    expect(log[0].name).toBe('render-start');
    expect(log[0].isRendering).toBe(true);
    expect(log.some((e) => e.name === 'render-progress')).toBe(true);
    const done = log[log.length - 1];
    expect(done.name).toBe('render-complete');
    expect(done.isRendering).toBe(false);
    expect(done.processed).toBe(300);
    expect(done.hasController).toBe(true);
    expect(await prop(page, 'isRendering')).toBe(false);
    await expect.poll(() => page.evaluate(() => (window as any).tree.shadowRoot.querySelectorAll('.wtv__node').length)).toBe(300);
  });

  test('no render events when the rows fit in the first batch', async ({ page }) => {
    await make(page);
    await page.waitForTimeout(100);
    expect(((await events(page)) as any[]).filter((e) => e.name.startsWith('render-'))).toEqual([]);
  });
});

test.describe('containerSize / container-resize', () => {
  test('measured on build; a resize fires container-resize with the new size', async ({ page }) => {
    await make(page);
    await expect.poll(async () => ((await events(page)) as any[]).some((e) => e.name === 'container-resize')).toBe(true);
    const size = (await prop(page, 'containerSize')) as { width: number; height: number };
    expect(size.width).toBeGreaterThan(0);
    const first = ((await events(page)) as any[]).find((e) => e.name === 'container-resize');
    expect(first.deviceClass).toBeTruthy();
    await page.evaluate(() => { document.getElementById('host')!.style.width = '300px'; });
    await expect.poll(async () => ((await prop(page, 'containerSize')) as any).width).toBeLessThan(size.width);
    const last = ((await events(page)) as any[]).filter((e) => e.name === 'container-resize').pop();
    expect(last.size.width).toBeLessThan(size.width);
  });
});

test.describe('selectionAnchor / toggleFocusedSelect', () => {
  test('selectionAnchor follows a click; setting it re-anchors Shift+click ranges', async ({ page }) => {
    await make(page, { attrs: { 'selection-mode': 'multiple', 'click-behavior': 'select' } });
    await nodeContent(nodeByPath(page, '1')).click();
    expect(await prop(page, 'selectionAnchor')).toBe('1');
    await page.evaluate(() => { (window as any).tree.selectionAnchor = '3'; });
    expect(await page.evaluate(() => (window as any).tree.controller.selectionAnchor)).toBe('3');
    await nodeContent(nodeByPath(page, '2')).click({ modifiers: ['Shift'] });
    expect(((await prop(page, 'selectedPaths')) as string[]).sort()).toEqual(['2', '3']);
  });

  test('toggleFocusedSelect toggles the focused node (multiple mode only)', async ({ page }) => {
    await make(page, { attrs: { 'selection-mode': 'multiple' } });
    await call(page, 'focusNode', '2');
    await call(page, 'toggleFocusedSelect');
    expect(await prop(page, 'selectedPaths')).toEqual(['2']);
    await call(page, 'toggleFocusedSelect');
    expect(await prop(page, 'selectedPaths')).toEqual([]);

    await make(page, { attrs: { 'selection-mode': 'single' } });
    await call(page, 'focusNode', '2');
    await call(page, 'toggleFocusedSelect');
    expect(await prop(page, 'selectedPaths')).toEqual([]);
  });
});

test.describe('auto-handle-move', () => {
  test('attribute ↔ shouldAutoHandleMove (unset = the default, on)', async ({ page }) => {
    await make(page);
    expect(await prop(page, 'shouldAutoHandleMove')).toBe(null);
    await page.evaluate(() => (window as any).tree.setAttribute('auto-handle-move', 'false'));
    expect(await prop(page, 'shouldAutoHandleMove')).toBe(false);
  });
});

test.describe('node-title-overflow', () => {
  const LONG = 'A very long node title that certainly does not fit into the narrow tree container at all';
  const longNodes = [{ id: 1, path: '1', name: LONG }, { id: 2, path: '2', name: 'Short' }];
  const container = (page: Page) => page.locator('#tree').locator('.wtv__container');

  test('default ellipsis; wrap lets the label wrap', async ({ page }) => {
    await make(page, { nodes: longNodes });
    await expect(container(page)).toHaveAttribute('data-node-title-overflow', 'ellipsis');
    const label = nodeByPath(page, '1').locator('.wtv__node-label');
    const oneLine = (await label.boundingBox())!.height;
    await page.evaluate(() => (window as any).tree.setAttribute('node-title-overflow', 'wrap'));
    await expect(container(page)).toHaveAttribute('data-node-title-overflow', 'wrap');
    await page.evaluate(() => { document.getElementById('host')!.style.width = '200px'; });
    await expect.poll(async () => (await label.boundingBox())!.height).toBeGreaterThan(oneLine * 1.5);
  });

  test('info: a clipped label gets an info button that reveals the full label', async ({ page }) => {
    await make(page, { nodes: longNodes, attrs: { 'node-title-overflow': 'info' } });
    const info = nodeByPath(page, '1').locator('.wtv__node-info');
    await expect(info).toHaveCount(1);
    await expect(nodeByPath(page, '2').locator('.wtv__node-info')).toHaveCount(0);
    await expect(nodeByPath(page, '1').locator('.wtv__node-label')).toHaveAttribute('title', LONG);
    await expect(info).toHaveAttribute('aria-label', 'Show full label');

    await info.click();
    const reveal = page.locator('#tree').locator('.wtv__node-info-reveal');
    await expect(reveal).toHaveText(LONG);
    expect(await prop(page, 'selectedPaths')).toEqual([]); // the button is not a node click
    await page.keyboard.press('Escape');
    await expect(reveal).toHaveCount(0);
    // core's overlay tree: clicking the button opens it again, a press outside closes it
    await info.click();
    await expect(reveal).toHaveText(LONG);
    await page.mouse.click(2, 2);
    await expect(reveal).toHaveCount(0);

    // widening the container drops the button
    await page.evaluate(() => { document.getElementById('host')!.style.width = '1400px'; });
    await expect(info).toHaveCount(0);
  });

  test('info: a click on a node checkbox closes the popover (the tree stops that click; core rc20)', async ({ page }) => {
    await make(page, { nodes: longNodes, attrs: { 'node-title-overflow': 'info', 'show-checkboxes': '' } });
    const reveal = page.locator('#tree').locator('.wtv__node-info-reveal');
    await nodeByPath(page, '1').locator('.wtv__node-info').click();
    await expect(reveal).toHaveText(LONG);
    await nodeByPath(page, '2').locator('.wtv__checkbox').click();
    expect(await prop(page, 'checkedPaths')).toEqual(['2']);
    await expect(reveal).toHaveCount(0);
  });

  test('info: a tree-body scroll that moves the row closes the popover (core shouldCloseOnScroll)', async ({ page }) => {
    const many = [...longNodes, ...Array.from({ length: 60 }, (_, i) => ({ id: 100 + i, path: String(100 + i), name: `Row ${i}` }))];
    await make(page, {
      nodes: many,
      attrs: { 'node-title-overflow': 'info', 'enable-virtual-scroll': '', 'virtual-scroll-container-height': '200px' },
    });
    const reveal = page.locator('#tree').locator('.wtv__node-info-reveal');
    await nodeByPath(page, '1').locator('.wtv__node-info').click();
    await expect(reveal).toHaveText(LONG);
    await page.evaluate(() => { (window as any).tree.shadowRoot.querySelector('.wtv__tree').scrollTop = 40; });
    await expect(reveal).toHaveCount(0);
  });

  test('info: a page scroll that moves the row closes the popover', async ({ page }) => {
    await make(page, { nodes: longNodes, attrs: { 'node-title-overflow': 'info' } });
    await page.evaluate(() => { document.body.style.minHeight = '4000px'; });
    const reveal = page.locator('#tree').locator('.wtv__node-info-reveal');
    await nodeByPath(page, '1').locator('.wtv__node-info').click();
    await expect(reveal).toHaveText(LONG);
    await page.evaluate(() => window.scrollBy(0, 60));
    await expect(reveal).toHaveCount(0);
  });

  test('info: a scroll inside the popover does not close it', async ({ page }) => {
    await make(page, { nodes: longNodes, attrs: { 'node-title-overflow': 'info' } });
    const reveal = page.locator('#tree').locator('.wtv__node-info-reveal');
    await nodeByPath(page, '1').locator('.wtv__node-info').click();
    await expect(reveal).toHaveText(LONG);
    // A scrollable popover (a very long label capped by app CSS): scrolling it moves nothing else.
    await page.evaluate(() => {
      const panel = (window as any).tree.shadowRoot.querySelector('.wtv__node-info-reveal') as HTMLElement;
      panel.style.width = '6em';
      panel.style.maxHeight = '2em';
      panel.style.overflowY = 'auto';
    });
    await page.evaluate(() => {
      const panel = (window as any).tree.shadowRoot.querySelector('.wtv__node-info-reveal') as HTMLElement;
      panel.scrollTop = 20;
    });
    await expect.poll(() => page.evaluate(() =>
      ((window as any).tree.shadowRoot.querySelector('.wtv__node-info-reveal') as HTMLElement).scrollTop)).toBeGreaterThan(0);
    await page.waitForTimeout(150);
    await expect(reveal).toHaveText(LONG);
  });
});

test.describe('scrollToPath options', () => {
  test('default: expands the ancestors, no highlight; shouldHighlight flashes the row', async ({ page }) => {
    await make(page);
    expect(await call(page, 'scrollToPath', '1.1')).toBe(true);
    expect(await prop(page, 'expandedPaths')).toEqual(['1']);
    const row = nodeContent(nodeByPath(page, '1.1'));
    await expect(row).not.toHaveClass(/wtv__node-content--scroll-highlight/);
    expect(await call(page, 'scrollToPath', '1.2', { shouldHighlight: true, behavior: 'instant', block: 'nearest' })).toBe(true);
    await expect(nodeContent(nodeByPath(page, '1.2'))).toHaveClass(/wtv__node-content--scroll-highlight/);
  });

  test('shouldExpandAncestors: false leaves a collapsed parent alone (no row → false)', async ({ page }) => {
    await make(page);
    expect(await call(page, 'scrollToPath', '1.1', { shouldExpandAncestors: false })).toBe(false);
    expect(await prop(page, 'expandedPaths')).toEqual([]);
  });
});

test.describe('context menu scroll close', () => {
  test('a tree-body scroll that moves the right-clicked row closes the context menu (core openMenu point reference)', async ({ page }) => {
    await page.goto(PAGE);
    await page.evaluate(async () => {
      const w = window as any;
      await w.make({ nodes: w.manyNodes(80), attrs: { 'enable-virtual-scroll': '', 'virtual-scroll-container-height': '200px' } });
      w.tree.getContextMenuItemsCallback = () => [{ id: 'noop', text: 'Noop', onClick() {} }];
    });
    const menu = page.locator('.km-menu');
    await nodeContent(nodeByPath(page.locator('#tree'), '2')).click({ button: 'right' });
    await expect(menu).toHaveCount(1);
    await page.evaluate(() => { (window as any).tree.shadowRoot.querySelector('.wtv__tree').scrollTop = 40; });
    await expect(menu).toHaveCount(0);
  });
});
