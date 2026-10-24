import { test, expect, Page, Locator } from './fixtures';

/**
 * E2E coverage for /test/search.html.
 *
 * Single tree (8 countries with 1–2 cities each, 15 nodes total). The fixture
 * builds a minimal search bar that wires the input to tree.filterNodes() and
 * tree.searchNodes() for counter display.
 *
 * The internal FlexSearch index is built asynchronously via requestIdleCallback,
 * so we poll until the counter matches.
 *
 * Stable search terms:
 *   'london'  → 2 matches (London/UK, London/Canada)
 *   'tokyo'   → 1 match
 *   'xxx_no_match' → 0 results
 *
 * NOT ported (svelte build only — needs an upstream search-bar widget):
 *   - mode toggle (filter vs search)
 *   - Enter/Shift+Enter result cycling
 *   - results panel
 *   - container scroll checkbox
 */

const PAGE = '/test/search.html';

function searchInput(page: Page): Locator {
  return page.getByTestId('search-input');
}

function searchCounter(page: Page): Locator {
  return page.getByTestId('search-counter');
}

function clearBtn(page: Page): Locator {
  return page.getByTestId('clear-btn');
}

function treeContainer(page: Page): Locator {
  return page.locator('.tree-container').first();
}

function nodeByName(page: Page, name: string): Locator {
  return treeContainer(page)
    .locator('.wtv__node')
    .filter({ hasText: new RegExp(`^${name}$`) })
    .first();
}

async function gotoSearch(page: Page) {
  await page.goto(PAGE);
  await expect(page.locator('.wtv__node').first()).toBeVisible();
}

async function fillUntilCounter(page: Page, query: string, match: RegExp | string) {
  const input = searchInput(page);
  await expect
    .poll(
      async () => {
        await input.fill('');
        await input.fill(query);
        await page.waitForTimeout(150);
        return (await searchCounter(page).textContent()) ?? '';
      },
      { timeout: 20_000 }
    )
    .toMatch(match instanceof RegExp ? match : new RegExp(`^${match}$`));
}

test.describe('Initial state', () => {
  test('renders the tree with all country roots and no counter', async ({ page }) => {
    await gotoSearch(page);

    await expect(searchInput(page)).toHaveValue('');
    await expect(searchCounter(page)).toBeHidden();

    await expect(nodeByName(page, 'United States')).toBeVisible();
    await expect(nodeByName(page, 'Germany')).toBeVisible();
    await expect(nodeByName(page, 'Japan')).toBeVisible();
  });
});

test.describe('Filter', () => {
  test('typing "london" filters the tree to matching paths', async ({ page }) => {
    await gotoSearch(page);

    await fillUntilCounter(page, 'london', /^\d+\/\d+$/);

    await expect(nodeByName(page, 'London')).toBeVisible();
    await expect(nodeByName(page, 'Tokyo')).toHaveCount(0);
  });

  test('typing a non-matching query shows "0 results"', async ({ page }) => {
    await gotoSearch(page);

    await searchInput(page).fill('xxx_no_match_zzz');

    await expect(searchCounter(page)).toContainText('0 results');
    await expect(searchCounter(page)).toHaveClass(/no-results/);
  });

  test('Clear (×) button empties the input and restores the tree', async ({ page }) => {
    await gotoSearch(page);

    await fillUntilCounter(page, 'tokyo', /^\d+\/\d+$/);

    await clearBtn(page).click();

    await expect(searchInput(page)).toHaveValue('');
    await expect(searchCounter(page)).toBeHidden();
    await expect(nodeByName(page, 'United States')).toBeVisible();
    await expect(nodeByName(page, 'Germany')).toBeVisible();
  });

  test('Escape clears the search', async ({ page }) => {
    await gotoSearch(page);

    await fillUntilCounter(page, 'tokyo', /^\d+\/\d+$/);

    await searchInput(page).press('Escape');

    await expect(searchInput(page)).toHaveValue('');
    await expect(searchCounter(page)).toBeHidden();
  });

  test('searchNodes returns 2 matches for "london" (UK + Canada)', async ({ page }) => {
    await gotoSearch(page);

    await fillUntilCounter(page, 'london', '2/2');
  });
});
