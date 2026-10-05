import { TreeController } from './controller/tree-controller';
import type { TreeControllerConfig } from './controller/types';
import type { TreeViewRenderer, RendererConfig } from './renderer/types';
import { DomRenderer } from './renderer/dom-renderer';
import type { LTreeNode } from './ltree/ltree-node';
import type { Ltree, DropPosition, TreeChange, ApplyChangesResult } from './ltree/types';
import type { HighlightMode, TreeMutationOptions, NodeTransformContext } from './controller/types';
import type { PasteResult } from './clipboard';
import type { TreeViewConfig, ScrollToPathOptions } from './types';
import type { SearchOptions } from 'flexsearch';

/**
 * WebTreeView<T> — thin facade wrapping TreeController + TreeViewRenderer.
 * Can be used standalone or wrapped by WebTreeViewElement.
 */
export class WebTreeView<T = any> {
  private controller: TreeController<T>;
  private renderer: TreeViewRenderer<T>;
  private element: HTMLElement;

  constructor(
    element: HTMLElement,
    options: Partial<TreeViewConfig<T>> = {},
    renderer?: TreeViewRenderer<T>
  ) {
    this.element = element;

    // Map TreeViewConfig to TreeControllerConfig
    const controllerConfig = mapToControllerConfig(options);
    this.controller = new TreeController<T>(controllerConfig);

    // Use provided renderer or default DomRenderer
    this.renderer = renderer ?? new DomRenderer<T>();
    this.renderer.mount(element, this.controller, mapToRendererConfig(options));

    // Dispatch tree-changed events on the host element
    this.controller.on('state-change', () => {
      this.element.dispatchEvent(new CustomEvent('tree-changed', { bubbles: true }));
    });
  }

  // ── Public API (proxy to controller) ────────────────────────────────

  update(props: Partial<TreeViewConfig<T>>): void {
    const controllerConfig = mapToControllerConfig(props);
    // If context menu callbacks changed, update controller's awareness
    if ('renderContextMenuCallback' in props || 'contextMenuCallback' in props) {
      controllerConfig.hasContextMenuRenderer = !!(
        props.renderContextMenuCallback || props.contextMenuCallback ||
        this.controller.contextMenuCallbackCb
      );
    }
    this.controller.updateProps(controllerConfig);
    const rendererConfig = mapToRendererConfig(props);
    if (Object.keys(rendererConfig).length > 0) {
      this.renderer.updateConfig(rendererConfig);
    }
  }

  expandNodes(
    nodePath: string | string[],
    options?: { exclusive?: boolean; noEmit?: boolean }
  ): void {
    this.controller.expandNodes(nodePath, options);
  }

  collapseNodes(
    nodePath: string | string[],
    options?: { noEmit?: boolean }
  ): void {
    this.controller.collapseNodes(nodePath, options);
  }

  /** Toggle the expand state of a node as if the user had clicked its toggle
   *  icon. Honors `isAccordionExpand`. */
  toggleNodeExpanded(path: string): void {
    this.controller.toggleNodeExpanded(path);
  }

  expandAll(
    nodePath?: string | string[] | null,
    options?: { exclusive?: boolean; noEmit?: boolean }
  ): void {
    this.controller.expandAll(nodePath, options);
  }

  collapseAll(
    nodePath?: string | string[] | null,
    options?: { noEmit?: boolean }
  ): void {
    this.controller.collapseAll(nodePath, options);
  }

  filterNodes(searchText: string, searchOptions?: SearchOptions): void {
    this.controller.filterNodes(searchText, searchOptions);
  }

  searchNodes(searchText: string | null, searchOptions?: SearchOptions): LTreeNode<T>[] {
    if (!searchText) return [];
    return this.controller.searchNodes(searchText, searchOptions);
  }

  scrollToPath(path: string, options?: ScrollToPathOptions): Promise<boolean> {
    return this.controller.scrollToPath(path, options);
  }

  closeContextMenu(): void {
    this.controller.closeContextMenu();
  }

  getVisibleFlatNodes(): LTreeNode<T>[] {
    return this.controller.flatNodesToRender;
  }

  getTreeNodes(): LTreeNode<T>[] {
    return this.controller.tree.tree;
  }

  getTree(): Ltree<T> {
    return this.controller.tree;
  }

  getController(): TreeController<T> {
    return this.controller;
  }

  getInsertResult() {
    return this.controller.insertResult;
  }

  getConfig(): Partial<TreeViewConfig<T>> {
    // Return snapshot of current config from controller
    return {};
  }

  // ── Tree mutation (proxy to controller) ─────────────────────────────

  moveNode(sourcePath: string, targetPath: string, position: DropPosition) {
    return this.controller.moveNode(sourcePath, targetPath, position);
  }

  removeNode(path: string, includeDescendants?: boolean) {
    return this.controller.removeNode(path, includeDescendants);
  }

  addNode(parentPath: string, nodeData: T, pathSegment?: string) {
    return this.controller.addNode(parentPath, nodeData, pathSegment);
  }

  updateNode(path: string, dataUpdates: Partial<T>) {
    return this.controller.updateNode(path, dataUpdates);
  }

  copyNodeWithDescendants(
    sourceNode: LTreeNode<T>,
    targetParentPath: string,
    dataTransform: (data: T, node: LTreeNode<T>) => T | null,
    siblingPath?: string,
    position?: 'before' | 'after'
  ) {
    return this.controller.copyNodeWithDescendants(sourceNode, targetParentPath, dataTransform, siblingPath, position);
  }

  /** Batch-move a complete manifest under a target (honors "holes"). rc13. */
  moveNodes(paths: string[], targetPath: string, position: DropPosition) {
    return this.controller.moveNodes(paths, targetPath, position);
  }

  /** Batch-duplicate a complete manifest under a target — the copy-side twin of
   *  moveNodes. `sourceTree` defaults to this tree (cross-tree copy otherwise). rc13. */
  duplicateNodes(
    paths: string[],
    targetPath: string,
    position: DropPosition,
    transform?: (data: T, ctx: NodeTransformContext<T>) => T | null,
    sourceTree?: Ltree<T>
  ) {
    return this.controller.duplicateNodes(paths, targetPath, position, transform, sourceTree);
  }

  applyChanges(changes: TreeChange<T>[]): ApplyChangesResult {
    return this.controller.applyChanges(changes);
  }

  insertBranch(parentPath: string, data: T[]): { success: boolean; count: number; error?: string } {
    return this.controller.insertBranch(parentPath, data);
  }

  replaceBranch(parentPath: string, data: T[]): { success: boolean; removed: number; added: number; error?: string } {
    return this.controller.replaceBranch(parentPath, data);
  }

  deleteBranch(path: string, keepParent?: boolean): { success: boolean; count: number; error?: string } {
    return this.controller.deleteBranch(path, keepParent);
  }

  getExpandedPaths(): string[] {
    return this.controller.getExpandedPaths();
  }

  setExpandedPaths(paths: string[]): void {
    this.controller.setExpandedPaths(paths);
  }

  getAllData(): T[] {
    return this.controller.getAllData();
  }

  getNodeByPath(path: string): LTreeNode<T> | null {
    return this.controller.getNodeByPath(path);
  }

  // ── Highlight set (Ctrl/Shift+click multi-select) ───────────────────

  highlightNode(
    path: string,
    mode: HighlightMode = 'replace',
    options?: TreeMutationOptions
  ): void {
    this.controller.highlightNode(path, mode, options);
  }

  highlightNodes(paths: string[], options?: TreeMutationOptions): void {
    this.controller.highlightNodes(paths, options);
  }

  setHighlightedPaths(paths: string[], options?: TreeMutationOptions): void {
    this.controller.setHighlightedPaths(paths, options);
  }

  highlightAll(options?: TreeMutationOptions): void {
    this.controller.highlightAll(options);
  }

  clearHighlight(paths?: string[], options?: TreeMutationOptions): void {
    this.controller.clearHighlight(paths, options);
  }

  getHighlightedNodes(): LTreeNode<T>[] {
    return this.controller.getHighlightedNodes();
  }

  getHighlightedPaths(): Set<string> {
    return this.controller.getHighlightedPaths();
  }

  isNodeHighlighted(path: string): boolean {
    return this.controller.isNodeHighlighted(path);
  }

  // ── Selection set (checkbox / data state) ───────────────────────────

  selectNode(path: string, options?: TreeMutationOptions): void {
    this.controller.selectNode(path, options);
  }

  selectNodes(paths: string[], options?: TreeMutationOptions): void {
    this.controller.selectNodes(paths, options);
  }

  setSelectedPaths(paths: string[], options?: TreeMutationOptions): void {
    this.controller.setSelectedPaths(paths, options);
  }

  selectAll(options?: TreeMutationOptions): void {
    this.controller.selectAll(options);
  }

  deselectNode(path: string, options?: TreeMutationOptions): void {
    this.controller.deselectNode(path, options);
  }

  clearSelection(paths?: string[], options?: TreeMutationOptions): void {
    this.controller.clearSelection(paths, options);
  }

  getSelectedNodes(): LTreeNode<T>[] {
    return this.controller.getSelectedNodes();
  }

  getSelectedPaths(): Set<string> {
    return this.controller.getSelectedPaths();
  }

  isNodeSelected(path: string): boolean {
    return this.controller.isNodeSelected(path);
  }

  // ── Focus (single cursor) ───────────────────────────────────────────

  focusNode(path: string, options?: TreeMutationOptions): void {
    this.controller.focusNode(path, options);
  }

  clearFocus(options?: TreeMutationOptions): void {
    this.controller.clearFocus(options);
  }

  // ── Navigation (proxy to controller) ──────────────────────────────

  navTo(path: string): void { this.controller.navTo(path); }
  navNext(): void { this.controller.navNext(); }
  navPrev(): void { this.controller.navPrev(); }
  navNextSibling(): void { this.controller.navNextSibling(); }
  navPrevSibling(): void { this.controller.navPrevSibling(); }
  navInto(): void { this.controller.navInto(); }
  navOut(): void { this.controller.navOut(); }
  navBackOut(): void { this.controller.navBackOut(); }
  navToggle(): void { this.controller.navToggle(); }
  navFirst(): void { this.controller.navFirst(); }
  navLast(): void { this.controller.navLast(); }

  // ── Clipboard (proxy to controller) ───────────────────────────────

  copyNodes(paths?: string[]): void {
    this.controller.copyNodes(paths);
  }

  cutNodes(paths?: string[]): void {
    this.controller.cutNodes(paths);
  }

  pasteNodes(
    targetPath: string,
    transformData?: ((data: T, ctx: NodeTransformContext<T>) => T | null) | null,
    position?: DropPosition
  ): PasteResult<T> {
    return this.controller.pasteNodes(targetPath, transformData, position);
  }

  cancelCut(): void {
    this.controller.cancelCut();
  }

  hasClipboardContent(): boolean {
    return this.controller.hasClipboardContent();
  }

  getClipboardOperation(): 'copy' | 'cut' | null {
    return this.controller.getClipboardOperation();
  }

  deleteNodes(paths?: string[]): { removed: number; blocked: number } {
    return this.controller.deleteNodes(paths);
  }

  // ── Renderer swap ───────────────────────────────────────────────────

  /** Swap renderer at runtime without losing tree state. */
  setRenderer(renderer: TreeViewRenderer<T>, config?: Partial<RendererConfig<T>>): void {
    this.renderer.destroy();
    this.renderer = renderer;
    this.renderer.mount(this.element, this.controller, config || {});
  }

  // ── Lifecycle ───────────────────────────────────────────────────────

  destroy(): void {
    this.renderer.destroy();
    this.controller.destroy();
  }
}

// ── Config mappers ────────────────────────────────────────────────────────

function mapToControllerConfig<T>(options: Partial<TreeViewConfig<T>>): TreeControllerConfig<T> {
  return {
    idMember: options.idMember || 'id',
    pathMember: options.pathMember || 'path',
    parentPathMember: options.parentPathMember,
    levelMember: options.levelMember,
    isExpandedMember: options.isExpandedMember,
    getIsExpandedCallback: options.getIsExpandedCallback,
    isSelectedMember: options.isSelectedMember,
    getIsSelectedCallback: options.getIsSelectedCallback,
    isSelectableMember: options.isSelectableMember,
    getIsSelectableCallback: options.getIsSelectableCallback,
    isDraggableMember: options.isDraggableMember,
    getIsDraggableCallback: options.getIsDraggableCallback,
    isDropAllowedMember: options.isDropAllowedMember,
    getIsDropAllowedCallback: options.getIsDropAllowedCallback,
    allowedDropPositionsMember: options.allowedDropPositionsMember,
    getAllowedDropPositionsCallback: options.getAllowedDropPositionsCallback,
    isCollapsibleMember: options.isCollapsibleMember,
    getIsCollapsibleCallback: options.getIsCollapsibleCallback,
    hasChildrenMember: options.hasChildrenMember,
    isSorted: options.isSorted,
    displayValueMember: options.displayValueMember,
    getDisplayValueCallback: options.getDisplayValueCallback,
    displayValueFallback: options.displayValueFallback,
    searchValueMember: options.searchValueMember,
    getSearchValueCallback: options.getSearchValueCallback,
    orderMember: options.orderMember,
    treeId: options.treeId,
    treePathSeparator: options.treePathSeparator,
    sortCallback: options.sortCallback,

    data: options.data || [],
    focusedNode: options.focusedNode,
    highlightedPaths: options.highlightedPaths,
    selectedPaths: options.selectedPaths,

    expandLevel: options.expandLevel,
    isAccordionExpand: options.isAccordionExpand,
    clickBehavior: options.clickBehavior,
    searchText: options.searchText,
    shouldUseInternalSearchIndex: options.shouldUseInternalSearchIndex,
    indexerBatchSize: options.indexerBatchSize,
    indexerTimeout: options.indexerTimeout,
    shouldDisplayDebugInformation: options.shouldDisplayDebugInformation ?? false,
    shouldDisplayContextMenuInDebugMode: options.shouldDisplayContextMenuInDebugMode ?? false,
    isLoading: options.isLoading ?? false,

    isProgressiveRender: options.isProgressiveRender ?? true,
    initialBatchSize: options.initialBatchSize,
    maxBatchSize: options.maxBatchSize,
    isFlatRenderingEnabled: options.isFlatRenderingEnabled ?? true,
    flatIndentSize: options.flatIndentSize,

    isVirtualScrollEnabled: options.isVirtualScrollEnabled ?? false,
    virtualRowHeight: options.virtualRowHeight ?? undefined,
    virtualOverscan: options.virtualOverscan ?? undefined,
    virtualContainerHeight: options.virtualContainerHeight ?? undefined,

    dragDropMode: options.dragDropMode,
    dropZoneMode: options.dropZoneMode,
    dropZoneLayout: options.dropZoneLayout,
    dropZoneStart: options.dropZoneStart,
    dropZoneMaxWidth: options.dropZoneMaxWidth,
    isCopyAllowed: options.isCopyAllowed,
    shouldAutoHandleCopy: options.shouldAutoHandleCopy,
    shouldAutoHandleMove: options.shouldAutoHandleMove,
    shouldAutoHandlePaste: options.shouldAutoHandlePaste,
    shouldHandleKeyboardShortcuts: options.shouldHandleKeyboardShortcuts,
    touchDragDelay: options.touchDragDelay,
    shouldIndicateUndraggable: options.shouldIndicateUndraggable,
    shouldEnableTreeDropZone: options.shouldEnableTreeDropZone,

    onNodeClick: options.onNodeClick,
    onNodeDoubleClick: options.onNodeDoubleClick,
    beforeCopyCallback: options.beforeCopyCallback,
    beforeCutCallback: options.beforeCutCallback,
    beforePasteCallback: options.beforePasteCallback,
    beforeDeleteCallback: options.beforeDeleteCallback,
    nodeOutputTransformationCallback: options.nodeOutputTransformationCallback,
    nodeInputTransformationCallback: options.nodeInputTransformationCallback,
    onCopy: options.onCopy,
    onCut: options.onCut,
    onPaste: options.onPaste,
    onDelete: options.onDelete,
    onNodeDragStart: options.onNodeDragStart,
    onNodeDragOver: options.onNodeDragOver,
    beforeDropCallback: options.beforeDropCallback,
    beforeDragStartCallback: options.beforeDragStartCallback,
    onNodeDrop: options.onNodeDrop,
    onNodeDragDenied: options.onNodeDragDenied,
    onNodeDropDenied: options.onNodeDropDenied,
    onTreeKeydown: options.onTreeKeydown,
    contextMenuCallback: options.contextMenuCallback,
    hasContextMenuRenderer: !!(options.contextMenuCallback || options.renderContextMenuCallback),

    bodyClass: options.bodyClass,
    highlightedNodeClass: options.highlightedNodeClass,
    focusedNodeClass: options.focusedNodeClass,
    dragOverNodeClass: options.dragOverNodeClass,
    draggedNodeClass: options.draggedNodeClass,
    iconSet: options.iconSet,
    expandIconClass: options.expandIconClass,
    collapseIconClass: options.collapseIconClass,
    leafIconClass: options.leafIconClass,
    toggleIconMode: options.toggleIconMode,
    scrollHighlightTimeout: options.scrollHighlightTimeout,
    scrollHighlightClass: options.scrollHighlightClass,
    contextMenuXOffset: options.contextMenuXOffset,
    contextMenuYOffset: options.contextMenuYOffset,
    iconMember: options.iconMember,
    iconCallback: options.iconCallback,
    shouldAlignNodeIcons: options.shouldAlignNodeIcons,
    nodeClass: options.nodeClass,
    nodeContentClass: options.nodeContentClass,

    renderStartCallback: options.renderStartCallback,
    renderProgressCallback: options.renderProgressCallback,
    renderCompleteCallback: options.renderCompleteCallback,

    rangeSelectionMode: options.rangeSelectionMode,
    selectionMode: options.selectionMode,
    shouldShowCheckboxes: options.shouldShowCheckboxes,
    checkboxMode: options.checkboxMode,
    cascadeSelectPolicy: options.cascadeSelectPolicy,
    shouldClickToggleCheckbox: options.shouldClickToggleCheckbox,
    beforeCheckboxToggleCallback: options.beforeCheckboxToggleCallback,
    onSelectionChange: options.onSelectionChange,
    onHighlightChange: options.onHighlightChange,
  } as TreeControllerConfig<T>;
}

function mapToRendererConfig<T>(options: Partial<TreeViewConfig<T>>): RendererConfig<T> {
  const cfg: RendererConfig<T> = {
    renderNodeCallback: options.renderNodeCallback,
    renderEmptyStateCallback: options.renderEmptyStateCallback,
    noDataText: options.noDataText,
    renderEmptyZoneCallback: options.renderEmptyZoneCallback,
    shouldShowDropPlaceholderWhenEmpty: options.shouldShowDropPlaceholderWhenEmpty,
    renderLoadingCallback: options.renderLoadingCallback,
    renderHeaderCallback: options.renderHeaderCallback,
    renderFooterCallback: options.renderFooterCallback,
    renderContextMenuCallback: options.renderContextMenuCallback,
    renderContextMenuItemCallback: options.renderContextMenuItemCallback,
  };
  if ('theme' in options) cfg.theme = options.theme ?? null;
  return cfg;
}
