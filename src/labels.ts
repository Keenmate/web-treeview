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
  /** Accessible name (`aria-label`) of the tree body (`role="tree"`). */
  treeLabel: string;
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

  /**
   * Screen-reader announcements (core `announce()`, the page's one polite live region).
   * `''` silences one. A search settled with matches (`{count}`); `announceSearchResultsOne` for exactly one.
   */
  announceSearchResults: string;
  announceSearchResultsOne: string;
  /** A search settled with no matches. */
  announceSearchNoResults: string;
  /** The tree placed dropped nodes (`{name}` = the node, `{target}` = the drop target). */
  announceMovedInto: string;
  announceMovedBefore: string;
  announceMovedAfter: string;
  announceCopiedInto: string;
  announceCopiedBefore: string;
  announceCopiedAfter: string;
  /** The `{name}` of a drop that placed several nodes (`{count}`). */
  announceDropItems: string;
  /** The `{target}` of a drop onto the empty tree / the top level. */
  announceDropTreeRoot: string;
  /** A refused drop and its reason (`{target}` = the node that doesn't accept drops). */
  announceDropDenied: string;
}

/** Built-in English strings. */
export const DEFAULT_LABELS: Readonly<TreeViewLabels> = Object.freeze({
  noData: 'No data',
  noResults: 'No results found',
  noDisplayValue: '[N/A]',
  loading: 'Loading…',
  dropHere: 'Drop here',
  showFullLabel: 'Show full label',
  treeLabel: 'Tree',
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
  announceSearchResults: '{count} results',
  announceSearchResultsOne: '1 result',
  announceSearchNoResults: 'No results found',
  announceMovedInto: '{name} moved into {target}',
  announceMovedBefore: '{name} moved before {target}',
  announceMovedAfter: '{name} moved after {target}',
  announceCopiedInto: '{name} copied into {target}',
  announceCopiedBefore: '{name} copied before {target}',
  announceCopiedAfter: '{name} copied after {target}',
  announceDropItems: '{count} items',
  announceDropTreeRoot: 'the tree',
  announceDropDenied: 'Cannot drop here: {target} does not accept dropped items',
});
