import { test, expect, Page } from '@playwright/test';

/**
 * NodeRenderContext passed as the last arg to the render callbacks (renderIconCallback /
 * renderNodeCallback). The fixture's renderIconCallback stamps ctx fields onto the
 * .wtv__node-icon element. Fixture: test/render-context.html
 */

const ctx = (page: Page, path: string) =>
	page.locator(`[data-tree-path="${path}"] [data-testid="ctx"]`).first();

test.beforeEach(async ({ page }) => {
	await page.goto('/test/render-context.html');
	await expect(ctx(page, '1')).toHaveText('•');
});

test('node-state fields reflect each node', async ({ page }) => {
	const root = ctx(page, '1');
	await expect(root).toHaveAttribute('data-haschildren', 'true');
	await expect(root).toHaveAttribute('data-expanded', 'true');
	await expect(root).toHaveAttribute('data-level', '1');

	const leaf = ctx(page, '1.1.1');
	await expect(leaf).toHaveAttribute('data-haschildren', 'false');
	await expect(leaf).toHaveAttribute('data-level', '3');
});

test('device + container fields are populated', async ({ page }) => {
	const root = ctx(page, '1');
	expect(['mobile', 'tablet', 'desktop']).toContain(await root.getAttribute('data-device'));
	expect(Number(await root.getAttribute('data-cw'))).toBeGreaterThan(0);
});

test('isExpanded updates on collapse (diff reconciler re-renders the icon)', async ({ page }) => {
	await expect(ctx(page, '1')).toHaveAttribute('data-expanded', 'true');
	await page.locator('[data-tree-path="1"] .wtv__toggle-icon').first().click();
	await expect(ctx(page, '1')).toHaveAttribute('data-expanded', 'false');
});

test('isChecked flips when the checkbox is toggled', async ({ page }) => {
	const leaf = ctx(page, '1.1.1');
	await expect(leaf).toHaveAttribute('data-checked', 'false');
	await page.locator('[data-tree-path="1.1.1"] .wtv__checkbox').first().click();
	await expect(leaf).toHaveAttribute('data-checked', 'true');
});

test('isSelected + isFocused flip when a row is clicked', async ({ page }) => {
	const leaf = ctx(page, '1.1.1');
	await expect(leaf).toHaveAttribute('data-selected', 'false');
	await expect(leaf).toHaveAttribute('data-focused', 'false');
	await page.locator('[data-tree-path="1.1.1"] .wtv__node-content').first().click();
	await expect(leaf).toHaveAttribute('data-focused', 'true');
	await expect(leaf).toHaveAttribute('data-selected', 'true');
});
