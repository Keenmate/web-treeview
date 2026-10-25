import { TreeEngine } from './controller/tree-engine';
import type { TreeEngineConfig, NodeRef, NodeRenderContext, NodeTransformContext } from './controller/types';
import type { TreeViewRenderer, RendererConfig } from './renderer/types';
import { DomRenderer } from './renderer/dom-renderer';
import type { LTreeNode } from './ltree/ltree-node';
import type { Ltree, DropPosition, TreeChange, ApplyChangesResult, InsertBranchResult, ReplaceBranchResult } from './ltree/types';
import type { SelectMode, TreeMutationOptions } from './controller/types';
import type { PasteResult } from './clipboard';
import type { TreeViewConfig, ScrollToPathOptions } from './types';
import type {
  TreeViewController,
  TreeViewContext,
  NodeContext,
  TreeMenuContext,
  TreeMenuItem,
  TreeViewAction,
  TreeViewActionEventDetail,
  NodeTransformCallback,
} from './interaction';
import type { SearchOptions } from 'flexsearch';
import { withComponentContext, runBeforeCallback, runBeforeCallbackEager, runBeforeCallbackSync, type BeforeCallbackResult } from '@keenmate/web-components-core';
import { runAction, type ResolvedActionItem } from '@keenmate/web-components-core/actions';

/** The names of every {@link TreeViewController} method (the facade is built from them). */
const CONTROLLER_METHODS = [
  'expandAll', 'collapseAll', 'expandNodes', 'collapseNodes', 'toggleNodeExpanded', 'getExpandedPaths',
  'setExpandedPaths', 'filterNodes', 'searchNodes', 'scrollToPath', 'getNodeByPath', 'getChildren',
  'getSiblings', 'getNodeRef', 'getFocusedNode', 'getVisibleFlatNodes', 'getAllData', 'getTree',
  'getInsertResult', 'addNode', 'updateNode', 'removeNode', 'moveNode', 'moveNodes', 'duplicateNodes',
  'applyChanges', 'insertBranch', 'replaceBranch', 'deleteBranch', 'selectNode', 'selectNodes',
  'setSelectedPaths', 'selectAll', 'clearSelection', 'getSelectedNodes', 'getSelectedPaths', 'isNodeSelected',
  'checkNode', 'checkNodes', 'setCheckedPaths', 'checkAll', 'uncheckNode', 'clearChecked', 'getCheckedNodes',
  'getCheckedPaths', 'isNodeChecked', 'focusNode', 'clearFocus', 'navTo', 'navNext', 'navPrev', 'navNextSibling',
  'navPrevSibling', 'navInto', 'navOut', 'navBackOut', 'navToggle', 'navFirst', 'navLast', 'navPageDown', 'navPageUp',
  'navSelectNext', 'navSelectPrev', 'navSelectFirst', 'navSelectLast', 'navSelectPageDown', 'navSelectPageUp', 'copyNodes', 'cutNodes',
  'pasteNodes', 'cancelCut', 'deleteNodes', 'hasClipboardContent', 'getClipboardOperation', 'openContextMenu',
  'closeContextMenu',
] as const satisfies readonly (keyof TreeViewController)[];

/** What a read returns while there is no tree yet (before the first build). */
const EMPTY_RESULTS: Partial<Record<keyof TreeViewController, () => unknown>> = {
  getExpandedPaths: () => [], searchNodes: () => [], getNodeByPath: () => null, getChildren: () => [],
  getSiblings: () => [], getNodeRef: () => ({ path: '', node: null, parent: null, siblings: [] }),
  getFocusedNode: () => null, getVisibleFlatNodes: () => [], getAllData: () => [], getSelectedNodes: () => [],
  getSelectedPaths: () => new Set(), isNodeSelected: () => false, getCheckedNodes: () => [],
  getCheckedPaths: () => new Set(), isNodeChecked: () => false, hasClipboardContent: () => false,
  getClipboardOperation: () => null, scrollToPath: () => Promise.resolve(false),
  pasteNodes: () => ({ success: false, count: 0, skipped: 0, error: 'Not initialized' }),
  deleteNodes: () => ({ removed: 0, blocked: 0 }),
};

/**
 * Build the public facade over whatever `getTarget()` returns now — the element passes
 * its current {@link WebTreeView} (so the facade survives rebuilds), a standalone
 * WebTreeView passes itself.
 */
export function createTreeViewController<T>(getTarget: () => WebTreeView<T> | undefined): TreeViewController<T> {
  const facade: Record<string, unknown> = {};
  for (const name of CONTROLLER_METHODS) {
    facade[name] = (...args: unknown[]) => {
      const target = getTarget() as unknown as Record<string, (...a: unknown[]) => unknown> | undefined;
      if (!target) return EMPTY_RESULTS[name]?.();
      return target[name](...args);
    };
  }
  return facade as unknown as TreeViewController<T>;
}

/** A before-hook result → the engine's internal contract: false | value | undefined. */
function internalGate(result: BeforeCallbackResult): unknown {
  if (result.isCancelled) return false;
  return 'value' in result ? result.value : undefined;
}

/**
 * WebTreeView<T> — wraps the TreeEngine + a TreeViewRenderer. Used by
 * `<web-treeview>` and standalone. It owns the PUBLIC config shape (single-ctx
 * callbacks, events with the component context) and adapts it to the engine's
 * internal callbacks — memoized per source function, so an unchanged callback keeps
 * its identity across updates (the engine rebuilds the tree when one changes).
 */
export class WebTreeView<T = any> {
  private engine: TreeEngine<T>;
  private renderer: TreeViewRenderer<T>;
  private element: HTMLElement;
  /** The public config as last assigned (events, before-hooks, element/controller). */
  private options: Partial<TreeViewConfig<T>>;
  private ownController: TreeViewController<T> | null = null;
  private wrapCache = new WeakMap<object, Map<string, unknown>>();
  private nodeCtxProto: object | null = null;
  private lastFocusedPath: string | null | undefined = undefined;
  /** False between deactivate() and activate() (the host is detached). */
  private isActive = true;

  constructor(
    element: HTMLElement,
    options: Partial<TreeViewConfig<T>> = {},
    renderer?: TreeViewRenderer<T>
  ) {
    this.element = element;
    this.options = { ...options };

    this.engine = new TreeEngine<T>(this.mapToEngineConfig(options));

    // Use provided renderer or default DomRenderer
    this.renderer = renderer ?? new DomRenderer<T>();
    this.renderer.mount(element, this.engine, this.mapToRendererConfig(options));

    // Every state change → `tree-change`; a changed focused node → `focus-change`.
    this.engine.on('state-change', (snapshot: any) => {
      this.options.onTreeChange?.(this.ctx({}));
      const focusedNode: LTreeNode<T> | null = snapshot.focusedNode ?? null;
      const path = focusedNode?.path ?? null;
      if (path !== this.lastFocusedPath) {
        const isFirst = this.lastFocusedPath === undefined;
        this.lastFocusedPath = path;
        if (!isFirst || path !== null) this.options.onFocusChange?.(this.ctx({ focusedNode }));
      }
    });
  }

  // ── Context ─────────────────────────────────────────────────────────

  /** The public facade on every ctx: the element's (rebuild-proof) one, else this view's own. */
  getPublicController(): TreeViewController<T> {
    if (this.options.controller) return this.options.controller;
    return (this.ownController ??= createTreeViewController<T>(() => this));
  }

  private hostElement(): HTMLElement {
    return this.options.hostElement ?? this.element;
  }

  /** Attach `controller` + `element` (non-enumerable) to `fields`. Every ctx / detail goes through here. */
  ctx<F extends object>(fields: F): F & TreeViewContext<T> {
    return withComponentContext(fields, this.getPublicController(), this.hostElement()) as F & TreeViewContext<T>;
  }

  /** Cheap `{ node }` ctx for the hot per-node callbacks: a shared prototype carries controller / element. */
  private nodeCtx(node: LTreeNode<T>): NodeContext<T> {
    if (!this.nodeCtxProto) {
      const self = this;
      this.nodeCtxProto = Object.create(Object.prototype, {
        controller: { get() { return self.getPublicController(); } },
        element: { get() { return self.hostElement(); } },
      });
    }
    const ctx = Object.create(this.nodeCtxProto) as NodeContext<T>;
    ctx.node = node;
    return ctx;
  }

  /** The context menu's surface ctx: the node with its live parent / siblings. */
  private menuCtx(node: LTreeNode<T>): TreeMenuContext<T> {
    return this.ctx({ ...this.engine.nodeRef(node), node }) as TreeMenuContext<T>;
  }

  /** Memoize an adapter per (source function, kind) so its identity is stable across updates. */
  private wrap<F extends (...args: any[]) => any>(src: F | null | undefined, kind: string, make: (src: F) => unknown): any {
    if (src == null) return src;
    let byKind = this.wrapCache.get(src);
    if (!byKind) { byKind = new Map(); this.wrapCache.set(src, byKind); }
    let wrapped = byKind.get(kind);
    if (!wrapped) { wrapped = make(src); byKind.set(kind, wrapped); }
    return wrapped;
  }

  /** A per-node `get*Callback(ctx)` → the engine's `(node) => value`. */
  private nodeCallback<R>(src: ((ctx: NodeContext<T>) => R) | null | undefined): any {
    return this.wrap(src, 'node', (f) => (node: LTreeNode<T>) => f(this.nodeCtx(node)));
  }

  /** A sync before-hook `(ctx)` → the engine's `(engineCtx) => false | value | undefined`. */
  private syncGate(src: ((ctx: any) => unknown) | null | undefined, name: string): any {
    return this.wrap(src, 'gate', (f) => (engineCtx: object) => internalGate(runBeforeCallbackSync(f, this.ctx(engineCtx), name)));
  }

  /** An event twin `(detail)` → the engine's notification `(engineDetail)`. */
  private event(src: ((detail: any) => void) | null | undefined): any {
    return this.wrap(src, 'event', (f) => (engineDetail: object) => f(this.ctx(engineDetail)));
  }

  /** A node transform `(ctx{ data, … })` → the engine's `(data, transformCtx)`. */
  private transform(src: NodeTransformCallback<T> | ((ctx: any) => T) | null | undefined): any {
    return this.wrap(src as any, 'transform', (f) => (data: T, tctx: NodeTransformContext<T>) => f(this.ctx({ ...tctx, data })));
  }

  // ── Context menu: built-ins + activation ────────────────────────────

  /** Built-in state of the default actions (text, disabled, danger). */
  private menuItemDefaults(item: TreeMenuItem<T>, ctx: TreeMenuContext<T>): Partial<ResolvedActionItem<TreeViewAction>> | undefined {
    const node = ctx.node;
    switch (item.action) {
      case 'copy': return { text: 'Copy' };
      case 'cut': return { text: 'Cut' };
      case 'paste': return { text: 'Paste', isDisabled: !this.engine.hasClipboardContent() };
      case 'delete': return { text: 'Delete', isDanger: true };
      case 'expand': return { text: 'Expand', isDisabled: !node.hasChildren || !!node.isExpanded };
      case 'collapse': return { text: 'Collapse', isDisabled: !node.hasChildren || !node.isExpanded };
      default: return undefined;
    }
  }

  /** core runAction: beforeActionCallback → onClick → `action` event → built-in. */
  private activateMenuItem(item: TreeMenuItem<T>, ctx: TreeMenuContext<T>, trigger: HTMLElement, event: Event): Promise<boolean> {
    const detail = this.ctx({
      ...ctx,
      action: item.action ?? 'custom',
      ...(item.id !== undefined ? { id: item.id } : {}),
      item,
      source: 'context-menu',
      sourceEvent: event,
      triggerElement: trigger,
      dataset: {},
    }) as TreeViewActionEventDetail<T>;
    return runAction({
      detail,
      beforeActionCallback: this.options.beforeActionCallback,
      emitAction: (d) => this.options.onAction?.(d),
      runBuiltIn: (d) => this.runBuiltInAction(d.action, ctx.node),
    });
  }

  /** The built-in menu actions act on the node — or on the whole selection when the node is in it. */
  private runBuiltInAction(action: string, node: LTreeNode<T>): void {
    const selected = this.engine.getSelectedPaths();
    const paths = selected.has(node.path) ? [...selected] : [node.path];
    switch (action) {
      case 'copy': this.engine.copyNodes(paths); break;
      case 'cut': this.engine.cutNodes(paths); break;
      case 'paste': this.engine.pasteNodes(node.path); break;
      case 'delete': this.engine.deleteNodes(paths); break;
      case 'expand': this.engine.expandNodes(node.path); break;
      case 'collapse': this.engine.collapseNodes(node.path); break;
    }
  }

  // ── Public API (proxy to engine) ────────────────────────────────────

  update(props: Partial<TreeViewConfig<T>>): void {
    Object.assign(this.options, props);
    const engineConfig = this.mapToEngineConfig(props);
    // If context menu callbacks changed, update the engine's awareness
    if ('renderContextMenuCallback' in props || 'getContextMenuItemsCallback' in props) {
      engineConfig.hasContextMenuRenderer = !!(
        props.renderContextMenuCallback || props.getContextMenuItemsCallback ||
        this.engine.contextMenuCallbackCb
      );
    }
    this.engine.updateProps(engineConfig);
    const rendererConfig = this.mapToRendererConfig(props);
    if (Object.keys(rendererConfig).length > 0) {
      this.renderer.updateConfig(rendererConfig);
    }
  }

  expandNodes(nodePath: string | string[], options?: { exclusive?: boolean; noEmit?: boolean }): void {
    this.engine.expandNodes(nodePath, options);
  }

  collapseNodes(nodePath: string | string[], options?: { noEmit?: boolean }): void {
    this.engine.collapseNodes(nodePath, options);
  }

  /** Toggle the expand state of a node as if the user had clicked its toggle
   *  icon. Honors `isAccordionExpand`. */
  toggleNodeExpanded(path: string): void {
    this.engine.toggleNodeExpanded(path);
  }

  expandAll(nodePath?: string | string[] | null, options?: { exclusive?: boolean; noEmit?: boolean }): void {
    this.engine.expandAll(nodePath, options);
  }

  collapseAll(nodePath?: string | string[] | null, options?: { noEmit?: boolean }): void {
    this.engine.collapseAll(nodePath, options);
  }

  filterNodes(searchText: string, searchOptions?: SearchOptions): void {
    this.engine.filterNodes(searchText, searchOptions);
  }

  searchNodes(searchText: string | null, searchOptions?: SearchOptions): LTreeNode<T>[] {
    if (!searchText) return [];
    return this.engine.searchNodes(searchText, searchOptions);
  }

  scrollToPath(path: string, options?: ScrollToPathOptions): Promise<boolean> {
    return this.engine.scrollToPath(path, options);
  }

  /** Open the context menu for the node at `path` at viewport coordinates. */
  openContextMenu(path: string, x: number, y: number): void {
    const node = this.engine.getNodeByPath(path);
    if (node) this.engine.openContextMenu(node, x, y);
  }

  closeContextMenu(): void {
    this.engine.closeContextMenu();
  }

  getVisibleFlatNodes(): LTreeNode<T>[] {
    return this.engine.flatNodesToRender;
  }

  getTreeNodes(): LTreeNode<T>[] {
    return this.engine.tree.tree;
  }

  getTree(): Ltree<T> {
    return this.engine.tree;
  }

  /** The internal engine — for renderer authors / advanced use; not part of the public API. */
  getEngine(): TreeEngine<T> {
    return this.engine;
  }

  getInsertResult() {
    return this.engine.insertResult;
  }

  getChildren(parentPath: string): LTreeNode<T>[] {
    return this.engine.getChildren(parentPath);
  }

  getSiblings(path: string): LTreeNode<T>[] {
    return this.engine.getSiblings(path);
  }

  /** The node at `path` with its live parent and siblings. */
  getNodeRef(path: string): NodeRef<T> {
    return this.engine.nodeRef(path);
  }

  getFocusedNode(): LTreeNode<T> | null {
    return this.engine.focusedNode ?? null;
  }

  // ── Tree mutation (proxy to engine) ─────────────────────────────────

  moveNode(sourcePath: string, targetPath: string, position: DropPosition) {
    return this.engine.moveNode(sourcePath, targetPath, position);
  }

  removeNode(path: string, includeDescendants?: boolean) {
    return this.engine.removeNode(path, includeDescendants);
  }

  addNode(parentPath: string, nodeData: T, pathSegment?: string) {
    return this.engine.addNode(parentPath, nodeData, pathSegment);
  }

  updateNode(path: string, dataUpdates: Partial<T>) {
    return this.engine.updateNode(path, dataUpdates);
  }

  /** Copy one node (+ descendants) under a parent; `transform({ data, node })` may return null to skip. */
  copyNodeWithDescendants(
    sourceNode: LTreeNode<T>,
    targetParentPath: string,
    transform: (ctx: { data: T; node: LTreeNode<T> } & TreeViewContext<T>) => T | null,
    siblingPath?: string,
    position?: 'before' | 'after'
  ) {
    return this.engine.copyNodeWithDescendants(
      sourceNode, targetParentPath, (data, node) => transform(this.ctx({ data, node })), siblingPath, position);
  }

  /** Batch-move a complete manifest under a target (honors "holes"). */
  moveNodes(paths: string[], targetPath: string, position: DropPosition) {
    return this.engine.moveNodes(paths, targetPath, position);
  }

  /** Batch-duplicate a complete manifest under a target — the copy-side twin of
   *  moveNodes. `sourceTree` defaults to this tree (cross-tree copy otherwise). */
  duplicateNodes(
    paths: string[],
    targetPath: string,
    position: DropPosition,
    transform?: NodeTransformCallback<T>,
    sourceTree?: Ltree<T>
  ) {
    return this.engine.duplicateNodes(paths, targetPath, position, this.transform(transform), sourceTree);
  }

  applyChanges(changes: TreeChange<T>[]): ApplyChangesResult {
    return this.engine.applyChanges(changes);
  }

  insertBranch(parentPath: string, data: T[]): InsertBranchResult<T> {
    return this.engine.insertBranch(parentPath, data);
  }

  replaceBranch(parentPath: string, data: T[]): ReplaceBranchResult<T> {
    return this.engine.replaceBranch(parentPath, data);
  }

  deleteBranch(path: string, keepParent?: boolean): { success: boolean; count: number; error?: string } {
    return this.engine.deleteBranch(path, keepParent);
  }

  getExpandedPaths(): string[] {
    return this.engine.getExpandedPaths();
  }

  setExpandedPaths(paths: string[]): void {
    this.engine.setExpandedPaths(paths);
  }

  getAllData(): T[] {
    return this.engine.getAllData();
  }

  getNodeByPath(path: string): LTreeNode<T> | null {
    return this.engine.getNodeByPath(path);
  }

  // ── Selected set (Ctrl/Shift+click multi-select) ────────────────────

  selectNode(path: string, mode: SelectMode = 'replace', options?: TreeMutationOptions): void {
    this.engine.selectNode(path, mode, options);
  }

  selectNodes(paths: string[], options?: TreeMutationOptions): void {
    this.engine.selectNodes(paths, options);
  }

  setSelectedPaths(paths: string[], options?: TreeMutationOptions): void {
    this.engine.setSelectedPaths(paths, options);
  }

  selectAll(options?: TreeMutationOptions): void {
    this.engine.selectAll(options);
  }

  clearSelection(paths?: string[], options?: TreeMutationOptions): void {
    this.engine.clearSelection(paths, options);
  }

  getSelectedNodes(): LTreeNode<T>[] {
    return this.engine.getSelectedNodes();
  }

  getSelectedPaths(): Set<string> {
    return this.engine.getSelectedPaths();
  }

  isNodeSelected(path: string): boolean {
    return this.engine.isNodeSelected(path);
  }

  // ── Checked set (checkbox / data state) ─────────────────────────────

  checkNode(path: string, options?: TreeMutationOptions): void {
    this.engine.checkNode(path, options);
  }

  checkNodes(paths: string[], options?: TreeMutationOptions): void {
    this.engine.checkNodes(paths, options);
  }

  setCheckedPaths(paths: string[], options?: TreeMutationOptions): void {
    this.engine.setCheckedPaths(paths, options);
  }

  checkAll(options?: TreeMutationOptions): void {
    this.engine.checkAll(options);
  }

  uncheckNode(path: string, options?: TreeMutationOptions): void {
    this.engine.uncheckNode(path, options);
  }

  clearChecked(paths?: string[], options?: TreeMutationOptions): void {
    this.engine.clearChecked(paths, options);
  }

  getCheckedNodes(): LTreeNode<T>[] {
    return this.engine.getCheckedNodes();
  }

  getCheckedPaths(): Set<string> {
    return this.engine.getCheckedPaths();
  }

  isNodeChecked(path: string): boolean {
    return this.engine.isNodeChecked(path);
  }

  // ── Focus (single cursor) ───────────────────────────────────────────

  focusNode(path: string, options?: TreeMutationOptions): void {
    this.engine.focusNode(path, options);
  }

  clearFocus(options?: TreeMutationOptions): void {
    this.engine.clearFocus(options);
  }

  // ── Navigation (proxy to engine) ────────────────────────────────────

  navTo(path: string): void { this.engine.navTo(path); }
  navNext(): void { this.engine.navNext(); }
  navPrev(): void { this.engine.navPrev(); }
  navNextSibling(): void { this.engine.navNextSibling(); }
  navPrevSibling(): void { this.engine.navPrevSibling(); }
  navInto(): void { this.engine.navInto(); }
  navOut(): void { this.engine.navOut(); }
  navBackOut(): void { this.engine.navBackOut(); }
  navToggle(): void { this.engine.navToggle(); }
  navFirst(): void { this.engine.navFirst(); }
  navLast(): void { this.engine.navLast(); }
  navPageDown(): void { this.engine.navPageDown(); }
  navPageUp(): void { this.engine.navPageUp(); }
  navSelectNext(): void { this.engine.navSelectNext(); }
  navSelectPrev(): void { this.engine.navSelectPrev(); }
  navSelectFirst(): void { this.engine.navSelectFirst(); }
  navSelectLast(): void { this.engine.navSelectLast(); }
  navSelectPageDown(): void { this.engine.navSelectPageDown(); }
  navSelectPageUp(): void { this.engine.navSelectPageUp(); }

  // ── Clipboard (proxy to engine) ─────────────────────────────────────

  copyNodes(paths?: string[]): void {
    this.engine.copyNodes(paths);
  }

  cutNodes(paths?: string[]): void {
    this.engine.cutNodes(paths);
  }

  /** Paste under / beside `targetPath`; `transform(ctx{ data, … })` overrides nodeInputTransformationCallback. */
  pasteNodes(targetPath: string, transform?: NodeTransformCallback<T> | null, position?: DropPosition): PasteResult<T> {
    return this.engine.pasteNodes(targetPath, this.transform(transform), position);
  }

  cancelCut(): void {
    this.engine.cancelCut();
  }

  hasClipboardContent(): boolean {
    return this.engine.hasClipboardContent();
  }

  getClipboardOperation(): 'copy' | 'cut' | null {
    return this.engine.getClipboardOperation();
  }

  deleteNodes(paths?: string[]): { removed: number; blocked: number } {
    return this.engine.deleteNodes(paths);
  }

  // ── Renderer swap ───────────────────────────────────────────────────

  /** Swap renderer at runtime without losing tree state. */
  setRenderer(renderer: TreeViewRenderer<T>, config?: Partial<RendererConfig<T>>): void {
    this.renderer.destroy();
    this.renderer = renderer;
    this.renderer.mount(this.element, this.engine, { ...this.mapToRendererConfig(this.options), ...(config || {}) });
    if (!this.isActive) this.renderer.deactivate?.();
  }

  // ── Lifecycle ───────────────────────────────────────────────────────

  /**
   * The host was detached (a DOM move or a removal): stop live resources only
   * (document listeners, observers, autoUpdate, open popups). Tree state, the
   * rendered rows and the scroll offset survive; {@link activate} resumes.
   * Idempotent.
   */
  deactivate(): void {
    if (!this.isActive) return;
    this.isActive = false;
    this.engine.deactivate();
    this.renderer.deactivate?.();
  }

  /** The host was re-attached: restart what {@link deactivate} stopped. Idempotent. */
  activate(): void {
    if (this.isActive) return;
    this.isActive = true;
    this.engine.activate();
    this.renderer.activate?.();
  }

  destroy(): void {
    this.renderer.destroy();
    this.engine.destroy();
  }

  // ── Config adapters (public single-ctx shape → engine internals) ────

  private mapToEngineConfig(options: Partial<TreeViewConfig<T>>): TreeEngineConfig<T> {
    const o = options;
    return {
      idMember: o.idMember || 'id',
      pathMember: o.pathMember || 'path',
      parentPathMember: o.parentPathMember,
      levelMember: o.levelMember,
      isExpandedMember: o.isExpandedMember,
      getIsExpandedCallback: this.nodeCallback(o.getIsExpandedCallback),
      isCheckedMember: o.isCheckedMember,
      getIsCheckedCallback: this.nodeCallback(o.getIsCheckedCallback),
      isSelectableMember: o.isSelectableMember,
      getIsSelectableCallback: this.nodeCallback(o.getIsSelectableCallback),
      isDraggableMember: o.isDraggableMember,
      getIsDraggableCallback: this.nodeCallback(o.getIsDraggableCallback),
      isDropAllowedMember: o.isDropAllowedMember,
      getIsDropAllowedCallback: this.nodeCallback(o.getIsDropAllowedCallback),
      allowedDropPositionsMember: o.allowedDropPositionsMember,
      getAllowedDropPositionsCallback: this.nodeCallback(o.getAllowedDropPositionsCallback),
      isCollapsibleMember: o.isCollapsibleMember,
      getIsCollapsibleCallback: this.nodeCallback(o.getIsCollapsibleCallback),
      hasChildrenMember: o.hasChildrenMember,
      isSorted: o.isSorted,
      displayValueMember: o.displayValueMember,
      getDisplayValueCallback: this.nodeCallback(o.getDisplayValueCallback),
      displayValueFallback: o.displayValueFallback,
      searchValueMember: o.searchValueMember,
      getSearchValueCallback: this.nodeCallback(o.getSearchValueCallback),
      orderMember: o.orderMember,
      treeId: o.treeId,
      treePathSeparator: o.treePathSeparator,
      sortCallback: this.wrap(o.sortCallback, 'sort', (f) => (items: LTreeNode<T>[]) => f(this.ctx({ items }))),

      data: o.data || [],
      focusedNode: o.focusedNode,
      selectedPaths: o.selectedPaths,
      checkedPaths: o.checkedPaths,

      expandLevel: o.expandLevel,
      isAccordionExpand: o.isAccordionExpand,
      clickBehavior: o.clickBehavior,
      searchText: o.searchText,
      shouldUseInternalSearchIndex: o.shouldUseInternalSearchIndex,
      indexerBatchSize: o.indexerBatchSize,
      indexerTimeout: o.indexerTimeout,
      shouldDisplayDebugInformation: o.shouldDisplayDebugInformation ?? false,
      shouldDisplayContextMenuInDebugMode: o.shouldDisplayContextMenuInDebugMode ?? false,
      isLoading: o.isLoading ?? false,

      isProgressiveRender: o.isProgressiveRender ?? true,
      initialBatchSize: o.initialBatchSize,
      maxBatchSize: o.maxBatchSize,
      isFlatRenderingEnabled: o.isFlatRenderingEnabled ?? true,
      flatIndentSize: o.flatIndentSize,

      isVirtualScrollEnabled: o.isVirtualScrollEnabled ?? false,
      virtualRowHeight: o.virtualRowHeight ?? undefined,
      virtualOverscan: o.virtualOverscan ?? undefined,
      virtualContainerHeight: o.virtualContainerHeight ?? undefined,

      dragDropMode: o.dragDropMode,
      dropZoneMode: o.dropZoneMode,
      dropZoneLayout: o.dropZoneLayout,
      dropZoneStart: o.dropZoneStart,
      dropZoneMaxWidth: o.dropZoneMaxWidth,
      isCopyAllowed: o.isCopyAllowed,
      shouldAutoHandleCopy: o.shouldAutoHandleCopy,
      shouldAutoHandleMove: o.shouldAutoHandleMove,
      shouldAutoHandlePaste: o.shouldAutoHandlePaste,
      shouldHandleKeyboardShortcuts: o.shouldHandleKeyboardShortcuts,
      touchDragDelay: o.touchDragDelay,
      shouldIndicateUndraggable: o.shouldIndicateUndraggable,
      shouldEnableTreeDropZone: o.shouldEnableTreeDropZone,

      onNodeClick: this.event(o.onNodeClick),
      onNodeDoubleClick: this.event(o.onNodeDoubleClick),
      onNodeExpand: this.event(o.onNodeExpand),
      onNodeCollapse: this.event(o.onNodeCollapse),
      // Expand gate: core runBeforeCallbackEager keeps a sync hook synchronous; an async
      // one yields a Promise. A rejected Promise is warned here and read as `false`.
      beforeExpandCallback: this.wrap(o.beforeExpandCallback, 'expand', (f) => (engineCtx: object) => {
        const guarded = (ctx: unknown) => {
          const r = (f as (c: unknown) => unknown)(ctx);
          if (r && typeof (r as PromiseLike<unknown>).then === 'function') {
            return Promise.resolve(r).catch((error) => {
              console.warn('[web-treeview] beforeExpandCallback rejected — the node stays collapsed', error);
              return false;
            });
          }
          return r;
        };
        const result = runBeforeCallbackEager(guarded, this.ctx(engineCtx), 'beforeExpandCallback');
        return result instanceof Promise ? result.then(internalGate) : internalGate(result);
      }),
      beforeCopyCallback: this.syncGate(o.beforeCopyCallback, 'beforeCopyCallback'),
      beforeCutCallback: this.syncGate(o.beforeCutCallback, 'beforeCutCallback'),
      beforePasteCallback: this.syncGate(o.beforePasteCallback, 'beforePasteCallback'),
      beforeDeleteCallback: this.syncGate(o.beforeDeleteCallback, 'beforeDeleteCallback'),
      nodeOutputTransformationCallback: this.transform(o.nodeOutputTransformationCallback),
      nodeInputTransformationCallback: this.transform(o.nodeInputTransformationCallback),
      onCopy: this.event(o.onNodeCopy),
      onCut: this.event(o.onNodeCut),
      // The engine passes the PasteResult it also returns — copy it before attaching the context.
      onPaste: this.wrap(o.onNodePaste, 'paste', (f) => (result: PasteResult<T>) => f(this.ctx({ ...result }))),
      onDelete: this.event(o.onNodeDelete),
      onNodeDragStart: this.event(o.onNodeDragStart),
      onNodeDragOver: this.event(o.onNodeDragOver),
      beforeDropCallback: this.wrap(o.beforeDropCallback, 'drop', (f) => async (engineCtx: object) =>
        internalGate(await runBeforeCallback(f, this.ctx(engineCtx), 'beforeDropCallback'))),
      beforeDragStartCallback: this.syncGate(o.beforeDragStartCallback, 'beforeDragStartCallback'),
      onNodeDrop: this.event(o.onNodeDrop),
      onNodeDragDenied: this.event(o.onNodeDragReject),
      onNodeDropDenied: this.event(o.onNodeDropReject),
      // Keydown: the public hook vetoes with `false`; the engine's internal one suppresses with `true`.
      onTreeKeydown: this.wrap(o.beforeKeydownCallback, 'keydown', (f) => (engineCtx: object) =>
        runBeforeCallbackSync(f, this.ctx(engineCtx), 'beforeKeydownCallback').isCancelled ? true : undefined),
      contextMenuCallback: this.wrap(o.getContextMenuItemsCallback, 'menu', (f) => (node: LTreeNode<T>) => f(this.menuCtx(node)) ?? []),
      hasContextMenuRenderer: !!(o.getContextMenuItemsCallback || o.renderContextMenuCallback),

      bodyClass: o.bodyClass,
      selectedNodeClass: o.selectedNodeClass,
      focusedNodeClass: o.focusedNodeClass,
      checkedNodeClass: o.checkedNodeClass,
      dragOverNodeClass: o.dragOverNodeClass,
      draggedNodeClass: o.draggedNodeClass,
      shouldShowNodeTooltips: o.shouldShowNodeTooltips,
      getNodeTooltipCallback: this.nodeCallback(o.getNodeTooltipCallback),
      tooltipPlacement: o.tooltipPlacement ?? undefined,
      tooltipDelay: o.tooltipDelay ?? undefined,
      tooltipOffset: o.tooltipOffset ?? undefined,
      tooltipFollowCursor: o.tooltipFollowCursor ?? undefined,
      iconSet: o.iconSet,
      expandIconClass: o.expandIconClass,
      collapseIconClass: o.collapseIconClass,
      leafIconClass: o.leafIconClass,
      toggleIconMode: o.toggleIconMode,
      scrollHighlightTimeout: o.scrollHighlightTimeout,
      scrollHighlightClass: o.scrollHighlightClass,
      contextMenuXOffset: o.contextMenuXOffset,
      contextMenuYOffset: o.contextMenuYOffset,
      iconMember: o.iconMember,
      iconCallback: this.nodeCallback(o.getIconCallback),
      iconColorMember: o.iconColorMember,
      iconColorCallback: this.nodeCallback(o.getIconColorCallback),
      shouldAlignNodeIcons: o.shouldAlignNodeIcons,
      nodeClass: this.nodeCallback(o.getNodeClassCallback),
      nodeContentClass: this.nodeCallback(o.getNodeContentClassCallback),

      rangeSelectionMode: o.rangeSelectionMode,
      navigationOverrides: o.navigationOverrides,
      selectionMode: o.selectionMode,
      shouldShowCheckboxes: o.shouldShowCheckboxes,
      checkboxMode: o.checkboxMode,
      cascadeCheckPolicy: o.cascadeCheckPolicy,
      shouldClickToggleCheckbox: o.shouldClickToggleCheckbox,
      beforeCheckboxToggleCallback: this.wrap(o.beforeCheckboxToggleCallback, 'checkbox', (f) =>
        (node: LTreeNode<T>, isChecked: boolean, affectedPaths: string[]) =>
          internalGate(runBeforeCallbackSync(f, this.ctx({ node, isChecked, affectedPaths }), 'beforeCheckboxToggleCallback'))),
      onCheckedChange: this.event(o.onCheckedChange),
      onSelectionChange: this.event(o.onSelectionChange),
    } as unknown as TreeEngineConfig<T>;
  }

  private mapToRendererConfig(options: Partial<TreeViewConfig<T>>): RendererConfig<T> {
    const o = options;
    const region = (src: ((ctx: any) => void) | null | undefined) =>
      this.wrap(src, 'region', (f) => (containerElement: HTMLElement) => f(this.ctx({ containerElement })));
    const cfg: RendererConfig<T> = {
      renderNodeCallback: this.wrap(o.renderNodeCallback, 'renderNode', (f) =>
        (node: LTreeNode<T>, contentElement: HTMLElement, rc: NodeRenderContext) => f(this.ctx({ ...rc, node, contentElement }))),
      renderIconCallback: this.wrap(o.renderIconCallback, 'renderIcon', (f) =>
        (node: LTreeNode<T>, value: string | null, iconElement: HTMLElement, rc: NodeRenderContext) =>
          f(this.ctx({ ...rc, node, value, iconElement }))),
      renderEmptyStateCallback: region(o.renderEmptyStateCallback),
      noDataText: o.noDataText,
      renderEmptyZoneCallback: region(o.renderEmptyZoneCallback),
      shouldShowDropPlaceholderWhenEmpty: o.shouldShowDropPlaceholderWhenEmpty,
      renderLoadingCallback: region(o.renderLoadingCallback),
      renderHeaderCallback: region(o.renderHeaderCallback),
      renderFooterCallback: region(o.renderFooterCallback),
      renderContextMenuCallback: this.wrap(o.renderContextMenuCallback, 'renderMenu', (f) =>
        (node: LTreeNode<T>, _close: () => void, containerElement: HTMLElement) =>
          f(Object.assign(this.menuCtx(node), { containerElement }))),
      renderContextMenuItemCallback: this.wrap(o.renderContextMenuItemCallback, 'renderMenuItem', (f) =>
        (menuItem: TreeMenuItem<T>, node: LTreeNode<T>, buttonElement: HTMLElement) =>
          f(Object.assign(this.menuCtx(node), { menuItem, buttonElement }))),
      contextMenuContext: (node) => this.menuCtx(node),
      contextMenuItemDefaults: (item, ctx) => this.menuItemDefaults(item, ctx),
      activateContextMenuItem: (item, ctx, trigger, event) => this.activateMenuItem(item, ctx, trigger, event),
    };
    if ('theme' in options) cfg.theme = options.theme ?? null;
    return cfg;
  }
}
