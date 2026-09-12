import { test, expect, Page } from '@playwright/test';

/**
 * The disclosure toggle is ONE mask-image glyph read from ONE variable set
 * (--wtv-icon-expand / --wtv-icon-collapse + rotation), and `icon-set` just
 * re-points those variables — it is NOT four parallel families of CSS classes.
 * These verify each set resolves the expected glyph + rotation, that the default
 * chains to --base-icon-chevron across the shadow boundary, and that setting the
 * JS property reflects `icon-set` onto the host so the :host([icon-set]) CSS matches.
 *
 * Fixture: test/icon-set.html
 */

const PAGE = '/test/icon-set.html';

test.beforeEach(async ({ page }) => {
    await page.goto(PAGE);
    await page.locator('#default .wtv__toggle-icon--expand').first().waitFor();
});

// --wtv-* are declared at :host and inherit, so reading them off the host is the
// most structure-independent probe of the resolved chain (mirrors drp's hostVar).
function hostVar(page: Page, id: string, name: string) {
    return page.locator(`#${id}`).evaluate(
        (el, v) => getComputedStyle(el).getPropertyValue(v).trim(),
        name,
    );
}

// Resolved mask-image of the first expandable toggle's ::before, inside shadow DOM.
function toggleMask(page: Page, id: string) {
    return page.locator(`#${id}`).evaluate((el) => {
        const toggle = (el as HTMLElement & { shadowRoot: ShadowRoot })
            .shadowRoot.querySelector('.wtv__toggle-icon--expand');
        return getComputedStyle(toggle as Element, '::before').maskImage;
    });
}

test('default set = chevron, chained to --base-icon-chevron', async ({ page }) => {
    const glyph = await hostVar(page, 'default', '--wtv-icon-expand');
    expect(glyph).toContain('data:image/svg');
    expect(glyph).toContain('9 18 6-6-6-6'); // Lucide chevron path
    // Right-pointing chevron: no collapsed rotation, 90° when expanded.
    expect(await hostVar(page, 'default', '--wtv-icon-rotate-collapsed')).toBe('0deg');
    expect(await hostVar(page, 'default', '--wtv-icon-rotate-expanded')).toBe('90deg');
    // The glyph actually renders (mask resolved, not none).
    expect(await toggleMask(page, 'default')).not.toBe('none');
});

test('icon-set="triangle" re-points to a down-caret with a -90° collapsed offset', async ({ page }) => {
    const glyph = await hostVar(page, 'triangle', '--wtv-icon-expand');
    expect(glyph).toContain('M12 15 6 9h12z'); // caret-down fallback
    // A down-pointing caret must rotate -90° to read as "collapsed" (points right).
    expect(await hostVar(page, 'triangle', '--wtv-icon-rotate-collapsed')).toBe('-90deg');
    expect(await hostVar(page, 'triangle', '--wtv-icon-rotate-expanded')).toBe('0deg');
});

test('icon-set="plus-minus" is a swap set: distinct + / − glyphs, no rotation', async ({ page }) => {
    const expand = await hostVar(page, 'plusminus', '--wtv-icon-expand');
    const collapse = await hostVar(page, 'plusminus', '--wtv-icon-collapse');
    expect(expand).toContain('M12 5v14');   // plus has the vertical stroke
    expect(collapse).not.toContain('M12 5v14'); // minus does not
    expect(expand).not.toBe(collapse);
    expect(await hostVar(page, 'plusminus', '--wtv-icon-rotate-collapsed')).toBe('0deg');
    expect(await hostVar(page, 'plusminus', '--wtv-icon-rotate-expanded')).toBe('0deg');
});

test('icon-set="arrow" points right and rotates 90° when expanded', async ({ page }) => {
    const glyph = await hostVar(page, 'arrow', '--wtv-icon-expand');
    expect(glyph).toContain('M5 12h14'); // arrow shaft
    expect(await hostVar(page, 'arrow', '--wtv-icon-rotate-collapsed')).toBe('0deg');
    expect(await hostVar(page, 'arrow', '--wtv-icon-rotate-expanded')).toBe('90deg');
});

test('--base-icon-chevron override re-skins the default set through the shadow boundary', async ({ page }) => {
    expect(await hostVar(page, 'base-icon', '--wtv-icon-expand')).toContain('sentinel.test/chevron.svg');
});

// Class list of the first expandable toggle inside a tree's shadow DOM.
function toggleClasses(page: Page, id: string) {
	return page.locator(`#${id}`).evaluate((el) => {
		const toggle = (el as HTMLElement & { shadowRoot: ShadowRoot })
			.shadowRoot.querySelector('.wtv__toggle-icon.wtv__clickable');
		return toggle ? Array.from(toggle.classList) : [];
	});
}

test('escape hatch: a custom class in swap mode swaps the class NAME (renderer, not CSS mask)', async ({ page }) => {
	// Root is expanded → swap mode must have applied the COLLAPSE class, since a
	// custom (non-mask) glyph can't be repainted via --wtv-icon-collapse.
	const classes = await toggleClasses(page, 'custom-swap');
	expect(classes).toContain('fx-minus'); // expanded → collapse glyph class
	expect(classes).not.toContain('fx-plus');
	expect(classes).toContain('expanded');
});

test('escape hatch: a custom class still rotates (rotation keyed off .wtv__clickable, not --expand)', async ({ page }) => {
	const classes = await toggleClasses(page, 'custom-rotate');
	expect(classes).toContain('fx-chevron');
	expect(classes).toContain('expanded');
	// The expanded rotation actually resolves to a non-identity transform.
	const transform = await page.locator('#custom-rotate').evaluate((el) => {
		const t = (el as HTMLElement & { shadowRoot: ShadowRoot })
			.shadowRoot.querySelector('.wtv__toggle-icon.wtv__clickable.expanded');
		return getComputedStyle(t as Element).transform;
	});
	// rotate(90deg) → matrix(0,1,-1,0,0,0); anything but 'none'/identity proves it rotated.
	expect(transform).not.toBe('none');
	expect(transform).toContain('matrix');
});

test('setting the iconSet JS property reflects icon-set onto the host (CSS matches)', async ({ page }) => {
    // The fixture sets `el.iconSet = 'triangle'` in JS, not via the attribute.
    await expect(page.locator('#by-prop')).toHaveAttribute('icon-set', 'triangle');
    // …and the reflected attribute drives the same :host([icon-set="triangle"]) rule.
    expect(await hostVar(page, 'by-prop', '--wtv-icon-rotate-collapsed')).toBe('-90deg');
});
