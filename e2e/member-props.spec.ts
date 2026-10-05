import { test, expect, Page, Locator } from '@playwright/test';

/**
 * Tests for the isSelectableMember + isSelectedMember props.
 *
 * Fixture data:
 *   1     Documents  selectable=true  selected=false
 *   1.1   Work       selectable=true  selected=true
 *   1.2   Locked     selectable=false selected=false
 *   1.3   Pinned     selectable=false selected=true
 *   2     Music      selectable=true  selected=true
 *   2.1   Playlists  selectable=true  selected=false
 *
 * Web-treeview's checkbox is a single styled <input class="wtv__checkbox"> — the
 * input IS the box, so `checkbox()` and `checkboxInput()` resolve to the same
 * element (:checked state read off it).
 */

const PAGE = '/test/member-props.html';

function nodeByPath(page: Page, path: string): Locator {
  return page.locator(`.wtv__node[data-tree-path="${path}"]`).first();
}

function checkbox(node: Locator): Locator {
  return node.locator('> .wtv__node-row .wtv__checkbox').first();
}

function checkboxInput(node: Locator): Locator {
  // Single-element contract: the input IS the .wtv__checkbox.
  return checkbox(node);
}

async function gotoFixture(page: Page) {
  await page.goto(PAGE);
  await expect(page.locator('.wtv__node').first()).toBeVisible();
}

test.describe('isSelectableMember', () => {
  test('nodes with selectable=true render a checkbox', async ({ page }) => {
    await gotoFixture(page);
    await expect(checkbox(nodeByPath(page, '1'))).toBeVisible();
    await expect(checkbox(nodeByPath(page, '1.1'))).toBeVisible();
    await expect(checkbox(nodeByPath(page, '2'))).toBeVisible();
    await expect(checkbox(nodeByPath(page, '2.1'))).toBeVisible();
  });

  test('nodes with selectable=false do NOT render a checkbox', async ({ page }) => {
    await gotoFixture(page);
    await expect(
      nodeByPath(page, '1.2').locator('> .wtv__node-row .wtv__checkbox')
    ).toHaveCount(0);
    await expect(
      nodeByPath(page, '1.3').locator('> .wtv__node-row .wtv__checkbox')
    ).toHaveCount(0);
  });

  test('nodes with selectable=true carry the wtv__clickable class', async ({ page }) => {
    await gotoFixture(page);
    await expect(
      nodeByPath(page, '1').locator('> .wtv__node-row .wtv__node-content').first()
    ).toHaveClass(/(^|\s)wtv__clickable(\s|$)/);
  });

  test('nodes with selectable=false do NOT carry the wtv__clickable class', async ({ page }) => {
    await gotoFixture(page);
    await expect(
      nodeByPath(page, '1.2').locator('> .wtv__node-row .wtv__node-content').first()
    ).not.toHaveClass(/(^|\s)wtv__clickable(\s|$)/);
    await expect(
      nodeByPath(page, '1.3').locator('> .wtv__node-row .wtv__node-content').first()
    ).not.toHaveClass(/(^|\s)wtv__clickable(\s|$)/);
  });
});

test.describe('isSelectedMember', () => {
  test('nodes with selected=true and selectable=true render their checkbox in checked state', async ({ page }) => {
    await gotoFixture(page);
    await expect(checkboxInput(nodeByPath(page, '1.1'))).toBeChecked();
    await expect(checkboxInput(nodeByPath(page, '2'))).toBeChecked();
  });

  test('nodes with selected=false render their checkbox unchecked', async ({ page }) => {
    await gotoFixture(page);
    await expect(checkboxInput(nodeByPath(page, '1'))).not.toBeChecked();
    await expect(checkboxInput(nodeByPath(page, '2.1'))).not.toBeChecked();
  });

  test('selectedPaths is seeded with every path where selected=true (incl. non-selectable)', async ({ page }) => {
    await gotoFixture(page);

    // Seed walk visits node.isSelected for every node, independent of isSelectable.
    // Expect all three selected=true paths: 1.1, 1.3, 2 (sorted).
    await expect(page.getByTestId('selected-paths-count')).toHaveText('3');
    await expect(page.getByTestId('selected-paths-list')).toHaveText('1.1,1.3,2');
  });

  test('toggling a checkbox updates selectedPaths', async ({ page }) => {
    await gotoFixture(page);

    await expect(page.getByTestId('selected-paths-count')).toHaveText('3');

    await checkbox(nodeByPath(page, '2.1')).click();
    await expect(checkboxInput(nodeByPath(page, '2.1'))).toBeChecked();

    await expect(page.getByTestId('selected-paths-count')).toHaveText('4');
    await expect(page.getByTestId('selected-paths-list')).toHaveText('1.1,1.3,2,2.1');

    await checkbox(nodeByPath(page, '1.1')).click();
    await expect(checkboxInput(nodeByPath(page, '1.1'))).not.toBeChecked();
    await expect(page.getByTestId('selected-paths-count')).toHaveText('3');
    await expect(page.getByTestId('selected-paths-list')).toHaveText('1.3,2,2.1');
  });
});
