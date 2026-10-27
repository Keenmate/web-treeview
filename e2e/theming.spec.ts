import { test, expect, Page, Locator } from './fixtures';

/**
 * E2E coverage for /test/theming.html — verifies that dark-mode signals
 * affect the .wtv__container inside the web-component's Shadow DOM.
 *
 * Three independent paths exercised:
 *
 *   A. Library defaults (no brand theme)
 *      Light: --wtv-bg-color falls back to var(--base-main-bg, #ffffff)  → rgb(255, 255, 255)
 *      Dark:  --wtv-bg-color falls back to var(--base-main-bg, #1e293b)  → rgb(30, 41, 59) (the contract default)
 *      Triggered by per-instance theme="dark"/"light" prop (mirrored to
 *      data-theme on the container by _applyTheme).
 *
 *   B. Brand theme with light-dark() at wrapper
 *      Light: --base-main-bg = #dc2626 → rgb(220, 38, 38)
 *      Dark:  --base-main-bg = #16a34a → rgb(22, 163, 74)
 *      CSS custom properties inherit through Shadow DOM, so the wrapper's
 *      --base-main-bg reaches the inner .wtv__container. light-dark() resolves
 *      against the inherited color-scheme.
 *
 *   C. OS prefers-color-scheme: dark
 *      The component has NO prefers-color-scheme rule: with no signal it
 *      inherits the page's color-scheme, so an unsignalled page stays light and
 *      a page declaring `color-scheme: light dark` follows the OS (live).
 *
 *   D. Page signals ([data-theme], [data-bs-theme], .dark on <html>) and
 *      theme-source — mirrored onto the host as data-context-theme by
 *      @keenmate/web-components-core (tests 8–13).
 */

const PAGE = '/test/theming.html';

const LIGHT_BG = 'rgb(255, 255, 255)';
const DARK_BG = 'rgb(30, 41, 59)'; // #1e293b, the contract's dark --base-main-bg
const BRAND_LIGHT_BG = 'rgb(220, 38, 38)'; // #dc2626 red
const BRAND_DARK_BG = 'rgb(22, 163, 74)';  // #16a34a green

function scenarioCard(page: Page, scenario: string): Locator {
  return page.locator(`.card[data-scenario="${scenario}"]`);
}

function ltreeContainer(card: Locator): Locator {
  return card.locator('.wtv__container').first();
}

async function backgroundColor(loc: Locator): Promise<string> {
  return loc.evaluate((el) => getComputedStyle(el).backgroundColor);
}

test.describe('Theming — library defaults + per-instance prop', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE);
    await page.locator('h1').first().waitFor();
    await expect(page.locator('.wtv__container').first()).toBeAttached();
  });

  test('1. No signal → tree surface is library light default', async ({ page }) => {
    const tree = ltreeContainer(scenarioCard(page, 'baseline-light'));
    expect(await backgroundColor(tree)).toBe(LIGHT_BG);
  });

  test('2. Per-instance theme="dark" → library dark default', async ({ page }) => {
    const tree = ltreeContainer(scenarioCard(page, 'per-instance-dark'));
    expect(await backgroundColor(tree)).toBe(DARK_BG);
    await expect(tree).toHaveAttribute('data-theme', 'dark');
  });

  test('3. Per-instance theme="light" → library light default', async ({ page }) => {
    const tree = ltreeContainer(scenarioCard(page, 'per-instance-light'));
    expect(await backgroundColor(tree)).toBe(LIGHT_BG);
    await expect(tree).toHaveAttribute('data-theme', 'light');
  });
});

test.describe('Theming — brand theme with light-dark() inherits through Shadow DOM', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE);
    await page.locator('h1').first().waitFor();
    await expect(page.locator('.wtv__container').first()).toBeAttached();
  });

  test('4. Brand theme, normal color-scheme → RED (light branch of light-dark)', async ({ page }) => {
    const tree = ltreeContainer(scenarioCard(page, 'brand-debug'));
    expect(await backgroundColor(tree)).toBe(BRAND_LIGHT_BG);
  });

  test('5. Brand theme, page color-scheme=dark → GREEN (dark branch flips)', async ({ page }) => {
    await page.evaluate(() => { document.documentElement.style.colorScheme = 'dark'; });
    const tree = ltreeContainer(scenarioCard(page, 'brand-debug'));
    await tree.evaluate((el) => void el.getBoundingClientRect());
    await expect.poll(() => backgroundColor(tree), { timeout: 5000 }).toBe(BRAND_DARK_BG);
  });

  test('6. Brand theme, OS color-scheme=dark → GREEN', async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: 'dark' });
    const page = await context.newPage();
    await page.goto(PAGE);
    await page.locator('h1').first().waitFor();
    const tree = ltreeContainer(scenarioCard(page, 'brand-debug'));
    expect(await backgroundColor(tree)).toBe(BRAND_DARK_BG);
    await context.close();
  });
});

test.describe('Theming — OS preference only through the page color-scheme', () => {
  test('7. OS dark, page declares nothing → tree stays light (matches the page)', async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: 'dark' });
    const page = await context.newPage();
    await page.goto(PAGE);
    await page.locator('h1').first().waitFor();
    const tree = ltreeContainer(scenarioCard(page, 'baseline-light'));
    expect(await backgroundColor(tree)).toBe(LIGHT_BG);
    await context.close();
  });

  test('7b. Page color-scheme: light dark → tree follows the OS, live', async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: 'dark' });
    const page = await context.newPage();
    await page.goto(PAGE);
    await page.locator('h1').first().waitFor();
    await page.evaluate(() => { document.documentElement.style.colorScheme = 'light dark'; });
    const tree = ltreeContainer(scenarioCard(page, 'baseline-light'));
    await expect.poll(() => backgroundColor(tree)).toBe(DARK_BG);
    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(() => backgroundColor(tree)).toBe(LIGHT_BG);
    await context.close();
  });
});

// ── Page / theme-source signals (web-components-core theme context) ─────────
// Core detects data-theme / data-bs-theme / .dark / .light on <html> or <body>
// once per page and mirrors it onto every host as data-context-theme, which
// dark-mode.css reads. No :host-context(), so these hold in Firefox and WebKit.
test.describe('Theming — page signal via data-context-theme', () => {
  const pageSignals: [string, (html: HTMLElement) => void][] = [
    ['<html data-theme="dark">', (h) => h.setAttribute('data-theme', 'dark')],
    ['<html data-bs-theme="dark">', (h) => h.setAttribute('data-bs-theme', 'dark')],
    ['<html class="dark">', (h) => h.classList.add('dark')],
  ];
  pageSignals.forEach(([label, apply], i) => {
    test(`${8 + i}. Page ${label} → library dark default on baseline tree`, async ({ page }) => {
      await page.goto(PAGE);
      await page.locator('h1').first().waitFor();
      await page.evaluate(`(${apply.toString()})(document.documentElement)`);
      const card = scenarioCard(page, 'baseline-light');
      await expect(card.locator('web-treeview')).toHaveAttribute('data-context-theme', 'dark');
      await expect.poll(() => backgroundColor(ltreeContainer(card))).toBe(DARK_BG);
    });
  });

  test('11. Page data-theme="light" beats OS dark', async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: 'dark' });
    const page = await context.newPage();
    await page.goto(PAGE);
    await page.locator('h1').first().waitFor();
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    const tree = ltreeContainer(scenarioCard(page, 'baseline-light'));
    await expect.poll(() => backgroundColor(tree)).toBe(LIGHT_BG);
    await context.close();
  });

  test('12. Wrapper data-theme="dark" + theme-source="closest" → dark', async ({ page }) => {
    await page.goto(PAGE);
    await page.locator('h1').first().waitFor();
    const card = scenarioCard(page, 'baseline-light');
    await card.evaluate((el) => {
      el.setAttribute('data-theme', 'dark');
      el.querySelector('web-treeview')!.setAttribute('theme-source', 'closest');
    });
    await expect.poll(() => backgroundColor(ltreeContainer(card))).toBe(DARK_BG);
  });

  test('13. Per-instance theme="light" wins over page dark', async ({ page }) => {
    await page.goto(PAGE);
    await page.locator('h1').first().waitFor();
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    const tree = ltreeContainer(scenarioCard(page, 'per-instance-light'));
    await expect.poll(() => backgroundColor(tree)).toBe(LIGHT_BG);
  });
});
