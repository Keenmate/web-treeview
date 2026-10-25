import { test, expect, type Page, nodeByPath, nodeContent } from './fixtures';

/**
 * Logging is silent by default; the core /logging controls turn it on; debug
 * panel + tree-id smoke (/test/logging.html).
 *
 *   1 A ── 1.1 A1
 *   2 B
 */

const PAGE = '/test/logging.html';

/** Console messages the component produced (Vite's own chatter filtered out). */
function collectConsole(page: Page): string[] {
  const out: string[] = [];
  page.on('console', (m) => {
    const t = m.text();
    if (t.startsWith('[vite]')) return;
    if (m.type() === 'log' || m.type() === 'debug' || m.type() === 'info') out.push(t);
  });
  return out;
}

async function load(page: Page, query = '') {
  await page.goto(PAGE + query);
  await expect(nodeByPath(page, '2')).toBeVisible();
}

/** Typical session: click, toggle, drag a row onto another. */
async function exercise(page: Page) {
  await nodeContent(nodeByPath(page, '1.1')).click();
  await nodeByPath(page, '1').locator('> .wtv__node-row .wtv__toggle-icon').first().click();
  await nodeByPath(page, '1').locator('> .wtv__node-row .wtv__toggle-icon').first().click();
  const box = (await nodeContent(nodeByPath(page, '2')).boundingBox())!;
  await nodeContent(nodeByPath(page, '1.1')).dragTo(nodeContent(nodeByPath(page, '2')), {
    targetPosition: { x: box.width * 0.8, y: box.height / 2 }
  });
  await page.waitForTimeout(200);
}

test('silent by default: building, clicking, expanding and dragging log nothing', async ({ page }) => {
  const logs = collectConsole(page);
  await load(page);
  await exercise(page);
  expect(logs).toEqual([]);
});

test('TREEVIEW:UI is silent until logging.enableLogging() turns the categories on', async ({ page }) => {
  const logs = collectConsole(page);
  await load(page);
  await nodeByPath(page, '1').locator('> .wtv__node-row .wtv__toggle-icon').first().click();
  await page.waitForTimeout(100);
  expect(logs.some((l) => l.includes('TREEVIEW:UI'))).toBe(false);
  await page.evaluate(() => (window as any).components['web-treeview'].logging.enableLogging());
  logs.length = 0;
  // toggling a branch logs on TREEVIEW:UI (silent before enableLogging)
  await nodeByPath(page, '1').locator('> .wtv__node-row .wtv__toggle-icon').first().click();
  await expect.poll(() => logs.some((l) => l.includes('TREEVIEW:UI'))).toBe(true);
  await page.evaluate(() => (window as any).components['web-treeview'].logging.disableLogging());
});

test.describe('debug smoke', () => {
  test('should-display-debug-information shows the debug panel', async ({ page }) => {
    await load(page, '?should-display-debug-information=true');
    const dbg = page.locator('.wtv__debug-info');
    await expect(dbg).toBeVisible();
    await expect(dbg).not.toBeEmpty();
  });

  test('off by default', async ({ page }) => {
    await load(page);
    await expect(page.locator('.wtv__debug-info')).toBeHidden();
  });

  test('tree-id: rows carry it in their element id; nodes report it', async ({ page }) => {
    await load(page);
    await expect(nodeByPath(page, '1.1')).toHaveAttribute('id', 'docs-tree-11');
    expect(await page.evaluate(() => (window as any).tree.getNodeByPath('1.1')?.treeId)).toBe('docs-tree');
  });
});
