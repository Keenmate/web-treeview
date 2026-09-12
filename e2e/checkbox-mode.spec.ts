import { test, expect, Page, Locator } from '@playwright/test';

/**
 * Regression for switching checkboxMode at runtime on /test/checkbox-mode.html.
 *
 * Bug (ported from svelte-treeview): in cascade mode a partially-selected parent
 * renders indeterminate ([-]). Switching to independent left it stuck at [-].
 *
 * Two-part fix: (1) the controller reconcile (_reconcileVisualStatesForMode)
 * promotes indeterminate→checked into `_selectedPaths`; (2) because every config
 * change re-inserts the data (fresh node objects), `_reapplyRuntimeSelection()`
 * re-applies the surviving `_selectedPaths` onto the fresh nodes and recomputes
 * visualState after every insertArray. The renderer reads `checked` straight from
 * `snapshot.selectedPaths` (web-grid-style state-off-nodes), so selection is
 * rebuild-proof and the mode switch sticks.
 */

const PAGE = '/test/checkbox-mode.html';

function tree(page: Page) {
  return page.locator('.wtv__container').first();
}
// The checkbox is now a <label class="wtv__checkbox"> wrapping a hidden native
// <input> (+ .wtv__checkbox-box). Click the label; read :checked / :indeterminate
// off the inner input (still the source of truth).
function checkbox(page: Page, path: string): Locator {
  return tree(page).locator(`.wtv__node[data-tree-path="${path}"] .wtv__checkbox`).first();
}
function checkboxInput(page: Page, path: string): Locator {
  return tree(page).locator(`.wtv__node[data-tree-path="${path}"] .wtv__checkbox input`).first();
}
function isIndeterminate(input: Locator): Promise<boolean> {
  return input.evaluate((el) => (el as HTMLInputElement).indeterminate);
}

test.describe('Checkbox mode switch', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE);
    await expect(page.locator('.wtv__node').first()).toBeVisible();
    await expect(page.getByTestId('mode')).toHaveText('cascade');
  });

  test('indeterminate parent becomes CHECKED (not stuck at [-]) when switching cascade → independent', async ({ page }) => {
    // Cascade: check one child of Documents (1) so the parent goes indeterminate.
    await checkbox(page, '1.1').click();
    await expect.poll(() => isIndeterminate(checkboxInput(page, '1'))).toBe(true);
    await expect(checkboxInput(page, '1')).not.toBeChecked();

    // Switch to independent mode (via the attribute → updateProps path).
    await page.getByTestId('mode-independent').click();
    await expect(page.getByTestId('mode')).toHaveText('independent');

    // The parent must LEAVE indeterminate and land fully checked.
    await expect.poll(() => isIndeterminate(checkboxInput(page, '1'))).toBe(false);
    await expect(checkboxInput(page, '1')).toBeChecked();
    await expect(page.getByTestId('selection')).toContainText('1');
    // The still-checked child stays checked; the untouched sibling stays clear.
    await expect(checkboxInput(page, '1.1')).toBeChecked();
    await expect(checkboxInput(page, '1.2')).not.toBeChecked();
    await expect.poll(() => isIndeterminate(checkboxInput(page, '1.2'))).toBe(false);
  });

  test('switching independent → cascade re-derives the parent dash', async ({ page }) => {
    await page.getByTestId('mode-independent').click();
    await checkbox(page, '1.1').click();

    // Independent: parent stays unchecked, no dash.
    await expect(checkboxInput(page, '1')).not.toBeChecked();
    await expect.poll(() => isIndeterminate(checkboxInput(page, '1'))).toBe(false);

    // Switch to cascade — parent now shows indeterminate from its one checked child.
    await page.getByTestId('mode-cascade').click();
    await expect(page.getByTestId('mode')).toHaveText('cascade');
    await expect.poll(() => isIndeterminate(checkboxInput(page, '1'))).toBe(true);
  });
});
