import { test, expect } from './fixtures';

/**
 * The public engine seam (docs/usage.md "Build your own UI"): `TreeViewEngine` without the element,
 * drawn by a custom `TreeViewRenderer`. User input goes back through engine calls, so the `on*` options
 * fire; the engine's own `translateCallback` beats the page-wide one. An option the engine isn't given has
 * the element's default (C-CA-37 — one source, the input table).
 *
 * Fixture: test/engine-custom-renderer.html — #list (custom renderer), #bare (engine with only `nodes`,
 * built-in renderer), #drawn (built-in renderer + renderNodeCallback + header), #element (<web-treeview>, same
 * nodes, no attributes)
 *   1 Documents ── 1.1 Projects
 *   2 Photos
 */

const PAGE = '/test/engine-custom-renderer.html';

test.beforeEach(async ({ page }) => {
  await page.goto(PAGE);
  await page.waitForFunction(() => (window as any).fixtureReady === true);
});

test('the custom renderer paints the visible rows; a click expands through the engine and fires onNodeExpand', async ({ page }) => {
  const rows = page.locator('#list [role="treeitem"]');
  await expect(rows).toHaveText(['Documents', 'Photos']);
  await rows.first().click();
  await expect(rows).toHaveText(['Documents', 'Projects', 'Photos']);
  await expect(rows.first()).toHaveAttribute('aria-expanded', 'true');
  expect(await page.evaluate(() => (window as any).expanded)).toEqual(['1']);
});

test('engine methods drive the custom renderer (the same API as el.controller)', async ({ page }) => {
  await page.evaluate(() => (window as any).engine.expandAll());
  await expect(page.locator('#list [role="treeitem"]')).toHaveText(['Documents', 'Projects', 'Photos']);
  expect(await page.evaluate(() => (window as any).engine.getPublicController().expandedPaths)).toContain('1');
});

test("the engine's own translateCallback beats the page-wide one; labels beat both", async ({ page }) => {
  const list = page.locator('#list');
  await expect(list).toHaveAttribute('aria-label', 'own');
  await page.evaluate(() => (window as any).engine.setOptions({ translateCallback: null }));
  await page.evaluate(() => (window as any).engine.refreshLabels());
  await expect(list).toHaveAttribute('aria-label', 'page');
  await page.evaluate(() => (window as any).engine.setOptions({ labels: { 'ariaLabels.tree': 'mine' } }));
  await expect(list).toHaveAttribute('aria-label', 'mine');
});

test('refreshIcons() (the page-wide icon hook changed) re-sends renderNodeIcon through the renderer updateConfig', async ({ page }) => {
  const keys = await page.evaluate(() => {
    (window as any).configKeys = [];
    (window as any).engine.refreshIcons();
    return (window as any).configKeys;
  });
  expect(keys).toEqual(['renderNodeIcon']);
});

test("an engine given only nodes renders like the element (the element's defaults: display value shown)", async ({ page }) => {
  const bare = page.locator('#bare .wtv__node-label');
  const element = page.locator('#element .wtv__node-label');
  await expect(element).toHaveText(['Documents', 'Photos']);
  await expect(bare).toHaveText(['Documents', 'Photos']);
  // Same default behaviour, not just the label: a row click (clickBehavior 'expand-and-focus') expands it.
  await page.locator('#bare .wtv__node-content').first().click();
  await page.locator('#element .wtv__node-content').first().click();
  await expect(element).toHaveText(['Documents', 'Projects', 'Photos']);
  await expect(bare).toHaveText(['Documents', 'Projects', 'Photos']);
});

test('setOptions(partial) merges: a standalone setOptions({ isReadonly }) keeps renderNodeCallback + regions (C-CA-39)', async ({ page }) => {
  const custom = page.locator('#drawn .custom-node');
  await expect(custom).toHaveText(['* Documents', '* Photos']);
  await page.evaluate(() => (window as any).drawnEngine.setOptions({ isReadonly: true }));
  await expect(page.locator('#drawn')).toHaveClass(/wtv__container--readonly/);
  await expect(custom).toHaveText(['* Documents', '* Photos']);
  await expect(page.locator('#drawn .custom-header')).toHaveText('Header');
  // A later structural change still draws through the kept callback.
  await page.evaluate(() => (window as any).drawnEngine.expandAll());
  await expect(custom).toHaveText(['* Documents', '* Projects', '* Photos']);
});

test('setOptions(partial) hands the renderer only the keys it carries', async ({ page }) => {
  const keys = await page.evaluate(() => {
    (window as any).configKeys = [];
    (window as any).engine.setOptions({ isReadonly: true });
    return (window as any).configKeys;
  });
  expect(keys).toEqual(['isReadonly']);
});

test("a headless TreeViewState given only data has the element's defaults (id / path / displayValue)", async ({ page }) => {
  const rows = await page.evaluate(() => {
    const state = (window as any).bareState;
    state.expandAll();
    return state.getSnapshot().flatNodesToRender.map((n: any) => [n.path, state.tree.getNodeDisplayValue(n)]);
  });
  expect(rows).toEqual([['1', 'Documents'], ['1.1', 'Projects'], ['2', 'Photos']]);
});

test('a headless TreeViewState takes settings one way: setOptions(partial) merges, getOptions() reads (C-CA-39)', async ({ page }) => {
  const result = await page.evaluate(() => {
    const state = (window as any).bareState;
    const before = { idMember: state.getOptions().idMember, selectionMode: state.getOptions().selectionMode };
    state.setOptions({ selectionMode: 'multiple' });
    state.setOptions({ isCheckboxesShown: true, selectionMode: undefined });   // undefined = unchanged
    const after = state.getOptions();
    return { before, selectionMode: after.selectionMode, isCheckboxesShown: after.isCheckboxesShown,
      idMember: after.idMember, hasData: Array.isArray(after.data), hasUpdateProps: 'updateProps' in state };
  });
  expect(result).toEqual({ before: { idMember: 'id', selectionMode: 'single' }, selectionMode: 'multiple',
    isCheckboxesShown: true, idMember: 'id', hasData: true, hasUpdateProps: false });
});

test('a fresh-but-equal tooltipDelay object is no node-config change (no row rebuild)', async ({ page }) => {
  const emits = await page.evaluate(() => {
    const state = (window as any).bareState;
    let count = 0;
    state.on('config-change', () => count++);
    state.setOptions({ tooltipDelay: { show: 250, hide: 50 } });
    state.setOptions({ tooltipDelay: { show: 250, hide: 50 } });   // equal values, new object
    state.setOptions({ tooltipDelay: { show: 300, hide: 50 } });
    return count;
  });
  expect(emits).toBe(2);
});
