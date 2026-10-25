/**
 * Categorized loggers for @keenmate/web-treeview — now a thin shim over the core
 * logging module (`@keenmate/web-components-core`, SPEC §12.1). Core owns the
 * `loglevel` dependency and the colour-coded `%c` prefix (built in a
 * `methodFactory`, ordering-safe), so the previously vendored `loglevel` +
 * `loglevel-plugin-prefix` copies under `src/vendor/` are gone.
 *
 * The engine (`treeview.ts`, `controller/`, `renderer/`, `ltree/`) imports the
 * category loggers by name, so this module keeps that surface:
 *
 * Categories (`TREEVIEW:*`):
 * - INIT   — component initialization and configuration
 * - DATA   — data insertion, tree manipulation, node operations
 * - INDEX  — search indexing operations
 * - UI     — rendering, context-menu, interaction
 * - DRAG   — drag-and-drop
 * - RENDER — progressive/virtual render coordination
 *
 * Enable from the console (or `window.components['web-treeview'].logging`):
 *
 * ```js
 * import { enableLogging, setLogLevel, setCategoryLevel } from '@keenmate/web-treeview';
 * enableLogging();                              // all categories → debug
 * setLogLevel('info');                          // all categories → info
 * setCategoryLevel('TREEVIEW:INDEX', 'debug');  // one category (bare or 'TREEVIEW:INDEX')
 * ```
 */
import { createLoggers, type Logger, type LogLevelDesc } from '@keenmate/web-components-core';

const CATEGORIES = ['INIT', 'DATA', 'INDEX', 'UI', 'DRAG', 'RENDER'] as const;
type Category = (typeof CATEGORIES)[number];

/**
 * The single core logger bundle for this component. Exported so the element
 * registration (`index.ts` → `registerComponent`) can expose its controls on
 * `window.components['web-treeview'].logging` and `BlissElement` can build the
 * per-instance `this.log` loggers from it.
 */
export const logging = createLoggers('TREEVIEW', CATEGORIES);

// The category loggers, by their historical names. Each is a `loglevel` Logger,
// so `dataLogger.debug(...)` etc. work exactly as before.
export const initLogger: Logger = logging.loggers.INIT;
export const dataLogger: Logger = logging.loggers.DATA;
export const indexLogger: Logger = logging.loggers.INDEX;
export const uiLogger: Logger = logging.loggers.UI;
export const dragLogger: Logger = logging.loggers.DRAG;
export const renderLogger: Logger = logging.loggers.RENDER;

/** Full (namespaced) category names, kept for back-compat introspection. */
export const LOGGING_CATEGORIES = CATEGORIES.map((c) => `TREEVIEW:${c}`);

/** Enable all logging (debug level). */
export function enableLogging(): void {
  logging.enableLogging();
}

/** Disable all logging (silent). */
export function disableLogging(): void {
  logging.disableLogging();
}

/** Set the same level on every category. */
export function setLogLevel(level: LogLevelDesc): void {
  logging.setLogLevel(level);
}

/**
 * Set the level of one category. Accepts the full prefixed name
 * (`TREEVIEW:INDEX`) or the bare suffix (`INDEX`) — both normalize to the
 * category key the core bundle expects.
 */
export function setCategoryLevel(category: string, level: LogLevelDesc = 'debug'): void {
  const bare = (category.includes(':') ? category.split(':').pop()! : category) as Category;
  logging.setCategoryLevel(bare, level);
}

// No forced level here: core gives every bundle its default (`warn`), a persisted
// `km-log:*` level wins, and `window.components.logging` is the page-wide switch.

/** The per-category loggers the engine / LTree / renderer log through. The element
 *  passes its instance loggers (`[TREEVIEW:CAT] #id …`); standalone use (no
 *  element) falls back to the plain category loggers. */
export type TreeLoggers = Record<Category, Pick<Logger, 'debug' | 'info' | 'warn' | 'error'>>;
export const defaultTreeLoggers: TreeLoggers = logging.loggers;

// Back-compat default export: modules that did `import log from './logger'` use
// it as a general sink → the INIT logger.
export default initLogger;
