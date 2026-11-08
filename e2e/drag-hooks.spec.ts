import { test, expect, type Page, type Locator, nodeByPath, nodeContent, logLines, WEBKIT_NO_NATIVE_DND } from './fixtures';

/**
 * beforeDropCallback / beforeDragStartCallback (/test/drag-hooks.html).
 *
 *   1 Inbox ── 1.1 Mail1
 *   2 Archive ── 2.1 Old
 *   3 Drafts ── 3.1 D1, 3.2 D2
 *   4 Trash
 *
 * The page logs `before-drop:<dragged>:<position>:<target>:<op>`,
 * `before-drag-start:<paths>` and `node-drop:…` lines.
 */

const PAGE = '/test/drag-hooks.html';
const LOG = 'dh-log';

test.skip(({ browserName }) => browserName === 'webkit', WEBKIT_NO_NATIVE_DND);

async function load(page: Page, query = '') {
  await page.goto(PAGE + query);
  await expect(nodeByPath(page, '4')).toBeVisible();
}

const row = (page: Page, path: string) => nodeContent(nodeByPath(page, path));

/** Native HTML5 drag onto the right half of the target row → "child". */
async function dragOnto(src: Locator, dst: Locator) {
  const box = await dst.boundingBox();
  if (!box) throw new Error('target has no box');
  await src.dragTo(dst, { targetPosition: { x: box.width * 0.8, y: box.height / 2 } });
}

const parentOf = (page: Page, name: string) => page.evaluate((n) => (window as any).parentOf(n), name);
const countOf = (page: Page, name: string) => page.evaluate((n) => (window as any).countOf(n), name);
const drops = async (page: Page) => (await logLines(page, LOG)).filter((l) => l.startsWith('node-drop:'));

test('baseline: no hooks → dropping D1 on Trash moves it under Trash', async ({ page }) => {
  await load(page);
  await dragOnto(row(page, '3.1'), row(page, '4'));
  await expect.poll(() => parentOf(page, 'D1')).toBe('Trash');
  expect(await drops(page)).toEqual(['node-drop:D1:child:Trash:move']);
});

test.describe('beforeDropCallback', () => {
  test('receives dragged / position / target / operation', async ({ page }) => {
    await load(page, '?drop=async-allow');
    await dragOnto(row(page, '3.1'), row(page, '4'));
    await expect.poll(() => logLines(page, LOG)).toContain('before-drop:D1:child:Trash:move');
  });

  test('returning false blocks the drop (no move, no node-drop)', async ({ page }) => {
    await load(page, '?drop=veto');
    await dragOnto(row(page, '3.1'), row(page, '4'));
    await expect.poll(() => logLines(page, LOG)).toContain('before-drop:D1:child:Trash:move');
    await page.waitForTimeout(100);
    expect(await parentOf(page, 'D1')).toBe('Drafts');
    expect(await drops(page)).toEqual([]);
  });

  test('{ position } redirects the drop (child → after: lands beside the target)', async ({ page }) => {
    await load(page, '?drop=redirect-after');
    await dragOnto(row(page, '3.1'), row(page, '2'));
    await expect.poll(() => parentOf(page, 'D1')).toBe('');
    expect(await drops(page)).toEqual(['node-drop:D1:after:Archive:move']);
  });

  test('{ operation: "copy" } turns the move into a copy (source stays)', async ({ page }) => {
    await load(page, '?drop=redirect-copy');
    await dragOnto(row(page, '3.1'), row(page, '4'));
    await expect.poll(() => countOf(page, 'D1')).toBe(2);
    expect(await drops(page)).toEqual(['node-drop:D1:child:Trash:copy']);
  });

  test('DropGroup[] fans a multi-drag out to several destinations', async ({ page }) => {
    await load(page, '?drop=groups');
    await row(page, '3.1').click();
    await row(page, '3.2').click({ modifiers: ['Control'] });
    await dragOnto(row(page, '3.1'), row(page, '4'));
    await expect.poll(() => parentOf(page, 'D1')).toBe('Inbox');
    expect(await parentOf(page, 'D2')).toBe('Archive');
  });

  test('async false (Promise) blocks the drop', async ({ page }) => {
    await load(page, '?drop=async-veto');
    await dragOnto(row(page, '3.1'), row(page, '4'));
    await expect.poll(() => logLines(page, LOG)).toContain('before-drop:D1:child:Trash:move');
    await page.waitForTimeout(200);
    expect(await parentOf(page, 'D1')).toBe('Drafts');
    expect(await drops(page)).toEqual([]);
  });

  test('async true (Promise) lets the drop proceed', async ({ page }) => {
    await load(page, '?drop=async-allow');
    await dragOnto(row(page, '3.1'), row(page, '4'));
    await expect.poll(() => parentOf(page, 'D1')).toBe('Trash');
    expect(await drops(page)).toEqual(['node-drop:D1:child:Trash:move']);
  });
});

test.describe('beforeDragStartCallback', () => {
  test('a string[] manifest prunes the dragged set', async ({ page }) => {
    await load(page, '?start=prune');
    await row(page, '3.1').click();
    await row(page, '3.2').click({ modifiers: ['Control'] });
    await dragOnto(row(page, '3.1'), row(page, '4'));
    await expect.poll(() => logLines(page, LOG)).toContain('before-drag-start:3.1+3.2');
    await expect.poll(() => parentOf(page, 'D1')).toBe('Trash');
    expect(await parentOf(page, 'D2')).toBe('Drafts');
  });

  test('returning false vetoes the drag (nothing moves)', async ({ page }) => {
    await load(page, '?start=veto');
    await dragOnto(row(page, '3.1'), row(page, '4'));
    await expect.poll(() => logLines(page, LOG)).toContain('before-drag-start:3.1');
    await page.waitForTimeout(100);
    expect(await parentOf(page, 'D1')).toBe('Drafts');
    expect(await drops(page)).toEqual([]);
  });
});
