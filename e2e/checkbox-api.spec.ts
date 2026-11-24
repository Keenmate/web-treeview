import { test, expect, type Page, nodeByPath, logLines } from './fixtures';

/**
 * Checked-set API, cascade policies and the checkbox interceptor
 * (/test/checkbox-api.html).
 *
 *   1 A ── 1.1 A1, 1.2 A2
 *   2 B ── 2.1 B1, 2.2 B2
 *   3 Fixed (not selectable → no checkbox)
 *   ?deep=1 adds 1.1.1 A1a, 1.1.2 A1b (A1 becomes a middle branch)
 */

const PAGE = '/test/checkbox-api.html';
const LOG = 'cb-log';

async function load(page: Page, query = '') {
  await page.goto(PAGE + query);
  await expect(nodeByPath(page, '2.2')).toBeVisible();
}

const call = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([fn, args]) => (window as any).tree[fn as string](...(args as unknown[])), [fn, args] as const);
const emitted = (page: Page) => page.evaluate(() => [...(window as any).tree.checkedPaths].sort());
const box = (page: Page, path: string) => nodeByPath(page, path).locator('.wtv__checkbox').first();
const lastChecked = async (page: Page) =>
  (await logLines(page, LOG)).filter((l) => l.startsWith('checked-change:')).pop();

test.describe('checked-set API (cascade)', () => {
  test('checkedPaths / getCheckedNodes are folded; allCheckedPaths / getAllCheckedNodes list every ticked node (D-NC-14)', async ({ page }) => {
    await load(page);
    await call(page, 'checkNode', '2');
    const r = await page.evaluate(() => {
      const t = (window as any).tree;
      const ctl = t.controller;
      const paths = (ns: any[]) => ns.map((n) => n.path).sort();
      return {
        checked: [...t.checkedPaths].sort(),
        all: [...t.allCheckedPaths].sort(),
        nodes: paths(t.getCheckedNodes()),
        allNodes: paths(t.getAllCheckedNodes()),
        ctlChecked: [...ctl.checkedPaths].sort(),
        ctlAll: [...ctl.allCheckedPaths].sort(),
        ctlNodes: paths(ctl.getCheckedNodes()),
        ctlAllNodes: paths(ctl.getAllCheckedNodes()),
      };
    });
    // rolled-up (default): the fully-checked B folds to itself; its children only show in the all* pair.
    expect(r.checked).toEqual(['2']);
    expect(r.nodes).toEqual(['2']);
    expect(r.ctlChecked).toEqual(['2']);
    expect(r.ctlNodes).toEqual(['2']);
    expect(r.all).toEqual(['2', '2.1', '2.2']);
    expect(r.allNodes).toEqual(['2', '2.1', '2.2']);
    expect(r.ctlAll).toEqual(['2', '2.1', '2.2']);
    expect(r.ctlAllNodes).toEqual(['2', '2.1', '2.2']);
  });

  test('checkNode cascades to descendants and ticks their boxes', async ({ page }) => {
    await load(page);
    await call(page, 'checkNode', '1');
    await expect(box(page, '1')).toBeChecked();
    await expect(box(page, '1.1')).toBeChecked();
    await expect(box(page, '1.2')).toBeChecked();
    await expect(box(page, '2')).not.toBeChecked();
    expect(await lastChecked(page)).toBe('checked-change:1');
  });

  test('uncheckNode removes the subtree', async ({ page }) => {
    await load(page);
    await call(page, 'checkNode', '1');
    await call(page, 'uncheckNode', '1');
    await expect(box(page, '1.1')).not.toBeChecked();
    expect(await emitted(page)).toEqual([]);
    expect(await lastChecked(page)).toBe('checked-change:');
  });

  test('checkNodes is additive; a partially checked parent is indeterminate', async ({ page }) => {
    await load(page);
    await call(page, 'checkNode', '1.1');
    await call(page, 'checkNodes', ['2.1']);
    expect(await emitted(page)).toEqual(['1.1', '2.1']);
    // Indeterminate is a modifier class + aria-checked="mixed", not the DOM prop.
    await expect(box(page, '1')).toHaveClass(/wtv__checkbox--indeterminate/);
    await expect(box(page, '1')).toHaveAttribute('aria-checked', 'mixed');
  });

  test('assigning checkedPaths replaces the whole set', async ({ page }) => {
    await load(page);
    await call(page, 'checkNode', '1');
    await page.evaluate(() => { (window as any).tree.checkedPaths = ['2.2']; });
    expect(await emitted(page)).toEqual(['2.2']);
    await expect(box(page, '1.1')).not.toBeChecked();
    await expect(box(page, '2.2')).toBeChecked();
  });

  test('checkAll checks every selectable node (rolled-up emits the roots)', async ({ page }) => {
    await load(page);
    await call(page, 'checkAll');
    expect(await emitted(page)).toEqual(['1', '2']);
    await expect(box(page, '2.2')).toBeChecked();
    expect(await nodeByPath(page, '3').locator('.wtv__checkbox').count()).toBe(0);
    expect(await page.evaluate(() => (window as any).tree.isNodeChecked('3'))).toBe(false);
  });

  test('uncheckNodes unchecks several subtrees; uncheckAll empties the set (symmetric to checkNodes / checkAll)', async ({ page }) => {
    await load(page);
    await call(page, 'checkAll');
    await call(page, 'uncheckNodes', ['1', '2.2']);
    expect(await emitted(page)).toEqual(['2.1']);
    await expect(box(page, '1.2')).not.toBeChecked();
    expect(await lastChecked(page)).toBe('checked-change:2.1');
    await call(page, 'uncheckNodes', []);
    expect(await emitted(page)).toEqual(['2.1']);
    await call(page, 'uncheckAll');
    expect(await emitted(page)).toEqual([]);
    await expect(box(page, '2.1')).not.toBeChecked();
  });

  test('silent variants skip checked-change but update state', async ({ page }) => {
    await load(page);
    await call(page, 'checkNode', '2', { isSilent: true });
    await expect(box(page, '2.1')).toBeChecked();
    expect(await lastChecked(page)).toBeUndefined();
  });
});

test.describe('independent mode', () => {
  test('checkNode checks only that node', async ({ page }) => {
    await load(page, '?mode=independent');
    await call(page, 'checkNode', '1');
    await expect(box(page, '1')).toBeChecked();
    await expect(box(page, '1.1')).not.toBeChecked();
    expect(await emitted(page)).toEqual(['1']);
  });
});

test.describe('cascade-check-policy → checked-change paths', () => {
  test('rolled-up (default): a fully checked branch collapses to its root', async ({ page }) => {
    await load(page);
    await box(page, '1').click();
    await box(page, '2.1').click();
    await expect.poll(() => lastChecked(page)).toBe('checked-change:1,2.1');
  });

  test('rolled-up: checking every child rolls up to the parent', async ({ page }) => {
    await load(page);
    await box(page, '1.1').click();
    await box(page, '1.2').click();
    await expect.poll(() => lastChecked(page)).toBe('checked-change:1');
  });

  test('leaves: only checked leaves are emitted', async ({ page }) => {
    await load(page, '?policy=leaves');
    await box(page, '1').click();
    await box(page, '2.1').click();
    await expect.poll(() => lastChecked(page)).toBe('checked-change:1.1,1.2,2.1');
  });

  test('all: every checked node, branches included', async ({ page }) => {
    await load(page, '?policy=all');
    await box(page, '1').click();
    await box(page, '2.1').click();
    await expect.poll(() => lastChecked(page)).toBe('checked-change:1,1.1,1.2,2.1');
  });
});

test.describe('beforeCheckboxToggleCallback', () => {
  test('receives the node, the new state and the cascade-affected paths', async ({ page }) => {
    await load(page, '?before=log');
    await box(page, '1').click();
    await expect.poll(() => logLines(page, LOG)).toContain('before:1:true:1,1.1,1.2');
    await expect(box(page, '1.2')).toBeChecked();
  });

  test('returning false cancels the toggle (no state change, no event)', async ({ page }) => {
    await load(page, '?before=veto');
    await box(page, '1').click();
    await expect.poll(() => logLines(page, LOG)).toContain('before:1:true:1,1.1,1.2');
    await expect(box(page, '1')).not.toBeChecked();
    expect(await emitted(page)).toEqual([]);
    expect(await lastChecked(page)).toBeUndefined();
  });

  test('returning string[] overrides the affected paths', async ({ page }) => {
    await load(page, '?before=override');
    await box(page, '1').click();
    await expect.poll(() => lastChecked(page)).toBe('checked-change:2.2');
    await expect(box(page, '2.2')).toBeChecked();
    await expect(box(page, '1.1')).not.toBeChecked();
  });

  test('paths the callback ADDS re-derive their own parents too', async ({ page }) => {
    // Toggling A1 also checks B1 + B2 → B is fully checked; A is [-]. B used to stay
    // unchecked: only the clicked node's ancestors were re-derived.
    await load(page, '?before=add');
    await box(page, '1.1').click();
    await expect(box(page, '2')).toBeChecked();
    await expect(box(page, '1')).toHaveClass(/wtv__checkbox--indeterminate/);
    await expect.poll(() => lastChecked(page)).toBe('checked-change:1.1,2');
  });
});

test.describe('cascade over three levels (?deep=1)', () => {
  // Check a leaf → A1 + A [-]; then check the ROOT → A1 must be fully checked. It used to keep
  // its stale [-]: only the clicked node and its ancestors were re-derived, not the
  // descendants the cascade had just checked.
  const ALL = ['1', '1.1', '1.1.1', '1.1.2', '1.2'];
  async function expectAll(page: Page, checked: boolean) {
    for (const path of ALL) {
      if (checked) await expect(box(page, path), path).toBeChecked();
      else await expect(box(page, path), path).not.toBeChecked();
      await expect(box(page, path), path).not.toHaveClass(/wtv__checkbox--indeterminate/);
    }
  }
  async function checkLeaf(page: Page) {
    await load(page, '?deep=1');
    await box(page, '1.1.1').click();
    await expect(box(page, '1.1')).toHaveClass(/wtv__checkbox--indeterminate/);
    await expect(box(page, '1')).toHaveClass(/wtv__checkbox--indeterminate/);
  }

  test('click: leaf, then root → the middle branch is checked, not [-]', async ({ page }) => {
    await checkLeaf(page);
    await box(page, '1').click();
    await expectAll(page, true);
    await box(page, '1').click();
    await expectAll(page, false);
  });

  test('API: checkNode / uncheckNode on the root re-derive the middle branch', async ({ page }) => {
    await checkLeaf(page);
    await call(page, 'checkNode', '1');
    await expectAll(page, true);
    await call(page, 'uncheckNode', '1');
    await expectAll(page, false);
  });
});
