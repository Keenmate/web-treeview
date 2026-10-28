import { test, expect, type Page, nodeByPath, nodeContent } from './fixtures';

/**
 * Core input-model reactivity on <web-treeview> (/test/attr-reactivity.html).
 *
 *   1 A ── 1.1 A1, 1.2 A2
 *   2 B
 *
 * Markup: expand-level=2, show-checkboxes=true, selected-node-class=picked,
 * checkbox-mode=cascade.
 */

const PAGE = '/test/attr-reactivity.html';

async function load(page: Page) {
  await page.goto(PAGE);
  await expect(nodeByPath(page, '2')).toBeVisible();
}

const boxes = (page: Page) => page.locator('.wtv__checkbox');

test.describe('removing an attribute resets the input to its default', () => {
  test('show-checkboxes removed → checkboxes disappear', async ({ page }) => {
    await load(page);
    await expect(boxes(page)).toHaveCount(4);
    await page.evaluate(() => (window as any).tree.removeAttribute('show-checkboxes'));
    await expect(boxes(page)).toHaveCount(0);
  });

  test('selected-node-class removed → the default selected marker returns', async ({ page }) => {
    await load(page);
    await nodeContent(nodeByPath(page, '2')).click();
    await expect(nodeContent(nodeByPath(page, '2'))).toHaveClass(/\bpicked\b/);
    await page.evaluate(() => (window as any).tree.removeAttribute('selected-node-class'));
    await expect(nodeContent(nodeByPath(page, '2'))).not.toHaveClass(/\bpicked\b/);
    await expect(nodeContent(nodeByPath(page, '2'))).toHaveClass(/wtv__node-content--selected/);
  });

  test('expand-level removed → back to the default (roots only)', async ({ page }) => {
    await load(page);
    await expect(nodeByPath(page, '1.1')).toBeVisible();
    await page.evaluate(() => (window as any).tree.removeAttribute('expand-level'));
    await expect(nodeByPath(page, '1.1')).toHaveCount(0);
  });
  test('loading removed → the loading overlay hides', async ({ page }) => {
    await load(page);
    const overlay = page.locator('.wtv__loading-overlay');
    await page.evaluate(() => (window as any).tree.setAttribute('loading', 'true'));
    await expect(overlay).toBeVisible();
    await page.evaluate(() => (window as any).tree.removeAttribute('loading'));
    await expect(overlay).toBeHidden();
  });

  test('virtual-scroll removed → back to the plain (non-virtual) body', async ({ page }) => {
    await load(page);
    const body = page.locator('.wtv__tree').first();
    await page.evaluate(() => (window as any).tree.setAttribute('enable-virtual-scroll', 'true'));
    await expect(body).toHaveClass(/wtv__virtual-scroll/);
    await page.evaluate(() => (window as any).tree.removeAttribute('enable-virtual-scroll'));
    await expect(body).not.toHaveClass(/wtv__virtual-scroll/);
  });

  test('virtual-scroll-overscan / context-menu-x-offset removed → their defaults (5 / 8)', async ({ page }) => {
    await load(page);
    const read = () => page.evaluate(() => {
      const t = (window as any).tree;
      return [t.virtualScrollOverscan, t.contextMenuXOffset];
    });
    await page.evaluate(() => {
      const t = (window as any).tree;
      t.setAttribute('virtual-scroll-overscan', '12');
      t.setAttribute('context-menu-x-offset', '30');
    });
    await expect.poll(read).toEqual([12, 30]);
    await page.evaluate(() => {
      const t = (window as any).tree;
      t.removeAttribute('virtual-scroll-overscan');
      t.removeAttribute('context-menu-x-offset');
    });
    await expect.poll(read).toEqual([5, 8]);
  });

  test('context-menu-x-offset removed → the menu opens at the default offset again', async ({ page }) => {
    await load(page);
    await page.evaluate(() => {
      const t = (window as any).tree;
      t.getContextMenuItemsCallback = () => [{ id: 'x', text: 'X' }];
      t.setAttribute('context-menu-x-offset', '60');
    });
    const menuLeft = async () => {
      await page.evaluate(() => (window as any).tree.openContextMenu('2', 100, 100));
      const left = await page.locator('.km-menu').first().evaluate((m) => m.getBoundingClientRect().left);
      await page.evaluate(() => (window as any).tree.closeContextMenu());
      return left;
    };
    expect(Math.round(await menuLeft())).toBe(160);
    await page.evaluate(() => (window as any).tree.removeAttribute('context-menu-x-offset'));
    await expect.poll(async () => Math.round(await menuLeft())).toBe(108);
  });
});

test('setAttributes applies a batch at once (settled on return)', async ({ page }) => {
  await load(page);
  const props = await page.evaluate(() => {
    const t = (window as any).tree;
    t.setAttributes({ 'checkbox-mode': 'independent', 'selected-node-class': 'chosen' });
    return { mode: t.checkboxMode, cls: t.selectedNodeClass };
  });
  expect(props).toEqual({ mode: 'independent', cls: 'chosen' });
  // independent now: checking the parent leaves the children alone
  await nodeByPath(page, '1').locator('.wtv__checkbox').first().click();
  await expect(nodeByPath(page, '1.1').locator('.wtv__checkbox').first()).not.toBeChecked();
});

test.describe('el.prop = x; el.method() sees x (no await in between)', () => {
  test('data assignment then getNodeByPath', async ({ page }) => {
    await load(page);
    const name = await page.evaluate(() => {
      const t = (window as any).tree;
      t.nodes = (window as any).moreData;
      return t.getNodeByPath('3.1')?.data?.name ?? null;
    });
    expect(name).toBe('C1');
  });

  test('checkboxMode assignment then checkNode', async ({ page }) => {
    await load(page);
    const checked = await page.evaluate(() => {
      const t = (window as any).tree;
      t.checkboxMode = 'independent';
      t.checkNode('1');
      // canonical state: in cascade mode 1.1 would be checked too
      return { parent: t.isNodeChecked('1'), child: t.isNodeChecked('1.1') };
    });
    expect(checked).toEqual({ parent: true, child: false });
  });

  test('via el.controller (which flushes) the same sequence works', async ({ page }) => {
    await load(page);
    const name = await page.evaluate(() => {
      const t = (window as any).tree;
      t.nodes = (window as any).moreData;
      return t.controller.getNodeByPath('3.1')?.data?.name ?? null;
    });
    expect(name).toBe('C1');
  });
});

test('an unrelated attribute change does not re-insert the data (NOTES #18)', async ({ page }) => {
  await load(page);
  const same = await page.evaluate(async () => {
    const t = (window as any).tree;
    const before = t.insertResult;
    t.setAttribute('selected-node-class', 'chosen');
    await t.whenSettled();
    return t.insertResult === before;
  });
  expect(same).toBe(true);
});
