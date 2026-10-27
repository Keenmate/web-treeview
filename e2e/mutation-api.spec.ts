import { test, expect, type Page, nodeByPath, logLines } from './fixtures';

/**
 * Programmatic mutation API (/test/mutation-api.html).
 *
 *   1 Fruits ── 1.1 Apple, 1.2 Banana
 *   2 Veg ── 2.1 Carrot ── 2.1.1 Baby carrot
 *   3 Nuts
 *
 * `outline()` reads the model (visible flat nodes), `domOutline()` the rendered
 * rows — both "  "-indented by level — so each test checks the DOM reflects the
 * model, plus the result shape and one `tree-change` per operation.
 */

const PAGE = '/test/mutation-api.html';
const LOG = 'mu-log';

const INITIAL = ['Fruits', '  Apple', '  Banana', 'Veg', '  Carrot', '    Baby carrot', 'Nuts'];

async function load(page: Page) {
  await page.goto(PAGE);
  await expect(nodeByPath(page, '3')).toBeVisible();
  await expect.poll(() => domOutline(page)).toEqual(INITIAL);
}

const outline = (page: Page) => page.evaluate(() => (window as any).outline());
const domOutline = (page: Page) => page.evaluate(() => (window as any).domOutline());
const treeChanges = async (page: Page) => (await logLines(page, LOG)).filter((l) => l.startsWith('tree-change')).length;

/** Run `expr` against `tree`, return its JSON-safe result (node objects → paths). */
async function run(page: Page, expr: string) {
  return page.evaluate((expr) => {
    const tree = (window as any).tree;
    const v = new Function('tree', `return (${expr});`)(tree);
    return JSON.parse(JSON.stringify(v, (k, x) =>
      x && typeof x === 'object' && 'path' in x && 'data' in x ? x.path : x));
  }, expr);
}

/** Expect `n` tree-change events since `before`, settled (no stragglers). */
async function expectTreeChanges(page: Page, before: number, n: number) {
  await expect.poll(() => treeChanges(page)).toBe(before + n);
  await page.waitForTimeout(100);
  expect(await treeChanges(page)).toBe(before + n);
}

test('addNode adds a child; DOM reflects it; one tree-change', async ({ page }) => {
  await load(page);
  const before = await treeChanges(page);
  const r = await run(page, `tree.addNode('3', { id: 31, name: 'Almond' })`);
  expect(r.success).toBe(true);
  await expect.poll(() => domOutline(page)).toEqual([...INITIAL, '  Almond']);
  await expectTreeChanges(page, before, 1);
});

test('addNode under a missing parent fails without touching the tree', async ({ page }) => {
  await load(page);
  const r = await run(page, `tree.addNode('9', { id: 91, name: 'Ghost' })`);
  expect(r.success).toBe(false);
  expect(await outline(page)).toEqual(INITIAL);
});

test('updateNode re-renders the label', async ({ page }) => {
  await load(page);
  const before = await treeChanges(page);
  const r = await run(page, `tree.updateNode('1.1', { name: 'Green apple' })`);
  expect(r.success).toBe(true);
  await expect(nodeByPath(page, '1.1')).toContainText('Green apple');
  await expectTreeChanges(page, before, 1);
});

test('removeNode with descendants removes the subtree', async ({ page }) => {
  await load(page);
  const before = await treeChanges(page);
  const r = await run(page, `tree.removeNode('2', true)`);
  expect(r.success).toBe(true);
  await expect.poll(() => domOutline(page)).toEqual(['Fruits', '  Apple', '  Banana', 'Nuts']);
  await expectTreeChanges(page, before, 1);
});

test('moveNode moves the whole subtree (child position)', async ({ page }) => {
  await load(page);
  const before = await treeChanges(page);
  const r = await run(page, `tree.moveNode('2', '3', 'child')`);
  expect(r.success).toBe(true);
  await expect.poll(() => domOutline(page)).toEqual([
    'Fruits', '  Apple', '  Banana', 'Nuts', '  Veg', '    Carrot', '      Baby carrot'
  ]);
  await expectTreeChanges(page, before, 1);
});

test('moveNodes with a complete manifest moves subtrees; result lists moved nodes', async ({ page }) => {
  await load(page);
  const before = await treeChanges(page);
  const r = await run(page, `tree.moveNodes(['1.2', '2.1', '2.1.1'], '3', 'child')`);
  expect(r.success).toBe(true);
  expect(r.movedNodes).toHaveLength(2); // the top-level roots (Banana, Carrot)
  expect(r.leftBehind).toEqual([]);
  // Landing order among the moved roots is expressed via sibling order, not the
  // path this fixture sorts by — so compare the moved subtrees order-agnostically.
  await expect.poll(async () => (await outline(page)).slice(0, 4)).toEqual(['Fruits', '  Apple', 'Veg', 'Nuts']);
  const tail = (await outline(page)).slice(4).join('|');
  expect(['  Banana|  Carrot|    Baby carrot', '  Carrot|    Baby carrot|  Banana']).toContain(tail);
  expect(await domOutline(page)).toEqual(await outline(page));
  await expectTreeChanges(page, before, 1);
});

test('moveNodes: a descendant absent from the manifest is left behind (re-homed) and reported', async ({ page }) => {
  await load(page);
  const r = await run(page, `tree.moveNodes(['2.1'], '3', 'child')`);
  expect(r.success).toBe(true);
  expect(r.leftBehind).toHaveLength(1);
  await expect.poll(() => outline(page)).toEqual([
    'Fruits', '  Apple', '  Banana', 'Veg', '  Baby carrot', 'Nuts', '  Carrot'
  ]);
  expect(await domOutline(page)).toEqual(await outline(page));
});

test('duplicateNodes (with an id-assigning transform) copies the manifest; source stays', async ({ page }) => {
  await load(page);
  const before = await treeChanges(page);
  const r = await run(
    page,
    `tree.duplicateNodes(['2', '2.1'], '3', 'child', ({ data }) => ({ ...data, id: data.id * 1000 }))`
  );
  expect(r.success).toBe(true);
  expect(r.copiedNodes).toHaveLength(1); // the copied root (Veg)
  // 2.1.1 is not in the manifest → not copied.
  await expect.poll(() => domOutline(page)).toEqual([...INITIAL, '  Veg', '    Carrot']);
  await expectTreeChanges(page, before, 1);
});

test('duplicateNodes without a transform keeps every row rendered (duplicate ids)', async ({ page }) => {
  await load(page);
  await run(page, `tree.duplicateNodes(['1', '1.1', '1.2'], '3', 'child')`);
  await expect.poll(() => outline(page)).toEqual([...INITIAL, '  Fruits', '    Apple', '    Banana']);
  await expect.poll(() => domOutline(page)).toEqual(await outline(page));
});

test('copyNodeWithDescendants copies the subtree through the transform', async ({ page }) => {
  await load(page);
  const r = await run(
    page,
    `tree.copyNodeWithDescendants(tree.getNodeByPath('2'), '3', ({ data }) => ({ ...data, id: data.id * 1000 }))`
  );
  expect(r).toBeTruthy();
  await expect.poll(() => domOutline(page)).toEqual([...INITIAL, '  Veg', '    Carrot', '      Baby carrot']);
});

test('copyNodeWithDescendants: transform returning null skips that node', async ({ page }) => {
  await load(page);
  await run(
    page,
    `tree.copyNodeWithDescendants(tree.getNodeByPath('2'), '3', ({ data }) => data.name === 'Baby carrot' ? null : ({ ...data, id: data.id * 1000 }))`
  );
  await expect.poll(() => domOutline(page)).toEqual([...INITIAL, '  Veg', '    Carrot']);
});

test('applyChanges applies create/update/delete, reports failures, one tree-change', async ({ page }) => {
  await load(page);
  const before = await treeChanges(page);
  const r = await run(page, `tree.applyChanges([
    { operation: 'create', parentPath: '3', data: { id: 31, name: 'Almond' } },
    { operation: 'update', path: '1', data: { name: 'FRUIT' } },
    { operation: 'delete', path: '1.2' },
    { operation: 'delete', path: 'nope' }
  ])`);
  expect(r.successful).toBe(3);
  expect(r.failed).toEqual([expect.objectContaining({ changeIndex: 3, operation: 'delete', path: 'nope' })]);
  await expect.poll(() => domOutline(page)).toEqual([
    'FRUIT', '  Apple', 'Veg', '  Carrot', '    Baby carrot', 'Nuts', '  Almond'
  ]);
  await expectTreeChanges(page, before, 1);
});
