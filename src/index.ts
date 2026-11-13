// Import styles (produces the shipped dist/web-treeview.css via Vite)
import './css/main.css';

import { registerComponent } from '@keenmate/web-components-core';
import { WebTreeViewElement } from './web-component';
import { logging } from './logger';

// Export the web component
export { WebTreeViewElement };

// Export the core engine wrapper
export { WebTreeView } from './treeview';
export { DEFAULT_LABELS, resolveLabel } from './labels';
export type { TreeViewLabels } from './labels';

// Core LTree (for direct usage without web component)
export { createLTree } from './ltree/ltree';
export type { Ltree, ExpandOptions, SortOptions, SortCompareContext, NodesReorderContext, InsertBranchResult, ReplaceBranchResult, RemoveBranchResult } from './ltree/types';
export type { LTreeNode, NodeId, DropPosition } from './ltree/ltree-node';
export { VisualState } from './ltree/ltree-node';

// Engine (internal state; for renderer authors / advanced use — element consumers use
// `el.controller`, the public TreeViewController facade)
export { TreeEngine } from './controller/tree-engine';
export { EventEmitter } from './controller/event-emitter';
export type {
  NodeCallbacks,
  NodeConfig,
  ClickBehavior,
  SelectionModifiers,
  RangeSelectionMode,
  TreeEngineConfig,
  TreeEngineSnapshot,
  TreeEngineEvents,
  // engine-side shapes the public ctx / detail types build on
  NodeRef,
  NodeEventContext,
  NodeDragContext,
  NodeDropContext,
  ClipboardEventContext,
  SelectionChangeContext,
  TreeKeydownContext,
  NodeTransformContext,
  BeforeCopyContext,
  BeforeDeleteContext,
  BeforePasteContext,
  BeforeDropContext,
  DragStartContext,
  DropGroup,
  SelectMode,
  TreeMutationOptions,
  CheckboxMode,
  CascadeCheckPolicy,
  TooltipPlacement,
  TooltipDelay,
  NodeRenderContext,
  TreeViewScrollSource,
  TreeViewScrollOptions
} from './controller/types';

// Clipboard
export {
  setClipboard,
  getClipboard,
  clearClipboard,
  hasClipboard,
  getClipboardOperation,
  registerClipboardTree,
  unregisterClipboardTree,
  getClipboardTree,
  setDragSet,
  getDragSet,
  clearDragSet,
  uniqueName
} from './clipboard';
export type {
  ClipboardEntry,
  TreeClipboard,
  ClipboardOperation,
  ClipboardSourceTree,
  PasteResult
} from './clipboard';

// Navigation
export type { TreeNavigation, TreeNavigationOverrides } from './navigation';

// Renderer
export { DomRenderer } from './renderer/dom-renderer';
export { createRenderCoordinator } from './renderer/render-coordinator';
export type { TreeViewRenderer, RendererConfig, NodeTitleOverflow, ContainerSize } from './renderer/types';
export type { RenderCoordinator, RenderStats, RenderCoordinatorCallbacks } from './renderer/render-coordinator';

// Export types
export type {
  TreeNode,
  TreeViewConfig,
  TreeViewResponsiveMap,
  TreeViewElementConfig,
  TreeViewResponsiveCallback,
  TreeViewMethods,
  TreeEventMap,
  ScrollToPathOptions,
  InsertArrayResult,
  TreeChange,
  ApplyChangesResult,
  DragDropMode,
  DropZoneLayout,
  DropOperation,
  FilterScope,
  IndexProgress,
  SearchStatus
} from './types';

// The interaction model: controller facade, callback contexts, menu items, event details.
export type * from './interaction';
// Menu dividers for getContextMenuItemsCallback: `createMenuDivider('Group')`; submenu entries for a
// renderContextMenuCallback (`getMenuChildren(item, ctx)`).
export { createMenuDivider, getMenuChildren } from '@keenmate/web-components-core/actions';
export type { ResolvedMenuEntry } from '@keenmate/web-components-core/actions';
// The shared loader hook (renderLoadingCallback / window.components.renderLoadingCallback, core SPEC §12.14).
export type { LoaderRenderContext, RenderLoaderCallback } from '@keenmate/web-components-core';

// Logging — now a thin shim over @keenmate/web-components-core (SPEC §12.1).
export {
  enableLogging,
  disableLogging,
  resetLogging,
  setLogLevel,
  setCategoryLevel,
  LOGGING_CATEGORIES,
  initLogger,
  dataLogger,
  indexLogger,
  uiLogger,
  dragLogger,
  renderLogger,
} from './logger';
export { enablePerfLogging, disablePerfLogging, setPerfThreshold } from './perf-logger';

// Auto-register the custom element
import './web-component';

// Type declarations for build-time constants
declare const __VERSION__: string;
declare const __PACKAGE_NAME__: string;
declare const __AUTHOR__: string;
declare const __LICENSE__: string;
declare const __REPOSITORY__: string;
declare const __HOMEPAGE__: string;

// The whole hand-rolled `window.components['web-treeview'] = { … }` block —
// version/config/register/getInstances — collapses to one core call.
// registerComponent defines the element, publishes build metadata + the
// flattened logging controls, and wires getInstances() to the live-instance
// registry that BlissElement maintains automatically (add on connect / remove on
// disconnect).
//
//   window.components['web-treeview'].getInstances()
//   window.components['web-treeview'].logging.enableLogging()
registerComponent('web-treeview', WebTreeViewElement as unknown as CustomElementConstructor, {
  config: {
    name: typeof __PACKAGE_NAME__ !== 'undefined' ? __PACKAGE_NAME__ : '@keenmate/web-treeview',
    version: typeof __VERSION__ !== 'undefined' ? __VERSION__ : '0.0.0',
    author: typeof __AUTHOR__ !== 'undefined' ? __AUTHOR__ : 'Keenmate',
    license: typeof __LICENSE__ !== 'undefined' ? __LICENSE__ : 'MIT',
    repository: typeof __REPOSITORY__ !== 'undefined' ? __REPOSITORY__ : '',
    homepage: typeof __HOMEPAGE__ !== 'undefined' ? __HOMEPAGE__ : '',
  },
  logging,
});

declare global {
  interface HTMLElementTagNameMap {
    'web-treeview': WebTreeViewElement;
  }
}
