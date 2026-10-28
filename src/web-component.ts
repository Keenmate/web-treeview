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
 * `config` to the tree (`WebTreeView` in `treeview.ts`, which adapts the public
 * single-ctx callbacks to the internal `TreeEngine`), the public `el.controller`
 * facade, the event bridges, and the custom-styles injection.
 *
 * Reactivity model: the tree (`WebTreeView` → engine + renderer) applies every
 * config change in place via `update()`; it is built once (first connect) and
 * kept across a DOM move — disconnect()/connect() only deactivate/activate its
 * live resources, so all runtime state survives (D1). Every input is `on:'update'`:
 * `update()` sends the full config, and WebTreeView memoizes its callback
 * adapters, so re-sending an unchanged callback costs nothing.
 */
import type { TreeLoggers } from './logger';
import {
  BlissElement,
  toBool,
  toEnum,
  toInt,
  toFloat,
  toText,
  toValue,
  toObject,
  toCustom,
  toFunction,
  adoptStyles,
  type InputDef,
  type EventDef,
} from '@keenmate/web-components-core';
import { WebTreeView, createTreeViewController } from './treeview';
import type { TreeViewConfig, ScrollToPathOptions } from './types';
import type { LTreeNode, DropPosition } from './ltree/ltree-node';
import type { Ltree, ExpandOptions, TreeChange, ApplyChangesResult, InsertBranchResult, ReplaceBranchResult } from './ltree/types';
import type { TreeViewRenderer } from './renderer/types';
import type { SelectMode, TreeMutationOptions, NodeRef } from './controller/types';
import type { PasteResult } from './clipboard';
import type {
  TreeViewController,
  TreeViewContext,
  NodeTransformCallback,
  NodeEventDetail,
  NodeDragEventDetail,
  NodeDropEventDetail,
  NodeClipboardEventDetail,
  NodePasteEventDetail,
  SelectionChangeEventDetail,
  FocusChangeEventDetail,
  ExpandedChangeEventDetail,
  TreeEventDetail,
  TreeViewActionEventDetail,
} from './interaction';
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

/**
 * `tooltip-delay`: the attribute takes one integer (ms, sets show AND hide); the
 * JS property also accepts `{ show?, hide? }` (NOTES #23 — `toInt()` rejected the
 * object). Non-negative integers only; one place validates both paths.
 */
type TooltipDelayValue = number | { show?: number; hide?: number };
const isDelayMs = (v: unknown): boolean => v === undefined || (Number.isInteger(v) && (v as number) >= 0);
const toTooltipDelay = () =>
  toCustom<TooltipDelayValue>(
    (raw, reportInvalid) => {
      if (raw === null) return undefined as unknown as TooltipDelayValue;
      const n = Number(raw.trim());
      if (raw.trim() === '' || !Number.isInteger(n) || n < 0) {
        reportInvalid?.('not a non-negative integer (ms)');
        return undefined as unknown as TooltipDelayValue;
      }
      return n;
    },
    {
      validate: (v): v is TooltipDelayValue =>
        v == null ||
        (typeof v === 'number' && isDelayMs(v)) ||
        (typeof v === 'object' && !Array.isArray(v) &&
          Object.keys(v as object).every((k) => k === 'show' || k === 'hide') &&
          isDelayMs((v as { show?: unknown }).show) && isDelayMs((v as { hide?: unknown }).hide)),
    },
  );

// ============================================================================
// INPUT TABLE — the whole <web-treeview> public surface, one row each.
//
// HTML attribute names stay kebab-case; the JS config keys follow the
// BlissFramework naming convention (is/should/has prefixes). Both were fixed by
// the rc05 API rename; the table below just moves them from the hand-coded
// `ATTRIBUTE_TABLE` onto the core input model verbatim.
// ============================================================================
/** Live `el.nodes` (core `getLiveValue`, SPEC §4.1): the built tree's current node data.
 *  Assigned in a static block so it can reach the private `#treeview`. */
let readLiveNodes: (el: HTMLElement) => unknown[] | undefined = () => undefined;

const INPUTS: readonly InputDef[] = [
  // ── Tree identification ────────────────────────────────────────────────────
  { configKey: 'treeId', attribute: 'tree-id', converter: toText({ isNullable: true }), on: 'update', description: 'Stable identifier for this tree (clipboard / cross-tree operations).' },

  // ── Member mappings: required (with defaults) ──────────────────────────────
  { configKey: 'idMember', attribute: 'id-member', converter: toText({ default: 'id' }), on: 'update', description: 'Property name on a node object that holds its id.' },
  { configKey: 'pathMember', attribute: 'path-member', converter: toText({ default: 'path' }), on: 'update', description: 'Property name that holds a node materialized tree path.' },
  { configKey: 'displayValueMember', attribute: 'display-value-member', converter: toText({ default: 'displayValue' }), on: 'update', description: 'Property name that holds a node display label.' },

  // ── Member mappings: optional (absent → default via engine) ────────────────
  { configKey: 'parentPathMember', attribute: 'parent-path-member', converter: toText({ isNullable: true }), on: 'update', description: 'Property name holding a node parent path.' },
  { configKey: 'levelMember', attribute: 'level-member', converter: toText({ isNullable: true }), on: 'update', description: 'Property name holding a node depth level.' },
  { configKey: 'isExpandedMember', attribute: 'is-expanded-member', converter: toText({ isNullable: true }), on: 'update', description: 'Property name flagging whether a node is expanded.' },
  { configKey: 'isCheckedMember', attribute: 'is-checked-member', converter: toText({ isNullable: true }), on: 'update', description: 'Property name flagging whether a node is checked (checkbox).' },
  { configKey: 'isDraggableMember', attribute: 'is-draggable-member', converter: toText({ isNullable: true }), on: 'update', description: 'Property name flagging whether a node is draggable.' },
  { configKey: 'isDropAllowedMember', attribute: 'is-drop-allowed-member', converter: toText({ isNullable: true }), on: 'update', description: 'Property name flagging whether a drop is allowed onto a node.' },
  { configKey: 'hasChildrenMember', attribute: 'has-children-member', converter: toText({ isNullable: true }), on: 'update', description: 'Property name flagging that a node has children (lazy trees).' },
  { configKey: 'searchValueMember', attribute: 'search-value-member', converter: toText({ isNullable: true }), on: 'update', description: 'Property name a node is searched against.' },
  { configKey: 'isSelectableMember', attribute: 'is-selectable-member', converter: toText({ isNullable: true }), on: 'update', description: 'Property name flagging whether a node can be selected.' },
  { configKey: 'isCollapsibleMember', attribute: 'is-collapsible-member', converter: toText({ isNullable: true }), on: 'update', description: 'Property name flagging whether a node can be collapsed.' },
  { configKey: 'orderMember', attribute: 'order-member', converter: toText({ isNullable: true }), on: 'update', description: 'Property name used to order sibling nodes.' },
  { configKey: 'allowedDropPositionsMember', attribute: 'allowed-drop-positions-member', converter: toText({ isNullable: true }), on: 'update', description: 'Property name listing the drop positions allowed on a node.' },
  { configKey: 'iconMember', attribute: 'icon-member', converter: toText({ isNullable: true }), on: 'update', description: 'Property name that holds a per-node icon value (rendered on every node as <i class="wtv__node-icon {value}">).' },
  { configKey: 'iconColorMember', attribute: 'icon-color-member', converter: toText({ isNullable: true }), on: 'update', description: 'Property name that holds a per-node icon color (applied to the .wtv__node-icon element).' },

  // ── Behavior ───────────────────────────────────────────────────────────────
  { configKey: 'expandLevel', attribute: 'expand-level', converter: toInt({ default: 0 }), on: 'update', description: 'Depth to auto-expand on load (0 = roots only, the default).' },
  { configKey: 'treePathSeparator', attribute: 'tree-path-separator', converter: toText({ isNullable: true, isEmptyAllowed: true }), on: 'update', description: 'Separator between segments in a materialized tree path.' },
  { configKey: 'clickBehavior', attribute: 'click-behavior', converter: toEnum(['select', 'expand', 'expand-and-focus'] as const), on: 'update', description: 'What a node click does: select, expand, or expand-and-focus.' },
  { configKey: 'shouldExpandAsAccordion', attribute: 'expand-as-accordion', converter: toBool('tristate'), default: false, on: 'update', type: 'boolean', description: 'Accordion mode: expanding a node collapses its siblings.' },
  { configKey: 'isSorted', attribute: 'sorted', converter: toBool('tristate'), default: false, on: 'update', type: 'boolean', description: 'Hint: data is already in insert order (parents first, siblings ordered) — skips sorting the input; faster on big data.' },

  // ── Search / indexer ───────────────────────────────────────────────────────
  { configKey: 'shouldUseInternalSearchIndex', attribute: 'use-internal-search-index', converter: toBool('tristate'), default: false, on: 'update', type: 'boolean', description: 'Build an internal FlexSearch index for search.' },
  { configKey: 'indexerBatchSize', attribute: 'indexer-batch-size', converter: toInt(), default: 25, on: 'update', description: 'Nodes indexed per batch when building the search index.' },
  { configKey: 'indexerTimeout', attribute: 'indexer-timeout', converter: toInt(), default: 50, on: 'update', description: 'Idle timeout (ms) between search-index batches.' },
  { configKey: 'searchTerm', attribute: 'search-term', converter: toText({ isNullable: true, isEmptyAllowed: true }), on: 'update', description: 'Active search/filter term.' },

  // ── Theme / visual classes ─────────────────────────────────────────────────
  { configKey: 'theme', attribute: 'theme', converter: toEnum(['dark', 'light'] as const, { shouldNullOnInvalid: true }), on: 'update', description: 'Force a `dark` / `light` theme (unset → follow host).' },
  { configKey: 'bodyClass', attribute: 'body-class', converter: toText({ isNullable: true }), on: 'update', description: 'Extra class on the tree body container.' },
  { configKey: 'selectedNodeClass', attribute: 'selected-node-class', converter: toText({ isNullable: true }), on: 'update', description: 'Class applied to selected nodes.' },
  { configKey: 'focusedNodeClass', attribute: 'focused-node-class', converter: toText({ isNullable: true }), on: 'update', description: 'Class applied to the focused node.' },
  { configKey: 'checkedNodeClass', attribute: 'checked-node-class', converter: toText({ isNullable: true }), on: 'update', description: 'Class applied to checked nodes — opt-in extra styling; the checkbox is the default signal.' },
  { configKey: 'dragOverNodeClass', attribute: 'drag-over-node-class', converter: toText({ isNullable: true }), on: 'update', description: 'Class applied to a node being dragged over.' },
  { configKey: 'draggedNodeClass', attribute: 'dragged-node-class', converter: toText({ isNullable: true }), on: 'update', description: 'Class for the dragged source row; replaces the built-in .wtv__node-content--dragged visual.' },

  // ── Node tooltips (hover/focus) ─────────────────────────────────────────────
  { configKey: 'isNodeTooltipsShown', attribute: 'show-node-tooltips', converter: toBool('default-false'), on: 'update', description: 'Enable hover/focus tooltips on node rows (content from getNodeTooltipCallback).' },
  { configKey: 'tooltipPlacement', attribute: 'tooltip-placement', converter: toEnum(['top', 'top-start', 'top-end', 'right', 'right-start', 'right-end', 'bottom', 'bottom-start', 'bottom-end', 'left', 'left-start', 'left-end'] as const), on: 'update', description: 'Tooltip placement relative to the row. Default top-start.' },
  { configKey: 'tooltipDelay', attribute: 'tooltip-delay', converter: toTooltipDelay(), on: 'update', type: 'number | { show?: number; hide?: number }', description: 'Show/hide delay (ms). The attribute sets both; the JS property also accepts { show, hide }. Default { show: 400, hide: 100 }.' },
  { configKey: 'tooltipOffset', attribute: 'tooltip-offset', converter: toInt(), default: 8, on: 'update', description: 'Gap from the row (or cursor), px. Default 8.' },
  { configKey: 'shouldTooltipFollowCursor', attribute: 'tooltip-follow-cursor', converter: toBool('default-false'), on: 'update', description: 'Anchor the tooltip to the pointer instead of the row.' },
  { configKey: 'iconSet', attribute: 'icon-set', converter: toEnum(['chevron', 'triangle', 'plus-minus', 'arrow'] as const), on: 'update', shouldReflect: true, description: 'Disclosure glyph set: chevron (default) | triangle | plus-minus | arrow. Re-points the --wtv-icon-* variables via a :host([icon-set]) rule; reflected to the attribute so the CSS matches when set via the JS property.' },
  { configKey: 'expandIconClass', attribute: 'expand-icon-class', converter: toText({ isNullable: true }), on: 'update', description: 'DEPRECATED — use icon-set. Escape hatch: a custom class attached to the expandable toggle.' },
  { configKey: 'collapseIconClass', attribute: 'collapse-icon-class', converter: toText({ isNullable: true }), on: 'update', description: 'DEPRECATED — glyph swap is now CSS-driven (icon-set + toggle-icon-mode); no longer selects the expanded glyph.' },
  { configKey: 'leafIconClass', attribute: 'leaf-icon-class', converter: toText({ isNullable: true }), on: 'update', description: 'Icon class for leaf nodes.' },
  { configKey: 'toggleIconMode', attribute: 'toggle-icon-mode', converter: toEnum(['rotate', 'swap'] as const), on: 'update', shouldReflect: true, description: 'Whether the toggle glyph rotates (single glyph) or swaps (expand↔collapse glyph). Reflected to the attribute so the :host([toggle-icon-mode="swap"]) CSS matches via the JS property.' },
  { configKey: 'scrollHighlightClass', attribute: 'scroll-highlight-class', converter: toText({ isNullable: true }), on: 'update', description: 'Class flashed on a node after scrollToPath().' },
  { configKey: 'scrollHighlightTimeout', attribute: 'scroll-highlight-timeout', converter: toInt(), default: 4000, on: 'update', description: 'How long (ms) the scroll highlight stays before clearing.' },

  // ── Per-node icons ─────────────────────────────────────────────────────────
  { configKey: 'shouldAlignNodeIcons', attribute: 'align-node-icons', converter: toBool('tristate'), default: true, on: 'update', type: 'boolean', description: 'Reserve a fixed icon column so node labels align.' },

  // ── Context menu ───────────────────────────────────────────────────────────
  { configKey: 'contextMenuXOffset', attribute: 'context-menu-x-offset', converter: toInt(), default: 8, on: 'update', description: 'Horizontal offset (px) of the context menu from the pointer.' },
  { configKey: 'contextMenuYOffset', attribute: 'context-menu-y-offset', converter: toInt(), default: 0, on: 'update', description: 'Vertical offset (px) of the context menu from the pointer.' },

  // ── Loading ──────────────────────────────────────────────────────────────
  { configKey: 'isLoading', attribute: 'loading', converter: toBool('tristate'), default: false, on: 'update', type: 'boolean', description: 'Show the loading state.' },

  // ── Drag and drop ──────────────────────────────────────────────────────────
  { configKey: 'dragDropMode', attribute: 'drag-drop-mode', converter: toText({ isNullable: true }), on: 'update', description: 'Drag-drop mode: `none` (off), `self` (within this tree), `cross` (between trees), or `both`.' },
  { configKey: 'dropZoneMode', attribute: 'drop-zone-mode', converter: toEnum(['floating', 'glow'] as const), on: 'update', description: 'Drop-zone visual style: floating indicator or glow.' },
  { configKey: 'dropZoneLayout', attribute: 'drop-zone-layout', converter: toEnum(['around', 'before', 'after', 'wave', 'wave2'] as const), on: 'update', description: 'Where drop zones render relative to a node.' },
  { configKey: 'dropZoneStart', attribute: 'drop-zone-start', converter: toDropZoneStart(), on: 'update', type: 'number | string', description: 'Where drop zones begin. A number is a percentage of node width; a string is used as-is (`px` or `%`, e.g. "50px").' },
  { configKey: 'dropZoneMaxWidth', attribute: 'drop-zone-max-width', converter: toInt(), default: 120, on: 'update', description: 'Maximum drop-zone width (px).' },
  { configKey: 'isCopyAllowed', attribute: 'allow-copy', converter: toBool('tristate'), default: false, on: 'update', type: 'boolean', description: 'Allow the copy clipboard operation.' },
  { configKey: 'shouldAutoHandleCopy', attribute: 'auto-handle-copy', converter: toBool('tristate'), default: true, on: 'update', type: 'boolean', description: 'Let the tree perform the copy itself (vs delegating to onCopy).' },
  { configKey: 'shouldAutoHandlePaste', attribute: 'auto-handle-paste', converter: toBool('tristate'), default: true, on: 'update', type: 'boolean', description: 'Let the tree perform the paste itself (vs delegating to onPaste).' },
  { configKey: 'shouldHandleKeyboardShortcuts', attribute: 'handle-keyboard-shortcuts', converter: toBool('tristate'), default: true, on: 'update', type: 'boolean', description: 'Handle copy/cut/paste/delete keyboard shortcuts.' },
  { configKey: 'touchDragDelay', attribute: 'touch-drag-delay', converter: toInt(), default: 300, on: 'update', description: 'Long-press hold (ms) before a touch-drag engages (default 300).' },
  { configKey: 'shouldIndicateUndraggable', attribute: 'indicate-undraggable', converter: toBool('tristate'), default: true, on: 'update', type: 'boolean', description: 'Built-in "can\'t move/drop this" feedback (🚫 badge + haptic). Default true.' },
  { configKey: 'isTreeDropZoneEnabled', attribute: 'enable-tree-drop-zone', converter: toBool('tristate'), default: false, on: 'update', type: 'boolean', description: 'Make the whole populated tree one drop target (drop lands target=null regardless of per-node drop rules).' },

  // ── Rendering ──────────────────────────────────────────────────────────────
  { configKey: 'labels', attribute: 'labels', converter: toObject(), on: 'update', type: 'Partial<TreeViewLabels>', description: 'UI strings — a partial object (JSON attribute) merged per key over the English defaults (an empty string = render nothing): `noData` ("No data" — no nodes), `noResults` ("No results found" — the search filter left nothing), `noDisplayValue` ("[N/A]" — node without a display value), `loading` ("Loading…" — spinner aria-label), `dropHere` ("Drop here"), `copy`, `cut`, `paste`, `delete`, `expand`, `collapse`, `expandSubtree`, `collapseSubtree`, `expandAll`, `collapseAll` (built-in context-menu items). `{name}` placeholders.' },
  { configKey: 'isEmptyDropPlaceholderShown', attribute: 'show-empty-drop-placeholder', converter: toBool('tristate'), default: false, on: 'update', type: 'boolean', description: 'Show a drop placeholder when the tree is empty.' },
  { configKey: 'isFlatRenderingEnabled', attribute: 'enable-flat-rendering', converter: toBool('tristate'), default: true, on: 'update', type: 'boolean', description: 'Render the visible nodes as a flat list (perf).' },
  { configKey: 'flatIndentSize', attribute: 'flat-indent-size', converter: toText({ isNullable: true }), on: 'update', description: 'Indent size (CSS length) per level in flat rendering.' },
  { configKey: 'isProgressiveRenderEnabled', attribute: 'enable-progressive-render', converter: toBool('tristate'), default: true, on: 'update', type: 'boolean', description: 'Render large trees in progressive batches.' },
  { configKey: 'initialBatchSize', attribute: 'initial-batch-size', converter: toInt(), default: 20, on: 'update', description: 'Rows rendered in the first progressive batch.' },
  { configKey: 'maxBatchSize', attribute: 'max-batch-size', converter: toInt(), default: 500, on: 'update', description: 'Maximum rows per progressive batch.' },

  // ── Virtual scroll ─────────────────────────────────────────────────────────
  { configKey: 'isVirtualScrollEnabled', attribute: 'enable-virtual-scroll', converter: toBool('tristate'), default: false, on: 'update', type: 'boolean', description: 'Enable virtual scrolling.' },
  { configKey: 'virtualScrollItemHeight', attribute: 'virtual-scroll-item-height', converter: toFloat(), on: 'update', description: 'Fixed row height (px) used by virtual scrolling.' },
  { configKey: 'virtualScrollOverscan', attribute: 'virtual-scroll-overscan', converter: toInt(), default: 5, on: 'update', description: 'Extra rows rendered above/below the viewport when virtualizing.' },
  { configKey: 'virtualScrollContainerHeight', attribute: 'virtual-scroll-container-height', converter: toText({ isNullable: true }), on: 'update', description: 'Height (CSS length) of the virtual-scroll viewport.' },

  // ── Selection model ────────────────────────────────────────────────────────
  { configKey: 'rangeSelectionMode', attribute: 'range-selection-mode', converter: toEnum(['visual', 'logical'] as const), on: 'update', description: 'How Shift+click range selection walks the tree.' },
  { configKey: 'selectionMode', attribute: 'selection-mode', converter: toEnum(['single', 'multiple'] as const), on: 'update', description: 'Single- or multi-node selection.' },
  /**
   * Replace individual keyboard-navigation methods. Merged over the built-in
   * defaults (`{ ...defaults, ...navigationOverrides }`) — a method you leave out
   * keeps its default. Called on the merged object, so inside a `function`
   * override `this.navTo(path)` reaches the active primitive (the defaults move
   * through `navTo`). Runs after `beforeKeydownCallback`. JS property only;
   * reassign to swap at runtime, `null` restores the defaults.
   */
  { configKey: 'navigationOverrides', converter: toValue({ validate: (v): v is object | null => v === null || (typeof v === 'object' && !Array.isArray(v)) }), default: null, on: 'update', type: 'TreeNavigationOverrides | null', description: 'Replace individual keyboard-navigation methods (navNextSibling, navPageDown, navSelectNext, …), merged over the defaults. JS property only; `null` restores the defaults.' },
  { configKey: 'isCheckboxesShown', attribute: 'show-checkboxes', converter: toBool('default-false'), on: 'update', description: 'Show a checkbox on each node.' },
  { configKey: 'checkboxMode', attribute: 'checkbox-mode', converter: toEnum(['independent', 'cascade'] as const), on: 'update', description: 'Checkbox interaction: `independent` toggles one node; `cascade` toggles the subtree with a tristate box on branches.' },
  { configKey: 'cascadeCheckPolicy', attribute: 'cascade-check-policy', converter: toEnum(['rolled-up', 'leaves', 'all'] as const), on: 'update', description: 'Which paths the checked set EMITS in cascade mode: `rolled-up` (minimal cover), `leaves`, or `all`. Default rolled-up.' },
  { configKey: 'shouldClickToggleCheckbox', attribute: 'click-toggle-checkbox', converter: toBool('tristate'), default: false, on: 'update', type: 'boolean', description: 'A node-row click also toggles its checkbox.' },

  // ── Complex property (nodes; too large for an attribute) ───────────────────
  { configKey: 'nodes', converter: toValue({ validate: (v): v is unknown[] => Array.isArray(v) }), on: 'update', getLiveValue: (el) => readLiveNodes(el), type: 'ReadonlyArray<Record<string, unknown>>', description: 'The node objects. Assigning replaces the tree (JS API); reading returns the current state once built — every node data object in tree order, mutations included (also `el.controller.nodes`).' },

  // ── Custom styles (element-only; injected, not passed to the engine) ───────
  { configKey: 'getCustomStylesCallback', converter: cb(), on: 'update', type: '(ctx: TreeViewContext) => string', description: 'Returns a CSS string injected into the component shadow root (supports @import).' },

  // ── Callbacks — every one takes ONE ctx (`ctx.node` for the per-node ones) ──
  { configKey: 'getDisplayValueCallback', converter: cb(), on: 'update', type: '(ctx: NodeContext) => string', description: 'Compute a node display label (overrides displayValueMember).' },
  { configKey: 'getSearchValueCallback', converter: cb(), on: 'update', type: '(ctx: NodeContext) => string', description: 'Compute the text a node is searched against.' },
  { configKey: 'getIsExpandedCallback', converter: cb(), on: 'update', type: '(ctx: NodeContext) => boolean', description: 'Whether a node starts expanded (overrides isExpandedMember).' },
  { configKey: 'getIsCheckedCallback', converter: cb(), on: 'update', type: '(ctx: NodeContext) => boolean', description: 'Whether a node starts checked (overrides isCheckedMember).' },
  { configKey: 'getIsSelectableCallback', converter: cb(), on: 'update', type: '(ctx: NodeContext) => boolean', description: 'Whether a node can be selected (overrides isSelectableMember).' },
  { configKey: 'getIsDraggableCallback', converter: cb(), on: 'update', type: '(ctx: NodeContext) => boolean', description: 'Whether a node is draggable (overrides isDraggableMember).' },
  { configKey: 'getIsDropAllowedCallback', converter: cb(), on: 'update', type: '(ctx: NodeContext) => boolean', description: 'Whether a drop onto a node is allowed (overrides isDropAllowedMember).' },
  { configKey: 'getIsCollapsibleCallback', converter: cb(), on: 'update', type: '(ctx: NodeContext) => boolean', description: 'Whether a node is collapsible (overrides isCollapsibleMember).' },
  { configKey: 'getAllowedDropPositionsCallback', converter: cb(), on: 'update', type: "(ctx: NodeContext) => ('before' | 'after' | 'child')[] | null | undefined", description: 'Which drop positions a node allows.' },
  { configKey: 'getIconCallback', converter: cb(), on: 'update', type: '(ctx: NodeContext) => string | null', description: 'Compute a per-node icon value (overrides iconMember).' },
  { configKey: 'getIconColorCallback', converter: cb(), on: 'update', type: '(ctx: NodeContext) => string | null', description: 'Compute a per-node icon color (overrides iconColorMember).' },
  { configKey: 'getNodeClassCallback', converter: cb(), on: 'update', type: '(ctx: NodeContext) => string | null | undefined', description: 'Extra class(es) for a node row (`.wtv__node`).' },
  { configKey: 'getNodeContentClassCallback', converter: cb(), on: 'update', type: '(ctx: NodeContext) => string | null | undefined', description: 'Extra class(es) for a node content element (`.wtv__node-content`).' },
  { configKey: 'getNodeTooltipCallback', converter: cb(), on: 'update', type: '(ctx: NodeContext) => string | HTMLElement | null | undefined', description: 'Tooltip content for a node — plain text or a built HTMLElement. Requires show-node-tooltips.' },
  { configKey: 'sortCallback', converter: cb(), on: 'update', type: '(ctx: SortContext) => LTreeNode[]', description: 'Orders the children of one parent: `ctx.nodes` are siblings — return them in the new order. Not called on the input under `sorted` (still used by addBranch / addNode / move re-sorts).' },
  { configKey: 'getContextMenuItemsCallback', converter: cb(), on: 'update', type: '(ctx: TreeMenuContext) => TreeMenuEntry[]', description: "The context-menu entries for the right-clicked node (`ctx.node`, `parent`, `siblings`): core action items (`{ id, text, icon, shortcut, onClick(detail) }`, `get*Callback(ctx)`, `children` / `getChildrenCallback`), `menuDivider(text?)`, or a built-in name ('copy' | 'cut' | 'paste' | 'delete' | 'expand' | 'collapse' | 'expand-subtree' | 'collapse-subtree' | 'expand-all' | 'collapse-all'). Every activation fires `action`." },

  // ── Callbacks: render hooks ──────────────────────────────────────────────
  { configKey: 'renderNodeCallback', converter: cb(), on: 'update', type: '(ctx: NodeRenderCallbackContext) => void', description: 'Custom render for a node row: fill `ctx.contentElement` (render state on the ctx).' },
  { configKey: 'renderIconCallback', converter: cb(), on: 'update', type: '(ctx: IconRenderContext) => void', description: 'Custom per-node icon render (SVG / unicode / markup) into `ctx.iconElement`. Wins over the default class-based <i>.' },
  { configKey: 'renderEmptyStateCallback', converter: cb(), on: 'update', type: '(ctx: ContainerRenderContext) => void', description: 'Custom render for the empty-tree state into `ctx.containerElement`.' },
  { configKey: 'renderEmptyZoneCallback', converter: cb(), on: 'update', type: '(ctx: ContainerRenderContext) => void', description: 'Custom render for an empty drop zone.' },
  { configKey: 'renderLoadingCallback', converter: cb(), on: 'update', type: '(ctx: ContainerRenderContext) => void', description: 'Custom render for the loading state.' },
  { configKey: 'renderHeaderCallback', converter: cb(), on: 'update', type: '(ctx: ContainerRenderContext) => void', description: 'Custom render for the tree header.' },
  { configKey: 'renderFooterCallback', converter: cb(), on: 'update', type: '(ctx: ContainerRenderContext) => void', description: 'Custom render for the tree footer.' },
  { configKey: 'renderContextMenuCallback', converter: cb(), on: 'update', type: '(ctx: ContextMenuRenderContext) => void', description: 'Take over the whole context menu: fill `ctx.containerElement` (close via `ctx.controller.closeContextMenu()`).' },
  { configKey: 'renderContextMenuItemCallback', converter: cb(), on: 'update', type: '(ctx: ContextMenuItemRenderContext) => void', description: 'Fill one context-menu item button (`ctx.buttonElement`, `ctx.menuItem`); leave it empty for the default.' },

  // ── Callbacks: before-hooks (`false` cancels; a value replaces) ───────────
  { configKey: 'beforeCopyCallback', converter: cb(), on: 'update', type: '(ctx: BeforeCopyCallbackContext) => string[] | false | void', description: 'Runs before a copy (synchronous): `false` blocks, a `string[]` replaces the paths.' },
  { configKey: 'beforeCutCallback', converter: cb(), on: 'update', type: '(ctx: BeforeCopyCallbackContext) => string[] | false | void', description: 'Runs before a cut (synchronous): `false` blocks, a `string[]` replaces the paths.' },
  { configKey: 'beforePasteCallback', converter: cb(), on: 'update', type: '(ctx: BeforePasteCallbackContext) => { targetPath?, position? } | false | void', description: 'Runs before a paste (synchronous): `false` blocks (no `node-paste` event), an object redirects the target / position.' },
  { configKey: 'beforeDeleteCallback', converter: cb(), on: 'update', type: '(ctx: BeforeDeleteCallbackContext) => string[] | false | void', description: 'Runs before a delete (synchronous): `false` blocks, a `string[]` narrows the paths.' },
  { configKey: 'beforeDropCallback', converter: cb(), on: 'update', type: '(ctx: BeforeDropCallbackContext) => false | { position?, operation? } | DropGroup[] | void | Promise<…>', description: 'Runs before a drop (async OK): `false` blocks, an object redirects, a DropGroup[] routes it to several destinations.' },
  { configKey: 'beforeDragStartCallback', converter: cb(), on: 'update', type: '(ctx: BeforeDragStartContext) => string[] | false | void', description: 'Set-level pre-drag interceptor (synchronous — dragstart): prune/augment/veto the dragged set.' },
  { configKey: 'beforeCheckboxToggleCallback', converter: cb(), on: 'update', type: '(ctx: BeforeCheckboxToggleContext) => string[] | false | void', description: 'Runs before a checkbox toggle (`ctx.node`, `ctx.isChecked`, `ctx.affectedPaths`): `false` cancels, a `string[]` overrides the affected paths.' },
  /**
   * Runs before a node expands via the toggle, the keyboard or `expandNodes()` (not
   * `expandAll()`, expand-level seeding or accordion side-effects). `false` keeps it
   * collapsed. A Promise defers the expand — load the children (`ctx.controller.addBranch`)
   * and resolve: the node shows a loading state (`.wtv__toggle-icon--loading`, `aria-busy`)
   * and ignores repeat toggles meanwhile; resolving `false` or rejecting (warned) keeps it
   * collapsed. A synchronous hook stays synchronous.
   */
  { configKey: 'beforeExpandCallback', converter: cb(), on: 'update', type: '(ctx: BeforeExpandContext) => boolean | void | Promise<boolean | void>', description: 'Runs before a node expands (toggle, keyboard, expandNodes — not expandAll / seeding / accordion): `false` keeps it collapsed; a Promise defers the expand with a loading state (lazy loading: addBranch the children, then resolve). A throw / rejection keeps it collapsed and is logged (error) through the element\'s logger.' },
  { configKey: 'beforeKeydownCallback', converter: cb(), on: 'update', type: '(ctx: KeydownContext) => void | false', description: 'Runs before the built-in keyboard handling (synchronous): return `false` to suppress it for this key. Drive the tree via `ctx.controller`.' },
  { configKey: 'beforeActionCallback', converter: cb(), on: 'update', type: '(detail: TreeViewActionEventDetail) => void | false | Promise<void | false>', description: 'Runs before a context-menu item activates: `false` cancels its onClick, the `action` event and the built-in.' },
  { configKey: 'nodeOutputTransformationCallback', converter: cb(), on: 'update', type: '(ctx: NodeTransformCallbackContext) => data', description: 'OUTPUT (egress) transform — clean/redact `ctx.data` as a node leaves the source (copy/cut/copy-drop).' },
  { configKey: 'nodeInputTransformationCallback', converter: cb(), on: 'update', type: '(ctx: NodeTransformCallbackContext) => data | null', description: 'INPUT (ingress) transform — derive ids/values from `ctx.data` as a node lands (paste/copy-drop); return null to skip.' },
];

// ── Outward DOM events (core §12.5) ──────────────────────────────────────────
// Each installs a camelCase `on<Name>` twin that core calls with the detail (not
// the CustomEvent) right before dispatching. Every detail carries `controller` /
// `element` (non-enumerable).
type TreeViewEvents = {
  'node-click': NodeEventDetail;
  'node-double-click': NodeEventDetail;
  'node-expand': NodeEventDetail;
  'node-collapse': NodeEventDetail;
  'node-copy': NodeClipboardEventDetail;
  'node-cut': NodeClipboardEventDetail;
  'node-paste': NodePasteEventDetail;
  'node-delete': NodeClipboardEventDetail;
  'node-drag-start': NodeDragEventDetail;
  'node-drag-over': NodeDragEventDetail;
  'node-drop': NodeDropEventDetail;
  'node-drag-reject': NodeEventDetail;
  'node-drop-reject': NodeEventDetail;
  'selection-change': SelectionChangeEventDetail;
  'checked-change': SelectionChangeEventDetail;
  'focus-change': FocusChangeEventDetail;
  'expanded-change': ExpandedChangeEventDetail;
  'tree-change': TreeEventDetail;
  'action': TreeViewActionEventDetail;
};
const EVENTS: readonly EventDef[] = [
  { name: 'node-click', description: 'A node was clicked (a checkbox toggle is not a click — see `checked-change`). `detail`: the node with `path`, `parent`, `siblings`. Twin: `onNodeClick(detail)`.' },
  { name: 'node-double-click', description: 'A node was double-clicked. `detail`: the node context. Twin: `onNodeDoubleClick(detail)`.' },
  { name: 'node-expand', description: 'A node expanded (toggle, keyboard, `expandNodes`, after any `beforeExpandCallback` load; NOT `expandAll` / expand-level seeding — those only fire `tree-change`). `detail`: the node context. Twin: `onNodeExpand(detail)`.' },
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
  { name: 'expanded-change', description: 'The expanded set changed (toggle, keyboard, expandNodes / collapseNodes, expandAll / collapseAll, accordion, assigning `expandedPaths`, data changes) — one event per change, after the state settled. `detail`: `{ paths }` = the whole new set (same as `expandedPaths`). Not fired for `{ silent: true }` operations. Twin: `onExpandedChange(detail)`.' },
  { name: 'tree-change', description: 'The tree state changed (bulk notification). `detail`: the context only. Twin: `onTreeChange(detail)`.' },
  { name: 'action', description: 'A context-menu item was activated. `detail`: `action` (built-in name or `custom`), `id`, `item`, `source: "context-menu"`, `node` / `path` / `parent` / `siblings`, `sourceEvent`, `triggerElement`. Fires after the item’s `onClick`, before the built-in. Twin: `onAction(detail)`.' },
];

/** configKey the engine does NOT own — injected/handled by this element. */
const NON_ENGINE_KEYS = new Set(['getCustomStylesCallback']);

export class WebTreeViewElement<T = any> extends BlissElement<TreeViewEvents, TreeViewController<T>> {
  protected static override inputs = INPUTS;
  protected static override events = EVENTS;

  static {
    readLiveNodes = (el) => (el instanceof WebTreeViewElement ? el.#treeview?.nodes : undefined);
  }

  // Type-only: core installs the `on<Name>` twins at runtime (§12.5); each is
  // called with the event detail (not the CustomEvent), right before the event.
  declare onNodeClick: ((detail: NodeEventDetail<T>) => void) | null;
  declare onNodeDoubleClick: ((detail: NodeEventDetail<T>) => void) | null;
  declare onNodeExpand: ((detail: NodeEventDetail<T>) => void) | null;
  declare onNodeCollapse: ((detail: NodeEventDetail<T>) => void) | null;
  declare onNodeCopy: ((detail: NodeClipboardEventDetail<T>) => void) | null;
  declare onNodeCut: ((detail: NodeClipboardEventDetail<T>) => void) | null;
  declare onNodePaste: ((detail: NodePasteEventDetail<T>) => void) | null;
  declare onNodeDelete: ((detail: NodeClipboardEventDetail<T>) => void) | null;
  declare onNodeDragStart: ((detail: NodeDragEventDetail<T>) => void) | null;
  declare onNodeDragOver: ((detail: NodeDragEventDetail<T>) => void) | null;
  declare onNodeDrop: ((detail: NodeDropEventDetail<T>) => void) | null;
  declare onNodeDragReject: ((detail: NodeEventDetail<T>) => void) | null;
  declare onNodeDropReject: ((detail: NodeEventDetail<T>) => void) | null;
  declare onSelectionChange: ((detail: SelectionChangeEventDetail<T>) => void) | null;
  declare onCheckedChange: ((detail: SelectionChangeEventDetail<T>) => void) | null;
  declare onFocusChange: ((detail: FocusChangeEventDetail<T>) => void) | null;
  declare onExpandedChange: ((detail: ExpandedChangeEventDetail<T>) => void) | null;
  declare onTreeChange: ((detail: TreeEventDetail<T>) => void) | null;
  declare onAction: ((detail: TreeViewActionEventDetail<T>) => void) | null;

  /**
   * The tree's notifications → `emit()` (which calls the twin, then dispatches). Built
   * once, so WebTreeView's memoized adapters keep their identity across updates.
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
    onTreeChange: (d) => this.emit('tree-change', d),
    onAction: (d) => this.emit('action', d),
  };

  #shadow: ShadowRoot;
  #treeview?: WebTreeView<T>;
  #container?: HTMLDivElement;
  #renderer?: TreeViewRenderer<T>;

  // Custom-styles injection state (mirrors the old _applyCustomStyles fields).
  #customStyleSheet?: HTMLStyleElement;
  #customStyleLinks?: HTMLLinkElement[];
  #customDocLinks?: HTMLLinkElement[];

  /** State assigned before the first build (`expandedPaths` / `selectedPaths` / `checkedPaths`), applied right after it. */
  #pendingState: { expandedPaths?: string[]; selectedPaths?: string[]; checkedPaths?: string[] } = {};

  constructor() {
    super();
    this.#shadow = this.attachShadow({ mode: 'open' });

    // §12.8: shell CSS via one shared, cached CSSStyleSheet (per string).
    adoptStyles(this.#shadow, styles);
    // FOUC guard: base.css hides the host until core sets the `ready` attribute
    // (+ `:state(ready)`, `ready` event) after the first build.
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
    if ('getCustomStylesCallback' in partial) this.#applyCustomStyles();
    if (!this.#treeview) return;
    const cfg = this.#assembleConfig() as Record<string, unknown>;
    for (const [key, value] of Object.entries(partial)) {
      if (NON_ENGINE_KEYS.has(key)) continue;
      // Forward `null` verbatim — it is the "clear/reset" signal (SPEC §6.1).
      // The engine resolves it per field: defaulted props via `?? default`,
      // clearable props (node classes, focusedNode, theme) by assigning null.
      cfg[key] = value;
    }
    this.#treeview.update(cfg as Partial<TreeViewConfig<T>>);
  }

  /**
   * Activate (every connect, after any reinit()/update()): re-attach the live
   * resources. The tree is built once (reinit) and survives a DOM move with all
   * its state; build only if it doesn't exist yet.
   */
  protected override connect(): void {
    if (!this.#treeview) this.#buildEngine();
    else this.#treeview.activate();
  }

  /**
   * Deactivate (every disconnect — a DOM move or a removal): stop ONLY the live
   * resources (document listeners, observers, autoUpdate, open popups). The
   * engine + renderer are kept, so expansion, selection, checks, focus, search
   * and the scroll offset survive a move (D1).
   */
  protected override disconnect(): void {
    this.#treeview?.deactivate();
  }

  /**
   * Final teardown (core `destroy()`): release what `disconnect()` keeps — the
   * engine, renderer, search index and clipboard registration.
   */
  protected override destroyCallback(): void {
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
    this.log.INIT.debug('build engine', {
      idMember: config.idMember,
      pathMember: config.pathMember,
      displayValueMember: config.displayValueMember,
      dataLength: (config.nodes as unknown[] | undefined)?.length ?? 0,
    });

    this.#treeview = new WebTreeView<T>(this.#container!, config, this.#renderer, this.#treeLoggers());
    this.#applyCustomStyles();
    const pending = this.#pendingState;
    this.#pendingState = {};
    if (pending.expandedPaths) this.#treeview.expandedPaths = pending.expandedPaths;
    if (pending.selectedPaths) this.#treeview.selectedPaths = pending.selectedPaths;
    if (pending.checkedPaths) this.#treeview.checkedPaths = pending.checkedPaths;
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
    this.#applyCustomStyles();
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
    cfg.hostElement = this;
    cfg.controller = this.controller;
    return cfg;
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

    const callback = this.config.getCustomStylesCallback as ((ctx: TreeViewContext<T>) => string) | null | undefined;
    if (typeof callback !== 'function') return;

    const css = callback(this.withContext({}) as unknown as TreeViewContext<T>);
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

  /** The live tree after applying pending property writes (`flush()`), so
   *  `el.prop = x; el.method()` sees `x` (core rule; NOTES #13). */
  get #live(): WebTreeView<T> | undefined {
    this.flush();
    return this.#treeview;
  }

  /** Assign a state set on the live tree, or hold it until the first build. */
  #setState(key: 'expandedPaths' | 'selectedPaths' | 'checkedPaths', paths: Iterable<string>): void {
    const list = [...(paths ?? [])];
    const tree = this.#live;
    if (tree) tree[key] = list;
    else this.#pendingState[key] = list;
  }

  expandAll(paths?: string | string[] | null, options?: ExpandOptions): void {
    this.#live?.expandAll(paths, options);
  }

  collapseAll(paths?: string | string[] | null, options?: ExpandOptions): void {
    this.#live?.collapseAll(paths, options);
  }

  expandNodes(paths: string | string[], options?: ExpandOptions): void {
    this.#live?.expandNodes(paths, options);
  }

  collapseNodes(paths: string | string[], options?: ExpandOptions): void {
    this.#live?.collapseNodes(paths, options);
  }

  filterNodes(term: string): void {
    this.#live?.filterNodes(term);
  }

  searchNodes(term: string | null): LTreeNode<T>[] {
    return this.#live?.searchNodes(term) ?? [];
  }

  scrollToPath(path: string, options?: ScrollToPathOptions): Promise<boolean> {
    return this.#live?.scrollToPath(path, options) ?? Promise.resolve(false);
  }

  closeContextMenu(): void {
    this.#live?.closeContextMenu();
  }

  /** The expanded set. Assigning replaces it (branches not listed collapse); before the
   *  first build the value is held and applied once the tree exists. */
  get expandedPaths(): string[] {
    return this.#live?.expandedPaths ?? [...(this.#pendingState.expandedPaths ?? [])];
  }

  set expandedPaths(paths: Iterable<string>) {
    this.#setState('expandedPaths', paths);
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

  removeNode(path: string, includeDescendants?: boolean): any {
    return this.#live?.removeNode(path, includeDescendants);
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

  /** Copy one node (+ descendants) under a parent; `transform({ data, node })` may return null to skip. */
  copyNodeWithDescendants(
    sourceNode: LTreeNode<T>,
    targetParentPath: string,
    transform: (ctx: { data: T; node: LTreeNode<T> } & TreeViewContext<T>) => T | null,
    siblingPath?: string,
    position?: 'before' | 'after'
  ): any {
    return this.#live?.copyNodeWithDescendants(sourceNode, targetParentPath, transform, siblingPath, position);
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
  applyChanges(changes: TreeChange<T>[]): ApplyChangesResult {
    return this.#live?.applyChanges(changes) ?? { successful: 0, failed: [] };
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

  removeBranch(path: string, keepParent?: boolean): { success: boolean; count: number; error?: string } {
    return this.#live?.removeBranch(path, keepParent) ?? { success: false, count: 0, error: 'Not initialized' };
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

  /** The selected set (a snapshot). Assigning replaces it and fires `selection-change`
   *  (use `clearSelection` / `selectNodes` with `{ silent: true }` for a silent restore). */
  get selectedPaths(): string[] {
    return this.#live?.selectedPaths ?? [...(this.#pendingState.selectedPaths ?? [])];
  }

  set selectedPaths(paths: Iterable<string>) {
    this.#setState('selectedPaths', paths);
  }

  isNodeSelected(path: string): boolean {
    return this.#live?.isNodeSelected(path) ?? false;
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

  /** The checked set as emitted (projected through `cascadeCheckPolicy`). Assigning
   *  replaces it and fires `checked-change`. */
  get checkedPaths(): string[] {
    return this.#live?.checkedPaths ?? [...(this.#pendingState.checkedPaths ?? [])];
  }

  set checkedPaths(paths: Iterable<string>) {
    this.#setState('checkedPaths', paths);
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

  // ── Insert diagnostics ──────────────────────────────────────────────────────

  /** Result of the most recent data insert (successful / failed / failedDetails) — read-only state. */
  get insertResult() {
    return this.#live?.insertResult;
  }

  // ── Navigation ──────────────────────────────────────────────────────────────

  navTo(path: string): void { this.#live?.navTo(path); }
  navNext(): void { this.#live?.navNext(); }
  navPrev(): void { this.#live?.navPrev(); }
  navNextSibling(): void { this.#live?.navNextSibling(); }
  navPrevSibling(): void { this.#live?.navPrevSibling(); }
  navInto(): void { this.#live?.navInto(); }
  navOut(): void { this.#live?.navOut(); }
  navBackOut(): void { this.#live?.navBackOut(); }
  navToggle(): void { this.#live?.navToggle(); }
  navFirst(): void { this.#live?.navFirst(); }
  navLast(): void { this.#live?.navLast(); }
  navPageDown(): void { this.#live?.navPageDown(); }
  navPageUp(): void { this.#live?.navPageUp(); }
  navSelectNext(): void { this.#live?.navSelectNext(); }
  navSelectPrev(): void { this.#live?.navSelectPrev(); }
  navSelectFirst(): void { this.#live?.navSelectFirst(); }
  navSelectLast(): void { this.#live?.navSelectLast(); }
  navSelectPageDown(): void { this.#live?.navSelectPageDown(); }
  navSelectPageUp(): void { this.#live?.navSelectPageUp(); }

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
    });
  }
}

// Importing this module registers the element (back-compat contract). The full
// global-API publish + logger wiring happens in index.ts via registerComponent();
// both defines are idempotent, so importing either works.
if (typeof customElements !== 'undefined' && !customElements.get('web-treeview')) {
  customElements.define('web-treeview', WebTreeViewElement);
}
