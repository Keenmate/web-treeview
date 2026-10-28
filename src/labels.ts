/**
 * UI strings (BlissFramework D-NC-24). Every built-in text the tree renders is a
 * `labels` key: the `labels` input is a PARTIAL object (also a JSON attribute),
 * merged per key over the English defaults below. Placeholders use `{name}`.
 *
 * {@link resolveLabel} is the single resolving seam — when core `/locale` lands,
 * the page-wide `window.components.locale.labels['web-treeview']` layer goes in
 * there (instance → page → built-in English).
 */

/** Every UI string of `<web-treeview>`. */
export interface TreeViewLabels {
  /** Empty-tree text when the tree has no nodes at all (no `renderEmptyStateCallback`). */
  noData: string;
  /** Empty-tree text when nodes exist but the search filter left none visible. */
  noResults: string;
  /** Text of a node with no resolvable display value (`displayValueMember` / `getDisplayValueCallback`). */
  noDisplayValue: string;
  /** Accessible label (`aria-label`) of the `isLoading` spinner overlay (no `renderLoadingCallback`). */
  loading: string;
  /** Text of the empty-tree drop zone (no `renderEmptyZoneCallback`). */
  dropHere: string;
  /** Accessible label of the trailing info button on a clipped node label (`nodeTitleOverflow: 'info'`). */
  showFullLabel: string;
  /** Built-in context-menu items. */
  copy: string;
  cut: string;
  paste: string;
  delete: string;
  expand: string;
  collapse: string;
  expandSubtree: string;
  collapseSubtree: string;
  expandAll: string;
  collapseAll: string;
  sort: string;
  sortSubtree: string;
  sortAll: string;
}

/** Built-in English strings. */
export const DEFAULT_LABELS: Readonly<TreeViewLabels> = Object.freeze({
  noData: 'No data',
  noResults: 'No results found',
  noDisplayValue: '[N/A]',
  loading: 'Loading…',
  dropHere: 'Drop here',
  showFullLabel: 'Show full label',
  copy: 'Copy',
  cut: 'Cut',
  paste: 'Paste',
  delete: 'Delete',
  expand: 'Expand',
  collapse: 'Collapse',
  expandSubtree: 'Expand subtree',
  collapseSubtree: 'Collapse subtree',
  expandAll: 'Expand all',
  collapseAll: 'Collapse all',
  sort: 'Sort',
  sortSubtree: 'Sort subtree',
  sortAll: 'Sort all',
});

/**
 * Resolve one UI string: instance `labels[key]` → built-in English, then fill
 * `{name}` placeholders from `vars` (unknown placeholders are left as-is).
 * A string — including `''` (deliberately empty: render nothing) — wins;
 * `undefined` / missing / non-string falls back to the English default.
 * Every label is inserted as text (`textContent` / attributes), so placeholder
 * values need no HTML escaping.
 */
export function resolveLabel(
  labels: Partial<TreeViewLabels> | null | undefined,
  key: keyof TreeViewLabels,
  vars?: Record<string, string | number>,
): string {
  const own = labels?.[key];
  const text = typeof own === 'string' ? own : DEFAULT_LABELS[key];
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}
