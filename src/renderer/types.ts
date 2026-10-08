/**
 * Pluggable renderer interface.
 * External packages (Svelte, React, Vue) can implement TreeViewRenderer
 * to provide framework-native rendering while using the shared TreeController.
 */

import type { TreeController } from '../controller/tree-controller';
import type { LTreeNode } from '../ltree/ltree-node';
import type { NodeRenderContext } from '../controller/types';

export interface TreeViewRenderer<T = any> {
  /** Mount the renderer into a container, subscribing to controller state changes. */
  mount(container: HTMLElement, controller: TreeController<T>, config: RendererConfig<T>): void;
  /** Update renderer configuration without full re-mount. */
  updateConfig(config: Partial<RendererConfig<T>>): void;
  /** Tear down DOM and unsubscribe from controller events. */
  destroy(): void;
}

export interface RendererConfig<T> {
  /** Per-instance theme. Renderer forwards as `data-theme` on the `.wtv__container`.
   *  See `dark-mode.css` for the cascade. */
  theme?: 'dark' | 'light' | null;
  /** Custom node content renderer. Receives the node, a container element to populate,
   *  and the NodeRenderContext (device + container + live node state). */
  renderNodeCallback?: (node: LTreeNode<T>, container: HTMLElement, ctx: NodeRenderContext) => void;
  /** Custom per-node icon renderer. Receives the node, the resolved icon VALUE
   *  (from iconMember/iconCallback), the `.wtv__node-icon` element to populate, and the
   *  NodeRenderContext. Wins over the default `<i class="wtv__node-icon {value}">`. */
  renderIconCallback?: (node: LTreeNode<T>, value: string | null, iconEl: HTMLElement, ctx: NodeRenderContext) => void;
  /** Informational display when the tree has no data (e.g. "No items to display"). */
  renderEmptyStateCallback?: (container: HTMLElement) => void;
  /** Fallback text for an empty tree when no renderEmptyStateCallback is given. Default "No data". */
  noDataText?: string | null;
  /** Drop zone rendered in an empty tree during drag operations. */
  renderEmptyZoneCallback?: (container: HTMLElement) => void;
  /** Keep the empty drop zone visible whenever the tree is empty (not only during a
   *  drag), and make it focusable + focus-on-hover so a Ctrl/Cmd+V pastes into it. */
  shouldShowDropPlaceholderWhenEmpty?: boolean | null;
  /** Rendered when isLoading is true. */
  renderLoadingCallback?: (container: HTMLElement) => void;
  /** Rendered above the tree body. */
  renderHeaderCallback?: (container: HTMLElement) => void;
  /** Rendered below the tree body. */
  renderFooterCallback?: (container: HTMLElement) => void;
  /** Full context menu renderer (takes over entire menu). */
  renderContextMenuCallback?: (node: LTreeNode<T>, close: () => void, container: HTMLElement) => void;
  /** Per-item context menu renderer. Receives item, node, and container for custom item content. */
  renderContextMenuItemCallback?: (item: import('../ltree/types').ContextMenuItem, node: LTreeNode<T>, container: HTMLElement) => void;
}
