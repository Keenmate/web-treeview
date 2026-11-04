import { test, expect, type Page, nodeByPath, nodeContent, logLines } from './fixtures';

/**
 * Drag visuals, reject feedback and the tree drop zone (/test/drag-visuals.html).
 *
 *   1 Alpha ── 1.1 Alpha-1
 *   2 NoDrop  (is-drop-allowed=false)
 *   3 Locked  (is-draggable=false)
 *   4 Delta
 *
 * Attributes are passed in the query string. HTML5 drags are synthesized step by
 * step (window.drag.start/over/drop/end) so classes can be asserted mid-drag.
 */

const PAGE = '/test/drag-visuals.html';
const LOG = 'dv-log';

async function load(page: Page, query = '') {
  await page.goto(PAGE + query);
  await expect(nodeByPath(page, '4')).toBeVisible();
}

const step = (page: Page, fn: 'start' | 'over' | 'drop' | 'end', path?: string, fx?: number) =>
  page.evaluate(([fn, path, fx]) => (window as any).drag[fn as string](path, fx), [fn, path, fx] as const);
const content = (page: Page, path: string) => nodeContent(nodeByPath(page, path));

test.describe('drag classes', () => {
  test('the dragged row gets .wtv__node-content--dragged until the drag ends', async ({ page }) => {
    await load(page);
    await step(page, 'start', '4');
    await expect(content(page, '4')).toHaveClass(/wtv__node-content--dragged/);
    await step(page, 'end');
    await expect(content(page, '4')).not.toHaveClass(/wtv__node-content--dragged/);
  });

  test('dragged-node-class replaces the built-in dragged modifier', async ({ page }) => {
    await load(page, '?dragged-node-class=ghosty');
    await step(page, 'start', '4');
    await expect(content(page, '4')).toHaveClass(/\bghosty\b/);
    await expect(content(page, '4')).not.toHaveClass(/wtv__node-content--dragged/);
    await step(page, 'end');
  });

  test('drop-zone-mode="glow": the hovered target glows for the resolved position', async ({ page }) => {
    await load(page, '?drop-zone-mode=glow');
    await step(page, 'start', '4');
    await step(page, 'over', '1', 0.8);
    await expect(content(page, '1')).toHaveClass(/wtv__node-content--glow-child/);
    await step(page, 'end');
    await expect(content(page, '1')).not.toHaveClass(/wtv__node-content--glow-/);
  });

  test('drop-zone-mode="floating": zones for each allowed position appear over the hovered row', async ({ page }) => {
    await load(page, '?drop-zone-mode=floating&drop-zone-layout=before&drop-zone-start=40&drop-zone-max-width=90');
    await step(page, 'start', '4');
    await step(page, 'over', '1', 0.8);
    const zones = page.locator('.wtv__drop-zones');
    await expect(zones).toHaveCount(1);
    await expect(zones).toHaveClass(/wtv__drop-zones--before/);
    await expect(zones).toHaveAttribute('data-tree-path', '1');
    expect(await zones.locator('.wtv__drop-zone').evaluateAll((z) => z.map((e) => e.getAttribute('data-drop-position')))).toEqual(['before', 'after', 'child']);
    const vars = await zones.evaluate((el) => ({ start: el.style.getPropertyValue('--drop-zone-start'), max: el.style.getPropertyValue('--drop-zone-max-width') }));
    expect(vars).toEqual({ start: '40%', max: '90px' });
    await step(page, 'end');
    await expect(zones).toHaveCount(0);
  });

  test('drop-zone-max-width is a CSS length (toCssLength): "8rem" passes through as-is', async ({ page }) => {
    await load(page, '?drop-zone-mode=floating&drop-zone-max-width=8rem');
    expect(await page.evaluate(() => (document.querySelector('web-treeview') as any).dropZoneMaxWidth)).toBe('8rem');
    await step(page, 'start', '4');
    await step(page, 'over', '1', 0.8);
    const zones = page.locator('.wtv__drop-zones');
    await expect(zones).toHaveCount(1);
    expect(await zones.evaluate((el) => el.style.getPropertyValue('--drop-zone-max-width'))).toBe('8rem');
    await step(page, 'end');
  });
});

test.describe('drop reject (desktop, real drag)', () => {
  /** Real Playwright drag onto the right half (child) of the target row. */
  async function realDrag(page: Page, from: string, to: string) {
    const box = (await content(page, to).boundingBox())!;
    await content(page, from).dragTo(content(page, to), { targetPosition: { x: box.width * 0.8, y: box.height / 2 } });
  }

  test('dropping on a no-drop node is refused: no move, no node-drop', async ({ page }) => {
    await load(page);
    await realDrag(page, '4', '2');
    await page.waitForTimeout(200);
    expect((await logLines(page, LOG)).some((l) => l.startsWith('node-drop:'))).toBe(false);
    await expect(nodeByPath(page, '4')).toBeVisible();
  });

  test('… and announces it: node-drop-reject + the 🚫 flash on the target', async ({ page }) => {
    await load(page);
    await realDrag(page, '4', '2');
    await expect.poll(() => logLines(page, LOG), { timeout: 2000 }).toContain('node-drop-reject:2');
    await expect(content(page, '2').locator('.wtv__drag-denied-badge')).toHaveCount(1);
  });

  test('enable-tree-drop-zone: a drop on a refusing node lands on the tree (target=null)', async ({ page }) => {
    await load(page, '?enable-tree-drop-zone=true');
    await realDrag(page, '4', '2');
    await expect.poll(() => logLines(page, LOG), { timeout: 2000 }).toContainEqual(expect.stringMatching(/^node-drop:4:.*:null$/));
    expect(await logLines(page, LOG)).not.toContainEqual(expect.stringMatching(/^node-drop-reject/));
  });
});

test.describe('drop cursor over a refusing node (NOTES #22)', () => {
  test('the dragover is refused: dropEffect "none" (🚫 cursor), no hover indicators', async ({ page }) => {
    await load(page, '?drop-zone-mode=glow');
    await step(page, 'start', '4');
    expect(await step(page, 'over', '1', 0.8)).toEqual({ accepted: true, dropEffect: 'move' });
    await expect(content(page, '1')).toHaveClass(/wtv__node-content--glow-child/);
    expect(await step(page, 'over', '2', 0.8)).toEqual({ accepted: false, dropEffect: 'none' });
    await expect(content(page, '2')).not.toHaveClass(/wtv__node-content--glow-/);
    await expect(content(page, '1')).not.toHaveClass(/wtv__node-content--glow-/); // the previous hover cleared
    expect(await logLines(page, LOG)).toEqual([]); // nothing announced mid-drag
    await step(page, 'end');
  });

  test('node-drop-reject + 🚫 fire from dragend on the last refusing node', async ({ page }) => {
    await load(page);
    await step(page, 'start', '4');
    await step(page, 'over', '2');
    await step(page, 'end');
    expect(await logLines(page, LOG)).toEqual(['node-drop-reject:2']);
    await expect(content(page, '2').locator('.wtv__drag-denied-badge')).toHaveCount(1);
  });

  test('moving on to an accepting node and dropping there: a normal drop, no reject', async ({ page }) => {
    await load(page);
    await step(page, 'start', '4');
    await step(page, 'over', '2');
    await step(page, 'over', '1');
    await step(page, 'drop', '1');
    await step(page, 'end');
    await expect.poll(() => logLines(page, LOG)).toEqual(['node-drop:1.4:child:1']);
  });

  test('enable-tree-drop-zone: the dragover on a refusing node is accepted (routed to the tree)', async ({ page }) => {
    await load(page, '?enable-tree-drop-zone=true');
    await step(page, 'start', '4');
    expect((await step(page, 'over', '2')).accepted).toBe(true);
    await step(page, 'end');
    expect(await logLines(page, LOG)).toEqual([]);
  });
});

test.describe('touch: drag reject + touch-drag-delay', () => {
  test.use({ hasTouch: true });

  async function touch(page: Page, type: 'touchstart' | 'touchend', path: string) {
    await page.evaluate(({ type, path }) => {
      const host = document.getElementById('tree')!;
      const el = host.shadowRoot!.querySelector(`.wtv__node[data-tree-path="${path}"] .wtv__node-content`) as HTMLElement;
      const r = el.getBoundingClientRect();
      const t = new Touch({ identifier: 1, target: el, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
      const live = type === 'touchend' ? [] : [t];
      el.dispatchEvent(new TouchEvent(type, { touches: live, targetTouches: live, changedTouches: [t], bubbles: true, cancelable: true, composed: true }));
    }, { type, path });
  }

  test('long-pressing a locked node fires node-drag-reject and holds the 🚫 badge until release', async ({ page }) => {
    await load(page);
    await touch(page, 'touchstart', '3');
    await expect.poll(() => logLines(page, LOG)).toContain('node-drag-reject:3');
    await expect(content(page, '3').locator('.wtv__drag-denied-badge')).toHaveCount(1);
    await touch(page, 'touchend', '3');
    await expect(content(page, '3').locator('.wtv__drag-denied-badge')).toHaveCount(0);
  });

  test('indicate-undraggable="false": node-drag-reject still fires, no badge', async ({ page }) => {
    await load(page, '?indicate-undraggable=false');
    await touch(page, 'touchstart', '3');
    await expect.poll(() => logLines(page, LOG)).toContain('node-drag-reject:3');
    await expect(content(page, '3').locator('.wtv__drag-denied-badge')).toHaveCount(0);
    await expect(content(page, '3')).not.toHaveClass(/wtv__node-content--drag-denied/);
    await touch(page, 'touchend', '3');
  });

  test('touch-drag-delay sets the long-press hold before the ghost appears', async ({ page }) => {
    await load(page, '?touch-drag-delay=900');
    await touch(page, 'touchstart', '4');
    await page.waitForTimeout(500);
    await expect(page.locator('.wtv__touch-ghost')).toHaveCount(0);
    await expect(page.locator('.wtv__touch-ghost')).toHaveCount(1, { timeout: 2000 });
    await touch(page, 'touchend', '4');
  });
});
