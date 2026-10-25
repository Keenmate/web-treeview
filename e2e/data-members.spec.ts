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

test('sortCallback + is-sorted decides the sibling order', async ({ page }) => {
  await load(page, 'callback');
  expect(await labels(page)).toEqual(['Cucumber', 'Banana', 'Apple', '  Date', '  Cherry']);
});

test('a sibling sortCallback without is-sorted keeps every node (no orphaned children)', async ({ page }) => {
  test.fail(true, 'NOTES.md #16');
  await load(page, 'callback-unsorted');
  expect(await labels(page)).toEqual(['Cucumber', 'Banana', 'Apple', '  Date', '  Cherry']);
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
  test.fail(true, 'NOTES.md #17');
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
