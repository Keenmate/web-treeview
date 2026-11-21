import { test, expect } from './fixtures';

/**
 * Smoke tests for the example pages — the ONLY spec allowed to open `examples-*.html`
 * (every other spec targets a fixture under test/).
 */

test.describe('Localization page (examples-localization.html)', () => {
  /** The shared LO01–LO06 page: no console errors, every toggle changes the text its readout shows. */
  test('every toggle changes the shown text', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    await page.goto('/examples-localization.html');
    const out = (id: string) => page.locator(`#${id}`);

    // LO01 — instance labels (on by default: short + full key), off → English.
    await expect(out('lo01-out')).toContainText('#lo01        aria-label: Soubory');
    await expect(out('lo01-out')).toContainText('nodes: (bez názvu) | package.json');
    await expect(out('lo01-out')).toContainText('#lo01-plain  aria-label: Tree');
    await page.locator('#lo01-labels').uncheck();
    await expect(out('lo01-out')).toContainText('#lo01        aria-label: Tree   nodes: [N/A] | package.json');

    // LO02 — the page dictionary translates every tree.
    await expect(out('lo02-out')).toContainText('#lo02a  empty: No data');
    await expect(out('lo02-out')).toContainText('#lo02b  empty: No results found');
    await page.locator('#lo02-dict').check();
    await expect(out('lo02-out')).toContainText('#lo02a  empty: Žádná data   aria-label: Strom');
    await expect(out('lo02-out')).toContainText('#lo02b  empty: Nic nenalezeno');
    await page.locator('#lo02-dict').uncheck();
    await expect(out('lo02-out')).toContainText('#lo02a  empty: No data');

    // LO03 — page callback, then the element's own one first; instance labels still win.
    await page.locator('#lo03-page').check();
    await expect(out('lo03-out')).toContainText('#lo03a  empty: Žiadne údaje   aria-label: Strom');
    await expect(out('lo03-out')).toContainText('#lo03b  empty: Instance wins   aria-label: Strom');
    await page.locator('#lo03-own').check();
    await expect(out('lo03-out')).toContainText('#lo03a  empty: Keine Daten   aria-label: Strom');
    await page.locator('#lo03-page').uncheck();
    await page.locator('#lo03-own').uncheck();
    await expect(out('lo03-out')).toContainText('#lo03a  empty: No data   aria-label: Tree');

    // LO04 — messages.loading only → the ariaLabels.loading twin follows.
    await expect(out('lo04-out')).toHaveText('aria-label: Loading…');
    await page.locator('#lo04-caption').check();
    await expect(out('lo04-out')).toHaveText('aria-label: Načítání…');

    // LO05 — the page locale formats {count} in the search announcement.
    await page.locator('input[name="lo05-locale"][value="de-DE"]').check();
    await expect(out('lo05-out')).toHaveText('announced: 1.234 results');
    await page.locator('input[name="lo05-locale"][value="en-IN"]').check();
    await expect(out('lo05-out')).toHaveText('announced: 1,234 results');
    // … the element's own `locale` beats the page one; unset = the page locale again.
    await page.locator('input[name="lo05-el-locale"][value="de"]').check();
    await expect(out('lo05-out')).toHaveText('announced: 1.234 results');
    await page.locator('input[name="lo05-el-locale"][value=""]').check();
    await expect(out('lo05-out')).toHaveText('announced: 1,234 results');

    expect(consoleErrors).toEqual([]);
  });
});
