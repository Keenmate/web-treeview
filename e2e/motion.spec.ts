import { test, expect, type Page } from './fixtures';

/**
 * Motion level (core rc17, SPEC §12.16): /test/motion.html. The tree reads its speeds from
 * `--base-duration-*` / `--base-scroll-behavior` (via `--wtv-transition-*` / `--wtv-scroll-behavior`),
 * which core's `[data-motion]` presets set — so `motion`, `window.components.motion` and a
 * `data-motion` ancestor all reach it, and the OS reduced-motion setting wins.
 */

const tokens = (page: Page, id = 'tree') => page.evaluate((i) => (window as any).tokens(i), id);

async function load(page: Page) {
  await page.goto('/test/motion.html');
  await expect(page.locator('#tree .wtv__node').first()).toBeVisible();
  await expect(page.locator('#inSection .wtv__node').first()).toBeVisible();
}

test('default (auto): the tree keeps its own speeds', async ({ page }) => {
  await load(page);
  expect(await tokens(page)).toEqual({ normal: '0.15s', slow: '0.3s', scroll: 'smooth' });
});

test('motion="none" / "snappy" / "smooth" on the element', async ({ page }) => {
  await load(page);
  await page.evaluate(() => document.getElementById('tree')!.setAttribute('motion', 'none'));
  await expect.poll(() => tokens(page)).toEqual({ normal: '0s', slow: '0s', scroll: 'auto' });
  await page.evaluate(() => { (document.getElementById('tree') as any).motion = 'snappy'; });
  await expect.poll(() => tokens(page)).toEqual({ normal: '0.08s', slow: '0.15s', scroll: 'smooth' });
  await page.evaluate(() => document.getElementById('tree')!.setAttribute('motion', 'smooth'));
  await expect.poll(() => tokens(page)).toEqual({ normal: '0.25s', slow: '0.45s', scroll: 'smooth' });
});

test('page-wide window.components.motion, and a data-motion section', async ({ page }) => {
  await load(page);
  expect(await tokens(page, 'inSection')).toEqual({ normal: '0s', slow: '0s', scroll: 'auto' });
  await page.evaluate(() => { (window as any).components.motion = 'smooth'; });
  await expect.poll(() => tokens(page)).toEqual({ normal: '0.25s', slow: '0.45s', scroll: 'smooth' });
});

/** The drop-zone icon's bob loop length (the ::before of an active empty zone). */
async function bobDuration(page: Page, id: string) {
  await page.evaluate((i) => {
    const tree = document.getElementById(i)!;
    tree.setAttribute('show-empty-drop-placeholder', '');
    (tree as any).nodes = [];
  }, id);
  await expect(page.locator(`#${id} .wtv__empty-zone-content`)).toBeVisible();
  return page.evaluate((i) => {
    const zone = document.getElementById(i)!.shadowRoot!.querySelector('.wtv__empty-zone')!;
    zone.classList.add('wtv__empty-zone--active');
    const style = getComputedStyle(zone.querySelector('.wtv__empty-zone-content')!, '::before');
    return { name: style.animationName, duration: parseFloat(style.animationDuration) };
  }, id);
}

test('the drop-zone icon bobs by default', async ({ page }) => {
  await load(page);
  const bob = await bobDuration(page, 'tree');
  expect(bob.name).toBe('wtv-drop-placeholder-bob');
  expect(bob.duration).toBeCloseTo(1.1, 1);
});

test('motion="none" on the element: the drop-zone icon does not bob', async ({ page }) => {
  await load(page);
  await page.evaluate(() => document.getElementById('tree')!.setAttribute('motion', 'none'));
  expect((await bobDuration(page, 'tree')).duration).toBe(0);
});

test('a data-motion="none" section: the drop-zone icon does not bob', async ({ page }) => {
  await load(page);
  expect((await bobDuration(page, 'inSection')).duration).toBe(0);
});

test('page-wide window.components.motion = "none": the drop-zone icon does not bob', async ({ page }) => {
  await load(page);
  await page.evaluate(() => { (window as any).components.motion = 'none'; });
  await expect.poll(async () => (await bobDuration(page, 'tree')).duration).toBe(0);
});

test.describe('the OS reduced-motion setting wins', () => {
  test('even over motion="smooth"', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await load(page);
    await page.evaluate(() => document.getElementById('tree')!.setAttribute('motion', 'smooth'));
    await page.waitForTimeout(100);
    expect(await tokens(page)).toEqual({ normal: '0s', slow: '0s', scroll: 'auto' });
  });
});
