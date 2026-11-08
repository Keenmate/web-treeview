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
        async ({ page, browserName }, use, testInfo) => {
            const errors: string[] = [];
            const isWebKit = browserName === 'webkit';
            page.on('pageerror', (e) => {
                const message = e.message ?? String(e);
                // WebKit only: a browser notice, not an exception, when a resize observed by a
                // ResizeObserver lands in the same frame (the custom-styles `@import` test's stylesheet
                // finishing its load). Chromium / Firefox keep reporting it, so a real
                // ResizeObserver feedback loop in the tree still fails the suite there.
                if (isWebKit && message.startsWith('ResizeObserver loop')) return;
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
 * Engine gaps in the test harness (not in the tree). Native HTML5 drag-and-drop: Playwright WebKit
 * on Windows delivers no `drop` for a mouse-driven drag; not confirmed on Linux / macOS WebKit, so
 * those still run it. Skip a describe with `test.skip(hasNoNativeDnd, WEBKIT_NO_NATIVE_DND)`, one
 * test with `test.skip(hasNoNativeDnd({ browserName }), WEBKIT_NO_NATIVE_DND)` in its body. Touch:
 * WebKit has no `Touch` constructor on any platform, so that skip is `browserName === 'webkit'`.
 */
export const hasNoNativeDnd = ({ browserName }: { browserName: string }): boolean =>
    browserName === 'webkit' && process.platform === 'win32';
export const WEBKIT_NO_NATIVE_DND =
    'Playwright WebKit on Windows delivers no HTML5 drop for a mouse-driven drag (dragTo / mouse down-move-up: drop count 0); Chromium + Firefox cover it';
export const WEBKIT_NO_TOUCH_CTOR =
    'WebKit has no Touch constructor (new Touch() throws "Illegal constructor", also with hasTouch + isMobile), so synthetic touch drags cannot be built; Chromium + Firefox cover it';
