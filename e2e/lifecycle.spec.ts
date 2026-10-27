import { test, expect, type Page, nodeByPath, nodeContent, logLines } from './fixtures';

/**
 * DOM move keeps state (decision D1, e2e-coverage-plan): a re-parent is
 * disconnect → connect, NOT a rebuild (/test/lifecycle.html).
 *
 *   1 A ── 1.1 A1, 1.2 A2
 *   2 B ── 2.1 B1
 */

const PAGE = '/test/lifecycle.html';
const LOG = 'lc-log';

async function load(page: Page) {
  await page.goto(PAGE);
  await expect(nodeByPath(page, '2')).toBeVisible();
}

const rows = (page: Page) => page.locator('.wtv__node[data-tree-path]').evaluateAll((els) => els.map((e) => e.getAttribute('data-tree-path')));
const selected = (page: Page) => page.evaluate(() => [...(window as any).tree.selectedPaths].sort());
const toggleOf = (page: Page, path: string) => nodeByPath(page, path).locator('> .wtv__node-row .wtv__toggle-icon').first();

async function setUpState(page: Page) {
  await toggleOf(page, '1').click();
  await expect(nodeByPath(page, '1.1')).toBeVisible();
  await nodeContent(nodeByPath(page, '1.1')).click();
  await nodeContent(nodeByPath(page, '2')).click({ modifiers: ['Control'] });
  await nodeByPath(page, '1.2').locator('.wtv__checkbox').first().click();
  expect(await selected(page)).toEqual(['1.1', '2']);
}

test('re-parenting keeps expansion, selection, checks and focus', async ({ page }) => {
  await load(page);
  await setUpState(page);
  const rowsBefore = await rows(page);
  const focusedBefore = await page.evaluate(() => (window as any).tree.focusedNode?.path);

  await page.evaluate(() => (window as any).moveTo('slot-b'));
  await expect(page.locator('#slot-b web-treeview')).toHaveCount(1);

  expect(await rows(page)).toEqual(rowsBefore);
  expect(await selected(page)).toEqual(['1.1', '2']);
  await expect(nodeContent(nodeByPath(page, '1.1'))).toHaveClass(/wtv__node-content--selected/);
  await expect(nodeByPath(page, '1.2').locator('.wtv__checkbox').first()).toBeChecked();
  expect(await page.evaluate(() => (window as any).tree.focusedNode?.path)).toBe(focusedBefore);
});

test('after a move, clicks and keys still work and fire exactly once', async ({ page }) => {
  await load(page);
  await setUpState(page);
  await page.evaluate(() => (window as any).moveTo('slot-b'));
  await page.evaluate(() => { document.querySelector('[data-testid="lc-log"]')!.textContent = ''; });

  await nodeContent(nodeByPath(page, '2')).click();
  await expect.poll(() => logLines(page, LOG)).toContain('node-click:2');
  await page.waitForTimeout(100);
  const clicks = (await logLines(page, LOG)).filter((l) => l.startsWith('node-click:'));
  expect(clicks).toEqual(['node-click:2']);

  await page.keyboard.press('ArrowUp');
  await expect.poll(() => page.evaluate(() => (window as any).tree.focusedNode?.path)).toBe('1');
});

test('detached for a while then re-attached: state survives, no rebuild flash', async ({ page }) => {
  await load(page);
  await setUpState(page);
  const rowsBefore = await rows(page);
  await page.evaluate(() => (window as any).detachFor(100));
  await expect(page.locator('#slot-a web-treeview')).toHaveCount(1);
  expect(await rows(page)).toEqual(rowsBefore);
  expect(await selected(page)).toEqual(['1.1', '2']);
});

test('a config change made while detached is applied on reconnect', async ({ page }) => {
  await load(page);
  await page.evaluate(async () => {
    const t = (window as any).tree;
    const parent = t.parentElement;
    t.remove();
    t.setAttribute('show-checkboxes', 'false');
    await new Promise((r) => setTimeout(r, 50));
    parent.appendChild(t);
  });
  await expect(page.locator('.wtv__checkbox')).toHaveCount(0);
});

test('remove + re-append (synchronous) keeps expansion, selection, checks, focus and search', async ({ page }) => {
  await load(page);
  await setUpState(page);
  await page.evaluate(() => { (window as any).tree.searchTerm = 'A'; });
  const rowsBefore = await rows(page);
  const focusedBefore = await page.evaluate(() => (window as any).tree.focusedNode?.path);

  await page.evaluate(() => {
    const t = (window as any).tree;
    const parent = t.parentElement;
    t.remove();
    parent.appendChild(t);
  });

  expect(await rows(page)).toEqual(rowsBefore);
  expect(await selected(page)).toEqual(['1.1', '2']);
  expect(await page.evaluate(() => [...(window as any).tree.checkedPaths])).toEqual(['1.2']);
  expect(await page.evaluate(() => (window as any).tree.focusedNode?.path)).toBe(focusedBefore);
  expect(await page.evaluate(() => (window as any).tree.searchTerm)).toBe('A');
});

test('a move keeps the virtual-scroll offset and the rendered window', async ({ page }) => {
  await page.goto('/test/virtual-scroll.html?mode=virtual');
  await expect(nodeByPath(page, '1.1')).toBeAttached();
  const vsBody = page.locator('.wtv__virtual-scroll').first();
  const rowH = await nodeByPath(page, '1').evaluate((el) => el.getBoundingClientRect().height);
  await vsBody.evaluate((el, top) => { el.scrollTop = top; el.dispatchEvent(new Event('scroll')); }, rowH * 2500);
  await expect(nodeByPath(page, '26')).toBeVisible();
  const before = await vsBody.evaluate((el) => el.scrollTop);
  expect(before).toBeGreaterThan(0);

  // Re-parent into a new wrapper (remove + insert elsewhere).
  await page.evaluate(() => {
    const t = (window as any).tree as HTMLElement;
    const wrap = document.createElement('div');
    document.body.appendChild(wrap);
    wrap.appendChild(t);
  });

  expect(await vsBody.evaluate((el) => el.scrollTop)).toBe(before);
  await expect(nodeByPath(page, '26')).toBeVisible();
  await expect(nodeByPath(page, '1.1')).toHaveCount(0);
});

/** Track the document / window listeners currently attached, per `target:type`. */
async function trackGlobalListeners(page: Page) {
  await page.addInitScript(() => {
    const live = new Map<string, Set<unknown>>();
    (window as any).__globalListeners = () => {
      const out: Record<string, number> = {};
      for (const [k, set] of live) if (set.size) out[k] = set.size;
      return out;
    };
    for (const [name, target] of [['doc', document], ['win', window]] as const) {
      const add = target.addEventListener;
      const remove = target.removeEventListener;
      target.addEventListener = function (this: EventTarget, type: string, listener: any, opts?: any) {
        const k = `${name}:${type}`;
        if (!live.has(k)) live.set(k, new Set());
        if (!(typeof opts === 'object' && opts?.once)) live.get(k)!.add(listener);
        return add.call(this, type, listener, opts);
      } as typeof target.addEventListener;
      target.removeEventListener = function (this: EventTarget, type: string, listener: any, opts?: any) {
        live.get(`${name}:${type}`)?.delete(listener);
        return remove.call(this, type, listener, opts);
      } as typeof target.removeEventListener;
    }
  });
}

test('no duplicated listeners after N moves; detached = document listeners released', async ({ page }) => {
  await trackGlobalListeners(page);
  await load(page);
  await setUpState(page);
  const listeners = () => page.evaluate(() => (window as any).__globalListeners());
  const baseline = await listeners();
  expect(baseline['doc:dragend']).toBeGreaterThanOrEqual(1);

  // Detached: the tree's document-level dragend listener is released.
  const detached = await page.evaluate(() => {
    const t = (window as any).tree;
    const parent = t.parentElement;
    t.remove();
    const snap = (window as any).__globalListeners();
    parent.appendChild(t);
    return snap;
  });
  expect(detached['doc:dragend'] ?? 0).toBe(baseline['doc:dragend'] - 1);

  for (let i = 0; i < 6; i++) {
    await page.evaluate((slot) => (window as any).moveTo(slot), i % 2 ? 'slot-a' : 'slot-b');
  }
  expect(await listeners()).toEqual(baseline);

  // Behaviour after the moves: one click → one event, one key → one step.
  await page.evaluate(() => { document.querySelector('[data-testid="lc-log"]')!.textContent = ''; });
  await nodeContent(nodeByPath(page, '1')).click();
  await expect.poll(() => logLines(page, LOG)).toContain('node-click:1');
  await page.waitForTimeout(100);
  expect((await logLines(page, LOG)).filter((l) => l.startsWith('node-click:'))).toEqual(['node-click:1']);
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => page.evaluate(() => (window as any).tree.focusedNode?.path)).toBe('2');
});

test('an open context menu closes on a move and leaves no document listeners behind', async ({ page }) => {
  await trackGlobalListeners(page);
  await load(page);
  await page.evaluate(() => { (window as any).tree.getContextMenuItemsCallback = () => ['copy', 'delete']; });
  const baseline = await page.evaluate(() => (window as any).__globalListeners());

  await page.evaluate(() => (window as any).tree.openContextMenu('1', 50, 50));
  await expect(page.locator('.km-menu')).toBeVisible();
  // The menu's dismiss listeners attach on the next frame.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

  await page.evaluate(() => (window as any).moveTo('slot-b'));
  await expect(page.locator('.km-menu')).toBeHidden();
  expect(await page.evaluate(() => (window as any).__globalListeners())).toEqual(baseline);
});

test('core ready: `ready` attribute + :state(ready) after the first build, host visible', async ({ page }) => {
  await load(page);
  const tree = page.locator('#tree');
  await expect(tree).toHaveAttribute('ready', '');
  expect(await page.evaluate(() => (window as any).tree.matches(':state(ready)'))).toBe(true);
  expect(await page.evaluate(() => (window as any).tree.isReady)).toBe(true);
  expect(await tree.evaluate((el) => getComputedStyle(el).visibility)).toBe('visible');
});

test('a deferred tree stays hidden (no ready) until release()', async ({ page }) => {
  await load(page);
  const state = await page.evaluate(async () => {
    const el = document.createElement('web-treeview') as any;
    el.setAttribute('defer', '');
    el.data = [{ id: 1, path: '1', name: 'X' }];
    document.body.appendChild(el);
    await new Promise((r) => setTimeout(r, 50));
    const before = { ready: el.hasAttribute('ready'), visibility: getComputedStyle(el).visibility, rows: el.shadowRoot.querySelectorAll('.wtv__node').length };
    el.release();
    await el.whenReady();
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const after = { ready: el.hasAttribute('ready'), visibility: getComputedStyle(el).visibility, rows: el.shadowRoot.querySelectorAll('.wtv__node').length };
    return { before, after };
  });
  expect(state.before).toEqual({ ready: false, visibility: 'hidden', rows: 0 });
  expect(state.after.ready).toBe(true);
  expect(state.after.visibility).toBe('visible');
  expect(state.after.rows).toBe(1);
});

test('destroy() tears the tree engine down: methods become no-ops, isDestroyed', async ({ page }) => {
  await load(page);
  const out = await page.evaluate(() => {
    const el = (window as any).tree;
    el.destroy();
    el.expandAll();
    return { isDestroyed: el.isDestroyed, node: el.getNodeByPath('1') };
  });
  expect(out).toEqual({ isDestroyed: true, node: null });
});

test('state properties: assigned before the first build are applied after it; controller mirrors them read-only', async ({ page }) => {
  await load(page);
  const out = await page.evaluate(async () => {
    const el = document.createElement('web-treeview') as any;
    el.setAttribute('show-checkboxes', '');
    el.setAttribute('selection-mode', 'multiple');
    el.data = [{ id: 1, path: '1', name: 'A' }, { id: 11, path: '1.1', name: 'A1' }, { id: 2, path: '2', name: 'B' }];
    el.expandedPaths = ['1'];
    el.selectedPaths = new Set(['1.1', '2']);
    el.checkedPaths = ['2'];
    document.body.appendChild(el);
    await el.whenReady();
    const c = el.controller;
    let threw = false;
    try { c.selectedPaths = new Set(); } catch { threw = true; }
    return {
      expanded: el.expandedPaths, selected: [...el.selectedPaths].sort(), checked: [...el.checkedPaths],
      cExpanded: c.expandedPaths, cSelected: [...c.selectedPaths].sort(), cChecked: [...c.checkedPaths],
      focused: el.focusedNode?.path ?? null, cFocused: c.focusedNode?.path ?? null, threw, stillSelected: [...el.selectedPaths].length,
    };
  });
  expect(out.expanded).toEqual(['1']);
  expect(out.selected).toEqual(['1.1', '2']);
  expect(out.checked).toEqual(['2']);
  expect(out.cExpanded).toEqual(['1']);
  expect(out.cSelected).toEqual(['1.1', '2']);
  expect(out.cChecked).toEqual(['2']);
  expect(out.cFocused).toBe(out.focused);
  expect(out.stillSelected).toBe(2);
});
