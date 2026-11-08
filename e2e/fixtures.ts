/**
 * Shared Playwright test fixtures for the web-treeview e2e suite.
 *
 * Import `test` / `expect` from here instead of `@playwright/test`. The only
 * addition is an always-on guard that **fails any test in which the page threw
 * an uncaught error** (`pageerror`) — the class of failure that let the
 * compact/partial "no options" crash sail through a green suite, because it
 * surfaced only as an uncaught exception during a page's init script and nothing
 * asserted on it.
 *
 * The listener attaches during fixture setup — before the test body's first
 * `page.goto` — so it catches load-time and init-script errors too.
 *
 * Opt out (for a test that deliberately provokes an uncaught error): read the
 * injected `pageErrors` array and clear the entries you expect, e.g.
 *
 *     test('...', async ({ page, pageErrors }) => {
 *         // ...trigger the expected throw...
 *         expect(pageErrors).toHaveLength(1);
 *         pageErrors.length = 0; // consumed → the guard passes
 *     });
 */
import { test as base, expect } from '@playwright/test';

export * from '@playwright/test';

export const test = base.extend<{ pageErrors: string[] }>({
    pageErrors: [
        async ({ page }, use, testInfo) => {
            const errors: string[] = [];
            page.on('pageerror', (e) => {
                const message = e.message ?? String(e);
                // A browser notice, not an exception: WebKit reports it when a resize observed by a
                // ResizeObserver lands in the same frame (e.g. a stylesheet finishing its load).
                if (message.startsWith('ResizeObserver loop')) return;
                errors.push(message);
            });

            await use(errors);

            // Only enforce when the test otherwise passed — don't bury a more
            // specific failure (or an expected-to-fail test) under this one.
            if (errors.length > 0 && testInfo.status === testInfo.expectedStatus) {
                expect(errors, 'uncaught page error(s) during test').toEqual([]);
            }
        },
        { auto: true }
    ]
});

export { expect };

export * from './helpers';

/**
 * Skip reasons for engine gaps in the test harness (not in the tree): pass as
 * `test.skip(({ browserName }) => browserName === 'webkit', WEBKIT_NO_NATIVE_DND)`.
 */
export const WEBKIT_NO_NATIVE_DND =
    'Playwright WebKit (Windows) delivers no HTML5 drop for a mouse-driven drag (dragTo / mouse down-move-up: drop count 0); Chromium + Firefox cover it';
export const WEBKIT_NO_TOUCH_CTOR =
    'WebKit has no Touch constructor (new Touch() throws "Illegal constructor", also with hasTouch + isMobile), so synthetic touch drags cannot be built; Chromium + Firefox cover it';
