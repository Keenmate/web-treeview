/**
 * Default flat-mode DOM renderer implementing TreeViewRenderer<T>.
 *
 * - Event delegation: single click/dragover/drop listeners on body element
 * - Keyed reconciliation: Map<string, HTMLElement> keyed by node path
 * - Node element matches Node.svelte template structure
 * - Uses RenderCoordinator for progressive rendering
 * - Virtual scroll: three-div structure (scroll container → spacer → translateY content)
 */

import { DEFAULT_LABELS, type TreeViewLabels } from '../labels';
import type { TreeViewRenderer, RendererConfig } from './types';
import type { TreeViewState } from '../controller/tree-view-state';
import type { TreeViewStateSnapshot, NodeConfig } from '../controller/types';
import type { LTreeNode } from '../ltree/ltree-node';
import type { DropPosition } from '../ltree/types';
import type { TreeMenuContext, TreeMenuItem } from '../interaction';
import { openMenu, type MenuHandle } from '@keenmate/web-components-core/menu';
import { isTypingTarget, matchesShortcut } from '@keenmate/web-components-core/actions';
import { createActiveDescendant, type ActiveDescendant } from '@keenmate/web-components-core/a11y';
import { createTooltip, createPopover, type TooltipHandle, type PopoverHandle } from '@keenmate/web-components-core/positioning';
import {
  classifyDevice,
  observeEnvironment,
  observeElementSize,
  getEnvironment,
  deepActiveElement,
  createFrameScheduler,
  createElementSizeObserver,
  isRtl,
  renderSlot,
  createPointerDrag,
  type PointerDrag,
  type DeviceClass,
  type ElementSizeObserver,
  type ElementSize,
  type SlotResult
} from '@keenmate/web-components-core';
import type { NodeRenderContext } from '../controller/types';
import type { NodeTitleOverflow } from './types';
import { defaultTreeLoggers, type TreeLoggers } from '../logger';
import { openTreeLayer } from './layers';
import { rowDomId } from '../helpers/string-helpers';
import type { Layer } from '@keenmate/web-components-core/positioning';

/** The drop pad a position shows (`labels.dropBefore` / `labels.dropAfter` / `labels.dropChild` keys). */
const DROP_PAD_LABEL = { before: 'labels.dropBefore', after: 'labels.dropAfter', child: 'labels.dropChild' } as const satisfies Record<DropPosition, keyof TreeViewLabels>;

/** Add space-separated class string to an element (classList.add doesn't support spaces) */
function addClasses(el: HTMLElement, classes: string): void {
  for (const cls of classes.split(' ')) {
    if (cls) el.classList.add(cls);
  }
}

/** Set (or with `null` remove) an attribute, touching the DOM only on a change. */
function setAttr(el: Element, name: string, value: string | null): void {
  if (value === null) {
    if (el.hasAttribute(name)) el.removeAttribute(name);
  } else if (el.getAttribute(name) !== value) {
    el.setAttribute(name, value);
  }
}

/** Remove space-separated class string from an element */
function removeClasses(el: HTMLElement, classes: string): void {
  for (const cls of classes.split(' ')) {
    if (cls) el.classList.remove(cls);
  }
}

/** Toggle space-separated class string on an element */
function toggleClasses(el: HTMLElement, classes: string, force: boolean): void {
  if (force) addClasses(el, classes);
  else removeClasses(el, classes);
}

export class DomRenderer<T = any> implements TreeViewRenderer<T> {
  private container: HTMLElement | null = null;
  private state: TreeViewState<T> | null = null;
  private config: RendererConfig<T> = {};

  // DOM elements
  private headerEl: HTMLElement | null = null;
  private bodyEl: HTMLElement | null = null;
  private footerEl: HTMLElement | null = null;
  /** The open context menu (core `/menu`) and what it was opened for. */
  private _menu: MenuHandle | null = null;
  private _menuKey: string | null = null;
  /** The next menu open came from the keyboard (Shift+F10 / ContextMenu) → focus its first item. */
  private _isMenuOpeningFromKeyboard = false;
  private loadingEl: HTMLElement | null = null;
  /** The engine's loggers (the element's instance loggers when hosted). */
  private get log(): TreeLoggers { return this.state?.log ?? defaultTreeLoggers; }

  // Virtual scroll DOM elements
  private vsSpacerEl: HTMLElement | null = null;
  private vsContentEl: HTMLElement | null = null;
  /** One virtual-scroll update per animation frame (scroll bursts coalesce). */
  private _vsFrame = createFrameScheduler(() => this._performScrollUpdate());
  private _vsMeasured = false;
  private _vsLastStartIndex = -1;
  private _vsLastEndIndex = -1;

  // Keyed node map
  /** Row elements keyed by node PATH (unique by construction — ids may repeat,
   *  e.g. a pasted copy keeps its source id; NOTES #8). */
  private nodeElements = new Map<string, HTMLElement>();
  /** The node object each row was rendered for — a path can be taken over by a
   *  different node (move away + move/insert into the same slot). */
  private nodeOfElement = new WeakMap<HTMLElement, LTreeNode<T>>();

  /**
   * ARIA tree (core `/a11y` `createActiveDescendant`, ARIA-only): focus stays on the
   * `role="tree"` body (rows are virtual and may not exist) and the tree keeps all its own
   * keys. Core owns `aria-activedescendant` + the row ids; the tree calls `setActive(row)`
   * when the focused node (or its row element) changes. No core scroll: keyboard moves
   * already reveal the row through `revealNode` (virtual-aware, `beforeScrollCallback`-gated).
   */
  private _activeDescendant: ActiveDescendant | null = null;
  /** `aria-posinset` / `aria-setsize` per path, for the visible-node list they were built from. */
  private _ariaPositions: Map<string, [number, number]> | null = null;
  private _ariaPositionsOf: readonly LTreeNode<T>[] | null = null;

  // Subscriptions
  private unsubState: (() => void) | null = null;
  private unsubConfig: (() => void) | null = null;

  // Last snapshot for diffing
  private lastSnapshot: TreeViewStateSnapshot<T> | null = null;
  private lastNodeConfig: NodeConfig | null = null;
  // Hover/focus tooltip handles, keyed like nodeElements (id || path). Created per
  // row via the shared core createTooltip, destroyed when the row leaves. The content
  // is resolved from getNodeTooltipCallback(ctx) at SHOW time (and refreshed while
  // visible on every state change), so it reflects live state — selected / checked /
  // expanded / focused — not the state the row was built in. The handle itself is
  // kept across reconciles, so the follow-cursor rect seeded on mouseenter survives.
  // Mirrors web-multiselect's option tooltips.
  private tooltips = new Map<string, TooltipHandle>();
  // The node each live tooltip describes (the content is resolved from it at show time).
  private tooltipNodes = new Map<string, LTreeNode<T>>();
  private _lastEmptyState: string = '';
  // Responsive env for the NodeRenderContext (@keenmate/web-components-core/environment).
  // deviceClass flips are discrete → re-render on change; container size updates silently
  // (web-treeview is virtual-scroll-first; re-painting all rows per resize frame is wrong).
  private _deviceClass: DeviceClass = 'desktop';
  private _containerBox: ElementSize = { width: 0, height: 0 };
  private _stopEnvObserve: (() => void) | null = null;
  private _stopSizeObserve: (() => void) | null = null;
  // False between deactivate() and activate() (the host element is detached).
  private _isActive = false;
  /** Disabled (native semantics, `isDisabled`): every user-input handler is a no-op, the body is
   *  out of the tab order. Programmatic engine calls are unaffected. */
  private _isDisabled = false;
  /** Read-only (`isReadonly`): user input can't change the data (checks, drag, drop). */
  private get _isReadonly(): boolean {
    return !!this.config?.isReadonly;
  }

  mount(container: HTMLElement, state: TreeViewState<T>, config: RendererConfig<T>): void {
    this.container = container;
    this.state = state;
    this.config = config;

    // Build skeleton
    this.container.innerHTML = '';
    this.container.classList.add('wtv__container');
    this._applyTitleOverflow(config.nodeTitleOverflow);

    // Header
    this.headerEl = document.createElement('div');
    this.headerEl.className = 'wtv__header';
    this.container.appendChild(this.headerEl);
    this._renderRegion(this.headerEl, config.renderHeaderCallback);

    // Tree body
    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'wtv__tree';
    this.bodyEl.setAttribute('role', 'tree');
    this.bodyEl.setAttribute('aria-label', this._label('ariaLabels.tree'));
    this.container.appendChild(this.bodyEl);

    // Footer
    this.footerEl = document.createElement('div');
    this.footerEl.className = 'wtv__footer';
    this.container.appendChild(this.footerEl);
    this._renderRegion(this.footerEl, config.renderFooterCallback);

    // Loading overlay
    this.loadingEl = document.createElement('div');
    this.loadingEl.className = 'wtv__loading-overlay';
    this.loadingEl.style.display = 'none';
    this.container.appendChild(this.loadingEl);

    // Set the state's container for scrollToPath
    state.containerElement = container;
    state.layerOpener = config.openLayer ?? null;

    // Responsive env for NodeRenderContext. Seed synchronously so the initial render has
    // the right device class; then observe — only a device-class FLIP forces a re-render.
    this._deviceClass = classifyDevice(getEnvironment());
    this._isActive = true;
    this._startObservers();

    // Wire event delegation
    this._attachBodyListeners();
    // After the body's tabindex="0" (core keeps an existing one). Input and listbox are the
    // same element: the focused tree body owns the active descendant.
    const body = this.bodyEl;
    this._activeDescendant = createActiveDescendant(body, body, {
      getItems: () => this._ariaRows(),
      shouldHandleKeys: false,
      shouldScroll: false,
    });
    this._isDisabled = false;
    this._applyDisabled(!!config.isDisabled);
    this.container.classList.toggle('wtv__container--readonly', !!config.isReadonly);

    // Subscribe to the state
    this.unsubState = state.on('state-change', (snapshot) => this._handleStateChange(snapshot));
    this.unsubConfig = state.on('config-change', (nodeConfig) => this._handleConfigChange(nodeConfig));

    // Initial render from current state
    this.lastNodeConfig = state.nodeConfig;
    this._handleStateChange(state.getSnapshot());
  }

  /** The overlay's loader (core `renderLoader`, SPEC §12.14 — NOTES #19): drawn while
   *  `isLoading`, removed after; redrawn when the drawer (instance `renderLoadingCallback`)
   *  or the `ariaLabels.loading` label changes. */
  private _removeLoader: (() => void) | null = null;
  private _loaderDrawer: unknown = undefined;
  private _loaderLabel = '';
  private _syncLoader(isLoading: boolean): void {
    const draw = this.config.renderLoadingCallback;
    const label = this._label('ariaLabels.loading');
    const isStale = draw !== this._loaderDrawer || label !== this._loaderLabel;
    if (this._removeLoader && (!isLoading || isStale)) {
      this._removeLoader();
      this._removeLoader = null;
    }
    if (isLoading && !this._removeLoader && this.loadingEl && draw) {
      this._loaderDrawer = draw;
      this._loaderLabel = label;
      this._removeLoader = draw(this.loadingEl, label);
    }
  }

  /** One UI string through the tree's core `/locale` labels (instance → page-wide → English);
   *  a renderer mounted without them (custom wiring) falls back to English. */
  private _label(key: keyof TreeViewLabels): string {
    return this.config.labels?.text(key) ?? DEFAULT_LABELS[key];
  }

  /** Label key of the built-in empty state: `messages.noData` (no nodes) or `messages.noResults` (filtered to nothing). */
  private _emptyLabelKey: 'messages.noData' | 'messages.noResults' = 'messages.noData';

  /** The callback the current `.wtv__empty-zone` was built with (NOTES #20). */
  private _emptyZoneCb: unknown = undefined;

  /** Re-apply the built-in UI strings to the live empty state / empty drop zone (custom render callbacks own theirs). */
  private _refreshLabels(): void {
    const target = this._renderTarget;
    if (!target) return;
    const emptyState = target.querySelector<HTMLElement>('.wtv__empty-state');
    if (emptyState) this._renderEmptyState(emptyState);
    this.bodyEl?.setAttribute('aria-label', this._label('ariaLabels.tree'));
    const showFull = this._label('ariaLabels.showFullLabel');
    for (const btn of target.querySelectorAll('.wtv__node-info')) btn.setAttribute('aria-label', showFull);
    // Only the built-in zone content carries this class (a custom result replaces it).
    const content = target.querySelector('.wtv__empty-zone-content');
    if (content) content.textContent = this._label('messages.dropHere');
  }

  /**
   * The icon sources changed (the page-wide or this tree's `renderIconCallback`): re-resolve every rendered
   * row's `.wtv__node-icon` (only the changed markup is written) and re-run `renderNodeCallback` in place — its
   * memo is invalidated (`_nodeRenderGen`), since a custom node may draw icons through core `renderIcon`.
   * Same rows → expansion, selection, checks, focus and scroll are kept; off-screen rows render fresh later.
   * `isIconsChanged: false` = only the custom node renders (a render-ctx value changed — `renderContextVersion`).
   */
  private _refreshIcons(isIconsChanged = true): void {
    const snapshot = this.lastSnapshot;
    if (!snapshot) return;
    const hasNodeCb = !!this.config.renderNodeCallback;
    if (!hasNodeCb && !isIconsChanged) return;
    if (hasNodeCb) this._nodeRenderGen++;
    for (const [, el] of this.nodeElements) {
      const node = this.nodeOfElement.get(el);
      const row = el.querySelector(':scope > .wtv__node-row') as HTMLElement | null;
      if (!node || !row) continue;
      const ctx = this._buildRenderContext(node, snapshot);
      if (isIconsChanged) this._applyNodeIcon(row, node, ctx);
      const content = hasNodeCb ? row.querySelector(':scope > .wtv__node-content') as HTMLElement | null : null;
      if (content) this._renderNodeContent(content, node, ctx);
    }
  }

  /** A header / footer region: its callback's result through core `renderSlot` (no built-in content). */
  private _renderRegion(el: HTMLElement | null, cb: (() => SlotResult) | undefined): void {
    if (el) renderSlot(el, cb ?? null);
  }

  /** The empty drop zone's content: `renderEmptyZoneCallback`'s result through core `renderSlot`; the built-in box by default. */
  private _fillEmptyZone(zone: HTMLElement): void {
    this._emptyZoneCb = this.config.renderEmptyZoneCallback;
    renderSlot(zone, this.config.renderEmptyZoneCallback ?? null, {
      renderDefault: (c) => {
        const content = document.createElement('div');
        content.className = 'wtv__empty-zone-content';
        content.textContent = this._label('messages.dropHere');
        c.replaceChildren(content);
      },
    });
  }

  /** The empty state: `renderEmptyStateCallback`'s result through core `renderSlot`; the built-in text by default. */
  private _renderEmptyState(el: HTMLElement): void {
    renderSlot(el, this.config.renderEmptyStateCallback ?? null, {
      renderDefault: (c) => { c.textContent = this._label(this._emptyLabelKey); },
    });
  }

  /** Bumped when `renderNodeCallback` changes — part of every node slot's memo key. */
  private _nodeRenderGen = 0;

  /**
   * A row's `.wtv__node-content`: `renderNodeCallback`'s result through core `renderSlot` (SPEC §12.35).
   * Memoized on the node's identity + version + render state (not the container size — like today, a
   * resize alone never re-renders rows; a device-class flip does), so a repaint that changes none of
   * them doesn't re-run the hook (a focused input inside a custom node survives).
   */
  private _renderNodeContent(content: HTMLElement, node: LTreeNode<T>, ctx: NodeRenderContext): void {
    const cb = this.config.renderNodeCallback;
    renderSlot(content, cb ? () => cb(node, ctx) : null, {
      memoKey: cb
        ? [this._nodeRenderGen, node.path, node._rev, ctx.isExpanded, ctx.isChecked, ctx.isSelected, ctx.isFocused,
           ctx.level, ctx.hasChildren, ctx.deviceClass].join('|')
        : undefined,
      renderDefault: (c) => this._renderDefaultLabel(c, node),
    });
  }

  /** The built-in `.wtv__node-label` (kept, its text patched, when it already is the content). */
  private _renderDefaultLabel(content: HTMLElement, node: LTreeNode<T>): void {
    const text = this.state?.tree?.getNodeDisplayValue(node) || String(node.id);
    const first = content.firstChild;
    const isOwn = first instanceof HTMLElement && first.classList.contains('wtv__node-label') &&
      Array.from(content.childNodes).every((n, i) => i === 0 || (n instanceof HTMLElement && n.classList.contains('wtv__node-info')));
    if (isOwn) {
      if (first.textContent !== text) {
        first.textContent = text;
        if (this._titleOverflow === 'info') this._measureLabel(first);
      }
      return;
    }
    const label = document.createElement('span');
    label.className = 'wtv__node-label';
    label.textContent = text;
    content.replaceChildren(label);
    this._trackLabel(label);
  }

  updateConfig(config: Partial<RendererConfig<T>>): void {
    const prevNodeCb = this.config.renderNodeCallback;
    const prevIconCb = this.config.renderIconCallback;
    const prevHeaderCb = this.config.renderHeaderCallback;
    const prevFooterCb = this.config.renderFooterCallback;
    const prevCtxVersion = this.config.renderContextVersion;
    Object.assign(this.config, config);
    // A value the render callbacks RECEIVE changed (labels, isReadonly, isDisabled — TreeViewEngine bumps the
    // version): re-run them in place, same elements. Anything else they don't receive never re-runs them.
    const isCtxChanged = 'renderContextVersion' in config && config.renderContextVersion !== prevCtxVersion;
    if ('labels' in config) this._refreshLabels();
    if (this.lastSnapshot) this._syncLoader(!!this.lastSnapshot.isLoading);
    if (this.config.renderEmptyZoneCallback !== this._emptyZoneCb) {
      const zone = this._renderTarget?.querySelector('.wtv__empty-zone');
      if (zone && this.state) {
        zone.remove();
        this._fullRender(this.state.getSnapshot());
      }
    } else if (isCtxChanged && this.config.renderEmptyZoneCallback) {
      const zone = this._renderTarget?.querySelector<HTMLElement>('.wtv__empty-zone');
      if (zone) this._fillEmptyZone(zone);
    }
    if (isCtxChanged && !('labels' in config) && this.config.renderEmptyStateCallback) {
      // (a `labels` pass re-renders the empty state already — `_refreshLabels`)
      const emptyState = this._renderTarget?.querySelector<HTMLElement>('.wtv__empty-state');
      if (emptyState) this._renderEmptyState(emptyState);
    }
    if ('openLayer' in config && this.state) this.state.layerOpener = config.openLayer ?? null;
    if ('isDisabled' in config) this._applyDisabled(!!config.isDisabled);
    if ('isReadonly' in config) this.container?.classList.toggle('wtv__container--readonly', !!config.isReadonly);
    if ('nodeTitleOverflow' in config && (config.nodeTitleOverflow ?? 'ellipsis') !== this._titleOverflow) {
      this._applyTitleOverflow(config.nodeTitleOverflow);
    }
    // `<web-treeview>` re-sends its full config on every batch (callbacks keep their identity — TreeViewEngine
    // memoizes the adapters), so the regions and rows are redrawn only on an ACTUAL callback change: an unrelated
    // input change keeps the row elements, focus and every transient row / region state.
    if (isCtxChanged || ('renderHeaderCallback' in config && config.renderHeaderCallback !== prevHeaderCb)) {
      this._renderRegion(this.headerEl, this.config.renderHeaderCallback);
    }
    if (isCtxChanged || ('renderFooterCallback' in config && config.renderFooterCallback !== prevFooterCb)) {
      this._renderRegion(this.footerEl, this.config.renderFooterCallback);
    }
    // Re-render nodes if renderNodeCallback changed (so a callback assigned after the initial data
    // render re-paints the rows; a removed one brings the built-in label back).
    const isNodeCbChanged = 'renderNodeCallback' in config && config.renderNodeCallback !== prevNodeCb;
    if (isNodeCbChanged) this._nodeRenderGen++;
    // The icon sources changed — a re-sent `renderNodeIcon` (the page-wide hook, or this tree's own) or a
    // replaced `renderIconCallback`: repaint the icons + custom node renders IN PLACE (`_refreshIcons`) —
    // rows, focus, scroll and every other state stay untouched.
    const isIconsChanged = 'renderNodeIcon' in config ||
      ('renderIconCallback' in config && config.renderIconCallback !== prevIconCb);
    if (isNodeCbChanged && this.state) {
      this._fullRender(this.state.getSnapshot());
    } else if (isIconsChanged || isCtxChanged) {
      // In place: icons (when they changed) + the custom node renders — same rows, focus / scroll / state kept.
      this._refreshIcons(isIconsChanged);
    }
  }

  destroy(): void {
    this._closeDropPads();
    this.unsubState?.();
    this.unsubConfig?.();
    this.unsubState = null;
    this.unsubConfig = null;
    this._detachBodyListeners();
    this._activeDescendant?.destroy();
    this._activeDescendant = null;
    this._ariaPositions = null;
    this._ariaPositionsOf = null;
    this._closeMenu();
    this._stopEnvObserve?.();
    this._stopSizeObserve?.();
    this._stopEnvObserve = null;
    this._stopSizeObserve = null;
    this._destroyAllTooltips();
    this._closeReveal();
    this._removeLoader?.();
    this._removeLoader = null;
    this._labelObserver?.disconnect();
    this._labelObserver = null;
    this.nodeElements.clear();
    this._vsFrame.cancel();
    this.vsSpacerEl = null;
    this.vsContentEl = null;
    this._vsMeasured = false;
    if (this.container) {
      this.container.innerHTML = '';
      this.container.classList.remove('wtv__container');
      this.container.removeAttribute('data-theme');
      this.container.removeAttribute('data-node-title-overflow');
      this.container.classList.remove('wtv__container--disabled', 'wtv__container--readonly');
    }
    this._isDisabled = false;
    this.container = null;
    this.state = null;
    this.lastSnapshot = null;
    this._isActive = false;
  }

  // ── Activate / deactivate (host DOM move — core build-once lifecycle) ──

  /**
   * The host was detached (a DOM move or a removal). Stop the LIVE resources —
   * environment / size observers, the document `dragend` listener, the open
   * context menu (its positioning + document listeners), shown tooltips — and keep
   * the rendered rows and all state. The body listeners live on elements inside
   * the shadow root, so they move with it and stay attached (no duplicates on
   * reconnect). The body scroll offset survives through the element's core
   * `keepScrollAcrossMove()`. Idempotent.
   */
  deactivate(): void {
    if (!this._isActive) return;
    this._isActive = false;
    this._closeMenu();
    this._closeReveal();
    this._closeDropPads();
    this._pointerDrag?.cancel();
    for (const h of this.tooltips.values()) h.hide();
    this._stopEnvObserve?.();
    this._stopSizeObserve?.();
    this._stopEnvObserve = null;
    this._stopSizeObserve = null;
  }

  /** The host was re-attached: restart what {@link deactivate} stopped. Idempotent. */
  activate(): void {
    if (this._isActive || !this.container) return;
    this._isActive = true;
    // The environment may have changed while detached — re-render only on a device-class flip.
    const dc = classifyDevice(getEnvironment());
    if (dc !== this._deviceClass) {
      this._deviceClass = dc;
      if (this.state) this._fullRender(this.state.getSnapshot());
    }
    this._startObservers();
  }

  /** Start the environment + container-size observers (mount / activate). */
  private _startObservers(): void {
    if (!this.container) return;
    this._stopEnvObserve?.();
    this._stopSizeObserve?.();
    this._stopEnvObserve = observeEnvironment((env) => {
      const dc = classifyDevice(env);
      if (dc !== this._deviceClass) {
        this._deviceClass = dc;
        if (this.state) this._fullRender(this.state.getSnapshot());
      }
    });
    this._stopSizeObserve = observeElementSize(this.container, (size) => {
      this._containerBox = size;
      if (this.vsSpacerEl && this.bodyEl) this.state?.setVirtualViewportHeight(this.bodyEl.clientHeight);
      this.config.onContainerResize?.({ width: size.width, height: size.height }, this._deviceClass);
    });
  }

  // ── Node title overflow (wrap | ellipsis | info) ────────────────────
  // wrap / ellipsis are pure CSS (gated by data-node-title-overflow on the container).
  // `info` also measures each built-in label (one ResizeObserver) and, when it is
  // clipped, appends a trailing info button revealing the full label in a popover — the
  // touch / no-hover substitute for the native title tooltip. renderNodeCallback rows
  // own their layout and don't take part.

  private _titleOverflow: NodeTitleOverflow = 'ellipsis';
  private _labelObserver: ElementSizeObserver | null = null;
  private _reveal: { handle: PopoverHandle; button: HTMLElement } | null = null;

  private _applyTitleOverflow(mode: NodeTitleOverflow | null | undefined): void {
    this._titleOverflow = mode ?? 'ellipsis';
    if (!this.container) return;
    this.container.setAttribute('data-node-title-overflow', this._titleOverflow);
    this._closeReveal();
    this._labelObserver?.disconnect();
    this._labelObserver = null;
    const labels = this.container.querySelectorAll<HTMLElement>('.wtv__node-label');
    if (this._titleOverflow === 'info' && typeof ResizeObserver !== 'undefined') {
      // Like a bare ResizeObserver: the first measure comes with the observer's initial
      // entry (no synchronous layout per label while rows build), no throttle window.
      this._labelObserver = createElementSizeObserver(
        (_size, label) => this._measureLabel(label as HTMLElement),
        { shouldFireImmediately: false, throttleMs: 0 }
      );
      for (const label of labels) this._labelObserver.observe(label);
    } else {
      for (const label of labels) this._setLabelTruncated(label, false);
    }
  }

  /** A freshly built default label: watch it in `info` mode. */
  private _trackLabel(label: HTMLElement): void {
    this._labelObserver?.observe(label);
  }

  /** `info` mode: show / drop the info button by whether the label is clipped. */
  private _measureLabel(label: HTMLElement): void {
    if (!label.isConnected) {
      this._labelObserver?.unobserve(label);
      return;
    }
    if (this._titleOverflow !== 'info') return;
    this._setLabelTruncated(label, label.scrollWidth > label.clientWidth + 1);
  }

  private _setLabelTruncated(label: HTMLElement, isTruncated: boolean): void {
    const next = label.nextElementSibling as HTMLElement | null;
    const button = next?.classList.contains('wtv__node-info') ? next : null;
    if (!isTruncated) {
      label.removeAttribute('title');
      if (button) {
        if (this._reveal?.button === button) this._closeReveal();
        button.remove();
      }
      return;
    }
    label.title = label.textContent ?? '';
    if (button) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wtv__node-info';
    btn.setAttribute('aria-label', this._label('ariaLabels.showFullLabel'));
    btn.disabled = this._isDisabled;
    const stop = (e: Event) => e.stopPropagation();
    btn.addEventListener('pointerdown', stop);
    btn.addEventListener('mousedown', stop);
    btn.addEventListener('dblclick', stop);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (this._isDisabled) return;
      this._toggleReveal(btn, label.textContent ?? '');
    });
    label.after(btn);
  }

  /** Open (or close, on a second click) the full-label popover for an info button. */
  private _toggleReveal(button: HTMLElement, text: string): void {
    const isSame = this._reveal?.button === button;
    this._closeReveal();
    if (isSame || !this.container) return;
    const panel = document.createElement('div');
    panel.className = 'wtv__node-info-reveal';
    panel.setAttribute('role', 'tooltip');
    panel.textContent = text;
    // Escape / an outside click close it through core's overlay tree (SPEC §12.9): one level per
    // Escape (a context menu opened over it closes first), focus back on the button, and a press on
    // the button itself is left to the click toggle. A scroll that moves the row (the tree body, an
    // outer scroller, the page) closes it too; a scroll inside the popover doesn't.
    const handle = createPopover({
      reference: button, panel, container: this.container, placement: 'top-end', offset: 6,
      shouldCloseOnEscape: true,
      shouldCloseOnOutsideClick: true,
      shouldCloseOnScroll: true,
      onClose: () => { if (this._reveal?.handle === handle) this._closeReveal(); },
    });
    handle.open();
    this._reveal = { handle, button };
  }

  private _closeReveal(): void {
    const reveal = this._reveal;
    if (!reveal) return;
    this._reveal = null;
    reveal.handle.destroy();
  }

  /**
   * Apply the disabled state (native form-control semantics): `.wtv__container--disabled` (dims it,
   * rows take no pointer input), the body leaves the tab order (`tabindex` removed, focus dropped)
   * and gets `aria-disabled="true"`, the info buttons / empty drop zone stop being focusable, and an
   * open context menu, full-label popover or tooltip closes. Re-enabling restores all of it.
   */
  private _applyDisabled(isDisabled: boolean): void {
    if (isDisabled === this._isDisabled) return;
    this._isDisabled = isDisabled;
    this.container?.classList.toggle('wtv__container--disabled', isDisabled);
    if (isDisabled) {
      this._closeMenu();
      if (this.state?.isContextMenuOpen) this.state.closeContextMenu();
      this._closeReveal();
      for (const h of this.tooltips.values()) h.hide();
    }
    const body = this.bodyEl;
    if (!body) return;
    if (isDisabled) {
      body.removeAttribute('tabindex');
      body.setAttribute('aria-disabled', 'true');
      // The focused element, even inside a nested shadow root (a node template's custom element):
      // climb its hosts to find whether it lives in the body, then blur the element itself.
      const active = deepActiveElement() as HTMLElement | null;
      let inside: Element | null = active;
      while (inside && inside !== body && !body.contains(inside)) {
        const r = inside.getRootNode();
        inside = r instanceof ShadowRoot ? r.host : null;
      }
      if (active && inside) active.blur();
    } else {
      body.setAttribute('tabindex', '0');
      body.removeAttribute('aria-disabled');
    }
    for (const btn of body.querySelectorAll<HTMLButtonElement>('.wtv__node-info')) btn.disabled = isDisabled;
    if (this.config?.isEmptyDropPlaceholderShown) {
      for (const zone of body.querySelectorAll<HTMLElement>('.wtv__empty-zone')) zone.tabIndex = isDisabled ? -1 : 0;
    }
  }

  // ── Event delegation ────────────────────────────────────────────────

  private _handleBodyClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement;
    if (!this.state) return;
    // Disabled: no interaction — also cancels a native checkbox toggle.
    if (this._isDisabled) {
      event.preventDefault();
      return;
    }

    // Build selection modifiers from event
    const modifiers = {
      isCtrlPressed: event.ctrlKey || event.metaKey,
      isShiftPressed: event.shiftKey
    };

    // Checkbox click
    const checkbox = target.closest('.wtv__checkbox') as HTMLInputElement | null;
    if (checkbox && this._isReadonly) {
      // Read-only: the check state is data — cancel the native toggle, change nothing.
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (checkbox) {
      event.stopPropagation();
      // Any non-plain click in between breaks a double-click (NOTES #25).
      this.state.resetDoubleClick();
      const nodeEl = checkbox.closest('.wtv__node') as HTMLElement;
      const path = nodeEl?.getAttribute('data-tree-path');
      if (path) {
        const node = this.state.getNodeByPath(path);
        if (node) {
          // .wtv__checkbox is the styled native <input> itself. We deliberately DON'T
          // preventDefault: on a reused input the browser's canceled-activation steps
          // fire LATE (after microtasks) and would restore .checked to its pre-click
          // value, clobbering our write. Letting the native toggle stand means no
          // cancellation + no restore. The state still owns it — handleCheckboxToggle
          // re-syncs the box via its synchronous refresh, and the microtask below
          // re-asserts the authoritative value so a VETOING beforeCheckboxToggleCallback
          // (which refreshes nothing) still snaps the native toggle back.
          this.state.nodeCallbacks.handleCheckboxToggle(node, { skipFocus: false });
          queueMicrotask(() => {
            const fresh = this.state?.getNodeByPath(path);
            if (fresh) {
              this._syncCheckboxState(
                checkbox,
                fresh.isChecked,
                fresh.visualState === 'indeterminate'
              );
            }
          });
          return;
        }
      }
    }

    // Toggle icon click
    const toggleIcon = target.closest('.wtv__toggle-icon') as HTMLElement;
    if (toggleIcon) {
      this.state.resetDoubleClick();
      const nodeEl = toggleIcon.closest('.wtv__node') as HTMLElement;
      const path = nodeEl?.getAttribute('data-tree-path');
      if (path) {
        const node = this.state.getNodeByPath(path);
        if (node) {
          // toggleNodeExpanded honors shouldExpandAsAccordion and the
          // isCollapsible gate. Programmatic expandNodes / collapseNodes
          // callers still bypass the accordion.
          this.state.toggleNodeExpanded(path);
          return;
        }
      }
    }

    // Node content click (or indent zone click)
    const contentEl = target.closest('.wtv__node-content') as HTMLElement;
    const nodeEl = (contentEl || target).closest('.wtv__node') as HTMLElement;
    const path = nodeEl?.getAttribute('data-tree-path');
    if (path) {
      const node = this.state.getNodeByPath(path);
      if (node) {
        const behavior = this.lastNodeConfig?.clickBehavior ?? 'expand-and-focus';
        const isPlainClick = !modifiers.isCtrlPressed && !modifiers.isShiftPressed;

        // Manual double-click detection (the native dblclick is unreliable under
        // the flat diff reconciler — the first click bumps _rev and patches the
        // row). On a detected double the state fires onNodeDoubleClick (and,
        // in select mode, toggles expand/collapse); we consume the 2nd click so
        // the gesture reads as a single open, not a re-toggle.
        if (!isPlainClick) this.state.resetDoubleClick(); // NOTES #25
        else if (this.state.detectDoubleClick(node)) {
          return;
        }

        // shouldClickToggleCheckbox: a plain click on a selectable node with
        // checkboxes shown toggles the checkbox instead of running the
        // normal click/select flow. Expand-on-click still fires.
        if (
          this.state.shouldClickToggleCheckbox &&
          !this._isReadonly &&
          this.lastNodeConfig?.isCheckboxesShown &&
          node.isSelectable &&
          isPlainClick
        ) {
          this.state.nodeCallbacks.handleCheckboxToggle(node, { skipFocus: true });
          if (behavior !== 'select' && node.hasChildren) {
            this.state.toggleNodeExpanded(path);
          }
          return;
        }

        if (behavior === 'expand-and-focus' && isPlainClick && node.hasChildren) {
          // Select + expand/collapse
          this.state.toggleNodeExpanded(path);
          this.state.nodeCallbacks.handleNodeSelectClick(node, modifiers);
        } else if (behavior === 'expand' && isPlainClick && node.hasChildren) {
          // Expand/collapse only, no selection
          this.state.toggleNodeExpanded(path);
        } else if (behavior === 'select' || !isPlainClick) {
          // Select only (ctrl/shift always selects regardless of behavior)
          this.state.nodeCallbacks.handleNodeSelectClick(node, modifiers);
        } else {
          // expand-and-focus on leaf, or expand on leaf — just select
          this.state.nodeCallbacks.handleNodeSelectClick(node, modifiers);
        }
      }
    }
  };

  private _handleBodyKeydown = (event: KeyboardEvent) => {
    if (!this.state || this._isDisabled) return;
    const shift = event.shiftKey;

    // Consumer onTreeKeydown (can suppress everything) THEN the built-in
    // Ctrl/Cmd+C/X/V + Delete + Esc-cancel-cut shortcuts. When this consumes the
    // event, stop — the tree's own navigation below is skipped.
    if (this.state.handleKeydown(event)) {
      event.preventDefault();
      return;
    }

    // A key typed into a field inside a row (an <input> a renderNodeCallback drew) belongs to
    // that field — no navigation (arrows, Home / End, Backspace, Enter / Space, Ctrl+A).
    // The built-in clipboard / Delete shortcuts were already guarded (handleShortcutKeydown).
    // (svelte-treeview REVIEW-2026-11-19 B18)
    if (isTypingTarget(event)) return;

    // Shift+F10 / the ContextMenu key open the focused node's context menu.
    if (matchesShortcut(event, 'ContextMenu') || matchesShortcut(event, 'Shift+F10')) {
      if (this._openContextMenuFromKeyboard()) event.preventDefault();
      return;
    }

    // Ctrl/Cmd+A selects every node.
    if (matchesShortcut(event, 'Ctrl+A') || matchesShortcut(event, 'Meta+A')) {
      event.preventDefault();
      this.state.selectAll();
      return;
    }

    switch (event.key) {
      // Shift variants extend the selected range (a no-op in single selection mode).
      case 'ArrowDown':
        event.preventDefault();
        if (shift) this.state.extendSelectionNext();
        else this.state.focusNextAtLevel();
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (shift) this.state.extendSelectionPrevious();
        else this.state.focusPreviousAtLevel();
        break;
      // ArrowRight / ArrowLeft = forward (into / expand) / back (out / collapse) along the
      // reading direction: swapped in a right-to-left tree (WAI-ARIA tree RTL rule). Read live
      // per key — follows a `dir` change anywhere up the tree, no directionChanged() needed.
      case 'ArrowRight':
      case 'ArrowLeft': {
        event.preventDefault();
        const isForward = (event.key === 'ArrowRight') !== isRtl(this.bodyEl ?? this.container);
        if (isForward) this.state.focusFirstChild();
        else this.state.focusParent();
        break;
      }
      case 'Backspace':
        event.preventDefault();
        this.state.collapseParent();
        break;
      case 'Enter':
        // WAI-ARIA tree: Enter = the node's default action (expand / collapse).
        event.preventDefault();
        this.state.toggleFocusedNodeExpanded();
        break;
      case ' ': {
        // WAI-ARIA tree: Space toggles selection — the focused node's checkbox when
        // checkboxes are shown; otherwise the focused node in the selection
        // (multiple mode) / selects it (single mode).
        event.preventDefault();
        const focused = this.state.focusedNode;
        if (!focused || !focused.isSelectable) break;
        if (this.state.isCheckboxesShown) {
          if (!this._isReadonly) this.state.nodeCallbacks.handleCheckboxToggle(focused);
        } else if (this.state.selectionMode === 'multiple') {
          this.state.toggleFocusedSelect();
        } else {
          this.state.selectNode(focused.path);
        }
        break;
      }
      case 'Home':
        event.preventDefault();
        if (shift) this.state.extendSelectionToFirst();
        else this.state.focusFirst();
        break;
      case 'End':
        event.preventDefault();
        if (shift) this.state.extendSelectionToLast();
        else this.state.focusLast();
        break;
      case 'PageDown':
        event.preventDefault();
        if (shift) this.state.extendSelectionNextPage();
        else this.state.focusNextPage();
        break;
      case 'PageUp':
        event.preventDefault();
        if (shift) this.state.extendSelectionPreviousPage();
        else this.state.focusPreviousPage();
        break;
      case 'Escape':
        // handleKeydown already consumed Escape when a cut was pending
        // (cancel-cut). Reaching here means no pending cut, so clear the
        // selected set. Checkboxes are deliberate state and stay put.
        if (this.state.getSelectedPaths().size > 0) {
          this.state.clearSelection();
        }
        break;
    }
  };

  private _handleBodyContextMenu = (event: MouseEvent) => {
    if (!this.state || this._isDisabled) return;
    const target = event.target as HTMLElement;
    const contentEl = target.closest('.wtv__node-content') as HTMLElement;
    const nodeEl = (contentEl || target).closest('.wtv__node') as HTMLElement;
    const path = nodeEl?.getAttribute('data-tree-path');
    if (path) {
      const node = this.state.getNodeByPath(path);
      if (node) {
        this.state.nodeCallbacks.handleNodeContextMenu(node, event);
      }
    } else if (this.state.isContextMenuOpen) {
      // The browser's keyboard-initiated `contextmenu` (Shift+F10 / ContextMenu key)
      // targets the focused body — ours is already open, don't show the native one too.
      event.preventDefault();
    }
  };

  /**
   * Drag and drop through core `createPointerDrag` (SPEC §12.28) — ONE drag for mouse, pen and
   * touch (svelte-treeview parity; no HTML5 drag session). Mouse / pen: a press on a draggable
   * node's content pill starts after 5px of movement. Touch: a long press (`touchDragDelay`) on a
   * row; a long press on a LOCKED node plays the "can't move this" reaction (held 🚫), which keeps
   * the gesture but switches core's auto-scroll off. Core owns the scroll lock, the hit test
   * through shadow roots, auto-scroll, Escape / pointercancel and the swallowed trailing click;
   * the state owns the dragged set, the hover visuals (in whichever tree is under the pointer)
   * and the drop. `touchDragDelay` is read on every press, so a change needs no rebuild.
   */
  private _pointerDrag: PointerDrag | null = null;
  /** The press that may become a drag (core hands `onStart` no event on a touch long press). */
  private _pressEvent: PointerEvent | null = null;

  private _attachPointerDrag(): void {
    if (!this.bodyEl || this._pointerDrag) return;
    this._pointerDrag = createPointerDrag(this.bodyEl, {
      longPressMs: () => this.state?.touchDragDelay ?? 300,
      // A finger moving > 10px before the long press = a scroll; a mouse / pen drags after 5px.
      threshold: () => (this._pressEvent?.pointerType === 'touch' ? 10 : 5),
      autoScroll: { isEnabled: () => !this.state?.isPointerDragDenied },
      getSource: (target, event) => {
        this._pressEvent = null;
        const state = this.state;
        if (!state || this._isDisabled || this._isReadonly || state.dragDropMode === 'none') return null;
        // Controls inside a row keep their own press (checkbox, toggle, info button, an input).
        if (target.closest('input, textarea, select, button, [contenteditable="true"], .wtv__toggle')) return null;
        const row = target.closest('.wtv__node') as HTMLElement | null;
        const node = state.getNodeByPath(row?.getAttribute('data-tree-path') ?? '');
        if (!row || !node) return null;
        if (event.pointerType !== 'touch') {
          // Mouse / pen: the grab handle is the content pill of a draggable node (the indent
          // gutter doesn't drag). A locked node simply doesn't drag — no reaction.
          if (!target.closest('.wtv__node-content') || !state.getNodeIsDraggable(node)) return null;
        }
        this._pressEvent = event;
        return row;
      },
      onStart: ({ source, x, y }) => {
        const node = this.state?.getNodeByPath(source.getAttribute('data-tree-path') ?? '');
        if (!node || !this._pressEvent) return false;
        return this.state!.pointerDragStart(node, x, y, this._pressEvent);
      },
      onMove: ({ target, x, y, event }) =>
        this.state?.pointerDragMove(target, x, y, event instanceof PointerEvent ? event : null),
      onDrop: ({ target, x, y, event }) => {
        void this.state?.pointerDragDrop(target, x, y, event as PointerEvent);
      },
      onCancel: () => this.state?.pointerDragCancel(),
    });
  }

  /** RAF-throttled virtual scroll handler — uses fast synchronous path */

  private _handleVirtualScroll = () => {
    if (!this.bodyEl) return;
    this._vsFrame.schedule();
  };

  /**
   * Fast synchronous virtual scroll update.
   * Bypasses the state's queueMicrotask + state-change event pipeline.
   * Computes the visible window, updates DOM positioning, and reconciles
   * only the node list — skips drag/drop/context-menu updates.
   */
  private _performScrollUpdate(): void {
    if (!this.bodyEl || !this.state || !this.vsSpacerEl || !this.vsContentEl || !this.lastSnapshot) return;

    const scrollTop = this.bodyEl.scrollTop;
    const ctrl = this.state;
    const rowHeight = ctrl.resolvedRowHeight;
    const allNodes = ctrl.allVisibleFlatNodes;

    // Core computeVirtualRange (SPEC §12.26) through the engine, with the live scroll position.
    const { start: startIndex, end: endIndex } = ctrl.virtualRange(
      allNodes.length, scrollTop, this.bodyEl.clientHeight || ctrl.virtualViewportHeightPx);

    // Early exit — window hasn't changed
    if (startIndex === this._vsLastStartIndex && endIndex === this._vsLastEndIndex) {
      ctrl.syncVirtualScrollTop(scrollTop);
      return;
    }
    this._vsLastStartIndex = startIndex;
    this._vsLastEndIndex = endIndex;

    const offsetY = startIndex * rowHeight;
    const totalHeight = allNodes.length * rowHeight;

    // Update spacer/content positioning synchronously
    this.vsSpacerEl.style.height = `${totalHeight}px`;
    this.vsContentEl.style.transform = `translateY(${offsetY}px)`;

    // Reconcile nodes with the sliced window
    const slicedNodes = allNodes.slice(startIndex, endIndex);
    this.lastSnapshot.flatNodesToRender = slicedNodes;
    this.lastSnapshot.virtualTotalHeight = totalHeight;
    this.lastSnapshot.virtualStartIndex = startIndex;
    this.lastSnapshot.virtualOffsetY = offsetY;
    this._reconcileNodes(this.lastSnapshot);

    // Sync the state silently (so next getSnapshot() has correct scrollTop)
    ctrl.syncVirtualScrollTop(scrollTop);
  }

  private _attachBodyListeners() {
    if (!this.bodyEl) return;
    // Enable keyboard focus
    this.bodyEl.setAttribute('tabindex', '0');
    this.bodyEl.style.outline = 'none';
    this.bodyEl.addEventListener('click', this._handleBodyClick);
    this.bodyEl.addEventListener('keydown', this._handleBodyKeydown);
    this.bodyEl.addEventListener('contextmenu', this._handleBodyContextMenu);
    this._attachPointerDrag();
  }

  private _detachBodyListeners() {
    if (!this.bodyEl) return;
    this.bodyEl.removeEventListener('click', this._handleBodyClick);
    this.bodyEl.removeEventListener('keydown', this._handleBodyKeydown);
    this.bodyEl.removeEventListener('contextmenu', this._handleBodyContextMenu);
    this._pointerDrag?.destroy();
    this._pointerDrag = null;
    this.bodyEl.removeEventListener('scroll', this._handleVirtualScroll);
  }

  // ── Virtual scroll structure ───────────────────────────────────────

  private _ensureVirtualScrollStructure(snapshot: TreeViewStateSnapshot<T>): void {
    if (!this.bodyEl) return;

    if (snapshot.isVirtualScrollEnabled && !this.vsSpacerEl) {
      // Enable virtual scroll: add class, create spacer + content wrapper
      this.bodyEl.classList.add('wtv__virtual-scroll');
      this.bodyEl.style.height = snapshot.virtualScrollContainerHeight;

      this.vsSpacerEl = document.createElement('div');
      this.vsSpacerEl.className = 'wtv__vs-spacer';
      this.vsSpacerEl.style.position = 'relative';
      this.vsSpacerEl.style.width = '100%';

      this.vsSpacerEl.setAttribute('role', 'none');

      this.vsContentEl = document.createElement('div');
      this.vsContentEl.className = 'wtv__vs-content';
      this.vsContentEl.setAttribute('role', 'none');
      this.vsContentEl.style.willChange = 'transform';

      // Move existing children into vsContentEl
      while (this.bodyEl.firstChild) {
        this.vsContentEl.appendChild(this.bodyEl.firstChild);
      }

      this.vsSpacerEl.appendChild(this.vsContentEl);
      this.bodyEl.appendChild(this.vsSpacerEl);

      // Attach scroll listener
      this.bodyEl.addEventListener('scroll', this._handleVirtualScroll, { passive: true });
      this._vsMeasured = false;
      this._vsLastStartIndex = -1;
      this._vsLastEndIndex = -1;

    } else if (!snapshot.isVirtualScrollEnabled && this.vsSpacerEl) {
      // Disable virtual scroll: tear down structure
      this.bodyEl.removeEventListener('scroll', this._handleVirtualScroll);
      this.bodyEl.classList.remove('wtv__virtual-scroll');
      this.bodyEl.style.height = '';

      // Move children back from vsContentEl to bodyEl
      if (this.vsContentEl) {
        while (this.vsContentEl.firstChild) {
          this.bodyEl.appendChild(this.vsContentEl.firstChild);
        }
      }
      this.vsSpacerEl.remove();
      this.vsSpacerEl = null;
      this.vsContentEl = null;
      this._vsMeasured = false;
      this._vsLastStartIndex = -1;
      this._vsLastEndIndex = -1;
    }
  }

  private _updateVirtualScrollPositioning(snapshot: TreeViewStateSnapshot<T>): void {
    if (!snapshot.isVirtualScrollEnabled || !this.vsSpacerEl || !this.vsContentEl || !this.bodyEl) return;

    // Update container height if changed
    if (this.bodyEl.style.height !== snapshot.virtualScrollContainerHeight) {
      this.bodyEl.style.height = snapshot.virtualScrollContainerHeight;
    }
    // The window maths needs pixels; the height is any CSS length (`30rem`, `50vh`).
    this.state?.setVirtualViewportHeight(this.bodyEl.clientHeight);

    // Update spacer height (creates the correct scrollbar size)
    this.vsSpacerEl.style.height = `${snapshot.virtualTotalHeight}px`;

    // Position the content wrapper at the correct offset
    this.vsContentEl.style.transform = `translateY(${snapshot.virtualOffsetY}px)`;
  }

  private _autoMeasureRowHeight(): void {
    if (!this.state || this._vsMeasured) return;

    const renderTarget = this.vsContentEl ?? this.bodyEl;
    if (!renderTarget) return;

    const firstNode = renderTarget.querySelector('.wtv__node') as HTMLElement;
    if (firstNode) {
      const height = firstNode.getBoundingClientRect().height;
      if (height > 0) {
        this._vsMeasured = true;
        this.state.setMeasuredRowHeight(height);
      }
    }
  }

  // ── State change handler ────────────────────────────────────────────

  private _handleStateChange(snapshot: TreeViewStateSnapshot<T>): void {
    if (!this.bodyEl || !this.state) return;

    // A drag from another tree finds this one under the pointer by the container's tree id
    // (state._resolveDropTarget → the tree registry).
    if (this.container && this.container.getAttribute('data-tree-id') !== this.state.treeId) {
      this.container.setAttribute('data-tree-id', this.state.treeId);
    }

    // Invalidate scroll fast-path cache — the underlying data may have changed
    // (filter, expand, collapse, data load), so the next scroll must not early-exit
    this._vsLastStartIndex = -1;
    this._vsLastEndIndex = -1;

    // Manage virtual scroll DOM structure
    this._ensureVirtualScrollStructure(snapshot);

    // Reconcile nodes
    this._reconcileNodes(snapshot);
    // An open tooltip tracks the state change that produced this snapshot.
    this._refreshVisibleTooltips();

    // Virtual scroll: update spacer/content positioning
    this._updateVirtualScrollPositioning(snapshot);

    // Virtual scroll: auto-measure row height from first rendered node
    if (snapshot.isVirtualScrollEnabled && !this._vsMeasured) {
      this._autoMeasureRowHeight();
    }

    // Update drag CSS classes
    this._updateDragClasses(snapshot);

    // Update drop zones for floating mode
    this._updateDropZones(snapshot);

    // Context menu
    this._updateContextMenu(snapshot);

    // Loading overlay
    if (this.loadingEl) {
      this.loadingEl.style.display = snapshot.isLoading ? 'flex' : 'none';
    }
    this._syncLoader(!!snapshot.isLoading);

    // Body class
    if (this.bodyEl) {
      if (this.lastSnapshot?.bodyClass) {
        this.bodyEl.classList.remove(this.lastSnapshot.bodyClass);
      }
      if (snapshot.bodyClass) {
        this.bodyEl.classList.add(snapshot.bodyClass);
      }
    }

    // Whole-tree drop-zone engaged outline (isTreeDropZoneEnabled): light the
    // container while a drag hovers it (isDropPlaceholderActive is set by the
    // container-level tree-zone dragover handler).
    if (this.container) {
      const zoneActive = !!this.state?.isTreeDropZoneEnabled && snapshot.isDropPlaceholderActive;
      this.container.classList.toggle('wtv__tree-drop-zone--active', zoneActive);
    }

    this.lastSnapshot = snapshot;
  }

  private _handleConfigChange(nodeConfig: NodeConfig): void {
    this.log.RENDER.debug('config-change → full render, focusedNodeClass =', JSON.stringify(nodeConfig.focusedNodeClass));
    this.lastNodeConfig = nodeConfig;
    // Re-render toggle icons if icon classes changed
    if (this.state) {
      this._fullRender(this.state.getSnapshot());
    }
  }

  // ── Node reconciliation ─────────────────────────────────────────────

  /** Get the element where node elements are rendered (vsContentEl in virtual scroll, bodyEl otherwise) */
  private get _renderTarget(): HTMLElement | null {
    return this.vsContentEl ?? this.bodyEl;
  }

  private _reconcileNodes(snapshot: TreeViewStateSnapshot<T>): void {
    const target = this._renderTarget;
    if (!target || !this.state) return;

    const nodes = snapshot.flatNodesToRender;
    const newKeys = new Set<string>();

    // Handle empty tree
    if (nodes.length === 0) {
      this._renderEmpty(snapshot);
      this._syncActiveDescendant(snapshot);
      return;
    }

    // Remove empty state if it exists
    const emptyState = target.querySelector('.wtv__empty-state');
    if (emptyState) emptyState.remove();
    const emptyZone = target.querySelector('.wtv__empty-zone');
    if (emptyZone) emptyZone.remove();

    if (this.bodyEl) setAttr(this.bodyEl, 'aria-multiselectable', this.state.selectionMode === 'multiple' ? 'true' : null);
    const positions = this._ariaPositionMap();

    // Build/update nodes
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const key = this._nodeKey(node);
      newKeys.add(key);

      let el = this.nodeElements.get(key);
      if (el && this.nodeOfElement.get(el) !== node) {
        // Another node now lives at this path — rebuild the row from scratch.
        el.remove();
        this.nodeElements.delete(key);
        this._destroyTooltip(key);
        el = undefined;
      }
      if (el) {
        // Always keep data-tree-path in sync (moveNode changes paths)
        const currentPath = el.getAttribute('data-tree-path');
        if (currentPath !== node.path) {
          el.setAttribute('data-tree-path', node.path);
          // Path changed — force full update regardless of _rev
          this._updateNodeElement(el, node, snapshot);
        } else {
          // Update existing node if _rev, expanded, or hasChildren changed.
          // hasChildren isn't captured by _rev (adding/removing a child doesn't
          // bump the parent's _rev), so a leaf↔folder transition would otherwise
          // be skipped and leave a stale toggle marker.
          const existingRev = el.getAttribute('data-rev');
          const existingExpanded = el.getAttribute('data-expanded');
          const existingHasChildren = el.getAttribute('data-has-children');
          // Focus/selection move between nodes WITHOUT bumping this node's _rev, so
          // a row that just lost focus/selection must still be re-rendered to drop
          // its stale focusedNodeClass / selectedNodeClass (see _createNodeElement).
          const existingFocused = el.getAttribute('data-focused');
          const existingSelected = el.getAttribute('data-selected');
          // Cut (dimmed) state isn't captured by _rev either (NOTES #6).
          const existingCut = el.getAttribute('data-cut');
          if (
            existingRev !== String(node._rev) ||
            existingExpanded !== String(!!node.isExpanded) ||
            existingHasChildren !== String(!!node.hasChildren) ||
            existingFocused !== String(snapshot.focusedNode?.path === node.path) ||
            existingSelected !== String(snapshot.selectedPaths.has(node.path)) ||
            existingCut !== String(snapshot.cutPaths.has(node.path))
          ) {
            this._updateNodeElement(el, node, snapshot);
          }
        }
        // Row indent
        el.style.paddingInlineStart = `calc((${node.level} - 1) * ${snapshot.flatIndentSize})`;
        // Row animation: the reveal was cleared → drop the modifier (never ADD it to a
        // reused row — only a row created during the reveal plays).
        if (!snapshot.revealedPaths.has(node.path)) el.classList.remove('wtv__node--opening');
      } else {
        // Create new node
        el = this._createNodeElement(node, snapshot);
        this.nodeElements.set(key, el);
        this.nodeOfElement.set(el, node);
      }

      this._applyRowAria(el, node, snapshot, positions);

      // Ensure correct order — ensure the element is parented to the render target
      const currentChild = target.children[i];
      if (currentChild !== el) {
        target.insertBefore(el, currentChild || null);
      }
    }

    // Remove absent nodes (nodes scrolled out of virtual window)
    for (const [key, el] of this.nodeElements) {
      if (!newKeys.has(key)) {
        el.remove();
        this.nodeElements.delete(key);
        this._destroyTooltip(key);
      }
    }
    this._syncActiveDescendant(snapshot);
  }

  // ── ARIA tree ───────────────────────────────────────────────────────

  /** The rendered `role="treeitem"` rows, in order (core `getItems`). */
  private _ariaRows(): HTMLElement[] {
    const target = this._renderTarget;
    if (!target) return [];
    const rows: HTMLElement[] = [];
    for (const child of target.children) {
      if (child.classList.contains('wtv__node')) rows.push(child as HTMLElement);
    }
    return rows;
  }

  /** `aria-activedescendant` follows the focused node's row; none when it isn't rendered
   *  (a virtual row scrolled out, a collapsed branch, the empty tree). */
  private _syncActiveDescendant(snapshot: TreeViewStateSnapshot<T>): void {
    const ad = this._activeDescendant;
    if (!ad) return;
    const path = snapshot.focusedNode?.path;
    const row = path != null ? this.nodeElements.get(this._findKeyByPath(path)) : undefined;
    const next = row?.isConnected ? row : null;
    if (next !== ad.active) ad.setActive(next);
  }

  /** `[posinset, setsize]` per path over every visible node (not just the rendered virtual
   *  window): siblings are the visible children of the same parent (search-filter aware).
   *  Rebuilt only when the tree's cached visible list changes. */
  private _ariaPositionMap(): Map<string, [number, number]> {
    const all = this.state?.tree?.visibleFlatNodes ?? [];
    if (this._ariaPositions && this._ariaPositionsOf === all) return this._ariaPositions;
    const counts = new Map<string, number>();
    const map = new Map<string, [number, number]>();
    for (const n of all) {
      const parent = n.parentPath ?? '';
      const pos = (counts.get(parent) ?? 0) + 1;
      counts.set(parent, pos);
      map.set(n.path, [pos, 0]);
    }
    for (const n of all) {
      const entry = map.get(n.path)!;
      entry[1] = counts.get(n.parentPath ?? '') ?? entry[0];
    }
    this._ariaPositions = map;
    this._ariaPositionsOf = all;
    return map;
  }

  /** The row's `role="treeitem"` + state: level, set position, expanded (parents only),
   *  selected, checked (`mixed` = indeterminate; only on a row with a checkbox). */
  private _applyRowAria(
    el: HTMLElement,
    node: LTreeNode<T>,
    snapshot: TreeViewStateSnapshot<T>,
    positions: Map<string, [number, number]>
  ): void {
    setAttr(el, 'role', 'treeitem');
    setAttr(el, 'aria-level', node.level != null ? String(node.level) : null);
    const pos = positions.get(node.path);
    setAttr(el, 'aria-posinset', pos ? String(pos[0]) : null);
    setAttr(el, 'aria-setsize', pos ? String(pos[1]) : null);
    setAttr(el, 'aria-expanded', node.hasChildren ? String(!!node.isExpanded) : null);
    setAttr(el, 'aria-selected', String(snapshot.selectedPaths.has(node.path)));
    const hasCheckbox = !!this.lastNodeConfig?.isCheckboxesShown && node.isSelectable;
    setAttr(
      el,
      'aria-checked',
      !hasCheckbox ? null : node.visualState === 'indeterminate' ? 'mixed' : String(snapshot.allCheckedPaths.has(node.path))
    );
  }

  private _renderEmpty(snapshot: TreeViewStateSnapshot<T>): void {
    const target = this._renderTarget;
    if (!target) return;

    // Clear all node elements
    for (const [, el] of this.nodeElements) {
      el.remove();
    }
    this.nodeElements.clear();
    this._destroyAllTooltips();

    // No nodes at all → `messages.noData`; nodes exist but the search filter hid them all → `messages.noResults`.
    this._emptyLabelKey = snapshot.hasNodes ? 'messages.noResults' : 'messages.noData';
    // Show empty zone (drop target during drag) or empty state (informational)
    const emptyState = `${snapshot.isDragInProgress}|${snapshot.isDropPlaceholderActive}|${snapshot.isLoading}|${snapshot.isArmed}`;
    if (this._lastEmptyState !== emptyState) {
      this.log.RENDER.debug('render empty', { isDragInProgress: snapshot.isDragInProgress, isDropPlaceholderActive: snapshot.isDropPlaceholderActive, isLoading: snapshot.isLoading });
      this._lastEmptyState = emptyState;
    }
    // Show the empty drop zone when a drag is over an empty tree, while armed
    // (highlight-on-page-drag: a node drag anywhere on the page), OR permanently
    // when isEmptyDropPlaceholderShown keeps it up so a Ctrl/Cmd+V can land.
    const showZone =
      (snapshot.isDragInProgress && snapshot.isDropPlaceholderActive) ||
      snapshot.isArmed ||
      !!this.config.isEmptyDropPlaceholderShown;

    if (showZone && !snapshot.isLoading) {
      target.style.minHeight = '';
      let zone = target.querySelector('.wtv__empty-zone') as HTMLElement | null;
      if (!zone) {
        const emptyState = target.querySelector('.wtv__empty-state');
        if (emptyState) emptyState.remove();

        zone = document.createElement('div');
        zone.className = 'wtv__empty-zone';
        this._fillEmptyZone(zone);
        // Make the zone focus the tree body on hover/pointerdown so a Ctrl/Cmd+V
        // (routed through the body keydown listener) pastes into the empty tree.
        if (this.config.isEmptyDropPlaceholderShown) {
          zone.tabIndex = this._isDisabled ? -1 : 0;
          const grabFocus = () => { if (!this._isDisabled) this.bodyEl?.focus(); };
          zone.addEventListener('pointerenter', grabFocus);
          zone.addEventListener('pointerdown', grabFocus);
        }
        target.appendChild(zone);
      }
      // Engaged feedback while a drag hovers the zone (HTML5 drag suppresses :hover).
      zone.classList.toggle('wtv__empty-zone--active', snapshot.isDropPlaceholderActive);
    } else if (snapshot.isLoading) {
      // Loading active — don't show empty state underneath the overlay
      // Set min-height so the absolute loading overlay has room to display
      target.style.minHeight = 'var(--wtv-tree-min-height)';
      const zone = target.querySelector('.wtv__empty-zone');
      if (zone) zone.remove();
      const emptyState = target.querySelector('.wtv__empty-state');
      if (emptyState) emptyState.remove();
    } else {
      target.style.minHeight = '';
      const zone = target.querySelector('.wtv__empty-zone');
      if (zone) zone.remove();

      // Reuse existing empty state to avoid DOM removal during active drags
      // (removing and recreating the element kills browser drag tracking)
      let emptyState = target.querySelector('.wtv__empty-state');
      if (!emptyState) {
        emptyState = document.createElement('div');
        emptyState.className = 'wtv__empty-state';
        target.appendChild(emptyState);
      }
      this._renderEmptyState(emptyState as HTMLElement);
    }
  }

  /**
   * (Re)build the toggle-icon class list from scratch based on node.hasChildren.
   * Called by BOTH _createNodeElement and updateNode so a node crossing the
   * leaf↔folder line always gets the right marker. updateNode used to only touch
   * the `expanded` class when hasChildren was already true, so a node that GAINED
   * children (e.g. a cross-tree child-drop) kept its empty --leaf-none slot (no
   * disclosure glyph), and a folder that LOST all its children (a move out) kept a
   * stale --expand glyph. Resetting className first clears any stale icon/expanded
   * classes.
   */
  /** Row-level loading state while an async beforeExpandCallback is pending: `aria-busy` +
   *  `data-loading` on the row (the toggle shows the spinner, see _applyToggleClasses). */
  private _applyExpandPending(el: HTMLElement, node: LTreeNode<T>): void {
    if (this.state?.isExpandPending(node.path)) {
      el.setAttribute('aria-busy', 'true');
      el.setAttribute('data-loading', '');
    } else {
      el.removeAttribute('aria-busy');
      el.removeAttribute('data-loading');
    }
  }

  private _applyToggleClasses(toggle: HTMLElement, node: LTreeNode<T>): void {
    const nodeConfig = this.lastNodeConfig;
    toggle.className = 'wtv__toggle-icon';
    if (node.hasChildren) {
      // ONE canonical class (`--expand`) for every expandable node + the `--expanded`
      // state marker. Rotate vs swap is a pure-CSS concern (variables.css / tree.css):
      // rotate mode spins the glyph via --wtv-icon-rotate-*, swap mode repaints its
      // mask to --wtv-icon-collapse.
      toggle.classList.add('wtv__toggle-icon--expand');
      if (node.isExpanded) {
        toggle.classList.add('wtv__toggle-icon--expanded');
      }
      toggle.classList.add('wtv__clickable');
      // Async beforeExpandCallback in flight (lazy load): spinner in place of the glyph.
      if (this.state?.isExpandPending(node.path)) toggle.classList.add('wtv__toggle-icon--loading');
    } else {
      // Leaf node: just the leaf spacer/marker. The per-node icon is NO LONGER folded
      // into the toggle slot — it renders as a dedicated .wtv__node-icon element on every
      // node (branch + leaf), via _applyNodeIcon. See iconMember / renderIconCallback.
      addClasses(toggle, nodeConfig?.leafIconClass || 'wtv__toggle-icon--leaf-none');
    }
  }

  /** The markup last written into each `.wtv__node-icon` wrapper. */
  private _iconHtml = new WeakMap<HTMLElement, string>();

  /**
   * Create / refresh / remove the dedicated per-node icon wrapper (`<span class="wtv__node-icon">`)
   * in a row, for EVERY node with an icon value. VALUE from iconMember / iconCallback; the markup
   * inside is core `renderIcon` (via `renderNodeIcon`: markup → built-in name → renderIconCallback →
   * page-wide hook → icon-font `<i class="wtv__icon …">` → text). COLOR from iconColorMember /
   * iconColorCallback on the wrapper. No icon → no wrapper, unless shouldAlignNodeIcons reserves
   * the column. Sits between the toggle/checkbox and content.
   */
  private _applyNodeIcon(row: HTMLElement, node: LTreeNode<T>, ctx: NodeRenderContext): void {
    const cfg = this.lastNodeConfig;
    const hasSupport = !!this.state?.hasIconSupport;
    const value = hasSupport ? this.state!.getNodeIcon(node) : null;
    const html = value ? (this.config.renderNodeIcon?.(value, node, ctx) ?? '') : '';
    const align = !!cfg?.shouldAlignNodeIcons;
    const shouldShow = !!html || (align && hasSupport);

    let iconEl = row.querySelector(':scope > .wtv__node-icon') as HTMLElement | null;
    if (!shouldShow) {
      iconEl?.remove();
      return;
    }
    if (!iconEl) {
      iconEl = document.createElement('span');
      const content = row.querySelector(':scope > .wtv__node-content');
      row.insertBefore(iconEl, content);
    }

    const className = 'wtv__node-icon' + (align ? ' wtv__node-icon--aligned' : '');
    if (iconEl.className !== className) iconEl.className = className;
    // Touch the DOM only on a change (the diff reconciler calls this on every pass).
    if (this._iconHtml.get(iconEl) !== html) {
      iconEl.innerHTML = html;
      this._iconHtml.set(iconEl, html);
    }
    const color = this.state?.getNodeIconColor ? this.state.getNodeIconColor(node) : null;
    if (color) iconEl.style.color = color;
    else iconEl.style.removeProperty('color');
  }

  /**
   * Build the canonical checkbox: a single styled native <input class="wtv__checkbox">
   * whose ::after renders the checkmark/dash mask (see tree.css). The <input> IS the
   * box (appearance:none) — the same single-element contract as web-multiselect's
   * .ms__checkbox and svelte-treeview's .stv__checkbox, themeable via --base-icon-check
   * / --base-icon-indeterminate. Indeterminate is a MODIFIER CLASS + aria-checked="mixed"
   * (NOT the native .indeterminate DOM property) so it survives the diff reconciler +
   * virtual-scroll recycling. The delegated click handler preventDefaults so only the
   * state toggles it.
   */
  private _buildCheckbox(checked: boolean, indeterminate: boolean): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'wtv__checkbox';
    input.tabIndex = -1;
    this._syncCheckboxState(input, checked, indeterminate);
    return input;
  }

  /**
   * Apply checked / indeterminate to a .wtv__checkbox <input>. Indeterminate wins:
   * it shows the dash (modifier class + aria-checked="mixed") and leaves the native
   * `checked` false so the dash glyph, not the tick, renders.
   */
  private _syncCheckboxState(
    input: HTMLInputElement,
    checked: boolean,
    indeterminate: boolean
  ): void {
    input.classList.toggle('wtv__checkbox--indeterminate', indeterminate);
    input.checked = checked && !indeterminate;
    if (indeterminate) {
      input.setAttribute('aria-checked', 'mixed');
    } else {
      input.removeAttribute('aria-checked');
    }
  }

  private _createNodeElement(node: LTreeNode<T>, snapshot: TreeViewStateSnapshot<T>): HTMLElement {
    const el = document.createElement('div');
    el.className = 'wtv__node';
    // Row animation: a row the last expand revealed plays the enter keyframes (tree.css).
    if (snapshot.revealedPaths.has(node.path)) el.classList.add('wtv__node--opening');
    el.setAttribute('data-tree-path', node.path);
    el.setAttribute('data-rev', String(node._rev));
    el.setAttribute('data-expanded', String(!!node.isExpanded));
    this._applyExpandPending(el, node);
    // hasChildren is a DERIVED visual property not captured by _rev — adding/
    // removing a child doesn't bump the parent's _rev. Track it like data-expanded
    // so the reconcile-skip check (see updateNodes) re-renders a node that crossed
    // the leaf↔folder line and its toggle marker gets rebuilt.
    el.setAttribute('data-has-children', String(!!node.hasChildren));
    // Focus/selection aren't captured by _rev — moving focus/selection to ANOTHER
    // node doesn't bump THIS node's _rev, so the reconcile-skip check (see
    // updateNodes) must track them as data-attributes (like data-expanded) or a row
    // that LOSES focus/selection is never re-rendered and keeps its stale
    // focusedNodeClass / selectedNodeClass.
    el.setAttribute('data-focused', String(snapshot.focusedNode?.path === node.path));
    el.setAttribute('data-selected', String(snapshot.selectedPaths.has(node.path)));
    el.setAttribute('data-cut', String(snapshot.cutPaths.has(node.path)));

    // Row id from the PATH (unique per tree), never node.id (a pasted copy keeps its
    // source id) — aria-activedescendant and any id lookup must hit exactly one row.
    if (this.state) el.id = rowDomId(this.state.treeId, node.path);

    // Row indent
    el.style.paddingInlineStart = `calc((${node.level} - 1) * ${snapshot.flatIndentSize})`;

    const nodeConfig = this.lastNodeConfig;

    // Node row
    const row = document.createElement('div');
    row.className = 'wtv__node-row';

    // Toggle icon
    const toggle = document.createElement('span');
    this._applyToggleClasses(toggle, node);

    row.appendChild(toggle);

    // Checkbox (between toggle and content). Rendered only when
    // isCheckboxesShown is true and the node is selectable.
    if (nodeConfig?.isCheckboxesShown && node.isSelectable) {
      row.appendChild(
        this._buildCheckbox(
          snapshot.allCheckedPaths.has(node.path),
          node.visualState === 'indeterminate'
        )
      );
    }

    // Node content
    const content = document.createElement('div');
    content.className = 'wtv__node-content';

    // Draggable + cut live on the CONTENT (the pill), not the outer .wtv__node — every
    // wtv__node-content--* class sits on the element it's named for. The pointer drag's grab
    // handle is the content pill too (excludes the indent gutter / toggle); see _attachPointerDrag.
    if (this.state?.dragDropMode !== 'none' && this.state?.getNodeIsDraggable(node)) {
      content.classList.add('wtv__node-content--draggable');
    }
    if (snapshot.cutPaths.has(node.path)) {
      content.classList.add('wtv__node-content--cut');
    }

    // Selected / focus state — applied to the row content so the styling
    // affects only the visible row, not the children indentation area below.
    // Selected is read from the state-owned set (snapshot), NOT node.isSelected:
    // the set survives a data rebuild, so the selection isn't lost when a config change
    // re-inserts the data (web-grid-style state-off-nodes).
    if (snapshot.selectedPaths.has(node.path)) {
      // `--selected` is a FALLBACK: only apply it when no selectedNodeClass
      // is configured, so the marker's default look never fights a custom class.
      if (nodeConfig?.selectedNodeClass) {
        content.classList.add(nodeConfig.selectedNodeClass);
      } else {
        content.classList.add('wtv__node-content--selected');
      }
    }
    if (snapshot.focusedNode?.path === node.path) {
      // `--focused` is the always-present pure hook; `--focused-default` carries the
      // visible default (inset ring) and is a FALLBACK — only when no focusedNodeClass.
      content.classList.add('wtv__node-content--focused');
      if (nodeConfig?.focusedNodeClass) {
        content.classList.add(nodeConfig.focusedNodeClass);
      } else {
        content.classList.add('wtv__node-content--focused-default');
      }
    }
    // Checked rows carry no default row treatment (the checkbox is the signal);
    // style them via the `checkedNodeClass` prop.
    if (node.isChecked && nodeConfig?.checkedNodeClass) {
      content.classList.add(nodeConfig.checkedNodeClass);
    }

    if (nodeConfig?.clickBehavior !== 'expand' && node.hasChildren) {
      content.classList.add('wtv__clickable');
    }

    const ctx = this._buildRenderContext(node, snapshot);

    // Custom or default content
    this._renderNodeContent(content, node, ctx);

    row.appendChild(content);
    el.appendChild(row);

    // Per-node icon element (between toggle/checkbox and content — inserts before content).
    this._applyNodeIcon(row, node, ctx);
    this._applyCustomNodeClasses(el, content, node);
    this._applyTooltip(content, node);
    return el;
  }

  /** Apply the data-driven nodeClass / nodeContentClass hooks to a row.
   *  Tracks the previously-applied classes in `data-*` attributes so a
   *  re-render removes stale classes before adding the new ones (the diff
   *  reconciler reuses row elements rather than recreating them). */
  private _applyCustomNodeClasses(el: HTMLElement, content: HTMLElement | null, node: LTreeNode<T>): void {
    const cfg = this.lastNodeConfig;
    // Outer .wtv__node
    const prevNodeCls = el.dataset.wtvNodeClass;
    if (prevNodeCls) { removeClasses(el, prevNodeCls); delete el.dataset.wtvNodeClass; }
    const nodeCls = cfg?.nodeClass?.(node);
    if (nodeCls) { addClasses(el, nodeCls); el.dataset.wtvNodeClass = nodeCls; }
    // Inner .wtv__node-content
    if (content) {
      const prevContentCls = content.dataset.wtvContentClass;
      if (prevContentCls) { removeClasses(content, prevContentCls); delete content.dataset.wtvContentClass; }
      const contentCls = cfg?.nodeContentClass?.(node);
      if (contentCls) { addClasses(content, contentCls); content.dataset.wtvContentClass = contentCls; }
    }
  }

  /** Row key: the node's path (unique by construction; ids may repeat — NOTES #8). */
  private _nodeKey(node: LTreeNode<T>): string {
    return node.path;
  }

  /** Build the NodeRenderContext for the render callbacks: device + container + live state. */
  private _buildRenderContext(node: LTreeNode<T>, snapshot: TreeViewStateSnapshot<T>): NodeRenderContext {
    return {
      deviceClass: this._deviceClass,
      container: { width: this._containerBox.width, height: this._containerBox.height },
      isExpanded: !!node.isExpanded,
      isChecked: snapshot.allCheckedPaths.has(node.path),
      isSelected: snapshot.selectedPaths.has(node.path),
      isFocused: snapshot.focusedNode?.path === node.path,
      level: node.level ?? 0,
      hasChildren: !!node.hasChildren
    };
  }

  /** Create / tear down the hover-focus tooltip for a row. The direct analog of
   *  web-multiselect's attachOptionTooltips, built on the shared core createTooltip
   *  (portal, autoUpdate, shouldFollowCursor, data-theme inherit). The handle is made
   *  whenever tooltips are on and a callback is set; the CONTENT is resolved from the
   *  callback at each show (`_fillTooltip`), so it reflects the node's live state.
   *  Empty content ⇒ the tooltip doesn't stay up. Mounts into the shadow container so
   *  it inherits the injected --wtv-tooltip-* tokens + data-theme. */
  private _applyTooltip(triggerEl: HTMLElement | null, node: LTreeNode<T>): void {
    const key = this._nodeKey(node);
    this._destroyTooltip(key);
    const cfg = this.lastNodeConfig;
    if (!triggerEl || !cfg?.isNodeTooltipsShown || !cfg.getNodeTooltipCallback) return;
    const handle: TooltipHandle = createTooltip({
      trigger: triggerEl,
      container: this.container ?? document.body,
      content: '',
      placement: cfg.tooltipPlacement,
      offset: cfg.tooltipOffset,
      delay: cfg.tooltipDelay,
      shouldFollowCursor: cfg.shouldTooltipFollowCursor,
      cssClass: 'wtv__tooltip',
      visibleClass: 'wtv__tooltip--visible',
      // Runs right before the tooltip becomes visible: resolve the content NOW. No
      // content → `false` cancels the show.
      beforeShowCallback: () => this._fillTooltip(key)
    });
    this.tooltips.set(key, handle);
    this.tooltipNodes.set(key, node);
  }

  /** Resolve a tooltip's content from the callback against its node's current state and
   *  put it into the tooltip element. Returns false when there's nothing to show. */
  private _fillTooltip(key: string): boolean {
    const handle = this.tooltips.get(key);
    const node = this.tooltipNodes.get(key);
    const cb = this.lastNodeConfig?.getNodeTooltipCallback;
    if (!handle || !node || !cb) return false;
    const content = cb(node);
    if (content == null || (typeof content === 'string' && content.trim() === '')) {
      handle.element.replaceChildren();
      return false;
    }
    if (typeof content === 'string') handle.element.textContent = content;
    else handle.element.replaceChildren(content);
    return true;
  }

  /** A state change (selection / check / expand / focus / data) while a tooltip is up:
   *  re-resolve its content so it never shows stale state; nothing left → hide. */
  private _refreshVisibleTooltips(): void {
    for (const [key, handle] of this.tooltips) {
      if (handle.isVisible && !this._fillTooltip(key)) handle.hide();
    }
  }

  private _destroyTooltip(key: string): void {
    const h = this.tooltips.get(key);
    if (h) {
      h.destroy();
      this.tooltips.delete(key);
    }
    this.tooltipNodes.delete(key);
  }

  private _destroyAllTooltips(): void {
    for (const h of this.tooltips.values()) h.destroy();
    this.tooltips.clear();
    this.tooltipNodes.clear();
  }

  private _updateNodeElement(el: HTMLElement, node: LTreeNode<T>, snapshot: TreeViewStateSnapshot<T>): void {
    el.setAttribute('data-rev', String(node._rev));
    el.setAttribute('data-expanded', String(!!node.isExpanded));
    this._applyExpandPending(el, node);
    el.setAttribute('data-has-children', String(!!node.hasChildren));
    el.setAttribute('data-tree-path', node.path);
    el.setAttribute('data-cut', String(snapshot.cutPaths.has(node.path)));

    const nodeConfig = this.lastNodeConfig;
    const ctx = this._buildRenderContext(node, snapshot);

    // Selected / focus / cut state — applied to the row content so the styling
    // affects only the visible row, not the children indentation area below.
    const contentEl = el.querySelector(':scope > .wtv__node-row > .wtv__node-content') as HTMLElement | null;
    if (contentEl) {
      // Cut dimming lives on the content pill (see _createNodeElement).
      contentEl.classList.toggle('wtv__node-content--cut', snapshot.cutPaths.has(node.path));
      // Fallback marker only when no selectedNodeClass is configured (see
      // _createNodeElement) — keeps the default look from fighting a custom class.
      const hasCustomSelected = !!nodeConfig?.selectedNodeClass;
      const isSelected = snapshot.selectedPaths.has(node.path);
      contentEl.classList.toggle('wtv__node-content--selected', isSelected && !hasCustomSelected);
      if (hasCustomSelected) {
        contentEl.classList.toggle(nodeConfig.selectedNodeClass, isSelected);
      }
      const isFocused = snapshot.focusedNode?.path === node.path;
      contentEl.classList.toggle('wtv__node-content--focused', isFocused);
      if (isFocused)
        this.log.RENDER.debug('update focused row', node.path, 'focusedNodeClass =', JSON.stringify(nodeConfig?.focusedNodeClass), 'classes before =', contentEl.className);
      if (nodeConfig?.focusedNodeClass) {
        contentEl.classList.toggle(nodeConfig.focusedNodeClass, isFocused);
        contentEl.classList.remove('wtv__node-content--focused-default');
      } else {
        // Default look (inset outline ring) — only when no custom focus class is configured.
        contentEl.classList.toggle('wtv__node-content--focused-default', isFocused);
      }
      // Checked rows: optional custom class only (checkbox is the default signal).
      if (nodeConfig?.checkedNodeClass) {
        contentEl.classList.toggle(nodeConfig.checkedNodeClass, !!node.isChecked);
      }
      // Keep the dirty-check attributes in sync (see updateNodes + _createNodeElement).
      el.setAttribute('data-focused', String(isFocused));
      el.setAttribute('data-selected', String(isSelected));
    }

    // Sync checkbox checked / indeterminate. The .wtv__checkbox IS the <input>
    // now (single-element contract) — indeterminate is a modifier class, not the
    // native .indeterminate property, so it survives the diff reconciler + virtual
    // scroll recycling.
    if (nodeConfig?.isCheckboxesShown && node.isSelectable) {
      let cb = el.querySelector('.wtv__checkbox') as HTMLInputElement | null;
      if (!cb) {
        // Showed checkboxes was just toggled on — insert one.
        cb = this._buildCheckbox(false, false);
        const toggle = el.querySelector('.wtv__toggle-icon');
        toggle?.after(cb);
      }
      this._syncCheckboxState(
        cb,
        snapshot.allCheckedPaths.has(node.path),
        node.visualState === 'indeterminate'
      );
    } else {
      const cb = el.querySelector('.wtv__checkbox');
      cb?.remove();
    }

    // Update toggle icon — rebuild the full class list so leaf↔folder transitions
    // (a node gaining/losing children via drop, move, or delete) swap the marker
    // correctly, not just the `expanded` state of an already-a-folder node.
    const toggle = el.querySelector('.wtv__toggle-icon') as HTMLElement;
    if (toggle) {
      this._applyToggleClasses(toggle, node);
    }

    // Update content
    const content = el.querySelector('.wtv__node-content') as HTMLElement;
    if (content) {
      // Sync wtv__clickable based on current clickBehavior + hasChildren.
      // Other classes on the content element (wtv__node-content--selected, wtv__node-content--focused,
      // selectedNodeClass, focusedNodeClass) are managed earlier in this
      // function and must not be wiped here.
      const clickable =
        nodeConfig?.clickBehavior !== 'expand' && node.hasChildren;
      content.classList.toggle('wtv__clickable', clickable);

      // Re-render the content (memoized: an unchanged node + render state skips the hook)
      this._renderNodeContent(content, node, ctx);
    }

    // Update draggable — on the content pill (matches _createNodeElement)
    if (content) {
      content.classList.toggle(
        'wtv__node-content--draggable',
        this.state?.dragDropMode !== 'none' && !!this.state?.getNodeIsDraggable(node)
      );
    }

    // Re-apply data-driven nodeClass / nodeContentClass (removes stale classes)
    this._applyCustomNodeClasses(el, content, node);
    // Refresh the per-node icon (value/color track the node's data).
    const row = el.querySelector(':scope > .wtv__node-row') as HTMLElement | null;
    if (row) this._applyNodeIcon(row, node, ctx);
    // The tooltip handle is kept (its content is resolved at show time and refreshed
    // while visible — _refreshVisibleTooltips), so the follow-cursor rect seeded on
    // mouseenter survives a reconcile. Enable/disable, callback, placement and
    // follow-cursor changes are config-level and go through _handleConfigChange →
    // _fullRender, which rebuilds all tooltips anyway.
  }

  // ── Drag CSS classes ────────────────────────────────────────────────

  private _updateDragClasses(snapshot: TreeViewStateSnapshot<T>): void {
    // Dragged node
    for (const [, el] of this.nodeElements) {
      const path = el.getAttribute('data-tree-path');
      const content = el.querySelector('.wtv__node-content') as HTMLElement;
      if (!content) continue;

      // Clear previous drag classes. draggedNodeClass, when set, REPLACES the built-in
      // --dragged visual; remove both so a config switch (custom↔default) can't leave a stale one.
      const draggedClass = this.lastNodeConfig?.draggedNodeClass || 'wtv__node-content--dragged';
      content.classList.remove('wtv__node-content--dragged');
      if (this.lastNodeConfig?.draggedNodeClass) content.classList.remove(this.lastNodeConfig.draggedNodeClass);
      content.classList.remove('wtv__node-content--glow-before', 'wtv__node-content--glow-after', 'wtv__node-content--glow-child', 'wtv__node-content--drop-copy');
      const dragOverClass = this.lastNodeConfig?.dragOverNodeClass;
      if (dragOverClass) {
        content.classList.toggle(dragOverClass, snapshot.isDragInProgress && path === snapshot.hoveredNodeForDropPath);
      }

      // Dragged node style (custom class wins over the built-in modifier). Applied to
      // EVERY top-level path in the drag, so a multi-drag dims the whole set, not just the lead.
      if (path && snapshot.draggedPaths.includes(path)) {
        content.classList.add(draggedClass);
      }

      // Glow mode indicators on hovered node
      if (
        snapshot.isDragInProgress &&
        path === snapshot.hoveredNodeForDropPath &&
        snapshot.activeDropPosition &&
        this.lastNodeConfig?.dropZoneMode === 'glow'
      ) {
        content.classList.add(`wtv__node-content--glow-${snapshot.activeDropPosition}`);
        if (snapshot.currentDropOperation === 'copy') {
          content.classList.add('wtv__node-content--drop-copy');
        }
      }
    }
  }

  // ── Drop zones (floating mode) ─────────────────────────────────────

  /** The floating drop pads' core layer (`createLayer`), open while a drag hovers a row in `floating` mode. */
  private _dropPads: Layer | null = null;

  private _closeDropPads(): void {
    if (!this._dropPads) return;
    this._dropPads.destroy();
    this._dropPads = null;
  }

  /** Lay the pads' layer over the row of `path` (viewport coordinates, re-read on every drag move). */
  private _placeDropPads(path: string): void {
    const row = this.nodeElements.get(this._findKeyByPath(path))?.querySelector('.wtv__node-row') as HTMLElement | null;
    if (row && this._dropPads) this._dropPads.place(row.getBoundingClientRect());
  }

  private _updateDropZones(snapshot: TreeViewStateSnapshot<T>): void {
    if (!this.bodyEl || !this.state || !this.container) return;

    const shouldShow =
      this.lastNodeConfig?.dropZoneMode === 'floating' &&
      snapshot.isDragInProgress &&
      !!snapshot.hoveredNodeForDropPath &&
      this._isActive;

    const existingPath = this._dropPads?.element.getAttribute('data-tree-path') ?? null;

    // If zones already exist for the same hovered path, just update position — don't recreate
    if (shouldShow && this._dropPads && existingPath === snapshot.hoveredNodeForDropPath) {
      this._placeDropPads(existingPath);
      this._markActiveDropPad(snapshot.activeDropPosition);
      return;
    }

    // Remove stale zones (different path or conditions no longer met)
    this._closeDropPads();

    if (!shouldShow) return;

    const hoveredEl = this.nodeElements.get(
      this._findKeyByPath(snapshot.hoveredNodeForDropPath!)
    );
    if (!hoveredEl) return;

    const node = this.state.getNodeByPath(snapshot.hoveredNodeForDropPath!);
    if (!node) return;

    const row = hoveredEl.querySelector('.wtv__node-row') as HTMLElement;
    if (!row) return;

    const allowedPositions = this.state.getNodeAllowedDropPositions(node);
    const layout = this.lastNodeConfig?.dropZoneLayout || 'around';
    const start = this.lastNodeConfig?.dropZoneStart ?? 33;
    const maxWidth = this.lastNodeConfig?.dropZoneMaxWidth ?? '120px';

    // A core layer outside the tree (SPEC §12.29): the tree's / a scroll parent's overflow can't clip
    // the pads (the before / after ones sit just outside the row).
    const pads = openTreeLayer(this.container, {
      className: `wtv__drop-zones wtv__drop-zones--${layout}`,
      zIndexToken: '--wtv-z-index-drop-zones',
    }, this.config.openLayer);
    const zones = pads.element;
    zones.setAttribute('data-tree-path', snapshot.hoveredNodeForDropPath!);
    zones.style.setProperty('--drop-zone-start', typeof start === 'number' ? `${start}%` : start);
    zones.style.setProperty('--drop-zone-max-width', maxWidth);

    const positions: DropPosition[] = allowedPositions || ['before', 'after', 'child'];
    for (const pos of positions) {
      const zone = document.createElement('div');
      zone.className = `wtv__drop-zone wtv__drop-zone--${pos}`;
      zone.setAttribute('data-drop-position', pos);
      zone.textContent = this._label(DROP_PAD_LABEL[pos]);
      zones.appendChild(zone);
    }

    // The pads are hit-tested by the pointer drag (state.pointerDragMove / pointerDragDrop read
    // .wtv__drop-zone + data-drop-position under the pointer) — no listeners of their own.
    this._dropPads = pads;
    pads.place(row.getBoundingClientRect());
    this._markActiveDropPad(snapshot.activeDropPosition);
  }

  /** Highlight the pad the drop would land on (the one under the pointer, or the position the
   *  pointer picks on the row itself). */
  private _markActiveDropPad(position: DropPosition | null): void {
    for (const pad of this._dropPads?.element.querySelectorAll('.wtv__drop-zone') ?? []) {
      pad.classList.toggle('wtv__drop-zone--active', pad.getAttribute('data-drop-position') === position);
    }
  }

  // ── Context menu (core /menu) ───────────────────────────────────────

  /**
   * Reflect the engine's context-menu state. The menu itself — rendering, submenus,
   * positioning, dismiss, keyboard — is core `openMenu()`; it opens once per
   * (node, point) and reports its own close back to the engine.
   */
  private _updateContextMenu(snapshot: TreeViewStateSnapshot<T>): void {
    if (!this.state || !this.container) return;
    const node = snapshot.contextMenuNode;
    if (!snapshot.isContextMenuOpen || !node || !this._isActive) {
      this._closeMenu();
      return;
    }
    const key = `${node.path}|${snapshot.contextMenuX}|${snapshot.contextMenuY}`;
    if (this._menu?.isOpen && this._menuKey === key) return;
    this._closeMenu();

    const isFromKeyboard = this._isMenuOpeningFromKeyboard;
    this._isMenuOpeningFromKeyboard = false;
    const config = this.config;
    // One surface ctx per open: every item callback, onClick and submenu share it.
    const ctx = config.contextMenuContext?.(node)
      ?? (this.state.nodeRef(node) as unknown as TreeMenuContext<T>);
    const renderMenu = config.renderContextMenuCallback;
    const items = renderMenu ? [] : this.state.contextMenuCallbackCb?.(node) ?? [];
    const menu = openMenu(items, ctx, {
      at: { x: snapshot.contextMenuX + snapshot.contextMenuXOffset, y: snapshot.contextMenuY + snapshot.contextMenuYOffset },
      host: this.container,
      shouldFocusFirst: isFromKeyboard,
      returnFocusTo: this.bodyEl,
      // The node's text names the menu: the phone sheet's header and the menu's aria-label.
      title: this.state.tree?.getNodeDisplayValue(node) || String(node.id),
      // Floating / sheet / drawer + drawer side: core `menu-presentation` / `menu-side` (effective config).
      ...config.menuPresentationOptions?.(),
      // The tree's own strings: a lazy submenu's loading row, the sheet header's back / close buttons.
      labels: {
        loading: this._label('messages.loading'),
        back: this._label('menuItems.back'),
        close: this._label('ariaLabels.closeSheet'),
      },
      defaults: (item) => config.contextMenuItemDefaults?.(item as TreeMenuItem<T>, ctx),
      renderItemCallback: config.renderContextMenuItemCallback
        ? (item, el) => config.renderContextMenuItemCallback!(item as TreeMenuItem<T>, node, el)
        : undefined,
      renderMenuCallback: renderMenu
        ? (el) => renderMenu(node, () => this.state?.closeContextMenu(), el)
        : undefined,
      runAction: (item, { triggerElement, sourceEvent }) =>
        config.activateContextMenuItem?.(item as TreeMenuItem<T>, ctx, triggerElement, sourceEvent),
      onClose: () => {
        if (this._menu !== menu) return; // replaced by a newer open
        this._menu = null;
        this._menuKey = null;
        if (this.state?.isContextMenuOpen) this.state.closeContextMenu();
      },
    });
    if (!menu.isOpen) {
      // Nothing visible to show — keep the engine in sync.
      this.state.closeContextMenu();
      return;
    }
    this._menu = menu;
    this._menuKey = key;
  }

  /** Close the open menu without echoing it back to the engine. */
  private _closeMenu(): void {
    const menu = this._menu;
    this._menu = null;
    this._menuKey = null;
    menu?.close();
  }

  /**
   * Shift+F10 / the ContextMenu key: open the menu for the focused node, below its
   * row, with the first item focused. Returns `false` when there is no menu to open.
   */
  private _openContextMenuFromKeyboard(): boolean {
    const ctrl = this.state;
    if (!ctrl || !this.bodyEl) return false;
    if (!ctrl.hasContextMenuRenderer && !ctrl.contextMenuCallbackCb) return false;
    const node = ctrl.focusedNode;
    if (!node) return false;
    const nodeEl = this.bodyEl.querySelector(`.wtv__node[data-tree-path="${CSS.escape(node.path)}"]`);
    const anchorEl = (nodeEl?.querySelector('.wtv__node-content') ?? nodeEl) as HTMLElement | null;
    const rect = (anchorEl ?? this.bodyEl).getBoundingClientRect();
    this._isMenuOpeningFromKeyboard = true;
    // At the node's inline-start corner (the right edge in a right-to-left tree).
    ctrl.openContextMenu(node, isRtl(this.bodyEl) ? rect.right : rect.left, rect.bottom);
    return true;
  }

  // ── Full render (for config changes) ────────────────────────────────

  private _fullRender(snapshot: TreeViewStateSnapshot<T>): void {
    // Clear all node elements and re-create
    for (const [, el] of this.nodeElements) {
      el.remove();
    }
    this.nodeElements.clear();
    this._destroyAllTooltips();
    this._closeReveal();
    this._handleStateChange(snapshot);
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  private _findKeyByPath(path: string): string {
    return path; // rows are keyed by path
  }
}
