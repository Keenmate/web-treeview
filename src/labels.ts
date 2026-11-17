/**
 * UI strings (BlissFramework D-NC-24). Every built-in text the tree renders is a
 * `labels` key: the `labels` input is a PARTIAL object (also a JSON attribute).
 * Resolved per key by core `/locale` `createLabels` (see `WebTreeView`): the
 * instance `labels` → the page-wide `window.components.locale.labels['web-treeview']`
 * → the English defaults below. Placeholders use `{name}`.
 */

/** Every UI string of `<web-treeview>`. */
export interface TreeViewLabels {
  /** Empty-tree text when the tree has no nodes at all (no `renderEmptyStateCallback`). */
  noData: string;
  /** Empty-tree text when nodes exist but the search filter left none visible. */
  noResults: string;
  /** Text of a node with no resolvable display value (`displayValueMember` / `getDisplayValueCallback`). */
  noDisplayValue: string;
  /** Accessible label (`aria-label`) of the `isLoading` overlay — core `renderLoader` sets it on the container (also passed as the loader hook's `ctx.label`). */
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
  /** Context menu as a phone sheet / drawer: the row on top of a drilled-in submenu that goes up one level. */
  back: string;
  /** Context menu as a phone sheet / drawer: the accessible name of the header's close button. */
  close: string;
  /** Drag-and-drop pads over a hovered node (`drop-zone-mode="floating"`): drop before the node. */
  dropBefore: string;
  /** Drop pad: drop after the node. */
  dropAfter: string;
  /** Drop pad: drop as the node's child. */
  dropChild: string;
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
  back: 'Back',
  close: 'Close',
  dropBefore: 'Before',
  dropAfter: 'After',
  dropChild: 'Child',
});
