import { test, expect, Page, Locator, nodeContent, nodeByPath } from './fixtures';

/**
 * E2E coverage for /test/clipboard-extended.html — the rc07 structural port from
 * svelte-treeview: built-in Delete (Delete key / onDelete / beforeDeleteCallback), removeNodes(),
 * the paste transform (pasteNodeTransformationCallback null-skip + PasteResult.skipped),
 * and the onTreeKeydown interceptor.
 *
 * Data (sorted by name):
 *   '1'     Documents
 *   '1.1'   Reports
 *   '1.1.1' Q1.txt
 *   '1.1.2' Q2.txt
 *   '1.2'   Notes.txt
 *   '2'     Images
 */

const PAGE = '/test/clipboard-extended.html';

function tree(page: Page): Locator {
  return page.locator('.tree-container').first();
}

function nodeAt(page: Page, path: string): Locator {
  return nodeByPath(tree(page), path);
}

async function goto(page: Page) {
  await page.goto(PAGE);
  await expect(page.locator('.wtv__node').first()).toBeVisible();
}

test.describe('Built-in Delete', () => {
  test('Delete key removes the focused node and fires onDelete with pre-removal names', async ({ page }) => {
    await goto(page);
    await expect(nodeAt(page, '1.2')).toBeVisible();

    // Click to focus/selection Notes.txt, then press Delete.
    await nodeContent(nodeAt(page, '1.2')).click();
    await page.keyboard.press('Delete');

    await expect(nodeAt(page, '1.2')).toHaveCount(0);
    await expect(page.getByTestId('del-log')).toContainText('deleted Notes.txt');
  });

  test('removeNodes() API removes a subtree silently (no beforeDeleteCallback, no node-delete)', async ({ page }) => {
    await goto(page);
    await page.getByText('beforeDelete → block').click();
    await page.getByRole('button', { name: 'removeNodes(1.2)' }).click();

    await expect(nodeAt(page, '1.2')).toHaveCount(0);
    await expect(page.getByTestId('paste-log')).toContainText('remove removed=1 failed=0');
    await expect(page.getByTestId('del-log')).toHaveText('');
  });

  test('beforeDeleteCallback returning false blocks the Delete command', async ({ page }) => {
    await goto(page);
    await page.getByText('beforeDelete → block').click();
    await nodeContent(nodeAt(page, '1.2')).click();
    await page.keyboard.press('Delete');

    await expect(nodeAt(page, '1.2')).toBeVisible();
    await expect(page.getByTestId('del-log')).toHaveText('');
  });
});

test.describe('Paste transform', () => {
  test('nodeInputTransformationCallback returning null skips a node and counts it', async ({ page }) => {
    await goto(page);

    // Copy Reports (1.1) — subtree Reports + Q1.txt + Q2.txt. The transform
    // vetoes Q2.txt, so the paste lands Reports + Q1 (count 2), skips 1.
    await page.getByRole('button', { name: 'Copy 1.1' }).click();
    await page.getByRole('button', { name: 'Paste into 2' }).click();

    await expect(page.getByTestId('paste-log')).toContainText('paste count=2 skipped=1');
  });
});

test.describe('beforeKeydownCallback interceptor', () => {
  test('returning false suppresses the built-in Delete', async ({ page }) => {
    await goto(page);
    await page.getByText('beforeKeydownCallback → suppress').click();

    await nodeContent(nodeAt(page, '1.2')).click();
    await page.keyboard.press('Delete');

    // Interceptor consumed the key — the node survives and the interceptor logged.
    await expect(nodeAt(page, '1.2')).toBeVisible();
    await expect(page.getByTestId('key-log')).toContainText('intercept Delete');
    await expect(page.getByTestId('del-log')).toHaveText('');
  });
});

// ── Extended: cut interceptor, output transform, clipboard state API, auto-handle-paste ──

async function gotoWith(page: Page, query: string) {
  await page.goto(PAGE + query);
  await expect(nodeAt(page, '2')).toBeVisible();
}

const clip = (page: Page) =>
  page.evaluate(() => ({ has: (window as any).tree.hasClipboardContent(), op: (window as any).tree.getClipboardOperation() }));
const childNames = (page: Page, p: string): Promise<string[]> => page.evaluate((p) => (window as any).childNames(p), p);

test.describe('beforeCutCallback', () => {
  test('returning false blocks the cut (clipboard untouched, no node-cut)', async ({ page }) => {
    await gotoWith(page, '?cut=veto');
    await page.evaluate(() => (window as any).tree.cutNodes(['1.1']));
    await expect(page.getByTestId('paste-log')).toContainText('before-cut 1.1');
    expect(await clip(page)).toEqual({ has: false, op: null });
    expect((await page.getByTestId('paste-log').textContent())!.split('\n')).not.toContain('cut 1.1');
  });

  test('returning string[] replaces the cut paths', async ({ page }) => {
    await gotoWith(page, '?cut=override');
    await page.evaluate(() => (window as any).tree.cutNodes(['1.1']));
    await expect(page.getByTestId('paste-log')).toContainText('cut 1.2');
    expect(await clip(page)).toEqual({ has: true, op: 'cut' });
  });
});

test.describe('clipboard state API', () => {
  test('hasClipboardContent / getClipboardOperation follow copy, cut and cancelCut', async ({ page }) => {
    await gotoWith(page, '');
    expect(await clip(page)).toEqual({ has: false, op: null });
    await page.evaluate(() => (window as any).tree.copyNodes(['1.2']));
    expect(await clip(page)).toEqual({ has: true, op: 'copy' });
    await page.evaluate(() => (window as any).tree.cutNodes(['1.2']));
    expect(await clip(page)).toEqual({ has: true, op: 'cut' });
    await page.evaluate(() => (window as any).tree.cancelCut());
    expect(await clip(page)).toEqual({ has: false, op: null });
  });

  test('cancelCut leaves a copy on the clipboard alone', async ({ page }) => {
    await gotoWith(page, '');
    await page.evaluate(() => (window as any).tree.copyNodes(['1.2']));
    await page.evaluate(() => (window as any).tree.cancelCut());
    expect(await clip(page)).toEqual({ has: true, op: 'copy' });
  });
});

test('nodeOutputTransformationCallback cleans the data as it leaves the source', async ({ page }) => {
  await gotoWith(page, '?output=redact');
  await page.evaluate(() => (window as any).tree.copyNodes(['1.2']));
  await page.evaluate(() => (window as any).tree.pasteNodes('2', undefined, 'child'));
  await expect.poll(() => childNames(page, '2')).toEqual(['Notes.txt (copy)']);
  // the source node is untouched
  expect(await childNames(page, '1')).toEqual(['Notes.txt', 'Reports']);
});

test('auto-handle-paste="false": node-paste carries the entries, the tree is not mutated', async ({ page }) => {
  await gotoWith(page, '?autopaste=off');
  await page.evaluate(() => (window as any).tree.copyNodes(['1.2']));
  await page.evaluate(() => (window as any).tree.pasteNodes('2', undefined, 'child'));
  await expect(page.getByTestId('paste-log')).toContainText('node-paste success=true count=1 entries=Notes.txt');
  expect(await childNames(page, '2')).toEqual([]);
});

test.describe('Paste into a collapsed node', () => {
  const isExpanded = (page: Page, p: string) =>
    page.evaluate((p) => !!(window as any).tree.controller.getNodeRef(p).node?.isExpanded, p);

  test("position 'child' expands the target and reveals the first pasted node", async ({ page }) => {
    await gotoWith(page, '?many=1');
    await page.evaluate(() => (window as any).tree.collapseNodes('2'));
    await expect(nodeAt(page, '2.1')).toHaveCount(0);
    await page.evaluate(() => (window as any).tree.copyNodes(['1.2']));
    await page.evaluate(() => (window as any).tree.pasteNodes('2', undefined, 'child'));
    await expect.poll(() => isExpanded(page, '2')).toBe(true);
    // 'Notes.txt' sorts after the 60 'Img NN' rows — far below the fold, scrolled into view.
    const pasted = tree(page).locator('.wtv__node').filter({ hasText: /^Notes\.txt$/ }).last();
    await expect(pasted).toBeInViewport();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  });

  test("position 'after' leaves a collapsed node collapsed", async ({ page }) => {
    await goto(page);
    await page.evaluate(() => (window as any).tree.collapseNodes('1.1'));
    await page.evaluate(() => (window as any).tree.copyNodes(['2']));
    await page.evaluate(() => (window as any).tree.pasteNodes('1.1', undefined, 'after'));
    await expect.poll(() => childNames(page, '1')).toEqual(['Images', 'Notes.txt', 'Reports']);
    expect(await isExpanded(page, '1.1')).toBe(false);
  });
});
