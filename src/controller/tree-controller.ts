/**
 * TreeController — all tree state & logic.
 * Ported from TreeController.svelte.ts to vanilla TypeScript.
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
  type ContextMenuItem,
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
  HighlightMode,
  TreeMutationOptions,
  TreeControllerConfig,
  TreeControllerSnapshot,
  TreeControllerEvents,
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
import { initLogger, uiLogger, dragLogger } from '../logger';
import { perfStart, perfEnd } from '../perf-logger';

// ─── TreeController ───────────────────────────────────────────────────────

export class TreeController<T> extends EventEmitter<TreeControllerEvents<T>> {
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
    highlightedNodeClass: undefined,
    focusedNodeClass: undefined,
    dragOverNodeClass: undefined,
    dragDropMode: 'none',
    dropZoneMode: 'glow',
    dropZoneLayout: 'around',
    dropZoneStart: 33,
    dropZoneMaxWidth: 120,
    isCopyAllowed: false,
    iconMember: undefined,
    shouldShowCheckboxes: false,
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
  private _shouldDisplayDebugInformation: boolean = false;
  private _shouldDisplayContextMenuInDebugMode: boolean = false;
  private _isLoading: boolean = false;
  private _isFlatRenderingEnabled: boolean = true;
  private _flatIndentSize: string = 'var(--wtv-indent-size)';
  private _isProgressiveRender: boolean = true;
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
  private _highlightedPaths: Set<string> = new Set();
  private _selectedPaths: Set<string> = new Set();
  private _lastHighlightedPath: string | null = null;
  private _rangeSelectionMode: import('./types').RangeSelectionMode = 'visual';
  private _selectionMode: 'single' | 'multi' = 'single';
  private _shouldShowCheckboxes: boolean = false;
  private _checkboxMode: import('./types').CheckboxMode = 'independent';
  // Which paths the selection EMITS in cascade mode (a projection of the canonical
  // _selectedPaths). Only applies when checkboxMode === 'cascade'. rc14.
  private _cascadeSelectPolicy: import('./types').CascadeSelectPolicy = 'rolled-up';
  private _shouldClickToggleCheckbox: boolean = false;
  private beforeCheckboxToggleCb: TreeControllerConfig<T>['beforeCheckboxToggleCallback'];

  // Clipboard (cut paths for dimming)
  private _cutPaths: Set<string> = new Set();

  // Events / callbacks (ctx-object signatures — rc07 parity)
  private selectionChangeCb: TreeControllerConfig<T>['onSelectionChange'];
  private highlightChangeCb: TreeControllerConfig<T>['onHighlightChange'];
  private nodeClickedCb: TreeControllerConfig<T>['onNodeClick'];
  private onNodeDoubleClickCb: TreeControllerConfig<T>['onNodeDoubleClick'];
  private beforeCopyCb: TreeControllerConfig<T>['beforeCopyCallback'];
  private beforeCutCb: TreeControllerConfig<T>['beforeCutCallback'];
  private beforePasteCb: TreeControllerConfig<T>['beforePasteCallback'];
  private beforeDeleteCb: TreeControllerConfig<T>['beforeDeleteCallback'];
  private onCopyCb: TreeControllerConfig<T>['onCopy'];
  private onCutCb: TreeControllerConfig<T>['onCut'];
  private onPasteCb: TreeControllerConfig<T>['onPaste'];
  private onDeleteCb: TreeControllerConfig<T>['onDelete'];
  private outputTransformCb: TreeControllerConfig<T>['nodeOutputTransformationCallback'];
  private inputTransformCb: TreeControllerConfig<T>['nodeInputTransformationCallback'];
  // Manual double-click detection — the flat diff reconciler patches a row's
  // attributes on the first click (focus/highlight bumps _rev), which makes the
  // browser's native dblclick unreliable. Tracks the last plain UI click.
  private _lastClickPath: string | null = null;
  private _lastClickTime: number = 0;
  private nodeDragStartCb: TreeControllerConfig<T>['onNodeDragStart'];
  private nodeDragOverCb: TreeControllerConfig<T>['onNodeDragOver'];
  private beforeDropCallbackCb: TreeControllerConfig<T>['beforeDropCallback'];
  private beforeDragStartCb: TreeControllerConfig<T>['beforeDragStartCallback'];
  private nodeDropCb: TreeControllerConfig<T>['onNodeDrop'];
  private nodeDragDeniedCb: TreeControllerConfig<T>['onNodeDragDenied'];
  private nodeDropDeniedCb: TreeControllerConfig<T>['onNodeDropDenied'];
  private onTreeKeydownCb: TreeControllerConfig<T>['onTreeKeydown'];
  /** @internal Used by renderers to check if a callback is available */
  contextMenuCallbackCb: TreeControllerConfig<T>['contextMenuCallback'];
  private renderStartCb: (() => void) | undefined;
  private renderProgressCb: ((stats: RenderStats) => void) | undefined;
  private renderCompleteCb: ((stats: RenderStats) => void) | undefined;

  // Visual config
  private _clickBehavior: import('./types').ClickBehavior = 'expand-and-focus';
  private _isAccordionExpand: boolean = false;
  private _iconSet: import('./types').IconSet = 'chevron';
  private _expandIconClass: string = 'wtv__toggle-icon--expand';
  private _collapseIconClass: string = 'wtv__toggle-icon--collapse';
  private _leafIconClass: string = 'wtv__toggle-icon--leaf-none';
  private _toggleIconMode: import('./types').ToggleIconMode = 'rotate';
  private _highlightedNodeClass: string | null | undefined = undefined;
  private _focusedNodeClass: string | null | undefined = undefined;
  private _dragOverNodeClass: string | null | undefined = undefined;
  private _dropZoneMode: 'floating' | 'glow' = 'glow';
  private _dropZoneLayout: 'around' | 'above' | 'below' | 'wave' | 'wave2' = 'around';
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
  private _isDebugMenuActive: boolean = false;

  // Scroll highlight
  private currentHighlight: {
    element: HTMLElement;
    timeoutId: ReturnType<typeof setTimeout>;
  } | null = null;

  // Drag and drop state
  private _draggedNode: LTreeNode<any> | null = null;
  private _isDragInProgress: boolean = false;
  private _hoveredNodeForDrop: LTreeNode<any> | null = null;
  private _activeDropPosition: DropPosition | null = null;
  private _currentDropOperation: DropOperation = 'move';
  // Snapshot of `highlightedPaths` taken in the dragstart rAF before the
  // OS-convention sync replaces it with the dragged node. Restored on
  // Esc-cancel so the user isn't left with the dragged node "stuck" selected.
  private _preDragHighlightSnapshot: Set<string> | null = null;
  // Authoritative dragged-set manifest from beforeDragStartCallback (rc13). Null =
  // no override (use the highlight set). Consulted by _draggedRefs + the multi-drag
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

  // Container element (set by the host component for scrollToPath / debug menu)
  containerElement: HTMLElement | null = null;

  // Context menu global listener cleanup
  private _contextMenuCleanup: (() => void) | null = null;

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
  set selectionMode(v: 'single' | 'multi') {
    this._selectionMode = v;
  }

  get shouldShowCheckboxes() { return this._shouldShowCheckboxes; }
  set shouldShowCheckboxes(v: boolean) {
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
    this._emitSelectionChange();
  }

  get cascadeSelectPolicy() { return this._cascadeSelectPolicy; }
  set cascadeSelectPolicy(v: import('./types').CascadeSelectPolicy) {
    if (this._cascadeSelectPolicy === v) return;
    this._cascadeSelectPolicy = v;
    // Re-project the (unchanged) canonical set through the new policy and notify.
    this._emitSelectionChange();
    this._scheduleNotify();
  }

  /** The emitted (policy-projected) selection — what `getSelectedPaths()` and the
   *  `selection-change` event expose. Equals the canonical set in independent mode
   *  or under the 'all' policy. */
  get emittedPaths(): Set<string> { return this._projectSelection(this._selectedPaths); }

  /** Bindable: the multi-select highlight set. */
  get highlightedPaths(): Set<string> { return this._highlightedPaths; }

  /** Bindable: the checkbox / data-state selection set. */
  get selectedPaths(): Set<string> { return this._selectedPaths; }

  get cutPaths(): Set<string> { return this._cutPaths; }

  get focusedNodeClass() { return this._focusedNodeClass; }
  set focusedNodeClass(v: string | null | undefined) { this._focusedNodeClass = v; this._updateNodeConfig(); }

  get insertResult() { return this._insertResult; }
  get searchText() { return this._searchText; }
  set searchText(v: string | null | undefined) {
    this._searchText = v;
    this.tree?.filterNodes(v as string);
    this._scheduleNotify();
  }

  get isRendering() { return this._isRendering; }
  get shouldDisplayDebugInformation() { return this._shouldDisplayDebugInformation; }
  set shouldDisplayDebugInformation(v: boolean) {
    this._shouldDisplayDebugInformation = v;
    this._scheduleNotify();
  }

  get shouldDisplayContextMenuInDebugMode() { return this._shouldDisplayContextMenuInDebugMode; }
  set shouldDisplayContextMenuInDebugMode(v: boolean) {
    this._shouldDisplayContextMenuInDebugMode = v;
    this._updateDebugContextMenu();
  }

  get isLoading() { return this._isLoading; }
  set isLoading(v: boolean) { this._isLoading = v; this._scheduleNotify(); }

  get isFlatRenderingEnabled() { return this._isFlatRenderingEnabled; }
  set isFlatRenderingEnabled(v: boolean) { this._isFlatRenderingEnabled = v; this._scheduleNotify(); }

  get flatIndentSize() { return this._flatIndentSize; }
  set flatIndentSize(v: string) { this._flatIndentSize = v; this._scheduleNotify(); }

  get isProgressiveRender() { return this._isProgressiveRender; }
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

  get shouldEnableTreeDropZone() { return this._shouldEnableTreeDropZone; }
  set shouldEnableTreeDropZone(v: boolean) { this._shouldEnableTreeDropZone = v; }

  get clickBehavior() { return this._clickBehavior; }
  set clickBehavior(v: import('./types').ClickBehavior) { this._clickBehavior = v; this._updateNodeConfig(); }

  get isAccordionExpand() { return this._isAccordionExpand; }
  set isAccordionExpand(v: boolean) { this._isAccordionExpand = v; }

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

  get highlightedNodeClass() { return this._highlightedNodeClass; }
  set highlightedNodeClass(v: string | null | undefined) { this._highlightedNodeClass = v; this._updateNodeConfig(); }

  get dragOverNodeClass() { return this._dragOverNodeClass; }
  set dragOverNodeClass(v: string | null | undefined) { this._dragOverNodeClass = v; this._updateNodeConfig(); }

  get dropZoneMode() { return this._dropZoneMode; }
  set dropZoneMode(v: 'floating' | 'glow') { this._dropZoneMode = v; this._updateNodeConfig(); }

  get dropZoneLayout() { return this._dropZoneLayout; }
  set dropZoneLayout(v: 'around' | 'above' | 'below' | 'wave' | 'wave2') { this._dropZoneLayout = v; this._updateNodeConfig(); }

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

  get virtualRowHeight() { return this._virtualRowHeight; }
  set virtualRowHeight(v: number | undefined) { this._virtualRowHeight = v; this._scheduleNotify(); }

  get virtualOverscan() { return this._virtualOverscan; }
  set virtualOverscan(v: number) { this._virtualOverscan = v; this._scheduleNotify(); }

  get virtualContainerHeight() { return this._virtualContainerHeight; }
  set virtualContainerHeight(v: string | undefined) { this._virtualContainerHeight = v; this._scheduleNotify(); }

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
    if (!this._isVirtualScrollEnabled && this._isFlatRenderingEnabled && this._isProgressiveRender) {
      return this.tree?.visibleFlatNodes?.filter(
        (n) => this.flatRenderedIds.has(String(n.id))
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

  constructor(props: TreeControllerConfig<T>) {
    super();

    // Assign prop values (with defaults)
    this._treeId = props.treeId || this.generateTreeId();
    this._treePathSeparator = props.treePathSeparator ?? '.';
    // Register in the module-level clipboard registry so a cross-tree cut/paste
    // can reach back here to remove the originals.
    registerClipboardTree(this._treeId, this);

    this._data = props.data;
    this._focusedNode = props.focusedNode ?? null;
    this._searchText = props.searchText;
    this._rangeSelectionMode = props.rangeSelectionMode ?? 'visual';
    this._selectionMode = props.selectionMode ?? 'single';
    this._shouldShowCheckboxes = props.shouldShowCheckboxes ?? false;
    this._checkboxMode = props.checkboxMode ?? 'independent';
    this._cascadeSelectPolicy = props.cascadeSelectPolicy ?? 'rolled-up';
    this._shouldClickToggleCheckbox = props.shouldClickToggleCheckbox ?? false;
    this.beforeCheckboxToggleCb = props.beforeCheckboxToggleCallback;

    this._shouldDisplayDebugInformation = props.shouldDisplayDebugInformation ?? false;
    this._shouldDisplayContextMenuInDebugMode = props.shouldDisplayContextMenuInDebugMode ?? false;
    this._isLoading = props.isLoading ?? false;

    this._isFlatRenderingEnabled = props.isFlatRenderingEnabled ?? true;
    this._flatIndentSize = props.flatIndentSize ?? 'var(--wtv-indent-size)';
    this._isProgressiveRender = props.isProgressiveRender ?? true;
    this._initialBatchSize = props.initialBatchSize ?? 20;
    this._maxBatchSize = props.maxBatchSize ?? 500;
    this._bodyClass = props.bodyClass;

    this._expandLevel = props.expandLevel ?? null;
    this._dragDropMode = props.dragDropMode ?? 'none';
    this._isCopyAllowed = props.isCopyAllowed ?? false;
    this._shouldAutoHandleCopy = props.shouldAutoHandleCopy ?? true;
    this._shouldAutoHandleMove = props.shouldAutoHandleMove ?? true;
    this._shouldAutoHandlePaste = props.shouldAutoHandlePaste ?? true;
    this._shouldHandleKeyboardShortcuts = props.shouldHandleKeyboardShortcuts ?? true;
    this._touchDragDelay = props.touchDragDelay ?? 300;
    this._shouldIndicateUndraggable = props.shouldIndicateUndraggable ?? true;
    this._shouldEnableTreeDropZone = props.shouldEnableTreeDropZone ?? false;

    this._isVirtualScrollEnabled = props.isVirtualScrollEnabled ?? false;
    this._virtualRowHeight = props.virtualRowHeight;
    this._virtualOverscan = props.virtualOverscan ?? 5;
    this._virtualContainerHeight = props.virtualContainerHeight;

    this._clickBehavior = props.clickBehavior ?? 'expand-and-focus';
    this._isAccordionExpand = props.isAccordionExpand ?? false;
    this._iconSet = props.iconSet ?? 'chevron';
    this._expandIconClass = props.expandIconClass ?? 'wtv__toggle-icon--expand';
    this._collapseIconClass = props.collapseIconClass ?? 'wtv__toggle-icon--collapse';
    this._leafIconClass = props.leafIconClass ?? 'wtv__toggle-icon--leaf-none';
    this._toggleIconMode = props.toggleIconMode ?? 'rotate';
    this._highlightedNodeClass = props.highlightedNodeClass;
    this._focusedNodeClass = props.focusedNodeClass;
    this._dragOverNodeClass = props.dragOverNodeClass;
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
    this._shouldAlignNodeIcons = props.shouldAlignNodeIcons ?? true;
    this._nodeClass = props.nodeClass;
    this._nodeContentClass = props.nodeContentClass;

    // Store callbacks
    this.selectionChangeCb = props.onSelectionChange;
    this.highlightChangeCb = props.onHighlightChange;
    this.nodeClickedCb = props.onNodeClick;
    this.onNodeDoubleClickCb = props.onNodeDoubleClick;
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
      props.isSelectedMember,
      props.getIsSelectedCallback,
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
        shouldDisplayDebugInformation: props.shouldDisplayDebugInformation,
        isSorted: props.isSorted,
        sortCallback: props.sortCallback,
        displayValueFallback: props.displayValueFallback ?? '[N/A]'
      }
    );

    initLogger.debug(`[${this._treeId}] TreeController created`, {
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
    this.renderCoordinator = this._isProgressiveRender
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
      this._seedSelectedPathsFromTree();
      this._reapplyRuntimeSelection();
      this._reapplyExpanded(preservedExpanded);
    }

    // Apply initial search filter
    if (this._searchText) {
      this.tree.filterNodes(this._searchText as string);
    }
  }

  // ── Public API methods ──────────────────────────────────────────────

  expandNodes(
    nodePath: string | string[],
    options?: { exclusive?: boolean; noEmit?: boolean }
  ) {
    this.tree.expandNodes(nodePath, options);
  }

  collapseNodes(
    nodePath: string | string[],
    options?: { noEmit?: boolean }
  ) {
    this.tree.collapseNodes(nodePath, options);
  }

  /** Toggle expand/collapse for a node clicked via the toggle UI. Honors the
   *  `isAccordionExpand` config: when expanding under accordion mode, every
   *  expanded sibling (whose `isCollapsible` allows it) is first collapsed
   *  in a single batch. Programmatic `expandNodes` / `expandAll` callers
   *  bypass the accordion. Mirrors svelte-treeview Node.svelte's
   *  toggleExpanded() flow. */
  toggleNodeExpanded(path: string): void {
    const node = this.getNodeByPath(path);
    if (!node || !node.hasChildren) return;
    // svelte-treeview blocks the entire toggle (both directions) when
    // a node is marked non-collapsible. Match that gate exactly so the
    // two packages behave the same way.
    if (!this.tree.getNodeIsCollapsible(node)) return;

    const shouldExpand = !node.isExpanded;

    uiLogger.debug(`Node ${shouldExpand ? 'expanded' : 'collapsed'}: ${path}`, {
      path,
      id: node.id,
      accordion: shouldExpand && this._isAccordionExpand
    });

    if (shouldExpand && this._isAccordionExpand) {
      const siblings = this.tree.getSiblings(path);
      for (const sibling of siblings) {
        if (sibling.path !== path && sibling.isExpanded && this.tree.getNodeIsCollapsible(sibling)) {
          sibling.isExpanded = false;
          (sibling as any)._rev = ((sibling as any)._rev || 0) + 1;
        }
      }
    }

    if (shouldExpand) this.tree.expandNodes(path);
    else this.tree.collapseNodes(path);
  }

  expandAll(
    nodePath?: string | string[] | null | undefined,
    options?: { exclusive?: boolean; noEmit?: boolean }
  ) {
    this.tree?.expandAll(nodePath, options);
  }

  collapseAll(
    nodePath?: string | string[] | null | undefined,
    options?: { noEmit?: boolean }
  ) {
    this.tree?.collapseAll(nodePath, options);
  }

  filterNodes(searchTextVal: string, searchOptions?: SearchOptions): void {
    this.tree?.filterNodes(searchTextVal, searchOptions);
  }

  searchNodes(
    searchTextVal: string | null | undefined,
    searchOptions?: SearchOptions
  ): LTreeNode<T>[] {
    return this.tree?.searchNodes(searchTextVal, searchOptions) || [];
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
   * same-tree multi-highlight, the draggable top-level highlighted subtrees (the
   * same set the multi-drag move loop uses); otherwise just the grabbed node.
   * Used to populate `dragged` on the drag/drop contexts. Call BEFORE a move
   * mutates the highlight set.
   */
  private _draggedTopLevel(draggedNode: LTreeNode<T>): LTreeNode<T>[] {
    const isSameTree = draggedNode.treeId === this._treeId;
    if (
      isSameTree &&
      this._highlightedPaths.has(draggedNode.path) &&
      this._highlightedPaths.size > 1
    ) {
      const set = this._getTopLevelHighlightedPaths()
        .map((p) => this.tree?.getNodeByPath(p) ?? null)
        .filter((n): n is LTreeNode<T> => !!n && this.getNodeIsDraggable(n));
      if (set.length) return set;
    }
    return [draggedNode];
  }

  /**
   * The full top-level dragged set as NodeRefs, correct for BOTH same-tree and
   * cross-tree drags — the single source of `ctx.dragged` on drag start/over/drop.
   * Same-tree reads the live highlight set (nodes resolve). Cross-tree can't see
   * the source's highlight, so it reads the paths the source published on drag
   * start (getDragSet) and builds path-only refs (node/parent null cross-tree);
   * falls back to the lead node alone when no set was published (e.g. touch). Call
   * BEFORE a move mutates the highlight set.
   */
  private _draggedRefs(draggedNode: LTreeNode<T> | null): NodeRef<T>[] {
    if (!draggedNode) return [];
    if (draggedNode.treeId === this._treeId) {
      // A beforeDragStartCallback override is authoritative: resolve its paths
      // directly (bypassing the highlight-derived set AND the isDraggable gate,
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
    return paths.map((p) => this.nodeRef(p));
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
    // Capture the affected path set BEFORE the move: any highlighted /
    // selected path that is the source itself or a descendant of it needs
    // to be remapped onto the new location. Without this the path Sets
    // keep stale strings after a multi-drag, so the next plain click leaves
    // visually-highlighted ghosts in the old positions and downstream
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
    const highlightAffected = collect(this._highlightedPaths);
    const selectedAffected = collect(this._selectedPaths);
    const lastHighlightSuffix =
      this._lastHighlightedPath && highlightAffected.has(this._lastHighlightedPath)
        ? highlightAffected.get(this._lastHighlightedPath)
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
      remap(this._highlightedPaths, highlightAffected);
      remap(this._selectedPaths, selectedAffected);
      if (lastHighlightSuffix !== undefined) {
        this._lastHighlightedPath = newPath + lastHighlightSuffix;
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
    sourceTree?: Ltree<T>
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
        index: idx,
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
        if (!transform) return data;
        return transform(data, ctxFor(srcNode, srcNode === root, index));
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

  insertBranch(parentPath: string, data: T[]): { success: boolean; count: number; error?: string } {
    this._skipInsertArray = true;
    const result = this.tree?.insertBranch(parentPath, data) || { success: false, count: 0, error: 'Tree not initialized' };
    queueMicrotask(() => { this._skipInsertArray = false; });
    return result;
  }

  replaceBranch(parentPath: string, data: T[]): { success: boolean; removed: number; added: number; error?: string } {
    this._skipInsertArray = true;
    const result = this.tree?.replaceBranch(parentPath, data) || { success: false, removed: 0, added: 0, error: 'Tree not initialized' };
    queueMicrotask(() => { this._skipInsertArray = false; });
    return result;
  }

  deleteBranch(path: string, keepParent?: boolean): { success: boolean; count: number; error?: string } {
    this._skipInsertArray = true;
    const result = this.tree?.deleteBranch(path, keepParent) || { success: false, count: 0, error: 'Tree not initialized' };
    queueMicrotask(() => { this._skipInsertArray = false; });
    return result;
  }

  getExpandedPaths(): string[] {
    return this.tree?.getExpandedPaths() || [];
  }

  setExpandedPaths(paths: string[]): void {
    this.tree?.setExpandedPaths(paths);
  }

  getAllData(): T[] {
    return this.tree?.getAllData() || [];
  }

  // ── Highlight API (multi-select via Ctrl/Shift+click) ────────────────
  //
  // Three-level selection model (mirrors svelte-treeview rc06+):
  //   - focusedNode     = single focused node (click, arrow keys)
  //   - highlightedPaths = multi-select set built by Ctrl/Shift+click
  //   - selectedPaths    = checkbox data state (touched by check/uncheck)
  //
  // When `shouldShowCheckboxes` is false, every change to `highlightedPaths` is
  // mirrored into `selectedPaths` so the form-style selection still reflects
  // what the user picked via the mouse. With checkboxes visible the two sets
  // stay independent.

  /** Programmatically update the highlight set.
   *  - `mode='replace'`: replaces the set with `path`
   *  - `mode='toggle'`: toggles `path` in/out of the set
   *  - `mode='range'`: range-selects from focused node to `path`
   *  Pass `{ silent: true }` to skip the `highlightChangeCallback` / mirror callbacks. */
  highlightNode(
    path: string,
    mode: HighlightMode = 'replace',
    options?: TreeMutationOptions
  ): void {
    const modifiers: SelectionModifiers | undefined =
      mode === 'toggle' ? { ctrl: true, shift: false }
      : mode === 'range' ? { ctrl: false, shift: true }
      : undefined;
    this._applyHighlight(path, modifiers, options);
  }

  /** Add nodes to the highlight set (additive — existing highlights are kept).
   *  Use setHighlightedPaths() to replace the whole set instead.
   *  Pass `{ silent: true }` to skip `highlightChangeCallback`. */
  highlightNodes(paths: string[], options?: TreeMutationOptions): void {
    let lastNode: LTreeNode<T> | null = null;
    for (const path of paths) {
      const node = this.tree?.getNodeByPath(path);
      if (node && node.isSelectable) {
        this._highlightedPaths.add(path);
        node.isHighlighted = true;
        node._rev++;
        lastNode = node;
      }
    }
    if (lastNode) {
      this._lastHighlightedPath = lastNode.path;
      this._focusedNode = lastNode;
    }
    if (!options?.silent) {
      this._emitHighlightChange();
      this._mirrorHighlightToSelected();
    }
    this.tree.refresh();
    this._scheduleNotify();
  }

  /** Replace the entire highlight set with the given paths.
   *  Equivalent to clearHighlight() + highlightNodes(paths).
   *  Pass `{ silent: true }` to skip `highlightChangeCallback`. */
  setHighlightedPaths(paths: string[], options?: TreeMutationOptions): void {
    this._clearHighlightFlags();
    this._highlightedPaths.clear();
    this._lastHighlightedPath = null;
    this.highlightNodes(paths, { silent: true });
    if (!options?.silent) {
      this._emitHighlightChange();
      this._mirrorHighlightToSelected();
    }
    this.tree.refresh();
    this._scheduleNotify();
  }

  /** Clear highlights. Pass `paths` to clear only those nodes, or omit to clear all.
   *  Pass `{ silent: true }` to skip `highlightChangeCallback`. */
  clearHighlight(paths?: string[], options?: TreeMutationOptions): void {
    if (paths && paths.length > 0) {
      for (const path of paths) {
        const node = this.tree?.getNodeByPath(path);
        if (node) {
          node.isHighlighted = false;
          node._rev++;
        }
        this._highlightedPaths.delete(path);
      }
      if (this._lastHighlightedPath && !this._highlightedPaths.has(this._lastHighlightedPath)) {
        this._lastHighlightedPath = null;
      }
    } else {
      this._clearHighlightFlags();
      this._highlightedPaths.clear();
      this._lastHighlightedPath = null;
      this._focusedNode = null;
    }
    if (!options?.silent) {
      this._emitHighlightChange();
      this._mirrorHighlightToSelected();
    }
    this.tree.refresh();
    this._scheduleNotify();
  }

  /** Get all currently highlighted nodes. */
  getHighlightedNodes(): LTreeNode<T>[] {
    const nodes: LTreeNode<T>[] = [];
    for (const path of this._highlightedPaths) {
      const node = this.tree?.getNodeByPath(path);
      if (node) nodes.push(node);
    }
    return nodes;
  }

  /** Get a snapshot of the highlighted-path set. */
  getHighlightedPaths(): Set<string> {
    return new Set(this._highlightedPaths);
  }

  /** Check if a node is in the highlight set. */
  isNodeHighlighted(path: string): boolean {
    return this._highlightedPaths.has(path);
  }

  /** Highlight every visible node. Pass `{ silent: true }` to skip
   *  `highlightChangeCallback`. */
  highlightAll(options?: TreeMutationOptions): void {
    this._clearHighlightFlags();
    this._highlightedPaths.clear();
    const visible = this.tree?.visibleFlatNodes ?? [];
    for (const node of visible) {
      if (!node.isSelectable) continue;
      this._highlightedPaths.add(node.path);
      node.isHighlighted = true;
      node._rev++;
    }
    if (visible.length > 0) {
      this._lastHighlightedPath = visible[visible.length - 1].path;
      this._focusedNode = visible[visible.length - 1];
    }
    if (!options?.silent) {
      this._emitHighlightChange();
      this._mirrorHighlightToSelected();
    }
    this.tree.refresh();
    this._scheduleNotify();
  }

  /** Clear `isHighlighted` flag on every node currently in the highlight set. */
  private _clearHighlightFlags(): void {
    for (const path of this._highlightedPaths) {
      const node = this.tree?.getNodeByPath(path);
      if (node) {
        node.isHighlighted = false;
        node._rev++;
      }
    }
  }

  /** Range-highlight between two paths. */
  private _rangeSelect(fromPath: string, toPath: string): void {
    const nodes = this._rangeSelectionMode === 'visual'
      ? (this.tree?.visibleFlatNodes ?? [])
      : (this.tree?.tree ?? []);

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

    this._clearHighlightFlags();
    this._highlightedPaths.clear();

    for (let i = start; i <= end; i++) {
      const node = nodes[i];
      if (!node.isSelectable) continue;
      this._highlightedPaths.add(node.path);
      node.isHighlighted = true;
      node._rev++;
    }

    this._focusedNode = this.tree?.getNodeByPath(toPath) ?? null;
  }

  /** Internal: do the click-driven highlight work. Called by both the
   *  click handler (with `modifiers` from the event) and the public
   *  `highlightNode(path, mode, options)` (which builds modifiers from
   *  the mode string). */
  private _applyHighlight(
    path: string,
    modifiers?: SelectionModifiers,
    options?: { silent?: boolean }
  ): void {
    const node = this.tree?.getNodeByPath(path);
    if (!node) return;

    const ctrl = modifiers?.ctrl ?? false;
    const shift = modifiers?.shift ?? false;
    // Single-mode degrades Ctrl/Shift+click to plain click (matches rc09).
    const isMulti = this._selectionMode === 'multi';
    const useCtrl = ctrl && isMulti;
    const useShift = shift && isMulti;

    if (useShift && this._lastHighlightedPath) {
      this._rangeSelect(this._lastHighlightedPath, path);
    } else if (useCtrl) {
      if (!node.isSelectable) return;
      if (this._highlightedPaths.has(path)) {
        this._highlightedPaths.delete(path);
        node.isHighlighted = false;
        node._rev++;
      } else {
        this._highlightedPaths.add(path);
        node.isHighlighted = true;
        node._rev++;
      }
      this._lastHighlightedPath = path;
      this._focusedNode = node;
    } else {
      // Replace
      this._clearHighlightFlags();
      this._highlightedPaths.clear();
      if (node.isSelectable) {
        this._highlightedPaths.add(path);
        node.isHighlighted = true;
        node._rev++;
        this._lastHighlightedPath = path;
      } else {
        this._lastHighlightedPath = null;
      }
      this._focusedNode = node;
    }

    if (!options?.silent) {
      this._emitHighlightChange();
      this._mirrorHighlightToSelected();
    }
    this.tree.refresh();
    this._scheduleNotify();
  }

  /** Emit the `highlightChangeCallback` callback. */
  private _emitHighlightChange(): void {
    this.highlightChangeCb?.({ paths: new Set(this._highlightedPaths), nodes: this.getHighlightedNodes() });
  }

  /** Emit the `selectionChangeCallback` callback (checkbox state). */
  private _emitSelectionChange(): void {
    if (!this.selectionChangeCb) return;
    const paths = this._projectSelection(this._selectedPaths);
    const nodes: LTreeNode<T>[] = [];
    for (const p of paths) {
      const n = this.tree?.getNodeByPath(p);
      if (n) nodes.push(n);
    }
    this.selectionChangeCb({ paths, nodes });
  }

  /**
   * Project the canonical checked set through the active `cascadeSelectPolicy` to
   * produce the EMITTED selection. Pure — reads visualState/isSelected off the live
   * tree, never mutates. Independent mode OR 'all' → the canonical set as-is;
   * 'leaves' → only checked leaf nodes; 'rolled-up' → a fully-checked selectable
   * branch collapses to its root (stop descending), indeterminate branches descend
   * to emit their checked bits. (svelte-treeview rc14)
   */
  private _projectSelection(canonical: Set<string>): Set<string> {
    if (this._checkboxMode !== 'cascade' || this._cascadeSelectPolicy === 'all' || !this.tree) {
      return new Set(canonical);
    }
    const policy = this._cascadeSelectPolicy;
    const out = new Set<string>();
    const walk = (node: LTreeNode<T>) => {
      const vs = this._computeVisualState(node);
      if (vs === VisualState.notSelected) return;
      const children = Object.values(node.children);
      const selectable = node.isSelectable !== false;
      if (policy === 'leaves') {
        if (children.length === 0 && node.isSelected && selectable) out.add(node.path);
        for (const child of children) walk(child);
        return;
      }
      // rolled-up: a fully-checked selectable node covers its whole subtree.
      if (vs === VisualState.selected && selectable) {
        out.add(node.path);
        return;
      }
      for (const child of children) walk(child);
    };
    for (const root of this.tree.tree) walk(root);
    return out;
  }

  /** When `shouldShowCheckboxes` is false, the highlight set IS the selection set —
   *  mirror it onto `_selectedPaths` so consumers reading the bindable
   *  checkbox state see what the user picked via the mouse. With checkboxes
   *  visible the two sets stay independent. Mirrors svelte-treeview rc09. */
  private _mirrorHighlightToSelected(): void {
    if (this._shouldShowCheckboxes) return;
    this._selectedPaths = new Set(this._highlightedPaths);
    this._emitSelectionChange();
  }

  // ── Selection API (checkbox / data state) ────────────────────────────

  /** Get all selected (checked) nodes. */
  getSelectedNodes(): LTreeNode<T>[] {
    const nodes: LTreeNode<T>[] = [];
    for (const path of this._selectedPaths) {
      const node = this.tree?.getNodeByPath(path);
      if (node) nodes.push(node);
    }
    return nodes;
  }

  /** The EMITTED (policy-projected) checkbox set — the minimal cover in cascade
   *  'rolled-up' mode, the leaves in 'leaves', or the full canonical set in 'all' /
   *  independent mode. Use the `selectedPaths` getter for the raw canonical set. */
  getSelectedPaths(): Set<string> {
    return this._projectSelection(this._selectedPaths);
  }

  /** Check if a node is in the selected (checked) set. */
  isNodeSelected(path: string): boolean {
    return this._selectedPaths.has(path);
  }

  /** Apply a checked/unchecked state to the given paths, expanding to
   *  descendants in cascade mode and recomputing ancestor visual states.
   *  Returns whether the selected set actually changed. Does not notify. */
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
    const newPaths = new Set(this._selectedPaths);
    let changed = false;
    for (const path of affected) {
      const n = this.tree?.getNodeByPath(path);
      if (!n) continue;
      if (checked) {
        if (!newPaths.has(path)) { newPaths.add(path); changed = true; }
        n.isSelected = true;
      } else {
        if (newPaths.has(path)) { newPaths.delete(path); changed = true; }
        n.isSelected = false;
      }
      n._rev++;
    }
    this._selectedPaths = newPaths;
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
        if (n) n.visualState = n.isSelected ? VisualState.selected : VisualState.notSelected;
      }
    }
    return changed;
  }

  /** Clear `isSelected` + reset visualState on every node in the checkbox set. */
  private _clearSelectionFlags(): void {
    for (const path of this._selectedPaths) {
      const node = this.tree?.getNodeByPath(path);
      if (node) {
        node.isSelected = false;
        node.visualState = VisualState.notSelected;
        node._rev++;
      }
    }
  }

  /** Check a single node (cascades to descendants in cascade mode).
   *  Pass `{ silent: true }` to skip `selectionChangeCallback`. */
  selectNode(path: string, options?: TreeMutationOptions): void {
    const changed = this._applyCheckboxState([path], true);
    if (changed && !options?.silent) this._emitSelectionChange();
    this.tree.refresh();
    this._scheduleNotify();
  }

  /** Check multiple nodes (additive — existing checks are kept).
   *  Use setSelectedPaths() to replace the whole set instead.
   *  Pass `{ silent: true }` to skip `selectionChangeCallback`. */
  selectNodes(paths: string[], options?: TreeMutationOptions): void {
    const changed = this._applyCheckboxState(paths, true);
    if (changed && !options?.silent) this._emitSelectionChange();
    this.tree.refresh();
    this._scheduleNotify();
  }

  /** Replace the entire checkbox set with the given paths.
   *  Equivalent to clearSelection() + selectNodes(paths).
   *  Pass `{ silent: true }` to skip `selectionChangeCallback`. */
  setSelectedPaths(paths: string[], options?: TreeMutationOptions): void {
    this._clearSelectionFlags();
    this._selectedPaths = new Set();
    this._applyCheckboxState(paths, true);
    if (!options?.silent) this._emitSelectionChange();
    this.tree.refresh();
    this._scheduleNotify();
  }

  /** Check every selectable node. Pass `{ silent: true }` to skip
   *  `selectionChangeCallback`. */
  selectAll(options?: TreeMutationOptions): void {
    const newPaths = new Set<string>();
    const traverse = (node: LTreeNode<T>) => {
      if (node.path && node.isSelectable) {
        node.isSelected = true;
        if (node.visualState !== VisualState.selected) node.visualState = VisualState.selected;
        node._rev++;
        newPaths.add(node.path);
      }
      for (const child of Object.values(node.children)) traverse(child);
    };
    for (const root of this.tree?.tree ?? []) traverse(root);
    this._selectedPaths = newPaths;
    if (!options?.silent) this._emitSelectionChange();
    this.tree.refresh();
    this._scheduleNotify();
  }

  /** Uncheck a single node (cascades to descendants in cascade mode).
   *  Pass `{ silent: true }` to skip `selectionChangeCallback`. */
  deselectNode(path: string, options?: TreeMutationOptions): void {
    const changed = this._applyCheckboxState([path], false);
    if (changed && !options?.silent) this._emitSelectionChange();
    this.tree.refresh();
    this._scheduleNotify();
  }

  /** Clear checkbox selection. Pass `paths` to uncheck only those nodes, or omit
   *  to clear all. Pass `{ silent: true }` to skip `selectionChangeCallback`. */
  clearSelection(paths?: string[], options?: TreeMutationOptions): void {
    if (paths && paths.length > 0) {
      const changed = this._applyCheckboxState(paths, false);
      if (changed && !options?.silent) this._emitSelectionChange();
      this.tree.refresh();
      this._scheduleNotify();
      return;
    }
    this._clearSelectionFlags();
    this._selectedPaths = new Set();
    if (!options?.silent) this._emitSelectionChange();
    this.tree.refresh();
    this._scheduleNotify();
  }

  // ── Focus (single cursor) ────────────────────────────────────────────

  /** Move focus to a node. `_options` is accepted for signature parity;
   *  focus changes have no dedicated change callback. */
  focusNode(path: string, _options?: TreeMutationOptions): void {
    const node = this.tree?.getNodeByPath(path);
    if (!node) return;
    this._focusedNode = node;
    this.tree.refresh();
    this._scheduleNotify();
  }

  /** Clear the focused node. */
  clearFocus(_options?: TreeMutationOptions): void {
    this._focusedNode = null;
    this.tree.refresh();
    this._scheduleNotify();
  }

  // ── Checkbox toggle (called by the renderer) ─────────────────────────

  /** Handle checkbox toggle. Honors checkboxMode (cascade/independent),
   *  multi-highlight bulk toggle, beforeCheckboxToggleCallback interceptor.
   *  Mirrors svelte-treeview rc06+ flow. */
  private _onCheckboxToggle(
    node: LTreeNode<T>,
    options?: { skipFocus?: boolean }
  ): void {
    // In cascade mode, indeterminate → check all (not fully selected yet).
    const newChecked =
      this._checkboxMode === 'cascade' && node.visualState === VisualState.indeterminate
        ? true
        : !node.isSelected;

    // Bulk via highlight: if the clicked node is in a multi-highlight,
    // apply to every highlighted node.
    const isMultiHighlighted =
      this._highlightedPaths.size > 1 && this._highlightedPaths.has(node.path);

    let affectedPaths: string[] = isMultiHighlighted
      ? [...this._highlightedPaths]
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

    const newPaths = new Set(this._selectedPaths);
    for (const path of affectedPaths) {
      const n = this.tree?.getNodeByPath(path);
      if (!n) continue;
      if (newChecked) {
        newPaths.add(path);
        n.isSelected = true;
      } else {
        newPaths.delete(path);
        n.isSelected = false;
      }
      n._rev++;
    }
    this._selectedPaths = newPaths;

    if (!options?.skipFocus) this._focusedNode = node;

    // Update visual states (cascade only — independent mode never auto-checks
    // a parent based on descendants).
    if (this._checkboxMode === 'cascade') {
      const rootPaths = isMultiHighlighted ? [...this._highlightedPaths] : [node.path];
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

    this.nodeClickedCb?.(this.nodeRef(node));
    this._emitSelectionChange();
    this.tree.refresh();
    this._scheduleNotify();
  }

  /** Re-derive every node's visualState + isSelected when checkboxMode changes
   *  at runtime. Switching to 'independent' PROMOTES an indeterminate [-] node to
   *  fully checked; switching to 'cascade' recomputes parent dashes from their
   *  descendants. Without this the indeterminate marker (an imperative DOM prop)
   *  sticks after a mode flip. (svelte-treeview parity — guarded by the ported
   *  e2e/checkbox-mode.spec.ts.) No-op before the tree is built. */
  private _reconcileVisualStatesForMode(): void {
    if (!this.tree?.root) return;
    const cascade = this._checkboxMode === 'cascade';
    const newPaths = new Set<string>(this._selectedPaths);
    let anyChanged = false;
    let selectionChanged = false;
    const visit = (node: LTreeNode<T>) => {
      let vs: VisualState;
      let selectionTouched = false;
      if (cascade) {
        vs = this._computeVisualState(node);
        // Sync isSelected with a definitive computed state (leave indeterminate as-is).
        if (vs !== VisualState.indeterminate) {
          const shouldBeSelected = vs === VisualState.selected;
          if (node.isSelected !== shouldBeSelected) {
            node.isSelected = shouldBeSelected;
            if (shouldBeSelected) newPaths.add(node.path);
            else newPaths.delete(node.path);
            selectionTouched = true;
          }
        }
      } else if (node.visualState === VisualState.indeterminate) {
        // Independent mode has no partial state: promote [-] to fully checked.
        if (!node.isSelected) {
          node.isSelected = true;
          selectionTouched = true;
        }
        newPaths.add(node.path);
        vs = VisualState.selected;
      } else {
        vs = node.isSelected ? VisualState.selected : VisualState.notSelected;
      }
      if (node.visualState !== vs || selectionTouched) {
        node.visualState = vs;
        node._rev = (node._rev || 0) + 1;
        anyChanged = true;
        if (selectionTouched) selectionChanged = true;
      }
      for (const key in node.children) visit(node.children[key]!);
    };
    for (const key in this.tree.root.children) visit(this.tree.root.children[key]!);
    if (selectionChanged) this._selectedPaths = newPaths;
    if (anyChanged) {
      this.tree.refresh();
      if (selectionChanged) this._emitSelectionChange();
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
   *  descendant selection. Syncs `isSelected` on the ancestors (all
   *  descendants selected → ancestor selected). */
  private _updateAncestorVisualStates(startPath: string): void {
    const newPaths = new Set(this._selectedPaths);
    let path: string | null | undefined = this.tree?.getNodeByPath(startPath)?.parentPath;
    while (path) {
      const ancestor = this.tree?.getNodeByPath(path);
      if (!ancestor) break;
      const vs = this._computeVisualState(ancestor);

      const shouldBeSelected = vs === VisualState.selected;
      if (ancestor.isSelected !== shouldBeSelected) {
        ancestor.isSelected = shouldBeSelected;
        if (shouldBeSelected) newPaths.add(path);
        else newPaths.delete(path);
      }
      if (ancestor.visualState !== vs) ancestor.visualState = vs;
      ancestor._rev++;
      path = ancestor.parentPath;
    }
    this._selectedPaths = newPaths;
  }

  /** Compute the visualState (selected / notSelected / indeterminate) for a
   *  node based on its descendants' `isSelected`. Leaves use the node's own
   *  `isSelected`. */
  private _computeVisualState(node: LTreeNode<T>): VisualState {
    const children = Object.values(node.children);
    if (children.length === 0) {
      return node.isSelected ? VisualState.selected : VisualState.notSelected;
    }
    let allSelected = true;
    let noneSelected = true;
    const check = (n: LTreeNode<T>) => {
      if (!allSelected && !noneSelected) return;
      if (n.isSelected) noneSelected = false;
      else allSelected = false;
      for (const child of Object.values(n.children)) {
        if (!allSelected && !noneSelected) return;
        check(child);
      }
    };
    for (const child of children) {
      check(child);
      if (!allSelected && !noneSelected) break;
    }
    if (allSelected) return VisualState.selected;
    if (noneSelected) return VisualState.notSelected;
    return VisualState.indeterminate;
  }

  // ── Navigation API ────────────────────────────────────────────────

  /** Navigate to a specific path (highlights and focuses it). */
  navTo(path: string): void {
    this.highlightNode(path);
  }

  /** Navigate to the next visible node. */
  navNext(): void {
    const visible = this.tree?.visibleFlatNodes ?? [];
    if (visible.length === 0) return;
    const currentPath = this._focusedNode?.path;
    if (!currentPath) {
      this.highlightNode(visible[0].path);
      return;
    }
    const idx = visible.findIndex(n => n.path === currentPath);
    if (idx >= 0 && idx < visible.length - 1) {
      this.highlightNode(visible[idx + 1].path);
    }
  }

  /** Navigate to the previous visible node. */
  navPrev(): void {
    const visible = this.tree?.visibleFlatNodes ?? [];
    if (visible.length === 0) return;
    const currentPath = this._focusedNode?.path;
    if (!currentPath) {
      this.highlightNode(visible[visible.length - 1].path);
      return;
    }
    const idx = visible.findIndex(n => n.path === currentPath);
    if (idx > 0) {
      this.highlightNode(visible[idx - 1].path);
    }
  }

  /** Navigate into first child (expand if collapsed, then move to child). */
  navInto(): void {
    const node = this._focusedNode;
    if (!node || !node.hasChildren) return;

    if (!node.isExpanded) {
      this.tree?.expandNodes(node.path);
    }
    // visibleFlatNodes updated synchronously — move to first child
    const visible = this.tree?.visibleFlatNodes ?? [];
    const idx = visible.findIndex(n => n.path === node.path);
    if (idx >= 0 && idx + 1 < visible.length) {
      this.highlightNode(visible[idx + 1].path);
    }
  }

  /** Navigate to parent node (no collapse — matches svelte-treeview). */
  navOut(): void {
    const node = this._focusedNode;
    if (!node) return;
    const sep = this._treePathSeparator;
    const lastSep = node.path.lastIndexOf(sep);
    if (lastSep > 0) {
      const parentPath = node.path.substring(0, lastSep);
      this.highlightNode(parentPath);
    }
  }

  /** Navigate to parent and collapse it. */
  navBackOut(): void {
    const node = this._focusedNode;
    if (!node) return;
    const sep = this._treePathSeparator;
    const lastSep = node.path.lastIndexOf(sep);
    if (lastSep > 0) {
      const parentPath = node.path.substring(0, lastSep);
      this.tree?.collapseNodes(parentPath);
      this.highlightNode(parentPath);
    }
  }

  /** Toggle expand/collapse on current node. */
  navToggle(): void {
    const node = this._focusedNode;
    if (!node || !node.hasChildren) return;
    if (node.isExpanded) {
      this.tree?.collapseNodes(node.path);
    } else {
      this.tree?.expandNodes(node.path);
    }
    this._scheduleNotify();
  }

  /** Navigate to first visible node. */
  navFirst(): void {
    const visible = this.tree?.visibleFlatNodes ?? [];
    if (visible.length > 0) {
      this.highlightNode(visible[0].path);
    }
  }

  /** Navigate to last visible node. */
  navLast(): void {
    const visible = this.tree?.visibleFlatNodes ?? [];
    if (visible.length > 0) {
      this.highlightNode(visible[visible.length - 1].path);
    }
  }

  /** Navigate to next visible node at the same level. */
  navNextSibling(): void {
    const visible = this.tree?.visibleFlatNodes ?? [];
    if (visible.length === 0) return;
    const currentPath = this._focusedNode?.path;
    const currentIndex = currentPath ? visible.findIndex(n => n.path === currentPath) : -1;
    if (currentIndex === -1) {
      this.highlightNode(visible[0].path);
      return;
    }
    const currentLevel = visible[currentIndex].level;
    for (let i = currentIndex + 1; i < visible.length; i++) {
      if (visible[i].level === currentLevel) {
        this.highlightNode(visible[i].path);
        return;
      }
    }
  }

  /** Navigate to previous visible node at the same level. */
  navPrevSibling(): void {
    const visible = this.tree?.visibleFlatNodes ?? [];
    if (visible.length === 0) return;
    const currentPath = this._focusedNode?.path;
    const currentIndex = currentPath ? visible.findIndex(n => n.path === currentPath) : -1;
    if (currentIndex === -1) {
      this.highlightNode(visible[visible.length - 1].path);
      return;
    }
    const currentLevel = visible[currentIndex].level;
    for (let i = currentIndex - 1; i >= 0; i--) {
      if (visible[i].level === currentLevel) {
        this.highlightNode(visible[i].path);
        return;
      }
    }
  }

  // ── Clipboard API ─────────────────────────────────────────────────

  /** Copy selected nodes (or specified paths) to clipboard. */
  copyNodes(paths?: string[]): void {
    let pathsToUse = paths ?? [...this._highlightedPaths];
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
    let pathsToUse = paths ?? [...this._highlightedPaths];
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
        const blocked: PasteResult<T> = { success: false, count: 0, skipped: 0, error: 'Paste blocked by beforePasteCallback' };
        this.onPasteCb?.(blocked);
        return blocked;
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
        index: idx,
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

  /** Paths a keyboard shortcut should act on: the highlight set if any, else the
   *  focused node, else empty. Shared by the built-in copy/cut/delete handling. */
  private _shortcutSelectionPaths(): string[] {
    if (this._highlightedPaths.size > 0) return [...this._highlightedPaths];
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
   * Remove nodes (and their descendants) from the tree. Defaults to the current
   * selection (highlight set, else focused node). Runs `beforeDeleteCallback` first
   * (narrow or block), removes only top-level subtrees, clears highlight + focus of
   * anything removed, and fires `onDelete` with PRE-REMOVAL node snapshots.
   */
  deleteNodes(paths?: string[]): { removed: number; blocked: number } {
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
      this.clearHighlight();
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
      this.deleteNodes();
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
        highlightedNodes: this.getHighlightedNodes(),
        controller: this
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
        index: rootIndex,
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
    this._isDebugMenuActive = false;
    this._updateContextMenuListeners();
    this._scheduleNotify();
  }

  closeContextMenu() {
    this._contextMenuVisible = false;
    this._contextMenuNode = null;
    this._isDebugMenuActive = false;
    this._updateContextMenuListeners();
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
    // rejects drops on desktop too (svelte-treeview parity).
    if (!node.isDropAllowed) {
      this._hoveredNodeForDrop = null;
      return;
    }

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
      this._scheduleNotify();
    }
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
      // rejects the drop even when the mode allows it.
      if (dropAllowed && node.isDropAllowed && (isCrossTreeDrag || this._draggedNode.path !== node.path)) {
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
      console.warn(`[Tree ${this._treeId}] Node not found for path: ${path}`);
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
      const el = rootEl
        ? rootEl.querySelector(`#${CSS.escape(elementId)}`)
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
      console.warn(`[Tree ${this._treeId}] DOM element not found for node ID: ${elementId}`);
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
      if (this.currentHighlight) {
        this.currentHighlight.element.classList.remove(this._scrollHighlightClass);
        clearTimeout(this.currentHighlight.timeoutId);
        this.currentHighlight = null;
      }

      contentDiv.classList.add(this._scrollHighlightClass);
      const highlightClass = this._scrollHighlightClass;
      const timeoutId = setTimeout(() => {
        contentDiv.classList.remove(highlightClass);
        this.currentHighlight = null;
      }, this._scrollHighlightTimeout);

      this.currentHighlight = { element: contentDiv, timeoutId };
    }

    perfEnd(`[${this._treeId}] scrollToPath`);
    return true;
  }

  // ── updateProps (batch property updates) ────────────────────────────

  updateProps(updates: Partial<TreeControllerConfig<T>>) {
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
      changed(updates.isSelectedMember, t.isSelectedMember) ||
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
      changed(updates.getIsSelectedCallback, t.getIsSelectedCallback) ||
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
    if (updates.highlightedPaths !== undefined)
      this._highlightedPaths = new Set(updates.highlightedPaths);
    if (updates.selectedPaths !== undefined)
      this._selectedPaths = new Set(updates.selectedPaths);
    if (updates.selectionMode !== undefined)
      this._selectionMode = updates.selectionMode ?? 'single';
    if (updates.shouldShowCheckboxes !== undefined) {
      this._shouldShowCheckboxes = updates.shouldShowCheckboxes ?? false;
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
    if (updates.cascadeSelectPolicy !== undefined) {
      const nextPolicy = updates.cascadeSelectPolicy ?? 'rolled-up';
      if (nextPolicy !== this._cascadeSelectPolicy) {
        this._cascadeSelectPolicy = nextPolicy;
        this._emitSelectionChange(); // re-project the unchanged canonical set
      }
    }
    if (updates.shouldClickToggleCheckbox !== undefined)
      this._shouldClickToggleCheckbox = updates.shouldClickToggleCheckbox ?? false;
    if (updates.beforeCheckboxToggleCallback !== undefined)
      this.beforeCheckboxToggleCb = updates.beforeCheckboxToggleCallback;
    if (updates.searchText !== undefined) this.searchText = updates.searchText;
    if (updates.shouldDisplayDebugInformation !== undefined)
      this._shouldDisplayDebugInformation = updates.shouldDisplayDebugInformation ?? false;
    if (updates.shouldDisplayContextMenuInDebugMode !== undefined) {
      this._shouldDisplayContextMenuInDebugMode = updates.shouldDisplayContextMenuInDebugMode ?? false;
    }
    if (updates.isLoading !== undefined) this._isLoading = updates.isLoading ?? false;
    if (updates.bodyClass !== undefined) this._bodyClass = updates.bodyClass;

    if (updates.clickBehavior !== undefined)
      this._clickBehavior = updates.clickBehavior ?? 'expand-and-focus';
    if (updates.isAccordionExpand !== undefined)
      this._isAccordionExpand = updates.isAccordionExpand ?? false;
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
    if (updates.highlightedNodeClass !== undefined)
      this._highlightedNodeClass = updates.highlightedNodeClass;
    if (updates.focusedNodeClass !== undefined)
      this._focusedNodeClass = updates.focusedNodeClass;
    if (updates.dragOverNodeClass !== undefined)
      this._dragOverNodeClass = updates.dragOverNodeClass;
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
    if (updates.shouldEnableTreeDropZone !== undefined)
      this._shouldEnableTreeDropZone = updates.shouldEnableTreeDropZone ?? false;
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
    if (updates.shouldAlignNodeIcons !== undefined) this._shouldAlignNodeIcons = updates.shouldAlignNodeIcons ?? true;

    // Virtual scroll
    if (updates.isVirtualScrollEnabled !== undefined) this._isVirtualScrollEnabled = updates.isVirtualScrollEnabled ?? false;
    if (updates.virtualRowHeight !== undefined) this._virtualRowHeight = updates.virtualRowHeight;
    if (updates.virtualOverscan !== undefined) this._virtualOverscan = updates.virtualOverscan ?? 5;
    if (updates.virtualContainerHeight !== undefined) this._virtualContainerHeight = updates.virtualContainerHeight;

    // Multi-select
    if (updates.rangeSelectionMode !== undefined) this._rangeSelectionMode = updates.rangeSelectionMode ?? 'visual';
    if (updates.onSelectionChange !== undefined) this.selectionChangeCb = updates.onSelectionChange;
    if (updates.onHighlightChange !== undefined) this.highlightChangeCb = updates.onHighlightChange;

    // Callbacks
    if (updates.onNodeClick !== undefined) this.nodeClickedCb = updates.onNodeClick;
    if (updates.onNodeDoubleClick !== undefined) this.onNodeDoubleClickCb = updates.onNodeDoubleClick;
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
        updates.isSelectedMember ?? this.tree.isSelectedMember,
        updates.getIsSelectedCallback ?? this.tree.getIsSelectedCallback,
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
          shouldDisplayDebugInformation: this._shouldDisplayDebugInformation,
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
        this._seedSelectedPathsFromTree();
        this._reapplyRuntimeSelection();
        if (!expandLevelChanged) this._reapplyExpanded(preservedExpanded);
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
    } else if (updates.data !== undefined) {
      this.data = updates.data;
    }

    this._updateNodeConfig();
    this._updateDebugContextMenu();
    this._scheduleNotify();
  }

  /** Get a snapshot of the current state for the renderer. */
  getSnapshot(): TreeControllerSnapshot<T> {
    return {
      flatNodesToRender: this.flatNodesToRender,
      draggedNodePath: this._draggedNode?.path ?? null,
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
      shouldDisplayDebugInformation: this._shouldDisplayDebugInformation,
      focusedNode: this._focusedNode,
      highlightedPaths: this._highlightedPaths,
      selectedPaths: this._selectedPaths,
      cutPaths: this._cutPaths,

      // Virtual scroll
      isVirtualScrollEnabled: this._isVirtualScrollEnabled,
      virtualRowHeight: this.resolvedRowHeight,
      virtualContainerHeight: this.resolvedContainerHeight,
      virtualTotalHeight: this._isVirtualScrollEnabled ? this.allVisibleFlatNodes.length * this.resolvedRowHeight : 0,
      virtualStartIndex: this._isVirtualScrollEnabled
        ? Math.max(0, Math.floor(this._vsScrollTop / this.resolvedRowHeight) - this._virtualOverscan)
        : 0,
      virtualOffsetY: this._isVirtualScrollEnabled
        ? Math.max(0, Math.floor(this._vsScrollTop / this.resolvedRowHeight) - this._virtualOverscan) * this.resolvedRowHeight
        : 0,
    };
  }

  /** Clean up document-level listeners and ghost elements. */
  destroy() {
    if (typeof document !== 'undefined') {
      this._removeDocumentTouchListeners();
      this.removeGhostElement();
      this._clearDragDenied();
      if (this._dropDeniedTimer) { clearTimeout(this._dropDeniedTimer); this._dropDeniedTimer = null; }
      document.querySelectorAll('.wtv__touch-ghost').forEach(el => el.remove());
    }
    this._contextMenuCleanup?.();
    this._contextMenuCleanup = null;
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
      this._seedSelectedPathsFromTree();
      this._reapplyRuntimeSelection();
      this._reapplyExpanded(preservedExpanded);
    }
  }

  // ── Internal: tree changed (from LTree.onChange) ────────────────────

  private _onTreeChanged() {
    this._updateProgressiveRendering();
    this._scheduleNotify();
  }

  /** Pre-populate `_highlightedPaths` from any nodes whose `isSelected` was set
   *  at insert time (via `isSelectedMember` or `getIsSelectedCallback`). Runs
   *  after every `insertArray` so consumers reading `getSelectedPaths()`
   *  immediately reflect server-side initial selection.
   *  Mirrors svelte-treeview rc07's post-insert seeding walk. */
  /** Re-apply the controller-owned runtime selection onto freshly (re)inserted
   *  nodes. `_selectedPaths` is the source of truth and survives a data re-insert;
   *  the per-node `isSelected` flag does NOT (fresh nodes default to false), and
   *  the cascade `visualState` is derived. So after every insertArray we push
   *  `_selectedPaths` back onto `node.isSelected` and recompute `visualState` from
   *  it — otherwise a config-triggered re-insert silently drops the checkbox
   *  selection + indeterminate dashes. (web-grid-style: primary state lives off
   *  the nodes; derived state is recomputed.) The renderer reads `checked` straight
   *  from `snapshot.selectedPaths`, so it's already rebuild-proof; this keeps the
   *  cascade computation + the indeterminate marker correct too. */
  private _reapplyRuntimeSelection(): void {
    if (!this.tree?.root) return;
    const cascade = this._checkboxMode === 'cascade';
    // Pass 1: primary state — isSelected from the surviving set.
    const applySelected = (node: LTreeNode<T>) => {
      node.isSelected = this._selectedPaths.has(node.path);
      for (const child of Object.values(node.children)) applySelected(child);
    };
    for (const child of Object.values(this.tree.root.children)) applySelected(child);
    // Pass 2: derived visualState — needs pass 1's isSelected on all descendants.
    const applyVisual = (node: LTreeNode<T>) => {
      node.visualState = cascade
        ? this._computeVisualState(node)
        : (node.isSelected ? VisualState.selected : VisualState.notSelected);
      for (const child of Object.values(node.children)) applyVisual(child);
    };
    for (const child of Object.values(this.tree.root.children)) applyVisual(child);
  }

  /** Snapshot which nodes are currently expanded — call BEFORE a data re-insert
   *  (which resets isExpanded to the expandLevel default) so the user's manual
   *  expand/collapse survives. Paths are stable across a re-insert. */
  private _collectExpandedPaths(): Set<string> {
    const out = new Set<string>();
    if (!this.tree?.root) return out;
    const visit = (node: LTreeNode<T>) => {
      if (node.isExpanded) out.add(node.path);
      for (const child of Object.values(node.children)) visit(child);
    };
    for (const child of Object.values(this.tree.root.children)) visit(child);
    return out;
  }

  /** Re-apply a captured expansion set onto freshly (re)inserted nodes. Paths not
   *  present in the new data are simply ignored. Unlike selection/highlight (whose
   *  source of truth is a controller-owned set the renderer reads), expansion is
   *  consumed by the LTree's own flattening, so it stays on the node — we just make
   *  the re-insert lossless by restoring it. */
  private _reapplyExpanded(expanded: Set<string>): void {
    if (!this.tree?.root || expanded.size === 0) return;
    const visit = (node: LTreeNode<T>) => {
      if (node.hasChildren) node.isExpanded = expanded.has(node.path);
      for (const child of Object.values(node.children)) visit(child);
    };
    for (const child of Object.values(this.tree.root.children)) visit(child);
  }

  private _seedSelectedPathsFromTree(): void {
    if (!this.tree) return;
    if (!this.tree.isSelectedMember && !this.tree.getIsSelectedCallback) return;
    // Walk every node — collapsed branches still need their selected flag
    // reflected in selectedPaths so the checkbox state is correct when the
    // user later expands them.
    const visit = (node: LTreeNode<T>) => {
      if (node.isSelected) this._selectedPaths.add(node.path);
      for (const child of Object.values(node.children)) visit(child);
    };
    const root = this.tree.root;
    if (root?.children) {
      for (const child of Object.values(root.children)) visit(child);
    }
  }

  // ── Internal: progressive flat rendering ────────────────────────────

  private _updateProgressiveRendering() {
    if (!this._isFlatRenderingEnabled || !this._isProgressiveRender || !this.tree?.visibleFlatNodes)
      return;
    // Virtual scroll already limits rendered nodes to the visible window —
    // skip progressive rendering to avoid background batches firing _scheduleNotify
    if (this._isVirtualScrollEnabled) return;

    const tracker = this.tree.changeTracker;
    if (tracker === this.lastFlatNodesTracker) return;
    this.lastFlatNodesTracker = tracker;

    const allNodes = this.tree.visibleFlatNodes;
    const currentIds = new Set(allNodes.map((n) => String(n.id)));

    const renderedSnapshot = new Set(this.flatRenderedIds);
    const queueSnapshot = new Set(this.flatRenderQueue);

    const newIds: string[] = [];
    for (const node of allNodes) {
      const id = String(node.id);
      if (!renderedSnapshot.has(id) && !queueSnapshot.has(id)) {
        newIds.push(id);
      }
    }

    const removedIds: string[] = [];
    for (const id of renderedSnapshot) {
      if (!currentIds.has(id)) {
        removedIds.push(id);
      }
    }

    if (removedIds.length > 0) {
      const newRendered = new Set(renderedSnapshot);
      for (const id of removedIds) {
        newRendered.delete(id);
      }
      this.flatRenderedIds = newRendered;
    }

    if (newIds.length > 0) {
      const alreadyHasManyNodes = renderedSnapshot.size > 1000;
      const addingFewNodes = newIds.length < 200;

      if (alreadyHasManyNodes && addingFewNodes) {
        this.flatRenderedIds = new Set([...this.flatRenderedIds, ...newIds]);
      } else {
        this.currentBatchSize = this._initialBatchSize;
        const immediateBatch = newIds.slice(0, this.currentBatchSize);
        const remaining = newIds.slice(this.currentBatchSize);

        if (immediateBatch.length > 0) {
          this.flatRenderedIds = new Set([...this.flatRenderedIds, ...immediateBatch]);
        }

        this.currentBatchSize = Math.min(this.currentBatchSize * 2, this._maxBatchSize);

        if (remaining.length > 0) {
          this.flatRenderQueue = [...remaining];
          this.scheduleFlatRenderBatch();
        }
      }
    }
  }

  scheduleFlatRenderBatch() {
    if (this.flatRenderAnimationFrame) return;

    this.flatRenderAnimationFrame = requestAnimationFrame(() => {
      this.flatRenderAnimationFrame = null;
      if (this.flatRenderQueue.length === 0) return;

      const batchSize = this.currentBatchSize || this._initialBatchSize;
      const batch = this.flatRenderQueue.slice(0, batchSize);
      const remaining = this.flatRenderQueue.slice(batchSize);

      this.flatRenderedIds = new Set([...this.flatRenderedIds, ...batch]);
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
      highlightedNodeClass: this._highlightedNodeClass,
      focusedNodeClass: this._focusedNodeClass,
      dragOverNodeClass: this._dragOverNodeClass,
      dragDropMode: this._dragDropMode,
      dropZoneMode: this._dropZoneMode,
      dropZoneLayout: this._dropZoneLayout,
      dropZoneStart: this._dropZoneStart,
      dropZoneMaxWidth: this._dropZoneMaxWidth,
      isCopyAllowed: this._isCopyAllowed,
      iconMember: this._iconMember,
      shouldShowCheckboxes: this._shouldShowCheckboxes,
      nodeClass: this._nodeClass,
      nodeContentClass: this._nodeContentClass
    };
    this.emit('config-change', this._nodeConfig);
  }

  // ── Internal: context menu listeners ────────────────────────────────

  private _updateContextMenuListeners() {
    // Clean up previous
    this._contextMenuCleanup?.();
    this._contextMenuCleanup = null;

    if (!this._contextMenuVisible) return;

    const handleGlobalClick = (event: MouseEvent) => {
      if (this._isDebugMenuActive) return;
      // When the click originates inside a Shadow DOM, `event.target` is
      // retargeted to the shadow host by the time the document listener
      // fires, so `.closest('.wtv__context-menu')` won't find the menu even
      // if the actual click landed on it. Walk the composed path instead so
      // the check sees the real chain through the shadow boundary.
      const path = event.composedPath();
      const insideMenu = path.some(
        (n) => n instanceof Element && n.classList?.contains('wtv__context-menu')
      );
      if (!insideMenu) {
        this.closeContextMenu();
      }
    };

    const handleGlobalScroll = () => {
      if (this._isDebugMenuActive) return;
      this.closeContextMenu();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.closeContextMenu();
      }
    };

    // Defer to avoid catching the same event that opened the menu
    requestAnimationFrame(() => {
      document.addEventListener('click', handleGlobalClick);
      document.addEventListener('contextmenu', handleGlobalClick);
      document.addEventListener('keydown', handleKeyDown);
      window.addEventListener('scroll', handleGlobalScroll, true);
      document.addEventListener('scroll', handleGlobalScroll, true);
      window.addEventListener('wheel', handleGlobalScroll, { passive: true });
    });

    this._contextMenuCleanup = () => {
      document.removeEventListener('click', handleGlobalClick);
      document.removeEventListener('contextmenu', handleGlobalClick);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleGlobalScroll, true);
      document.removeEventListener('scroll', handleGlobalScroll, true);
      window.removeEventListener('wheel', handleGlobalScroll);
    };
  }

  // ── Internal: debug context menu ────────────────────────────────────

  private _updateDebugContextMenu() {
    if (
      this._shouldDisplayContextMenuInDebugMode &&
      (this._hasContextMenuRenderer || this.contextMenuCallbackCb) &&
      this.tree?.tree &&
      this.tree.tree.length > 0
    ) {
      const targetNode =
        this.tree.tree.length > 1 ? this.tree.tree[1] : this.tree.tree[0];
      if (targetNode && this.containerElement) {
        const treeRect = this.containerElement.getBoundingClientRect();
        this._contextMenuNode = targetNode;
        this._contextMenuX = treeRect.left + 200;
        this._contextMenuY = treeRect.top + 100;
        this._contextMenuVisible = true;
        this._isDebugMenuActive = true;
        this._updateContextMenuListeners();
        this._scheduleNotify();
      }
    } else if (!this._shouldDisplayContextMenuInDebugMode && this._isDebugMenuActive) {
      this._contextMenuVisible = false;
      this._contextMenuNode = null;
      this._isDebugMenuActive = false;
      this._updateContextMenuListeners();
      this._scheduleNotify();
    }
  }

  // ── Internal event handlers ─────────────────────────────────────────

  private _nodeClickedCallback(node: LTreeNode<T>, modifiers?: SelectionModifiers) {
    if (this._contextMenuVisible) {
      this.closeContextMenu();
    }

    this._applyHighlight(node.path, modifiers);

    uiLogger.debug(`Node clicked: ${node.path}`, {
      newPath: node.path,
      id: node.id,
      ctrl: modifiers?.ctrl,
      shift: modifiers?.shift,
      highlightedCount: this._highlightedPaths.size
    });

    this.nodeClickedCb?.(this.nodeRef(node));
  }

  /**
   * Manual double-click detection, called by the renderer for every genuine
   * plain (no Ctrl/Shift) UI click. The flat diff reconciler patches a row's
   * attributes on the first click (focus/highlight bumps `_rev`), so the
   * browser's native `dblclick` can't be trusted. Returns `true` when this
   * click completes a double within the 400ms window — the caller then
   * consumes the click (returns early) so the gesture reads as a single open
   * rather than a re-toggle. Fires `onNodeDoubleClick` for every clickBehavior;
   * `select` mode additionally toggles expand/collapse on the double (the other
   * modes already toggle on single click).
   */
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

    // OS-convention highlight sync: grabbing a node that isn't part of the
    // current highlight set replaces the highlight with just that node.
    // Mirrors Windows Explorer / macOS Finder — without it the prior
    // highlight stays visible while the drag silently carries only the
    // grabbed node, making it impossible to tell what's actually moving.
    // Skipped when the node is already in the set (multi-drag) or when
    // the node is unselectable.
    // Deferred to rAF rather than running synchronously: a sync mutation
    // of the source row before the browser commits the drag image causes
    // the renderer's keyed update to drop the dragged element and the
    // drag silently aborts. rAF runs after the drag is committed.
    if (node.isSelectable && !this._highlightedPaths.has(node.path)) {
      requestAnimationFrame(() => {
        // Esc-cancel can fire dragend before this rAF runs.
        if (!this._isDragInProgress) return;
        // Snapshot the prior highlight so _onNodeDragEnd can restore it if
        // the drag is Esc-cancelled. Without this, the user is left with
        // the dragged node selected even though they cancelled the operation.
        this._preDragHighlightSnapshot = new Set(this._highlightedPaths);
        this._clearHighlightFlags();
        node.isHighlighted = true;
        node._rev++;
        this._highlightedPaths = new Set([node.path]);
        this._lastHighlightedPath = node.path;
        this._focusedNode = node;
        this._emitHighlightChange();
        this._mirrorHighlightToSelected();
        this.tree.refresh();
        this._scheduleNotify();
      });
    }

    this._scheduleNotify();
  }

  /** Pick out the "top-level highlighted" subset of `highlightedPaths`:
   *  every path whose nearest highlighted ancestor is NOT in the set.
   *  Descendants whose ancestor is also highlighted are absorbed — they
   *  ride along inside the ancestor's subtree during multi-drag. */
  private _getTopLevelHighlightedPaths(): string[] {
    const paths = this._highlightedPaths;
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
    const dropEffect = event.dataTransfer?.dropEffect;
    dragLogger.debug('Drag ended', {
      dropEffect,
      operation: this._currentDropOperation
    });
    // Esc-cancel / drop-on-invalid-target: restore the pre-drag highlight so
    // the dragged node doesn't end up "stuck" selected. Mirrors svelte-treeview.
    if (dropEffect === 'none' && this._preDragHighlightSnapshot) {
      const prior = this._preDragHighlightSnapshot;
      this._clearHighlightFlags();
      this._highlightedPaths = new Set(prior);
      for (const path of prior) {
        const n = this.tree?.getNodeByPath(path);
        if (n) {
          n.isHighlighted = true;
          n._rev++;
        }
      }
      // When the snapshot was empty, focus also belonged to nobody — clear it.
      if (prior.size === 0) this._focusedNode = null;
      this._emitHighlightChange();
      this._mirrorHighlightToSelected();
      this.tree.refresh();
    }
    this._preDragHighlightSnapshot = null;
    this._resetDragState();
  };

  private _resetDragState(): void {
    dragLogger.debug('_resetDragState');
    this._isDragInProgress = false;
    this._draggedNode = null;
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
    // the highlight set (same-tree) or the source clears its published set
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

    // Multi-drag: when the dragged node is in a multi-highlight set (or a
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
        : this._highlightedPaths.has(draggedNodeRef.path) && this._highlightedPaths.size > 1);

    if (isMultiDrag) {
      const topLevelPaths = (this._dragSetOverride ?? this._getTopLevelHighlightedPaths())
        .filter((p) => p !== dropNode!.path)
        // Respect per-node draggability: a locked node merely in the highlight set
        // must NOT ride along. An explicit override skips this gate (the consumer
        // forced these in on purpose).
        .filter((p) => {
          if (this._dragSetOverride) return !!this.tree.getNodeByPath(p);
          const n = this.tree.getNodeByPath(p);
          return n ? this.getNodeIsDraggable(n) : false;
        });
      dragLogger.info(`Multi-drag: moving ${topLevelPaths.length} top-level subtree(s)`, {
        topLevelPaths,
        totalHighlighted: this._highlightedPaths.size,
        dropTarget: dropNode!.path,
        position
      });
      // A curated override IS the manifest as-is (its omissions are holes moveNodes
      // leaves behind); a plain highlight set has no holes, so complete it → whole
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
      // with holes, or the completed highlight/lead set = whole subtrees), then
      // duplicateNodes runs the INPUT transform per node — the consumer's
      // pasteNodeTransformationCallback, else a default id-uniquifier.
      const transform = this.inputTransformCb ?? this._defaultCopyTransform;
      const isMulti = this._dragSetOverride
        ? this._dragSetOverride.length > 1
        : this._highlightedPaths.has(draggedNodeRef.path) && this._highlightedPaths.size > 1;
      const manifest = this._dragSetOverride
        ? this._dragSetOverride
        : isMulti
          ? this._completeManifest(
              this._getTopLevelHighlightedPaths().filter((p) => p !== dropNode.path)
            )
          : this._completeManifest([draggedNodeRef.path]);
      const result = this.duplicateNodes(manifest, dropNode.path, position, transform);
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
          sourceTree
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

  // ── Tree-level drop zone (shouldEnableTreeDropZone) ─────────────────────
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
    const elementUnderTouch = document.elementFromPoint(touch.clientX, touch.clientY);
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

      const dropElement = document.elementFromPoint(touch.clientX, touch.clientY);
      const dropNode = this.findNodeFromElement(dropElement);

      const emptyTarget = dropElement?.closest('.wtv__empty-state, .wtv__empty-zone');
      const rootDropZone = dropElement?.closest('.wtv__root-drop-zone');
      if ((emptyTarget || rootDropZone) && !dropNode) {
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
    const el = document.querySelector(
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

    this.nodeDropDeniedCb?.(this.nodeRef(node));

    if (!this._shouldIndicateUndraggable) return;

    try { navigator.vibrate?.([30, 25, 30]); } catch { /* blocked by browser policy */ }

    if (typeof document === 'undefined') return;
    const el = document.querySelector(
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
    document.querySelectorAll('.wtv__touch-ghost').forEach(el => el.remove());

    const ghost = document.createElement('div');
    ghost.className = 'wtv__touch-ghost';
    ghost.textContent = this.tree.getNodeDisplayValue(node);
    ghost.style.left = `${x}px`;
    ghost.style.top = `${y}px`;
    document.body.appendChild(ghost);
    this.touchDragState.ghostElement = ghost;
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
      const prevElement = document.querySelector(
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
      const targetElement = document.querySelector(
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
      const element = document.querySelector(
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
      console.log('[Controller] handleEmptyTreeDragOver — activating', { treeId: this._treeId });
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
    console.log('[Controller] handleEmptyTreeDragLeave', { treeId: this._treeId, outside, x, y, rect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right } });
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
    console.log('[Controller] handleTreeDragEnter', { treeId: this._treeId, nodeCount: this.flatNodesToRender.length, hasMime: event.dataTransfer?.types.includes('application/svelte-treeview') });
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
    console.log('[Controller] handleTreeDragLeave', { treeId: this._treeId, outside, x, y, rect: { top: rect.top, bottom: rect.bottom } });
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
