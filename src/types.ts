import type { TreeViewLabels } from './labels';
// Re-export core types from LTree engine
export type { LTreeNode as TreeNode, LTreeNode, NodeId, DropPosition } from './ltree/ltree-node';
export { VisualState } from './ltree/ltree-node';
export type {
  Ltree,
  InsertArrayResult,
  InsertBranchResult,
  ReplaceBranchResult,
  TreeChange,
  ApplyChangesResult,
  DragDropMode,
  DropZoneLayout,
  DropOperation
} from './ltree/types';

// The interaction model: controller facade, callback contexts, menu items, event details.
export type {
  TreeViewController,
  TreeViewContext,
  NodeContext,
  SortContext,
  NodeRenderCallbackContext,
  IconRenderContext,
  ContainerRenderContext,
  TreeMenuContext,
  TreeViewAction,
  TreeMenuItem,
  TreeMenuEntry,
  ContextMenuRenderContext,
  ContextMenuItemRenderContext,
  TreeViewActionEventDetail,
  BeforeCheckboxToggleContext,
  KeydownContext,
  BeforeExpandContext,
  NodeTransformCallbackContext,
  NodeTransformCallback,
  BeforeCopyCallbackContext,
  BeforeDeleteCallbackContext,
  BeforePasteCallbackContext,
  BeforeDropCallbackContext,
  BeforeDragStartContext,
  NodeEventDetail,
  NodeDragEventDetail,
  NodeDropEventDetail,
  NodeClipboardEventDetail,
  NodePasteEventDetail,
  SelectionChangeEventDetail,
  FocusChangeEventDetail,
  ExpandedChangeEventDetail,
  NodesReorderEventDetail,
  TreeEventDetail,
  RenderStartEventDetail,
  RenderStatsEventDetail,
  ContainerResizeEventDetail,
} from './interaction';

// Re-export controller types
export type {
  NodeCallbacks,
  NodeConfig,
  ClickBehavior,
  CheckboxMode,
  CascadeCheckPolicy,
  SelectionModifiers,
  RangeSelectionMode,
  SelectMode,
  TreeMutationOptions,
  TreeEngineConfig,
  TreeEngineSnapshot,
  TreeEngineEvents,
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
  DropGroup,
  NodeRenderContext
} from './controller/types';

// Re-export clipboard types
export type { ClipboardEntry, TreeClipboard, ClipboardOperation, PasteResult } from './clipboard';

// Re-export navigation types
export type { TreeNavigation, TreeNavigationOverrides } from './navigation';

// Re-export renderer types
export type { TreeViewRenderer, RendererConfig, NodeTitleOverflow, ContainerSize } from './renderer/types';
export type { RenderCoordinator, RenderStats, RenderCoordinatorCallbacks } from './renderer/render-coordinator';

// ── Configuration ──────────────────────────────────────────────────────

import type { LTreeNode } from './ltree/ltree-node';
import type { DropPosition } from './ltree/ltree-node';
import type { DragDropMode, DropOperation, ExpandOptions, SortOptions, InsertBranchResult, ReplaceBranchResult } from './ltree/types';
import type {
  ClickBehavior,
  RangeSelectionMode,
  SelectMode,
  TreeMutationOptions,
  DropGroup,
} from './controller/types';
import type { PasteResult } from './clipboard';
import type { TreeNavigationOverrides } from './navigation';
import type { NodeTitleOverflow, ContainerSize } from './renderer/types';
import type { SearchOptions } from 'flexsearch';
import type {
  TreeViewController,
  NodeContext,
  SortContext,
  NodeRenderCallbackContext,
  IconRenderContext,
  ContainerRenderContext,
  TreeMenuContext,
  TreeMenuEntry,
  ContextMenuRenderContext,
  ContextMenuItemRenderContext,
  TreeViewActionEventDetail,
  BeforeCheckboxToggleContext,
  KeydownContext,
  BeforeExpandContext,
  NodeTransformCallbackContext,
  NodeTransformCallback,
  BeforeCopyCallbackContext,
  BeforeDeleteCallbackContext,
  BeforePasteCallbackContext,
  BeforeDropCallbackContext,
  BeforeDragStartContext,
  NodeEventDetail,
  NodeDragEventDetail,
  NodeDropEventDetail,
  NodeClipboardEventDetail,
  NodePasteEventDetail,
  SelectionChangeEventDetail,
  FocusChangeEventDetail,
  ExpandedChangeEventDetail,
  NodesReorderEventDetail,
  TreeEventDetail,
  RenderStartEventDetail,
  RenderStatsEventDetail,
  ContainerResizeEventDetail,
} from './interaction';

export interface TreeViewConfig<T = any> {
  // Required
  /** The node objects to render (input). Read back (`el.nodes` / `controller.nodes`) it is
   *  the current state — every node's data in tree order, mutations included. */
  nodes: T[];
  idMember: string;
  pathMember: string;

  // Tree identification
  treeId?: string | null;

  // Optional member mappings
  parentPathMember?: string | null;
  levelMember?: string | null;
  isExpandedMember?: string | null;
  isCheckedMember?: string | null;
  isDraggableMember?: string | null;
  isDropAllowedMember?: string | null;
  hasChildrenMember?: string | null;
  displayValueMember?: string | null;
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
  shouldExpandAsAccordion?: boolean | null;
  /** Performance hint: the input is already in insert order (parents before
   *  children, siblings in display order) — `data` / addBranch skip sorting the
   *  input (no depth sort, no `sortCallback`). addBranch still re-sorts each
   *  affected parent's children, since the hint covers the batch, not the existing
   *  tree. A child listed before its parent is dropped as an orphan
   *  (`insertResult.failed`) — caller's responsibility. */
  isSorted?: boolean | null;
  /** `false` = never auto-sort: the input order is kept, `addNode` appends, `insertNode` /
   *  `insertBranch` / `moveNode` / drop keep the exact position (with `orderMember` the order
   *  values are still computed between the neighbours, for persistence). `sortNodes` /
   *  `sortAll` still sort. Switching it back on re-sorts the whole tree. Default `true`. */
  isSortingEnabled?: boolean | null;

  // Search
  /** Build the internal FlexSearch index (needed by `filterNodes` / `searchNodes` / `searchTerm`). Default `true`. */
  shouldUseInternalSearchIndex?: boolean | null;
  /** Factory for a custom FlexSearch `Index` (tokenizer, charset, …) used instead of the
   *  built-in one. JS only; a change rebuilds the index. */
  initializeIndexCallback?: (() => import('flexsearch').Index) | null;
  indexerBatchSize?: number | null;
  indexerTimeout?: number | null;

  // Progressive rendering
  isProgressiveRenderEnabled?: boolean | null;
  initialBatchSize?: number | null;
  maxBatchSize?: number | null;

  // Flat rendering
  isFlatRenderingEnabled?: boolean | null;
  flatIndentSize?: string | null;

  // Virtual scroll
  isVirtualScrollEnabled?: boolean | null;
  virtualScrollItemHeight?: number | null;
  virtualScrollOverscan?: number | null;
  virtualScrollContainerHeight?: string | null;

  // Visual
  /** Per-instance theme override. Forwarded to the root `.wtv__container`
   *  as `data-theme="dark"|"light"`, which the stylesheet uses to flip the
   *  tree's colors independently of the surrounding page. Leave undefined to
   *  inherit from the page (OS preference, framework classes, etc.). */
  theme?: 'dark' | 'light' | null;
  bodyClass?: string | null;
  /** CSS class applied to every node in the selected set (Ctrl/Shift+click). */
  selectedNodeClass?: string | null;
  /** CSS class applied to the single focused node. */
  focusedNodeClass?: string | null;
  /** CSS class applied to every checked (checkedPaths) node — the checkbox is the
   *  default signal, this is opt-in extra styling for checked rows. */
  checkedNodeClass?: string | null;
  dragOverNodeClass?: string | null;
  /** CSS class for the dragged source row (the dimmed node left in place while its ghost
   *  follows the pointer). When set, REPLACES the built-in `.wtv__node-content--dragged`
   *  visual (opacity + left-anchored scale). Tune the default via `--wtv-dragged-opacity` /
   *  `--wtv-dragged-scale` instead of replacing it. Mirrors `selectedNodeClass`. */
  draggedNodeClass?: string | null;
  /** Enable hover/focus tooltips on node rows (the direct analog of web-multiselect's
   *  option tooltips). Content from `getNodeTooltipCallback`; no content ⇒ no tooltip.
   *  Portaled + Floating-UI positioned (shared core createTooltip), themed via
   *  `--base-tooltip-*`. Parity with svelte-treeview's `isNodeTooltipsShown`. */
  isNodeTooltipsShown?: boolean;
  /** Tooltip content for a node — plain text OR a built `HTMLElement` for rich content
   *  (the wtv analog of svelte-treeview's `tooltip` snippet). Return null/empty to skip. */
  getNodeTooltipCallback?: (ctx: NodeContext<T>) => string | HTMLElement | null | undefined;
  /** Tooltip placement relative to the row. Default `'top-start'`. */
  tooltipPlacement?:
    | 'top' | 'top-start' | 'top-end'
    | 'right' | 'right-start' | 'right-end'
    | 'bottom' | 'bottom-start' | 'bottom-end'
    | 'left' | 'left-start' | 'left-end'
    | null;
  /** Show/hide delay(s), ms. Default `{ show: 400, hide: 100 }`. */
  tooltipDelay?: number | { show?: number; hide?: number } | null;
  /** Gap from the row (or cursor), px. Default `8`. */
  tooltipOffset?: number | null;
  /** Anchor the tooltip to the pointer instead of the row. Default `false`. */
  shouldTooltipFollowCursor?: boolean | null;
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
  /** A too-long built-in label: `wrap` (multi-line), `ellipsis` (single-line clip, the
   *  default) or `info` (ellipsis + a trailing info button on clipped rows revealing the
   *  full label). */
  nodeTitleOverflow?: NodeTitleOverflow | null;

  // Per-node icons — rendered as a dedicated .wtv__node-icon element on EVERY node
  // (branch + leaf). VALUE from iconMember/getIconCallback (default <i class={value}>,
  // FontAwesome-friendly); override the render with renderIconCallback. COLOR from
  // iconColorMember/getIconColorCallback. shouldAlignNodeIcons reserves the icon column.
  iconMember?: string | null;
  getIconCallback?: (ctx: NodeContext<T>) => string | null;
  /** Per-node icon COLOR from a data key (applied to the icon element). */
  iconColorMember?: string | null;
  /** Per-node icon COLOR from a callback (overrides iconColorMember). */
  getIconColorCallback?: (ctx: NodeContext<T>) => string | null;
  /** Custom per-node icon renderer: populate `ctx.iconElement` (inline SVG, unicode, custom
   *  markup) from `ctx.node` / `ctx.value` (the resolved icon value) / the render state
   *  (device + container + live node state). Wins over the default class-based `<i>`. */
  renderIconCallback?: (ctx: IconRenderContext<T>) => void;
  shouldAlignNodeIcons?: boolean | null;

  // Data-driven per-row class hooks
  /** Returns class(es) applied to the node's outer `.wtv__node` element.
   *  Recomputes per render (on the node's `data-rev` bump). */
  getNodeClassCallback?: (ctx: NodeContext<T>) => string | null | undefined;
  /** Returns class(es) applied to the node's inner `.wtv__node-content`. */
  getNodeContentClassCallback?: (ctx: NodeContext<T>) => string | null | undefined;

  // Bindable properties
  searchTerm?: string | null;
  /** Single focused node (click, arrow keys). Distinct from the multi-select
   *  selected set. */
  focusedNode?: LTreeNode<T> | null;
  /** Multi-select selected set (Ctrl/Shift+click). */
  selectedPaths?: string[];
  /** Checkbox / data-state checked set. When `isCheckboxesShown` is false,
   *  the controller mirrors `selectedPaths` into this set. */
  checkedPaths?: string[];

  // Loading
  isLoading?: boolean | null;

  // Callbacks — every one takes ONE ctx (`ctx.node` for the per-node ones)
  getDisplayValueCallback?: (ctx: NodeContext<T>) => string;
  getSearchValueCallback?: (ctx: NodeContext<T>) => string;
  getIsExpandedCallback?: (ctx: NodeContext<T>) => boolean;
  getIsSelectableCallback?: (ctx: NodeContext<T>) => boolean;
  getIsCheckedCallback?: (ctx: NodeContext<T>) => boolean;
  getIsDraggableCallback?: (ctx: NodeContext<T>) => boolean;
  getIsDropAllowedCallback?: (ctx: NodeContext<T>) => boolean;
  getIsCollapsibleCallback?: (ctx: NodeContext<T>) => boolean;
  getAllowedDropPositionsCallback?: (ctx: NodeContext<T>) => DropPosition[] | null | undefined;
  /** Orders the children of ONE parent: `ctx.nodes` are siblings; return them in
   *  the new order. Without it siblings go by `orderMember`, then display value.
   *  Insert order (parents first) is handled internally; not called on the input under
   *  `isSorted` (still used by the per-parent re-sorts). */
  sortCallback?: (ctx: SortContext<T>) => LTreeNode<T>[];
  /**
   * The context-menu entries for the node right-clicked (`ctx.node`, with `parent` /
   * `siblings`): core action items (`{ id, text, icon, shortcut, onClick(detail) }`,
   * `get*Callback(ctx)`, `children` / `getChildrenCallback`), `menuDivider(text?)`, or a
   * built-in name (`'copy' | 'cut' | 'paste' | 'delete' | 'expand' | 'collapse' | 'expand-subtree' | 'collapse-subtree' | 'expand-all' | 'collapse-all'`). Every
   * activation fires the `action` event.
   */
  getContextMenuItemsCallback?: (ctx: TreeMenuContext<T>) => TreeMenuEntry<T>[];
  /** Runs before a context-menu item activates: return `false` to cancel its `onClick`, the `action` event and the built-in. May be async. */
  beforeActionCallback?: (detail: TreeViewActionEventDetail<T>) => void | false | Promise<void | false>;

  // Context Menu
  contextMenuXOffset?: number | null;
  contextMenuYOffset?: number | null;

  // Selection model (rc06+: focusedNode / selectedPaths / checkedPaths)
  /** `'single'` (default) — Ctrl/Shift+click degrade to plain click.
   *  `'multiple'` — Ctrl+click toggles, Shift+click range-extends. */
  selectionMode?: 'single' | 'multiple';
  /** Replace individual keyboard-navigation methods — merged over the defaults
   *  (`{ ...defaults, ...navigationOverrides }`), so a method you leave out keeps its
   *  built-in behavior. Keys: navTo, navNext, navPrev, navNextSibling, navPrevSibling,
   *  navInto, navOut, navBackOut, navToggle, navFirst, navLast, navPageDown, navPageUp,
   *  navSelectNext, navSelectPrev, navSelectFirst, navSelectLast, navSelectPageDown,
   *  navSelectPageUp. Reassign to swap at runtime; `null` restores the defaults. */
  navigationOverrides?: TreeNavigationOverrides<T> | null;
  /** Render a checkbox per selectable node. Default `false`. */
  isCheckboxesShown?: boolean;
  /** `'independent'` (default) — checkbox state is per-node; toggling a parent
   *  does NOT cascade to descendants. `'cascade'` — toggling a parent cascades
   *  to every descendant; a partially checked subtree shows an indeterminate state on
   *  the parent. */
  checkboxMode?: 'independent' | 'cascade';
  /** Which paths the selection EMITS in cascade mode (a projection of the canonical
   *  checked set, exposed by `checkedPaths` + the `checked-change` event).
   *  ONLY applies in cascade mode. `'rolled-up'` (default) — minimal cover (a
   *  fully-checked subtree collapses to its root); `'leaves'` — only checked leaf
   *  nodes; `'all'` — every fully-checked node. */
  cascadeCheckPolicy?: 'rolled-up' | 'leaves' | 'all';
  /** When `true`, plain clicks on a selectable node toggle its checkbox
   *  instead of focusing/selecting. Requires `isCheckboxesShown=true`. */
  shouldClickToggleCheckbox?: boolean;
  /** Runs before a checkbox toggle (`ctx.node`, `ctx.isChecked` = the new state,
   *  `ctx.affectedPaths`). Return `false` to cancel, a `string[]` to override which paths
   *  are affected, or nothing to apply unchanged. */
  beforeCheckboxToggleCallback?: (ctx: BeforeCheckboxToggleContext<T>) => string[] | false | void;
  rangeSelectionMode?: RangeSelectionMode;
  /** Twin of `checked-change` (engine use; on the element assign `el.onCheckedChange`). */
  onCheckedChange?: (detail: SelectionChangeEventDetail<T>) => void;
  /** Twin of `selection-change`. */
  onSelectionChange?: (detail: SelectionChangeEventDetail<T>) => void;

  // Drag and Drop
  dragDropMode?: DragDropMode;
  dropZoneMode?: 'floating' | 'glow';
  dropZoneLayout?: 'around' | 'before' | 'after' | 'wave' | 'wave2';
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

  // Event twins (engine use — on the element, core installs them from the event table).
  // Each gets the event detail (the data + controller / element).
  /** Twin of `node-click`: the clicked node with parent + siblings. */
  onNodeClick?: (detail: NodeEventDetail<T>) => void;
  /** Twin of `node-double-click`. Uses manual detection (last path + timestamp, 400ms)
   *  rather than the native `dblclick`, which is unreliable under the flat diff
   *  reconciler. Fires for every `clickBehavior`. */
  onNodeDoubleClick?: (detail: NodeEventDetail<T>) => void;
  /** Twin of `node-expand` — a node actually expanded (UI, keyboard, `expandNodes`; not
   *  `expandAll` / expand-level seeding, which only fire `tree-change`). */
  onNodeExpand?: (detail: NodeEventDetail<T>) => void;
  /** Twin of `node-collapse` — a node actually collapsed (UI, keyboard, `collapseNodes`,
   *  an accordion sibling; not `collapseAll`). */
  onNodeCollapse?: (detail: NodeEventDetail<T>) => void;
  /** Runs before a node expands via the toggle, the keyboard or `expandNodes()` (not
   *  `expandAll()`, expand-level seeding or accordion side-effects). Return `false` to keep
   *  it collapsed. Return a Promise (e.g. load + `addBranch` the children) to defer the
   *  expand: the node shows a loading state and ignores repeat toggles until it settles;
   *  resolving `false` or rejecting (warned) keeps it collapsed. A sync hook stays sync. */
  beforeExpandCallback?: (ctx: BeforeExpandContext<T>) => boolean | void | Promise<boolean | void>;
  /** Runs before `copyNodes` (synchronous). Return `false` to block, or a `string[]` to
   *  override which paths are copied. */
  beforeCopyCallback?: (ctx: BeforeCopyCallbackContext<T>) => string[] | false | void;
  /** Runs before `cutNodes` (synchronous). Return `false` to block, or a `string[]` to
   *  override which paths are cut. */
  beforeCutCallback?: (ctx: BeforeCopyCallbackContext<T>) => string[] | false | void;
  /** Runs before `pasteNodes` (synchronous). Return `false` to block (no `node-paste`
   *  event), or `{ targetPath?, position? }` to redirect the paste target / position. */
  beforePasteCallback?: (
    ctx: BeforePasteCallbackContext<T>
  ) => { targetPath?: string; position?: DropPosition } | false | void;
  /** Runs before the user Delete command (Delete key / context-menu `delete`; synchronous): narrow (return path[]) or block (false). */
  beforeDeleteCallback?: (ctx: BeforeDeleteCallbackContext<T>) => string[] | false | void;
  /** OUTPUT (egress) transform — per-node clean/redact at snapshot time (copy/cut +
   *  the capture side of a copy-drop) before data hits the shared clipboard. `ctx.data`
   *  is the snapshot; return the cleaned data. */
  nodeOutputTransformationCallback?: (ctx: NodeTransformCallbackContext<T>) => T;
  /** INPUT (ingress) transform — per-node at insert time (paste + the insert side of
   *  a copy-drop); derive ids/values/names from `ctx.data`; return null to SKIP a node (+ subtree). */
  nodeInputTransformationCallback?: NodeTransformCallback<T>;
  /** Twin of `node-copy`: `{ operation: 'copy', paths, nodes }`. */
  onNodeCopy?: (detail: NodeClipboardEventDetail<T>) => void;
  /** Twin of `node-cut`. */
  onNodeCut?: (detail: NodeClipboardEventDetail<T>) => void;
  /** Twin of `node-paste`: the paste result. */
  onNodePaste?: (detail: NodePasteEventDetail<T>) => void;
  /** Twin of `node-delete`; nodes are pre-removal snapshots. */
  onNodeDelete?: (detail: NodeClipboardEventDetail<T>) => void;
  onNodeDragStart?: (detail: NodeDragEventDetail<T>) => void;
  onNodeDragOver?: (detail: NodeDragEventDetail<T>) => void;
  /** Intercept — modify/block/route a drop. `false` blocks, `{ position?, operation? }`
   *  redirects, a `DropGroup[]` fans it out to several destinations, nothing proceeds.
   *  Async-capable. */
  beforeDropCallback?: (
    ctx: BeforeDropCallbackContext<T>
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
  onNodeDrop?: (detail: NodeDropEventDetail<T>) => void;
  /** Twin of `node-drag-reject` — source side: a locked node was long-pressed / an
   *  undraggable drag was attempted. */
  onNodeDragReject?: (detail: NodeEventDetail<T>) => void;
  /** Twin of `node-drop-reject` — target side: a drop was rejected because the target refuses it. */
  onNodeDropReject?: (detail: NodeEventDetail<T>) => void;
  /** Set-level PRE-drag interceptor (synchronous — dragstart needs the answer now):
   *  prune/augment/veto the dragged set. Return a `string[]` manifest (landing order),
   *  `false` to cancel, or nothing for the default. */
  beforeDragStartCallback?: (ctx: BeforeDragStartContext<T>) => string[] | false | void;
  /** Runs before the built-in keyboard handling (synchronous). Return `false` to
   *  suppress the default + built-in shortcuts for this key. */
  beforeKeydownCallback?: (ctx: KeydownContext<T>) => void | false;
  /** Twin of `action` (a context-menu item was activated). */
  onAction?: (detail: TreeViewActionEventDetail<T>) => void;
  /** Twin of `tree-change` (bulk notification after any state change). */
  onTreeChange?: (detail: TreeEventDetail<T>) => void;
  /** Twin of `focus-change`. */
  onFocusChange?: (detail: FocusChangeEventDetail<T>) => void;
  /** Twin of `expanded-change` (the expanded set changed; `detail.paths` = the whole new set). */
  onExpandedChange?: (detail: ExpandedChangeEventDetail<T>) => void;
  /** Twin of `nodes-reorder` (a sort rewrote one parent's `orderMember` values). */
  onNodesReorder?: (detail: NodesReorderEventDetail<T>) => void;
  /** Twin of `render-start` (a progressive render began). */
  onRenderStart?: (detail: RenderStartEventDetail<T>) => void;
  /** Twin of `render-progress` (`detail.pending` / `detail.processed`). */
  onRenderProgress?: (detail: RenderStatsEventDetail<T>) => void;
  /** Twin of `render-complete`. */
  onRenderComplete?: (detail: RenderStatsEventDetail<T>) => void;
  /** Twin of `container-resize` (`detail.size`, `detail.deviceClass`). */
  onContainerResize?: (detail: ContainerResizeEventDetail<T>) => void;
  /** Opt out of the built-in Ctrl/Cmd+C/X/V + Delete + Esc shortcuts. Default `true`. */
  shouldHandleKeyboardShortcuts?: boolean;
  /** Long-press hold (ms) before a touch-drag engages. Default `300`. */
  touchDragDelay?: number | null;
  /** Built-in "can't move/drop this" feedback (🚫 badge + haptic). Default `true`. */
  shouldIndicateUndraggable?: boolean | null;
  /** Make the whole populated tree ONE drop target: a drop anywhere lands with
   *  `target = null` regardless of per-node `getIsDropAllowedCallback`. Default `false`. */
  isTreeDropZoneEnabled?: boolean | null;

  // Render callbacks (for DomRenderer) — one ctx each
  /** Fill `ctx.contentElement` for `ctx.node` (render state on the ctx: device, container, isExpanded, …). */
  renderNodeCallback?: (ctx: NodeRenderCallbackContext<T>) => void;
  renderEmptyStateCallback?: (ctx: ContainerRenderContext<T>) => void;
  /** UI strings, a partial object merged per key over the English defaults (`empty`, `dropHere`, `copy`, `cut`, `paste`, `delete`, `expand`, `collapse`). */
  labels?: Partial<TreeViewLabels> | null;
  renderEmptyZoneCallback?: (ctx: ContainerRenderContext<T>) => void;
  /** Keep the empty drop zone visible whenever the tree is empty (not only during a
   *  drag), and focus it on hover/pointerdown so a Ctrl/Cmd+V pastes into an empty tree. */
  isEmptyDropPlaceholderShown?: boolean | null;
  renderLoadingCallback?: (ctx: ContainerRenderContext<T>) => void;
  renderHeaderCallback?: (ctx: ContainerRenderContext<T>) => void;
  renderFooterCallback?: (ctx: ContainerRenderContext<T>) => void;
  /** Take over the whole context menu: fill `ctx.containerElement` (close it via `ctx.controller.closeContextMenu()`). */
  renderContextMenuCallback?: (ctx: ContextMenuRenderContext<T>) => void;
  /** Fill one item's `ctx.buttonElement` (leave it empty for the default). */
  renderContextMenuItemCallback?: (ctx: ContextMenuItemRenderContext<T>) => void;

  // Context (passed by <web-treeview>; a standalone WebTreeView defaults them)
  /** The host element — `element` on every ctx / event detail. */
  hostElement?: HTMLElement;
  /** The public facade — `controller` on every ctx / event detail. */
  controller?: TreeViewController<T>;
}

// ── Methods ────────────────────────────────────────────────────────────

export interface TreeViewMethods<T = any> {
  expandNodes(
    paths: string | string[],
    options?: ExpandOptions
  ): void;
  collapseNodes(
    paths: string | string[],
    options?: ExpandOptions
  ): void;
  toggleNodeExpanded(path: string, options?: ExpandOptions): void;
  sortNodes(paths: string | string[], options?: SortOptions<T>): void;
  sortAll(paths?: string | string[] | null, options?: SortOptions<T>): void;
  expandAll(
    paths?: string | string[] | null,
    options?: ExpandOptions
  ): void;
  collapseAll(
    paths?: string | string[] | null,
    options?: ExpandOptions
  ): void;
  filterNodes(term: string, searchOptions?: SearchOptions): void;
  searchNodes(term: string | null, searchOptions?: SearchOptions): LTreeNode<T>[];
  scrollToPath(path: string, options?: ScrollToPathOptions): Promise<boolean>;
  closeContextMenu(): void;
  update(props: Partial<TreeViewConfig<T>>): void;
  getTree(): import('./ltree/types').Ltree<T>;
  refreshNode(path: string): void;
  refreshSiblings(parentPath: string): void;
  isNodeDropAllowed(path: string): boolean;
  readonly isRendering: boolean;
  readonly containerSize: ContainerSize | null;

  // Bulk operations
  addBranch(parentPath: string, data: T[]): InsertBranchResult<T>;
  insertBranch(targetPath: string, data: T[], position: DropPosition): InsertBranchResult<T>;
  replaceBranch(parentPath: string, data: T[]): ReplaceBranchResult<T>;
  removeBranch(path: string, keepParent?: boolean): { success: boolean; count: number; error?: string };

  // Selected set (UI multi-select — Ctrl/Shift+click)
  selectNode(path: string, mode?: SelectMode, options?: TreeMutationOptions): void;
  selectNodes(paths: string[], options?: TreeMutationOptions): void;
  selectAll(options?: TreeMutationOptions): void;
  clearSelection(paths?: string[], options?: TreeMutationOptions): void;
  getSelectedNodes(): LTreeNode<T>[];
  selectedPaths: string[];
  isNodeSelected(path: string): boolean;
  selectionAnchor: string | null;
  toggleFocusedSelect(): void;

  // Checked set (checkbox / data state)
  checkNode(path: string, options?: TreeMutationOptions): void;
  checkNodes(paths: string[], options?: TreeMutationOptions): void;
  checkAll(options?: TreeMutationOptions): void;
  uncheckNode(path: string, options?: TreeMutationOptions): void;
  uncheckNodes(paths: string[], options?: TreeMutationOptions): void;
  uncheckAll(options?: TreeMutationOptions): void;
  getCheckedNodes(): LTreeNode<T>[];
  checkedPaths: string[];
  isNodeChecked(path: string): boolean;

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
  navPageDown(): void;
  navPageUp(): void;
  navSelectNext(): void;
  navSelectPrev(): void;
  navSelectFirst(): void;
  navSelectLast(): void;
  navSelectPageDown(): void;
  navSelectPageUp(): void;

  // Clipboard
  copyNodes(paths?: string[]): void;
  cutNodes(paths?: string[]): void;
  pasteNodes(
    targetPath: string,
    transform?: NodeTransformCallback<T> | null,
    position?: DropPosition
  ): PasteResult<T>;
  cancelCut(): void;
  hasClipboardContent(): boolean;
  getClipboardOperation(): 'copy' | 'cut' | null;

  // Delete (default = current selection). Fires beforeDeleteCallback + onDelete.
  removeNodes(paths: string[]): { removed: number; failed: number };

  destroy(): void;
}

// ── Events ─────────────────────────────────────────────────────────────

// Each event's detail is the same object its `on*` twin receives, with `controller` /
// `element` attached (non-enumerable).
export interface TreeEventMap<T = any> {
  'node-click': CustomEvent<NodeEventDetail<T>>;
  'node-double-click': CustomEvent<NodeEventDetail<T>>;
  'node-expand': CustomEvent<NodeEventDetail<T>>;
  'node-collapse': CustomEvent<NodeEventDetail<T>>;
  'node-copy': CustomEvent<NodeClipboardEventDetail<T>>;
  'node-cut': CustomEvent<NodeClipboardEventDetail<T>>;
  'node-paste': CustomEvent<NodePasteEventDetail<T>>;
  'node-delete': CustomEvent<NodeClipboardEventDetail<T>>;
  'node-drag-start': CustomEvent<NodeDragEventDetail<T>>;
  'node-drag-over': CustomEvent<NodeDragEventDetail<T>>;
  'node-drop': CustomEvent<NodeDropEventDetail<T>>;
  'node-drag-reject': CustomEvent<NodeEventDetail<T>>;
  'node-drop-reject': CustomEvent<NodeEventDetail<T>>;
  'selection-change': CustomEvent<SelectionChangeEventDetail<T>>;
  'checked-change': CustomEvent<SelectionChangeEventDetail<T>>;
  'focus-change': CustomEvent<FocusChangeEventDetail<T>>;
  'expanded-change': CustomEvent<ExpandedChangeEventDetail<T>>;
  'nodes-reorder': CustomEvent<NodesReorderEventDetail<T>>;
  'tree-change': CustomEvent<TreeEventDetail<T>>;
  'action': CustomEvent<TreeViewActionEventDetail<T>>;
  'render-start': CustomEvent<RenderStartEventDetail<T>>;
  'render-progress': CustomEvent<RenderStatsEventDetail<T>>;
  'render-complete': CustomEvent<RenderStatsEventDetail<T>>;
  'container-resize': CustomEvent<ContainerResizeEventDetail<T>>;
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
