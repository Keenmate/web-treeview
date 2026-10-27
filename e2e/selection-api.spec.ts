import { test, expect, type Page, nodeByPath, nodeContent, logLines } from './fixtures';

/**
 * Programmatic selection + focus API (/test/selection-api.html).
 *
 *   1 A ── 1.1 A1 (collapsed: 1.1.1 hidden), 1.2 A2
 *   2 B
 *   3 C (not selectable)
 */

const PAGE = '/test/selection-api.html';
const LOG = 'sa-log';

async function load(page: Page) {
  await page.goto(PAGE);
  await expect(nodeByPath(page, '3')).toBeVisible();
  // let the initial build's notifications settle, then start from an empty log
  await page.waitForTimeout(50);
  await page.evaluate(() => (window as any).clearLog());
}

const call = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([fn, args]) => (window as any).tree[fn as string](...(args as unknown[])), [fn, args] as const);
const selected = (page: Page) => page.evaluate(() => [...(window as any).tree.selectedPaths].sort());
const focused = (page: Page) => page.evaluate(() => (window as any).tree.focusedNode?.path ?? null);
const settledLog = async (page: Page) => { await page.waitForTimeout(60); return logLines(page, LOG); };
const isSelectedRow = (page: Page, p: string) => nodeContent(nodeByPath(page, p));

test('selectAll selects every visible selectable row and emits selection-change', async ({ page }) => {
  await load(page);
  await call(page, 'selectAll');
  expect(await selected(page)).toEqual(['1', '1.1', '1.2', '2']);
  await expect(isSelectedRow(page, '1.2')).toHaveClass(/wtv__node-content--selected/);
  expect(await settledLog(page)).toContain('selection-change:1,1.1,1.2,2');
});

test('assigning selectedPaths replaces the set (hidden paths included) and emits once', async ({ page }) => {
  await load(page);
  await call(page, 'selectNode', '2');
  await page.evaluate(() => (window as any).clearLog());
  await page.evaluate(() => { (window as any).tree.selectedPaths = ['1.2', '1.1.1']; });
  expect(await selected(page)).toEqual(['1.1.1', '1.2']);
  await expect(isSelectedRow(page, '2')).not.toHaveClass(/wtv__node-content--selected/);
  const lines = (await settledLog(page)).filter((l) => l.startsWith('selection-change'));
  expect(lines).toEqual(['selection-change:1.1.1,1.2']);
});

test('silent replace (clearSelection + selectNodes with { silent }): state + DOM update, no selection-change', async ({ page }) => {
  await load(page);
  await call(page, 'selectNode', '2', 'replace', { silent: true });
  await call(page, 'clearSelection', undefined, { silent: true });
  await call(page, 'selectNodes', ['1.2'], { silent: true });
  expect(await selected(page)).toEqual(['1.2']);
  await expect(isSelectedRow(page, '1.2')).toHaveClass(/wtv__node-content--selected/);
  expect((await settledLog(page)).filter((l) => l.startsWith('selection-change'))).toEqual([]);
});

test('selectAll silent: no selection-change', async ({ page }) => {
  await load(page);
  await call(page, 'selectAll', { silent: true });
  expect(await selected(page)).toEqual(['1', '1.1', '1.2', '2']);
  expect((await settledLog(page)).filter((l) => l.startsWith('selection-change'))).toEqual([]);
});

test('focusNode moves the focus marker and emits focus-change with the node', async ({ page }) => {
  await load(page);
  await call(page, 'focusNode', '1.2');
  expect(await focused(page)).toBe('1.2');
  await expect(isSelectedRow(page, '1.2')).toHaveClass(/wtv__node-content--focused/);
  expect(await settledLog(page)).toEqual(['focus-change:1.2']);
  // focus is not selection
  expect(await selected(page)).toEqual([]);
});

test('focus-change detail carries the live node (path + data)', async ({ page }) => {
  await load(page);
  const detail = await page.evaluate(() => new Promise<any>((resolve) => {
    const tree = (window as any).tree;
    tree.addEventListener('focus-change', (e: CustomEvent) =>
      resolve({ path: e.detail.focusedNode?.path, name: e.detail.focusedNode?.data?.name, hasController: !!e.detail.controller }), { once: true });
    tree.focusNode('2');
  }));
  expect(detail).toEqual({ path: '2', name: 'B', hasController: true });
});

test('clearFocus removes the marker and emits focus-change with null', async ({ page }) => {
  await load(page);
  await call(page, 'focusNode', '2');
  await expect(isSelectedRow(page, '2')).toHaveClass(/wtv__node-content--focused/);
  await page.evaluate(() => (window as any).clearLog());
  await call(page, 'clearFocus');
  expect(await focused(page)).toBeNull();
  await expect(isSelectedRow(page, '2')).not.toHaveClass(/wtv__node-content--focused/);
  expect(await settledLog(page)).toEqual(['focus-change:']);
});

test('focusNode on a missing path is a no-op', async ({ page }) => {
  await load(page);
  await call(page, 'focusNode', '9.9');
  expect(await focused(page)).toBeNull();
  expect(await settledLog(page)).toEqual([]);
});

test('focusNode / clearFocus silent fire no focus-change', async ({ page }) => {
  await load(page);
  await call(page, 'focusNode', '1.2', { silent: true });
  expect(await focused(page)).toBe('1.2');
  await call(page, 'clearFocus', { silent: true });
  expect(await settledLog(page)).toEqual([]);
});

test('selectNode silent fires nothing (no selection-change, no focus-change)', async ({ page }) => {
  await load(page);
  await call(page, 'selectNode', '1.2', 'replace', { silent: true });
  expect(await selected(page)).toEqual(['1.2']);
  expect(await settledLog(page)).toEqual([]);
});
