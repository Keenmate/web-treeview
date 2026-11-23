import { test, expect, type Page, type Locator } from './fixtures';

/**
 * Row animation (docs/PLAN-row-animation.md) on /test/row-animation.html — mirror of
 * svelte-treeview's e2e/row-animation.spec.ts. On by default — part of core `motion`, no on/off
 * attribute (SPEC §12.16). The rows an expand reveals get wtv__node--opening (the first
 * max-animated-row-count in visible order), cleared after the CSS duration (read back with core
 * readAnimationMs). Never on first render, a re-render (focus click) or a data reload;
 * motion="none", reduced motion or --wtv-row-animation-duration: 0s → no reveal at all.
 */

const tree = (page: Page, id: string): Locator => page.locator(`#${id}`);
const row = (page: Page, id: string, path: string): Locator =>
  tree(page, id).locator(`.wtv__node[data-tree-path="${path}"]`);
const opening = (page: Page, id: string) =>
  page.evaluate((i) => [...document.getElementById(i)!.shadowRoot!.querySelectorAll('.wtv__node--opening')]
    .map((el) => el.getAttribute('data-tree-path')), id);
const toggle = (page: Page, id: string, path: string) =>
  row(page, id, path).locator('.wtv__toggle-icon').first().click();

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/test/row-animation.html');
  for (const id of ['off', 'on', 'none', 'plain']) await expect(row(page, id, '3.1')).toBeVisible();
});

test('first render: no row animates', async ({ page }) => {
  for (const id of ['off', 'on', 'none', 'plain']) expect(await opening(page, id)).toEqual([]);
});

test('--wtv-row-animation-duration: 0s turns off just the rows', async ({ page }) => {
  await toggle(page, 'off', '1');
  await expect(row(page, 'off', '1.1')).toBeVisible();
  expect(await opening(page, 'off')).toEqual([]);
});

test('default (no attribute): exactly the revealed rows animate, capped at max-animated-row-count, then the class goes', async ({ page }) => {
  await toggle(page, 'on', '1');
  await expect(row(page, 'on', '1.5')).toBeVisible();
  expect(await opening(page, 'on')).toEqual(['1.1', '1.2', '1.3']);
  const anim = await row(page, 'on', '1.1').evaluate((el) => getComputedStyle(el).animationName);
  expect(anim).toBe('wtv-row-in');
  await expect.poll(() => opening(page, 'on'), { timeout: 3000 }).toEqual([]);
});

test('on: a focus click after the reveal re-renders the row but does not replay', async ({ page }) => {
  await toggle(page, 'on', '2');
  await expect.poll(() => opening(page, 'on')).toEqual(['2.1', '2.2']);
  await expect.poll(() => opening(page, 'on'), { timeout: 3000 }).toEqual([]);
  await row(page, 'on', '2.1').locator('.wtv__node-content').first().click();
  await expect(row(page, 'on', '2.1')).toHaveAttribute('data-focused', 'true');
  expect(await opening(page, 'on')).toEqual([]);
});

test('on: expandAll animates what it reveals (capped)', async ({ page }) => {
  await page.getByTestId('expand-all').click();
  await expect(row(page, 'on', '2.2')).toBeVisible();
  expect(await opening(page, 'on')).toEqual(['1.1', '1.2', '1.3']);
});

test('on: a data reload re-renders without animating', async ({ page }) => {
  await page.getByTestId('reload').click();
  await expect(row(page, 'on', '1')).toBeVisible();
  await page.waitForTimeout(100);
  expect(await opening(page, 'on')).toEqual([]);
});

test('motion="none": no reveal at all', async ({ page }) => {
  await toggle(page, 'none', '1');
  await expect(row(page, 'none', '1.1')).toBeVisible();
  expect(await opening(page, 'none')).toEqual([]);
});

test('reduced motion: no reveal at all', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await toggle(page, 'plain', '1');
  await expect(row(page, 'plain', '1.1')).toBeVisible();
  expect(await opening(page, 'plain')).toEqual([]);
});

// ── Collapse half: rows animate out (core animateOut), then the node collapses ──

const closing = (page: Page, id: string) =>
  page.evaluate((i) => [...document.getElementById(i)!.shadowRoot!.querySelectorAll('.wtv__node--closing')]
    .map((el) => el.getAttribute('data-tree-path')), id);

test('collapse: the hidden rows animate out (inert), then the node collapses and the event fires', async ({ page }) => {
  await toggle(page, 'on', '3');
  await expect.poll(() => closing(page, 'on')).toEqual(['3.1']);
  await expect(row(page, 'on', '3.1')).toHaveAttribute('inert', '');
  expect(await row(page, 'on', '3.1').evaluate((el) => getComputedStyle(el).animationName)).toBe('wtv-row-out');
  await expect(page.getByTestId('collapse-log')).toHaveText('');
  await expect(row(page, 'on', '3.1')).toHaveCount(0, { timeout: 3000 });
  await expect(page.getByTestId('collapse-log')).toHaveText('3');
});

test('collapse: toggling again mid-animation cancels it — the node stays open, no event', async ({ page }) => {
  await toggle(page, 'on', '3');
  await expect.poll(() => closing(page, 'on')).toEqual(['3.1']);
  await toggle(page, 'on', '3');
  expect(await closing(page, 'on')).toEqual([]);
  await page.waitForTimeout(1300);
  await expect(row(page, 'on', '3.1')).toBeVisible();
  await expect(row(page, 'on', '3.1')).not.toHaveAttribute('inert', '');
  await expect(page.getByTestId('collapse-log')).toHaveText('');
});

test('collapse: await collapseNodes() settles after the animation, with the rows gone', async ({ page }) => {
  await page.getByTestId('collapse-code').click();
  await expect(page.getByTestId('await-result')).not.toHaveText('', { timeout: 3000 });
  const [ms, rowsLeft] = (await page.getByTestId('await-result').textContent())!.split('|').map(Number);
  expect(ms).toBeGreaterThanOrEqual(900);
  expect(rowsLeft).toBe(0);
});

test('collapseAll: animates the first max-animated-row-count rows out, then collapses everything', async ({ page }) => {
  await page.getByTestId('expand-all').click();
  await expect.poll(() => opening(page, 'on'), { timeout: 3000 }).toEqual([]);
  await page.getByTestId('collapse-all').click();
  await expect.poll(() => closing(page, 'on')).toEqual(['1.1', '1.2', '1.3']);
  await expect(row(page, 'on', '2.1')).toHaveCount(0, { timeout: 3000 });
  await expect(row(page, 'on', '1.1')).toHaveCount(0);
});

test('collapse with motion="none" / the token at 0s: instant, never a closing row', async ({ page }) => {
  for (const id of ['none', 'off']) {
    await toggle(page, id, '3');
    expect(await closing(page, id)).toEqual([]);
    await expect(row(page, id, '3.1')).toHaveCount(0, { timeout: 200 });
  }
});

test('call order is kept: collapseAll(); expandNodes(x) in one tick ends as it would without motion', async ({ page }) => {
  await page.getByTestId('expand-all').click();
  await expect.poll(() => opening(page, 'on'), { timeout: 3000 }).toEqual([]);
  await page.evaluate(() => {
    const t = document.getElementById('on') as any;
    t.collapseAll();
    t.expandNodes('2');
  });
  const paths = () => tree(page, 'on').locator('.wtv__node').evaluateAll((els) => els.map((el) => el.getAttribute('data-tree-path')));
  await expect.poll(paths, { timeout: 3000 }).toEqual(['1', '2', '2.1', '2.2', '3']);
});

// svelte-treeview B11: a non-collapsible root stays open — only what really collapses under it animates out.
test('collapseAll under a non-collapsible root: only the rows that hide animate, the root stays open', async ({ page }) => {
  await expect(row(page, 'pinned', '1.1.1')).toBeVisible();
  await page.getByTestId('pinned-collapse-all').click();
  await expect.poll(() => closing(page, 'pinned')).toEqual(['1.1.1']);
  await expect(row(page, 'pinned', '1.1.1')).toHaveCount(0, { timeout: 3000 });
  await expect(row(page, 'pinned', '1.1')).toBeVisible();
  await expect(row(page, 'pinned', '1.2')).toBeVisible();
  expect(await closing(page, 'pinned')).toEqual([]);
});

test('collapseNodes on a non-collapsible node: nothing animates, nothing collapses, no event', async ({ page }) => {
  await page.getByTestId('pinned-collapse-root').click();
  expect(await closing(page, 'pinned')).toEqual([]);
  await page.waitForTimeout(1300);
  await expect(row(page, 'pinned', '1.1')).toBeVisible();
  await expect(row(page, 'pinned', '1.1.1')).toBeVisible();
  await expect(page.getByTestId('pinned-log')).toHaveText('');
});
