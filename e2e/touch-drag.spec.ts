import { test, expect, Page } from '@playwright/test';

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

test('touch drag: styled ghost inside the shadow root, highlight and drop on the target', async ({ page }) => {
  await page.goto(PAGE);
  const host = page.locator('#tree-single');
  await expect(host.locator('.wtv__node').first()).toBeVisible();
  await expect(page.getByTestId('single-drop-count')).toHaveText('0');

  await touchAt(page, 'touchstart', '1.1');
  // The ghost appears after the long-press delay (300ms default).
  const ghost = host.locator('.wtv__touch-ghost');
  await expect(ghost).toHaveCount(1);
  expect(await page.locator('body > .wtv__touch-ghost').count()).toBe(0);
  const style = await ghost.evaluate((g) => {
    const cs = getComputedStyle(g);
    return { position: cs.position, bg: cs.backgroundColor, shadow: cs.boxShadow };
  });
  expect(style.position).toBe('fixed');
  expect(style.bg).not.toBe('rgba(0, 0, 0, 0)');
  expect(style.shadow).not.toBe('none');

  await touchAt(page, 'touchmove', '2');
  await expect(host.locator('.wtv__node[data-tree-path="2"] .wtv__node-content').first())
    .toHaveClass(/wtv__node-content--dragover-highlight/);

  await touchAt(page, 'touchend', '2');
  await expect(page.getByTestId('single-drop-count')).toHaveText('1');
  await expect(page.getByTestId('single-drop-dragged')).toHaveText('Alpha-1');
  await expect(ghost).toHaveCount(0);
});
