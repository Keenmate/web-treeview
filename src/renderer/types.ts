import type { Labels } from '@keenmate/web-components-core/locale';
import type { SlotResult } from '@keenmate/web-components-core';
import type { TreeViewLabels } from '../labels';
import type { TreeLayerOpener } from './layers';
/**
 * Pluggable renderer interface.
 * External packages (Svelte, React, Vue) can implement TreeViewRenderer
 * to provide framework-native rendering over the shared TreeViewState (the headless tree state).
 */

import type { TreeViewState } from '../controller/tree-view-state';
import type { LTreeNode } from '../ltree/ltree-node';
import type { NodeRenderContext } from '../controller/types';
import type { ResolvedActionItem } from '@keenmate/web-components-core/actions';
import type { MenuDrawerSide, MenuPresentation } from '@keenmate/web-components-core/menu';
import type { TreeMenuContext, TreeMenuItem, TreeViewAction } from '../interaction';

export interface TreeViewRenderer<T = any> {
  /** Mount the renderer into a container, subscribing to the state's `state-change` snapshots. */
  mount(container: HTMLElement, state: TreeViewState<T>, config: RendererConfig<T>): void;
  /** Update renderer configuration without full re-mount. */
  updateConfig(config: Partial<RendererConfig<T>>): void;
  /** Tear down DOM and unsubscribe from controller events. */
  destroy(): void;
  /**
   * The host was detached (a DOM move or a removal): stop LIVE resources only —
   * document / window listeners, observers, floating-ui autoUpdate, open
   * popups — and keep the rendered DOM and all state. Optional; idempotent.
   */
  deactivate?(): void;
  /** The host was re-attached: restart what {@link deactivate} stopped. Optional; idempotent. */
  activate?(): void;
}

/** How a node's built-in label handles a too-long title: `wrap` (multi-line), `ellipsis`
 *  (single-line clip) or `info` (ellipsis + a trailing info button on clipped rows that
 *  reveals the full label on click). */
export type NodeTitleOverflow = 'wrap' | 'ellipsis' | 'info';

/** A measured box, px. */
export interface ContainerSize {
  width: number;
  height: number;
}

export interface RendererConfig<T> {
  /** Built-in label overflow (`data-node-title-overflow` on `.wtv__container`). Default `'ellipsis'`. */
  nodeTitleOverflow?: NodeTitleOverflow | null;
  /** Disabled (native semantics): the renderer ignores user input, drops the body from the tab
   *  order, sets `aria-disabled` and `.wtv__container--disabled`. Programmatic calls still work. */
  isDisabled?: boolean;
  /** Read-only: user input can't change the data (no check, drag, drop); navigation, expand /
   *  collapse and selection still work. `.wtv__container--readonly`. */
  isReadonly?: boolean;
  /** The tree container was resized (also once when observing starts). */
  onContainerResize?: (size: ContainerSize, deviceClass: import('@keenmate/web-components-core').DeviceClass) => void;
  /** Custom node content: returns the `.wtv__node-content` slot's content, read by core `renderSlot`
   *  (string = HTML, Node = mounted, `null` / `undefined` = the built-in label, `false` = hidden).
   *  Receives the node and the NodeRenderContext (device + container + live node state). */
  renderNodeCallback?: (node: LTreeNode<T>, ctx: NodeRenderContext) => SlotResult;
  /** The node icon's markup for a resolved icon VALUE (iconMember / iconCallback) — core `renderIcon`
   *  (markup → built-in name → the instance `renderIconCallback` → the page-wide one → icon-font
   *  `<i class="wtv__icon …">` → text), drawn INTO the `.wtv__node-icon` wrapper. `''` = no icon. */
  renderNodeIcon?: (value: string, node: LTreeNode<T>, ctx: NodeRenderContext) => string;
  /** The instance icon hook — only compared here: a changed one re-paints the icons. */
  renderIconCallback?: unknown;
  /** Informational display when the tree has no data (e.g. "No items to display"). The result is read by
   *  core `renderSlot` (string = HTML, Node = mounted, `null` / `undefined` = the built-in text, `false` = hidden). */
  renderEmptyStateCallback?: () => SlotResult;
  /** The tree's UI strings — core `/locale` `createLabels` over `TreeViewLabels` (instance `labels` →
   *  page-wide `window.components.locale.labels['web-treeview.<key>']` → English). Passing it re-applies the
   *  built-in texts on the live tree (a `labels` or page-wide locale change). */
  labels?: Labels<TreeViewLabels> | null;
  /** Drop zone rendered in an empty tree during drag operations. */
  renderEmptyZoneCallback?: () => SlotResult;
  /** Keep the empty drop zone visible whenever the tree is empty (not only during a
   *  drag), and make it focusable + focus-on-hover so a Ctrl/Cmd+V pastes into it. */
  isEmptyDropPlaceholderShown?: boolean | null;
  /** Draws the loader into the overlay while isLoading is true; returns its remove().
   *  TreeViewEngine binds it to core `renderLoader` (instance hook → page hook → default). */
  renderLoadingCallback?: ((container: HTMLElement, label: string) => () => void) | null;
  /** Rendered above the tree body. */
  renderHeaderCallback?: () => SlotResult;
  /** Rendered below the tree body. */
  renderFooterCallback?: () => SlotResult;
  /** Full context menu renderer (takes over entire menu). */
  renderContextMenuCallback?: (node: LTreeNode<T>, close: () => void, container: HTMLElement) => void;
  /** Per-item context menu renderer. Receives item, node, and container for custom item content. */
  renderContextMenuItemCallback?: (item: TreeMenuItem<T>, node: LTreeNode<T>, container: HTMLElement) => void;

  // ── Interaction model (supplied by TreeViewEngine) ───────────────────────
  /** The context menu's surface ctx for `node` (NodeRef + controller / element). */
  contextMenuContext?: (node: LTreeNode<T>) => TreeMenuContext<T>;
  /** Built-in state of an item (text / shortcut / disabled / danger of `copy`, `paste`, …). */
  contextMenuItemDefaults?: (item: TreeMenuItem<T>, ctx: TreeMenuContext<T>) => Partial<ResolvedActionItem<TreeViewAction>> | undefined;
  /**
   * Activate an item (core `runAction`: `beforeActionCallback` → `onClick` → `action`
   * event → built-in). Resolves `false` when cancelled.
   */
  activateContextMenuItem?: (item: TreeMenuItem<T>, ctx: TreeMenuContext<T>, trigger: HTMLElement, event: Event) => Promise<boolean>;
  /** Core `openMenu()` presentation + drawer side, read at every open (core `menuPresentationOptions()`
   *  over the effective config). Missing: core's defaults (`'auto'`, `'start'`). */
  menuPresentationOptions?: () => { presentation: MenuPresentation; side: MenuDrawerSide };
  /** Opens the drop pads' / touch ghost's core layer (`<web-treeview>`: + its custom CSS). Missing: core `createLayer()`. */
  openLayer?: TreeLayerOpener | null;
}
