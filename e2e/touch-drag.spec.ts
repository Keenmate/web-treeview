import { test, expect, type Page, CDP_TOUCH_ONLY, touchDrag, centerOf, nodeByPath, nodeContent } from './fixtures';

/**
 * Touch drag inside the shadow root, through core `createPointerDrag` (real touch input via CDP).
 * The ghost, the drop-target lookup and the drag-over highlight must all work against the
 * element's shadow root — a ghost appended to <body> gets none of the tree's CSS, and
 * document.elementFromPoint only ever returns the <web-treeview> host.
 *
 * Fixture: test/drag-drop.html (section-single, tree-single).
 */

const PAGE = '/test/drag-drop.html';

test.use({ hasTouch: true });

test.skip(({ browserName }) => browserName !== 'chromium', CDP_TOUCH_ONLY);

const pill = (page: Page, path: string) => nodeContent(nodeByPath(page.locator('#tree-single'), path));

test('touch drag: styled ghost in a core layer, highlight and drop on the target', async ({ page }) => {
  await page.goto(PAGE);
  const host = page.locator('#tree-single');
  await expect(host.locator('.wtv__node').first()).toBeVisible();
  await expect(page.getByTestId('single-drop-count')).toHaveText('0');

  const from = await centerOf(pill(page, '1.1'));
  const to = await centerOf(pill(page, '2'));
  await touchDrag(page, [{ type: 'touchStart', ...from }]);
  // The ghost appears after the long-press delay (300ms default).
  // A core layer (SPEC §12.29): body > .km-layer, its own shadow root, `pointer-events: none`
  // (the hit test sees through it), so the tree's overflow can't clip it.
  const ghost = page.locator('.km-layer .wtv__touch-ghost');
  await expect(ghost).toHaveCount(1);
  expect(await host.evaluate((h) => !!h.shadowRoot!.querySelector('.wtv__touch-ghost'))).toBe(false);
  const style = await ghost.evaluate((g) => {
    const cs = getComputedStyle(g);
    const layer = (g.getRootNode() as ShadowRoot).host as HTMLElement;
    return {
      isInBody: layer.parentElement === document.body,
      layerPointer: getComputedStyle(layer).pointerEvents,
      layerPosition: getComputedStyle(layer).position,
      bg: cs.backgroundColor,
      shadow: cs.boxShadow,
    };
  });
  expect(style).toMatchObject({ isInBody: true, layerPointer: 'none', layerPosition: 'fixed' });
  expect(style.bg).not.toBe('rgba(0, 0, 0, 0)');
  expect(style.shadow).not.toBe('none');

  await touchDrag(page, [
    { type: 'touchMove', x: from.x, y: from.y + 15, waitMs: 30 },
    { type: 'touchMove', ...to, waitMs: 30 },
  ]);
  await expect(host.locator('.wtv__node[data-tree-path="2"] .wtv__node-content').first())
    .toHaveClass(/wtv__node-content--glow-/);

  await touchDrag(page, [{ type: 'touchEnd' }]);
  await expect(page.getByTestId('single-drop-count')).toHaveText('1');
  await expect(page.getByTestId('single-drop-dragged')).toHaveText('Alpha-1');
  await expect(ghost).toHaveCount(0);
  await expect(page.locator('.km-layer')).toHaveCount(0);
});

test('a finger that moves before the long press scrolls instead: no ghost, no drop', async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.locator('#tree-single .wtv__node').first()).toBeVisible();
  const from = await centerOf(pill(page, '1.1'));
  const to = await centerOf(pill(page, '2'));
  await touchDrag(page, [
    { type: 'touchStart', ...from, waitMs: 50 },
    { type: 'touchMove', x: from.x, y: from.y + 30, waitMs: 30 },
    { type: 'touchMove', ...to, waitMs: 500 },
  ]);
  await expect(page.locator('.wtv__touch-ghost')).toHaveCount(0);
  await touchDrag(page, [{ type: 'touchEnd' }]);
  await expect(page.getByTestId('single-drop-count')).toHaveText('0');
});

test('Escape cancels a touch drag: ghost and highlight gone, no drop', async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.locator('#tree-single .wtv__node').first()).toBeVisible();
  const from = await centerOf(pill(page, '1.1'));
  const to = await centerOf(pill(page, '2'));
  await touchDrag(page, [{ type: 'touchStart', ...from }]);
  await expect(page.locator('.km-layer .wtv__touch-ghost')).toHaveCount(1);
  await touchDrag(page, [{ type: 'touchMove', x: from.x, y: from.y + 15, waitMs: 30 }, { type: 'touchMove', ...to, waitMs: 30 }]);
  await expect(pill(page, '2')).toHaveClass(/wtv__node-content--glow-/);
  await page.keyboard.press('Escape');
  await expect(page.locator('.wtv__touch-ghost')).toHaveCount(0);
  await expect(pill(page, '2')).not.toHaveClass(/wtv__node-content--glow-/);
  await touchDrag(page, [{ type: 'touchEnd' }]);
  await expect(page.getByTestId('single-drop-count')).toHaveText('0');
});

test('touchDragDelay set live re-times the long press', async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.locator('#tree-single .wtv__node').first()).toBeVisible();
  await page.evaluate(() => { (document.getElementById('tree-single') as any).touchDragDelay = 1000; });
  await page.evaluate(() => (document.getElementById('tree-single') as any).whenSettled());
  await touchDrag(page, [{ type: 'touchStart', ...(await centerOf(pill(page, '1.1'))), waitMs: 600 }]);
  await expect(page.locator('.wtv__touch-ghost')).toHaveCount(0);
  await expect(page.locator('.wtv__touch-ghost')).toHaveCount(1, { timeout: 2000 });
  await touchDrag(page, [{ type: 'touchEnd' }]);
});

test('a long press held on a locked node near the bottom edge does not auto-scroll the tree', async ({ page }) => {
  await page.goto(PAGE);
  const host = page.locator('#tree-single');
  await expect(host.locator('.wtv__node').first()).toBeVisible();
  // Lock 1.1 and put the tree in a short scroller, so the locked row sits in core's 40px edge zone.
  await page.evaluate(() => {
    const el = document.getElementById('tree-single') as any;
    el.getIsDraggableCallback = ({ node }: any) => node.path !== '1.1';
    el.parentElement.id = 'single-scroller';
    Object.assign(el.parentElement.style, { height: '70px', overflow: 'auto' });
  });
  await page.evaluate(() => (document.getElementById('tree-single') as any).whenSettled());
  const scroller = page.locator('#single-scroller');
  expect(await scroller.evaluate((s) => s.scrollHeight > s.clientHeight + 20)).toBe(true);
  const box = (await scroller.boundingBox())!;
  const row = await centerOf(pill(page, '1.1'));
  const nearBottom = { x: row.x, y: box.y + box.height - 4 };
  expect(nearBottom.y - row.y).toBeLessThan(40); // a slide within the threshold-free edge zone

  await touchDrag(page, [{ type: 'touchStart', ...row }]);
  await expect(pill(page, '1.1').locator('.wtv__drag-denied-badge')).toHaveCount(1);
  const before = await scroller.evaluate((s) => s.scrollTop);
  await touchDrag(page, [{ type: 'touchMove', ...nearBottom, waitMs: 600 }]);
  expect(await scroller.evaluate((s) => s.scrollTop)).toBe(before);
  await touchDrag(page, [{ type: 'touchEnd' }]);
  await expect(pill(page, '1.1').locator('.wtv__drag-denied-badge')).toHaveCount(0);
  await expect(page.getByTestId('single-drop-count')).toHaveText('0');
});
