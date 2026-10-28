import { test, expect, Page, Locator, nodeByPath } from './fixtures';

/**
 * E2E coverage for the branch-operations test fixture at /test/branch-operations.html.
 *
 * Exercises addBranch / replaceBranch / removeBranch plus a minimal
 * cut/paste flow and failure-path buttons.
 *
 * Return shapes: addBranch → {success, count, failed[], parentNode, error?}
 * (svelte-treeview's InsertBranchResult); replaceBranch adds {removed, added};
 * removeBranch → {success, count, error?}.
 */

const PAGE = '/test/branch-operations.html';

async function gotoFixture(page: Page) {
  await page.goto(PAGE);
  await expect(page.locator('.wtv__node').first()).toBeVisible();
}

function readCount(page: Page, testId: string): Promise<number> {
  return page
    .getByTestId(testId)
    .textContent()
    .then((t) => Number(t ?? '0'));
}

test.beforeEach(async ({ page }) => {
  await gotoFixture(page);
  await expect(page.getByTestId('total-node-count')).toHaveText('8');
});

// ── Initial state ──────────────────────────────────────────────────────────

test.describe('initial state', () => {
  test('seed tree exposes 8 nodes and a clean lastOp / clipboard', async ({ page }) => {
    await expect(page.getByTestId('op-call-count')).toHaveText('0');
    await expect(page.getByTestId('total-node-count')).toHaveText('8');
    await expect(page.getByTestId('clipboard-source')).toHaveText('(empty)');
    await expect(page.getByTestId('last-op-name')).toHaveText('');

    for (const p of ['1', '1.1', '1.2', '2', '2.1', '2.1.1', '2.1.2', '3']) {
      await expect(nodeByPath(page, p)).toBeVisible();
    }
  });
});

// ── addBranch ───────────────────────────────────────────────────────────

test.describe('addBranch', () => {
  test('inserts a 3-node branch under "1" — one API call, count=3', async ({ page }) => {
    const before = await readCount(page, 'op-call-count');
    const totalBefore = await readCount(page, 'total-node-count');

    await page.getByTestId('btn-insert-under-1').click();

    await expect(page.getByTestId('last-op-name')).toHaveText('addBranch');
    await expect(page.getByTestId('last-op-success')).toHaveText('true');
    await expect(page.getByTestId('last-op-count')).toHaveText('3');
    await expect(page.getByTestId('last-op-failed-count')).toHaveText('0');
    await expect(page.getByTestId('last-op-error')).toHaveText('');

    await expect(page.getByTestId('op-call-count')).toHaveText(String(before + 1));
    await expect(page.getByTestId('total-node-count')).toHaveText(String(totalBefore + 3));

    await expect(page.getByText('New-Root')).toBeVisible();
    await expect(page.getByText('New-Child-A')).toBeVisible();
    await expect(page.getByText('New-Child-B')).toBeVisible();
  });

  test('inserts under "3" (a leaf) — succeeds and adds branch as descendants', async ({ page }) => {
    await page.getByTestId('btn-insert-under-3').click();

    await expect(page.getByTestId('last-op-success')).toHaveText('true');
    await expect(page.getByTestId('last-op-count')).toHaveText('3');
    await expect(page.getByTestId('total-node-count')).toHaveText('11');
  });
});

// ── replaceBranch ──────────────────────────────────────────────────────────

test.describe('replaceBranch', () => {
  test('replaces all descendants under "1" — old subtree gone, new subtree present', async ({ page }) => {
    await expect(nodeByPath(page, '1.1')).toBeVisible();
    await expect(nodeByPath(page, '1.2')).toBeVisible();

    await page.getByTestId('btn-replace-1').click();

    await expect(page.getByTestId('last-op-name')).toHaveText('replaceBranch');
    await expect(page.getByTestId('last-op-success')).toHaveText('true');
    await expect(page.getByTestId('last-op-count')).toHaveText('4');

    await expect(nodeByPath(page, '1.1')).toHaveCount(0);
    await expect(nodeByPath(page, '1.2')).toHaveCount(0);
    await expect(page.getByText('Replaced-1', { exact: true })).toBeVisible();
    await expect(page.getByText('Replaced-2', { exact: true })).toBeVisible();
    await expect(page.getByText('Replaced-3', { exact: true })).toBeVisible();
    await expect(page.getByText('Replaced-1-child', { exact: true })).toBeVisible();
  });

  test('replaceBranch is a single public-API call', async ({ page }) => {
    const before = await readCount(page, 'op-call-count');
    await page.getByTestId('btn-replace-2.1').click();
    await expect(page.getByTestId('op-call-count')).toHaveText(String(before + 1));
  });
});

// ── removeBranch ───────────────────────────────────────────────────────────

test.describe('removeBranch', () => {
  test('deletes "2.1" subtree — removedCount=3 (self + 2 grandchildren)', async ({ page }) => {
    await page.getByTestId('btn-delete-2.1').click();

    await expect(page.getByTestId('last-op-name')).toHaveText('removeBranch');
    await expect(page.getByTestId('last-op-success')).toHaveText('true');
    await expect(page.getByTestId('last-op-removed')).toHaveText('3');

    await expect(nodeByPath(page, '2.1')).toHaveCount(0);
    await expect(nodeByPath(page, '2.1.1')).toHaveCount(0);
    await expect(nodeByPath(page, '2.1.2')).toHaveCount(0);
    await expect(nodeByPath(page, '2')).toBeVisible();

    await expect(page.getByTestId('total-node-count')).toHaveText('5');
  });

  test('keepParent=true removes only descendants', async ({ page }) => {
    await page.getByTestId('btn-delete-2.1-keepParent').click();

    await expect(page.getByTestId('last-op-name')).toHaveText('removeBranch(keepParent)');
    await expect(page.getByTestId('last-op-success')).toHaveText('true');
    await expect(page.getByTestId('last-op-removed')).toHaveText('2');

    await expect(nodeByPath(page, '2.1')).toBeVisible();
    await expect(nodeByPath(page, '2.1.1')).toHaveCount(0);
    await expect(nodeByPath(page, '2.1.2')).toHaveCount(0);
  });

  test('removeBranch on a leaf removes only that leaf', async ({ page }) => {
    await page.getByTestId('btn-delete-3').click();
    await expect(page.getByTestId('last-op-removed')).toHaveText('1');
    await expect(nodeByPath(page, '3')).toHaveCount(0);
  });
});

// ── Cut / paste flow ──────────────────────────────────────────────────────

test.describe('cut/paste workflow', () => {
  test('cut populates clipboard; paste under another node moves the branch', async ({ page }) => {
    await page.getByTestId('btn-cut-2.1').click();
    await expect(page.getByTestId('clipboard-source')).toHaveText('2.1');

    const before = await readCount(page, 'op-call-count');
    await page.getByTestId('btn-paste-3').click();

    await expect(page.getByTestId('last-op-name')).toHaveText('paste:insert');
    await expect(page.getByTestId('last-op-success')).toHaveText('true');
    await expect(page.getByTestId('last-op-count')).toHaveText('3');

    await expect(page.getByTestId('op-call-count')).toHaveText(String(before + 2));
    await expect(page.getByTestId('clipboard-source')).toHaveText('(empty)');

    await expect(nodeByPath(page, '2.1')).toHaveCount(0);
    await expect(nodeByPath(page, '2.1.1')).toHaveCount(0);

    await expect(page.getByTestId('total-node-count')).toHaveText('8');
  });

  test('pasting into self records error and leaves clipboard intact', async ({ page }) => {
    await page.getByTestId('btn-cut-2.1').click();
    await expect(page.getByTestId('clipboard-source')).toHaveText('2.1');

    await page.getByTestId('btn-paste-into-self').click();

    await expect(page.getByTestId('last-op-name')).toHaveText('paste');
    await expect(page.getByTestId('last-op-success')).toHaveText('false');
    await expect(page.getByTestId('last-op-error')).toHaveText('Cannot paste into self or descendant');
    await expect(nodeByPath(page, '2.1')).toBeVisible();
    await expect(nodeByPath(page, '2.1.1')).toBeVisible();
  });

  test('Clear clipboard button empties the clipboard', async ({ page }) => {
    await page.getByTestId('btn-cut-1.1').click();
    await expect(page.getByTestId('clipboard-source')).toHaveText('1.1');

    await page.getByTestId('btn-clear-clipboard').click();
    await expect(page.getByTestId('clipboard-source')).toHaveText('(empty)');
  });
});

// ── Failure cases ─────────────────────────────────────────────────────────

test.describe('failure cases', () => {
  test('addBranch on a missing parent returns success=false', async ({ page }) => {
    const totalBefore = await readCount(page, 'total-node-count');

    await page.getByTestId('btn-fail-insert-parent').click();

    await expect(page.getByTestId('last-op-name')).toHaveText('addBranch(invalid-parent)');
    await expect(page.getByTestId('last-op-success')).toHaveText('false');
    await expect(page.getByTestId('last-op-count')).toHaveText('0');
    await expect(page.getByTestId('total-node-count')).toHaveText(String(totalBefore));
  });

  test('addBranch with mixed-validity items reports the failed ones', async ({ page }) => {
    const totalBefore = await readCount(page, 'total-node-count');
    await page.getByTestId('btn-fail-insert-items').click();

    await expect(page.getByTestId('last-op-name')).toHaveText('addBranch(mixed-validity)');
    await expect(page.getByTestId('last-op-success')).toHaveText('true');
    await expect(page.getByTestId('last-op-count')).toHaveText('2');
    await expect(page.getByTestId('last-op-failed-count')).toHaveText('2');
    await expect(page.getByTestId('total-node-count')).toHaveText(String(totalBefore + 2));
    await expect(page.getByText('Valid-1', { exact: true })).toBeVisible();
    await expect(page.getByText('Valid-2', { exact: true })).toBeVisible();
  });

  test('replaceBranch on a missing parent returns success=false', async ({ page }) => {
    const totalBefore = await readCount(page, 'total-node-count');

    await page.getByTestId('btn-fail-replace-parent').click();

    await expect(page.getByTestId('last-op-name')).toHaveText('replaceBranch(invalid-parent)');
    await expect(page.getByTestId('last-op-success')).toHaveText('false');
    await expect(page.getByTestId('total-node-count')).toHaveText(String(totalBefore));
  });

  test('removeBranch on a missing path returns success=false with an error message', async ({ page }) => {
    const totalBefore = await readCount(page, 'total-node-count');

    await page.getByTestId('btn-fail-delete-path').click();

    await expect(page.getByTestId('last-op-name')).toHaveText('removeBranch(invalid-path)');
    await expect(page.getByTestId('last-op-success')).toHaveText('false');
    await expect(page.getByTestId('last-op-removed')).toHaveText('0');
    await expect(page.getByTestId('last-op-error')).not.toHaveText('');
    await expect(page.getByTestId('total-node-count')).toHaveText(String(totalBefore));
  });
});

// ── Toggle marker reconciles across leaf↔folder transitions ─────────────────
// Regression: updateNode used to only flip the `expanded` class of an already-
// a-folder node, and the reconcile-skip check keyed on _rev + isExpanded only.
// hasChildren isn't captured by _rev (adding/removing a child doesn't bump the
// PARENT's _rev), so a leaf that GAINED children kept its empty --leaf-none slot
// (no ▼) and a folder that LOST all its children kept a stale --expand ▼.

function toggleClass(scope: Locator | Page, path: string): Promise<string> {
  return nodeByPath(scope, path)
    .locator('.wtv__toggle-icon')
    .first()
    .getAttribute('class')
    .then((c) => c ?? '');
}

test.describe('toggle marker reconciles across leaf↔folder transitions', () => {
  test('leaf that gains children swaps its leaf slot for an expand toggle', async ({ page }) => {
    // "3" is a leaf in the seed.
    expect(await toggleClass(page, '3')).toContain('wtv__toggle-icon--leaf-none');

    await page.getByTestId('btn-insert-under-3').click();
    await expect(page.getByTestId('last-op-success')).toHaveText('true');

    const cls = await toggleClass(page, '3');
    expect(cls).toContain('wtv__toggle-icon--expand');
    expect(cls).not.toContain('wtv__toggle-icon--leaf-none');
  });

  test('folder that loses all children falls back to a leaf slot (no stale arrow)', async ({ page }) => {
    // "2.1" is a folder (children 2.1.1 / 2.1.2) in the seed.
    expect(await toggleClass(page, '2.1')).toContain('wtv__toggle-icon--expand');

    await page.getByTestId('btn-delete-2.1-keepParent').click();
    await expect(page.getByTestId('last-op-success')).toHaveText('true');

    const cls = await toggleClass(page, '2.1');
    expect(cls).toContain('wtv__toggle-icon--leaf-none');
    expect(cls).not.toContain('wtv__toggle-icon--expand');
  });
});

// ── Reset ─────────────────────────────────────────────────────────────────

test.describe('reset', () => {
  test('Reset Tree button restores the initial seed and clears lastOp/clipboard', async ({ page }) => {
    await page.getByTestId('btn-insert-under-1').click();
    await page.getByTestId('btn-cut-2.1').click();
    await expect(page.getByTestId('clipboard-source')).toHaveText('2.1');

    await page.getByTestId('btn-reset').click();

    await expect(page.getByTestId('total-node-count')).toHaveText('8');
    await expect(page.getByTestId('op-call-count')).toHaveText('0');
    await expect(page.getByTestId('clipboard-source')).toHaveText('(empty)');
    await expect(page.getByTestId('last-op-name')).toHaveText('');
  });
});

// ── addBranch: placement by path + per-item failure reasons (TV-1) ──────

const insert = (page: Page, parentPath: string, items: unknown[]) =>
  page.evaluate(([pp, data]) => {
    const r = (window as any).tree.addBranch(pp, data);
    return {
      success: r.success,
      count: r.count,
      parentPath: r.parentNode?.path ?? null,
      failed: r.failed.map((f: { data: { name: string }; error: string }) => ({ name: f.data.name, error: f.error })),
    };
  }, [parentPath, items] as const);

test.describe('addBranch (TV-1)', () => {
  test('places every item by its own path — a whole subtree in one call, any input order', async ({ page }) => {
    const r = await insert(page, '2.1', [
      { id: 903, path: '2.1.9.1.1', name: 'Deep-leaf', sortOrder: 10 },
      { id: 902, path: '2.1.9.1', name: 'Deep-mid', sortOrder: 10 },
      { id: 901, path: '2.1.9', name: 'Deep-top', sortOrder: 30 },
    ]);
    expect(r).toEqual({ success: true, count: 3, parentPath: '2.1', failed: [] });
    expect(await page.evaluate(() => (window as any).tree.getNodeByPath('2.1.9.1.1')?.data?.name)).toBe('Deep-leaf');
    expect(await page.evaluate(() => (window as any).tree.getNodeByPath('2.1.9.1')?.parentPath)).toBe('2.1.9');
    expect(await page.evaluate(() => (window as any).tree.getChildren('2.1').map((n: any) => n.path))).toEqual(['2.1.1', '2.1.2', '2.1.9']);
  });

  test('failed reasons: empty path, duplicate path, not under the parent, missing parent', async ({ page }) => {
    const r = await insert(page, '1', [
      { id: 910, path: '1.10', name: 'Ok', sortOrder: 50 },
      { id: 911, path: '', name: 'Empty' },
      { id: 912, path: '1.1', name: 'Duplicate' },
      { id: 913, path: '2.13', name: 'Elsewhere' },
      { id: 914, path: '1.77.1', name: 'Orphan' },
    ]);
    expect(r.success).toBe(true);
    expect(r.count).toBe(1);
    const reason = (name: string) => r.failed.find((f) => f.name === name)?.error ?? '';
    expect(r.failed.map((f) => f.name).sort()).toEqual(['Duplicate', 'Elsewhere', 'Empty', 'Orphan']);
    expect(reason('Empty')).toContain('invalid path (empty string)');
    expect(reason('Duplicate')).toContain('already exists');
    expect(reason('Elsewhere')).toContain('is not under 1');
    expect(reason('Orphan')).toContain('Could not find parent node: 1.77');
    // Nothing failed was inserted; the duplicate kept the original node.
    expect(await page.evaluate(() => (window as any).tree.getNodeByPath('1.1')?.data?.name)).toBe('A-child-1');
    expect(await page.evaluate(() => (window as any).tree.getNodeByPath('2.13'))).toBeNull();
  });

  test('one console.warn summarises the failures; a clean insert warns nothing', async ({ page }) => {
    const warnings: string[] = [];
    page.on('console', (m) => { if (m.type() === 'warning') warnings.push(m.text()); });

    await insert(page, '3', [{ id: 920, path: '3.1', name: 'Clean' }]);
    expect(warnings.filter((w) => w.includes('addBranch'))).toEqual([]);

    await insert(page, '3', [{ id: 921, path: '', name: 'Bad-1' }, { id: 922, path: '9.9', name: 'Bad-2' }]);
    await expect.poll(() => warnings.filter((w) => w.includes('addBranch')).length).toBe(1);
    expect(warnings.find((w) => w.includes('addBranch'))).toContain('2 of 2 items failed');
  });

  test('replaceBranch returns the richer shape (failed, removed descendants, added)', async ({ page }) => {
    const r = await page.evaluate(() => {
      const res = (window as any).tree.replaceBranch('2', [
        { id: 930, path: '2.5', name: 'R-1' },
        { id: 931, path: '7', name: 'R-bad' },
      ]);
      return { success: res.success, count: res.count, added: res.added, removed: res.removed, failed: res.failed.length };
    });
    // '2' had 2.1, 2.1.1, 2.1.2 below it.
    expect(r).toEqual({ success: true, count: 1, added: 1, removed: 3, failed: 1 });
    expect(await page.evaluate(() => (window as any).tree.getChildren('2').map((n: any) => n.path))).toEqual(['2.5']);
  });
});

test('replaceBranch notifies the tree once (NOTES #2)', async ({ page }) => {
  const counts = await page.evaluate(async () => {
    const { createLTree } = await import('/src/ltree/ltree.ts' as string);
    const t = createLTree('id', 'path');
    t.insertArray([{ id: 1, path: '1' }, { id: 2, path: '1.1' }, { id: 3, path: '1.1.1' }, { id: 4, path: '2' }]);
    let n = 0;
    t.onChange = () => { n++; };
    const r1 = t.replaceBranch('1', [{ id: 5, path: '1.2' }, { id: 6, path: '1.2.1' }]);
    const withData = n;
    n = 0;
    const r2 = t.replaceBranch('1', []);
    return { withData, empty: n, removed1: r1.removed, removed2: r2.removed };
  });
  expect(counts).toEqual({ withData: 1, empty: 1, removed1: 2, removed2: 2 });
});

test('replaceBranch keeps the search index aligned: a node after the replaced branch is still found', async ({ page }) => {
  // Rebuild the fixture tree with the internal search index on (keyed by flat position).
  await page.evaluate(() => {
    const t = (window as any).tree;
    t.shouldUseInternalSearchIndex = true;
    t.searchValueMember = 'name';
    t.data = [
      { id: 1, path: '1', name: 'Root-A', sortOrder: 10 },
      { id: 2, path: '1.1', name: 'A-child-1', sortOrder: 10 },
      { id: 3, path: '1.2', name: 'A-child-2', sortOrder: 20 },
      { id: 4, path: '2', name: 'Root-B', sortOrder: 20 },
      { id: 5, path: '2.1', name: 'Bravo', sortOrder: 10 },
      { id: 6, path: '3', name: 'Charlie', sortOrder: 30 },
    ];
  });
  const find = (q: string) => page.evaluate((s) => (window as any).tree.searchNodes(s).map((n: any) => n?.path ?? null), q);
  await expect.poll(() => find('Charlie')).toEqual(['3']);

  // Replace 1's two children with one: the old positions of 1.1 / 1.2 go away.
  await page.evaluate(() => (window as any).tree.replaceBranch('1', [{ id: 7, path: '1.9', name: 'Delta', sortOrder: 10 }]));

  await expect.poll(() => find('Charlie')).toEqual(['3']);
  await expect.poll(() => find('Bravo')).toEqual(['2.1']);
  await expect.poll(() => find('Delta')).toEqual(['1.9']);
  expect(await find('A-child')).toEqual([]);
});
