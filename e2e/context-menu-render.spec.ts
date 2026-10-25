import { test, expect, type Page, nodeByPath, nodeContent, logLines } from './fixtures';

/**
 * Context-menu render hooks, programmatic open + offsets, keyboard
 * (/test/context-menu-render.html).
 *
 *   1 Docs ── 1.1 Readme
 *   2 Pics
 *
 * Items: Open (shortcut o), Star (s, custom-rendered), Disabled (d, disabled).
 */

const PAGE = '/test/context-menu-render.html';
const LOG = 'cm-log';

async function load(page: Page, query = '') {
  await page.goto(PAGE + query);
  await expect(nodeByPath(page, '2')).toBeVisible();
}

const menu = (page: Page) => page.locator('.wtv__context-menu');
const open = (page: Page, path: string, x: number, y: number) =>
  page.evaluate(([p, x, y]) => (window as any).tree.openContextMenu(p, x, y), [path, x, y] as const);

test.describe('renderContextMenuItemCallback', () => {
  test('fills the items it wants; the rest render by default', async ({ page }) => {
    await load(page);
    await nodeContent(nodeByPath(page, '1.1')).click({ button: 'right' });
    await expect(menu(page)).toBeVisible();
    await expect(menu(page).locator('.custom-item')).toHaveText('★ Star Readme');
    await expect(menu(page).locator('.wtv__context-menu-item[data-id="open"]')).toContainText('Open');
    await expect(menu(page).locator('.wtv__context-menu-item[data-id="open"] .wtv__context-menu-shortcut')).toHaveText('o');
  });

  test('a custom-rendered item still activates its onClick', async ({ page }) => {
    await load(page);
    await nodeContent(nodeByPath(page, '2')).click({ button: 'right' });
    await menu(page).locator('.custom-item').click();
    await expect.poll(() => logLines(page, LOG)).toEqual(['click:star:2']);
    await expect(menu(page)).toBeHidden();
  });
});

test('renderContextMenuCallback renders the whole menu and can close it via the controller', async ({ page }) => {
  await load(page, '?mode=custom');
  await nodeContent(nodeByPath(page, '1')).click({ button: 'right' });
  await expect(menu(page).locator('.custom-menu')).toContainText('Menu for Docs');
  await expect(menu(page).locator('.wtv__context-menu-item')).toHaveCount(0);
  await menu(page).locator('.custom-close').click();
  await expect.poll(() => logLines(page, LOG)).toEqual(['custom-close:1']);
  await expect(menu(page)).toBeHidden();
});

test.describe('openContextMenu(path, x, y)', () => {
  test('opens for that node at the given viewport point (+ the default 8px x-offset)', async ({ page }) => {
    await load(page);
    await open(page, '2', 200, 150);
    await expect(menu(page)).toBeVisible();
    const box = (await menu(page).boundingBox())!;
    expect(Math.abs(box.x - 208)).toBeLessThan(2);
    expect(Math.abs(box.y - 150)).toBeLessThan(2);
    await menu(page).locator('.wtv__context-menu-item[data-id="open"]').click();
    await expect.poll(() => logLines(page, LOG)).toEqual(['click:open:2']);
  });

  test('context-menu-x/y-offset shift the anchor', async ({ page }) => {
    await load(page, '?context-menu-x-offset=30&context-menu-y-offset=20');
    await open(page, '2', 200, 150);
    await expect(menu(page)).toBeVisible();
    const box = (await menu(page).boundingBox())!;
    expect(Math.abs(box.x - 230)).toBeLessThan(2);
    expect(Math.abs(box.y - 170)).toBeLessThan(2);
  });

  test('closeContextMenu() hides it', async ({ page }) => {
    await load(page);
    await open(page, '1', 100, 100);
    await expect(menu(page)).toBeVisible();
    await page.evaluate(() => (window as any).tree.closeContextMenu());
    await expect(menu(page)).toBeHidden();
  });
});

test.describe('keyboard in the open menu', () => {
  test("an item's shortcut key activates it", async ({ page }) => {
    await load(page);
    await nodeContent(nodeByPath(page, '1.1')).click({ button: 'right' });
    await expect(menu(page)).toBeVisible();
    await page.keyboard.press('s');
    await expect.poll(() => logLines(page, LOG)).toEqual(['click:star:1.1']);
    await expect(menu(page)).toBeHidden();
  });

  test("a disabled item's shortcut does nothing", async ({ page }) => {
    await load(page);
    await nodeContent(nodeByPath(page, '1.1')).click({ button: 'right' });
    await page.keyboard.press('d');
    await page.waitForTimeout(100);
    expect(await logLines(page, LOG)).toEqual([]);
    await expect(menu(page)).toBeVisible();
  });

  test('Escape closes the menu', async ({ page }) => {
    await load(page);
    await nodeContent(nodeByPath(page, '1.1')).click({ button: 'right' });
    await expect(menu(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu(page)).toBeHidden();
  });
});
