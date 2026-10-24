import { test, expect, Page, Locator, nodeByPath, cssAttrEscape } from './fixtures';

/**
 * E2E coverage for /test/data.html.
 *
 * Three cards, four trees total:
 *   1. "Path-Based Data Structure"   — default '.' separator, 4 nodes
 *   2. "Custom Path Separators"      — two side-by-side trees:
 *        a. slash '/'
 *        b. double-colon '::'
 *   3. "Insert Result and Validation" — feeds orphan / duplicate / empty paths
 *      so the test can verify the insertResult diagnostics.
 *
 * Custom node template prints "<name> (<path>)" so the spec can assert on
 * both label and path text.
 */

const PAGE = '/test/data.html';

function cardByHeading(page: Page, heading: string): Locator {
  return page.locator('.card').filter({ has: page.locator('h2', { hasText: heading }) }).first();
}

function pathCard(page: Page): Locator {
  return cardByHeading(page, 'Path-Based Data Structure');
}

function separatorCard(page: Page): Locator {
  return cardByHeading(page, 'Custom Path Separators');
}

function insertCard(page: Page): Locator {
  return cardByHeading(page, 'Insert Result and Validation');
}

function fallbackCard(page: Page): Locator {
  return cardByHeading(page, 'Display Value Fallback');
}

function slashTree(page: Page): Locator {
  return separatorCard(page).locator('.tree-container').nth(0);
}

function colonTree(page: Page): Locator {
  return separatorCard(page).locator('.tree-container').nth(1);
}

function treeInCard(card: Locator): Locator {
  return card.locator('.tree-container').first();
}

async function gotoData(page: Page) {
  await page.goto(PAGE);
  await expect(page.locator('.wtv__node').first()).toBeVisible();
}

// ── Path-Based Data Structure ──────────────────────────────────────────────

test.describe('Path-Based Data Structure', () => {
  test('renders all four nodes of the dot-separated hierarchy with their paths visible', async ({ page }) => {
    await gotoData(page);
    const tree = treeInCard(pathCard(page));

    await expect(nodeByPath(tree, '1')).toBeVisible();
    await expect(nodeByPath(tree, '1.1')).toBeVisible();
    await expect(nodeByPath(tree, '1.1.1')).toBeVisible();
    await expect(nodeByPath(tree, '1.2')).toBeVisible();

    await expect(nodeByPath(tree, '1')).toContainText('Root');
    await expect(nodeByPath(tree, '1')).toContainText('(1)');
    await expect(nodeByPath(tree, '1.1.1')).toContainText('Grandchild');
    await expect(nodeByPath(tree, '1.1.1')).toContainText('(1.1.1)');
  });
});

// ── Custom Path Separators ─────────────────────────────────────────────────

test.describe('Custom Path Separators', () => {
  test('slash separator: paths like "home/user/documents" build the expected hierarchy', async ({ page }) => {
    await gotoData(page);
    const tree = slashTree(page);

    await expect(nodeByPath(tree, 'home')).toBeVisible();
    await expect(nodeByPath(tree, 'home/user')).toBeVisible();
    await expect(nodeByPath(tree, 'home/user/documents')).toBeVisible();
    await expect(nodeByPath(tree, 'home/user/downloads')).toBeVisible();
    await expect(nodeByPath(tree, 'var')).toBeVisible();
    await expect(nodeByPath(tree, 'var/log')).toBeVisible();

    await expect(nodeByPath(tree, 'home')).toContainText('/home');
    await expect(nodeByPath(tree, 'var/log')).toContainText('/var/log');
  });

  test('double-colon separator: paths like "App::Services::Auth" build the expected namespaces', async ({ page }) => {
    await gotoData(page);
    const tree = colonTree(page);

    await expect(nodeByPath(tree, 'App')).toBeVisible();
    await expect(nodeByPath(tree, 'App::Services')).toBeVisible();
    await expect(nodeByPath(tree, 'App::Services::Auth')).toBeVisible();
    await expect(nodeByPath(tree, 'App::Models')).toBeVisible();
    await expect(nodeByPath(tree, 'App::Models::User')).toBeVisible();

    await expect(nodeByPath(tree, 'App::Services::Auth')).toContainText('App::Services::Auth');
  });
});

// ── Insert Result and Validation ───────────────────────────────────────────

test.describe('Insert Result and Validation', () => {
  test('valid items render; orphans + empty paths land in insertResult.failed; duplicate path overrides', async ({ page }) => {
    await gotoData(page);
    const card = insertCard(page);
    const tree = treeInCard(card);

    await expect(nodeByPath(tree, '1')).toBeVisible();
    await expect(nodeByPath(tree, '1.1')).toBeVisible();
    await expect(nodeByPath(tree, '1.2')).toBeVisible();
    await expect(nodeByPath(tree, '1.1')).toContainText('Valid Child');

    await expect(tree).not.toContainText('Orphan');
    await expect(tree).not.toContainText('Empty Path');
    await expect(tree).not.toContainText('Duplicate Path');

    const output = card.locator('.output pre').first();
    await expect(output).not.toHaveText('');
    const json = JSON.parse((await output.textContent()) ?? '{}');
    expect(json.total).toBe(6);
    expect(json.successful).toBe(4);
    expect(json.failed).toBe(2);

    const failedNames = (json.failedDetails as Array<{ originalData?: { name?: string } }>).
      map((d) => d.originalData?.name);
    expect(failedNames).toEqual(
      expect.arrayContaining(['Orphan (parent 2 missing)', 'Empty Path'])
    );
    expect(json.failedDetails).toHaveLength(2);
  });
});

// ── Display Value Fallback ─────────────────────────────────────────────────

test.describe('Display Value Fallback', () => {
  test('a missing display member resolves to displayValueFallback and does not crash the sort', async ({ page }) => {
    await gotoData(page);
    const tree = treeInCard(fallbackCard(page));

    // All three nodes render (sort tiebreak on an undefined display value used to throw).
    await expect(nodeByPath(tree, '1')).toBeVisible();
    await expect(nodeByPath(tree, '1.1')).toBeVisible();
    await expect(nodeByPath(tree, '1.2')).toBeVisible();

    // Every label falls back to the configured text instead of being blank/undefined.
    await expect(nodeByPath(tree, '1')).toContainText('(no name)');
    await expect(nodeByPath(tree, '1.1')).toContainText('(no name)');
  });
});
