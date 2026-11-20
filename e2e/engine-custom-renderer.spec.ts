import { test, expect } from './fixtures';

/**
 * The public engine seam (docs/usage.md "Build your own UI"): `TreeViewEngine` without the element,
 * drawn by a custom `TreeViewRenderer`. User input goes back through engine calls, so the `on*` options
 * fire; the engine's own `translateCallback` beats the page-wide one. An option the engine isn't given has
 * the element's default (C-CA-37 — one source, the input table).
 *
 * Fixture: test/engine-custom-renderer.html — #list (custom renderer), #bare (engine with only `nodes`,
 * built-in renderer), #element (<web-treeview>, same nodes, no attributes)
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
  await page.evaluate(() => (window as any).engine.update({ translateCallback: null }));
  await page.evaluate(() => (window as any).engine.refreshLabels());
  await expect(list).toHaveAttribute('aria-label', 'page');
  await page.evaluate(() => (window as any).engine.update({ labels: { 'ariaLabels.tree': 'mine' } }));
  await expect(list).toHaveAttribute('aria-label', 'mine');
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

test("a headless TreeViewState given only data has the element's defaults (id / path / displayValue)", async ({ page }) => {
  const rows = await page.evaluate(() => {
    const state = (window as any).bareState;
    state.expandAll();
    return state.getSnapshot().flatNodesToRender.map((n: any) => [n.path, state.tree.getNodeDisplayValue(n)]);
  });
  expect(rows).toEqual([['1', 'Documents'], ['1.1', 'Projects'], ['2', 'Photos']]);
});
