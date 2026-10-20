import { test, expect, Page, Locator } from '@playwright/test';

/**
 * Regression: the focused style must sit on EXACTLY ONE row.
 *
 * The flat diff reconciler only re-renders a row when its `data-rev`,
 * `data-expanded` or `data-has-children` changes. Focus (and highlight) move
 * between nodes WITHOUT bumping the losing node's `_rev` — e.g. a Ctrl+click
 * that adds a node to a multi-highlight (the previously-focused row stays
 * highlighted, so nothing bumps its `_rev`), or a checkbox toggle on another
 * row. Before the fix, the losing row was skipped by the reconciler and kept
 * its stale `focusedNodeClass`, so the focus style accumulated on every row it
 * had ever visited. The renderer now tracks `data-focused` / `data-highlighted`
 * in the dirty check so a row that loses focus/highlight is always re-rendered.
 *
 * Fixture: /test/highlight-focus.html — selection-mode="multi",
 * click-behavior="select", focusedNodeClass selectable as `test-focus`.
 * Data (alpha-sorted): '1' Documents, '1.1' Work, '1.2' Personal, '2' Downloads.
 */

const PAGE = '/test/highlight-focus.html';
const FOCUS_CLASS = 'test-focus';

function nodeContent(page: Page, path: string): Locator {
  return page
    .locator(`.wtv__node[data-tree-path="${path}"]`)
    .first()
    .locator('> .wtv__node-row .wtv__node-content')
    .first();
}

test('Ctrl+click across a multi-highlight leaves the focus class on exactly one row', async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.locator('.wtv__node').first()).toBeVisible();
  await page.getByLabel('Focus Class:').selectOption(FOCUS_CLASS);

  const work = nodeContent(page, '1.1');
  const personal = nodeContent(page, '1.2');
  const re = new RegExp(`\\b${FOCUS_CLASS}\\b`);

  // First Ctrl+click: Work enters the highlight set and takes focus.
  await work.click({ modifiers: ['Control'] });
  await expect(work).toHaveClass(re);

  // Second Ctrl+click: Personal joins the highlight set and focus moves to it.
  // Work stays highlighted (its _rev does NOT bump), so the reconciler must still
  // re-render it to drop the now-stale focus class.
  await personal.click({ modifiers: ['Control'] });
  await expect(personal).toHaveClass(re);
  await expect(work).not.toHaveClass(re);

  // The whole tree carries the focus class on exactly one row.
  await expect(page.locator(`.wtv__node-content.${FOCUS_CLASS}`)).toHaveCount(1);
});

/**
 * Regression: switching focusedNodeClass back to the built-in default must take
 * effect. Clearing a nullable class attribute (`removeAttribute('focused-node-class')`)
 * surfaces as `null` in the assembled engine config; the element used to strip ALL
 * null values ("unset → use default"), so the clear reached the controller as
 * `undefined` and its `!== undefined` merge guard swallowed it — the custom class
 * stuck and the default bar never returned. The element now assembles the engine
 * config via core's `engineConfig()`, which preserves `null` as the clear signal
 * (the null-clear contract, core SPEC §6.1), so the guard sees it and clears.
 */
test('switching focusedNodeClass back to default clears the custom class and restores the default bar', async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.locator('.wtv__node').first()).toBeVisible();

  const work = nodeContent(page, '1.1');
  const focusRe = new RegExp(`\\b${FOCUS_CLASS}\\b`);
  const defaultRe = /wtv__node-content--focused-default/;

  // Focus a node under a custom focus class → custom class on, default bar off.
  await page.getByLabel('Focus Class:').selectOption(FOCUS_CLASS);
  await work.click();
  await expect(work).toHaveClass(focusRe);
  await expect(work).not.toHaveClass(defaultRe);

  // Switch back to Default ('' → removeAttribute). The custom class must drop and
  // the built-in default bar must come back on the still-focused row.
  await page.getByLabel('Focus Class:').selectOption('');
  await expect(work).not.toHaveClass(focusRe);
  await expect(work).toHaveClass(defaultRe);
});
