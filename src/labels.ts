/**
 * UI strings (BlissFramework D-NC-24). Every built-in text the tree renders is a
 * `labels` key: the `labels` input is a PARTIAL object (also a JSON attribute).
 * Keys are flat `<elementType>.<name>` (`menuItems.copy`, `ariaLabels.tree`), resolved
 * per key by core `/locale` `createLabels` (see `TreeViewEngine`): the instance `labels`
 * (short `messages.noData` or full `web-treeview.messages.noData` key) → the page-wide
 * flat dictionary `window.components.locale.labels['web-treeview.<key>']` → the English
 * defaults below. Dynamic texts read the spot's context: `{ctx.count}`, `{ctx.name}`, … (core `/locale` dotted
 * paths; numbers formatted in the tree's locale). The context of each key is named in its JSDoc; a `translateCallback`
 * gets it as `params.ctx` (`ctx.count` = the number the text's noun agrees with — core never picks plural forms).
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
   * `''` silences one. A search settled with matches — ctx `SearchResultsLabelContext` (`{ctx.count}` = the matches,
   * `{ctx.searchTerm}`).
   */
  'ariaLabels.searchResults': string;
  /** A search settled with no matches (ctx `SearchResultsLabelContext`, `ctx.count` = 0). */
  'ariaLabels.searchNoResults': string;
  /** The tree placed dropped nodes — ctx `DropLabelContext` (`{ctx.name}` = the node, or `ariaLabels.dropItems` for
   *  several; `{ctx.target}` = the drop target; `ctx.count` = the dropped nodes). */
  'ariaLabels.movedInto': string;
  'ariaLabels.movedBefore': string;
  'ariaLabels.movedAfter': string;
  'ariaLabels.copiedInto': string;
  'ariaLabels.copiedBefore': string;
  'ariaLabels.copiedAfter': string;
  /** The `ctx.name` of a drop that placed several nodes — ctx `DropItemsLabelContext` (`{ctx.count}` = the nodes). */
  'ariaLabels.dropItems': string;
  /** The `ctx.target` of a drop onto the empty tree / the top level. */
  'ariaLabels.dropTreeRoot': string;
  /** A refused drop and its reason — ctx `DropDeniedLabelContext` (`{ctx.target}` = the node that doesn't accept drops). */
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
  'ariaLabels.searchResults': 'Results: {ctx.count}',
  'ariaLabels.searchNoResults': 'No results found',
  'ariaLabels.movedInto': '{ctx.name} moved into {ctx.target}',
  'ariaLabels.movedBefore': '{ctx.name} moved before {ctx.target}',
  'ariaLabels.movedAfter': '{ctx.name} moved after {ctx.target}',
  'ariaLabels.copiedInto': '{ctx.name} copied into {ctx.target}',
  'ariaLabels.copiedBefore': '{ctx.name} copied before {ctx.target}',
  'ariaLabels.copiedAfter': '{ctx.name} copied after {ctx.target}',
  'ariaLabels.dropItems': 'Items ({ctx.count})',
  'ariaLabels.dropTreeRoot': 'the tree',
  'ariaLabels.dropDenied': 'Cannot drop here: {ctx.target} does not accept dropped items',
});
