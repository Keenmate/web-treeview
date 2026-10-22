import { test, expect } from '@playwright/test';

/**
 * Regression: Esc-cancelling a drag must restore the pre-drag selection.
 *
 * On dragstart, the controller's `_nodeDragStartCallback` schedules a rAF that
 * replaces the selection with the dragged node (OS-convention selection sync).
 * If the user then presses Esc, the browser fires dragend with dropEffect
 * 'none' and the controller must roll the selection back. Without rollback the
 * user is left with the dragged node visually selected after a cancelled drag.
 *
 * Playwright's mouse helpers don't synthesize HTML5 drag events, so we
 * dispatch dragstart / dragend directly with a real DataTransfer. Esc-cancel
 * is modeled as dragend firing with the default dropEffect 'none'. The source
 * element is re-queried after the rAF because the controller's reconciliation
 * re-keys the row and the original DOM node is detached.
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

  await page.evaluate(async () => {
    const root = document.querySelector('web-treeview')?.shadowRoot;
    if (!root) throw new Error('shadow root missing');
    const find = () =>
      root.querySelector(
        '.wtv__container .wtv__node[data-tree-path="1.1"] .wtv__node-content'
      ) as HTMLElement | null;
    const start = find();
    if (!start) throw new Error('source row missing');
    const dt = new DataTransfer();
    start.dispatchEvent(
      new DragEvent('dragstart', { dataTransfer: dt, bubbles: true, cancelable: true })
    );
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    const end = find();
    if (!end) throw new Error('source row missing after rAF');
    end.dispatchEvent(new DragEvent('dragend', { dataTransfer: dt, bubbles: true }));
  });
  await page.waitForTimeout(50);

  const after = await fileARow.getAttribute('class');

  expect(after).toBe(before);
});
