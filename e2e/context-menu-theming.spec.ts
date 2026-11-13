import { test, expect, Page, nodeByPath, nodeContent } from './fixtures';

/**
 * The context menu's CSS-variable chain (core SPEC §12.13):
 *   --wtv-context-menu-* (this tree) → --km-menu-* (every menu on the page) → --base-* → core default.
 * The tree maps --wtv-context-menu-X onto core's private --_km-menu-X with no fallback, so
 * an unset tree variable falls through to a page-level --km-menu-X on :root.
 * Fixture: /test/context-menu.html (no base-css-variables theme loaded).
 */

const PAGE = '/test/context-menu.html';
const menu = (page: Page) => page.locator('.km-menu').first();
const tree = (page: Page) => page.locator('#tree-1');

async function openMenu(page: Page) {
  const content = nodeContent(nodeByPath(tree(page), '1'));
  await expect(content).toBeVisible();
  await content.click({ button: 'right' });
  await expect(menu(page)).toBeVisible();
}

const setRoot = (page: Page, name: string, value: string) =>
  page.evaluate(([n, v]) => document.documentElement.style.setProperty(n!, v!), [name, value]);
const setTree = (page: Page, name: string, value: string) =>
  tree(page).evaluate((el, [n, v]) => (el as HTMLElement).style.setProperty(n!, v!), [name, value]);

test.describe('context menu — CSS variable chain', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE);
    await expect(page.locator('.wtv__node').first()).toBeVisible();
  });

  test('a page-level --km-menu-bg on :root themes the menu when --wtv-context-menu-bg is unset', async ({ page }) => {
    await setRoot(page, '--km-menu-bg', 'rgb(10, 20, 30)');
    await setRoot(page, '--km-menu-item-padding', '9px 21px');
    await openMenu(page);
    await expect(menu(page)).toHaveCSS('background-color', 'rgb(10, 20, 30)');
    await expect(menu(page).locator('.km-menu__item').first()).toHaveCSS('padding', '9px 21px');
  });

  test('--wtv-context-menu-bg on the tree wins over the page-level --km-menu-bg', async ({ page }) => {
    await setRoot(page, '--km-menu-bg', 'rgb(10, 20, 30)');
    await setTree(page, '--wtv-context-menu-bg', 'rgb(1, 2, 3)');
    await openMenu(page);
    await expect(menu(page)).toHaveCSS('background-color', 'rgb(1, 2, 3)');
  });

  test('neither set → --base-dropdown-bg, then the core default', async ({ page }) => {
    await openMenu(page);
    await expect(menu(page)).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await page.keyboard.press('Escape');
    await expect(menu(page)).toBeHidden();
    await setRoot(page, '--base-dropdown-bg', 'rgb(4, 5, 6)');
    await openMenu(page);
    await expect(menu(page)).toHaveCSS('background-color', 'rgb(4, 5, 6)');
  });

  test('--wtv-context-menu-text-color-hover colours the hovered item text (unset → unchanged)', async ({ page }) => {
    const plain = (p: Page) =>
      menu(p).locator('.km-menu__item:not(.km-menu__item--disabled):not(.km-menu__item--danger):not(.km-menu__item--toggled)').first();
    await openMenu(page);
    const before = await plain(page).evaluate((el) => getComputedStyle(el).color);
    await plain(page).hover();
    await expect(plain(page)).toHaveCSS('color', before);
    await page.keyboard.press('Escape');
    await expect(menu(page)).toBeHidden();
    await setTree(page, '--wtv-context-menu-text-color-hover', 'rgb(200, 0, 100)');
    await openMenu(page);
    await plain(page).hover();
    await expect(plain(page)).toHaveCSS('color', 'rgb(200, 0, 100)');
  });
  test('z-index: core 9001 (--base-z-tooltip + 1) by default; page --km-menu-z-index reaches the tree; --wtv-context-menu-z-index wins', async ({ page }) => {
    await openMenu(page);
    await expect(menu(page)).toHaveCSS('z-index', '9001');
    await page.keyboard.press('Escape');
    await expect(menu(page)).toBeHidden();
    await setRoot(page, '--km-menu-z-index', '12345');
    await openMenu(page);
    await expect(menu(page)).toHaveCSS('z-index', '12345');
    await page.keyboard.press('Escape');
    await expect(menu(page)).toBeHidden();
    await setTree(page, '--wtv-context-menu-z-index', '777');
    await openMenu(page);
    await expect(menu(page)).toHaveCSS('z-index', '777');
  });
});
