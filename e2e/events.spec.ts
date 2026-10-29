import { test, expect, type Page, nodeByPath, nodeContent } from './fixtures';

/**
 * Event semantics (svelte-treeview parity, docs/parity.md §9). Fixture: test/events.html.
 *  - assigning selectedPaths / checkedPaths / expandedPaths is silent (element, controller, pre-build replay)
 *  - methods / interaction keep firing; expand / collapse methods fire `expanded-change` synchronously
 *  - `tree-change` = data / structure changes only, one per change
 *  - keyboard: Enter = expand / collapse; Space = checkbox / selection toggle
 *
 * Data: 1 Alpha (1.1, 1.2), 2 Beta (2.1), 3 Gamma.
 */

const PAGE = '/test/events.html';
const STATE_EVENTS = ['selection-change', 'checked-change', 'expanded-change', 'focus-change', 'tree-change'];

async function make(page: Page, opts: Record<string, unknown> = {}) {
  await page.goto(PAGE);
  await page.evaluate((o) => (window as any).make(o), opts);
}
const track = (page: Page, code: string) =>
  page.evaluate((c) => (window as any).track(c), code) as Promise<{ sync: string[]; all: string[] }>;
const log = (page: Page) => page.evaluate(() => [...(window as any).__log]) as Promise<string[]>;
const get = (page: Page, name: string) => page.evaluate((n) => [...(window as any).tree[n]].sort(), name);

test.describe('assigning the state sets is silent', () => {
  test('element: selectedPaths / checkedPaths / expandedPaths assignment fires nothing', async ({ page }) => {
    await make(page, { attrs: { 'selection-mode': 'multiple' } });
    const r = await track(page, `t.expandedPaths = ['1', '2']; t.selectedPaths = ['1.1', '2.1']; t.checkedPaths = ['3'];`);
    expect(r.all).toEqual([]);
    expect(await get(page, 'expandedPaths')).toEqual(['1', '2']);
    expect(await get(page, 'selectedPaths')).toEqual(['1.1', '2.1']);
    expect(await get(page, 'checkedPaths')).toEqual(['3']);
  });

  test('selectedPaths assignment without checkboxes still mirrors into checkedPaths (silently)', async ({ page }) => {
    await make(page);
    const r = await track(page, `t.selectedPaths = ['2'];`);
    expect(r.all).toEqual([]);
    expect(await get(page, 'checkedPaths')).toEqual(['2']);
  });

  test('pre-build assignment is replayed after the build without events', async ({ page }) => {
    await make(page, {
      attrs: { 'show-checkboxes': '' },
      state: { expandedPaths: ['1'], selectedPaths: ['1.1'], checkedPaths: ['3'] },
    });
    const events = await log(page);
    expect(events.filter((e) => STATE_EVENTS.includes(e))).toEqual([]);
    expect(await get(page, 'expandedPaths')).toEqual(['1']);
    expect(await get(page, 'selectedPaths')).toEqual(['1.1']);
    expect(await get(page, 'checkedPaths')).toEqual(['3']);
  });

  test('methods keep firing; { isSilent: true } does not', async ({ page }) => {
    await make(page, { attrs: { 'selection-mode': 'multiple', 'show-checkboxes': '' } });
    let r = await track(page, `t.selectNodes(['1']); t.checkNodes(['3']);`);
    expect(r.all).toEqual(expect.arrayContaining(['selection-change', 'checked-change', 'focus-change']));
    r = await track(page, `t.selectNodes(['2'], { isSilent: true }); t.checkNodes(['2'], { isSilent: true }); t.expandNodes('2', { isSilent: true });`);
    expect(r.all).toEqual([]);
  });
});

test.describe('expanded-change from methods is synchronous', () => {
  test('expandNodes / collapseNodes / expandAll fire it right away, after node-expand / node-collapse', async ({ page }) => {
    await make(page);
    let r = await track(page, `t.expandNodes('1');`);
    expect(r.sync).toEqual(['node-expand', 'expanded-change']);
    expect(r.all).toEqual(['node-expand', 'expanded-change']); // no echo on the microtask
    r = await track(page, `t.collapseNodes('1');`);
    expect(r.sync).toEqual(['node-collapse', 'expanded-change']);
    r = await track(page, `t.expandAll();`);
    expect(r.sync).toEqual(['expanded-change']);
    r = await track(page, `t.collapseAll();`);
    expect(r.sync).toEqual(['expanded-change']);
  });

  test('the controller fires it too', async ({ page }) => {
    await make(page);
    const r = await track(page, `t.controller.expandNodes('2');`);
    expect(r.sync).toEqual(['node-expand', 'expanded-change']);
  });
});

test.describe('tree-change = structure only', () => {
  test('expand / select / check / focus fire no tree-change', async ({ page }) => {
    await make(page, { attrs: { 'selection-mode': 'multiple', 'show-checkboxes': '' } });
    const r = await track(page, `t.expandNodes('1'); t.selectNodes(['1.1']); t.checkNodes(['3']); t.focusNode('2'); t.expandAll();`);
    expect(r.all).not.toContain('tree-change');
    await nodeContent(nodeByPath(page, '1.2')).click();
    await page.waitForTimeout(50);
    expect(await log(page)).not.toContain('tree-change');
  });

  test('each mutation fires exactly one tree-change', async ({ page }) => {
    await make(page);
    const ops = [
      `t.addNode('3', { id: 31, path: '3.1', name: 'G child' });`,
      `t.updateNode('3', { name: 'Gamma 2' });`,
      `t.moveNode('3', '1', 'before');`,
      `t.removeNode('2');`,
      `t.applyChanges([{ type: 'add', parentPath: '1', data: { id: 13, path: '1.3', name: 'x' } }, { type: 'update', path: '1.1', data: { name: 'y' } }]);`,
      `t.addBranch('1', [{ id: 14, path: '1.4', name: 'b' }]);`,
      `t.sortAll();`,
    ];
    for (const op of ops) {
      const r = await track(page, op);
      expect(r.all.filter((e) => e === 'tree-change'), op).toEqual(['tree-change']);
      expect(r.sync, op).not.toContain('tree-change'); // on the microtask after the change
    }
  });

  test('loading nodes fires no tree-change', async ({ page }) => {
    await make(page);
    const r = await track(page, `t.nodes = window.baseNodes().slice(0, 3);`);
    expect(r.all).not.toContain('tree-change');
  });
});

test.describe('keyboard (WAI-ARIA)', () => {
  const press = async (page: Page, path: string, key: string) => {
    await nodeContent(nodeByPath(page, path)).click();
    await page.evaluate(() => { (window as any).__log = []; });
    await page.keyboard.press(key);
    await page.waitForTimeout(50);
  };

  test('Enter expands / collapses the focused node', async ({ page }) => {
    await make(page, { attrs: { 'click-behavior': 'select' } });
    await press(page, '1', 'Enter');
    expect(await get(page, 'expandedPaths')).toEqual(['1']);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(50);
    expect(await get(page, 'expandedPaths')).toEqual([]);
  });

  test('Space toggles the checkbox when checkboxes are shown (no expand)', async ({ page }) => {
    await make(page, { attrs: { 'click-behavior': 'select', 'show-checkboxes': '' } });
    await press(page, '1', 'Space');
    expect(await get(page, 'checkedPaths')).toContain('1');
    expect(await get(page, 'expandedPaths')).toEqual([]);
    expect(await log(page)).toContain('checked-change');
    await page.keyboard.press('Space');
    await page.waitForTimeout(50);
    expect(await get(page, 'checkedPaths')).toEqual([]);
  });

  test('Space toggles the focused node in the selection in multiple mode', async ({ page }) => {
    await make(page, { attrs: { 'click-behavior': 'select', 'selection-mode': 'multiple' } });
    await nodeContent(nodeByPath(page, '2')).click();
    await page.keyboard.press('ArrowDown'); // -> 3 (replaces the selection)
    await press(page, '3', 'Space'); // click selected 3; Space toggles it out
    expect(await get(page, 'selectedPaths')).toEqual([]);
    expect(await get(page, 'expandedPaths')).toEqual([]);
    await page.keyboard.press('ArrowUp'); // -> 2 (selects 2)
    await page.keyboard.press('Space'); // toggles 2 out
    await page.waitForTimeout(50);
    expect(await get(page, 'selectedPaths')).toEqual([]);
    await page.keyboard.press('Space'); // and back in
    await page.waitForTimeout(50);
    expect(await get(page, 'selectedPaths')).toEqual(['2']);
  });

  test('Space selects the focused node in single mode (no expand)', async ({ page }) => {
    await make(page, { attrs: { 'click-behavior': 'select' } });
    await nodeContent(nodeByPath(page, '1')).click();
    await page.evaluate(() => (window as any).tree.clearSelection(['1'])); // keeps the focus
    await page.keyboard.press('Space');
    await page.waitForTimeout(50);
    expect(await get(page, 'selectedPaths')).toEqual(['1']);
    expect(await get(page, 'expandedPaths')).toEqual([]);
    await page.keyboard.press('Space'); // single mode: stays selected
    await page.waitForTimeout(50);
    expect(await get(page, 'selectedPaths')).toEqual(['1']);
  });
});
