import { test, expect, type Page, type Locator, nodeByPath, WEBKIT_NO_NATIVE_DND, hasNoNativeDnd } from './fixtures';

/**
 * Screen-reader announcements through core `announce()` (the page's one polite
 * `[data-km-announcer]` live region): a settled search, a placed drop, a refused
 * drop. Selection / expand-collapse are NOT announced (they have ARIA state).
 * A label set to `''` stays silent.
 *
 * Fixture: test/announce.html — #tree (default labels), #silent (announce* = '').
 *   1 Apple ── 1.1 Apricot
 *   2 Banana
 *   3 Locked (does not accept drops)
 */

const PAGE = '/test/announce.html';

const region = (page: Page) => page.locator('[data-km-announcer="polite"]');
const tree = (page: Page, id: string) => page.locator(`#${id}`);
const row = (node: Locator) => node.locator('> .wtv__node-row .wtv__node-content').first();

async function search(page: Page, id: string, term: string): Promise<void> {
  await page.evaluate(([i, t]) => { (document.getElementById(i) as any).searchTerm = t; }, [id, term]);
}

async function dragInto(src: Locator, dst: Locator): Promise<void> {
  const box = (await dst.boundingBox())!;
  await src.dragTo(dst, { targetPosition: { x: box.width * 0.8, y: box.height / 2 } });
}

test.beforeEach(async ({ page }) => {
  await page.goto(PAGE);
  await page.waitForFunction(() => (window as any).__ready === true);
  await expect(nodeByPath(tree(page, 'tree'), '1.1')).toBeVisible();
});

test('a settled search says the match count; no match says "No results found"', async ({ page }) => {
  await search(page, 'tree', 'Ap');
  await expect(region(page)).toHaveText('2 results');
  await search(page, 'tree', 'Banana');
  await expect(region(page)).toHaveText('1 result');
  await search(page, 'tree', 'zzz');
  await expect(region(page)).toHaveText('No results found');
});

test.describe('drops', () => {
  test.skip(hasNoNativeDnd, WEBKIT_NO_NATIVE_DND);

  test('a placed drop says what moved where', async ({ page }) => {
    const t = tree(page, 'tree');
    await dragInto(row(nodeByPath(t, '1.1')), row(nodeByPath(t, '2')));
    await expect(region(page)).toHaveText('Apricot moved into Banana');
  });

  test('a refused drop says why', async ({ page }) => {
    const t = tree(page, 'tree');
    await dragInto(row(nodeByPath(t, '2')), row(nodeByPath(t, '3')));
    await expect(region(page)).toHaveText('Cannot drop here: Locked does not accept dropped items');
  });

  test("labels set to '' stay silent", async ({ page }) => {
    const s = tree(page, 'silent');
    await dragInto(row(nodeByPath(s, '2')), row(nodeByPath(s, '3')));
    await dragInto(row(nodeByPath(s, '1.1')), row(nodeByPath(s, '2')));
    await expect(nodeByPath(s, '2.1')).toBeAttached();   // the drop happened
    await search(page, 'silent', 'Ap');
    await expect(nodeByPath(s, '3')).toHaveCount(0);      // the search applied
    await page.waitForTimeout(300);
    expect(await region(page).count() === 0 || (await region(page).textContent()) === '').toBe(true);
  });
});
