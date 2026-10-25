import { test, expect, type Page, nodeByPath, nodeContent } from './fixtures';

/**
 * Programmatic navigation (nav*) + scroll highlight (/test/nav-api.html).
 *
 *   1 A ── 1.1 A1, 1.2 A2      (expand-level=1 → level 2 visible…
 *   2 B ── 2.1 B1               … B is expanded too)
 *   3 C
 */

const PAGE = '/test/nav-api.html';

async function load(page: Page, query = '') {
  await page.goto(PAGE + query);
  await expect(nodeByPath(page, '3')).toBeVisible();
}

const state = (page: Page): Promise<{ focused: string | null; selected: string[]; rows: string[] }> =>
  page.evaluate(() => (window as any).state());
const nav = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([fn, args]) => (window as any).tree[fn as string](...(args as unknown[])), [fn, args] as const);

test('navTo focuses and selects the node', async ({ page }) => {
  await load(page);
  await nav(page, 'navTo', '2.1');
  expect(await state(page)).toMatchObject({ focused: '2.1', selected: ['2.1'] });
  await expect(nodeContent(nodeByPath(page, '2.1'))).toHaveClass(/wtv__node-content--focused/);
});

test('navNext / navPrev walk the visible rows (starting from the first / last)', async ({ page }) => {
  await load(page);
  await nav(page, 'navNext');
  expect((await state(page)).focused).toBe('1');
  await nav(page, 'navNext');
  expect((await state(page)).focused).toBe('1.1');
  await nav(page, 'navPrev');
  expect((await state(page)).focused).toBe('1');
  await nav(page, 'navPrev'); // already first → stays
  expect((await state(page)).focused).toBe('1');
});

test('navPrev with nothing focused starts at the last visible row', async ({ page }) => {
  await load(page);
  await nav(page, 'navPrev');
  expect((await state(page)).focused).toBe('3');
});

test('navFirst / navLast jump to the ends', async ({ page }) => {
  await load(page);
  await nav(page, 'navTo', '2');
  await nav(page, 'navLast');
  expect((await state(page)).focused).toBe('3');
  await nav(page, 'navFirst');
  expect((await state(page)).focused).toBe('1');
});

test('navToggle collapses / expands the focused branch; navInto expands and enters', async ({ page }) => {
  await load(page);
  await nav(page, 'navTo', '1');
  await nav(page, 'navToggle');
  await expect(nodeByPath(page, '1.1')).toHaveCount(0);
  await nav(page, 'navInto');
  await expect(nodeByPath(page, '1.1')).toBeVisible();
  expect((await state(page)).focused).toBe('1.1');
});

test('navOut goes to the parent; navNextSibling / navPrevSibling stay on the level', async ({ page }) => {
  await load(page);
  await nav(page, 'navTo', '1.2');
  await nav(page, 'navOut');
  expect((await state(page)).focused).toBe('1');
  await nav(page, 'navNextSibling');
  expect((await state(page)).focused).toBe('2');
  await nav(page, 'navPrevSibling');
  expect((await state(page)).focused).toBe('1');
});

test.describe('scroll highlight', () => {
  test('scrollToPath adds the default highlight class, removed after the timeout', async ({ page }) => {
    await load(page, '?scroll-highlight-timeout=300');
    await nav(page, 'scrollToPath', '2.1');
    const c = nodeContent(nodeByPath(page, '2.1'));
    await expect(c).toHaveClass(/wtv__node-content--scroll-highlight/);
    await expect(c).not.toHaveClass(/wtv__node-content--scroll-highlight/, { timeout: 2000 });
  });

  test('scroll-highlight-class replaces the class', async ({ page }) => {
    await load(page, '?scroll-highlight-class=zap&scroll-highlight-timeout=5000');
    await nav(page, 'scrollToPath', '1.2');
    const c = nodeContent(nodeByPath(page, '1.2'));
    await expect(c).toHaveClass(/\bzap\b/);
    await expect(c).not.toHaveClass(/wtv__node-content--scroll-highlight/);
  });

  test('a second scrollToPath moves the highlight', async ({ page }) => {
    await load(page);
    await nav(page, 'scrollToPath', '1.1');
    await nav(page, 'scrollToPath', '3');
    await expect(nodeContent(nodeByPath(page, '3'))).toHaveClass(/wtv__node-content--scroll-highlight/);
    await expect(nodeContent(nodeByPath(page, '1.1'))).not.toHaveClass(/wtv__node-content--scroll-highlight/);
  });
});
