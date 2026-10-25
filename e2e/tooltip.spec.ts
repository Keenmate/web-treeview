import { test, expect, Page } from './fixtures';

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

test('follow-cursor: a stationary hover anchors the tooltip to the cursor, not the row corner', async ({ page }) => {
	// Regression guard for the core rc11 fix (seed cursor rect on mouseenter). With a
	// non-zero show delay and NO pointer movement after entry, pre-rc11 the follow-cursor
	// VirtualElement had no cursor rect at show() time and fell back to the trigger rect,
	// pinning the tooltip to the row's left/top corner. rc11 seeds it on mouseenter.
	const content = row(page, 'cursor', '1');
	await content.scrollIntoViewIfNeeded();
	let box = (await content.boundingBox())!;
	expect(box.width).toBeGreaterThan(120); // wide row → right-side hover is far from the left edge

	// Enter near the RIGHT edge and hold still. hover({position}) moves once and stays put
	// (element-relative, auto-scrolls), so the 150ms delay elapses on a stationary pointer.
	const rightOffset = box.width - 24;
	await content.hover({ position: { x: rightOffset, y: box.height / 2 } });
	box = (await content.boundingBox())!; // re-measure (hover may have scrolled) → viewport coords
	const cursorX = box.x + rightOffset;

	const tip = page.locator('.wtv__tooltip.wtv__tooltip--visible');
	await expect(tip).toBeVisible(); // survives the 150ms delay
	const tipBox = (await tip.boundingBox())!;

	// top-start + a 0-width cursor rect ⇒ the tooltip's left edge sits at ~cursorX.
	expect(Math.abs(tipBox.x - cursorX)).toBeLessThan(48);
	// And it must be well to the RIGHT of the row's left edge (i.e. NOT pinned to the corner).
	expect(tipBox.x).toBeGreaterThan(box.x + 60);
});

test('disabled: no tooltip when show-node-tooltips is toggled off', async ({ page }) => {
	await page.locator('#toggle').click(); // off
	await row(page, 'text', '1').hover();
	await page.waitForTimeout(100);
	await expect(page.locator('.wtv__tooltip')).toHaveCount(0);
});

// ── placement / offset / delay ──────────────────────────────────────────────

test('tooltip-placement="right" + tooltip-offset=24: the tooltip sits 24px right of the row', async ({ page }) => {
	const r = row(page, 'placed', '1.1');
	await r.hover();
	const tip = page.locator('#placed .wtv__tooltip.wtv__tooltip--visible');
	await expect(tip).toBeVisible();
	const rb = (await r.boundingBox())!;
	const tb = (await tip.boundingBox())!;
	expect(Math.abs(tb.x - (rb.x + rb.width + 24))).toBeLessThan(3);
	// vertically centred on the row
	expect(Math.abs(tb.y + tb.height / 2 - (rb.y + rb.height / 2))).toBeLessThan(3);
});

test('tooltip-delay attribute: no tooltip before the show delay, then it appears', async ({ page }) => {
	await row(page, 'slow', '1.1').hover();
	await page.waitForTimeout(350);
	await expect(page.locator('#slow .wtv__tooltip.wtv__tooltip--visible')).toHaveCount(0);
	await expect(page.locator('#slow .wtv__tooltip.wtv__tooltip--visible')).toBeVisible({ timeout: 2000 });
});

test('tooltipDelay = { show, hide } (JS property): instant show, delayed hide', async ({ page }) => {
	await row(page, 'delayed', '1.1').hover();
	const tip = page.locator('#delayed .wtv__tooltip.wtv__tooltip--visible');
	await expect(tip).toBeVisible({ timeout: 150 });
	await page.mouse.move(0, 0);
	await page.waitForTimeout(300);
	await expect(tip).toBeVisible();
	await expect(page.locator('#delayed .wtv__tooltip')).toHaveCount(0, { timeout: 2000 });
});
