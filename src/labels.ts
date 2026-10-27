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
  /** Empty-tree text (no `renderEmptyStateCallback`). */
  empty: string;
  /** Text of the empty-tree drop zone (no `renderEmptyZoneCallback`). */
  dropHere: string;
  /** Built-in context-menu items. */
  copy: string;
  cut: string;
  paste: string;
  delete: string;
  expand: string;
  collapse: string;
}

/** Built-in English strings. */
export const DEFAULT_LABELS: Readonly<TreeViewLabels> = Object.freeze({
  empty: 'No data',
  dropHere: 'Drop here',
  copy: 'Copy',
  cut: 'Cut',
  paste: 'Paste',
  delete: 'Delete',
  expand: 'Expand',
  collapse: 'Collapse',
});

/**
 * Resolve one UI string: instance `labels[key]` → built-in English, then fill
 * `{name}` placeholders from `vars` (unknown placeholders are left as-is).
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
