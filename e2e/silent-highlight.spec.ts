import { test, expect, Page } from '@playwright/test';

/**
 * E2E coverage for the `silent: true` option on highlightNode / highlightNodes /
 * clearHighlight / clearSelection.
 *
 * The fixture counts node-clicked / highlight-change / selection-change events
 * (the web-component's DOM-level events, equivalent to the Svelte build's
 * onNodeClick/onHighlightChange/onSelectionChange callbacks). Each control
 * button calls a single tree method once with options omitted ("loud") and
 * once with { silent: true }. The spec asserts that counters do NOT bump in
 * silent mode but state still updates.
 */

const PAGE = '/test/silent-highlight.html';

async function goto(page: Page) {
  await page.goto(PAGE);
  await expect(page.locator('.wtv__node').first()).toBeVisible();
}

async function counter(page: Page, name: 'click' | 'highlight' | 'selection'): Promise<number> {
  const txt = await page.getByTestId(`counter-${name}`).textContent();
  return Number(txt ?? '0');
}

async function highlightSize(page: Page): Promise<number> {
  return Number(await page.getByTestId('highlight-size').textContent() ?? '0');
}

async function selectionSize(page: Page): Promise<number> {
  return Number(await page.getByTestId('selection-size').textContent() ?? '0');
}

// ── highlightNode ───────────────────────────────────────────────────────────

test.describe('highlightNode', () => {
  test('loud: fires node-clicked? actually only fires highlight-change; state updates', async ({ page }) => {
    // Note: highlightNode is a programmatic call — it doesn't synthesize a
    // node-clicked event (that's only for user clicks). The spec just checks
    // that highlight-change fires and state updates.
    await goto(page);
    await page.getByTestId('reset-counters').click();

    await page.getByTestId('highlight-loud').click();

    expect(await counter(page, 'highlight')).toBe(1);
    expect(await highlightSize(page)).toBe(1);
    await expect(page.getByTestId('highlight-paths')).toHaveText('1.2');
  });

  test('silent: skips highlight-change but updates highlightedPaths and DOM class', async ({ page }) => {
    await goto(page);
    await page.getByTestId('reset-counters').click();

    await page.getByTestId('highlight-silent').click();

    expect(await counter(page, 'highlight')).toBe(0);
    await expect(page.getByTestId('last-clicked')).toHaveText('(none)');

    expect(await highlightSize(page)).toBe(1);
    await expect(page.getByTestId('highlight-paths')).toHaveText('1.2');

    // highlightedNodeClass lands on the inner .wtv__node-content so styling
    // affects only the visible row, not the children indentation area.
    await expect(
      page.locator('.wtv__node[data-tree-path="1.2"] > .wtv__node-row > .wtv__node-content').first()
    ).toHaveClass(/test-highlighted/);
  });

  test('silent then loud: counter only increments for loud call', async ({ page }) => {
    await goto(page);
    await page.getByTestId('reset-counters').click();

    await page.getByTestId('highlight-silent').click();
    await page.getByTestId('highlight-other-silent').click();
    expect(await counter(page, 'highlight')).toBe(0);
    expect(await highlightSize(page)).toBe(1);
    await expect(page.getByTestId('highlight-paths')).toHaveText('2.1');

    await page.getByTestId('highlight-loud').click();
    expect(await counter(page, 'highlight')).toBe(1);
    await expect(page.getByTestId('highlight-paths')).toHaveText('1.2');
  });
});

// ── highlightNodes ──────────────────────────────────────────────────────────

test.describe('highlightNodes', () => {
  test('loud: fires highlight-change; sets all paths', async ({ page }) => {
    await goto(page);
    await page.getByTestId('reset-counters').click();

    await page.getByTestId('highlight-many-loud').click();

    expect(await counter(page, 'highlight')).toBe(1);
    expect(await highlightSize(page)).toBe(2);
    await expect(page.getByTestId('highlight-paths')).toHaveText('1.1,1.2');
  });

  test('silent: skips highlight-change; sets all paths', async ({ page }) => {
    await goto(page);
    await page.getByTestId('reset-counters').click();

    await page.getByTestId('highlight-many-silent').click();

    expect(await counter(page, 'highlight')).toBe(0);
    expect(await highlightSize(page)).toBe(2);
    await expect(page.getByTestId('highlight-paths')).toHaveText('1.1,1.2');
  });
});

// ── clearHighlight ──────────────────────────────────────────────────────────

test.describe('clearHighlight', () => {
  test('loud after highlight: fires highlight-change; clears state', async ({ page }) => {
    await goto(page);
    await page.getByTestId('highlight-silent').click();
    await page.getByTestId('reset-counters').click();

    await page.getByTestId('clear-loud').click();

    expect(await counter(page, 'highlight')).toBe(1);
    expect(await highlightSize(page)).toBe(0);
  });

  test('silent after highlight: skips highlight-change; clears state', async ({ page }) => {
    await goto(page);
    await page.getByTestId('highlight-silent').click();
    await page.getByTestId('reset-counters').click();

    await page.getByTestId('clear-silent').click();

    expect(await counter(page, 'highlight')).toBe(0);
    expect(await highlightSize(page)).toBe(0);
  });
});

// ── clearSelection ───────────────────────────────────────────────────────────

test.describe('clearSelection', () => {
  test('loud after checkbox check: fires selection-change; clears state', async ({ page }) => {
    await goto(page);

    const checkbox = page.locator('.wtv__node[data-tree-path="1.2"] .wtv__checkbox').first();
    await checkbox.click();
    expect(await selectionSize(page)).toBeGreaterThan(0);

    await page.getByTestId('reset-counters').click();
    await page.getByTestId('clear-selection-loud').click();

    expect(await counter(page, 'selection')).toBe(1);
    expect(await selectionSize(page)).toBe(0);
  });

  test('silent after checkbox check: skips selection-change; clears state', async ({ page }) => {
    await goto(page);

    const checkbox = page.locator('.wtv__node[data-tree-path="1.2"] .wtv__checkbox').first();
    await checkbox.click();
    expect(await selectionSize(page)).toBeGreaterThan(0);

    await page.getByTestId('reset-counters').click();
    await page.getByTestId('clear-selection-silent').click();

    expect(await counter(page, 'selection')).toBe(0);
    expect(await selectionSize(page)).toBe(0);
  });
});

// ── URL-restore scenario ────────────────────────────────────────────────────

test.describe('URL-restore scenario', () => {
  test('silent highlight + interactive click still fires (no callback poisoning)', async ({ page }) => {
    await goto(page);
    await page.getByTestId('reset-counters').click();

    await page.getByTestId('highlight-silent').click();
    expect(await counter(page, 'highlight')).toBe(0);
    expect(await counter(page, 'click')).toBe(0);

    await page.locator('.wtv__node[data-tree-path="2"] .wtv__node-content').first().click();
    expect(await counter(page, 'click')).toBe(1);
    expect(await counter(page, 'highlight')).toBe(1);
  });
});
