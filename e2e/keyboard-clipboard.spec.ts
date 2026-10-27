import { test, expect, type Page, nodeByPath, nodeContent, logLines } from './fixtures';

/**
 * Built-in keyboard shortcuts (/test/keyboard-clipboard.html).
 *
 *   1 Docs ── 1.1 Reports ── 1.1.1 Q1 (hidden: expand-level=1)
 *          └─ 1.2 Notes
 *   2 Images ── 2.1 Pic
 *   3 Locked  (is-selectable=false)
 */

const PAGE = '/test/keyboard-clipboard.html';
const LOG = 'kc-log';

async function load(page: Page, query = '') {
  await page.goto(PAGE + query);
  await expect(nodeByPath(page, '3')).toBeVisible();
}

async function clickNode(page: Page, path: string, modifiers: ('Control' | 'Shift')[] = []) {
  await nodeContent(nodeByPath(page, path)).click({ modifiers });
}

const childNames = (page: Page, p: string) => page.evaluate((p) => (window as any).childNames(p), p);
const clipboardOp = (page: Page) => page.evaluate(() => (window as any).tree.getClipboardOperation());
const selected = (page: Page) => page.evaluate(() => [...(window as any).tree.selectedPaths].sort());
const checked = (page: Page) => page.evaluate(() => [...(window as any).tree.checkedPaths].sort());

test.describe('copy / cut / paste', () => {
  test('Ctrl+C then Ctrl+V on another node pastes a copy, source stays', async ({ page }) => {
    await load(page);
    await clickNode(page, '1.2');
    await page.keyboard.press('Control+c');
    await expect.poll(() => logLines(page, LOG)).toContain('node-copy:1.2');
    expect(await clipboardOp(page)).toBe('copy');

    await clickNode(page, '2');
    await page.keyboard.press('Control+v');
    await expect.poll(() => childNames(page, '2')).toEqual(['Notes', 'Pic']);
    expect(await childNames(page, '1')).toEqual(['Notes', 'Reports']);
    expect(await logLines(page, LOG)).toContain('node-paste:success=true count=1');
  });

  test('after copy + paste both the original and the copy are rendered', async ({ page }) => {
    await load(page);
    await clickNode(page, '1.2');
    await page.keyboard.press('Control+c');
    await clickNode(page, '2.1');
    await page.keyboard.press('Control+v');
    await expect.poll(() => childNames(page, '2.1')).toEqual(['Notes']);
    // the paste target (a leaf) stays collapsed — open it to show the copy
    await page.evaluate(() => (window as any).tree.expandNodes('2.1'));
    // Model has two "Notes" rows (same id) → the DOM must show two as well (rows keyed by path).
    await expect(page.locator('.wtv__node-label', { hasText: 'Notes' })).toHaveCount(2);
  });

  test('Ctrl+X then Ctrl+V moves the node', async ({ page }) => {
    await load(page);
    await clickNode(page, '1.2');
    await page.keyboard.press('Control+x');
    await expect.poll(() => logLines(page, LOG)).toContain('node-cut:1.2');
    expect(await clipboardOp(page)).toBe('cut');

    await clickNode(page, '2');
    await page.keyboard.press('Control+v');
    await expect.poll(() => childNames(page, '2')).toEqual(['Notes', 'Pic']);
    expect(await childNames(page, '1')).toEqual(['Reports']);
  });

  test('CUA aliases: Ctrl+Insert copies, Shift+Insert pastes', async ({ page }) => {
    await load(page);
    await clickNode(page, '2.1');
    await page.keyboard.press('Control+Insert');
    await expect.poll(() => logLines(page, LOG)).toContain('node-copy:2.1');

    await clickNode(page, '1');
    await page.keyboard.press('Shift+Insert');
    await expect.poll(() => childNames(page, '1')).toEqual(['Notes', 'Pic', 'Reports']);
  });

  test('CUA alias: Shift+Delete cuts (does not delete)', async ({ page }) => {
    await load(page);
    await clickNode(page, '2.1');
    await page.keyboard.press('Shift+Delete');
    await expect.poll(() => logLines(page, LOG)).toContain('node-cut:2.1');
    expect(await clipboardOp(page)).toBe('cut');
    await expect(nodeByPath(page, '2.1')).toBeVisible();
    expect((await logLines(page, LOG)).some((l) => l.startsWith('node-delete:'))).toBe(false);
  });

  test('Escape cancels a pending cut (clipboard cleared, selection kept)', async ({ page }) => {
    await load(page);
    await clickNode(page, '1.2');
    await page.keyboard.press('Control+x');
    await expect.poll(() => clipboardOp(page)).toBe('cut');

    await page.keyboard.press('Escape');
    await expect.poll(() => clipboardOp(page)).toBeNull();
    // The cancel consumed Escape — the selection is untouched.
    expect(await selected(page)).toEqual(['1.2']);
  });

  test('a cut row (and its descendants) is dimmed; Escape un-dims it', async ({ page }) => {
    await load(page);
    await clickNode(page, '1.2');
    await page.keyboard.press('Control+x');
    await expect(nodeContent(nodeByPath(page, '1.2'))).toHaveClass(/wtv__node-content--cut/);

    await page.keyboard.press('Escape');
    await expect(nodeContent(nodeByPath(page, '1.2'))).not.toHaveClass(/wtv__node-content--cut/);
  });

  test('copy acts on the whole selected set', async ({ page }) => {
    await load(page);
    await clickNode(page, '1.2');
    await clickNode(page, '2.1', ['Control']);
    await page.keyboard.press('Control+c');
    await expect.poll(() => logLines(page, LOG)).toContain('node-copy:1.2,2.1');
  });
});

test.describe('handle-keyboard-shortcuts=false', () => {
  test('Ctrl+C / Ctrl+X / Delete do nothing', async ({ page }) => {
    await load(page, '?shortcuts=off');
    await clickNode(page, '1.2');
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+x');
    await page.keyboard.press('Delete');
    await page.waitForTimeout(100);
    expect(await clipboardOp(page)).toBeNull();
    await expect(nodeByPath(page, '1.2')).toBeVisible();
    const lines = await logLines(page, LOG);
    expect(lines.filter((l) => /^node-(copy|cut|delete)/.test(l))).toEqual([]);
  });

  test('arrow navigation keeps working', async ({ page }) => {
    await load(page, '?shortcuts=off');
    await clickNode(page, '1');
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => page.evaluate(() => (window as any).tree.focusedNode?.path)).toBe('2');
  });
});

test.describe('Ctrl+A / Escape selection', () => {
  test('Ctrl+A selects every visible selectable node (not hidden, not non-selectable)', async ({ page }) => {
    await load(page);
    await clickNode(page, '2.1'); // a leaf: clicking a branch would toggle it
    await page.keyboard.press('Control+a');
    await expect.poll(() => selected(page)).toEqual(['1', '1.1', '1.2', '2', '2.1']);
    await expect(nodeContent(nodeByPath(page, '3'))).not.toHaveClass(/wtv__node-content--selected/);
  });

  test('Escape clears the selection but keeps the checked set', async ({ page }) => {
    await load(page);
    await nodeByPath(page, '2.1').locator('.wtv__checkbox').first().click();
    await expect.poll(() => checked(page)).toEqual(['2.1']);

    await clickNode(page, '1.1');
    await clickNode(page, '1.2', ['Control']);
    expect(await selected(page)).toEqual(['1.1', '1.2']);

    await page.keyboard.press('Escape');
    await expect.poll(() => selected(page)).toEqual([]);
    expect(await checked(page)).toEqual(['2.1']);
    expect(await logLines(page, LOG)).toContain('selection-change:');
  });
});
