import { test, expect, type Page, nodeByPath, nodeContent, logLines } from './fixtures';

/**
 * Context-menu render hooks, programmatic open + offsets, keyboard
 * (/test/context-menu-render.html).
 *
 *   1 Docs ── 1.1 Readme
 *   2 Pics
 *
 * Items: Open (shortcut o), Star (s, custom-rendered), Disabled (d, disabled),
 * More (submenu: Unavailable (disabled), First, Second).
 */

const PAGE = '/test/context-menu-render.html';
const LOG = 'cm-log';

async function load(page: Page, query = '') {
  await page.goto(PAGE + query);
  await expect(nodeByPath(page, '2')).toBeVisible();
}

const menu = (page: Page) => page.locator('.km-menu');
const open = (page: Page, path: string, x: number, y: number) =>
  page.evaluate(([p, x, y]) => (window as any).tree.openContextMenu(p, x, y), [path, x, y] as const);

test.describe('renderContextMenuItemCallback', () => {
  test('fills the items it wants; the rest render by default', async ({ page }) => {
    await load(page);
    await nodeContent(nodeByPath(page, '1.1')).click({ button: 'right' });
    await expect(menu(page)).toBeVisible();
    await expect(menu(page).locator('.custom-item')).toHaveText('★ Star Readme');
    await expect(menu(page).locator('.km-menu__item[data-id="open"]')).toContainText('Open');
    await expect(menu(page).locator('.km-menu__item[data-id="open"] .km-menu__shortcut')).toHaveText('o');
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
  await expect(menu(page).locator('.km-menu__item')).toHaveCount(0);
  await menu(page).locator('.custom-close').click();
  await expect.poll(() => logLines(page, LOG)).toEqual(['custom-close:1']);
  await expect(menu(page)).toBeHidden();
});

test.describe('renderContextMenuCallback + controller.activateMenuItem', () => {
  test('ctx.entries = the resolved items (built-in texts, hidden dropped)', async ({ page }) => {
    await load(page, '?mode=run');
    await nodeContent(nodeByPath(page, '1')).click({ button: 'right' });
    await expect(menu(page).locator('.run-item')).toHaveText(['Open', 'Collapse']);
  });

  test('runs the built-in path: beforeActionCallback → onClick → built-in → action event', async ({ page }) => {
    await load(page, '?mode=run');
    await nodeContent(nodeByPath(page, '1')).click({ button: 'right' });
    await menu(page).locator('.run-item', { hasText: 'Open' }).click();
    await expect.poll(() => logLines(page, LOG)).toEqual(['before:custom:open', 'click:open:1', 'action:custom:1', 'ran:true']);
    await expect(menu(page)).toBeHidden();

    await nodeContent(nodeByPath(page, '1')).click({ button: 'right' });
    await menu(page).locator('.run-item', { hasText: 'Collapse' }).click();
    await expect(nodeByPath(page, '1.1')).toBeHidden();
    await expect.poll(() => logLines(page, LOG)).toEqual([
      'before:custom:open', 'click:open:1', 'action:custom:1', 'ran:true',
      'before:collapse:', 'action:collapse:1', 'ran:true',
    ]);
  });

  test('beforeActionCallback returning false vetoes it: no built-in, no action event', async ({ page }) => {
    await load(page, '?mode=run&veto');
    await nodeContent(nodeByPath(page, '1')).click({ button: 'right' });
    await menu(page).locator('.run-item', { hasText: 'Collapse' }).click();
    await expect.poll(() => logLines(page, LOG)).toEqual(['before:collapse:', 'ran:false']);
    await expect(nodeByPath(page, '1.1')).toBeVisible();
  });

  test('el.activateMenuItem / el.controller.activateMenuItem are public', async ({ page }) => {
    await load(page, '?mode=run');
    expect(await page.evaluate(() => {
      const t = (window as any).tree;
      return [typeof t.activateMenuItem, typeof t.controller.activateMenuItem];
    })).toEqual(['function', 'function']);
  });
});

test.describe('openContextMenu(path, x, y)', () => {
  test('opens for that node at the given viewport point (+ the default 8px x-offset)', async ({ page }) => {
    await load(page);
    await open(page, '2', 200, 150);
    await expect(menu(page)).toBeVisible();
    const box = (await menu(page).boundingBox())!;
    expect(Math.abs(box.x - 208)).toBeLessThan(2);
    expect(Math.abs(box.y - 150)).toBeLessThan(2);
    await menu(page).locator('.km-menu__item[data-id="open"]').click();
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

/**
 * The menu is core `openMenu()` — the WAI-ARIA menu keyboard model with roving
 * focus. Focus is read through shadow roots (the deep active element).
 */
test.describe('keyboard navigation (WAI-ARIA menu)', () => {
  /** data-id of the focused menu item, or the class of whatever else has focus. */
  const focused = (page: Page) =>
    page.evaluate(() => {
      let a: Element | null = document.activeElement;
      while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
      return (a as HTMLElement | null)?.dataset?.id ?? a?.className ?? null;
    });
  const focusedPath = (page: Page) => page.evaluate(() => (window as any).tree.focusedNode?.path);
  const selectedPaths = (page: Page) => page.evaluate(() => [...(window as any).tree.selectedPaths]);
  const submenu = (page: Page) => page.locator('.km-menu--submenu');

  /** Focus node 1.1 (keyboard focus on the tree body), then open the menu from the keyboard. */
  async function openFromKeyboard(page: Page, keys = 'Shift+F10') {
    await load(page);
    await nodeContent(nodeByPath(page, '1.1')).click();
    await expect.poll(() => focusedPath(page)).toBe('1.1');
    await page.keyboard.press(keys);
    await expect(menu(page).first()).toBeVisible();
  }

  test("Shift+F10 opens the focused node's menu with the first item focused", async ({ page }) => {
    await openFromKeyboard(page);
    await expect(menu(page).first()).toHaveAttribute('role', 'menu');
    await expect.poll(() => focused(page)).toBe('open');
    // Opened below the node row.
    const row = (await nodeContent(nodeByPath(page, '1.1')).boundingBox())!;
    const box = (await menu(page).first().boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(row.y + row.height - 2);
  });

  test('the ContextMenu key opens it too', async ({ page }) => {
    await openFromKeyboard(page, 'ContextMenu');
    await expect.poll(() => focused(page)).toBe('open');
  });

  test('↓ / ↑ move with wrap-around, skipping the disabled item; Home / End', async ({ page }) => {
    await openFromKeyboard(page);
    await page.keyboard.press('ArrowDown');
    expect(await focused(page)).toBe('star');
    await page.keyboard.press('ArrowDown');
    expect(await focused(page)).toBe('more'); // "Disabled" skipped
    await page.keyboard.press('ArrowDown');
    expect(await focused(page)).toBe('open'); // wrapped
    await page.keyboard.press('ArrowUp');
    expect(await focused(page)).toBe('more');
    await page.keyboard.press('Home');
    expect(await focused(page)).toBe('open');
    await page.keyboard.press('End');
    expect(await focused(page)).toBe('more');
    // The tree didn't move underneath.
    expect(await focusedPath(page)).toBe('1.1');
  });

  test('→ opens the submenu on its first enabled item; ← closes it and refocuses the parent item', async ({ page }) => {
    await openFromKeyboard(page);
    await page.keyboard.press('End');
    const more = menu(page).first().locator('.km-menu__item[data-id="more"]');
    await expect(more).toHaveAttribute('aria-haspopup', 'menu');
    await page.keyboard.press('ArrowRight');
    await expect(submenu(page)).toBeVisible();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    await expect.poll(() => focused(page)).toBe('m1');
    await page.keyboard.press('ArrowLeft');
    await expect(submenu(page)).toHaveCount(0);
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(await focused(page)).toBe('more');
  });

  test('Enter opens the submenu; Esc closes only the submenu and refocuses its parent item', async ({ page }) => {
    await openFromKeyboard(page);
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await expect.poll(() => focused(page)).toBe('m1');
    await page.keyboard.press('Escape');
    await expect(submenu(page)).toHaveCount(0);
    await expect(menu(page).first()).toBeVisible();
    expect(await focused(page)).toBe('more');
  });

  test('Enter runs a submenu leaf, closes the menu and returns focus to the tree', async ({ page }) => {
    await openFromKeyboard(page);
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => focused(page)).toBe('m1');
    await page.keyboard.press('ArrowDown');
    expect(await focused(page)).toBe('m2');
    await page.keyboard.press('Enter');
    await expect.poll(() => logLines(page, LOG)).toEqual(['click:m2:1.1']);
    await expect(menu(page)).toHaveCount(0);
    expect(await focused(page)).toBe('wtv__tree');
    expect(await focusedPath(page)).toBe('1.1');
  });

  test('Space runs the focused leaf', async ({ page }) => {
    await openFromKeyboard(page);
    await page.keyboard.press(' ');
    await expect.poll(() => logLines(page, LOG)).toEqual(['click:open:1.1']);
    await expect(menu(page)).toHaveCount(0);
  });

  test('Esc on the root closes it, returns focus to the tree node, and does not reach the tree', async ({ page }) => {
    await openFromKeyboard(page);
    const selectedBefore = await selectedPaths(page);
    expect(selectedBefore.length).toBeGreaterThan(0); // the click selected 1.1
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Escape');
    await expect(menu(page)).toHaveCount(0);
    expect(await focused(page)).toBe('wtv__tree');
    expect(await focusedPath(page)).toBe('1.1');
    // The tree's own Escape (clear selection) didn't run.
    expect(await selectedPaths(page)).toEqual(selectedBefore);
    // The keyboard is the tree's again.
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => focusedPath(page)).toBe('1');
  });

  test('Tab closes the menu', async ({ page }) => {
    await openFromKeyboard(page);
    await page.keyboard.press('Tab');
    await expect(menu(page)).toHaveCount(0);
  });

  test('a mouse-opened menu is keyboard-operable: ↓ focuses the first item, Enter runs it', async ({ page }) => {
    await load(page);
    await nodeContent(nodeByPath(page, '2')).click({ button: 'right' });
    await expect(menu(page).first()).toBeVisible();
    await page.keyboard.press('ArrowDown');
    expect(await focused(page)).toBe('open');
    await page.keyboard.press('Enter');
    await expect.poll(() => logLines(page, LOG)).toEqual(['click:open:2']);
  });

  test('items carry the menu roles and roving tabindex', async ({ page }) => {
    await openFromKeyboard(page);
    const root = menu(page).first();
    await expect(root.locator('[role="menuitem"]')).toHaveCount(4);
    await expect(root.locator('.km-menu__item[data-id="off"]')).toHaveAttribute('aria-disabled', 'true');
    await expect(root.locator('.km-menu__item[data-id="open"]')).toHaveAttribute('tabindex', '-1');
  });
});
