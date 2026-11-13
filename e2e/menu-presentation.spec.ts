import { test, expect, nodeContent, nodeByPath } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * Core /menu host inputs (SPEC §12.13): `menu-presentation` / `menu-side` reach the context
 * menu's core `openMenu()`, and the tree's `labels.back` / `labels.close` name the sheet's
 * back row and close button. Fixture: /test/menu-presentation.html (drawer, end side, Czech labels).
 */
const PAGE = '/test/menu-presentation.html';

async function openMenuOn(page: Page, path: string) {
  const content = nodeContent(nodeByPath(page.locator('#tree'), path));
  await expect(content).toBeVisible();
  await content.click({ button: 'right' });
}

test.describe('context menu presentation (menu-presentation / menu-side)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE);
    await expect(nodeByPath(page.locator('#tree'), '1.1')).toBeVisible();
  });

  test('menu-presentation="drawer" menu-side="end" opens an end-side drawer named by labels', async ({ page }) => {
    await openMenuOn(page, '1.1');
    const sheet = page.locator('.km-menu-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveClass(/km-menu-sheet--drawer/);
    await expect(sheet).toHaveClass(/km-menu-sheet--right/); // end in LTR
    await expect(sheet.locator('.km-sheet-title')).toHaveText('Notes.txt');
    const close = sheet.locator('.km-sheet-close');
    await expect(close).toHaveAttribute('aria-label', 'Zavřít');

    // Drill into a submenu: the back row speaks labels.back.
    await sheet.locator('.km-menu__item', { hasText: 'More' }).click();
    await expect(sheet.locator('.km-menu__item--back')).toHaveText('Zpět');

    await close.click();
    await expect(sheet).toHaveCount(0);
  });

  test('the attribute is read at open: menu-presentation="floating" → no sheet; menu-side="start" → left drawer', async ({ page }) => {
    const tree = page.locator('#tree');
    await tree.evaluate((el) => el.setAttribute('menu-presentation', 'floating'));
    await openMenuOn(page, '1');
    await expect(page.locator('.km-menu').first()).toBeVisible();
    await expect(page.locator('.km-menu-sheet')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('.km-menu')).toHaveCount(0);

    await tree.evaluate((el: any) => { el.menuPresentation = 'drawer'; el.menuSide = 'start'; });
    await openMenuOn(page, '1');
    await expect(page.locator('.km-menu-sheet')).toHaveClass(/km-menu-sheet--left/);
  });

  test('defaults: the English Back / Close labels', async ({ page }) => {
    const tree = page.locator('#tree');
    await tree.evaluate((el: any) => { el.removeAttribute('labels'); el.menuPresentation = 'sheet'; });
    await openMenuOn(page, '1.1');
    const sheet = page.locator('.km-menu-sheet');
    await expect(sheet).not.toHaveClass(/km-menu-sheet--drawer/);
    await expect(sheet.locator('.km-sheet-close')).toHaveAttribute('aria-label', 'Close');
    await sheet.locator('.km-menu__item', { hasText: 'More' }).click();
    await expect(sheet.locator('.km-menu__item--back')).toHaveText('Back');
  });
});
