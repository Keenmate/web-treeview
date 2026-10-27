import { test, expect, type Page, logLines } from './fixtures';

/**
 * Cross-tree drag + Ctrl copy-drop (/test/drag-cross-tree.html).
 *
 *   tree A: 1 A-Folder ── 1.1 A-File;  2 A-Leaf
 *   tree B: 1 B-Folder ── 1.1 B-File
 *
 * Drags are synthesized (dragstart → dragover → drop → dragend) so Ctrl can
 * ride on the drop event. Every drop lands on the target's right half → "child".
 */

const PAGE = '/test/drag-cross-tree.html';
const LOG = 'xt-log';

async function load(page: Page, query = '') {
  await page.goto(PAGE + query);
  await expect(page.locator('#tree-b .wtv__node[data-tree-path="1.1"]')).toBeVisible();
  await expect(page.locator('#tree-a .wtv__node[data-tree-path="2"]')).toBeVisible();
}

const names = (page: Page, id: 'A' | 'B'): Promise<string[]> => page.evaluate((id) => (window as any).names(id), id);
const drag = (page: Page, from: string, fromPath: string, to: string, toPath: string, ctrl = false) =>
  page.evaluate(([f, fp, t, tp, c]) => (window as any).synthDrag(f, fp, t, tp, { ctrl: c }), [from, fromPath, to, toPath, ctrl] as const);
const drops = async (page: Page) => (await logLines(page, LOG)).filter((l) => l.includes(':node-drop:'));

test.describe('same tree (baseline for the synthesized drag)', () => {
  test('plain drop moves the node', async ({ page }) => {
    await load(page);
    await drag(page, 'A', '2', 'A', '1');
    await expect.poll(() => names(page, 'A')).toEqual(['A-Folder', '  A-File', '  A-Leaf']);
  });

  test('Ctrl-drop with allow-copy copies it; the source stays', async ({ page }) => {
    await load(page);
    await drag(page, 'A', '2', 'A', '1', true);
    await expect.poll(() => names(page, 'A')).toEqual(['A-Folder', '  A-File', '  A-Leaf', 'A-Leaf']);
    expect(await drops(page)).toEqual(['A:node-drop:copy:A-Leaf:child:A-Folder:dropped=1']);
  });

  test('Ctrl-drop runs nodeOutputTransformationCallback on the copy', async ({ page }) => {
    await load(page, '?redact');
    await drag(page, 'A', '2', 'A', '1', true);
    await expect.poll(() => names(page, 'A'), { timeout: 2000 }).toContain('  A-Leaf (copy)');
  });

  test('Ctrl-drop without allow-copy stays a move', async ({ page }) => {
    await load(page, '?nocopy');
    await drag(page, 'A', '2', 'A', '1', true);
    await expect.poll(() => names(page, 'A')).toEqual(['A-Folder', '  A-File', '  A-Leaf']);
  });
});

test.describe('A → B', () => {
  test('a cross-tree move is handed to the consumer: node-drop on B, dropped=null, trees untouched', async ({ page }) => {
    await load(page);
    await drag(page, 'A', '2', 'B', '1');
    await expect.poll(() => drops(page)).toEqual(['B:node-drop:move:A-Leaf:child:B-Folder:dropped=null']);
    expect(await names(page, 'A')).toEqual(['A-Folder', '  A-File', 'A-Leaf']);
    expect(await names(page, 'B')).toEqual(['B-Folder', '  B-File']);
  });

  test('Ctrl-drop copies the subtree into B; A keeps it', async ({ page }) => {
    await load(page);
    await drag(page, 'A', '1', 'B', '1', true);
    await expect.poll(() => names(page, 'B')).toEqual(['B-Folder', '  B-File', '  A-Folder', '    A-File']);
    expect(await names(page, 'A')).toEqual(['A-Folder', '  A-File', 'A-Leaf']);
    expect(await drops(page)).toEqual(['B:node-drop:copy:A-Folder:child:B-Folder:dropped=1']);
  });

  test("the source tree's nodeOutputTransformationCallback cleans the copied data", async ({ page }) => {
    await load(page, '?redact');
    await drag(page, 'A', '2', 'B', '1', true);
    await expect.poll(() => names(page, 'B'), { timeout: 2000 }).toContain('  A-Leaf (copy)');
    expect(await names(page, 'A')).toContain('A-Leaf');
  });

  test('auto-handle-copy="false": the copy-drop only notifies (dropped=null), B unchanged', async ({ page }) => {
    await load(page, '?autocopy=off');
    await drag(page, 'A', '2', 'B', '1', true);
    await expect.poll(() => drops(page)).toEqual(['B:node-drop:copy:A-Leaf:child:B-Folder:dropped=null']);
    expect(await names(page, 'B')).toEqual(['B-Folder', '  B-File']);
  });
});

// TV-5 (NOTES.md #5) cross-tree variant: absorption selection (A-1, Ctrl A, Ctrl B)
// dropped into tree B as a child of B-Folder. A cross-tree MOVE is handed to the
// consumer (trees untouched); a Ctrl copy-drop is auto-handled.
test.describe('A → B with a top-level-absorbed selection (TV-5)', () => {
  const rowA = (page: Page, path: string) =>
    page.locator(`#tree-a .wtv__node[data-tree-path="${path}"] > .wtv__node-row .wtv__node-content`).first();

  async function selectAbsorbed(page: Page) {
    await rowA(page, '1.1').click();
    await rowA(page, '1').click({ modifiers: ['Control'] });
    await rowA(page, '2').click({ modifiers: ['Control'] });
    expect(await page.evaluate(() => [...(window as any).trees.A.selectedPaths].sort())).toEqual(['1', '1.1', '2']);
  }

  const lastDrop = (page: Page) => page.evaluate(() => (window as any).lastDrop);

  test('move: node-drop on B carries exactly the top-level paths [A, B] (A-1 absorbed); trees untouched', async ({ page }) => {
    await load(page, '?multi');
    await selectAbsorbed(page);
    await drag(page, 'A', '1', 'B', '1');
    await expect.poll(() => lastDrop(page)).toMatchObject({
      tree: 'B', operation: 'move', draggedPaths: ['1', '2'], dropped: null,
    });
    expect(await names(page, 'A')).toEqual(['Multi-A', '  A-1', '  A-2', 'Multi-B', 'Multi-C']);
    expect(await names(page, 'B')).toEqual(['B-Folder', '  B-File']);
  });

  test('move: the cross-tree dragged refs carry the SOURCE nodes', async ({ page }) => {
    await load(page, '?multi');
    await selectAbsorbed(page);
    await drag(page, 'A', '1', 'B', '1');
    await expect.poll(() => lastDrop(page), { timeout: 2000 }).toMatchObject({ dragged: ['Multi-A', 'Multi-B'] });
  });

  test('Ctrl copy-drop: B gets A (with A-1, A-2 inside) and B under B-Folder, no duplicates; A keeps all', async ({ page }) => {
    await load(page, '?multi');
    await selectAbsorbed(page);
    await drag(page, 'A', '1', 'B', '1', true);
    await expect.poll(() => names(page, 'B')).toEqual([
      'B-Folder', '  B-File', '  Multi-A', '    A-1', '    A-2', '  Multi-B',
    ]);
    expect(await names(page, 'A')).toEqual(['Multi-A', '  A-1', '  A-2', 'Multi-B', 'Multi-C']);
  });
});
