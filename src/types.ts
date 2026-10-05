// Re-export core types from LTree engine
export type { LTreeNode as TreeNode, LTreeNode, NodeId, DropPosition } from './ltree/ltree-node';
export { VisualState } from './ltree/ltree-node';
export type {
  Ltree,
  InsertArrayResult,
  TreeChange,
  ApplyChangesResult,
  DragDropMode,
  DropZoneLayout,
  DropOperation
} from './ltree/types';

// Re-export context menu types from ltree types
export type { ContextMenuItem, ContextMenuDivider, ContextMenuEntry } from './ltree/types';

// Re-export controller types
export type {
  NodeCallbacks,
  NodeConfig,
  ClickBehavior,
  CheckboxMode,
  CascadeSelectPolicy,
  SelectionModifiers,
  RangeSelectionMode,
  HighlightMode,
  TreeMutationOptions,
  TreeControllerConfig,
  TreeControllerSnapshot,
  TreeControllerEvents,
  // ctx-object context types (rc07 parity with svelte-treeview)
  NodeRef,
  NodeEventContext,
  NodeDragContext,
  NodeDropContext,
  ClipboardEventContext,
  SelectionChangeContext,
  TreeKeydownContext,
  NodeTransformContext,
  BeforeCopyContext,
  BeforeDeleteContext,
  BeforePasteContext,
  BeforeDropContext,
  DragStartContext,
  DropGroup
} from './controller/types';

// Re-export clipboard types
export type { ClipboardEntry, TreeClipboard, ClipboardOperation, PasteResult } from './clipboard';

// Re-export navigation types
export type { TreeNavigation, TreeNavigationOverrides } from './navigation';

// Re-export renderer types
export type { TreeViewRenderer, RendererConfig } from './renderer/types';
export type { RenderCoordinator, RenderStats, RenderCoordinatorCallbacks } from './renderer/render-coordinator';

// ── Configuration ──────────────────────────────────────────────────────

import type { LTreeNode } from './ltree/ltree-node';
import type { DropPosition } from './ltree/ltree-node';
import type { DragDropMode, DropOperation, ContextMenuItem, ContextMenuEntry } from './ltree/types';
import type {
  ClickBehavior,
  RangeSelectionMode,
  HighlightMode,
  TreeMutationOptions,
  NodeEventContext,
  NodeDragContext,
  NodeDropContext,
  ClipboardEventContext,
  SelectionChangeContext,
  TreeKeydownContext,
  NodeTransformContext,
  BeforeCopyContext,
  BeforeDeleteContext,
  BeforePasteContext,
  BeforeDropContext,
  DragStartContext,
  DropGroup
} from './controller/types';
import type { PasteResult } from './clipboard';
import type { RenderStats } from './renderer/render-coordinator';

export interface TreeViewConfig<T = any> {
  // Required
  data: T[];
  idMember: string;
  pathMember: string;

  // Tree identification
  treeId?: string | null;

  // Optional member mappings
  parentPathMember?: string | null;
  levelMember?: string | null;
  isExpandedMember?: string | null;
  isSelectedMember?: string | null;
  isDraggableMember?: string | null;
  isDropAllowedMember?: string | null;
  hasChildrenMember?: string | null;
  displayValueMember?: string | null;
  /** Text shown for a node with no resolvable display value (neither
   *  `displayValueMember` nor `getDisplayValueCallback` yields one — e.g. a
   *  synthetic/dataless node). Default `'[N/A]'`; set `''` to render nothing. */
  displayValueFallback?: string | null;
  searchValueMember?: string | null;
  isSelectableMember?: string | null;
  isCollapsibleMember?: string | null;
  orderMember?: string | null;
  allowedDropPositionsMember?: string | null;

  // Behavior
  expandLevel?: number | null;
  treePathSeparator?: string | null;
  clickBehavior?: ClickBehavior | null;
  /** When true, expanding a node via the toggle UI auto-collapses its
   *  siblings. Programmatic `expandNodes` / `expandAll` are unaffected.
   *  Respects `isCollapsibleMember` / `getIsCollapsibleCallback`.
   *  Mirrors svelte-treeview rc03. */
  isAccordionExpand?: boolean | null;
  isSorted?: boolean | null;

  // Search
  shouldUseInternalSearchIndex?: boolean | null;
  indexerBatchSize?: number | null;
  indexerTimeout?: number | null;

  // Progressive rendering
  isProgressiveRender?: boolean | null;
  initialBatchSize?: number | null;
  maxBatchSize?: number | null;

  // Flat rendering
  isFlatRenderingEnabled?: boolean | null;
  flatIndentSize?: string | null;

  // Virtual scroll
  isVirtualScrollEnabled?: boolean | null;
  virtualRowHeight?: number | null;
  virtualOverscan?: number | null;
  virtualContainerHeight?: string | null;

  // Visual
  /** Per-instance theme override. Forwarded to the root `.wtv__container`
   *  as `data-theme="dark"|"light"`, which the stylesheet uses to flip the
   *  tree's colors independently of the surrounding page. Leave undefined to
   *  inherit from the page (OS preference, framework classes, etc.). */
  theme?: 'dark' | 'light' | null;
  bodyClass?: string | null;
  /** CSS class applied to every node in the highlight set (Ctrl/Shift+click). */
  highlightedNodeClass?: string | null;
  /** CSS class applied to the single focused node. */
  focusedNodeClass?: string | null;
  dragOverNodeClass?: string | null;
  /** CSS class for the dragged source row (the dimmed node left in place while its ghost
   *  follows the pointer). When set, REPLACES the built-in `.wtv__node-content--dragged`
   *  visual (opacity + left-anchored scale). Tune the default via `--wtv-dragged-opacity` /
   *  `--wtv-dragged-scale` instead of replacing it. Mirrors `highlightedNodeClass`. */
  draggedNodeClass?: string | null;
  /** Disclosure glyph set: 'chevron' (default) | 'triangle' | 'plus-minus' | 'arrow'.
   *  Re-points the --wtv-icon-* variables; see IconSet in controller/types. */
  iconSet?: 'chevron' | 'triangle' | 'plus-minus' | 'arrow' | null;
  /** @deprecated Use `iconSet`. */
  expandIconClass?: string | null;
  /** @deprecated Use `iconSet` + `toggleIconMode`. */
  collapseIconClass?: string | null;
  leafIconClass?: string | null;
  toggleIconMode?: 'rotate' | 'swap' | null;
  scrollHighlightTimeout?: number | null;
  scrollHighlightClass?: string | null;

  // Per-node icons
  iconMember?: string | null;
  iconCallback?: (node: LTreeNode<T>) => string | null;
  shouldAlignNodeIcons?: boolean | null;

  // Data-driven per-row class hooks
  /** Returns class(es) applied to the node's outer `.wtv__node` element.
   *  Recomputes per render (on the node's `data-rev` bump). */
  nodeClass?: (node: LTreeNode<T>) => string | null | undefined;
  /** Returns class(es) applied to the node's inner `.wtv__node-content`. */
  nodeContentClass?: (node: LTreeNode<T>) => string | null | undefined;

  // Bindable properties
  searchText?: string | null;
  /** Single focused node (click, arrow keys). Distinct from the multi-select
   *  highlight set. */
  focusedNode?: LTreeNode<T> | null;
  /** Multi-select highlight set (Ctrl/Shift+click). */
  highlightedPaths?: Set<string>;
  /** Checkbox / data-state selection set. When `shouldShowCheckboxes` is false,
   *  the controller mirrors `highlightedPaths` into this set. */
  selectedPaths?: Set<string>;

  // Loading
  isLoading?: boolean | null;

  // Callbacks
  getDisplayValueCallback?: (node: LTreeNode<T>) => string;
  getSearchValueCallback?: (node: LTreeNode<T>) => string;
  getIsExpandedCallback?: (node: LTreeNode<T>) => boolean;
  getIsSelectableCallback?: (node: LTreeNode<T>) => boolean;
  getIsSelectedCallback?: (node: LTreeNode<T>) => boolean;
  getIsDraggableCallback?: (node: LTreeNode<T>) => boolean;
  getIsDropAllowedCallback?: (node: LTreeNode<T>) => boolean;
  getIsCollapsibleCallback?: (node: LTreeNode<T>) => boolean;
  getAllowedDropPositionsCallback?: (node: LTreeNode<T>) => DropPosition[] | null | undefined;
  sortCallback?: (items: LTreeNode<T>[]) => LTreeNode<T>[];
  contextMenuCallback?: (node: LTreeNode<T>, closeMenuCallback: () => void) => ContextMenuEntry[];
  indexingCompleteCallback?: () => void;

  // Context Menu
  contextMenuXOffset?: number | null;
  contextMenuYOffset?: number | null;

  // Selection model (rc06+: focusedNode / highlightedPaths / selectedPaths)
  /** `'single'` (default) — Ctrl/Shift+click degrade to plain click.
   *  `'multi'` — Ctrl+click toggles, Shift+click range-extends. */
  selectionMode?: 'single' | 'multi';
  /** Render a checkbox per selectable node. Default `false`. */
  shouldShowCheckboxes?: boolean;
  /** `'independent'` (default) — checkbox state is per-node; toggling a parent
   *  does NOT cascade to descendants. `'cascade'` — toggling a parent cascades
   *  to every descendant; partial selection shows an indeterminate state on
   *  the parent. */
  checkboxMode?: 'independent' | 'cascade';
  /** Which paths the selection EMITS in cascade mode (a projection of the canonical
   *  checked set, exposed by `getSelectedPaths()` + the `selection-change` event).
   *  ONLY applies in cascade mode. `'rolled-up'` (default) — minimal cover (a
   *  fully-checked subtree collapses to its root); `'leaves'` — only checked leaf
   *  nodes; `'all'` — every fully-checked node. */
  cascadeSelectPolicy?: 'rolled-up' | 'leaves' | 'all';
  /** When `true`, plain clicks on a selectable node toggle its checkbox
   *  instead of focusing/highlighting. Requires `shouldShowCheckboxes=true`. */
  shouldClickToggleCheckbox?: boolean;
  /** Interceptor invoked before applying a checkbox toggle. Return `false`
   *  to cancel, return a `string[]` to override which paths are affected,
   *  or return `void` to apply unchanged. */
  beforeCheckboxToggleCallback?: (
    node: LTreeNode<T>,
    checked: boolean,
    affectedPaths: string[]
  ) => boolean | string[] | void;
  rangeSelectionMode?: RangeSelectionMode;
  /** Fires on changes to the checkbox / data-state selection set (selectedPaths). */
  onSelectionChange?: (ctx: SelectionChangeContext<T>) => void;
  /** Fires on changes to the highlight set (Ctrl/Shift+click, arrow keys). */
  onHighlightChange?: (ctx: SelectionChangeContext<T>) => void;

  // Debug
  shouldDisplayDebugInformation?: boolean | null;
  shouldDisplayContextMenuInDebugMode?: boolean | null;

  // Drag and Drop
  dragDropMode?: DragDropMode;
  dropZoneMode?: 'floating' | 'glow';
  dropZoneLayout?: 'around' | 'above' | 'below' | 'wave' | 'wave2';
  dropZoneStart?: number | string;
  dropZoneMaxWidth?: number;
  isCopyAllowed?: boolean;
  shouldAutoHandleCopy?: boolean;
  /** When `true` (default), drop operations with `move` semantics call
   *  `moveNode` automatically. Set to `false` to receive the `onNodeDrop`
   *  callback without mutating the tree (consumer handles the move). */
  shouldAutoHandleMove?: boolean;
  /** When `true` (default), `pasteNodes` inserts into the tree. Set to `false`
   *  to receive the cleaned entries via `PasteResult.entries` for manual placement. */
  shouldAutoHandlePaste?: boolean;

  // Event handlers (on* = fire-and-forget; each takes ONE context object)
  /** Fires on a plain node click. ctx = NodeRef of the clicked node. */
  onNodeClick?: (ctx: NodeEventContext<T>) => void;
  /** Fires on a detected node double-click. Uses manual detection (last path +
   *  timestamp, 400ms) rather than the native `dblclick`, which is unreliable
   *  under the flat diff reconciler. Fires for every `clickBehavior`. */
  onNodeDoubleClick?: (ctx: NodeEventContext<T>) => void;
  /** Interceptor before `copyNodes`. Return `false` to block, or a `string[]` to
   *  override which paths are copied. */
  beforeCopyCallback?: (ctx: BeforeCopyContext<T>) => string[] | false | void;
  /** Interceptor before `cutNodes`. Return `false` to block, or a `string[]` to
   *  override which paths are cut. */
  beforeCutCallback?: (ctx: BeforeCopyContext<T>) => string[] | false | void;
  /** Interceptor before `pasteNodes`. Return `false` to block, or `{ targetPath?,
   *  position? }` to redirect the paste target / position. */
  beforePasteCallback?: (
    ctx: BeforePasteContext<T>
  ) => { targetPath?: string; position?: DropPosition } | false | void;
  /** Narrow (return path[]) or block (false) the built-in Delete set. */
  beforeDeleteCallback?: (ctx: BeforeDeleteContext<T>) => string[] | false | void;
  /** OUTPUT (egress) transform — per-node clean/redact at snapshot time (copy/cut +
   *  the capture side of a copy-drop) before data hits the shared clipboard. */
  nodeOutputTransformationCallback?: (data: T, ctx: NodeTransformContext<T>) => T;
  /** INPUT (ingress) transform — per-node at insert time (paste + the insert side of
   *  a copy-drop); derive ids/values/names; return null to SKIP a node (+ subtree). */
  nodeInputTransformationCallback?: (data: T, ctx: NodeTransformContext<T>) => T | null;
  /** Fires after `copyNodes` succeeds. ctx = { operation:'copy', paths, nodes }. */
  onCopy?: (ctx: ClipboardEventContext<T>) => void;
  /** Fires after `cutNodes` succeeds. ctx = { operation:'cut', paths, nodes }. */
  onCut?: (ctx: ClipboardEventContext<T>) => void;
  /** Fires after `pasteNodes` succeeds, with the paste result. */
  onPaste?: (result: PasteResult<T>) => void;
  /** Fires after the built-in Delete (or `deleteNodes()`); nodes are pre-removal snapshots. */
  onDelete?: (ctx: ClipboardEventContext<T>) => void;
  onNodeDragStart?: (ctx: NodeDragContext<T>) => void;
  onNodeDragOver?: (ctx: NodeDragContext<T>) => void;
  /** Intercept — modify/block/route a drop. `false` blocks, `{ position?, operation? }`
   *  redirects, a `DropGroup[]` fans it out to several destinations, `void` proceeds.
   *  Async-capable. (Migrated rc13 from its 5-arg positional form.) */
  beforeDropCallback?: (
    ctx: BeforeDropContext<T>
  ) =>
    | boolean
    | { position?: DropPosition; operation?: DropOperation }
    | DropGroup[]
    | void
    | Promise<
        | boolean
        | { position?: DropPosition; operation?: DropOperation }
        | DropGroup[]
        | void
      >;
  onNodeDrop?: (ctx: NodeDropContext<T>) => void;
  /** Source-side blocked-action event — a locked node was long-pressed / an
   *  undraggable drag was attempted. Fires the `node-drag-denied` DOM event. */
  onNodeDragDenied?: (ctx: NodeEventContext<T>) => void;
  /** Target-side blocked-action event — a drop was rejected because the target
   *  refuses it. Fires the `node-drop-denied` DOM event. */
  onNodeDropDenied?: (ctx: NodeEventContext<T>) => void;
  /** Set-level PRE-drag interceptor: prune/augment/veto the dragged set. Return a
   *  `string[]` manifest (landing order), `false` to cancel, or `void` for default. */
  beforeDragStartCallback?: (ctx: DragStartContext<T>) => string[] | false | void;
  /** Interceptor — return `true` to suppress default + built-in shortcuts. Runs first. */
  onTreeKeydown?: (ctx: TreeKeydownContext<T>) => boolean | void;
  /** Opt out of the built-in Ctrl/Cmd+C/X/V + Delete + Esc shortcuts. Default `true`. */
  shouldHandleKeyboardShortcuts?: boolean;
  /** Long-press hold (ms) before a touch-drag engages. Default `300`. */
  touchDragDelay?: number | null;
  /** Built-in "can't move/drop this" feedback (🚫 badge + haptic). Default `true`. */
  shouldIndicateUndraggable?: boolean | null;
  /** Make the whole populated tree ONE drop target: a drop anywhere lands with
   *  `target = null` regardless of per-node `getIsDropAllowedCallback`. Default `false`. */
  shouldEnableTreeDropZone?: boolean | null;

  // Render callbacks
  renderStartCallback?: () => void;
  renderProgressCallback?: (stats: RenderStats) => void;
  renderCompleteCallback?: (stats: RenderStats) => void;

  // Render callbacks (for DomRenderer)
  renderNodeCallback?: (node: LTreeNode<T>, container: HTMLElement) => void;
  renderEmptyStateCallback?: (container: HTMLElement) => void;
  /** Fallback text for an empty tree when no renderEmptyStateCallback is given. Default "No data". */
  noDataText?: string | null;
  renderEmptyZoneCallback?: (container: HTMLElement) => void;
  /** Keep the empty drop zone visible whenever the tree is empty (not only during a
   *  drag), and focus it on hover/pointerdown so a Ctrl/Cmd+V pastes into an empty tree. */
  shouldShowDropPlaceholderWhenEmpty?: boolean | null;
  renderLoadingCallback?: (container: HTMLElement) => void;
  renderHeaderCallback?: (container: HTMLElement) => void;
  renderFooterCallback?: (container: HTMLElement) => void;
  renderContextMenuCallback?: (node: LTreeNode<T>, close: () => void, container: HTMLElement) => void;
  renderContextMenuItemCallback?: (item: ContextMenuItem, node: LTreeNode<T>, container: HTMLElement) => void;
}

// ── Methods ────────────────────────────────────────────────────────────

export interface TreeViewMethods<T = any> {
  expandNodes(
    nodePath: string | string[],
    options?: { exclusive?: boolean; noEmit?: boolean }
  ): void;
  collapseNodes(
    nodePath: string | string[],
    options?: { noEmit?: boolean }
  ): void;
  toggleNodeExpanded(path: string): void;
  expandAll(
    nodePath?: string | string[] | null,
    options?: { exclusive?: boolean; noEmit?: boolean }
  ): void;
  collapseAll(
    nodePath?: string | string[] | null,
    options?: { noEmit?: boolean }
  ): void;
  filterNodes(searchText: string): void;
  searchNodes(searchText: string | null): LTreeNode<T>[];
  scrollToPath(path: string, options?: ScrollToPathOptions): Promise<boolean>;
  closeContextMenu(): void;
  update(props: Partial<TreeViewConfig<T>>): void;
  getTree(): import('./ltree/types').Ltree<T>;

  // Bulk operations
  insertBranch(parentPath: string, data: T[]): { success: boolean; count: number; error?: string };
  replaceBranch(parentPath: string, data: T[]): { success: boolean; removed: number; added: number; error?: string };
  deleteBranch(path: string, keepParent?: boolean): { success: boolean; count: number; error?: string };

  // Highlight set (UI multi-select — Ctrl/Shift+click)
  highlightNode(path: string, mode?: HighlightMode, options?: TreeMutationOptions): void;
  highlightNodes(paths: string[], options?: TreeMutationOptions): void;
  setHighlightedPaths(paths: string[], options?: TreeMutationOptions): void;
  highlightAll(options?: TreeMutationOptions): void;
  clearHighlight(paths?: string[], options?: TreeMutationOptions): void;
  getHighlightedNodes(): LTreeNode<T>[];
  getHighlightedPaths(): Set<string>;
  isNodeHighlighted(path: string): boolean;

  // Selection set (checkbox / data state)
  selectNode(path: string, options?: TreeMutationOptions): void;
  selectNodes(paths: string[], options?: TreeMutationOptions): void;
  setSelectedPaths(paths: string[], options?: TreeMutationOptions): void;
  selectAll(options?: TreeMutationOptions): void;
  deselectNode(path: string, options?: TreeMutationOptions): void;
  clearSelection(paths?: string[], options?: TreeMutationOptions): void;
  getSelectedNodes(): LTreeNode<T>[];
  getSelectedPaths(): Set<string>;
  isNodeSelected(path: string): boolean;

  // Focus (single cursor)
  focusNode(path: string, options?: TreeMutationOptions): void;
  clearFocus(options?: TreeMutationOptions): void;

  // Navigation
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

  // Clipboard
  copyNodes(paths?: string[]): void;
  cutNodes(paths?: string[]): void;
  pasteNodes(
    targetPath: string,
    transformData?: ((data: T, ctx: NodeTransformContext<T>) => T | null) | null,
    position?: DropPosition
  ): PasteResult<T>;
  cancelCut(): void;
  hasClipboardContent(): boolean;
  getClipboardOperation(): 'copy' | 'cut' | null;

  // Delete (default = current selection). Fires beforeDeleteCallback + onDelete.
  deleteNodes(paths?: string[]): { removed: number; blocked: number };

  destroy(): void;
}

// ── Events ─────────────────────────────────────────────────────────────

// DOM CustomEvent details mirror the ctx object each on* callback receives — so
// `event.detail` IS the NodeRef / NodeDropContext / SelectionChangeContext / etc.
export interface TreeEventMap<T = any> {
  'node-clicked': CustomEvent<NodeEventContext<T>>;
  'node-double-click': CustomEvent<NodeEventContext<T>>;
  'copy': CustomEvent<ClipboardEventContext<T>>;
  'cut': CustomEvent<ClipboardEventContext<T>>;
  'paste': CustomEvent<{ result: PasteResult<T> }>;
  'delete': CustomEvent<ClipboardEventContext<T>>;
  'node-drag-start': CustomEvent<NodeDragContext<T>>;
  'node-drag-over': CustomEvent<NodeDragContext<T>>;
  'node-drop': CustomEvent<NodeDropContext<T>>;
  'node-drag-denied': CustomEvent<NodeEventContext<T>>;
  'node-drop-denied': CustomEvent<NodeEventContext<T>>;
  'data-changed': CustomEvent<{ data: T[] }>;
  'focused-node-changed': CustomEvent<{ focusedNode: LTreeNode<T> | null }>;
  'search-text-changed': CustomEvent<{ searchText: string }>;
  'highlight-change': CustomEvent<SelectionChangeContext<T>>;
  'selection-change': CustomEvent<SelectionChangeContext<T>>;
  'tree-changed': CustomEvent<void>;
}

// ── Scroll Options ─────────────────────────────────────────────────────

export interface ScrollToPathOptions {
  behavior?: ScrollBehavior;
  block?: ScrollLogicalPosition;
  inline?: ScrollLogicalPosition;
  expand?: boolean;
  expandTarget?: boolean;
  highlight?: boolean;
  scrollOptions?: ScrollIntoViewOptions;
  containerScroll?: boolean;
  containerElement?: HTMLElement;
}
