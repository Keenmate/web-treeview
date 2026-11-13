/**
 * The public interaction model of `<web-treeview>` (web-components-core `/actions`,
 * SPEC §12.5 / §12.12): the controller facade, the callback contexts, the context-menu
 * items and the event details. Types only.
 *
 * Every callback takes ONE `ctx`; every ctx and every event detail carries `controller`
 * (the public {@link TreeViewController}, also `el.controller`) and `element` (the host) —
 * both non-enumerable, so `JSON.stringify` / logs see only the data.
 */
import type { ComponentContext, DeviceClass } from '@keenmate/web-components-core';
import type { MenuItem, MenuEntry, ActionEventDetail, ResolvedMenuEntry } from '@keenmate/web-components-core/actions';
import type { LTreeNode, DropPosition } from './ltree/ltree-node';
import type { FilterScope, IndexProgress, SearchStatus } from './ltree/types';
import type { Ltree, ExpandOptions, SortOptions, NodesReorderContext, TreeChange, ApplyChangesResult, InsertArrayResult, InsertBranchResult, ReplaceBranchResult, RemoveBranchResult } from './ltree/types';
import type {
  NodeRef,
  NodeRenderContext,
  NodeDragContext,
  NodeDropContext,
  ClipboardEventContext,
  SelectionChangeContext,
  NodeTransformContext,
  BeforeCopyContext,
  BeforeDeleteContext,
  BeforePasteContext,
  BeforeDropContext,
  DragStartContext,
  SelectMode,
  TreeMutationOptions,
  TreeViewScrollSource,
  TreeViewScrollOptions,
} from './controller/types';
import type { PasteResult } from './clipboard';
import type { ScrollToPathOptions } from './types';
import type { ContainerSize } from './renderer/types';
import type { SearchOptions } from 'flexsearch';

/**
 * The public facade — `el.controller`, and `controller` on every callback ctx and event
 * detail. The same methods as the element; delegates to the live tree, so it survives
 * rebuilds.
 */
export interface TreeViewController<T = any> {
  // expand / collapse
  expandAll(paths?: string | string[] | null, options?: ExpandOptions): void;
  collapseAll(paths?: string | string[] | null, options?: ExpandOptions): void;
  expandNodes(paths: string | string[], options?: ExpandOptions): void;
  collapseNodes(paths: string | string[], options?: ExpandOptions): void;
  toggleNodeExpanded(path: string, options?: ExpandOptions): void;
  // sort
  /** Sort the children of each node (one level; `''` = the roots). */
  sortNodes(paths: string | string[], options?: SortOptions<T>): void;
  /** Sort whole subtrees — the nodes' children at every depth; `null` / omitted = the whole tree. */
  sortAll(paths?: string | string[] | null, options?: SortOptions<T>): void;
  /** The expanded set (assign `el.expandedPaths` to change it). */
  readonly expandedPaths: string[];
  // search / scroll
  /** Filter the visible tree to `term` (empty = clear); `searchOptions` go to FlexSearch. */
  filterNodes(term: string, searchOptions?: SearchOptions): void;
  /** The nodes matching `term` (no filtering); `searchOptions` go to FlexSearch. */
  searchNodes(term: string | null, searchOptions?: SearchOptions): LTreeNode<T>[];
  scrollToPath(path: string, options?: ScrollToPathOptions): Promise<boolean>;
  // read
  getNodeByPath(path: string): LTreeNode<T> | null;
  getChildren(parentPath: string): LTreeNode<T>[];
  getSiblings(path: string): LTreeNode<T>[];
  /** The node at `path` with its live parent and siblings. */
  getNodeRef(path: string): NodeRef<T>;
  /** The focused node (`focusNode(path)` / `clearFocus()` move it). */
  readonly focusedNode: LTreeNode<T> | null;
  getVisibleFlatNodes(): LTreeNode<T>[];
  /** Every node's data object in tree order — the current state (mutations included). */
  readonly nodes: T[];
  getTree(): Ltree<T> | undefined;
  /** Result of the most recent data insert (successful / failed / failedDetails). */
  readonly insertResult: InsertArrayResult<T> | undefined;
  /** Whether the node at `path` accepts drops (`getIsDropAllowedCallback` → `isDropAllowedMember`); `false` for an unknown path. */
  isNodeDropAllowed(path: string): boolean;
  /** True while a progressive render is in flight (`render-start` … `render-complete`). */
  readonly isRendering: boolean;
  /** The tree container's last measured size (`container-resize`); `null` before the first measure. */
  readonly containerSize: ContainerSize | null;
  // refresh
  /** Re-render the node at `path` after its data object was changed in place. */
  refreshNode(path: string): void;
  /** Re-sort the children of `parentPath` (`''` = the roots) by the tree's rule and re-render. */
  refreshSiblings(parentPath: string): void;
  // mutate
  addNode(parentPath: string, nodeData: T, pathSegment?: string): any;
  insertNode(targetPath: string, nodeData: T, position: DropPosition): any;
  updateNode(path: string, dataUpdates: Partial<T>): any;
  removeNode(path: string, includeDescendants?: boolean): any;
  moveNode(sourcePath: string, targetPath: string, position: DropPosition): any;
  moveNodes(paths: string[], targetPath: string, position: DropPosition): any;
  duplicateNodes(paths: string[], targetPath: string, position: DropPosition, transform?: NodeTransformCallback<T>, sourceTree?: Ltree<T>): any;
  applyChanges(changes: TreeChange<T>[]): ApplyChangesResult;
  addBranch(parentPath: string, data: T[]): InsertBranchResult<T>;
  insertBranch(targetPath: string, data: T[], position: DropPosition): InsertBranchResult<T>;
  replaceBranch(parentPath: string, data: T[]): ReplaceBranchResult<T>;
  removeBranch(path: string, keepParent?: boolean): RemoveBranchResult<T>;
  // selection
  selectNode(path: string, mode?: SelectMode, options?: TreeMutationOptions): void;
  selectNodes(paths: string[], options?: TreeMutationOptions): void;
  selectAll(options?: TreeMutationOptions): void;
  clearSelection(paths?: string[], options?: TreeMutationOptions): void;
  getSelectedNodes(): LTreeNode<T>[];
  /** The selected set (snapshot; assign `el.selectedPaths` to replace it). */
  readonly selectedPaths: string[];
  isNodeSelected(path: string): boolean;
  /** The Shift-range anchor (Shift+click / Shift+Arrow extend from it); writable, `null` = none. */
  selectionAnchor: string | null;
  /** Toggle the focused node in / out of the selection (Ctrl+click semantics). Multiple selection mode only. */
  toggleFocusedSelect(): void;
  // checked
  checkNode(path: string, options?: TreeMutationOptions): void;
  checkNodes(paths: string[], options?: TreeMutationOptions): void;
  checkAll(options?: TreeMutationOptions): void;
  uncheckNode(path: string, options?: TreeMutationOptions): void;
  uncheckNodes(paths: string[], options?: TreeMutationOptions): void;
  uncheckAll(options?: TreeMutationOptions): void;
  getCheckedNodes(): LTreeNode<T>[];
  /** The checked set as emitted (assign `el.checkedPaths` to replace it). */
  readonly checkedPaths: string[];
  isNodeChecked(path: string): boolean;
  // focus
  focusNode(path: string, options?: TreeMutationOptions): void;
  clearFocus(options?: TreeMutationOptions): void;
  // keyboard navigation
  navTo(path: string): void;
  navNext(): void;
  navPrev(): void;
  navNextSibling(): void;
  navPrevSibling(): void;
  navInto(): void;
  navOut(): void;
  navBackOut(): void;
  navToggle(): void;
  navFirst(): void;
  navLast(): void;
  navPageDown(): void;
  navPageUp(): void;
  navSelectNext(): void;
  navSelectPrev(): void;
  navSelectFirst(): void;
  navSelectLast(): void;
  navSelectPageDown(): void;
  navSelectPageUp(): void;
  // clipboard / delete
  copyNodes(paths?: string[]): void;
  cutNodes(paths?: string[]): void;
  pasteNodes(targetPath: string, transform?: NodeTransformCallback<T> | null, position?: DropPosition): PasteResult<T>;
  cancelCut(): void;
  removeNodes(paths: string[]): { removed: number; failed: number };
  hasClipboardContent(): boolean;
  getClipboardOperation(): 'copy' | 'cut' | null;
  // context menu
  /** Open the context menu for the node at `path` at viewport coordinates. */
  openContextMenu(path: string, x: number, y: number): void;
  closeContextMenu(): void;
  /**
   * Run a menu item exactly like the built-in menu: `beforeActionCallback` (`false` cancels —
   * no `onClick`, built-in or `action` event) → item `onClick(detail)` → built-in action (on the
   * selection when `ctx.node` is in it, else on `ctx.node`) → `action` event. `ctx` = the menu
   * ctx (e.g. the `renderContextMenuCallback` ctx); `trigger` gets `aria-busy` while it runs.
   * Resolves `false` when cancelled. Closing the menu is the caller's job (honour
   * `item.shouldCloseOnClick !== false`).
   */
  activateMenuItem(item: TreeMenuItem<T>, ctx: TreeMenuContext<T>, trigger?: HTMLElement, event?: Event): Promise<boolean>;
}

/** Base of every callback ctx and event detail. */
export type TreeViewContext<T = any> = ComponentContext<TreeViewController<T>>;

/** ctx of the per-node callbacks (`getDisplayValueCallback`, `getIconCallback`, …). */
export interface NodeContext<T = any> extends TreeViewContext<T> {
  node: LTreeNode<T>;
}

/** ctx of `sortCallback`. */
export interface SortContext<T = any> extends TreeViewContext<T> {
  /** The children of ONE parent (siblings) to sort; return them in the new order. */
  nodes: LTreeNode<T>[];
}

/** ctx of `renderNodeCallback`: the node, the content element to fill, and its render state. */
export interface NodeRenderCallbackContext<T = any> extends NodeContext<T>, NodeRenderContext {
  /** The `.wtv__node-content` element to populate. */
  contentElement: HTMLElement;
}

/** ctx of `renderIconCallback`. */
export interface IconRenderContext<T = any> extends NodeContext<T>, NodeRenderContext {
  /** The resolved icon value (iconMember / getIconCallback), or null. */
  value: string | null;
  /** The `.wtv__node-icon` element to populate. */
  iconElement: HTMLElement;
}

/** ctx of the region render callbacks (empty state, empty drop zone, loading, header, footer). */
export interface ContainerRenderContext<T = any> extends TreeViewContext<T> {
  containerElement: HTMLElement;
}

/**
 * The surface ctx of the context menu: the node it opened on, with its live parent and
 * siblings. Built once per open; every item callback and `onClick` gets it.
 */
export interface TreeMenuContext<T = any> extends NodeRef<T>, TreeViewContext<T> {
  node: LTreeNode<T>;
}

/**
 * Built-in context-menu actions — act on the node, or on the whole selection when the node is
 * in it. `expand` / `collapse` = one level (ancestors opened); `expand-subtree` /
 * `collapse-subtree` = the targets and all their descendants; `expand-all` / `collapse-all` =
 * the whole tree. `sort` = the targets' children (one level, the tree's sort rule);
 * `sort-subtree` = the targets' children at every depth; `sort-all` = the whole tree.
 */
export type TreeViewAction = 'copy' | 'cut' | 'paste' | 'delete' | 'expand' | 'collapse' | 'expand-subtree' | 'collapse-subtree' | 'expand-all' | 'collapse-all' | 'sort' | 'sort-subtree' | 'sort-all';

/** A context-menu item (core `MenuItem`): text, icon, shortcut, `get*Callback(ctx)`, `onClick(detail)`, children. */
export type TreeMenuItem<T = any> = MenuItem<TreeMenuContext<T>, TreeViewAction>;
/** A menu item, a divider (`createMenuDivider(text?)`) or a built-in action name. */
export type TreeMenuEntry<T = any> = MenuEntry<TreeMenuContext<T>, TreeViewAction> | TreeViewAction;

/** ctx of `renderContextMenuCallback` — take over the whole menu. */
export interface ContextMenuRenderContext<T = any> extends TreeMenuContext<T> {
  containerElement: HTMLElement;
  /** The resolved top level of `getContextMenuItemsCallback(ctx)` (built-in names → items with
   *  their texts / state, hidden items dropped, dividers collapsed) — run one with
   *  `ctx.controller.activateMenuItem(entry.item, ctx)`; submenus via `getMenuChildren`. */
  entries: ResolvedMenuEntry<TreeMenuContext<T>, TreeViewAction>[];
}

/** ctx of `renderContextMenuItemCallback` — fill one item's button (leave it empty for the default). */
export interface ContextMenuItemRenderContext<T = any> extends TreeMenuContext<T> {
  menuItem: TreeMenuItem<T>;
  buttonElement: HTMLElement;
}

/** Detail of the `action` event / `onAction` / an item's `onClick` / `beforeActionCallback`. */
export type TreeViewActionEventDetail<T = any> = ActionEventDetail<TreeMenuContext<T>, TreeViewAction>;

/** ctx of `beforeCheckboxToggleCallback`. Return `false` to cancel, a `string[]` to override the affected paths. */
export interface BeforeCheckboxToggleContext<T = any> extends NodeContext<T> {
  /** The state the node is about to get. */
  isChecked: boolean;
  /** Every path the toggle will change (the cascade included). */
  affectedPaths: string[];
}

/**
 * ctx of `beforeExpandCallback` — the node about to expand (`node`, `path`, `parent`,
 * `siblings`) + `controller` / `element`. Return `false` (or resolve `false`) to keep it
 * collapsed; return a Promise to load children first (e.g. `ctx.controller.addBranch`).
 */
export type BeforeExpandContext<T = any> = NodeRef<T> & TreeViewContext<T>;

/** ctx of `beforeKeydownCallback` — return `false` to suppress the built-in handling. Synchronous. */
export interface KeydownContext<T = any> extends TreeViewContext<T> {
  event: KeyboardEvent;
  focusedNode: LTreeNode<T> | null;
  selectedNodes: LTreeNode<T>[];
}

/**
 * ctx of `beforeScrollCallback` — the tree is about to scroll `node` into view on its own.
 * Return `false` to skip the scroll, or a partial `options` to replace the defaults. Synchronous.
 */
export interface TreeViewBeforeScrollContext<T = any> extends NodeContext<T> {
  path: string;
  /** `'keyboard'` (a keyboard move), `'scroll-to-path'` (`scrollToPath`), `'paste'` (the reveal after a paste into a node). */
  source: TreeViewScrollSource;
  /** The scroll container around the row (the tree's own, or a wrapper) — `null` = only the page scrolls. */
  container: HTMLElement | null;
  /** What the tree is about to use (its defaults for this `source`). */
  options: TreeViewScrollOptions;
}

/** ctx of the node transforms (`nodeOutputTransformationCallback` / `nodeInputTransformationCallback`, the paste / duplicate transform argument). */
export interface NodeTransformCallbackContext<T = any> extends NodeTransformContext<T>, TreeViewContext<T> {
  /** The node data to transform (a snapshot — return a new object). */
  data: T;
}
/** A node transform: return the (new) data; an input transform may return null to skip the node. */
export type NodeTransformCallback<T = any> = (ctx: NodeTransformCallbackContext<T>) => T | null;

export type BeforeCopyCallbackContext<T = any> = BeforeCopyContext<T> & TreeViewContext<T>;
export type BeforeDeleteCallbackContext<T = any> = BeforeDeleteContext<T> & TreeViewContext<T>;
export type BeforePasteCallbackContext<T = any> = BeforePasteContext<T> & TreeViewContext<T>;
export type BeforeDropCallbackContext<T = any> = BeforeDropContext<T> & TreeViewContext<T>;
export type BeforeDragStartContext<T = any> = DragStartContext<T> & TreeViewContext<T>;

// ── Event details ────────────────────────────────────────────────────────────

/** `node-click` / `node-double-click` / `node-drag-reject` / `node-drop-reject`: the node with its parent + siblings. */
export type NodeEventDetail<T = any> = NodeRef<T> & TreeViewContext<T>;
/** `node-drag-start` / `node-drag-over`. */
export type NodeDragEventDetail<T = any> = NodeDragContext<T> & TreeViewContext<T>;
/** `node-drop`. */
export type NodeDropEventDetail<T = any> = NodeDropContext<T> & TreeViewContext<T>;
/** `node-copy` / `node-cut` / `node-delete`. */
export type NodeClipboardEventDetail<T = any> = ClipboardEventContext<T> & TreeViewContext<T>;
/** `node-paste`: the paste result (not fired when `beforePasteCallback` blocked it). */
export type NodePasteEventDetail<T = any> = PasteResult<T> & TreeViewContext<T>;
/** `selection-change` / `checked-change`. */
export type SelectionChangeEventDetail<T = any> = SelectionChangeContext<T> & TreeViewContext<T>;
/** `focus-change`. */
export interface FocusChangeEventDetail<T = any> extends TreeViewContext<T> {
  focusedNode: LTreeNode<T> | null;
}
/** `expanded-change`: the whole new expanded set (same as `expandedPaths`). */
export interface ExpandedChangeEventDetail<T = any> extends TreeViewContext<T> {
  paths: string[];
}
/** `nodes-reorder`: one parent whose children's `orderMember` values a sort rewrote. */
export type NodesReorderEventDetail<T = any> = NodesReorderContext<T> & TreeViewContext<T>;
/** `tree-change`: the context only. */
export type TreeEventDetail<T = any> = TreeViewContext<T>;
/** `render-start`: the context only. */
export type RenderStartEventDetail<T = any> = TreeViewContext<T>;
/** `index-progress`: the async search index filled another batch (`isComplete` once at the end).
 *  Search / filter results are partial until `isComplete`. */
export type IndexProgressEventDetail<T = any> = IndexProgress & TreeViewContext<T>;
/** `search-status-change`: the applied (or cleared) filter — `matchCount`, `isLimited` (more
 *  matched than `limit`, the rest cut off), `isIndexing` (index still filling; the filter
 *  re-applies itself on completion and fires again). */
export type SearchStatusEventDetail<T = any> = SearchStatus & TreeViewContext<T>;
export type { FilterScope, IndexProgress, SearchStatus };
/** `render-progress` / `render-complete`: the progressive-render counters. */
export interface RenderStatsEventDetail<T = any> extends TreeViewContext<T> {
  /** Rows still queued. */
  pending: number;
  /** Rows rendered so far in this pass. */
  processed: number;
}
/** `container-resize`: the tree container's new size + the current device class. */
export interface ContainerResizeEventDetail<T = any> extends TreeViewContext<T> {
  size: ContainerSize;
  deviceClass: DeviceClass;
}
