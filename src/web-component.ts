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
 * `config` to the real engine (`WebTreeView` in `treeview.ts`), the DOM-event
 * wrappers, and the custom-styles injection.
 *
 * Reactivity model: the engine (`WebTreeView` → controller + renderer) applies
 * every config change in place via `update()`; it is built once per connect and
 * destroyed on disconnect (a DOM move rebuilds it, matching the old element,
 * which also re-initialized on every reconnect). So every reactive input is
 * `on:'update'`; inputs whose old setter did NOT schedule an update (search-index
 * config, the pure/bridged callbacks) are `on:'none'` — read from `this.config`
 * at engine-build time, exactly as before.
 */
import {
  BlissElement,
  toBool,
  toEnum,
  toInt,
  toFloat,
  toText,
  toValue,
  toCustom,
  toFunction,
  adoptStyles,
  type InputDef,
  type EventDef,
} from '@keenmate/web-components-core';
import { WebTreeView } from './treeview';
import type { TreeViewConfig, ScrollToPathOptions } from './types';
import type { LTreeNode, DropPosition } from './ltree/ltree-node';
import type { Ltree } from './ltree/types';
import type { TreeViewRenderer } from './renderer/types';
import type { HighlightMode, TreeMutationOptions, NodeTransformContext } from './controller/types';
import type { PasteResult } from './clipboard';
import type { TreeController } from './controller/tree-controller';
import { initLogger } from './logger';
import styles from './css/main.css?inline';

/** Any callback input. */
const cb = (): ReturnType<typeof toFunction> => toFunction();

/**
 * `drop-zone-start` accepts a NUMBER (percentage of node width) or a STRING used
 * as-is (`px` or `%`), mirroring the engine's `number | string` contract. A plain
 * `toInt()` would narrow strings like "50px" to a bare number (→ treated as a
 * percentage), regressing the old property setter which passed strings through.
 * Attribute path: a bare numeric string becomes a number (percentage, matching
 * the old `parseInt`); anything else (e.g. "50px", "33%") stays a string.
 */
const toDropZoneStart = () =>
  toCustom<number | string>(
    (raw) => {
      if (raw === null || raw.trim() === '') return undefined as unknown as number | string;
      const s = raw.trim();
      return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : s;
    },
    { validate: (v): v is number | string => typeof v === 'number' || typeof v === 'string' },
  );

// ============================================================================
// INPUT TABLE — the whole <web-treeview> public surface, one row each.
//
// HTML attribute names stay kebab-case; the JS config keys follow the
// BlissFramework naming convention (is/should/has prefixes). Both were fixed by
// the rc05 API rename; the table below just moves them from the hand-coded
// `ATTRIBUTE_TABLE` onto the core input model verbatim.
// ============================================================================
const INPUTS: readonly InputDef[] = [
  // ── Tree identification ────────────────────────────────────────────────────
  { configKey: 'treeId', attribute: 'tree-id', converter: toText({ isNullable: true }), on: 'update', description: 'Stable identifier for this tree (clipboard / cross-tree operations).' },

  // ── Member mappings: required (with defaults) ──────────────────────────────
  { configKey: 'idMember', attribute: 'id-member', converter: toText({ default: 'id' }), on: 'update', description: 'Property name on a node object that holds its id.' },
  { configKey: 'pathMember', attribute: 'path-member', converter: toText({ default: 'path' }), on: 'update', description: 'Property name that holds a node materialized tree path.' },
  { configKey: 'displayValueMember', attribute: 'display-value-member', converter: toText({ default: 'displayValue' }), on: 'update', description: 'Property name that holds a node display label.' },
  { configKey: 'displayValueFallback', attribute: 'display-value-fallback', converter: toText({ isNullable: true, isEmptyAllowed: true }), on: 'update', description: 'Text shown for a node with no resolvable display value (default "[N/A]"; empty renders nothing).' },

  // ── Member mappings: optional (absent → default via engine) ────────────────
  { configKey: 'parentPathMember', attribute: 'parent-path-member', converter: toText({ isNullable: true }), on: 'update', description: 'Property name holding a node parent path.' },
  { configKey: 'levelMember', attribute: 'level-member', converter: toText({ isNullable: true }), on: 'update', description: 'Property name holding a node depth level.' },
  { configKey: 'isExpandedMember', attribute: 'is-expanded-member', converter: toText({ isNullable: true }), on: 'update', description: 'Property name flagging whether a node is expanded.' },
  { configKey: 'isSelectedMember', attribute: 'is-selected-member', converter: toText({ isNullable: true }), on: 'update', description: 'Property name flagging whether a node is selected (checkbox).' },
  { configKey: 'isDraggableMember', attribute: 'is-draggable-member', converter: toText({ isNullable: true }), on: 'update', description: 'Property name flagging whether a node is draggable.' },
  { configKey: 'isDropAllowedMember', attribute: 'is-drop-allowed-member', converter: toText({ isNullable: true }), on: 'update', description: 'Property name flagging whether a drop is allowed onto a node.' },
  { configKey: 'hasChildrenMember', attribute: 'has-children-member', converter: toText({ isNullable: true }), on: 'update', description: 'Property name flagging that a node has children (lazy trees).' },
  { configKey: 'searchValueMember', attribute: 'search-value-member', converter: toText({ isNullable: true }), on: 'update', description: 'Property name a node is searched against.' },
  { configKey: 'isSelectableMember', attribute: 'is-selectable-member', converter: toText({ isNullable: true }), on: 'update', description: 'Property name flagging whether a node can be selected.' },
  { configKey: 'isCollapsibleMember', attribute: 'is-collapsible-member', converter: toText({ isNullable: true }), on: 'update', description: 'Property name flagging whether a node can be collapsed.' },
  { configKey: 'orderMember', attribute: 'order-member', converter: toText({ isNullable: true }), on: 'update', description: 'Property name used to order sibling nodes.' },
  { configKey: 'allowedDropPositionsMember', attribute: 'allowed-drop-positions-member', converter: toText({ isNullable: true }), on: 'update', description: 'Property name listing the drop positions allowed on a node.' },
  { configKey: 'iconMember', attribute: 'icon-member', converter: toText({ isNullable: true }), on: 'update', description: 'Property name that holds a per-node icon.' },

  // ── Behavior ───────────────────────────────────────────────────────────────
  { configKey: 'expandLevel', attribute: 'expand-level', converter: toInt(), on: 'update', description: 'Depth to auto-expand on load (0 = roots only).' },
  { configKey: 'treePathSeparator', attribute: 'tree-path-separator', converter: toText({ isNullable: true, isEmptyAllowed: true }), on: 'update', description: 'Separator between segments in a materialized tree path.' },
  { configKey: 'clickBehavior', attribute: 'click-behavior', converter: toEnum(['select', 'expand', 'expand-and-focus'] as const), on: 'update', description: 'What a node click does: select, expand, or expand-and-focus.' },
  { configKey: 'isAccordionExpand', attribute: 'accordion-expand', converter: toBool('tristate'), on: 'update', type: 'boolean', description: 'Accordion mode: expanding a node collapses its siblings.' },
  { configKey: 'isSorted', attribute: 'is-sorted', converter: toBool('tristate'), on: 'update', type: 'boolean', description: 'Keep siblings sorted (by orderMember / sortCallback).' },

  // ── Search / indexer ───────────────────────────────────────────────────────
  { configKey: 'shouldUseInternalSearchIndex', attribute: 'should-use-internal-search-index', converter: toBool('tristate'), on: 'update', type: 'boolean', description: 'Build an internal FlexSearch index for search.' },
  { configKey: 'indexerBatchSize', attribute: 'indexer-batch-size', converter: toInt(), on: 'update', description: 'Nodes indexed per batch when building the search index.' },
  { configKey: 'indexerTimeout', attribute: 'indexer-timeout', converter: toInt(), on: 'update', description: 'Idle timeout (ms) between search-index batches.' },
  { configKey: 'searchText', attribute: 'search-text', converter: toText({ isNullable: true, isEmptyAllowed: true }), on: 'update', description: 'Active search/filter term.' },

  // ── Theme / visual classes ─────────────────────────────────────────────────
  { configKey: 'theme', attribute: 'theme', converter: toEnum(['dark', 'light'] as const, { shouldNullOnInvalid: true }), on: 'update', description: 'Force a `dark` / `light` theme (unset → follow host).' },
  { configKey: 'bodyClass', attribute: 'body-class', converter: toText({ isNullable: true }), on: 'update', description: 'Extra class on the tree body container.' },
  { configKey: 'highlightedNodeClass', attribute: 'highlighted-node-class', converter: toText({ isNullable: true }), on: 'update', description: 'Class applied to highlighted nodes.' },
  { configKey: 'focusedNodeClass', attribute: 'focused-node-class', converter: toText({ isNullable: true }), on: 'update', description: 'Class applied to the focused node.' },
  { configKey: 'dragOverNodeClass', attribute: 'drag-over-node-class', converter: toText({ isNullable: true }), on: 'update', description: 'Class applied to a node being dragged over.' },
  { configKey: 'iconSet', attribute: 'icon-set', converter: toEnum(['chevron', 'triangle', 'plus-minus', 'arrow'] as const), on: 'update', reflect: true, description: 'Disclosure glyph set: chevron (default) | triangle | plus-minus | arrow. Re-points the --wtv-icon-* variables via a :host([icon-set]) rule; reflected to the attribute so the CSS matches when set via the JS property.' },
  { configKey: 'expandIconClass', attribute: 'expand-icon-class', converter: toText({ isNullable: true }), on: 'update', description: 'DEPRECATED — use icon-set. Escape hatch: a custom class attached to the expandable toggle.' },
  { configKey: 'collapseIconClass', attribute: 'collapse-icon-class', converter: toText({ isNullable: true }), on: 'update', description: 'DEPRECATED — glyph swap is now CSS-driven (icon-set + toggle-icon-mode); no longer selects the expanded glyph.' },
  { configKey: 'leafIconClass', attribute: 'leaf-icon-class', converter: toText({ isNullable: true }), on: 'update', description: 'Icon class for leaf nodes.' },
  { configKey: 'toggleIconMode', attribute: 'toggle-icon-mode', converter: toEnum(['rotate', 'swap'] as const), on: 'update', reflect: true, description: 'Whether the toggle glyph rotates (single glyph) or swaps (expand↔collapse glyph). Reflected to the attribute so the :host([toggle-icon-mode="swap"]) CSS matches via the JS property.' },
  { configKey: 'scrollHighlightClass', attribute: 'scroll-highlight-class', converter: toText({ isNullable: true }), on: 'update', description: 'Class flashed on a node after scrollToPath().' },
  { configKey: 'scrollHighlightTimeout', attribute: 'scroll-highlight-timeout', converter: toInt(), on: 'update', description: 'How long (ms) the scroll highlight stays before clearing.' },

  // ── Per-node icons ─────────────────────────────────────────────────────────
  { configKey: 'shouldAlignNodeIcons', attribute: 'align-node-icons', converter: toBool('tristate'), on: 'update', type: 'boolean', description: 'Reserve a fixed icon column so node labels align.' },

  // ── Context menu ───────────────────────────────────────────────────────────
  { configKey: 'contextMenuXOffset', attribute: 'context-menu-x-offset', converter: toInt(), on: 'update', description: 'Horizontal offset (px) of the context menu from the pointer.' },
  { configKey: 'contextMenuYOffset', attribute: 'context-menu-y-offset', converter: toInt(), on: 'update', description: 'Vertical offset (px) of the context menu from the pointer.' },

  // ── Debug / loading ────────────────────────────────────────────────────────
  { configKey: 'shouldDisplayDebugInformation', attribute: 'should-display-debug-information', converter: toBool('tristate'), on: 'update', type: 'boolean', description: 'Render in-tree debug diagnostics.' },
  { configKey: 'isLoading', attribute: 'is-loading', converter: toBool('tristate'), on: 'update', type: 'boolean', description: 'Show the loading state.' },

  // ── Drag and drop ──────────────────────────────────────────────────────────
  { configKey: 'dragDropMode', attribute: 'drag-drop-mode', converter: toText({ isNullable: true }), on: 'update', description: 'Drag-drop mode: `none` (off), `self` (within this tree), `cross` (between trees), or `both`.' },
  { configKey: 'dropZoneMode', attribute: 'drop-zone-mode', converter: toEnum(['floating', 'glow'] as const), on: 'update', description: 'Drop-zone visual style: floating indicator or glow.' },
  { configKey: 'dropZoneLayout', attribute: 'drop-zone-layout', converter: toEnum(['around', 'above', 'below', 'wave', 'wave2'] as const), on: 'update', description: 'Where drop zones render relative to a node.' },
  { configKey: 'dropZoneStart', attribute: 'drop-zone-start', converter: toDropZoneStart(), on: 'update', type: 'number | string', description: 'Where drop zones begin. A number is a percentage of node width; a string is used as-is (`px` or `%`, e.g. "50px").' },
  { configKey: 'dropZoneMaxWidth', attribute: 'drop-zone-max-width', converter: toInt(), on: 'update', description: 'Maximum drop-zone width (px).' },
  { configKey: 'isCopyAllowed', attribute: 'allow-copy', converter: toBool('tristate'), on: 'update', type: 'boolean', description: 'Allow the copy clipboard operation.' },
  { configKey: 'shouldAutoHandleCopy', attribute: 'auto-handle-copy', converter: toBool('tristate'), on: 'update', type: 'boolean', description: 'Let the tree perform the copy itself (vs delegating to onCopy).' },
  { configKey: 'shouldAutoHandlePaste', attribute: 'auto-handle-paste', converter: toBool('tristate'), on: 'update', type: 'boolean', description: 'Let the tree perform the paste itself (vs delegating to onPaste).' },
  { configKey: 'shouldHandleKeyboardShortcuts', attribute: 'handle-keyboard-shortcuts', converter: toBool('tristate'), on: 'update', type: 'boolean', description: 'Handle copy/cut/paste/delete keyboard shortcuts.' },
  { configKey: 'touchDragDelay', attribute: 'touch-drag-delay', converter: toInt(), on: 'update', description: 'Long-press hold (ms) before a touch-drag engages (default 300).' },
  { configKey: 'shouldIndicateUndraggable', attribute: 'indicate-undraggable', converter: toBool('tristate'), on: 'update', type: 'boolean', description: 'Built-in "can\'t move/drop this" feedback (🚫 badge + haptic). Default true.' },
  { configKey: 'shouldEnableTreeDropZone', attribute: 'enable-tree-drop-zone', converter: toBool('tristate'), on: 'update', type: 'boolean', description: 'Make the whole populated tree one drop target (drop lands target=null regardless of per-node drop rules).' },

  // ── Rendering ──────────────────────────────────────────────────────────────
  { configKey: 'noDataText', attribute: 'no-data-text', converter: toText({ isNullable: true }), on: 'update', description: 'Text shown when the tree is empty.' },
  { configKey: 'shouldShowDropPlaceholderWhenEmpty', attribute: 'show-drop-placeholder-when-empty', converter: toBool('tristate'), on: 'update', type: 'boolean', description: 'Show a drop placeholder when the tree is empty.' },
  { configKey: 'isFlatRenderingEnabled', attribute: 'use-flat-rendering', converter: toBool('tristate'), on: 'update', type: 'boolean', description: 'Render the visible nodes as a flat list (perf).' },
  { configKey: 'flatIndentSize', attribute: 'flat-indent-size', converter: toText({ isNullable: true }), on: 'update', description: 'Indent size (CSS length) per level in flat rendering.' },
  { configKey: 'isProgressiveRender', attribute: 'progressive-render', converter: toBool('tristate'), on: 'update', type: 'boolean', description: 'Render large trees in progressive batches.' },
  { configKey: 'initialBatchSize', attribute: 'initial-batch-size', converter: toInt(), on: 'update', description: 'Rows rendered in the first progressive batch.' },
  { configKey: 'maxBatchSize', attribute: 'max-batch-size', converter: toInt(), on: 'update', description: 'Maximum rows per progressive batch.' },

  // ── Virtual scroll ─────────────────────────────────────────────────────────
  { configKey: 'isVirtualScrollEnabled', attribute: 'virtual-scroll', converter: toBool('tristate'), on: 'update', type: 'boolean', description: 'Enable virtual scrolling.' },
  { configKey: 'virtualRowHeight', attribute: 'virtual-row-height', converter: toFloat(), on: 'update', description: 'Fixed row height (px) used by virtual scrolling.' },
  { configKey: 'virtualOverscan', attribute: 'virtual-overscan', converter: toInt(), on: 'update', description: 'Extra rows rendered above/below the viewport when virtualizing.' },
  { configKey: 'virtualContainerHeight', attribute: 'virtual-container-height', converter: toText({ isNullable: true }), on: 'update', description: 'Height (CSS length) of the virtual-scroll viewport.' },

  // ── Selection model ────────────────────────────────────────────────────────
  { configKey: 'rangeSelectionMode', attribute: 'range-selection-mode', converter: toEnum(['visual', 'logical'] as const), on: 'update', description: 'How Shift+click range selection walks the tree.' },
  { configKey: 'selectionMode', attribute: 'selection-mode', converter: toEnum(['single', 'multi'] as const), on: 'update', description: 'Single- or multi-node selection.' },
  { configKey: 'shouldShowCheckboxes', attribute: 'show-checkboxes', converter: toBool('default-false'), on: 'update', description: 'Show a checkbox on each node.' },
  { configKey: 'checkboxMode', attribute: 'checkbox-mode', converter: toEnum(['independent', 'cascade'] as const), on: 'update', description: 'Checkbox interaction: `independent` toggles one node; `cascade` toggles the subtree with a tristate box on branches.' },
  { configKey: 'cascadeSelectPolicy', attribute: 'cascade-select-policy', converter: toEnum(['rolled-up', 'leaves', 'all'] as const), on: 'update', description: 'Which paths the selection EMITS in cascade mode: `rolled-up` (minimal cover), `leaves`, or `all`. Default rolled-up.' },
  { configKey: 'shouldClickToggleCheckbox', attribute: 'click-toggles-checkbox', converter: toBool('tristate'), on: 'update', type: 'boolean', description: 'A node-row click also toggles its checkbox.' },

  // ── Complex property (data; too large for an attribute) ────────────────────
  { configKey: 'data', converter: toValue({ validate: (v): v is unknown[] => Array.isArray(v) }), on: 'update', type: 'ReadonlyArray<Record<string, unknown>>', description: 'The array of node objects to render. Assign `el.data` directly (JS API).' },

  // ── JS-only flag (no attribute) ────────────────────────────────────────────
  { configKey: 'shouldDisplayContextMenuInDebugMode', converter: toBool('tristate'), on: 'update', type: 'boolean', description: 'Show the built-in context menu even while debug info is displayed.' },

  // ── Custom styles (element-only; injected, not passed to the engine) ───────
  { configKey: 'customStylesCallback', converter: cb(), on: 'update', type: '() => string', description: 'Returns a CSS string injected into the component shadow root (supports @import).' },

  // ── Callbacks: data shape / behavior (reactive → update) ───────────────────
  { configKey: 'iconCallback', converter: cb(), on: 'update', type: '(node: LTreeNode) => string | null', description: 'Compute a per-node icon (overrides iconMember).' },
  { configKey: 'sortCallback', converter: cb(), on: 'update', type: '(items: LTreeNode[]) => LTreeNode[]', description: 'Custom sibling sort.' },
  { configKey: 'contextMenuCallback', converter: cb(), on: 'update', type: '(node: LTreeNode, close: () => void) => ContextMenuEntry[]', description: 'Build the context-menu entries for a node.' },
  { configKey: 'nodeClass', converter: cb(), on: 'update', type: '(node: LTreeNode) => string | null | undefined', description: 'Extra class(es) for a node row.' },
  { configKey: 'nodeContentClass', converter: cb(), on: 'update', type: '(node: LTreeNode) => string | null | undefined', description: 'Extra class(es) for a node content element.' },

  // ── Callbacks: render hooks (reactive → update) ────────────────────────────
  { configKey: 'renderNodeCallback', converter: cb(), on: 'update', type: '(node: LTreeNode, container: HTMLElement) => void', description: 'Custom render for a node row.' },
  { configKey: 'renderEmptyStateCallback', converter: cb(), on: 'update', type: '(container: HTMLElement) => void', description: 'Custom render for the empty-tree state.' },
  { configKey: 'renderEmptyZoneCallback', converter: cb(), on: 'update', type: '(container: HTMLElement) => void', description: 'Custom render for an empty drop zone.' },
  { configKey: 'renderLoadingCallback', converter: cb(), on: 'update', type: '(container: HTMLElement) => void', description: 'Custom render for the loading state.' },
  { configKey: 'renderHeaderCallback', converter: cb(), on: 'update', type: '(container: HTMLElement) => void', description: 'Custom render for the tree header.' },
  { configKey: 'renderFooterCallback', converter: cb(), on: 'update', type: '(container: HTMLElement) => void', description: 'Custom render for the tree footer.' },
  { configKey: 'renderContextMenuCallback', converter: cb(), on: 'update', type: '(node: LTreeNode, close: () => void, container: HTMLElement) => void', description: 'Custom render for the whole context menu.' },
  { configKey: 'renderContextMenuItemCallback', converter: cb(), on: 'update', type: '(item: ContextMenuItem, node: LTreeNode, container: HTMLElement) => void', description: 'Custom render for one context-menu item.' },

  // ── Callbacks: bridged to DOM events (non-reactive → none; wrapped at build)
  // Setting one updates `this.config`; the stable engine wrapper reads it lazily,
  // so the change takes effect on the next event without breaking the bridge.
  { configKey: 'onNodeClick', converter: cb(), on: 'none', type: '(ctx: NodeEventContext) => void', description: 'A node was clicked (also fires the `node-clicked` DOM event).' },
  { configKey: 'onNodeDoubleClick', converter: cb(), on: 'none', type: '(ctx: NodeEventContext) => void', description: 'A node was double-clicked (also fires `node-double-click`).' },
  { configKey: 'onCopy', converter: cb(), on: 'none', type: '(ctx: ClipboardEventContext) => void', description: 'A copy happened (also fires `copy`).' },
  { configKey: 'onCut', converter: cb(), on: 'none', type: '(ctx: ClipboardEventContext) => void', description: 'A cut happened (also fires `cut`).' },
  { configKey: 'onPaste', converter: cb(), on: 'none', type: '(result: PasteResult) => void', description: 'A paste happened (also fires `paste` with `detail.result`).' },
  { configKey: 'onDelete', converter: cb(), on: 'none', type: '(ctx: unknown) => void', description: 'A delete happened (also fires `delete`).' },
  { configKey: 'onNodeDragStart', converter: cb(), on: 'none', type: '(ctx: NodeDragContext) => void', description: 'A node drag started (also fires `node-drag-start`).' },
  { configKey: 'onNodeDragOver', converter: cb(), on: 'none', type: '(ctx: NodeDragContext) => void', description: 'A node was dragged over (also fires `node-drag-over`).' },
  { configKey: 'onNodeDrop', converter: cb(), on: 'none', type: '(ctx: NodeDropContext) => void', description: 'A drop completed (also fires `node-drop`).' },
  { configKey: 'onHighlightChange', converter: cb(), on: 'none', type: '(ctx: unknown) => void', description: 'The highlight set changed (also fires `highlight-change`).' },
  { configKey: 'onSelectionChange', converter: cb(), on: 'none', type: '(ctx: SelectionChangeContext) => void', description: 'The selection (checkbox) set changed (also fires `selection-change`).' },

  // ── Callbacks: pure engine hooks (non-reactive → none) ─────────────────────
  { configKey: 'beforeCopyCallback', converter: cb(), on: 'none', type: '(ctx: BeforeCopyContext) => boolean | void', description: 'Runs before a copy; return false to veto.' },
  { configKey: 'beforeCutCallback', converter: cb(), on: 'none', type: '(ctx: BeforeCopyContext) => boolean | void', description: 'Runs before a cut; return false to veto.' },
  { configKey: 'beforePasteCallback', converter: cb(), on: 'none', type: '(ctx: BeforePasteContext) => boolean | void', description: 'Runs before a paste; return false to veto.' },
  { configKey: 'beforeDeleteCallback', converter: cb(), on: 'none', type: '(ctx: BeforeDeleteContext) => boolean | void', description: 'Runs before a delete; return false to veto.' },
  { configKey: 'beforeDropCallback', converter: cb(), on: 'none', type: '(ctx: BeforeDropContext) => boolean | { position?, operation? } | DropGroup[] | void', description: 'Runs before a drop; false blocks, an object redirects, a DropGroup[] routes it to several destinations.' },
  { configKey: 'beforeDragStartCallback', converter: cb(), on: 'none', type: '(ctx: DragStartContext) => string[] | false | void', description: 'Set-level pre-drag interceptor: prune/augment/veto the dragged set.' },
  { configKey: 'onNodeDragDenied', converter: cb(), on: 'none', type: '(ctx: NodeEventContext) => void', description: 'A locked node was long-pressed (also fires `node-drag-denied`).' },
  { configKey: 'onNodeDropDenied', converter: cb(), on: 'none', type: '(ctx: NodeEventContext) => void', description: 'A drop was rejected by the target (also fires `node-drop-denied`).' },
  { configKey: 'nodeOutputTransformationCallback', converter: cb(), on: 'none', type: '(data, ctx: NodeTransformContext) => data', description: 'OUTPUT (egress) transform — clean/redact a node data object as it leaves the source (copy/cut/copy-drop).' },
  { configKey: 'nodeInputTransformationCallback', converter: cb(), on: 'none', type: '(data, ctx: NodeTransformContext) => data | null', description: 'INPUT (ingress) transform — derive ids/values as a node lands (paste/copy-drop); return null to skip.' },
  { configKey: 'onTreeKeydown', converter: cb(), on: 'none', type: '(ctx: TreeKeydownContext) => void', description: 'Intercept keydown before the tree handles it.' },
  { configKey: 'getDisplayValueCallback', converter: cb(), on: 'none', type: '(node: LTreeNode) => string', description: 'Compute a node display label (overrides displayValueMember).' },
  { configKey: 'getSearchValueCallback', converter: cb(), on: 'none', type: '(node: LTreeNode) => string', description: 'Compute the text a node is searched against.' },
  { configKey: 'getIsDraggableCallback', converter: cb(), on: 'none', type: '(node: LTreeNode) => boolean', description: 'Whether a node is draggable (overrides isDraggableMember).' },
  { configKey: 'getIsCollapsibleCallback', converter: cb(), on: 'none', type: '(node: LTreeNode) => boolean', description: 'Whether a node is collapsible (overrides isCollapsibleMember).' },
  { configKey: 'getAllowedDropPositionsCallback', converter: cb(), on: 'none', type: '(node: LTreeNode) => DropPosition[] | null | undefined', description: 'Which drop positions a node allows.' },
  { configKey: 'indexingCompleteCallback', converter: cb(), on: 'none', type: '() => void', description: 'Fires when the search index finishes building.' },
  { configKey: 'renderStartCallback', converter: cb(), on: 'none', type: '() => void', description: 'Fires when a progressive render starts.' },
  { configKey: 'renderProgressCallback', converter: cb(), on: 'none', type: '(stats) => void', description: 'Fires on each progressive-render batch.' },
  { configKey: 'renderCompleteCallback', converter: cb(), on: 'none', type: '(stats) => void', description: 'Fires when a progressive render completes.' },
];

// ── Outward DOM events (core §12.5) ──────────────────────────────────────────
// Every event is declared with `property: false`: web-treeview has never exposed
// managed `on<Name>` handler PROPERTIES for these (consumers use
// addEventListener), and the default handler-property names would collide with
// the identically-named engine callback inputs above (`onCopy`, `onNodeDrop`,
// `onSelectionChange`, …). Declaring them here still gives `emit()` its typing
// and feeds the CEM manifest.
type TreeViewEvents = {
  'node-clicked': unknown;
  'node-double-click': unknown;
  'copy': unknown;
  'cut': unknown;
  'paste': { result: unknown };
  'delete': unknown;
  'node-drag-start': unknown;
  'node-drag-over': unknown;
  'node-drop': unknown;
  'node-drag-denied': unknown;
  'node-drop-denied': unknown;
  'highlight-change': unknown;
  'selection-change': unknown;
  'tree-changed': undefined;
  'focused-node-changed': { focusedNode: unknown };
};
const EVENTS: readonly EventDef[] = [
  { name: 'node-clicked', property: false, description: 'A node was clicked. `detail` is the node context (NodeRef).' },
  { name: 'node-double-click', property: false, description: 'A node was double-clicked. `detail` is the node context.' },
  { name: 'copy', property: false, description: 'A copy operation ran. `detail` is `{ operation, paths, nodes }`.' },
  { name: 'cut', property: false, description: 'A cut operation ran. `detail` is `{ operation, paths, nodes }`.' },
  { name: 'paste', property: false, description: 'A paste operation ran. `detail.result` is the PasteResult.' },
  { name: 'delete', property: false, description: 'A delete operation ran. `detail` is the delete context.' },
  { name: 'node-drag-start', property: false, description: 'A node drag started. `detail` is the drag context.' },
  { name: 'node-drag-over', property: false, description: 'A node was dragged over. `detail` is the drag context.' },
  { name: 'node-drop', property: false, description: 'A drop completed. `detail` is the NodeDropContext.' },
  { name: 'node-drag-denied', property: false, description: 'A locked node was long-pressed / an undraggable drag was attempted. `detail` is the NodeRef.' },
  { name: 'node-drop-denied', property: false, description: 'A drop was rejected by the target. `detail` is the NodeRef.' },
  { name: 'highlight-change', property: false, description: 'The highlight set changed. `detail` is `{ paths, nodes }`.' },
  { name: 'selection-change', property: false, description: 'The selection (checkbox) set changed. `detail` is `{ paths, nodes }`.' },
  { name: 'tree-changed', property: false, description: 'The tree state changed (bulk notification; no detail).' },
  { name: 'focused-node-changed', property: false, description: 'The focused node changed. `detail` is `{ focusedNode }`.' },
];

/** configKey the engine does NOT own — injected/handled by this element. */
const NON_ENGINE_KEYS = new Set(['customStylesCallback']);

export class WebTreeViewElement<T = any> extends BlissElement<TreeViewEvents> {
  protected static override inputs = INPUTS;
  protected static override events = EVENTS;

  #shadow: ShadowRoot;
  #treeview?: WebTreeView<T>;
  #container?: HTMLDivElement;
  #renderer?: TreeViewRenderer<T>;

  // Custom-styles injection state (mirrors the old _applyCustomStyles fields).
  #customStyleSheet?: HTMLStyleElement;
  #customStyleLinks?: HTMLLinkElement[];
  #customDocLinks?: HTMLLinkElement[];

  constructor() {
    super();
    this.#shadow = this.attachShadow({ mode: 'open' });

    // §12.8: shell CSS via one shared, cached CSSStyleSheet (per string).
    adoptStyles(this.#shadow, styles);

    // Mark ready on the next frame (placeholder-visibility CSS keys off it).
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => this.setAttribute('data-ready', ''));
    } else {
      this.setAttribute('data-ready', '');
    }
  }

  // ── core lifecycle hooks ──────────────────────────────────────────────────

  /** First connect (or an `on:'reinit'` change — there are none): build the engine. */
  protected override reinit(): void {
    if (this.isConnected) this.#rebuildEngine();
  }

  /**
   * Cosmetic/structural change — patch the live engine. Also serves as the
   * PUBLIC imperative `el.update(props)` method (the old API).
   *
   * Sends the FULL assembled engine config on every call, exactly like the old
   * `_scheduleUpdate` → `treeview.update(buildConfig())` did. This matters:
   * `controller.updateProps` is a merge, and several derived behaviors (e.g.
   * `expandLevel` auto-expansion when `data` arrives) only fire when the relevant
   * keys are present together. A changed-keys-only partial would drop them.
   * Any explicit `partial` (imperative caller) is folded over the assembled config.
   */
  override update(partial: Partial<TreeViewConfig<T>> = {}): void {
    if ('customStylesCallback' in partial) this.#applyCustomStyles();
    if (!this.#treeview) return;
    const cfg = this.#assembleConfig() as Record<string, unknown>;
    for (const [key, value] of Object.entries(partial)) {
      if (NON_ENGINE_KEYS.has(key)) continue;
      // null == "unset" → let the engine fall back to its default, except `theme`
      // (passed through as null so the renderer clears it).
      if (value === null && key !== 'theme') delete cfg[key];
      else cfg[key] = value;
    }
    this.#treeview.update(cfg as Partial<TreeViewConfig<T>>);
  }

  /** Activate: ensure the engine exists (a DOM move destroyed it in disconnect()). */
  protected override connect(): void {
    if (!this.#treeview) this.#buildEngine();
  }

  /** Deactivate: tear the engine down (rebuilt on the next connect). */
  protected override disconnect(): void {
    this.#treeview?.destroy();
    this.#treeview = undefined;
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
    initLogger.debug('[WebTreeViewElement] build engine', {
      idMember: config.idMember,
      pathMember: config.pathMember,
      displayValueMember: config.displayValueMember,
      dataLength: (config.data as unknown[] | undefined)?.length ?? 0,
    });

    this.#treeview = new WebTreeView<T>(this.#container!, config, this.#renderer);

    // State-change drives the bulk `tree-changed` event and the
    // `focused-node-changed` event (no silent option on those two).
    const ctrl = this.#treeview.getController();
    let prevFocusedPath: string | null = null;
    ctrl.on('state-change', (snapshot: any) => {
      this.emit('tree-changed', undefined);
      const currentPath = snapshot.focusedNode?.path ?? null;
      if (currentPath !== prevFocusedPath) {
        prevFocusedPath = currentPath;
        this.emit('focused-node-changed', { focusedNode: snapshot.focusedNode ?? null });
      }
    });

    this.#applyCustomStyles();
  }

  #ensureContainer(): void {
    if (this.#container) return;
    const container = document.createElement('div');
    this.#shadow.appendChild(container);
    this.#container = container;
    this.#applyCustomStyles();
  }

  /**
   * Build the engine config from the merged `this.config`: drop element-only
   * keys, normalize "unset" (null) → absent (matching the old parser's undefined),
   * and install the DOM-event bridge wrappers. Wrappers read `this.config` at
   * CALL time so assigning a bridged callback later takes effect without
   * rebuilding — and without ever replacing the stable wrapper the engine holds.
   */
  #assembleConfig(): Partial<TreeViewConfig<T>> {
    const cfg: Record<string, unknown> = { ...this.config };
    for (const key of NON_ENGINE_KEYS) delete cfg[key];
    for (const key of Object.keys(cfg)) {
      if (cfg[key] === null && key !== 'theme') delete cfg[key];
    }

    const bridge = (key: keyof TreeViewEvents, engineKey: string, mapDetail?: (arg: any) => any): void => {
      cfg[engineKey] = (arg: any) => {
        (this.config[engineKey] as ((a: any) => void) | null | undefined)?.(arg);
        this.emit(key as any, mapDetail ? mapDetail(arg) : arg);
      };
    };
    bridge('node-clicked', 'onNodeClick');
    bridge('node-double-click', 'onNodeDoubleClick');
    bridge('copy', 'onCopy');
    bridge('cut', 'onCut');
    bridge('paste', 'onPaste', (result) => ({ result }));
    bridge('delete', 'onDelete');
    bridge('node-drag-start', 'onNodeDragStart');
    bridge('node-drag-over', 'onNodeDragOver');
    bridge('node-drop', 'onNodeDrop');
    bridge('node-drag-denied', 'onNodeDragDenied');
    bridge('node-drop-denied', 'onNodeDropDenied');
    bridge('highlight-change', 'onHighlightChange');
    bridge('selection-change', 'onSelectionChange');

    return cfg as Partial<TreeViewConfig<T>>;
  }

  // ── custom styles injection (ported verbatim; component-specific @import /
  //    @font-face handling that core's createStyleSlot does not cover) ─────────

  #applyCustomStyles(): void {
    // Remove previous custom elements
    if (this.#customStyleSheet) {
      this.#customStyleSheet.remove();
      this.#customStyleSheet = undefined;
    }
    if (this.#customStyleLinks) {
      for (const link of this.#customStyleLinks) link.remove();
      this.#customStyleLinks = undefined;
    }
    if (this.#customDocLinks) {
      for (const link of this.#customDocLinks) link.remove();
      this.#customDocLinks = undefined;
    }

    const callback = this.config.customStylesCallback as (() => string) | null | undefined;
    if (typeof callback !== 'function') return;

    const css = callback();
    if (!css) return;

    // Extract @import url(...) rules and inject as <link> elements (@import in a
    // dynamically-set <style>.textContent is ignored by the CSS parser).
    const importRegex = /@import\s+url\(\s*['"]?([^'")]+)['"]?\s*\)\s*;?/g;
    let remaining = css;
    let match: RegExpExecArray | null;
    const links: HTMLLinkElement[] = [];

    while ((match = importRegex.exec(css)) !== null) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = match[1];
      link.className = 'tv-custom-styles';
      this.#shadow.appendChild(link);
      links.push(link);
      remaining = remaining.replace(match[0], '');
    }

    if (links.length > 0) {
      this.#customStyleLinks = links;

      // Also inject into document <head> for @font-face registration (Shadow DOM
      // @font-face doesn't always register fonts globally).
      const docLinks: HTMLLinkElement[] = [];
      for (const shadowLink of links) {
        const href = shadowLink.href;
        if (!document.querySelector(`link[href="${href}"]`)) {
          const docLink = document.createElement('link');
          docLink.rel = 'stylesheet';
          docLink.href = href;
          docLink.setAttribute('data-tv-injected', '');
          document.head.appendChild(docLink);
          docLinks.push(docLink);
        }
      }
      if (docLinks.length > 0) this.#customDocLinks = docLinks;
    }

    // Inject remaining CSS (non-@import rules) as <style>.
    remaining = remaining.trim();
    if (remaining) {
      this.#customStyleSheet = document.createElement('style');
      this.#customStyleSheet.className = 'tv-custom-styles';
      this.#customStyleSheet.textContent = remaining;
      this.#shadow.appendChild(this.#customStyleSheet);
    }
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

  expandAll(nodePath?: string | string[] | null, options?: { exclusive?: boolean; noEmit?: boolean }): void {
    this.#treeview?.expandAll(nodePath, options);
  }

  collapseAll(nodePath?: string | string[] | null, options?: { noEmit?: boolean }): void {
    this.#treeview?.collapseAll(nodePath, options);
  }

  expandNodes(nodePath: string | string[], options?: { exclusive?: boolean; noEmit?: boolean }): void {
    this.#treeview?.expandNodes(nodePath, options);
  }

  collapseNodes(nodePath: string | string[], options?: { noEmit?: boolean }): void {
    this.#treeview?.collapseNodes(nodePath, options);
  }

  filterNodes(searchText: string): void {
    this.#treeview?.filterNodes(searchText);
  }

  searchNodes(searchText: string | null): LTreeNode<T>[] {
    return this.#treeview?.searchNodes(searchText) ?? [];
  }

  scrollToPath(path: string, options?: ScrollToPathOptions): Promise<boolean> {
    return this.#treeview?.scrollToPath(path, options) ?? Promise.resolve(false);
  }

  closeContextMenu(): void {
    this.#treeview?.closeContextMenu();
  }

  getExpandedPaths(): string[] {
    return this.#treeview?.getExpandedPaths() ?? [];
  }

  setExpandedPaths(paths: string[]): void {
    this.#treeview?.setExpandedPaths(paths);
  }

  getVisibleFlatNodes(): LTreeNode<T>[] {
    return this.#treeview?.getVisibleFlatNodes() ?? [];
  }

  getNodeByPath(path: string): LTreeNode<T> | null {
    return this.#treeview?.getNodeByPath(path) ?? null;
  }

  getAllData(): T[] {
    return this.#treeview?.getAllData() ?? [];
  }

  moveNode(sourcePath: string, targetPath: string, position: DropPosition): any {
    return this.#treeview?.moveNode(sourcePath, targetPath, position);
  }

  removeNode(path: string, includeDescendants?: boolean): any {
    return this.#treeview?.removeNode(path, includeDescendants);
  }

  addNode(parentPath: string, nodeData: T, pathSegment?: string): any {
    return this.#treeview?.addNode(parentPath, nodeData, pathSegment);
  }

  updateNode(path: string, dataUpdates: Partial<T>): any {
    return this.#treeview?.updateNode(path, dataUpdates);
  }

  copyNodeWithDescendants(
    sourceNode: LTreeNode<T>,
    targetParentPath: string,
    dataTransform: (data: T, node: LTreeNode<T>) => T | null,
    siblingPath?: string,
    position?: 'before' | 'after'
  ): any {
    return this.#treeview?.copyNodeWithDescendants(sourceNode, targetParentPath, dataTransform, siblingPath, position);
  }

  moveNodes(paths: string[], targetPath: string, position: DropPosition): any {
    return this.#treeview?.moveNodes(paths, targetPath, position);
  }

  duplicateNodes(
    paths: string[],
    targetPath: string,
    position: DropPosition,
    transform?: (data: T, ctx: NodeTransformContext<T>) => T | null,
    sourceTree?: Ltree<T>
  ): any {
    return this.#treeview?.duplicateNodes(paths, targetPath, position, transform, sourceTree);
  }

  /** Access the underlying LTree for advanced programmatic usage. */
  getTree(): Ltree<T> | undefined {
    return this.#treeview?.getTree();
  }

  /** Access the TreeController directly. */
  getController(): TreeController<T> | undefined {
    return this.#treeview?.getController();
  }

  // ── Bulk operations ─────────────────────────────────────────────────────────

  insertBranch(parentPath: string, data: T[]): { success: boolean; count: number; error?: string } {
    return this.#treeview?.insertBranch(parentPath, data) ?? { success: false, count: 0, error: 'Not initialized' };
  }

  replaceBranch(parentPath: string, data: T[]): { success: boolean; removed: number; added: number; error?: string } {
    return this.#treeview?.replaceBranch(parentPath, data) ?? { success: false, removed: 0, added: 0, error: 'Not initialized' };
  }

  deleteBranch(path: string, keepParent?: boolean): { success: boolean; count: number; error?: string } {
    return this.#treeview?.deleteBranch(path, keepParent) ?? { success: false, count: 0, error: 'Not initialized' };
  }

  // ── Highlight (focus + multi-select) ────────────────────────────────────────

  highlightNode(path: string, mode: HighlightMode = 'replace', options?: TreeMutationOptions): void {
    this.#treeview?.highlightNode(path, mode, options);
  }

  highlightNodes(paths: string[], options?: TreeMutationOptions): void {
    this.#treeview?.highlightNodes(paths, options);
  }

  setHighlightedPaths(paths: string[], options?: TreeMutationOptions): void {
    this.#treeview?.setHighlightedPaths(paths, options);
  }

  highlightAll(options?: TreeMutationOptions): void {
    this.#treeview?.highlightAll(options);
  }

  clearHighlight(paths?: string[], options?: TreeMutationOptions): void {
    this.#treeview?.clearHighlight(paths, options);
  }

  getHighlightedNodes(): LTreeNode<T>[] {
    return this.#treeview?.getHighlightedNodes() ?? [];
  }

  getHighlightedPaths(): Set<string> {
    return this.#treeview?.getHighlightedPaths() ?? new Set();
  }

  isNodeHighlighted(path: string): boolean {
    return this.#treeview?.isNodeHighlighted(path) ?? false;
  }

  // ── Selection (checkbox data state) ─────────────────────────────────────────

  selectNode(path: string, options?: TreeMutationOptions): void {
    this.#treeview?.selectNode(path, options);
  }

  selectNodes(paths: string[], options?: TreeMutationOptions): void {
    this.#treeview?.selectNodes(paths, options);
  }

  setSelectedPaths(paths: string[], options?: TreeMutationOptions): void {
    this.#treeview?.setSelectedPaths(paths, options);
  }

  selectAll(options?: TreeMutationOptions): void {
    this.#treeview?.selectAll(options);
  }

  deselectNode(path: string, options?: TreeMutationOptions): void {
    this.#treeview?.deselectNode(path, options);
  }

  clearSelection(paths?: string[], options?: TreeMutationOptions): void {
    this.#treeview?.clearSelection(paths, options);
  }

  getSelectedNodes(): LTreeNode<T>[] {
    return this.#treeview?.getSelectedNodes() ?? [];
  }

  getSelectedPaths(): Set<string> {
    return this.#treeview?.getSelectedPaths() ?? new Set();
  }

  isNodeSelected(path: string): boolean {
    return this.#treeview?.isNodeSelected(path) ?? false;
  }

  // ── Focus (single cursor) ───────────────────────────────────────────────────

  focusNode(path: string, options?: TreeMutationOptions): void {
    this.#treeview?.focusNode(path, options);
  }

  clearFocus(options?: TreeMutationOptions): void {
    this.#treeview?.clearFocus(options);
  }

  // ── Expand toggle (honors isAccordionExpand) ────────────────────────────────

  toggleNodeExpanded(path: string): void {
    this.#treeview?.toggleNodeExpanded(path);
  }

  // ── Insert diagnostics ──────────────────────────────────────────────────────

  /** Result of the most recent insertArray (successful / failed / failedDetails). */
  getInsertResult() {
    return this.#treeview?.getInsertResult();
  }

  // ── Navigation ──────────────────────────────────────────────────────────────

  navTo(path: string): void { this.#treeview?.navTo(path); }
  navNext(): void { this.#treeview?.navNext(); }
  navPrev(): void { this.#treeview?.navPrev(); }
  navNextSibling(): void { this.#treeview?.navNextSibling(); }
  navPrevSibling(): void { this.#treeview?.navPrevSibling(); }
  navInto(): void { this.#treeview?.navInto(); }
  navOut(): void { this.#treeview?.navOut(); }
  navBackOut(): void { this.#treeview?.navBackOut(); }
  navToggle(): void { this.#treeview?.navToggle(); }
  navFirst(): void { this.#treeview?.navFirst(); }
  navLast(): void { this.#treeview?.navLast(); }

  // ── Clipboard ─────────────────────────────────────────────────────────────

  copyNodes(paths?: string[]): void {
    this.#treeview?.copyNodes(paths);
  }

  cutNodes(paths?: string[]): void {
    this.#treeview?.cutNodes(paths);
  }

  pasteNodes(
    targetPath: string,
    transformData?: ((data: T, ctx: NodeTransformContext<T>) => T | null) | null,
    position?: DropPosition
  ): PasteResult<T> {
    return this.#treeview?.pasteNodes(targetPath, transformData, position) ?? { success: false, count: 0, skipped: 0, error: 'Not initialized' };
  }

  cancelCut(): void {
    this.#treeview?.cancelCut();
  }

  deleteNodes(paths?: string[]): { removed: number; blocked: number } {
    return this.#treeview?.deleteNodes(paths) ?? { removed: 0, blocked: 0 };
  }

  hasClipboardContent(): boolean {
    return this.#treeview?.hasClipboardContent() ?? false;
  }

  getClipboardOperation(): 'copy' | 'cut' | null {
    return this.#treeview?.getClipboardOperation() ?? null;
  }
}

// Importing this module registers the element (back-compat contract). The full
// global-API publish + logger wiring happens in index.ts via registerComponent();
// both defines are idempotent, so importing either works.
if (typeof customElements !== 'undefined' && !customElements.get('web-treeview')) {
  customElements.define('web-treeview', WebTreeViewElement);
}
