import { test, expect } from './fixtures';
// @ts-expect-error — plain ESM helper shipped by the contract package (no .d.ts)
import { contractParity } from '@keenmate/base-css-variables/testing/parity';

/**
 * The tree looks the same with and without @keenmate/base-css-variables.
 *
 * Renders test/contract-parity.html standalone and with the contract injected, in light and
 * dark, and compares every color-valued --wtv-* token. A second pass sets a different accent
 * (--wtv-accent-color standalone vs --base-primary-color with the contract): the derived
 * fallbacks are the contract's formulas on --wtv-accent-color, so they follow.
 * The static side of the same rule is `npm run check:contract`.
 */
test('standalone colors match the contract (light + dark, default + custom accent)', async ({ page }) => {
    const diffs = await contractParity(page, {
        url: '/test/contract-parity.html',
        selector: '#parity',
        prefix: 'wtv',
        accentToken: '--wtv-accent-color',
    });
    expect(diffs).toEqual([]);
});
