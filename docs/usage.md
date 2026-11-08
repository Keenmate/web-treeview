# Usage — `@keenmate/web-treeview`

Full reference for every attribute, property, method, and event the component exposes. See [theming.md](./theming.md) for the CSS variable surface and [examples.md](./examples.md) for end-to-end recipes.

## Installation

```bash
npm install @keenmate/web-treeview
```

## Quick start

### Declarative (HTML)

```html
<script type="module" src="./node_modules/@keenmate/web-treeview/dist/web-treeview.js"></script>

<web-treeview id="my-tree" expand-level="2"></web-treeview>

<script>
  const tree = document.getElementById('my-tree');
  tree.nodes = [
    { id: 1, path: '1',     displayValue: 'Documents' },
    { id: 2, path: '1.1',   displayValue: 'Projects' },
    { id: 3, path: '1.1.1', displayValue: 'Web App' },
    { id: 4, path: '1.1.2', displayValue: 'Mobile App' },
    { id: 5, path: '1.2',   displayValue: 'Photos' },
    { id: 6, path: '2',     displayValue: 'Downloads' },
  ];
</script>
```

### Programmatic (ES module)

```typescript
import '@keenmate/web-treeview';
import { WebTreeView } from '@keenmate/web-treeview';

const container = document.getElementById('tree-container')!;
const tree = new WebTreeView(container, {
  data: myData,
  idMember: 'id',
  pathMember: 'path',
  displayValueMember: 'name',
  expandLevel: 2,
  onNodeClick: ({ node }) => console.log('Clicked:', node),
});
```

### Custom member names

If your data uses different property names, map them via attributes:

```html
<web-treeview
  id-member="nodeId"
  path-member="treePath"
  display-value-member="label"
  expand-level="1">
</web-treeview>

<script>
  document.querySelector('web-treeview').nodes = [
    { nodeId: 1, treePath: '1',   label: 'Root' },
    { nodeId: 2, treePath: '1.1', label: 'Child' },
  ];
</script>
```

### Headless (LTree core only)

Use the tree engine directly without any DOM rendering:

```typescript
import { createLTree } from '@keenmate/web-treeview';

const tree = createLTree('id', 'path');
tree.insertArray([
  { id: 1, path: '1',   name: 'Root' },
  { id: 2, path: '1.1', name: 'Child' },
]);

console.log(tree.tree);             // Root nodes
console.log(tree.visibleFlatNodes); // Flat list of visible nodes
```

## Attributes

All attributes use kebab-case. Equivalent camelCase property setters exist on the element (JS property always wins over the HTML attribute). The single source of truth for the attribute ⇄ config wiring is the `INPUTS` table in `src/web-component.ts`.

### Data mapping

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `id-member` | `string` | `'id'` | Property name for node ID |
| `path-member` | `string` | `'path'` | Property name for hierarchical path |
| `display-value-member` | `string` | `'displayValue'` | Property name for display text |
| `parent-path-member` | `string` | — | Property name for parent path (auto-calculated if omitted) |
| `level-member` | `string` | — | Property name for depth level (auto-calculated if omitted) |
| `has-children-member` | `string` | — | Property name for has-children flag (auto-calculated if omitted) |
| `is-expanded-member` | `string` | — | Property name for expanded state in data |
| `is-checked-member` | `string` | — | Property name for checked (checkbox) state in data |
| `is-draggable-member` | `string` | — | Property name for per-node draggable flag |
| `is-drop-allowed-member` | `string` | — | Property name for per-node drop-allowed flag |
| `is-collapsible-member` | `string` | — | Property name for per-node collapsible flag |
| `is-selectable-member` | `string` | — | Property name for per-node selectable flag |
| `search-value-member` | `string` | — | Property name for search text (defaults to display value) |
| `order-member` | `string` | — | Property name for sibling order (ascending; ties by display value) |
| `allowed-drop-positions-member` | `string` | — | Property name for per-node allowed drop positions array |
| `icon-member` | `string` | — | Property name for per-node icon CSS class(es) |

### Behavior

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `expand-level` | `number` | `0` | Auto-expand nodes up to this depth (`0` = roots only) |
| `tree-path-separator` | `string` | `'.'` | Separator character in paths |
| `tree-id` | `string` | — | Unique tree identifier (for cross-tree DnD) |
| `click-behavior` | `string` | `'expand-and-focus'` | `'select'` \| `'expand'` \| `'expand-and-focus'` |
| `expand-as-accordion` | `boolean` | `false` | Expanding via toggle auto-collapses siblings (config key: `shouldExpandAsAccordion`) |
| `enable-sorting` | `boolean` | `true` | Automatic sibling sorting (config key: `isSortingEnabled`). `false` = never auto-sort: input order kept, `addNode` appends, insert / move / drop keep the exact position — see [Sorting](#sorting) |
| `sorted` | `boolean` | `false` | Hint: data is already in insert order (parents first, siblings ordered) — skips sorting the input; faster on big data. A child listed before its parent is dropped (see `insertResult.failed`) |
| `use-internal-search-index` | `boolean` | `true` | Build the FlexSearch index `filterNodes` / `searchNodes` / `search-term` query (config key: `shouldUseInternalSearchIndex`; `false` = no index, search finds nothing). Index what `search-value-member` / `getSearchValueCallback` return; `initializeIndexCallback` (JS) supplies a custom `Index` |
| `indexer-batch-size` | `number` | — | Items per requestIdleCallback batch |
| `indexer-timeout` | `number` | — | Idle-callback deadline (ms) |
| `search-term` | `string` | — | Current search/filter text |
| `theme` | `'dark' \| 'light'` | — | Per-instance theme override |
| `custom-styles` | `string` | — | CSS injected into the shadow root (a full stylesheet, `@import url(…)` works) — the declarative twin of `getCustomStylesCallback`, which wins when both are set (config key: `customStyles`). See [Custom CSS](./theming.md#custom-css-shadow-root) |
| `loading` | `boolean` | `false` | Show loading overlay |
| `handle-keyboard-shortcuts` | `boolean` | `true` | Opt out of built-in Ctrl/Cmd+C/X/V + Delete/Shift+Delete + Esc shortcuts (config key: `shouldHandleKeyboardShortcuts`) |
| `auto-handle-paste` | `boolean` | `true` | Apply pastes automatically; set `false` to forward cleaned entries via `PasteResult.entries` for manual insert (config key: `shouldAutoHandlePaste`) |
| `labels` | JSON object | — | UI strings, partial, merged per key over the English defaults: `noData` (`'No data'` — the tree has no nodes), `noResults` (`'No results found'` — the search filter left nothing), `noDisplayValue` (`'[N/A]'` — a node with no resolvable display value), `loading` (`'Loading…'` — accessible name of the `loading` spinner), `dropHere` (`'Drop here'`), `showFullLabel` (`'Show full label'` — aria-label of the `node-title-overflow="info"` button), `copy` / `cut` / `paste` / `delete` / `expand` / `collapse` / `expandSubtree` / `collapseSubtree` / `expandAll` / `collapseAll` / `sort` / `sortSubtree` / `sortAll` (built-in context-menu items). `{name}` placeholders. `''` renders nothing; a missing key is the English default. Inserted as text. Also the `labels` property; changes apply live |
| `show-empty-drop-placeholder` | `boolean` | `false` | Keep the empty drop zone visible + focusable so Ctrl/Cmd+V pastes into an empty tree (config key: `isEmptyDropPlaceholderShown`) |
| `highlight-on-page-drag` | `boolean` | `false` | Arm the tree while a node is dragged anywhere over the page (any tree): `armed` attribute + `:state(armed)` + read-only `el.isArmed`; an empty tree shows its drop zone at once (`--wtv-drop-placeholder-bg-armed` / `-border-color-armed`), the zone under the pointer keeps the engaged look. Never armed with `drag-drop-mode="none"`. Same option as web-dropzone (config key: `shouldHighlightOnPageDrag`) |

**Sibling order.** On insert (`nodes`, `addBranch`) the tree puts parents before their
children itself and orders each parent's children by one rule: `sortCallback` when set
(one call per sibling group — `items` are siblings, never the whole list), else
`order-member` (display value breaks ties), else the display value (`Intl.Collator`,
numeric-aware: "Item 2" before "Item 10"). `addNode`, `refreshSiblings`, `updateNode`
(an `order-member` change), `moveNode` / drop / paste as a child, and `insertNode` /
`insertBranch` / `moveNode` before/after **with** `order-member` re-sort the affected parent
the same way — only that parent's children (its siblings), nothing else. A before/after
insert / move without `order-member` keeps the exact position. Children are kept in that
order — there is no render-time sorting. `enable-sorting="false"` turns all of this off —
see [Sorting](#sorting).

`sorted` is a **performance hint**, not a sort switch: "my data is already in insert
order (parents first, siblings in display order)". The tree then skips sorting the
input (no depth sort, no `sortCallback`) and renders `nodes` as given. The hint covers
the input batch only: `addBranch` still re-sorts each affected parent's children
(existing + new), so a new child lands in its sibling position. Ordering is the caller's responsibility:
a child listed before its parent is dropped as an orphan and reported in
`insertResult.failed`.

### Drag and drop

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `drag-drop-mode` | `string` | `'none'` | `'none'` \| `'self'` (within this tree) \| `'cross'` (between trees) \| `'both'`; any other value is refused (warn + `input-rejected`) |
| `drop-zone-mode` | `string` | `'glow'` | `'glow'` \| `'floating'` |
| `drop-zone-layout` | `string` | `'around'` | `'around'` \| `'before'` (row above the node) \| `'after'` (row below the node) \| `'wave'` \| `'wave2'` |
| `drop-zone-start` | `number\|string` | `33` | Child zone threshold (number = %, string = CSS value) |
| `drop-zone-max-width` | `string` (CSS length) \| `number` | `120px` | Max floating drop-zone width: `120px`, `8rem`, `30%`; a number means px on both paths (`"90"` / `el.dropZoneMaxWidth = 90` → `90px`) |
| `allow-copy` | `boolean` | `false` | Enable Ctrl+drag copy (config key: `isCopyAllowed`) |
| `auto-handle-copy` | `boolean` | `true` | Apply copy moves automatically (config key: `shouldAutoHandleCopy`) |
| `auto-handle-move` | `boolean` | `true` | Apply move drops automatically (config key: `shouldAutoHandleMove`); `false` = the tree isn't mutated — `node-drop` fires and you move the nodes |

### Selection

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `selection-mode` | `string` | `'single'` | `'single'` (Ctrl/Shift+click degrade to plain click; Shift+keyboard extend is a no-op) \| `'multiple'` (Ctrl+toggle, Shift+range, Shift+Arrow/Home/End/PageUp/PageDown extend) |
| `range-selection-mode` | `string` | `'visual'` | `'visual'` (visible flat nodes) \| `'logical'` (tree walk) |
| `show-checkboxes` | `boolean` | `false` | Render checkbox per selectable node (config key: `isCheckboxesShown`) |
| `checkbox-mode` | `string` | `'independent'` | `'independent'` (per-node) \| `'cascade'` (parent → descendants) |
| `click-toggle-checkbox` | `boolean` | `false` | Plain click toggles checkbox instead of focusing (config key: `shouldClickToggleCheckbox`) |

### Visual / CSS hooks

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `body-class` | `string` | — | Extra class on `.wtv__container` |
| `selected-node-class` | `string` | — | Extra class on each selected node-content |
| `focused-node-class` | `string` | — | Extra class on the focused node-content |
| `drag-over-node-class` | `string` | — | Extra class while a drag is over the node |
| `leaf-icon-class` | `string` | — | Toggle icon class for leaves |
| `toggle-icon-mode` | `string` | `'rotate'` | `'rotate'` \| `'swap'` |
| `align-node-icons` | `boolean` | `true` | Reserve icon column for nodes without icons (config key: `shouldAlignNodeIcons`) |
| `scroll-highlight-class` | `string` | — | Extra class while a node is scroll-highlighted |
| `scroll-highlight-timeout` | `number` | `1500` | Scroll-highlight duration (ms) |
| `node-title-overflow` | `string` | `'ellipsis'` | A too-long built-in label: `'wrap'` (multi-line; rows grow — avoid with virtual scroll) \| `'ellipsis'` (single-line clip) \| `'info'` (ellipsis + a trailing info button on clipped rows; click reveals the full label in a popover, `labels.showFullLabel` is its aria-label). `renderNodeCallback` content owns its layout |

### Context menu

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `context-menu-x-offset` | `number` | `8` | Horizontal offset (px) for cursor clearance |
| `context-menu-y-offset` | `number` | `0` | Vertical offset (px) |

### Rendering

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `enable-flat-rendering` | `boolean` | `true` | Flat DOM list with `paddingLeft` indent (config key: `isFlatRenderingEnabled`) |
| `flat-indent-size` | `string \| number` (CSS length) | `var(--wtv-indent-size)` | Per-level indent step in flat mode; a bare number means px on both paths (`"20"` / `el.flatIndentSize = 20` → `20px`); `null` is refused — `undefined` or removing the attribute resets |
| `enable-progressive-render` | `boolean` | `true` | RAF-batched rendering for large trees (config key: `isProgressiveRenderEnabled`) |
| `initial-batch-size` | `number` | — | First batch size |
| `max-batch-size` | `number` | — | Subsequent batch ceiling |
| `enable-virtual-scroll` | `boolean` | `false` | Render only visible rows (config key: `isVirtualScrollEnabled`) |
| `virtual-scroll-item-height` | `number` | auto | Row height in px (auto-measured if omitted) |
| `virtual-scroll-overscan` | `number` | `5` | Extra rows above/below viewport |
| `virtual-scroll-container-height` | `string \| number` (CSS length) | measured, else `'400px'` | Viewport height: any CSS length (`30rem`, `50vh`), a bare number means px on both paths; `null` is refused — `undefined` or removing the attribute resets; the window maths uses the measured height |

## Properties (JS only)

Set via JavaScript, not HTML attributes.

**Every callback takes ONE context object.** Every ctx (and every event detail) also carries
`controller` — the public `TreeViewController` facade, same as `el.controller` — and `element`
(the host). Both are non-enumerable, so `JSON.stringify` / logs see only the data. Destructure what
you need: `tree.getIconCallback = ({ node }) => …`.

### Data & renderer

| Property | Type | Description |
|----------|------|-------------|
| `nodes` | `T[]` | Array of node objects to display - assigning replaces the tree; reading returns the current state (every node's data in tree order, mutations included) |
| `renderer` | `TreeViewRenderer<T>` | Custom renderer (replaces default DomRenderer) |
| `navigationOverrides` | `TreeNavigationOverrides<T> \| null` | Replace individual keyboard-navigation methods — see [Keyboard navigation overrides](#keyboard-navigation-overrides). Reassign to swap at runtime; `null` restores the defaults |
| `controller` | `TreeViewController<T>` (read-only) | The public facade: every element method + the state properties below (read-only there) + `getNodeRef(path)`, `getChildren(path)`, `getSiblings(path)`, `openContextMenu(path, x, y)`, `applyChanges(changes)`. Replaces the removed `getController()` |

### State (element: read / assign; `el.controller`: read-only)

| Property | Type | Description |
|----------|------|-------------|
| `expandedPaths` | `string[]` | The expanded set. Assigning replaces it (branches not listed collapse) **silently** (no `expanded-change`) — save / restore a view |
| `selectedPaths` | `string[]` | The selected (Ctrl/Shift-click) set, a snapshot. Assigning (any iterable) replaces it **silently** (no `selection-change` / `checked-change` / `focus-change`; use `selectNodes` / `clearSelection` to announce) |
| `checkedPaths` | `string[]` | The checked (checkbox) set as emitted — projected through `cascadeCheckPolicy`. Assigning replaces it **silently** (no `checked-change`; use `checkNodes` / `uncheckAll` to announce) |
| `focusedNode` | `LTreeNode \| null` | The focused node (read-only; `focusNode(path)` / `clearFocus()` move it) |
| `selectionAnchor` | `string \| null` | The Shift-range anchor (Shift+click / Shift+Arrow extend from it). Writable on the element and the controller — e.g. an alternative renderer keeping its own range selection in sync |
| `isRendering` | `boolean` | Read-only: `true` while a progressive (batched) render is in flight (`render-start` … `render-complete`) |
| `containerSize` | `{ width, height } \| null` | Read-only: the tree container's last measured size (`container-resize`); `null` before the first measure |

Assigned before the first build, `expandedPaths` / `selectedPaths` / `checkedPaths` are held and
applied right after it. For a silent replace use `clearSelection(undefined, { isSilent: true })` +
`selectNodes(paths, { isSilent: true })` (and `uncheckAll` / `checkNodes` likewise).

### Per-node callbacks — `(ctx: NodeContext) => …`, `ctx = { node, controller, element }`

| Property | Returns | Description |
|----------|---------|-------------|
| `getDisplayValueCallback` | `string` | Dynamic display value (overrides `displayValueMember`) |
| `getSearchValueCallback` | `string` | Dynamic search value |
| `getIsExpandedCallback` | `boolean` | Seed initial `isExpanded` per node |
| `getIsCheckedCallback` | `boolean` | Seed initial `isChecked` per node |
| `getIsSelectableCallback` | `boolean` | Dynamic selectable check |
| `getIsDraggableCallback` | `boolean` | Dynamic draggable check |
| `getIsDropAllowedCallback` | `boolean` | Dynamic drop-allowed check |
| `getIsCollapsibleCallback` | `boolean` | Dynamic collapsible check |
| `getAllowedDropPositionsCallback` | `DropPosition[] \| null` | Dynamic per-position constraint |
| `getIconCallback` | `string \| null` | Per-node icon value (overrides `iconMember`) — a class list or an emoji / symbol |
| `getIconColorCallback` | `string \| null` | Per-node icon color (overrides `iconColorMember`) |
| `getNodeClassCallback` | `string \| null` | Extra class(es) on the row (`.wtv__node`) |
| `getNodeContentClassCallback` | `string \| null` | Extra class(es) on `.wtv__node-content` |
| `getNodeTooltipCallback` | `string \| HTMLElement \| null` | Tooltip content (requires `show-node-tooltips`) |

| Property | Signature | Description |
|----------|-----------|-------------|
| `sortCallback` | `({ nodes }) => LTreeNode[]` | Orders the children of one parent: `nodes` are siblings — return them in the new order. Parents-first insert order is internal; not called on the input under `sorted` (the per-parent re-sorts still use it) |
| `getCustomStylesCallback` | `(ctx) => string \| null` | CSS injected into the shadow root (supports `@import`); wins over `customStyles`. See [Custom CSS](./theming.md#custom-css-shadow-root) |

### Render callbacks

| Property | Signature | Description |
|----------|-----------|-------------|
| `renderNodeCallback` | `({ node, contentElement, deviceClass, container, isExpanded, isChecked, isSelected, isFocused, level, hasChildren }) => void` | Custom node content rendering into `contentElement` |
| `renderIconCallback` | `({ node, value, iconElement, …renderState }) => void` | Custom per-node icon (SVG / unicode / markup) into `iconElement` |
| `renderEmptyStateCallback` | `({ containerElement }) => void` | "No items to display" rendering |
| `renderEmptyZoneCallback` | `({ containerElement }) => void` | Drop zone in an empty tree |
| `renderLoadingCallback` | `({ component, context, containerElement, element, label }) => void \| (() => void)` | The `isLoading` overlay (core `LoaderRenderContext`, `context: 'overlay'`); may return a cleanup. Beats the page-wide `window.components.renderLoadingCallback`; neither → the default `.wtv__loader` |
| `renderHeaderCallback` | `({ containerElement }) => void` | Tree header rendering |
| `renderFooterCallback` | `({ containerElement }) => void` | Tree footer rendering |
| `renderContextMenuCallback` | `({ node, path, parent, siblings, containerElement, entries, controller }) => void` | Take over the whole context menu (see [Custom menu renderer](#custom-menu-renderer)); close via `controller.closeContextMenu()` |
| `renderContextMenuItemCallback` | `({ node, path, parent, siblings, menuItem, buttonElement }) => void` | Fill one menu item (`buttonElement` is the item `<div role="menuitem">`); leave it empty for the default |

### Context menu

| Property | Signature | Description |
|----------|-----------|-------------|
| `getContextMenuItemsCallback` | `({ node, path, parent, siblings, controller, element }) => TreeMenuEntry[]` | The menu entries for the right-clicked node (see below) |
| `beforeActionCallback` | `(detail: TreeViewActionEventDetail) => void \| false \| Promise<…>` | Runs before an item activates: `false` cancels its `onClick`, the `action` event and the built-in |

A `TreeMenuEntry` is one of:

- a **core action item** — `{ id, text, icon, shortcut, cssClass, isDanger, isDisabled, isVisible, isToggled, tooltip, onClick(detail), children, getChildrenCallback(ctx), shouldCloseOnClick }`. The static fields have `get*Callback(ctx)` variants (text, icon, tooltip, class, visible, disabled, toggled). `onClick` receives the `action` detail. An enabled leaf closes the menu after it activates unless `shouldCloseOnClick: false`. `getChildrenCallback` loads a submenu lazily (sync or async — a loading row shows meanwhile).
- a **divider** — `{ divider: true, text? }` or `createMenuDivider(text?)` (exported from the package).
- a **built-in name** — `'copy' | 'cut' | 'paste' | 'delete' | 'expand' | 'collapse' | 'expand-subtree' | 'collapse-subtree' | 'expand-all' | 'collapse-all' | 'sort' | 'sort-subtree' | 'sort-all'` (acts on the node, or on the whole selection when the node is in it; default text, disabled and danger state). `expand` / `collapse` = one level; `expand-subtree` / `collapse-subtree` = the targets and all their descendants; `expand-all` / `collapse-all` = the whole tree. `sort` = the targets' children (one level, `sortNodes`); `sort-subtree` = at every depth (`sortAll(targets)`); `sort-all` = the whole tree (`sortAll(null)`). There is no default menu — list the built-ins you want.

Activation order: `beforeActionCallback` → item `onClick` → built-in → `action` event (+ `onAction`). The event is a notification after the fact — a listener sees the tree as the built-in left it (after `collapse` the node is collapsed, after `delete` it is gone); to prevent a built-in use `beforeActionCallback`. A throwing built-in is logged and the event still fires. Menu items carry `data-action` (built-in name or `custom`) and `data-id`.

An item's `icon` string is inserted as **HTML** (an `<i class="…">`, an inline `<svg>`, or plain text/emoji) — the same as action buttons.

The menu is web-components-core's shared `openMenu()` (`/menu`). It is rendered inside the tree's shadow root and closes on an outside click, a scroll that moves the tree (the tree body, a scroller around it or the page; never a scroll inside the menu, an unrelated scroller or a bare mouse wheel — core rc20), window blur, Escape / Tab, or when another KeenMate overlay opens (outside interactions are ignored while debug mode pins the menu).

#### Custom menu renderer

`renderContextMenuCallback(ctx)` takes over the whole menu (the built-in markup is not rendered). It uses the same pieces as the built-in menu, so built-in texts / state and the activation order stay identical:

| API | Description |
|-----|-------------|
| `ctx.entries` | The resolved top level of `getContextMenuItemsCallback(ctx)`: built-in names → items with their texts / `isDisabled` / `isDanger`, `get*Callback`s evaluated, hidden items dropped, dividers collapsed. `{ kind: 'item', item, resolved, hasChildren } \| { kind: 'divider', text? }` (`ResolvedMenuEntry`). `[]` without `getContextMenuItemsCallback`. |
| `getMenuChildren(item, ctx)` | A submenu's entries (`getChildrenCallback(ctx)`, may be async, wins over `children`) — exported from the package; resolve them with core's `resolveMenuEntries` (`@keenmate/web-components-core/actions`). |
| `controller.activateMenuItem(item, ctx, trigger?, event?)` (also `el.activateMenuItem`) | Runs the item exactly like the built-in menu: `beforeActionCallback` (`false` cancels — no `onClick`, built-in or `action` event) → `onClick(detail)` → built-in action → `action` event. `trigger` gets `aria-busy` while it runs. Resolves `false` when cancelled. A custom renderer cannot bypass the veto. Closing the menu is yours (respect `item.shouldCloseOnClick !== false`). |

```js
tree.renderContextMenuCallback = (ctx) => {
  const { containerElement, entries, controller } = ctx;
  for (const entry of entries) {
    if (entry.kind === 'divider') { containerElement.append(document.createElement('hr')); continue; }
    const button = document.createElement('button');
    button.textContent = entry.resolved.text;
    button.disabled = !!entry.resolved.isDisabled;
    button.onclick = async (e) => {
      await controller.activateMenuItem(entry.item, ctx, button, e);
      if (entry.item.shouldCloseOnClick !== false) controller.closeContextMenu();
    };
    containerElement.append(button);
  }
};
```

#### Keyboard (WAI-ARIA menu)

| Key | Effect |
|-----|--------|
| `Shift+F10` / `ContextMenu` | On a focused node: open its menu below the row, first item focused |
| `ArrowDown` / `ArrowUp` | Next / previous item (wraps; skips disabled items and dividers) |
| `Home` / `End` | First / last item |
| `ArrowRight` / `Enter` / `Space` on a submenu item | Open the submenu on its first item |
| `ArrowLeft` / `Escape` in a submenu | Close it, back to its parent item |
| `Enter` / `Space` | Run the item (a leaf closes the menu first) |
| an item's `shortcut` (letter, case-insensitive, or a key name like `F2`) | Run that item |
| `Escape` / `Tab` | Close and return focus to the tree |

While the menu is open it is keyboard-modal (handled keys don't reach the tree). A mouse-opened menu is keyboard-operable too (focus stays put until you press a key; hover focuses items).

#### Styling

Classes (core `/menu`): `.km-menu` (`role="menu"`), `.km-menu--submenu`,
`.km-menu__item` (`<div role="menuitem">`; a toggle item is `menuitemcheckbox` + `aria-checked`) with `--disabled` / `--danger` / `--toggled` /
`--has-submenu`, `.km-menu__icon` / `__label` / `__shortcut`, `.km-menu__divider`
(`--named`), `.km-menu__loading`. They replace the old `.wtv__context-menu*` classes
(see CHANGELOG for the mapping).

Theme the menu with the `--wtv-context-menu-*` variables (this tree only) or with core's
`--km-menu-*` on `:root` (every KeenMate menu on the page). Precedence: `--wtv-context-menu-*`
→ `--km-menu-*` → `--base-*` → core default. The tree maps each `--wtv-context-menu-*` onto
core's private `--_km-menu-*` with no fallback, so an unset one falls through:

```css
:root { --km-menu-bg: #fffbe6; }                    /* every menu on the page */
web-treeview.files { --wtv-context-menu-bg: #eef; } /* just this tree's menu */
```

| `--wtv-context-menu-*` | → `--km-menu-*` |
|---|---|
| `bg` / `bg-hover` / `hover-color` / `text-color` | `bg` / `hover-bg` / `hover-color` / `text-color` |
| `border` / `border-radius` / `shadow` | `border` / `border-radius` / `shadow` |
| `min-width` / `padding` / `font-size` | `min-width` / `padding` / `font-size` |
| `item-padding` / `item-gap` | `item-padding` / `item-gap` |
| `toggled-color` | `toggled-color` |
| `icon-width` / `icon-font-size` | `icon-size` / `icon-font-size` |
| `arrow-font-size` | `arrow-font-size` |
| `shortcut-color` | `shortcut-color` |
| `danger-color` / `danger-bg-hover` | `danger-color` / `danger-hover-bg` |
| `divider-color` / `divider-margin` | `divider-color` / `divider-margin` |
| `disabled-opacity` | `disabled-opacity` |

`--km-menu-z-index` follows `--wtv-z-index-dropdown`.

### Before-hooks (interceptors)

| Property | Signature | Description |
|----------|-----------|-------------|
| `beforeCheckboxToggleCallback` | `({ node, isChecked, affectedPaths }) => string[] \| false \| void` | Intercept a checkbox toggle: `false` cancels, `string[]` overrides the affected paths |
| `beforeCopyCallback` | `({ operation, paths, nodes }) => string[] \| false \| void` | Rewrite the copy set (new `path[]`) or block (`false`) |
| `beforeCutCallback` | `({ operation, paths, nodes }) => string[] \| false \| void` | Rewrite the cut set or block (same shape as `beforeCopyCallback`) |
| `beforePasteCallback` | `({ operation, target: { path, node }, entries }) => { targetPath?, position? } \| false \| void` | Batch-policy interceptor: redirect target/position or block (no `node-paste` event) |
| `beforeDeleteCallback` | `({ paths, nodes }) => string[] \| false \| void` | Narrow (return `path[]`) or block (`false`) the built-in Delete set |
| `beforeDragStartCallback` | `({ lead, dragged, … }) => string[] \| false \| void` | Prune / augment / veto the dragged set at drag start |
| `beforeDropCallback` | `(ctx: BeforeDropContext) => false \| { position?, operation? } \| DropGroup[] \| void \| Promise<…>` | Drop validation / redirect / fan-out (async OK) |
| `beforeKeydownCallback` | `({ event, focusedNode, selectedNodes, controller }) => void \| false` | Runs before built-in keyboard handling; return `false` to suppress default navigation + shortcuts for this key |
| `beforeScrollCallback` | `({ node, path, source, container, options, controller }) => void \| false \| Partial<TreeViewScrollOptions>` | Runs before the tree scrolls a node into view on its own — see [Scrolling](#scrolling). `false` skips the scroll; options replace the defaults. Synchronous; no matching event |
| `beforeExpandCallback` | `({ node, path, parent, siblings, controller }) => boolean \| void \| Promise<boolean \| void>` | Runs before a node expands via the toggle, the keyboard or `expandNodes()` (not `expandAll()`, expand-level seeding or accordion side-effects). `false` keeps it collapsed; a Promise defers the expand (loading state, repeat toggles ignored); resolving `false` or rejecting (warned) keeps it collapsed. See [Lazy loading](#lazy-loading) |

A throwing before-hook cancels the operation (the error is logged).

### Transforms

| Property | Signature | Description |
|----------|-----------|-------------|
| `nodeOutputTransformationCallback` | `({ data, operation, phase, isRoot, rootIndex, position, source, target }) => T` | OUTPUT (egress) transform — clean / redact `data` as a node leaves the source (copy / cut / copy-drop) |
| `nodeInputTransformationCallback` | `({ data, … }) => T \| null` | INPUT (ingress) transform — derive ids / values as a node lands (paste / copy-drop); return `null` to skip a node (skipping a root skips its subtree) |

The transform ctx is `NodeTransformContext` + `data`: `{ data, operation, phase: 'output' \| 'input', isRoot, rootIndex, position, source, target }`, where `source` and `target` are symmetric NodeRefs (`{ path, node, parent, siblings }`); `target` and `position` are `null` during the output phase. The `transform` arguments of `pasteNodes`, `duplicateNodes` and `copyNodeWithDescendants` take the same one-ctx shape.

### Event twins (`on*`)

Every event below has a camelCase `on*` property twin that receives the **detail** (not the `CustomEvent`): `onNodeClick`, `onNodeDoubleClick`, `onNodeCopy`, `onNodeCut`, `onNodePaste`, `onNodeDelete`, `onNodeDragStart`, `onNodeDragOver`, `onNodeDrop`, `onNodeDragReject`, `onNodeDropReject`, `onSelectionChange`, `onCheckedChange`, `onFocusChange`, `onExpandedChange`, `onNodesReorder`, `onTreeChange`, `onAction`, `onRenderStart`, `onRenderProgress`, `onRenderComplete`, `onContainerResize`, `onNodeExpand`, `onNodeCollapse`.

```javascript
tree.onNodeClick = ({ node, parent }) => console.log('clicked', node.path, 'under', parent?.path);
tree.addEventListener('node-paste', (e) => console.log('pasted', e.detail.count));
```

## Methods

All methods are available on the element **and** on `el.controller`.

| Method | Signature | Description |
|--------|-----------|-------------|
| `expandNodes` | `(paths: string \| string[], options?)` | Expand the node(s) one level (collapsed ancestors are opened) |
| `collapseNodes` | `(paths: string \| string[], options?)` | Collapse the node(s) |
| `toggleNodeExpanded` | `(path, options?)` | Toggle as the user would (honors `shouldExpandAsAccordion`; `isExclusive` replaces the accordion) |
| `expandAll` | `(paths?: string \| string[] \| null, options?)` | `null` / omitted = the whole tree; paths = those nodes + all their descendants |
| `collapseAll` | `(paths?: string \| string[] \| null, options?)` | `null` / omitted = the whole tree; paths = those nodes + all their descendants |
| `sortNodes` | `(paths: string \| string[], options?)` | Sort the children of each node, one level (`''` = the roots) — see [Sorting](#sorting) |
| `sortAll` | `(paths?: string \| string[] \| null, options?)` | Sort whole subtrees (the nodes' children at every depth); `null` / omitted = the whole tree |
| `filterNodes` | `(term, searchOptions?)` | Filter the tree by a search term (hide non-matching); `searchOptions` go to FlexSearch (e.g. `{ limit }`) |
| `searchNodes` | `(term, searchOptions?): LTreeNode[]` | Find matching nodes without filtering |
| `scrollToPath` | `(path, options?): Promise<boolean>` | Scroll a node into view — `ScrollToPathOptions` below; `false` when the node / its row isn't found |
| `refreshNode` | `(path)` | Re-render a node whose data object you changed in place |
| `refreshSiblings` | `(parentPath)` | Re-sort one parent's children (`''` = the roots) by the tree's rule, e.g. after changing `order-member` values in place |
| `isNodeDropAllowed` | `(path): boolean` | Whether the node accepts drops (`getIsDropAllowedCallback` → `is-drop-allowed-member`); `false` for an unknown path |
| `getNodeByPath` | `(path): LTreeNode \| null` | Look up a node |
| `getNodeRef` | `(path): NodeRef` | `{ path, node, parent, siblings }` for a path |
| `getChildren` / `getSiblings` | `(path): LTreeNode[]` | Children of a node / siblings of a node (including itself) |
| `getVisibleFlatNodes` | `(): LTreeNode[]` | The visible rows in order |
| `controller.nodes` | `T[]` | Same as `el.nodes`: the current state (every node's data in tree order, mutations included) |
| `openContextMenu` | `(path, x, y)` | Open the context menu for a node at viewport coordinates |
| `closeContextMenu` | `()` | Close the context menu |
| `activateMenuItem` | `(item, ctx, trigger?, event?) => Promise<boolean>` | Run a menu item like the built-in menu (`beforeActionCallback` veto → `onClick` → built-in → `action`) — for a [custom menu renderer](#custom-menu-renderer) |
| `addNode` / `updateNode` / `removeNode` | `(parentPath, data, segment?)` / `(path, updates)` / `(path, includeDescendants?)` | Single-node mutations |
| `insertNode` | `(targetPath, data, position)` | Insert one node `'before' \| 'after'` the target (as its sibling) or as its `'child'`; positioned like `moveNode` (with `orderMember`: an order value between the neighbours) |
| `moveNode` / `moveNodes` | `(path \| paths[], targetPath, position)` | Move node(s) `'before' \| 'after' \| 'child'` |
| `duplicateNodes` | `(paths[], targetPath, position, transform?, sourceTree?)` | Copy node(s) with descendants; `transform({ data, … })` |
| `applyChanges` | `(changes: TreeChange[]): ApplyChangesResult` | Apply a batch: `{ operation: 'add', parentPath, data, pathSegment? }`, `{ operation: 'insert', targetPath, position, data }`, `{ operation: 'update', path, data }`, `{ operation: 'remove', path }` |
| `selectNode` | `(path, mode?, options?)` | Select one node. `mode`: `'replace'` (default) \| `'toggle'` \| `'range'` |
| `selectNodes` | `(paths[], options?)` | Add nodes to the selected set (**additive**) |
| `selectAll` | `(options?)` | Select every visible node (Ctrl+A) |
| `clearSelection` | `(paths?, options?)` | Clear the given paths, or all when omitted |
| `getSelectedNodes` | `(): LTreeNode[]` | All selected nodes |
| `isNodeSelected` | `(path): boolean` | Check selected-set membership |
| `toggleFocusedSelect` | `()` | Toggle the focused node in / out of the selection (Ctrl+click semantics; `selection-mode="multiple"` only) |
| `checkNode` | `(path, options?)` | Check one node (cascades in cascade mode) |
| `checkNodes` | `(paths[], options?)` | Check nodes (**additive**) |
| `checkAll` | `(options?)` | Check every selectable node |
| `uncheckNode` | `(path, options?)` | Uncheck one node (cascades in cascade mode) |
| `uncheckNodes` | `(paths[], options?)` | Uncheck nodes (cascades in cascade mode) |
| `uncheckAll` | `(options?)` | Uncheck every node |
| `getCheckedNodes` | `(): LTreeNode[]` | All checked nodes |
| `isNodeChecked` | `(path): boolean` | Check checked-set membership |
| `focusNode` | `(path, options?)` | Move focus to a node |
| `clearFocus` | `(options?)` | Clear the focused node |
| `copyNodes` | `(paths?)` | Copy selected/specified nodes to clipboard |
| `cutNodes` | `(paths?)` | Cut selected/specified nodes to clipboard |
| `pasteNodes` | `(targetPath, transform?, position?): PasteResult` | Paste clipboard at target; `transform({ data, … })`. `PasteResult.count` + `PasteResult.skipped` |
| `removeNodes` | `(paths[]): { removed, failed }` | Remove nodes (+ descendants) programmatically — no `beforeDeleteCallback`, no `node-delete` (those belong to the user Delete command: Delete key / context-menu `delete`) |
| `cancelCut` | `()` | Cancel pending cut |
| `hasClipboardContent` / `getClipboardOperation` | `(): boolean` / `(): 'copy' \| 'cut' \| null` | Clipboard state |
| `navTo` | `(path)` | Focus a specific node |
| `navNext` / `navPrev` | `()` | Focus next / previous visible node |
| `navNextSibling` / `navPrevSibling` | `()` | Focus next / previous sibling at same level |
| `navInto` / `navOut` | `()` | Move into child / to parent |
| `navBackOut` | `()` | Collapse parent and focus it |
| `navToggle` | `()` | Toggle expand/collapse on current node |
| `navFirst` / `navLast` | `()` | Focus first / last visible node |
| `navPageDown` / `navPageUp` | `()` | Focus the node ~10 visible rows down / up (clamped) |
| `navSelectNext` / `navSelectPrev` | `()` | Extend the selected range to the next / previous sibling (multi mode; no-op in single) |
| `navSelectFirst` / `navSelectLast` | `()` | Extend the selected range to the first / last visible node (multi mode) |
| `navSelectPageDown` / `navSelectPageUp` | `()` | Extend the selected range ~10 visible rows down / up (multi mode) |
| `addBranch` | `(parentPath, data[]): InsertBranchResult` | Add a batch under `parentPath`, each item placed by its own path (whole subtrees OK). Returns `{ success, count, failed: [{ data, error }], parentNode }` — an item with a missing/empty path, a path not under `parentPath`, a duplicate path or a missing parent is skipped into `failed` (one `console.warn`) |
| `insertBranch` | `(targetPath, data[], position): InsertBranchResult` | Insert a batch before / after `targetPath` (items' paths under the target's parent) or under it (`'child'` = `addBranch(targetPath, …)`). The block's top-level nodes keep their order from `data`; with `orderMember` they get order values spread between the target and its neighbour |
| `replaceBranch` | `(parentPath, data[]): ReplaceBranchResult` | Replace all descendants of a node (same rules as `addBranch`); adds `removed` / `added` |
| `removeBranch` | `(path, keepParent?): RemoveBranchResult` | Remove a node and its descendants (or only the descendants with `keepParent`); `{ success, count, error? }` |
| `getTree` | `(): Ltree<T>` | Access the underlying LTree |
| `setAttributes` | `(props: Partial<TreeViewConfig<T>>): InputRejection[]` | Core (element only): write many inputs (by config key or attribute name) as one validated batch — one engine update; returns the refused values (each also fires `input-rejected`). Replaces the old public `el.update(props)` (2.0.0-rc07) |
| `release` / `whenReady` | `()` / `(): Promise<void>` | Core lifecycle (element only): build a `defer`-held tree now / await the first build |
| `destroy` | `()` | Core final teardown (element only): releases the tree engine, renderer and clipboard registration; `isDestroyed` turns `true` |

`ExpandOptions`: `{ isExclusive?: boolean; isSilent?: boolean }` — `isExclusive` (expand) collapses every expanded node off the targets' ancestor chains; `isSilent` changes the state without `node-expand` / `node-collapse` / `expanded-change`.

`SortOptions`: `{ compareCallback?: ({ a, b }) => number; direction?: 'asc' | 'desc'; isSilent?: boolean }` — see [Sorting](#sorting).

`ScrollToPathOptions`: `{ shouldExpandAncestors?: boolean = true; shouldHighlight?: boolean = false; behavior?; block?; inline?; shouldRevealContainer?: boolean = true }` — `behavior` / `block` / `inline` as in `ScrollIntoViewOptions` (defaults `--wtv-scroll-behavior` — `smooth`, `auto` under reduced motion — / `'center'` / `'nearest'`; keyboard moves always scroll instantly, never with the token). `shouldRevealContainer` first scrolls the page to the tree's scroll container when it isn't fully visible. `shouldHighlight` flashes `scroll-highlight-class` for `scroll-highlight-timeout` ms. See [Scrolling](#scrolling).

### Scrolling

The tree scrolls a node into view on its own in three places. Each moves **only the row's scroll
container** — the tree's own (virtual scroll) or the nearest scrollable wrapper around the element —
never the page (core `scrollIntoContainer`). A tree with no scroll container scrolls the page with the
same `block`, so a `center` jump centres the row in the window.

| `source` | When | Defaults (`options`) |
|---|---|---|
| `'keyboard'` | Arrow keys, PageUp / PageDown, Home / End, Shift range moves (`navTo`) | `block: 'nearest'`, `inline: 'nearest'`, `behavior: 'auto'` (keys never animate), `shouldRevealContainer: false` |
| `'scroll-to-path'` | `scrollToPath(path, options)` | the call's `block` (`'center'`) / `inline` (`'nearest'`) / `behavior` (the `--wtv-scroll-behavior` token) / `shouldRevealContainer` (`true`) |
| `'paste'` | The reveal after a paste into a node (`position: 'child'`) | `block: 'nearest'`, `inline: 'nearest'`, the token behavior, `shouldRevealContainer: false` |

`beforeScrollCallback(ctx)` runs first, once per scroll. `ctx` = `{ node, path, source, container,
options, controller, element }` — `container` is the scroll container found around the row (`null` =
only the page scrolls; in virtual scroll the tree's own `.wtv__tree`), `options` is what the tree is
about to use (`TreeViewScrollOptions = { block, inline, behavior, shouldRevealContainer }`). Return:

- `false` — skip the scroll (`scrollToPath` still resolves `true`: the node was found; the highlight
  still flashes when the row is rendered);
- a partial `TreeViewScrollOptions` — merged over the defaults (e.g. `{ block: 'start' }`);
- nothing — the defaults.

```js
tree.beforeScrollCallback = ({ source }) => {
  if (source === 'keyboard' && isEditing) return false;   // keep the list still
  if (source === 'scroll-to-path') return { block: 'start' };
};
```

A throwing callback skips the scroll (logged). Virtual scroll runs the callback before its own
index-based scroll. There is no scroll event. Demo: `examples-search.html` SF04.

`el.getController()` (which returned the internal engine) is gone — use `el.controller`.

**Motion level (core).** `motion="auto | none | snappy | smooth"` (attribute / property; core
declares it on every KeenMate element), the page-wide `window.components.motion`, or a
`data-motion` attribute on any ancestor (`<html>`, a section) sets the tree's speeds: core maps the
level onto `--base-duration-*` / `--base-scroll-behavior`, which every `--wtv-transition-*` and
`--wtv-scroll-behavior` reads. `none` = no transitions + instant `scrollToPath` (the drop-zone icon
stops bobbing too — its loop follows `--wtv-transition-slow`); `snappy` / `smooth` = faster / slower presets; `auto` (default) follows the
closest `data-motion` (a section, then the page) and the OS. The OS reduced-motion setting always wins, even over `motion="smooth"`.
Keyboard moves scroll instantly at every level. The loader keeps its own speed.

**Ready / defer (core).** Add the `defer` attribute to hold the first build (set data and
callbacks first), then call `el.release()` (or remove `defer`). After the first build the host
gets the `ready` attribute and `:state(ready)` and fires `ready` (`onReady`); `el.whenReady()`
resolves then. Until `ready` the host is `visibility: hidden` (FOUC guard).

### Keyboard navigation overrides

Every navigation key goes through a navigation object — the built-in defaults merged with
`navigationOverrides` (`{ ...defaults, ...navigationOverrides }`, same as svelte-treeview). Replace
only the methods you need; the rest keep their default. The methods are called on the merged
object, so inside a `function` override `this` is the active navigation (`this.navTo(path)`,
`this.navNext()`). The defaults move through `navTo`, so overriding `navTo` affects every built-in
move. `el.controller.nav*()` routes through the overrides too. `beforeKeydownCallback` still runs
first and can suppress a key entirely.

Every keyboard move scrolls the newly focused node into view with `block: 'nearest'` — nothing
moves while the row is already visible; otherwise the nearest scroll container (and the page, if
needed) scrolls just enough to show it. This covers all `nav*` / `navSelect*` moves, PageUp/PageDown,
Home/End and `navInto` after a lazy load. With virtual scroll the scroll offset moves to the row
first, so it gets rendered. Mouse clicks don't scroll. The scroll lives in the default `navTo` (and
in the Shift-extend moves) — an overridden `navTo` decides for itself (call
`el.controller.scrollToPath(path, …)` if you want a scroll).

```js
// ArrowDown / ArrowUp walk every visible row (into children) instead of jumping between siblings.
tree.navigationOverrides = {
  navNextSibling() { this.navNext(); },
  navPrevSibling() { this.navPrev(); },
};
tree.navigationOverrides = null; // back to the defaults
```

| Key | Method | Shift variant (multi mode) |
|-----|--------|----------------------------|
| `ArrowDown` / `ArrowUp` | `navNextSibling` / `navPrevSibling` | `navSelectNext` / `navSelectPrev` |
| `Home` / `End` | `navFirst` / `navLast` | `navSelectFirst` / `navSelectLast` |
| `PageDown` / `PageUp` | `navPageDown` / `navPageUp` | `navSelectPageDown` / `navSelectPageUp` |
| `ArrowRight` / `ArrowLeft` / `Backspace` | `navInto` / `navOut` / `navBackOut` | — |
| `Enter` | `navToggle` (the node's default action: expand / collapse) | — |
| `Space` | toggle selection: the focused node's checkbox when checkboxes are shown; else `toggleFocusedSelect` (multiple mode) / `selectNode` (single mode) | — |

## Events

`CustomEvent` instances dispatched from the host element. They bubble and are **not** composed. Every detail carries the non-enumerable `controller` / `element`; every event has an `on*` twin (see above) that receives the detail.

| Event | Detail | Description |
|-------|--------|-------------|
| `node-click` | `{ path, node, parent, siblings }` | Node was clicked (a checkbox toggle is not a click — see `checked-change`) |
| `node-double-click` | `{ path, node, parent, siblings }` | Node was double-clicked |
| `node-expand` | `{ path, node, parent, siblings }` | A node expanded — toggle, keyboard, `expandNodes()` (each collapsed ancestor it revealed too), after any `beforeExpandCallback` load. NOT for `expandAll()` / expand-level seeding |
| `node-collapse` | `{ path, node, parent, siblings }` | A node collapsed — toggle, keyboard, `collapseNodes()`, an accordion sibling. NOT for `collapseAll()` |
| `node-copy` | `{ operation, paths, nodes }` | Nodes copied to clipboard |
| `node-cut` | `{ operation, paths, nodes }` | Nodes cut to clipboard (`nodes` still live — cut only dims until paste) |
| `node-paste` | `PasteResult` = `{ success, count, skipped, error?, entries?, operation? }` | A paste ran (not fired when `beforePasteCallback` blocked it) |
| `node-delete` | `{ paths, nodes }` | Nodes deleted (`nodes` are pre-removal snapshots) |
| `node-drag-start` | `{ path, node, parent, siblings, event, dragged }` | A drag started |
| `node-drag-over` | `{ path, node, parent, siblings, event, dragged }` | A node is dragged over |
| `node-drop` | `{ source, target, dragged, dropped, position, operation, event }` | Drop completed |
| `node-drag-reject` | `{ path, node, parent, siblings }` | An undraggable / locked node drag was attempted |
| `node-drop-reject` | `{ path, node, parent, siblings }` | A drop was rejected by the target |
| `selection-change` | `{ paths, nodes }` | Selected (Ctrl/Shift+click) set changed (`paths`: `string[]`) |
| `checked-change` | `{ paths, nodes }` | Checkbox/data-state checked set changed (`paths`: `string[]`) |
| `focus-change` | `{ focusedNode }` | Single-focused node changed |
| `expanded-change` | `{ paths }` | The expanded set changed — the whole new set (= `expandedPaths`); one event per change, including `expandAll()` / `collapseAll()` / data changes. Synchronous right after an expand / collapse (after its `node-expand` / `node-collapse`); on the next microtask after a data change. Not for `{ isSilent: true }` nor for assigning `expandedPaths` |
| `nodes-reorder` | `{ parentPath, nodes, changes: [{ path, oldOrder, newOrder }] }` | A sort with `compareCallback` or `direction: 'desc'` rewrote one parent's `order-member` values (one event per parent; `nodes` = all its children in the new order, `changes` = only those whose value changed). Never without `order-member`; not with `isSilent` |
| `tree-change` | context only | The data / structure changed: add / insert / update / move / remove, `applyChanges`, add / insert / replace / `removeBranch`, paste, drop, duplicate, sort — one event per change (a multi-node drop fires once), on the microtask after it. **Not** for expand / select / check / focus, nor for loading `nodes`; read the new data from `controller.nodes` |
| `action` | `{ action, id, item, source: 'context-menu', node, path, parent, siblings, sourceEvent, triggerElement }` | A context-menu item was activated (after its `onClick`, before the built-in) |
| `render-start` | context only | A progressive (batched) render began — `isRendering` is `true` |
| `render-progress` | `{ pending, processed }` | A render batch finished (`pending` rows still queued) |
| `render-complete` | `{ pending, processed }` | The progressive render finished — `isRendering` is `false` |
| `container-resize` | `{ size: { width, height }, deviceClass }` | The tree container was resized (also once when observing starts); `size` = `containerSize` |
| `input-rejected` | `{ configKey, attribute?, value, reason?, kept, source }` | Core (every KeenMate component): an attribute / property write was refused (invalid value, unknown `setAttributes()` key). Synchronous — it has fired when the write returns; the element warns and keeps `kept`. `setAttributes()` also returns the list |

Bulk `expandAll()` / `collapseAll()` (and expand-level seeding) fire **no** per-node `node-expand` / `node-collapse` — only one `expanded-change` (the set). `expandNodes` / `collapseNodes` / `expandAll` / `collapseAll` with `{ isSilent: true }` fire none of them.

Assigning `expandedPaths` / `selectedPaths` / `checkedPaths` (element, before or after the first build) is a silent state restore — no event; the methods (`expandNodes`, `selectNodes`, `checkNodes`, …) and user interaction announce. `isSilent: true` (the `TreeMutationOptions` flag on every select/check/focus mutator) suppresses both the `on*` twin AND the DOM event. The verbs are partitioned: `select*` drives the UI multi-select set, `check*` / `uncheck*` drive the checkbox/data set, `focus*` drives the single cursor.

## Sorting

Siblings are sorted automatically (see **Sibling order** under [Behavior](#behavior)) by the
tree's rule: `sortCallback` → `order-member` → display value (`Intl.Collator`, numeric).

**Turning it off — `enable-sorting="false"` / `isSortingEnabled = false`.** The tree never
auto-sorts: `nodes` keep the input order (parents must still come before their children),
`addNode` / `addBranch` append, `insertNode` / `insertBranch` / `moveNode` / drop / paste keep
the exact before/after position. With `order-member` the order values are still computed
between the neighbours (so the position can be persisted). Switching it back on re-sorts the
whole tree once.

**An exact before/after position needs `order-member` OR `enable-sorting="false"`** — without
either, the next automatic sort of that parent puts the node back in display-value order.
Sorting only ever touches the children of the affected parent (its siblings).

**Sorting on demand** (works with automatic sorting off too):

```javascript
tree.sortNodes('1');                 // the children of node 1 (one level); '' = the roots
tree.sortAll('1');                   // node 1's whole subtree
tree.sortAll();                      // the whole tree
tree.sortAll(null, { direction: 'desc' });
tree.sortNodes('', { compareCallback: ({ a, b }) => a.data.size - b.data.size });
```

`SortOptions`: `compareCallback({ a, b })` — an ascending comparator (negative = `a` first;
default = the tree's rule); `direction: 'desc'` reverses whichever rule applies; `isSilent`
suppresses `nodes-reorder` only (the tree always re-renders).

**With `order-member`**, a `compareCallback` or `direction: 'desc'` sort rewrites the order
values of the sorted children (10, 20, 30…) so the new order survives the next automatic
sort, and fires `nodes-reorder` once per parent whose values changed —
`{ parentPath, nodes, changes: [{ path, oldOrder, newOrder }] }` — persist `changes` from it.
A sort by the tree's own rule changes no values and fires nothing.

The context-menu built-ins `sort`, `sort-subtree` and `sort-all` call these (labels `sort`,
`sortSubtree`, `sortAll`).

## Lazy loading

Flag the unloaded nodes with `has-children-member` (so they get an expand toggle), then load
their children in `beforeExpandCallback`: return a Promise, `addBranch` the children
and resolve. While it is pending the node's toggle shows the loader
(`.wtv__toggle-icon--loading`, the shared loader shape — `--wtv-loader-*`, sized by `--wtv-loader-inline-size`), the row carries
`aria-busy="true"` + `data-loading`, and repeat toggles of that node are ignored. The hook
runs for the toggle, the keyboard (`ArrowRight` waits for the load, then moves into the first
child) and `expandNodes()`; resolve `false` (or reject — it's warned) to keep the node
collapsed.

```js
tree.hasChildrenMember = 'hasChildren';
tree.beforeExpandCallback = async ({ node, controller }) => {
  if (controller.getChildren(node.path).length > 0) return; // already loaded → expand now
  const rows = await fetch(`/api/children?path=${node.path}`).then((r) => r.json());
  controller.addBranch(node.path, rows); // each row carries its full path
};
tree.addEventListener('node-expand', (e) => console.log('expanded', e.detail.path));
```

## Architecture

```
WebTreeViewElement (custom element, BlissElement)
  └── WebTreeView (facade; adapts one-ctx callbacks, builds el.controller)
        ├── TreeEngine (internal: state, logic, DnD)
        │     └── LTree (path-based tree engine)
        └── TreeViewRenderer (pluggable rendering)
              └── DomRenderer (default, flat DOM + event delegation)
```

- **TreeEngine** owns all state and emits snapshots via `EventEmitter`. It is internal (exported only for renderer authors); app code drives the tree through `el.controller`.
- **TreeViewRenderer** subscribes to snapshots and renders the DOM.
- **LTree** is the pure data engine — usable headlessly without any DOM.
- **WebTreeViewElement** is the custom-element wrapper. Inputs and events are table-driven (`INPUTS` / `EVENTS` in `src/web-component.ts`).

## Logging

Quiet by default: every category starts at `warn` (web-components-core's default), so
only real problems (invalid input, failed inserts, a throwing callback) reach the
console. Lines carry the instance: `[TREEVIEW:DATA] #my-tree 2 of 40 items failed to insert`.
`window.components.logging` switches every KeenMate component on the page at once;
`window.components['web-treeview'].logging` just this one. A level persisted in
`localStorage` (`km-log:TREEVIEW:*`) wins over the default. Enable at runtime for debugging:

```javascript
import {
  enableLogging, disableLogging, resetLogging,
  setLogLevel, setCategoryLevel,
  enablePerfLogging, setPerfThreshold,
} from '@keenmate/web-treeview';

enableLogging();                              // global on
setCategoryLevel('TREEVIEW:DATA', 'debug');   // per-category (null clears it)
resetLogging();                               // drop the tree's own levels
enablePerfLogging();
setPerfThreshold(5);                          // only log > 5ms
```

Levels coalesce, closest first: one element (`el.enableLogging(level?)`, `el.disableLogging()` = silence
this element, `el.resetLogging()` = follow its type / the page again) → the type
(`window.components['web-treeview'].logging`, per category) → the page (`window.components.logging`) → `warn`.
A page call does not overwrite a level set on the type. Instance `debug` / `trace` lines print through
`console.log` (Chrome hides `console.debug` by default).

Categories: `TREEVIEW:INIT`, `TREEVIEW:DATA`, `TREEVIEW:INDEX`, `TREEVIEW:UI`, `TREEVIEW:DRAG`, `TREEVIEW:RENDER`.
