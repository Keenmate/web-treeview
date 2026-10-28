/**
 * TreeEngine — all tree state & logic.
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
import {
  type Ltree,
  type InsertArrayResult,
  type InsertBranchResult,
  type ReplaceBranchResult,
  type DropPosition,
  type DragDropMode,
  type DropOperation,
  type TreeChange,
  type ApplyChangesResult
} from '../ltree/types';
import {
  createRenderCoordinator,
  type RenderCoordinator,
  type RenderStats
} from '../renderer/render-coordinator';
import { EventEmitter } from './event-emitter';
import type {
  NodeCallbacks,
  NodeConfig,
  SelectionModifiers,
  SelectMode,
  TreeMutationOptions,
  TreeEngineConfig,
  TreeEngineSnapshot,
  TreeEngineEvents,
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
  DropGroup
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
import { initLogger, uiLogger, dragLogger, defaultTreeLoggers, type TreeLoggers } from '../logger';
import type { TreeNavigation, TreeNavigationOverrides } from '../navigation';
import { perfStart, perfEnd } from '../perf-logger';

// ─── TreeEngine ───────────────────────────────────────────────────────

/** Rows a PageUp / PageDown (and their Shift variants) jumps in the visible flat list. */
const NAV_PAGE_SIZE = 10;

export class TreeEngine<T> extends EventEmitter<TreeEngineEvents<T>> {
  // ── LTree instance ──────────────────────────────────────────────────
  tree!: Ltree<T>;

  // ── Render coordinator ──────────────────────────────────────────────
  renderCoordinator!: RenderCoordinator | null;

  // ── Stable callback & config objects for renderer ───────────────────
  nodeCallbacks!: NodeCallbacks<T>;
  private _nodeConfig: NodeConfig = {
    clickBehavior: 'expand-and-focus',
    iconSet: 'chevron',
    expandIconClass: 'wtv__toggle-icon--expand',
    collapseIconClass: 'wtv__toggle-icon--collapse',
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
    dropZoneMaxWidth: 120,
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

  // Behaviour
  private _isLoading: boolean = false;
  private _isFlatRenderingEnabled: boolean = true;
  private _flatIndentSize: string = 'var(--wtv-indent-size)';
  private _isProgressiveRenderEnabled: boolean = true;
  private _initialBatchSize: number = 20;
  private _maxBatchSize: number = 500;
  private _bodyClass: string | null | undefined = undefined;
  // Current expand-to-level. Tracked on the controller because the LTree bakes
  // its expand level into a closure at construction — the only way to change it
  // is to recreate the tree, so updateProps must know the previous value to
  // detect a real change (buildConfig resends the attribute on every update).
  private _expandLevel: number | null | undefined = undefined;

  // Drag and drop
  private _dragDropMode: DragDropMode = 'none';
  private _isCopyAllowed: boolean = false;
  private _shouldAutoHandleCopy: boolean = true;
  private _shouldAutoHandleMove: boolean = true;
  private _shouldAutoHandlePaste: boolean = true;
  // Opt out of built-in Ctrl/Cmd+C/X/V + Delete + Esc shortcuts (default on).
  private _shouldHandleKeyboardShortcuts: boolean = true;
  // Long-press hold (ms) before a touch-drag engages (svelte-treeview rc14).
  private _touchDragDelay: number = 300;
  // Whole populated tree is one drop target — a drop anywhere lands target=null
  // regardless of per-node getIsDropAllowed (svelte-treeview rc13).
  private _shouldEnableTreeDropZone: boolean = false;
  // Built-in "can't move/drop this" feedback (🚫 badge + haptic). rc14.
  private _shouldIndicateUndraggable: boolean = true;

  // Three-level selection model (rc06+)
  private _selectedPaths: Set<string> = new Set();
  private _checkedPaths: Set<string> = new Set();
  private _lastSelectedPath: string | null = null;
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
  private beforeCheckboxToggleCb: TreeEngineConfig<T>['beforeCheckboxToggleCallback'];

  // Clipboard (cut paths for dimming)
  private _cutPaths: Set<string> = new Set();

  // Events / callbacks (ctx-object signatures — rc07 parity)
  private checkedChangeCb: TreeEngineConfig<T>['onCheckedChange'];
  private selectionChangeCb: TreeEngineConfig<T>['onSelectionChange'];
  private nodeClickedCb: TreeEngineConfig<T>['onNodeClick'];
  private onNodeDoubleClickCb: TreeEngineConfig<T>['onNodeDoubleClick'];
  private beforeExpandCb: TreeEngineConfig<T>['beforeExpandCallback'];
  private nodeExpandCb: TreeEngineConfig<T>['onNodeExpand'];
  private nodeCollapseCb: TreeEngineConfig<T>['onNodeCollapse'];
  /** Paths whose async beforeExpandCallback is in flight (loading state; repeat toggles ignored). */
  private _expandPending = new Set<string>();
  private beforeCopyCb: TreeEngineConfig<T>['beforeCopyCallback'];
  private beforeCutCb: TreeEngineConfig<T>['beforeCutCallback'];
  private beforePasteCb: TreeEngineConfig<T>['beforePasteCallback'];
  private beforeDeleteCb: TreeEngineConfig<T>['beforeDeleteCallback'];
  private onCopyCb: TreeEngineConfig<T>['onCopy'];
  private onCutCb: TreeEngineConfig<T>['onCut'];
  private onPasteCb: TreeEngineConfig<T>['onPaste'];
  private onDeleteCb: TreeEngineConfig<T>['onDelete'];
  private outputTransformCb: TreeEngineConfig<T>['nodeOutputTransformationCallback'];
  private inputTransformCb: TreeEngineConfig<T>['nodeInputTransformationCallback'];
  // Manual double-click detection — the flat diff reconciler patches a row's
  // attributes on the first click (focus/selection bumps _rev), which makes the
  // browser's native dblclick unreliable. Tracks the last plain UI click.
  private _lastClickPath: string | null = null;
  private _lastClickTime: number = 0;
  private nodeDragStartCb: TreeEngineConfig<T>['onNodeDragStart'];
  private nodeDragOverCb: TreeEngineConfig<T>['onNodeDragOver'];
  private beforeDropCallbackCb: TreeEngineConfig<T>['beforeDropCallback'];
  private beforeDragStartCb: TreeEngineConfig<T>['beforeDragStartCallback'];
  private nodeDropCb: TreeEngineConfig<T>['onNodeDrop'];
  private nodeDragDeniedCb: TreeEngineConfig<T>['onNodeDragDenied'];
  private nodeDropDeniedCb: TreeEngineConfig<T>['onNodeDropDenied'];
  private onTreeKeydownCb: TreeEngineConfig<T>['onTreeKeydown'];
  /** @internal Used by renderers to check if a callback is available */
  contextMenuCallbackCb: TreeEngineConfig<T>['contextMenuCallback'];
  private renderStartCb: (() => void) | undefined;
  private renderProgressCb: ((stats: RenderStats) => void) | undefined;
  private renderCompleteCb: ((stats: RenderStats) => void) | undefined;

  // Visual config
  private _clickBehavior: import('./types').ClickBehavior = 'expand-and-focus';
  private _shouldExpandAsAccordion: boolean = false;
  private _iconSet: import('./types').IconSet = 'chevron';
  private _expandIconClass: string = 'wtv__toggle-icon--expand';
  private _collapseIconClass: string = 'wtv__toggle-icon--collapse';
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
  private _dropZoneMaxWidth: number = 120;
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
  private _contextMenuVisible: boolean = false;
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
  /** The refusing row (isDropAllowed:false) the desktop drag is over — its dragover was
   *  NOT accepted (🚫 cursor), so no `drop` fires there; `dragend` announces the reject
   *  (NOTES #22). Cleared when the drag moves to anything else or a drop happens. */
  private _refusedDropNode: LTreeNode<any> | null = null;
  private _activeDropPosition: DropPosition | null = null;
  private _currentDropOperation: DropOperation = 'move';
  // Snapshot of `selectedPaths` taken in the dragstart rAF before the
  // OS-convention sync replaces it with the dragged node. Restored on
  // Esc-cancel so the user isn't left with the dragged node "stuck" selected.
  private _preDragSelectionSnapshot: Set<string> | null = null;
  // Authoritative dragged-set manifest from beforeDragStartCallback (rc13). Null =
  // no override (use the selected set). Consulted by _draggedRefs + the multi-drag
  // move/copy. Cleared on drag end. A curated override may omit descendants (holes).
  private _dragSetOverride: string[] | null = null;

  // Touch drag
  private touchDragState: {
    node: LTreeNode<any> | null;
    startX: number;
    startY: number;
    isDragging: boolean;
    /** A long-press landed on a NON-draggable node: we show the held 🚫 badge
     *  instead of starting a drag, and swallow touchmove so it stays put. */
    isDenied: boolean;
    ghostElement: HTMLElement | null;
    currentDropTarget: LTreeNode<any> | null;
  } = {
    node: null, startX: 0, startY: 0,
    isDragging: false, isDenied: false, ghostElement: null, currentDropTarget: null
  };
  private touchTimer: ReturnType<typeof setTimeout> | null = null;

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

  // Virtual scroll
  private _isVirtualScrollEnabled: boolean = false;
  private _virtualRowHeight?: number;
  private _virtualOverscan: number = 5;
  private _virtualContainerHeight?: string;
  private _vsScrollTop: number = 0;
  private _vsMeasuredRowHeight: number | null = null;
  private _vsDetectedHeight: string | null = null;

  // Skip insertArray flag
  private _skipInsertArray = false;

  // Progressive flat rendering tracker
  private lastFlatNodesTracker: Symbol | undefined | null = null;

  // Container element (set by the host component for scrollToPath)
  containerElement: HTMLElement | null = null;
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

  /** Synchronously emit state-change snapshot, bypassing microtask batching.
   *  Used when the DOM must be updated before the caller continues (e.g. scrollToPath). */
  private _flushNotify() {
    this._dirty = false;
    this.emit('state-change', this.getSnapshot());
  }

  // ── Property accessors ──────────────────────────────────────────────

  get treeId() { return this._treeId; }
  set treeId(v: string) {
    this._treeId = v;
    if (this.tree) this.tree.treePathSeparator = this._treePathSeparator;
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

  get focusedNode() { return this._focusedNode; }
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
  set shouldClickToggleCheckbox(v: boolean) { this._shouldClickToggleCheckbox = v; }

  get checkboxMode() { return this._checkboxMode; }
  set checkboxMode(v: import('./types').CheckboxMode) {
    if (this._checkboxMode === v) return;
    this._checkboxMode = v;
    this._reconcileVisualStatesForMode();
    // The emitted projection depends on the mode — re-notify with the new view.
    this._emitCheckedChange();
  }

  get cascadeCheckPolicy() { return this._cascadeCheckPolicy; }
  set cascadeCheckPolicy(v: import('./types').CascadeCheckPolicy) {
    if (this._cascadeCheckPolicy === v) return;
    this._cascadeCheckPolicy = v;
    // Re-project the (unchanged) canonical set through the new policy and notify.
    this._emitCheckedChange();
    this._scheduleNotify();
  }

  /** The emitted (policy-projected) selection — what `getCheckedPaths()` and the
   *  `checked-change` event expose. Equals the canonical set in independent mode
   *  or under the 'all' policy. */
  get emittedPaths(): Set<string> { return this._projectChecked(this._checkedPaths); }

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

  get isRendering() { return this._isRendering; }
  get isLoading() { return this._isLoading; }
  set isLoading(v: boolean) { this._isLoading = v; this._scheduleNotify(); }

  get isFlatRenderingEnabled() { return this._isFlatRenderingEnabled; }
  set isFlatRenderingEnabled(v: boolean) { this._isFlatRenderingEnabled = v; this._scheduleNotify(); }

  get flatIndentSize() { return this._flatIndentSize; }
  set flatIndentSize(v: string) { this._flatIndentSize = v; this._scheduleNotify(); }

  get isProgressiveRenderEnabled() { return this._isProgressiveRenderEnabled; }
  get initialBatchSize() { return this._initialBatchSize; }
  get maxBatchSize() { return this._maxBatchSize; }

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

  get expandIconClass() { return this._expandIconClass; }
  set expandIconClass(v: string) { this._expandIconClass = v; this._updateNodeConfig(); }

  get collapseIconClass() { return this._collapseIconClass; }
  set collapseIconClass(v: string) { this._collapseIconClass = v; this._updateNodeConfig(); }

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
  set dropZoneMaxWidth(v: number) { this._dropZoneMaxWidth = v; this._updateNodeConfig(); }

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
  get contextMenuVisible() { return this._contextMenuVisible; }
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
    if (!this._isVirtualScrollEnabled && this._isFlatRenderingEnabled && this._isProgressiveRenderEnabled) {
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

    const rowHeight = this.resolvedRowHeight;
    const containerHeightPx = parseFloat(this.resolvedContainerHeight) || 400;
    const startIndex = Math.max(0, Math.floor(this._vsScrollTop / rowHeight) - this._virtualOverscan);
    const endIndex = Math.min(all.length, Math.ceil((this._vsScrollTop + containerHeightPx) / rowHeight) + this._virtualOverscan);
    return all.slice(startIndex, endIndex);
  }

  get statistics() {
    return this.tree?.statistics;
  }

  // ── Constructor ─────────────────────────────────────────────────────

  constructor(props: TreeEngineConfig<T>) {
    super();

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
    this._shouldClickToggleCheckbox = props.shouldClickToggleCheckbox ?? false;
    this.beforeCheckboxToggleCb = props.beforeCheckboxToggleCallback;

    this._isLoading = props.isLoading ?? false;

    this._isFlatRenderingEnabled = props.isFlatRenderingEnabled ?? true;
    this._flatIndentSize = props.flatIndentSize ?? 'var(--wtv-indent-size)';
    this._isProgressiveRenderEnabled = props.isProgressiveRenderEnabled ?? true;
    this._initialBatchSize = props.initialBatchSize ?? 20;
    this._maxBatchSize = props.maxBatchSize ?? 500;
    this._bodyClass = props.bodyClass;

    this._expandLevel = props.expandLevel ?? null;
    if (props.log) this.log = props.log;
    this._dragDropMode = props.dragDropMode ?? 'none';
    this._isCopyAllowed = props.isCopyAllowed ?? false;
    this._shouldAutoHandleCopy = props.shouldAutoHandleCopy ?? true;
    this._shouldAutoHandleMove = props.shouldAutoHandleMove ?? true;
    this._shouldAutoHandlePaste = props.shouldAutoHandlePaste ?? true;
    this._shouldHandleKeyboardShortcuts = props.shouldHandleKeyboardShortcuts ?? true;
    this._touchDragDelay = props.touchDragDelay ?? 300;
    this._shouldIndicateUndraggable = props.shouldIndicateUndraggable ?? true;
    this._shouldEnableTreeDropZone = props.isTreeDropZoneEnabled ?? false;

    this._isVirtualScrollEnabled = props.isVirtualScrollEnabled ?? false;
    this._virtualRowHeight = props.virtualScrollItemHeight;
    this._virtualOverscan = props.virtualScrollOverscan ?? 5;
    this._virtualContainerHeight = props.virtualScrollContainerHeight;

    this._clickBehavior = props.clickBehavior ?? 'expand-and-focus';
    this._shouldExpandAsAccordion = props.shouldExpandAsAccordion ?? false;
    this._iconSet = props.iconSet ?? 'chevron';
    this._expandIconClass = props.expandIconClass ?? 'wtv__toggle-icon--expand';
    this._collapseIconClass = props.collapseIconClass ?? 'wtv__toggle-icon--collapse';
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
    this._dropZoneMaxWidth = props.dropZoneMaxWidth ?? 120;
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
    this.contextMenuCallbackCb = props.contextMenuCallback;
    this.renderStartCb = props.renderStartCallback;
    this.renderProgressCb = props.renderProgressCallback;
    this.renderCompleteCb = props.renderCompleteCallback;

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
      props.shouldUseInternalSearchIndex,
      props.initializeIndexCallback,
      props.indexerBatchSize,
      props.indexerTimeout,
      {
        log: this.log,
        isSorted: props.isSorted,
        sortCallback: props.sortCallback,
        displayValueFallback: props.displayValueFallback ?? '[N/A]'
      }
    );

    initLogger.debug(`[${this._treeId}] TreeEngine created`, {
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
      onNodeDragStart: this._onNodeDragStartInternal.bind(this),
      onNodeDragOver: this._onNodeDragOverInternal.bind(this),
      onNodeDragLeave: this._onNodeDragLeaveInternal.bind(this),
      onNodeDrop: this._onNodeDropInternal.bind(this),
      onZoneDrop: this._onZoneDrop.bind(this),
      onTouchDragStart: this._onTouchStart.bind(this),
      onTouchDragMove: this._onTouchMove.bind(this),
      onTouchDragEnd: this._onTouchEnd.bind(this),
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
   * collapsed ancestors on the way included) unless `noEmit`. `exclusive`
   * side-effect collapses fire no `node-collapse`.
   */
  expandNodes(
    nodePath: string | string[],
    options?: { exclusive?: boolean; noEmit?: boolean }
  ) {
    const paths = Array.isArray(nodePath) ? nodePath : [nodePath];
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
      this._gateExpand(node, () => {
        if (isSyncPhase) now.push(p);
        else this._expandWithEvents([p], options);
      });
    }
    isSyncPhase = false;
    if (now.length) this._expandWithEvents(now, options);
  }

  /** Collapse nodes; fires `node-collapse` for every node that actually collapsed (unless `noEmit`). */
  collapseNodes(
    nodePath: string | string[],
    options?: { noEmit?: boolean }
  ) {
    const paths = Array.isArray(nodePath) ? nodePath : [nodePath];
    const wereExpanded = paths
      .map((p) => this.tree?.getNodeByPath(p))
      .filter((n): n is LTreeNode<T> => !!n && !!n.isExpanded && !!n.hasChildren);
    this.tree.collapseNodes(nodePath, options);
    this._markExpanded(options?.noEmit);
    if (options?.noEmit) return;
    for (const n of wereExpanded) if (!n.isExpanded) this.nodeCollapseCb?.(this.nodeRef(n));
  }

  /** Whether `path` has an async `beforeExpandCallback` in flight (renders the loading state). */
  isExpandPending(path: string): boolean {
    return this._expandPending.has(path);
  }

  /** Expand `paths` (no gate) and fire `node-expand` for each node that changed. */
  private _expandWithEvents(paths: string[], options?: { exclusive?: boolean; noEmit?: boolean }): void {
    const sep = this._treePathSeparator;
    const changing = new Map<string, LTreeNode<T>>();
    for (const p of paths) {
      const segs = p.split(sep);
      for (let i = 1; i <= segs.length; i++) {
        const prefix = segs.slice(0, i).join(sep);
        if (changing.has(prefix)) continue;
        const n = this.tree?.getNodeByPath(prefix);
        if (!n) break;
        if (!n.isExpanded && n.hasChildren) changing.set(prefix, n);
      }
    }
    this.tree.expandNodes(paths, options);
    this._markExpanded(options?.noEmit);
    if (options?.noEmit) return;
    for (const n of changing.values()) if (n.isExpanded) this.nodeExpandCb?.(this.nodeRef(n));
  }

  /**
   * Run `beforeExpandCallback` for `node`, then `apply()` when allowed. A sync
   * hook answers synchronously (`true` applied / `false` cancelled). An async
   * hook marks the node pending (loading state, `isExpandPending`) and returns a
   * Promise; on settle the pending mark clears and `apply()` runs unless the hook
   * resolved `false` (a rejection was already turned into `false` by the adapter).
   * A request for a node that is already pending is ignored (`false`).
   */
  private _gateExpand(node: LTreeNode<T>, apply: () => void): boolean | Promise<boolean> {
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
   *  a node whose async hook is pending ignores the toggle. */
  toggleNodeExpanded(path: string): void {
    const node = this.getNodeByPath(path);
    if (!node || !node.hasChildren) return;
    // svelte-treeview blocks the entire toggle (both directions) when
    // a node is marked non-collapsible. Match that gate exactly so the
    // two packages behave the same way.
    if (!this.tree.getNodeIsCollapsible(node)) return;
    if (this._expandPending.has(path)) return;

    const shouldExpand = !node.isExpanded;

    uiLogger.debug(`Node ${shouldExpand ? 'expanded' : 'collapsed'}: ${path}`, {
      path,
      id: node.id,
      accordion: shouldExpand && this._shouldExpandAsAccordion
    });

    if (!shouldExpand) {
      this.collapseNodes(path);
      return;
    }
    this._gateExpand(node, () => this._toggleExpandApply(path));
  }

  /** The expand half of a UI toggle, after the gate: accordion side-effect + expand + events. */
  private _toggleExpandApply(path: string): void {
    const node = this.getNodeByPath(path);
    if (!node || node.isExpanded) return;
    const collapsedSiblings: LTreeNode<T>[] = [];
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
    this.tree.expandNodes(path);
    for (const s of collapsedSiblings) this.nodeCollapseCb?.(this.nodeRef(s));
    if (node.isExpanded) this.nodeExpandCb?.(this.nodeRef(node));
  }

  expandAll(
    nodePath?: string | string[] | null | undefined,
    options?: { exclusive?: boolean; noEmit?: boolean }
  ) {
    this.tree?.expandAll(nodePath, options);
    this._markExpanded(options?.noEmit);
  }

  collapseAll(
    nodePath?: string | string[] | null | undefined,
    options?: { noEmit?: boolean }
  ) {
    this.tree?.collapseAll(nodePath, options);
    this._markExpanded(options?.noEmit);
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

  refreshNode(path: string): void {
    this.tree?.refreshNode(path);
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
  private _normalizeDragManifest(paths: string[], leadPath: string): string[] {
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
    this._skipInsertArray = true;
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
        if (p === sourcePath || p.startsWith(sourcePath + sep)) {
          m.set(p, p.substring(sourcePath.length));
        }
      }
      return m;
    };
    const selectionAffected = collect(this._selectedPaths);
    const checkedAffected = collect(this._checkedPaths);
    const lastSelectedSuffix =
      this._lastSelectedPath && selectionAffected.has(this._lastSelectedPath)
        ? selectionAffected.get(this._lastSelectedPath)
        : undefined;
    const focusedAffectedSuffix =
      this._focusedNode &&
      (this._focusedNode.path === sourcePath ||
        this._focusedNode.path.startsWith(sourcePath + sep))
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
      remap(this._selectedPaths, selectionAffected);
      remap(this._checkedPaths, checkedAffected);
      if (lastSelectedSuffix !== undefined) {
        this._lastSelectedPath = newPath + lastSelectedSuffix;
      }
      if (focusedAffectedSuffix !== undefined && this._focusedNode) {
        // _focusedNode is the same node reference; its .path was already
        // updated by tree.moveNode. Nothing extra to do here — the suffix
        // capture above is just a witness that focus belongs to the moved
        // subtree, so we don't need to clear it.
      }
    }

    queueMicrotask(() => { this._skipInsertArray = false; });
    return result;
  }

  removeNode(
    path: string,
    includeDescendants: boolean = true
  ): { success: boolean; node?: LTreeNode<T>; error?: string } {
    this._skipInsertArray = true;
    const result = this.tree?.removeNode(path, includeDescendants) || {
      success: false,
      error: 'Tree not initialized'
    };
    queueMicrotask(() => { this._skipInsertArray = false; });
    return result;
  }

  addNode(
    parentPath: string,
    nodeData: T,
    pathSegment?: string
  ): { success: boolean; node?: LTreeNode<T>; error?: string } {
    this._skipInsertArray = true;
    const result = this.tree?.addNode(parentPath, nodeData, pathSegment) || {
      success: false,
      error: 'Tree not initialized'
    };
    queueMicrotask(() => { this._skipInsertArray = false; });
    return result;
  }

  updateNode(
    path: string,
    dataUpdates: Partial<T>
  ): { success: boolean; node?: LTreeNode<T>; error?: string } {
    this._skipInsertArray = true;
    const result = this.tree?.updateNode(path, dataUpdates) || {
      success: false,
      error: 'Tree not initialized'
    };
    queueMicrotask(() => { this._skipInsertArray = false; });
    return result;
  }

  applyChanges(changes: TreeChange<T>[]): ApplyChangesResult {
    this._skipInsertArray = true;
    const result = this.tree?.applyChanges(changes) || { successful: 0, failed: [] };
    queueMicrotask(() => { this._skipInsertArray = false; });
    return result;
  }

  copyNodeWithDescendants(
    sourceNode: LTreeNode<T>,
    targetParentPath: string,
    transformData: (data: T, node: LTreeNode<T>) => T | null,
    siblingPath?: string,
    position?: 'before' | 'after'
  ): { success: boolean; rootNode?: LTreeNode<T>; count: number; error?: string } {
    this._skipInsertArray = true;
    const result = this.tree?.copyNodeWithDescendants(
      sourceNode, targetParentPath, transformData, siblingPath, position
    ) || { success: false, count: 0, error: 'Tree not initialized' };
    queueMicrotask(() => { this._skipInsertArray = false; });
    return result;
  }

  /**
   * Expand a set of paths into a COMPLETE manifest: every descendant of every
   * member is added. moveNodes/duplicateNodes treat a manifest as authoritative —
   * a descendant PRESENT rides along, one ABSENT is a hole — so callers that just
   * want whole subtrees (multi-drag, DropGroup routing) must complete their set
   * first, else every unlisted descendant reads as a hole. (svelte-treeview rc13)
   */
  private _completeManifest(paths: string[]): string[] {
    if (!this.tree) return paths;
    const set = new Set<string>(paths);
    for (const p of paths) {
      const n = this.tree.getNodeByPath(p);
      if (n) for (const dp of this._getDescendantPaths(n)) set.add(dp);
    }
    return [...set];
  }

  /**
   * Complete a set of top-level dragged refs into the flattened manifest of live
   * NodeRefs (every descendant included) for beforeDragStartCallback's
   * ctx.dragged. Same-tree only (nodes are live at drag start).
   */
  private _completeDraggedRefs(refs: NodeRef<T>[]): NodeRef<T>[] {
    return this._completeManifest(refs.map((r) => r.path)).map((p) => this.nodeRef(p));
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
      for (const dp of this._getDescendantPaths(root)) {
        if (manifest.has(dp)) continue;
        const parent = dp.substring(0, dp.lastIndexOf(this._treePathSeparator));
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

    // Leaf-aware landing: a 'child' copy onto a node that disallows 'child' lands
    // beside it (inside its parent), mirroring pasteNodes + the drag position rules.
    let landTargetPath = targetPath;
    if (position === 'child' && landTargetPath !== '') {
      const t = tree.getNodeByPath(landTargetPath);
      if (t) {
        const allowed = this.getNodeAllowedDropPositions(t);
        if (allowed && allowed.length > 0 && !allowed.includes('child')) {
          landTargetPath = t.parentPath ?? '';
        }
      }
    }
    const parentPath =
      position === 'child'
        ? landTargetPath
        : (tree.getNodeByPath(landTargetPath)?.parentPath ?? '');

    const ctxFor = (
      srcNode: LTreeNode<T>,
      isRoot: boolean,
      idx: number
    ): NodeTransformContext<T> => {
      const srcParentPath = srcNode.parentPath ?? null;
      const srcParent = srcParentPath ? (src.getNodeByPath(srcParentPath) ?? null) : null;
      const anchorNode = landTargetPath ? (tree.getNodeByPath(landTargetPath) ?? null) : null;
      const anchorParentPath = anchorNode?.parentPath ?? null;
      return {
        operation: 'copy',
        phase: 'input',
        isRoot,
        rootIndex: idx,
        position,
        source: {
          path: srcNode.path,
          node: srcNode,
          parent: srcParent,
          siblings: srcParent ? (Object.values(srcParent.children) as LTreeNode<T>[]) : []
        },
        target: {
          path: landTargetPath,
          node: anchorNode,
          parent: anchorParentPath ? (tree.getNodeByPath(anchorParentPath) ?? null) : null,
          siblings: this.getChildren(anchorParentPath ?? '')
        }
      };
    };

    this._skipInsertArray = true;
    const copiedNodes: LTreeNode<T>[] = [];
    let skipped = 0;
    let lastError: string | undefined;
    let prevRootPath: string | null = null;

    for (let index = 0; index < roots.length; index++) {
      const root = roots[index];
      const siblingPath =
        prevRootPath !== null ? prevRootPath : position !== 'child' ? landTargetPath : undefined;
      const rootPosition: 'before' | 'after' | undefined =
        prevRootPath !== null ? 'after' : position !== 'child' ? (position as 'before' | 'after') : undefined;

      // Per-node wrapper: gate on the manifest (an absent descendant is a hole →
      // NOT copied), then run the caller's input transform with a full context.
      const wrapped = (data: T, srcNode: LTreeNode<T>): T | null => {
        if (!manifest.has(srcNode.path)) return null; // hole → skip node + subtree
        const ctx = ctxFor(srcNode, srcNode === root, index);
        // Egress first (the SOURCE tree's output transform, phase 'output'), then the
        // input transform — like the clipboard path (NOTES #21).
        if (outgoing) {
          const out = outgoing(JSON.parse(JSON.stringify(data)) as T, { ...ctx, phase: 'output' });
          if (out == null) return null;
          data = out;
        }
        if (!transform) return data;
        return transform(data, ctx);
      };

      const result = tree.copyNodeWithDescendants(root, parentPath, wrapped, siblingPath, rootPosition);
      if (result.success && result.rootNode) {
        copiedNodes.push(result.rootNode);
        prevRootPath = result.rootNode.path;
      } else {
        lastError = result.error;
        skipped++;
      }
    }

    queueMicrotask(() => { this._skipInsertArray = false; });

    return {
      success: copiedNodes.length > 0,
      copiedNodes,
      skipped,
      error: copiedNodes.length === 0 ? (lastError ?? 'No nodes copied') : undefined
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

  /**
   * Execute a beforeDropCallback `DropGroup[]` (content-addressed routing). Each
   * group's paths (whole-subtree roots) are completed to a manifest and moved to
   * the group's target/position via moveNodes; targets + sources are resolved to
   * live refs up front so per-move path reassignment can't stale them. Cross-tree
   * paths (not in this tree) are skipped for the consumer to place. Fires drop once
   * with all placed nodes. (svelte-treeview rc13)
   */
  private _executeDropGroups(
    groups: DropGroup[],
    fireDrop: (dropped: LTreeNode<T>[] | null) => void
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
    for (const group of resolved) {
      if (!group.nodes.length) continue;
      const manifest = this._completeManifest(group.nodes.map((n) => n.path));
      const r = this.moveNodes(manifest, group.targetNode?.path ?? group.targetPath, group.position);
      movedNodes.push(...r.movedNodes);
      if (!r.success) allOk = false;
    }
    fireDrop(movedNodes.length ? movedNodes : null);
    return allOk;
  }

  insertBranch(parentPath: string, data: T[]): InsertBranchResult<T> {
    this._skipInsertArray = true;
    const result = this.tree?.insertBranch(parentPath, data) || { success: false, count: 0, failed: [], parentNode: null, error: 'Tree not initialized' };
    queueMicrotask(() => { this._skipInsertArray = false; });
    return result;
  }

  replaceBranch(parentPath: string, data: T[]): ReplaceBranchResult<T> {
    this._skipInsertArray = true;
    const result = this.tree?.replaceBranch(parentPath, data) || { success: false, count: 0, failed: [], parentNode: null, removed: 0, added: 0, error: 'Tree not initialized' };
    queueMicrotask(() => { this._skipInsertArray = false; });
    return result;
  }

  removeBranch(path: string, keepParent?: boolean): { success: boolean; count: number; error?: string } {
    this._skipInsertArray = true;
    const result = this.tree?.removeBranch(path, keepParent) || { success: false, count: 0, error: 'Tree not initialized' };
    queueMicrotask(() => { this._skipInsertArray = false; });
    return result;
  }

  getExpandedPaths(): string[] {
    return this.tree?.getExpandedPaths() || [];
  }

  setExpandedPaths(paths: string[]): void {
    this.tree?.setExpandedPaths(paths);
    this._markExpanded();
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
   *  Pass `{ silent: true }` to skip the `selectionChangeCallback` / mirror callbacks. */
  selectNode(
    path: string,
    mode: SelectMode = 'replace',
    options?: TreeMutationOptions
  ): void {
    const modifiers: SelectionModifiers | undefined =
      mode === 'toggle' ? { ctrl: true, shift: false }
      : mode === 'range' ? { ctrl: false, shift: true }
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
    this._silentFocusPath = options?.silent ? (this._focusedNode?.path ?? null) : undefined;
  }

  /** Consume the silent-focus marker (called by the facade on each state-change). */
  takeSilentFocus(): string | null | undefined {
    const path = this._silentFocusPath;
    this._silentFocusPath = undefined;
    return path;
  }

  /** Add nodes to the selected set (additive — existing selections are kept).
   *  Use setSelectedPaths() to replace the whole set instead.
   *  Pass `{ silent: true }` to skip `selectionChangeCallback`. */
  selectNodes(paths: string[], options?: TreeMutationOptions): void {
    let lastNode: LTreeNode<T> | null = null;
    for (const path of paths) {
      const node = this.tree?.getNodeByPath(path);
      if (node && node.isSelectable) {
        this._selectedPaths.add(path);
        node.isSelected = true;
        node._rev++;
        lastNode = node;
      }
    }
    if (lastNode) {
      this._lastSelectedPath = lastNode.path;
      this._focusedNode = lastNode;
    }
    if (!options?.silent) {
      this._emitSelectionChange();
      this._mirrorSelectedToChecked();
    }
    this._markSilentFocus(options);
    this.tree.refresh();
    this._scheduleNotify();
  }

  /** Replace the entire selected set with the given paths.
   *  Equivalent to clearSelection() + selectNodes(paths).
   *  Pass `{ silent: true }` to skip `selectionChangeCallback`. */
  setSelectedPaths(paths: string[], options?: TreeMutationOptions): void {
    this._clearSelectionFlags();
    this._selectedPaths.clear();
    this._lastSelectedPath = null;
    this.selectNodes(paths, { silent: true });
    if (!options?.silent) {
      this._emitSelectionChange();
      this._mirrorSelectedToChecked();
    }
    this._markSilentFocus(options);
    this.tree.refresh();
    this._scheduleNotify();
  }

  /** Clear the selection. Pass `paths` to clear only those nodes, or omit to clear all.
   *  Pass `{ silent: true }` to skip `selectionChangeCallback`. */
  clearSelection(paths?: string[], options?: TreeMutationOptions): void {
    if (paths && paths.length > 0) {
      for (const path of paths) {
        const node = this.tree?.getNodeByPath(path);
        if (node) {
          node.isSelected = false;
          node._rev++;
        }
        this._selectedPaths.delete(path);
      }
      if (this._lastSelectedPath && !this._selectedPaths.has(this._lastSelectedPath)) {
        this._lastSelectedPath = null;
      }
    } else {
      this._clearSelectionFlags();
      this._selectedPaths.clear();
      this._lastSelectedPath = null;
      this._focusedNode = null;
    }
    if (!options?.silent) {
      this._emitSelectionChange();
      this._mirrorSelectedToChecked();
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

  /** Select every visible node. Pass `{ silent: true }` to skip
   *  `selectionChangeCallback`. */
  selectAll(options?: TreeMutationOptions): void {
    this._clearSelectionFlags();
    this._selectedPaths.clear();
    const visible = this.tree?.visibleFlatNodes ?? [];
    for (const node of visible) {
      if (!node.isSelectable) continue;
      this._selectedPaths.add(node.path);
      node.isSelected = true;
      node._rev++;
    }
    if (visible.length > 0) {
      this._lastSelectedPath = visible[visible.length - 1].path;
      this._focusedNode = visible[visible.length - 1];
    }
    if (!options?.silent) {
      this._emitSelectionChange();
      this._mirrorSelectedToChecked();
    }
    this._markSilentFocus(options);
    this.tree.refresh();
    this._scheduleNotify();
  }

  /** Clear `isSelected` flag on every node currently in the selected set. */
  private _clearSelectionFlags(): void {
    for (const path of this._selectedPaths) {
      const node = this.tree?.getNodeByPath(path);
      if (node) {
        node.isSelected = false;
        node._rev++;
      }
    }
  }

  /** Every node depth-first in display (children) order, ignoring expansion. */
  private _allNodesDepthFirst(): LTreeNode<T>[] {
    const out: LTreeNode<T>[] = [];
    const walk = (node: LTreeNode<T>) => {
      out.push(node);
      for (const child of Object.values(node.children) as LTreeNode<T>[]) walk(child);
    };
    for (const root of this.tree?.tree ?? []) walk(root);
    return out;
  }

  /** Range-select between two paths. */
  private _rangeSelect(fromPath: string, toPath: string): void {
    // visual: the rendered rows; logical: every node depth-first in display order,
    // collapsed descendants included (NOTES #7 — `tree.tree` is the roots only).
    const nodes = this._rangeSelectionMode === 'visual'
      ? (this.tree?.visibleFlatNodes ?? [])
      : this._allNodesDepthFirst();

    let fromIndex = -1;
    let toIndex = -1;
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].path === fromPath) fromIndex = i;
      if (nodes[i].path === toPath) toIndex = i;
      if (fromIndex >= 0 && toIndex >= 0) break;
    }

    if (fromIndex < 0 || toIndex < 0) return;

    const start = Math.min(fromIndex, toIndex);
    const end = Math.max(fromIndex, toIndex);

    this._clearSelectionFlags();
    this._selectedPaths.clear();

    for (let i = start; i <= end; i++) {
      const node = nodes[i];
      if (!node.isSelectable) continue;
      this._selectedPaths.add(node.path);
      node.isSelected = true;
      node._rev++;
    }

    this._focusedNode = this.tree?.getNodeByPath(toPath) ?? null;
  }

  /** Internal: do the click-driven selection work. Called by both the
   *  click handler (with `modifiers` from the event) and the public
   *  `selectNode(path, mode, options)` (which builds modifiers from
   *  the mode string). */
  private _applySelection(
    path: string,
    modifiers?: SelectionModifiers,
    options?: { silent?: boolean }
  ): void {
    const node = this.tree?.getNodeByPath(path);
    if (!node) return;

    const ctrl = modifiers?.ctrl ?? false;
    const shift = modifiers?.shift ?? false;
    // Single-mode degrades Ctrl/Shift+click to plain click (matches rc09).
    const isMulti = this._selectionMode === 'multiple';
    const useCtrl = ctrl && isMulti;
    const useShift = shift && isMulti;

    if (useShift && this._lastSelectedPath) {
      this._rangeSelect(this._lastSelectedPath, path);
    } else if (useCtrl) {
      if (!node.isSelectable) return;
      if (this._selectedPaths.has(path)) {
        this._selectedPaths.delete(path);
        node.isSelected = false;
        node._rev++;
      } else {
        this._selectedPaths.add(path);
        node.isSelected = true;
        node._rev++;
      }
      this._lastSelectedPath = path;
      this._focusedNode = node;
    } else {
      // Replace
      this._clearSelectionFlags();
      this._selectedPaths.clear();
      if (node.isSelectable) {
        this._selectedPaths.add(path);
        node.isSelected = true;
        node._rev++;
        this._lastSelectedPath = path;
      } else {
        this._lastSelectedPath = null;
      }
      this._focusedNode = node;
    }

    if (!options?.silent) {
      this._emitSelectionChange();
      this._mirrorSelectedToChecked();
    }
    this._markSilentFocus(options);
    this.tree.refresh();
    this._scheduleNotify();
  }

  /** Emit the `selectionChangeCallback` callback. */
  private _emitSelectionChange(): void {
    this.selectionChangeCb?.({ paths: new Set(this._selectedPaths), nodes: this.getSelectedNodes() });
  }

  /** Emit the `checkedChangeCallback` callback (checkbox state). */
  private _emitCheckedChange(): void {
    if (!this.checkedChangeCb) return;
    const paths = this._projectChecked(this._checkedPaths);
    const nodes: LTreeNode<T>[] = [];
    for (const p of paths) {
      const n = this.tree?.getNodeByPath(p);
      if (n) nodes.push(n);
    }
    this.checkedChangeCb({ paths, nodes });
  }

  /**
   * Project the canonical checked set through the active `cascadeCheckPolicy` to
   * produce the EMITTED selection. Pure — reads visualState/isChecked off the live
   * tree, never mutates. Independent mode OR 'all' → the canonical set as-is;
   * 'leaves' → only checked leaf nodes; 'rolled-up' → a fully-checked selectable
   * branch collapses to its root (stop descending), indeterminate branches descend
   * to emit their checked bits. (svelte-treeview rc14)
   */
  private _projectChecked(canonical: Set<string>): Set<string> {
    if (this._checkboxMode !== 'cascade' || this._cascadeCheckPolicy === 'all' || !this.tree) {
      return new Set(canonical);
    }
    const policy = this._cascadeCheckPolicy;
    const out = new Set<string>();
    const walk = (node: LTreeNode<T>) => {
      const vs = this._computeVisualState(node);
      if (vs === VisualState.unchecked) return;
      const children = Object.values(node.children);
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
    for (const root of this.tree.tree) walk(root);
    return out;
  }

  /** When `isCheckboxesShown` is false, the selected set IS the checked set —
   *  mirror it onto `_checkedPaths` so consumers reading the bindable
   *  checkbox state see what the user picked via the mouse. With checkboxes
   *  visible the two sets stay independent. Mirrors svelte-treeview rc09. */
  private _mirrorSelectedToChecked(): void {
    if (this._shouldShowCheckboxes) return;
    this._checkedPaths = new Set(this._selectedPaths);
    this._emitCheckedChange();
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
    return this._projectChecked(this._checkedPaths);
  }

  /** Check if a node is in the checked set. */
  isNodeChecked(path: string): boolean {
    return this._checkedPaths.has(path);
  }

  /** Apply a checked/unchecked state to the given paths, expanding to
   *  descendants in cascade mode and recomputing ancestor visual states.
   *  Returns whether the checked set actually changed. Does not notify. */
  private _applyCheckboxState(paths: string[], checked: boolean): boolean {
    let affected = paths;
    if (this._checkboxMode === 'cascade') {
      const expanded = new Set(paths);
      for (const path of paths) {
        const n = this.tree?.getNodeByPath(path);
        if (n) for (const dp of this._getDescendantPaths(n)) expanded.add(dp);
      }
      affected = [...expanded];
    }
    const newPaths = new Set(this._checkedPaths);
    let changed = false;
    for (const path of affected) {
      const n = this.tree?.getNodeByPath(path);
      if (!n) continue;
      if (checked) {
        if (!newPaths.has(path)) { newPaths.add(path); changed = true; }
        n.isChecked = true;
      } else {
        if (newPaths.has(path)) { newPaths.delete(path); changed = true; }
        n.isChecked = false;
      }
      n._rev++;
    }
    this._checkedPaths = newPaths;
    if (this._checkboxMode === 'cascade') {
      for (const rp of paths) {
        const rn = this.tree?.getNodeByPath(rp);
        if (!rn) continue;
        const vs = this._computeVisualState(rn);
        if (rn.visualState !== vs) { rn.visualState = vs; rn._rev++; }
        this._updateAncestorVisualStates(rp);
      }
    } else {
      for (const path of affected) {
        const n = this.tree?.getNodeByPath(path);
        if (n) n.visualState = n.isChecked ? VisualState.checked : VisualState.unchecked;
      }
    }
    return changed;
  }

  /** Clear `isChecked` + reset visualState on every node in the checkbox set. */
  private _clearCheckedFlags(): void {
    for (const path of this._checkedPaths) {
      const node = this.tree?.getNodeByPath(path);
      if (node) {
        node.isChecked = false;
        node.visualState = VisualState.unchecked;
        node._rev++;
      }
    }
  }

  /** Check a single node (cascades to descendants in cascade mode).
   *  Pass `{ silent: true }` to skip `checkedChangeCallback`. */
  checkNode(path: string, options?: TreeMutationOptions): void {
    const changed = this._applyCheckboxState([path], true);
    if (changed && !options?.silent) this._emitCheckedChange();
    this.tree.refresh();
    this._scheduleNotify();
  }

  /** Check multiple nodes (additive — existing checks are kept).
   *  Use setCheckedPaths() to replace the whole set instead.
   *  Pass `{ silent: true }` to skip `checkedChangeCallback`. */
  checkNodes(paths: string[], options?: TreeMutationOptions): void {
    const changed = this._applyCheckboxState(paths, true);
    if (changed && !options?.silent) this._emitCheckedChange();
    this.tree.refresh();
    this._scheduleNotify();
  }

  /** Replace the entire checkbox set with the given paths.
   *  Equivalent to uncheckAll() + checkNodes(paths).
   *  Pass `{ silent: true }` to skip `checkedChangeCallback`. */
  setCheckedPaths(paths: string[], options?: TreeMutationOptions): void {
    this._clearCheckedFlags();
    this._checkedPaths = new Set();
    this._applyCheckboxState(paths, true);
    if (!options?.silent) this._emitCheckedChange();
    this.tree.refresh();
    this._scheduleNotify();
  }

  /** Check every selectable node. Pass `{ silent: true }` to skip
   *  `checkedChangeCallback`. */
  checkAll(options?: TreeMutationOptions): void {
    const newPaths = new Set<string>();
    const traverse = (node: LTreeNode<T>) => {
      if (node.path && node.isSelectable) {
        node.isChecked = true;
        if (node.visualState !== VisualState.checked) node.visualState = VisualState.checked;
        node._rev++;
        newPaths.add(node.path);
      }
      for (const child of Object.values(node.children)) traverse(child);
    };
    for (const root of this.tree?.tree ?? []) traverse(root);
    this._checkedPaths = newPaths;
    if (!options?.silent) this._emitCheckedChange();
    this.tree.refresh();
    this._scheduleNotify();
  }

  /** Uncheck a single node (cascades to descendants in cascade mode).
   *  Pass `{ silent: true }` to skip `checkedChangeCallback`. */
  uncheckNode(path: string, options?: TreeMutationOptions): void {
    const changed = this._applyCheckboxState([path], false);
    if (changed && !options?.silent) this._emitCheckedChange();
    this.tree.refresh();
    this._scheduleNotify();
  }

  /** Uncheck the given nodes (cascades in cascade mode). Pass `{ silent: true }`
   *  to skip `checkedChangeCallback`. */
  uncheckNodes(paths: string[], options?: TreeMutationOptions): void {
    if (!paths || paths.length === 0) return;
    const changed = this._applyCheckboxState(paths, false);
    if (changed && !options?.silent) this._emitCheckedChange();
    this.tree.refresh();
    this._scheduleNotify();
  }

  /** Uncheck every node (empty the checked set). Pass `{ silent: true }` to skip
   *  `checkedChangeCallback`. */
  uncheckAll(options?: TreeMutationOptions): void {
    this._clearCheckedFlags();
    this._checkedPaths = new Set();
    if (!options?.silent) this._emitCheckedChange();
    this.tree.refresh();
    this._scheduleNotify();
  }

  // ── Focus (single cursor) ────────────────────────────────────────────

  /** Move focus to a node. `{ silent: true }` suppresses the resulting
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
    // In cascade mode, indeterminate → check all (not fully checked yet).
    const newChecked =
      this._checkboxMode === 'cascade' && node.visualState === VisualState.indeterminate
        ? true
        : !node.isChecked;

    // Bulk via selection: if the clicked node is in a multi-selection,
    // apply to every selected node.
    const isMultiSelected =
      this._selectedPaths.size > 1 && this._selectedPaths.has(node.path);

    let affectedPaths: string[] = isMultiSelected
      ? [...this._selectedPaths]
      : [node.path];

    if (this._checkboxMode === 'cascade') {
      const expanded = new Set(affectedPaths);
      for (const path of affectedPaths) {
        const n = this.tree?.getNodeByPath(path);
        if (n) {
          for (const dp of this._getDescendantPaths(n)) expanded.add(dp);
        }
      }
      affectedPaths = [...expanded];
    }

    // Interceptor: false → cancel, string[] → override affected paths.
    if (this.beforeCheckboxToggleCb) {
      const result = this.beforeCheckboxToggleCb(node, newChecked, affectedPaths);
      if (result === false) return;
      if (Array.isArray(result)) affectedPaths = result;
    }

    const newPaths = new Set(this._checkedPaths);
    for (const path of affectedPaths) {
      const n = this.tree?.getNodeByPath(path);
      if (!n) continue;
      if (newChecked) {
        newPaths.add(path);
        n.isChecked = true;
      } else {
        newPaths.delete(path);
        n.isChecked = false;
      }
      n._rev++;
    }
    this._checkedPaths = newPaths;

    if (!options?.skipFocus) this._focusedNode = node;

    // Update visual states (cascade only — independent mode never auto-checks
    // a parent based on descendants).
    if (this._checkboxMode === 'cascade') {
      const rootPaths = isMultiSelected ? [...this._selectedPaths] : [node.path];
      for (const rp of rootPaths) {
        const rn = this.tree?.getNodeByPath(rp);
        if (!rn) continue;
        const vs = this._computeVisualState(rn);
        if (rn.visualState !== vs) {
          rn.visualState = vs;
          rn._rev++;
        }
        this._updateAncestorVisualStates(rp);
      }
    }

    // A checkbox toggle is not a node click — `checked-change` reports it.
    this._emitCheckedChange();
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
        node._rev = (node._rev || 0) + 1;
        anyChanged = true;
        if (checkedTouched) checkedChanged = true;
      }
      for (const key in node.children) visit(node.children[key]!);
    };
    for (const key in this.tree.root.children) visit(this.tree.root.children[key]!);
    if (checkedChanged) this._checkedPaths = newPaths;
    if (anyChanged) {
      this.tree.refresh();
      if (checkedChanged) this._emitCheckedChange();
      this._scheduleNotify();
    }
  }

  /** Collect every descendant path of a node (depth-first). */
  private _getDescendantPaths(node: LTreeNode<T>): string[] {
    const result: string[] = [];
    const traverse = (n: LTreeNode<T>) => {
      for (const child of Object.values(n.children)) {
        result.push(child.path);
        traverse(child);
      }
    };
    traverse(node);
    return result;
  }

  /** Walk up from a node and set visualState on each ancestor based on its
   *  descendant checked state. Syncs `isChecked` on the ancestors (all
   *  descendants checked → ancestor checked). */
  private _updateAncestorVisualStates(startPath: string): void {
    const newPaths = new Set(this._checkedPaths);
    let path: string | null | undefined = this.tree?.getNodeByPath(startPath)?.parentPath;
    while (path) {
      const ancestor = this.tree?.getNodeByPath(path);
      if (!ancestor) break;
      const vs = this._computeVisualState(ancestor);

      const shouldBeChecked = vs === VisualState.checked;
      if (ancestor.isChecked !== shouldBeChecked) {
        ancestor.isChecked = shouldBeChecked;
        if (shouldBeChecked) newPaths.add(path);
        else newPaths.delete(path);
      }
      if (ancestor.visualState !== vs) ancestor.visualState = vs;
      ancestor._rev++;
      path = ancestor.parentPath;
    }
    this._checkedPaths = newPaths;
  }

  /** Compute the visualState (checked / unchecked / indeterminate) for a
   *  node based on its descendants' `isChecked`. Leaves use the node's own
   *  `isChecked`. */
  private _computeVisualState(node: LTreeNode<T>): VisualState {
    const children = Object.values(node.children);
    if (children.length === 0) {
      return node.isChecked ? VisualState.checked : VisualState.unchecked;
    }
    let allChecked = true;
    let noneChecked = true;
    const check = (n: LTreeNode<T>) => {
      if (!allChecked && !noneChecked) return;
      if (n.isChecked) noneChecked = false;
      else allChecked = false;
      for (const child of Object.values(n.children)) {
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
  // Every nav* method calls through `this._navigation` — the defaults from
  // `createDefaultNavigation()` merged with the consumer's `navigationOverrides`
  // (svelte-treeview parity). The defaults move via `this._navigation.navTo`, so an
  // overridden `navTo` applies to every built-in move.

  /** Navigate to a specific path (selects and focuses it). */
  navTo(path: string): void { this._navigation.navTo(path); }
  /** Navigate to the next visible node. */
  navNext(): void { this._navigation.navNext(); }
  /** Navigate to the previous visible node. */
  navPrev(): void { this._navigation.navPrev(); }
  /** ArrowDown — next visible node at the same level. */
  navNextSibling(): void { this._navigation.navNextSibling(); }
  /** ArrowUp — previous visible node at the same level. */
  navPrevSibling(): void { this._navigation.navPrevSibling(); }
  /** ArrowRight — into the first child (expands if collapsed). */
  navInto(): void { this._navigation.navInto(); }
  /** ArrowLeft — to the parent (no collapse). */
  navOut(): void { this._navigation.navOut(); }
  /** Backspace — collapse the parent and move to it. */
  navBackOut(): void { this._navigation.navBackOut(); }
  /** Enter / Space — toggle expand/collapse on the current node. */
  navToggle(): void { this._navigation.navToggle(); }
  /** Home — first visible node. */
  navFirst(): void { this._navigation.navFirst(); }
  /** End — last visible node. */
  navLast(): void { this._navigation.navLast(); }
  /** PageDown — jump forward ~10 visible nodes. */
  navPageDown(): void { this._navigation.navPageDown(); }
  /** PageUp — jump back ~10 visible nodes. */
  navPageUp(): void { this._navigation.navPageUp(); }
  /** Shift+ArrowDown — extend the selection to the next same-level node (multi mode only). */
  navSelectNext(): void { this._navigation.navSelectNext(); }
  /** Shift+ArrowUp — extend the selection to the previous same-level node (multi mode only). */
  navSelectPrev(): void { this._navigation.navSelectPrev(); }
  /** Shift+Home — extend the selection to the first visible node (multi mode only). */
  navSelectFirst(): void { this._navigation.navSelectFirst(); }
  /** Shift+End — extend the selection to the last visible node (multi mode only). */
  navSelectLast(): void { this._navigation.navSelectLast(); }
  /** Shift+PageDown — extend the selection forward ~10 visible nodes (multi mode only). */
  navSelectPageDown(): void { this._navigation.navSelectPageDown(); }
  /** Shift+PageUp — extend the selection back ~10 visible nodes (multi mode only). */
  navSelectPageUp(): void { this._navigation.navSelectPageUp(); }

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
      navTo: (path: string) => {
        this.selectNode(path);
        this.revealNode(path);
      },

      navNext: () => {
        const flat = visible();
        if (flat.length === 0) return;
        if (!this._focusedNode) {
          this._navigation.navTo(flat[0].path);
          return;
        }
        const idx = indexOfFocused(flat);
        if (idx >= 0 && idx < flat.length - 1) this._navigation.navTo(flat[idx + 1].path);
      },

      navPrev: () => {
        const flat = visible();
        if (flat.length === 0) return;
        if (!this._focusedNode) {
          this._navigation.navTo(flat[flat.length - 1].path);
          return;
        }
        const idx = indexOfFocused(flat);
        if (idx > 0) this._navigation.navTo(flat[idx - 1].path);
      },

      navNextSibling: () => {
        const flat = visible();
        if (flat.length === 0) return;
        const idx = indexOfFocused(flat);
        if (idx === -1) {
          this._navigation.navTo(flat[0].path);
          return;
        }
        const target = sameLevelFrom(flat, idx, 1);
        if (target) this._navigation.navTo(target.path);
      },

      navPrevSibling: () => {
        const flat = visible();
        if (flat.length === 0) return;
        const idx = indexOfFocused(flat);
        if (idx === -1) {
          this._navigation.navTo(flat[flat.length - 1].path);
          return;
        }
        const target = sameLevelFrom(flat, idx, -1);
        if (target) this._navigation.navTo(target.path);
      },

      navInto: () => {
        const node = this._focusedNode;
        if (!node || !node.hasChildren) return;
        // visibleFlatNodes updates synchronously — move to the first child.
        const moveIn = () => {
          if (this._focusedNode?.path !== node.path) return; // focus moved while loading
          const flat = visible();
          const idx = flat.findIndex(n => n.path === node.path);
          if (idx >= 0 && idx + 1 < flat.length) this._navigation.navTo(flat[idx + 1].path);
        };
        if (node.isExpanded) {
          moveIn();
          return;
        }
        // Expanding goes through beforeExpandCallback (may be async — lazy load).
        const gated = this._gateExpand(node, () => this._expandWithEvents([node.path]));
        if (gated instanceof Promise) gated.then((isExpanded) => { if (isExpanded) moveIn(); });
        else if (gated) moveIn();
      },

      // To the parent, no collapse (matches svelte-treeview).
      navOut: () => {
        const node = this._focusedNode;
        if (!node) return;
        const parentPath = parentPathOf(node.path);
        if (parentPath) this._navigation.navTo(parentPath);
      },

      navBackOut: () => {
        const node = this._focusedNode;
        if (!node) return;
        const parentPath = parentPathOf(node.path);
        if (!parentPath) return;
        this.collapseNodes(parentPath);
        this._navigation.navTo(parentPath);
      },

      navToggle: () => {
        const node = this._focusedNode;
        if (!node || !node.hasChildren) return;
        if (node.isExpanded) this.collapseNodes(node.path);
        else this.expandNodes(node.path);
        this._scheduleNotify();
      },

      navFirst: () => {
        const flat = visible();
        if (flat.length > 0) this._navigation.navTo(flat[0].path);
      },

      navLast: () => {
        const flat = visible();
        if (flat.length > 0) this._navigation.navTo(flat[flat.length - 1].path);
      },

      navPageDown: () => {
        const flat = visible();
        if (flat.length === 0) return;
        const idx = indexOfFocused(flat);
        const target = Math.min((idx === -1 ? 0 : idx) + NAV_PAGE_SIZE, flat.length - 1);
        this._navigation.navTo(flat[target].path);
      },

      navPageUp: () => {
        const flat = visible();
        if (flat.length === 0) return;
        const idx = indexOfFocused(flat);
        const target = Math.max((idx === -1 ? flat.length : idx) - NAV_PAGE_SIZE, 0);
        this._navigation.navTo(flat[target].path);
      },

      // ── Shift+navigation: extend the selected range ─────────────
      navSelectNext: () => {
        const flat = visible();
        const idx = indexOfFocused(flat);
        if (idx === -1) return;
        const target = sameLevelFrom(flat, idx, 1);
        if (target) this._navSelectTo(target.path);
      },

      navSelectPrev: () => {
        const flat = visible();
        const idx = indexOfFocused(flat);
        if (idx === -1) return;
        const target = sameLevelFrom(flat, idx, -1);
        if (target) this._navSelectTo(target.path);
      },

      navSelectFirst: () => {
        const flat = visible();
        if (flat.length > 0) this._navSelectTo(flat[0].path);
      },

      navSelectLast: () => {
        const flat = visible();
        if (flat.length > 0) this._navSelectTo(flat[flat.length - 1].path);
      },

      navSelectPageDown: () => {
        const flat = visible();
        const idx = indexOfFocused(flat);
        if (idx === -1) return;
        this._navSelectTo(flat[Math.min(idx + NAV_PAGE_SIZE, flat.length - 1)].path);
      },

      navSelectPageUp: () => {
        const flat = visible();
        const idx = indexOfFocused(flat);
        if (idx === -1) return;
        this._navSelectTo(flat[Math.max(idx - NAV_PAGE_SIZE, 0)].path);
      },
    };
  }

  /** Extend the selected range to `path` (Shift+nav) and move focus there. The
   *  range runs from the Shift anchor (`_lastSelectedPath` — seeded from the
   *  focused node on the first Shift move; a plain move resets it to the new
   *  node). No-op in single selection mode. */
  private _navSelectTo(path: string): void {
    if (this._selectionMode !== 'multiple') return;
    const focused = this._focusedNode;
    if (!this._lastSelectedPath && focused) {
      this._lastSelectedPath = focused.path;
      if (focused.isSelectable && !this._selectedPaths.has(focused.path)) {
        this._selectedPaths.add(focused.path);
        focused.isSelected = true;
        focused._rev++;
      }
    }
    this._applySelection(path, { ctrl: false, shift: true });
    this.revealNode(path);
  }

  /** Bumped per revealNode() call — a newer keyboard move supersedes a pending one. */
  private _revealToken = 0;

  /**
   * Keyboard navigation's scroll-into-view (svelte-treeview's navTo →
   * scrollToPath, but `block: 'nearest'`: scrolls only when the row is off-screen,
   * no highlight, no expand). Virtual scroll: the scroll offset is moved to the
   * row FIRST (nearest edge), so the pending render slices a window that contains
   * it. The DOM step runs after the scheduled render (microtask) and retries over
   * a few frames while progressive rendering hasn't reached the row yet. Mouse
   * clicks don't go through here.
   */
  revealNode(path: string): void {
    const root = this.containerElement;
    if (!root || typeof requestAnimationFrame === 'undefined') return;
    const token = ++this._revealToken;
    const scrollEl = root.querySelector('.wtv__tree') as HTMLElement | null;

    if (this._isVirtualScrollEnabled && scrollEl) {
      const idx = this.allVisibleFlatNodes.findIndex((n) => n.path === path);
      if (idx >= 0) {
        const rowHeight = this.resolvedRowHeight;
        const top = idx * rowHeight;
        const bottom = top + rowHeight;
        const viewHeight = scrollEl.clientHeight || parseFloat(this.resolvedContainerHeight) || 400;
        let scrollTop = scrollEl.scrollTop;
        if (top < scrollTop) scrollTop = top;
        else if (bottom > scrollTop + viewHeight) scrollTop = bottom - viewHeight;
        if (scrollTop !== scrollEl.scrollTop) {
          scrollEl.scrollTop = scrollTop;
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
        row.scrollIntoView({ block: 'nearest', inline: 'nearest' });
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
    let pathsToUse = paths ?? [...this._selectedPaths];
    if (pathsToUse.length === 0) return;

    // Interceptor: can modify paths (return string[]) or block (false).
    if (this.beforeCopyCb) {
      const nodes = pathsToUse
        .map((p) => this.tree.getNodeByPath(p))
        .filter((n): n is LTreeNode<T> => n !== null);
      const result = this.beforeCopyCb({ operation: 'copy', paths: pathsToUse, nodes });
      if (result === false) return;
      if (Array.isArray(result)) pathsToUse = result;
    }

    const entries: ClipboardEntry<T>[] = [];
    for (let i = 0; i < pathsToUse.length; i++) {
      const node = this.tree.getNodeByPath(pathsToUse[i]);
      if (node) entries.push(this._collectClipboardEntry(node, 'copy', i));
    }
    if (entries.length === 0) return;

    // Clear any previous cut state
    this._cutPaths.clear();

    setClipboard<T>({ operation: 'copy', entries, sourceTreeId: this._treeId });
    this.tree.refresh();
    this._scheduleNotify();
    this.onCopyCb?.({
      operation: 'copy',
      paths: pathsToUse,
      nodes: pathsToUse
        .map((p) => this.tree.getNodeByPath(p))
        .filter((n): n is LTreeNode<T> => n !== null)
    });
  }

  /** Cut selected nodes (or specified paths) to clipboard. Dimmed, not removed until paste. */
  cutNodes(paths?: string[]): void {
    let pathsToUse = paths ?? [...this._selectedPaths];
    if (pathsToUse.length === 0) return;

    // Interceptor: can modify paths (return string[]) or block (false).
    if (this.beforeCutCb) {
      const nodes = pathsToUse
        .map((p) => this.tree.getNodeByPath(p))
        .filter((n): n is LTreeNode<T> => n !== null);
      const result = this.beforeCutCb({ operation: 'cut', paths: pathsToUse, nodes });
      if (result === false) return;
      if (Array.isArray(result)) pathsToUse = result;
    }

    const entries: ClipboardEntry<T>[] = [];
    const cutSet = new Set<string>();
    for (let i = 0; i < pathsToUse.length; i++) {
      const p = pathsToUse[i];
      const node = this.tree.getNodeByPath(p);
      if (node) {
        entries.push(this._collectClipboardEntry(node, 'cut', i));
        // Dim the node itself and all descendants.
        cutSet.add(p);
        this._walkDescendants(node, (desc) => cutSet.add(desc.path));
      }
    }
    if (entries.length === 0) return;

    setClipboard<T>({ operation: 'cut', entries, sourceTreeId: this._treeId });
    this._cutPaths = cutSet;
    this.tree.refresh();
    this._scheduleNotify();
    // Cut only dims — nodes aren't removed until paste — so they're still live here.
    this.onCutCb?.({
      operation: 'cut',
      paths: pathsToUse,
      nodes: pathsToUse
        .map((p) => this.tree.getNodeByPath(p))
        .filter((n): n is LTreeNode<T> => n !== null)
    });
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

    // Leaf-aware paste position: a 'child' paste onto a node that disallows 'child'
    // drops (e.g. a leaf/file) is redirected to paste beside it (in its parent), so
    // one allowed-positions config governs both drag-drop and clipboard paste.
    if (position === 'child' && targetPath !== '') {
      const targetForChild = this.tree?.getNodeByPath(targetPath);
      if (targetForChild) {
        const allowed = this.getNodeAllowedDropPositions(targetForChild);
        if (allowed && allowed.length > 0 && !allowed.includes('child')) {
          targetPath = targetForChild.parentPath ?? '';
        }
      }
    }

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
    const apply = (data: T, ctx: NodeTransformContext<T>): T | null =>
      transform ? transform(data, ctx) : data;
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

    this._skipInsertArray = true;
    let totalCount = 0;
    let skipped = 0;
    let lastError: string | undefined;
    const pastedSourcePaths: string[] = [];
    let firstPasted: LTreeNode<T> | null = null;

    // Per-node context with LIVE, symmetric references, re-resolved per call so
    // target.node.children / target.siblings already include nodes added earlier
    // in THIS paste (batch-aware, no accumulator).
    const ctxFor = (
      anchorPath: string,
      pos: DropPosition,
      isRoot: boolean,
      idx: number,
      srcPath: string
    ): NodeTransformContext<T> => {
      const srcNode = sameTree ? this.tree.getNodeByPath(srcPath) ?? null : null;
      const srcParentPath = srcNode?.parentPath ?? null;
      const tgtNode = anchorPath ? this.tree.getNodeByPath(anchorPath) ?? null : null;
      const tgtParentPath = tgtNode?.parentPath ?? null;
      return {
        operation,
        phase: 'input',
        isRoot,
        rootIndex: idx,
        position: pos,
        source: {
          path: srcPath,
          node: srcNode,
          parent: srcParentPath ? this.tree.getNodeByPath(srcParentPath) ?? null : null,
          siblings: srcNode ? this.getChildren(srcParentPath ?? '') : []
        },
        target: {
          path: anchorPath,
          node: tgtNode,
          parent: tgtParentPath ? this.tree.getNodeByPath(tgtParentPath) ?? null : null,
          siblings: this.getChildren(tgtParentPath ?? '')
        }
      };
    };

    for (let index = 0; index < workEntries.length; index++) {
      const entry = workEntries[index];

      // Per-entry self-paste guard: skip (don't abort the batch) an entry whose
      // destination is itself or its own descendant.
      if (sameTree && !isRootPaste &&
        (destParentPath === entry.sourcePath || destParentPath.startsWith(entry.sourcePath + sep))) {
        skipped++;
        continue;
      }

      const rootData = apply(entry.data, ctxFor(targetPath, position, true, index, entry.sourcePath));
      if (rootData === null) { skipped++; continue; } // transform vetoed this entry

      const addResult =
        isRootPaste || position === 'child'
          ? this.tree.addNode(targetPath, rootData)
          : this.tree.addNode(targetNodeAfter!.parentPath ?? '', rootData);

      if (!addResult.success || !addResult.node) {
        lastError = addResult.error;
        skipped++;
        continue;
      }
      totalCount++;
      pastedSourcePaths.push(entry.sourcePath);
      firstPasted ??= addResult.node;

      // Descendants (parent-first). A vetoed descendant takes its subtree with it.
      const skippedDescRel = new Set<string>();
      for (const desc of entry.descendants) {
        const parentRel = desc.relativePath.substring(0, desc.relativePath.lastIndexOf(sep));
        if (parentRel && skippedDescRel.has(parentRel)) {
          skippedDescRel.add(desc.relativePath);
          skipped++;
          continue;
        }
        const descParentPath = parentRel ? addResult.node.path + parentRel : addResult.node.path;
        const descData = apply(
          desc.data,
          ctxFor(descParentPath, 'child', false, index, entry.sourcePath + desc.relativePath)
        );
        if (descData === null) {
          skippedDescRel.add(desc.relativePath);
          skipped++;
          continue;
        }
        const descResult = this.tree.addNode(descParentPath, descData);
        if (descResult.success) totalCount++;
        else skipped++;
      }
    }

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

    queueMicrotask(() => { this._skipInsertArray = false; });

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
      this.revealNode(firstPasted.path);
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

  /** Keep only top-level paths — a path whose ancestor is also present is dropped. */
  private _topLevelOf(paths: string[]): string[] {
    const set = new Set(paths);
    const sep = this._treePathSeparator;
    return paths.filter((p) => {
      let cursor = p;
      while (cursor.includes(sep)) {
        cursor = cursor.substring(0, cursor.lastIndexOf(sep));
        if (set.has(cursor)) return false;
      }
      return true;
    });
  }

  /**
   * Programmatic removal of nodes (and their descendants): top-level subtrees only,
   * selection + focus are cleared when anything was removed. No `beforeDeleteCallback`,
   * no `node-delete` (that is the user Delete command, {@link runDeleteCommand}).
   */
  removeNodes(paths: string[]): { removed: number; failed: number } {
    const targets = this._topLevelOf(paths ?? []);
    let removed = 0;
    let failed = 0;
    for (const p of targets) {
      if (this.removeNode(p, true).success) removed++;
      else failed++;
    }
    if (removed > 0) {
      this.clearSelection();
      this.clearFocus();
    }
    return { removed, failed };
  }

  /**
   * The user **Delete command** (Delete key, context-menu `delete`): defaults to the
   * current selection (selected set, else focused node). Runs `beforeDeleteCallback`
   * first (narrow or block), removes only top-level subtrees, clears selection +
   * focus of anything removed, and fires `onDelete` (`node-delete`) with PRE-REMOVAL
   * node snapshots. Programmatic removal is {@link removeNodes} (no veto, no event).
   */
  runDeleteCommand(paths?: string[]): { removed: number; blocked: number } {
    let targets = this._topLevelOf(paths ?? this._shortcutSelectionPaths());
    if (targets.length === 0) return { removed: 0, blocked: 0 };

    if (this.beforeDeleteCb) {
      const nodes = targets
        .map((p) => this.tree.getNodeByPath(p))
        .filter((n): n is LTreeNode<T> => n !== null);
      const result = this.beforeDeleteCb({ paths: targets, nodes });
      if (result === false) return { removed: 0, blocked: targets.length };
      if (Array.isArray(result)) targets = this._topLevelOf(result);
    }

    // Snapshot targets BEFORE removal so onDelete can hand back resolved nodes.
    const preRemoval = new Map(targets.map((p) => [p, this.tree.getNodeByPath(p)]));

    let removed = 0;
    let blocked = 0;
    for (const p of targets) {
      if (this.removeNode(p, true).success) removed++;
      else blocked++;
    }
    if (removed > 0) {
      this.clearSelection();
      this.clearFocus();
      const removedPaths = targets.slice(0, removed);
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
   * Built-in keyboard shortcuts, gated by `shouldHandleKeyboardShortcuts` (default
   * on). Returns true when it consumed the event (caller should preventDefault +
   * stop). A consumer `onTreeKeydown` runs BEFORE this, so it can override/suppress.
   *   Ctrl/Cmd+C copy · Ctrl/Cmd+X cut · Ctrl/Cmd+V paste (into focused node / root) ·
   *   Delete remove selection · Escape cancel cut. Classic CUA aliases too:
   *   Ctrl+Insert copy · Shift+Insert paste · Shift+Delete cut.
   */
  handleShortcutKeydown(event: KeyboardEvent): boolean {
    if (!this._shouldHandleKeyboardShortcuts) return false;
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    const isInsert = event.key === 'Insert';

    if ((mod && key === 'c') || (event.ctrlKey && isInsert)) {
      const p = this._shortcutSelectionPaths();
      if (!p.length) return false;
      this.copyNodes(p);
      return true;
    }
    // Cut — Ctrl/Cmd+X or Shift+Delete (checked before plain Delete below).
    if ((mod && key === 'x') || (event.shiftKey && event.key === 'Delete')) {
      const p = this._shortcutSelectionPaths();
      if (!p.length) return false;
      this.cutNodes(p);
      return true;
    }
    if ((mod && key === 'v') || (event.shiftKey && isInsert)) {
      if (!hasClipboardFn()) return false;
      this.pasteNodes(this._focusedNode?.path ?? '', this.inputTransformCb ?? null, 'child');
      return true;
    }
    // Delete selection — plain Delete only (Shift+Delete was cut, handled above).
    if (event.key === 'Delete' && !event.shiftKey) {
      if (!this._shortcutSelectionPaths().length) return false;
      this.runDeleteCommand();
      return true;
    }
    if (event.key === 'Escape' && getClipboardOp() === 'cut') {
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
    for (const child of Object.values(node.children)) {
      callback(child);
      this._walkDescendants(child, callback);
    }
  }

  /** Open the context menu at the given screen coordinates. Offsets are applied by the renderer via Floating UI. */
  openContextMenu(node: LTreeNode<T>, screenX: number, screenY: number) {
    this._contextMenuNode = node;
    this._contextMenuX = screenX;
    this._contextMenuY = screenY;
    this._contextMenuVisible = true;
    this._scheduleNotify();
  }

  closeContextMenu() {
    if (!this._contextMenuVisible && !this._contextMenuNode) return;
    this._contextMenuVisible = false;
    this._contextMenuNode = null;
    this._scheduleNotify();
  }

  // ── Public Drag-and-Drop API ────────────────────────────────────────

  /** Call from ondragstart. Sets up dataTransfer, stores drag state, fires callback. */
  startDrag(node: LTreeNode<T>, event: DragEvent): void {
    dragLogger.debug('startDrag', { path: node.path, isDraggable: this.getNodeIsDraggable(node), dragDropMode: this._dragDropMode, hasDataTransfer: !!event.dataTransfer });
    if (this._dragDropMode === 'none' || !this.getNodeIsDraggable(node) || !event.dataTransfer) return;
    event.dataTransfer.effectAllowed = this._isCopyAllowed ? 'copyMove' : 'move';
    event.dataTransfer.setData('application/svelte-treeview', JSON.stringify(node));
    const displayValue = this.tree.getNodeDisplayValue(node);
    if (displayValue) event.dataTransfer.setData('text/plain', displayValue);
    this._onNodeDragStartInternal(node, event);
  }

  /** Call from ondragover. Calculates drop position, updates hover state. */
  dragOver(node: LTreeNode<T>, event: DragEvent, element?: HTMLElement): void {
    if (!event.dataTransfer?.types.includes('application/svelte-treeview')) return;

    let effectiveDraggedNode = this._draggedNode;
    let isCrossTreeDrag = false;
    if (!effectiveDraggedNode) {
      isCrossTreeDrag = true;
      try {
        const data = event.dataTransfer.getData('application/svelte-treeview');
        if (data) effectiveDraggedNode = JSON.parse(data);
      } catch { /* getData might fail during dragover */ }
      this._isDragInProgress = true;
    }

    const dropAllowed = isCrossTreeDrag
      ? this._dragDropMode === 'both' || this._dragDropMode === 'cross'
      : this.isDropAllowedByMode(effectiveDraggedNode?.treeId);

    if (!dropAllowed) {
      this._hoveredNodeForDrop = null;
      return;
    }

    // Per-node opt-out gate. Mirrors the touch path so isDropAllowed:false
    // rejects drops on desktop too (svelte-treeview parity); no hover / indicators.
    // With a tree drop zone the dragover is ACCEPTED so the browser fires `drop` on
    // the row, which routes it to the zone. Without one it is REFUSED
    // (dropEffect 'none' → 🚫 cursor, no `drop` event) and `dragend` announces the
    // reject (node-drop-reject + 🚫 flash) on the last refusing row (NOTES #22).
    if (!node.isDropAllowed) {
      const hadHover = this._hoveredNodeForDrop !== null || this._activeDropPosition !== null;
      this._hoveredNodeForDrop = null;
      this._activeDropPosition = null;
      if (this._shouldEnableTreeDropZone) {
        this._refusedDropNode = null;
        event.preventDefault();
      } else {
        this._refusedDropNode = node;
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
      }
      if (hadHover) this._scheduleNotify();
      return;
    }
    this._refusedDropNode = null;

    const isValidDrop = effectiveDraggedNode
      ? isCrossTreeDrag || effectiveDraggedNode.path !== node.path
      : this._isDragInProgress;

    if (!isValidDrop) return;

    event.preventDefault();
    this._hoveredNodeForDrop = node;
    this._currentDropOperation = (this._isCopyAllowed && event.ctrlKey) ? 'copy' : 'move';

    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = this._currentDropOperation;
    }

    if (element) {
      const positions = this.getNodeAllowedDropPositions(node);
      this._activeDropPosition = this.calculateDropPositionFromEvent(event, element, positions);
    } else {
      const el = (event.currentTarget || event.target) as Element;
      if (el) {
        this._activeDropPosition = this.calculateDropPosition(event, el);
      }
    }

    this.nodeDragOverCb?.({ ...this.nodeRef(node), event, dragged: this._draggedRefs(this._draggedNode) });
    this._scheduleNotify();
  }

  /** Call from ondragleave. Clears hover state when cursor leaves element bounds. */
  dragLeave(_node: LTreeNode<T>, event: DragEvent): void {
    const target = event.currentTarget as HTMLElement;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const x = event.clientX;
    const y = event.clientY;

    if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) {
      this._hoveredNodeForDrop = null;
      this._activeDropPosition = null;
      this._refusedDropNode = null;
      this._scheduleNotify();
    }
  }

  /** The desktop drag moved off any row (empty body area, a zone, the empty state):
   *  it is no longer over a refusing node (NOTES #22). Called by the renderer. */
  clearRefusedDropHover(): void {
    this._refusedDropNode = null;
  }

  /**
   * A desktop drag ended (`dragend`). When it was last over a refusing row and no
   * drop happened (a successful drop resets the drag state first), announce the
   * reject there: node-drop-reject + the 🚫 flash (NOTES #22). Called by the
   * renderer (source tree: its own `dragend`; another tree: the document one).
   */
  announceRefusedDrop(): void {
    const node = this._refusedDropNode;
    this._refusedDropNode = null;
    if (!node || this._shouldEnableTreeDropZone) return;
    this._indicateDropDenied(node);
  }

  /** Call from ondrop. Uses calculated position or defaults to 'child'. */
  drop(node: LTreeNode<T>, event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();

    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = (this._isCopyAllowed && event.ctrlKey) ? 'copy' : 'move';
    }

    let isCrossTreeDrag = false;
    if (!this._draggedNode) {
      const data = event.dataTransfer?.getData('application/svelte-treeview');
      if (data) {
        this._draggedNode = JSON.parse(data);
        isCrossTreeDrag = this._draggedNode?.treeId !== this._treeId;
      }
    }

    if (this._draggedNode) {
      const dropAllowed = isCrossTreeDrag
        ? this._dragDropMode === 'both' || this._dragDropMode === 'cross'
        : this.isDropAllowedByMode(this._draggedNode.treeId);

      // Per-node opt-out gate (svelte-treeview parity): isDropAllowed:false
      // rejects the drop even when the mode allows it — routed to the tree drop
      // zone when that is on, else announced (node-drop-reject + 🚫), like the
      // touch / zone paths (NOTES #22).
      if (dropAllowed && !node.isDropAllowed) {
        if (this._shouldEnableTreeDropZone) return this.handleTreeZoneDrop(event);
        this._indicateDropDenied(node);
      } else if (dropAllowed && (isCrossTreeDrag || this._draggedNode.path !== node.path)) {
        const position = this._activeDropPosition || 'child';
        this._handleDrop(node, this._draggedNode, position, event);
      }
    }

    this._resetDragState();
  }

  /** Drop with explicit position (for custom drop zones). */
  dropAt(node: LTreeNode<T>, position: DropPosition, event: DragEvent | TouchEvent): void {
    if (event instanceof DragEvent) {
      event.preventDefault();
      if (!this._draggedNode) {
        const data = event.dataTransfer?.getData('application/svelte-treeview');
        if (data) this._draggedNode = JSON.parse(data);
      }
    }

    if (this._draggedNode) {
      this._handleDrop(node, this._draggedNode, position, event);
    }

    this._resetDragState();
  }

  /** Cancel current drag and reset all state. */
  cancelDrag(): void {
    dragLogger.debug('Drag cancelled via public API');
    this._resetDragState();
  }

  /** Touch drag start */
  touchStart(node: LTreeNode<T>, event: TouchEvent): void {
    this._onTouchStart(node, event);
  }

  /** Touch drag move */
  touchMove(node: LTreeNode<T>, event: TouchEvent): void {
    this._onTouchMove(node, event);
  }

  /** Touch drag end */
  touchEnd(node: LTreeNode<T>, event: TouchEvent): void {
    this._onTouchEnd(node, event);
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
    event: DragEvent | MouseEvent,
    element: HTMLElement,
    allowedPositions?: DropPosition[] | null
  ): DropPosition {
    const rect = element.getBoundingClientRect();
    const x = event.clientX - rect.left;
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

  async scrollToPath(
    path: string,
    options?: {
      expand?: boolean;
      expandTarget?: boolean;
      highlight?: boolean;
      scrollOptions?: ScrollIntoViewOptions;
      containerScroll?: boolean;
      containerElement?: HTMLElement;
    }
  ): Promise<boolean> {
    perfStart(`[${this._treeId}] scrollToPath`);
    const {
      expand = true,
      expandTarget = false,
      highlight = true,
      scrollOptions = { behavior: 'smooth', block: 'center' },
      containerScroll = false,
      containerElement
    } = options || {};

    const node = this.tree.getNodeByPath(path);
    if (!node || !node.id) {
      this.log.UI.warn(`scrollToPath: node not found for path ${path}`);
      perfEnd(`[${this._treeId}] scrollToPath`);
      return false;
    }

    if (expand && node.parentPath) {
      this.tree.expandNodes(node.parentPath);
    }

    if (expandTarget) {
      this.tree.expandNodes(path);
    }

    if (expand || expandTarget) {
      await new Promise<void>(resolve => queueMicrotask(resolve));
    }

    // Virtual scroll: programmatically scroll the container to bring the node into view
    if (this._isVirtualScrollEnabled) {
      const allNodes = this.allVisibleFlatNodes;
      const nodeIndex = allNodes.findIndex(n => n.path === path);
      if (nodeIndex >= 0) {
        const rowHeight = this.resolvedRowHeight;
        const containerPx = parseFloat(this.resolvedContainerHeight) || 400;
        const targetScrollTop = Math.max(0, nodeIndex * rowHeight - containerPx / 2 + rowHeight / 2);
        this._vsScrollTop = targetScrollTop;
        // Set the actual DOM scroll position
        const scrollEl = (containerElement || this.containerElement)?.querySelector('.wtv__tree') as HTMLElement;
        if (scrollEl) {
          scrollEl.scrollTop = targetScrollTop;
        }
        // Synchronous flush — renderer reconciles the visible window immediately,
        // so the target node element is in the DOM before we query for it below.
        // This also prevents race conditions when scrollToPath is called rapidly.
        this._flushNotify();
      }
    }

    const elementId = `${this._treeId}-${node.id}`;
    const rootEl = containerElement || this.containerElement;
    const findContent = (): HTMLElement | null => {
      // Find the row by PATH (unique) — ids may repeat (a pasted copy keeps its
      // source id, NOTES #8); the element id is only the fallback without a root.
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
      this.log.UI.warn(`scrollToPath: no rendered row for ${path} (${elementId})`);
      perfEnd(`[${this._treeId}] scrollToPath`);
      return false;
    }

    if (containerScroll) {
      // Caller can pass `containerElement` explicitly — useful when the
      // scrollable wrapper sits in the light DOM (outside the web-component's
      // Shadow DOM), where `findScrollableAncestor` can't walk to it.
      const container = containerElement ?? this.findScrollableAncestor(contentDiv);
      if (container) {
        const containerRect = container.getBoundingClientRect();
        const elementRect = contentDiv.getBoundingClientRect();
        const scrollTop =
          container.scrollTop +
          (elementRect.top - containerRect.top) -
          containerRect.height / 2 +
          elementRect.height / 2;
        container.scrollTo({
          top: scrollTop,
          behavior: scrollOptions?.behavior || 'smooth'
        });
      }
    } else {
      contentDiv.scrollIntoView(scrollOptions);
    }

    if (highlight && this._scrollHighlightClass) {
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

    perfEnd(`[${this._treeId}] scrollToPath`);
    return true;
  }

  // ── updateProps (batch property updates) ────────────────────────────

  updateProps(updates: Partial<TreeEngineConfig<T>>) {
    {
      const has = (k: string) => k in updates;
      this.log.INIT.debug('updateProps: node classes',
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
    const t = this.tree;
    const changed = <V>(next: V | undefined, current: V): boolean =>
      next !== undefined && next !== current;
    const needsTreeRecreation =
      changed(updates.idMember, t.idMember) ||
      changed(updates.pathMember, t.pathMember) ||
      changed(updates.parentPathMember, t.parentPathMember) ||
      changed(updates.levelMember, t.levelMember) ||
      changed(updates.hasChildrenMember, t.hasChildrenMember) ||
      changed(updates.isExpandedMember, t.isExpandedMember) ||
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
      changed(updates.sortCallback, t.sortCallback);

    // expandLevel is baked into the LTree's construction closure, so a real
    // change can only take effect by recreating the tree. Unlike a member
    // change (where we PRESERVE the user's expand/collapse state across the
    // rebuild), an explicit expandLevel change is a request to RE-SEED
    // expansion at that level — so when it changes we let the fresh insert's
    // seed stand instead of restoring the previous expanded set.
    const expandLevelChanged =
      updates.expandLevel !== undefined && (updates.expandLevel ?? null) !== (this._expandLevel ?? null);
    if (updates.expandLevel !== undefined) this._expandLevel = updates.expandLevel ?? null;

    if (updates.treeId !== undefined) this._treeId = updates.treeId || this._treeId;
    if (updates.treePathSeparator !== undefined)
      this.treePathSeparator = updates.treePathSeparator ?? '.';
    if (updates.focusedNode !== undefined) this._focusedNode = updates.focusedNode;
    if (updates.selectedPaths !== undefined)
      this._selectedPaths = new Set(updates.selectedPaths);
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
        this._emitCheckedChange(); // re-project the unchanged canonical set
      }
    }
    if (updates.shouldClickToggleCheckbox !== undefined)
      this._shouldClickToggleCheckbox = updates.shouldClickToggleCheckbox ?? false;
    if (updates.beforeCheckboxToggleCallback !== undefined)
      this.beforeCheckboxToggleCb = updates.beforeCheckboxToggleCallback;
    if (updates.searchTerm !== undefined && updates.searchTerm !== this._searchText) this.searchTerm = updates.searchTerm;
    if (updates.isLoading !== undefined) this._isLoading = updates.isLoading ?? false;
    if (updates.bodyClass !== undefined) this._bodyClass = updates.bodyClass;

    if (updates.clickBehavior !== undefined)
      this._clickBehavior = updates.clickBehavior ?? 'expand-and-focus';
    if (updates.shouldExpandAsAccordion !== undefined)
      this._shouldExpandAsAccordion = updates.shouldExpandAsAccordion ?? false;
    if (updates.iconSet !== undefined)
      this._iconSet = updates.iconSet ?? 'chevron';
    if (updates.expandIconClass !== undefined)
      this._expandIconClass = updates.expandIconClass ?? 'wtv__toggle-icon--expand';
    if (updates.collapseIconClass !== undefined)
      this._collapseIconClass = updates.collapseIconClass ?? 'wtv__toggle-icon--collapse';
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
      this._dropZoneMaxWidth = updates.dropZoneMaxWidth ?? 120;
    if (updates.isCopyAllowed !== undefined) this._isCopyAllowed = updates.isCopyAllowed ?? false;
    if (updates.shouldAutoHandleCopy !== undefined)
      this._shouldAutoHandleCopy = updates.shouldAutoHandleCopy ?? true;
    if (updates.shouldAutoHandleMove !== undefined)
      this._shouldAutoHandleMove = updates.shouldAutoHandleMove ?? true;
    if (updates.shouldAutoHandlePaste !== undefined)
      this._shouldAutoHandlePaste = updates.shouldAutoHandlePaste ?? true;
    if (updates.shouldHandleKeyboardShortcuts !== undefined)
      this._shouldHandleKeyboardShortcuts = updates.shouldHandleKeyboardShortcuts ?? true;
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
    const nextFlat = updates.isFlatRenderingEnabled !== undefined ? (updates.isFlatRenderingEnabled ?? true) : this._isFlatRenderingEnabled;
    const nextProgressive = updates.isProgressiveRenderEnabled !== undefined ? (updates.isProgressiveRenderEnabled ?? true) : this._isProgressiveRenderEnabled;
    if (nextFlat !== this._isFlatRenderingEnabled || nextProgressive !== this._isProgressiveRenderEnabled) {
      this._isFlatRenderingEnabled = nextFlat;
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
        for (const n of this.tree.visibleFlatNodes ?? []) n._rev = (n._rev || 0) + 1;
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
    if (updates.contextMenuCallback !== undefined) this.contextMenuCallbackCb = updates.contextMenuCallback;
    if (updates.hasContextMenuRenderer !== undefined) this._hasContextMenuRenderer = updates.hasContextMenuRenderer;
    if (updates.renderStartCallback !== undefined) this.renderStartCb = updates.renderStartCallback;
    if (updates.renderProgressCallback !== undefined) this.renderProgressCb = updates.renderProgressCallback;
    if (updates.renderCompleteCallback !== undefined) this.renderCompleteCb = updates.renderCompleteCallback;

    if (needsTreeRecreation || expandLevelChanged) {
      // Preserve the user's expand/collapse state across the re-insert — fresh
      // nodes otherwise reset to the expandLevel default. Capture BEFORE the new
      // tree replaces this.tree. Skipped when the user explicitly changed
      // expandLevel (then the new seed IS the desired expansion).
      const preservedExpanded = this._collectExpandedPaths();
      // Recreate LTree with updated member mappings
      const resolvedIdMember = updates.idMember ?? this.tree.idMember;
      const resolvedPathMember = updates.pathMember ?? this.tree.pathMember;
      const resolvedDisplayValueMember = updates.displayValueMember ?? this.tree.displayValueMember;
      const resolvedExpandLevel = updates.expandLevel ?? null;
      const data = updates.data ?? this._data;
      initLogger.debug(`[${this._treeId}] Recreating LTree due to member mapping changes`, {
        idMember: resolvedIdMember,
        pathMember: resolvedPathMember,
        displayValueMember: resolvedDisplayValueMember,
        parentPathMember: updates.parentPathMember ?? this.tree.parentPathMember,
        expandLevel: resolvedExpandLevel,
        dataLength: data?.length ?? 0
      });
      this.tree = createLTree<T>(
        updates.idMember ?? this.tree.idMember,
        updates.pathMember ?? this.tree.pathMember,
        updates.parentPathMember ?? this.tree.parentPathMember,
        updates.levelMember ?? this.tree.levelMember,
        updates.hasChildrenMember ?? this.tree.hasChildrenMember,
        updates.isExpandedMember ?? this.tree.isExpandedMember,
        updates.getIsExpandedCallback ?? this.tree.getIsExpandedCallback,
        updates.isSelectableMember ?? this.tree.isSelectableMember,
        updates.getIsSelectableCallback ?? this.tree.getIsSelectableCallback,
        updates.isCheckedMember ?? this.tree.isCheckedMember,
        updates.getIsCheckedCallback ?? this.tree.getIsCheckedCallback,
        updates.isDraggableMember ?? this.tree.isDraggableMember,
        updates.getIsDraggableCallback ?? this.tree.getIsDraggableCallback,
        updates.isDropAllowedMember ?? this.tree.isDropAllowedMember,
        updates.getIsDropAllowedCallback ?? this.tree.getIsDropAllowedCallback,
        updates.allowedDropPositionsMember ?? this.tree.allowedDropPositionsMember,
        updates.displayValueMember ?? this.tree.displayValueMember,
        updates.getDisplayValueCallback ?? this.tree.getDisplayValueCallback,
        updates.searchValueMember ?? this.tree.searchValueMember,
        updates.getSearchValueCallback ?? this.tree.getSearchValueCallback,
        updates.getAllowedDropPositionsCallback,
        updates.isCollapsibleMember,
        updates.getIsCollapsibleCallback,
        updates.orderMember,
        this._treeId,
        this._treePathSeparator,
        updates.expandLevel ?? null,
        updates.shouldUseInternalSearchIndex,
        undefined,
        updates.indexerBatchSize,
        updates.indexerTimeout,
        {
          log: this.log,
          isSorted: updates.isSorted ?? this.tree.isSorted,
          sortCallback: updates.sortCallback,
          displayValueFallback: updates.displayValueFallback ?? this.tree.displayValueFallback
        }
      );
      this.tree.onChange = () => this._onTreeChanged();

      // Insert data into the new tree
      if (data) {
        this._data = data;
        this._skipInsertArray = true;
        queueMicrotask(() => { this._skipInsertArray = false; });
        this._insertResult = this.tree.insertArray(data);
        this._seedCheckedPathsFromTree();
        this._reapplyRuntimeChecked();
        if (!expandLevelChanged) this._reapplyExpanded(preservedExpanded);
        this._reapplySearchFilter();
        const result = this._insertResult;
        initLogger.debug(`[${this._treeId}] insertArray result`, {
          successful: result.successful,
          failed: result.failed?.length ?? 0,
          total: result.total,
          visibleFlatNodes: this.tree.visibleFlatNodes?.length ?? 0,
          stats: this.tree.statistics
        });
        this._updateProgressiveRendering();
        initLogger.debug(`[${this._treeId}] after progressive rendering`, {
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

    this._updateNodeConfig();
    this._scheduleNotify();
  }

  /** Get a snapshot of the current state for the renderer. */
  getSnapshot(): TreeEngineSnapshot<T> {
    return {
      flatNodesToRender: this.flatNodesToRender,
      draggedNodePath: this._draggedNode?.path ?? null,
      draggedPaths: this._draggedPaths,
      isDragInProgress: this._isDragInProgress,
      hoveredNodeForDropPath: this._hoveredNodeForDrop?.path ?? null,
      activeDropPosition: this._activeDropPosition,
      currentDropOperation: this._currentDropOperation,
      contextMenuVisible: this._contextMenuVisible,
      contextMenuX: this._contextMenuX,
      contextMenuY: this._contextMenuY,
      contextMenuXOffset: this._contextMenuXOffset,
      contextMenuYOffset: this._contextMenuYOffset,
      contextMenuNode: this._contextMenuNode,
      isDropPlaceholderActive: this._isDropPlaceholderActive,
      isLoading: this._isLoading,
      isRendering: this._isRendering,
      bodyClass: this._bodyClass,
      isFlatRenderingEnabled: this._isFlatRenderingEnabled,
      flatIndentSize: this._flatIndentSize,
      focusedNode: this._focusedNode,
      selectedPaths: this._selectedPaths,
      checkedPaths: this._checkedPaths,
      cutPaths: this._cutPaths,

      // Virtual scroll
      isVirtualScrollEnabled: this._isVirtualScrollEnabled,
      virtualScrollItemHeight: this.resolvedRowHeight,
      virtualScrollContainerHeight: this.resolvedContainerHeight,
      virtualTotalHeight: this._isVirtualScrollEnabled ? this.allVisibleFlatNodes.length * this.resolvedRowHeight : 0,
      virtualStartIndex: this._isVirtualScrollEnabled
        ? Math.max(0, Math.floor(this._vsScrollTop / this.resolvedRowHeight) - this._virtualOverscan)
        : 0,
      virtualOffsetY: this._isVirtualScrollEnabled
        ? Math.max(0, Math.floor(this._vsScrollTop / this.resolvedRowHeight) - this._virtualOverscan) * this.resolvedRowHeight
        : 0,
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
    if (this._contextMenuVisible) this.closeContextMenu();
    if (typeof document !== 'undefined' && (this.touchDragState.node || this._boundDocTouchMove)) {
      this.removeGhostElement();
      this._resetTouchState();
    }
    unregisterClipboardTree(this._treeId, this);
  }

  /** The host was re-attached: rejoin the cross-tree clipboard registry. */
  activate(): void {
    registerClipboardTree(this._treeId, this);
  }

  /** Clean up document-level listeners and ghost elements. */
  destroy() {
    if (typeof document !== 'undefined') {
      this._removeDocumentTouchListeners();
      this.removeGhostElement();
      this._clearDragDenied();
      if (this._dropDeniedTimer) { clearTimeout(this._dropDeniedTimer); this._dropDeniedTimer = null; }
      this._domScope().querySelectorAll('.wtv__touch-ghost').forEach(el => el.remove());
    }
    if (this.flatRenderAnimationFrame) {
      cancelAnimationFrame(this.flatRenderAnimationFrame);
      this.flatRenderAnimationFrame = null;
    }
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

  /** After an expansion op: `silent` (noEmit) re-baselines without announcing. */
  private _markExpanded(silent?: boolean): void {
    if (silent) {
      this._lastExpandedKey = this.getExpandedPaths().join('\u0000');
      this._expandedDirty = false;
    } else {
      this._expandedDirty = true;
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
      for (const child of Object.values(node.children)) applyChecked(child);
    };
    for (const child of Object.values(this.tree.root.children)) applyChecked(child);
    // Pass 2: derived visualState — needs pass 1's isChecked on all descendants.
    const applyVisual = (node: LTreeNode<T>) => {
      node.visualState = cascade
        ? this._computeVisualState(node)
        : (node.isChecked ? VisualState.checked : VisualState.unchecked);
      for (const child of Object.values(node.children)) applyVisual(child);
    };
    for (const child of Object.values(this.tree.root.children)) applyVisual(child);
  }

  /** Snapshot which nodes are currently expanded — call BEFORE a data re-insert
   *  (which resets isExpanded to the expandLevel default) so the user's manual
   *  expand/collapse survives. Paths are stable across a re-insert. */
  /** The expanded paths of the current tree, or `null` when there is no previous
   *  tree content (first insert — the expand-level seed must stand). An EMPTY set
   *  means "the user had everything collapsed" and is restored as such (NOTES #17). */
  private _collectExpandedPaths(): Set<string> | null {
    const out = new Set<string>();
    if (!this.tree?.root || Object.keys(this.tree.root.children).length === 0) return null;
    const visit = (node: LTreeNode<T>) => {
      if (node.isExpanded) out.add(node.path);
      for (const child of Object.values(node.children)) visit(child);
    };
    for (const child of Object.values(this.tree.root.children)) visit(child);
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
      for (const child of Object.values(node.children)) visit(child);
    };
    for (const child of Object.values(this.tree.root.children)) visit(child);
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
      for (const child of Object.values(node.children)) visit(child);
    };
    const root = this.tree.root;
    if (root?.children) {
      for (const child of Object.values(root.children)) visit(child);
    }
  }

  // ── Internal: progressive flat rendering ────────────────────────────

  private _updateProgressiveRendering() {
    if (!this._isFlatRenderingEnabled || !this._isProgressiveRenderEnabled || !this.tree?.visibleFlatNodes)
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
    if (rest.length > 0) this.scheduleFlatRenderBatch();
  }

  scheduleFlatRenderBatch() {
    if (this.flatRenderAnimationFrame) return;

    this.flatRenderAnimationFrame = requestAnimationFrame(() => {
      this.flatRenderAnimationFrame = null;
      if (this.flatRenderQueue.length === 0) return;

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
    });
  }

  // ── Internal: nodeConfig ────────────────────────────────────────────

  private _updateNodeConfig() {
    this._nodeConfig = {
      clickBehavior: this._clickBehavior,
      iconSet: this._iconSet,
      expandIconClass: this._expandIconClass,
      collapseIconClass: this._collapseIconClass,
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
    this.log.RENDER.debug('config-change, focusedNodeClass =', JSON.stringify(this._focusedNodeClass));
    this.emit('config-change', this._nodeConfig);
  }

  // ── Internal event handlers ─────────────────────────────────────────

  private _nodeClickedCallback(node: LTreeNode<T>, modifiers?: SelectionModifiers) {
    if (this._contextMenuVisible) {
      this.closeContextMenu();
    }

    this._applySelection(node.path, modifiers);

    uiLogger.debug(`Node clicked: ${node.path}`, {
      newPath: node.path,
      id: node.id,
      ctrl: modifiers?.ctrl,
      shift: modifiers?.shift,
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
    uiLogger.debug(`Right-click on node: ${node.path}`, {
      hasContextMenuRenderer: this._hasContextMenuRenderer,
      hasContextMenuCallback: !!this.contextMenuCallbackCb,
    });
    if (!this._hasContextMenuRenderer && !this.contextMenuCallbackCb) {
      return;
    }

    uiLogger.debug(`Context menu opened: ${node.path}`);
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

  private calculateDropPosition(
    event: DragEvent | MouseEvent,
    element: Element
  ): DropPosition {
    const rect = element.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const height = rect.height;
    if (y < height * 0.25) return 'before';
    if (y > height * 0.75) return 'after';
    return 'child';
  }

  private _onNodeDragStartInternal(node: LTreeNode<T>, event: DragEvent) {
    dragLogger.debug(`Drag started: ${node.path}`, {
      ctrlKey: event.ctrlKey,
      isCopyAllowed: this._isCopyAllowed,
      treeId: this._treeId
    });
    this._draggedNode = node;
    this._isDragInProgress = true;

    // Set-level PRE-drag interceptor (rc13): build the tree's default dragged set,
    // hand the consumer the COMPLETE flattened set, and let them REPLACE it (prune
    // and/or force-add), cancel the drag, or leave it. Runs BEFORE the cross-tree
    // publish + onNodeDragStart so both see the final set.
    this._dragSetOverride = null;
    let draggedRefs = this._draggedRefs(node);
    if (this.beforeDragStartCb) {
      const decision = this.beforeDragStartCb({
        lead: this.nodeRef(node),
        dragged: this._completeDraggedRefs(draggedRefs),
        event
      });
      if (decision === false) {
        event.preventDefault();
        this._draggedNode = null;
        this._isDragInProgress = false;
        this._dragSetOverride = null;
        dragLogger.debug('[before-drag-start] drag cancelled by callback', { path: node.path });
        return;
      }
      if (Array.isArray(decision)) {
        this._dragSetOverride = this._normalizeDragManifest(decision, node.path);
        draggedRefs = this._draggedRefs(node); // republish through the override
      }
    }

    // Publish the top-level dragged paths (→ ctx.dragged cross-tree) PLUS the
    // PLACEMENT manifest a cross-tree auto-copy feeds to duplicateNodes: a curated
    // override keeps its holes; a plain drag is completed so whole subtrees copy.
    const placementManifest =
      this._dragSetOverride ?? this._completeManifest(draggedRefs.map((r) => r.path));
    // Dim every traveling node (roots + descendants, minus any leave-behind holes), not just
    // the roots — otherwise a dragged folder's children wouldn't dim.
    this._draggedPaths = placementManifest;
    setDragSet(this._treeId, draggedRefs.map((r) => r.path), placementManifest);
    // ALSO stash it in the dataTransfer: the module-level dragSet is cleared on the
    // source's dragend, which can fire BEFORE the target's drop under synthetic DnD.
    if (event.dataTransfer) {
      try {
        event.dataTransfer.setData(
          'application/svelte-treeview-manifest',
          JSON.stringify({ sourceTreeId: this._treeId, manifest: placementManifest })
        );
      } catch { /* setData can throw outside a dragstart — dragSet still covers it */ }
    }
    this.nodeDragStartCb?.({ ...this.nodeRef(node), event, dragged: draggedRefs });

    // OS-convention selection sync: grabbing a node that isn't part of the
    // current selected set replaces the selection with just that node.
    // Mirrors Windows Explorer / macOS Finder — without it the prior
    // selection stays visible while the drag silently carries only the
    // grabbed node, making it impossible to tell what's actually moving.
    // Skipped when the node is already in the set (multi-drag) or when
    // the node is unselectable.
    // Deferred to rAF rather than running synchronously: a sync mutation
    // of the source row before the browser commits the drag image causes
    // the renderer's keyed update to drop the dragged element and the
    // drag silently aborts. rAF runs after the drag is committed.
    if (node.isSelectable && !this._selectedPaths.has(node.path)) {
      requestAnimationFrame(() => {
        // Esc-cancel can fire dragend before this rAF runs.
        if (!this._isDragInProgress) return;
        // Snapshot the prior selection so _onNodeDragEnd can restore it if
        // the drag is Esc-cancelled. Without this, the user is left with
        // the dragged node selected even though they cancelled the operation.
        this._preDragSelectionSnapshot = new Set(this._selectedPaths);
        this._clearSelectionFlags();
        node.isSelected = true;
        node._rev++;
        this._selectedPaths = new Set([node.path]);
        this._lastSelectedPath = node.path;
        this._focusedNode = node;
        this._emitSelectionChange();
        this._mirrorSelectedToChecked();
        this.tree.refresh();
        this._scheduleNotify();
      });
    }

    this._scheduleNotify();
  }

  /** Pick out the "top-level selected" subset of `selectedPaths`:
   *  every path whose nearest selected ancestor is NOT in the set.
   *  Descendants whose ancestor is also selected are absorbed — they
   *  ride along inside the ancestor's subtree during multi-drag. */
  private _getTopLevelSelectedPaths(): string[] {
    const paths = this._selectedPaths;
    if (paths.size === 0) return [];
    const sep = this._treePathSeparator;
    const result: string[] = [];
    for (const p of paths) {
      let cursor = p;
      let absorbed = false;
      while (cursor.includes(sep)) {
        cursor = cursor.substring(0, cursor.lastIndexOf(sep));
        if (paths.has(cursor)) {
          absorbed = true;
          break;
        }
      }
      if (!absorbed) result.push(p);
    }
    return result;
  }

  _onNodeDragEnd = (event: DragEvent) => {
    this.announceRefusedDrop();
    const dropEffect = event.dataTransfer?.dropEffect;
    dragLogger.debug('Drag ended', {
      dropEffect,
      operation: this._currentDropOperation
    });
    // Esc-cancel / drop-on-invalid-target: restore the pre-drag selection so
    // the dragged node doesn't end up "stuck" selected. Mirrors svelte-treeview.
    if (dropEffect === 'none' && this._preDragSelectionSnapshot) {
      const prior = this._preDragSelectionSnapshot;
      this._clearSelectionFlags();
      this._selectedPaths = new Set(prior);
      for (const path of prior) {
        const n = this.tree?.getNodeByPath(path);
        if (n) {
          n.isSelected = true;
          n._rev++;
        }
      }
      // When the snapshot was empty, focus also belonged to nobody — clear it.
      if (prior.size === 0) this._focusedNode = null;
      this._emitSelectionChange();
      this._mirrorSelectedToChecked();
      this.tree.refresh();
    }
    this._preDragSelectionSnapshot = null;
    this._resetDragState();
  };

  private _resetDragState(): void {
    dragLogger.debug('_resetDragState');
    this._isDragInProgress = false;
    this._draggedNode = null;
    this._draggedPaths = [];
    this._hoveredNodeForDrop = null;
    this._activeDropPosition = null;
    this._refusedDropNode = null;
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
    event: DragEvent | TouchEvent
  ): Promise<boolean> {
    let operation: DropOperation = 'move';
    const isDragEvent = event instanceof DragEvent;
    const ctrlKey = isDragEvent ? event.ctrlKey : false;

    if (this._isCopyAllowed && isDragEvent && ctrlKey) {
      operation = 'copy';
    }

    dragLogger.info(`Drop: ${draggedNodeRef.path} -> ${dropNode?.path ?? 'empty tree'}`, {
      position,
      operation,
      isCrossTree: draggedNodeRef.treeId !== this._treeId
    });

    const isSameTreeDrag = draggedNodeRef.treeId === this._treeId;

    // Full top-level dragged set as NodeRefs — captured BEFORE any move mutates
    // the selected set (same-tree) or the source clears its published set
    // (cross-tree). Feeds ctx.dragged on every drop, single- or multi-origin.
    const draggedRefs = this._draggedRefs(draggedNodeRef);

    // One fire path for every branch: `dropped` = the nodes the library actually
    // placed (null when it didn't — cross-tree/consumer-owned or auto-handle off).
    const fireDrop = (dropped: LTreeNode<T>[] | null) => {
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
        return this._executeDropGroups(result, fireDrop);
      }
      if (result && typeof result === 'object') {
        if ('position' in result && result.position) position = result.position;
        if ('operation' in result && result.operation) operation = result.operation;
      }
    }

    // Multi-drag: when the dragged node is in a multi-selection set (or a
    // beforeDragStart override carries >1 top-level path), move the whole set as
    // top-level subtrees via moveNodes, which resolves refs up front, picks the
    // roots, and chains them in source order under the target. (svelte-treeview rc13)
    const isMultiDrag =
      isSameTreeDrag &&
      operation === 'move' &&
      dropNode &&
      this._shouldAutoHandleMove &&
      (this._dragSetOverride
        ? this._dragSetOverride.length > 1
        : this._selectedPaths.has(draggedNodeRef.path) && this._selectedPaths.size > 1);

    if (isMultiDrag) {
      const topLevelPaths = (this._dragSetOverride ?? this._getTopLevelSelectedPaths())
        .filter((p) => p !== dropNode!.path)
        // Respect per-node draggability: a locked node merely in the selected set
        // must NOT ride along. An explicit override skips this gate (the consumer
        // forced these in on purpose).
        .filter((p) => {
          if (this._dragSetOverride) return !!this.tree.getNodeByPath(p);
          const n = this.tree.getNodeByPath(p);
          return n ? this.getNodeIsDraggable(n) : false;
        });
      dragLogger.info(`Multi-drag: moving ${topLevelPaths.length} top-level subtree(s)`, {
        topLevelPaths,
        totalSelected: this._selectedPaths.size,
        dropTarget: dropNode!.path,
        position
      });
      // A curated override IS the manifest as-is (its omissions are holes moveNodes
      // leaves behind); a plain selected set has no holes, so complete it → whole
      // subtrees move.
      const manifest = this._dragSetOverride ? topLevelPaths : this._completeManifest(topLevelPaths);
      const result = this.moveNodes(manifest, dropNode!.path, position);
      fireDrop(result.movedNodes);
      return result.success;
    }

    if (isSameTreeDrag && operation === 'move' && dropNode) {
      if (this._shouldAutoHandleMove) {
        const result = this.moveNode(draggedNodeRef.path, dropNode.path, position);
        // moveNode mutates in place → draggedNodeRef IS the landed node.
        fireDrop(result.success ? [draggedNodeRef] : null);
        return result.success;
      }
      // shouldAutoHandleMove=false: don't mutate the tree, just notify the consumer
      fireDrop(null);
      return true;
    }

    if (isSameTreeDrag && operation === 'copy' && dropNode && this._shouldAutoHandleCopy) {
      // Copy twin of the move branches: build the same manifest (curated override
      // with holes, or the completed selected/lead set = whole subtrees), then
      // duplicateNodes runs the INPUT transform per node — the consumer's
      // pasteNodeTransformationCallback, else a default id-uniquifier.
      const transform = this.inputTransformCb ?? this._defaultCopyTransform;
      const isMulti = this._dragSetOverride
        ? this._dragSetOverride.length > 1
        : this._selectedPaths.has(draggedNodeRef.path) && this._selectedPaths.size > 1;
      const manifest = this._dragSetOverride
        ? this._dragSetOverride
        : isMulti
          ? this._completeManifest(
              this._getTopLevelSelectedPaths().filter((p) => p !== dropNode.path)
            )
          : this._completeManifest([draggedNodeRef.path]);
      const result = this.duplicateNodes(
        manifest, dropNode.path, position, transform, undefined,
        this.outputTransformCb ? (d, ctx) => this.transformOutgoing(d, ctx) : undefined
      );
      fireDrop(result.copiedNodes);
      return result.success;
    }

    if (!isSameTreeDrag && operation === 'copy' && this._shouldAutoHandleCopy) {
      // Cross-tree AUTO-copy: reach the SOURCE tree via the registry, read its
      // published PLACEMENT manifest (curated override keeps holes; a plain drag was
      // completed to whole subtrees) and duplicate it into THIS tree. The source
      // stays put — a copy re-homes nothing. Prefer the dataTransfer payload (it
      // survives the source's early dragend), fall back to the module-level dragSet.
      let sourceTreeId = draggedNodeRef.treeId ?? '';
      let manifest: string[] | null = null;
      if (event instanceof DragEvent) {
        const raw = event.dataTransfer?.getData('application/svelte-treeview-manifest');
        if (raw) {
          try {
            const m = JSON.parse(raw) as { sourceTreeId?: string; manifest?: string[] };
            if (m.sourceTreeId) sourceTreeId = m.sourceTreeId;
            if (m.manifest) manifest = m.manifest;
          } catch { /* malformed payload — fall through to the dragSet */ }
        }
      }
      if (!manifest) {
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
        fireDrop(result.copiedNodes);
        return result.success;
      }
    }

    // Cross-tree without a reachable source (or copy without shouldAutoHandleCopy):
    // the consumer performs the insertion, so dropped is null.
    fireDrop(null);
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
    event: DragEvent | TouchEvent
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

  private _onNodeDragOverInternal(node: LTreeNode<T>, event: DragEvent) {
    let effectiveDraggedNode = this._draggedNode;
    let isCrossTreeDrag = false;
    if (
      !effectiveDraggedNode &&
      event.dataTransfer?.types.includes('application/svelte-treeview')
    ) {
      isCrossTreeDrag = true;
      try {
        const data = event.dataTransfer.getData('application/svelte-treeview');
        if (data) effectiveDraggedNode = JSON.parse(data);
      } catch { /* getData might fail during dragover */ }
      this._isDragInProgress = true;
    }

    const dropAllowed = isCrossTreeDrag
      ? this._dragDropMode === 'both' || this._dragDropMode === 'cross'
      : this.isDropAllowedByMode(effectiveDraggedNode?.treeId);

    if (!dropAllowed) {
      this._hoveredNodeForDrop = null;
      return;
    }

    // Per-node opt-out gate. Mirrors the touch path so isDropAllowed:false
    // rejects drops on desktop too (svelte-treeview parity).
    if (!node.isDropAllowed) {
      this._hoveredNodeForDrop = null;
      return;
    }

    const isValidDrop = effectiveDraggedNode
      ? isCrossTreeDrag || effectiveDraggedNode.path !== node.path
      : this._isDragInProgress;

    if (isValidDrop) {
      event.preventDefault();
      this._hoveredNodeForDrop = node;
      const nodeElement = (event.target as Element).closest('.wtv__node-content');
      if (nodeElement) {
        this._activeDropPosition = this.calculateDropPosition(event, nodeElement);
      }
      this._currentDropOperation = this._isCopyAllowed && event.ctrlKey ? 'copy' : 'move';
      this.nodeDragOverCb?.({ ...this.nodeRef(node), event, dragged: this._draggedRefs(effectiveDraggedNode) });

      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = this._currentDropOperation;
      }
      this._scheduleNotify();
    }
  }

  private _onNodeDragLeaveInternal(_node: LTreeNode<T>, _event: DragEvent) {
    // Don't clear hoveredNodeForDrop — let dragover on other nodes handle it
  }

  private _onNodeDropInternal(node: LTreeNode<T>, event: DragEvent) {
    event.preventDefault();

    let isCrossTreeDrag = false;
    if (!this._draggedNode) {
      const data = event.dataTransfer?.getData('application/svelte-treeview');
      if (data) {
        this._draggedNode = JSON.parse(data);
        isCrossTreeDrag = this._draggedNode?.treeId !== this._treeId;
      }
    }

    const dropAllowed = isCrossTreeDrag
      ? this._dragDropMode === 'both' || this._dragDropMode === 'cross'
      : this.isDropAllowedByMode(this._draggedNode?.treeId);

    if (!dropAllowed) {
      this._onNodeDragEnd(event);
      return;
    }

    // Per-node opt-out gate. The Node component calls event.preventDefault()
    // before forwarding, so the drop event fires regardless of the dragover
    // gate — it must be re-checked here (svelte-treeview parity).
    if (!node.isDropAllowed) {
      // A tree drop zone catches the forwarded reject and routes it (target=null);
      // otherwise this is a genuine "can't drop here" → flash + onNodeDropDenied.
      if (this._shouldEnableTreeDropZone) return this.handleTreeZoneDrop(event);
      this._indicateDropDenied(node);
      this._onNodeDragEnd(event);
      return;
    }

    if (this._draggedNode && (isCrossTreeDrag || this._draggedNode !== node)) {
      const position = this._activeDropPosition || 'child';
      this._handleDrop(node, this._draggedNode, position, event);
    }

    this._onNodeDragEnd(event);
  }

  private _onZoneDrop(node: LTreeNode<T>, position: DropPosition, event: DragEvent) {
    event.preventDefault();

    let isCrossTreeDrag = false;
    if (!this._draggedNode) {
      const data = event.dataTransfer?.getData('application/svelte-treeview');
      if (data) {
        this._draggedNode = JSON.parse(data);
        isCrossTreeDrag = this._draggedNode?.treeId !== this._treeId;
      }
    }

    if (!this._draggedNode) {
      this._onNodeDragEnd(event);
      return;
    }

    const dropAllowed = isCrossTreeDrag
      ? this._dragDropMode === 'both' || this._dragDropMode === 'cross'
      : this.isDropAllowedByMode(this._draggedNode?.treeId);

    if (!dropAllowed) {
      this._onNodeDragEnd(event);
      return;
    }

    // Per-node opt-out gate (glow/zone equivalent of the _onNodeDrop gate).
    if (!node.isDropAllowed) {
      if (this._shouldEnableTreeDropZone) return this.handleTreeZoneDrop(event);
      this._indicateDropDenied(node);
      this._onNodeDragEnd(event);
      return;
    }

    if (isCrossTreeDrag || this._draggedNode !== node) {
      this._handleDrop(node, this._draggedNode, position, event);
    }

    this._onNodeDragEnd(event);
  }

  // ── Tree-level drop zone (isTreeDropZoneEnabled) ─────────────────────
  // The whole populated tree becomes ONE drop target: a drop anywhere lands with
  // dropNode = null (route via beforeDropCallback's DropGroup[] return), regardless
  // of per-node isDropAllowed. Wired on the always-present container (only when the
  // flag is on). dragover here preventDefaults so a drop is accepted even when every
  // node rejects it. A drop ON a node is stopPropagation()'d, so a node's reject
  // path forwards straight to handleTreeZoneDrop; drops on empty area hit it directly.

  handleTreeZoneDragOver = (event: DragEvent) => {
    if (!this._shouldEnableTreeDropZone || this._dragDropMode === 'none') return;
    const isTreeDrag = event.dataTransfer?.types.includes('application/svelte-treeview');
    if (isTreeDrag || this._draggedNode) {
      event.preventDefault();
      this._isDropPlaceholderActive = true;
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = this._isCopyAllowed && event.ctrlKey ? 'copy' : 'move';
      }
    }
  };

  handleTreeZoneDrop = (event: DragEvent) => {
    if (!this._shouldEnableTreeDropZone) return;
    event.preventDefault();
    this._isDropPlaceholderActive = false;
    if (this._dragDropMode === 'none') return;

    // Same-tree: the live draggedNode. Cross-tree: rehydrate from the dataTransfer.
    let dragged = this._draggedNode;
    if (!dragged) {
      const data = event.dataTransfer?.getData('application/svelte-treeview');
      if (data) {
        try { dragged = JSON.parse(data); } catch { /* malformed payload */ }
      }
    }
    if (dragged) this._handleDrop(null, dragged, 'child', event);
    this._onNodeDragEnd(event);
  };

  // ── Touch drag handlers ─────────────────────────────────────────────

  private _onTouchStart(node: LTreeNode<any>, event: TouchEvent) {
    const draggable = this.getNodeIsDraggable(node);

    const touch = event.touches[0];
    this.touchDragState = {
      node,
      startX: touch.clientX,
      startY: touch.clientY,
      isDragging: false,
      isDenied: false,
      ghostElement: null,
      currentDropTarget: null
    };

    this._addDocumentTouchListeners();

    // Non-draggable node: instead of silently doing nothing (which just feels
    // broken), a deliberate long-press plays the "can't move this" reaction — a
    // held 🚫 badge + double-buzz. A tap/scroll still cancels via the move
    // threshold in _docTouchMove before the timer fires. (svelte-treeview rc14)
    if (!draggable) {
      this.touchTimer = setTimeout(() => {
        this.touchDragState.isDenied = true;
        this._indicateDragDenied(node);
      }, this._touchDragDelay);
      return;
    }

    this.touchTimer = setTimeout(() => {
      this.touchDragState.isDragging = true;
      this._draggedNode = node;
      // Complete manifest so a touch-dragged folder dims its whole subtree, matching desktop.
      this._draggedPaths = this._completeManifest([node.path]);
      this._isDragInProgress = true;
      dragLogger.debug(`Touch drag started: ${node.path}`);
      this.createGhostElement(node, touch.clientX, touch.clientY);
      try { navigator.vibrate?.(50); } catch { /* blocked by browser policy */ }
      this._scheduleNotify();
    }, this._touchDragDelay);
  }

  private _onTouchMove(_node: LTreeNode<any>, _event: TouchEvent) {
    // Handled by _docTouchMove
  }

  private _onTouchEnd(_node: LTreeNode<any>, _event: TouchEvent) {
    // Handled by _docTouchEnd
  }

  // ── Document-level touch listeners ──────────────────────────────────

  private _boundDocTouchMove: ((e: TouchEvent) => void) | null = null;
  private _boundDocTouchEnd: ((e: TouchEvent) => void) | null = null;

  private _addDocumentTouchListeners() {
    this._removeDocumentTouchListeners();
    this._boundDocTouchMove = (e: TouchEvent) => this._docTouchMove(e);
    this._boundDocTouchEnd = (e: TouchEvent) => this._docTouchEnd(e);
    document.addEventListener('touchmove', this._boundDocTouchMove, { passive: false });
    document.addEventListener('touchend', this._boundDocTouchEnd);
    document.addEventListener('touchcancel', this._boundDocTouchEnd);
  }

  private _removeDocumentTouchListeners() {
    if (this._boundDocTouchMove) {
      document.removeEventListener('touchmove', this._boundDocTouchMove);
      this._boundDocTouchMove = null;
    }
    if (this._boundDocTouchEnd) {
      document.removeEventListener('touchend', this._boundDocTouchEnd);
      document.removeEventListener('touchcancel', this._boundDocTouchEnd);
      this._boundDocTouchEnd = null;
    }
  }

  private _docTouchMove(event: TouchEvent) {
    if (!this.touchDragState.node) return;

    const touch = event.touches[0];

    // A denied long-press is held: keep the 🚫 badge on the row and swallow the
    // move so the page doesn't scroll out from under it. Released in _docTouchEnd.
    if (this.touchDragState.isDenied) {
      event.preventDefault();
      return;
    }

    if (!this.touchDragState.isDragging) {
      const dx = Math.abs(touch.clientX - this.touchDragState.startX);
      const dy = Math.abs(touch.clientY - this.touchDragState.startY);
      if (dx > 10 || dy > 10) {
        if (this.touchTimer) clearTimeout(this.touchTimer);
        this._resetTouchState();
      }
      return;
    }

    event.preventDefault();

    if (this.touchDragState.ghostElement) {
      this.touchDragState.ghostElement.style.left = `${touch.clientX}px`;
      this.touchDragState.ghostElement.style.top = `${touch.clientY}px`;
    }

    if (this.touchDragState.ghostElement) {
      this.touchDragState.ghostElement.style.pointerEvents = 'none';
    }
    const elementUnderTouch = this._elementFromPoint(touch.clientX, touch.clientY);
    if (this.touchDragState.ghostElement) {
      this.touchDragState.ghostElement.style.pointerEvents = '';
    }

    this.updateDropTarget(elementUnderTouch);
  }

  private _docTouchEnd(event: TouchEvent) {
    if (this.touchTimer) clearTimeout(this.touchTimer);

    if (this.touchDragState.isDragging && this._draggedNode) {
      const touch = event.changedTouches[0];

      if (this.touchDragState.ghostElement) {
        this.touchDragState.ghostElement.style.display = 'none';
      }

      const dropElement = this._elementFromPoint(touch.clientX, touch.clientY);
      const dropNode = this.findNodeFromElement(dropElement);

      const emptyTarget = dropElement?.closest('.wtv__empty-state, .wtv__empty-zone');
      if (emptyTarget && !dropNode) {
        dragLogger.debug(`Touch drag ended: ${this._draggedNode.path} -> empty tree`);
        this._handleDrop(null, this._draggedNode, 'child', event);
      } else if (dropNode && dropNode !== this._draggedNode && dropNode.isDropAllowed) {
        dragLogger.debug(`Touch drag ended: ${this._draggedNode.path} -> ${dropNode.path}`);
        this._handleDrop(dropNode, this._draggedNode, 'child', event);
      } else if (dropNode && dropNode !== this._draggedNode && !this._shouldEnableTreeDropZone) {
        // Target refused the drop (isDropAllowed false / getIsDropAllowedCallback):
        // flash the 🚫 on it + fire onNodeDropDenied. Skipped when a tree drop zone
        // would catch the forwarded drop instead. (svelte-treeview rc14)
        dragLogger.debug(`Touch drop denied: ${this._draggedNode.path} -> ${dropNode.path}`);
        this._indicateDropDenied(dropNode);
      } else {
        dragLogger.debug(`Touch drag cancelled: ${this._draggedNode.path}`);
      }

      this.removeGhostElement();
      this.clearDropTargetHighlight();
    }

    this._resetTouchState();
  }

  private _resetTouchState() {
    this._removeDocumentTouchListeners();
    // Tear down any held "can't move this" badge/pulse.
    this._clearDragDenied();
    this.touchDragState = {
      node: null, startX: 0, startY: 0,
      isDragging: false, isDenied: false, ghostElement: null, currentDropTarget: null
    };
    this._draggedNode = null;
    this._isDragInProgress = false;
    this._isDropPlaceholderActive = false;
    this._scheduleNotify();
  }

  // ── Blocked-action feedback (svelte-treeview rc14) ──────────────────

  /** "Can't move this" — a locked node was long-pressed. Fires onNodeDragDenied
   *  always; the built-in held 🚫 badge + double-buzz only when
   *  shouldIndicateUndraggable. Torn down on release via _clearDragDenied. */
  private _indicateDragDenied(node: LTreeNode<any>) {
    dragLogger.debug('[drag-denied] locked node long-pressed', { path: node?.path });

    this.nodeDragDeniedCb?.(this.nodeRef(node));

    if (!this._shouldIndicateUndraggable) return;

    // Distinct double-buzz (a real drag start is a single 50ms buzz).
    try { navigator.vibrate?.([30, 25, 30]); } catch { /* blocked by browser policy */ }

    if (typeof document === 'undefined') return;
    const el = this._domScope().querySelector(
      `[data-tree-path="${node.path}"] .wtv__node-content`
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
  private _indicateDropDenied(node: LTreeNode<any>) {
    dragLogger.debug('[drop-denied] target refused drop', { path: node?.path });
    this._refusedDropNode = null; // announced — a later dragend must not repeat it

    this.nodeDropDeniedCb?.(this.nodeRef(node));

    if (!this._shouldIndicateUndraggable) return;

    try { navigator.vibrate?.([30, 25, 30]); } catch { /* blocked by browser policy */ }

    if (typeof document === 'undefined') return;
    const el = this._domScope().querySelector(
      `[data-tree-path="${node.path}"] .wtv__node-content`
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
    this._domScope().querySelectorAll('.wtv__touch-ghost').forEach(el => el.remove());

    const ghost = document.createElement('div');
    ghost.className = 'wtv__touch-ghost';
    ghost.textContent = this.tree.getNodeDisplayValue(node);
    ghost.style.left = `${x}px`;
    ghost.style.top = `${y}px`;
    // Inside the tree's own container, not <body>: the ghost's CSS and --wtv-*
    // variables live in the shadow root, and the container carries the
    // per-instance data-theme. position: fixed still places it by viewport.
    (this.containerElement ?? document.body).appendChild(ghost);
    this.touchDragState.ghostElement = ghost;
  }

  /** The tree's own DOM, for lookups by path: the .wtv__container (inside the
   *  shadow root for <web-treeview>), so they neither miss a shadow-rendered tree
   *  nor hit another tree with the same paths. */
  private _domScope(): ParentNode {
    return this.containerElement ?? document;
  }

  /** Hit-test from the tree's root node — document.elementFromPoint stops at
   *  the shadow host and never returns a row. */
  private _elementFromPoint(x: number, y: number): Element | null {
    const root = this.containerElement?.getRootNode();
    return (root instanceof ShadowRoot ? root : document).elementFromPoint(x, y);
  }

  private removeGhostElement() {
    if (this.touchDragState.ghostElement) {
      this.touchDragState.ghostElement.remove();
      this.touchDragState.ghostElement = null;
    }
  }

  private findNodeFromElement(element: Element | null): LTreeNode<any> | null {
    if (!element) return null;
    const nodeElement = element.closest('.wtv__node');
    if (!nodeElement) return null;
    const path = nodeElement.getAttribute('data-tree-path');
    if (!path) return null;
    return this.tree.getNodeByPath(path);
  }

  private updateDropTarget(element: Element | null) {
    const newTarget = this.findNodeFromElement(element);

    if (this.touchDragState.currentDropTarget && this.touchDragState.currentDropTarget !== newTarget) {
      const prevElement = this._domScope().querySelector(
        `[data-tree-path="${this.touchDragState.currentDropTarget.path}"] .wtv__node-content`
      );
      prevElement?.classList.remove(this._dragOverNodeClass || 'wtv__node-content--dragover-highlight');
    }

    const emptyTarget = element?.closest('.wtv__empty-state, .wtv__empty-zone');
    if (emptyTarget && !newTarget) {
      this._isDropPlaceholderActive = true;
      this.touchDragState.currentDropTarget = null;
      this._scheduleNotify();
      return;
    } else {
      this._isDropPlaceholderActive = false;
    }

    if (newTarget && newTarget !== this._draggedNode && newTarget.isDropAllowed) {
      const targetElement = this._domScope().querySelector(
        `[data-tree-path="${newTarget.path}"] .wtv__node-content`
      );
      targetElement?.classList.add(this._dragOverNodeClass || 'wtv__node-content--dragover-highlight');
      this.touchDragState.currentDropTarget = newTarget;
    } else {
      this.touchDragState.currentDropTarget = null;
    }
  }

  private clearDropTargetHighlight() {
    if (this.touchDragState.currentDropTarget) {
      const element = this._domScope().querySelector(
        `[data-tree-path="${this.touchDragState.currentDropTarget.path}"] .wtv__node-content`
      );
      element?.classList.remove(this._dragOverNodeClass || 'wtv__node-content--dragover-highlight');
    }
  }

  // ── Empty tree drop handlers ────────────────────────────────────────

  handleEmptyTreeDragOver = (event: DragEvent) => {
    if (!event.dataTransfer?.types.includes('application/svelte-treeview')) return;
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    // Only notify if state actually changed
    if (!this._isDragInProgress || !this._isDropPlaceholderActive) {
      this.log.DRAG.debug('empty-tree dragover — activating the drop placeholder');
      this._isDragInProgress = true;
      this._isDropPlaceholderActive = true;
      this._scheduleNotify();
    }
  };

  handleEmptyTreeDragLeave = (event: DragEvent) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const x = event.clientX;
    const y = event.clientY;
    const outside = x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom;
    this.log.DRAG.debug('empty-tree dragleave', { outside, x, y, rect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right } });
    if (outside) {
      this._isDragInProgress = false;
      this._isDropPlaceholderActive = false;
      this._scheduleNotify();
    }
  };

  handleEmptyTreeDrop = (event: DragEvent) => {
    event.preventDefault();
    this._isDragInProgress = false;
    this._isDropPlaceholderActive = false;

    const draggedNodeData = event.dataTransfer?.getData('application/svelte-treeview');
    if (draggedNodeData) {
      const droppedNode = JSON.parse(draggedNodeData);
      this._handleDrop(null, droppedNode, 'child', event);
    }
    this._onNodeDragEnd(event);
  };

  handleEmptyTreeTouchEnd = (event: TouchEvent) => {
    if (this._draggedNode && this._isDropPlaceholderActive) {
      this._handleDrop(null, this._draggedNode, 'child', event);
      this._isDropPlaceholderActive = false;
    }
  };

  // ── Tree-level drag handlers ────────────────────────────────────────

  handleTreeDragEnter = (event: DragEvent) => {
    this.log.DRAG.debug('tree dragenter', { nodeCount: this.flatNodesToRender.length, hasMime: event.dataTransfer?.types.includes('application/svelte-treeview') });
    if (event.dataTransfer?.types.includes('application/svelte-treeview')) {
      this._isDragInProgress = true;
      // For empty trees, also activate drop placeholder immediately
      // so renderEmpty shows the drop zone instead of recreating the empty state
      if (this.flatNodesToRender.length === 0) {
        this._isDropPlaceholderActive = true;
      }
      this._scheduleNotify();
    }
  };

  handleTreeDragLeave = (event: DragEvent) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const x = event.clientX;
    const y = event.clientY;
    const outside = x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom;
    this.log.DRAG.debug('tree dragleave', { outside, x, y, rect: { top: rect.top, bottom: rect.bottom } });
    if (outside) {
      if (this._draggedNode?.treeId !== this._treeId) {
        this._isDragInProgress = false;
        this._isDropPlaceholderActive = false;
        this._hoveredNodeForDrop = null;
        this._activeDropPosition = null;
        this._scheduleNotify();
      }
    }
  };

  // ── Helpers ──────────────────────────────────────────────────────────

  private generateTreeId(): string {
    return `${Date.now()}${Math.floor(Math.random() * 10000)}`;
  }

  findScrollableAncestor(element: HTMLElement): HTMLElement | null {
    let parent = element.parentElement;
    while (parent) {
      const style = getComputedStyle(parent);
      const overflowY = style.overflowY;
      if (
        (overflowY === 'auto' || overflowY === 'scroll') &&
        parent.scrollHeight > parent.clientHeight
      ) {
        return parent;
      }
      parent = parent.parentElement;
    }
    return null;
  }
}
