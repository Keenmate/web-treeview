/**
 * TreeViewState — all tree state & logic, headless: data, expand / select / check / focus, search,
 * keyboard, clipboard, drag-and-drop. Public: every `TreeViewRenderer` gets it in `mount()`, and a fully
 * custom UI can drive one directly (`new TreeViewState({ data, … })`, docs/usage.md "Build your own UI").
 * Its callbacks keep their positional signatures (`TreeViewEngine` adapts the element's one-ctx ones).
 * Ported from TreeEngine.svelte.ts to vanilla TypeScript.
 *
 * Svelte → vanilla conversions:
 *   $state<X>        → plain property + _scheduleNotify()
 *   $state.raw<X>    → plain property + _scheduleNotify()
 *   $derived(expr)   → getter
 *   $effect(fn)      → explicit call from the setter that drives it
 *   tick()           → queueMicrotask()
 */

import type { Index, SearchOptions } from 'flexsearch';
import { type LTreeNode, VisualState } from '../ltree/ltree-node';
import { createLTree } from '../ltree/ltree';
import { DEFAULT_INDEXER_BATCH_SIZE } from '../ltree/indexer';
import {
  type Ltree,
  type InsertArrayResult,
  type InsertBranchResult,
  type ReplaceBranchResult,
  type RemoveBranchResult,
  type DropPosition,
  type DragDropMode,
  type DropOperation,
  type TreeChange,
  type ProcessChangesResult,
  type ExpandOptions,
  type SortOptions,
  type NodesSortContext,
  type FilterScope,
  type IndexProgress,
  type SearchStatus
} from '../ltree/types';
import {
  createRenderCoordinator,
  type RenderCoordinator,
  type RenderStats
} from '../renderer/render-coordinator';
import { EventEmitter } from './event-emitter';
import { withEngineDefaults } from '../inputs';
import { isTypingTarget, matchesShortcut } from '@keenmate/web-components-core/actions';
import { openTreeLayer, type TreeLayerOpener } from '../renderer/layers';
import type { Layer } from '@keenmate/web-components-core/positioning';
import { animateOut, computeVirtualRange, createSelection, findScrollContainer, isRtl, readAnimationMs, scrollContainerToBox, scrollIntoContainer, type AnimateOutHandle, type VirtualRange } from '@keenmate/web-components-core';
import type {
  NodeCallbacks,
  NodeConfig,
  SelectionModifiers,
  SelectMode,
  TreeMutationOptions,
  TreeViewStateOptions,
  TreeViewStateSnapshot,
  TreeViewStateEvents,
  NodeRef,
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
  DropGroup,
  BeforeScrollContext,
  TreeViewScrollSource,
  TreeViewScrollOptions
} from './types';
import {
  setClipboard,
  getClipboard,
  clearClipboard,
  hasClipboard as hasClipboardFn,
  getClipboardOperation as getClipboardOp,
  registerClipboardTree,
  unregisterClipboardTree,
  getClipboardTree,
  setDragSet,
  getDragSet,
  clearDragSet,
  type ClipboardEntry,
  type ClipboardOperation,
  type PasteResult
} from '../clipboard';
import { defaultTreeLoggers, type TreeLoggers } from '../logger';
import type { TreeNavigation, TreeNavigationOverrides } from '../navigation';
import { perf } from '../perf-logger';
import { rowDomId } from '../helpers/string-helpers';
import {
  bumpRev,
  getAncestorPaths,
  getDescendantPaths,
  getParentPath,
  getPathChain,
  getTopLevelPaths,
  isSelfOrDescendant,
} from '../helpers/ltree-helpers';

// ─── TreeViewState ───────────────────────────────────────────────────────

/** Rows a PageUp / PageDown (and their Shift variants) jumps in the visible flat list. */
const NAV_PAGE_SIZE = 10;

/**
 * The built-in clipboard / delete shortcuts, in core `/actions` syntax (`matchesShortcut`).
 * Ctrl AND Cmd (Meta) on every platform, plus the classic CUA aliases
 * (Ctrl+Insert copy · Shift+Delete cut · Shift+Insert paste).
 */
const TREE_SHORTCUTS = {
  copy: ['Ctrl+C', 'Meta+C', 'Ctrl+Insert'],
  cut: ['Ctrl+X', 'Meta+X', 'Shift+Delete'],
  paste: ['Ctrl+V', 'Meta+V', 'Shift+Insert'],
  delete: ['Delete'],
  cancelCut: ['Escape']
} as const satisfies Record<string, readonly string[]>;
type TreeShortcutCommand = keyof typeof TREE_SHORTCUTS;

export class TreeViewState<T> extends EventEmitter<TreeViewStateEvents<T>> {
  // ── LTree instance ──────────────────────────────────────────────────
  tree!: Ltree<T>;

  // ── Render coordinator ──────────────────────────────────────────────
  renderCoordinator!: RenderCoordinator | null;

  // ── Stable callback & config objects for renderer ───────────────────
  nodeCallbacks!: NodeCallbacks<T>;
  private _nodeConfig: NodeConfig = {
    clickBehavior: 'expand-and-focus',
    iconSet: 'chevron',
    leafIconClass: 'wtv__toggle-icon--leaf-none',
    toggleIconMode: 'rotate',
    selectedNodeClass: undefined,
    focusedNodeClass: undefined,
    checkedNodeClass: undefined,
    dragOverNodeClass: undefined,
    draggedNodeClass: undefined,
    dragDropMode: 'none',
    dropZoneMode: 'glow',
    dropZoneLayout: 'around',
    dropZoneStart: 33,
    dropZoneMaxWidth: '120px',
    isCopyAllowed: false,
    iconMember: undefined,
    iconColorMember: undefined,
    shouldAlignNodeIcons: true,
    isCheckboxesShown: false,
    isNodeTooltipsShown: false,
    getNodeTooltipCallback: undefined,
    tooltipPlacement: 'top-start',
    tooltipDelay: { show: 400, hide: 100 },
    tooltipOffset: 8,
    shouldTooltipFollowCursor: false,
    nodeClass: undefined,
    nodeContentClass: undefined
  };

  get nodeConfig(): NodeConfig { return this._nodeConfig; }

  // ── State properties ────────────────────────────────────────────────
  private _treeId: string = '';
  private _treePathSeparator: string = '.';
  private _data: T[] = [];
  private _focusedNode: LTreeNode<T> | null | undefined = null;
  private _insertResult: InsertArrayResult<T> | null | undefined = null;
  private _searchText: string | null | undefined = undefined;
  private _isRendering: boolean = false;
  /** Rows rendered in the current progressive pass (`render-progress` / `render-complete`). */
  private _renderProcessed: number = 0;

  // Behaviour
  private _isLoading: boolean = false;
  private _flatIndentSize: string = 'var(--wtv-indent-size)';
  private _isProgressiveRenderEnabled: boolean = true;
  private _initialBatchSize: number = 20;
  private _maxBatchSize: number = 500;
  // ROW ANIMATION (docs/PLAN-row-animation.md): rows an expand reveals get
  // wtv__node--opening (CSS @keyframes, timed by the motion tokens) — at most
  // maxAnimatedRowCount. No on/off property: core `motion` is the one switch (SPEC §12.16 /
  // C-NC-15); --wtv-row-animation-duration: 0s turns off just rows. The renderer adds the
  // class only to rows it CREATES while the path is in the reveal, so a reused /
  // scrolled-back row never replays.
  private _maxAnimatedRowCount = 50;
  private _revealedPaths: ReadonlySet<string> = new Set();
  private _revealGeneration = 0;
  private _revealDepth = 0;
  // Collapse half: the rows a collapse hides animate out first (core animateOut — the
  // closing class + inert + --km-exit-height), THEN the node really collapses. The handle is
  // kept per collapsing node: a re-expand cancels it, a second collapse awaits it. Rows are
  // reused by the renderer, so the class added to the live element survives re-renders.
  private _closingHandles = new Map<string, { handle: AnimateOutHandle; apply: () => void; targets: string[] }>();
  private _bodyClass: string | null | undefined = undefined;
  /** The merged options (`getOptions()`): constructor options + every `setOptions()` partial. */
  private _options!: TreeViewStateOptions<T>;
  // Current expand-to-level. Tracked on the controller because the LTree bakes
  // its expand level into a closure at construction — the only way to change it
  // is to recreate the tree, so setOptions must know the previous value to
  // detect a real change (buildConfig resends the attribute on every update).
  private _expandLevel: number | null | undefined = undefined;
  /** The indexer settings the LTree was built with (a change rebuilds it). */
  private _indexerBatchSize: number | undefined = undefined;
  private _indexerTimeout: number | undefined = undefined;

  // Drag and drop
  private _dragDropMode: DragDropMode = 'none';
  private _isCopyAllowed: boolean = false;
  private _shouldAutoHandleCopy: boolean = true;
  private _shouldAutoHandleMove: boolean = true;
  private _shouldAutoHandlePaste: boolean = true;
  // Opt out of built-in Ctrl/Cmd+C/X/V + Delete + Esc shortcuts (default on).
  private _isKeyboardShortcutsEnabled: boolean = true;
  // Read-only (`isReadonly`): the user can't change the data — the cut / paste / delete shortcuts
  // are off (copy stays). Programmatic calls are not gated.
  private _isReadonly: boolean = false;
  // Internal FlexSearch index (default on) + an optional custom index factory. Both are
  // baked into the LTree at construction — a change recreates it.
  private _isInternalSearchIndexEnabled: boolean = true;
  private _initializeIndexCallback: (() => Index) | undefined;
  // Long-press hold (ms) before a touch-drag engages (svelte-treeview rc14).
  private _touchDragDelay: number = 300;
  // Whole populated tree is one drop target — a drop anywhere lands target=null
  // regardless of per-node getIsDropAllowed (svelte-treeview rc13).
  private _shouldEnableTreeDropZone: boolean = false;
  // Built-in "can't move/drop this" feedback (🚫 badge + haptic). rc14.
  private _shouldIndicateUndraggable: boolean = true;

  // Three-level selection model (rc06+)
  // Selection = core `createSelection` (SPEC §12.27): it owns the selected keys, the Shift anchor and the
  // click / Ctrl / Shift rules. `_selectedPaths` is its read mirror (renderer snapshot, O(1) `has`),
  // re-synced by `_syncSelection()` after every write; the nodes' `isSelected` flags follow it.
  private _selectedPaths: Set<string> = new Set();
  private readonly _selection = createSelection<string>({
    mode: () => (this._selectionMode === 'multiple' ? 'multi' : 'single'),
    getOrderedKeys: () => this._selectionOrder(),
    isSelectable: (path) => this.tree?.getNodeByPath(path)?.isSelectable === true,
    onChange: () => this._onSelectionGesture(),
  });
  /** A gesture-path write (`_applySelection`) that must not emit. */
  private _isSelectionSilent = false;
  private _checkedPaths: Set<string> = new Set();
  private _rangeSelectionMode: import('./types').RangeSelectionMode = 'visual';
  private _selectionMode: 'single' | 'multiple' = 'single';
  // Keyboard navigation: the defaults merged with the consumer's navigationOverrides.
  private _navigation!: TreeNavigation<T>;
  private _navigationOverrides: TreeNavigationOverrides<T> | null = null;
  private _shouldShowCheckboxes: boolean = false;
  private _checkboxMode: import('./types').CheckboxMode = 'independent';
  // Which paths the selection EMITS in cascade mode (a projection of the canonical
  // _checkedPaths). Only applies when checkboxMode === 'cascade'. rc14.
  private _cascadeCheckPolicy: import('./types').CascadeCheckPolicy = 'rolled-up';
  private _shouldClickToggleCheckbox: boolean = false;
  private beforeCheckboxToggleCb: TreeViewStateOptions<T>['beforeCheckboxToggleCallback'];

  // Clipboard (cut paths for dimming)
  private _cutPaths: Set<string> = new Set();

  // Events / callbacks (ctx-object signatures — rc07 parity)
  private checkedChangeCb: TreeViewStateOptions<T>['onCheckedChange'];
  private selectionChangeCb: TreeViewStateOptions<T>['onSelectionChange'];
  private nodeClickedCb: TreeViewStateOptions<T>['onNodeClick'];
  private onNodeDoubleClickCb: TreeViewStateOptions<T>['onNodeDoubleClick'];
  private beforeExpandCb: TreeViewStateOptions<T>['beforeExpandCallback'];
  private nodeExpandCb: TreeViewStateOptions<T>['onNodeExpand'];
  private nodeCollapseCb: TreeViewStateOptions<T>['onNodeCollapse'];
  /** Paths whose async beforeExpandCallback is in flight (loading state; repeat toggles ignored). */
  private _expandPending = new Set<string>();
  private beforeCopyCb: TreeViewStateOptions<T>['beforeCopyCallback'];
  private beforeCutCb: TreeViewStateOptions<T>['beforeCutCallback'];
  private beforePasteCb: TreeViewStateOptions<T>['beforePasteCallback'];
  private beforeDeleteCb: TreeViewStateOptions<T>['beforeDeleteCallback'];
  private onCopyCb: TreeViewStateOptions<T>['onCopy'];
  private onCutCb: TreeViewStateOptions<T>['onCut'];
  private onPasteCb: TreeViewStateOptions<T>['onPaste'];
  private onDeleteCb: TreeViewStateOptions<T>['onDelete'];
  private outputTransformCb: TreeViewStateOptions<T>['nodeOutputTransformationCallback'];
  private inputTransformCb: TreeViewStateOptions<T>['nodeInputTransformationCallback'];
  // Manual double-click detection — the flat diff reconciler patches a row's
  // attributes on the first click (focus/selection bumps _rev), which makes the
  // browser's native dblclick unreliable. Tracks the last plain UI click.
  private _lastClickPath: string | null = null;
  private _lastClickTime: number = 0;
  private nodeDragStartCb: TreeViewStateOptions<T>['onNodeDragStart'];
  private nodeDragOverCb: TreeViewStateOptions<T>['onNodeDragOver'];
  private beforeDropCallbackCb: TreeViewStateOptions<T>['beforeDropCallback'];
  private beforeDragStartCb: TreeViewStateOptions<T>['beforeDragStartCallback'];
  private nodeDropCb: TreeViewStateOptions<T>['onNodeDrop'];
  private nodeDragDeniedCb: TreeViewStateOptions<T>['onNodeDragDenied'];
  private nodeDropDeniedCb: TreeViewStateOptions<T>['onNodeDropDenied'];
  private onTreeKeydownCb: TreeViewStateOptions<T>['onTreeKeydown'];
  private beforeScrollCb: TreeViewStateOptions<T>['beforeScrollCallback'];
  /** @internal Used by renderers to check if a callback is available */
  contextMenuCallbackCb: TreeViewStateOptions<T>['contextMenuCallback'];
  private renderStartCb: (() => void) | undefined;
  private renderProgressCb: ((stats: RenderStats) => void) | undefined;
  private renderCompleteCb: ((stats: RenderStats) => void) | undefined;
  private indexProgressCb: ((progress: IndexProgress) => void) | undefined;
  private searchStatusCb: ((status: SearchStatus) => void) | undefined;

  // Search: result limit + EXPERIMENTAL filter scope (pushed onto the ltree, see _wireTreeSearch)
  private _maxSearchResultCount: number | undefined = undefined;
  private _filterScope: FilterScope = 'matches';
  private _filterDescendantDepth = 1;
  private _shouldExpandFilterDescendants = true;
  private _indexProgress: IndexProgress | null = null;
  private _searchStatus: SearchStatus | null = null;
  // A search-status handler that itself changes the filter must not recurse into a
  // nested dispatch — the nested status is queued and delivered after the outer one.
  private _isDispatchingSearchStatus = false;
  private _pendingSearchStatus: SearchStatus | null = null;

  // Visual config
  private _clickBehavior: import('./types').ClickBehavior = 'expand-and-focus';
  private _shouldExpandAsAccordion: boolean = false;
  /** `false` = never auto-sort (input order / exact positions kept); see Ltree.isSortingEnabled. */
  private _isSortingEnabled: boolean = true;
  private _iconSet: import('./types').IconSet = 'chevron';
  private _leafIconClass: string = 'wtv__toggle-icon--leaf-none';
  private _toggleIconMode: import('./types').ToggleIconMode = 'rotate';
  private _selectedNodeClass: string | null | undefined = undefined;
  private _focusedNodeClass: string | null | undefined = undefined;
  private _checkedNodeClass: string | null | undefined = undefined;
  private _dragOverNodeClass: string | null | undefined = undefined;
  private _draggedNodeClass: string | null | undefined = undefined;
  private _shouldShowNodeTooltips: boolean = false;
  private _getNodeTooltipCallback: ((node: LTreeNode<T>) => string | HTMLElement | null | undefined) | undefined = undefined;
  private _tooltipPlacement: import('./types').TooltipPlacement = 'top-start';
  private _tooltipDelay: import('./types').TooltipDelay = { show: 400, hide: 100 };
  private _tooltipOffset: number = 8;
  private _tooltipFollowCursor: boolean = false;
  private _dropZoneMode: 'floating' | 'glow' = 'glow';
  private _dropZoneLayout: 'around' | 'before' | 'after' | 'wave' | 'wave2' = 'around';
  private _dropZoneStart: number | string = 33;
  private _dropZoneMaxWidth: string = '120px';
  private _scrollHighlightTimeout: number = 4000;
  private _scrollHighlightClass: string | null | undefined = 'wtv__node-content--scroll-highlight';
  private _contextMenuXOffset: number = 8;
  private _contextMenuYOffset: number = 0;
  private _hasContextMenuRenderer: boolean = false;

  // Per-node icons
  private _iconMember: string | null | undefined = undefined;
  private _iconCallback: ((node: LTreeNode<T>) => string | null) | undefined = undefined;
  private _iconColorMember: string | null | undefined = undefined;
  private _iconColorCallback: ((node: LTreeNode<T>) => string | null) | undefined = undefined;
  private _shouldAlignNodeIcons: boolean = true;

  // Data-driven per-row class hooks
  private _nodeClass: ((node: LTreeNode<T>) => string | null | undefined) | undefined = undefined;
  private _nodeContentClass: ((node: LTreeNode<T>) => string | null | undefined) | undefined = undefined;

  // ── Internal mutable state ──────────────────────────────────────────

  // Context menu
  private _isContextMenuOpen: boolean = false;
  private _contextMenuX: number = 0;
  private _contextMenuY: number = 0;
  private _contextMenuNode: LTreeNode<T> | null = null;

  // Scroll highlight
  private currentSelection: {
    element: HTMLElement;
    timeoutId: ReturnType<typeof setTimeout>;
  } | null = null;

  // Drag and drop state
  private _draggedNode: LTreeNode<any> | null = null;
  // Every TRAVELING path in the active drag — the complete placement manifest (lead +
  // multi-drag members + their descendants, minus any leave-behind holes) — so the dragged
  // visual dims the whole set, not just the roots. Empty when no drag is in progress.
  private _draggedPaths: string[] = [];
  private _isDragInProgress: boolean = false;
  private _hoveredNodeForDrop: LTreeNode<any> | null = null;
  private _activeDropPosition: DropPosition | null = null;
  private _currentDropOperation: DropOperation = 'move';
  // Snapshot of `selectedPaths` taken at drag start before the OS-convention sync
  // replaces it with the dragged node. Restored when the drag is cancelled or lands
  // nowhere, so the user isn't left with the dragged node "stuck" selected.
  private _preDragSelectionSnapshot: Set<string> | null = null;
  // Authoritative dragged-set manifest from beforeDragStartCallback (rc13). Null =
  // no override (use the selected set). Consulted by _draggedRefs + the multi-drag
  // move/copy. Cleared on drag end. A curated override may omit descendants (holes).
  private _dragSetOverride: string[] | null = null;

  // Pointer drag (mouse / pen / touch): the gesture (threshold / long press, scroll lock, hit
  // test, auto-scroll, Escape) is core createPointerDrag, wired by the renderer; the engine
  // keeps the tree side of it (see "Pointer drag" below).
  private _pointerDragState: {
    node: LTreeNode<any> | null;
    isDragging: boolean;
    /** A long-press landed on a NON-draggable node: we show the held 🚫 badge
     *  instead of starting a drag (core still holds the gesture, so the page stays put). */
    isDenied: boolean;
    /** The drag ghost's core layer (placed at the pointer). */
    ghostLayer: Layer | null;
  } = {
    node: null, isDragging: false, isDenied: false, ghostLayer: null
  };

  // Blocked-action ("can't move this") feedback (svelte-treeview rc14). The held
  // 🚫 badge + its row's pulse class are torn down on touch release.
  private _deniedBadgeEl: HTMLElement | null = null;
  private _deniedRowEl: HTMLElement | null = null;
  private _dropDeniedTimer: ReturnType<typeof setTimeout> | null = null;

  // Progressive flat rendering
  private flatRenderedIds: Set<string> = new Set();
  private flatRenderQueue: string[] = [];
  private flatRenderAnimationFrame: number | null = null;
  private currentBatchSize: number = 0;

  // Drop placeholder
  private _isDropPlaceholderActive: boolean = false;
  private _isArmed: boolean = false;

  // Virtual scroll
  private _isVirtualScrollEnabled: boolean = false;
  private _virtualRowHeight?: number;
  private _virtualOverscan: number = 5;
  private _virtualContainerHeight?: string;
  private _vsScrollTop: number = 0;
  private _vsMeasuredRowHeight: number | null = null;
  private _vsDetectedHeight: string | null = null;
  /** The virtual viewport's measured height (px), reported by the renderer — the window maths
   *  can't parse a CSS length such as `30rem` or `50vh` itself. */
  private _vsViewportHeight: number | null = null;

  /** updateProps rebuilt the tree and inserted `data` itself — a `data` set in the same batch
   *  must not insert it again. (Mutations no longer set it: a `data` assigned right after a
   *  move / remove used to be ignored until the next microtask.) */
  private _skipInsertArray = false;

  // Progressive flat rendering tracker
  private lastFlatNodesTracker: Symbol | undefined | null = null;

  // Container element (set by the host component for scrollToPath)
  containerElement: HTMLElement | null = null;
  /** Opens the touch ghost's core layer (set by the renderer; `<web-treeview>` adds its custom CSS). */
  layerOpener: TreeLayerOpener | null = null;
  /** Where this engine logs (the element's instance loggers when hosted). */
  log: TreeLoggers = defaultTreeLoggers;

  // ── Batched notification ────────────────────────────────────────────
  private _dirty = false;
  private _scheduleNotify() {
    if (this._dirty) return;
    this._dirty = true;
    queueMicrotask(() => {
      this._dirty = false;
      this.emit('state-change', this.getSnapshot());
    });
  }

  /** A data / structure mutation ran (add / insert / update / move / remove, processChanges,
   *  branch ops, paste, duplicate, sort): `nodes-change` once, on the microtask after it —
   *  coalesced, so a compound op (drop of many nodes, paste, duplicate) fires one event.
   *  Never for expand / select / check / focus or loading `nodes` (svelte onNodesChange). */
  private _nodesChangePending = false;
  private _markStructureChanged(): void {
    if (this._nodesChangePending) return;
    this._nodesChangePending = true;
    queueMicrotask(() => {
      this._nodesChangePending = false;
      this.emit('nodes-change', undefined);
    });
  }

  /** Nesting depth of `_mutate` — the state reconcile runs once, after the outermost. */
  private _mutationDepth = 0;

  /**
   * THE bracket around every change to the tree's structure or data (move / add / remove /
   * paste / branch ops / processChanges…): announces it (`nodes-change`, microtask) and, after
   * the outermost one, brings the path-keyed state back in line with the tree
   * (_reconcileAfterMutation). Nested calls (moveNodes → moveNode, a cross-tree cut-paste
   * removing its sources) reconcile once. (svelte-treeview REVIEW-2026-11-19 §3.3)
   */
  private _mutate<R>(run: () => R): R {
    this._markStructureChanged();
    this._mutationDepth++;
    try {
      return run();
    } finally {
      if (--this._mutationDepth === 0) this._reconcileAfterMutation();
    }
  }

  /**
   * After a mutation (see _mutate): the path-keyed state follows the tree.
   * (svelte-treeview REVIEW-2026-11-19 B2)
   * - Paths of nodes no longer in the tree leave the selection (+ anchor), the checked set and
   *   the cut set — removeNode / removeBranch / a cut-paste source used to leave them behind.
   * - A removed focused node is unfocused.
   * - Cascade mode re-derives the branch states: a removed / moved / added child changes its
   *   parent's [✓] / [-] (_rederiveCascadeStates).
   * Fires selection-change / checked-change only for what changed (focus-change follows
   * from the snapshot).
   */
  private _reconcileAfterMutation(): void {
    if (!this.tree?.root) return;
    const isLive = (path: string) => this._getRealNode(path) !== null;

    const selected = this._selection.values();
    const liveSelected = selected.filter(isLive);
    const isSelectionChanged = liveSelected.length !== selected.length;
    if (isSelectionChanged) {
      this._selection.set(liveSelected, { isSilent: true });
      this._syncSelection();
    }
    const anchor = this._selection.anchor;
    if (anchor && !isLive(anchor)) this._selection.setAnchor(null);

    const isFocusRemoved = !!this._focusedNode && !isLive(this._focusedNode.path);
    if (isFocusRemoved) this._focusedNode = null;

    if (this._cutPaths.size > 0) {
      const cut = [...this._cutPaths].filter(isLive);
      if (cut.length !== this._cutPaths.size) this._cutPaths = new Set(cut);
    }

    const prevChecked = this._checkedPaths;
    const checked = new Set([...prevChecked].filter(isLive));
    // No checkboxes = the checked set is the selection mirror (_reconcileCheckedFromSelection),
    // which has no cascade.
    const isCascade = this._checkboxMode === 'cascade' && this._shouldShowCheckboxes;
    if (isCascade && prevChecked.size > 0) this._rederiveCascadeStates(checked);
    const isCheckedChanged =
      checked.size !== prevChecked.size || [...checked].some((p) => !prevChecked.has(p));
    if (isCheckedChanged) {
      this._checkedPaths = checked;
      this._reconcileFilteredCheckState();
    }

    if (isSelectionChanged) {
      this._dispatchSelectionChange();
      this._reconcileCheckedFromSelection();
    }
    if (isCheckedChanged) this._dispatchCheckedChange();
    if (isSelectionChanged || isCheckedChanged || isFocusRemoved) {
      this.tree.refresh();
      this._scheduleNotify();
    }
  }

  /**
   * Cascade mode: re-derive every branch's visualState + isChecked from its descendants in
   * ONE bottom-up pass over the real tree (O(n)), writing membership changes into `checked`.
   * Same rule as _reconcileCascadeStates: all descendants checked → checked, none →
   * unchecked, else [-] (not in the canonical set). Leaves keep their own isChecked.
   */
  private _rederiveCascadeStates(checked: Set<string>): void {
    // Returns whether the node's whole subtree (itself included) is checked / unchecked.
    const visit = (n: LTreeNode<T>): { isAll: boolean; isNone: boolean } => {
      let isAll = true;
      let isNone = true;
      const children = n.children as LTreeNode<T>[];
      for (const child of children) {
        const sub = visit(child);
        isAll &&= sub.isAll;
        isNone &&= sub.isNone;
      }
      let vs: VisualState;
      if (children.length === 0) {
        vs = n.isChecked ? VisualState.checked : VisualState.unchecked;
      } else {
        vs = isAll ? VisualState.checked : isNone ? VisualState.unchecked : VisualState.indeterminate;
        const shouldBeChecked = vs === VisualState.checked;
        if (n.isChecked !== shouldBeChecked) {
          n.isChecked = shouldBeChecked;
          n._rev++;
        }
        if (shouldBeChecked) checked.add(n.path);
        else checked.delete(n.path);
      }
      if (n.visualState !== vs) {
        n.visualState = vs;
        n._rev++;
      }
      return { isAll: isAll && n.isChecked, isNone: isNone && !n.isChecked };
    };
    for (const child of this.tree.root.children as LTreeNode<T>[]) visit(child);
  }

  /** Synchronously emit state-change snapshot, bypassing microtask batching.
   *  Used when the DOM must be updated before the caller continues (e.g. scrollToPath). */
  private _flushNotify() {
    this._dirty = false;
    this.emit('state-change', this.getSnapshot());
  }

  // ── Property accessors ──────────────────────────────────────────────

  get treeId() { return this._treeId; }
  set treeId(v: string) {
    this._setTreeId(v);
    if (this.tree) this.tree.treePathSeparator = this._treePathSeparator;
  }

  /**
   * Rename the tree. Keeps the cross-tree registry, the nodes' `treeId` and the container's
   * `data-tree-id` (re-rendered) in step: a pointer drag from another tree finds this one by the
   * container's id through the registry, and tells same-tree from cross-tree by `node.treeId` — a
   * tree renamed after construction (`el.treeId = 'target'`) used to stay registered under its
   * generated id, so a drop onto it was handled by the SOURCE tree.
   */
  private _setTreeId(treeId: string): void {
    if (!treeId || treeId === this._treeId) return;
    const isRegistered = getClipboardTree(this._treeId) === (this as unknown);
    if (isRegistered) unregisterClipboardTree(this._treeId, this);
    this._treeId = treeId;
    if (isRegistered) registerClipboardTree(this._treeId, this);
    this.tree?.setTreeId(treeId);
    this._scheduleNotify();
  }

  get treePathSeparator() { return this._treePathSeparator; }
  set treePathSeparator(v: string) {
    this._treePathSeparator = v;
    if (this.tree) this.tree.treePathSeparator = v;
  }

  get data() { return this._data; }
  set data(v: T[]) {
    this._data = v;
    this._onDataChanged();
  }

  /** The focused node — always the REAL node: focus made while filtered lands on the filtered
   *  COPY (the rendered row), which is thrown away when the filter clears.
   *  (svelte-treeview REVIEW-2026-11-19 R5) */
  get focusedNode() {
    const node = this._focusedNode;
    return node && this.tree ? (this._getRealNode(node.path) ?? node) : node;
  }
  set focusedNode(v: LTreeNode<T> | null | undefined) {
    this._focusedNode = v;
    this._scheduleNotify();
  }

  get rangeSelectionMode() { return this._rangeSelectionMode; }
  set rangeSelectionMode(v: import('./types').RangeSelectionMode) {
    this._rangeSelectionMode = v;
  }

  get selectionMode() { return this._selectionMode; }
  set selectionMode(v: 'single' | 'multiple') {
    this._selectionMode = v;
  }

  get isCheckboxesShown() { return this._shouldShowCheckboxes; }
  set isCheckboxesShown(v: boolean) {
    this._shouldShowCheckboxes = v;
    this._updateNodeConfig();
  }

  get shouldClickToggleCheckbox() { return this._shouldClickToggleCheckbox; }
  /** Read-only: user input can't change the data (checks, moves, clipboard edits). */
  get isReadonly() { return this._isReadonly; }
  set shouldClickToggleCheckbox(v: boolean) { this._shouldClickToggleCheckbox = v; }

  get checkboxMode() { return this._checkboxMode; }
  set checkboxMode(v: import('./types').CheckboxMode) {
    if (this._checkboxMode === v) return;
    this._checkboxMode = v;
    this._reconcileVisualStatesForMode();
    // The emitted projection depends on the mode — re-notify with the new view.
    this._dispatchCheckedChange();
  }

  get cascadeCheckPolicy() { return this._cascadeCheckPolicy; }
  set cascadeCheckPolicy(v: import('./types').CascadeCheckPolicy) {
    if (this._cascadeCheckPolicy === v) return;
    this._cascadeCheckPolicy = v;
    // Re-project the (unchanged) canonical set through the new policy and notify.
    this._dispatchCheckedChange();
    this._scheduleNotify();
  }

  /** The emitted (policy-projected) selection — what `getCheckedPaths()` and the
   *  `checked-change` event expose. Equals the canonical set in independent mode
   *  or under the 'all' policy. */
  get emittedPaths(): Set<string> { return this._computeEmittedCheckedPaths(this._checkedPaths); }

  /** Bindable: the multi-select selected set. */
  get selectedPaths(): Set<string> { return this._selectedPaths; }

  /** Bindable: the checkbox / data-state checked set. */
  get checkedPaths(): Set<string> { return this._checkedPaths; }

  get cutPaths(): Set<string> { return this._cutPaths; }

  get focusedNodeClass() { return this._focusedNodeClass; }
  set focusedNodeClass(v: string | null | undefined) { this._focusedNodeClass = v; this._updateNodeConfig(); }

  get checkedNodeClass() { return this._checkedNodeClass; }
  set checkedNodeClass(v: string | null | undefined) { this._checkedNodeClass = v; this._updateNodeConfig(); }

  get insertResult() { return this._insertResult; }
  get searchTerm() { return this._searchText; }
  set searchTerm(v: string | null | undefined) {
    this._searchText = v;
    this.tree?.filterNodes(v as string);
    this._scheduleNotify();
  }

  /** Max matches a search/filter returns (undefined = DEFAULT_SEARCH_RESULT_LIMIT, 1000). */
  get maxSearchResultCount() { return this._maxSearchResultCount; }
  set maxSearchResultCount(v: number | undefined) {
    if (this._maxSearchResultCount === v) return;
    this._maxSearchResultCount = v;
    this._wireTreeSearch();
    this._reapplySearchFilter();
  }

  /** EXPERIMENTAL — which descendants of a filter match stay visible. */
  get filterScope() { return this._filterScope; }
  set filterScope(v: FilterScope) {
    if (this._filterScope === v) return;
    this._filterScope = v;
    this._wireTreeSearch();
    this._reapplySearchFilter();
  }

  /** EXPERIMENTAL — the `x` for the depth-limited filterScopes. */
  get filterDescendantDepth() { return this._filterDescendantDepth; }
  set filterDescendantDepth(v: number) {
    if (this._filterDescendantDepth === v) return;
    this._filterDescendantDepth = v;
    this._wireTreeSearch();
    this._reapplySearchFilter();
  }

  /** EXPERIMENTAL — expand the descendants a filterScope adds (default true). */
  get shouldExpandFilterDescendants() { return this._shouldExpandFilterDescendants; }
  set shouldExpandFilterDescendants(v: boolean) {
    if (this._shouldExpandFilterDescendants === v) return;
    this._shouldExpandFilterDescendants = v;
    this._wireTreeSearch();
    this._reapplySearchFilter();
  }

  /** Latest search-index progress; null until a load queues indexing. */
  get indexProgress(): IndexProgress | null { return this._indexProgress; }
  /** Status of the last applied/cleared filter; null before the first filter. */
  get searchStatus(): SearchStatus | null { return this._searchStatus; }

  /** Push the search settings + progress/status hooks onto the current ltree (it is
   *  recreated by setOptions, so this runs after every createLTree too). */
  private _wireTreeSearch(): void {
    const tree = this.tree;
    if (!tree) return;
    tree.maxSearchResultCount = this._maxSearchResultCount;
    tree.filterScope = this._filterScope;
    tree.filterDescendantDepth = this._filterDescendantDepth;
    tree.shouldExpandFilterDescendants = this._shouldExpandFilterDescendants;
    tree.onIndexProgress = (progress) => {
      this._indexProgress = progress;
      this.indexProgressCb?.(progress);
    };
    tree.onSearchStatus = (status) => this._dispatchSearchStatus(status);
  }

  private _dispatchSearchStatus(status: SearchStatus): void {
    this._searchStatus = status;
    if (this._isDispatchingSearchStatus) {
      // A handler changed the filter mid-dispatch — deliver the newest status after it returns.
      this._pendingSearchStatus = status;
      return;
    }
    this._isDispatchingSearchStatus = true;
    try {
      let next: SearchStatus | null = status;
      while (next) {
        this._pendingSearchStatus = null;
        this.searchStatusCb?.(next);
        next = this._pendingSearchStatus;
      }
    } finally {
      this._isDispatchingSearchStatus = false;
    }
  }

  get isRendering() { return this._isRendering; }
  get isLoading() { return this._isLoading; }
  /** `highlight-on-page-drag` armed state (set by the element from the page drag tracker). */
  setArmed(isArmed: boolean): void {
    if (this._isArmed === isArmed) return;
    this._isArmed = isArmed;
    this._scheduleNotify();
  }
  set isLoading(v: boolean) { this._isLoading = v; this._scheduleNotify(); }


  get flatIndentSize() { return this._flatIndentSize; }
  set flatIndentSize(v: string) { this._flatIndentSize = v; this._scheduleNotify(); }

  get isProgressiveRenderEnabled() { return this._isProgressiveRenderEnabled; }
  get initialBatchSize() { return this._initialBatchSize; }
  get maxBatchSize() { return this._maxBatchSize; }
  get maxAnimatedRowCount() { return this._maxAnimatedRowCount; }
  get revealedPaths(): ReadonlySet<string> { return this._revealedPaths; }

  get bodyClass() { return this._bodyClass; }
  set bodyClass(v: string | null | undefined) { this._bodyClass = v; this._scheduleNotify(); }

  get dragDropMode() { return this._dragDropMode; }
  set dragDropMode(v: DragDropMode) { this._dragDropMode = v; this._updateNodeConfig(); }

  get isCopyAllowed() { return this._isCopyAllowed; }
  set isCopyAllowed(v: boolean) {
    this._isCopyAllowed = v;
    this._updateNodeConfig();
  }

  get shouldAutoHandleCopy() { return this._shouldAutoHandleCopy; }
  set shouldAutoHandleCopy(v: boolean) { this._shouldAutoHandleCopy = v; }

  get shouldAutoHandleMove() { return this._shouldAutoHandleMove; }
  set shouldAutoHandleMove(v: boolean) { this._shouldAutoHandleMove = v; }

  get touchDragDelay() { return this._touchDragDelay; }
  set touchDragDelay(v: number) { this._touchDragDelay = v ?? 300; }

  get shouldIndicateUndraggable() { return this._shouldIndicateUndraggable; }
  set shouldIndicateUndraggable(v: boolean) { this._shouldIndicateUndraggable = v; }

  get isTreeDropZoneEnabled() { return this._shouldEnableTreeDropZone; }
  set isTreeDropZoneEnabled(v: boolean) { this._shouldEnableTreeDropZone = v; }

  get clickBehavior() { return this._clickBehavior; }
  set clickBehavior(v: import('./types').ClickBehavior) { this._clickBehavior = v; this._updateNodeConfig(); }

  get shouldExpandAsAccordion() { return this._shouldExpandAsAccordion; }
  set shouldExpandAsAccordion(v: boolean) { this._shouldExpandAsAccordion = v; }

  get iconSet() { return this._iconSet; }
  set iconSet(v: import('./types').IconSet) { this._iconSet = v; this._updateNodeConfig(); }

  get leafIconClass() { return this._leafIconClass; }
  set leafIconClass(v: string) { this._leafIconClass = v; this._updateNodeConfig(); }

  get toggleIconMode() { return this._toggleIconMode; }
  set toggleIconMode(v: import('./types').ToggleIconMode) { this._toggleIconMode = v; this._updateNodeConfig(); }

  get selectedNodeClass() { return this._selectedNodeClass; }
  set selectedNodeClass(v: string | null | undefined) { this._selectedNodeClass = v; this._updateNodeConfig(); }

  get dragOverNodeClass() { return this._dragOverNodeClass; }
  set dragOverNodeClass(v: string | null | undefined) { this._dragOverNodeClass = v; this._updateNodeConfig(); }

  get draggedNodeClass() { return this._draggedNodeClass; }
  set draggedNodeClass(v: string | null | undefined) { this._draggedNodeClass = v; this._updateNodeConfig(); }

  get isNodeTooltipsShown() { return this._shouldShowNodeTooltips; }
  set isNodeTooltipsShown(v: boolean) { this._shouldShowNodeTooltips = v; this._updateNodeConfig(); }

  get getNodeTooltipCallback() { return this._getNodeTooltipCallback; }
  set getNodeTooltipCallback(v: ((node: LTreeNode<T>) => string | HTMLElement | null | undefined) | undefined) { this._getNodeTooltipCallback = v; this._updateNodeConfig(); }

  get tooltipPlacement() { return this._tooltipPlacement; }
  set tooltipPlacement(v: import('./types').TooltipPlacement) { this._tooltipPlacement = v; this._updateNodeConfig(); }

  get tooltipDelay() { return this._tooltipDelay; }
  set tooltipDelay(v: import('./types').TooltipDelay) { this._tooltipDelay = v; this._updateNodeConfig(); }

  get tooltipOffset() { return this._tooltipOffset; }
  set tooltipOffset(v: number) { this._tooltipOffset = v; this._updateNodeConfig(); }

  get shouldTooltipFollowCursor() { return this._tooltipFollowCursor; }
  set shouldTooltipFollowCursor(v: boolean) { this._tooltipFollowCursor = v; this._updateNodeConfig(); }

  get dropZoneMode() { return this._dropZoneMode; }
  set dropZoneMode(v: 'floating' | 'glow') { this._dropZoneMode = v; this._updateNodeConfig(); }

  get dropZoneLayout() { return this._dropZoneLayout; }
  set dropZoneLayout(v: 'around' | 'before' | 'after' | 'wave' | 'wave2') { this._dropZoneLayout = v; this._updateNodeConfig(); }

  get dropZoneStart() { return this._dropZoneStart; }
  set dropZoneStart(v: number | string) { this._dropZoneStart = v; this._updateNodeConfig(); }

  get dropZoneMaxWidth() { return this._dropZoneMaxWidth; }
  set dropZoneMaxWidth(v: string) { this._dropZoneMaxWidth = v; this._updateNodeConfig(); }

  get scrollHighlightTimeout() { return this._scrollHighlightTimeout; }
  set scrollHighlightTimeout(v: number) { this._scrollHighlightTimeout = v; }

  get scrollHighlightClass() { return this._scrollHighlightClass; }
  set scrollHighlightClass(v: string | null | undefined) { this._scrollHighlightClass = v; }

  get contextMenuXOffset() { return this._contextMenuXOffset; }
  set contextMenuXOffset(v: number) { this._contextMenuXOffset = v; }

  get contextMenuYOffset() { return this._contextMenuYOffset; }
  set contextMenuYOffset(v: number) { this._contextMenuYOffset = v; }

  get hasContextMenuRenderer() { return this._hasContextMenuRenderer; }
  set hasContextMenuRenderer(v: boolean) { this._hasContextMenuRenderer = v; }

  // Per-node icons
  get iconMember() { return this._iconMember; }
  set iconMember(v: string | null | undefined) { this._iconMember = v; this._updateNodeConfig(); }

  get iconCallback() { return this._iconCallback; }
  set iconCallback(v: ((node: LTreeNode<T>) => string | null) | undefined) { this._iconCallback = v; this._updateNodeConfig(); }

  get iconColorMember() { return this._iconColorMember; }
  set iconColorMember(v: string | null | undefined) { this._iconColorMember = v; this._updateNodeConfig(); }

  get iconColorCallback() { return this._iconColorCallback; }
  set iconColorCallback(v: ((node: LTreeNode<T>) => string | null) | undefined) { this._iconColorCallback = v; this._updateNodeConfig(); }

  /** Resolve a node's icon COLOR (iconColorCallback wins over iconColorMember). */
  getNodeIconColor(node: LTreeNode<T>): string | null {
    if (this._iconColorCallback) return this._iconColorCallback(node);
    if (this._iconColorMember && node.data) {
      const val = (node.data as any)[this._iconColorMember];
      return val ? String(val) : null;
    }
    return null;
  }

  get shouldAlignNodeIcons() { return this._shouldAlignNodeIcons; }
  set shouldAlignNodeIcons(v: boolean) { this._shouldAlignNodeIcons = v; this._updateNodeConfig(); }

  get hasIconSupport(): boolean {
    return !!(this._iconMember || this._iconCallback);
  }

  getNodeIcon(node: LTreeNode<T>): string | null {
    if (this._iconCallback) {
      return this._iconCallback(node);
    }
    if (this._iconMember && node.data) {
      const val = (node.data as any)[this._iconMember];
      return val ? String(val) : null;
    }
    return null;
  }

  // Context menu state
  get isContextMenuOpen() { return this._isContextMenuOpen; }
  get contextMenuX() { return this._contextMenuX; }
  get contextMenuY() { return this._contextMenuY; }
  get contextMenuNode() { return this._contextMenuNode; }

  // Drag and drop state (read by renderer)
  get draggedNode() { return this._draggedNode; }
  get isDragInProgress() { return this._isDragInProgress; }
  get hoveredNodeForDrop() { return this._hoveredNodeForDrop; }
  get activeDropPosition() { return this._activeDropPosition; }
  get currentDropOperation() { return this._currentDropOperation; }
  get isDropPlaceholderActive() { return this._isDropPlaceholderActive; }

  // Virtual scroll accessors
  get isVirtualScrollEnabled() { return this._isVirtualScrollEnabled; }
  set isVirtualScrollEnabled(v: boolean) {
    this._isVirtualScrollEnabled = v;
    // Cancel pending progressive render batches — virtual scroll replaces progressive rendering
    if (v && this.flatRenderAnimationFrame) {
      cancelAnimationFrame(this.flatRenderAnimationFrame);
      this.flatRenderAnimationFrame = null;
      this.flatRenderQueue = [];
      this._completeRenderPass();
    }
    this._scheduleNotify();
  }

  get virtualScrollItemHeight() { return this._virtualRowHeight; }
  set virtualScrollItemHeight(v: number | undefined) { this._virtualRowHeight = v; this._scheduleNotify(); }

  get virtualScrollOverscan() { return this._virtualOverscan; }
  set virtualScrollOverscan(v: number) { this._virtualOverscan = v; this._scheduleNotify(); }

  get virtualScrollContainerHeight() { return this._virtualContainerHeight; }
  set virtualScrollContainerHeight(v: string | undefined) { this._virtualContainerHeight = v; this._scheduleNotify(); }

  /** Called by renderer on scroll (triggers full state-change pipeline). */
  setVirtualScrollTop(scrollTop: number): void {
    this._vsScrollTop = scrollTop;
    this._scheduleNotify();
  }

  /** Silently sync scroll position without triggering state notification.
   *  Used by the renderer's fast synchronous scroll path. */
  syncVirtualScrollTop(scrollTop: number): void {
    this._vsScrollTop = scrollTop;
  }

  /** Called by renderer after first render to auto-measure row height. */
  setMeasuredRowHeight(height: number): void {
    if (this._vsMeasuredRowHeight !== height) {
      this._vsMeasuredRowHeight = height;
      this._scheduleNotify();
    }
  }

  /** Called by renderer with the virtual viewport's measured height (px). */
  setVirtualViewportHeight(height: number): void {
    const next = height > 0 ? height : null;
    if (this._vsViewportHeight !== next) {
      this._vsViewportHeight = next;
      this._scheduleNotify();
    }
  }

  /** Viewport height (px) for the virtual window: measured > a px / bare-number length > 400. */
  get virtualViewportHeightPx(): number {
    if (this._vsViewportHeight) return this._vsViewportHeight;
    const css = this.resolvedContainerHeight.trim();
    return /^\d+(\.\d+)?(px)?$/.test(css) ? parseFloat(css) : 400;
  }

  /** Called by renderer to report detected container height. */
  setDetectedContainerHeight(height: string): void {
    if (this._vsDetectedHeight !== height) {
      this._vsDetectedHeight = height;
      this._scheduleNotify();
    }
  }

  /** Resolved row height: explicit > measured > 24px default (matches the
   *  --wtv-node-height token; only used before a real row can be measured). */
  get resolvedRowHeight(): number {
    return this._virtualRowHeight ?? this._vsMeasuredRowHeight ?? 24;
  }

  /** Resolved container height string: explicit > detected > '400px' */
  get resolvedContainerHeight(): string {
    return this._virtualContainerHeight ?? this._vsDetectedHeight ?? '400px';
  }

  /** All visible flat nodes (before virtual scroll slicing).
   *  When virtual scroll is active, bypasses the progressive render filter
   *  because virtual scroll already limits rendered nodes to the visible window. */
  get allVisibleFlatNodes(): LTreeNode<T>[] {
    if (!this._isVirtualScrollEnabled && this._isProgressiveRenderEnabled) {
      return this.tree?.visibleFlatNodes?.filter(
        (n) => this.flatRenderedIds.has(n.path)
      ) ?? [];
    }
    return this.tree?.visibleFlatNodes ?? [];
  }

  // ── Derived ─────────────────────────────────────────────────────────

  get flatNodesToRender(): LTreeNode<T>[] {
    const all = this.allVisibleFlatNodes;
    if (!this._isVirtualScrollEnabled) return all;

    const { start, end } = this.virtualRange(all.length);
    return all.slice(start, end);
  }

  /**
   * The rendered window over `allVisibleFlatNodes` (flat path only): core `computeVirtualRange`
   * (SPEC §12.26). The engine owns the window and the renderer reconciles it on its own schedule
   * (snapshot pipeline + the per-frame scroll fast path), so core's range math, not
   * `createVirtualWindow`. The fast path passes the live `scrollTop` / viewport; otherwise the last
   * synced ones.
   */
  virtualRange(
    count: number = this.allVisibleFlatNodes.length,
    scrollTop: number = this._vsScrollTop,
    viewport: number = this.virtualViewportHeightPx,
  ): VirtualRange {
    return computeVirtualRange({ scrollTop, viewport, count, rowHeight: this.resolvedRowHeight, overscan: this._virtualOverscan });
  }

  get statistics() {
    return this.tree?.statistics;
  }

  // ── Constructor ─────────────────────────────────────────────────────

  constructor(props: TreeViewStateOptions<T>) {
    super();
    // C-CA-37: every option left out (or `undefined`) gets <web-treeview>'s default — one source, the
    // element's input table (`ENGINE_DEFAULTS`), for the keys this config shares with the element. A bare
    // `new TreeViewState({ data })` reads `id` / `path` / `displayValue` like the element does.
    props = withEngineDefaults(props) as TreeViewStateOptions<T> & Required<Pick<TreeViewStateOptions<T>, 'idMember' | 'pathMember'>>;
    this._options = { ...props };

    // Assign prop values (with defaults)
    this._treeId = props.treeId || this.generateTreeId();
    this._treePathSeparator = props.treePathSeparator ?? '.';
    // Register in the module-level clipboard registry so a cross-tree cut/paste
    // can reach back here to remove the originals.
    registerClipboardTree(this._treeId, this);

    this._data = props.data;
    this._focusedNode = props.focusedNode ?? null;
    this._searchText = props.searchTerm;
    this._rangeSelectionMode = props.rangeSelectionMode ?? 'visual';
    this._selectionMode = props.selectionMode ?? 'single';
    this._applyNavigationOverrides(props.navigationOverrides);
    this._shouldShowCheckboxes = props.isCheckboxesShown ?? false;
    this._checkboxMode = props.checkboxMode ?? 'independent';
    this._cascadeCheckPolicy = props.cascadeCheckPolicy ?? 'rolled-up';
    this._maxSearchResultCount = props.maxSearchResultCount ?? undefined;
    this._filterScope = props.filterScope ?? 'matches';
    this._filterDescendantDepth = props.filterDescendantDepth ?? 1;
    this._shouldExpandFilterDescendants = props.shouldExpandFilterDescendants ?? true;
    this.indexProgressCb = props.onIndexProgress;
    this.searchStatusCb = props.onSearchStatusChange;
    this._shouldClickToggleCheckbox = props.shouldClickToggleCheckbox ?? false;
    this.beforeCheckboxToggleCb = props.beforeCheckboxToggleCallback;

    this._isLoading = props.isLoading ?? false;

    this._flatIndentSize = props.flatIndentSize ?? 'var(--wtv-indent-size)';
    this._isProgressiveRenderEnabled = props.isProgressiveRenderEnabled ?? true;
    this._initialBatchSize = props.initialBatchSize ?? 20;
    this._maxBatchSize = props.maxBatchSize ?? 500;
    this._maxAnimatedRowCount = props.maxAnimatedRowCount ?? 50;
    this._bodyClass = props.bodyClass;

    this._expandLevel = props.expandLevel ?? null;
    this._indexerBatchSize = props.indexerBatchSize ?? undefined;
    this._indexerTimeout = props.indexerTimeout ?? undefined;
    if (props.log) this.log = props.log;
    this._dragDropMode = props.dragDropMode ?? 'none';
    this._isCopyAllowed = props.isCopyAllowed ?? false;
    this._shouldAutoHandleCopy = props.shouldAutoHandleCopy ?? true;
    this._shouldAutoHandleMove = props.shouldAutoHandleMove ?? true;
    this._shouldAutoHandlePaste = props.shouldAutoHandlePaste ?? true;
    this._isKeyboardShortcutsEnabled = props.isKeyboardShortcutsEnabled ?? true;
    this._isReadonly = props.isReadonly ?? false;
    this._isInternalSearchIndexEnabled = props.isInternalSearchIndexEnabled ?? true;
    this._initializeIndexCallback = props.initializeIndexCallback ?? undefined;
    this._touchDragDelay = props.touchDragDelay ?? 300;
    this._shouldIndicateUndraggable = props.shouldIndicateUndraggable ?? true;
    this._shouldEnableTreeDropZone = props.isTreeDropZoneEnabled ?? false;

    this._isVirtualScrollEnabled = props.isVirtualScrollEnabled ?? false;
    this._virtualRowHeight = props.virtualScrollItemHeight;
    this._virtualOverscan = props.virtualScrollOverscan ?? 5;
    this._virtualContainerHeight = props.virtualScrollContainerHeight;

    this._clickBehavior = props.clickBehavior ?? 'expand-and-focus';
    this._shouldExpandAsAccordion = props.shouldExpandAsAccordion ?? false;
    this._isSortingEnabled = props.isSortingEnabled !== false;
    this._iconSet = props.iconSet ?? 'chevron';
    this._leafIconClass = props.leafIconClass ?? 'wtv__toggle-icon--leaf-none';
    this._toggleIconMode = props.toggleIconMode ?? 'rotate';
    this._selectedNodeClass = props.selectedNodeClass;
    this._focusedNodeClass = props.focusedNodeClass;
    this._checkedNodeClass = props.checkedNodeClass;
    this._dragOverNodeClass = props.dragOverNodeClass;
    this._draggedNodeClass = props.draggedNodeClass;
    this._shouldShowNodeTooltips = props.isNodeTooltipsShown ?? false;
    this._getNodeTooltipCallback = props.getNodeTooltipCallback;
    this._tooltipPlacement = props.tooltipPlacement ?? 'top-start';
    this._tooltipDelay = props.tooltipDelay ?? { show: 400, hide: 100 };
    this._tooltipOffset = props.tooltipOffset ?? 8;
    this._tooltipFollowCursor = props.shouldTooltipFollowCursor ?? false;
    this._dropZoneMode = props.dropZoneMode ?? 'glow';
    this._dropZoneLayout = props.dropZoneLayout ?? 'around';
    this._dropZoneStart = props.dropZoneStart ?? 33;
    this._dropZoneMaxWidth = props.dropZoneMaxWidth ?? '120px';
    this._scrollHighlightTimeout = props.scrollHighlightTimeout ?? 4000;
    this._scrollHighlightClass = props.scrollHighlightClass ?? 'wtv__node-content--scroll-highlight';
    this._contextMenuXOffset = props.contextMenuXOffset ?? 8;
    this._contextMenuYOffset = props.contextMenuYOffset ?? 0;
    this._hasContextMenuRenderer = props.hasContextMenuRenderer ?? false;
    this._iconMember = props.iconMember ?? undefined;
    this._iconCallback = props.iconCallback;
    this._iconColorMember = props.iconColorMember ?? undefined;
    this._iconColorCallback = props.iconColorCallback;
    this._shouldAlignNodeIcons = props.shouldAlignNodeIcons ?? true;
    this._nodeClass = props.nodeClass;
    this._nodeContentClass = props.nodeContentClass;

    // Store callbacks
    this.checkedChangeCb = props.onCheckedChange;
    this.selectionChangeCb = props.onSelectionChange;
    this.nodeClickedCb = props.onNodeClick;
    this.onNodeDoubleClickCb = props.onNodeDoubleClick;
    this.beforeExpandCb = props.beforeExpandCallback;
    this.nodeExpandCb = props.onNodeExpand;
    this.nodeCollapseCb = props.onNodeCollapse;
    this.beforeCopyCb = props.beforeCopyCallback;
    this.beforeCutCb = props.beforeCutCallback;
    this.beforePasteCb = props.beforePasteCallback;
    this.beforeDeleteCb = props.beforeDeleteCallback;
    this.onCopyCb = props.onCopy;
    this.onCutCb = props.onCut;
    this.onPasteCb = props.onPaste;
    this.onDeleteCb = props.onDelete;
    this.outputTransformCb = props.nodeOutputTransformationCallback;
    this.inputTransformCb = props.nodeInputTransformationCallback;
    this.nodeDragStartCb = props.onNodeDragStart;
    this.nodeDragOverCb = props.onNodeDragOver;
    this.beforeDropCallbackCb = props.beforeDropCallback;
    this.beforeDragStartCb = props.beforeDragStartCallback;
    this.nodeDropCb = props.onNodeDrop;
    this.nodeDragDeniedCb = props.onNodeDragDenied;
    this.nodeDropDeniedCb = props.onNodeDropDenied;
    this.onTreeKeydownCb = props.onTreeKeydown;
    this.beforeScrollCb = props.beforeScrollCallback;
    this.contextMenuCallbackCb = props.contextMenuCallback;
    this.renderStartCb = props.onRenderStart;
    this.renderProgressCb = props.onRenderProgress;
    this.renderCompleteCb = props.onRenderComplete;

    // ── Create LTree ────────────────────────────────────────────────
    this.tree = createLTree<T>(
      props.idMember,
      props.pathMember,
      props.parentPathMember,
      props.levelMember,
      props.hasChildrenMember,
      props.isExpandedMember,
      props.getIsExpandedCallback,
      props.isSelectableMember,
      props.getIsSelectableCallback,
      props.isCheckedMember,
      props.getIsCheckedCallback,
      props.isDraggableMember,
      props.getIsDraggableCallback,
      props.isDropAllowedMember,
      props.getIsDropAllowedCallback,
      props.allowedDropPositionsMember,
      props.displayValueMember,
      props.getDisplayValueCallback,
      props.searchValueMember,
      props.getSearchValueCallback,
      props.getAllowedDropPositionsCallback,
      props.isCollapsibleMember,
      props.getIsCollapsibleCallback,
      props.orderMember,
      this._treeId,
      this._treePathSeparator,
      props.expandLevel,
      this._isInternalSearchIndexEnabled,
      this._initializeIndexCallback,
      props.indexerBatchSize,
      props.indexerTimeout,
      {
        log: this.log,
        isSorted: props.isSorted,
        isSortingEnabled: this._isSortingEnabled,
        sortCallback: props.sortCallback,
        displayValueFallback: props.displayValueFallback ?? '[N/A]'
      }
    );

    this.log.INIT.debug(`[${this._treeId}] TreeViewState created`, {
      idMember: props.idMember,
      pathMember: props.pathMember,
      displayValueMember: props.displayValueMember,
      parentPathMember: props.parentPathMember,
      expandLevel: props.expandLevel,
      dataLength: props.data?.length ?? 0,
      dragDropMode: this._dragDropMode
    });

    // Wire tree change notifications
    this.tree.onChange = () => this._onTreeChanged();
    this._wireTreeSearch();

    // ── Create render coordinator ───────────────────────────────────
    this.renderCoordinator = this._isProgressiveRenderEnabled
      ? createRenderCoordinator(2, {
          onStart: () => {
            this._isRendering = true;
            this.renderStartCb?.();
          },
          onProgress: (stats) => {
            this.renderProgressCb?.(stats);
          },
          onComplete: (stats) => {
            this._isRendering = false;
            this.renderCompleteCb?.(stats);
          }
        })
      : null;

    // ── Create stable nodeCallbacks ─────────────────────────────────
    this.nodeCallbacks = {
      onNodeClicked: this._nodeClickedCallback.bind(this),
      onNodeRightClicked: this._onNodeRightClicked.bind(this),
      onCheckboxToggle: this._onCheckboxToggle.bind(this)
    };

    // ── Initial nodeConfig ──────────────────────────────────────────
    this._updateNodeConfig();

    // Insert initial data
    if (this._data?.length) {
      this.renderCoordinator?.reset();
      this.flatRenderedIds = new Set();
      this.flatRenderQueue = [];
      this.currentBatchSize = 0;
      const preservedExpanded = this._collectExpandedPaths();
      this._insertResult = this.tree.insertArray(this._data);
      this._seedCheckedPathsFromTree();
      this._reapplyRuntimeChecked();
      this._reapplyExpanded(preservedExpanded);
    }

    // Apply initial search filter
    if (this._searchText) {
      this.tree.filterNodes(this._searchText as string);
    }
  }

  // ── Public API methods ──────────────────────────────────────────────

  /**
   * Expand nodes (programmatic / context menu / keyboard). Each target that has
   * children and is collapsed goes through `beforeExpandCallback` first (a
   * `false` keeps it collapsed; an async hook defers it, showing the loading
   * state). Fires `node-expand` for every node that actually expanded (the
   * collapsed ancestors on the way included) unless `isSilent`. `isExclusive`
   * side-effect collapses fire no `node-collapse`.
   */
  expandNodes(
    nodePath: string | string[],
    options?: ExpandOptions
  ) {
    const paths = Array.isArray(nodePath) ? nodePath : [nodePath];
    this._commitPendingCollapses(paths);
    if (!this.beforeExpandCb) {
      this._expandWithEvents(paths, options);
      return;
    }
    const now: string[] = [];
    let isSyncPhase = true;
    for (const p of paths) {
      const node = this.tree?.getNodeByPath(p);
      if (!node || node.isExpanded || !node.hasChildren) {
        now.push(p);
        continue;
      }
      this._checkBeforeExpand(node, () => {
        if (isSyncPhase) now.push(p);
        else this._expandWithEvents([p], options);
      });
    }
    isSyncPhase = false;
    if (now.length) this._expandWithEvents(now, options);
  }

  /** Collapse the nodes; a non-collapsible node (`getNodeIsCollapsible`) stays open. The rows
   *  they hide animate out first (motion); the Promise settles once the collapse applied
   *  (`node-collapse` fires then for every node that actually collapsed, unless `isSilent`). */
  collapseNodes(
    nodePath: string | string[],
    options?: ExpandOptions
  ): Promise<void> {
    const paths = Array.isArray(nodePath) ? nodePath : [nodePath];
    const wereExpanded = paths
      .map((p) => this.tree?.getNodeByPath(p))
      .filter(
        (n): n is LTreeNode<T> =>
          !!n && !!n.isExpanded && !!n.hasChildren && this.tree.getNodeIsCollapsible(n)
      );
    // Already animating out (a second collapse) → wait for that one.
    const running = wereExpanded.filter((n) => this._closingHandles.has(n.path));
    const fresh = wereExpanded.filter((n) => !this._closingHandles.has(n.path));
    const waits: Promise<unknown>[] = running.map((n) => this._closingHandles.get(n.path)!.handle.finished);
    if (fresh.length || !running.length)
      waits.push(
        this._animateCollapse(fresh.map((n) => n.path), () => {
          this.tree.collapseNodes(fresh.length ? fresh.map((n) => n.path) : paths, options);
          if (!options?.isSilent)
            for (const n of fresh) if (!n.isExpanded) this.nodeCollapseCb?.(this.nodeRef(n));
          this._markExpanded(options?.isSilent);
          this._scheduleNotify();
        })
      );
    return Promise.all(waits).then(() => undefined);
  }

  /** Whether `path` has an async `beforeExpandCallback` in flight (renders the loading state). */
  isExpandPending(path: string): boolean {
    return this._expandPending.has(path);
  }

  /** Expand `paths` (no gate) and fire `node-expand` for each node that changed. */
  private _expandWithEvents(paths: string[], options?: ExpandOptions): void {
    const sep = this._treePathSeparator;
    const changing = new Map<string, LTreeNode<T>>();
    for (const p of paths) {
      for (const prefix of getPathChain(p, sep)) {
        if (changing.has(prefix)) continue;
        const n = this.tree?.getNodeByPath(prefix);
        if (!n) break;
        if (!n.isExpanded && n.hasChildren) changing.set(prefix, n);
      }
    }
    this._animateExpand(() => this.tree.expandNodes(paths, options));
    if (!options?.isSilent)
      for (const n of changing.values()) if (n.isExpanded) this.nodeExpandCb?.(this.nodeRef(n));
    this._markExpanded(options?.isSilent);
  }

  /**
   * Run `beforeExpandCallback` for `node`, then `apply()` when allowed. A sync
   * hook answers synchronously (`true` applied / `false` cancelled). An async
   * hook marks the node pending (loading state, `isExpandPending`) and returns a
   * Promise; on settle the pending mark clears and `apply()` runs unless the hook
   * resolved `false` (a rejection was already turned into `false` by the adapter).
   * A request for a node that is already pending is ignored (`false`).
   */
  private _checkBeforeExpand(node: LTreeNode<T>, apply: () => void): boolean | Promise<boolean> {
    const path = node.path;
    if (this._expandPending.has(path)) return false;
    const cb = this.beforeExpandCb;
    if (!cb) {
      apply();
      return true;
    }
    const result = cb(this.nodeRef(node));
    if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
      this._expandPending.add(path);
      node._rev++;
      this.tree.refresh();
      this._scheduleNotify();
      return Promise.resolve(result).then(
        (v) => v !== false,
        () => false
      ).then((isAllowed) => {
        this._expandPending.delete(path);
        const live = this.tree?.getNodeByPath(path) ?? null;
        if (live) live._rev++;
        if (isAllowed && live) apply();
        this.tree?.refresh();
        this._scheduleNotify();
        return isAllowed && !!live;
      });
    }
    if (result === false) return false;
    apply();
    return true;
  }

  /** Toggle expand/collapse for a node clicked via the toggle UI. Honors the
   *  `shouldExpandAsAccordion` config: when expanding under accordion mode, every
   *  expanded sibling (whose `isCollapsible` allows it) is first collapsed
   *  in a single batch. Programmatic `expandNodes` / `expandAll` callers
   *  bypass the accordion. Mirrors svelte-treeview Node.svelte's
   *  toggleExpanded() flow. An expand goes through `beforeExpandCallback`;
   *  a node whose async hook is pending ignores the toggle.
   *  `options.isExclusive` (expand only) replaces the accordion with the
   *  exclusive expand of `expandNodes`; `options.isSilent` fires no events. */
  toggleNodeExpanded(path: string, options?: ExpandOptions): void {
    const node = this.getNodeByPath(path);
    if (!node || !node.hasChildren) return;
    // svelte-treeview blocks the entire toggle (both directions) when
    // a node is marked non-collapsible. Match that gate exactly so the
    // two packages behave the same way.
    if (!this.tree.getNodeIsCollapsible(node)) return;
    if (this._expandPending.has(path)) return;
    // Toggled again while its rows animate out = re-expand: cancel, it stays open.
    if (this._commitPendingCollapses([path])) {
      this.log.UI.debug(`Node re-expanded mid-collapse (animation cancelled): ${path}`, { path, id: node.id });
      return;
    }

    const shouldExpand = !node.isExpanded;

    this.log.UI.debug(`Node ${shouldExpand ? 'expanded' : 'collapsed'}: ${path}`, {
      path,
      id: node.id,
      accordion: shouldExpand && this._shouldExpandAsAccordion
    });

    if (!shouldExpand) {
      this.collapseNodes(path, options);
      return;
    }
    this._checkBeforeExpand(node, () => this._expandFromToggle(path, options));
  }

  /** The expand half of a UI toggle, after the gate: accordion side-effect + expand + events. */
  private _expandFromToggle(path: string, options?: ExpandOptions): void {
    const node = this.getNodeByPath(path);
    if (!node || node.isExpanded) return;
    if (options?.isExclusive) {
      this._expandWithEvents([path], options);
      return;
    }
    const collapsedSiblings: LTreeNode<T>[] = [];
    this._animateExpand(() => {
      if (this._shouldExpandAsAccordion) {
        const siblings = this.tree.getSiblings(path);
        for (const sibling of siblings) {
          if (sibling.path !== path && sibling.isExpanded && this.tree.getNodeIsCollapsible(sibling)) {
            sibling.isExpanded = false;
            (sibling as any)._rev = ((sibling as any)._rev || 0) + 1;
            collapsedSiblings.push(sibling);
          }
        }
      }
      this.tree.expandNodes(path, options);
    });
    if (!options?.isSilent) {
      for (const s of collapsedSiblings) this.nodeCollapseCb?.(this.nodeRef(s));
      if (node.isExpanded) this.nodeExpandCb?.(this.nodeRef(node));
    }
    this._markExpanded(options?.isSilent);
  }

  expandAll(
    nodePath?: string | string[] | null | undefined,
    options?: ExpandOptions
  ) {
    this._commitPendingCollapses(nodePath == null ? null : Array.isArray(nodePath) ? nodePath : [nodePath]);
    this._animateExpand(() => this.tree?.expandAll(nodePath, options));
    this._markExpanded(options?.isSilent);
  }

  /**
   * Row animation: run an expand and record the rows it made visible (the first
   * `maxAnimatedRowCount` in visible order) as the reveal. Nested calls (the accordion toggle →
   * _expandWithEvents) record once, around the outermost. Nothing to animate (duration 0s —
   * motion "none", reduced motion, the token — or a limit of 0) → just `apply()`, so a
   * motion-off tree never builds the before-set.
   */
  private _animateExpand(apply: () => void): void {
    if (this._revealDepth > 0 || !this.tree || !this._isRowAnimationEnabled()) {
      apply();
      return;
    }
    const before = new Set<string>();
    for (const n of this.tree.visibleFlatNodes ?? []) before.add(n.path);
    this._revealDepth++;
    try {
      apply();
    } finally {
      this._revealDepth--;
    }
    const limit = Math.max(0, this._maxAnimatedRowCount ?? 50);
    const revealed = new Set<string>();
    if (limit > 0)
      for (const n of this.tree.visibleFlatNodes ?? []) {
        if (before.has(n.path)) continue;
        revealed.add(n.path);
        if (revealed.size >= limit) break;
      }
    if (revealed.size === 0) return;
    this._revealedPaths = revealed;
    const generation = ++this._revealGeneration;
    this._scheduleNotify();
    // Clear the reveal once the rows played (a row created later — virtual-scroll window,
    // progressive batch — must not replay). The duration is read back from CSS (core
    // readAnimationMs): 0 under motion="none" / reduced motion → cleared at once. The
    // state-change microtask renders first, so look after it.
    setTimeout(() => {
      if (generation !== this._revealGeneration) return;
      const row = this.containerElement?.querySelector('.wtv__node--opening');
      const ms = row ? readAnimationMs(row) : 0;
      this.log.UI.debug('Row animation: reveal', { rows: revealed.size, ms });
      setTimeout(() => {
        if (generation !== this._revealGeneration) return;
        this._revealedPaths = new Set();
        this._scheduleNotify();
      }, ms + 50);
    }, 0);
  }

  /** Collapse the whole tree (`null`) or the given nodes + their descendants. The rows animate
   *  out first (motion); the Promise settles once the tree is collapsed. */
  collapseAll(
    nodePath?: string | string[] | null | undefined,
    options?: ExpandOptions
  ): Promise<void> {
    const apply = () => {
      this.tree?.collapseAll(nodePath, options);
      this._markExpanded(options?.isSilent);
      this._scheduleNotify();
    };
    if (!this.tree) return Promise.resolve();
    // The nodes whose rows disappear: from every root (whole tree) or the given nodes, the
    // topmost expanded nodes that really collapse — a non-collapsible one stays open, so its
    // rows stay and the search goes on below it (svelte-treeview B11).
    const starts = (nodePath == null
      ? (this.tree.visibleFlatNodes ?? []).filter((n) => !n.parentPath)
      : (Array.isArray(nodePath) ? nodePath : [nodePath]).map((p) => this.tree.getNodeByPath(p))
    ).filter((n): n is LTreeNode<T> => !!n);
    const targets: string[] = [];
    const collectCollapsing = (node: LTreeNode<T>) => {
      if (!node.isExpanded || !node.hasChildren) return;
      if (this.tree.getNodeIsCollapsible(node)) targets.push(node.path);
      else for (const child of node.children) collectCollapsing(child);
    };
    for (const node of starts) collectCollapsing(node);
    return this._animateCollapse(targets, apply);
  }

  /**
   * Row animation, collapse half: animate out the visible rows under `targets` (the first
   * `maxAnimatedRowCount`; the rest go with the collapse), then `apply()` the real collapse — core
   * `animateOut` (closing class + inert + --km-exit-height, waits for the CSS animation; 0s → at
   * once). Nothing to animate → `apply()` now.
   */
  private _animateCollapse(targets: string[], apply: () => void): Promise<void> {
    const container = this.containerElement;
    if (!targets.length || !container || !this._isRowAnimationEnabled()) {
      apply();
      return Promise.resolve();
    }
    const sep = this._treePathSeparator || '.';
    const targetSet = new Set(targets);
    const isUnderTarget = (path: string): boolean =>
      getAncestorPaths(path, sep).some((a) => targetSet.has(a));
    const limit = Math.max(0, this._maxAnimatedRowCount ?? 50);
    const hiding: string[] = [];
    for (const n of this.tree.visibleFlatNodes ?? []) {
      if (hiding.length >= limit) break;
      if (isUnderTarget(n.path)) hiding.push(n.path);
    }
    const rowByPath = new Map<string, Element>();
    for (const el of container.querySelectorAll('.wtv__node[data-tree-path]'))
      rowByPath.set(el.getAttribute('data-tree-path')!, el);
    const rows = hiding.map((p) => rowByPath.get(p)).filter((el): el is Element => !!el);
    if (!rows.length) {
      apply();
      return Promise.resolve();
    }
    this.log.UI.debug('Row animation: closing', { targets, rows: rows.length });
    const cleanup = () => {
      for (const t of targets) if (this._closingHandles.get(t)?.handle === handle) this._closingHandles.delete(t);
    };
    const handle: AnimateOutHandle = animateOut(rows, {
      className: 'wtv__node--closing',
      shouldSetInert: true,
      shouldSetHeightVar: true,
      onDone: () => {
        cleanup();
        apply();
      },
    });
    const entry = { handle, apply, targets };
    for (const t of targets) this._closingHandles.set(t, entry);
    return handle.finished.then((isDone) => {
      if (!isDone) cleanup();
    });
  }

  /**
   * Before an expand: settle the pending collapses that involve `paths` (the same node, an
   * ancestor or a descendant; `null` = all). A pending collapse of exactly ONE of these nodes
   * is cancelled — a re-expand mid-animation, it simply stays open. Any other one (e.g. a
   * collapseAll in flight) is applied NOW, so calls keep their order: `collapseAll();
   * expandNodes(x)` ends exactly as it does without motion. Returns whether one was cancelled.
   */
  private _commitPendingCollapses(paths: readonly string[] | null): boolean {
    const sep = this._treePathSeparator || '.';
    const isRelated = (t: string) =>
      paths == null || paths.some((p) => isSelfOrDescendant(p, t, sep) || isSelfOrDescendant(t, p, sep));
    const entries = new Set(this._closingHandles.values());
    let isCancelled = false;
    for (const entry of entries) {
      if (!entry.targets.some(isRelated)) continue;
      const isReExpand = paths != null && entry.targets.length === 1 && paths.includes(entry.targets[0]);
      entry.handle.cancel(); // class + inert off; core's onDone never runs
      for (const t of entry.targets) if (this._closingHandles.get(t) === entry) this._closingHandles.delete(t);
      if (isReExpand) isCancelled = true;
      else entry.apply();
    }
    return isCancelled;
  }

  /** Rows animate: a limit above 0 and a resolved `--wtv-row-animation-duration` above 0s. */
  private _isRowAnimationEnabled(): boolean {
    if ((this._maxAnimatedRowCount ?? 50) <= 0) return false;
    const el = this.containerElement;
    if (!el || typeof getComputedStyle !== 'function') return false;
    const raw = getComputedStyle(el).getPropertyValue('--wtv-row-animation-duration').trim();
    const value = parseFloat(raw);
    return Number.isFinite(value) && value > 0;
  }

  /** Sort the children of each node (one level; '' = root). Returns the orderMember rewrites
   *  (the facade fires `nodes-sort` for them). */
  sortNodes(paths: string | string[], options?: SortOptions<T>): NodesSortContext<T>[] {
    return this._mutate(() => this.tree?.sortNodes(paths, options) ?? []);
  }

  /** Sort whole subtrees (`null` / omitted = the whole tree). Returns the orderMember rewrites. */
  sortAll(paths?: string | string[] | null, options?: SortOptions<T>): NodesSortContext<T>[] {
    return this._mutate(() => this.tree?.sortAll(paths, options) ?? []);
  }

  filterNodes(term: string, searchOptions?: SearchOptions): void {
    this.tree?.filterNodes(term, searchOptions);
  }

  searchNodes(
    term: string | null | undefined,
    searchOptions?: SearchOptions
  ): LTreeNode<T>[] {
    return this.tree?.searchNodes(term, searchOptions) || [];
  }

  getChildren(parentPath: string): LTreeNode<T>[] {
    return this.tree?.getChildren(parentPath) || [];
  }

  getSiblings(path: string): LTreeNode<T>[] {
    return this.tree?.getSiblings(path) || [];
  }

  refreshSiblings(parentPath: string): void {
    this.tree?.refreshSiblings(parentPath);
  }

  /** Re-render the node at `path` (its data object was changed in place). */
  refreshNode(path: string): void {
    const node = this.tree?.getNodeByPath(path);
    if (node) node._rev++;
    this.tree?.refreshNode(path);
  }

  /** Whether the node at `path` accepts drops (`getIsDropAllowedCallback` → `isDropAllowedMember`
   *  → the node flag). `false` for an unknown path. */
  isNodeDropAllowed(path: string): boolean {
    const node = this.tree?.getNodeByPath(path);
    return node ? this.tree.getNodeIsDropAllowed(node) : false;
  }

  /** The Shift-range anchor (Shift+click / Shift+Arrow extend from it); `null` = none.
   *  Writable so an alternative renderer can keep its own range selection in sync. */
  get selectionAnchor(): string | null {
    return this._selection.anchor;
  }

  set selectionAnchor(path: string | null) {
    this._selection.setAnchor(path ?? null);
  }

  /** Toggle the focused node in/out of the selection (Ctrl+click semantics; the anchor
   *  moves to it). Multiple selection mode only; no-op without a selectable focused node. */
  toggleFocusedSelect(): void {
    if (this._selectionMode !== 'multiple') return;
    const node = this._focusedNode;
    if (!node || !node.isSelectable) return;
    this._applySelection(node.path, { isCtrlPressed: true, isShiftPressed: false });
  }

  getNodeByPath(path: string): LTreeNode<T> | null {
    return this.tree?.getNodeByPath(path) || null;
  }

  // ── NodeRef / drag-set helpers (rc07 ctx-object parity) ──────────────

  /**
   * Build the shared { path, node, parent, siblings } pointer for a node the tree
   * already holds — gives on* events and clipboard callbacks the same relational
   * context. Pass the live node (preferred) or just a path (e.g. a pre-removal
   * snapshot, where the node is gone and only the path is known). Missing
   * parent/siblings resolve to null/[].
   */
  nodeRef(nodeOrPath: LTreeNode<T> | string | null): NodeRef<T> {
    const node =
      typeof nodeOrPath === 'string' ? this.tree?.getNodeByPath(nodeOrPath) ?? null : nodeOrPath;
    if (!node) {
      return {
        path: typeof nodeOrPath === 'string' ? nodeOrPath : '',
        node: null,
        parent: null,
        siblings: []
      };
    }
    const parentPath = node.parentPath;
    return {
      path: node.path,
      node,
      parent: parentPath ? this.tree?.getNodeByPath(parentPath) ?? null : null,
      siblings: this.getChildren(parentPath ?? '')
    };
  }

  /**
   * The effective top-level set being dragged: when the grabbed node is part of a
   * same-tree multi-selection, the draggable top-level selected subtrees (the
   * same set the multi-drag move loop uses); otherwise just the grabbed node.
   * Used to populate `dragged` on the drag/drop contexts. Call BEFORE a move
   * mutates the selected set.
   */
  private _draggedTopLevel(draggedNode: LTreeNode<T>): LTreeNode<T>[] {
    const isSameTree = draggedNode.treeId === this._treeId;
    if (
      isSameTree &&
      this._selectedPaths.has(draggedNode.path) &&
      this._selectedPaths.size > 1
    ) {
      const set = this._getTopLevelSelectedPaths()
        .map((p) => this.tree?.getNodeByPath(p) ?? null)
        .filter((n): n is LTreeNode<T> => !!n && this.getNodeIsDraggable(n));
      if (set.length) return set;
    }
    return [draggedNode];
  }

  /**
   * The full top-level dragged set as NodeRefs, correct for BOTH same-tree and
   * cross-tree drags — the single source of `ctx.dragged` on drag start/over/drop.
   * Same-tree reads the live selected set (nodes resolve). Cross-tree can't see
   * the source's selection, so it reads the paths the source published on drag
   * start (getDragSet) and resolves them through the SOURCE tree (registry) — never
   * this one, where the same path may name a different node. Path-only refs
   * (node/parent null) when the source isn't reachable; falls back to the lead node
   * alone when no set was published (e.g. touch). Call BEFORE a move mutates the
   * selected set.
   */
  private _draggedRefs(draggedNode: LTreeNode<T> | null): NodeRef<T>[] {
    if (!draggedNode) return [];
    if (draggedNode.treeId === this._treeId) {
      // A beforeDragStartCallback override is authoritative: resolve its paths
      // directly (bypassing the selection-derived set AND the isDraggable gate,
      // since a forced-in node is the whole point).
      if (this._dragSetOverride) {
        return this._dragSetOverride
          .map((p) => this.tree?.getNodeByPath(p) ?? null)
          .filter((n): n is LTreeNode<T> => !!n)
          .map((n) => this.nodeRef(n));
      }
      return this._draggedTopLevel(draggedNode).map((n) => this.nodeRef(n));
    }
    const set = getDragSet();
    const paths =
      set && set.sourceTreeId === draggedNode.treeId ? set.paths : [draggedNode.path];
    const source = getClipboardTree(draggedNode.treeId ?? '');
    return paths.map((p): NodeRef<T> =>
      (source?.nodeRef?.(p) as NodeRef<T> | undefined) ?? { path: p, node: null, parent: null, siblings: [] });
  }

  /** Normalize a consumer drag manifest (from beforeDragStartCallback): dedupe and
   *  guarantee the lead stays (you can prune siblings but not the node under the
   *  cursor). Descendants are KEPT — moveNodes treats an omitted descendant as a
   *  hole. Order is preserved (= landing order). (svelte-treeview rc13) */
  private _validateDragManifest(paths: string[], leadPath: string): string[] {
    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const p of paths) {
      if (!seen.has(p)) { seen.add(p); deduped.push(p); }
    }
    if (!seen.has(leadPath)) deduped.push(leadPath);
    return deduped;
  }

  // ── Tree editor mutation methods ────────────────────────────────────

  moveNode(
    sourcePath: string,
    targetPath: string,
    position: DropPosition
  ): { success: boolean; error?: string } {
    return this._mutate(() => {
      // Capture the affected path set BEFORE the move: any selected /
      // checked path that is the source itself or a descendant of it needs
      // to be remapped onto the new location. Without this the path Sets
      // keep stale strings after a multi-drag, so the next plain click leaves
      // visually-selected ghosts in the old positions and downstream
      // operations work on dangling paths.
      const sourceNode = this.tree?.getNodeByPath(sourcePath);
      const sep = this._treePathSeparator;
      const collect = (paths: Set<string>): Map<string, string> => {
        const m = new Map<string, string>();
        for (const p of paths) {
          if (isSelfOrDescendant(p, sourcePath, sep)) {
            m.set(p, p.substring(sourcePath.length));
          }
        }
        return m;
      };
      const selectionAffected = collect(this._selectedPaths);
      const checkedAffected = collect(this._checkedPaths);
      const anchorPath = this._selection.anchor;
      const lastSelectedSuffix =
        anchorPath && selectionAffected.has(anchorPath)
          ? selectionAffected.get(anchorPath)
          : undefined;
      const focusedAffectedSuffix =
        this._focusedNode &&
        isSelfOrDescendant(this._focusedNode.path, sourcePath, sep)
          ? this._focusedNode.path.substring(sourcePath.length)
          : undefined;

      const result = this.tree?.moveNode(sourcePath, targetPath, position) || {
        success: false,
        error: 'Tree not initialized'
      };

      if (result.success && sourceNode) {
        const newPath = sourceNode.path; // tree.moveNode mutates this in place
        const remap = (paths: Set<string>, affected: Map<string, string>) => {
          if (affected.size === 0) return;
          for (const [oldP, suffix] of affected) {
            paths.delete(oldP);
            paths.add(newPath + suffix);
          }
        };
        if (selectionAffected.size > 0) {
          const next = new Set(this._selection.values());
          remap(next, selectionAffected);
          this._selection.set(next, { isSilent: true });
          // The moved nodes keep their own `isSelected` flags (same objects, new paths).
          this._syncSelection(false);
        }
        remap(this._checkedPaths, checkedAffected);
        if (lastSelectedSuffix !== undefined) {
          this._selection.setAnchor(newPath + lastSelectedSuffix);
        }
        if (focusedAffectedSuffix !== undefined && this._focusedNode) {
          // _focusedNode is the same node reference; its .path was already
          // updated by tree.moveNode. Nothing extra to do here — the suffix
          // capture above is just a witness that focus belongs to the moved
          // subtree, so we don't need to clear it.
        }
      }

      return result;
    });
  }

  removeNode(
    path: string,
    includeDescendants: boolean = true
  ): { success: boolean; node?: LTreeNode<T>; error?: string } {
    return this._mutate(() => {
      const result = this.tree?.removeNode(path, includeDescendants) || {
        success: false,
        error: 'Tree not initialized'
      };
      return result;
    });
  }

  addNode(
    parentPath: string,
    nodeData: T,
    pathSegment?: string
  ): { success: boolean; node?: LTreeNode<T>; error?: string } {
    return this._mutate(() => {
      const result = this.tree?.addNode(parentPath, nodeData, pathSegment) || {
        success: false,
        error: 'Tree not initialized'
      };
      return result;
    });
  }

  insertNode(
    targetPath: string,
    nodeData: T,
    position: DropPosition
  ): { success: boolean; node?: LTreeNode<T>; error?: string } {
    return this._mutate(() => {
      const result = this.tree?.insertNode(targetPath, nodeData, position) || {
        success: false,
        error: 'Tree not initialized'
      };
      return result;
    });
  }

  updateNode(
    path: string,
    dataUpdates: Partial<T>
  ): { success: boolean; node?: LTreeNode<T>; error?: string } {
    return this._mutate(() => {
      const result = this.tree?.updateNode(path, dataUpdates) || {
        success: false,
        error: 'Tree not initialized'
      };
      return result;
    });
  }

  processChanges(changes: TreeChange<T>[]): ProcessChangesResult {
    return this._mutate(() => {
      const result = this.tree?.processChanges(changes) || { successful: 0, failed: [] };
      return result;
    });
  }

  duplicateNode(
    sourceNode: LTreeNode<T>,
    targetParentPath: string,
    transformData: (data: T, node: LTreeNode<T>, targetParentPath: string) => T | null,
    siblingPath?: string,
    position?: 'before' | 'after'
  ): { success: boolean; rootNode?: LTreeNode<T>; count: number; error?: string } {
    return this._mutate(() => {
      const result = this.tree?.duplicateNode(
        sourceNode, targetParentPath, transformData, siblingPath, position
      ) || { success: false, count: 0, error: 'Tree not initialized' };
      return result;
    });
  }

  /**
   * Expand a set of paths into a COMPLETE manifest: every descendant of every
   * member is added. moveNodes/duplicateNodes treat a manifest as authoritative —
   * a descendant PRESENT rides along, one ABSENT is a hole — so callers that just
   * want whole subtrees (multi-drag, DropGroup routing) must complete their set
   * first, else every unlisted descendant reads as a hole. (svelte-treeview rc13)
   */
  private _getPathsWithDescendants(paths: string[]): string[] {
    if (!this.tree) return paths;
    const set = new Set<string>(paths);
    for (const p of paths) {
      const n = this.tree.getNodeByPath(p);
      if (n) for (const dp of getDescendantPaths(n)) set.add(dp);
    }
    return [...set];
  }

  /**
   * Complete a set of top-level dragged refs into the flattened manifest of live
   * NodeRefs (every descendant included) for beforeDragStartCallback's
   * ctx.dragged. Same-tree only (nodes are live at drag start).
   */
  private _getDraggedRefsWithDescendants(refs: NodeRef<T>[]): NodeRef<T>[] {
    return this._getPathsWithDescendants(refs.map((r) => r.path)).map((p) => this.nodeRef(p));
  }

  /**
   * Batch-move a COMPLETE manifest of nodes under a target, honoring "holes".
   * A descendant ABSENT from the manifest is left behind by re-homing it to its
   * moved root's OLD parent (it physically stays put). Every source is resolved to
   * a live ref up front, so per-move path reassignment can't stale later items.
   * Cross-tree nodes (treeId mismatch) are skipped. Roots (manifest entries whose
   * parent isn't in the manifest) chain in landing order: first at target/position,
   * the rest 'after'. (svelte-treeview rc13)
   */
  moveNodes(
    paths: string[],
    targetPath: string,
    position: DropPosition
  ): { success: boolean; movedNodes: LTreeNode<T>[]; leftBehind: LTreeNode<T>[]; error?: string } {
    return this._mutate(() => this._moveNodes(paths, targetPath, position));
  }

  private _moveNodes(
    paths: string[],
    targetPath: string,
    position: DropPosition
  ): { success: boolean; movedNodes: LTreeNode<T>[]; leftBehind: LTreeNode<T>[]; error?: string } {
    const tree = this.tree;
    if (!tree)
      return { success: false, movedNodes: [], leftBehind: [], error: 'Tree not initialized' };

    const manifest = new Set(paths);
    const resolved = paths
      .map((p) => tree.getNodeByPath(p))
      .filter((n): n is LTreeNode<T> => !!n && n.treeId === this._treeId);
    let allOk = resolved.length === paths.length;

    const roots = resolved.filter((n) => !n.parentPath || !manifest.has(n.parentPath));

    // Holes: a descendant whose PARENT is kept (in the manifest) but which is
    // itself ABSENT is a boundary hole — re-home it to its moved root's OLD parent.
    const holes: { node: LTreeNode<T>; toParent: string }[] = [];
    for (const root of roots) {
      const oldParent = root.parentPath ?? '';
      for (const dp of getDescendantPaths(root)) {
        if (manifest.has(dp)) continue;
        const parent = getParentPath(dp, this._treePathSeparator) ?? '';
        if (!manifest.has(parent)) continue; // parent is also a hole → rides inside it
        const node = tree.getNodeByPath(dp);
        if (node) holes.push({ node, toParent: oldParent });
      }
    }

    const leftBehind: LTreeNode<T>[] = [];
    for (const hole of holes) {
      const r = this.moveNode(hole.node.path, hole.toParent, 'child');
      if (r.success) leftBehind.push(hole.node);
      else allOk = false;
    }

    const movedNodes: LTreeNode<T>[] = [];
    let prevMovedNode: LTreeNode<T> | null = null;
    for (const root of roots) {
      const tp = prevMovedNode ? prevMovedNode.path : targetPath;
      const pos: DropPosition = prevMovedNode ? 'after' : position;
      const r = this.moveNode(root.path, tp, pos);
      if (r.success) {
        prevMovedNode = root; // moveNode mutates in place → root.path is the new path
        movedNodes.push(root);
      } else {
        allOk = false;
      }
    }

    return { success: allOk, movedNodes, leftBehind };
  }

  /**
   * Batch-DUPLICATE a COMPLETE manifest — the copy-side twin of moveNodes. A
   * descendant ABSENT from the manifest is a hole, but a copy has nothing to
   * re-home, so the hole is simply NOT copied. Roots chain in source order under
   * the target; each node's data flows through `transform` (the INPUT transform;
   * return null to skip). `sourceTree` defaults to this tree — pass another tree's
   * Ltree to copy its live nodes in (cross-tree). (svelte-treeview rc13)
   */
  duplicateNodes(
    paths: string[],
    targetPath: string,
    position: DropPosition,
    transform?: (data: T, ctx: NodeTransformContext<T>) => T | null,
    sourceTree?: Ltree<T>,
    outgoing?: (data: T, ctx: NodeTransformContext<T>) => T | null
  ): { success: boolean; copiedNodes: LTreeNode<T>[]; skipped: number; error?: string } {
    const tree = this.tree;
    if (!tree)
      return { success: false, copiedNodes: [], skipped: 0, error: 'Tree not initialized' };
    const src = sourceTree ?? tree;
    const manifest = new Set(paths);

    const resolved = paths.map((p) => src.getNodeByPath(p)).filter((n): n is LTreeNode<T> => !!n);
    const roots = resolved.filter((n) => !n.parentPath || !manifest.has(n.parentPath));
    if (!roots.length)
      return { success: false, copiedNodes: [], skipped: 0, error: 'No source roots resolved' };

    const result = this._mutate(() =>
      this._duplicateSubtrees(
        roots.map((node, index) => ({ node, rootIndex: index })),
        this._leafAwareTarget(targetPath, position),
        position,
        {
          operation: 'copy',
          // An absent descendant is a hole → NOT copied (node + subtree).
          isIncluded: (n) => manifest.has(n.path),
          sourceRef: (n) => this._nodeRefIn(src, n),
          transform: transform ?? null,
          outgoing: outgoing ?? null,
        }
      )
    );
    const copiedNodes = result.copied.filter((n): n is LTreeNode<T> => !!n);
    return {
      success: copiedNodes.length > 0,
      copiedNodes,
      skipped: result.skipped,
      error: copiedNodes.length === 0 ? (result.lastError ?? 'No nodes copied') : undefined
    };
  }

  /** Default INPUT transform for a copy-drop when the consumer supplies no
   *  pasteNodeTransformationCallback: uniquify the id so the duplicate doesn't
   *  collide with the original. */
  private _defaultCopyTransform = (data: T): T => {
    const idKey = this.tree?.idMember || 'id';
    const raw = data as Record<string, unknown>;
    return { ...raw, [idKey]: `${raw[idKey]}_copy_${Date.now()}` } as T;
  };

  /** NodeRef of `node` read off `tree` (another tree for a cross-tree copy); `nodeRef` for
   *  this one. A null node (not reachable — cross-tree paste, a cut source) = a path-only ref. */
  private _nodeRefIn(tree: Ltree<T> | null | undefined, node: LTreeNode<T> | null, path?: string): NodeRef<T> {
    if (!node || !tree) return { path: node?.path ?? path ?? '', node: null, parent: null, siblings: [] };
    if (tree === this.tree) return this.nodeRef(node);
    const parentPath = node.parentPath;
    return {
      path: node.path,
      node,
      parent: parentPath ? (tree.getNodeByPath(parentPath) ?? null) : null,
      siblings: tree.getChildren(parentPath ?? '')
    };
  }

  /** NodeRef of a landing anchor in this tree; `''` = the tree root (node null, siblings =
   *  the top-level nodes). */
  private _anchorRef(path: string): NodeRef<T> {
    if (!path) return { path: '', node: null, parent: null, siblings: this.getChildren('') };
    return this.nodeRef(path);
  }

  /**
   * Leaf-aware landing: a 'child' landing on a node that does not allow 'child' drops
   * (getNodeAllowedDropPositions — e.g. a file) lands beside it, inside its parent. One
   * allowed-positions config governs drag-drop, copy-drop and paste. No restriction = child.
   */
  private _leafAwareTarget(targetPath: string, position: DropPosition): string {
    if (position !== 'child' || targetPath === '') return targetPath;
    const target = this.tree?.getNodeByPath(targetPath);
    if (!target) return targetPath;
    const allowed = this.getNodeAllowedDropPositions(target);
    return allowed && allowed.length > 0 && !allowed.includes('child')
      ? (target.parentPath ?? '')
      : targetPath;
  }

  /**
   * THE subtree insert behind duplicateNodes and pasteNodes (call inside `_mutate`).
   * Duplicates each root with its descendants: the first lands at `targetPath` / `position`
   * ('child' = appended under it; 'before' / 'after' = next to it), the rest chain 'after'
   * the previous copy, so the source order is kept. Each node's data runs through the INPUT
   * transform with a NodeTransformContext: a root sees the anchor + `position`, a descendant
   * its new parent + 'child' (so `target` is always where THIS node lands — batch-aware, it
   * includes nodes added earlier in the same call). `isIncluded` false or a transform
   * returning null skips that node and its subtree. `outgoing` (copy-drop egress) runs first.
   * `skipped` counts the nodes refused (transform null, add failed) — not the descendants
   * that go with them, nor a node `isIncluded` leaves out (a hole is not a failure).
   * (svelte-treeview REVIEW-2026-11-19 §3.4)
   */
  private _duplicateSubtrees(
    roots: { node: LTreeNode<T>; rootIndex: number }[],
    targetPath: string,
    position: DropPosition,
    options: {
      operation: 'copy' | 'cut';
      isIncluded?: (node: LTreeNode<T>) => boolean;
      sourceRef: (node: LTreeNode<T>) => NodeRef<T>;
      transform: ((data: T, ctx: NodeTransformContext<T>) => T | null) | null;
      outgoing?: ((data: T, ctx: NodeTransformContext<T>) => T | null) | null;
    }
  ): { copied: (LTreeNode<T> | null)[]; count: number; skipped: number; lastError?: string } {
    const tree = this.tree;
    const parentPath =
      position === 'child' ? targetPath : (tree.getNodeByPath(targetPath)?.parentPath ?? '');
    const copied: (LTreeNode<T> | null)[] = [];
    let count = 0;
    let skipped = 0;
    let lastError: string | undefined;
    let prevRootPath: string | null = null;

    for (const { node: root, rootIndex } of roots) {
      const siblingPath = prevRootPath ?? (position !== 'child' ? targetPath : undefined);
      const rootPosition: 'before' | 'after' | undefined =
        prevRootPath !== null ? 'after' : position !== 'child' ? (position as 'before' | 'after') : undefined;
      let accepted = 0;
      const wrapped = (data: T, node: LTreeNode<T>, targetParentPath: string): T | null => {
        if (options.isIncluded && !options.isIncluded(node)) return null; // a hole: left out on purpose
        const isRoot = node === root;
        const ctx: NodeTransformContext<T> = {
          operation: options.operation,
          phase: 'input',
          isRoot,
          rootIndex,
          position: isRoot ? position : 'child',
          source: options.sourceRef(node),
          target: this._anchorRef(isRoot ? targetPath : targetParentPath)
        };
        let result: T | null = data;
        // Egress first (the SOURCE tree's output transform, phase 'output'), then the
        // input transform — like the clipboard path (NOTES #21).
        if (options.outgoing) {
          result = options.outgoing(JSON.parse(JSON.stringify(data)) as T, { ...ctx, phase: 'output' });
        }
        if (result != null && options.transform) result = options.transform(result, ctx);
        if (result == null) skipped++;
        else accepted++;
        return result;
      };
      const result = tree.duplicateNode(root, parentPath, wrapped, siblingPath, rootPosition);
      count += result.count;
      skipped += accepted - result.count; // accepted by the transform, but the add failed
      if (result.success && result.rootNode) {
        copied.push(result.rootNode);
        prevRootPath = result.rootNode.path;
      } else {
        copied.push(null);
        lastError = result.error;
      }
    }
    return { copied, count, skipped, lastError };
  }

  /**
   * Execute a beforeDropCallback `DropGroup[]` (content-addressed routing). Each
   * group's paths (whole-subtree roots) are completed to a manifest and moved to
   * the group's target/position via moveNodes; targets + sources are resolved to
   * live refs up front so per-move path reassignment can't stale them. Cross-tree
   * paths (not in this tree) are skipped for the consumer to place. Fires drop once
   * with all placed nodes. (svelte-treeview rc13)
   */
  private _processDropGroups(
    groups: DropGroup[],
    dispatchDrop: (dropped: LTreeNode<T>[] | null) => void
  ): boolean {
    const resolved = groups
      .filter((g) => g?.targetPath && g.paths?.length)
      .map((g) => ({
        targetNode: this.tree?.getNodeByPath(g.targetPath) ?? null,
        targetPath: g.targetPath,
        position: g.position ?? ('child' as DropPosition),
        nodes: g.paths
          .map((p) => this.tree?.getNodeByPath(p) ?? null)
          .filter((n): n is LTreeNode<T> => !!n)
      }));

    const movedNodes: LTreeNode<T>[] = [];
    let allOk = true;
    this._mutate(() => {
      for (const group of resolved) {
        if (!group.nodes.length) continue;
        const manifest = this._getPathsWithDescendants(group.nodes.map((n) => n.path));
        const r = this.moveNodes(manifest, group.targetNode?.path ?? group.targetPath, group.position);
        movedNodes.push(...r.movedNodes);
        if (!r.success) allOk = false;
      }
    });
    dispatchDrop(movedNodes.length ? movedNodes : null);
    return allOk;
  }

  addBranch(parentPath: string, data: T[]): InsertBranchResult<T> {
    return this._mutate(() => {
      const result = this.tree?.addBranch(parentPath, data) || { success: false, count: 0, failed: [], parentNode: null, error: 'Tree not initialized' };
      return result;
    });
  }

  insertBranch(targetPath: string, data: T[], position: DropPosition): InsertBranchResult<T> {
    return this._mutate(() => {
      const result = this.tree?.insertBranch(targetPath, data, position) || { success: false, count: 0, failed: [], parentNode: null, error: 'Tree not initialized' };
      return result;
    });
  }

  replaceBranch(parentPath: string, data: T[]): ReplaceBranchResult<T> {
    return this._mutate(() => {
      const result = this.tree?.replaceBranch(parentPath, data) || { success: false, count: 0, failed: [], parentNode: null, removed: 0, added: 0, error: 'Tree not initialized' };
      return result;
    });
  }

  removeBranch(path: string, keepParent?: boolean): RemoveBranchResult<T> {
    return this._mutate(() => {
      const result = this.tree?.removeBranch(path, keepParent) || { success: false, count: 0, error: 'Tree not initialized' };
      return result;
    });
  }

  getExpandedPaths(): string[] {
    return this.tree?.getExpandedPaths() || [];
  }

  /** Replace the expanded set. `{ isSilent: true }` (property assignment) re-baselines
   *  without announcing `expanded-change`. */
  setExpandedPaths(paths: string[], options?: TreeMutationOptions): void {
    this.tree?.setExpandedPaths(paths);
    this._markExpanded(options?.isSilent);
  }

  getAllData(): T[] {
    return this.tree?.getAllData() || [];
  }

  // ── Selection API (multi-select via Ctrl/Shift+click) ────────────────
  //
  // Three-level selection model (mirrors svelte-treeview rc06+):
  //   - focusedNode     = single focused node (click, arrow keys)
  //   - selectedPaths = multi-select set built by Ctrl/Shift+click
  //   - checkedPaths    = checkbox data state (touched by check/uncheck)
  //
  // When `isCheckboxesShown` is false, every change to `selectedPaths` is
  // mirrored into `checkedPaths` so the form-style checked set still reflects
  // what the user picked via the mouse. With checkboxes visible the two sets
  // stay independent.

  /** Programmatically update the selected set.
   *  - `mode='replace'`: replaces the set with `path`
   *  - `mode='toggle'`: toggles `path` in/out of the set
   *  - `mode='range'`: range-selects from focused node to `path`
   *  Pass `{ isSilent: true }` to skip the `selectionChangeCallback` / mirror callbacks. */
  selectNode(
    path: string,
    mode: SelectMode = 'replace',
    options?: TreeMutationOptions
  ): void {
    const modifiers: SelectionModifiers | undefined =
      mode === 'toggle' ? { isCtrlPressed: true, isShiftPressed: false }
      : mode === 'range' ? { isCtrlPressed: false, isShiftPressed: true }
      : undefined;
    this._applySelection(path, modifiers, options);
    this._markSilentFocus(options);
  }

  /** The focus a silent operation produced (`undefined` = none pending). The
   *  facade swallows exactly that `focus-change` (NOTES #11). */
  private _silentFocusPath: string | null | undefined = undefined;

  private _markSilentFocus(options?: TreeMutationOptions): void {
    // A later non-silent operation (e.g. setSelectedPaths around its internal
    // silent selectNodes) clears the marker so its focus change is emitted.
    this._silentFocusPath = options?.isSilent ? (this._focusedNode?.path ?? null) : undefined;
  }

  /** Consume the silent-focus marker (called by the facade on each state-change). */
  takeSilentFocus(): string | null | undefined {
    const path = this._silentFocusPath;
    this._silentFocusPath = undefined;
    return path;
  }

  /** Add nodes to the selected set (additive — existing selections are kept).
   *  Use setSelectedPaths() to replace the whole set instead.
   *  Pass `{ isSilent: true }` to skip `selectionChangeCallback`. */
  selectNodes(paths: string[], options?: TreeMutationOptions): void {
    const added = paths.filter((path) => this.tree?.getNodeByPath(path)?.isSelectable);
    if (added.length > 0) {
      // Single mode keeps one key (core `set`): the first of the added paths.
      const isSingle = this._selectionMode !== 'multiple';
      this._selection.set(isSingle ? added : [...this._selection.values(), ...added], { isSilent: true });
      this._syncSelection();
      const last = [...added].reverse().find((path) => this._selection.has(path));
      if (last) {
        this._selection.setAnchor(last);
        this._focusedNode = this.tree.getNodeByPath(last) ?? this._focusedNode;
      }
    }
    if (!options?.isSilent) {
      this._dispatchSelectionChange();
      this._reconcileCheckedFromSelection();
    }
    this._markSilentFocus(options);
    this.tree.refresh();
    this._scheduleNotify();
  }

  /** Replace the entire selected set with the given paths.
   *  Equivalent to clearSelection() + selectNodes(paths).
   *  Pass `{ isSilent: true }` to skip `selectionChangeCallback`. */
  setSelectedPaths(paths: string[], options?: TreeMutationOptions): void {
    this._selection.clear({ isSilent: true });
    this._selection.setAnchor(null);
    this.selectNodes(paths, { isSilent: true });
    this._syncSelection();
    if (!options?.isSilent) this._dispatchSelectionChange();
    this._reconcileCheckedFromSelection(options?.isSilent);
    this._markSilentFocus(options);
    this.tree.refresh();
    this._scheduleNotify();
  }

  /** Clear the selection. Pass `paths` to clear only those nodes, or omit to clear all.
   *  Pass `{ isSilent: true }` to skip `selectionChangeCallback`. */
  clearSelection(paths?: string[], options?: TreeMutationOptions): void {
    if (paths && paths.length > 0) {
      const dropped = new Set(paths);
      this._selection.set(this._selection.values().filter((path) => !dropped.has(path)), { isSilent: true });
      const anchor = this._selection.anchor;
      if (anchor && !this._selection.has(anchor)) this._selection.setAnchor(null);
    } else {
      this._selection.clear({ isSilent: true });
      this._selection.setAnchor(null);
      this._focusedNode = null;
    }
    this._syncSelection();
    if (!options?.isSilent) {
      this._dispatchSelectionChange();
      this._reconcileCheckedFromSelection();
    }
    this._markSilentFocus(options);
    this.tree.refresh();
    this._scheduleNotify();
  }

  /** Get all currently selected nodes. */
  getSelectedNodes(): LTreeNode<T>[] {
    const nodes: LTreeNode<T>[] = [];
    for (const path of this._selectedPaths) {
      const node = this.tree?.getNodeByPath(path);
      if (node) nodes.push(node);
    }
    return nodes;
  }

  /** Get a snapshot of the selected-path set. */
  getSelectedPaths(): Set<string> {
    return new Set(this._selectedPaths);
  }

  /** Check if a node is in the selected set. */
  isNodeSelected(path: string): boolean {
    return this._selectedPaths.has(path);
  }

  /** Select every visible selectable node (multiple selection mode only — core
   *  `selectAll` rule). Pass `{ isSilent: true }` to skip `selectionChangeCallback`. */
  selectAll(options?: TreeMutationOptions): void {
    if (this._selectionMode !== 'multiple') return;
    // Visible rows even under rangeSelectionMode 'logical' (whose range order includes collapsed nodes).
    const visible = this.tree?.visibleFlatNodes ?? [];
    this._selection.set(visible.filter((node) => node.isSelectable).map((node) => node.path), { isSilent: true });
    this._syncSelection();
    if (visible.length > 0) {
      this._selection.setAnchor(visible[visible.length - 1].path);
      this._focusedNode = visible[visible.length - 1];
    }
    if (!options?.isSilent) {
      this._dispatchSelectionChange();
      this._reconcileCheckedFromSelection();
    }
    this._markSilentFocus(options);
    this.tree.refresh();
    this._scheduleNotify();
  }

  /** Every node depth-first in display (children) order, ignoring expansion. */
  private _allNodesDepthFirst(): LTreeNode<T>[] {
    const out: LTreeNode<T>[] = [];
    const walk = (node: LTreeNode<T>) => {
      out.push(node);
      for (const child of node.children as LTreeNode<T>[]) walk(child);
    };
    for (const root of this.tree?.tree ?? []) walk(root);
    return out;
  }

  /** The selection's display order (core `getOrderedKeys`) — what a Shift range spans. visual: the
   *  rendered rows (collapsed children excluded); logical: every node depth-first, collapsed
   *  descendants included (NOTES #7 — `tree.tree` is the roots only). */
  private _selectionOrder(): string[] {
    const nodes = this._rangeSelectionMode === 'visual'
      ? (this.tree?.visibleFlatNodes ?? [])
      : this._allNodesDepthFirst();
    return nodes.map((node) => node.path);
  }

  /** Re-read the core selection into the `_selectedPaths` mirror; with `isFlagSync`, flip the
   *  `isSelected` flag (+ `_rev`) of every node that joined or left it. */
  private _syncSelection(isFlagSync = true): void {
    const next = new Set(this._selection.values());
    if (isFlagSync) {
      const flip = (path: string, isSelected: boolean) => {
        const node = this.tree?.getNodeByPath(path);
        if (node) {
          node.isSelected = isSelected;
          node._rev++;
        }
      };
      for (const path of this._selectedPaths) if (!next.has(path)) flip(path, false);
      for (const path of next) if (!this._selectedPaths.has(path)) flip(path, true);
    }
    this._selectedPaths = next;
  }

  /** Core `onChange` (a gesture changed the selection): sync, then report — unless silent. */
  private _onSelectionGesture(): void {
    this._syncSelection();
    if (this._isSelectionSilent) return;
    this._dispatchSelectionChange();
    this._reconcileCheckedFromSelection();
  }

  /** Internal: do the click-driven selection work. Called by both the
   *  click handler (with `modifiers` from the event) and the public
   *  `selectNode(path, mode, options)` (which builds modifiers from
   *  the mode string). Core `click()` rules (SPEC §12.27): plain → only this
   *  node, Ctrl → toggle, Shift → anchor…node range, Ctrl+Shift → range added;
   *  single mode ignores Shift; an unselectable node leaves the selection as it is.
   *  `selection-change` fires only when the selection changed. */
  private _applySelection(
    path: string,
    modifiers?: SelectionModifiers,
    options?: { isSilent?: boolean }
  ): void {
    const node = this.tree?.getNodeByPath(path);
    if (!node) return;

    const ctrl = modifiers?.isCtrlPressed ?? false;
    const shift = modifiers?.isShiftPressed ?? false;
    // Ctrl+click on an unselectable node: nothing (not even focus).
    if (ctrl && !shift && !node.isSelectable) return;

    // Focus first, so a selection-change listener reads the new focus.
    this._focusedNode = node;
    this._isSelectionSilent = options?.isSilent ?? false;
    try {
      this._selection.click(path, { ctrlKey: ctrl, shiftKey: shift });
    } finally {
      this._isSelectionSilent = false;
    }

    this._markSilentFocus(options);
    this.tree.refresh();
    this._scheduleNotify();
  }

  /** Emit the `selectionChangeCallback` callback. */
  private _dispatchSelectionChange(): void {
    this.selectionChangeCb?.({ paths: [...this._selectedPaths], nodes: this.getSelectedNodes() });
  }

  /** Emit the `checkedChangeCallback` callback (checkbox state). */
  private _dispatchCheckedChange(): void {
    if (!this.checkedChangeCb) return;
    const paths = this._computeEmittedCheckedPaths(this._checkedPaths);
    const nodes: LTreeNode<T>[] = [];
    for (const p of paths) {
      const n = this.tree?.getNodeByPath(p);
      if (n) nodes.push(n);
    }
    this.checkedChangeCb({ paths: [...paths], nodes });
  }

  /**
   * Project the canonical checked set through the active `cascadeCheckPolicy` to
   * produce the EMITTED selection. Pure — reads visualState/isChecked off the live
   * tree, never mutates. Independent mode OR 'all' → the canonical set as-is;
   * 'leaves' → only checked leaf nodes; 'rolled-up' → a fully-checked selectable
   * branch collapses to its root (stop descending), indeterminate branches descend
   * to emit their checked bits. (svelte-treeview rc14)
   */
  private _computeEmittedCheckedPaths(canonical: Set<string>): Set<string> {
    if (this._checkboxMode !== 'cascade' || this._cascadeCheckPolicy === 'all' || !this.tree) {
      return new Set(canonical);
    }
    const policy = this._cascadeCheckPolicy;
    const out = new Set<string>();
    const walk = (node: LTreeNode<T>) => {
      const vs = this._computeVisualState(node);
      if (vs === VisualState.unchecked) return;
      const children = node.children;
      const selectable = node.isSelectable !== false;
      if (policy === 'leaves') {
        if (children.length === 0 && node.isChecked && selectable) out.add(node.path);
        for (const child of children) walk(child);
        return;
      }
      // rolled-up: a fully-checked selectable node covers its whole subtree.
      if (vs === VisualState.checked && selectable) {
        out.add(node.path);
        return;
      }
      for (const child of children) walk(child);
    };
    for (const root of this.tree.root.children) walk(root);
    return out;
  }

  /** When `isCheckboxesShown` is false, the selected set IS the checked set —
   *  mirror it onto `_checkedPaths` so consumers reading the bindable
   *  checkbox state see what the user picked via the mouse. With checkboxes
   *  visible the two sets stay independent. Mirrors svelte-treeview rc09. */
  private _reconcileCheckedFromSelection(isSilent = false): void {
    if (this._shouldShowCheckboxes) return;
    this._checkedPaths = new Set(this._selectedPaths);
    if (!isSilent) this._dispatchCheckedChange();
  }

  // ── Checked API (checkbox / data state) ────────────────────────────

  /** Get all checked nodes. */
  getCheckedNodes(): LTreeNode<T>[] {
    const nodes: LTreeNode<T>[] = [];
    for (const path of this._checkedPaths) {
      const node = this.tree?.getNodeByPath(path);
      if (node) nodes.push(node);
    }
    return nodes;
  }

  /** The EMITTED (policy-projected) checkbox set — the minimal cover in cascade
   *  'rolled-up' mode, the leaves in 'leaves', or the full canonical set in 'all' /
   *  independent mode. Use the `checkedPaths` getter for the raw canonical set. */
  getCheckedPaths(): Set<string> {
    return this._computeEmittedCheckedPaths(this._checkedPaths);
  }

  /** Check if a node is in the checked set. */
  isNodeChecked(path: string): boolean {
    return this._checkedPaths.has(path);
  }

  /** checkNode(s) / uncheckNode(s) / an assigned checkedPaths: `paths` plus (cascade
   *  mode) their whole real subtrees, through _setChecked. */
  private _setCheckedWithCascade(paths: string[], isChecked: boolean): boolean {
    const affected = this._checkboxMode === 'cascade' ? this._withCascadeDescendants(paths) : paths;
    return this._setChecked(affected, isChecked);
  }

  /**
   * THE writer of a check / uncheck (checkbox click, checkNode(s), uncheckNode(s), an
   * assigned checkedPaths): sets isChecked on the REAL nodes of `paths` (the caller has
   * already added the cascade descendants), re-derives the cascade states, assigns the
   * canonical set ONCE and mirrors onto the filtered copies. Returns whether the canonical
   * set changed. No event, no refresh. (svelte-treeview parity)
   */
  private _setChecked(paths: string[], isChecked: boolean, isAffectedSynced = false): boolean {
    const prev = this._checkedPaths;
    const next = new Set(prev);
    for (const path of paths) {
      const n = this._getRealNode(path);
      if (!n) continue;
      if (isChecked) next.add(path);
      else next.delete(path);
      n.isChecked = isChecked;
      n._rev++;
    }
    if (this._checkboxMode === 'cascade') {
      this._reconcileCascadeStates(paths, next, isAffectedSynced);
    } else {
      for (const path of paths) {
        const n = this._getRealNode(path);
        if (n) n.visualState = n.isChecked ? VisualState.checked : VisualState.unchecked;
      }
    }
    const isChanged = next.size !== prev.size || [...next].some((p) => !prev.has(p));
    this._checkedPaths = next;
    this._reconcileFilteredCheckState();
    return isChanged;
  }


  /**
   * Reset checkbox state on the whole REAL tree: `isChecked` AND visualState. Walking only
   * the checked set missed indeterminate branches (a [-] branch is never in the canonical
   * set), so `uncheckAll()` / assigning `checkedPaths` left their dash behind.
   * (svelte-treeview REVIEW-2026-11-19 R1)
   */
  private _clearCheckedFlags(): void {
    const root = this.tree?.root;
    if (!root) return;
    const visit = (node: LTreeNode<T>) => {
      if (node.isChecked || node.visualState !== VisualState.unchecked) {
        node.isChecked = false;
        node.visualState = VisualState.unchecked;
        node._rev++;
      }
      for (const child of node.children) visit(child);
    };
    for (const child of root.children) visit(child);
  }

  /** Check a single node (cascades to descendants in cascade mode).
   *  Pass `{ isSilent: true }` to skip `checkedChangeCallback`. */
  checkNode(path: string, options?: TreeMutationOptions): void {
    const changed = this._setCheckedWithCascade([path], true);
    if (changed && !options?.isSilent) this._dispatchCheckedChange();
    this.tree.refresh();
    this._scheduleNotify();
  }

  /** Check multiple nodes (additive — existing checks are kept).
   *  Use setCheckedPaths() to replace the whole set instead.
   *  Pass `{ isSilent: true }` to skip `checkedChangeCallback`. */
  checkNodes(paths: string[], options?: TreeMutationOptions): void {
    const changed = this._setCheckedWithCascade(paths, true);
    if (changed && !options?.isSilent) this._dispatchCheckedChange();
    this.tree.refresh();
    this._scheduleNotify();
  }

  /** Replace the entire checkbox set with the given paths.
   *  Equivalent to uncheckAll() + checkNodes(paths).
   *  Pass `{ isSilent: true }` to skip `checkedChangeCallback`. */
  setCheckedPaths(paths: string[], options?: TreeMutationOptions): void {
    this._clearCheckedFlags();
    this._checkedPaths = new Set();
    this._setCheckedWithCascade(paths, true);
    if (!options?.isSilent) this._dispatchCheckedChange();
    this.tree.refresh();
    this._scheduleNotify();
  }

  /** Check every selectable node. Pass `{ isSilent: true }` to skip
   *  `checkedChangeCallback`. */
  checkAll(options?: TreeMutationOptions): void {
    // While filtered only the visible matches are checked — keep hidden checks.
    const isFiltered = !!this.tree?.isFiltered;
    const newPaths = isFiltered ? new Set(this._checkedPaths) : new Set<string>();
    const traverse = (node: LTreeNode<T>) => {
      if (node.path && node.isSelectable) {
        const real = this._getRealNode(node.path) ?? node;
        real.isChecked = true;
        if (real.visualState !== VisualState.checked) real.visualState = VisualState.checked;
        real._rev++;
        newPaths.add(node.path);
      }
      for (const child of node.children) traverse(child);
    };
    for (const root of this.tree?.tree ?? []) traverse(root);
    this._checkedPaths = newPaths;
    // Branches with hidden unchecked children must fall back to [-] in cascade.
    if (isFiltered && this._checkboxMode === 'cascade') this._reconcileVisualStatesForMode();
    this._reconcileFilteredCheckState();
    if (!options?.isSilent) this._dispatchCheckedChange();
    this.tree.refresh();
    this._scheduleNotify();
  }

  /** Uncheck a single node (cascades to descendants in cascade mode).
   *  Pass `{ isSilent: true }` to skip `checkedChangeCallback`. */
  uncheckNode(path: string, options?: TreeMutationOptions): void {
    const changed = this._setCheckedWithCascade([path], false);
    if (changed && !options?.isSilent) this._dispatchCheckedChange();
    this.tree.refresh();
    this._scheduleNotify();
  }

  /** Uncheck the given nodes (cascades in cascade mode). Pass `{ isSilent: true }`
   *  to skip `checkedChangeCallback`. */
  uncheckNodes(paths: string[], options?: TreeMutationOptions): void {
    if (!paths || paths.length === 0) return;
    const changed = this._setCheckedWithCascade(paths, false);
    if (changed && !options?.isSilent) this._dispatchCheckedChange();
    this.tree.refresh();
    this._scheduleNotify();
  }

  /** Uncheck every node (empty the checked set). Pass `{ isSilent: true }` to skip
   *  `checkedChangeCallback`. */
  uncheckAll(options?: TreeMutationOptions): void {
    this._clearCheckedFlags();
    this._checkedPaths = new Set();
    this._reconcileFilteredCheckState();
    if (!options?.isSilent) this._dispatchCheckedChange();
    this.tree.refresh();
    this._scheduleNotify();
  }

  // ── Focus (single cursor) ────────────────────────────────────────────

  /** Move focus to a node. `{ isSilent: true }` suppresses the resulting
   *  `focus-change` (URL / state restore). */
  focusNode(path: string, options?: TreeMutationOptions): void {
    const node = this.tree?.getNodeByPath(path);
    if (!node) return;
    this._focusedNode = node;
    this._markSilentFocus(options);
    this.tree.refresh();
    this._scheduleNotify();
  }

  /** Clear the focused node. */
  clearFocus(options?: TreeMutationOptions): void {
    this._focusedNode = null;
    this._markSilentFocus(options);
    this.tree.refresh();
    this._scheduleNotify();
  }

  // ── Checkbox toggle (called by the renderer) ─────────────────────────

  /** Handle checkbox toggle. Honors checkboxMode (cascade/independent),
   *  multi-selection bulk toggle, beforeCheckboxToggleCallback interceptor.
   *  Mirrors svelte-treeview rc06+ flow. */
  private _onCheckboxToggle(
    node: LTreeNode<T>,
    options?: { skipFocus?: boolean }
  ): void {
    // While a filter is active, a cascade click acts on the VISIBLE matches only
    // (the filtered copy's children), not the hidden real descendants. The parent's
    // own box still reflects ALL its real children, so it can stay [-] after the
    // click — hence the toggle direction comes from the visible set: all visible
    // descendants checked → uncheck them, otherwise check them. (svelte-treeview parity)
    const isFilteredCascade = this._checkboxMode === 'cascade' && !!this.tree?.isFiltered;
    const visibleDescendants = (path: string): string[] => {
      const copy = this.tree?.getNodeByPath(path);
      return copy ? getDescendantPaths(copy) : [];
    };

    let newChecked: boolean;
    const clickedVisible = isFilteredCascade ? visibleDescendants(node.path) : [];
    if (clickedVisible.length > 0) {
      newChecked = !clickedVisible.every((p) => this._getRealNode(p)?.isChecked);
    } else {
      // In cascade mode, indeterminate → check all (not fully checked yet).
      newChecked =
        this._checkboxMode === 'cascade' && node.visualState === VisualState.indeterminate
          ? true
          : !node.isChecked;
    }

    // Bulk via selection: if the clicked node is in a multi-selection,
    // apply to every selected node.
    const isMultiSelected =
      this._selectedPaths.size > 1 && this._selectedPaths.has(node.path);

    let affectedPaths: string[] = isMultiSelected
      ? [...this._selectedPaths]
      : [node.path];

    if (this._checkboxMode === 'cascade') {
      affectedPaths = this._withCascadeDescendants(affectedPaths, isFilteredCascade);
    }

    // Interceptor: false → cancel, string[] → override affected paths.
    if (this.beforeCheckboxToggleCb) {
      const result = this.beforeCheckboxToggleCb({ node, isChecked: newChecked, affectedPaths });
      if (result === false) return;
      if (Array.isArray(result)) affectedPaths = result;
    }

    // A filtered click checked only the visible part of each branch it touched, so those
    // branches may still have hidden unchecked children — re-derive their isChecked from
    // the REAL children too, so a partial branch lands at [-] and never sits in the
    // canonical checked set.
    this._setChecked(affectedPaths, newChecked, isFilteredCascade);

    if (!options?.skipFocus) this._focusedNode = node;

    // A checkbox toggle is not a node click — `checked-change` reports it.
    this._dispatchCheckedChange();
    this.tree.refresh();
    this._scheduleNotify();
  }

  /** Re-derive every node's visualState + isChecked when checkboxMode changes
   *  at runtime. Switching to 'independent' PROMOTES an indeterminate [-] node to
   *  fully checked; switching to 'cascade' recomputes parent dashes from their
   *  descendants. Without this the indeterminate marker (an imperative DOM prop)
   *  sticks after a mode flip. (svelte-treeview parity — guarded by the ported
   *  e2e/checkbox-mode.spec.ts.) No-op before the tree is built. */
  private _reconcileVisualStatesForMode(): void {
    if (!this.tree?.root) return;
    const cascade = this._checkboxMode === 'cascade';
    const newPaths = new Set<string>(this._checkedPaths);
    let anyChanged = false;
    let checkedChanged = false;
    const visit = (node: LTreeNode<T>) => {
      let vs: VisualState;
      let checkedTouched = false;
      if (cascade) {
        vs = this._computeVisualState(node);
        // Sync isChecked with a definitive computed state (leave indeterminate as-is).
        if (vs !== VisualState.indeterminate) {
          const shouldBeChecked = vs === VisualState.checked;
          if (node.isChecked !== shouldBeChecked) {
            node.isChecked = shouldBeChecked;
            if (shouldBeChecked) newPaths.add(node.path);
            else newPaths.delete(node.path);
            checkedTouched = true;
          }
        }
      } else if (node.visualState === VisualState.indeterminate) {
        // Independent mode has no partial state: promote [-] to fully checked.
        if (!node.isChecked) {
          node.isChecked = true;
          checkedTouched = true;
        }
        newPaths.add(node.path);
        vs = VisualState.checked;
      } else {
        vs = node.isChecked ? VisualState.checked : VisualState.unchecked;
      }
      if (node.visualState !== vs || checkedTouched) {
        node.visualState = vs;
        bumpRev(node);
        anyChanged = true;
        if (checkedTouched) checkedChanged = true;
      }
      for (const child of node.children) visit(child);
    };
    for (const child of this.tree.root.children) visit(child);
    if (checkedChanged) this._checkedPaths = newPaths;
    if (anyChanged) {
      this._reconcileFilteredCheckState();
      this.tree.refresh();
      if (checkedChanged) this._dispatchCheckedChange();
      this._scheduleNotify();
    }
  }

  /**
   * Resolve a path against the REAL (unfiltered) tree. While a filter is active,
   * `tree.getNodeByPath()` returns the filtered COPY, whose `children` hold only the
   * matching subset — checkbox state must live on (and cascade math must see every
   * child of) the real node, or a parent with one visible match reads as fully
   * checked. (svelte-treeview parity)
   */
  private _getRealNode(path: string): LTreeNode<T> | null {
    return this.tree?.getNodeByPath(path, this.tree.root) ?? null;
  }

  /** Mirror isChecked/visualState from the real nodes onto the filtered copies
   *  (bumping `_rev` so the reconciler re-syncs them). No-op when unfiltered. */
  private _reconcileFilteredCheckState(): void {
    if (!this.tree?.isFiltered) return;
    const visit = (copy: LTreeNode<T>) => {
      const real = this._getRealNode(copy.path);
      if (real && real !== copy && (copy.isChecked !== real.isChecked || copy.visualState !== real.visualState)) {
        copy.isChecked = real.isChecked;
        copy.visualState = real.visualState;
        bumpRev(copy);
      }
      for (const child of copy.children) visit(child);
    };
    for (const node of this.tree.tree) visit(node);
  }


  /** `paths` plus every descendant (the cascade set of a check / uncheck). `isVisibleOnly`
   *  (a cascade click while filtered) takes the descendants of the filtered COPY — the
   *  visible matches — instead of the whole real subtree. */
  private _withCascadeDescendants(paths: string[], isVisibleOnly = false): string[] {
    const expanded = new Set(paths);
    for (const path of paths) {
      const n = isVisibleOnly ? (this.tree?.getNodeByPath(path) ?? null) : this._getRealNode(path);
      if (n) for (const dp of getDescendantPaths(n)) expanded.add(dp);
    }
    return [...expanded];
  }

  /**
   * Re-derive visualState for every node a cascade check / uncheck touched AND all their
   * ancestors, deepest first, writing membership changes into `checked`.
   * - The touched nodes themselves: not just the clicked one — a branch BELOW it that was
   *   [-] (root → region → country, one country checked, then the root) gets all its
   *   children checked by the cascade and must flip to checked too.
   * - Ancestors of EVERY touched path, not just of the clicked node: a
   *   beforeCheckboxToggleCallback may add paths elsewhere in the tree, whose parents
   *   must follow too. Each ancestor also syncs isChecked (all children checked → checked).
   * `isAffectedSynced` also syncs isChecked on the touched branches (a filtered click).
   */
  private _reconcileCascadeStates(paths: string[], checked: Set<string>, isAffectedSynced: boolean): void {
    const affected = new Set(paths);
    const nodes = new Map<string, LTreeNode<T>>();
    for (const path of affected) {
      let n = this._getRealNode(path);
      // A collected node's ancestors are collected already — stop climbing there.
      while (n && !nodes.has(n.path)) {
        nodes.set(n.path, n);
        n = n.parentPath ? this._getRealNode(n.parentPath) : null;
      }
    }
    const ordered = [...nodes.values()].sort((a, b) => (b.level ?? 0) - (a.level ?? 0));
    for (const n of ordered) {
      const vs = this._computeVisualState(n);
      let isTouched = n.visualState !== vs;
      n.visualState = vs;
      if (isAffectedSynced || !affected.has(n.path)) {
        const shouldBeChecked = vs === VisualState.checked;
        if (n.isChecked !== shouldBeChecked) {
          n.isChecked = shouldBeChecked;
          isTouched = true;
        }
        if (shouldBeChecked) checked.add(n.path);
        else checked.delete(n.path);
      }
      if (isTouched) n._rev++;
    }
  }

  /** Compute the visualState (checked / unchecked / indeterminate) for a
   *  node based on its descendants' `isChecked`. Leaves use the node's own
   *  `isChecked`. */
  private _computeVisualState(node: LTreeNode<T>): VisualState {
    const children = node.children;
    if (children.length === 0) {
      return node.isChecked ? VisualState.checked : VisualState.unchecked;
    }
    let allChecked = true;
    let noneChecked = true;
    const check = (n: LTreeNode<T>) => {
      if (!allChecked && !noneChecked) return;
      if (n.isChecked) noneChecked = false;
      else allChecked = false;
      for (const child of n.children) {
        if (!allChecked && !noneChecked) return;
        check(child);
      }
    };
    for (const child of children) {
      check(child);
      if (!allChecked && !noneChecked) break;
    }
    if (allChecked) return VisualState.checked;
    if (noneChecked) return VisualState.unchecked;
    return VisualState.indeterminate;
  }

  // ── Navigation API (delegates to the active navigation strategy) ──
  //
  // Every keyboard-navigation method (focus* / extendSelection* / collapseParent / toggleFocusedNodeExpanded) calls through `this._navigation` — the defaults from
  // `createDefaultNavigation()` merged with the consumer's `navigationOverrides`
  // (svelte-treeview parity). The defaults move via `this._navigation.focusAndSelectNode`, so an
  // overridden `focusAndSelectNode` applies to every built-in move.

  /** Navigate to a specific path (selects and focuses it). */
  focusAndSelectNode(path: string): void { this._navigation.focusAndSelectNode(path); }
  /** Navigate to the next visible node. */
  focusNext(): void { this._navigation.focusNext(); }
  /** Navigate to the previous visible node. */
  focusPrevious(): void { this._navigation.focusPrevious(); }
  /** ArrowDown — next visible node at the same level. */
  focusNextAtLevel(): void { this._navigation.focusNextAtLevel(); }
  /** ArrowUp — previous visible node at the same level. */
  focusPreviousAtLevel(): void { this._navigation.focusPreviousAtLevel(); }
  /** ArrowRight — into the first child (expands if collapsed). */
  focusFirstChild(): void { this._navigation.focusFirstChild(); }
  /** ArrowLeft — to the parent (no collapse). */
  focusParent(): void { this._navigation.focusParent(); }
  /** Backspace — collapse the parent and move to it. */
  collapseParent(): void { this._navigation.collapseParent(); }
  /** Enter — toggle expand/collapse on the current node. */
  toggleFocusedNodeExpanded(): void { this._navigation.toggleFocusedNodeExpanded(); }
  /** Home — first visible node. */
  focusFirst(): void { this._navigation.focusFirst(); }
  /** End — last visible node. */
  focusLast(): void { this._navigation.focusLast(); }
  /** PageDown — jump forward ~10 visible nodes. */
  focusNextPage(): void { this._navigation.focusNextPage(); }
  /** PageUp — jump back ~10 visible nodes. */
  focusPreviousPage(): void { this._navigation.focusPreviousPage(); }
  /** Shift+ArrowDown — extend the selection to the next same-level node (multi mode only). */
  extendSelectionNext(): void { this._navigation.extendSelectionNext(); }
  /** Shift+ArrowUp — extend the selection to the previous same-level node (multi mode only). */
  extendSelectionPrevious(): void { this._navigation.extendSelectionPrevious(); }
  /** Shift+Home — extend the selection to the first visible node (multi mode only). */
  extendSelectionToFirst(): void { this._navigation.extendSelectionToFirst(); }
  /** Shift+End — extend the selection to the last visible node (multi mode only). */
  extendSelectionToLast(): void { this._navigation.extendSelectionToLast(); }
  /** Shift+PageDown — extend the selection forward ~10 visible nodes (multi mode only). */
  extendSelectionNextPage(): void { this._navigation.extendSelectionNextPage(); }
  /** Shift+PageUp — extend the selection back ~10 visible nodes (multi mode only). */
  extendSelectionPreviousPage(): void { this._navigation.extendSelectionPreviousPage(); }

  /** (Re)build the active navigation: the defaults with every function-valued
   *  override (for a known method) on top. `null` / `undefined` → defaults only. */
  private _applyNavigationOverrides(overrides: TreeNavigationOverrides<T> | null | undefined): void {
    this._navigationOverrides = overrides ?? null;
    const nav = this.createDefaultNavigation();
    if (overrides) {
      for (const [key, fn] of Object.entries(overrides)) {
        if (typeof fn === 'function' && key in nav) (nav as unknown as Record<string, unknown>)[key] = fn;
      }
    }
    this._navigation = nav;
  }

  /** The default flat-list navigation strategy (used by the DOM renderer). */
  createDefaultNavigation(): TreeNavigation<T> {
    const visible = () => this.tree?.visibleFlatNodes ?? [];
    const indexOfFocused = (flat: LTreeNode<T>[]) => {
      const currentPath = this._focusedNode?.path;
      return currentPath ? flat.findIndex(n => n.path === currentPath) : -1;
    };
    const parentPathOf = (path: string): string | null => {
      const lastSep = path.lastIndexOf(this._treePathSeparator);
      return lastSep > 0 ? path.substring(0, lastSep) : null;
    };
    /** The next (dir 1) / previous (dir -1) visible node at the same level as flat[index]. */
    const sameLevelFrom = (flat: LTreeNode<T>[], index: number, dir: 1 | -1): LTreeNode<T> | null => {
      const level = flat[index].level;
      for (let i = index + dir; i >= 0 && i < flat.length; i += dir) {
        if (flat[i].level === level) return flat[i];
      }
      return null;
    };

    return {
      // Every built-in keyboard move lands here: select + focus, then bring the
      // row into view (block 'nearest' — no scroll when it's already visible).
      focusAndSelectNode: (path: string) => {
        this.selectNode(path);
        this.revealNode(path);
      },

      focusNext: () => {
        const flat = visible();
        if (flat.length === 0) return;
        if (!this._focusedNode) {
          this._navigation.focusAndSelectNode(flat[0].path);
          return;
        }
        const idx = indexOfFocused(flat);
        if (idx >= 0 && idx < flat.length - 1) this._navigation.focusAndSelectNode(flat[idx + 1].path);
      },

      focusPrevious: () => {
        const flat = visible();
        if (flat.length === 0) return;
        if (!this._focusedNode) {
          this._navigation.focusAndSelectNode(flat[flat.length - 1].path);
          return;
        }
        const idx = indexOfFocused(flat);
        if (idx > 0) this._navigation.focusAndSelectNode(flat[idx - 1].path);
      },

      focusNextAtLevel: () => {
        const flat = visible();
        if (flat.length === 0) return;
        const idx = indexOfFocused(flat);
        if (idx === -1) {
          this._navigation.focusAndSelectNode(flat[0].path);
          return;
        }
        const target = sameLevelFrom(flat, idx, 1);
        if (target) this._navigation.focusAndSelectNode(target.path);
      },

      focusPreviousAtLevel: () => {
        const flat = visible();
        if (flat.length === 0) return;
        const idx = indexOfFocused(flat);
        if (idx === -1) {
          this._navigation.focusAndSelectNode(flat[flat.length - 1].path);
          return;
        }
        const target = sameLevelFrom(flat, idx, -1);
        if (target) this._navigation.focusAndSelectNode(target.path);
      },

      focusFirstChild: () => {
        const node = this._focusedNode;
        if (!node || !node.hasChildren) return;
        // visibleFlatNodes updates synchronously — move to the first child.
        const moveIn = () => {
          if (this._focusedNode?.path !== node.path) return; // focus moved while loading
          const flat = visible();
          const idx = flat.findIndex(n => n.path === node.path);
          if (idx >= 0 && idx + 1 < flat.length) this._navigation.focusAndSelectNode(flat[idx + 1].path);
        };
        if (node.isExpanded) {
          moveIn();
          return;
        }
        // Expanding goes through beforeExpandCallback (may be async — lazy load).
        const gated = this._checkBeforeExpand(node, () => this._expandWithEvents([node.path]));
        if (gated instanceof Promise) gated.then((isExpanded) => { if (isExpanded) moveIn(); });
        else if (gated) moveIn();
      },

      // To the parent, no collapse (matches svelte-treeview).
      focusParent: () => {
        const node = this._focusedNode;
        if (!node) return;
        const parentPath = parentPathOf(node.path);
        if (parentPath) this._navigation.focusAndSelectNode(parentPath);
      },

      collapseParent: () => {
        const node = this._focusedNode;
        if (!node) return;
        const parentPath = parentPathOf(node.path);
        if (!parentPath) return;
        // A non-collapsible parent (getNodeIsCollapsible) stays open — only focus moves.
        const parent = this.tree?.getNodeByPath(parentPath);
        if (parent && this.getNodeIsCollapsible(parent)) this.collapseNodes(parentPath);
        this._navigation.focusAndSelectNode(parentPath);
      },

      // Enter / Space = the toggle glyph: accordion, the pending beforeExpand guard,
      // getNodeIsCollapsible and a mid-collapse cancel all apply.
      // (svelte-treeview REVIEW-2026-11-19 B3)
      toggleFocusedNodeExpanded: () => {
        const node = this._focusedNode;
        if (!node || !node.hasChildren) return;
        this.toggleNodeExpanded(node.path);
        this._scheduleNotify();
      },

      focusFirst: () => {
        const flat = visible();
        if (flat.length > 0) this._navigation.focusAndSelectNode(flat[0].path);
      },

      focusLast: () => {
        const flat = visible();
        if (flat.length > 0) this._navigation.focusAndSelectNode(flat[flat.length - 1].path);
      },

      focusNextPage: () => {
        const flat = visible();
        if (flat.length === 0) return;
        const idx = indexOfFocused(flat);
        const target = Math.min((idx === -1 ? 0 : idx) + NAV_PAGE_SIZE, flat.length - 1);
        this._navigation.focusAndSelectNode(flat[target].path);
      },

      focusPreviousPage: () => {
        const flat = visible();
        if (flat.length === 0) return;
        const idx = indexOfFocused(flat);
        const target = Math.max((idx === -1 ? flat.length : idx) - NAV_PAGE_SIZE, 0);
        this._navigation.focusAndSelectNode(flat[target].path);
      },

      // ── Shift+navigation: extend the selected range ─────────────
      extendSelectionNext: () => {
        const flat = visible();
        const idx = indexOfFocused(flat);
        if (idx === -1) return;
        const target = sameLevelFrom(flat, idx, 1);
        if (target) this._extendSelectionTo(target.path);
      },

      extendSelectionPrevious: () => {
        const flat = visible();
        const idx = indexOfFocused(flat);
        if (idx === -1) return;
        const target = sameLevelFrom(flat, idx, -1);
        if (target) this._extendSelectionTo(target.path);
      },

      extendSelectionToFirst: () => {
        const flat = visible();
        if (flat.length > 0) this._extendSelectionTo(flat[0].path);
      },

      extendSelectionToLast: () => {
        const flat = visible();
        if (flat.length > 0) this._extendSelectionTo(flat[flat.length - 1].path);
      },

      extendSelectionNextPage: () => {
        const flat = visible();
        const idx = indexOfFocused(flat);
        if (idx === -1) return;
        this._extendSelectionTo(flat[Math.min(idx + NAV_PAGE_SIZE, flat.length - 1)].path);
      },

      extendSelectionPreviousPage: () => {
        const flat = visible();
        const idx = indexOfFocused(flat);
        if (idx === -1) return;
        this._extendSelectionTo(flat[Math.max(idx - NAV_PAGE_SIZE, 0)].path);
      },
    };
  }

  /** Extend the selected range to `path` (Shift+nav) and move focus there. The
   *  range runs from the Shift anchor (core `selection.anchor` — seeded from the
   *  focused node on the first Shift move; a plain move resets it to the new
   *  node). No-op in single selection mode. */
  private _extendSelectionTo(path: string): void {
    if (this._selectionMode !== 'multiple') return;
    const focused = this._focusedNode;
    if (this._selection.anchor === null && focused) this._selection.setAnchor(focused.path);
    this._applySelection(path, { isCtrlPressed: false, isShiftPressed: true });
    this.revealNode(path);
  }

  /** Bumped per revealNode() call — a newer keyboard move supersedes a pending one. */
  private _revealToken = 0;

  /**
   * Keyboard navigation's scroll-into-view (svelte-treeview's focusAndSelectNode →
   * scrollToPath, but `block: 'nearest'`: scrolls only when the row is off-screen,
   * no highlight, no expand). Virtual scroll: the scroll offset is moved to the
   * row FIRST (nearest edge), so the pending render slices a window that contains
   * it. The DOM step runs after the scheduled render (microtask) and retries over
   * a few frames while progressive rendering hasn't reached the row yet. Mouse
   * clicks don't go through here. Keyboard moves scroll instantly (`'auto'`) —
   * the scroll keeps up with a held key; only a programmatic jump (the paste
   * reveal) passes the `--wtv-scroll-behavior` token.
   */
  /** The scroll behaviour of programmatic jumps (scrollToPath, paste reveal) when the caller passes none:
   *  the `--wtv-scroll-behavior` token (→ `--base-scroll-behavior`; `auto` under reduced motion).
   *  Keyboard moves never read it — they always scroll instantly. */
  private resolveScrollBehavior(): ScrollBehavior {
    const el = this.containerElement;
    if (!el || typeof getComputedStyle === 'undefined') return 'smooth';
    return (getComputedStyle(el).getPropertyValue('--wtv-scroll-behavior').trim() || 'smooth') as ScrollBehavior;
  }

  /**
   * The one gate of every self-initiated scroll (keyboard move, scrollToPath, paste reveal):
   * runs `beforeScrollCallback` with the node, the `source`, the container core finds around
   * the row (null = the page) and the `defaults`. Returns the options to use, or null when the
   * callback skipped the scroll. Virtual scroll passes its `.wtv__tree` (the row may not be
   * rendered yet).
   */
  private _resolveScroll(
    node: LTreeNode<T>,
    source: TreeViewScrollSource,
    container: HTMLElement | null,
    defaults: TreeViewScrollOptions
  ): TreeViewScrollOptions | null {
    if (!this.beforeScrollCb) return defaults;
    const ctx: BeforeScrollContext<T> = { node, path: node.path, source, container, options: { ...defaults } };
    const result = this.beforeScrollCb(ctx);
    if (result === false) {
      this.log.UI.debug('beforeScrollCallback skipped the scroll', { path: node.path, source });
      return null;
    }
    return result && typeof result === 'object' ? { ...defaults, ...result } : defaults;
  }

  /** Bring a rendered row into view through core's container scroll (the row's scroll
   *  container only; with none, the page gets the same request). */
  private _scrollRow(row: HTMLElement, options: TreeViewScrollOptions, container?: HTMLElement | null): void {
    scrollIntoContainer(row, {
      block: options.block,
      inline: options.inline,
      behavior: options.behavior,
      container: container ?? undefined,
      shouldRevealContainer: options.shouldRevealContainer,
    });
  }

  /** Virtual scroll: the `.wtv__tree` box of the row at `index` (content coordinates — it isn't
   *  rendered yet), for core's `getScrollTopForBox` / `scrollContainerToBox`. */
  private _virtualRowBox(index: number): { top: number; height: number } {
    const height = this.resolvedRowHeight;
    return { top: index * height, height };
  }

  revealNode(path: string, behavior: ScrollBehavior = 'auto', source: TreeViewScrollSource = 'keyboard'): void {
    const root = this.containerElement;
    if (!root || typeof requestAnimationFrame === 'undefined') return;
    const token = ++this._revealToken;
    const scrollEl = root.querySelector('.wtv__tree') as HTMLElement | null;
    const defaults: TreeViewScrollOptions = { block: 'nearest', inline: 'nearest', behavior, shouldRevealContainer: false };
    // beforeScrollCallback runs once per reveal: up front in virtual scroll (the index scroll
    // comes first), else when the row is found (with the container core finds around it).
    let options: TreeViewScrollOptions | null | undefined;

    if (this._isVirtualScrollEnabled && scrollEl) {
      const flat = this.allVisibleFlatNodes;
      const idx = flat.findIndex((n) => n.path === path);
      if (idx >= 0) {
        options = this._resolveScroll(flat[idx], source, scrollEl, defaults);
        if (!options) return;
        // Instant (synchronous) index jump; the row's own scroll below applies the behavior.
        if (scrollContainerToBox(scrollEl, this._virtualRowBox(idx), { block: options.block }) !== null) {
          this._vsScrollTop = scrollEl.scrollTop;
          this._scheduleNotify();
        }
      }
    }

    const findRow = (): HTMLElement | null => {
      const nodeEl = root.querySelector(`.wtv__node[data-tree-path="${CSS.escape(path)}"]`);
      return (nodeEl?.querySelector(':scope > .wtv__node-row') ?? nodeEl) as HTMLElement | null;
    };
    let framesLeft = 30;
    const attempt = () => {
      if (token !== this._revealToken) return; // superseded by a newer move
      const row = findRow();
      if (row) {
        if (options === undefined) {
          const node = this.tree.getNodeByPath(path);
          if (!node) return;
          options = this._resolveScroll(node, source, findScrollContainer(row), defaults);
        }
        if (options) this._scrollRow(row, options);
        return;
      }
      if (framesLeft-- > 0) requestAnimationFrame(attempt);
    };
    // After the render the selection change scheduled (a microtask).
    queueMicrotask(() => queueMicrotask(attempt));
  }

  // ── Clipboard API ─────────────────────────────────────────────────

  /** Copy selected nodes (or specified paths) to clipboard. */
  copyNodes(paths?: string[]): void {
    this._captureToClipboard('copy', paths);
  }

  /** Cut selected nodes (or specified paths) to clipboard. Dimmed, not removed until paste. */
  cutNodes(paths?: string[]): void {
    this._captureToClipboard('cut', paths);
  }

  /** copyNodes / cutNodes: before-hook (rewrite the set or block) → snapshot onto the shared
   *  clipboard → the cut dims the nodes + their subtrees (a copy clears the dimming) → event. */
  private _captureToClipboard(operation: 'copy' | 'cut', paths?: string[]): void {
    let pathsToUse = paths ?? [...this._selectedPaths];
    if (pathsToUse.length === 0) return;
    const nodesOf = (list: string[]) =>
      list.map((p) => this.tree.getNodeByPath(p)).filter((n): n is LTreeNode<T> => n !== null);

    // Interceptor: can modify paths (return string[]) or block (false).
    const before = operation === 'copy' ? this.beforeCopyCb : this.beforeCutCb;
    if (before) {
      const result = before({ operation, paths: pathsToUse, nodes: nodesOf(pathsToUse) });
      if (result === false) return;
      if (Array.isArray(result)) pathsToUse = result;
    }

    const entries: ClipboardEntry<T>[] = [];
    const cutSet = new Set<string>();
    pathsToUse.forEach((p, i) => {
      const node = this.tree.getNodeByPath(p);
      if (!node) return;
      entries.push(this._collectClipboardEntry(node, operation, i));
      if (operation === 'cut') {
        cutSet.add(p);
        for (const dp of getDescendantPaths(node)) cutSet.add(dp);
      }
    });
    if (entries.length === 0) return;

    setClipboard<T>({ operation, entries, sourceTreeId: this._treeId });
    this._cutPaths = cutSet;
    this.tree.refresh();
    this._scheduleNotify();
    // Cut only dims — nodes aren't removed until paste — so they're still live here.
    const handler = operation === 'copy' ? this.onCopyCb : this.onCutCb;
    handler?.({ operation, paths: pathsToUse, nodes: nodesOf(pathsToUse) });
  }

  /**
   * Paste clipboard content under (or beside) the target node.
   * @param targetPath   Where to paste ('' = tree root).
   * @param transformData Optional per-node transform (overrides pasteNodeTransformationCallback);
   *                      return null to SKIP a node (skipping a root skips its subtree).
   * @param position     'child' (default), 'before', or 'after'.
   */
  pasteNodes(
    targetPath: string,
    transformData?: ((data: T, ctx: NodeTransformContext<T>) => T | null) | null,
    position: DropPosition = 'child'
  ): PasteResult<T> {
    const clip = getClipboard<T>();
    if (!clip || clip.entries.length === 0) {
      return { success: false, count: 0, skipped: 0, error: 'Clipboard is empty' };
    }
    const operation = clip.operation;
    const sep = this._treePathSeparator;
    const snapshot = (x: T): T => JSON.parse(JSON.stringify(x));

    // Per-paste working copy: the clipboard singleton is never mutated (a copy can
    // be pasted again), so beforePaste + the transform operate on this deep copy.
    const workEntries: ClipboardEntry<T>[] = clip.entries.map((e) => ({
      sourceTreeId: e.sourceTreeId,
      sourcePath: e.sourcePath,
      data: snapshot(e.data),
      descendants: e.descendants.map((d) => ({ relativePath: d.relativePath, data: snapshot(d.data) }))
    }));

    // Leaf-aware: a 'child' paste onto a node that disallows children lands beside it.
    targetPath = this._leafAwareTarget(targetPath, position);

    // Interceptor: batch policy only — redirect target/position or block.
    if (this.beforePasteCb) {
      const result = this.beforePasteCb({
        operation,
        target: {
          path: targetPath,
          node: targetPath ? this.tree.getNodeByPath(targetPath) ?? null : null
        },
        entries: workEntries
      });
      if (result === false) {
        // Blocked by the hook: nothing happened, so no paste event.
        return { success: false, count: 0, skipped: 0, error: 'Paste blocked by beforePasteCallback' };
      }
      if (result && typeof result === 'object') {
        if (result.targetPath !== undefined) targetPath = result.targetPath;
        if (result.position !== undefined) position = result.position;
      }
    }

    // Re-evaluate after possible interceptor override.
    const isRootPaste = targetPath === '';
    const targetNodeAfter = isRootPaste ? null : this.tree.getNodeByPath(targetPath);
    if (!isRootPaste && !targetNodeAfter) {
      const notFound: PasteResult<T> = { success: false, count: 0, skipped: 0, error: `Target node not found: ${targetPath}` };
      this.onPasteCb?.(notFound);
      return notFound;
    }

    // The actual parent the roots land in (its children = the landing siblings).
    const destParentPath = isRootPaste
      ? ''
      : position === 'child'
        ? targetPath
        : targetNodeAfter!.parentPath ?? '';

    const transform = transformData ?? this.inputTransformCb ?? null;
    const sameTree = clip.sourceTreeId === this._treeId;

    // shouldAutoHandlePaste=false: don't touch the tree — forward the (cleaned)
    // working-copy entries to the consumer to place.
    if (!this._shouldAutoHandlePaste) {
      const result: PasteResult<T> = {
        success: true,
        count: workEntries.length,
        skipped: 0,
        entries: workEntries,
        operation,
        targetPath,
        position
      };
      this._cutPaths.clear();
      if (operation === 'cut') clearClipboard();
      this.tree.refresh();
      this._scheduleNotify();
      this.onPasteCb?.(result);
      return result;
    }

    // The snapshot entries as detached node trees (path = the ORIGINAL path, so a same-tree
    // paste's ctx.source resolves the live origin), then the one subtree insert duplicateNodes
    // uses: roots land at target / position and chain in order (before / after used to be
    // ignored — every root was appended to the parent). (svelte-treeview REVIEW B12)
    const roots: { node: LTreeNode<T>; rootIndex: number }[] = [];
    let skipped = 0;
    workEntries.forEach((entry, index) => {
      // Per-entry self-paste guard: skip (don't abort the batch) an entry whose
      // destination is itself or its own descendant.
      if (sameTree && !isRootPaste && isSelfOrDescendant(destParentPath, entry.sourcePath, sep)) {
        skipped++;
        return;
      }
      roots.push({ node: this._snapshotTree(entry), rootIndex: index });
    });

    const pastedSourcePaths: string[] = [];
    let pasted: { copied: (LTreeNode<T> | null)[]; count: number; skipped: number; lastError?: string } = {
      copied: [],
      count: 0,
      skipped: 0
    };
    this._mutate(() => {
      pasted = this._duplicateSubtrees(roots, targetPath, position, {
        operation,
        sourceRef: (n) =>
          this._nodeRefIn(sameTree ? this.tree : null, sameTree ? this.tree.getNodeByPath(n.path) : null, n.path),
        transform
      });
      pasted.copied.forEach((n, i) => {
        if (n) pastedSourcePaths.push(roots[i].node.path);
      });

      // Cut = move: remove only the sources we actually pasted. Same-tree removes
      // directly; cross-tree reaches back to the source tree via the registry.
      if (operation === 'cut') {
        if (sameTree) {
          for (const src of pastedSourcePaths) this.tree.removeNode(src, true);
        } else {
          const source = getClipboardTree(clip.sourceTreeId);
          if (source && source !== this) {
            for (const src of pastedSourcePaths) source.removeNode(src, true);
          }
        }
      }
    });
    const totalCount = pasted.count;
    skipped += pasted.skipped;
    const lastError = pasted.lastError;
    const firstPasted = pasted.copied.find((n): n is LTreeNode<T> => !!n) ?? null;

    // A CUT is one-shot — clear the clipboard; a COPY stays for repeat pastes.
    this._cutPaths.clear();
    if (operation === 'cut') clearClipboard();

    this.tree.refresh();
    this._scheduleNotify();

    // A paste INTO a node: open it and bring the first pasted node into view, so
    // the result isn't hidden under a collapsed parent. 'before' / 'after' land
    // beside a visible node — nothing to open.
    if (position === 'child' && !isRootPaste && firstPasted) {
      if (!targetNodeAfter!.isExpanded) this.expandNodes(targetPath);
      this.revealNode(firstPasted.path, this.resolveScrollBehavior(), 'paste');
    }

    const result: PasteResult<T> = {
      success: totalCount > 0,
      count: totalCount,
      skipped,
      error: totalCount === 0 ? (lastError ?? (skipped > 0 ? 'All nodes skipped' : 'No nodes pasted')) : undefined
    };
    this.onPasteCb?.(result);
    return result;
  }

  /** Cancel cut operation, clear cut visual state. */
  cancelCut(): void {
    if (getClipboardOp() === 'cut') {
      clearClipboard();
    }
    this._cutPaths.clear();
    this.tree.refresh();
    this._scheduleNotify();
  }

  /** Check if clipboard has content. */
  hasClipboardContent(): boolean {
    return hasClipboardFn();
  }

  /** Get clipboard operation type. */
  getClipboardOperation(): 'copy' | 'cut' | null {
    return getClipboardOp();
  }

  /** Paths a keyboard shortcut should act on: the selected set if any, else the
   *  focused node, else empty. Shared by the built-in copy/cut/delete handling. */
  private _shortcutSelectionPaths(): string[] {
    if (this._selectedPaths.size > 0) return [...this._selectedPaths];
    return this._focusedNode ? [this._focusedNode.path] : [];
  }

  /**
   * Programmatic removal of nodes (and their descendants): top-level subtrees only,
   * selection + focus are cleared when anything was removed. No `beforeDeleteCallback`,
   * no `node-delete` (that is the user Delete command, {@link deleteNodes}).
   */
  removeNodes(paths: string[]): { removed: number; failed: number } {
    const targets = getTopLevelPaths(paths ?? [], this._treePathSeparator);
    let removed = 0;
    let failed = 0;
    // One bracket: the clear runs before the reconcile, so selection-change fires once.
    this._mutate(() => {
      for (const p of targets) {
        if (this.removeNode(p, true).success) removed++;
        else failed++;
      }
      if (removed > 0) {
        this.clearSelection();
        this.clearFocus();
      }
    });
    return { removed, failed };
  }

  /**
   * The user **Delete command** (Delete key, context-menu `delete`): defaults to the
   * current selection (selected set, else focused node). Runs `beforeDeleteCallback`
   * first (narrow or block), removes only top-level subtrees, clears selection +
   * focus of anything removed, and fires `onDelete` (`node-delete`) with PRE-REMOVAL
   * node snapshots. Programmatic removal is {@link removeNodes} (no veto, no event).
   */
  deleteNodes(paths?: string[]): { removed: number; blocked: number } {
    let targets = getTopLevelPaths(paths ?? this._shortcutSelectionPaths(), this._treePathSeparator);
    if (targets.length === 0) return { removed: 0, blocked: 0 };

    if (this.beforeDeleteCb) {
      const nodes = targets
        .map((p) => this.tree.getNodeByPath(p))
        .filter((n): n is LTreeNode<T> => n !== null);
      const result = this.beforeDeleteCb({ paths: targets, nodes });
      if (result === false) return { removed: 0, blocked: targets.length };
      if (Array.isArray(result)) targets = getTopLevelPaths(result, this._treePathSeparator);
    }

    // Snapshot targets BEFORE removal so onDelete can hand back resolved nodes.
    const preRemoval = new Map(targets.map((p) => [p, this.tree.getNodeByPath(p)]));

    // Collect the paths that were actually removed — a failure in the middle used to shift
    // `targets.slice(0, removed)` onto the wrong paths. (svelte-treeview REVIEW-2026-11-19 B1)
    const removedPaths: string[] = [];
    this._mutate(() => {
      for (const p of targets) {
        if (this.removeNode(p, true).success) removedPaths.push(p);
      }
      if (removedPaths.length > 0) {
        this.clearSelection();
        this.clearFocus();
      }
    });
    const removed = removedPaths.length;
    const blocked = targets.length - removed;
    if (removed > 0) {
      this.onDeleteCb?.({
        paths: removedPaths,
        nodes: removedPaths
          .map((p) => preRemoval.get(p))
          .filter((n): n is LTreeNode<T> => n != null)
      });
    }
    return { removed, blocked };
  }

  /**
   * Built-in keyboard shortcuts, gated by `isKeyboardShortcutsEnabled` (default
   * on). Returns true when it consumed the event (caller should preventDefault +
   * stop). A consumer `onTreeKeydown` runs BEFORE this, so it can override/suppress.
   * Matched with core `/actions` `matchesShortcut()` ({@link TREE_SHORTCUTS}: exact
   * modifiers); a key typed into a text field inside the tree (`isTypingTarget`) is
   * never taken — it keeps its native text editing.
   */
  handleShortcutKeydown(event: KeyboardEvent): boolean {
    if (!this._isKeyboardShortcutsEnabled || isTypingTarget(event)) return false;
    const is = (command: TreeShortcutCommand) => TREE_SHORTCUTS[command].some((s) => matchesShortcut(event, s));

    if (is('copy')) {
      const p = this._shortcutSelectionPaths();
      if (!p.length) return false;
      this.copyNodes(p);
      return true;
    }
    // Read-only: copy above still works; cut / paste / delete change the data — off.
    if (this._isReadonly) return false;
    if (is('cut')) {
      const p = this._shortcutSelectionPaths();
      if (!p.length) return false;
      this.cutNodes(p);
      return true;
    }
    if (is('paste')) {
      if (!hasClipboardFn()) return false;
      this.pasteNodes(this._focusedNode?.path ?? '', this.inputTransformCb ?? null, 'child');
      return true;
    }
    if (is('delete')) {
      if (!this._shortcutSelectionPaths().length) return false;
      this.deleteNodes();
      return true;
    }
    if (is('cancelCut') && getClipboardOp() === 'cut') {
      this.cancelCut();
      return true;
    }
    return false;
  }

  /**
   * Full keydown entry point for the renderer: runs the consumer `onTreeKeydown`
   * interceptor FIRST (return true to suppress everything), then the built-in
   * shortcuts. Returns true when the event was consumed (caller should
   * preventDefault + stop; skip its own navigation handling).
   */
  handleKeydown(event: KeyboardEvent): boolean {
    if (this.onTreeKeydownCb) {
      const suppressed = this.onTreeKeydownCb({
        event,
        focusedNode: this._focusedNode ?? null,
        selectedNodes: this.getSelectedNodes()
      });
      if (suppressed === true) return true;
    }
    return this.handleShortcutKeydown(event);
  }

  /**
   * Collect a node and all its descendants into a ClipboardEntry. Descendants are
   * parent-first with paths relative to the source node (INCLUDING the leading
   * separator, e.g. ".2" under "1"). The optional copy transform cleans each
   * snapshot before it lands on the shared clipboard — it gets the SAME
   * NodeTransformContext the input transform sees (phase: 'output', target: null).
   */
  /** This tree's `nodeOutputTransformationCallback` over a node leaving it (copy-drop
   *  egress; also called by a TARGET tree for a cross-tree copy-drop through the
   *  clipboard registry). Unchanged data when no output transform is set. */
  transformOutgoing(data: T, ctx: NodeTransformContext<T>): T | null {
    if (!this.outputTransformCb) return data;
    return this.outputTransformCb(data, ctx);
  }

  /** A clipboard entry as a detached node tree for `_duplicateSubtrees` (paths = the original
   *  paths; children in snapshot order — parent-first, so every parent exists first). */
  private _snapshotTree(entry: ClipboardEntry<T>): LTreeNode<T> {
    const sep = this._treePathSeparator;
    const make = (path: string, data: T) => ({ path, data, children: [] }) as unknown as LTreeNode<T>;
    const root = make(entry.sourcePath, entry.data);
    const byRel = new Map<string, LTreeNode<T>>([['', root]]);
    for (const desc of entry.descendants) {
      const parent = byRel.get(desc.relativePath.substring(0, desc.relativePath.lastIndexOf(sep)));
      if (!parent) continue; // malformed entry — no parent to hang it on
      const node = make(entry.sourcePath + desc.relativePath, desc.data);
      parent.children.push(node);
      byRel.set(desc.relativePath, node);
    }
    return root;
  }

  private _collectClipboardEntry(
    node: LTreeNode<T>,
    operation: ClipboardOperation,
    rootIndex = 0
  ): ClipboardEntry<T> {
    const snapshot = (n: LTreeNode<T>, isRoot: boolean): T => {
      const snap = JSON.parse(JSON.stringify(n.data)) as T;
      if (!this.outputTransformCb) return snap;
      return this.outputTransformCb(snap, {
        operation,
        phase: 'output',
        isRoot,
        rootIndex,
        position: null,
        source: this.nodeRef(n),
        target: null
      });
    };

    const descendants: ClipboardEntry<T>['descendants'] = [];
    this._walkDescendants(node, (desc) => {
      // relativePath = everything after sourcePath (keeps the leading separator)
      descendants.push({
        relativePath: desc.path.substring(node.path.length),
        data: snapshot(desc, false)
      });
    });

    return {
      sourceTreeId: this._treeId,
      sourcePath: node.path,
      data: snapshot(node, true),
      descendants
    };
  }

  /** Walk all descendants of a node. */
  private _walkDescendants(node: LTreeNode<T>, callback: (node: LTreeNode<T>) => void): void {
    if (!node.children) return;
    for (const child of node.children) {
      callback(child);
      this._walkDescendants(child, callback);
    }
  }

  /** Open the context menu at the given screen coordinates. Offsets are applied by the renderer via Floating UI. */
  openContextMenu(node: LTreeNode<T>, screenX: number, screenY: number) {
    this._contextMenuNode = node;
    this._contextMenuX = screenX;
    this._contextMenuY = screenY;
    this._isContextMenuOpen = true;
    this._scheduleNotify();
  }

  closeContextMenu() {
    if (!this._isContextMenuOpen && !this._contextMenuNode) return;
    this._isContextMenuOpen = false;
    this._contextMenuNode = null;
    this._scheduleNotify();
  }

  // ── Public Drag-and-Drop API ────────────────────────────────────────

  /** Cancel current drag and reset all state. */
  cancelDrag(): void {
    this.log.DRAG.debug('Drag cancelled via public API');
    this.pointerDragCancel();
  }

  /** Get allowed drop positions for a node */
  getNodeAllowedDropPositions(node: LTreeNode<T>): DropPosition[] | null {
    return this.tree?.getNodeAllowedDropPositions(node) ?? null;
  }

  /** Get whether a node is draggable */
  getNodeIsDraggable(node: LTreeNode<T>): boolean {
    return this.tree?.getNodeIsDraggable(node) ?? true;
  }

  /** Get whether a node is collapsible */
  getNodeIsCollapsible(node: LTreeNode<T>): boolean {
    return this.tree?.getNodeIsCollapsible(node) ?? true;
  }

  /** Calculate drop position from cursor location within an element */
  calculateDropPositionFromEvent(
    event: MouseEvent,
    element: HTMLElement,
    allowedPositions?: DropPosition[] | null
  ): DropPosition {
    const rect = element.getBoundingClientRect();
    // Offset from the row's inline START (the right edge in a right-to-left tree), so the
    // child pad stays on the indent side, matching the logical drop-zone CSS.
    const x = isRtl(element) ? rect.right - event.clientX : event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const width = rect.width;
    const height = rect.height;

    // Convert dropZoneStart to pixels: number = percentage, string = as-is (px or %)
    const dzs = this._dropZoneStart;
    const startPx = typeof dzs === 'number'
      ? (dzs / 100) * width
      : String(dzs).endsWith('px')
        ? parseFloat(String(dzs))
        : (parseFloat(String(dzs)) / 100) * width;

    let idealPosition: DropPosition;
    if (x > startPx) {
      idealPosition = 'child';
    } else if (y < height / 2) {
      idealPosition = 'before';
    } else {
      idealPosition = 'after';
    }

    if (!allowedPositions || allowedPositions.length === 0) {
      return idealPosition;
    }

    if (allowedPositions.includes(idealPosition)) {
      return idealPosition;
    }

    if (allowedPositions.length === 1) {
      return allowedPositions[0];
    }

    if (allowedPositions.includes('before') && allowedPositions.includes('after')) {
      return y < height / 2 ? 'before' : 'after';
    }

    return allowedPositions[0];
  }

  /**
   * Scroll the node at `path` into view. `shouldExpandAncestors` (default true) expands its
   * ancestors first; `shouldHighlight` (default false) flashes the scroll-highlight class;
   * `behavior` / `block` / `inline` are the native ScrollIntoViewOptions (default
   * `--wtv-scroll-behavior` (smooth; auto under reduced motion) / center / nearest). Scrolls the
   * row's scroll container only (core `scrollIntoContainer`); with none, the page gets the same
   * `block`. `shouldRevealContainer` (default true) first brings an off-screen container into the
   * viewport. `beforeScrollCallback` (source `'scroll-to-path'`) can skip or re-align it — a
   * skipped scroll still resolves true. Resolves false when the node or its row isn't found.
   */
  async scrollToPath(
    path: string,
    options?: {
      shouldExpandAncestors?: boolean;
      shouldHighlight?: boolean;
      behavior?: ScrollBehavior;
      block?: ScrollLogicalPosition;
      inline?: ScrollLogicalPosition;
      shouldRevealContainer?: boolean;
    }
  ): Promise<boolean> {
    perf.start(`[${this._treeId}] scrollToPath`);
    const {
      shouldExpandAncestors = true,
      shouldHighlight = false,
      behavior = this.resolveScrollBehavior(),
      block = 'center',
      inline = 'nearest',
      shouldRevealContainer = true
    } = options || {};
    const defaults: TreeViewScrollOptions = { block, inline, behavior, shouldRevealContainer };
    // Resolved once: before the index scroll in virtual scroll, else once the row is found.
    let scroll: TreeViewScrollOptions | null | undefined;

    const node = this.tree.getNodeByPath(path);
    if (!node || !node.id) {
      this.log.UI.warn(`scrollToPath: node not found for path ${path}`);
      perf.end(`[${this._treeId}] scrollToPath`);
      return false;
    }

    if (shouldExpandAncestors && node.parentPath) {
      this.tree.expandNodes(node.parentPath);
      await new Promise<void>(resolve => queueMicrotask(resolve));
    }

    // Virtual scroll: scroll the container by index first, so the rendered window holds the row.
    const vsScrollEl = this._isVirtualScrollEnabled
      ? (this.containerElement?.querySelector('.wtv__tree') as HTMLElement | null)
      : null;
    if (vsScrollEl) {
      const nodeIndex = this.allVisibleFlatNodes.findIndex(n => n.path === path);
      if (nodeIndex >= 0) {
        scroll = this._resolveScroll(node, 'scroll-to-path', vsScrollEl, defaults);
        if (scroll) {
          // Core's box math (SPEC §12.15), clamped to the scroll range; the window follows the
          // container's actual scrollTop.
          scrollContainerToBox(vsScrollEl, this._virtualRowBox(nodeIndex), { block: scroll.block });
          this._vsScrollTop = vsScrollEl.scrollTop;
          // Synchronous flush — renderer reconciles the visible window immediately,
          // so the target node element is in the DOM before we query for it below.
          // This also prevents race conditions when scrollToPath is called rapidly.
          this._flushNotify();
        }
      }
    }

    const elementId = rowDomId(this._treeId, path);
    const rootEl = this.containerElement;
    const findContent = (): HTMLElement | null => {
      // Find the row by PATH (unique); the element id (also path-derived) is only
      // the fallback without a root.
      const el = rootEl
        ? rootEl.querySelector(`.wtv__node[data-tree-path="${CSS.escape(path)}"]`)
        : document.getElementById(elementId);
      return (el?.querySelector('.wtv__node-content') as HTMLElement | null) ?? null;
    };
    // Progressive flat rendering adds newly-revealed rows in rAF-deferred
    // batches (initialBatchSize, doubling each step). After expandNodes and
    // the microtask flush above, the immediate batch is in DOM but rows past
    // that batch arrive over subsequent frames. Retry across up to ~6 frames
    // before giving up — without this, scrollToPath silently no-ops on any
    // target that lands past the first batch.
    let contentDiv = findContent();
    if (!contentDiv) {
      for (let i = 0; i < 6 && !contentDiv; i++) {
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
        contentDiv = findContent();
      }
    }

    if (!contentDiv) {
      perf.end(`[${this._treeId}] scrollToPath`);
      // Skipped by beforeScrollCallback in virtual scroll: the node exists, its row just isn't
      // in the rendered window — found, nothing to highlight.
      if (scroll === null) return true;
      this.log.UI.warn(`scrollToPath: no rendered row for ${path} (${elementId})`);
      return false;
    }

    // Let a running progressive render finish first (bounded, ~1 s): rows it still inserts move
    // the target, and WebKit cancels a smooth scroll whose content changes mid-glide, so the jump
    // stopped short (the row stayed off-screen). The scroll then starts against the final layout.
    if (!vsScrollEl && (this.flatRenderQueue.length > 0 || this.flatRenderAnimationFrame !== null)) {
      for (let i = 0; i < 60 && (this.flatRenderQueue.length > 0 || this.flatRenderAnimationFrame !== null); i++) {
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
      }
      await new Promise<void>(resolve => queueMicrotask(resolve));
      contentDiv = findContent() ?? contentDiv;
    }

    if (scroll === undefined) scroll = this._resolveScroll(node, 'scroll-to-path', findScrollContainer(contentDiv), defaults);
    if (scroll) this._scrollRow(contentDiv, scroll, vsScrollEl);

    if (shouldHighlight && this._scrollHighlightClass) {
      if (this.currentSelection) {
        this.currentSelection.element.classList.remove(this._scrollHighlightClass);
        clearTimeout(this.currentSelection.timeoutId);
        this.currentSelection = null;
      }

      contentDiv.classList.add(this._scrollHighlightClass);
      const highlightClass = this._scrollHighlightClass;
      const timeoutId = setTimeout(() => {
        contentDiv.classList.remove(highlightClass);
        this.currentSelection = null;
      }, this._scrollHighlightTimeout);

      this.currentSelection = { element: contentDiv, timeoutId };
    }

    perf.end(`[${this._treeId}] scrollToPath`);
    return true;
  }

  // ── setOptions / getOptions (rulebook C-CA-39) ──────────────────────

  /** Apply `isInternalSearchIndexEnabled` (null → default true) / `initializeIndexCallback`
   *  (null clears; undefined = unchanged). True when either changed — the LTree is rebuilt. */
  private _applyIndexProps(updates: Partial<TreeViewStateOptions<T>>): boolean {
    let isChanged = false;
    if (updates.isInternalSearchIndexEnabled !== undefined) {
      const next = updates.isInternalSearchIndexEnabled ?? true;
      if (next !== this._isInternalSearchIndexEnabled) { this._isInternalSearchIndexEnabled = next; isChanged = true; }
    }
    if (updates.initializeIndexCallback !== undefined) {
      const next = updates.initializeIndexCallback ?? undefined;
      if (next !== this._initializeIndexCallback) { this._initializeIndexCallback = next; isChanged = true; }
    }
    return isChanged;
  }

  /** The merged options: the constructor's (missing keys = the element's defaults) + every `setOptions()` since.
   *  The live object — read it, change it only through `setOptions(partial)`. State changed by the user or by a
   *  method (expand, select, search typed in …) is read from the state itself, not from here. */
  getOptions(): Readonly<TreeViewStateOptions<T>> {
    return this._options;
  }

  /**
   * Merge `updates` into the current options and apply only what changed (rulebook C-CA-39: the one way the
   * state takes settings after construction). A key that is absent or `undefined` is left unchanged; `null`
   * clears a nullable option. `TreeViewEngine.setOptions()` calls it with its full mapped options.
   */
  setOptions(updates: Partial<TreeViewStateOptions<T>>) {
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) (this._options as unknown as Record<string, unknown>)[key] = value;
    }
    {
      const has = (k: string) => k in updates;
      this.log.INIT.debug('setOptions: node classes',
        'focusedNodeClass:', has('focusedNodeClass') ? JSON.stringify((updates as any).focusedNodeClass) : '(absent)',
        '| selectedNodeClass:', has('selectedNodeClass') ? JSON.stringify((updates as any).selectedNodeClass) : '(absent)',
        '| checkedNodeClass:', has('checkedNodeClass') ? JSON.stringify((updates as any).checkedNodeClass) : '(absent)');
    }
    // Check if any LTree-baked member mapping / structural callback changed —
    // only THAT requires tearing down and rebuilding the tree.
    //
    // A2 value-compare guard: the web-component's buildConfig() resends EVERY
    // set member + callback on ANY property change (it has no per-key dirty
    // tracking), so a plain `updates.X !== undefined` presence check fired a
    // full LTree recreation + insertArray (fresh node objects, wasted work) on
    // purely cosmetic changes like flipping a theme class. We instead compare
    // each incoming value against the one currently baked into this.tree and
    // only recreate on a real change. References are stable across resends
    // (buildConfig copies the stored field, it does not rebuild closures), so
    // identity compare is sound for callbacks and string compare for members.
    // `changed(x, cur)` is false when x is undefined (key absent from updates).
    // isSortingEnabled is a live flag on the tree (consulted per operation) — set it before
    // any re-insert below; switching it back on re-sorts the whole tree once (at the end).
    let isSortingReenabled = false;
    if (updates.isSortingEnabled !== undefined) {
      const next = updates.isSortingEnabled !== false;
      isSortingReenabled = next && !this._isSortingEnabled;
      this._isSortingEnabled = next;
      if (this.tree) this.tree.isSortingEnabled = next;
    }
    const t = this.tree;
    const changed = <V>(next: V | undefined, current: V): boolean =>
      next !== undefined && next !== current;
    const indexChanged = this._applyIndexProps(updates);
    const needsTreeRecreation =
      changed(updates.idMember, t.idMember) ||
      changed(updates.pathMember, t.pathMember) ||
      changed(updates.parentPathMember, t.parentPathMember) ||
      changed(updates.levelMember, t.levelMember) ||
      changed(updates.hasChildrenMember, t.hasChildrenMember) ||
      changed(updates.isExpandedMember, t.isExpandedMember) ||
      changed(updates.isSelectableMember, t.isSelectableMember) ||
      changed(updates.isCheckedMember, t.isCheckedMember) ||
      changed(updates.isDraggableMember, t.isDraggableMember) ||
      changed(updates.isDropAllowedMember, t.isDropAllowedMember) ||
      changed(updates.allowedDropPositionsMember, t.allowedDropPositionsMember) ||
      changed(updates.displayValueMember, t.displayValueMember) ||
      changed(updates.searchValueMember, t.searchValueMember) ||
      changed(updates.isCollapsibleMember, t.isCollapsibleMember) ||
      changed(updates.orderMember, t.orderMember) ||
      changed(updates.getDisplayValueCallback, t.getDisplayValueCallback) ||
      changed(updates.getSearchValueCallback, t.getSearchValueCallback) ||
      changed(updates.getIsDraggableCallback, t.getIsDraggableCallback) ||
      changed(updates.getIsExpandedCallback, t.getIsExpandedCallback) ||
      changed(updates.getIsSelectableCallback, t.getIsSelectableCallback) ||
      changed(updates.getIsCheckedCallback, t.getIsCheckedCallback) ||
      changed(updates.getIsDropAllowedCallback, t.getIsDropAllowedCallback) ||
      changed(updates.getIsCollapsibleCallback, t.getIsCollapsibleCallback) ||
      changed(updates.getAllowedDropPositionsCallback, t.getAllowedDropPositionsCallback) ||
      changed(updates.sortCallback, t.sortCallback) ||
      // Compared as the LTree reads them (the element resends `isSorted: false` / the indexer
      // defaults with every batch; the tree may hold `undefined`) — else every batch rebuilds.
      (updates.isSorted !== undefined && !!updates.isSorted !== !!t.isSorted) ||
      // A new separator re-reads every path (the setter alone switched it without rebuilding).
      (updates.treePathSeparator !== undefined && (updates.treePathSeparator || '.') !== (t.treePathSeparator || '.')) ||
      (updates.indexerBatchSize !== undefined &&
        (updates.indexerBatchSize || DEFAULT_INDEXER_BATCH_SIZE) !== (this._indexerBatchSize || DEFAULT_INDEXER_BATCH_SIZE)) ||
      (updates.indexerTimeout !== undefined && (updates.indexerTimeout || 50) !== (this._indexerTimeout || 50)) ||
      indexChanged;
    if (updates.indexerBatchSize !== undefined) this._indexerBatchSize = updates.indexerBatchSize ?? undefined;
    if (updates.indexerTimeout !== undefined) this._indexerTimeout = updates.indexerTimeout ?? undefined;
    // A new expand / checked mapping is a request for the data's seed, not the kept state.
    const isExpansionReseeded =
      changed(updates.isExpandedMember, t.isExpandedMember) ||
      changed(updates.getIsExpandedCallback, t.getIsExpandedCallback);
    const isCheckedReseeded =
      changed(updates.isCheckedMember, t.isCheckedMember) ||
      changed(updates.getIsCheckedCallback, t.getIsCheckedCallback);

    // expandLevel is baked into the LTree's construction closure, so a real
    // change can only take effect by recreating the tree. Unlike a member
    // change (where we PRESERVE the user's expand/collapse state across the
    // rebuild), an explicit expandLevel change is a request to RE-SEED
    // expansion at that level — so when it changes we let the fresh insert's
    // seed stand instead of restoring the previous expanded set.
    const expandLevelChanged =
      updates.expandLevel !== undefined && (updates.expandLevel ?? null) !== (this._expandLevel ?? null);
    if (updates.expandLevel !== undefined) this._expandLevel = updates.expandLevel ?? null;

    if (updates.treeId !== undefined) this._setTreeId(updates.treeId || this._treeId);
    if (updates.treePathSeparator !== undefined)
      this.treePathSeparator = updates.treePathSeparator ?? '.';
    if (updates.focusedNode !== undefined) this._focusedNode = updates.focusedNode;
    if (updates.selectedPaths !== undefined) {
      this._selection.set(updates.selectedPaths ?? [], { isSilent: true });
      this._syncSelection();
    }
    if (updates.checkedPaths !== undefined)
      this._checkedPaths = new Set(updates.checkedPaths);
    if (updates.selectionMode !== undefined)
      this._selectionMode = updates.selectionMode ?? 'single';
    if (updates.navigationOverrides !== undefined && (updates.navigationOverrides ?? null) !== this._navigationOverrides)
      this._applyNavigationOverrides(updates.navigationOverrides);
    if (updates.isCheckboxesShown !== undefined) {
      this._shouldShowCheckboxes = updates.isCheckboxesShown ?? false;
      this._updateNodeConfig();
    }
    if (updates.checkboxMode !== undefined) {
      const nextMode = updates.checkboxMode ?? 'independent';
      if (nextMode !== this._checkboxMode) {
        this._checkboxMode = nextMode;
        // Re-derive visual states so a runtime mode flip repaints indeterminate
        // dashes (svelte-treeview parity). No-op before the tree is built.
        this._reconcileVisualStatesForMode();
      }
    }
    if (updates.cascadeCheckPolicy !== undefined) {
      const nextPolicy = updates.cascadeCheckPolicy ?? 'rolled-up';
      if (nextPolicy !== this._cascadeCheckPolicy) {
        this._cascadeCheckPolicy = nextPolicy;
        this._dispatchCheckedChange(); // re-project the unchanged canonical set
      }
    }
    if (updates.shouldClickToggleCheckbox !== undefined)
      this._shouldClickToggleCheckbox = updates.shouldClickToggleCheckbox ?? false;
    if (updates.beforeCheckboxToggleCallback !== undefined)
      this.beforeCheckboxToggleCb = updates.beforeCheckboxToggleCallback;
    if (updates.onIndexProgress !== undefined) this.indexProgressCb = updates.onIndexProgress;
    if (updates.onSearchStatusChange !== undefined) this.searchStatusCb = updates.onSearchStatusChange;
    // Filter settings first (each re-applies the active filter), then a new term.
    if (updates.maxSearchResultCount !== undefined) this.maxSearchResultCount = updates.maxSearchResultCount ?? undefined;
    if (updates.filterScope !== undefined) this.filterScope = updates.filterScope ?? 'matches';
    if (updates.filterDescendantDepth !== undefined) this.filterDescendantDepth = updates.filterDescendantDepth ?? 1;
    if (updates.shouldExpandFilterDescendants !== undefined)
      this.shouldExpandFilterDescendants = updates.shouldExpandFilterDescendants ?? true;
    if (updates.searchTerm !== undefined && updates.searchTerm !== this._searchText) this.searchTerm = updates.searchTerm;
    if (updates.isLoading !== undefined) this._isLoading = updates.isLoading ?? false;
    if (updates.bodyClass !== undefined) this._bodyClass = updates.bodyClass;

    if (updates.clickBehavior !== undefined)
      this._clickBehavior = updates.clickBehavior ?? 'expand-and-focus';
    if (updates.shouldExpandAsAccordion !== undefined)
      this._shouldExpandAsAccordion = updates.shouldExpandAsAccordion ?? false;
    if (updates.iconSet !== undefined)
      this._iconSet = updates.iconSet ?? 'chevron';
    if (updates.leafIconClass !== undefined)
      this._leafIconClass = updates.leafIconClass ?? 'wtv__toggle-icon--leaf-none';
    if (updates.toggleIconMode !== undefined)
      this._toggleIconMode = updates.toggleIconMode ?? 'rotate';
    if (updates.selectedNodeClass !== undefined)
      this._selectedNodeClass = updates.selectedNodeClass;
    if (updates.focusedNodeClass !== undefined)
      this._focusedNodeClass = updates.focusedNodeClass;
    else if ('focusedNodeClass' in updates)
      this.log.INIT.debug('focusedNodeClass: undefined keeps the current value', JSON.stringify(this._focusedNodeClass));
    if (updates.checkedNodeClass !== undefined)
      this._checkedNodeClass = updates.checkedNodeClass;
    if (updates.dragOverNodeClass !== undefined)
      this._dragOverNodeClass = updates.dragOverNodeClass;
    if (updates.draggedNodeClass !== undefined)
      this._draggedNodeClass = updates.draggedNodeClass;
    if (updates.isNodeTooltipsShown !== undefined)
      this._shouldShowNodeTooltips = updates.isNodeTooltipsShown ?? false;
    if (updates.getNodeTooltipCallback !== undefined)
      this._getNodeTooltipCallback = updates.getNodeTooltipCallback;
    if (updates.tooltipPlacement !== undefined)
      this._tooltipPlacement = updates.tooltipPlacement ?? 'top-start';
    if (updates.tooltipDelay !== undefined)
      this._tooltipDelay = updates.tooltipDelay ?? { show: 400, hide: 100 };
    if (updates.tooltipOffset !== undefined)
      this._tooltipOffset = updates.tooltipOffset ?? 8;
    if (updates.shouldTooltipFollowCursor !== undefined)
      this._tooltipFollowCursor = updates.shouldTooltipFollowCursor ?? false;
    if (updates.dropZoneMode !== undefined)
      this._dropZoneMode = updates.dropZoneMode ?? 'glow';
    if (updates.dropZoneLayout !== undefined)
      this._dropZoneLayout = updates.dropZoneLayout ?? 'around';
    if (updates.dropZoneStart !== undefined)
      this._dropZoneStart = updates.dropZoneStart ?? 33;
    if (updates.dropZoneMaxWidth !== undefined)
      this._dropZoneMaxWidth = updates.dropZoneMaxWidth ?? '120px';
    if (updates.isCopyAllowed !== undefined) this._isCopyAllowed = updates.isCopyAllowed ?? false;
    if (updates.shouldAutoHandleCopy !== undefined)
      this._shouldAutoHandleCopy = updates.shouldAutoHandleCopy ?? true;
    if (updates.shouldAutoHandleMove !== undefined)
      this._shouldAutoHandleMove = updates.shouldAutoHandleMove ?? true;
    if (updates.shouldAutoHandlePaste !== undefined)
      this._shouldAutoHandlePaste = updates.shouldAutoHandlePaste ?? true;
    if (updates.isKeyboardShortcutsEnabled !== undefined)
      this._isKeyboardShortcutsEnabled = updates.isKeyboardShortcutsEnabled ?? true;
    if (updates.isReadonly !== undefined)
      this._isReadonly = updates.isReadonly ?? false;
    if (updates.touchDragDelay !== undefined)
      this._touchDragDelay = updates.touchDragDelay ?? 300;
    if (updates.shouldIndicateUndraggable !== undefined)
      this._shouldIndicateUndraggable = updates.shouldIndicateUndraggable ?? true;
    if (updates.isTreeDropZoneEnabled !== undefined)
      this._shouldEnableTreeDropZone = updates.isTreeDropZoneEnabled ?? false;
    if (updates.dragDropMode !== undefined)
      this._dragDropMode = updates.dragDropMode ?? 'none';
    if (updates.scrollHighlightTimeout !== undefined)
      this._scrollHighlightTimeout = updates.scrollHighlightTimeout ?? 4000;
    if (updates.scrollHighlightClass !== undefined)
      this._scrollHighlightClass = updates.scrollHighlightClass ?? 'wtv__node-content--scroll-highlight';
    if (updates.contextMenuXOffset !== undefined)
      this._contextMenuXOffset = updates.contextMenuXOffset ?? 8;
    if (updates.contextMenuYOffset !== undefined)
      this._contextMenuYOffset = updates.contextMenuYOffset ?? 0;

    // Flat / progressive rendering inputs apply at runtime too (NOTES #9).
    if (updates.flatIndentSize !== undefined)
      this._flatIndentSize = updates.flatIndentSize ?? 'var(--wtv-indent-size)';
    if (updates.initialBatchSize !== undefined) this._initialBatchSize = updates.initialBatchSize ?? 20;
    if (updates.maxBatchSize !== undefined) this._maxBatchSize = updates.maxBatchSize ?? 500;
    if (updates.maxAnimatedRowCount !== undefined) this._maxAnimatedRowCount = updates.maxAnimatedRowCount ?? 50;
    const nextProgressive = updates.isProgressiveRenderEnabled !== undefined ? (updates.isProgressiveRenderEnabled ?? true) : this._isProgressiveRenderEnabled;
    if (nextProgressive !== this._isProgressiveRenderEnabled) {
      this._isProgressiveRenderEnabled = nextProgressive;
      // Switching at runtime: show what is visible now (no re-batching of rows
      // the user already sees); later inserts batch as usual.
      if (this.flatRenderAnimationFrame) {
        cancelAnimationFrame(this.flatRenderAnimationFrame);
        this.flatRenderAnimationFrame = null;
      }
      this.flatRenderQueue = [];
      this.flatRenderedIds = new Set((this.tree?.visibleFlatNodes ?? []).map((n) => n.path));
      this.lastFlatNodesTracker = this.tree?.changeTracker;
      this._completeRenderPass();
    }

    // Display-value fallback — mutable on the tree (member → callback → fallback).
    // A change re-renders the fallback labels; since the DOM renderer diffs on
    // data-rev, bump revs of the visible nodes so they repaint. (No recreation:
    // it's not a baked member.) Applied before any recreation below, so a rebuild
    // reads the updated value through createLTree's opts.
    if (updates.displayValueFallback !== undefined && this.tree) {
      const nextFallback = updates.displayValueFallback ?? '[N/A]';
      if (this.tree.displayValueFallback !== nextFallback) {
        this.tree.displayValueFallback = nextFallback;
        for (const n of this.tree.visibleFlatNodes ?? []) bumpRev(n);
      }
    }

    // Per-node icons
    if (updates.iconMember !== undefined) this._iconMember = updates.iconMember ?? undefined;
    if (updates.iconCallback !== undefined) this._iconCallback = updates.iconCallback;
    if (updates.iconColorMember !== undefined) this._iconColorMember = updates.iconColorMember ?? undefined;
    if (updates.iconColorCallback !== undefined) this._iconColorCallback = updates.iconColorCallback;
    if (updates.shouldAlignNodeIcons !== undefined) this._shouldAlignNodeIcons = updates.shouldAlignNodeIcons ?? true;

    // Virtual scroll
    if (updates.isVirtualScrollEnabled !== undefined) this._isVirtualScrollEnabled = updates.isVirtualScrollEnabled ?? false;
    if (updates.virtualScrollItemHeight !== undefined) this._virtualRowHeight = updates.virtualScrollItemHeight;
    if (updates.virtualScrollOverscan !== undefined) this._virtualOverscan = updates.virtualScrollOverscan ?? 5;
    if (updates.virtualScrollContainerHeight !== undefined) this._virtualContainerHeight = updates.virtualScrollContainerHeight;

    // Multi-select
    if (updates.rangeSelectionMode !== undefined) this._rangeSelectionMode = updates.rangeSelectionMode ?? 'visual';
    if (updates.onCheckedChange !== undefined) this.checkedChangeCb = updates.onCheckedChange;
    if (updates.onSelectionChange !== undefined) this.selectionChangeCb = updates.onSelectionChange;

    // Callbacks
    if (updates.onNodeClick !== undefined) this.nodeClickedCb = updates.onNodeClick;
    if (updates.onNodeDoubleClick !== undefined) this.onNodeDoubleClickCb = updates.onNodeDoubleClick;
    if (updates.beforeExpandCallback !== undefined) this.beforeExpandCb = updates.beforeExpandCallback;
    if (updates.onNodeExpand !== undefined) this.nodeExpandCb = updates.onNodeExpand;
    if (updates.onNodeCollapse !== undefined) this.nodeCollapseCb = updates.onNodeCollapse;
    if (updates.beforeCopyCallback !== undefined) this.beforeCopyCb = updates.beforeCopyCallback;
    if (updates.beforeCutCallback !== undefined) this.beforeCutCb = updates.beforeCutCallback;
    if (updates.beforePasteCallback !== undefined) this.beforePasteCb = updates.beforePasteCallback;
    if (updates.beforeDeleteCallback !== undefined) this.beforeDeleteCb = updates.beforeDeleteCallback;
    if (updates.onCopy !== undefined) this.onCopyCb = updates.onCopy;
    if (updates.onCut !== undefined) this.onCutCb = updates.onCut;
    if (updates.onPaste !== undefined) this.onPasteCb = updates.onPaste;
    if (updates.onDelete !== undefined) this.onDeleteCb = updates.onDelete;
    if (updates.nodeOutputTransformationCallback !== undefined) this.outputTransformCb = updates.nodeOutputTransformationCallback;
    if (updates.nodeInputTransformationCallback !== undefined) this.inputTransformCb = updates.nodeInputTransformationCallback;
    if (updates.nodeClass !== undefined) { this._nodeClass = updates.nodeClass; this._updateNodeConfig(); }
    if (updates.nodeContentClass !== undefined) { this._nodeContentClass = updates.nodeContentClass; this._updateNodeConfig(); }
    if (updates.onNodeDragStart !== undefined) this.nodeDragStartCb = updates.onNodeDragStart;
    if (updates.onNodeDragOver !== undefined) this.nodeDragOverCb = updates.onNodeDragOver;
    if (updates.beforeDropCallback !== undefined) this.beforeDropCallbackCb = updates.beforeDropCallback;
    if (updates.beforeDragStartCallback !== undefined) this.beforeDragStartCb = updates.beforeDragStartCallback;
    if (updates.onNodeDrop !== undefined) this.nodeDropCb = updates.onNodeDrop;
    if (updates.onNodeDragDenied !== undefined) this.nodeDragDeniedCb = updates.onNodeDragDenied;
    if (updates.onNodeDropDenied !== undefined) this.nodeDropDeniedCb = updates.onNodeDropDenied;
    if (updates.onTreeKeydown !== undefined) this.onTreeKeydownCb = updates.onTreeKeydown;
    if (updates.beforeScrollCallback !== undefined) this.beforeScrollCb = updates.beforeScrollCallback;
    if (updates.contextMenuCallback !== undefined) this.contextMenuCallbackCb = updates.contextMenuCallback;
    if (updates.hasContextMenuRenderer !== undefined) this._hasContextMenuRenderer = updates.hasContextMenuRenderer;
    if (updates.onRenderStart !== undefined) this.renderStartCb = updates.onRenderStart;
    if (updates.onRenderProgress !== undefined) this.renderProgressCb = updates.onRenderProgress;
    if (updates.onRenderComplete !== undefined) this.renderCompleteCb = updates.onRenderComplete;

    if (needsTreeRecreation || expandLevelChanged) {
      // Preserve the user's expand/collapse state across the re-insert — fresh
      // nodes otherwise reset to the expandLevel default. Capture BEFORE the new
      // tree replaces this.tree. Skipped when the user explicitly changed
      // expandLevel (then the new seed IS the desired expansion).
      const preservedExpanded = isExpansionReseeded ? null : this._collectExpandedPaths();
      // Recreate the LTree from the merged options (this._options holds every setOptions so far)
      const o = this._options;
      const data = updates.data ?? this._data;
      this.log.INIT.debug(`[${this._treeId}] Recreating LTree due to member mapping changes`, {
        idMember: o.idMember,
        pathMember: o.pathMember,
        displayValueMember: o.displayValueMember,
        parentPathMember: o.parentPathMember,
        expandLevel: this._expandLevel,
        isExpansionReseeded,
        isCheckedReseeded,
        dataLength: data?.length ?? 0
      });
      this.tree = createLTree<T>(
        o.idMember,
        o.pathMember,
        o.parentPathMember,
        o.levelMember,
        o.hasChildrenMember,
        o.isExpandedMember,
        o.getIsExpandedCallback,
        o.isSelectableMember,
        o.getIsSelectableCallback,
        o.isCheckedMember,
        o.getIsCheckedCallback,
        o.isDraggableMember,
        o.getIsDraggableCallback,
        o.isDropAllowedMember,
        o.getIsDropAllowedCallback,
        o.allowedDropPositionsMember,
        o.displayValueMember,
        o.getDisplayValueCallback,
        o.searchValueMember,
        o.getSearchValueCallback,
        o.getAllowedDropPositionsCallback,
        o.isCollapsibleMember,
        o.getIsCollapsibleCallback,
        o.orderMember,
        this._treeId,
        this._treePathSeparator,
        this._expandLevel,
        this._isInternalSearchIndexEnabled,
        this._initializeIndexCallback,
        this._indexerBatchSize,
        this._indexerTimeout,
        {
          log: this.log,
          isSorted: o.isSorted,
          isSortingEnabled: this._isSortingEnabled,
          sortCallback: o.sortCallback,
          displayValueFallback: updates.displayValueFallback ?? this.tree.displayValueFallback
        }
      );
      this.tree.onChange = () => this._onTreeChanged();
      this._wireTreeSearch();

      // Insert data into the new tree
      if (data) {
        this._data = data;
        this._skipInsertArray = true;
        queueMicrotask(() => { this._skipInsertArray = false; });
        this._insertResult = this.tree.insertArray(data);
        if (isCheckedReseeded) this._checkedPaths = new Set();
        this._seedCheckedPathsFromTree();
        this._reapplyRuntimeChecked();
        if (!expandLevelChanged) this._reapplyExpanded(preservedExpanded);
        this._reapplySearchFilter();
        const result = this._insertResult;
        this.log.INIT.debug(`[${this._treeId}] insertArray result`, {
          successful: result.successful,
          failed: result.failed?.length ?? 0,
          total: result.total,
          visibleFlatNodes: this.tree.visibleFlatNodes?.length ?? 0,
          stats: this.tree.statistics
        });
        this._updateProgressiveRendering();
        this.log.INIT.debug(`[${this._treeId}] after progressive rendering`, {
          flatRenderedIds: this.flatRenderedIds.size,
          flatRenderQueue: this.flatRenderQueue.length,
          flatNodesToRender: this.flatNodesToRender.length
        });
      }
    } else if (updates.data !== undefined && updates.data !== this._data) {
      // Same array identity = no new data: every config batch carries the full
      // config (incl. data), so re-inserting on each would rebuild + re-index the
      // tree and drop the active filter (NOTES #18).
      this.data = updates.data;
    }
    if (isSortingReenabled) this.tree?.sortAll(null);

    this._updateNodeConfig();
    this._scheduleNotify();
  }

  /** The tree holds at least one node (independent of the search filter). */
  private _hasAnyNode(): boolean {
    return (this.tree?.root?.children.length ?? 0) > 0;
  }

  /** Get a snapshot of the current state for the renderer. */
  getSnapshot(): TreeViewStateSnapshot<T> {
    const virtualStart = this._isVirtualScrollEnabled ? this.virtualRange().start : 0;
    return {
      flatNodesToRender: this.flatNodesToRender,
      draggedNodePath: this._draggedNode?.path ?? null,
      draggedPaths: this._draggedPaths,
      revealedPaths: this._revealedPaths,
      isDragInProgress: this._isDragInProgress,
      hoveredNodeForDropPath: this._hoveredNodeForDrop?.path ?? null,
      activeDropPosition: this._activeDropPosition,
      currentDropOperation: this._currentDropOperation,
      isContextMenuOpen: this._isContextMenuOpen,
      contextMenuX: this._contextMenuX,
      contextMenuY: this._contextMenuY,
      contextMenuXOffset: this._contextMenuXOffset,
      contextMenuYOffset: this._contextMenuYOffset,
      contextMenuNode: this._contextMenuNode,
      isDropPlaceholderActive: this._isDropPlaceholderActive,
      isArmed: this._isArmed,
      isLoading: this._isLoading,
      hasNodes: this._hasAnyNode(),
      isRendering: this._isRendering,
      bodyClass: this._bodyClass,
      flatIndentSize: this._flatIndentSize,
      focusedNode: this.focusedNode,
      selectedPaths: this._selectedPaths,
      checkedPaths: this._checkedPaths,
      cutPaths: this._cutPaths,

      // Virtual scroll
      isVirtualScrollEnabled: this._isVirtualScrollEnabled,
      virtualScrollItemHeight: this.resolvedRowHeight,
      virtualScrollContainerHeight: this.resolvedContainerHeight,
      virtualTotalHeight: this._isVirtualScrollEnabled ? this.allVisibleFlatNodes.length * this.resolvedRowHeight : 0,
      virtualStartIndex: virtualStart,
      virtualOffsetY: virtualStart * this.resolvedRowHeight,
    };
  }

  /**
   * The host was detached (a DOM move or a removal): stop the LIVE resources —
   * close the context menu (the renderer drops its listeners), abort an
   * in-flight touch drag (document touch listeners + ghost), and leave the
   * cross-tree clipboard registry so a removed tree isn't pinned in memory. The
   * tree, expansion, selection, checks, focus and search are untouched.
   */
  deactivate(): void {
    if (this._isContextMenuOpen) this.closeContextMenu();
    if (typeof document !== 'undefined' && this._pointerDragState.node) this.pointerDragCancel();
    unregisterClipboardTree(this._treeId, this);
  }

  /** The host was re-attached: rejoin the cross-tree clipboard registry. */
  activate(): void {
    registerClipboardTree(this._treeId, this);
  }

  /** Clean up document-level listeners and ghost elements. */
  destroy() {
    if (typeof document !== 'undefined') {
      this.removeGhostElement();
      this._clearDragDenied();
      if (this._dropDeniedTimer) { clearTimeout(this._dropDeniedTimer); this._dropDeniedTimer = null; }
    }
    if (this.flatRenderAnimationFrame) {
      cancelAnimationFrame(this.flatRenderAnimationFrame);
      this.flatRenderAnimationFrame = null;
    }
    this._isRendering = false;
    this.renderCoordinator?.reset();
    this.tree.onChange = null;
    unregisterClipboardTree(this._treeId, this);
    this.offAll();
  }

  // ── Internal: data changed ──────────────────────────────────────────

  private _onDataChanged() {
    if (this.tree && this._data) {
      if (this._skipInsertArray) {
        this._skipInsertArray = false;
        return;
      }
      this.renderCoordinator?.reset();
      this.flatRenderedIds = new Set();
      this.flatRenderQueue = [];
      this.currentBatchSize = 0;
      const preservedExpanded = this._collectExpandedPaths();
      this._insertResult = this.tree.insertArray(this._data);
      this._seedCheckedPathsFromTree();
      this._reapplyRuntimeChecked();
      this._reapplyExpanded(preservedExpanded);
      this._reapplySearchFilter();
    }
  }

  /** A re-insert rebuilds the tree unfiltered — re-apply the active search (NOTES #18). */
  private _reapplySearchFilter(): void {
    if (this._searchText) this.tree?.filterNodes(this._searchText as string);
  }

  // ── Internal: tree changed (from LTree.onChange) ────────────────────

  /** `expanded-change` bookkeeping: dirty after any tree change / expansion op;
   *  `_lastExpandedKey` is the last announced (or silently re-baselined) set. */
  private _expandedDirty = false;
  private _lastExpandedKey: string | undefined = undefined;

  /** After an expansion op: `isSilent` re-baselines without announcing; otherwise a
   *  changed set is announced synchronously (`expanded-change`, like svelte-treeview). */
  private _markExpanded(isSilent?: boolean): void {
    if (isSilent) {
      this._lastExpandedKey = this.getExpandedPaths().join('\u0000');
      this._expandedDirty = false;
    } else {
      this._expandedDirty = true;
      const paths = this.takeExpandedChange();
      if (paths) this.emit('expanded-change', paths);
    }
  }

  /**
   * The new expanded set when it changed since the last call (else `null`). The
   * first call only takes the baseline. Cheap when nothing touched the tree.
   */
  takeExpandedChange(): string[] | null {
    if (!this._expandedDirty && this._lastExpandedKey !== undefined) return null;
    this._expandedDirty = false;
    const paths = this.getExpandedPaths();
    const key = paths.join('\u0000');
    const isFirst = this._lastExpandedKey === undefined;
    if (key === this._lastExpandedKey) return null;
    this._lastExpandedKey = key;
    return isFirst ? null : paths;
  }

  private _onTreeChanged() {
    // Keep the internal focus on the node of the CURRENT view (the filtered copy while
    // filtered, the real node otherwise): a copy kept after the filter cleared carried stale
    // flags (isExpanded of the filtered view) into keyboard navigation. (REVIEW-2026-11-19 R5)
    const focused = this._focusedNode;
    if (focused) {
      const live = this.tree?.getNodeByPath(focused.path);
      if (live && live !== focused && live.id === focused.id) this._focusedNode = live;
    }
    this._expandedDirty = true;
    this._updateProgressiveRendering();
    this._scheduleNotify();
  }

  /** Pre-populate `_checkedPaths` from any nodes whose `isChecked` was set
   *  at insert time (via `isCheckedMember` or `getIsCheckedCallback`). Runs
   *  after every `insertArray` so consumers reading `getCheckedPaths()`
   *  immediately reflect server-side initial checked state.
   *  Mirrors svelte-treeview rc07's post-insert seeding walk. */
  /** Re-apply the controller-owned runtime checked state onto freshly (re)inserted
   *  nodes. `_checkedPaths` is the source of truth and survives a data re-insert;
   *  the per-node `isChecked` flag does NOT (fresh nodes default to false), and
   *  the cascade `visualState` is derived. So after every insertArray we push
   *  `_checkedPaths` back onto `node.isChecked` and recompute `visualState` from
   *  it — otherwise a config-triggered re-insert silently drops the checkbox
   *  state + indeterminate dashes. (web-grid-style: primary state lives off
   *  the nodes; derived state is recomputed.) The renderer reads `checked` straight
   *  from `snapshot.checkedPaths`, so it's already rebuild-proof; this keeps the
   *  cascade computation + the indeterminate marker correct too. */
  private _reapplyRuntimeChecked(): void {
    if (!this.tree?.root) return;
    const cascade = this._checkboxMode === 'cascade';
    // Pass 1: primary state — isChecked from the surviving set.
    const applyChecked = (node: LTreeNode<T>) => {
      node.isChecked = this._checkedPaths.has(node.path);
      for (const child of node.children) applyChecked(child);
    };
    for (const child of this.tree.root.children) applyChecked(child);
    // Pass 2: derived visualState — needs pass 1's isChecked on all descendants.
    const applyVisual = (node: LTreeNode<T>) => {
      node.visualState = cascade
        ? this._computeVisualState(node)
        : (node.isChecked ? VisualState.checked : VisualState.unchecked);
      for (const child of node.children) applyVisual(child);
    };
    for (const child of this.tree.root.children) applyVisual(child);
  }

  /** Snapshot which nodes are currently expanded — call BEFORE a data re-insert
   *  (which resets isExpanded to the expandLevel default) so the user's manual
   *  expand/collapse survives. Paths are stable across a re-insert. */
  /** The expanded paths of the current tree, or `null` when there is no previous
   *  tree content (first insert — the expand-level seed must stand). An EMPTY set
   *  means "the user had everything collapsed" and is restored as such (NOTES #17). */
  private _collectExpandedPaths(): Set<string> | null {
    const out = new Set<string>();
    if (!this.tree?.root || this.tree.root.children.length === 0) return null;
    const visit = (node: LTreeNode<T>) => {
      if (node.isExpanded) out.add(node.path);
      for (const child of node.children) visit(child);
    };
    for (const child of this.tree.root.children) visit(child);
    return out;
  }

  /** Re-apply a captured expansion set onto freshly (re)inserted nodes. Paths not
   *  present in the new data are simply ignored. Unlike selected/checked (whose
   *  source of truth is a controller-owned set the renderer reads), expansion is
   *  consumed by the LTree's own flattening, so it stays on the node — we just make
   *  the re-insert lossless by restoring it. */
  private _reapplyExpanded(expanded: Set<string> | null): void {
    if (!this.tree?.root || expanded === null) return;
    const visit = (node: LTreeNode<T>) => {
      if (node.hasChildren) node.isExpanded = expanded.has(node.path);
      for (const child of node.children) visit(child);
    };
    for (const child of this.tree.root.children) visit(child);
    // isExpanded changed outside the LTree's own API — invalidate its cached
    // visibleFlatNodes (else the rows of a re-collapsed branch stay listed).
    this.tree.refresh();
  }

  private _seedCheckedPathsFromTree(): void {
    if (!this.tree) return;
    if (!this.tree.isCheckedMember && !this.tree.getIsCheckedCallback) return;
    // Walk every node — collapsed branches still need their checked flag
    // reflected in checkedPaths so the checkbox state is correct when the
    // user later expands them.
    const visit = (node: LTreeNode<T>) => {
      if (node.isChecked) this._checkedPaths.add(node.path);
      for (const child of node.children) visit(child);
    };
    const root = this.tree.root;
    if (root?.children) {
      for (const child of root.children) visit(child);
    }
  }

  // ── Internal: progressive flat rendering ────────────────────────────

  private _updateProgressiveRendering() {
    if (!this._isProgressiveRenderEnabled || !this.tree?.visibleFlatNodes)
      return;
    // Virtual scroll already limits rendered nodes to the visible window —
    // skip progressive rendering to avoid background batches firing _scheduleNotify
    if (this._isVirtualScrollEnabled) return;

    const tracker = this.tree.changeTracker;
    if (tracker === this.lastFlatNodesTracker) return;
    this.lastFlatNodesTracker = tracker;

    // Keys are node PATHS (unique; ids may be missing or repeat). The pending
    // queue is recomputed from the visible list on every run — never replaced by
    // just the latest delta — so a re-run while batches are pending loses nothing
    // (NOTES #10). A run while a batch sequence is in flight keeps its batch size.
    const allNodes = this.tree.visibleFlatNodes;
    const currentIds = new Set(allNodes.map((n) => n.path));

    for (const id of [...this.flatRenderedIds]) {
      if (!currentIds.has(id)) this.flatRenderedIds.delete(id);
    }

    const pending: string[] = [];
    for (const node of allNodes) {
      if (!this.flatRenderedIds.has(node.path)) pending.push(node.path);
    }
    if (pending.length === 0) {
      this.flatRenderQueue = [];
      if (!this.flatRenderAnimationFrame) this._completeRenderPass();
      return;
    }

    // A few nodes added to an already large rendered tree: show them at once.
    if (this.flatRenderedIds.size > 1000 && pending.length < 200 && this.flatRenderQueue.length === 0) {
      for (const id of pending) this.flatRenderedIds.add(id);
      return;
    }

    const isBatching = this.flatRenderQueue.length > 0 || !!this.flatRenderAnimationFrame;
    let rest = pending;
    if (!isBatching) {
      this.currentBatchSize = this._initialBatchSize;
      for (const id of pending.slice(0, this.currentBatchSize)) this.flatRenderedIds.add(id);
      rest = pending.slice(this.currentBatchSize);
      this.currentBatchSize = Math.min(this.currentBatchSize * 2, this._maxBatchSize);
    }
    this.flatRenderQueue = rest;
    if (rest.length > 0) {
      this._startRenderPass(pending.length - rest.length);
      this.scheduleFlatRenderBatch();
    }
  }

  /** A progressive (rAF-batched) render pass began: `isRendering` + `render-start`. */
  private _startRenderPass(processed: number): void {
    if (this._isRendering) return;
    this._isRendering = true;
    this._renderProcessed = processed;
    this.renderStartCb?.();
  }

  /** The progressive pass ended (queue drained or cancelled): `render-complete`. */
  private _completeRenderPass(): void {
    if (!this._isRendering) return;
    this._isRendering = false;
    this.renderCompleteCb?.({ pending: 0, processed: this._renderProcessed });
  }

  scheduleFlatRenderBatch() {
    if (this.flatRenderAnimationFrame) return;

    this.flatRenderAnimationFrame = requestAnimationFrame(() => {
      this.flatRenderAnimationFrame = null;
      if (this.flatRenderQueue.length === 0) {
        this._completeRenderPass();
        return;
      }

      const batchSize = this.currentBatchSize || this._initialBatchSize;
      const batch = this.flatRenderQueue.slice(0, batchSize);
      const remaining = this.flatRenderQueue.slice(batchSize);

      for (const id of batch) this.flatRenderedIds.add(id);
      this.flatRenderQueue = remaining;
      this.currentBatchSize = Math.min(batchSize * 2, this._maxBatchSize);

      if (remaining.length > 0) {
        this.scheduleFlatRenderBatch();
      }

      this._scheduleNotify();
      if (this._isRendering) {
        this._renderProcessed += batch.length;
        // After the state-change microtask queued above, so the batch is in the DOM.
        const pendingCount = remaining.length;
        const processed = this._renderProcessed;
        queueMicrotask(() => {
          if (!this._isRendering) return;
          this.renderProgressCb?.({ pending: pendingCount, processed });
          if (pendingCount === 0 && this.flatRenderQueue.length === 0) this._completeRenderPass();
        });
      }
    });
  }

  // ── Internal: nodeConfig ────────────────────────────────────────────

  private _updateNodeConfig() {
    const prev = this._nodeConfig;
    const next: NodeConfig = {
      clickBehavior: this._clickBehavior,
      iconSet: this._iconSet,
      leafIconClass: this._leafIconClass,
      toggleIconMode: this._toggleIconMode,
      selectedNodeClass: this._selectedNodeClass,
      focusedNodeClass: this._focusedNodeClass,
      checkedNodeClass: this._checkedNodeClass,
      dragOverNodeClass: this._dragOverNodeClass,
      draggedNodeClass: this._draggedNodeClass,
      dragDropMode: this._dragDropMode,
      dropZoneMode: this._dropZoneMode,
      dropZoneLayout: this._dropZoneLayout,
      dropZoneStart: this._dropZoneStart,
      dropZoneMaxWidth: this._dropZoneMaxWidth,
      isCopyAllowed: this._isCopyAllowed,
      iconMember: this._iconMember,
      iconColorMember: this._iconColorMember,
      shouldAlignNodeIcons: this._shouldAlignNodeIcons,
      isCheckboxesShown: this._shouldShowCheckboxes,
      isNodeTooltipsShown: this._shouldShowNodeTooltips,
      getNodeTooltipCallback: this._getNodeTooltipCallback,
      tooltipPlacement: this._tooltipPlacement,
      tooltipDelay: this._tooltipDelay,
      tooltipOffset: this._tooltipOffset,
      shouldTooltipFollowCursor: this._tooltipFollowCursor,
      nodeClass: this._nodeClass,
      nodeContentClass: this._nodeContentClass
    };
    // Every config batch re-sends the full options, so this runs on each one: only an actual change
    // re-renders the rows (a `config-change` is a full row rebuild — focus / transient row state lost).
    // `tooltipDelay` is an object (a fresh-but-equal one must not rebuild rows) — compared by value, shallowly.
    const isSame = (key: keyof NodeConfig): boolean => {
      const a = next[key], b = prev[key];
      if (a === b) return true;
      if (key !== 'tooltipDelay' || !a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
      const ka = Object.keys(a), kb = Object.keys(b);
      return ka.length === kb.length && ka.every((k) => (a as any)[k] === (b as any)[k]);
    };
    if ((Object.keys(next) as (keyof NodeConfig)[]).every(isSame)) return;
    this._nodeConfig = next;
    this.log.RENDER.debug('config-change, focusedNodeClass =', JSON.stringify(this._focusedNodeClass));
    this.emit('config-change', this._nodeConfig);
  }

  // ── Internal event handlers ─────────────────────────────────────────

  private _nodeClickedCallback(node: LTreeNode<T>, modifiers?: SelectionModifiers) {
    if (this._isContextMenuOpen) {
      this.closeContextMenu();
    }

    this._applySelection(node.path, modifiers);

    this.log.UI.debug(`Node clicked: ${node.path}`, {
      newPath: node.path,
      id: node.id,
      ctrl: modifiers?.isCtrlPressed,
      shift: modifiers?.isShiftPressed,
      selectedCount: this._selectedPaths.size
    });

    this.nodeClickedCb?.(this.nodeRef(node));
  }

  /**
   * Manual double-click detection, called by the renderer for every genuine
   * plain (no Ctrl/Shift) UI click. The flat diff reconciler patches a row's
   * attributes on the first click (focus/selection bumps `_rev`), so the
   * browser's native `dblclick` can't be trusted. Returns `true` when this
   * click completes a double within the 400ms window — the caller then
   * consumes the click (returns early) so the gesture reads as a single open
   * rather than a re-toggle. Fires `onNodeDoubleClick` for every clickBehavior;
   * `select` mode additionally toggles expand/collapse on the double (the other
   * modes already toggle on single click).
   */
  /** Forget the pending first click — a modifier click, checkbox or toggle click
   *  in between means the next plain click is NOT a double-click (NOTES #25). */
  resetDoubleClick(): void {
    this._lastClickPath = null;
    this._lastClickTime = 0;
  }

  detectDoubleClick(node: LTreeNode<T>): boolean {
    const now = Date.now();
    const isDouble =
      this._lastClickPath === node.path && now - this._lastClickTime < 400;
    if (isDouble) {
      this._lastClickPath = null;
      this._lastClickTime = 0;
      this.onNodeDoubleClickCb?.(this.nodeRef(node));
      if (this._clickBehavior === 'select') {
        const canonical = this.tree?.getNodeByPath(node.path) ?? node;
        if (canonical.hasChildren && this.getNodeIsCollapsible(canonical)) {
          this.toggleNodeExpanded(canonical.path);
        }
      }
      return true;
    }
    this._lastClickPath = node.path;
    this._lastClickTime = now;
    return false;
  }

  private _onNodeRightClicked(node: LTreeNode<T>, event: MouseEvent) {
    this.log.UI.debug(`Right-click on node: ${node.path}`, {
      hasContextMenuRenderer: this._hasContextMenuRenderer,
      hasContextMenuCallback: !!this.contextMenuCallbackCb,
    });
    if (!this._hasContextMenuRenderer && !this.contextMenuCallbackCb) {
      return;
    }

    this.log.UI.debug(`Context menu opened: ${node.path}`);
    event.preventDefault();
    this.openContextMenu(node, event.clientX, event.clientY);
  }

  // ── Drag and drop internals ─────────────────────────────────────────

  private isDropAllowedByMode(draggedNodeTreeId: string | undefined): boolean {
    if (this._dragDropMode === 'none') return false;
    const isSameTree = draggedNodeTreeId === this._treeId;
    // 'self' = same-tree only: reject anything coming from another tree.
    if (this._dragDropMode === 'self' && !isSameTree) return false;
    // 'cross' = cross-tree only: reject drops originating in this same tree.
    if (this._dragDropMode === 'cross' && isSameTree) return false;
    return true;
  }

  /** Pick out the "top-level selected" subset of `selectedPaths`:
   *  every path whose nearest selected ancestor is NOT in the set.
   *  Descendants whose ancestor is also selected are absorbed — they
   *  ride along inside the ancestor's subtree during multi-drag. */
  private _getTopLevelSelectedPaths(): string[] {
    return getTopLevelPaths(this._selectedPaths, this._treePathSeparator);
  }

  /**
   * The top-level selected paths a multi-drag carries (move AND copy): minus the drop target,
   * minus locked nodes (getIsDraggableCallback false). The single-drag path is gated at drag
   * start, but a multi-drag reads straight from the selected set, so a locked node that merely
   * sits in the selection must not ride along — the copy branch used to skip this gate.
   * (svelte-treeview REVIEW-2026-11-19 B9)
   */
  private _getDraggableTopLevelSelection(dropPath: string): string[] {
    return this._getTopLevelSelectedPaths().filter((p) => {
      if (p === dropPath) return false;
      const n = this.tree.getNodeByPath(p);
      return n ? this.getNodeIsDraggable(n) : false;
    });
  }

  /**
   * Hand the pre-drag selection snapshot to a drop's outcome: restored when the drop didn't
   * land (vetoed / denied / failed). Takes the snapshot, so the later `dragend` (whose
   * dropEffect is 'move' for any drop the tree accepted at the DOM level) can't drop it.
   */
  private _settlePreDragSelection(drop: Promise<boolean>): void {
    const prior = this._preDragSelectionSnapshot;
    if (!prior) return;
    this._preDragSelectionSnapshot = null;
    void drop.then((isDropped) => {
      if (!isDropped) this._restorePreDragSelection(prior);
    });
  }

  private _restorePreDragSelection(prior: Set<string>): void {
    this._selection.set(prior, { isSilent: true });
    this._syncSelection();
    // When the snapshot was empty, focus also belonged to nobody — clear it.
    if (prior.size === 0) this._focusedNode = null;
    this._dispatchSelectionChange();
    this._reconcileCheckedFromSelection();
    this.tree.refresh();
    this._scheduleNotify();
  }

  private _resetDragState(): void {
    this.log.DRAG.debug('_resetDragState');
    this._isDragInProgress = false;
    this._draggedNode = null;
    this._draggedPaths = [];
    this._hoveredNodeForDrop = null;
    this._activeDropPosition = null;
    this._isDropPlaceholderActive = false;
    this._currentDropOperation = 'move';
    this._dragSetOverride = null;
    clearDragSet();
    this._scheduleNotify();
  }

  private async _handleDrop(
    dropNode: LTreeNode<T> | null,
    draggedNodeRef: LTreeNode<T>,
    position: DropPosition,
    event: PointerEvent
  ): Promise<boolean> {
    let operation: DropOperation = 'move';
    if (this._isCopyAllowed && event?.ctrlKey) {
      operation = 'copy';
    }

    this.log.DRAG.info(`Drop: ${draggedNodeRef.path} -> ${dropNode?.path ?? 'empty tree'}`, {
      position,
      operation,
      isCrossTree: draggedNodeRef.treeId !== this._treeId
    });

    const isSameTreeDrag = draggedNodeRef.treeId === this._treeId;

    // The beforeDragStart override, read BEFORE the await below: every drop path calls
    // _handleDrop without awaiting it and resets the drag state right after (dragend /
    // _resetDragState), so after an (async) beforeDropCallback `this._dragSetOverride` was
    // already null and a curated manifest with holes silently became whole subtrees.
    // (svelte-treeview REVIEW-2026-11-19 B7)
    const dragSetOverride = this._dragSetOverride;

    // Full top-level dragged set as NodeRefs — captured BEFORE any move mutates
    // the selected set (same-tree) or the source clears its published set
    // (cross-tree). Feeds ctx.dragged on every drop, single- or multi-origin.
    const draggedRefs = this._draggedRefs(draggedNodeRef);

    // One fire path for every branch: `dropped` = the nodes the library actually
    // placed (null when it didn't — cross-tree/consumer-owned or auto-handle off).
    const dispatchDrop = (dropped: LTreeNode<T>[] | null) => {
      this._fireNodeDrop(dropNode, draggedNodeRef, draggedRefs, dropped, position, operation, event);
    };

    if (this.beforeDropCallbackCb) {
      const result = await this.beforeDropCallbackCb({
        target: dropNode ? this.nodeRef(dropNode) : null,
        dragged: draggedRefs,
        position,
        operation,
        event
      });
      if (result === false) return false;
      if (Array.isArray(result)) {
        // Content-addressed routing: fan the drop out to the returned groups.
        // Same-tree nodes are moved by the library; cross-tree nodes are left for
        // the consumer's onNodeDrop. Paths in no group aren't placed.
        return this._processDropGroups(result, dispatchDrop);
      }
      if (result && typeof result === 'object') {
        if ('position' in result && result.position) position = result.position;
        if ('operation' in result && result.operation) operation = result.operation;
      }
    }

    // Multi-drag: when the dragged node is in a multi-selection set (or a
    // beforeDragStart override exists), move the whole set as top-level subtrees via
    // moveNodes, which resolves refs up front, picks the roots, and chains them in
    // source order under the target. (svelte-treeview rc13) An override ALWAYS goes
    // here, even a ONE-entry one: ['folder'] with its only child omitted is a manifest
    // with a hole, and the single-node moveNode below would carry that child along.
    const isMultiDrag =
      isSameTreeDrag &&
      operation === 'move' &&
      dropNode &&
      this._shouldAutoHandleMove &&
      (dragSetOverride
        ? dragSetOverride.length > 0
        : this._selectedPaths.has(draggedNodeRef.path) && this._selectedPaths.size > 1);

    if (isMultiDrag) {
      // drop target can't be moved onto itself. An explicit override skips the draggability
      // gate — the consumer forced these in on purpose.
      const topLevelPaths = dragSetOverride
        ? dragSetOverride.filter((p) => p !== dropNode!.path && !!this.tree.getNodeByPath(p))
        : this._getDraggableTopLevelSelection(dropNode!.path);
      this.log.DRAG.info(`Multi-drag: moving ${topLevelPaths.length} top-level subtree(s)`, {
        topLevelPaths,
        totalSelected: this._selectedPaths.size,
        dropTarget: dropNode!.path,
        position
      });
      // A curated override IS the manifest as-is (its omissions are holes moveNodes
      // leaves behind); a plain selected set has no holes, so complete it → whole
      // subtrees move.
      const manifest = dragSetOverride ? topLevelPaths : this._getPathsWithDescendants(topLevelPaths);
      const result = this.moveNodes(manifest, dropNode!.path, position);
      dispatchDrop(result.movedNodes);
      return result.success;
    }

    if (isSameTreeDrag && operation === 'move' && dropNode) {
      if (this._shouldAutoHandleMove) {
        const result = this.moveNode(draggedNodeRef.path, dropNode.path, position);
        // moveNode mutates in place → draggedNodeRef IS the landed node.
        dispatchDrop(result.success ? [draggedNodeRef] : null);
        return result.success;
      }
      // shouldAutoHandleMove=false: don't mutate the tree, just notify the consumer
      dispatchDrop(null);
      return true;
    }

    if (isSameTreeDrag && operation === 'copy' && dropNode && this._shouldAutoHandleCopy) {
      // Copy twin of the move branches: build the same manifest (curated override
      // with holes, or the completed selected/lead set = whole subtrees), then
      // duplicateNodes runs the INPUT transform per node — the consumer's
      // pasteNodeTransformationCallback, else a default id-uniquifier.
      const transform = this.inputTransformCb ?? this._defaultCopyTransform;
      const isMulti = dragSetOverride
        ? dragSetOverride.length > 1
        : this._selectedPaths.has(draggedNodeRef.path) && this._selectedPaths.size > 1;
      const manifest = dragSetOverride
        ? dragSetOverride
        : isMulti
          ? this._getPathsWithDescendants(this._getDraggableTopLevelSelection(dropNode.path))
          : this._getPathsWithDescendants([draggedNodeRef.path]);
      const result = this.duplicateNodes(
        manifest, dropNode.path, position, transform, undefined,
        this.outputTransformCb ? (d, ctx) => this.transformOutgoing(d, ctx) : undefined
      );
      dispatchDrop(result.copiedNodes);
      return result.success;
    }

    if (!isSameTreeDrag && operation === 'copy' && this._shouldAutoHandleCopy) {
      // Cross-tree AUTO-copy: reach the SOURCE tree via the registry, read its
      // published PLACEMENT manifest (curated override keeps holes; a plain drag was
      // completed to whole subtrees) and duplicate it into THIS tree. The source
      // stays put — a copy re-homes nothing. The module-level dragSet (the drag is
      // still live: the source keeps it until this drop settles), else the lead path.
      let sourceTreeId = draggedNodeRef.treeId ?? '';
      let manifest: string[] | null = null;
      {
        const drag = getDragSet();
        if (drag) { sourceTreeId = drag.sourceTreeId; manifest = drag.manifest; }
      }
      if (!manifest) manifest = [draggedNodeRef.path];
      const sourceCtrl = getClipboardTree(sourceTreeId);
      const sourceTree = sourceCtrl ? (sourceCtrl.tree as Ltree<T> | undefined) : undefined;
      if (sourceTree) {
        const transform = this.inputTransformCb ?? this._defaultCopyTransform;
        const result = this.duplicateNodes(
          manifest,
          dropNode ? dropNode.path : '',
          dropNode ? position : 'child',
          transform,
          sourceTree,
          sourceCtrl?.transformOutgoing
            ? (d, ctx) => sourceCtrl.transformOutgoing!(d, ctx) as T | null
            : undefined
        );
        dispatchDrop(result.copiedNodes);
        return result.success;
      }
    }

    // Cross-tree without a reachable source (or copy without shouldAutoHandleCopy):
    // the consumer performs the insertion, so dropped is null.
    dispatchDrop(null);
    return true;
  }

  /** Build the NodeDropContext and fire onNodeDrop. `dropped` is the nodes the
   *  library placed (null when it didn't — cross-tree or shouldAutoHandle*=false). */
  private _fireNodeDrop(
    dropNode: LTreeNode<T> | null,
    draggedNodeRef: LTreeNode<T>,
    draggedRefs: NodeRef<T>[],
    dropped: LTreeNode<T>[] | null,
    position: DropPosition,
    operation: DropOperation,
    event: PointerEvent
  ): void {
    this.nodeDropCb?.({
      source: this.nodeRef(draggedNodeRef),
      target: dropNode ? this.nodeRef(dropNode) : null,
      dragged: draggedRefs,
      dropped: dropped ? dropped.map((n) => this.nodeRef(n)) : null,
      position,
      operation,
      event
    });
  }

  // ── Pointer drag (core createPointerDrag, wired by the renderer) ─────
  // ONE drag for mouse, pen and touch (svelte-treeview parity). The gesture — the 5px threshold /
  // the touch long press, the scroll lock, the hit test through shadow roots, auto-scroll, Escape,
  // the swallowed trailing click — is core createPointerDrag in the renderer; the state keeps the
  // tree side: the dragged set, the hover / drop-position visuals in whichever tree the pointer is
  // over (another tree is found through the tree registry by its container's data-tree-id) and the
  // drop itself. There is no HTML5 drag session and no dataTransfer.

  /** The tree whose hover visuals the drag last lit (another tree on a cross-tree drag). */
  private _hoverState: TreeViewState<any> | null = null;
  /** The live operation: Ctrl held (and isCopyAllowed) = copy. Kept across auto-scroll frames,
   *  which have no pointer event. */
  private _pointerOperation: DropOperation = 'move';
  /** The last pointer event of the drag — an auto-scroll frame has none of its own. */
  private _lastPointerEvent: PointerEvent | null = null;

  /** A press became a drag on `node` (viewport `x` / `y`; `event` = the press). A NON-draggable node
   *  (a touch long press — the renderer starts no mouse drag on one) only plays the "can't move this"
   *  reaction until release. `false` = refused (beforeDragStartCallback). */
  pointerDragStart(node: LTreeNode<T>, x: number, y: number, event: PointerEvent): boolean {
    this._pointerDragState = { node, isDragging: false, isDenied: false, ghostLayer: null };
    if (!this.getNodeIsDraggable(node)) {
      this._pointerDragState.isDenied = true;
      this._showDragBlockedIndicator(node);
      return true;
    }
    this.log.DRAG.debug(`Drag started: ${node.path}`, { pointerType: event.pointerType, treeId: this._treeId });
    this._draggedNode = node;
    this._isDragInProgress = true;

    // Set-level PRE-drag interceptor (rc13): hand the consumer the COMPLETE flattened set and let
    // them REPLACE it (prune and/or force-add), cancel the drag, or leave it. Runs BEFORE the
    // cross-tree publish + onNodeDragStart so both see the final set.
    this._dragSetOverride = null;
    let draggedRefs = this._draggedRefs(node);
    if (this.beforeDragStartCb) {
      const decision = this.beforeDragStartCb({
        lead: this.nodeRef(node),
        dragged: this._getDraggedRefsWithDescendants(draggedRefs),
        event
      });
      if (decision === false) {
        this.log.DRAG.debug('[before-drag-start] drag cancelled by callback', { path: node.path });
        this._endPointerDrag();
        return false;
      }
      if (Array.isArray(decision)) {
        this._dragSetOverride = this._validateDragManifest(decision, node.path);
        draggedRefs = this._draggedRefs(node); // republish through the override
      }
    }

    // Publish the top-level dragged paths (→ ctx.dragged cross-tree) PLUS the PLACEMENT manifest a
    // cross-tree auto-copy feeds to duplicateNodes: a curated override keeps its holes; a plain drag
    // is completed so whole subtrees copy. Every TRAVELING node dims, not just the roots.
    const placementManifest =
      this._dragSetOverride ?? this._getPathsWithDescendants(draggedRefs.map((r) => r.path));
    this._draggedPaths = placementManifest;
    setDragSet(this._treeId, draggedRefs.map((r) => r.path), placementManifest);
    this._pointerDragState.isDragging = true;
    this._pointerOperation = this._isCopyAllowed && event.ctrlKey ? 'copy' : 'move';
    this.createGhostElement(node, x, y);
    this.nodeDragStartCb?.({ ...this.nodeRef(node), event, dragged: draggedRefs });

    // OS-convention selection sync: grabbing a node outside the selected set replaces the selection
    // with just it (Windows Explorer / macOS Finder). Synchronous — there is no browser drag image
    // to lose (the HTML5 path had to defer it to a rAF). Restored when the drag lands nowhere.
    if (node.isSelectable && !this._selectedPaths.has(node.path)) {
      this._preDragSelectionSnapshot = new Set(this._selectedPaths);
      this._selection.set([node.path], { isSilent: true });
      this._selection.setAnchor(node.path);
      this._syncSelection();
      this._focusedNode = node;
      this._dispatchSelectionChange();
      this._reconcileCheckedFromSelection();
      this.tree.refresh();
    }

    // Haptic feedback on a real touch drag start (a treeview extra; core has none).
    if (event.pointerType === 'touch') {
      try { navigator.vibrate?.(50); } catch { /* blocked by browser policy */ }
    }
    this._scheduleNotify();
    return true;
  }

  /** A held drag the tree refuses (a locked node showing the 🚫 badge) — the renderer turns core's
   *  auto-scroll off for it. */
  get isPointerDragDenied(): boolean { return this._pointerDragState.isDenied; }

  /** The pointer moved (or the list auto-scrolled under it). `target` = the deepest element under it;
   *  `event` is null for an auto-scroll frame. */
  pointerDragMove(target: Element | null, x: number, y: number, event: PointerEvent | null): void {
    if (!this._pointerDragState.isDragging || !this._draggedNode) return; // a denied hold: nothing moves
    if (event) {
      this._lastPointerEvent = event;
      this._pointerOperation = this._isCopyAllowed && event.ctrlKey ? 'copy' : 'move';
    }
    this._placeGhost(x, y);
    const hit = this._resolveDropTarget(target);

    // Over a floating drop pad: the pads sit off the row (their own layer), so keep the hovered
    // node and just take the pad's position.
    if (hit.pad && this._hoverState?._hoveredNodeForDrop) {
      const hover = this._hoverState;
      if (hover._activeDropPosition !== hit.pad || hover._currentDropOperation !== this._pointerOperation) {
        hover._activeDropPosition = hit.pad;
        hover._currentDropOperation = this._pointerOperation;
        hover._scheduleNotify();
      }
      return;
    }

    const position = this._pointerDropPosition(hit, x, y);
    if (hit.node && position) {
      this._setHover(hit.state, hit.node, position, false);
      const dragEvent = event ?? this._lastPointerEvent;
      if (dragEvent) {
        hit.state.nodeDragOverCb?.({
          ...hit.state.nodeRef(hit.node),
          event: dragEvent,
          dragged: this._draggedRefs(this._draggedNode)
        });
      }
      return;
    }
    // An empty tree's drop zone / an active placeholder.
    const isEmptyZone = !!hit.el?.closest('.wtv__empty-state, .wtv__empty-zone');
    if (isEmptyZone && this._isDropAllowedFrom(hit.state)) {
      this._setHover(hit.state, null, null, true);
      return;
    }
    // Inside a tree but not over a valid target: keep that tree "in a drag" (its empty-tree
    // placeholder / tree drop zone outline) without a hovered row.
    if (hit.isInContainer && this._isDropAllowedFrom(hit.state)) {
      this._setHover(hit.state, null, null, hit.state._shouldEnableTreeDropZone);
      return;
    }
    this._clearHover();
  }

  /** The pointer was released over `target`. Async: the drag state lives until the drop (an async
   *  beforeDropCallback) settles, so a cross-tree auto-copy can still read the published manifest. */
  async pointerDragDrop(target: Element | null, x: number, y: number, event: PointerEvent): Promise<void> {
    const dragged = this._draggedNode;
    if (!this._pointerDragState.isDragging || !dragged) {
      this._endPointerDrag();
      return;
    }
    this._pointerOperation = this._isCopyAllowed && event.ctrlKey ? 'copy' : 'move';
    this.removeGhostElement();
    const hit = this._resolveDropTarget(target);
    const hover = this._hoverState;
    let drop: Promise<boolean> | null = null;

    if (hit.pad && hover?._hoveredNodeForDrop && this._isDropAllowedFrom(hover)) {
      this.log.DRAG.debug(`Drop on a pad: ${dragged.path} -> ${hover._hoveredNodeForDrop.path} (${hit.pad})`);
      drop = hover._handleDrop(hover._hoveredNodeForDrop, dragged, hit.pad, event);
    } else if (hit.node && this._pointerDropPosition(hit, x, y)) {
      const position = this._pointerDropPosition(hit, x, y)!;
      this.log.DRAG.debug(`Drop: ${dragged.path} -> ${hit.node.path} (${position})`);
      drop = hit.state._handleDrop(hit.node, dragged, position, event);
    } else if (hit.state._shouldEnableTreeDropZone && hit.isInContainer && this._isDropAllowedFrom(hit.state)) {
      // Whole-tree drop zone: any release inside the tree that isn't a valid node drop — empty
      // area, or a node whose getIsDropAllowedCallback refused it — lands with target = null.
      drop = hit.state._handleDrop(null, dragged, 'child', event);
    } else if (hit.el?.closest('.wtv__empty-state, .wtv__empty-zone') && !hit.node && this._isDropAllowedFrom(hit.state)) {
      this.log.DRAG.debug(`Drop: ${dragged.path} -> empty tree`);
      drop = hit.state._handleDrop(null, dragged, 'child', event);
    } else if (hit.node && hit.node !== dragged && !hit.node.isDropAllowed && this._isDropAllowedFrom(hit.state)) {
      // The target refused the drop: flash the 🚫 on it + fire onNodeDropDenied (NOTES #22).
      hit.state._showDropBlockedIndicator(hit.node);
    } else {
      this.log.DRAG.debug(`Drag ended on no target: ${dragged.path}`);
    }

    // Vetoed / denied / failed / nowhere → the grab's selection change is undone.
    const isDropped = drop ? await drop : false;
    const prior = this._preDragSelectionSnapshot;
    this._preDragSelectionSnapshot = null;
    if (!isDropped && prior) this._restorePreDragSelection(prior);
    this._endPointerDrag();
  }

  /** Escape / pointercancel / detach / cancelDrag(): abort. Nothing was mutated (commit on drop),
   *  so only the grab's selection change is undone. Idempotent. */
  pointerDragCancel(): void {
    const prior = this._preDragSelectionSnapshot;
    this._preDragSelectionSnapshot = null;
    if (this._pointerDragState.isDragging && prior) this._restorePreDragSelection(prior);
    this._endPointerDrag();
  }

  /** Tear the drag down: ghost, the held 🚫, the hover visuals (in any tree), the drag state. */
  private _endPointerDrag(): void {
    this.removeGhostElement();
    this._clearDragDenied();
    this._clearHover();
    this._pointerDragState = { node: null, isDragging: false, isDenied: false, ghostLayer: null };
    this._preDragSelectionSnapshot = null;
    this._lastPointerEvent = null;
    this._resetDragState();
  }

  /**
   * Map the element under the pointer to the tree that owns it + the node it belongs to. `pad` = the
   * floating drop pad's position when the pointer is on one; `isInContainer` = inside a tree at all.
   */
  private _resolveDropTarget(el: Element | null): {
    state: TreeViewState<any>;
    node: LTreeNode<any> | null;
    el: Element | null;
    pad: DropPosition | null;
    isInContainer: boolean;
  } {
    if (!el) return { state: this, node: null, el: null, pad: null, isInContainer: false };
    const padEl = el.closest('.wtv__drop-zone');
    const padPosition = padEl?.getAttribute('data-drop-position');
    const pad = padPosition === 'before' || padPosition === 'after' || padPosition === 'child' ? padPosition : null;
    const container = el.closest('.wtv__container');
    const treeId = container?.getAttribute('data-tree-id') ?? null;
    const other = treeId && treeId !== this._treeId ? getClipboardTree(treeId) : undefined;
    const state = (other as unknown as TreeViewState<any> | undefined) ?? this;
    const row = container ? el.closest('.wtv__node') : null;
    const path = row?.getAttribute('data-tree-path');
    const node = path ? (state.tree?.getNodeByPath(path) ?? null) : null;
    return { state, node, el, pad, isInContainer: !!container };
  }

  /** May the drag in progress (from THIS tree) drop into `target` at all — its dragDropMode,
   *  disabled / read-only. */
  private _isDropAllowedFrom(target: TreeViewState<any>): boolean {
    if (target._isReadonly || target.containerElement?.classList.contains('wtv__container--disabled')) return false;
    return target === this
      ? this.isDropAllowedByMode(this._draggedNode?.treeId)
      : target._dragDropMode === 'both' || target._dragDropMode === 'cross';
  }

  /** The drop position over `hit.node`, or null when it can't take this drop (refused, onto
   *  itself, mode). From where the pointer sits on the row content, within the allowed positions. */
  private _pointerDropPosition(
    hit: { state: TreeViewState<any>; node: LTreeNode<any> | null; el: Element | null },
    x: number,
    y: number
  ): DropPosition | null {
    const node = hit.node;
    if (!node || !this._draggedNode || !node.isDropAllowed || !this._isDropAllowedFrom(hit.state)) return null;
    if (hit.state === this && node === this._draggedNode) return null;
    const content = (hit.el?.closest('.wtv__node-content') ??
      hit.el?.closest('.wtv__node')?.querySelector('.wtv__node-content')) as HTMLElement | null;
    if (!content) return 'child';
    const positions = hit.state.getNodeAllowedDropPositions(node);
    return hit.state.calculateDropPositionFromEvent({ clientX: x, clientY: y } as MouseEvent, content, positions);
  }

  /** Light up `target`'s hover visuals (and clear the previous tree's, cross-tree). */
  private _setHover(
    target: TreeViewState<any>,
    node: LTreeNode<any> | null,
    position: DropPosition | null,
    isPlaceholderActive: boolean
  ): void {
    if (this._hoverState && this._hoverState !== target) this._clearHoverOn(this._hoverState);
    this._hoverState = target;
    const isChanged =
      target._hoveredNodeForDrop !== node ||
      target._activeDropPosition !== position ||
      target._isDropPlaceholderActive !== isPlaceholderActive ||
      target._currentDropOperation !== this._pointerOperation ||
      !target._isDragInProgress;
    // A cross-tree target needs isDragInProgress on so its renderer draws the glow / pads.
    target._isDragInProgress = true;
    target._hoveredNodeForDrop = node;
    target._activeDropPosition = position;
    target._isDropPlaceholderActive = isPlaceholderActive;
    target._currentDropOperation = this._pointerOperation;
    if (isChanged) target._scheduleNotify();
  }

  private _clearHoverOn(target: TreeViewState<any>): void {
    target._hoveredNodeForDrop = null;
    target._activeDropPosition = null;
    target._isDropPlaceholderActive = false;
    if (target !== this) target._isDragInProgress = false;
    target._scheduleNotify();
  }

  private _clearHover(): void {
    if (this._hoverState) this._clearHoverOn(this._hoverState);
    this._hoverState = null;
  }

  // ── Blocked-action feedback (svelte-treeview rc14) ──────────────────

  /** "Can't move this" — a locked node was long-pressed. Fires onNodeDragDenied
   *  always; the built-in held 🚫 badge + double-buzz only when
   *  shouldIndicateUndraggable. Torn down on release via _clearDragDenied. */
  private _showDragBlockedIndicator(node: LTreeNode<any>) {
    this.log.DRAG.debug('[drag-denied] locked node long-pressed', { path: node?.path });

    this.nodeDragDeniedCb?.(this.nodeRef(node));

    if (!this._shouldIndicateUndraggable) return;

    // Distinct double-buzz (a real drag start is a single 50ms buzz).
    try { navigator.vibrate?.([30, 25, 30]); } catch { /* blocked by browser policy */ }

    if (typeof document === 'undefined') return;
    const el = this._domScope().querySelector(
      `[data-tree-path="${CSS.escape(node.path)}"] .wtv__node-content`
    ) as HTMLElement | null;
    if (!el) return;

    // Clear any previous indicator, then show one that persists until release.
    this._clearDragDenied();

    el.classList.add('wtv__node-content--drag-denied');
    this._deniedRowEl = el;

    const badge = document.createElement('span');
    badge.className = 'wtv__drag-denied-badge';
    badge.textContent = '🚫';
    badge.setAttribute('aria-hidden', 'true');
    el.appendChild(badge);
    this._deniedBadgeEl = badge;
  }

  /** Remove the held "can't move this" indicator (badge + row class). Idempotent. */
  private _clearDragDenied() {
    if (this._deniedBadgeEl) {
      this._deniedBadgeEl.remove();
      this._deniedBadgeEl = null;
    }
    if (this._deniedRowEl) {
      this._deniedRowEl.classList.remove('wtv__node-content--drag-denied');
      this._deniedRowEl = null;
    }
  }

  /** "Can't drop here" — the target-side twin. Fires onNodeDropDenied always; the
   *  built-in indicator (haptic + a brief 🚫 flash on the refusing target) only
   *  when shouldIndicateUndraggable. Transient (a drop is a discrete moment), so
   *  it auto-clears after a short beat. */
  private _showDropBlockedIndicator(node: LTreeNode<any>) {
    this.log.DRAG.debug('[drop-denied] target refused drop', { path: node?.path });

    this.nodeDropDeniedCb?.(this.nodeRef(node));

    if (!this._shouldIndicateUndraggable) return;

    try { navigator.vibrate?.([30, 25, 30]); } catch { /* blocked by browser policy */ }

    if (typeof document === 'undefined') return;
    const el = this._domScope().querySelector(
      `[data-tree-path="${CSS.escape(node.path)}"] .wtv__node-content`
    ) as HTMLElement | null;
    if (!el) return;

    el.classList.add('wtv__node-content--drag-denied');
    const badge = document.createElement('span');
    badge.className = 'wtv__drag-denied-badge';
    badge.textContent = '🚫';
    badge.setAttribute('aria-hidden', 'true');
    el.appendChild(badge);

    if (this._dropDeniedTimer) clearTimeout(this._dropDeniedTimer);
    this._dropDeniedTimer = setTimeout(() => {
      el.classList.remove('wtv__node-content--drag-denied');
      badge.remove();
      this._dropDeniedTimer = null;
    }, 700);
  }

  private createGhostElement(node: LTreeNode<any>, x: number, y: number) {
    this.removeGhostElement();
    if (!this.containerElement) return;

    // A core layer outside the tree (SPEC §12.29): never clipped by the tree's overflow; its
    // own shadow root carries the ghost CSS + the host's --wtv-* tokens and theme.
    const layer = openTreeLayer(this.containerElement, {
      className: 'wtv__drag-layer',
      zIndexToken: '--wtv-z-index-ghost',
    }, this.layerOpener);
    const ghost = document.createElement('div');
    ghost.className = 'wtv__touch-ghost';
    ghost.textContent = this.tree.getNodeDisplayValue(node);
    layer.element.append(ghost);
    this._pointerDragState.ghostLayer = layer;
    this._placeGhost(x, y);
  }

  /** Put the ghost's (0 × 0) layer at the finger; the ghost centres itself on it. */
  private _placeGhost(x: number, y: number) {
    this._pointerDragState.ghostLayer?.place({ top: y, left: x, width: 0, height: 0 });
  }

  /** The tree's own DOM, for lookups by path: the .wtv__container (inside the
   *  shadow root for <web-treeview>), so they neither miss a shadow-rendered tree
   *  nor hit another tree with the same paths. */
  private _domScope(): ParentNode {
    return this.containerElement ?? document;
  }

  private removeGhostElement() {
    if (this._pointerDragState.ghostLayer) {
      this._pointerDragState.ghostLayer.destroy();
      this._pointerDragState.ghostLayer = null;
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  private generateTreeId(): string {
    return `${Date.now()}${Math.floor(Math.random() * 10000)}`;
  }
}
