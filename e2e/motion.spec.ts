import { test, expect } from './fixtures';

/**
 * Motion is CSS only: the --wtv-transition-* speeds chain to the contract's
 * --base-duration-*, prefers-reduced-motion sets them to 0s, and 0s turns motion
 * off (no attribute). Disabled dimming chains to --base-disabled-opacity.
 */
const host = '#parity';

const read = (page, names: string[]) =>
    page.evaluate(([sel, n]) => {
        const cs = getComputedStyle(document.querySelector(sel)!);
        return n.map((x) => cs.getPropertyValue(x).trim());
    }, [host, names] as const);

const toggleDuration = (page) =>
    page.evaluate((sel) => {
        const t = document.querySelector(sel)!.shadowRoot!.querySelector('.wtv__toggle-icon')!;
        return getComputedStyle(t).transitionDuration;
    }, host);

const SPEEDS = ['--wtv-transition-fast', '--wtv-transition-normal', '--wtv-transition-medium', '--wtv-transition-slow'];

test.beforeEach(async ({ page }) => {
    await page.goto('/test/contract-parity.html');
    await page.waitForFunction((sel) => document.querySelector(sel)?.shadowRoot?.querySelector('.wtv__toggle-icon'), host);
});

test('the four speeds are the contract defaults standalone; the toggle turns at normal', async ({ page }) => {
    expect(await read(page, SPEEDS)).toEqual(['0.1s', '0.15s', '0.25s', '0.3s']);
    expect(await toggleDuration(page)).toBe('0.15s');
});

test('--base-duration-* re-times the tree; 0s turns motion off', async ({ page }) => {
    await page.evaluate(() => document.documentElement.style.setProperty('--base-duration-normal', '0.25s'));
    expect(await toggleDuration(page)).toBe('0.25s');
    await page.evaluate((sel) => (document.querySelector(sel) as HTMLElement).style.setProperty('--wtv-transition-normal', '0s'), host);
    expect(await toggleDuration(page)).toBe('0s');
});

test('prefers-reduced-motion: every speed is 0s', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await read(page, SPEEDS)).toEqual(['0s', '0s', '0s', '0s']);
    expect(await toggleDuration(page)).toBe('0s');
});

test('disabled opacity follows --base-disabled-opacity (0.65 standalone)', async ({ page }) => {
    expect(await read(page, ['--wtv-disabled-opacity'])).toEqual(['0.65']);
    await page.evaluate(() => document.documentElement.style.setProperty('--base-disabled-opacity', '0.4'));
    expect(await read(page, ['--wtv-disabled-opacity'])).toEqual(['0.4']);
});
