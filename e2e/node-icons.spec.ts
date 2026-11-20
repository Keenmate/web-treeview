import { test, expect, Page } from './fixtures';

/**
 * Per-node icons (iconMember/iconCallback + iconColorMember/iconColorCallback), drawn by core
 * renderIcon INTO a dedicated <span class="wtv__node-icon"> wrapper on EVERY node with an icon
 * (branch + leaf): markup → built-in name → the element's renderIconCallback → the page-wide
 * window.components.renderIconCallback → icon-font <i class="wtv__icon …"> → text.
 * Fixture: test/node-icons.html
 */

const iconAt = (page: Page, treeId: string, path: string) =>
	page.locator(`#${treeId} [data-tree-path="${path}"] .wtv__node-icon`).first();

test.beforeEach(async ({ page }) => {
	await page.goto('/test/node-icons.html');
	await page.locator('#default [data-tree-path="1"]').waitFor();
});

test('default: icon-font classes → <i class="wtv__icon …"> inside the wrapper, on branch AND leaf', async ({ page }) => {
	// Branch (Region, has children)
	const branch = iconAt(page, 'default', '1');
	expect(await branch.evaluate((el) => el.tagName)).toBe('SPAN');
	const i = branch.locator('i');
	await expect(i).toHaveClass('wtv__icon fa-sitemap');
	await expect(i).toHaveAttribute('aria-hidden', 'true');

	// Leaf (Employee)
	await expect(iconAt(page, 'default', '1.1.1').locator('i')).toHaveClass('wtv__icon fa-user');
});

test('default: the branch toggle still shows the chevron, not the icon', async ({ page }) => {
	// The icon is a SEPARATE element; the toggle keeps its expand glyph.
	const toggle = page.locator('#default [data-tree-path="1"] .wtv__toggle-icon').first();
	await expect(toggle).toHaveClass(/wtv__toggle-icon--expand/);
	await expect(toggle).not.toHaveClass(/fa-sitemap/);
});

test('default: per-node color from icon-color-member is applied inline on the wrapper', async ({ page }) => {
	const branch = iconAt(page, 'default', '1'); // #7c3aed
	expect(await branch.evaluate((el) => (el as HTMLElement).style.color)).toBe('rgb(124, 58, 237)');
	// Employee has no color → inherits (no inline color).
	expect(await iconAt(page, 'default', '1.1.1').evaluate((el) => (el as HTMLElement).style.color)).toBe('');
});

test('default: a non-class value (emoji) renders as the icon text', async ({ page }) => {
	const branch = iconAt(page, 'emoji', '1');
	await expect(branch).toHaveText('🗂️');
	await expect(branch).toHaveClass('wtv__node-icon wtv__node-icon--aligned');
	await expect(iconAt(page, 'emoji', '1.1.1')).toHaveText('👤');
	// A class-like value on the same tree is an icon-font <i>, with no text.
	const cls = iconAt(page, 'emoji', '1.2');
	await expect(cls.locator('i')).toHaveClass('wtv__icon fa-building');
	await expect(cls).toHaveText('');
});

test.describe('renderIconCallback (element) + window.components.renderIconCallback (page)', () => {
	test('the element hook beats the page hook, with ctx.node + render state + component context', async ({ page }) => {
		const b = iconAt(page, 'custom', '1').locator('b');
		await expect(b).toHaveAttribute('data-hook', 'element');
		await expect(b).toHaveAttribute('data-path', '1');
		await expect(b).toHaveAttribute('data-component', 'web-treeview');
		await expect(b).toHaveAttribute('data-prefix', 'wtv');
		await expect(b).toHaveAttribute('data-has-controller', 'true');
		await expect(b).toHaveAttribute('data-level', '1');
	});

	test('the element hook answering null falls through to the page hook', async ({ page }) => {
		await expect(iconAt(page, 'custom', '1.1').locator('b')).toHaveAttribute('data-hook', 'page');
	});

	test('nobody claims a class list → icon-font <i class="wtv__icon …">', async ({ page }) => {
		await expect(iconAt(page, 'custom', '1.2').locator('i')).toHaveClass('wtv__icon fa-solid fa-building');
	});

	test('a built-in name renders the masked span and is never sent to a hook', async ({ page }) => {
		const span = iconAt(page, 'custom', '1.1.1').locator('span.km-icon');
		await expect(span).toHaveClass(/wtv__icon--check/);
		const seen = await page.evaluate(() => (window as any).__seen);
		expect(seen.element).not.toContain('check');
		expect(seen.page).not.toContain('check');
		expect(seen.element).toContain('both');
		// ICON_CSS is adopted into the shadow root (the masked span gets its 1em box).
		expect((await span.boundingBox())!.width).toBeGreaterThan(0);
	});

	test('markup goes in as is; markup never reaches a hook', async ({ page }) => {
		await expect(iconAt(page, 'custom', '1.3').locator('svg[data-testid="raw-svg"]')).toHaveCount(1);
		const seen = await page.evaluate(() => (window as any).__seen);
		expect(seen.element.some((n: string) => n.startsWith('<'))).toBe(false);
	});

	test('no icon value → no wrapper (align off)', async ({ page }) => {
		await expect(page.locator('#custom [data-tree-path="1.4"] .wtv__node-icon')).toHaveCount(0);
	});

	test('replacing the hook re-paints the icons; removing it falls back to the page hook', async ({ page }) => {
		await page.locator('#custom').evaluate((el: any) => { el.renderIconCallback = (name: string) => (name === 'both' ? '<em>new</em>' : null); });
		await expect(iconAt(page, 'custom', '1').locator('em')).toHaveText('new');
		await page.locator('#custom').evaluate((el: any) => { el.renderIconCallback = null; });
		await expect(iconAt(page, 'custom', '1').locator('b')).toHaveAttribute('data-hook', 'page');
	});
});
