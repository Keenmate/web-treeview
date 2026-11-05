import { test, expect, type Page, nodeByPath, nodeContent } from './fixtures';

/**
 * Keyboard navigation scrolls the focused node into view (svelte-treeview's
 * navTo → scroll, with block 'nearest'): /test/keyboard-scroll.html — 200 root
 * rows in a 300px scroll box (#box). Virtual scroll: /test/virtual-scroll.html.
 */

const PAGE = '/test/keyboard-scroll.html';

const focused = (page: Page) => page.locator('.wtv__node[data-focused="true"]').first();
const boxScrollTop = (page: Page): Promise<number> => page.evaluate(() => (window as any).box.scrollTop);

async function load(page: Page, query = '') {
  await page.goto(PAGE + query);
  await expect(nodeByPath(page, '200')).toHaveCount(1);
  await nodeContent(nodeByPath(page, '1')).click();
  await expect(nodeByPath(page, '1')).toHaveAttribute('data-focused', 'true');
}

test('PageDown ×3 keeps the focused node visible', async ({ page }) => {
  await load(page);
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('PageDown');
    await expect(focused(page)).toHaveAttribute('data-tree-path', String(1 + (i + 1) * 10));
    await expect(focused(page)).toBeInViewport();
  }
  expect(await boxScrollTop(page)).toBeGreaterThan(0);
  // block 'nearest': the focused row sits at the bottom edge, not centered
  const { rowBottom, boxBottom } = await page.evaluate(() => {
    const row = (window as any).tree.shadowRoot.querySelector('.wtv__node[data-tree-path="31"] > .wtv__node-row');
    return { rowBottom: row.getBoundingClientRect().bottom, boxBottom: (window as any).box.getBoundingClientRect().bottom };
  });
  expect(Math.abs(boxBottom - rowBottom)).toBeLessThan(4);
});

test('a move within the visible rows does not scroll', async ({ page }) => {
  await load(page);
  await page.keyboard.press('ArrowDown');
  await expect(focused(page)).toHaveAttribute('data-tree-path', '2');
  await page.waitForTimeout(100);
  expect(await boxScrollTop(page)).toBe(0);
});

test('End scrolls to the bottom, Home back to the top', async ({ page }) => {
  await load(page);
  await page.keyboard.press('End');
  await expect(focused(page)).toHaveAttribute('data-tree-path', '200');
  await expect(focused(page)).toBeInViewport();
  await expect.poll(() => page.evaluate(() => {
    const b = (window as any).box;
    return b.scrollHeight - b.clientHeight - b.scrollTop;
  })).toBeLessThan(2);
  await page.keyboard.press('Home');
  await expect(focused(page)).toHaveAttribute('data-tree-path', '1');
  await expect.poll(() => boxScrollTop(page)).toBe(0);
});

test('Shift+End (navSelectLast) scrolls too', async ({ page }) => {
  await load(page);
  await page.evaluate(() => (window as any).tree.setAttribute('selection-mode', 'multiple'));
  await page.keyboard.press('Shift+End');
  await expect(focused(page)).toHaveAttribute('data-tree-path', '200');
  await expect(focused(page)).toBeInViewport();
});

test('a mouse click on a partly hidden row does not scroll', async ({ page }) => {
  await load(page);
  // the row cut by the box's bottom edge — click its visible top part (mouse.click doesn't auto-scroll)
  const point = await page.evaluate(() => {
    const boxRect = (window as any).box.getBoundingClientRect();
    const rows = [...(window as any).tree.shadowRoot.querySelectorAll('.wtv__node > .wtv__node-row .wtv__node-content')] as HTMLElement[];
    const cut = rows.find((r) => { const b = r.getBoundingClientRect(); return b.top < boxRect.bottom - 2 && b.bottom > boxRect.bottom; });
    const b = cut!.getBoundingClientRect();
    return { x: b.left + 10, y: b.top + 2 };
  });
  await page.mouse.click(point.x, point.y);
  await expect(focused(page)).not.toHaveAttribute('data-tree-path', '1');
  await page.waitForTimeout(150);
  expect(await boxScrollTop(page)).toBe(0);
});

test('a navigationOverrides.navTo override controls the scroll (no scroll when it does not)', async ({ page }) => {
  await load(page, '?override=1');
  await page.keyboard.press('PageDown');
  await page.keyboard.press('PageDown');
  await page.keyboard.press('PageDown');
  await expect(focused(page)).toHaveAttribute('data-tree-path', '31');
  await page.waitForTimeout(150);
  expect(await boxScrollTop(page)).toBe(0);
});

test.describe('virtual scroll', () => {
  test('End renders and shows the last row; Home returns to the top', async ({ page }) => {
    await page.goto('/test/virtual-scroll.html?mode=virtual');
    await expect(nodeByPath(page, '1')).toBeVisible();
    await nodeContent(nodeByPath(page, '1')).click();
    await expect(nodeByPath(page, '1')).toHaveAttribute('data-focused', 'true');
    await page.keyboard.press('End');
    await expect(nodeByPath(page, '50.99')).toHaveAttribute('data-focused', 'true');
    await expect(nodeByPath(page, '50.99')).toBeInViewport();
    await page.keyboard.press('Home');
    await expect(nodeByPath(page, '1')).toHaveAttribute('data-focused', 'true');
    await expect(nodeByPath(page, '1')).toBeInViewport();
    expect(await page.locator('.wtv__virtual-scroll').first().evaluate((el) => el.scrollTop)).toBe(0);
  });

  test('PageDown past the viewport keeps the focused row rendered and visible', async ({ page }) => {
    await page.goto('/test/virtual-scroll.html?mode=virtual');
    await expect(nodeByPath(page, '1')).toBeVisible();
    await nodeContent(nodeByPath(page, '1')).click();
    for (let i = 0; i < 4; i++) await page.keyboard.press('PageDown');
    await expect(page.locator('.wtv__node[data-focused="true"]').first()).toBeInViewport();
  });
});

test.describe('keyboard moves always scroll instantly (--wtv-scroll-behavior is for programmatic jumps only)', () => {
  // Rows scroll through core's scrollIntoContainer: the container's scrollTo (container scroll)
  // or window.scrollTo (no container: the page) — record the behavior of either.
  const spy = (page: Page) => page.evaluate(() => {
    const calls: (string | undefined)[] = ((window as any).scrollCalls = []);
    const origScrollTo = Element.prototype.scrollTo;
    Element.prototype.scrollTo = function (this: Element, ...args: any[]) {
      calls.push(typeof args[0] === 'object' ? args[0].behavior : undefined);
      return (origScrollTo as any).apply(this, args);
    };
    const origWindowScrollTo = window.scrollTo;
    window.scrollTo = function (...args: any[]) {
      calls.push(typeof args[0] === 'object' ? args[0].behavior : undefined);
      return (origWindowScrollTo as any).apply(window, args);
    } as typeof window.scrollTo;
  });
  const calls = (page: Page) => page.evaluate(() => (window as any).scrollCalls as (string | undefined)[]);

  test('ArrowDown / PageDown / End / Home / Shift+End scroll with behavior auto despite a smooth token', async ({ page }) => {
    await load(page);
    await page.evaluate(() => {
      (window as any).tree.style.setProperty('--wtv-scroll-behavior', 'smooth');
      (window as any).tree.setAttribute('selection-mode', 'multiple');
    });
    await spy(page);
    for (const key of ['ArrowDown', 'PageDown', 'End', 'Home', 'Shift+End']) {
      await page.keyboard.press(key);
    }
    await expect(focused(page)).toHaveAttribute('data-tree-path', '200');
    // Core's container scroll skips the call when the row is already in view (ArrowDown on a
    // visible row), so not every key scrolls — PageDown / End / Home / Shift+End do.
    await expect.poll(async () => (await calls(page)).length).toBeGreaterThanOrEqual(3);
    expect(new Set(await calls(page))).toEqual(new Set(['auto']));
    // scrollToPath keeps the token
    await page.evaluate(() => (window as any).tree.scrollToPath('100'));
    expect((await calls(page)).at(-1)).toBe('smooth');
  });

  test('holding ArrowDown: every repeat lands the focused row in view synchronously (no animation to lag behind)', async ({ page }) => {
    await load(page);
    // Every scroll of the hold (the box's scrollTo — container scroll) asks for behavior 'auto',
    // and the focused row is in the box right after the call returns. (Headless Chromium doesn't
    // animate smooth scrolls, so the behavior argument is what tells instant from smooth here.)
    await page.evaluate(() => {
      (window as any).tree.style.setProperty('--wtv-scroll-behavior', 'smooth');
      const out: number[] = ((window as any).scrollOut = []);
      const behaviors: (string | undefined)[] = ((window as any).scrollCalls = []);
      const tree = (window as any).tree as HTMLElement;
      const orig = Element.prototype.scrollTo;
      Element.prototype.scrollTo = function (this: Element, ...args: any[]) {
        behaviors.push(typeof args[0] === 'object' ? args[0].behavior : undefined);
        (orig as any).apply(this, args);
        const row = tree.shadowRoot!.querySelector('.wtv__node[data-focused="true"] .wtv__node-content');
        if (!row) return;
        const r = row.getBoundingClientRect();
        const b = (window as any).box.getBoundingClientRect();
        out.push(Math.max(0, r.bottom - b.bottom, b.top - r.top));
      };
    });
    for (let i = 0; i < 25; i++) await page.keyboard.down('ArrowDown'); // repeat = true after the first: a held key
    await page.keyboard.up('ArrowDown');
    await expect(focused(page)).toHaveAttribute('data-tree-path', '26');
    const out: number[] = await page.evaluate(() => (window as any).scrollOut);
    expect(out.length).toBeGreaterThan(10); // the rows past the first screen scrolled
    expect(Math.max(...out)).toBeLessThan(1);
    expect(new Set(await page.evaluate(() => (window as any).scrollCalls))).toEqual(new Set(['auto']));
    expect(await boxScrollTop(page)).toBeGreaterThan(0);
  });
});
