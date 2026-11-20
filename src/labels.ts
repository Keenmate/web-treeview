/**
 * UI strings (BlissFramework D-NC-24). Every built-in text the tree renders is a
 * `labels` key: the `labels` input is a PARTIAL object (also a JSON attribute).
 * Keys are flat `<elementType>.<name>` (`menuItems.copy`, `ariaLabels.tree`), resolved
 * per key by core `/locale` `createLabels` (see `TreeViewEngine`): the instance `labels`
 * (short `messages.noData` or full `web-treeview.messages.noData` key) → the page-wide
 * flat dictionary `window.components.locale.labels['web-treeview.<key>']` → the English
 * defaults below. Placeholders use `{name}`.
 */

/** Every UI string of `<web-treeview>`. */
export interface TreeViewLabels {
  /** Empty-tree text when the tree has no nodes at all (no `renderEmptyStateCallback`). */
  'messages.noData': string;
  /** Empty-tree text when nodes exist but the search filter left none visible. */
  'messages.noResults': string;
  /** Text of the empty-tree drop zone (no `renderEmptyZoneCallback`). */
  'messages.dropHere': string;
  /** Visible text of a lazy context submenu's loading row while its children load. */
  'messages.loading': string;
  /** Text of a node with no resolvable display value (`displayValueMember` / `getDisplayValueCallback`). */
  'labels.noDisplayValue': string;
  /** Drag-and-drop pads over a hovered node (`drop-zone-mode="floating"`): drop before the node. */
  'labels.dropBefore': string;
  /** Drop pad: drop after the node. */
  'labels.dropAfter': string;
  /** Drop pad: drop as the node's child. */
  'labels.dropChild': string;
  /** Accessible name (`aria-label`) of the tree body (`role="tree"`). */
  'ariaLabels.tree': string;
  /** Accessible label (`aria-label`) of the `isLoading` overlay — core `renderLoader` sets it on the container (also passed as the loader hook's `ctx.label`). */
  'ariaLabels.loading': string;
  /** Accessible label of the trailing info button on a clipped node label (`nodeTitleOverflow: 'info'`). */
  'ariaLabels.showFullLabel': string;
  /** Context menu as a phone sheet / drawer: the accessible name of the header's close button. */
  'ariaLabels.closeSheet': string;
  /** Built-in context-menu items. */
  'menuItems.copy': string;
  'menuItems.cut': string;
  'menuItems.paste': string;
  'menuItems.delete': string;
  'menuItems.expand': string;
  'menuItems.collapse': string;
  'menuItems.expandSubtree': string;
  'menuItems.collapseSubtree': string;
  'menuItems.expandAll': string;
  'menuItems.collapseAll': string;
  'menuItems.sort': string;
  'menuItems.sortSubtree': string;
  'menuItems.sortAll': string;
  /** Context menu as a phone sheet / drawer: the row on top of a drilled-in submenu that goes up one level. */
  'menuItems.back': string;

  /**
   * Screen-reader announcements (core `announce()`, the page's one polite live region).
   * `''` silences one. A search settled with matches (`{count}`); `ariaLabels.searchResultsOne` for exactly one.
   */
  'ariaLabels.searchResults': string;
  'ariaLabels.searchResultsOne': string;
  /** A search settled with no matches. */
  'ariaLabels.searchNoResults': string;
  /** The tree placed dropped nodes (`{name}` = the node, `{target}` = the drop target). */
  'ariaLabels.movedInto': string;
  'ariaLabels.movedBefore': string;
  'ariaLabels.movedAfter': string;
  'ariaLabels.copiedInto': string;
  'ariaLabels.copiedBefore': string;
  'ariaLabels.copiedAfter': string;
  /** The `{name}` of a drop that placed several nodes (`{count}`). */
  'ariaLabels.dropItems': string;
  /** The `{target}` of a drop onto the empty tree / the top level. */
  'ariaLabels.dropTreeRoot': string;
  /** A refused drop and its reason (`{target}` = the node that doesn't accept drops). */
  'ariaLabels.dropDenied': string;
}

/** Built-in English strings. */
export const DEFAULT_LABELS: Readonly<TreeViewLabels> = Object.freeze({
  'messages.noData': 'No data',
  'messages.noResults': 'No results found',
  'messages.dropHere': 'Drop here',
  'messages.loading': 'Loading…',
  'labels.noDisplayValue': '[N/A]',
  'labels.dropBefore': 'Before',
  'labels.dropAfter': 'After',
  'labels.dropChild': 'Child',
  'ariaLabels.tree': 'Tree',
  'ariaLabels.loading': 'Loading…',
  'ariaLabels.showFullLabel': 'Show full label',
  'ariaLabels.closeSheet': 'Close',
  'menuItems.copy': 'Copy',
  'menuItems.cut': 'Cut',
  'menuItems.paste': 'Paste',
  'menuItems.delete': 'Delete',
  'menuItems.expand': 'Expand',
  'menuItems.collapse': 'Collapse',
  'menuItems.expandSubtree': 'Expand subtree',
  'menuItems.collapseSubtree': 'Collapse subtree',
  'menuItems.expandAll': 'Expand all',
  'menuItems.collapseAll': 'Collapse all',
  'menuItems.sort': 'Sort',
  'menuItems.sortSubtree': 'Sort subtree',
  'menuItems.sortAll': 'Sort all',
  'menuItems.back': 'Back',
  'ariaLabels.searchResults': '{count} results',
  'ariaLabels.searchResultsOne': '1 result',
  'ariaLabels.searchNoResults': 'No results found',
  'ariaLabels.movedInto': '{name} moved into {target}',
  'ariaLabels.movedBefore': '{name} moved before {target}',
  'ariaLabels.movedAfter': '{name} moved after {target}',
  'ariaLabels.copiedInto': '{name} copied into {target}',
  'ariaLabels.copiedBefore': '{name} copied before {target}',
  'ariaLabels.copiedAfter': '{name} copied after {target}',
  'ariaLabels.dropItems': '{count} items',
  'ariaLabels.dropTreeRoot': 'the tree',
  'ariaLabels.dropDenied': 'Cannot drop here: {target} does not accept dropped items',
});
