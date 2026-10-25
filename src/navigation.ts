/**
 * Tree navigation interface — keyboard and programmatic navigation.
 *
 * The engine builds a default flat-list implementation; consumers replace any
 * individual method via `navigationOverrides` (a {@link TreeNavigationOverrides}).
 * The merged object is `{ ...defaults, ...overrides }`, so a method left out keeps
 * its default. Methods are called on the merged object — inside a `function`
 * (non-arrow) override `this` is the active navigation, so `this.navTo(path)`
 * reaches the (possibly overridden) primitive. The defaults move through
 * `navTo`, so overriding `navTo` changes every built-in move.
 */

export interface TreeNavigation<T> {
  /** Select a node and focus it (core navigation primitive) */
  navTo(path: string): void;
  /** Navigate to the next visible node */
  navNext(): void;
  /** Navigate to the previous visible node */
  navPrev(): void;
  /** ArrowDown — move to the next visible node at the same level */
  navNextSibling(): void;
  /** ArrowUp — move to the previous visible node at the same level */
  navPrevSibling(): void;
  /** ArrowRight — move to the first child (expands if collapsed) */
  navInto(): void;
  /** ArrowLeft — move to the parent node (no collapse) */
  navOut(): void;
  /** Backspace — collapse the parent and move to it */
  navBackOut(): void;
  /** Enter / Space — toggle expand/collapse of the current node */
  navToggle(): void;
  /** Home — move to the first visible node */
  navFirst(): void;
  /** End — move to the last visible node */
  navLast(): void;
  /** PageDown — jump forward ~10 visible nodes */
  navPageDown(): void;
  /** PageUp — jump back ~10 visible nodes */
  navPageUp(): void;

  // ── Shift+navigation: extend the selected range (no-op in single mode) ──
  /** Shift+ArrowDown — extend the selection to the next visible node at the same level */
  navSelectNext(): void;
  /** Shift+ArrowUp — extend the selection to the previous visible node at the same level */
  navSelectPrev(): void;
  /** Shift+Home — extend the selection to the first visible node */
  navSelectFirst(): void;
  /** Shift+End — extend the selection to the last visible node */
  navSelectLast(): void;
  /** Shift+PageDown — extend the selection forward ~10 visible nodes */
  navSelectPageDown(): void;
  /** Shift+PageUp — extend the selection back ~10 visible nodes */
  navSelectPageUp(): void;
}

export type TreeNavigationOverrides<T> = Partial<TreeNavigation<T>>;
