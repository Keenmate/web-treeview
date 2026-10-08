import { test, expect, Page } from '@playwright/test';

/**
 * Node tooltips (show-node-tooltips + getNodeTooltipCallback), built on the shared
 * core createTooltip — parity with svelte-treeview's node tooltips and
 * web-multiselect's option tooltips. Portaled into the shadow container as
 * .wtv__tooltip; shown on hover, hidden on leave. tooltip-delay=0 so hover shows
 * immediately.
 *
 * Fixture: test/tooltip.html
 */

const PAGE = '/test/tooltip.html';

const row = (page: Page, treeId: string, path: string) =>
	page.locator(`#${treeId} [data-tree-path="${path}"] .wtv__node-content`).first();

test.beforeEach(async ({ page }) => {
	await page.goto(PAGE);
	await row(page, 'text', '1').waitFor();
});

test('callback: hover shows a .wtv__tooltip with the text; leave hides it', async ({ page }) => {
	await expect(page.locator('.wtv__tooltip')).toHaveCount(0);

	await row(page, 'text', '1').hover();
	const tip = page.locator('.wtv__tooltip.wtv__tooltip--visible');
	await expect(tip).toBeVisible();
	await expect(tip).toHaveText('Sweet edible plant fruits');

	// Move off the row → tooltip removed.
	await page.mouse.move(0, 0);
	await expect(page.locator('.wtv__tooltip')).toHaveCount(0);
});

test('callback: a node with empty text gets no tooltip', async ({ page }) => {
	await row(page, 'text', '1.2').hover();
	await page.waitForTimeout(100);
	await expect(page.locator('.wtv__tooltip')).toHaveCount(0);
});

test('rich: callback returning an HTMLElement renders as the tooltip body', async ({ page }) => {
	await row(page, 'rich', '1.1').hover();
	const tip = page.locator('.wtv__tooltip.wtv__tooltip--visible');
	await expect(tip).toBeVisible();
	await expect(tip.locator('[data-testid="tip-content"]')).toBeVisible();
	await expect(tip).toContainText('Apple');
	await expect(tip).toContainText('Crisp orchard fruit');
});

test('disabled: no tooltip when show-node-tooltips is toggled off', async ({ page }) => {
	await page.locator('#toggle').click(); // off
	await row(page, 'text', '1').hover();
	await page.waitForTimeout(100);
	await expect(page.locator('.wtv__tooltip')).toHaveCount(0);
});
