import { test, expect, Page, Locator } from './fixtures';

/**
 * E2E coverage for /test/selection-focus.html — parity with svelte-treeview's
 * e2e/selection-focus.spec.ts.
 *
 * Two contracts:
 *
 *  1. Selected-marker FALLBACK. `.wtv__node-content--selected` ships a
 *     default look so the selection is visible out of the box, but the DOM renderer
 *     only applies it when `selectedNodeClass` is unset. Setting a selected
 *     class must suppress the marker so the default background never fights the
 *     configured style.
 *
 *  2. Focused-node styling. `.wtv__node-content--focused` is a pure hook applied
 *     whenever a node is focused (regardless of focusedNodeClass). The optional
 *     `focusedNodeClass` is additive and lands on exactly the one focused row.
 *
 * NB: web-treeview's diff renderer only re-renders a row when its `_rev` bumps
 * (a config-only attribute change does NOT re-render already-drawn rows). So
 * each test sets the selection/focus class BEFORE clicking — the click bumps
 * `_rev`, and `_updateNodeElement` then reads the current config. This is why
 * there's no "switch the class on an already-selected row" test like the
 * Svelte build has (Svelte's reactive class binding hot-swaps; the diff
 * renderer intentionally doesn't).
 *
 * Page data (alpha-sorted): '1' Documents, '1.1' Work, '1.2' Personal,
 * '2' Downloads. 1.1/1.2/2 are leaves. click-behavior="select": a plain click
 * focuses + selects (replace).
 */

const PAGE = '/test/selection-focus.html';

const MARKER = 'wtv__node-content--selected';
const FOCUS_MARKER = 'wtv__node-content--focused';
const BOLD = 'wtv__node-content--selected-bold';
const GLOW = 'wtv__node-content--selected-glow';

// Whole-class match — `\b` would let `--selected` match inside `--selected-bold`.
const cls = (name: string) => new RegExp(`(^|\\s)${name}(\\s|$)`);
const FOCUS_CLASS = 'test-focus';

function nodeContent(page: Page, path: string): Locator {
  return page
    .locator(`.wtv__node[data-tree-path="${path}"]`)
    .first()
    .locator('> .wtv__node-row .wtv__node-content')
    .first();
}

function outputValue(page: Page, label: string): Locator {
  return page
    .locator('.output')
    .filter({ has: page.locator('p.output-label', { hasText: label }) })
    .first()
    .locator('pre')
    .first();
}

async function goto(page: Page) {
  await page.goto(PAGE);
  await expect(page.locator('.wtv__node').first()).toBeVisible();
}

// ── Selected marker fallback ────────────────────────────────────────────────

test.describe('selected marker fallback', () => {
  test('no selectedNodeClass: selected row gets the fallback marker', async ({ page }) => {
    await goto(page);

    const work = nodeContent(page, '1.1');
    await work.click();

    await expect(outputValue(page, 'Selected Paths')).toContainText('1.1');
    await expect(work).toHaveClass(cls(MARKER));
  });

  test('selectedNodeClass="Bold": custom class applied, fallback marker suppressed', async ({ page }) => {
    await goto(page);
    await page.getByLabel('Selected Class:').selectOption(BOLD);

    const work = nodeContent(page, '1.1');
    await work.click();

    await expect(work).toHaveClass(cls(BOLD));
    await expect(work).not.toHaveClass(cls(MARKER));
  });

  test('selectedNodeClass="Glow": custom class applied, fallback marker suppressed', async ({ page }) => {
    await goto(page);
    await page.getByLabel('Selected Class:').selectOption(GLOW);

    const work = nodeContent(page, '1.1');
    await work.click();

    await expect(work).toHaveClass(cls(GLOW));
    await expect(work).not.toHaveClass(cls(MARKER));
  });
});

// ── Focused node styling ─────────────────────────────────────────────────────

test.describe('focused node styling', () => {
  test('focus marker hook is applied to the focused row even with no focusedNodeClass', async ({ page }) => {
    await goto(page);

    const work = nodeContent(page, '1.1');
    await work.click();

    await expect(outputValue(page, 'Focused Node')).toContainText('Work');
    await expect(work).toHaveClass(cls(FOCUS_MARKER));
    await expect(work).not.toHaveClass(cls(FOCUS_CLASS));
  });

  test('focusedNodeClass lands on the focused row', async ({ page }) => {
    await goto(page);
    await page.getByLabel('Focus Class:').selectOption(FOCUS_CLASS);

    const work = nodeContent(page, '1.1');
    await work.click();

    await expect(work).toHaveClass(cls(FOCUS_CLASS));
    await expect(work).toHaveClass(cls(FOCUS_MARKER));
  });

  test('focus is single: moving focus moves both the hook and the custom class', async ({ page }) => {
    await goto(page);
    await page.getByLabel('Focus Class:').selectOption(FOCUS_CLASS);

    const work = nodeContent(page, '1.1');
    const personal = nodeContent(page, '1.2');

    await work.click();
    await expect(work).toHaveClass(cls(FOCUS_CLASS));

    await personal.click();
    await expect(personal).toHaveClass(cls(FOCUS_CLASS));
    await expect(personal).toHaveClass(cls(FOCUS_MARKER));
    await expect(work).not.toHaveClass(cls(FOCUS_CLASS));
    await expect(work).not.toHaveClass(cls(FOCUS_MARKER));

    await expect(page.locator(`.${FOCUS_MARKER}`)).toHaveCount(1);
  });

  test('selection and focus stack independently on the same row', async ({ page }) => {
    await goto(page);
    await page.getByLabel('Selected Class:').selectOption(BOLD);
    await page.getByLabel('Focus Class:').selectOption(FOCUS_CLASS);

    const work = nodeContent(page, '1.1');
    await work.click();

    await expect(work).toHaveClass(cls(BOLD));
    await expect(work).toHaveClass(cls(FOCUS_CLASS));
    await expect(work).not.toHaveClass(cls(MARKER));
  });
});
