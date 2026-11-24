import { test, expect, type Page, nodeByPath, nodeContent, logLines } from './fixtures';

/**
 * Regressions from svelte-treeview's 2026-11-19 review (svelte-treeview
 * docs/REVIEW-2026-11-19.md — R… / B… ids), mirrored for web-treeview on /test/regressions.html.
 *
 *   main: 1 Alpha → 1.1 Beta → 1.1.1 Gamma, 1.1.2 Delta; 1.2 Eta match; 2 Epsilon → 2.1 Zeta match
 *         (cascade checkboxes, internal search, id-minting input transform, F2 / Del menu items)
 *   acc:  accordion; 1 Open → 1.1, 2 Closed → 2.1, 3 Locked (not collapsible) → 3.1
 *   inp:  row 1 renders an <input>
 *
 * Drag regressions (B7, B9) live in drag-hooks.spec.ts (they need the HTML5 drag fixture).
 */

const PAGE = '/test/regressions.html';

const section = (page: Page, id: string) => page.getByTestId(`${id}-section`);
const row = (page: Page, path: string, id = 'main') => nodeByPath(section(page, id), path);
const content = (page: Page, path: string, id = 'main') => nodeContent(row(page, path, id));
const box = (page: Page, path: string) => row(page, path).locator('.wtv__checkbox').first();
const label = (page: Page, path: string, id = 'main') => row(page, path, id).locator('.wtv__node-label').first();
const toggle = (page: Page, path: string, id = 'main') => row(page, path, id).locator('.wtv__toggle-icon').first();
const setSearch = (page: Page, term: string) =>
  page.evaluate((t) => { (window as any).__main.searchTerm = t; }, term);
const real = (page: Page) => page.evaluate(() => (window as any).__real() as string[]);

async function load(page: Page, query = '') {
  await page.goto(PAGE + query);
  await page.waitForFunction(() => !!(window as any).__ready);
  await expect(row(page, '1.1.1')).toBeVisible();
}

test.describe('checkbox state', () => {
  test.beforeEach(({ page }) => load(page));

  test('R1: uncheckAll clears a [-] branch too', async ({ page }) => {
    await box(page, '1.1.1').click();
    await expect(box(page, '1.1')).toHaveClass(/wtv__checkbox--indeterminate/);
    await page.evaluate(() => (window as any).__main.uncheckAll());
    for (const p of ['1', '1.1', '1.1.1']) {
      await expect(box(page, p), p).not.toHaveClass(/wtv__checkbox--indeterminate/);
      await expect(box(page, p), p).not.toBeChecked();
    }
  });

  test('R1: assigning checkedPaths clears a [-] branch the new set does not cover', async ({ page }) => {
    await box(page, '1.1.1').click();
    await expect(box(page, '1')).toHaveClass(/wtv__checkbox--indeterminate/);
    await page.evaluate(() => { (window as any).__main.checkedPaths = ['2.1']; });
    await expect(box(page, '2.1')).toBeChecked();
    for (const p of ['1', '1.1', '1.1.1']) {
      await expect(box(page, p), p).not.toHaveClass(/wtv__checkbox--indeterminate/);
      await expect(box(page, p), p).not.toBeChecked();
    }
  });
});

test.describe('B2: state follows a removal / move', () => {
  test.beforeEach(({ page }) => load(page));
  const call = (page: Page, fn: string, ...args: unknown[]) =>
    page.evaluate(([fn, args]) => (window as any).__main[fn as string](...(args as unknown[])), [fn, args] as const);
  const read = (page: Page, prop: string) =>
    page.evaluate((p) => [...(window as any).__main[p]].sort(), prop);

  test('a removed checked node leaves checkedPaths and its parent re-derives', async ({ page }) => {
    await box(page, '1.1.1').click();
    await expect(box(page, '1.1')).toHaveClass(/wtv__checkbox--indeterminate/);
    await call(page, 'removeNode', '1.1.1');
    await expect(row(page, '1.1.1')).toHaveCount(0);
    expect(await read(page, 'checkedPaths')).toEqual([]);
    for (const p of ['1', '1.1']) {
      await expect(box(page, p), p).not.toHaveClass(/wtv__checkbox--indeterminate/);
      await expect(box(page, p), p).not.toBeChecked();
    }
  });

  test('removing the only unchecked sibling makes the parent checked', async ({ page }) => {
    await box(page, '1.1.1').click();
    await call(page, 'removeNode', '1.1.2');
    await expect(box(page, '1.1')).toBeChecked();
    await expect(box(page, '1')).toHaveClass(/wtv__checkbox--indeterminate/);
    expect(await read(page, 'checkedPaths')).toEqual(['1.1']); // rolled-up
  });

  test('moveNode re-derives the old and the new parent', async ({ page }) => {
    await box(page, '1.1.1').click();
    await call(page, 'moveNode', '1.1.2', '2', 'child');
    await expect(box(page, '1.1')).toBeChecked();
    await expect(box(page, '2')).not.toBeChecked();
    await expect(box(page, '2')).not.toHaveClass(/wtv__checkbox--indeterminate/);
  });

  test('a removed node leaves the selection and the focus', async ({ page }) => {
    await call(page, 'selectNodes', ['1.1.2', '2']);
    expect(await read(page, 'selectedPaths')).toEqual(['1.1.2', '2']);
    await call(page, 'focusNode', '1.1.1');
    await call(page, 'removeNode', '1.1');
    await expect.poll(() => read(page, 'selectedPaths')).toEqual(['2']);
    await expect.poll(() => page.evaluate(() => (window as any).__main.focusedNode?.path ?? null)).toBe(null);
  });

  test('assigning nodes right after a mutation loads the new data', async ({ page }) => {
    // Guard: a mutation no longer sets _skipInsertArray (a direct TreeViewState.data set right
    // after one was ignored; the element batches nodes to a microtask, so it never hit this).
    await page.evaluate(() => {
      const t = (window as any).__main;
      t.removeNode('2');
      t.nodes = [{ id: 50, path: '1', name: 'Fresh' }];
    });
    await expect(label(page, '1')).toHaveText('Fresh');
    await expect(section(page, 'main').locator('.wtv__node')).toHaveCount(1);
  });
});

test('R2: pasting a 3-level subtree with an id-minting transform keeps the grandchildren', async ({ page }) => {
  await load(page);
  const result = await page.evaluate(() => {
    const t = (window as any).__main;
    t.copyNodes(['1']);
    return t.pasteNodes('2', undefined, 'child');
  });
  expect(result).toMatchObject({ success: true, count: 5, skipped: 0 });
  const names = (await real(page)).map((e) => e.split('=')[1]);
  expect(names.filter((n) => n === 'Gamma')).toHaveLength(2);
  expect(names.filter((n) => n === 'Delta')).toHaveLength(2);
});

test('B12: a before / after paste lands next to the target, roots in source order', async ({ page }) => {
  await load(page);
  const childNames = (path: string) =>
    page.evaluate((p) => (window as any).__main.getChildren(p).map((n: any) => n.data.name), path);
  await page.evaluate(() => ((window as any).__main.isSortingEnabled = false));
  await expect.poll(() => page.evaluate(() => (window as any).__main.isSortingEnabled)).toBe(false);
  const paste = (paths: string[], target: string, position: string) =>
    page.evaluate(
      ([paths, target, position]) => {
        const t = (window as any).__main;
        t.copyNodes(paths);
        return t.pasteNodes(target, undefined, position);
      },
      [paths, target, position] as const
    );
  expect(await paste(['1.1.1', '1.1.2'], '1.2', 'before')).toMatchObject({ success: true, count: 2, skipped: 0 });
  // Used to be appended to the parent: Beta, Eta match, Gamma, Delta.
  expect(await childNames('1')).toEqual(['Beta', 'Gamma', 'Delta', 'Eta match']);
  await paste(['1.1.1', '1.1.2'], '2.1', 'after');
  expect(await childNames('2')).toEqual(['Zeta match', 'Gamma', 'Delta']);
  await paste(['1.2'], '2.1', 'after');
  expect(await childNames('2')).toEqual(['Zeta match', 'Eta match', 'Gamma', 'Delta']);
});

test.describe('while filtered', () => {
  test.beforeEach(async ({ page }) => {
    await load(page);
    await setSearch(page, 'match');
    await expect(row(page, '1.1')).toHaveCount(0);
    await expect(row(page, '2.1')).toBeVisible();
  });

  test('R3: a node removed while filtered is gone at once and stays gone when the filter clears', async ({ page }) => {
    await page.evaluate(() => (window as any).__main.removeNode('2.1'));
    await expect(row(page, '2.1')).toHaveCount(0);
    await setSearch(page, '');
    await expect(row(page, '1.1')).toBeVisible();
    await expect(row(page, '2')).toBeVisible();
    await expect(row(page, '2.1')).toHaveCount(0);
    expect(await real(page)).not.toContain('2.1=Zeta match');
  });

  test('R3: a node moved while filtered lands in the real tree', async ({ page }) => {
    await page.evaluate(() => (window as any).__main.moveNode('1.2', '2', 'child'));
    await setSearch(page, '');
    await expect(row(page, '1.1')).toBeVisible();
    expect(await real(page)).toContain('2.2=Eta match');
    expect((await real(page)).some((e) => e.startsWith('1.2='))).toBe(false);
  });

  test('R5: a node selected + focused while filtered stays so when the filter clears', async ({ page }) => {
    await label(page, '2.1').click();
    await setSearch(page, '');
    await expect(row(page, '1.1')).toBeVisible();
    await expect(content(page, '2.1')).toHaveClass(/wtv__node-content--selected/);
    await expect(content(page, '2.1')).toHaveClass(/wtv__node-content--focused/);
    // focusedNode is the REAL node, not the filtered copy that was thrown away.
    expect(
      await page.evaluate(() => {
        const t = (window as any).__main;
        return t.focusedNode === t.getTree().getNodeByPath('2.1', t.getTree().root);
      })
    ).toBe(true);
  });
});

test('R4: assigning expandedPaths updates the expand arrow of a still-visible row', async ({ page }) => {
  await load(page);
  await expect(toggle(page, '1')).toHaveClass(/wtv__toggle-icon--expanded/);
  await page.evaluate(() => { (window as any).__main.expandedPaths = ['2']; });
  await expect(row(page, '1.1')).toHaveCount(0);
  await expect(toggle(page, '1')).not.toHaveClass(/wtv__toggle-icon--expanded/);
  await expect(toggle(page, '2')).toHaveClass(/wtv__toggle-icon--expanded/);
});

test('R7: named-key menu item shortcuts fire (F2, Del alias)', async ({ page }) => {
  await load(page);
  const menu = page.locator('.km-menu').first();
  await label(page, '1.1').click({ button: 'right' });
  await expect(menu).toBeVisible();
  await page.keyboard.press('F2');
  await expect.poll(() => logLines(page, 'log')).toContain('menu:F2:1.1');
  await label(page, '1.1').click({ button: 'right' });
  await expect(menu).toBeVisible();
  await page.keyboard.press('Delete');
  await expect.poll(() => logLines(page, 'log')).toContain('menu:Del:1.1');
  expect(await real(page)).toContain('1.1=Beta');
});

test('B1: node-delete reports the removed paths when one in the middle fails', async ({ page }) => {
  await load(page, '?delete=gap');
  await label(page, '1').click();
  await page.keyboard.press('Delete');
  await expect.poll(() => logLines(page, 'log')).toEqual(['delete:1.2,2.1']);
  expect(await real(page)).not.toContain('2.1=Zeta match');
});

test.describe('B3: keyboard toggle = the toggle glyph', () => {
  test.beforeEach(async ({ page }) => {
    await load(page);
    await page.evaluate(() => { (window as any).__acc.expandedPaths = ['1', '3']; });
    await expect(row(page, '1.1', 'acc')).toBeVisible();
    await expect(row(page, '3.1', 'acc')).toBeVisible();
    await expect(row(page, '2.1', 'acc')).toHaveCount(0);
  });

  test('Enter honours accordion mode', async ({ page }) => {
    await label(page, '2', 'acc').click();
    await page.keyboard.press('Enter');
    await expect(row(page, '2.1', 'acc')).toBeVisible();
    await expect(row(page, '1.1', 'acc')).toHaveCount(0);
    await expect(row(page, '3.1', 'acc')).toBeVisible(); // not collapsible: the accordion leaves it
  });

  test('Enter / Backspace do not collapse a non-collapsible node', async ({ page }) => {
    await label(page, '3', 'acc').click();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    await expect(row(page, '3.1', 'acc')).toBeVisible();
    await label(page, '3.1', 'acc').click();
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(400);
    await expect(row(page, '3.1', 'acc')).toBeVisible();
  });
});

test('B13: search works without requestIdleCallback (Safari)', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as any).requestIdleCallback;
  });
  await load(page);
  expect(await page.evaluate(() => typeof (window as any).requestIdleCallback)).toBe('undefined');
  await setSearch(page, 'zeta');
  await expect(row(page, '2.1')).toBeVisible();
  await expect(row(page, '1.1')).toHaveCount(0);
});

test('B18: keys typed in an input inside a row edit the input, not the tree', async ({ page }) => {
  await load(page);
  const input = section(page, 'input').getByTestId('row-input');
  await input.click();
  await input.press('End');
  await input.press('Backspace');
  await input.press('ArrowLeft');
  await input.press('Delete');
  await expect(input).toHaveValue('te');
  await input.press('Home');
  await input.press('Delete');
  await expect(input).toHaveValue('e');
  await expect(row(page, '1', 'input')).toHaveCount(1);
  await expect(row(page, '1.1', 'input')).toBeVisible();
});

test('B19: insertArray reports duplicate paths as failures with their own row', async ({ page }) => {
  await load(page);
  const result = await page.evaluate(() => {
    const t = (window as any).__inp;
    t.nodes = [
      { id: 1, path: '1', name: 'First' },
      { id: 2, path: '1', name: 'Duplicate' },
      { id: 3, path: '1.1', name: 'Child' },
      { id: 4, path: '9.9', name: 'Orphan' }
    ];
    return new Promise((resolve) =>
      setTimeout(() => {
        const r = t.insertResult;
        resolve({ successful: r.successful, failed: r.failed.map((f: any) => f.originalData.name).sort() });
      }, 100)
    );
  });
  expect(result).toEqual({ successful: 2, failed: ['Duplicate', 'Orphan'] });
});

test.describe('B20: statistics', () => {
  test.beforeEach(({ page }) => load(page));

  test('removeNode(path) still drops the whole subtree from nodeCount', async ({ page }) => {
    const counts = await page.evaluate(() => {
      const lt = (window as any).__main.getTree();
      const before = lt.statistics.nodeCount;
      lt.removeNode('1.1');
      return [before, lt.statistics.nodeCount];
    });
    expect(counts).toEqual([7, 4]);
  });

  test('filteredNodeCount counts the filtered view', async ({ page }) => {
    await setSearch(page, 'match');
    await expect(row(page, '1.1')).toHaveCount(0);
    // Alpha, Eta match, Epsilon, Zeta match
    expect(await page.evaluate(() => (window as any).__main.getTree().statistics.filteredNodeCount)).toBe(4);
  });
});

test.describe('options after setup (svelte §3.1)', () => {
  test.beforeEach(({ page }) => load(page));

  test('B17: a new member re-inserts the data — expansion, selection and checks kept by path', async ({ page }) => {
    await box(page, '2.1').click();
    await label(page, '1.1.1').click();
    await page.evaluate(() => (window as any).__main.collapseNodes('2'));
    await expect(row(page, '2.1')).toHaveCount(0);

    await page.evaluate(() => ((window as any).__main.displayValueMember = 'path'));
    await expect(label(page, '1.1.1')).toHaveText('1.1.1');
    await expect(row(page, '2.1')).toHaveCount(0);
    await expect(content(page, '1.1.1')).toHaveClass(/wtv__node-content--selected/);
    await expect(box(page, '2')).toBeChecked();
  });

  test('B17: expandLevel re-seeds the expansion', async ({ page }) => {
    await page.evaluate(() => ((window as any).__main.expandLevel = 1));
    await expect(row(page, '1.1')).toBeVisible();
    await expect(row(page, '1.1.1')).toHaveCount(0);
  });
});
