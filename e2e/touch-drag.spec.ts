import { test, expect, Page, WEBKIT_NO_TOUCH_CTOR } from './fixtures';

/**
 * Touch drag inside the shadow root. The ghost, the drop-target lookup and the
 * drag-over highlight must all work against the element's shadow root — a ghost
 * appended to <body> gets none of the tree's CSS, and document.elementFromPoint
 * only ever returns the <web-treeview> host.
 *
 * Fixture: test/drag-drop.html (section-single, tree-single).
 */

const PAGE = '/test/drag-drop.html';

test.use({ hasTouch: true });

test.skip(({ browserName }) => browserName === 'webkit', WEBKIT_NO_TOUCH_CTOR);

/** Dispatch a single-finger touch event at the centre of a node's content pill. */
async function touchAt(page: Page, type: 'touchstart' | 'touchmove' | 'touchend', path: string, dx = 0.5) {
  await page.evaluate(({ type, path, dx }) => {
    const host = document.getElementById('tree-single')!;
    const el = host.shadowRoot!.querySelector(`.wtv__node[data-tree-path="${path}"] .wtv__node-content`) as HTMLElement;
    const r = el.getBoundingClientRect();
    const t = new Touch({ identifier: 1, target: el, clientX: r.left + r.width * dx, clientY: r.top + r.height / 2 });
    const live = type === 'touchend' ? [] : [t];
    el.dispatchEvent(new TouchEvent(type, { touches: live, targetTouches: live, changedTouches: [t], bubbles: true, cancelable: true, composed: true }));
  }, { type, path, dx });
}

test('touch drag: styled ghost in a core layer, highlight and drop on the target', async ({ page }) => {
  await page.goto(PAGE);
  const host = page.locator('#tree-single');
  await expect(host.locator('.wtv__node').first()).toBeVisible();
  await expect(page.getByTestId('single-drop-count')).toHaveText('0');

  await touchAt(page, 'touchstart', '1.1');
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

  await touchAt(page, 'touchmove', '2');
  await expect(host.locator('.wtv__node[data-tree-path="2"] .wtv__node-content').first())
    .toHaveClass(/wtv__node-content--dragover-highlight/);

  await touchAt(page, 'touchend', '2');
  await expect(page.getByTestId('single-drop-count')).toHaveText('1');
  await expect(page.getByTestId('single-drop-dragged')).toHaveText('Alpha-1');
  await expect(ghost).toHaveCount(0);
  await expect(page.locator('.km-layer')).toHaveCount(0);
});
