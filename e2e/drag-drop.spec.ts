import { test, expect, Page, Locator, nodeByPath } from './fixtures';

/**
 * E2E coverage for the drag-and-drop test fixture at /test/drag-drop.html.
 *
 * Covers (in this port): single-tree drag, allowedDropPositionsMember,
 * getAllowedDropPositionsCallback, and multi-drag.
 *
 * Two-tree drag + Ctrl-drag copy live in drag-cross-tree.spec.ts (synthesized
 * drag events carry Ctrl); touch drag in touch-drag.spec.ts. The Chromium
 * native-drag-synth chain is flaky for the modifier-aware paths.
 */

const PAGE = '/test/drag-drop.html';

async function gotoFixture(page: Page) {
  await page.goto(PAGE);
  await expect(page.locator('.wtv__node').first()).toBeVisible();
}

function nodeRow(node: Locator): Locator {
  return node.locator('> .wtv__node-row .wtv__node-content').first();
}

async function dragNodeTo(
  src: Locator,
  dst: Locator,
  position: 'before' | 'after' | 'child'
) {
  const box = await dst.boundingBox();
  if (!box) throw new Error('Missing target boundingBox');
  let x: number;
  let y: number;
  if (position === 'child') {
    x = box.width * 0.8;
    y = box.height / 2;
  } else {
    x = box.width * 0.2;
    y = position === 'before' ? Math.max(1, box.height * 0.15) : box.height * 0.85;
  }
  await src.dragTo(dst, { targetPosition: { x, y } });
}

// ── Section 1: single-tree drag ────────────────────────────────────────────

test.describe('single-tree drag', () => {
  test('drag fires onNodeDrop with operation=move and dragged/target names', async ({ page }) => {
    await gotoFixture(page);
    const section = page.getByTestId('section-single');

    await expect(page.getByTestId('single-drop-count')).toHaveText('0');

    await dragNodeTo(nodeRow(nodeByPath(section, '1.1')), nodeRow(nodeByPath(section, '2')), 'after');

    await expect(page.getByTestId('single-drop-count')).toHaveText('1');
    await expect(page.getByTestId('single-drop-dragged')).toHaveText('Alpha-1');
    await expect(page.getByTestId('single-drop-target')).toHaveText('Beta');
    await expect(page.getByTestId('single-drop-operation')).toHaveText('move');
  });

  test('drop on right half of a target resolves to "child"', async ({ page }) => {
    await gotoFixture(page);
    const section = page.getByTestId('section-single');

    await dragNodeTo(nodeRow(nodeByPath(section, '1.1')), nodeRow(nodeByPath(section, '2')), 'child');

    await expect(page.getByTestId('single-drop-count')).toHaveText('1');
    await expect(page.getByTestId('single-drop-position')).toHaveText('child');
  });

  test('drop on left-top of a target resolves to "before"', async ({ page }) => {
    await gotoFixture(page);
    const section = page.getByTestId('section-single');

    await dragNodeTo(
      nodeRow(nodeByPath(section, '2.1')),
      nodeRow(nodeByPath(section, '1.2')),
      'before'
    );

    await expect(page.getByTestId('single-drop-count')).toHaveText('1');
    await expect(page.getByTestId('single-drop-position')).toHaveText('before');
  });
});

// ── Section 3: restricted positions via allowedDropPositionsMember ─────────

test.describe('restricted drop positions — allowedDropPositionsMember', () => {
  test('node restricted to ["child"] snaps "before" intent to "child"', async ({ page }) => {
    await gotoFixture(page);
    const section = page.getByTestId('section-restricted-member');

    await dragNodeTo(
      nodeRow(nodeByPath(section, '4')),
      nodeRow(nodeByPath(section, '1')),
      'before'
    );

    await expect(page.getByTestId('r-member-drop-count')).toHaveText('1');
    await expect(page.getByTestId('r-member-drop-target')).toHaveText('TrashChildOnly');
    await expect(page.getByTestId('r-member-drop-position')).toHaveText('child');
  });

  test('node restricted to ["before","after"] does not resolve to "child"', async ({ page }) => {
    await gotoFixture(page);
    const section = page.getByTestId('section-restricted-member');

    await dragNodeTo(
      nodeRow(nodeByPath(section, '4')),
      nodeRow(nodeByPath(section, '3')),
      'child'
    );

    await expect(page.getByTestId('r-member-drop-count')).toHaveText('1');
    const pos = await page.getByTestId('r-member-drop-position').textContent();
    expect(['before', 'after']).toContain(pos);
  });
});

// ── Section 4: restricted via callback ────────────────────────────────────

test.describe('restricted drop positions — getAllowedDropPositionsCallback', () => {
  test('callback restricting odd-id nodes to ["before"] snaps "child" intent to "before"', async ({ page }) => {
    await gotoFixture(page);
    const section = page.getByTestId('section-restricted-callback');

    await dragNodeTo(
      nodeRow(nodeByPath(section, '4')),
      nodeRow(nodeByPath(section, '1')),
      'child'
    );

    await expect(page.getByTestId('r-callback-drop-count')).toHaveText('1');
    await expect(page.getByTestId('r-callback-drop-target')).toHaveText('OddBeforeOnly-31');
    await expect(page.getByTestId('r-callback-drop-position')).toHaveText('before');
  });

  test('callback restricting even-id nodes to ["child"] snaps "before" intent to "child"', async ({ page }) => {
    await gotoFixture(page);
    const section = page.getByTestId('section-restricted-callback');

    await dragNodeTo(
      nodeRow(nodeByPath(section, '4')),
      nodeRow(nodeByPath(section, '2')),
      'before'
    );

    await expect(page.getByTestId('r-callback-drop-count')).toHaveText('1');
    await expect(page.getByTestId('r-callback-drop-position')).toHaveText('child');
  });
});

// ── Section 6: multi-drag ─────────────────────────────────────────────────

test.describe('multi-drag (selectionMode=multi)', () => {
  async function rootNodeNamesInOrder(section: Locator): Promise<string[]> {
    const roots = section.locator('.wtv__node[data-tree-path]:not([data-tree-path*="."])');
    return await roots.locator('.wtv__node-row .wtv__node-content > span').allInnerTexts();
  }

  test('grabbing a non-selected node replaces the selection with just that node', async ({ page }) => {
    await gotoFixture(page);
    const section = page.getByTestId('section-multi');

    await nodeRow(nodeByPath(section, '1')).click();
    await nodeRow(nodeByPath(section, '2')).click({ modifiers: ['Control'] });
    await expect(page.getByTestId('multi-selected-size')).toHaveText('2');

    await dragNodeTo(nodeRow(nodeByPath(section, '3')), nodeRow(nodeByPath(section, '4')), 'child');

    await expect(page.getByTestId('multi-selected-size')).toHaveText('1');
    await expect(page.getByTestId('multi-drop-count')).toHaveText('1');
    await expect(page.getByTestId('multi-drop-dragged')).toHaveText('Multi-C');
  });

  test('grabbing a selected node preserves the selected set', async ({ page }) => {
    await gotoFixture(page);
    const section = page.getByTestId('section-multi');

    await nodeRow(nodeByPath(section, '1')).click();
    await nodeRow(nodeByPath(section, '2')).click({ modifiers: ['Control'] });
    await nodeRow(nodeByPath(section, '3')).click({ modifiers: ['Control'] });
    await expect(page.getByTestId('multi-selected-size')).toHaveText('3');

    await dragNodeTo(nodeRow(nodeByPath(section, '1')), nodeRow(nodeByPath(section, '4')), 'child');

    await expect(page.getByTestId('multi-selected-size')).not.toHaveText('1');
  });

  test('multi-drag (child position): all top-level selected subtrees land under dropNode', async ({ page }) => {
    await gotoFixture(page);
    const section = page.getByTestId('section-multi');

    const initialRoots = await rootNodeNamesInOrder(section);
    expect(initialRoots).toEqual(['Multi-A', 'Multi-B', 'Multi-C', 'Multi-D']);

    await nodeRow(nodeByPath(section, '1')).click();
    await nodeRow(nodeByPath(section, '2')).click({ modifiers: ['Control'] });
    await nodeRow(nodeByPath(section, '3')).click({ modifiers: ['Control'] });
    await expect(page.getByTestId('multi-selected-size')).toHaveText('3');

    await dragNodeTo(nodeRow(nodeByPath(section, '1')), nodeRow(nodeByPath(section, '4')), 'child');

    const afterRoots = await rootNodeNamesInOrder(section);
    expect(afterRoots).toEqual(['Multi-D']);

    await expect(section.locator('.wtv__node[data-tree-path]')).toHaveCount(6);

    await expect(page.getByTestId('multi-drop-count')).toHaveText('1');
    await expect(page.getByTestId('multi-drop-dragged')).toHaveText('Multi-A');
  });

  test('multi-drag (after position): chained-after yields [D, A, B, C]', async ({ page }) => {
    await gotoFixture(page);
    const section = page.getByTestId('section-multi');

    await nodeRow(nodeByPath(section, '1')).click();
    await nodeRow(nodeByPath(section, '2')).click({ modifiers: ['Control'] });
    await nodeRow(nodeByPath(section, '3')).click({ modifiers: ['Control'] });
    await dragNodeTo(nodeRow(nodeByPath(section, '1')), nodeRow(nodeByPath(section, '4')), 'after');

    const afterRoots = await rootNodeNamesInOrder(section);
    expect(afterRoots).toEqual(['Multi-D', 'Multi-A', 'Multi-B', 'Multi-C']);
    await expect(section.locator('.wtv__node[data-tree-path]')).toHaveCount(6);
  });

  // Top-level absorption (ancestor + descendant both selected): the descendant
  // rides along INSIDE its moved ancestor (was skipped as TV-5 — NOTES.md #5).
  test('top-level absorption: descendant of a selected ancestor rides along inside', async ({ page }) => {
    await gotoFixture(page);
    const section = page.getByTestId('section-multi');

    await nodeRow(nodeByPath(section, '1.1')).click();
    await nodeRow(nodeByPath(section, '1')).click({ modifiers: ['Control'] });
    await nodeRow(nodeByPath(section, '2')).click({ modifiers: ['Control'] });
    await expect(page.getByTestId('multi-selected-size')).toHaveText('3');

    await dragNodeTo(nodeRow(nodeByPath(section, '1')), nodeRow(nodeByPath(section, '4')), 'child');

    await expect.poll(() => rootNodeNamesInOrder(section)).toEqual(['Multi-C', 'Multi-D']);
    await expect(section.locator('.wtv__node[data-tree-path]')).toHaveCount(6);
    // A-1 is still A's child (now 3 levels deep under D), not a sibling of A.
    const a1Path = await section.locator('.wtv__node[data-tree-path]').evaluateAll((els) =>
      els.find((el) => el.querySelector('.wtv__node-content > span')?.textContent?.trim() === 'A-1')
        ?.getAttribute('data-tree-path'));
    expect(a1Path?.split('.').length).toBe(3);
  });

  test('locked node (isDraggable=false) in the selected set does NOT ride along on multi-drag', async ({ page }) => {
    await gotoFixture(page);
    const section = page.getByTestId('section-multi-locked');

    expect(await rootNodeNamesInOrder(section)).toEqual(['Lock-A', 'Lock-B', 'Lock-C', 'Lock-D']);

    // Select A, B and the LOCKED C.
    await nodeRow(nodeByPath(section, '1')).click();
    await nodeRow(nodeByPath(section, '2')).click({ modifiers: ['Control'] });
    await nodeRow(nodeByPath(section, '3')).click({ modifiers: ['Control'] });
    await expect(page.getByTestId('locked-selected-size')).toHaveText('3');

    // Drag the lead (Lock-A) onto Lock-D as child. A and B move; the locked
    // Lock-C must stay at root despite being selected.
    await dragNodeTo(nodeRow(nodeByPath(section, '1')), nodeRow(nodeByPath(section, '4')), 'child');

    // Pre-fix, Lock-C would have ridden along and roots would be just ['Lock-D'].
    expect(await rootNodeNamesInOrder(section)).toEqual(['Lock-C', 'Lock-D']);

    // No orphans / duplicates, and exactly two nodes are now nested (A + B).
    await expect(section.locator('.wtv__node[data-tree-path]')).toHaveCount(4);
    await expect(section.locator('.wtv__node[data-tree-path*="."]')).toHaveCount(2);
    await expect(page.getByTestId('locked-drop-count')).toHaveText('1');
  });
});

// ── Section 7: node that rejects all drops (isDropAllowed=false) ────────────
// Regression: web only gated node.isDropAllowed on the touch path; the desktop
// dragOver/drop handlers accepted a drop onto a node with isDropAllowed=false.
// svelte-treeview gates every desktop path; this asserts web now does too.
test.describe('no-drop node (isDropAllowed=false)', () => {
  test('a node with isDropAllowed=false rejects a drop; a normal node accepts it', async ({ page }) => {
    await gotoFixture(page);
    const section = page.getByTestId('section-no-drop');

    // Drag CanDrop-A onto NoDrop-B as child — must be REJECTED (no drop fires).
    await dragNodeTo(nodeRow(nodeByPath(section, '1')), nodeRow(nodeByPath(section, '2')), 'child');
    await expect(page.getByTestId('no-drop-drop-count')).toHaveText('0');
    await expect(nodeByPath(section, '1')).toBeVisible(); // A stays at root

    // Control: dropping onto a normal node (CanDrop-C) still works.
    await dragNodeTo(nodeRow(nodeByPath(section, '1')), nodeRow(nodeByPath(section, '3')), 'child');
    await expect(page.getByTestId('no-drop-drop-count')).toHaveText('1');
    await expect(page.getByTestId('no-drop-drop-target')).toHaveText('CanDrop-C');
  });
});

// ── Section: drag-drop-mode same-tree gate (self / cross) ──────────────────
// isDropAllowedByMode gates drops by origin: 'self' = same-tree only, 'cross' =
// cross-tree only, 'both' = either. We assert the SAME-TREE branch across modes
// (reliable single-tree DnD): 'self' must ALLOW a same-tree drop, 'cross' must
// REJECT it. The cross-tree branch stays under the skipped two-tree placeholder
// (Chromium cross-tree native-drag synth is flaky).
test.describe('drag-drop-mode same-tree gate', () => {
  async function setMode(page: Page, mode: string) {
    await page.evaluate((m) => {
      document.getElementById('tree-single')!.setAttribute('drag-drop-mode', m);
    }, mode);
    await page.waitForTimeout(50);
  }

  test("mode='self' allows a same-tree drop", async ({ page }) => {
    await gotoFixture(page);
    const section = page.getByTestId('section-single');
    await setMode(page, 'self');

    await expect(page.getByTestId('single-drop-count')).toHaveText('0');
    await dragNodeTo(nodeRow(nodeByPath(section, '1.1')), nodeRow(nodeByPath(section, '2')), 'after');
    await expect(page.getByTestId('single-drop-count')).toHaveText('1');
  });

  test("mode='cross' rejects a same-tree drop", async ({ page }) => {
    await gotoFixture(page);
    const section = page.getByTestId('section-single');
    await setMode(page, 'cross');

    await dragNodeTo(nodeRow(nodeByPath(section, '1.1')), nodeRow(nodeByPath(section, '2')), 'after');
    await expect(page.getByTestId('single-drop-count')).toHaveText('0'); // same-tree drop blocked
  });
});

// Two-tree drag and Ctrl-drag copy: drag-cross-tree.spec.ts. Touch drag: touch-drag.spec.ts.
