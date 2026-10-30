import { devices } from '@playwright/test';
import { test, expect, type Page, nodeByPath } from './fixtures';

/**
 * Core responsive rules (SPEC §6.7) on <web-treeview> (/test/responsive-rules.html).
 *
 *   1 A ── 1.1 A1 ── 1.1.1 A1a
 *   2 B
 *
 * The page sets `window.components['web-treeview'].responsive = { mobile: { expandLevel: 1 } }`.
 * #plain has no expand-level; #explicit has expand-level="2" (instance beats page rules).
 */

const PAGE = '/test/responsive-rules.html';

async function load(page: Page) {
  await page.goto(PAGE);
  await expect(nodeByPath(page.locator('#plain'), '2')).toBeVisible();
  await expect(nodeByPath(page.locator('#explicit'), '2')).toBeVisible();
}

test.describe('responsive rules — phone (touch, short side < 600 → mobile)', () => {
  const { viewport, isMobile, hasTouch, deviceScaleFactor } = devices['Pixel 7'];
  test.use({ viewport, isMobile, hasTouch, deviceScaleFactor });

  test('the per-tag page rule applies, the instance attribute beats it', async ({ page }) => {
    await load(page);
    const plain = page.locator('#plain');
    const explicit = page.locator('#explicit');

    // Page rule → roots expanded (level 1 shown), deeper levels collapsed.
    await expect(nodeByPath(plain, '1.1')).toBeVisible();
    await expect(nodeByPath(plain, '1.1.1')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).plain.expandLevel)).toBe(1);
    // Responsive overrides never reflect.
    await expect(plain).not.toHaveAttribute('expand-level');

    // The attribute written on the instance wins over the page rule.
    await expect(nodeByPath(explicit, '1.1.1')).toBeVisible();
    expect(await page.evaluate(() => (window as any).explicit.expandLevel)).toBe(2);
  });
});

test.describe('responsive rules — desktop', () => {
  test('the mobile rule does not apply (default expandLevel 0)', async ({ page }) => {
    await load(page);
    await expect(nodeByPath(page.locator('#plain'), '1.1')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).plain.expandLevel)).toBe(0);
  });
});
