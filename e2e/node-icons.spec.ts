import { test, expect, Page } from '@playwright/test';

/**
 * Per-node icons (iconMember/iconCallback + iconColorMember/iconColorCallback +
 * renderIconCallback), rendered as a dedicated .wtv__node-icon element on EVERY node
 * (branch + leaf) — no longer folded into the leaf toggle slot.
 * Fixture: test/node-icons.html
 */

const iconAt = (page: Page, treeId: string, path: string) =>
	page.locator(`#${treeId} [data-tree-path="${path}"] .wtv__node-icon`).first();

test.beforeEach(async ({ page }) => {
	await page.goto('/test/node-icons.html');
	await page.locator('#default [data-tree-path="1"]').waitFor();
});

test('default: icon value → class on <i> for BOTH branch and leaf', async ({ page }) => {
	// Branch (Region, has children) — previously branches got no icon at all.
	const branch = iconAt(page, 'default', '1');
	await expect(branch).toHaveClass(/fa-sitemap/);
	expect(await branch.evaluate((el) => el.tagName)).toBe('I');

	// Leaf (Employee)
	await expect(iconAt(page, 'default', '1.1.1')).toHaveClass(/fa-user/);
});

test('default: the branch toggle still shows the chevron, not the icon', async ({ page }) => {
	// The icon is a SEPARATE element now; the toggle keeps its expand glyph.
	const toggle = page.locator('#default [data-tree-path="1"] .wtv__toggle-icon').first();
	await expect(toggle).toHaveClass(/wtv__toggle-icon--expand/);
	await expect(toggle).not.toHaveClass(/fa-sitemap/);
});

test('default: per-node color from icon-color-member is applied inline', async ({ page }) => {
	const branch = iconAt(page, 'default', '1'); // #7c3aed
	expect(await branch.evaluate((el) => (el as HTMLElement).style.color)).toBe('rgb(124, 58, 237)');
	// Employee has no color → inherits (no inline color).
	expect(await iconAt(page, 'default', '1.1.1').evaluate((el) => (el as HTMLElement).style.color)).toBe('');
});

test('renderIconCallback: populates the icon element and receives the resolved value', async ({ page }) => {
	const icon = iconAt(page, 'custom', '1');
	await expect(icon).toHaveText('★');
	await expect(icon).toHaveAttribute('data-value', 'fa-sitemap');
	expect(await icon.evaluate((el) => el.tagName)).toBe('SPAN'); // callback path uses <span>
});
