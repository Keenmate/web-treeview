import { test, expect, Page } from './fixtures';

/**
 * Regression: search hit in a collapsed deep branch must expand ancestors AND
 * scroll the container so the match is on-screen.
 *
 * Fixture (/test/search-deep.html): 10×10×10 = 1000 leaves over 3 levels,
 * expandLevel=1 so levels 2 and 3 start collapsed. The tree lives inside a
 * fixed-height (240 px) overflow-auto container with containerScroll=true on
 * scrollToPath, so the only way the target row reaches the viewport is if the
 * controller scrolls the wrapper.
 *
 * The internal FlexSearch index builds via requestIdleCallback. Poll on the
 * result-count testid until the indexer has caught up.
 */

const TARGET_NAME = 'ZZTARGETUNIQUE';
const TARGET_PATH = '9.7.10';

async function fillUntilCounter(page: Page, query: string, expected: string) {
  const input = page.getByTestId('search-input');
  await expect
    .poll(
      async () => {
        await input.fill('');
        await input.fill(query);
        await page.waitForTimeout(150);
        return (await page.getByTestId('result-count').textContent()) ?? '';
      },
      { timeout: 15_000 }
    )
    .toBe(expected);
}

test('search-result navigation expands ancestors and scrolls a collapsed-branch hit into view', async ({ page }) => {
  await page.goto('/test/search-deep.html');
  await expect(page.locator('.wtv__node').first()).toBeVisible();

  await expect(page.locator(`.wtv__node[data-tree-path="${TARGET_PATH}"]`)).toHaveCount(0);

  await fillUntilCounter(page, TARGET_NAME, '1');

  const targetRow = page.locator(`.wtv__node[data-tree-path="${TARGET_PATH}"]`).first();
  await expect(targetRow).toBeVisible();
  await expect(targetRow.locator('.node-name')).toHaveText(TARGET_NAME);

  await page.waitForTimeout(800);

  const container = page.getByTestId('scroll-container');
  const containerBox = await container.boundingBox();
  const rowBox = await targetRow.boundingBox();
  if (!containerBox || !rowBox) throw new Error('missing bounding box');
  expect(rowBox.y).toBeGreaterThanOrEqual(containerBox.y - 1);
  expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(containerBox.y + containerBox.height + 1);

  await expect(targetRow.locator('.wtv__node-content').first()).toHaveClass(/wtv__node-content--scroll-highlight/);
});

test('sequential search to a different collapsed branch scrolls there too', async ({ page }) => {
  await page.goto('/test/search-deep.html');
  await expect(page.locator('.wtv__node').first()).toBeVisible();

  await fillUntilCounter(page, TARGET_NAME, '1');
  const first = page.locator(`.wtv__node[data-tree-path="${TARGET_PATH}"]`).first();
  await expect(first).toBeVisible();
  await page.waitForTimeout(800);

  await fillUntilCounter(page, 'AATARGETUNIQUE', '1');
  const secondPath = '2.3.10';
  const second = page.locator(`.wtv__node[data-tree-path="${secondPath}"]`).first();
  await expect(second).toBeVisible();

  await page.waitForTimeout(800);

  const container = page.getByTestId('scroll-container');
  const containerBox = await container.boundingBox();
  const rowBox = await second.boundingBox();
  if (!containerBox || !rowBox) throw new Error('missing bounding box');
  expect(rowBox.y).toBeGreaterThanOrEqual(containerBox.y - 1);
  expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(containerBox.y + containerBox.height + 1);

  await expect(second.locator('.wtv__node-content').first()).toHaveClass(/wtv__node-content--scroll-highlight/);
});
