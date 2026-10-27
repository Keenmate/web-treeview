import { test, expect, type Page, nodeByPath, nodeContent } from './fixtures';

/**
 * Data mapping members, sorting and display values (/test/data-members.html).
 * Input order is shuffled; members: id=key, path=path, display=name.
 *
 *   1 Apple (rank 3) ── 1.1 Date (rank 2), 1.2 Cherry (rank 1)
 *   2 Banana (rank 1)
 *   3 Cucumber (rank 2)
 */

const PAGE = '/test/data-members.html';

async function load(page: Page, mode: string) {
  await page.goto(`${PAGE}?mode=${mode}`);
  await expect(nodeByPath(page, '3')).toBeVisible();
}

const labels = (page: Page): Promise<string[]> => page.evaluate(() => (window as any).labels());

test('default: siblings are ordered by display value', async ({ page }) => {
  await load(page, 'default');
  expect(await labels(page)).toEqual(['Apple', '  Cherry', '  Date', 'Banana', 'Cucumber']);
});

test('order-member orders siblings by that field (then by name)', async ({ page }) => {
  await load(page, 'order');
  expect(await labels(page)).toEqual(['Banana', 'Cucumber', 'Apple', '  Cherry', '  Date']);
});

test('a sibling sortCallback without sorted keeps every node (no orphaned children)', async ({ page }) => {
  await load(page, 'callback');
  expect(await labels(page)).toEqual(['Cucumber', 'Banana', 'Apple', '  Date', '  Cherry']);
  expect(await page.evaluate(() => (window as any).tree.insertResult?.failed?.length ?? 0)).toBe(0);
});

test('sortCallback only ever sees the children of one parent', async ({ page }) => {
  await load(page, 'callback');
  const calls: string[][] = await page.evaluate(() => (window as any).sortCalls);
  // one call per sibling group (root + under "1"), never the whole flat list
  expect(calls.map((c) => [...c].sort())).toEqual([['1', '2', '3'], ['1.1', '1.2']]);
});

test('sorted renders pre-sorted data exactly as given (no reorder)', async ({ page }) => {
  await load(page, 'presorted');
  // display order given: 3, 1 (1.2, 1.1), 2 — not by name, not by the descending callback
  expect(await labels(page)).toEqual(['Cucumber', 'Apple', '  Cherry', '  Date', 'Banana']);
});

test('sorted skips all sorting on insert (sortCallback is never called)', async ({ page }) => {
  await load(page, 'presorted');
  expect(await page.evaluate(() => (window as any).sortCalls.length)).toBe(0);
});

test('sorted with badly ordered data drops orphans into insertResult.failed', async ({ page }) => {
  await load(page, 'presorted-bad');
  // 1.1 is listed before its parent 1 → caller broke the hint's contract; it is reported, not rendered
  const failed: string[] = await page.evaluate(() =>
    (window as any).tree.insertResult.failed.map((f: any) => f.originalData?.path ?? f.node?.path));
  expect(failed).toEqual(['1.1']);
  expect(await labels(page)).toEqual(['Apple', '  Cherry', 'Banana', 'Cucumber']);
});

test('sorted: insertBranch still re-sorts the affected parent (the hint covers the input only)', async ({ page }) => {
  await load(page, 'presorted');
  // as given: Apple's children Cherry, Date; the callback orders descending by name
  const result = await page.evaluate(() => {
    (window as any).sortCalls.length = 0;
    const r = (window as any).tree.insertBranch('1', [{ key: 'k13', path: '1.3', name: 'Daisy', rank: 5, parent: '1', lvl: 2 }]);
    return { count: r.count, failed: r.failed.length, calls: (window as any).sortCalls };
  });
  expect(result).toMatchObject({ count: 1, failed: 0 });
  // one re-sort, of the affected parent only
  expect(result.calls.map((c: string[]) => [...c].sort())).toEqual([['1.1', '1.2', '1.3']]);
  // Daisy lands between Date and Cherry; the root (not affected) keeps the given order
  await expect.poll(() => labels(page)).toEqual(['Cucumber', 'Apple', '  Date', '  Daisy', '  Cherry', 'Banana']);
});

test('getDisplayValueCallback supplies the label when the member is absent', async ({ page }) => {
  await load(page, 'display');
  await expect(nodeByPath(page, '1.1')).toContainText('#k11:DATE');
  await expect(nodeByPath(page, '2')).toContainText('#k2:BANANA');
});

test('id-member: node ids come from the configured field', async ({ page }) => {
  await load(page, 'default');
  const id = await page.evaluate(() => (window as any).tree.getNodeByPath('1.1')?.id);
  expect(id).toBe('k11');
  await expect(nodeByPath(page, '1.1')).toHaveAttribute('id', /-k11$/);
});

test('parent-path-member + level-member are read from data', async ({ page }) => {
  await load(page, 'members');
  const n = await page.evaluate(() => {
    const x = (window as any).tree.getNodeByPath('1.2');
    return { parent: x?.parentPath, level: x?.level };
  });
  expect(n).toEqual({ parent: '1', level: 2 });
  expect(await labels(page)).toEqual(['Apple', '  Cherry', '  Date', 'Banana', 'Cucumber']);
});

test('reassigning data re-renders and keeps the expansion of surviving paths', async ({ page }) => {
  await load(page, 'default');
  // collapse Apple, then reassign data with one extra child under it
  await nodeByPath(page, '1').locator('> .wtv__node-row .wtv__toggle-icon').first().click();
  await expect(nodeByPath(page, '1.1')).toHaveCount(0);
  await page.evaluate(() => (window as any).reassign());
  await expect.poll(() => page.evaluate(() => (window as any).tree.getNodeByPath('1.3')?.data?.name)).toBe('Elder');
  // still collapsed …
  await expect(nodeByPath(page, '1.1')).toHaveCount(0);
  // … and the new child shows once expanded
  await nodeContent(nodeByPath(page, '1')).click();
  expect(await labels(page)).toEqual(['Apple', '  Cherry', '  Date', '  Elder', 'Banana', 'Cucumber']);
});
