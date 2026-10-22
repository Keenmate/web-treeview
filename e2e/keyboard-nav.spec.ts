import { test, expect, Page, Locator } from '@playwright/test';

/**
 * E2E coverage for /test/keyboard-nav.html.
 *
 * Tree layout (18 nodes, sorted by path):
 *
 *   idx | path  | name     | level
 *   ----+-------+----------+------
 *     0 | 1     | Root-A   |   1
 *     1 | 1.1   | A-1      |   2
 *     2 | 1.1.1 | A-1-x    |   3
 *     3 | 1.1.2 | A-1-y    |   3
 *     4 | 1.2   | A-2      |   2
 *     5 | 1.2.1 | A-2-x    |   3
 *     6 | 1.2.2 | A-2-y    |   3
 *     7 | 1.3   | A-3      |   2  leaf
 *     8 | 2     | Root-B   |   1
 *     9 | 2.1   | B-1      |   2
 *    10 | 2.1.1 | B-1-x    |   3
 *    11 | 2.1.2 | B-1-y    |   3
 *    12 | 2.2   | B-2      |   2  leaf
 *    13 | 3     | Root-C   |   1
 *    14 | 3.1   | C-1      |   2  leaf
 *    15 | 3.2   | C-2      |   2  leaf
 *    16 | 4     | Root-D   |   1  leaf
 *    17 | 5     | Root-E   |   1  leaf
 *
 * Each test clicks a node to seed focus, then presses keys and asserts the
 * resulting focusedNode.path.
 *
 * Gaps vs the Svelte build (controller features not yet ported to
 * web-treeview): Shift+Arrow extends, Shift+Home/End ranges, PageDown/PageUp,
 * Shift+PageDown/Up. Those tests are skipped at the bottom.
 */

const PAGE = '/test/keyboard-nav.html';

function nodeByPath(scope: Locator | Page, path: string): Locator {
  return scope.locator(`.wtv__node[data-tree-path="${path}"]`).first();
}

function nodeContent(node: Locator): Locator {
  return node.locator('> .wtv__node-row .wtv__node-content').first();
}

async function gotoFixture(page: Page) {
  await page.goto(PAGE);
  await expect(page.locator('.wtv__node').first()).toBeVisible();
}

async function clickToFocus(page: Page, path: string) {
  await nodeContent(nodeByPath(page, path)).click();
  await expect(page.getByTestId('focused-path')).toHaveText(path);
}

function visibleCount(page: Page): Promise<number> {
  return page.locator('.wtv__node[data-tree-path]').count();
}

test.beforeEach(async ({ page }) => {
  await gotoFixture(page);
  await expect.poll(() => visibleCount(page)).toBe(18);
});

// ── Sibling navigation (no Shift) ──────────────────────────────────────────

test.describe('ArrowDown / ArrowUp — sibling navigation', () => {
  test('ArrowDown moves focus to the next sibling at the same level', async ({ page }) => {
    await clickToFocus(page, '1');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('focused-path')).toHaveText('2');
  });

  test('ArrowDown at level 2 walks level-2 siblings, skipping descendants', async ({ page }) => {
    await clickToFocus(page, '1.1');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('focused-path')).toHaveText('1.2');
  });

  test('ArrowDown at level 3 walks level-3 siblings', async ({ page }) => {
    await clickToFocus(page, '1.1.1');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('focused-path')).toHaveText('1.1.2');
  });

  test('ArrowDown on the last sibling is a no-op', async ({ page }) => {
    await clickToFocus(page, '5');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('focused-path')).toHaveText('5');
  });

  test('ArrowUp moves focus to the previous sibling at the same level', async ({ page }) => {
    await clickToFocus(page, '2');
    await page.keyboard.press('ArrowUp');
    await expect(page.getByTestId('focused-path')).toHaveText('1');
  });

  test('ArrowUp on the first sibling is a no-op', async ({ page }) => {
    await clickToFocus(page, '1');
    await page.keyboard.press('ArrowUp');
    await expect(page.getByTestId('focused-path')).toHaveText('1');
  });
});

// ── Tree-traversal navigation ──────────────────────────────────────────────

test.describe('ArrowRight / ArrowLeft — descend and ascend', () => {
  test('ArrowRight on an expanded parent moves into the first child', async ({ page }) => {
    await clickToFocus(page, '1');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('focused-path')).toHaveText('1.1');
  });

  test('ArrowRight on a collapsed parent first expands, then moves into the first child', async ({ page }) => {
    await clickToFocus(page, '1');
    await page.keyboard.press('Space');
    await expect.poll(() => visibleCount(page)).toBe(11);

    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('focused-path')).toHaveText('1.1');
    await expect.poll(() => visibleCount(page)).toBe(18);
  });

  test('ArrowRight on a leaf is a no-op', async ({ page }) => {
    await clickToFocus(page, '1.3');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('focused-path')).toHaveText('1.3');
  });

  test('ArrowLeft moves focus to the parent', async ({ page }) => {
    await clickToFocus(page, '1.1');
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('focused-path')).toHaveText('1');
  });

  test('ArrowLeft from a level-3 descendant moves to its level-2 parent', async ({ page }) => {
    await clickToFocus(page, '1.1.1');
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('focused-path')).toHaveText('1.1');
  });

  test('ArrowLeft on a root node is a no-op', async ({ page }) => {
    await clickToFocus(page, '1');
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('focused-path')).toHaveText('1');
  });
});

// ── Backspace: navBackOut (collapse parent, focus parent) ──────────────────

test.describe('Backspace — collapse parent and focus it', () => {
  test('Backspace collapses the focused node\'s parent and moves focus there', async ({ page }) => {
    await clickToFocus(page, '1.1');
    await page.keyboard.press('Backspace');
    await expect(page.getByTestId('focused-path')).toHaveText('1');
    await expect.poll(() => visibleCount(page)).toBe(11);
  });

  test('Backspace from a level-3 node collapses the level-2 parent', async ({ page }) => {
    await clickToFocus(page, '1.1.1');
    await page.keyboard.press('Backspace');
    await expect(page.getByTestId('focused-path')).toHaveText('1.1');
    await expect.poll(() => visibleCount(page)).toBe(16);
  });

  test('Backspace on a root node is a no-op (no parent)', async ({ page }) => {
    await clickToFocus(page, '1');
    await page.keyboard.press('Backspace');
    await expect(page.getByTestId('focused-path')).toHaveText('1');
    await expect.poll(() => visibleCount(page)).toBe(18);
  });
});

// ── Space: navToggle ───────────────────────────────────────────────────────

test.describe('Space — toggle expand state of focused node', () => {
  test('Space collapses an expanded parent', async ({ page }) => {
    await clickToFocus(page, '1');
    await page.keyboard.press('Space');
    await expect.poll(() => visibleCount(page)).toBe(11);
  });

  test('Space re-expands a collapsed parent', async ({ page }) => {
    await clickToFocus(page, '1');
    await page.keyboard.press('Space');
    await expect.poll(() => visibleCount(page)).toBe(11);

    await page.keyboard.press('Space');
    await expect.poll(() => visibleCount(page)).toBe(18);
  });

  test('Space on a different expanded node also collapses', async ({ page }) => {
    await clickToFocus(page, '2');
    await page.keyboard.press('Space');
    await expect.poll(() => visibleCount(page)).toBe(14);
  });

  test('Space on a leaf is a no-op', async ({ page }) => {
    await clickToFocus(page, '1.3');
    await page.keyboard.press('Space');
    await expect.poll(() => visibleCount(page)).toBe(18);
  });
});

// ── Home / End: jump to ends of visible flat list ─────────────────────────

test.describe('Home / End — jump to first/last visible', () => {
  test('Home moves focus to the first visible node', async ({ page }) => {
    await clickToFocus(page, '2.1.1');
    await page.keyboard.press('Home');
    await expect(page.getByTestId('focused-path')).toHaveText('1');
  });

  test('End moves focus to the last visible node', async ({ page }) => {
    await clickToFocus(page, '1');
    await page.keyboard.press('End');
    await expect(page.getByTestId('focused-path')).toHaveText('5');
  });
});

// ── Controller gaps: PageDown / PageUp and Shift+ extend ──────────────────
// These exist in the Svelte build but the web-treeview controller doesn't yet
// expose navPageDown / navPageUp / navSelectNext / navSelectPrev /
// navSelectFirst / navSelectLast / navSelectPageDown / navSelectPageUp.
// Tracked as a follow-up.

test.skip('PageDown jumps 10 nodes forward — controller gap', () => {});
test.skip('PageDown clamps to last visible — controller gap', () => {});
test.skip('PageUp jumps 10 nodes backward — controller gap', () => {});
test.skip('PageUp clamps to first visible — controller gap', () => {});
test.skip('Shift+ArrowDown extends selection to next sibling — controller gap', () => {});
test.skip('Shift+ArrowUp extends selection to prev sibling — controller gap', () => {});
test.skip('Shift+End extends selection to last — controller gap', () => {});
test.skip('Shift+Home extends selection to first — controller gap', () => {});
test.skip('Shift+PageDown extends selection by 10 — controller gap', () => {});
test.skip('Shift+PageUp extends selection by -10 — controller gap', () => {});
