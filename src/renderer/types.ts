import type { TreeViewLabels } from '../labels';
/**
 * Pluggable renderer interface.
 * External packages (Svelte, React, Vue) can implement TreeViewRenderer
 * to provide framework-native rendering while using the shared TreeEngine.
 */

import type { TreeEngine } from '../controller/tree-engine';
import type { LTreeNode } from '../ltree/ltree-node';
import type { NodeRenderContext } from '../controller/types';
import type { ResolvedActionItem } from '@keenmate/web-components-core/actions';
import type { TreeMenuContext, TreeMenuItem, TreeViewAction } from '../interaction';

export interface TreeViewRenderer<T = any> {
  /** Mount the renderer into a container, subscribing to controller state changes. */
  mount(container: HTMLElement, controller: TreeEngine<T>, config: RendererConfig<T>): void;
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
  /** Per-instance theme. Renderer forwards as `data-theme` on the `.wtv__container`.
   *  See `dark-mode.css` for the cascade. */
  theme?: 'dark' | 'light' | null;
  /** Built-in label overflow (`data-node-title-overflow` on `.wtv__container`). Default `'ellipsis'`. */
  nodeTitleOverflow?: NodeTitleOverflow | null;
  /** The tree container was resized (also once when observing starts). */
  containerResizeCallback?: (size: ContainerSize, deviceClass: import('@keenmate/web-components-core').DeviceClass) => void;
  /** Custom node content renderer. Receives the node, a container element to populate,
   *  and the NodeRenderContext (device + container + live node state). */
  renderNodeCallback?: (node: LTreeNode<T>, container: HTMLElement, ctx: NodeRenderContext) => void;
  /** Custom per-node icon renderer. Receives the node, the resolved icon VALUE
   *  (from iconMember/iconCallback), the `.wtv__node-icon` element to populate, and the
   *  NodeRenderContext. Wins over the default `<i class="wtv__node-icon {value}">`. */
  renderIconCallback?: (node: LTreeNode<T>, value: string | null, iconEl: HTMLElement, ctx: NodeRenderContext) => void;
  /** Informational display when the tree has no data (e.g. "No items to display"). */
  renderEmptyStateCallback?: (container: HTMLElement) => void;
  /** UI strings (partial; `empty` = empty-tree text, `dropHere` = empty drop-zone text) — see `resolveLabel`. */
  labels?: Partial<TreeViewLabels> | null;
  /** Drop zone rendered in an empty tree during drag operations. */
  renderEmptyZoneCallback?: (container: HTMLElement) => void;
  /** Keep the empty drop zone visible whenever the tree is empty (not only during a
   *  drag), and make it focusable + focus-on-hover so a Ctrl/Cmd+V pastes into it. */
  isEmptyDropPlaceholderShown?: boolean | null;
  /** Draws the loader into the overlay while isLoading is true; returns its remove().
   *  WebTreeView binds it to core `renderLoader` (instance hook → page hook → default). */
  renderLoadingCallback?: ((container: HTMLElement, label: string) => () => void) | null;
  /** Rendered above the tree body. */
  renderHeaderCallback?: (container: HTMLElement) => void;
  /** Rendered below the tree body. */
  renderFooterCallback?: (container: HTMLElement) => void;
  /** Full context menu renderer (takes over entire menu). */
  renderContextMenuCallback?: (node: LTreeNode<T>, close: () => void, container: HTMLElement) => void;
  /** Per-item context menu renderer. Receives item, node, and container for custom item content. */
  renderContextMenuItemCallback?: (item: TreeMenuItem<T>, node: LTreeNode<T>, container: HTMLElement) => void;

  // ── Interaction model (supplied by WebTreeView) ───────────────────────
  /** The context menu's surface ctx for `node` (NodeRef + controller / element). */
  contextMenuContext?: (node: LTreeNode<T>) => TreeMenuContext<T>;
  /** Built-in state of an item (text / shortcut / disabled / danger of `copy`, `paste`, …). */
  contextMenuItemDefaults?: (item: TreeMenuItem<T>, ctx: TreeMenuContext<T>) => Partial<ResolvedActionItem<TreeViewAction>> | undefined;
  /**
   * Activate an item (core `runAction`: `beforeActionCallback` → `onClick` → `action`
   * event → built-in). Resolves `false` when cancelled.
   */
  activateContextMenuItem?: (item: TreeMenuItem<T>, ctx: TreeMenuContext<T>, trigger: HTMLElement, event: Event) => Promise<boolean>;
}
