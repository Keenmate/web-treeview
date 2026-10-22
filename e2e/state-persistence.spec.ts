import { test, expect, Page, Locator } from '@playwright/test';

/**
 * Regression for the web-grid-style state-off-nodes refactor.
 *
 * Bug: every property/attribute change on <web-treeview> resends the full config,
 * which re-triggers insertArray (a full data re-insert with fresh node objects).
 * Runtime state that lived ON the nodes (selection, checked state, expansion)
 * was silently reset to defaults by that re-insert.
 *
 * Fix: selected + checked are read from controller-owned sets the renderer
 * consults (snapshot.selectedPaths / checkedPaths — survive the re-insert);
 * expansion is captured before the re-insert and re-applied to the fresh nodes.
 * This spec forces a re-insert (re-setting a member) and asserts nothing resets.
 */

const PAGE = '/test/selection-focus.html';

function tree(page: Page) {
  return page.locator('.wtv__container').first();
}
function node(page: Page, path: string): Locator {
  return tree(page).locator(`.wtv__node[data-tree-path="${path}"]`).first();
}
function isSelected(page: Page, path: string): Promise<boolean> {
  return node(page, path)
    .locator('.wtv__node-content')
    .first()
    .evaluate((el) => [...el.classList].some((c) => c === 'wtv__node-content--selected'));
}
function isExpanded(page: Page, path: string): Promise<boolean> {
  return node(page, path).getAttribute('data-expanded').then((v) => v === 'true');
}

// Force a GENUINE tree recreation. Toggling displayValueMember between two real
// members ('name' ⇄ 'id') is a real member change → the A2 value-compare guard
// fires → the controller tears down and rebuilds the LTree with fresh node
// objects. Only the label text changes; paths (which the assertions key on) are
// untouched. That rebuild is exactly what the state-off-nodes refactor must
// survive.
//
// NOTE: re-setting a member to its CURRENT value no longer forces a rebuild —
// that's what the A2 guard fixed (see the "A2 guard" describe block below), so
// the old force-by-same-value trick is now a no-op and can't be used here.
async function forceRebuild(page: Page) {
  await page.evaluate(() => {
    const el = document.getElementById('tree') as any;
    el.displayValueMember = el.displayValueMember === 'name' ? 'id' : 'name';
  });
  await page.waitForTimeout(250);
}

// Count controller LTree recreations by watching the init logger, which emits
// "Recreating LTree due to member mapping changes" on every teardown+rebuild
// (initLogger defaults to debug level, so it reaches the console).
function watchRecreations(page: Page): string[] {
  const hits: string[] = [];
  page.on('console', (msg) => {
    if (msg.text().includes('Recreating LTree')) hits.push(msg.text());
  });
  return hits;
}

test.describe('runtime state survives a config-change re-insert', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE);
    await expect(node(page, '1')).toBeVisible();
  });

  test('selection survives a re-insert', async ({ page }) => {
    await page.evaluate(() => (document.getElementById('tree') as any).setSelectedPaths(['1']));
    await expect.poll(() => isSelected(page, '1')).toBe(true);

    await forceRebuild(page);

    expect(await isSelected(page, '1')).toBe(true); // was lost pre-refactor
  });

  test('expansion survives a re-insert', async ({ page }) => {
    await page.evaluate(() => {
      const el = document.getElementById('tree') as any;
      el.collapseAll();
      el.expandNodes('1');
    });
    await expect.poll(() => isExpanded(page, '1')).toBe(true);

    await forceRebuild(page);

    expect(await isExpanded(page, '1')).toBe(true); // was reset to expandLevel default pre-refactor
  });
});

/**
 * A2 value-compare guard: the web-component's buildConfig() resends EVERY set
 * member + callback on ANY property change, so a plain presence check
 * (`updates.X !== undefined`) recreated the whole LTree on cosmetic changes.
 * The guard now compares each incoming value against the one baked into the
 * live tree and only recreates on a real change. These specs pin that: a
 * same-value resend recreates NOTHING; a genuine change still does.
 */
test.describe('A2 guard — cosmetic resends do not recreate the tree', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE);
    await expect(node(page, '1')).toBeVisible();
  });

  test('re-setting a member to its CURRENT value does not recreate', async ({ page }) => {
    const recreations = watchRecreations(page);

    await page.evaluate(() => {
      const el = document.getElementById('tree') as any;
      el.displayValueMember = el.displayValueMember; // same string → no real change
    });
    await page.waitForTimeout(250);

    expect(recreations).toHaveLength(0); // pre-A2 this logged a recreation
  });

  test('a GENUINE member/callback change still recreates (guard is not over-eager)', async ({ page }) => {
    const recreations = watchRecreations(page);

    await page.evaluate(() => {
      const el = document.getElementById('tree') as any;
      // A different real member is a genuine change the guard must catch.
      el.displayValueMember = 'id';
    });
    await page.waitForTimeout(250);

    expect(recreations.length).toBeGreaterThan(0);
  });
});
