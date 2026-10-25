import { test, expect, Page, Locator, nodeByPath, nodeContent } from './fixtures';

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
 * PageDown/PageUp jump ±10 rows; the Shift variants (and Shift+Arrow/Home/End)
 * extend the selected range in multi mode (TV-4). navigationOverrides tests at
 * the bottom.
 */

const PAGE = '/test/keyboard-nav.html';

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

// ── PageDown / PageUp: jump ±10 in the visible flat list ───────────────────

test.describe('PageDown / PageUp — jump ±10 in visible flat list', () => {
  test('PageDown jumps 10 nodes forward in the visible flat list', async ({ page }) => {
    await clickToFocus(page, '1'); // idx 0
    await page.keyboard.press('PageDown');
    // idx 10 → '2.1.1'.
    await expect(page.getByTestId('focused-path')).toHaveText('2.1.1');
    await expect(page.getByTestId('selected-sorted')).toHaveText('2.1.1');
  });

  test('PageDown clamps to the last visible node when near the end', async ({ page }) => {
    await clickToFocus(page, '2.1.1'); // idx 10
    await page.keyboard.press('PageDown');
    // min(20, 17) = 17 → '5'.
    await expect(page.getByTestId('focused-path')).toHaveText('5');
  });

  test('PageUp jumps 10 nodes backward in the visible flat list', async ({ page }) => {
    await clickToFocus(page, '5'); // idx 17
    await page.keyboard.press('PageUp');
    // idx 7 → '1.3'.
    await expect(page.getByTestId('focused-path')).toHaveText('1.3');
  });

  test('PageUp clamps to the first visible node when near the start', async ({ page }) => {
    await clickToFocus(page, '1.1'); // idx 1
    await page.keyboard.press('PageUp');
    // max(-9, 0) = 0 → '1'.
    await expect(page.getByTestId('focused-path')).toHaveText('1');
  });
});

// ── Shift+nav: extend the selected range (multi mode) ──────────────────────

test.describe('Shift+ArrowDown / Shift+ArrowUp — extend selection by sibling', () => {
  test('Shift+ArrowDown selects the visible-flat range from anchor to the next sibling', async ({ page }) => {
    await clickToFocus(page, '1.1');
    await expect(page.getByTestId('selected-size')).toHaveText('1');

    await page.keyboard.press('Shift+ArrowDown');

    // navSelectNext walks to the next level-2 sibling → '1.2'.
    // Range fills visible-flat from '1.1' to '1.2' = [1.1, 1.1.1, 1.1.2, 1.2].
    await expect(page.getByTestId('focused-path')).toHaveText('1.2');
    await expect(page.getByTestId('selected-size')).toHaveText('4');
    await expect(page.getByTestId('selected-sorted')).toHaveText('1.1,1.1.1,1.1.2,1.2');
  });

  test('Shift+ArrowUp selects the visible-flat range from anchor to the previous sibling', async ({ page }) => {
    await clickToFocus(page, '1.2');

    await page.keyboard.press('Shift+ArrowUp');

    await expect(page.getByTestId('focused-path')).toHaveText('1.1');
    await expect(page.getByTestId('selected-size')).toHaveText('4');
    await expect(page.getByTestId('selected-sorted')).toHaveText('1.1,1.1.1,1.1.2,1.2');
  });

  test('repeated Shift+ArrowDown keeps the anchor and grows the range', async ({ page }) => {
    await clickToFocus(page, '1.1');
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowDown');

    await expect(page.getByTestId('focused-path')).toHaveText('1.3');
    await expect(page.getByTestId('selected-sorted')).toHaveText('1.1,1.1.1,1.1.2,1.2,1.2.1,1.2.2,1.3');

    // Back up one step: the anchor (1.1) stays, the range shrinks.
    await page.keyboard.press('Shift+ArrowUp');
    await expect(page.getByTestId('focused-path')).toHaveText('1.2');
    await expect(page.getByTestId('selected-sorted')).toHaveText('1.1,1.1.1,1.1.2,1.2');
  });

  test('a plain move after Shift-extend resets the selection and the anchor', async ({ page }) => {
    await clickToFocus(page, '1.1');
    await page.keyboard.press('Shift+ArrowDown');
    await expect(page.getByTestId('selected-size')).toHaveText('4');

    await page.keyboard.press('ArrowDown'); // plain → 1.3, selection = {1.3}
    await expect(page.getByTestId('focused-path')).toHaveText('1.3');
    await expect(page.getByTestId('selected-sorted')).toHaveText('1.3');

    await page.keyboard.press('Shift+ArrowUp'); // anchor is now 1.3
    await expect(page.getByTestId('focused-path')).toHaveText('1.2');
    await expect(page.getByTestId('selected-sorted')).toHaveText('1.2,1.2.1,1.2.2,1.3');
  });
});

test.describe('Shift+Home / Shift+End — extend selection to ends', () => {
  test('Shift+End selects from anchor through the last visible node', async ({ page }) => {
    await clickToFocus(page, '2'); // anchor idx 8 → range to idx 17 = 10 paths

    await page.keyboard.press('Shift+End');

    await expect(page.getByTestId('focused-path')).toHaveText('5');
    await expect(page.getByTestId('selected-size')).toHaveText('10');
    await expect(page.getByTestId('selected-sorted')).toHaveText('2,2.1,2.1.1,2.1.2,2.2,3,3.1,3.2,4,5');
  });

  test('Shift+Home selects from anchor back through the first visible node', async ({ page }) => {
    await clickToFocus(page, '1.2'); // anchor idx 4 → range to idx 0 = 5 paths

    await page.keyboard.press('Shift+Home');

    await expect(page.getByTestId('focused-path')).toHaveText('1');
    await expect(page.getByTestId('selected-size')).toHaveText('5');
    await expect(page.getByTestId('selected-sorted')).toHaveText('1,1.1,1.1.1,1.1.2,1.2');
  });
});

test.describe('Shift+PageDown / Shift+PageUp — extend selection by ±10', () => {
  test('Shift+PageDown selects from anchor through anchor+10 in visible-flat order', async ({ page }) => {
    await clickToFocus(page, '1'); // anchor idx 0
    await page.keyboard.press('Shift+PageDown');
    // Target idx 10 → '2.1.1'. Range = idx 0..10 = 11 paths.
    await expect(page.getByTestId('focused-path')).toHaveText('2.1.1');
    await expect(page.getByTestId('selected-size')).toHaveText('11');
    await expect(page.getByTestId('selected-sorted')).toHaveText('1,1.1,1.1.1,1.1.2,1.2,1.2.1,1.2.2,1.3,2,2.1,2.1.1');
  });

  test('Shift+PageUp selects from anchor back through anchor-10', async ({ page }) => {
    await clickToFocus(page, '5'); // anchor idx 17
    await page.keyboard.press('Shift+PageUp');
    // Target idx 7 → '1.3'. Range = idx 7..17 = 11 paths.
    await expect(page.getByTestId('focused-path')).toHaveText('1.3');
    await expect(page.getByTestId('selected-size')).toHaveText('11');
    await expect(page.getByTestId('selected-sorted')).toHaveText('1.3,2,2.1,2.1.1,2.1.2,2.2,3,3.1,3.2,4,5');
  });
});

test.describe('Shift+nav in single selection mode', () => {
  test('Shift+ArrowDown / Shift+End / Shift+PageDown are no-ops (focus and selection stay)', async ({ page }) => {
    await page.evaluate(() => { (document.getElementById('tree') as any).selectionMode = 'single'; });
    await clickToFocus(page, '1.1');
    await expect(page.getByTestId('selected-sorted')).toHaveText('1.1');

    for (const key of ['Shift+ArrowDown', 'Shift+End', 'Shift+PageDown', 'Shift+Home']) {
      await page.keyboard.press(key);
    }
    await expect(page.getByTestId('focused-path')).toHaveText('1.1');
    await expect(page.getByTestId('selected-sorted')).toHaveText('1.1');
    // Plain navigation still works.
    await page.keyboard.press('PageDown');
    await expect(page.getByTestId('focused-path')).toHaveText('2.1.2');
  });
});

// ── navigationOverrides: replace individual navigation methods ─────────────

test.describe('navigationOverrides', () => {
  test('an override replaces one key behaviour; the other keys keep their defaults', async ({ page }) => {
    // ArrowDown → next VISIBLE node (descends into children) instead of next sibling.
    await page.evaluate(() => {
      (document.getElementById('tree') as any).navigationOverrides = {
        navNextSibling() { (this as any).navNext(); },
      };
    });
    await clickToFocus(page, '1');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('focused-path')).toHaveText('1.1');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('focused-path')).toHaveText('1.1.1');

    // Not overridden → still the defaults.
    await page.keyboard.press('ArrowUp'); // prev sibling of 1.1.1 at level 3 → none, stays
    await expect(page.getByTestId('focused-path')).toHaveText('1.1.1');
    await page.keyboard.press('End');
    await expect(page.getByTestId('focused-path')).toHaveText('5');
    await page.keyboard.press('PageUp');
    await expect(page.getByTestId('focused-path')).toHaveText('1.3');
  });

  test('the controller nav methods route through the override too', async ({ page }) => {
    await page.evaluate(() => {
      const tree = document.getElementById('tree') as any;
      tree.navigationOverrides = { navPageDown() { (this as any).navTo('4'); } };
    });
    await clickToFocus(page, '1');
    await page.evaluate(() => (document.getElementById('tree') as any).controller.navPageDown());
    await expect(page.getByTestId('focused-path')).toHaveText('4');
  });

  test('overriding navTo changes every built-in move', async ({ page }) => {
    await page.evaluate(() => {
      const w = window as any;
      w.__navToCalls = [];
      (document.getElementById('tree') as any).navigationOverrides = {
        navTo(path: string) { w.__navToCalls.push(path); },
      };
    });
    await clickToFocus(page, '1');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('PageDown');
    // The override swallowed the moves: focus stays, but both targets were requested.
    await expect(page.getByTestId('focused-path')).toHaveText('1');
    expect(await page.evaluate(() => (window as any).__navToCalls)).toEqual(['2', '2.1.1']);
  });

  test('reassigning at runtime swaps the behaviour; null restores the defaults', async ({ page }) => {
    await clickToFocus(page, '1');
    await page.evaluate(() => {
      (document.getElementById('tree') as any).navigationOverrides = { navNextSibling() { (this as any).navTo('3'); } };
    });
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('focused-path')).toHaveText('3');

    await page.evaluate(() => {
      (document.getElementById('tree') as any).navigationOverrides = { navNextSibling() { (this as any).navTo('5'); } };
    });
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('focused-path')).toHaveText('5');

    await page.evaluate(() => { (document.getElementById('tree') as any).navigationOverrides = null; });
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('focused-path')).toHaveText('2');
  });

  test('beforeKeydownCallback runs first and can suppress an overridden key', async ({ page }) => {
    await page.evaluate(() => {
      const w = window as any;
      w.__overrideCalls = 0;
      const tree = document.getElementById('tree') as any;
      tree.navigationOverrides = { navPageDown() { w.__overrideCalls++; } };
      tree.beforeKeydownCallback = (ctx: { event: KeyboardEvent }) => (ctx.event.key === 'PageDown' ? false : undefined);
    });
    await clickToFocus(page, '1');
    await page.keyboard.press('PageDown');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('focused-path')).toHaveText('2');
    expect(await page.evaluate(() => (window as any).__overrideCalls)).toBe(0);
  });
});
