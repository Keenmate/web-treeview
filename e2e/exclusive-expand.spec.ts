import { test, expect } from './fixtures';

/**
 * Regression: an API call to `expandNodes(path, { isExclusive: true })` must
 * collapse off-spine branches *visually*, including flipping their toggle
 * icon back to the collapsed state. A pure data-only mutation that leaves the
 * toggle UI showing the expanded chevron is a bug.
 *
 * Fixture: three siblings A1, A2, A3 collapsed at expandLevel=0. The spec
 * expands A3 by clicking its toggle, then triggers exclusive-expand on A2 via
 * a button → A3's toggle must lose the `.expanded` class and A3's children
 * must leave the DOM.
 */

test('exclusive expand of A2 collapses previously-expanded A3 in the UI', async ({ page }) => {
  await page.goto('/test/exclusive-expand.html');
  await expect(page.locator('.wtv__node').first()).toBeVisible();

  const a3 = page.locator('.wtv__node[data-tree-path="3"]').first();
  const a3Toggle = a3.locator('> .wtv__node-row .wtv__toggle-icon').first();
  await expect(a3Toggle).not.toHaveClass(/(?:^|\s)expanded(?:\s|$)/);
  await expect(page.locator('.wtv__node[data-tree-path="3.1"]')).toHaveCount(0);

  await a3Toggle.click();
  await expect(a3Toggle).toHaveClass(/(?:^|\s)expanded(?:\s|$)/);
  await expect(page.locator('.wtv__node[data-tree-path="3.1"]').first()).toBeVisible();
  await expect(page.locator('.wtv__node[data-tree-path="3.2"]').first()).toBeVisible();

  await page.getByTestId('exclusive-expand-a2').click();

  const a2 = page.locator('.wtv__node[data-tree-path="2"]').first();
  const a2Toggle = a2.locator('> .wtv__node-row .wtv__toggle-icon').first();
  await expect(a2Toggle).toHaveClass(/(?:^|\s)expanded(?:\s|$)/);
  await expect(page.locator('.wtv__node[data-tree-path="2.1"]').first()).toBeVisible();

  // Critical: A3's toggle UI must reflect the data change.
  await expect(a3Toggle).not.toHaveClass(/(?:^|\s)expanded(?:\s|$)/);
  await expect(page.locator('.wtv__node[data-tree-path="3.1"]')).toHaveCount(0);
  await expect(page.locator('.wtv__node[data-tree-path="3.2"]')).toHaveCount(0);
});
