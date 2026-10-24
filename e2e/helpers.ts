/**
 * Locator helpers shared by the web-treeview e2e specs (re-exported from
 * `./fixtures`). Playwright CSS locators pierce the open shadow root, so these
 * work from the page or any ancestor locator.
 */
import type { Locator, Page } from '@playwright/test';

/** Escape a value for use inside a double-quoted CSS attribute selector. */
export function cssAttrEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Escape a string for literal use inside a RegExp. */
export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The `.wtv__node` row for an LTree path, scoped to a page/tree/card. */
export function nodeByPath(scope: Locator | Page, path: string): Locator {
  return scope.locator(`.wtv__node[data-tree-path="${cssAttrEscape(path)}"]`).first();
}

/** The clickable `.wtv__node-content` of a `.wtv__node`. */
export function nodeContent(node: Locator): Locator {
  return node.locator('> .wtv__node-row .wtv__node-content').first();
}

/** Lines of a `<pre data-testid="…-log">` event log (empty lines dropped). */
export async function logLines(page: Page, testId: string): Promise<string[]> {
  const text = (await page.getByTestId(testId).textContent()) ?? '';
  return text.split('\n').map((l) => l.trim()).filter(Boolean);
}
