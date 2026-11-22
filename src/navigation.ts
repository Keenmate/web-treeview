/**
 * Tree navigation interface — keyboard and programmatic navigation.
 *
 * The engine builds a default flat-list implementation; consumers replace any
 * individual method via `navigationOverrides` (a {@link TreeNavigationOverrides}).
 * The merged object is `{ ...defaults, ...overrides }`, so a method left out keeps
 * its default. Methods are called on the merged object — inside a `function`
 * (non-arrow) override `this` is the active navigation, so `this.focusAndSelectNode(path)`
 * reaches the (possibly overridden) primitive. The defaults move through
 * `focusAndSelectNode`, so overriding `focusAndSelectNode` changes every built-in move.
 */

export interface TreeNavigation<T> {
  /** Select a node and focus it (core navigation primitive) */
  focusAndSelectNode(path: string): void;
  /** Navigate to the next visible node */
  focusNext(): void;
  /** Navigate to the previous visible node */
  focusPrevious(): void;
  /** ArrowDown — move to the next visible node at the same level */
  focusNextAtLevel(): void;
  /** ArrowUp — move to the previous visible node at the same level */
  focusPreviousAtLevel(): void;
  /** ArrowRight — move to the first child (expands if collapsed) */
  focusFirstChild(): void;
  /** ArrowLeft — move to the parent node (no collapse) */
  focusParent(): void;
  /** Backspace — collapse the parent and move to it */
  collapseParent(): void;
  /** Enter — toggle expand/collapse of the current node */
  toggleFocusedNodeExpanded(): void;
  /** Home — move to the first visible node */
  focusFirst(): void;
  /** End — move to the last visible node */
  focusLast(): void;
  /** PageDown — jump forward ~10 visible nodes */
  focusNextPage(): void;
  /** PageUp — jump back ~10 visible nodes */
  focusPreviousPage(): void;

  // ── Shift+navigation: extend the selected range (no-op in single mode) ──
  /** Shift+ArrowDown — extend the selection to the next visible node at the same level */
  extendSelectionNext(): void;
  /** Shift+ArrowUp — extend the selection to the previous visible node at the same level */
  extendSelectionPrevious(): void;
  /** Shift+Home — extend the selection to the first visible node */
  extendSelectionToFirst(): void;
  /** Shift+End — extend the selection to the last visible node */
  extendSelectionToLast(): void;
  /** Shift+PageDown — extend the selection forward ~10 visible nodes */
  extendSelectionNextPage(): void;
  /** Shift+PageUp — extend the selection back ~10 visible nodes */
  extendSelectionPreviousPage(): void;
}

export type TreeNavigationOverrides<T> = Partial<TreeNavigation<T>>;
