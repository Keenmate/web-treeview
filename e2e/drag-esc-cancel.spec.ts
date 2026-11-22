import { test, expect } from './fixtures';

/**
 * Regression: Esc-cancelling a drag must restore the pre-drag selection.
 *
 * Grabbing a node outside the selection replaces the selection with it (OS-convention
 * selection sync, at drag start). Escape cancels the pointer drag (core createPointerDrag)
 * and the state must roll the selection back — without it the dragged node stays
 * visually selected after a cancelled drag.
 */
test('Esc during drag restores the pre-drag selection on the source row', async ({ page }) => {
  await page.goto('/test/drag-esc-cancel.html');
  await expect(page.locator('.wtv__node').first()).toBeVisible();

  const fileARow = page
    .locator('.wtv__container')
    .first()
    .locator('.wtv__node[data-tree-path="1.1"] .wtv__node-content')
    .first();
  await expect(fileARow).toBeVisible();
  const before = await fileARow.getAttribute('class');
  expect(before).not.toMatch(/wtv__node-content--selected/);

  const box = (await fileARow.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 10, box.y + box.height / 2 + 30, { steps: 4 });
  // The grab selected the dragged row …
  await expect(fileARow).toHaveClass(/wtv__node-content--selected/);
  await page.keyboard.press('Escape');
  await page.mouse.up();

  // … and Escape gave the old selection back.
  await expect.poll(() => fileARow.getAttribute('class')).toBe(before);
});
