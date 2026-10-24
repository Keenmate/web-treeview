import { test, expect, Page, Locator, nodeContent, escapeRe, nodeByPath } from './fixtures';

/**
 * E2E coverage for /test/context-menu.html. Single tree with the callback API.
 * The Svelte build also covers a snippet-based approach — that doesn't apply
 * here (web-treeview is callback-only) and isn't ported.
 *
 * Sample data (alphabetically sorted by name):
 *   '1'     Documents     (folder)
 *   '1.1'   Reports       (folder)
 *   '1.1.1' Q1 Report.pdf (file)
 *   '1.1.2' Q2 Report.pdf (file, readonly)
 *   '1.2'   Notes.txt     (file)
 *   '2'     Images        (folder)
 *   '2.1'   Photo.jpg     (file)
 *   '2.2'   Logo.png      (file)
 *
 * Callback rules:
 *   - folders get a "New File" / "New Folder" pair + divider on top
 *   - "Paste" is disabled on non-folders
 *   - "Cut" / "Rename" / "Delete" are disabled on readonly items
 *   - "Read-only file" entry only appears on readonly items
 */

const PAGE = '/test/context-menu.html';

function callbackCard(page: Page): Locator {
  return page.locator('.card').filter({ has: page.locator('h2', { hasText: 'Callback Approach' }) }).first();
}

function treeIn(card: Locator): Locator {
  return card.locator('.tree-container').first();
}

function nodeIn(card: Locator, path: string): Locator {
  return nodeByPath(treeIn(card), path);
}

function menuIn(card: Locator): Locator {
  // The menu is appended inside the web-component's shadow root — Playwright
  // pierces it but the menu element is NOT a descendant of the card. Use a
  // page-level locator instead.
  return card.page().locator('.wtv__context-menu').first();
}

function menuItem(card: Locator, label: string): Locator {
  return menuIn(card)
    .locator('> .wtv__context-menu-item')
    .filter({ has: card.page().locator('.wtv__context-menu-label', { hasText: new RegExp(`^${escapeRe(label)}$`) }) })
    .first();
}

function activityLog(card: Locator): Locator {
  return card.locator('.output pre').first();
}

async function rightClick(card: Locator, path: string) {
  const content = nodeContent(nodeIn(card, path));
  await expect(content).toBeVisible();
  await content.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await content.page().waitForTimeout(50);
  await content.click({ button: 'right' });
  await expect(menuIn(card)).toBeVisible();
}

async function gotoContextMenu(page: Page) {
  await page.goto(PAGE);
  await expect(page.locator('.wtv__node').first()).toBeVisible();
}

// ── Callback approach ──────────────────────────────────────────────────────

test.describe('Callback approach', () => {
  test('right-click on a folder shows the folder-specific entries and named divider', async ({ page }) => {
    await gotoContextMenu(page);
    const card = callbackCard(page);

    await rightClick(card, '1'); // Documents (folder)

    await expect(menuItem(card, 'New File')).toBeVisible();
    await expect(menuItem(card, 'New Folder')).toBeVisible();
    await expect(menuItem(card, 'Copy')).toBeVisible();
    await expect(menuItem(card, 'Cut')).toBeVisible();
    await expect(menuItem(card, 'Paste')).toBeVisible();
    await expect(menuItem(card, 'Export As...')).toBeVisible();
    await expect(menuItem(card, 'Rename')).toBeVisible();
    await expect(menuItem(card, 'Delete')).toBeVisible();
    await expect(menuIn(card).locator('.wtv__context-menu-divider--named')).toHaveText('Danger zone');
    await expect(menuIn(card).locator('.wtv__context-menu-label', { hasText: 'Read-only file' })).toHaveCount(0);
  });

  test('right-click on a file hides folder-only entries and disables Paste', async ({ page }) => {
    await gotoContextMenu(page);
    const card = callbackCard(page);

    await rightClick(card, '1.2'); // Notes.txt (file, writable)

    await expect(menuIn(card).locator('.wtv__context-menu-label', { hasText: 'New File' })).toHaveCount(0);
    await expect(menuIn(card).locator('.wtv__context-menu-label', { hasText: 'New Folder' })).toHaveCount(0);

    await expect(menuItem(card, 'Paste')).toHaveClass(/wtv__context-menu-item--disabled/);
    await expect(menuItem(card, 'Cut')).not.toHaveClass(/wtv__context-menu-item--disabled/);
    await expect(menuItem(card, 'Rename')).not.toHaveClass(/wtv__context-menu-item--disabled/);
    await expect(menuItem(card, 'Delete')).not.toHaveClass(/wtv__context-menu-item--disabled/);
  });

  test('readonly file disables Cut/Rename/Delete and surfaces the "Read-only file" entry', async ({ page }) => {
    await gotoContextMenu(page);
    const card = callbackCard(page);

    await rightClick(card, '1.1.2'); // Q2 Report.pdf (readonly)

    await expect(menuItem(card, 'Cut')).toHaveClass(/wtv__context-menu-item--disabled/);
    await expect(menuItem(card, 'Rename')).toHaveClass(/wtv__context-menu-item--disabled/);
    await expect(menuItem(card, 'Delete')).toHaveClass(/wtv__context-menu-item--disabled/);

    await expect(menuIn(card).locator('.wtv__context-menu-label', { hasText: 'Read-only file' })).toBeVisible();
  });

  test('clicking an item fires the callback, closes the menu, and appends to the activity log', async ({ page }) => {
    await gotoContextMenu(page);
    const card = callbackCard(page);

    await rightClick(card, '1');
    await menuItem(card, 'Copy').click();

    await expect(menuIn(card)).toBeHidden();
    await expect(activityLog(card)).toContainText('Copied "Documents"');
  });

  test('shouldCloseOnClick:false keeps the menu open so the item can be clicked repeatedly', async ({ page }) => {
    await gotoContextMenu(page);
    const card = callbackCard(page);

    await rightClick(card, '1'); // Documents
    const bump = menuItem(card, 'Bump (stays open)');

    await bump.click();
    await expect(menuIn(card)).toBeVisible();
    await expect(activityLog(card)).toContainText('Bump ×1 on "Documents"');

    await bump.click();
    await expect(menuIn(card)).toBeVisible();
    await expect(activityLog(card)).toContainText('Bump ×2 on "Documents"');

    // A normal item still dismisses the menu afterward.
    await menuItem(card, 'Copy').click();
    await expect(menuIn(card)).toBeHidden();
  });

  test('clicking a disabled item does not fire the callback', async ({ page }) => {
    await gotoContextMenu(page);
    const card = callbackCard(page);

    await rightClick(card, '1.2'); // Notes.txt → Paste is disabled
    await menuItem(card, 'Paste').click({ force: true });

    await expect(menuIn(card)).toBeVisible();
    await expect(card.locator('.output')).toBeHidden();
  });

  test('hovering "Export As..." reveals its submenu items', async ({ page }) => {
    await gotoContextMenu(page);
    const card = callbackCard(page);

    await rightClick(card, '1');

    const exportItem = menuItem(card, 'Export As...');
    await expect(exportItem).toHaveClass(/wtv__context-menu-item--has-children/);

    await exportItem.hover();
    const submenu = page.locator('.wtv__context-submenu').first();
    await expect(submenu).toBeVisible();
    await expect(submenu.locator('.wtv__context-menu-label', { hasText: 'JSON' })).toBeVisible();
    await expect(submenu.locator('.wtv__context-menu-label', { hasText: 'XML' })).toBeVisible();
    await expect(submenu.locator('.wtv__context-menu-label', { hasText: 'CSV' })).toBeVisible();
  });

  test('clicking a submenu entry fires the nested callback', async ({ page }) => {
    await gotoContextMenu(page);
    const card = callbackCard(page);

    await rightClick(card, '1');

    const exportItem = menuItem(card, 'Export As...');
    await exportItem.hover();
    const submenu = page.locator('.wtv__context-submenu').first();
    await submenu.locator('.wtv__context-menu-item', { hasText: 'JSON' }).first().click();

    await expect(menuIn(card)).toBeHidden();
    await expect(activityLog(card)).toContainText('Export "Documents" as JSON');
  });

  test('clicking outside the menu closes it', async ({ page }) => {
    await gotoContextMenu(page);
    const card = callbackCard(page);

    await rightClick(card, '1');
    await card.locator('h2').click();
    await expect(menuIn(card)).toBeHidden();
  });

  test('Clear Log empties the activity log output', async ({ page }) => {
    await gotoContextMenu(page);
    const card = callbackCard(page);

    await rightClick(card, '1');
    await menuItem(card, 'Copy').click();
    await expect(activityLog(card)).toContainText('Copied "Documents"');

    await card.getByRole('button', { name: 'Clear Log' }).click();
    await expect(card.locator('.output')).toBeHidden();
  });
});
