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

test.describe('Search folding (core normalizeSearchText)', () => {
  test('an unaccented query finds accented nodes (Český, Łódź, Straße)', async ({ page }) => {
    await gotoSearch(page);
    const out = await page.evaluate(async () => {
      const el = document.createElement('web-treeview') as any;
      el.setAttribute('enable-internal-search-index', 'true');
      el.displayValueMember = 'name';
      el.searchValueMember = 'name';
      el.nodes = [
        { id: 1, path: '1', name: 'Český Krumlov' },
        { id: 2, path: '2', name: 'Łódź' },
        { id: 3, path: '3', name: 'Hauptstraße' },
        { id: 4, path: '4', name: 'Brno' },
      ];
      const indexed = new Promise<void>((resolve) => el.addEventListener('index-progress', (e: CustomEvent) => {
        if (e.detail.isComplete) resolve();
      }));
      document.body.appendChild(el);
      await indexed;
      const names = (q: string) => el.searchNodes(q).map((n: any) => n.data.name);
      const result = { ces: names('ces'), lodz: names('lodz'), strasse: names('strasse'), accentedQuery: names('ČESKÝ') };
      el.remove();
      return result;
    });
    expect(out.ces).toEqual(['Český Krumlov']);
    expect(out.lodz).toEqual(['Łódź']);
    expect(out.strasse).toEqual(['Hauptstraße']);
    expect(out.accentedQuery).toEqual(['Český Krumlov']);
  });
});

test.describe('Search value resolution', () => {
  test('a row without the searchValueMember field is indexed through getSearchValueCallback', async ({ page }) => {
    await gotoSearch(page);
    const out = await page.evaluate(async () => {
      const el = document.createElement('web-treeview') as any;
      el.setAttribute('enable-internal-search-index', 'true');
      el.displayValueMember = 'name';
      el.searchValueMember = 'keywords';
      el.getSearchValueCallback = (node: any) => `${node.data?.name} callback`;
      el.nodes = [
        { id: 1, path: '1', name: 'alpha' },
        { id: 2, path: '2', name: 'bravo' },
        { id: 3, path: '3', name: 'delta', keywords: 'kilo' },
      ];
      const indexed = new Promise<void>((resolve) => el.addEventListener('index-progress', (e: CustomEvent) => {
        if (e.detail.isComplete) resolve();
      }));
      document.body.appendChild(el);
      await indexed;
      const names = (q: string) => el.searchNodes(q).map((n: any) => n.data.name).sort();
      const result = { kilo: names('kilo'), callback: names('callback') };
      el.remove();
      return result;
    });
    // the member wins when present; the indexer used to skip the callback whenever a member was set
    expect(out.kilo).toEqual(['delta']);
    expect(out.callback).toEqual(['alpha', 'bravo']);
  });
});

