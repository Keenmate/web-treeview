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

test('motion="none": scrollToPath jumps instantly; the drop-zone icon does not bob', async ({ page }) => {
  await load(page);
  await page.evaluate(() => {
    const tree = document.getElementById('tree')!;
    tree.setAttribute('motion', 'none');
    tree.setAttribute('show-empty-drop-placeholder', '');
    (tree as any).nodes = [];
  });
  const icon = page.locator('#tree .wtv__empty-zone-content');
  await expect(icon).toBeVisible();
  const anim = await page.evaluate(() => {
    const zone = document.getElementById('tree')!.shadowRoot!.querySelector('.wtv__empty-zone')!;
    zone.classList.add('wtv__empty-zone--active');
    return getComputedStyle(zone.querySelector('.wtv__empty-zone-content')!, '::before').animationName;
  });
  expect(anim).toBe('none');
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
