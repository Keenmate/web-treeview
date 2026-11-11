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

test.describe('live state: the callback content reflects the node state when shown', () => {
	const liveTip = (page: Page) => page.locator('#live .wtv__tooltip.wtv__tooltip--visible');

	test('state toggled before the hover → the tooltip shows the new state', async ({ page }) => {
		await row(page, 'live', '1.1').hover();
		await expect(liveTip(page)).toHaveText('Apple | sel:0 | chk:0 | exp:1 | checked in tree:0');
		await page.mouse.move(0, 0);
		await expect(page.locator('#live .wtv__tooltip')).toHaveCount(0);

		// Another row's check doesn't touch Apple's node, but Apple's tooltip reads the
		// tree-wide count — resolved when shown, not when the row was last rendered.
		await page.evaluate(() => (document.getElementById('live') as any).checkNode('1.2'));
		await row(page, 'live', '1.1').hover();
		await expect(liveTip(page)).toHaveText('Apple | sel:0 | chk:0 | exp:1 | checked in tree:1');

		// Select (click) + check (Space) Apple itself, then hover again.
		await row(page, 'live', '1.1').click();
		await page.keyboard.press('Space');
		await page.mouse.move(0, 0);
		await expect(page.locator('#live .wtv__tooltip')).toHaveCount(0);
		await row(page, 'live', '1.1').hover();
		await expect(liveTip(page)).toHaveText('Apple | sel:1 | chk:1 | exp:1 | checked in tree:2');
	});

	test('state toggled from the keyboard while the tooltip is open → it updates in place', async ({ page }) => {
		// Focus the tree on Apple, then move the keyboard focus to its parent Fruits.
		await row(page, 'live', '1.1').click();
		await page.keyboard.press('ArrowLeft');
		// Start collapsed: expanding (Enter) grows the page, so the hovered row stays under
		// the pointer (a collapse can shrink the page and scroll the row away).
		await page.evaluate(() => (document.getElementById('live') as any).collapseNodes('1'));
		await row(page, 'live', '1').hover();
		const tip = liveTip(page);
		await expect(tip).toContainText('Fruits | ');
		await expect(tip).toContainText('chk:0 | exp:0');
		await page.keyboard.press('Space'); // checkboxes shown → toggles the focused node's check
		await expect(tip).toContainText('chk:1 | exp:0');
		await page.keyboard.press('Enter'); // expands the focused branch
		await expect(tip).toContainText('chk:1 | exp:1');
	});
});

test.describe('width variables', () => {
	const tipBox = async (page: Page, path: string) => {
		await row(page, 'sized', path).hover();
		const tip = page.locator('.wtv__tooltip.wtv__tooltip--visible');
		await expect(tip).toBeVisible();
		return tip.evaluate((el) => {
			// The variables size the CONTENT box (padding is added outside, like any box).
			const cs = getComputedStyle(el);
			const extra = ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth']
				.reduce((sum, k) => sum + parseFloat(cs[k as any]), 0);
			return { width: el.getBoundingClientRect().width - extra, minWidth: cs.minWidth, maxWidth: cs.maxWidth };
		});
	};
	const setVars = (page: Page, vars: Record<string, string>) =>
		page.evaluate((v) => {
			const el = document.getElementById('sized')!;
			for (const [k, val] of Object.entries(v)) el.style.setProperty(k, val);
		}, vars);

	test('defaults: auto width shrinks to short text; a long text wraps at the 320px max-width', async ({ page }) => {
		const short = await tipBox(page, '1');
		expect(short.minWidth).toBe('0px');
		expect(short.maxWidth).toBe('320px');
		expect(short.width).toBeLessThan(100);
		await page.mouse.move(0, 0);
		const long = await tipBox(page, '1.1');
		expect(long.width).toBeLessThanOrEqual(320.5);
		expect(long.width).toBeGreaterThan(300);
	});

	test('--wtv-tooltip-min-width is a floor for short content', async ({ page }) => {
		await setVars(page, { '--wtv-tooltip-min-width': '250px' });
		const box = await tipBox(page, '1');
		expect(box.minWidth).toBe('250px');
		expect(Math.round(box.width)).toBe(250);
	});

	test('--wtv-tooltip-max-width moves the wrap point', async ({ page }) => {
		await setVars(page, { '--wtv-tooltip-max-width': '180px' });
		const box = await tipBox(page, '1.1');
		expect(box.maxWidth).toBe('180px');
		expect(box.width).toBeLessThanOrEqual(180.5);
	});

	test('--wtv-tooltip-width + max-width:none gives a fixed box', async ({ page }) => {
		await setVars(page, { '--wtv-tooltip-width': '450px', '--wtv-tooltip-max-width': 'none' });
		const short = await tipBox(page, '1');
		expect(Math.round(short.width)).toBe(450);
		await page.mouse.move(0, 0);
		const long = await tipBox(page, '1.1');
		expect(Math.round(long.width)).toBe(450);
	});
});
