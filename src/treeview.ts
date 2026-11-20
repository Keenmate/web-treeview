import { createLabels, type Labels } from '@keenmate/web-components-core/locale';
import { DEFAULT_LABELS, type TreeViewLabels } from './labels';
import { TreeViewState } from './controller/tree-view-state';
import type { TreeLoggers } from './logger';
import type { TreeViewStateConfig, NodeRef, NodeDropContext, NodeRenderContext, NodeTransformContext } from './controller/types';
import type { TreeViewRenderer, RendererConfig, ContainerSize } from './renderer/types';
import type { RenderStats } from './renderer/render-coordinator';
import { DomRenderer } from './renderer/dom-renderer';
import type { LTreeNode } from './ltree/ltree-node';
import type { IndexProgress, SearchStatus } from './ltree/types';
import type { Ltree, ExpandOptions, SortOptions, NodesReorderContext, DropPosition, TreeChange, ApplyChangesResult, InsertBranchResult, ReplaceBranchResult, RemoveBranchResult } from './ltree/types';
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
  ContextMenuRenderContext,
  ContextMenuItemRenderContext,
} from './interaction';
import type { SearchOptions } from 'flexsearch';
import { adoptStyles, ICON_CSS, renderIcon, type RenderIconCallback, announce, withComponentContext, createControllerFacade, renderLoader, type RenderLoaderCallback, type SlotResult, runBeforeCallback, runBeforeCallbackEager, runBeforeCallbackSync, type BeforeCallbackResult } from '@keenmate/web-components-core';
import { resolveMenuEntries, runAction, type ResolvedActionItem } from '@keenmate/web-components-core/actions';
import { menuPresentationOptions } from '@keenmate/web-components-core/menu';
import { withEngineDefaults } from './inputs';

/** Built-in menu actions that change the data — greyed out and inert while `isReadonly`. */
const READONLY_BLOCKED_ACTIONS = new Set(['cut', 'paste', 'delete', 'sort', 'sort-subtree', 'sort-all']);

/** The names of every {@link TreeViewController} method (the facade is built from them). */
const CONTROLLER_METHODS = [
  'expandAll', 'collapseAll', 'expandNodes', 'collapseNodes', 'toggleNodeExpanded', 'sortNodes', 'sortAll',
  'filterNodes', 'searchNodes', 'scrollToPath', 'getNodeByPath', 'getChildren',
  'getSiblings', 'getNodeRef', 'getVisibleFlatNodes', 'getTree', 'refreshNode', 'refreshSiblings', 'isNodeDropAllowed',
  'addNode', 'insertNode', 'updateNode', 'removeNode', 'moveNode', 'moveNodes', 'duplicateNodes',
  'applyChanges', 'addBranch', 'insertBranch', 'replaceBranch', 'removeBranch', 'selectNode', 'selectNodes',
  'selectAll', 'clearSelection', 'getSelectedNodes', 'isNodeSelected', 'toggleFocusedSelect',
  'checkNode', 'checkNodes', 'checkAll', 'uncheckNode', 'uncheckNodes', 'uncheckAll', 'getCheckedNodes',
  'isNodeChecked', 'focusNode', 'clearFocus', 'navTo', 'navNext', 'navPrev', 'navNextSibling',
  'navPrevSibling', 'navInto', 'navOut', 'navBackOut', 'navToggle', 'navFirst', 'navLast', 'navPageDown', 'navPageUp',
  'navSelectNext', 'navSelectPrev', 'navSelectFirst', 'navSelectLast', 'navSelectPageDown', 'navSelectPageUp', 'copyNodes', 'cutNodes',
  'pasteNodes', 'cancelCut', 'removeNodes', 'hasClipboardContent', 'getClipboardOperation', 'openContextMenu',
  'closeContextMenu', 'activateMenuItem',
] as const satisfies readonly (keyof TreeViewController)[];

/** What a read returns while there is no tree yet (before the first build). */
const EMPTY_RESULTS: Partial<Record<keyof TreeViewController, () => unknown>> = {
  searchNodes: () => [], getNodeByPath: () => null, getChildren: () => [],
  getSiblings: () => [], getNodeRef: () => ({ path: '', node: null, parent: null, siblings: [] }),
  getVisibleFlatNodes: () => [], getSelectedNodes: () => [],
  isNodeSelected: () => false, isNodeDropAllowed: () => false, getCheckedNodes: () => [],
  isNodeChecked: () => false, hasClipboardContent: () => false,
  getClipboardOperation: () => null, scrollToPath: () => Promise.resolve(false),
  pasteNodes: () => ({ success: false, count: 0, skipped: 0, error: 'Not initialized' }),
  removeNodes: () => ({ removed: 0, failed: 0 }),
  activateMenuItem: () => Promise.resolve(false),
};

/**
 * Build the public facade over whatever `getTarget()` returns now — the element passes
 * its current {@link TreeViewEngine} (so the facade survives rebuilds), a standalone
 * TreeViewEngine passes itself.
 */
export function createTreeViewController<T>(
  getTarget: () => TreeViewEngine<T> | undefined,
  /** State reads while there is no tree yet (the element knows `isRendering` during the first build). */
  fallback: Partial<Record<string, () => unknown>> = {},
): TreeViewController<T> {
  // Core's facade (SPEC §12.34): frozen; methods forwarded to the current tree; read-only state
  // answered live (empty values before the first build); `selectionAnchor` also writable.
  return createControllerFacade<TreeViewController<T>>(getTarget, {
    methods: CONTROLLER_METHODS,
    state: {
      expandedPaths: () => [], selectedPaths: () => [], checkedPaths: () => [], focusedNode: null,
      insertResult: undefined, nodes: () => [], isRendering: false, containerSize: null,
      ...fallback,
    },
    writable: ['selectionAnchor'],
    emptyResults: EMPTY_RESULTS as Record<string, () => unknown>,
  });
}

/** A before-hook result → the engine's internal contract: false | value | undefined. */
function internalGate(result: BeforeCallbackResult): unknown {
  if (result.isRejected) return false;
  return 'value' in result ? result.value : undefined;
}

/**
 * TreeViewEngine<T> — the class behind `<web-treeview>`: connects a TreeViewState + a TreeViewRenderer + a container.
 * Public as the seam for your own UI (docs/usage.md "Build your own UI"): `new TreeViewEngine(container,
 * options, renderer?)` — the same options as the element (every per-element hook / setting the element
 * passes through) with the same defaults (`ENGINE_DEFAULTS`, read from the element's input table), a custom
 * `TreeViewRenderer` draws. It owns the PUBLIC config shape (single-ctx
 * callbacks, events with the component context) and adapts it to the engine's
 * internal callbacks — memoized per source function, so an unchanged callback keeps
 * its identity across updates (the engine rebuilds the tree when one changes).
 */
export class TreeViewEngine<T = any> {
  private engine: TreeViewState<T>;
  private renderer: TreeViewRenderer<T>;
  private element: HTMLElement;
  /** The public config as last assigned (events, before-hooks, element/controller). */
  private options: Partial<TreeViewConfig<T>>;
  private ownController: TreeViewController<T> | null = null;
  private wrapCache = new WeakMap<object, Map<string, unknown>>();
  private nodeCtxProto: object | null = null;
  private lastFocusedPath: string | null | undefined = undefined;
  /** The tree container's last measured size (renderer resize observer). */
  private lastContainerSize: ContainerSize | null = null;
  /** False between deactivate() and activate() (the host is detached). */
  private isActive = true;
  /** The UI strings (core `/locale`, D-NC-24): instance `labels` → own `translateCallback` → page-wide
   *  `translateCallback` → `window.components.locale.labels['web-treeview.<key>']` → English. Read live on every call. */
  private labels!: Labels<TreeViewLabels>;

  constructor(
    element: HTMLElement,
    options: Partial<TreeViewConfig<T>> = {},
    renderer?: TreeViewRenderer<T>,
    /** Loggers for the engine / LTree / renderer — the element passes its instance
     *  loggers so lines read `[TREEVIEW:CAT] #id …`. */
    log?: TreeLoggers
  ) {
    this.element = element;
    // Every option the caller leaves out (or `undefined`) gets <web-treeview>'s default — one source, the input table (C-CA-37).
    this.options = withEngineDefaults(options);
    this.labels = createLabels(this.hostElement(), DEFAULT_LABELS as TreeViewLabels, () => this.options.labels, {
      tag: 'web-treeview',
      // This tree's own translateCallback (the element's input, or a plain TreeViewEngine option) → the page-wide one.
      getTranslateCallback: () => this.options.translateCallback ?? undefined,
    });

    this.engine = new TreeViewState<T>({ ...this.mapToEngineConfig(this.options), log });

    // Use provided renderer or default DomRenderer
    this.renderer = renderer ?? new DomRenderer<T>();
    this.renderer.mount(element, this.engine, this.mapToRendererConfig(this.options));

    // Expand / collapse methods announce `expanded-change` synchronously.
    this.engine.on('expanded-change', (paths: string[]) => {
      this.options.onExpandedChange?.(this.ctx({ paths }));
    });
    // Data / structure mutations → `tree-change` (one per change; not expand / select / focus).
    this.engine.on('tree-change', () => {
      this.options.onTreeChange?.(this.ctx({}));
    });
    // A changed focused node → `focus-change`.
    this.engine.on('state-change', (snapshot: any) => {
      const focusedNode: LTreeNode<T> | null = snapshot.focusedNode ?? null;
      const path = focusedNode?.path ?? null;
      // A focus produced by a `{ isSilent: true }` operation is not echoed (NOTES #11).
      const silentPath = this.engine.takeSilentFocus();
      // Expanded-set changes no method announced synchronously (data loads, mutations).
      const expanded = this.engine.takeExpandedChange();
      if (expanded) this.options.onExpandedChange?.(this.ctx({ paths: expanded }));
      if (path !== this.lastFocusedPath) {
        const isFirst = this.lastFocusedPath === undefined;
        this.lastFocusedPath = path;
        const isSilent = silentPath !== undefined && silentPath === path;
        if (!isSilent && (!isFirst || path !== null)) this.options.onFocusChange?.(this.ctx({ focusedNode }));
      }
    });
  }

  // ── Screen-reader announcements (core `announce()`) ─────────────────

  /** Announce a label through the page's polite live region; a label set to `''` stays silent. */
  private say(key: keyof TreeViewLabels, params?: Record<string, unknown>): void {
    const text = this.labels.text(key, params as any);
    if (text) announce(text, { document: this.hostElement().ownerDocument });
  }

  /** A node's display text for an announcement. */
  private nodeName(node: LTreeNode<T> | null | undefined): string {
    return node ? (this.engine.tree?.getNodeDisplayValue(node) || String(node.id)) : '';
  }

  /** `search-status-change` bridge: announce a settled search (not while the index is still
   *  filling — a fresh status follows when it completes; a cleared search is silent). */
  private readonly searchStatusBridge = (s: SearchStatus): void => {
    if (s.searchTerm && !s.isIndexing) {
      if (s.matchCount === 0) this.say('ariaLabels.searchNoResults');
      else this.say(s.matchCount === 1 ? 'ariaLabels.searchResultsOne' : 'ariaLabels.searchResults', { count: s.matchCount });
    }
    this.options.onSearchStatusChange?.(this.ctx({ searchTerm: s.searchTerm, matchCount: s.matchCount, isLimited: s.isLimited, limit: s.limit, isIndexing: s.isIndexing }));
  };

  /** `node-drop` bridge: announce the outcome when the tree placed the nodes itself
   *  (a consumer-owned drop — `dropped: null` — is the consumer's to announce). */
  private readonly nodeDropBridge = (d: NodeDropContext<T>): void => {
    if (d.dropped?.length) {
      const name = d.dragged.length > 1
        ? this.labels.text('ariaLabels.dropItems', { count: d.dragged.length })
        : this.nodeName(d.dropped[0].node);
      const target = d.target?.node ? this.nodeName(d.target.node) : this.labels.text('ariaLabels.dropTreeRoot');
      const where = !d.target || d.position === 'child' ? 'Into' : d.position === 'before' ? 'Before' : 'After';
      this.say(`ariaLabels.${d.operation === 'copy' ? 'copied' : 'moved'}${where}` as keyof TreeViewLabels, { name, target });
    }
    this.options.onNodeDrop?.(this.ctx(d));
  };

  /** `node-drop-reject` bridge: say the drop was refused, and why. */
  private readonly nodeDropDeniedBridge = (ref: NodeRef<T>): void => {
    this.say('ariaLabels.dropDenied', { target: this.nodeName(ref.node) });
    this.options.onNodeDropReject?.(this.ctx(ref));
  };

  // ── Context ─────────────────────────────────────────────────────────

  /** The public facade on every ctx: the element's (rebuild-proof) one, else this view's own. */
  getPublicController(): TreeViewController<T> {
    if (this.options.controller) return this.options.controller;
    return (this.ownController ??= createTreeViewController<T>(() => this));
  }

  private hostElement(): HTMLElement {
    return this.options.hostElement ?? this.element;
  }

  /** The root the ICON_CSS (`.km-icon`, the built-in masked glyphs) was adopted into. */
  private iconCssRoot: Node | null = null;

  /**
   * A node icon's markup — core `renderIcon` (SPEC §12.33): markup → built-in name → the instance
   * `renderIconCallback(name, ctx)` → the page-wide `window.components.renderIconCallback` → icon-font
   * `<i class="wtv__icon …">` → escaped text. `ctx` carries `node` + the render state + `controller`.
   */
  private nodeIconHtml = (value: string, node: LTreeNode<T>, rc: NodeRenderContext): string => {
    const root = this.element.getRootNode();
    if (root !== this.iconCssRoot && (root instanceof Document || root instanceof ShadowRoot)) {
      adoptStyles(root, ICON_CSS);
      this.iconCssRoot = root;
    }
    return renderIcon(value, {
      prefix: 'wtv',
      host: this.hostElement(),
      renderIconCallback: (this.options.renderIconCallback ?? null) as unknown as RenderIconCallback | null,
      context: { ...rc, node, controller: this.getPublicController() },
    });
  };

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

  /** The overlay loader drawer: core `renderLoader` with the instance hook (else the page
   *  hook, else the default `.wtv__loader`). Stable identity per hook (the renderer redraws on change). */
  private defaultLoaderDrawer: ((container: HTMLElement, label: string) => () => void) | null = null;
  private loaderDrawer(src: RenderLoaderCallback | null | undefined): (container: HTMLElement, label: string) => () => void {
    const make = (hook: RenderLoaderCallback | null) => (container: HTMLElement, label: string) =>
      renderLoader(this.hostElement(), container, 'overlay', { prefix: 'wtv', label, renderLoadingCallback: hook });
    if (typeof src !== 'function') return (this.defaultLoaderDrawer ??= make(null));
    return this.wrap(src, 'loader', make);
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
    const label = (key: keyof TreeViewLabels) => this.labels.text(key);
    const targets = () => this.actionTargets(ctx.node).map((p) => this.engine.getNodeByPath(p)).filter((n): n is LTreeNode<T> => !!n && !!n.hasChildren);
    switch (item.action) {
      case 'copy': return { text: label('menuItems.copy') };
      case 'cut': return { text: label('menuItems.cut'), isDisabled: this.isReadonly() };
      case 'paste': return { text: label('menuItems.paste'), isDisabled: this.isReadonly() || !this.engine.hasClipboardContent() };
      case 'delete': return { text: label('menuItems.delete'), isDanger: true, isDisabled: this.isReadonly() };
      case 'expand': return { text: label('menuItems.expand'), isDisabled: !targets().some((n) => !n.isExpanded) };
      case 'collapse': return { text: label('menuItems.collapse'), isDisabled: !targets().some((n) => n.isExpanded) };
      case 'expand-subtree': return { text: label('menuItems.expandSubtree'), isDisabled: targets().length === 0 };
      case 'collapse-subtree': return { text: label('menuItems.collapseSubtree'), isDisabled: targets().length === 0 };
      case 'expand-all': return { text: label('menuItems.expandAll') };
      case 'collapse-all': return { text: label('menuItems.collapseAll') };
      case 'sort': return { text: label('menuItems.sort'), isDisabled: this.isReadonly() || targets().length === 0 };
      case 'sort-subtree': return { text: label('menuItems.sortSubtree'), isDisabled: this.isReadonly() || targets().length === 0 };
      case 'sort-all': return { text: label('menuItems.sortAll'), isDisabled: this.isReadonly() };
      default: return undefined;
    }
  }

  /**
   * Activate a menu item exactly like the built-in menu (core `runAction`):
   * `beforeActionCallback` (`false` cancels — nothing else runs) → item `onClick(detail)` →
   * the built-in action (on the selection when `ctx.node` is in it, else on `ctx.node`) →
   * `action` event / `onAction(detail)`. `detail.source` is `'context-menu'`; `trigger` gets
   * `aria-busy` while it runs (a second activation of the same item meanwhile is ignored).
   * Resolves `false` when cancelled or ignored. Public for `renderContextMenuCallback` —
   * closing the menu is the caller's job (honour `item.shouldCloseOnClick !== false`).
   */
  activateMenuItem(item: TreeMenuItem<T>, ctx: TreeMenuContext<T>, trigger?: HTMLElement, event?: Event): Promise<boolean> {
    // The render ctx's own members are not part of the action detail.
    const { containerElement: _c, entries: _e, menuItem: _m, buttonElement: _b, ...menuCtx } =
      ctx as TreeMenuContext<T> & Partial<ContextMenuRenderContext<T> & ContextMenuItemRenderContext<T>>;
    const detail = this.ctx({
      ...menuCtx,
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

  /** Read-only (`isReadonly`): the user can't change the data. */
  private isReadonly(): boolean {
    return !!this.options.isReadonly;
  }

  /** Targets of a built-in menu action: the whole selection when `node` is in it, else just `node`. */
  private actionTargets(node: LTreeNode<T>): string[] {
    const selected = this.engine.getSelectedPaths();
    return selected.has(node.path) ? [...selected] : [node.path];
  }

  /** The built-in menu actions act on the node — or on the whole selection when the node is in it. */
  private async runBuiltInAction(action: string, node: LTreeNode<T>): Promise<void> {
    // Read-only: the menu greys these out; a custom menu activating one changes nothing either.
    if (this.isReadonly() && READONLY_BLOCKED_ACTIONS.has(action)) return;
    const paths = this.actionTargets(node);
    switch (action) {
      case 'copy': this.engine.copyNodes(paths); break;
      case 'cut': this.engine.cutNodes(paths); break;
      case 'paste': this.engine.pasteNodes(node.path); break;
      case 'delete': this.engine.runDeleteCommand(paths); break;
      case 'expand': this.engine.expandNodes(paths); break;
      // Collapses settle after the rows animated out — the action event fires after that.
      case 'collapse': await this.engine.collapseNodes(paths); break;
      case 'expand-subtree': this.engine.expandAll(paths); break;
      case 'collapse-subtree': await this.engine.collapseAll(paths); break;
      case 'expand-all': this.engine.expandAll(null); break;
      case 'collapse-all': await this.engine.collapseAll(null); break;
      case 'sort': this.sortNodes(paths); break;
      case 'sort-subtree': this.sortAll(paths); break;
      case 'sort-all': this.sortAll(null); break;
    }
  }

  // ── Public API (proxy to engine) ────────────────────────────────────

  update(props: Partial<TreeViewConfig<T>>): void {
    // An option set to `undefined` goes back to its default (as `el.x = undefined` does on the element).
    props = withEngineDefaults(props, true);
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

  /**
   * Re-apply every built-in UI string (the page-wide `window.components.locale` changed —
   * `<web-treeview>` calls it from core `localeChanged()`). Re-renders texts only; expansion,
   * selection, checks, focus and scroll are kept.
   */
  refreshLabels(): void {
    this.engine.updateProps({ displayValueFallback: this.labels.text('labels.noDisplayValue') });
    this.renderer.updateConfig({ labels: this.labels });
  }

  expandNodes(paths: string | string[], options?: ExpandOptions): void {
    this.engine.expandNodes(paths, options);
  }

  /** Settles after the collapse applied — after the rows animated out (motion). */
  collapseNodes(paths: string | string[], options?: ExpandOptions): Promise<void> {
    return this.engine.collapseNodes(paths, options);
  }

  /** Toggle the expand state of a node as if the user had clicked its toggle
   *  icon. Honors `shouldExpandAsAccordion`. */
  toggleNodeExpanded(path: string, options?: ExpandOptions): void {
    this.engine.toggleNodeExpanded(path, options);
  }

  sortNodes(paths: string | string[], options?: SortOptions<T>): void {
    this.announceReorders(this.engine.sortNodes(paths, options), options);
  }

  sortAll(paths?: string | string[] | null, options?: SortOptions<T>): void {
    this.announceReorders(this.engine.sortAll(paths, options), options);
  }

  /** `nodes-reorder` — one per parent whose `orderMember` values the sort rewrote. */
  private announceReorders(reorders: NodesReorderContext<T>[], options?: SortOptions<T>): void {
    if (options?.isSilent) return;
    for (const r of reorders) this.options.onNodesReorder?.(this.ctx({ ...r }));
  }

  expandAll(paths?: string | string[] | null, options?: ExpandOptions): void {
    this.engine.expandAll(paths, options);
  }

  /** Settles after the collapse applied — after the rows animated out (motion). */
  collapseAll(paths?: string | string[] | null, options?: ExpandOptions): Promise<void> {
    return this.engine.collapseAll(paths, options);
  }

  filterNodes(term: string, searchOptions?: SearchOptions): void {
    this.engine.filterNodes(term, searchOptions);
  }

  searchNodes(term: string | null, searchOptions?: SearchOptions): LTreeNode<T>[] {
    if (!term) return [];
    return this.engine.searchNodes(term, searchOptions);
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

  /** Re-render the node at `path` after its data object was changed in place. */
  refreshNode(path: string): void {
    this.engine.refreshNode(path);
  }

  /** Re-sort the children of `parentPath` (`''` = the roots) by the tree's rule and re-render. */
  refreshSiblings(parentPath: string): void {
    this.engine.refreshSiblings(parentPath);
  }

  /** Whether the node at `path` accepts drops (`getIsDropAllowedCallback` → `isDropAllowedMember`). */
  isNodeDropAllowed(path: string): boolean {
    return this.engine.isNodeDropAllowed(path);
  }

  /** True while a progressive render is in flight. */
  get isRendering(): boolean {
    return this.engine.isRendering;
  }

  /** The tree container's last measured size; `null` before the first measure. */
  get containerSize(): ContainerSize | null {
    return this.lastContainerSize ? { ...this.lastContainerSize } : null;
  }

  /** The Shift-range anchor; writable, `null` = none. */
  get selectionAnchor(): string | null {
    return this.engine.selectionAnchor;
  }

  set selectionAnchor(path: string | null) {
    this.engine.selectionAnchor = path;
  }

  /** Toggle the focused node in / out of the selection (Ctrl+click semantics; multiple mode). */
  toggleFocusedSelect(): void {
    this.engine.toggleFocusedSelect();
  }

  /** The tree's `TreeViewState` (the headless state the renderer mounts on) — for renderer authors / advanced use. */
  getState(): TreeViewState<T> {
    return this.engine;
  }

  /** Result of the most recent data insert. */
  get insertResult() {
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

  /** The focused node (the single cursor) — move it with `focusNode(path)` / `clearFocus()`. */
  get focusedNode(): LTreeNode<T> | null {
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

  insertNode(targetPath: string, nodeData: T, position: DropPosition) {
    return this.engine.insertNode(targetPath, nodeData, position);
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

  addBranch(parentPath: string, data: T[]): InsertBranchResult<T> {
    return this.engine.addBranch(parentPath, data);
  }

  insertBranch(targetPath: string, data: T[], position: DropPosition): InsertBranchResult<T> {
    return this.engine.insertBranch(targetPath, data, position);
  }

  replaceBranch(parentPath: string, data: T[]): ReplaceBranchResult<T> {
    return this.engine.replaceBranch(parentPath, data);
  }

  removeBranch(path: string, keepParent?: boolean): RemoveBranchResult<T> {
    return this.engine.removeBranch(path, keepParent);
  }

  /** The expanded set; assigning replaces it (branches not listed collapse) silently — no
   *  `expanded-change` (use `expandNodes` / `collapseNodes` for an announced change). */
  get expandedPaths(): string[] {
    return this.engine.getExpandedPaths();
  }

  set expandedPaths(paths: Iterable<string>) {
    this.engine.setExpandedPaths([...paths], { isSilent: true });
  }

  /** The node objects: assigning replaces the tree (input); reading returns every node's
   *  data in tree order — the current state, mutations included. */
  get nodes(): T[] {
    return this.engine.getAllData();
  }

  set nodes(nodes: T[]) {
    this.update({ nodes });
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

  selectAll(options?: TreeMutationOptions): void {
    this.engine.selectAll(options);
  }

  clearSelection(paths?: string[], options?: TreeMutationOptions): void {
    this.engine.clearSelection(paths, options);
  }

  getSelectedNodes(): LTreeNode<T>[] {
    return this.engine.getSelectedNodes();
  }

  /** The selected set (snapshot); assigning replaces it silently — no `selection-change` /
   *  `checked-change` / `focus-change` (use `selectNodes` / `clearSelection` to announce). */
  get selectedPaths(): string[] {
    return [...this.engine.getSelectedPaths()];
  }

  set selectedPaths(paths: Iterable<string>) {
    this.engine.setSelectedPaths([...paths], { isSilent: true });
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

  checkAll(options?: TreeMutationOptions): void {
    this.engine.checkAll(options);
  }

  uncheckNode(path: string, options?: TreeMutationOptions): void {
    this.engine.uncheckNode(path, options);
  }

  uncheckNodes(paths: string[], options?: TreeMutationOptions): void {
    this.engine.uncheckNodes(paths, options);
  }

  uncheckAll(options?: TreeMutationOptions): void {
    this.engine.uncheckAll(options);
  }

  getCheckedNodes(): LTreeNode<T>[] {
    return this.engine.getCheckedNodes();
  }

  /** The checked set as emitted (projected through `cascadeCheckPolicy`); assigning replaces it
   *  silently — no `checked-change` (use `checkNodes` / `uncheckAll` to announce). */
  get checkedPaths(): string[] {
    return [...this.engine.getCheckedPaths()];
  }

  set checkedPaths(paths: Iterable<string>) {
    this.engine.setCheckedPaths([...paths], { isSilent: true });
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

  removeNodes(paths: string[]): { removed: number; failed: number } {
    return this.engine.removeNodes(paths);
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

  /** The effective disabled state (the element merges its `isDisabled` input with a disabled
   *  `<fieldset>`): no user interaction, out of the tab order. Programmatic calls still work. */
  setDisabled(isDisabled: boolean): void {
    this.options.isDisabled = isDisabled;
    this.renderer.updateConfig({ isDisabled });
  }

  /** `highlight-on-page-drag` armed state — an armed empty tree shows its drop zone. */
  setArmed(isArmed: boolean): void {
    this.engine.setArmed(isArmed);
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

  private mapToEngineConfig(options: Partial<TreeViewConfig<T>>): TreeViewStateConfig<T> {
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
      isSortingEnabled: o.isSortingEnabled,
      displayValueMember: o.displayValueMember,
      getDisplayValueCallback: this.nodeCallback(o.getDisplayValueCallback),
      // labels['labels.noDisplayValue'] → the Ltree's display fallback (the engine repaints only when it changed).
      displayValueFallback: this.labels.text('labels.noDisplayValue'),
      searchValueMember: o.searchValueMember,
      getSearchValueCallback: this.nodeCallback(o.getSearchValueCallback),
      orderMember: o.orderMember,
      treeId: o.treeId,
      treePathSeparator: o.treePathSeparator,
      sortCallback: this.wrap(o.sortCallback, 'sort', (f) => (nodes: LTreeNode<T>[]) => f(this.ctx({ nodes }))),

      data: o.nodes || [],
      focusedNode: o.focusedNode,
      selectedPaths: o.selectedPaths,
      checkedPaths: o.checkedPaths,

      expandLevel: o.expandLevel,
      shouldExpandAsAccordion: o.shouldExpandAsAccordion,
      clickBehavior: o.clickBehavior,
      searchTerm: o.searchTerm,
      shouldUseInternalSearchIndex: o.shouldUseInternalSearchIndex,
      initializeIndexCallback: o.initializeIndexCallback,
      indexerBatchSize: o.indexerBatchSize,
      indexerTimeout: o.indexerTimeout,
      searchResultLimit: o.searchResultLimit,
      filterScope: o.filterScope,
      filterDescendantDepth: o.filterDescendantDepth,
      shouldExpandFilterDescendants: o.shouldExpandFilterDescendants,
      onIndexProgress: this.wrap(o.onIndexProgress, 'indexProgress', (f) => (p: IndexProgress) =>
        f(this.ctx({ processed: p.processed, total: p.total, isComplete: p.isComplete }))),
      // Always bridged (stable identity): the bridge announces, then calls the current hook.
      onSearchStatusChange: this.searchStatusBridge,
      isLoading: o.isLoading ?? false,

      isProgressiveRenderEnabled: o.isProgressiveRenderEnabled ?? true,
      rowAnimationLimit: o.rowAnimationLimit ?? undefined,
      initialBatchSize: o.initialBatchSize,
      maxBatchSize: o.maxBatchSize,
      isFlatRenderingEnabled: o.isFlatRenderingEnabled ?? true,
      flatIndentSize: typeof o.flatIndentSize === 'number' ? `${o.flatIndentSize}px` : o.flatIndentSize,

      isVirtualScrollEnabled: o.isVirtualScrollEnabled ?? false,
      virtualScrollItemHeight: o.virtualScrollItemHeight ?? undefined,
      virtualScrollOverscan: o.virtualScrollOverscan ?? undefined,
      virtualScrollContainerHeight: typeof o.virtualScrollContainerHeight === 'number' ? `${o.virtualScrollContainerHeight}px` : o.virtualScrollContainerHeight,

      dragDropMode: o.dragDropMode,
      dropZoneMode: o.dropZoneMode,
      dropZoneLayout: o.dropZoneLayout,
      dropZoneStart: o.dropZoneStart,
      dropZoneMaxWidth: typeof o.dropZoneMaxWidth === 'number' ? `${o.dropZoneMaxWidth}px` : o.dropZoneMaxWidth,
      isCopyAllowed: o.isCopyAllowed,
      shouldAutoHandleCopy: o.shouldAutoHandleCopy,
      shouldAutoHandleMove: o.shouldAutoHandleMove,
      shouldAutoHandlePaste: o.shouldAutoHandlePaste,
      shouldHandleKeyboardShortcuts: o.shouldHandleKeyboardShortcuts,
      isReadonly: o.isReadonly,
      touchDragDelay: o.touchDragDelay,
      shouldIndicateUndraggable: o.shouldIndicateUndraggable,
      isTreeDropZoneEnabled: o.isTreeDropZoneEnabled,

      onRenderStart: this.wrap(o.onRenderStart, 'renderStart', (f) => () => f(this.ctx({}))),
      onRenderProgress: this.wrap(o.onRenderProgress, 'renderStats', (f) => (stats: RenderStats) =>
        f(this.ctx({ pending: stats.pending, processed: stats.processed }))),
      onRenderComplete: this.wrap(o.onRenderComplete, 'renderStats', (f) => (stats: RenderStats) =>
        f(this.ctx({ pending: stats.pending, processed: stats.processed }))),

      onNodeClick: this.event(o.onNodeClick),
      onNodeDoubleClick: this.event(o.onNodeDoubleClick),
      onNodeExpand: this.event(o.onNodeExpand),
      onNodeCollapse: this.event(o.onNodeCollapse),
      // Expand gate: core runBeforeCallbackEager keeps a sync hook synchronous; an async
      // one yields a Promise. A throw / rejection is reported by core through the
      // element's logger (error) and cancels — the node stays collapsed.
      beforeExpandCallback: this.wrap(o.beforeExpandCallback, 'expand', (f) => (engineCtx: object) => {
        const result = runBeforeCallbackEager(f as (c: unknown) => unknown, this.ctx(engineCtx), 'beforeExpandCallback');
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
      onNodeDrop: this.nodeDropBridge,
      onNodeDragDenied: this.event(o.onNodeDragReject),
      onNodeDropDenied: this.nodeDropDeniedBridge,
      // Keydown: the public hook vetoes with `false`; the engine's internal one suppresses with `true`.
      onTreeKeydown: this.wrap(o.beforeKeydownCallback, 'keydown', (f) => (engineCtx: object) =>
        runBeforeCallbackSync(f, this.ctx(engineCtx), 'beforeKeydownCallback').isRejected ? true : undefined),
      // Scroll gate: `false` skips the scroll, an object replaces the defaults (merged by the engine).
      beforeScrollCallback: this.syncGate(o.beforeScrollCallback, 'beforeScrollCallback'),
      contextMenuCallback: this.wrap(o.getContextMenuItemsCallback, 'menu', (f) => (node: LTreeNode<T>) => f(this.menuCtx(node)) ?? []),
      hasContextMenuRenderer: !!(o.getContextMenuItemsCallback || o.renderContextMenuCallback),

      bodyClass: o.bodyClass,
      selectedNodeClass: o.selectedNodeClass,
      focusedNodeClass: o.focusedNodeClass,
      checkedNodeClass: o.checkedNodeClass,
      dragOverNodeClass: o.dragOverNodeClass,
      draggedNodeClass: o.draggedNodeClass,
      isNodeTooltipsShown: o.isNodeTooltipsShown,
      getNodeTooltipCallback: this.nodeCallback(o.getNodeTooltipCallback),
      tooltipPlacement: o.tooltipPlacement ?? undefined,
      tooltipDelay: o.tooltipDelay ?? undefined,
      tooltipOffset: o.tooltipOffset ?? undefined,
      shouldTooltipFollowCursor: o.shouldTooltipFollowCursor ?? undefined,
      iconSet: o.iconSet,
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
      isCheckboxesShown: o.isCheckboxesShown,
      checkboxMode: o.checkboxMode,
      cascadeCheckPolicy: o.cascadeCheckPolicy,
      shouldClickToggleCheckbox: o.shouldClickToggleCheckbox,
      beforeCheckboxToggleCallback: this.wrap(o.beforeCheckboxToggleCallback, 'checkbox', (f) =>
        (node: LTreeNode<T>, isChecked: boolean, affectedPaths: string[]) =>
          internalGate(runBeforeCallbackSync(f, this.ctx({ node, isChecked, affectedPaths }), 'beforeCheckboxToggleCallback'))),
      onCheckedChange: this.event(o.onCheckedChange),
      onSelectionChange: this.event(o.onSelectionChange),
    } as unknown as TreeViewStateConfig<T>;
  }

  private mapToRendererConfig(options: Partial<TreeViewConfig<T>>): RendererConfig<T> {
    const o = options;
    const region = (src: ((ctx: any) => SlotResult) | null | undefined) =>
      this.wrap(src, 'region', (f) => () => f(this.ctx({})));
    const cfg: RendererConfig<T> = {
      renderNodeCallback: this.wrap(o.renderNodeCallback, 'renderNode', (f) =>
        (node: LTreeNode<T>, rc: NodeRenderContext) => f(this.ctx({ ...rc, node }))),
      renderIconCallback: o.renderIconCallback,
      renderNodeIcon: this.nodeIconHtml,
      renderEmptyStateCallback: region(o.renderEmptyStateCallback),
      labels: this.labels,
      renderEmptyZoneCallback: region(o.renderEmptyZoneCallback),
      isEmptyDropPlaceholderShown: o.isEmptyDropPlaceholderShown,
      renderLoadingCallback: this.loaderDrawer(o.renderLoadingCallback),
      renderHeaderCallback: region(o.renderHeaderCallback),
      renderFooterCallback: region(o.renderFooterCallback),
      renderContextMenuCallback: this.wrap(o.renderContextMenuCallback, 'renderMenu', (f) =>
        (node: LTreeNode<T>, _close: () => void, containerElement: HTMLElement) => {
          // The resolved top level of getContextMenuItemsCallback — what the built-in menu would show.
          const ctx = this.menuCtx(node);
          const entries = resolveMenuEntries<TreeMenuContext<T>, TreeViewAction>(
            this.options.getContextMenuItemsCallback?.(ctx) ?? [], ctx, (item) => this.menuItemDefaults(item, ctx));
          f(Object.assign(ctx, { containerElement, entries }));
        }),
      renderContextMenuItemCallback: this.wrap(o.renderContextMenuItemCallback, 'renderMenuItem', (f) =>
        (menuItem: TreeMenuItem<T>, node: LTreeNode<T>, buttonElement: HTMLElement) =>
          f(Object.assign(this.menuCtx(node), { menuItem, buttonElement }))),
      contextMenuContext: (node) => this.menuCtx(node),
      contextMenuItemDefaults: (item, ctx) => this.menuItemDefaults(item, ctx),
      activateContextMenuItem: (item, ctx, trigger, event) => this.activateMenuItem(item, ctx, trigger, event),
      // Read at every open: <web-treeview> supplies its live effective config; standalone = these options.
      menuPresentationOptions: () => this.options.getMenuPresentationOptions?.() ?? menuPresentationOptions(this.options),
      openLayer: o.openLayer,
      onContainerResize: (size, deviceClass) => {
        this.lastContainerSize = { width: size.width, height: size.height };
        this.options.onContainerResize?.(this.ctx({ size: { width: size.width, height: size.height }, deviceClass }));
      },
    };
    if ('nodeTitleOverflow' in options) cfg.nodeTitleOverflow = options.nodeTitleOverflow ?? null;
    if ('isDisabled' in options) cfg.isDisabled = !!options.isDisabled;
    if ('isReadonly' in options) cfg.isReadonly = !!options.isReadonly;
    return cfg;
  }
}
