import { test, expect, type Page, nodeByPath, logLines } from './fixtures';

/**
 * Checked-set API, cascade policies and the checkbox interceptor
 * (/test/checkbox-api.html).
 *
 *   1 A ── 1.1 A1, 1.2 A2
 *   2 B ── 2.1 B1, 2.2 B2
 *   3 Fixed (not selectable → no checkbox)
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
    await call(page, 'checkNode', '2', { silent: true });
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
});
