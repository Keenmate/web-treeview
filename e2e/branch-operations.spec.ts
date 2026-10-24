import { test, expect, Page, Locator, nodeByPath } from './fixtures';

/**
 * E2E coverage for the branch-operations test fixture at /test/branch-operations.html.
 *
 * Exercises insertBranch / replaceBranch / deleteBranch plus a minimal
 * cut/paste flow and failure-path buttons.
 *
 * Web-treeview's return shapes differ slightly from svelte-treeview's:
 *   - insertBranch returns {success, count, error?} (no failed[]). The fixture
 *     computes a failed count from input length minus inserted count.
 *   - replaceBranch returns {success, removed, added, error?}. The fixture
 *     mirrors `added` into the `last-op-count` readout.
 *   - deleteBranch returns {success, count, error?}. The fixture mirrors
 *     `count` into `last-op-removed`.
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

// ── insertBranch ───────────────────────────────────────────────────────────

test.describe('insertBranch', () => {
  test('inserts a 3-node branch under "1" — one API call, count=3', async ({ page }) => {
    const before = await readCount(page, 'op-call-count');
    const totalBefore = await readCount(page, 'total-node-count');

    await page.getByTestId('btn-insert-under-1').click();

    await expect(page.getByTestId('last-op-name')).toHaveText('insertBranch');
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

// ── deleteBranch ───────────────────────────────────────────────────────────

test.describe('deleteBranch', () => {
  test('deletes "2.1" subtree — removedCount=3 (self + 2 grandchildren)', async ({ page }) => {
    await page.getByTestId('btn-delete-2.1').click();

    await expect(page.getByTestId('last-op-name')).toHaveText('deleteBranch');
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

    await expect(page.getByTestId('last-op-name')).toHaveText('deleteBranch(keepParent)');
    await expect(page.getByTestId('last-op-success')).toHaveText('true');
    await expect(page.getByTestId('last-op-removed')).toHaveText('2');

    await expect(nodeByPath(page, '2.1')).toBeVisible();
    await expect(nodeByPath(page, '2.1.1')).toHaveCount(0);
    await expect(nodeByPath(page, '2.1.2')).toHaveCount(0);
  });

  test('deleteBranch on a leaf removes only that leaf', async ({ page }) => {
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
  test('insertBranch on a missing parent returns success=false', async ({ page }) => {
    const totalBefore = await readCount(page, 'total-node-count');

    await page.getByTestId('btn-fail-insert-parent').click();

    await expect(page.getByTestId('last-op-name')).toHaveText('insertBranch(invalid-parent)');
    await expect(page.getByTestId('last-op-success')).toHaveText('false');
    await expect(page.getByTestId('last-op-count')).toHaveText('0');
    await expect(page.getByTestId('total-node-count')).toHaveText(String(totalBefore));
  });

  // The Svelte build validates each item in insertBranch and rejects empty
  // and null paths. Web-treeview's addNode is more lenient; the mixed-validity
  // contract isn't currently honored. Tracked as a follow-up.
  test.skip('insertBranch with mixed-validity items reports failed count — addNode validation gap', () => {});

  test('replaceBranch on a missing parent returns success=false', async ({ page }) => {
    const totalBefore = await readCount(page, 'total-node-count');

    await page.getByTestId('btn-fail-replace-parent').click();

    await expect(page.getByTestId('last-op-name')).toHaveText('replaceBranch(invalid-parent)');
    await expect(page.getByTestId('last-op-success')).toHaveText('false');
    await expect(page.getByTestId('total-node-count')).toHaveText(String(totalBefore));
  });

  test('deleteBranch on a missing path returns success=false with an error message', async ({ page }) => {
    const totalBefore = await readCount(page, 'total-node-count');

    await page.getByTestId('btn-fail-delete-path').click();

    await expect(page.getByTestId('last-op-name')).toHaveText('deleteBranch(invalid-path)');
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
