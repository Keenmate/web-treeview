import { test, expect, Page, Locator, nodeContent, nodeByPath } from './fixtures';

/**
 * E2E coverage for /test/clipboard-extended.html — the rc07 structural port from
 * svelte-treeview: built-in Delete (deleteNodes / onDelete / beforeDeleteCallback),
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

  test('deleteNodes() API removes a subtree and reports removed count', async ({ page }) => {
    await goto(page);
    await page.getByRole('button', { name: 'deleteNodes(1.2)' }).click();

    await expect(nodeAt(page, '1.2')).toHaveCount(0);
    await expect(page.getByTestId('paste-log')).toContainText('delete removed=1 blocked=0');
    await expect(page.getByTestId('del-log')).toContainText('deleted Notes.txt');
  });

  test('beforeDeleteCallback returning false blocks the delete', async ({ page }) => {
    await goto(page);
    await page.getByText('beforeDelete → block').click();
    await page.getByRole('button', { name: 'deleteNodes(1.2)' }).click();

    await expect(nodeAt(page, '1.2')).toBeVisible();
    await expect(page.getByTestId('paste-log')).toContainText('delete removed=0 blocked=1');
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
