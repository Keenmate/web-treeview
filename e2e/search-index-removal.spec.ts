import { test, expect, Page } from './fixtures';

/**
 * Regression (port of svelte-treeview a060d13): the internal search index is keyed by
 * a node's SLOT in a flat array. removeNode never left the index (removed nodes stayed
 * searchable — and, with a tombstone-free removal elsewhere, later hits resolved to the
 * wrong node), and addNode never indexed the new node.
 *
 * Fixture: /test/search.html (15 nodes, internal index built on idle).
 */

const PAGE = '/test/search.html';

async function gotoSearch(page: Page) {
  await page.goto(PAGE);
  await expect(page.locator('.wtv__node').first()).toBeVisible();
  // Wait for the idle-built index.
  await expect.poll(() => hits(page, 'toronto')).toEqual(['Toronto']);
}

function hits(page: Page, term: string): Promise<string[]> {
  return page.evaluate((t) => {
    const tree = document.getElementById('tree') as any;
    return (tree.searchNodes(t) as any[]).map((n) => n?.data?.name ?? '<none>').sort();
  }, term);
}

test('removeNode drops the node + subtree from search; later hits resolve to the right node', async ({ page }) => {
  await gotoSearch(page);
  const ok = await page.evaluate(() => (document.getElementById('tree') as any).removeNode('2').success);
  expect(ok).toBe(true);
  expect(await hits(page, 'united kingdom')).toEqual([]);
  expect(await hits(page, 'manchester')).toEqual([]);
  expect(await hits(page, 'london')).toEqual(['London']); // only Canada's London is left
  expect(await hits(page, 'tokyo')).toEqual(['Tokyo']);
  expect(await hits(page, 'toronto')).toEqual(['Toronto']);
});

test('removeBranch (keepParent) then removeNode keeps every later hit on its own node', async ({ page }) => {
  await gotoSearch(page);
  await page.evaluate(() => {
    const tree = document.getElementById('tree') as any;
    tree.removeBranch('1', true);
    tree.removeNode('3');
  });
  expect(await hits(page, 'new york')).toEqual([]);
  expect(await hits(page, 'berlin')).toEqual([]);
  expect(await hits(page, 'united states')).toEqual(['United States']);
  expect(await hits(page, 'osaka')).toEqual(['Osaka']);
  expect(await hits(page, 'london')).toEqual(['London', 'London']);
});

test('addNode makes the new node searchable', async ({ page }) => {
  await gotoSearch(page);
  await page.evaluate(() => {
    (document.getElementById('tree') as any).addNode('4', { id: 43, path: '', name: 'Kyoto' });
  });
  await expect.poll(() => hits(page, 'kyoto')).toEqual(['Kyoto']);
  expect(await hits(page, 'tokyo')).toEqual(['Tokyo']);
});
