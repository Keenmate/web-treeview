import { test, expect, type Page, nodeByPath, nodeContent, logLines } from './fixtures';

/**
 * `disabled` / `readonly` (core SPEC §6.4 — every data-input component has the pair)
 * on /test/disabled-readonly.html.
 *
 *   1 A ── 1.1 A1, 1.2 A2
 *   2 B ── 2.1 B1
 *   3 C
 *
 * disabled — no user interaction at all, out of the tab order, aria-disabled, dimmed.
 * readonly — no data change (check, drag, drop, cut / paste / delete), but focusable and
 * navigable (keyboard, expand / collapse, selection, copy), not dimmed.
 * Calls from code work under both.
 */

const PAGE = '/test/disabled-readonly.html';
const LOG = 'log';

async function load(page: Page, state = '') {
  await page.goto(PAGE + (state ? `?state=${state}` : ''));
  await expect(nodeByPath(page, '3')).toBeVisible();
}

const body = (page: Page) => page.locator('web-treeview .wtv__tree');
const box = (page: Page, path: string) => nodeByPath(page, path).locator('.wtv__checkbox').first();
const content = (page: Page, path: string) => nodeContent(nodeByPath(page, path));
const lines = (page: Page) => logLines(page, LOG);
const clearLog = (page: Page) => page.getByTestId(LOG).evaluate((el) => { el.textContent = ''; });
const setProp = (page: Page, key: string, value: unknown) =>
  page.evaluate(([k, v]) => { (window as any).tree[k as string] = v; return (window as any).tree.whenSettled(); }, [key, value] as const);
/** The shadow root's focused element (class name) — `''` when focus is elsewhere. */
const shadowFocus = (page: Page) =>
  page.evaluate(() => ((window as any).tree.shadowRoot.activeElement as HTMLElement | null)?.className ?? '');

/** Synthetic drag events on a node row: was `dragstart` cancelled / `dragover` accepted? */
const dragProbe = (page: Page, path: string) =>
  page.evaluate((p) => {
    const tree = (window as any).tree as HTMLElement;
    const el = tree.shadowRoot!.querySelector(`.wtv__node[data-tree-path="${p}"] .wtv__node-content`)!;
    const fire = (type: string) => {
      const e = new DragEvent(type, { bubbles: true, cancelable: true, composed: true, dataTransfer: new DataTransfer() });
      el.dispatchEvent(e);
      return e.defaultPrevented;
    };
    const isDragStartPrevented = fire('dragstart');
    fire('dragend');
    const isDragOverAccepted = fire('dragover');
    return { isDragStartPrevented, isDragOverAccepted };
  }, path);

/** Synthetic keydown on the tree body (reaches the listener even when the body can't take focus). */
const keyOnBody = (page: Page, key: string, init: KeyboardEventInit = {}) =>
  page.evaluate(([k, i]) => {
    const tree = (window as any).tree as HTMLElement;
    tree.shadowRoot!.querySelector('.wtv__tree')!.dispatchEvent(new KeyboardEvent('keydown', { key: k as string, bubbles: true, cancelable: true, ...(i as object) }));
  }, [key, init] as const);

test.describe('disabled', () => {
  test('the attribute reflects both ways and sets aria-disabled + drops tabindex', async ({ page }) => {
    await load(page);
    const tree = page.locator('#tree');
    await expect(body(page)).toHaveAttribute('tabindex', '0');
    await setProp(page, 'isDisabled', true);
    await expect(tree).toHaveAttribute('disabled', '');
    await expect(body(page)).toHaveAttribute('aria-disabled', 'true');
    await expect(body(page)).not.toHaveAttribute('tabindex', /.*/);
    await tree.evaluate((el) => el.removeAttribute('disabled'));
    expect(await tree.evaluate((el: any) => el.isDisabled)).toBe(false);
    await expect(body(page)).not.toHaveAttribute('aria-disabled', /.*/);
    await expect(body(page)).toHaveAttribute('tabindex', '0');
  });

  test('no check, select, expand or context menu by pointer', async ({ page }) => {
    await load(page, 'disabled');
    const expanded = await nodeByPath(page, '2').getAttribute('data-expanded');
    await box(page, '1.1').click({ force: true });
    await content(page, '2').click({ force: true });
    await content(page, '3').click({ force: true, button: 'right' });
    await expect(box(page, '1.1')).not.toBeChecked();
    await expect(nodeByPath(page, '2')).toHaveAttribute('data-expanded', expanded!);
    await expect(page.locator('.km-menu')).toHaveCount(0);
    expect(await lines(page)).toEqual([]);
  });

  test('not focusable: Tab skips the tree', async ({ page }) => {
    await load(page, 'disabled');
    await page.getByTestId('before').focus();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('after')).toBeFocused();
    expect(await shadowFocus(page)).toBe('');
  });

  test('keyboard does nothing (navigation, Space, Delete, Ctrl+X)', async ({ page }) => {
    await load(page, 'disabled');
    await page.evaluate(() => (window as any).tree.focusNode?.('1.1'));
    await clearLog(page);
    for (const key of ['ArrowDown', ' ', 'Enter', 'Delete']) await keyOnBody(page, key);
    await keyOnBody(page, 'x', { ctrlKey: true });
    await expect(box(page, '1.1')).not.toBeChecked();
    await expect(nodeByPath(page, '1.1')).toBeVisible();
    expect(await lines(page)).toEqual([]);
  });

  test('no drag out and no drop in', async ({ page }) => {
    await load(page, 'disabled');
    expect(await dragProbe(page, '1.1')).toEqual({ isDragStartPrevented: true, isDragOverAccepted: false });
    expect((await lines(page)).filter((l) => l.startsWith('node-drag-start'))).toEqual([]);
  });

  test('disabling closes an open context menu; the tree is dimmed', async ({ page }) => {
    await load(page);
    await content(page, '3').click({ button: 'right' });
    await expect(page.locator('.km-menu')).toHaveCount(1);
    await setProp(page, 'isDisabled', true);
    await expect(page.locator('.km-menu')).toHaveCount(0);
    const opacity = await page.locator('web-treeview .wtv__container').evaluate((el) => Number(getComputedStyle(el).opacity));
    expect(opacity).toBeLessThan(1);
  });

  test('calls from code still work', async ({ page }) => {
    await load(page, 'disabled');
    await page.evaluate(() => { const t = (window as any).tree; t.checkNode('1.1'); t.expandAll(); });
    await expect(box(page, '1.1')).toBeChecked();
    await expect(nodeByPath(page, '2.1')).toBeVisible();
  });

  test('re-enabling restores pointer, keyboard and focus', async ({ page }) => {
    await load(page, 'disabled');
    await setProp(page, 'isDisabled', false);
    await box(page, '1.1').click();
    await expect(box(page, '1.1')).toBeChecked();
    await page.getByTestId('before').focus();
    await page.keyboard.press('Tab');
    expect(await shadowFocus(page)).toContain('wtv__tree');
    expect(dragProbeOk(await dragProbe(page, '1.2'))).toBe(true);
    const opacity = await page.locator('web-treeview .wtv__container').evaluate((el) => Number(getComputedStyle(el).opacity));
    expect(opacity).toBe(1);
  });
});

/** An enabled, writable tree starts a drag (not cancelled). */
const dragProbeOk = (r: { isDragStartPrevented: boolean }) => !r.isDragStartPrevented;

test.describe('readonly', () => {
  test('the attribute reflects both ways; not dimmed, still focusable', async ({ page }) => {
    await load(page);
    const tree = page.locator('#tree');
    await setProp(page, 'isReadonly', true);
    await expect(tree).toHaveAttribute('readonly', '');
    await expect(body(page)).toHaveAttribute('tabindex', '0');
    await expect(body(page)).not.toHaveAttribute('aria-disabled', /.*/);
    const opacity = await page.locator('web-treeview .wtv__container').evaluate((el) => Number(getComputedStyle(el).opacity));
    expect(opacity).toBe(1);
    await tree.evaluate((el) => el.removeAttribute('readonly'));
    expect(await tree.evaluate((el: any) => el.isReadonly)).toBe(false);
  });

  test('no check by click or Space', async ({ page }) => {
    await load(page, 'readonly');
    await box(page, '1.1').click();
    await expect(box(page, '1.1')).not.toBeChecked();
    await content(page, '1.2').click();
    await page.keyboard.press(' ');
    await expect(box(page, '1.2')).not.toBeChecked();
    expect((await lines(page)).filter((l) => l.startsWith('checked-change'))).toEqual([]);
  });

  test('no drag out and no drop in', async ({ page }) => {
    await load(page, 'readonly');
    expect(await dragProbe(page, '1.1')).toEqual({ isDragStartPrevented: true, isDragOverAccepted: false });
    expect((await lines(page)).filter((l) => l.startsWith('node-drag-start'))).toEqual([]);
  });

  test('Delete / Ctrl+X / Ctrl+V change nothing; Ctrl+C still copies', async ({ page }) => {
    await load(page, 'readonly');
    await content(page, '3').click();
    await page.keyboard.press('Delete');
    await page.keyboard.press('Control+x');
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    await expect(nodeByPath(page, '3')).toBeVisible();
    const log = await lines(page);
    expect(log.filter((l) => /^node-(delete|cut|paste)/.test(l))).toEqual([]);
    expect(log).toContain('node-copy:3');
  });

  test('context menu: data-changing items are disabled, copy is not', async ({ page }) => {
    await load(page, 'readonly');
    await content(page, '1').click({ button: 'right' });
    const item = (label: string) => page.locator('.km-menu .km-menu__item').filter({ hasText: new RegExp(`^${label}`) });
    for (const label of ['Cut', 'Paste', 'Delete', 'Sort all']) await expect(item(label)).toHaveAttribute('aria-disabled', 'true');
    for (const label of ['Copy']) await expect(item(label)).not.toHaveAttribute('aria-disabled', 'true');
  });

  test('focus, keyboard navigation, expand and selection still work', async ({ page }) => {
    await load(page, 'readonly');
    await page.getByTestId('before').focus();
    await page.keyboard.press('Tab');
    expect(await shadowFocus(page)).toContain('wtv__tree');
    const wasExpanded = await nodeByPath(page, '2').getAttribute('data-expanded');
    await content(page, '2').click();
    await expect(nodeByPath(page, '2')).not.toHaveAttribute('data-expanded', wasExpanded!);
    await page.keyboard.press('ArrowDown');
    const log = await lines(page);
    expect(log.some((l) => l.startsWith('selection-change:2'))).toBe(true);
    expect(log.some((l) => l.startsWith('expanded-change'))).toBe(true);
    expect(log.filter((l) => l.startsWith('focus-change:')).pop()).not.toBe('focus-change:2');
  });

  test('calls from code still work', async ({ page }) => {
    await load(page, 'readonly');
    await page.evaluate(() => { const t = (window as any).tree; t.checkNode('1.1'); t.removeNodes(['3']); });
    await expect(box(page, '1.1')).toBeChecked();
    await expect(nodeByPath(page, '3')).toHaveCount(0);
  });

  test('switching readonly off restores checking and dragging', async ({ page }) => {
    await load(page, 'readonly');
    await setProp(page, 'isReadonly', false);
    await box(page, '1.1').click();
    await expect(box(page, '1.1')).toBeChecked();
    expect(dragProbeOk(await dragProbe(page, '1.2'))).toBe(true);
  });
});
