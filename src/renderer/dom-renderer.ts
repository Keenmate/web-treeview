/**
 * Default flat-mode DOM renderer implementing TreeViewRenderer<T>.
 *
 * - Event delegation: single click/dragover/drop listeners on body element
 * - Keyed reconciliation: Map<string, HTMLElement> keyed by node path
 * - Node element matches Node.svelte template structure
 * - Uses RenderCoordinator for progressive rendering
 * - Virtual scroll: three-div structure (scroll container → spacer → translateY content)
 */

import type { TreeViewRenderer, RendererConfig } from './types';
import type { TreeController } from '../controller/tree-controller';
import type { TreeControllerSnapshot, NodeConfig } from '../controller/types';
import type { LTreeNode } from '../ltree/ltree-node';
import type { DropPosition, ContextMenuItem, ContextMenuEntry } from '../ltree/types';
import { computePosition, flip, shift, offset, autoUpdate } from '@floating-ui/dom';
import { createTooltip, type TooltipHandle } from '@keenmate/web-components-core/positioning';
import {
  classifyDevice,
  observeEnvironment,
  observeElementSize,
  getEnvironment,
  type DeviceClass,
  type ElementSize
} from '@keenmate/web-components-core';
import type { NodeRenderContext } from '../controller/types';

/** An icon value that reads as CSS classes (`fa-solid fa-user`) goes on the element's class;
 *  anything else (emoji, symbol, text) is rendered as the element's text. */
const ICON_CLASS_LIST = /^\s*-?[A-Za-z_][\w-]*(\s+-?[A-Za-z_][\w-]*)*\s*$/;

/** Add space-separated class string to an element (classList.add doesn't support spaces) */
function addClasses(el: HTMLElement, classes: string): void {
  for (const cls of classes.split(' ')) {
    if (cls) el.classList.add(cls);
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
  private controller: TreeController<T> | null = null;
  private config: RendererConfig<T> = {};

  // DOM elements
  private headerEl: HTMLElement | null = null;
  private bodyEl: HTMLElement | null = null;
  private footerEl: HTMLElement | null = null;
  private debugEl: HTMLElement | null = null;
  private contextMenuEl: HTMLElement | null = null;
  private _ctxSubmenus: HTMLElement[] = [];
  private _ctxCleanupAutoUpdate: (() => void) | null = null;
  private _ctxKeydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private loadingEl: HTMLElement | null = null;

  // Virtual scroll DOM elements
  private vsSpacerEl: HTMLElement | null = null;
  private vsContentEl: HTMLElement | null = null;
  private _vsRafPending = false;
  private _vsMeasured = false;
  private _vsLastStartIndex = -1;
  private _vsLastEndIndex = -1;

  // Keyed node map
  private nodeElements = new Map<string, HTMLElement>();

  // Subscriptions
  private unsubState: (() => void) | null = null;
  private unsubConfig: (() => void) | null = null;

  // Last snapshot for diffing
  private lastSnapshot: TreeControllerSnapshot<T> | null = null;
  private lastNodeConfig: NodeConfig | null = null;
  // Hover/focus tooltip handles, keyed like nodeElements (id || path). Created per
  // row via the shared core createTooltip; rebuilt only when the node's data changes
  // (content derives from getNodeTooltipCallback(node)), destroyed when the row leaves.
  // Mirrors web-multiselect's option tooltips.
  private tooltips = new Map<string, TooltipHandle>();
  // The node _rev each live tooltip was built at. A reconcile pass that ISN'T a data
  // change (virtual-scroll reposition, focus/selection toggle) keeps the same handle,
  // so the core createTooltip's follow-cursor rect — seeded on mouseenter — survives a
  // stationary hover instead of being dropped by a needless destroy+recreate.
  private tooltipRevs = new Map<string, number>();
  private _lastDragOverTarget: string = '';
  private _lastEmptyState: string = '';
  // Responsive env for the NodeRenderContext (@keenmate/web-components-core/environment).
  // deviceClass flips are discrete → re-render on change; container size updates silently
  // (web-treeview is virtual-scroll-first; re-painting all rows per resize frame is wrong).
  private _deviceClass: DeviceClass = 'desktop';
  private _containerBox: ElementSize = { width: 0, height: 0 };
  private _stopEnvObserve: (() => void) | null = null;
  private _stopSizeObserve: (() => void) | null = null;

  mount(container: HTMLElement, controller: TreeController<T>, config: RendererConfig<T>): void {
    this.container = container;
    this.controller = controller;
    this.config = config;

    // Build skeleton
    this.container.innerHTML = '';
    this.container.classList.add('wtv__container');
    this._applyTheme(config.theme);

    // Header
    this.headerEl = document.createElement('div');
    this.headerEl.className = 'wtv__header';
    this.container.appendChild(this.headerEl);
    if (config.renderHeaderCallback) {
      config.renderHeaderCallback(this.headerEl);
    }

    // Debug info
    this.debugEl = document.createElement('div');
    this.debugEl.className = 'wtv__debug-info';
    this.debugEl.style.display = 'none';
    this.container.appendChild(this.debugEl);

    // Tree body
    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'wtv__tree';
    this.container.appendChild(this.bodyEl);

    // Footer
    this.footerEl = document.createElement('div');
    this.footerEl.className = 'wtv__footer';
    this.container.appendChild(this.footerEl);
    if (config.renderFooterCallback) {
      config.renderFooterCallback(this.footerEl);
    }

    // Loading overlay
    this.loadingEl = document.createElement('div');
    this.loadingEl.className = 'wtv__loading-overlay';
    this.loadingEl.style.display = 'none';
    this.loadingEl.innerHTML = '<div class="wtv__loading-spinner"></div>';
    this.container.appendChild(this.loadingEl);

    // Context menu
    this.contextMenuEl = document.createElement('div');
    this.contextMenuEl.className = 'wtv__context-menu';
    this.contextMenuEl.style.display = 'none';
    this.container.appendChild(this.contextMenuEl);

    // Set controller container for scrollToPath
    controller.containerElement = container;

    // Responsive env for NodeRenderContext. Seed synchronously so the initial render has
    // the right device class; then observe — only a device-class FLIP forces a re-render.
    this._deviceClass = classifyDevice(getEnvironment());
    this._stopEnvObserve = observeEnvironment((env) => {
      const dc = classifyDevice(env);
      if (dc !== this._deviceClass) {
        this._deviceClass = dc;
        if (this.controller) this._fullRender(this.controller.getSnapshot());
      }
    });
    this._stopSizeObserve = observeElementSize(container, (size) => {
      this._containerBox = size;
    });

    // Wire event delegation
    this._attachBodyListeners();

    // Subscribe to controller
    this.unsubState = controller.on('state-change', (snapshot) => this._onStateChange(snapshot));
    this.unsubConfig = controller.on('config-change', (nodeConfig) => this._onConfigChange(nodeConfig));

    // Initial render from current state
    this.lastNodeConfig = controller.nodeConfig;
    this._onStateChange(controller.getSnapshot());
  }

  updateConfig(config: Partial<RendererConfig<T>>): void {
    Object.assign(this.config, config);
    if ('theme' in config) this._applyTheme(config.theme);
    if (config.renderHeaderCallback && this.headerEl) {
      this.headerEl.innerHTML = '';
      config.renderHeaderCallback(this.headerEl);
    }
    if (config.renderFooterCallback && this.footerEl) {
      this.footerEl.innerHTML = '';
      config.renderFooterCallback(this.footerEl);
    }
    // Re-render nodes if renderNodeCallback / renderIconCallback changed (so a callback
    // assigned after the initial data render re-paints the rows / icons).
    if ((config.renderNodeCallback || config.renderIconCallback) && this.controller) {
      this._fullRender(this.controller.getSnapshot());
    }
  }

  destroy(): void {
    this.unsubState?.();
    this.unsubConfig?.();
    this.unsubState = null;
    this.unsubConfig = null;
    this._detachBodyListeners();
    this._closeAllSubmenus();
    this._ctxCleanupAutoUpdate?.();
    this._ctxCleanupAutoUpdate = null;
    this._removeCtxKeydownHandler();
    this._stopEnvObserve?.();
    this._stopSizeObserve?.();
    this._stopEnvObserve = null;
    this._stopSizeObserve = null;
    this._destroyAllTooltips();
    this.nodeElements.clear();
    this.vsSpacerEl = null;
    this.vsContentEl = null;
    this._vsMeasured = false;
    if (this.container) {
      this.container.innerHTML = '';
      this.container.classList.remove('wtv__container');
      this.container.removeAttribute('data-theme');
    }
    this.container = null;
    this.controller = null;
    this.lastSnapshot = null;
  }

  // ── Theme ───────────────────────────────────────────────────────────

  /** Forward the `theme` prop onto `.wtv__container` as `data-theme="..."`.
   *  The dark-mode partial keys off this attribute for per-instance overrides. */
  private _applyTheme(theme: 'dark' | 'light' | null | undefined): void {
    if (!this.container) return;
    if (theme === 'dark' || theme === 'light') {
      this.container.setAttribute('data-theme', theme);
    } else {
      this.container.removeAttribute('data-theme');
    }
  }

  // ── Event delegation ────────────────────────────────────────────────

  private _onBodyClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement;
    if (!this.controller) return;

    // Build selection modifiers from event
    const modifiers = {
      ctrl: event.ctrlKey || event.metaKey,
      shift: event.shiftKey
    };

    // Checkbox click
    const checkbox = target.closest('.wtv__checkbox') as HTMLInputElement | null;
    if (checkbox) {
      event.stopPropagation();
      const nodeEl = checkbox.closest('.wtv__node') as HTMLElement;
      const path = nodeEl?.getAttribute('data-tree-path');
      if (path) {
        const node = this.controller.getNodeByPath(path);
        if (node) {
          // .wtv__checkbox is the styled native <input> itself. We deliberately DON'T
          // preventDefault: on a reused input the browser's canceled-activation steps
          // fire LATE (after microtasks) and would restore .checked to its pre-click
          // value, clobbering our write. Letting the native toggle stand means no
          // cancellation + no restore. The controller still owns state — onCheckboxToggle
          // re-syncs the box via its synchronous refresh, and the microtask below
          // re-asserts the authoritative value so a VETOING beforeCheckboxToggleCallback
          // (which refreshes nothing) still snaps the native toggle back.
          this.controller.nodeCallbacks.onCheckboxToggle(node, { skipFocus: false });
          queueMicrotask(() => {
            const fresh = this.controller?.getNodeByPath(path);
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
      const nodeEl = toggleIcon.closest('.wtv__node') as HTMLElement;
      const path = nodeEl?.getAttribute('data-tree-path');
      if (path) {
        const node = this.controller.getNodeByPath(path);
        if (node) {
          // toggleNodeExpanded honors isAccordionExpand and the
          // isCollapsible gate. Programmatic expandNodes / collapseNodes
          // callers still bypass the accordion.
          this.controller.toggleNodeExpanded(path);
          return;
        }
      }
    }

    // Node content click (or indent zone click)
    const contentEl = target.closest('.wtv__node-content') as HTMLElement;
    const nodeEl = (contentEl || target).closest('.wtv__node') as HTMLElement;
    const path = nodeEl?.getAttribute('data-tree-path');
    if (path) {
      const node = this.controller.getNodeByPath(path);
      if (node) {
        const behavior = this.lastNodeConfig?.clickBehavior ?? 'expand-and-focus';
        const isPlainClick = !modifiers.ctrl && !modifiers.shift;

        // Manual double-click detection (the native dblclick is unreliable under
        // the flat diff reconciler — the first click bumps _rev and patches the
        // row). On a detected double the controller fires onNodeDoubleClick (and,
        // in select mode, toggles expand/collapse); we consume the 2nd click so
        // the gesture reads as a single open, not a re-toggle.
        if (isPlainClick && this.controller.detectDoubleClick(node)) {
          return;
        }

        // shouldClickToggleCheckbox: a plain click on a selectable node with
        // checkboxes shown toggles the checkbox instead of running the
        // normal click/select flow. Expand-on-click still fires.
        if (
          this.controller.shouldClickToggleCheckbox &&
          this.lastNodeConfig?.shouldShowCheckboxes &&
          node.isSelectable &&
          isPlainClick
        ) {
          this.controller.nodeCallbacks.onCheckboxToggle(node, { skipFocus: true });
          if (behavior !== 'select' && node.hasChildren) {
            this.controller.toggleNodeExpanded(path);
          }
          return;
        }

        if (behavior === 'expand-and-focus' && isPlainClick && node.hasChildren) {
          // Select + expand/collapse
          this.controller.toggleNodeExpanded(path);
          this.controller.nodeCallbacks.onNodeClicked(node, modifiers);
        } else if (behavior === 'expand' && isPlainClick && node.hasChildren) {
          // Expand/collapse only, no selection
          this.controller.toggleNodeExpanded(path);
        } else if (behavior === 'select' || !isPlainClick) {
          // Select only (ctrl/shift always selects regardless of behavior)
          this.controller.nodeCallbacks.onNodeClicked(node, modifiers);
        } else {
          // expand-and-focus on leaf, or expand on leaf — just select
          this.controller.nodeCallbacks.onNodeClicked(node, modifiers);
        }
      }
    }
  };

  private _onBodyKeydown = (event: KeyboardEvent) => {
    if (!this.controller) return;
    const ctrl = event.ctrlKey || event.metaKey;

    // Consumer onTreeKeydown (can suppress everything) THEN the built-in
    // Ctrl/Cmd+C/X/V + Delete + Esc-cancel-cut shortcuts. When this consumes the
    // event, stop — the tree's own navigation below is skipped.
    if (this.controller.handleKeydown(event)) {
      event.preventDefault();
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.controller.navNextSibling();
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.controller.navPrevSibling();
        break;
      case 'ArrowRight':
        event.preventDefault();
        this.controller.navInto();
        break;
      case 'ArrowLeft':
        event.preventDefault();
        this.controller.navOut();
        break;
      case 'Backspace':
        event.preventDefault();
        this.controller.navBackOut();
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        this.controller.navToggle();
        break;
      case 'Home':
        event.preventDefault();
        this.controller.navFirst();
        break;
      case 'End':
        event.preventDefault();
        this.controller.navLast();
        break;
      case 'a':
        if (ctrl) {
          event.preventDefault();
          this.controller.selectAll();
        }
        break;
      case 'Escape':
        // handleKeydown already consumed Escape when a cut was pending
        // (cancel-cut). Reaching here means no pending cut, so clear the
        // selected set. Checkboxes are deliberate state and stay put.
        if (this.controller.getSelectedPaths().size > 0) {
          this.controller.clearSelection();
        }
        break;
    }
  };

  private _onBodyContextMenu = (event: MouseEvent) => {
    if (!this.controller) return;
    const target = event.target as HTMLElement;
    const contentEl = target.closest('.wtv__node-content') as HTMLElement;
    const nodeEl = (contentEl || target).closest('.wtv__node') as HTMLElement;
    const path = nodeEl?.getAttribute('data-tree-path');
    if (path) {
      const node = this.controller.getNodeByPath(path);
      if (node) {
        this.controller.nodeCallbacks.onNodeRightClicked(node, event);
      }
    }
  };

  private _onBodyDragStart = (event: DragEvent) => {
    if (!this.controller) return;
    const target = event.target as HTMLElement;
    const nodeEl = target.closest('.wtv__node') as HTMLElement;
    const path = nodeEl?.getAttribute('data-tree-path');
    if (path) {
      const node = this.controller.getNodeByPath(path);
      if (node) {
        this.controller.startDrag(node, event);
      }
    }
  };

  private _onBodyDragOver = (event: DragEvent) => {
    if (!this.controller) return;
    const target = event.target as HTMLElement;
    // Log only on first dragover or target change to reduce noise
    const targetDesc = target.tagName + '.' + target.className;
    if (this._lastDragOverTarget !== targetDesc) {
      console.log('[DomRenderer] _onBodyDragOver', { target: targetDesc, treeId: this.controller.treeId });
      this._lastDragOverTarget = targetDesc;
    }

    // Drop zone handling — allow drop and highlight active zone
    const zoneEl = target.closest('.wtv__drop-zone') as HTMLElement;
    if (zoneEl) {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      const parent = zoneEl.parentElement as HTMLElement;
      if (parent) {
        // Toggle active class on hovered zone
        for (const sibling of parent.querySelectorAll('.wtv__drop-zone')) {
          sibling.classList.toggle('wtv__drop-zone--active', sibling === zoneEl);
        }
        // Refresh position for scroll tracking
        const path = parent.getAttribute('data-tree-path');
        if (path) {
          const key = this._findKeyByPath(path);
          const hoveredEl = this.nodeElements.get(key);
          const row = hoveredEl?.querySelector('.wtv__node-row') as HTMLElement;
          if (row) {
            const rect = row.getBoundingClientRect();
            parent.style.top = `${rect.top}px`;
            parent.style.left = `${rect.left}px`;
            parent.style.width = `${rect.width}px`;
            parent.style.height = `${rect.height}px`;
          }
        }
      }
      return;
    }

    const contentEl = target.closest('.wtv__node-content') as HTMLElement;
    if (contentEl) {
      const nodeEl = contentEl.closest('.wtv__node') as HTMLElement;
      const path = nodeEl?.getAttribute('data-tree-path');
      if (path) {
        const node = this.controller.getNodeByPath(path);
        if (node) {
          this.controller.dragOver(node, event, contentEl);
        }
      }
    }

    // Empty tree or active drop placeholder dragover
    const emptyOrPlaceholder = target.closest('.wtv__empty-state, .wtv__empty-zone') as HTMLElement;
    if (emptyOrPlaceholder) {
      console.log('[DomRenderer] dragover on empty/placeholder element', emptyOrPlaceholder.className);
      this.controller.handleEmptyTreeDragOver(event);
    } else {
      const bodyHit = target.closest('.wtv__tree');
      if (bodyHit && !contentEl && !zoneEl) {
        console.log('[DomRenderer] dragover on tree body, but no node/zone/empty found. target:', target.tagName, target.className);
      }
    }
  };

  private _onBodyDragLeave = (event: DragEvent) => {
    if (!this.controller) return;
    this._lastDragOverTarget = '';
    const related = event.relatedTarget as HTMLElement;
    const target = event.target as HTMLElement;
    console.log('[DomRenderer] _onBodyDragLeave', {
      target: target.tagName + '.' + target.className,
      related: related ? related.tagName + '.' + related.className : null,
      treeId: this.controller.treeId
    });
    // Don't clear hover when cursor moves to a floating drop zone
    if (related?.closest?.('.wtv__drop-zones')) return;
    const contentEl = target.closest('.wtv__node-content') as HTMLElement;
    if (contentEl) {
      const nodeEl = contentEl.closest('.wtv__node') as HTMLElement;
      const path = nodeEl?.getAttribute('data-tree-path');
      if (path) {
        const node = this.controller.getNodeByPath(path);
        if (node) {
          this.controller.dragLeave(node, event);
        }
      }
    }

    const emptyOrPlaceholder = target.closest('.wtv__empty-state, .wtv__empty-zone') as HTMLElement;
    if (emptyOrPlaceholder) {
      this.controller.handleEmptyTreeDragLeave(event);
    }
  };

  private _onBodyDrop = (event: DragEvent) => {
    if (!this.controller) return;
    // When the tree drop zone is on, the container also listens for `drop`. bodyEl
    // fully owns in-body drops (node / zone / empty, plus forwarding rejects to the
    // zone), so stop the event here to keep the container handler from double-placing.
    if (this.controller.shouldEnableTreeDropZone) event.stopPropagation();
    const target = event.target as HTMLElement;

    // Check for drop zone (zones are appended to bodyEl, not inside .wtv__node)
    const zoneEl = target.closest('.wtv__drop-zone') as HTMLElement;
    if (zoneEl) {
      const zonesContainer = zoneEl.closest('.wtv__drop-zones') as HTMLElement;
      const path = zonesContainer?.getAttribute('data-tree-path');
      const position = zoneEl.getAttribute('data-drop-position') as DropPosition;
      if (path && position) {
        const node = this.controller.getNodeByPath(path);
        if (node) {
          this.controller.dropAt(node, position, event);
          return;
        }
      }
    }

    // Check for empty tree drop (matches both .wtv__empty-state and active .wtv__empty-zone)
    const emptyOrPlaceholder = target.closest('.wtv__empty-state, .wtv__empty-zone') as HTMLElement;
    if (emptyOrPlaceholder) {
      this.controller.handleEmptyTreeDrop(event);
      return;
    }

    // Regular node drop
    const contentEl = target.closest('.wtv__node-content') as HTMLElement;
    if (contentEl) {
      const nodeEl = contentEl.closest('.wtv__node') as HTMLElement;
      const path = nodeEl?.getAttribute('data-tree-path');
      if (path) {
        const node = this.controller.getNodeByPath(path);
        if (node) {
          this.controller.drop(node, event);
        }
      }
    }
  };

  private _onBodyDragEnter = (event: DragEvent) => {
    const target = event.target as HTMLElement;
    const related = event.relatedTarget as HTMLElement;
    console.log('[DomRenderer] _onBodyDragEnter', {
      target: target.tagName + '.' + target.className,
      related: related ? related.tagName + '.' + related.className : null,
      treeId: this.controller?.treeId
    });
    this.controller?.handleTreeDragEnter(event);
  };

  private _onBodyDragEnd = (event: DragEvent) => {
    this.controller?._onNodeDragEnd(event);
  };

  /** Catches dragend from OTHER trees (cross-tree) and Esc cancellations.
   *  dragend fires on the source element; when that element lives in a
   *  different shadow root the event never reaches our bodyEl. */
  private _onDocumentDragEnd = (event: DragEvent) => {
    this.controller?.cancelDrag();
  };

  private _onBodyTouchStart = (event: TouchEvent) => {
    if (!this.controller) return;
    const target = event.target as HTMLElement;
    const nodeEl = target.closest('.wtv__node') as HTMLElement;
    const path = nodeEl?.getAttribute('data-tree-path');
    if (path) {
      const node = this.controller.getNodeByPath(path);
      if (node) {
        // Chromium touch-emulation fix (svelte-treeview rc14): the native
        // `draggable` attr swallows the synthetic touchmove/touchend stream (Chrome
        // tries to hand the gesture to its mouse-driven HTML5 drag engine). Turn it
        // OFF synchronously for the duration of the touch gesture; restore on end.
        // Scoped to touch — a mouse never fires touchstart, so mouse-drag is
        // unaffected. On real phones the collision can't occur.
        if (nodeEl.draggable) {
          const wasDraggable = nodeEl.draggable;
          nodeEl.draggable = false;
          const restore = () => { nodeEl.draggable = wasDraggable; };
          document.addEventListener('touchend', restore, { once: true });
          document.addEventListener('touchcancel', restore, { once: true });
        }
        this.controller.touchStart(node, event);
      }
    }
  };

  // Tree-level drop zone (shouldEnableTreeDropZone): container-level fallback so a
  // drop anywhere over the tree is accepted even when every node rejects it. The
  // controller handlers no-op unless the flag is on, so these can attach always.
  private _onContainerDragOver = (event: DragEvent) => this.controller?.handleTreeZoneDragOver(event);
  private _onContainerDrop = (event: DragEvent) => this.controller?.handleTreeZoneDrop(event);

  /** RAF-throttled virtual scroll handler — uses fast synchronous path */
  private _onVirtualScroll = () => {
    if (this._vsRafPending || !this.bodyEl) return;
    this._vsRafPending = true;
    requestAnimationFrame(() => {
      this._vsRafPending = false;
      this._performScrollUpdate();
    });
  };

  /**
   * Fast synchronous virtual scroll update.
   * Bypasses the controller's queueMicrotask + state-change event pipeline.
   * Computes the visible window, updates DOM positioning, and reconciles
   * only the node list — skips drag/drop/context-menu/debug updates.
   */
  private _performScrollUpdate(): void {
    if (!this.bodyEl || !this.controller || !this.vsSpacerEl || !this.vsContentEl || !this.lastSnapshot) return;

    const scrollTop = this.bodyEl.scrollTop;
    const ctrl = this.controller;
    const rowHeight = ctrl.resolvedRowHeight;
    const containerHeightPx = parseFloat(ctrl.resolvedContainerHeight) || 400;
    const overscan = ctrl.virtualOverscan;
    const allNodes = ctrl.allVisibleFlatNodes;

    const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    const endIndex = Math.min(allNodes.length, Math.ceil((scrollTop + containerHeightPx) / rowHeight) + overscan);

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

    // Sync controller state silently (so next getSnapshot() has correct scrollTop)
    ctrl.syncVirtualScrollTop(scrollTop);
  }

  private _attachBodyListeners() {
    if (!this.bodyEl) return;
    // Enable keyboard focus
    this.bodyEl.setAttribute('tabindex', '0');
    this.bodyEl.style.outline = 'none';
    this.bodyEl.addEventListener('click', this._onBodyClick);
    this.bodyEl.addEventListener('keydown', this._onBodyKeydown);
    this.bodyEl.addEventListener('contextmenu', this._onBodyContextMenu);
    this.bodyEl.addEventListener('dragstart', this._onBodyDragStart);
    this.bodyEl.addEventListener('dragover', this._onBodyDragOver);
    this.bodyEl.addEventListener('dragleave', this._onBodyDragLeave);
    this.bodyEl.addEventListener('drop', this._onBodyDrop);
    this.bodyEl.addEventListener('dragenter', this._onBodyDragEnter);
    this.bodyEl.addEventListener('touchstart', this._onBodyTouchStart, { passive: true });
    // dragend fires on the SOURCE element after any drag ends (drop, cancel, cross-tree)
    this.bodyEl.addEventListener('dragend', this._onBodyDragEnd);
    // Cross-tree / Esc: dragend from other shadow roots won't reach our bodyEl
    document.addEventListener('dragend', this._onDocumentDragEnd);
    // Tree-level drop zone: fallback dragover/drop on the whole container (gated
    // inside the controller handlers by shouldEnableTreeDropZone).
    if (this.container) {
      this.container.addEventListener('dragover', this._onContainerDragOver);
      this.container.addEventListener('drop', this._onContainerDrop);
    }
  }

  private _detachBodyListeners() {
    if (!this.bodyEl) return;
    this.bodyEl.removeEventListener('click', this._onBodyClick);
    this.bodyEl.removeEventListener('keydown', this._onBodyKeydown);
    this.bodyEl.removeEventListener('contextmenu', this._onBodyContextMenu);
    this.bodyEl.removeEventListener('dragstart', this._onBodyDragStart);
    this.bodyEl.removeEventListener('dragover', this._onBodyDragOver);
    this.bodyEl.removeEventListener('dragleave', this._onBodyDragLeave);
    this.bodyEl.removeEventListener('drop', this._onBodyDrop);
    this.bodyEl.removeEventListener('dragenter', this._onBodyDragEnter);
    this.bodyEl.removeEventListener('touchstart', this._onBodyTouchStart);
    this.bodyEl.removeEventListener('dragend', this._onBodyDragEnd);
    this.bodyEl.removeEventListener('scroll', this._onVirtualScroll);
    document.removeEventListener('dragend', this._onDocumentDragEnd);
    if (this.container) {
      this.container.removeEventListener('dragover', this._onContainerDragOver);
      this.container.removeEventListener('drop', this._onContainerDrop);
    }
  }

  // ── Virtual scroll structure ───────────────────────────────────────

  private _ensureVirtualScrollStructure(snapshot: TreeControllerSnapshot<T>): void {
    if (!this.bodyEl) return;

    if (snapshot.isVirtualScrollEnabled && !this.vsSpacerEl) {
      // Enable virtual scroll: add class, create spacer + content wrapper
      this.bodyEl.classList.add('wtv__virtual-scroll');
      this.bodyEl.style.height = snapshot.virtualContainerHeight;

      this.vsSpacerEl = document.createElement('div');
      this.vsSpacerEl.className = 'wtv__vs-spacer';
      this.vsSpacerEl.style.position = 'relative';
      this.vsSpacerEl.style.width = '100%';

      this.vsContentEl = document.createElement('div');
      this.vsContentEl.className = 'wtv__vs-content';
      this.vsContentEl.style.willChange = 'transform';

      // Move existing children into vsContentEl
      while (this.bodyEl.firstChild) {
        this.vsContentEl.appendChild(this.bodyEl.firstChild);
      }

      this.vsSpacerEl.appendChild(this.vsContentEl);
      this.bodyEl.appendChild(this.vsSpacerEl);

      // Attach scroll listener
      this.bodyEl.addEventListener('scroll', this._onVirtualScroll, { passive: true });
      this._vsMeasured = false;
      this._vsLastStartIndex = -1;
      this._vsLastEndIndex = -1;

    } else if (!snapshot.isVirtualScrollEnabled && this.vsSpacerEl) {
      // Disable virtual scroll: tear down structure
      this.bodyEl.removeEventListener('scroll', this._onVirtualScroll);
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

  private _updateVirtualScrollPositioning(snapshot: TreeControllerSnapshot<T>): void {
    if (!snapshot.isVirtualScrollEnabled || !this.vsSpacerEl || !this.vsContentEl || !this.bodyEl) return;

    // Update container height if changed
    if (this.bodyEl.style.height !== snapshot.virtualContainerHeight) {
      this.bodyEl.style.height = snapshot.virtualContainerHeight;
    }

    // Update spacer height (creates the correct scrollbar size)
    this.vsSpacerEl.style.height = `${snapshot.virtualTotalHeight}px`;

    // Position the content wrapper at the correct offset
    this.vsContentEl.style.transform = `translateY(${snapshot.virtualOffsetY}px)`;
  }

  private _autoMeasureRowHeight(): void {
    if (!this.controller || this._vsMeasured) return;

    const renderTarget = this.vsContentEl ?? this.bodyEl;
    if (!renderTarget) return;

    const firstNode = renderTarget.querySelector('.wtv__node') as HTMLElement;
    if (firstNode) {
      const height = firstNode.getBoundingClientRect().height;
      if (height > 0) {
        this._vsMeasured = true;
        this.controller.setMeasuredRowHeight(height);
      }
    }
  }

  // ── State change handler ────────────────────────────────────────────

  private _onStateChange(snapshot: TreeControllerSnapshot<T>): void {
    if (!this.bodyEl || !this.controller) return;

    // Invalidate scroll fast-path cache — the underlying data may have changed
    // (filter, expand, collapse, data load), so the next scroll must not early-exit
    this._vsLastStartIndex = -1;
    this._vsLastEndIndex = -1;

    // Manage virtual scroll DOM structure
    this._ensureVirtualScrollStructure(snapshot);

    // Reconcile nodes
    this._reconcileNodes(snapshot);

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

    // Debug info
    this._updateDebugInfo(snapshot);

    // Body class
    if (this.bodyEl) {
      if (this.lastSnapshot?.bodyClass) {
        this.bodyEl.classList.remove(this.lastSnapshot.bodyClass);
      }
      if (snapshot.bodyClass) {
        this.bodyEl.classList.add(snapshot.bodyClass);
      }
    }

    // Whole-tree drop-zone engaged outline (shouldEnableTreeDropZone): light the
    // container while a drag hovers it (isDropPlaceholderActive is set by the
    // container-level tree-zone dragover handler).
    if (this.container) {
      const zoneActive = !!this.controller?.shouldEnableTreeDropZone && snapshot.isDropPlaceholderActive;
      this.container.classList.toggle('wtv__tree-drop-zone--active', zoneActive);
    }

    this.lastSnapshot = snapshot;
  }

  private _onConfigChange(nodeConfig: NodeConfig): void {
    if ((globalThis as any).__WTV_DEBUG) console.log('[wtv:render] _onConfigChange → _fullRender, focusedNodeClass=', JSON.stringify(nodeConfig.focusedNodeClass));
    this.lastNodeConfig = nodeConfig;
    // Re-render toggle icons if icon classes changed
    if (this.controller) {
      this._fullRender(this.controller.getSnapshot());
    }
  }

  // ── Node reconciliation ─────────────────────────────────────────────

  /** Get the element where node elements are rendered (vsContentEl in virtual scroll, bodyEl otherwise) */
  private get _renderTarget(): HTMLElement | null {
    return this.vsContentEl ?? this.bodyEl;
  }

  private _reconcileNodes(snapshot: TreeControllerSnapshot<T>): void {
    const target = this._renderTarget;
    if (!target || !this.controller) return;

    const nodes = snapshot.flatNodesToRender;
    const newKeys = new Set<string>();

    // Handle empty tree
    if (nodes.length === 0) {
      this._renderEmpty(snapshot);
      return;
    }

    // Remove empty state if it exists
    const emptyState = target.querySelector('.wtv__empty-state');
    if (emptyState) emptyState.remove();
    const emptyZone = target.querySelector('.wtv__empty-zone');
    if (emptyZone) emptyZone.remove();

    // Build/update nodes
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const key = String(node.id || node.path);
      newKeys.add(key);

      let el = this.nodeElements.get(key);
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
          if (
            existingRev !== String(node._rev) ||
            existingExpanded !== String(!!node.isExpanded) ||
            existingHasChildren !== String(!!node.hasChildren) ||
            existingFocused !== String(snapshot.focusedNode?.path === node.path) ||
            existingSelected !== String(snapshot.selectedPaths.has(node.path))
          ) {
            this._updateNodeElement(el, node, snapshot);
          }
        }
        // Update indent for flat mode
        if (snapshot.isFlatRenderingEnabled) {
          el.style.paddingLeft = `calc((${node.level} - 1) * ${snapshot.flatIndentSize})`;
        }
      } else {
        // Create new node
        el = this._createNodeElement(node, snapshot);
        this.nodeElements.set(key, el);
      }

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
  }

  private _renderEmpty(snapshot: TreeControllerSnapshot<T>): void {
    const target = this._renderTarget;
    if (!target) return;

    // Clear all node elements
    for (const [, el] of this.nodeElements) {
      el.remove();
    }
    this.nodeElements.clear();
    this._destroyAllTooltips();

    // Show empty zone (drop target during drag) or empty state (informational)
    const emptyState = `${snapshot.isDragInProgress}|${snapshot.isDropPlaceholderActive}|${snapshot.isLoading}`;
    if (this._lastEmptyState !== emptyState) {
      console.log('[DomRenderer] renderEmpty', { isDragInProgress: snapshot.isDragInProgress, isDropPlaceholderActive: snapshot.isDropPlaceholderActive, isLoading: snapshot.isLoading });
      this._lastEmptyState = emptyState;
    }
    // Show the empty drop zone when a drag is over an empty tree, OR permanently
    // when shouldShowDropPlaceholderWhenEmpty keeps it up so a Ctrl/Cmd+V can land.
    const showZone =
      (snapshot.isDragInProgress && snapshot.isDropPlaceholderActive) ||
      !!this.config.shouldShowDropPlaceholderWhenEmpty;

    if (showZone && !snapshot.isLoading) {
      target.style.minHeight = '';
      let zone = target.querySelector('.wtv__empty-zone') as HTMLElement | null;
      if (!zone) {
        const emptyState = target.querySelector('.wtv__empty-state');
        if (emptyState) emptyState.remove();

        zone = document.createElement('div');
        zone.className = 'wtv__empty-zone';
        if (this.config.renderEmptyZoneCallback) {
          this.config.renderEmptyZoneCallback(zone);
        } else {
          const content = document.createElement('div');
          content.className = 'wtv__empty-zone-content';
          content.textContent = 'Drop here';
          zone.appendChild(content);
        }
        // Make the zone focus the tree body on hover/pointerdown so a Ctrl/Cmd+V
        // (routed through the body keydown listener) pastes into the empty tree.
        if (this.config.shouldShowDropPlaceholderWhenEmpty) {
          zone.tabIndex = 0;
          const grabFocus = () => this.bodyEl?.focus();
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
      if (this.config.renderEmptyStateCallback) {
        this.config.renderEmptyStateCallback(emptyState as HTMLElement);
      } else {
        emptyState.textContent = this.config.noDataText ?? 'No data';
      }
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
  private _applyToggleClasses(toggle: HTMLElement, node: LTreeNode<T>): void {
    const nodeConfig = this.lastNodeConfig;
    toggle.className = 'wtv__toggle-icon';
    if (node.hasChildren) {
      // Built-in glyph path: ONE canonical class (`--expand`) for every expandable
      // node + the `.expanded` state marker. Rotate vs swap is a pure-CSS concern
      // (variables.css / tree.css): rotate mode spins the glyph via
      // --wtv-icon-rotate-*, swap mode repaints its mask to --wtv-icon-collapse.
      //
      // Escape-hatch path: a custom expandIconClass (e.g. FontAwesome, `fa-*`) is NOT
      // a CSS mask, so it can't be repainted — the renderer reproduces swap itself by
      // swapping class names (the pre-icon-set behaviour). Rotation still works because
      // the rotate rule keys off the shared `.wtv__toggle-icon.wtv__clickable`, which
      // every expandable toggle carries regardless of glyph class.
      const expandIconClass = nodeConfig?.expandIconClass || 'wtv__toggle-icon--expand';
      const usingCustomGlyph = expandIconClass !== 'wtv__toggle-icon--expand';
      const swap = nodeConfig?.toggleIconMode === 'swap';
      if (usingCustomGlyph && swap && node.isExpanded) {
        addClasses(toggle, nodeConfig?.collapseIconClass || 'wtv__toggle-icon--collapse');
      } else {
        addClasses(toggle, expandIconClass);
      }
      if (node.isExpanded) {
        toggle.classList.add('expanded');
      }
      toggle.classList.add('wtv__clickable');
    } else {
      // Leaf node: just the leaf spacer/marker. The per-node icon is NO LONGER folded
      // into the toggle slot — it renders as a dedicated .wtv__node-icon element on every
      // node (branch + leaf), via _applyNodeIcon. See iconMember / renderIconCallback.
      addClasses(toggle, nodeConfig?.leafIconClass || 'wtv__toggle-icon--leaf-none');
    }
  }

  /**
   * Create / refresh / remove the dedicated per-node icon element (.wtv__node-icon) in a
   * row, for EVERY node. VALUE from iconMember/iconCallback; default render is a class on an
   * <i> (`<i class="wtv__node-icon {value}">`, FontAwesome-friendly), overridable via
   * renderIconCallback (which populates a <span>). COLOR from iconColorMember/iconColorCallback.
   * Reserves the column via shouldAlignNodeIcons. Sits between the toggle/checkbox and content.
   */
  private _applyNodeIcon(row: HTMLElement, node: LTreeNode<T>, ctx: NodeRenderContext): void {
    const cfg = this.lastNodeConfig;
    const useCallback = !!this.config.renderIconCallback;
    const value = this.controller?.hasIconSupport ? this.controller.getNodeIcon(node) : null;
    const color = this.controller?.getNodeIconColor ? this.controller.getNodeIconColor(node) : null;
    const align = !!cfg?.shouldAlignNodeIcons;
    const hasSupport = !!(this.controller?.hasIconSupport || useCallback);
    const shouldShow = useCallback || !!value || (align && hasSupport);

    let iconEl = row.querySelector(':scope > .wtv__node-icon') as HTMLElement | null;
    if (!shouldShow) {
      iconEl?.remove();
      return;
    }

    // <span> for the callback path (consumer populates), <i> for the default class path.
    const wantTag = useCallback ? 'SPAN' : 'I';
    if (iconEl && iconEl.tagName !== wantTag) {
      iconEl.remove();
      iconEl = null;
    }
    if (!iconEl) {
      iconEl = document.createElement(useCallback ? 'span' : 'i');
      const content = row.querySelector(':scope > .wtv__node-content');
      row.insertBefore(iconEl, content);
    }

    // Full className reset each time removes stale value classes (diff reconciler reuses rows).
    const base = 'wtv__node-icon' + (align ? ' wtv__node-icon--aligned' : '');
    if (useCallback) {
      iconEl.className = base;
      iconEl.innerHTML = '';
      this.config.renderIconCallback!(node, value, iconEl, ctx);
    } else if (value && !ICON_CLASS_LIST.test(value)) {
      // Not a class list (emoji / symbol / text) — render the value itself.
      iconEl.className = base;
      iconEl.textContent = value;
    } else {
      iconEl.className = base + (value ? ' ' + value : '');
      iconEl.textContent = '';
    }
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
   * controller toggles the state.
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

  private _createNodeElement(node: LTreeNode<T>, snapshot: TreeControllerSnapshot<T>): HTMLElement {
    const el = document.createElement('div');
    el.className = 'wtv__node';
    el.setAttribute('data-tree-path', node.path);
    el.setAttribute('data-rev', String(node._rev));
    el.setAttribute('data-expanded', String(!!node.isExpanded));
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

    if (this.controller && node.id) {
      el.id = `${this.controller.treeId}-${node.id}`;
    }

    // Flat mode indent
    if (snapshot.isFlatRenderingEnabled) {
      el.style.paddingLeft = `calc((${node.level} - 1) * ${snapshot.flatIndentSize})`;
    }

    const nodeConfig = this.lastNodeConfig;

    // Node row
    const row = document.createElement('div');
    row.className = 'wtv__node-row';

    // Toggle icon
    const toggle = document.createElement('span');
    this._applyToggleClasses(toggle, node);

    row.appendChild(toggle);

    // Checkbox (between toggle and content). Rendered only when
    // shouldShowCheckboxes is true and the node is selectable.
    if (nodeConfig?.shouldShowCheckboxes && node.isSelectable) {
      row.appendChild(
        this._buildCheckbox(
          snapshot.checkedPaths.has(node.path),
          node.visualState === 'indeterminate'
        )
      );
    }

    // Node content
    const content = document.createElement('div');
    content.className = 'wtv__node-content';

    // Draggable + cut live on the CONTENT (the pill), not the outer .wtv__node.
    // Keeps every wtv__node-content--* class on the element it's named for and
    // matches svelte-treeview (draggable on .stv__node-content). The delegated
    // dragstart/touch handlers still resolve the row via closest('.wtv__node'),
    // so the grab handle is the content pill (excludes the indent gutter/toggle).
    if (this.controller?.dragDropMode !== 'none' && this.controller?.getNodeIsDraggable(node)) {
      content.setAttribute('draggable', 'true');
      content.classList.add('wtv__node-content--draggable');
    }
    if (snapshot.cutPaths.has(node.path)) {
      content.classList.add('wtv__node-content--cut');
    }

    // Selected / focus state — applied to the row content so the styling
    // affects only the visible row, not the children indentation area below.
    // Selected is read from the controller-owned set (snapshot), NOT node.isSelected:
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
    if (this.config.renderNodeCallback) {
      this.config.renderNodeCallback(node, content, ctx);
    } else {
      const label = document.createElement('span');
      label.className = 'wtv__node-label';
      label.textContent = this.controller?.tree?.getNodeDisplayValue(node) || String(node.id);
      content.appendChild(label);
    }

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

  /** Row key — must match _reconcileNodes' keying (id || path). */
  private _nodeKey(node: LTreeNode<T>): string {
    return String(node.id || node.path);
  }

  /** Build the NodeRenderContext for the render callbacks: device + container + live state. */
  private _buildRenderContext(node: LTreeNode<T>, snapshot: TreeControllerSnapshot<T>): NodeRenderContext {
    return {
      deviceClass: this._deviceClass,
      container: { width: this._containerBox.width, height: this._containerBox.height },
      isExpanded: !!node.isExpanded,
      isChecked: snapshot.checkedPaths.has(node.path),
      isSelected: snapshot.selectedPaths.has(node.path),
      isFocused: snapshot.focusedNode?.path === node.path,
      level: node.level ?? 0,
      hasChildren: !!node.hasChildren
    };
  }

  /** Create / refresh / tear down the hover-focus tooltip for a row. The direct
   *  analog of web-multiselect's attachOptionTooltips, built on the shared core
   *  createTooltip (portal, autoUpdate, shouldFollowCursor, data-theme inherit). Recreated
   *  on every node update so content tracks data (rename / _rev bump); a no-op +
   *  teardown when disabled, no callback, or empty content. Mounts into the shadow
   *  container so it inherits the injected --wtv-tooltip-* tokens + data-theme. */
  private _applyTooltip(triggerEl: HTMLElement | null, node: LTreeNode<T>): void {
    const key = this._nodeKey(node);
    this._destroyTooltip(key);
    const cfg = this.lastNodeConfig;
    if (!triggerEl || !cfg?.shouldShowNodeTooltips || !cfg.getNodeTooltipCallback) return;
    const content = cfg.getNodeTooltipCallback(node);
    if (content == null || (typeof content === 'string' && content.trim() === '')) return;
    const handle = createTooltip({
      trigger: triggerEl,
      container: this.container ?? document.body,
      content,
      placement: cfg.tooltipPlacement,
      offset: cfg.tooltipOffset,
      delay: cfg.tooltipDelay,
      shouldFollowCursor: cfg.tooltipFollowCursor,
      cssClass: 'wtv__tooltip',
      visibleClass: 'wtv__tooltip--visible'
    });
    this.tooltips.set(key, handle);
    this.tooltipRevs.set(key, node._rev);
  }

  private _destroyTooltip(key: string): void {
    const h = this.tooltips.get(key);
    if (h) {
      h.destroy();
      this.tooltips.delete(key);
    }
    this.tooltipRevs.delete(key);
  }

  private _destroyAllTooltips(): void {
    for (const h of this.tooltips.values()) h.destroy();
    this.tooltips.clear();
    this.tooltipRevs.clear();
  }

  private _updateNodeElement(el: HTMLElement, node: LTreeNode<T>, snapshot: TreeControllerSnapshot<T>): void {
    el.setAttribute('data-rev', String(node._rev));
    el.setAttribute('data-expanded', String(!!node.isExpanded));
    el.setAttribute('data-has-children', String(!!node.hasChildren));
    el.setAttribute('data-tree-path', node.path);

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
      if ((globalThis as any).__WTV_DEBUG && isFocused)
        console.log('[wtv:render] update-path focus node', node.path, 'focusedNodeClass=', JSON.stringify(nodeConfig?.focusedNodeClass), 'classesBefore=', contentEl.className);
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
    if (nodeConfig?.shouldShowCheckboxes && node.isSelectable) {
      let cb = el.querySelector('.wtv__checkbox') as HTMLInputElement | null;
      if (!cb) {
        // Showed checkboxes was just toggled on — insert one.
        cb = this._buildCheckbox(false, false);
        const toggle = el.querySelector('.wtv__toggle-icon');
        toggle?.after(cb);
      }
      this._syncCheckboxState(
        cb,
        snapshot.checkedPaths.has(node.path),
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

      // Re-render content if using template
      if (this.config.renderNodeCallback) {
        content.innerHTML = '';
        this.config.renderNodeCallback(node, content, ctx);
      } else {
        const label = content.querySelector('.wtv__node-label') as HTMLElement;
        if (label) {
          label.textContent = this.controller?.tree?.getNodeDisplayValue(node) || String(node.id);
        }
      }
    }

    // Update draggable — on the content pill (matches _createNodeElement)
    if (content) {
      if (this.controller?.dragDropMode !== 'none' && this.controller?.getNodeIsDraggable(node)) {
        content.setAttribute('draggable', 'true');
        content.classList.add('wtv__node-content--draggable');
      } else {
        content.removeAttribute('draggable');
        content.classList.remove('wtv__node-content--draggable');
      }
    }

    // Re-apply data-driven nodeClass / nodeContentClass (removes stale classes)
    this._applyCustomNodeClasses(el, content, node);
    // Refresh the per-node icon (value/color track the node's data).
    const row = el.querySelector(':scope > .wtv__node-row') as HTMLElement | null;
    if (row) this._applyNodeIcon(row, node, ctx);
    // Rebuild the tooltip ONLY when the node's data changed — its content comes
    // from getNodeTooltipCallback(node), so a same-_rev reconcile (reposition,
    // focus/selection toggle) must keep the existing handle. Rebuilding every pass
    // would drop the follow-cursor rect seeded on mouseenter (stationary-hover bug)
    // and needlessly churn floating-ui autoUpdate + listeners. Enable/disable,
    // callback, placement and follow-cursor changes are config-level and go through
    // _onConfigChange → _fullRender, which rebuilds all tooltips anyway.
    const key = this._nodeKey(node);
    if (this.tooltipRevs.get(key) !== node._rev) {
      this._applyTooltip(content, node);
    }
  }

  // ── Drag CSS classes ────────────────────────────────────────────────

  private _updateDragClasses(snapshot: TreeControllerSnapshot<T>): void {
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

  private _updateDropZones(snapshot: TreeControllerSnapshot<T>): void {
    if (!this.bodyEl || !this.controller) return;

    const shouldShow =
      this.lastNodeConfig?.dropZoneMode === 'floating' &&
      snapshot.isDragInProgress &&
      !!snapshot.hoveredNodeForDropPath;

    const existing = this.bodyEl.querySelector('.wtv__drop-zones') as HTMLElement | null;
    const existingPath = existing?.getAttribute('data-tree-path') ?? null;

    // If zones already exist for the same hovered path, just update position — don't recreate
    if (shouldShow && existing && existingPath === snapshot.hoveredNodeForDropPath) {
      const key = this._findKeyByPath(snapshot.hoveredNodeForDropPath!);
      const hoveredEl = this.nodeElements.get(key);
      const row = hoveredEl?.querySelector('.wtv__node-row') as HTMLElement;
      if (row) {
        const rect = row.getBoundingClientRect();
        existing.style.top = `${rect.top}px`;
        existing.style.left = `${rect.left}px`;
        existing.style.width = `${rect.width}px`;
        existing.style.height = `${rect.height}px`;
      }
      return;
    }

    // Remove stale zones (different path or conditions no longer met)
    if (existing) existing.remove();

    if (!shouldShow) return;

    const hoveredEl = this.nodeElements.get(
      this._findKeyByPath(snapshot.hoveredNodeForDropPath!)
    );
    if (!hoveredEl) return;

    const node = this.controller.getNodeByPath(snapshot.hoveredNodeForDropPath!);
    if (!node) return;

    const row = hoveredEl.querySelector('.wtv__node-row') as HTMLElement;
    if (!row) return;

    const rect = row.getBoundingClientRect();

    const allowedPositions = this.controller.getNodeAllowedDropPositions(node);
    const layout = this.lastNodeConfig?.dropZoneLayout || 'around';
    const start = this.lastNodeConfig?.dropZoneStart ?? 33;
    const maxWidth = this.lastNodeConfig?.dropZoneMaxWidth ?? 120;

    const zones = document.createElement('div');
    zones.className = `wtv__drop-zones wtv__drop-zones--${layout}`;
    zones.setAttribute('data-tree-path', snapshot.hoveredNodeForDropPath!);
    zones.style.position = 'fixed';
    zones.style.top = `${rect.top}px`;
    zones.style.left = `${rect.left}px`;
    zones.style.width = `${rect.width}px`;
    zones.style.height = `${rect.height}px`;
    zones.style.setProperty('--drop-zone-start', typeof start === 'number' ? `${start}%` : start);
    zones.style.setProperty('--drop-zone-max-width', `${maxWidth}px`);

    const positions: DropPosition[] = allowedPositions || ['before', 'after', 'child'];
    for (const pos of positions) {
      const zone = document.createElement('div');
      zone.className = `wtv__drop-zone wtv__drop-zone--${pos}`;
      zone.setAttribute('data-drop-position', pos);
      zone.textContent = pos.charAt(0).toUpperCase() + pos.slice(1);
      zones.appendChild(zone);
    }

    this.bodyEl.appendChild(zones);
  }

  // ── Context menu (Floating UI) ──────────────────────────────────────

  private _updateContextMenu(snapshot: TreeControllerSnapshot<T>): void {
    if (!this.contextMenuEl || !this.controller) return;

    if (!snapshot.contextMenuVisible || !snapshot.contextMenuNode) {
      this._closeAllSubmenus();
      this._ctxCleanupAutoUpdate?.();
      this._ctxCleanupAutoUpdate = null;
      this._removeCtxKeydownHandler();
      this.contextMenuEl.style.display = 'none';
      return;
    }

    // Custom context menu render callback
    if (this.config.renderContextMenuCallback) {
      this.contextMenuEl.innerHTML = '';
      this.contextMenuEl.style.display = 'block';
      this.config.renderContextMenuCallback(
        snapshot.contextMenuNode,
        () => this.controller!.closeContextMenu(),
        this.contextMenuEl
      );
      // Position with Floating UI using virtual element at cursor
      this._positionAtCursor(this.contextMenuEl, snapshot.contextMenuX, snapshot.contextMenuY, snapshot.contextMenuXOffset, snapshot.contextMenuYOffset);
      return;
    }

    // Default: render items from contextMenuCallback
    const callbackRef = this.controller.contextMenuCallbackCb;
    if (callbackRef) {
      const items: ContextMenuEntry[] = callbackRef(
        snapshot.contextMenuNode,
        () => this.controller!.closeContextMenu()
      );
      this.contextMenuEl.innerHTML = '';
      this.contextMenuEl.style.display = 'block';
      this._renderContextMenuItems(items, this.contextMenuEl, snapshot.contextMenuNode);
      this._positionAtCursor(this.contextMenuEl, snapshot.contextMenuX, snapshot.contextMenuY, snapshot.contextMenuXOffset, snapshot.contextMenuYOffset);
      this._installCtxKeydownHandler();
    }
  }

  /** Position a menu element at cursor coordinates using Floating UI */
  private _positionAtCursor(menuEl: HTMLElement, x: number, y: number, xOffset: number = 0, yOffset: number = 0): void {
    this._ctxCleanupAutoUpdate?.();
    // Virtual reference element at cursor position (offsets shift the anchor point)
    const ax = x + xOffset;
    const ay = y + yOffset;
    const virtualRef = {
      getBoundingClientRect: () => ({
        x: ax, y: ay, width: 0, height: 0,
        top: ay, left: ax, right: ax, bottom: ay,
      }),
    };
    this._ctxCleanupAutoUpdate = autoUpdate(virtualRef, menuEl, () => {
      computePosition(virtualRef, menuEl, {
        strategy: 'fixed',
        placement: 'bottom-start',
        middleware: [offset(0), flip(), shift({ padding: 8 })],
      }).then(({ x: fx, y: fy }) => {
        menuEl.style.left = `${fx}px`;
        menuEl.style.top = `${fy}px`;
      });
    });
  }

  /** Position a submenu next to its parent item using Floating UI */
  private _positionSubmenu(parentItem: HTMLElement, submenuEl: HTMLElement): () => void {
    return autoUpdate(parentItem, submenuEl, () => {
      if (!parentItem.isConnected || !submenuEl.isConnected) return;
      computePosition(parentItem, submenuEl, {
        strategy: 'fixed',
        placement: 'right-start',
        middleware: [offset({ mainAxis: 0, crossAxis: -4 }), flip({ fallbackPlacements: ['left-start'] }), shift({ padding: 8 })],
      }).then(({ x: fx, y: fy }) => {
        if (submenuEl.isConnected) {
          submenuEl.style.left = `${fx}px`;
          submenuEl.style.top = `${fy}px`;
        }
      });
    });
  }

  private _renderContextMenuItems(entries: ContextMenuEntry[], container: HTMLElement, contextNode: LTreeNode<T>, cancelParentHide?: () => void): void {
    // Check if any item in this level has an icon — if so, reserve column for all items
    const hasAnyIcon = entries.some(e => !('divider' in e && e.divider) && (e as ContextMenuItem).icon);

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];

      // Divider entry
      if ('divider' in entry && entry.divider) {
        const divider = document.createElement('div');
        divider.className = 'wtv__context-menu-divider';
        if (entry.label) {
          divider.classList.add('wtv__context-menu-divider--named');
          divider.textContent = entry.label;
        }
        container.appendChild(divider);
        continue;
      }

      const item = entry as ContextMenuItem;

      // Skip hidden items
      if (item.isVisible === false) continue;

      const btn = document.createElement('button');
      btn.className = 'wtv__context-menu-item';
      if (item.id) btn.setAttribute('data-item-id', item.id);
      if (item.shortcut) btn.setAttribute('data-shortcut', item.shortcut);
      if (item.isDisabled) btn.classList.add('wtv__context-menu-item--disabled');
      if (item.children?.length) btn.classList.add('wtv__context-menu-item--has-children');
      if (item.className) btn.classList.add(item.className);

      // Custom item rendering: callback gets first shot, default fills in if empty
      if (this.config.renderContextMenuItemCallback) {
        this.config.renderContextMenuItemCallback(item, contextNode, btn);
      }
      // Default rendering if callback didn't populate the button
      if (!btn.hasChildNodes()) {
        if (hasAnyIcon) {
          const icon = document.createElement('span');
          icon.className = 'wtv__context-menu-icon';
          if (item.icon) icon.textContent = item.icon;
          btn.appendChild(icon);
        }

        const labelSpan = document.createElement('span');
        labelSpan.className = 'wtv__context-menu-label';
        labelSpan.textContent = item.label;
        btn.appendChild(labelSpan);

        if (item.shortcut) {
          const shortcutSpan = document.createElement('span');
          shortcutSpan.className = 'wtv__context-menu-shortcut';
          shortcutSpan.textContent = item.shortcut;
          btn.appendChild(shortcutSpan);
        }

        if (item.children?.length) {
          const arrow = document.createElement('span');
          arrow.className = 'wtv__context-menu-arrow';
          arrow.textContent = '\u25B8'; // ▸
          btn.appendChild(arrow);
        }
      }

      // Submenu hover logic
      if (item.children?.length) {
        let submenuEl: HTMLElement | null = null;
        let cleanupPos: (() => void) | null = null;
        let hideTimeout: ReturnType<typeof setTimeout> | null = null;

        const cancelHide = () => {
          if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }
          cancelParentHide?.();
        };

        const showSubmenu = () => {
          cancelHide();
          if (submenuEl) return;
          submenuEl = document.createElement('div');
          submenuEl.className = 'wtv__context-menu wtv__context-submenu';
          submenuEl.style.display = 'block';
          submenuEl.style.position = 'fixed';
          this._renderContextMenuItems(item.children!, submenuEl, contextNode, cancelHide);
          this.container!.appendChild(submenuEl);
          this._ctxSubmenus.push(submenuEl);
          cleanupPos = this._positionSubmenu(btn, submenuEl);

          submenuEl.addEventListener('mouseenter', () => {
            cancelHide();
          });
          submenuEl.addEventListener('mouseleave', () => {
            hideTimeout = setTimeout(hideSubmenu, 150);
          });
        };

        const hideSubmenu = () => {
          if (cleanupPos) { cleanupPos(); cleanupPos = null; }
          if (submenuEl) {
            const idx = this._ctxSubmenus.indexOf(submenuEl);
            if (idx >= 0) this._ctxSubmenus.splice(idx, 1);
            submenuEl.remove();
            submenuEl = null;
          }
        };

        btn.addEventListener('mouseenter', showSubmenu);
        btn.addEventListener('mouseleave', () => {
          hideTimeout = setTimeout(hideSubmenu, 150);
        });
      } else if (!item.isDisabled && item.onclick) {
        btn.addEventListener('click', async () => {
          try {
            await item.onclick?.();
          } catch (error) {
            console.error('Context menu callback error:', error);
          } finally {
            // Auto-close after activating a leaf item — like every native menu.
            // Opt out with shouldCloseOnClick:false to keep the menu open for
            // incremental actions; the handler then dismisses it via close().
            if (item.shouldCloseOnClick !== false) this.controller?.closeContextMenu();
          }
        });
      }

      container.appendChild(btn);
    }
  }

  private _closeAllSubmenus(): void {
    for (const el of this._ctxSubmenus) {
      el.remove();
    }
    this._ctxSubmenus = [];
  }

  /** Install keydown listener for shortcut matching while context menu is open */
  private _installCtxKeydownHandler(): void {
    this._removeCtxKeydownHandler();
    this._ctxKeydownHandler = (e: KeyboardEvent) => {
      if (!this.container) return;
      const key = e.key.toLowerCase();
      const menuItems = this.container.querySelectorAll('.wtv__context-menu-item[data-shortcut]') as NodeListOf<HTMLElement>;
      for (const el of menuItems) {
        const shortcut = el.dataset.shortcut!;
        const disabled = el.classList.contains('wtv__context-menu-item--disabled');
        if (disabled) continue;
        if (shortcut.toLowerCase() === key || shortcut === e.key) {
          e.preventDefault();
          el.click();
          return;
        }
      }
    };
    document.addEventListener('keydown', this._ctxKeydownHandler);
  }

  private _removeCtxKeydownHandler(): void {
    if (this._ctxKeydownHandler) {
      document.removeEventListener('keydown', this._ctxKeydownHandler);
      this._ctxKeydownHandler = null;
    }
  }

  // ── Debug info ──────────────────────────────────────────────────────

  private _updateDebugInfo(snapshot: TreeControllerSnapshot<T>): void {
    if (!this.debugEl || !this.controller) return;

    if (!snapshot.shouldDisplayDebugInformation) {
      this.debugEl.style.display = 'none';
      return;
    }

    this.debugEl.style.display = 'block';
    const stats = this.controller.statistics;
    if (!stats) return;

    this.debugEl.innerHTML = `
      <details>
        <summary>Tree Debug Info</summary>
        <div class="wtv__debug-stats">
          <span>Nodes: ${stats.nodeCount}</span>
          <span>Visible: ${snapshot.flatNodesToRender.length}</span>
          <span>Max Level: ${stats.maxLevel}</span>
          <span>Flat: ${snapshot.isFlatRenderingEnabled}</span>
          <span>Rendering: ${snapshot.isRendering}</span>
          ${snapshot.isVirtualScrollEnabled ? `<span>VScroll: on</span><span>RowH: ${snapshot.virtualRowHeight}px</span>` : ''}
        </div>
      </details>
    `;
  }

  // ── Full render (for config changes) ────────────────────────────────

  private _fullRender(snapshot: TreeControllerSnapshot<T>): void {
    // Clear all node elements and re-create
    for (const [, el] of this.nodeElements) {
      el.remove();
    }
    this.nodeElements.clear();
    this._destroyAllTooltips();
    this._onStateChange(snapshot);
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  private _findKeyByPath(path: string): string {
    for (const [key, el] of this.nodeElements) {
      if (el.getAttribute('data-tree-path') === path) return key;
    }
    return '';
  }
}
