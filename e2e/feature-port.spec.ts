import { test, expect, Page, Locator, nodeContent, nodeByPath } from './fixtures';

/**
 * E2E coverage for /test/feature-port.html — the rc-cycle features ported from
 * svelte-treeview: data-driven per-row class hooks (nodeClass / nodeContentClass),
 * the onNodeDoubleClick event (manual detection), and the post-operation
 * clipboard events (onNodeCopy / onNodeCut / onNodePaste).
 *
 * Data (sorted by name):
 *   '1'   Documents (folder)
 *   '1.1' Reports   (folder)
 *   '1.2' Notes.txt (file)
 *   '2'   Images    (folder)
 *   '2.1' Photo.jpg (file)
 */

const PAGE = '/test/feature-port.html';

function tree(page: Page): Locator {
  return page.locator('.tree-container').first();
}

function nodeAt(page: Page, path: string): Locator {
  return nodeByPath(tree(page), path);
}

function dblLog(page: Page): Locator {
  return page.getByTestId('dbl-log');
}

function clipLog(page: Page): Locator {
  return page.getByTestId('clip-log');
}

async function goto(page: Page) {
  await page.goto(PAGE);
  await expect(page.locator('.wtv__node').first()).toBeVisible();
}

test.describe('Per-row class hooks', () => {
  test('nodeClass lands on .wtv__node and nodeContentClass on .wtv__node-content, by data', async ({ page }) => {
    await goto(page);

    // Folder row
    await expect(nodeAt(page, '1')).toHaveClass(/is-folder/);
    await expect(nodeContent(nodeAt(page, '1'))).toHaveClass(/row-folder/);

    // File row
    await expect(nodeAt(page, '1.2')).toHaveClass(/is-file/);
    await expect(nodeContent(nodeAt(page, '1.2'))).toHaveClass(/row-file/);

    // The two are mutually exclusive — a folder is not tagged is-file.
    await expect(nodeAt(page, '1')).not.toHaveClass(/is-file/);
  });
});

test.describe('onNodeDoubleClick', () => {
  test('double-clicking a node fires the event', async ({ page }) => {
    await goto(page);
    await nodeContent(nodeAt(page, '1')).dblclick();
    await expect(dblLog(page)).toContainText('dblclick "Documents"');
  });

  test('a single click does not fire it', async ({ page }) => {
    await goto(page);
    await nodeContent(nodeAt(page, '1')).click();
    // Give any (incorrect) double-click detection a chance to flush.
    await page.waitForTimeout(450);
    await expect(dblLog(page)).toHaveText('');
  });
  test('a Ctrl+click on another node in between breaks the double-click (NOTES #25)', async ({ page }) => {
    await goto(page);
    // three quick clicks via raw events (no Playwright actionability delays)
    await page.evaluate(() => {
      const host = document.querySelector('web-treeview')!;
      const content = (p: string) => host.shadowRoot!.querySelector(`.wtv__node[data-tree-path="${p}"] .wtv__node-content`) as HTMLElement;
      content('1').dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
      content('2').dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, ctrlKey: true }));
      content('1').dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    });
    await page.waitForTimeout(100);
    await expect(dblLog(page)).toHaveText('');
  });

  test('a toggle click in between breaks it too', async ({ page }) => {
    await goto(page);
    await page.evaluate(() => {
      const host = document.querySelector('web-treeview')!;
      const row = (p: string) => host.shadowRoot!.querySelector(`.wtv__node[data-tree-path="${p}"]`) as HTMLElement;
      const content = row('1').querySelector('.wtv__node-content') as HTMLElement;
      const toggle = row('2').querySelector('.wtv__toggle-icon') as HTMLElement;
      content.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
      content.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    });
    await page.waitForTimeout(100);
    await expect(dblLog(page)).toHaveText('');
  });
});

test.describe('Clipboard events', () => {
  test('copy then paste fires onNodeCopy + onNodePaste and adds a node', async ({ page }) => {
    await goto(page);
    const before = await tree(page).locator('.wtv__node').count();

    await page.getByRole('button', { name: 'Copy 1.1' }).click();
    await expect(clipLog(page)).toContainText('copy 1.1');

    await page.getByRole('button', { name: 'Paste into 2' }).click();
    await expect(clipLog(page)).toContainText('paste 1');

    await expect(tree(page).locator('.wtv__node')).toHaveCount(before + 1);
  });

  test('cut fires onCut', async ({ page }) => {
    await goto(page);
    await page.getByRole('button', { name: 'Cut 1.2' }).click();
    await expect(clipLog(page)).toContainText('cut 1.2');
  });
});

test.describe('Clipboard interceptors', () => {
  test('beforeCopyCallback overrides which paths are copied', async ({ page }) => {
    await goto(page);
    await page.getByText('beforeCopy → 1.2').click();

    await page.getByRole('button', { name: 'Copy 1.1' }).click();
    // The interceptor redirected the copy to 1.2 (Notes.txt), so onNodeCopy reports 1.2.
    await expect(clipLog(page)).toContainText('copy 1.2');
    await expect(clipLog(page)).not.toContainText('copy 1.1');
  });

  test('beforePasteCallback returning false blocks the paste', async ({ page }) => {
    await goto(page);
    const before = await tree(page).locator('.wtv__node').count();

    await page.getByText('Block paste').click();
    await page.getByRole('button', { name: 'Copy 1.1' }).click();
    await page.getByRole('button', { name: 'Paste into 2' }).click();

    // Paste was blocked: no node added, and no node-paste event (nothing happened).
    await expect(clipLog(page)).toContainText('copy 1.1');
    await expect(tree(page).locator('.wtv__node')).toHaveCount(before);
    await expect(clipLog(page)).not.toContainText('paste');
  });
});
