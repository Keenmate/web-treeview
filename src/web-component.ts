/**
 * `<web-treeview>` — the custom element, now built on
 * `@keenmate/web-components-core` (`BlissElement`).
 *
 * All the custom-element plumbing that used to live here by hand — the
 * `ATTRIBUTE_TABLE`, `JS_CALLBACK_FIELDS`, `observedAttributes`,
 * `attributeChangedCallback`, `readAttrValue`, the `_scheduleUpdate` microtask
 * batcher, and the ~100 property/callback getters/setters — is now declared ONCE
 * as a core input table (`static inputs`) plus an event table (`static events`).
 * Core owns parsing, validation, reactivity coalescing, and reflection. This file
 * keeps only what is genuinely treeview-specific: the bridge from the merged
 * `config` to the tree (`TreeViewEngine` in `treeview.ts`, which adapts the public
 * single-ctx callbacks to the headless `TreeViewState`), the public `el.controller`
 * facade and the event bridges. Custom CSS goes through core's `createCustomStyles()`.
 *
 * Reactivity model: the tree (`TreeViewEngine` → engine + renderer) applies every
 * config change in place via `setOptions()`; it is built once (first connect) and
 * kept across a DOM move — disconnect()/connect() only deactivate/activate its
 * live resources, so all runtime state survives (D1). Every input is `on:'update'`:
 * `update()` sends the full config to `setOptions()`, and TreeViewEngine memoizes its callback
 * adapters, so re-sending an unchanged callback costs nothing.
 */
import type { TreeLoggers } from './logger';
import {
  BlissElement,
  adoptStyles,
  createCustomStyles,
  type CustomStylesOptions,
  applyArmedState,
  keepScrollAcrossMove,
  type CustomStylesHandle,
  type EventDef,
} from '@keenmate/web-components-core';
import { menuPresentationOptions } from '@keenmate/web-components-core/menu';
import { INPUTS, STATE_KEYS, UNSET_PATHS, liveReaders } from './inputs';
import { createLayer, type Layer, type LayerOptions } from '@keenmate/web-components-core/positioning';
import { TreeViewEngine, createTreeViewController } from './treeview';
import type { TreeViewConfig, TreeViewElementConfig, ScrollToPathOptions } from './types';
import type { LTreeNode, DropPosition } from './ltree/ltree-node';
import type { Ltree, ExpandOptions, SortOptions, TreeChange, ProcessChangesResult, InsertBranchResult, ReplaceBranchResult, RemoveBranchResult, RemoveBranchOptions } from './ltree/types';
import type { TreeViewRenderer } from './renderer/types';
import type { SelectMode, TreeMutationOptions, NodeRef } from './controller/types';
import { watchNodeDrag, type PasteResult } from './clipboard';
import type {
  TreeViewController,
  TreeViewContext,
  TreeMenuContext,
  TreeMenuItem,
  NodeTransformCallback,
  NodeEventDetail,
  NodeDragEventDetail,
  NodeDropEventDetail,
  NodeCopyEventDetail,
  NodeCutEventDetail,
  NodeDeleteEventDetail,
  NodePasteEventDetail,
  SelectionChangeEventDetail,
  CheckedChangeEventDetail,
  FocusChangeEventDetail,
  ExpandedChangeEventDetail,
  NodesSortEventDetail,
  TreeEventDetail,
  TreeViewActionEventDetail,
  RenderStartEventDetail,
  RenderStatsEventDetail,
  ContainerResizeEventDetail,
  IndexProgressEventDetail,
  SearchStatusEventDetail,
} from './interaction';
import type { ContainerSize } from './renderer/types';
import type { SearchOptions } from 'flexsearch';
import styles from './css/main.css?inline';

// The input table (`INPUTS`) lives in ./inputs — the public TreeViewEngine reads its defaults too (C-CA-37).

// ── Outward DOM events (core §12.5) ──────────────────────────────────────────
// Each installs a camelCase `on<Name>` twin that core calls with the detail (not
// the CustomEvent) right before dispatching. Every detail carries `controller` /
// `element` (non-enumerable).
type TreeViewEvents = {
  'node-click': NodeEventDetail;
  'node-double-click': NodeEventDetail;
  'node-expand': NodeEventDetail;
  'node-collapse': NodeEventDetail;
  'node-copy': NodeCopyEventDetail;
  'node-cut': NodeCutEventDetail;
  'node-paste': NodePasteEventDetail;
  'node-delete': NodeDeleteEventDetail;
  'node-drag-start': NodeDragEventDetail;
  'node-drag-over': NodeDragEventDetail;
  'node-drop': NodeDropEventDetail;
  'node-drag-reject': NodeEventDetail;
  'node-drop-reject': NodeEventDetail;
  'selection-change': SelectionChangeEventDetail;
  'checked-change': CheckedChangeEventDetail;
  'focus-change': FocusChangeEventDetail;
  'expanded-change': ExpandedChangeEventDetail;
  'nodes-sort': NodesSortEventDetail;
  'nodes-change': TreeEventDetail;
  'action': TreeViewActionEventDetail;
  'render-start': RenderStartEventDetail;
  'render-progress': RenderStatsEventDetail;
  'render-complete': RenderStatsEventDetail;
  'container-resize': ContainerResizeEventDetail;
  'index-progress': IndexProgressEventDetail;
  'search-status-change': SearchStatusEventDetail;
};
const EVENTS: readonly EventDef[] = [
  { name: 'node-click', description: 'A node was clicked (a checkbox toggle is not a click — see `checked-change`). `detail`: the node with `path`, `parent`, `siblings`. Twin: `onNodeClick(detail)`.' },
  { name: 'node-double-click', description: 'A node was double-clicked. `detail`: the node context. Twin: `onNodeDoubleClick(detail)`.' },
  { name: 'node-expand', description: 'A node expanded (toggle, keyboard, `expandNodes`, after any `beforeExpandCallback` load; NOT `expandAll` / expand-level seeding — those only fire `expanded-change`). `detail`: the node context. Twin: `onNodeExpand(detail)`.' },
  { name: 'node-collapse', description: 'A node collapsed (toggle, keyboard, `collapseNodes`, an accordion sibling; NOT `collapseAll`). `detail`: the node context. Twin: `onNodeCollapse(detail)`.' },
  { name: 'node-copy', description: 'Nodes were copied. `detail`: `{ operation, paths, nodes }`. Twin: `onNodeCopy(detail)`.' },
  { name: 'node-cut', description: 'Nodes were cut. `detail`: `{ operation, paths, nodes }`. Twin: `onNodeCut(detail)`.' },
  { name: 'node-paste', description: 'A paste ran (not fired when `beforePasteCallback` blocked it). `detail`: the PasteResult (`success`, `count`, `skipped`, `error?`, `entries?`, …). Twin: `onNodePaste(detail)`.' },
  { name: 'node-delete', description: 'Nodes were deleted. `detail`: `{ paths, nodes }` (pre-removal snapshots). Twin: `onNodeDelete(detail)`.' },
  { name: 'node-drag-start', description: 'A node drag started. `detail`: the drag context (`event`, `dragged`). Twin: `onNodeDragStart(detail)`.' },
  { name: 'node-drag-over', description: 'A node was dragged over. `detail`: the drag context. Twin: `onNodeDragOver(detail)`.' },
  { name: 'node-drop', description: 'A drop completed. `detail`: `{ source, target, dragged, dropped, position, operation, event }`. Twin: `onNodeDrop(detail)`.' },
  { name: 'node-drag-reject', description: 'A locked node was long-pressed / an undraggable drag was attempted. `detail`: the node context. Twin: `onNodeDragReject(detail)`.' },
  { name: 'node-drop-reject', description: 'A drop was rejected by the target. `detail`: the node context. Twin: `onNodeDropReject(detail)`.' },
  { name: 'selection-change', description: 'The selected set changed. `detail`: `{ paths, nodes }`. Twin: `onSelectionChange(detail)`.' },
  { name: 'checked-change', description: 'The checked (checkbox) set changed. `detail`: `{ paths, nodes }`. Twin: `onCheckedChange(detail)`.' },
  { name: 'focus-change', description: 'The focused node changed. `detail`: `{ focusedNode }`. Twin: `onFocusChange(detail)`.' },
  { name: 'expanded-change', description: 'The expanded set changed (toggle, keyboard, expandNodes / collapseNodes, expandAll / collapseAll, accordion, data changes) — one event per change: synchronously right after an expand / collapse (after its `node-expand` / `node-collapse`), on the next microtask after a data change. `detail`: `{ paths }` = the whole new set (same as `expandedPaths`). Not fired for `{ isSilent: true }` operations nor for assigning `expandedPaths`. Twin: `onExpandedChange(detail)`.' },
  { name: 'nodes-sort', description: 'A sort (`sortNodes` / `sortAll` / the `sort*` menu items) with a `compareCallback` or `direction: "desc"` rewrote the `orderMember` values (10, 20, 30…) of the children of one parent — one event per parent; never without `orderMember`. `detail`: `{ parentPath, nodes, changes: [{ path, oldOrder, newOrder }] }`. Twin: `onNodesSort(detail)`.' },
  { name: 'nodes-change', description: 'The data / structure changed — add / insert / update / move / remove, `processChanges`, add / insert / replace / removeBranch, paste, drop, duplicate, sort. One event per change (a compound op such as a multi-node drop fires once), on the microtask after it. Not for expand / select / check / focus nor for loading `nodes`; read the new state from `controller.nodes`. `detail`: the context only. Twin: `onNodesChange(detail)`.' },
  { name: 'action', description: 'A context-menu item was activated. `detail`: `action` (built-in name or `custom`), `id`, `item`, `source: "context-menu"`, `node` / `path` / `parent` / `siblings`, `sourceEvent`, `triggerElement`. Fires after the item’s `onClick`, before the built-in. Twin: `onAction(detail)`.' },
  { name: 'render-start', description: 'A progressive render began (`isRendering` turns true). `detail`: the context only. Twin: `onRenderStart(detail)`.' },
  { name: 'render-progress', description: 'A progressive-render batch finished. `detail`: `{ pending, processed }`. Twin: `onRenderProgress(detail)`.' },
  { name: 'render-complete', description: 'The progressive render finished (`isRendering` turns false). `detail`: `{ pending, processed }`. Twin: `onRenderComplete(detail)`.' },
  { name: 'index-progress', description: 'The async search index filled another batch, and once more with `isComplete: true` at the end — search / filter results are partial until then. `detail`: `{ processed, total, isComplete }`. Twin: `onIndexProgress(detail)`.' },
  { name: 'search-status-change', description: 'A filter was applied or cleared (also the automatic re-filter when indexing completes). `detail`: `{ searchTerm, matchCount, isLimited, limit, isIndexing }` — `isLimited` = more matched than `max-search-result-count` and the rest were cut off. Twin: `onSearchStatusChange(detail)`.' },
  { name: 'container-resize', description: 'The tree container was resized (also once when the tree starts observing). `detail`: `{ size: { width, height }, deviceClass }` — `size` is also `el.containerSize`. Twin: `onContainerResize(detail)`.' },
];

/** configKey the engine does NOT own — injected/handled by this element. `isDisabled` is sent as
 *  the EFFECTIVE state by #assembleConfig and flipped in place by disabledChanged() (SPEC §6.4). */
const NON_ENGINE_KEYS = new Set<string>(['customStyles', 'getCustomStylesCallback', 'shouldHighlightOnPageDrag', 'isDisabled', 'menuPresentation', 'menuSide', ...STATE_KEYS]);

export class WebTreeViewElement<T = any> extends BlissElement<TreeViewEvents, TreeViewController<T>> {
  protected static override inputs = INPUTS;
  protected static override events = EVENTS;

  static {
    liveReaders.nodes = (el) => (el instanceof WebTreeViewElement ? el.#treeview?.nodes : undefined);
    liveReaders.state = (el, key) => (el instanceof WebTreeViewElement ? el.#treeview?.[key] : undefined);
  }

  // Type-only: core installs the `on<Name>` twins at runtime (§12.5); each is
  // called with the event detail (not the CustomEvent), right before the event.
  declare onNodeClick: ((detail: NodeEventDetail<T>) => void) | null;
  declare onNodeDoubleClick: ((detail: NodeEventDetail<T>) => void) | null;
  declare onNodeExpand: ((detail: NodeEventDetail<T>) => void) | null;
  declare onNodeCollapse: ((detail: NodeEventDetail<T>) => void) | null;
  declare onNodeCopy: ((detail: NodeCopyEventDetail<T>) => void) | null;
  declare onNodeCut: ((detail: NodeCutEventDetail<T>) => void) | null;
  declare onNodePaste: ((detail: NodePasteEventDetail<T>) => void) | null;
  declare onNodeDelete: ((detail: NodeDeleteEventDetail<T>) => void) | null;
  declare onNodeDragStart: ((detail: NodeDragEventDetail<T>) => void) | null;
  declare onNodeDragOver: ((detail: NodeDragEventDetail<T>) => void) | null;
  declare onNodeDrop: ((detail: NodeDropEventDetail<T>) => void) | null;
  declare onNodeDragReject: ((detail: NodeEventDetail<T>) => void) | null;
  declare onNodeDropReject: ((detail: NodeEventDetail<T>) => void) | null;
  declare onSelectionChange: ((detail: SelectionChangeEventDetail<T>) => void) | null;
  declare onCheckedChange: ((detail: CheckedChangeEventDetail<T>) => void) | null;
  declare onFocusChange: ((detail: FocusChangeEventDetail<T>) => void) | null;
  declare onExpandedChange: ((detail: ExpandedChangeEventDetail<T>) => void) | null;
  declare onNodesSort: ((detail: NodesSortEventDetail<T>) => void) | null;
  declare onNodesChange: ((detail: TreeEventDetail<T>) => void) | null;
  declare onAction: ((detail: TreeViewActionEventDetail<T>) => void) | null;
  declare onRenderStart: ((detail: RenderStartEventDetail<T>) => void) | null;
  declare onRenderProgress: ((detail: RenderStatsEventDetail<T>) => void) | null;
  declare onRenderComplete: ((detail: RenderStatsEventDetail<T>) => void) | null;
  declare onContainerResize: ((detail: ContainerResizeEventDetail<T>) => void) | null;
  declare onIndexProgress: ((detail: IndexProgressEventDetail<T>) => void) | null;
  declare onSearchStatusChange: ((detail: SearchStatusEventDetail<T>) => void) | null;

  /**
   * The tree's notifications → `emit()` (which calls the twin, then dispatches). Built
   * once, so TreeViewEngine's memoized adapters keep their identity across updates.
   */
  readonly #bridges: Partial<TreeViewConfig<T>> = {
    onNodeClick: (d) => this.emit('node-click', d),
    onNodeDoubleClick: (d) => this.emit('node-double-click', d),
    onNodeExpand: (d) => this.emit('node-expand', d),
    onNodeCollapse: (d) => this.emit('node-collapse', d),
    onNodeCopy: (d) => this.emit('node-copy', d),
    onNodeCut: (d) => this.emit('node-cut', d),
    onNodePaste: (d) => this.emit('node-paste', d),
    onNodeDelete: (d) => this.emit('node-delete', d),
    onNodeDragStart: (d) => this.emit('node-drag-start', d),
    onNodeDragOver: (d) => this.emit('node-drag-over', d),
    onNodeDrop: (d) => this.emit('node-drop', d),
    onNodeDragReject: (d) => this.emit('node-drag-reject', d),
    onNodeDropReject: (d) => this.emit('node-drop-reject', d),
    onSelectionChange: (d) => this.emit('selection-change', d),
    onCheckedChange: (d) => this.emit('checked-change', d),
    onFocusChange: (d) => this.emit('focus-change', d),
    onExpandedChange: (d) => this.emit('expanded-change', d),
    onNodesSort: (d) => this.emit('nodes-sort', d),
    onNodesChange: (d) => this.emit('nodes-change', d),
    onAction: (d) => this.emit('action', d),
    onRenderStart: (d) => { this.#isRendering = true; this.emit('render-start', d); },
    onRenderProgress: (d) => this.emit('render-progress', d),
    onRenderComplete: (d) => { this.#isRendering = false; this.emit('render-complete', d); },
    onContainerResize: (d) => this.emit('container-resize', d),
    onIndexProgress: (d) => this.emit('index-progress', d),
    onSearchStatusChange: (d) => this.emit('search-status-change', d),
  };

  #shadow: ShadowRoot;
  #treeview?: TreeViewEngine<T>;
  /** Mirrors render-start / render-complete — also valid while the first build is still constructing the tree. */
  #isRendering = false;
  #container?: HTMLDivElement;
  #renderer?: TreeViewRenderer<T>;

  /** Core custom CSS (SPEC §12.8): the page layer for the tag, then this instance's. */
  #customStyles: CustomStylesHandle | null = null;

  constructor() {
    super();
    this.#shadow = this.attachShadow({ mode: 'open' });

    // §12.8: shell CSS via one shared, cached CSSStyleSheet (per string).
    adoptStyles(this.#shadow, styles);
    // §12.31: the body scroll offset survives a DOM move (the browser resets it on re-insert).
    keepScrollAcrossMove(this, () => [this.#shadow.querySelector<HTMLElement>('.wtv__tree')]);
    // FOUC guard: base.css hides the host until core sets the `ready` attribute
    // (+ `:state(ready)`, `ready` event) after the first build.
  }

  // ── core lifecycle hooks ──────────────────────────────────────────────────

  /** First connect (or an `on:'reinit'` change — there are none): build the engine. */
  protected override reinit(): void {
    if (this.isConnected) this.#rebuildEngine();
  }

  /**
   * A batch of input changes — patch the live engine in place (core hook; protected, C-CA-14:
   * the public batch write is core's `el.setAttributes(props)`).
   *
   * Sends the FULL assembled engine config on every call. This matters:
   * `TreeViewState.setOptions` is a merge, and several derived behaviors (e.g.
   * `expandLevel` auto-expansion when `data` arrives) only fire when the relevant
   * keys are present together. A changed-keys-only partial would drop them.
   * `this.config` already holds every value in `partial`. A batch of element-only keys
   * (NON_ENGINE_KEYS: custom styles, page-drag highlight, the state sets) doesn't reach the engine.
   * A state set (`expandedPaths` / `selectedPaths` / `checkedPaths`) in the batch is assigned on the
   * tree after the engine update, so `el.nodes = d; el.expandedPaths = p` expands paths of `d`.
   */
  protected override update(partial: Record<string, unknown>): void {
    if ('getCustomStylesCallback' in partial || 'customStyles' in partial) this.#customStyles?.refresh();
    if ('shouldHighlightOnPageDrag' in partial || 'dragDropMode' in partial || 'isReadonly' in partial) this.#reconcilePageDrag();
    if (!this.#treeview) return;
    const keys = Object.keys(partial);
    if (!(keys.length > 0 && keys.every((key) => NON_ENGINE_KEYS.has(key)))) this.#treeview.setOptions(this.#assembleConfig());
    for (const key of STATE_KEYS) {
      if (key in partial) this.#treeview[key] = partial[key] === UNSET_PATHS ? [] : (partial[key] as string[]);
    }
  }

  /**
   * Activate (every connect, after any reinit()/update()): re-attach the live
   * resources. The tree is built once (reinit) and survives a DOM move with all
   * its state; build only if it doesn't exist yet.
   */
  protected override connect(): void {
    if (!this.#treeview) this.#buildEngine();
    else this.#treeview.activate();
    this.#reconcilePageDrag();
  }

  /**
   * Deactivate (every disconnect — a DOM move or a removal): stop ONLY the live
   * resources (document listeners, observers, autoUpdate, open popups). The
   * engine + renderer are kept, so expansion, selection, checks, focus, search
   * and the scroll offset survive a move (D1).
   */
  protected override disconnect(): void {
    this.#treeview?.deactivate();
    this.#reconcilePageDrag();
  }

  /** The page-wide `window.components.locale` changed (core `/locale`): re-apply every built-in
   *  label on the live tree — texts only, all tree state kept. */
  protected override localeChanged(): void {
    this.#treeview?.refreshLabels();
  }

  /** The page-wide `window.components.renderIconCallback` changed (core SPEC §12.33): repaint the
   *  node icons in place — expansion, selection, checks, focus and scroll kept. */
  protected override iconsChanged(): void {
    this.#treeview?.refreshIcons();
  }

  /** The effective disabled state flipped on the built tree (core SPEC §6.4): apply it in place. */
  protected override disabledChanged(isDisabled: boolean): void {
    this.#treeview?.setDisabled(isDisabled);
    this.#reconcileArmed();
  }

  // ── armed (highlight-on-page-drag) ───────────────────────────────────────

  /** Unsubscribe from the page-wide node-drag watcher (set while `highlight-on-page-drag` is live). */
  #unsubscribePageDrag?: () => void;
  /** A node drag is in progress on the page (`watchNodeDrag`, only while subscribed). */
  #isNodeDragOverPage = false;
  #isArmed = false;

  /**
   * True while the tree is armed (`highlight-on-page-drag` + a node is dragged over
   * the page + it accepts drops). Mirrors the `armed` attribute / `:state(armed)`.
   */
  get isArmed(): boolean {
    return this.#isArmed;
  }

  /**
   * Join / leave the page-wide node-drag watcher (`watchNodeDrag` — the shared drag set every
   * tree's pointer drag publishes) per `highlight-on-page-drag` and the connection state, then
   * re-derive the armed state.
   */
  #reconcilePageDrag(): void {
    const shouldTrack = this.isConnected && !!(this.config as { shouldHighlightOnPageDrag?: boolean }).shouldHighlightOnPageDrag;
    if (shouldTrack && !this.#unsubscribePageDrag) {
      this.#unsubscribePageDrag = watchNodeDrag((isActive) => {
        this.#isNodeDragOverPage = isActive;
        this.#reconcileArmed();
      });
    } else if (!shouldTrack && this.#unsubscribePageDrag) {
      this.#unsubscribePageDrag();
      this.#unsubscribePageDrag = undefined;
      this.#isNodeDragOverPage = false;
    }
    this.#reconcileArmed();
  }

  /** Armed = tracking + a node drag over the page + the tree accepts drops. */
  #reconcileArmed(): void {
    const isArmed = !!this.#unsubscribePageDrag
      && this.#isNodeDragOverPage
      && (this.config as { dragDropMode?: string | null }).dragDropMode !== 'none'
      && !this.isEffectivelyDisabled
      && !(this.config as { isReadonly?: boolean }).isReadonly;
    if (isArmed === this.#isArmed) return;
    this.#isArmed = isArmed;
    applyArmedState(this, this.internals, isArmed);
    this.#treeview?.setArmed(isArmed);
  }

  /**
   * Final teardown (core `destroy()`): release what `disconnect()` keeps — the
   * engine, renderer, search index and clipboard registration.
   */
  protected override destroyCallback(): void {
    this.#treeview?.destroy();
    this.#treeview = undefined;
    this.#customStyles?.destroy();
    this.#customStyles = null;
  }

  // ── engine lifecycle ──────────────────────────────────────────────────────

  #rebuildEngine(): void {
    this.#treeview?.destroy();
    this.#treeview = undefined;
    this.#buildEngine();
  }

  #buildEngine(): void {
    this.#ensureContainer();
    const config = this.#assembleConfig();
    this.log.INIT.debug('build engine', {
      idMember: config.idMember,
      pathMember: config.pathMember,
      displayValueMember: config.displayValueMember,
      dataLength: (config.nodes as unknown[] | undefined)?.length ?? 0,
    });

    this.#isRendering = false;
    this.#treeview = new TreeViewEngine<T>(this.#container!, config, this.#renderer, this.#treeLoggers());
    this.#reconcileCustomStyles();
    // State sets assigned before the build (property or attribute); a set never assigned leaves the tree's own.
    for (const key of STATE_KEYS) {
      const paths = this.config[key];
      if (paths !== UNSET_PATHS) this.#treeview[key] = paths as string[];
    }
  }

  /** The element's instance loggers for the engine / LTree / renderer, resolved
   *  per access: `this.log` changes when the tag's logging bundle is registered
   *  after the element was built (it is the CORE fallback before that). */
  #treeLoggers(): TreeLoggers {
    const out = {} as TreeLoggers;
    for (const category of ['INIT', 'DATA', 'INDEX', 'UI', 'DRAG', 'RENDER'] as const) {
      Object.defineProperty(out, category, { get: () => this.log[category] ?? this.log.INIT, enumerable: true });
    }
    return out;
  }

  #ensureContainer(): void {
    if (this.#container) return;
    const container = document.createElement('div');
    this.#shadow.appendChild(container);
    this.#container = container;
  }

  /**
   * Build the tree config from the merged `this.config`: drop element-only
   * keys (NON_ENGINE_KEYS) via core's `engineConfig`, which **preserves `null`**
   * as the clear signal (SPEC §6.1 — the engine resolves it per field), then
   * add the event bridges and the context (this element + its rebuild-proof
   * controller, so every ctx / detail carries them).
   */
  #assembleConfig(): Partial<TreeViewConfig<T>> {
    const cfg = this.engineConfig(NON_ENGINE_KEYS) as Partial<TreeViewConfig<T>>;
    Object.assign(cfg, this.#bridges);
    // The effective disabled state: the `disabled` input (or a disabled <fieldset>, were it form-associated).
    cfg.isDisabled = this.isEffectivelyDisabled;
    cfg.hostElement = this;
    cfg.controller = this.controller;
    // menu-presentation / menu-side are on:'none' (read at open): hand the tree a live reader of the effective config.
    cfg.getMenuPresentationOptions = () => menuPresentationOptions(this.config);
    cfg.openLayer = this.#openLayer;
    return cfg;
  }

  /**
   * The drop pads' / touch ghost's core layer (SPEC §12.29), with this element's custom CSS adopted into
   * the layer root too — a second `createCustomStyles` on it (`shouldShareLayers: false`: it isn't one of
   * the host's managed layers), destroyed with the layer.
   */
  #openLayer = (_host: HTMLElement, options: LayerOptions): Layer => {
    const layer = createLayer(this, options);
    const styles = createCustomStyles<TreeViewContext<T>>(this, layer.layer.shadowRoot!, {
      ...this.#customStylesOptions(),
      shouldShareLayers: false,
    });
    return {
      element: layer.element,
      layer: layer.layer,
      place: (rect) => layer.place(rect),
      syncTheme: () => layer.syncTheme(),
      destroy: () => {
        styles.destroy();
        layer.destroy();
      },
    };
  };

  // ── custom styles (core createCustomStyles, SPEC §12.8) ─────────────────

  /**
   * Write both custom-CSS layers: the page one (`window.components['web-treeview'].customStyles`
   * / `.getCustomStylesCallback`) and this instance's (`getCustomStylesCallback` > `customStyles`),
   * which comes after it and overrides. Core links each `@import` in the document head too, so an
   * imported icon font's `@font-face` registers (Chromium ignores it inside a shadow root).
   */
  #reconcileCustomStyles(): void {
    if (this.#customStyles) return this.#customStyles.refresh();
    this.#customStyles = createCustomStyles<TreeViewContext<T>>(this, this.#shadow, this.#customStylesOptions()); // writes both layers now
  }

  /** The custom-CSS options — the shadow root's and every layer's (drop pads, touch ghost). */
  #customStylesOptions(): CustomStylesOptions<TreeViewContext<T>> {
    return {
      cssClass: 'wtv-custom-styles',
      getContext: () => this.withContext({}) as unknown as TreeViewContext<T>,
      getInstanceStyles: () => ({
        css: this.config.customStyles as string | null | undefined,
        callback: this.config.getCustomStylesCallback as ((ctx: TreeViewContext<T>) => string | null | undefined) | null | undefined,
      }),
    };
  }

  // ── non-input property: renderer (special — swaps live without a rebuild) ──

  get renderer(): TreeViewRenderer<T> | undefined {
    return this.#renderer;
  }

  set renderer(value: TreeViewRenderer<T> | undefined) {
    this.#renderer = value;
    if (this.#treeview && value) this.#treeview.setRenderer(value);
  }

  // ── Public methods (proxy to engine) ───────────────────────────────────────

  /** The live tree after applying pending property writes (`flush()`), so
   *  `el.prop = x; el.method()` sees `x` (core rule; NOTES #13). */
  get #live(): TreeViewEngine<T> | undefined {
    this.flush();
    return this.#treeview;
  }

  expandAll(paths?: string | string[] | null, options?: ExpandOptions): void {
    this.#live?.expandAll(paths, options);
  }

  /** Settles after the collapse applied — after the rows animated out (motion). */
  collapseAll(paths?: string | string[] | null, options?: ExpandOptions): Promise<void> {
    return this.#live?.collapseAll(paths, options) ?? Promise.resolve();
  }

  expandNodes(paths: string | string[], options?: ExpandOptions): void {
    this.#live?.expandNodes(paths, options);
  }

  /** Settles after the collapse applied — after the rows animated out (motion). */
  collapseNodes(paths: string | string[], options?: ExpandOptions): Promise<void> {
    return this.#live?.collapseNodes(paths, options) ?? Promise.resolve();
  }

  /** Filter the visible tree to `term` (empty = clear); `searchOptions` go to FlexSearch. */
  filterNodes(term: string, searchOptions?: SearchOptions): void {
    this.#live?.filterNodes(term, searchOptions);
  }

  /** The nodes matching `term` (no filtering); `searchOptions` go to FlexSearch. */
  searchNodes(term: string | null, searchOptions?: SearchOptions): LTreeNode<T>[] {
    return this.#live?.searchNodes(term, searchOptions) ?? [];
  }

  scrollToPath(path: string, options?: ScrollToPathOptions): Promise<boolean> {
    return this.#live?.scrollToPath(path, options) ?? Promise.resolve(false);
  }

  closeContextMenu(): void {
    this.#live?.closeContextMenu();
  }

  /**
   * Run a menu item exactly like the built-in menu: `beforeActionCallback` (`false` cancels) →
   * item `onClick(detail)` → built-in action → `action` event. For `renderContextMenuCallback`:
   * `ctx.controller.activateMenuItem(entry.item, ctx, button, event)`. Resolves `false` when
   * cancelled; closing the menu is the caller's job.
   */
  activateMenuItem(item: TreeMenuItem<T>, ctx: TreeMenuContext<T>, trigger?: HTMLElement, event?: Event): Promise<boolean> {
    return this.#live?.activateMenuItem(item, ctx, trigger, event) ?? Promise.resolve(false);
  }

  getVisibleFlatNodes(): LTreeNode<T>[] {
    return this.#live?.getVisibleFlatNodes() ?? [];
  }

  getNodeByPath(path: string): LTreeNode<T> | null {
    return this.#live?.getNodeByPath(path) ?? null;
  }

  moveNode(sourcePath: string, targetPath: string, position: DropPosition): any {
    return this.#live?.moveNode(sourcePath, targetPath, position);
  }

  removeNode(path: string): any {
    return this.#live?.removeNode(path);
  }

  addNode(parentPath: string, nodeData: T, pathSegment?: string): any {
    return this.#live?.addNode(parentPath, nodeData, pathSegment);
  }

  /** Insert one node before / after `targetPath` (as its sibling) or as its last child. */
  insertNode(targetPath: string, nodeData: T, position: DropPosition): any {
    return this.#live?.insertNode(targetPath, nodeData, position);
  }

  updateNode(path: string, dataUpdates: Partial<T>): any {
    return this.#live?.updateNode(path, dataUpdates);
  }

  /** Copy one node (+ descendants) under a parent; `transform({ data, node, targetParentPath })` may return null to skip (targetParentPath = where that node lands). */
  duplicateNode(
    sourceNode: LTreeNode<T>,
    targetParentPath: string,
    transform: (ctx: { data: T; node: LTreeNode<T>; targetParentPath: string } & TreeViewContext<T>) => T | null,
    siblingPath?: string,
    position?: 'before' | 'after'
  ): any {
    return this.#live?.duplicateNode(sourceNode, targetParentPath, transform, siblingPath, position);
  }

  moveNodes(paths: string[], targetPath: string, position: DropPosition): any {
    return this.#live?.moveNodes(paths, targetPath, position);
  }

  duplicateNodes(
    paths: string[],
    targetPath: string,
    position: DropPosition,
    transform?: NodeTransformCallback<T>,
    sourceTree?: Ltree<T>
  ): any {
    return this.#live?.duplicateNodes(paths, targetPath, position, transform, sourceTree);
  }

  /** Apply a batch of add / update / remove changes. */
  processChanges(changes: TreeChange<T>[]): ProcessChangesResult {
    return this.#live?.processChanges(changes) ?? { successful: 0, failed: [] };
  }

  /** Access the underlying LTree for advanced programmatic usage. */
  getTree(): Ltree<T> | undefined {
    return this.#live?.getTree();
  }

  getChildren(parentPath: string): LTreeNode<T>[] {
    return this.#live?.getChildren(parentPath) ?? [];
  }

  getSiblings(path: string): LTreeNode<T>[] {
    return this.#live?.getSiblings(path) ?? [];
  }

  /** The node at `path` with its live parent and siblings. */
  getNodeRef(path: string): NodeRef<T> {
    return this.#live?.getNodeRef(path) ?? { path, node: null, parent: null, siblings: [] };
  }

  /** Re-render the node at `path` after its data object was changed in place. */
  refreshNode(path: string): void {
    this.#live?.refreshNode(path);
  }

  /** Re-sort the children of `parentPath` (`''` = the roots) by the tree's rule and re-render. */
  refreshSiblings(parentPath: string): void {
    this.#live?.refreshSiblings(parentPath);
  }

  /** Whether the node at `path` accepts drops (`getIsDropAllowedCallback` → `isDropAllowedMember`); `false` for an unknown path. */
  isNodeDropAllowed(path: string): boolean {
    return this.#live?.isNodeDropAllowed(path) ?? false;
  }

  /** True while a progressive render is in flight (`render-start` … `render-complete`). Read-only. */
  get isRendering(): boolean {
    return this.#isRendering;
  }

  /** The tree container's last measured size (`container-resize`); `null` before the first measure. Read-only. */
  get containerSize(): ContainerSize | null {
    return this.#treeview?.containerSize ?? null;
  }

  /** The focused node (read-only — `focusNode(path)` / `clearFocus()` move it). */
  get focusedNode(): LTreeNode<T> | null {
    return this.#live?.focusedNode ?? null;
  }

  /** Open the context menu for the node at `path` at viewport coordinates. */
  openContextMenu(path: string, x: number, y: number): void {
    this.#live?.openContextMenu(path, x, y);
  }

  // ── Bulk operations ─────────────────────────────────────────────────────────

  addBranch(parentPath: string, data: T[]): InsertBranchResult<T> {
    return this.#live?.addBranch(parentPath, data) ?? { success: false, count: 0, failed: [], parentNode: null, error: 'Not initialized' };
  }

  /** Insert a branch before / after `targetPath` (block order kept) or under it (`'child'`). */
  insertBranch(targetPath: string, data: T[], position: DropPosition): InsertBranchResult<T> {
    return this.#live?.insertBranch(targetPath, data, position) ?? { success: false, count: 0, failed: [], parentNode: null, error: 'Not initialized' };
  }

  replaceBranch(parentPath: string, data: T[]): ReplaceBranchResult<T> {
    return this.#live?.replaceBranch(parentPath, data) ?? { success: false, count: 0, failed: [], parentNode: null, removed: 0, added: 0, error: 'Not initialized' };
  }

  removeBranch(path: string, options?: RemoveBranchOptions): RemoveBranchResult<T> {
    return this.#live?.removeBranch(path, options) ?? { success: false, count: 0, error: 'Not initialized' };
  }

  // ── Selection (focus + multi-select) ────────────────────────────────────────

  selectNode(path: string, mode: SelectMode = 'replace', options?: TreeMutationOptions): void {
    this.#live?.selectNode(path, mode, options);
  }

  selectNodes(paths: string[], options?: TreeMutationOptions): void {
    this.#live?.selectNodes(paths, options);
  }

  selectAll(options?: TreeMutationOptions): void {
    this.#live?.selectAll(options);
  }

  clearSelection(paths?: string[], options?: TreeMutationOptions): void {
    this.#live?.clearSelection(paths, options);
  }

  getSelectedNodes(): LTreeNode<T>[] {
    return this.#live?.getSelectedNodes() ?? [];
  }

  isNodeSelected(path: string): boolean {
    return this.#live?.isNodeSelected(path) ?? false;
  }

  /** The Shift-range anchor (Shift+click / Shift+Arrow extend from it); `null` = none.
   *  Writable — e.g. an alternative renderer keeping its own range selection in sync. */
  get selectionAnchor(): string | null {
    return this.#live?.selectionAnchor ?? null;
  }

  set selectionAnchor(path: string | null) {
    const tree = this.#live;
    if (tree) tree.selectionAnchor = path;
  }

  /** Toggle the focused node in / out of the selection (Ctrl+click semantics). Multiple selection mode only. */
  toggleFocusedSelect(): void {
    this.#live?.toggleFocusedSelect();
  }

  // ── Checked (checkbox data state) ───────────────────────────────────────────

  checkNode(path: string, options?: TreeMutationOptions): void {
    this.#live?.checkNode(path, options);
  }

  checkNodes(paths: string[], options?: TreeMutationOptions): void {
    this.#live?.checkNodes(paths, options);
  }

  checkAll(options?: TreeMutationOptions): void {
    this.#live?.checkAll(options);
  }

  uncheckNode(path: string, options?: TreeMutationOptions): void {
    this.#live?.uncheckNode(path, options);
  }

  uncheckNodes(paths: string[], options?: TreeMutationOptions): void {
    this.#live?.uncheckNodes(paths, options);
  }

  uncheckAll(options?: TreeMutationOptions): void {
    this.#live?.uncheckAll(options);
  }

  getCheckedNodes(): LTreeNode<T>[] {
    return this.#live?.getCheckedNodes() ?? [];
  }

  /** Every node that shows a tick, folders and their children — never folded by `cascade-check-policy`. */
  getAllCheckedNodes(): LTreeNode<T>[] {
    return this.#live?.getAllCheckedNodes() ?? [];
  }

  /** Every ticked path, never folded (read-only; `checkedPaths` is the folded set). */
  get allCheckedPaths(): string[] {
    return this.#live?.allCheckedPaths ?? [];
  }

  isNodeChecked(path: string): boolean {
    return this.#live?.isNodeChecked(path) ?? false;
  }

  // ── Focus (single cursor) ───────────────────────────────────────────────────

  focusNode(path: string, options?: TreeMutationOptions): void {
    this.#live?.focusNode(path, options);
  }

  clearFocus(options?: TreeMutationOptions): void {
    this.#live?.clearFocus(options);
  }

  // ── Expand toggle (honors shouldExpandAsAccordion) ────────────────────────────────

  toggleNodeExpanded(path: string, options?: ExpandOptions): void {
    this.#live?.toggleNodeExpanded(path, options);
  }

  // ── Sorting ────────────────────────────────────────────────────────────────

  /** Sort the children of each node (one level; `''` = the roots) by the tree's rule
   *  (`sortCallback` → `orderMember` → display value, numeric-aware) or `options.compareCallback`;
   *  `direction: 'desc'` reverses it. Fires `nodes-sort` when `orderMember` values were
   *  rewritten (unless `isSilent`). Works with `isSortingEnabled` off too. */
  sortNodes(paths: string | string[], options?: SortOptions<T>): void {
    this.#live?.sortNodes(paths, options);
  }

  /** Sort whole subtrees — the nodes' children at every depth; `null` / omitted = the whole
   *  tree. Same rule / options / event as {@link sortNodes}. */
  sortAll(paths?: string | string[] | null, options?: SortOptions<T>): void {
    this.#live?.sortAll(paths, options);
  }

  // ── Insert diagnostics ──────────────────────────────────────────────────────

  /** Result of the most recent data insert (successful / failed / failedDetails) — read-only state. */
  get insertResult() {
    return this.#live?.insertResult;
  }

  // ── Navigation ──────────────────────────────────────────────────────────────

  focusAndSelectNode(path: string): void { this.#live?.focusAndSelectNode(path); }
  focusNext(): void { this.#live?.focusNext(); }
  focusPrevious(): void { this.#live?.focusPrevious(); }
  focusNextAtLevel(): void { this.#live?.focusNextAtLevel(); }
  focusPreviousAtLevel(): void { this.#live?.focusPreviousAtLevel(); }
  focusFirstChild(): void { this.#live?.focusFirstChild(); }
  focusParent(): void { this.#live?.focusParent(); }
  collapseParent(): void { this.#live?.collapseParent(); }
  toggleFocusedNodeExpanded(): void { this.#live?.toggleFocusedNodeExpanded(); }
  focusFirst(): void { this.#live?.focusFirst(); }
  focusLast(): void { this.#live?.focusLast(); }
  focusNextPage(): void { this.#live?.focusNextPage(); }
  focusPreviousPage(): void { this.#live?.focusPreviousPage(); }
  extendSelectionNext(): void { this.#live?.extendSelectionNext(); }
  extendSelectionPrevious(): void { this.#live?.extendSelectionPrevious(); }
  extendSelectionToFirst(): void { this.#live?.extendSelectionToFirst(); }
  extendSelectionToLast(): void { this.#live?.extendSelectionToLast(); }
  extendSelectionNextPage(): void { this.#live?.extendSelectionNextPage(); }
  extendSelectionPreviousPage(): void { this.#live?.extendSelectionPreviousPage(); }

  // ── Clipboard ─────────────────────────────────────────────────────────────

  copyNodes(paths?: string[]): void {
    this.#live?.copyNodes(paths);
  }

  cutNodes(paths?: string[]): void {
    this.#live?.cutNodes(paths);
  }

  /** Paste under / beside `targetPath`; `transform(ctx{ data, … })` overrides nodeInputTransformationCallback. */
  pasteNodes(
    targetPath: string,
    transform?: NodeTransformCallback<T> | null,
    position?: DropPosition
  ): PasteResult<T> {
    return this.#live?.pasteNodes(targetPath, transform, position) ?? { success: false, count: 0, skipped: 0, error: 'Not initialized' };
  }

  cancelCut(): void {
    this.#live?.cancelCut();
  }

  /** Programmatic removal (no `beforeDeleteCallback`, no `node-delete` — those belong to the user Delete command). */
  removeNodes(paths: string[]): { removed: number; failed: number } {
    return this.#live?.removeNodes(paths) ?? { removed: 0, failed: 0 };
  }

  /**
   * The user's Delete command (the Delete key / the `delete` menu action) on `paths` — default:
   * the selection, else the focused node. `beforeDeleteCallback` may narrow or block it; fires
   * `node-delete` with the pre-removal nodes. Programmatic removal without a veto: {@link removeNodes}.
   */
  deleteNodes(paths?: string[]): { removed: number; blocked: number } {
    return this.#live?.deleteNodes(paths) ?? { removed: 0, blocked: 0 };
  }

  hasClipboardContent(): boolean {
    return this.#live?.hasClipboardContent() ?? false;
  }

  getClipboardOperation(): 'copy' | 'cut' | null {
    return this.#live?.getClipboardOperation() ?? null;
  }

  /**
   * The public facade (`el.controller`, and `controller` on every callback ctx and event
   * detail). Delegates to the current tree, so it survives rebuilds; applies pending
   * property writes first (`flush`). Reads return empty values before the first build.
   */
  protected override createController(): TreeViewController<T> {
    return createTreeViewController<T>(() => {
      this.flush();
      return this.#treeview;
    }, { isRendering: () => this.#isRendering });
  }
}

// Every input-table row as a typed property (core docs/usage.md → "Typing the properties", rulebook C-CA-16).
export interface WebTreeViewElement<T = any> extends TreeViewElementConfig<T> {
  /** The expanded set (live once built). Assigning (any iterable) replaces it silently — no `expanded-change`. */
  get expandedPaths(): string[];
  set expandedPaths(paths: Iterable<string> | null | undefined);
  /** The selected set (live once built). Assigning (any iterable) replaces it silently — no `selection-change`. */
  get selectedPaths(): string[];
  set selectedPaths(paths: Iterable<string> | null | undefined);
  /** The checked set as emitted (live once built). Assigning (any iterable) replaces it silently — no `checked-change`. */
  get checkedPaths(): string[];
  set checkedPaths(paths: Iterable<string> | null | undefined);
}
