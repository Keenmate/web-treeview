/**
 * The `<web-treeview>` input table (core `static inputs`), in its own module so the public
 * `TreeViewEngine` reads the SAME defaults the element seeds — C-CA-37: every engine option has the
 * element's default, from one source (this table). `ENGINE_DEFAULTS` is derived from the rows with the
 * resolution core's element uses (`resolveFromAttribute(def, null)`, "absent == default").
 */
import {
  toBool,
  toEnum,
  toInt,
  toCssLength,
  toFloat,
  toText,
  toValue,
  toList,
  toObject,
  toCustom,
  toFunction,
  resolveFromAttribute,
  type AttrReader,
  type InputDef,
  type Converter,
} from '@keenmate/web-components-core';
import { menuPresentationInputs } from '@keenmate/web-components-core/menu';

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
/** Live reads (core `getLiveValue`, SPEC §4.1): `nodes` = the built tree's current node data, `state` = its
 *  current expanded / selected / checked set. Assigned in the element's static block (it reaches the private
 *  `#treeview`). */
export const liveReaders = {
  nodes: (_el: HTMLElement): unknown[] | undefined => undefined,
  state: (_el: HTMLElement, _key: StateKey): string[] | undefined => undefined,
};

/** The tree-state inputs (`expandedPaths` / `selectedPaths` / `checkedPaths`): applied on the built tree
 *  directly, never through the engine config (it would re-apply the assigned set on every update). */
export type StateKey = 'expandedPaths' | 'selectedPaths' | 'checkedPaths';
export const STATE_KEYS: readonly StateKey[] = ['expandedPaths', 'selectedPaths', 'checkedPaths'];

/**
 * "Never set" for a state input — its default and its absent-attribute value. One shared frozen `[]`, so it
 * reads as an empty set and the first build can still tell it from an assigned `[]` (which it applies: an empty
 * set overrides `expandLevel` / the data's `selected` flags). After the build it clears the set (attribute
 * removed, `el.x = undefined`).
 */
export const UNSET_PATHS = Object.freeze([]) as unknown as string[];

/**
 * A path set: a JSON array or a comma-separated list on the attribute (core `toList`), any iterable of strings
 * on the property (a `Set` is copied to an array; `null` = the empty set).
 */
function toPathSet(): Converter<string[]> {
  const list = toList({ itemType: 'string' });
  return {
    fromAttribute(raw, el, attr, reportInvalid) {
      return raw === null || raw.trim() === '' ? UNSET_PATHS : list.fromAttribute!(raw, el, attr, reportInvalid);
    },
    normalize(value) {
      if (value === null) return [];
      if (Array.isArray(value)) return value;
      if (typeof value === 'object' && Symbol.iterator in value) return [...(value as Iterable<unknown>)];
      return value;
    },
    validate: list.validate,
    toAttribute: list.toAttribute,
  };
}

export const INPUTS: readonly InputDef[] = [
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
  { configKey: 'iconMember', attribute: 'icon-member', converter: toText({ isNullable: true }), on: 'update', description: 'Property name that holds a per-node icon value — markup, a built-in name, a name for `renderIconCallback`, or icon-font classes (`<i class="wtv__icon {value}">`).' },
  { configKey: 'iconColorMember', attribute: 'icon-color-member', converter: toText({ isNullable: true }), on: 'update', description: 'Property name that holds a per-node icon color (applied to the .wtv__node-icon element).' },

  // ── Behavior ───────────────────────────────────────────────────────────────
  { configKey: 'expandLevel', attribute: 'expand-level', converter: toInt({ default: 0 }), on: 'update', description: 'Depth to auto-expand on load (0 = roots only, the default).' },
  { configKey: 'treePathSeparator', attribute: 'tree-path-separator', converter: toText({ isNullable: true, isEmptyAllowed: true }), on: 'update', description: 'Separator between segments in a materialized tree path.' },
  { configKey: 'clickBehavior', attribute: 'click-behavior', converter: toEnum(['select', 'expand', 'expand-and-focus'] as const, { default: 'expand-and-focus' }), on: 'update', description: 'What a node click does: select, expand, or expand-and-focus (default).' },
  { configKey: 'shouldExpandAsAccordion', attribute: 'expand-as-accordion', converter: toBool('tristate'), default: false, on: 'update', type: 'boolean', description: 'Accordion mode: expanding a node collapses its siblings.' },
  { configKey: 'isSortingEnabled', attribute: 'enable-sorting', converter: toBool('tristate'), default: true, on: 'update', type: 'boolean', description: 'Automatic sorting of siblings (default on). Off: the input order is kept, `addNode` appends, `insertNode` / `insertBranch` / `moveNode` / drop keep the exact position (with `orderMember` the order values are still computed). `sortNodes` / `sortAll` still sort; switching it back on re-sorts the tree.' },
  { configKey: 'isSorted', attribute: 'sorted', converter: toBool('tristate'), default: false, on: 'update', type: 'boolean', description: 'Hint: data is already in insert order (parents first, siblings ordered) — skips sorting the input; faster on big data.' },

  // ── Search / indexer ───────────────────────────────────────────────────────
  { configKey: 'shouldUseInternalSearchIndex', attribute: 'use-internal-search-index', converter: toBool('tristate'), default: true, on: 'update', type: 'boolean', description: 'Build the internal FlexSearch index that filterNodes / searchNodes / search-term query (default on; `false` = no index, search finds nothing).' },
  { configKey: 'indexerBatchSize', attribute: 'indexer-batch-size', converter: toInt(), default: 1000, on: 'update', description: 'Max nodes indexed per idle slot when building the search index (default 1000). Each slot is also time-boxed (≤16 ms, ≤8 ms when forced on a busy page), which is what keeps the UI smooth.' },
  { configKey: 'indexerTimeout', attribute: 'indexer-timeout', converter: toInt(), default: 50, on: 'update', description: 'Idle timeout (ms) between search-index batches.' },
  { configKey: 'initializeIndexCallback', converter: cb(), on: 'update', type: '() => Index', description: 'Factory for a custom FlexSearch Index (tokenizer, charset, …) used instead of the built-in one. JS only; a change rebuilds the index.' },
  { configKey: 'searchTerm', attribute: 'search-term', converter: toText({ isNullable: true, isEmptyAllowed: true }), on: 'update', description: 'Active search/filter term.' },
  { configKey: 'searchResultLimit', attribute: 'search-result-limit', converter: toInt({ min: 1, default: 1000 }), default: 1000, on: 'update', description: 'Max matches a search / filter returns (default 1000; FlexSearch\'s own silent default was 100). Check `search-status-change` `detail.isLimited` to tell users the result was truncated.' },
  { configKey: 'filterScope', attribute: 'filter-scope', converter: toEnum(['matches', 'descendants', 'tree-depth', 'subtree-height', 'levels-below'] as const, { default: 'matches' }), on: 'update', description: 'EXPERIMENTAL — which descendants of a filter match stay visible (ancestors always do): `matches` (default), `descendants` (whole subtree), `tree-depth` (whole subtree for a match at level ≥ max depth − x), `subtree-height` (whole subtree if it is ≤ x levels deep), `levels-below` (x levels under each match). x = filter-descendant-depth.' },
  { configKey: 'filterDescendantDepth', attribute: 'filter-descendant-depth', converter: toInt({ min: 0, default: 1 }), on: 'update', description: 'EXPERIMENTAL — the x for the depth-limited filter scopes. Default 1.' },
  { configKey: 'shouldExpandFilterDescendants', attribute: 'expand-filter-descendants', converter: toBool('tristate'), default: true, on: 'update', type: 'boolean', description: 'EXPERIMENTAL — expand the descendants a filter scope adds (default on). Off: they start collapsed (matches + ancestors stay expanded) — keeps a top-level match on a big tree cheap.' },

  // ── Theme / visual classes ─────────────────────────────────────────────────
  { configKey: 'bodyClass', attribute: 'body-class', converter: toText({ isNullable: true }), on: 'update', description: 'Extra class on the tree body container.' },
  { configKey: 'selectedNodeClass', attribute: 'selected-node-class', converter: toText({ isNullable: true }), on: 'update', description: 'Class applied to selected nodes.' },
  { configKey: 'focusedNodeClass', attribute: 'focused-node-class', converter: toText({ isNullable: true }), on: 'update', description: 'Class applied to the focused node.' },
  { configKey: 'checkedNodeClass', attribute: 'checked-node-class', converter: toText({ isNullable: true }), on: 'update', description: 'Class applied to checked nodes — opt-in extra styling; the checkbox is the default signal.' },
  { configKey: 'dragOverNodeClass', attribute: 'drag-over-node-class', converter: toText({ isNullable: true }), on: 'update', description: 'Class applied to a node being dragged over.' },
  { configKey: 'draggedNodeClass', attribute: 'dragged-node-class', converter: toText({ isNullable: true }), on: 'update', description: 'Class for the dragged source row; replaces the built-in .wtv__node-content--dragged visual.' },

  // ── Node tooltips (hover/focus) ─────────────────────────────────────────────
  { configKey: 'isNodeTooltipsShown', attribute: 'show-node-tooltips', converter: toBool('default-false'), on: 'update', description: 'Enable hover/focus tooltips on node rows (content from getNodeTooltipCallback).' },
  { configKey: 'tooltipPlacement', attribute: 'tooltip-placement', converter: toEnum(['top', 'top-start', 'top-end', 'right', 'right-start', 'right-end', 'bottom', 'bottom-start', 'bottom-end', 'left', 'left-start', 'left-end'] as const, { default: 'top-start' }), on: 'update', description: 'Tooltip placement relative to the row. Default top-start.' },
  { configKey: 'tooltipDelay', attribute: 'tooltip-delay', converter: toTooltipDelay(), on: 'update', type: 'number | { show?: number; hide?: number }', description: 'Show/hide delay (ms). The attribute sets both; the JS property also accepts { show, hide }. Default { show: 400, hide: 100 }.' },
  { configKey: 'tooltipOffset', attribute: 'tooltip-offset', converter: toInt(), default: 8, on: 'update', description: 'Gap from the row (or cursor), px. Default 8.' },
  { configKey: 'shouldTooltipFollowCursor', attribute: 'tooltip-follow-cursor', converter: toBool('default-false'), on: 'update', description: 'Anchor the tooltip to the pointer instead of the row.' },
  { configKey: 'iconSet', attribute: 'icon-set', converter: toEnum(['chevron', 'triangle', 'plus-minus', 'arrow'] as const, { default: 'chevron' }), on: 'update', shouldReflect: true, description: 'Disclosure glyph set: chevron (default) | triangle | plus-minus | arrow. Re-points the --wtv-icon-* variables via a :host([icon-set]) rule; reflected to the attribute so the CSS matches when set via the JS property.' },
  { configKey: 'leafIconClass', attribute: 'leaf-icon-class', converter: toText({ isNullable: true }), on: 'update', description: 'Icon class for leaf nodes.' },
  { configKey: 'toggleIconMode', attribute: 'toggle-icon-mode', converter: toEnum(['rotate', 'swap'] as const, { default: 'rotate' }), on: 'update', shouldReflect: true, description: 'Whether the toggle glyph rotates (single glyph, default) or swaps (expand↔collapse glyph). Reflected to the attribute so the :host([toggle-icon-mode="swap"]) CSS matches via the JS property.' },
  { configKey: 'scrollHighlightClass', attribute: 'scroll-highlight-class', converter: toText({ isNullable: true }), on: 'update', description: 'Class flashed on a node after scrollToPath().' },
  { configKey: 'scrollHighlightTimeout', attribute: 'scroll-highlight-timeout', converter: toInt(), default: 4000, on: 'update', description: 'How long (ms) the scroll highlight stays before clearing.' },
  { configKey: 'nodeTitleOverflow', attribute: 'node-title-overflow', converter: toEnum(['wrap', 'ellipsis', 'info'] as const), default: 'ellipsis', on: 'update', type: "'wrap' | 'ellipsis' | 'info'", description: 'A too-long built-in label: `wrap` (multi-line; rows grow — avoid with virtual scroll), `ellipsis` (single-line clip, default) or `info` (ellipsis + a trailing info button on clipped rows that reveals the full label). renderNodeCallback content owns its layout.' },

  // ── Per-node icons ─────────────────────────────────────────────────────────
  { configKey: 'shouldAlignNodeIcons', attribute: 'align-node-icons', converter: toBool('tristate'), default: true, on: 'update', type: 'boolean', description: 'Reserve a fixed icon column so node labels align.' },

  // ── Context menu ───────────────────────────────────────────────────────────
  { configKey: 'contextMenuXOffset', attribute: 'context-menu-x-offset', converter: toInt(), default: 8, on: 'update', description: 'Horizontal offset (px) of the context menu from the pointer.' },
  { configKey: 'contextMenuYOffset', attribute: 'context-menu-y-offset', converter: toInt(), default: 0, on: 'update', description: 'Vertical offset (px) of the context menu from the pointer.' },

  // ── Disabled / read-only (SPEC §6.4: every data-input component has the pair) ─
  { configKey: 'isDisabled', attribute: 'disabled', converter: toBool('presence'), shouldReflect: true, on: 'update', description: 'Disable the tree like a native form control: no user interaction (check, select, expand / collapse, drag, drop, copy / cut / paste / delete, context menu, keyboard), out of the tab order, `aria-disabled="true"`, dimmed (`--wtv-disabled-tree-opacity`). Programmatic API calls still work. Re-enabling restores everything.' },
  { configKey: 'isReadonly', attribute: 'readonly', converter: toBool('presence'), shouldReflect: true, on: 'update', description: 'Read-only tree like a native read-only control: the user cannot change the data — no check, drag, drop, cut / paste / delete (shortcuts and built-in menu items), no sort from the menu — but the tree stays focusable and navigable: keyboard navigation, scroll, expand / collapse, selection highlight and copy work. Not dimmed. Programmatic API calls still work.' },

  // ── Loading ──────────────────────────────────────────────────────────────
  { configKey: 'isLoading', attribute: 'loading', converter: toBool('tristate'), default: false, on: 'update', type: 'boolean', description: 'Show the loading state.' },

  // ── Drag and drop ──────────────────────────────────────────────────────────
  { configKey: 'dragDropMode', attribute: 'drag-drop-mode', converter: toEnum(['none', 'self', 'cross', 'both'] as const, { default: 'none' }), on: 'update', description: 'Drag-drop mode: `none` (off, default), `self` (within this tree), `cross` (between trees), or `both`.' },
  { configKey: 'dropZoneMode', attribute: 'drop-zone-mode', converter: toEnum(['floating', 'glow'] as const, { default: 'glow' }), on: 'update', description: 'Drop-zone visual style: floating indicator or glow (default).' },
  { configKey: 'dropZoneLayout', attribute: 'drop-zone-layout', converter: toEnum(['around', 'before', 'after', 'wave', 'wave2'] as const, { default: 'around' }), on: 'update', description: 'Where drop zones render relative to a node (default `around`).' },
  { configKey: 'dropZoneStart', attribute: 'drop-zone-start', converter: toDropZoneStart(), on: 'update', type: 'number | string', description: 'Where drop zones begin. A number is a percentage of node width; a string is used as-is (`px` or `%`, e.g. "50px").' },
  { configKey: 'dropZoneMaxWidth', attribute: 'drop-zone-max-width', converter: toCssLength({ default: '120px' }), on: 'update', type: 'string | number', description: 'Maximum floating drop-zone width, a CSS length (`120px`, `8rem`, `30%`); a number means pixels on both paths (`drop-zone-max-width="90"` / `el.dropZoneMaxWidth = 90` → `90px`). Default `120px`.' },
  { configKey: 'isCopyAllowed', attribute: 'allow-copy', converter: toBool('tristate'), default: false, on: 'update', type: 'boolean', description: 'Allow the copy clipboard operation.' },
  { configKey: 'shouldAutoHandleCopy', attribute: 'auto-handle-copy', converter: toBool('tristate'), default: true, on: 'update', type: 'boolean', description: 'Let the tree perform the copy itself (vs delegating to onCopy).' },
  { configKey: 'shouldAutoHandleMove', attribute: 'auto-handle-move', converter: toBool('tristate'), default: true, on: 'update', type: 'boolean', description: 'Let the tree perform a move drop itself (default). `false`: the tree is not mutated — `node-drop` fires and the consumer moves the nodes.' },
  { configKey: 'shouldAutoHandlePaste', attribute: 'auto-handle-paste', converter: toBool('tristate'), default: true, on: 'update', type: 'boolean', description: 'Let the tree perform the paste itself (vs delegating to onPaste).' },
  { configKey: 'shouldHandleKeyboardShortcuts', attribute: 'handle-keyboard-shortcuts', converter: toBool('tristate'), default: true, on: 'update', type: 'boolean', description: 'Handle copy/cut/paste/delete keyboard shortcuts.' },
  { configKey: 'touchDragDelay', attribute: 'touch-drag-delay', converter: toInt(), default: 300, on: 'update', description: 'Long-press hold (ms) before a touch-drag engages (default 300).' },
  { configKey: 'shouldIndicateUndraggable', attribute: 'indicate-undraggable', converter: toBool('tristate'), default: true, on: 'update', type: 'boolean', description: 'Built-in "can\'t move/drop this" feedback (🚫 badge + haptic). Default true.' },
  { configKey: 'isTreeDropZoneEnabled', attribute: 'enable-tree-drop-zone', converter: toBool('tristate'), default: false, on: 'update', type: 'boolean', description: 'Make the whole populated tree one drop target (drop lands target=null regardless of per-node drop rules).' },

  // ── Rendering ──────────────────────────────────────────────────────────────
  { configKey: 'labels', attribute: 'labels', converter: toObject(), on: 'update', type: 'Partial<TreeViewLabels>', description: 'UI strings — a partial object (JSON attribute) of flat `<elementType>.<name>` keys (short `messages.noData` or full `web-treeview.messages.noData`), resolved per key by core `/locale`: this `labels` → the page-wide flat dictionary `window.components.locale.labels["web-treeview.<key>"]` → English (an empty string = render nothing; a key this instance did not set goes through the element `translateCallback`, then the page-wide one, first): `messages.noData` ("No data" — no nodes), `messages.noResults` ("No results found" — the search filter left nothing), `messages.dropHere` ("Drop here" — the empty-tree drop zone), `messages.loading` ("Loading…" — the loading row of a lazy context submenu), `labels.noDisplayValue` ("[N/A]" — node without a display value), `labels.dropBefore` / `labels.dropAfter` / `labels.dropChild` ("Before" / "After" / "Child" — the floating drop pads), `ariaLabels.tree` ("Tree" — aria-label of the tree body), `ariaLabels.loading` ("Loading…" — aria-label of the `isLoading` overlay), `ariaLabels.showFullLabel` ("Show full label" — the node-title-overflow="info" button), `ariaLabels.closeSheet` ("Close" — the context menu sheet / drawer close button), `menuItems.copy`, `menuItems.cut`, `menuItems.paste`, `menuItems.delete`, `menuItems.expand`, `menuItems.collapse`, `menuItems.expandSubtree`, `menuItems.collapseSubtree`, `menuItems.expandAll`, `menuItems.collapseAll`, `menuItems.sort`, `menuItems.sortSubtree`, `menuItems.sortAll` (built-in context-menu items), `menuItems.back` ("Back" — the sheet / drawer submenu back row); screen-reader announcements (core `announce()`, `""` silences one): `ariaLabels.searchResults` / `ariaLabels.searchResultsOne` ("{count} results" / "1 result" — a settled search), `ariaLabels.searchNoResults` ("No results found"), `ariaLabels.movedInto` / `ariaLabels.movedBefore` / `ariaLabels.movedAfter` / `ariaLabels.copiedInto` / `ariaLabels.copiedBefore` / `ariaLabels.copiedAfter` ("{name} moved into {target}" … — a drop the tree placed), `ariaLabels.dropItems` ("{count} items" — the `{name}` of a multi-node drop), `ariaLabels.dropTreeRoot` ("the tree" — the `{target}` of a drop on the top level), `ariaLabels.dropDenied` ("Cannot drop here: {target} does not accept dropped items"). `{name}` placeholders.' },
  { configKey: 'translateCallback', converter: cb(), on: 'update', type: 'TranslateCallback', description: "This tree's translation hook (core `/locale`): `({ component, key, template, params, locale }) => string | null`, `key` = the full `web-treeview.<elementType>.<name>`. Asked for every label key this instance's `labels` did not set, before the page-wide `window.components.locale.translateCallback`; `null` / `undefined` = not mine (the page-wide hook, then the page dictionary / English decide). A change re-renders the texts live." },
  { configKey: 'isEmptyDropPlaceholderShown', attribute: 'show-empty-drop-placeholder', converter: toBool('tristate'), default: false, on: 'update', type: 'boolean', description: 'Show a drop placeholder when the tree is empty.' },
  { configKey: 'shouldHighlightOnPageDrag', attribute: 'highlight-on-page-drag', converter: toBool('default-false'), on: 'update', type: 'boolean', description: 'Arm the drop target while a tree NODE is dragged anywhere over the page (any tree): the host gets the `armed` attribute + `:state(armed)`, and an empty tree shows its drop zone at once with `--wtv-drop-placeholder-bg-armed` (the zone under the pointer keeps the engaged look). Cleared on drop anywhere, when the drag leaves the window, on Escape / `dragend`, and on disconnect. Never armed while `drag-drop-mode="none"`, disabled or read-only. One shared page listener for all instances (same option as web-dropzone).' },
  { configKey: 'isFlatRenderingEnabled', attribute: 'enable-flat-rendering', converter: toBool('tristate'), default: true, on: 'update', type: 'boolean', description: 'Render the visible nodes as a flat list (perf).' },
  { configKey: 'flatIndentSize', attribute: 'flat-indent-size', converter: toCssLength({ default: 'var(--wtv-indent-size)' }), on: 'update', type: 'string | number', description: 'Indent per level in flat rendering, a CSS length (`20px`, `1.5rem`); a bare number means pixels (`flat-indent-size="20"` → `20px`). Default `var(--wtv-indent-size)`.' },
  { configKey: 'rowAnimationLimit', attribute: 'row-animation-limit', converter: toInt({ min: 0, default: 50 }), default: 50, on: 'update', description: 'Rows an expand reveals animate in (part of `motion`; `--wtv-row-animation-duration: 0s` turns off just the rows). At most this many animate per expand; the rest appear at once. 0 = none.' },
  { configKey: 'isProgressiveRenderEnabled', attribute: 'enable-progressive-render', converter: toBool('tristate'), default: true, on: 'update', type: 'boolean', description: 'Render large trees in progressive batches.' },
  { configKey: 'initialBatchSize', attribute: 'initial-batch-size', converter: toInt(), default: 20, on: 'update', description: 'Rows rendered in the first progressive batch.' },
  { configKey: 'maxBatchSize', attribute: 'max-batch-size', converter: toInt(), default: 500, on: 'update', description: 'Maximum rows per progressive batch.' },

  // ── Virtual scroll ─────────────────────────────────────────────────────────
  { configKey: 'isVirtualScrollEnabled', attribute: 'enable-virtual-scroll', converter: toBool('tristate'), default: false, on: 'update', type: 'boolean', description: 'Enable virtual scrolling.' },
  { configKey: 'virtualScrollItemHeight', attribute: 'virtual-scroll-item-height', converter: toFloat(), on: 'update', description: 'Fixed row height (px) used by virtual scrolling.' },
  { configKey: 'virtualScrollOverscan', attribute: 'virtual-scroll-overscan', converter: toInt(), default: 5, on: 'update', description: 'Extra rows rendered above/below the viewport when virtualizing.' },
  { configKey: 'virtualScrollContainerHeight', attribute: 'virtual-scroll-container-height', converter: toCssLength(), on: 'update', type: 'string | number', description: 'Height of the virtual-scroll viewport, a CSS length (`400px`, `30rem`, `50vh`); a bare number means pixels. Unset: the measured tree height (else 400px).' },

  // ── Selection model ────────────────────────────────────────────────────────
  { configKey: 'rangeSelectionMode', attribute: 'range-selection-mode', converter: toEnum(['visual', 'logical'] as const, { default: 'visual' }), on: 'update', description: 'How Shift+click range selection walks the tree (default `visual`).' },
  { configKey: 'selectionMode', attribute: 'selection-mode', converter: toEnum(['single', 'multiple'] as const, { default: 'single' }), on: 'update', description: 'Single- (default) or multi-node selection.' },
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
  { configKey: 'checkboxMode', attribute: 'checkbox-mode', converter: toEnum(['independent', 'cascade'] as const, { default: 'independent' }), on: 'update', description: 'Checkbox interaction: `independent` (default) toggles one node; `cascade` toggles the subtree with a tristate box on branches.' },
  { configKey: 'cascadeCheckPolicy', attribute: 'cascade-check-policy', converter: toEnum(['rolled-up', 'leaves', 'all'] as const, { default: 'rolled-up' }), on: 'update', description: 'Which paths the checked set EMITS in cascade mode: `rolled-up` (minimal cover), `leaves`, or `all`. Default rolled-up.' },
  { configKey: 'shouldClickToggleCheckbox', attribute: 'click-toggle-checkbox', converter: toBool('tristate'), default: false, on: 'update', type: 'boolean', description: 'A node-row click also toggles its checkbox.' },

  // ── Complex property (nodes; too large for an attribute) ───────────────────
  // ── Tree state (applied on the built tree; reading returns the live set) ──
  { configKey: 'expandedPaths', attribute: 'expanded-paths', converter: toPathSet(), default: UNSET_PATHS, on: 'update', getLiveValue: (el) => liveReaders.state(el, 'expandedPaths'), type: 'string[]', description: 'The expanded set. Assigning (any iterable of paths) replaces it — branches not listed collapse — silently: no `expanded-change` / `tree-change` (use `expandNodes` / `collapseNodes` to announce). Attribute: a JSON array (`["1","1.2"]`) or a comma-separated list. Reading returns the live set once built. Set before the first build it replaces the `expand-level` expansion; never set, the tree keeps its own; removing the attribute (or `el.expandedPaths = undefined`) after the build collapses all.' },
  { configKey: 'selectedPaths', attribute: 'selected-paths', converter: toPathSet(), default: UNSET_PATHS, on: 'update', getLiveValue: (el) => liveReaders.state(el, 'selectedPaths'), type: 'string[]', description: 'The selected set. Assigning (any iterable of paths) replaces it silently: no `selection-change` / `checked-change` / `focus-change` (use `selectNodes` / `clearSelection` to announce). Attribute: a JSON array or a comma-separated list. Reading returns the live set once built. Never set, the data\'s `selected` flags apply; removing the attribute (or `el.selectedPaths = undefined`) after the build clears it.' },
  { configKey: 'checkedPaths', attribute: 'checked-paths', converter: toPathSet(), default: UNSET_PATHS, on: 'update', getLiveValue: (el) => liveReaders.state(el, 'checkedPaths'), type: 'string[]', description: 'The checked set (checkbox data state). Reading returns it as emitted (projected through `cascade-check-policy`) once built. Assigning (any iterable of paths) replaces it silently: no `checked-change` (use `checkNodes` / `uncheckAll` to announce). Attribute: a JSON array or a comma-separated list. Never set, the data\'s checked flags apply; removing the attribute (or `el.checkedPaths = undefined`) after the build clears it.' },

  { configKey: 'nodes', converter: toValue({ validate: (v): v is unknown[] => Array.isArray(v) }), on: 'update', getLiveValue: (el) => liveReaders.nodes(el), type: 'ReadonlyArray<Record<string, unknown>>', description: 'The node objects. Assigning replaces the tree (JS API); reading returns the current state once built — every node data object in tree order, mutations included (also `el.controller.nodes`).' },

  // ── Custom styles (element-only; injected, not passed to the engine) ───────
  { configKey: 'customStyles', attribute: 'custom-styles', converter: toText({ isNullable: true }), on: 'update', description: 'CSS injected into the shadow root (a full stylesheet; `@import url(…)` works) — the declarative alternative to `getCustomStylesCallback`, which wins when both are set. Comes after the page-wide `window.components["web-treeview"].customStyles`, so it overrides it.' },
  { configKey: 'getCustomStylesCallback', converter: cb(), on: 'update', type: '(ctx: TreeViewContext) => string | null', description: 'Returns a CSS string injected into the shadow root (`@import url(…)` works; an imported font is also linked in the document head). Wins over `customStyles`; comes after the page-wide layer, so it overrides it.' },

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
  { configKey: 'getContextMenuItemsCallback', converter: cb(), on: 'update', type: '(ctx: TreeMenuContext) => TreeMenuEntry[]', description: "The context-menu entries for the right-clicked node (`ctx.node`, `parent`, `siblings`): core action items (`{ id, text, icon, shortcut, onClick(detail) }`, `get*Callback(ctx)`, `children` / `getChildrenCallback`), `createMenuDivider(text?)`, or a built-in name ('copy' | 'cut' | 'paste' | 'delete' | 'expand' | 'collapse' | 'expand-subtree' | 'collapse-subtree' | 'expand-all' | 'collapse-all' | 'sort' | 'sort-subtree' | 'sort-all'). Every activation fires `action`." },

  // ── Callbacks: render hooks ──────────────────────────────────────────────
  { configKey: 'renderNodeCallback', converter: cb(), on: 'update', type: '(ctx: NodeRenderCallbackContext) => string | Node | null | undefined | false', description: 'Custom content of a node row (render state on the ctx). Returns string (HTML) / Node (mounted) / `null` | `undefined` (the built-in label) / `false` (hidden). Re-run only when the node or its render state changes.' },
  { configKey: 'renderIconCallback', converter: cb(), on: 'update', type: '(name: string, ctx: IconRenderContext) => string | null | undefined', description: "This tree's icon hook: maps a node's icon name (iconMember / getIconCallback) to markup. Asked after markup and the built-in names, before the page-wide `window.components.renderIconCallback`; `null` = not mine (the next rule decides), `''` = no icon. `ctx.node` + the render state." },
  { configKey: 'renderEmptyStateCallback', converter: cb(), on: 'update', type: '(ctx: ContainerRenderContext) => string | Node | null | undefined | false', description: 'Custom empty-tree state. Returns string (HTML) / Node (mounted) / `null` | `undefined` (the built-in text) / `false` (hidden).' },
  { configKey: 'renderEmptyZoneCallback', converter: cb(), on: 'update', type: '(ctx: ContainerRenderContext) => string | Node | null | undefined | false', description: 'Custom content of the empty-tree drop zone. Returns string (HTML) / Node (mounted) / `null` | `undefined` (the built-in box) / `false` (hidden).' },
  { configKey: 'renderLoadingCallback', converter: cb(), on: 'update', type: '(ctx: LoaderRenderContext) => void | (() => void)', description: 'Custom render for the loading state (the `isLoading` overlay), the core shared loader hook: fill `ctx.containerElement` (already `role="status"` + `aria-label` = the `ariaLabels.loading` label); `ctx` = `{ component, context: "overlay", containerElement, element, label }`; may return a cleanup. Beats the page-wide `window.components.renderLoadingCallback`; neither set: the default `.wtv__loader` (`--wtv-loader-*` tokens).' },
  { configKey: 'renderHeaderCallback', converter: cb(), on: 'update', type: '(ctx: ContainerRenderContext) => string | Node | null | undefined | false', description: 'Header above the tree. Returns string (HTML) / Node (mounted) / `null` | `undefined` (empty) / `false` (hidden).' },
  { configKey: 'renderFooterCallback', converter: cb(), on: 'update', type: '(ctx: ContainerRenderContext) => string | Node | null | undefined | false', description: 'Footer below the tree. Returns string (HTML) / Node (mounted) / `null` | `undefined` (empty) / `false` (hidden).' },
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
  { configKey: 'beforeScrollCallback', converter: cb(), on: 'update', type: '(ctx: TreeViewBeforeScrollContext) => void | false | Partial<TreeViewScrollOptions>', description: 'Runs before the tree scrolls a node into view on its own (keyboard move, scrollToPath, paste reveal). Return false to skip the scroll, or options to replace the defaults. Sync.' },
  { configKey: 'beforeKeydownCallback', converter: cb(), on: 'update', type: '(ctx: KeydownContext) => void | false', description: 'Runs before the built-in keyboard handling (synchronous): return `false` to suppress it for this key. Drive the tree via `ctx.controller`.' },
  { configKey: 'beforeActionCallback', converter: cb(), on: 'update', type: '(detail: TreeViewActionEventDetail) => void | false | Promise<void | false>', description: 'Runs before a context-menu item activates: `false` cancels its onClick, the `action` event and the built-in.' },
  { configKey: 'nodeOutputTransformationCallback', converter: cb(), on: 'update', type: '(ctx: NodeTransformCallbackContext) => data', description: 'OUTPUT (egress) transform — clean/redact `ctx.data` as a node leaves the source (copy/cut/copy-drop).' },
  { configKey: 'nodeInputTransformationCallback', converter: cb(), on: 'update', type: '(ctx: NodeTransformCallbackContext) => data | null', description: 'INPUT (ingress) transform — derive ids/values from `ctx.data` as a node lands (paste/copy-drop); return null to skip.' },
  // ── Context menu presentation (core /menu host inputs: menu-presentation, menu-side; on:'none') ──
  ...menuPresentationInputs(),
];

/** An element with no attributes — what the table's defaults resolve against. */
const NO_ATTRIBUTES: AttrReader = { getAttribute: () => null, hasAttribute: () => false };

/**
 * Every option's default as `<web-treeview>` seeds it (`configKey` → value; a row whose absent value is
 * `undefined` is left out — the engine's own handling, as for the element). The state sets
 * (`expandedPaths` / `selectedPaths` / `checkedPaths`) are left out too: the element applies them on the
 * built tree, never through the engine config. `TreeViewEngine` fills every missing / `undefined` option
 * from it, so a standalone engine renders exactly like the element.
 */
export const ENGINE_DEFAULTS: Readonly<Record<string, unknown>> = Object.freeze(
  Object.fromEntries(
    INPUTS.filter((def) => !(STATE_KEYS as readonly string[]).includes(def.configKey))
      .map((def) => [def.configKey, resolveFromAttribute(def, null, NO_ATTRIBUTES).value] as const)
      .filter(([, value]) => value !== undefined),
  ),
);
