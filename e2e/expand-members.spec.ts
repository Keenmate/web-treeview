import { test, expect, type Page, nodeByPath, nodeContent } from './fixtures';

/**
 * Expansion state from data + the expanded-paths API (/test/expand-members.html).
 *
 *   1 Open A   (open, NOT collapsible) ── 1.1 A1 ── 1.1.1 A1x
 *   2 Closed B ── 2.1 B1
 *   3 Open C   (open) ── 3.1 C1
 */

const PAGE = '/test/expand-members.html';

async function load(page: Page, mode: string) {
  await page.goto(`${PAGE}?mode=${mode}`);
  await expect(nodeByPath(page, '3')).toBeVisible();
}

const rows = (page: Page): Promise<string[]> => page.evaluate(() => (window as any).rowPaths());
const expanded = (page: Page) => page.evaluate(() => [...(window as any).tree.getExpandedPaths()].sort());
const toggleOf = (page: Page, path: string) =>
  nodeByPath(page, path).locator('> .wtv__node-row .wtv__toggle-icon').first();

test.describe('getExpandedPaths / setExpandedPaths', () => {
  test('setExpandedPaths opens exactly those branches; getExpandedPaths reads them back', async ({ page }) => {
    await load(page, 'api');
    expect(await rows(page)).toEqual(['1', '2', '3']);
    await page.evaluate(() => (window as any).tree.setExpandedPaths(['1', '1.1']));
    await expect.poll(() => rows(page)).toEqual(['1', '1.1', '1.1.1', '2', '3']);
    expect(await expanded(page)).toEqual(['1', '1.1']);
  });

  test('round-trip: a saved set restores the same view after collapseAll', async ({ page }) => {
    await load(page, 'api');
    await nodeContent(nodeByPath(page, '2')).click();
    await toggleOf(page, '3').click();
    await expect.poll(() => rows(page)).toEqual(['1', '2', '2.1', '3', '3.1']);
    const saved = await expanded(page);
    expect(saved).toEqual(['2', '3']);

    await page.evaluate(() => (window as any).tree.collapseAll());
    await expect.poll(() => rows(page)).toEqual(['1', '2', '3']);
    await page.evaluate((s) => (window as any).tree.setExpandedPaths(s), saved);
    await expect.poll(() => rows(page)).toEqual(['1', '2', '2.1', '3', '3.1']);
  });

  test('setExpandedPaths replaces (closes branches not in the list)', async ({ page }) => {
    await load(page, 'api');
    await page.evaluate(() => (window as any).tree.setExpandedPaths(['2', '3']));
    await expect.poll(() => rows(page)).toEqual(['1', '2', '2.1', '3', '3.1']);
    await page.evaluate(() => (window as any).tree.setExpandedPaths(['1']));
    await expect.poll(() => rows(page)).toEqual(['1', '1.1', '2', '3']);
  });
});

test('is-expanded-member seeds expansion from data (overrides expand-level=0)', async ({ page }) => {
  await load(page, 'member');
  await expect.poll(() => rows(page)).toEqual(['1', '1.1', '2', '3', '3.1']);
  await expect(toggleOf(page, '1')).toHaveClass(/expanded/);
  await expect(toggleOf(page, '2')).not.toHaveClass(/expanded/);
});

test('getIsExpandedCallback seeds expansion per node (callback reads node.data)', async ({ page }) => {
  await load(page, 'callback');
  await expect.poll(() => rows(page)).toEqual(['1', '1.1', '2', '3', '3.1']);
});

test.describe('is-collapsible-member', () => {
  test('a non-collapsible node ignores its toggle (stays open)', async ({ page }) => {
    await load(page, 'collapsible');
    await expect(nodeByPath(page, '1.1')).toBeVisible();
    await toggleOf(page, '1').click();
    await page.waitForTimeout(100);
    await expect(nodeByPath(page, '1.1')).toBeVisible();
    expect(await expanded(page)).toContain('1');
  });

  test('a collapsible sibling still toggles', async ({ page }) => {
    await load(page, 'collapsible');
    await expect(nodeByPath(page, '3.1')).toBeVisible();
    await toggleOf(page, '3').click();
    await expect(nodeByPath(page, '3.1')).toHaveCount(0);
  });
});
