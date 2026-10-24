import { test, expect, Page } from './fixtures';

/**
 * E2E coverage for the `silent: true` option on selectNode / selectNodes /
 * clearSelection / clearChecked.
 *
 * The fixture counts node-clicked / selection-change / checked-change events
 * (the web-component's DOM-level events, equivalent to the Svelte build's
 * onNodeClick/onSelectionChange/onCheckedChange callbacks). Each control
 * button calls a single tree method once with options omitted ("loud") and
 * once with { silent: true }. The spec asserts that counters do NOT bump in
 * silent mode but state still updates.
 */

const PAGE = '/test/silent-selection.html';

async function goto(page: Page) {
  await page.goto(PAGE);
  await expect(page.locator('.wtv__node').first()).toBeVisible();
}

async function counter(page: Page, name: 'click' | 'selection' | 'checked'): Promise<number> {
  const txt = await page.getByTestId(`counter-${name}`).textContent();
  return Number(txt ?? '0');
}

async function selectedSize(page: Page): Promise<number> {
  return Number(await page.getByTestId('selected-size').textContent() ?? '0');
}

async function checkedSize(page: Page): Promise<number> {
  return Number(await page.getByTestId('checked-size').textContent() ?? '0');
}

// ── selectNode ───────────────────────────────────────────────────────────

test.describe('selectNode', () => {
  test('loud: fires selection-change (no node-click) and updates state', async ({ page }) => {
    // Note: selectNode is a programmatic call — it doesn't synthesize a
    // node-clicked event (that's only for user clicks). The spec just checks
    // that selection-change fires and state updates.
    await goto(page);
    await page.getByTestId('reset-counters').click();

    await page.getByTestId('select-loud').click();

    expect(await counter(page, 'selection')).toBe(1);
    expect(await selectedSize(page)).toBe(1);
    await expect(page.getByTestId('selected-paths')).toHaveText('1.2');
  });

  test('silent: skips selection-change but updates selectedPaths and DOM class', async ({ page }) => {
    await goto(page);
    await page.getByTestId('reset-counters').click();

    await page.getByTestId('select-silent').click();

    expect(await counter(page, 'selection')).toBe(0);
    await expect(page.getByTestId('last-clicked')).toHaveText('(none)');

    expect(await selectedSize(page)).toBe(1);
    await expect(page.getByTestId('selected-paths')).toHaveText('1.2');

    // selectedNodeClass lands on the inner .wtv__node-content so styling
    // affects only the visible row, not the children indentation area.
    await expect(
      page.locator('.wtv__node[data-tree-path="1.2"] > .wtv__node-row > .wtv__node-content').first()
    ).toHaveClass(/test-selected/);
  });

  test('silent then loud: counter only increments for loud call', async ({ page }) => {
    await goto(page);
    await page.getByTestId('reset-counters').click();

    await page.getByTestId('select-silent').click();
    await page.getByTestId('select-other-silent').click();
    expect(await counter(page, 'selection')).toBe(0);
    expect(await selectedSize(page)).toBe(1);
    await expect(page.getByTestId('selected-paths')).toHaveText('2.1');

    await page.getByTestId('select-loud').click();
    expect(await counter(page, 'selection')).toBe(1);
    await expect(page.getByTestId('selected-paths')).toHaveText('1.2');
  });
});

// ── selectNodes ──────────────────────────────────────────────────────────

test.describe('selectNodes', () => {
  test('loud: fires selection-change; sets all paths', async ({ page }) => {
    await goto(page);
    await page.getByTestId('reset-counters').click();

    await page.getByTestId('select-many-loud').click();

    expect(await counter(page, 'selection')).toBe(1);
    expect(await selectedSize(page)).toBe(2);
    await expect(page.getByTestId('selected-paths')).toHaveText('1.1,1.2');
  });

  test('silent: skips selection-change; sets all paths', async ({ page }) => {
    await goto(page);
    await page.getByTestId('reset-counters').click();

    await page.getByTestId('select-many-silent').click();

    expect(await counter(page, 'selection')).toBe(0);
    expect(await selectedSize(page)).toBe(2);
    await expect(page.getByTestId('selected-paths')).toHaveText('1.1,1.2');
  });
});

// ── clearSelection ──────────────────────────────────────────────────────────

test.describe('clearSelection', () => {
  test('loud after select: fires selection-change; clears state', async ({ page }) => {
    await goto(page);
    await page.getByTestId('select-silent').click();
    await page.getByTestId('reset-counters').click();

    await page.getByTestId('clear-loud').click();

    expect(await counter(page, 'selection')).toBe(1);
    expect(await selectedSize(page)).toBe(0);
  });

  test('silent after select: skips selection-change; clears state', async ({ page }) => {
    await goto(page);
    await page.getByTestId('select-silent').click();
    await page.getByTestId('reset-counters').click();

    await page.getByTestId('clear-silent').click();

    expect(await counter(page, 'selection')).toBe(0);
    expect(await selectedSize(page)).toBe(0);
  });
});

// ── clearChecked ───────────────────────────────────────────────────────────

test.describe('clearChecked', () => {
  test('loud after checkbox check: fires checked-change; clears state', async ({ page }) => {
    await goto(page);

    const checkbox = page.locator('.wtv__node[data-tree-path="1.2"] .wtv__checkbox').first();
    await checkbox.click();
    expect(await checkedSize(page)).toBeGreaterThan(0);

    await page.getByTestId('reset-counters').click();
    await page.getByTestId('clear-checked-loud').click();

    expect(await counter(page, 'checked')).toBe(1);
    expect(await checkedSize(page)).toBe(0);
  });

  test('silent after checkbox check: skips checked-change; clears state', async ({ page }) => {
    await goto(page);

    const checkbox = page.locator('.wtv__node[data-tree-path="1.2"] .wtv__checkbox').first();
    await checkbox.click();
    expect(await checkedSize(page)).toBeGreaterThan(0);

    await page.getByTestId('reset-counters').click();
    await page.getByTestId('clear-checked-silent').click();

    expect(await counter(page, 'checked')).toBe(0);
    expect(await checkedSize(page)).toBe(0);
  });
});

// ── URL-restore scenario ────────────────────────────────────────────────────

test.describe('URL-restore scenario', () => {
  test('silent select + interactive click still fires (no callback poisoning)', async ({ page }) => {
    await goto(page);
    await page.getByTestId('reset-counters').click();

    await page.getByTestId('select-silent').click();
    expect(await counter(page, 'selection')).toBe(0);
    expect(await counter(page, 'click')).toBe(0);

    await page.locator('.wtv__node[data-tree-path="2"] .wtv__node-content').first().click();
    expect(await counter(page, 'click')).toBe(1);
    expect(await counter(page, 'selection')).toBe(1);
  });
});
