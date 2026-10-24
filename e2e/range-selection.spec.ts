import { test, expect, type Page, nodeByPath, nodeContent, logLines } from './fixtures';

/**
 * Range selection and selection-mode gating (/test/range-selection.html).
 *
 *   1 A ── 1.1 A1 (collapsed) ── 1.1.1 A1x, 1.1.2 A1y (hidden)
 *       └─ 1.2 A2
 *   2 B ── 2.1 B1 (collapsed) ── 2.1.1 B1x (hidden)
 *   3 C
 *
 * click-behavior="select" so a plain click never toggles expansion.
 */

const PAGE = '/test/range-selection.html';
const LOG = 'rs-log';

async function load(page: Page, query: string) {
  await page.goto(PAGE + query);
  await expect(nodeByPath(page, '3')).toBeVisible();
}

const click = (page: Page, path: string, modifiers: ('Control' | 'Shift')[] = []) =>
  nodeContent(nodeByPath(page, path)).click({ modifiers });
const selected = (page: Page) => page.evaluate(() => [...(window as any).tree.getSelectedPaths()].sort());

test.describe('rangeSelectionMode', () => {
  test('visual (default): Shift+click selects only the visible rows in between', async ({ page }) => {
    await load(page, '?range=visual');
    await click(page, '1.1');
    await click(page, '2.1', ['Shift']);
    await expect.poll(() => selected(page)).toEqual(['1.1', '1.2', '2', '2.1']);
  });

  test('logical: Shift+click also selects the collapsed (hidden) descendants in the range', async ({ page }) => {
    test.fail(true, 'NOTES.md #7');
    await load(page, '?range=logical');
    await click(page, '1.1');
    await click(page, '2.1', ['Shift']);
    await expect.poll(() => selected(page)).toEqual(['1.1', '1.1.1', '1.1.2', '1.2', '2', '2.1']);
    // Hidden rows are selected in state; the visible endpoints carry the class.
    await expect(nodeContent(nodeByPath(page, '1.2'))).toHaveClass(/wtv__node-content--selected/);
  });

  test('logical: a backwards range (Shift+click above the anchor) works the same', async ({ page }) => {
    test.fail(true, 'NOTES.md #7');
    await load(page, '?range=logical');
    await click(page, '2');
    await click(page, '1.1', ['Shift']);
    await expect.poll(() => selected(page)).toEqual(['1.1', '1.1.1', '1.1.2', '1.2', '2']);
  });
});

test.describe("selectionMode='single'", () => {
  test('Ctrl+click replaces instead of adding', async ({ page }) => {
    await load(page, '?mode=single');
    await click(page, '1');
    await click(page, '3', ['Control']);
    await expect.poll(() => selected(page)).toEqual(['3']);
  });

  test('Shift+click replaces instead of ranging', async ({ page }) => {
    await load(page, '?mode=single');
    await click(page, '1');
    await click(page, '3', ['Shift']);
    await expect.poll(() => selected(page)).toEqual(['3']);
    await expect(nodeContent(nodeByPath(page, '1'))).not.toHaveClass(/wtv__node-content--selected/);
  });

  test('Ctrl+A does not select everything', async ({ page }) => {
    test.fail(true, 'NOTES.md #3');
    await load(page, '?mode=single');
    await click(page, '1.2');
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(100);
    expect((await selected(page)).length).toBeLessThanOrEqual(1);
  });
});

test.describe('selectAll focus', () => {
  test('selectAll() moves focus to the last visible row and announces it with focus-change', async ({ page }) => {
    await load(page, '?mode=multi');
    await click(page, '1');
    const focusedBefore = await page.evaluate(() => (window as any).tree.getFocusedNode()?.path);
    await page.evaluate(() => {
      document.querySelector('[data-testid="rs-log"]')!.textContent = '';
      (window as any).tree.selectAll();
    });
    const focusedAfter = await page.evaluate(() => (window as any).tree.getFocusedNode()?.path);
    expect(focusedBefore).toBe('1');
    expect(focusedAfter).toBe('3');
    await expect.poll(() => logLines(page, LOG)).toContain('focus-change:3');
  });
});
