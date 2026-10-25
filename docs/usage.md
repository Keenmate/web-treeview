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
  tree.data = [
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
  document.querySelector('web-treeview').data = [
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
| `expand-level` | `number` | — | Auto-expand nodes up to this depth |
| `tree-path-separator` | `string` | `'.'` | Separator character in paths |
| `tree-id` | `string` | — | Unique tree identifier (for cross-tree DnD) |
| `click-behavior` | `string` | `'expand-and-focus'` | `'select'` \| `'expand'` \| `'expand-and-focus'` |
| `accordion-expand` | `boolean` | `false` | Expanding via toggle auto-collapses siblings (config key: `isAccordionExpand`) |
| `is-sorted` | `boolean` | `false` | Hint: data is already in insert order (parents first, siblings ordered) — skips sorting; faster on big data. A child listed before its parent is dropped (see `getInsertResult().failed`) |
| `should-use-internal-search-index` | `boolean` | `false` | Build FlexSearch index for fast filter |
| `indexer-batch-size` | `number` | — | Items per requestIdleCallback batch |
| `indexer-timeout` | `number` | — | Idle-callback deadline (ms) |
| `search-text` | `string` | — | Current search/filter text |
| `theme` | `'dark' \| 'light'` | — | Per-instance theme override |
| `is-loading` | `boolean` | `false` | Show loading overlay |
| `handle-keyboard-shortcuts` | `boolean` | `true` | Opt out of built-in Ctrl/Cmd+C/X/V + Delete/Shift+Delete + Esc shortcuts (config key: `shouldHandleKeyboardShortcuts`) |
| `auto-handle-paste` | `boolean` | `true` | Apply pastes automatically; set `false` to forward cleaned entries via `PasteResult.entries` for manual insert (config key: `shouldAutoHandlePaste`) |
| `no-data-text` | `string` | `'No data'` | Fallback text shown for an empty tree (config key: `noDataText`) |
| `show-drop-placeholder-when-empty` | `boolean` | `false` | Keep the empty drop zone visible + focusable so Ctrl/Cmd+V pastes into an empty tree (config key: `shouldShowDropPlaceholderWhenEmpty`) |

**Sibling order.** On insert (`data`, `insertBranch`) the tree puts parents before their
children itself and orders each parent's children with `sortCallback` (one call per
sibling group — `items` are siblings, never the whole list), or by `order-member` then
display value when there is no callback. `addNode`, `refreshSiblings` and `moveNode`
(as a child, or before/after with `order-member`) re-sort the affected parent the same
way; a before/after move without `order-member` keeps the dropped position. Children are kept in that order — there is
no render-time sorting.

`is-sorted` is a **performance hint**, not a sort switch: "my data is already in insert
order (parents first, siblings in display order)". The tree then skips all sorting on
insert (no depth sort, no `sortCallback`; `insertBranch` appends new children after the
existing ones) and renders the data as given. Ordering is the caller's responsibility:
a child listed before its parent is dropped as an orphan and reported in
`getInsertResult().failed`.

### Drag and drop

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `drag-drop-mode` | `string` | `'none'` | `'none'` \| `'internal'` \| `'cross'` \| `'both'` |
| `drop-zone-mode` | `string` | `'glow'` | `'glow'` \| `'floating'` |
| `drop-zone-layout` | `string` | `'around'` | `'around'` \| `'before'` (row above the node) \| `'after'` (row below the node) \| `'wave'` \| `'wave2'` |
| `drop-zone-start` | `number\|string` | `33` | Child zone threshold (number = %, string = CSS value) |
| `drop-zone-max-width` | `number` | — | Max drop-zone width in px |
| `allow-copy` | `boolean` | `false` | Enable Ctrl+drag copy (config key: `isCopyAllowed`) |
| `auto-handle-copy` | `boolean` | `true` | Apply copy moves automatically (config key: `shouldAutoHandleCopy`) |

### Selection

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `selection-mode` | `string` | `'single'` | `'single'` (Ctrl/Shift+click degrade to plain click; Shift+keyboard extend is a no-op) \| `'multi'` (Ctrl+toggle, Shift+range, Shift+Arrow/Home/End/PageUp/PageDown extend) |
| `range-selection-mode` | `string` | `'visual'` | `'visual'` (visible flat nodes) \| `'logical'` (tree walk) |
| `show-checkboxes` | `boolean` | `false` | Render checkbox per selectable node (config key: `shouldShowCheckboxes`) |
| `checkbox-mode` | `string` | `'independent'` | `'independent'` (per-node) \| `'cascade'` (parent → descendants) |
| `click-toggles-checkbox` | `boolean` | `false` | Plain click toggles checkbox instead of focusing (config key: `shouldClickToggleCheckbox`) |

### Visual / CSS hooks

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `body-class` | `string` | — | Extra class on `.wtv__container` |
| `selected-node-class` | `string` | — | Extra class on each selected node-content |
| `focused-node-class` | `string` | — | Extra class on the focused node-content |
| `drag-over-node-class` | `string` | — | Extra class while a drag is over the node |
| `expand-icon-class` | `string` | `wtv__toggle-icon--expand` | Toggle icon class for expandable nodes |
| `collapse-icon-class` | `string` | `wtv__toggle-icon--collapse` | Toggle icon class for collapsible nodes |
| `leaf-icon-class` | `string` | — | Toggle icon class for leaves |
| `toggle-icon-mode` | `string` | `'rotate'` | `'rotate'` \| `'swap'` |
| `align-node-icons` | `boolean` | `true` | Reserve icon column for nodes without icons (config key: `shouldAlignNodeIcons`) |
| `scroll-highlight-class` | `string` | — | Extra class while a node is scroll-highlighted |
| `scroll-highlight-timeout` | `number` | `1500` | Scroll-highlight duration (ms) |

### Context menu

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `context-menu-x-offset` | `number` | `8` | Horizontal offset (px) for cursor clearance |
| `context-menu-y-offset` | `number` | `0` | Vertical offset (px) |

### Rendering

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `use-flat-rendering` | `boolean` | `true` | Flat DOM list with `paddingLeft` indent (config key: `isFlatRenderingEnabled`) |
| `flat-indent-size` | `string` | `'1.5rem'` | Per-level indent step in flat mode |
| `progressive-render` | `boolean` | `true` | RAF-batched rendering for large trees (config key: `isProgressiveRender`) |
| `initial-batch-size` | `number` | — | First batch size |
| `max-batch-size` | `number` | — | Subsequent batch ceiling |
| `virtual-scroll` | `boolean` | `false` | Render only visible rows (config key: `isVirtualScrollEnabled`) |
| `virtual-row-height` | `number` | auto | Row height in px (auto-measured if omitted) |
| `virtual-overscan` | `number` | `5` | Extra rows above/below viewport |
| `virtual-container-height` | `string` | `'400px'` | Viewport height |

### Debug

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `should-display-debug-information` | `boolean` | `false` | Show debug overlay |

## Properties (JS only)

Set via JavaScript, not HTML attributes.

**Every callback takes ONE context object.** Every ctx (and every event detail) also carries
`controller` — the public `TreeViewController` facade, same as `el.controller` — and `element`
(the host). Both are non-enumerable, so `JSON.stringify` / logs see only the data. Destructure what
you need: `tree.getIconCallback = ({ node }) => …`.

### Data & renderer

| Property | Type | Description |
|----------|------|-------------|
| `data` | `T[]` | Array of data objects to display |
| `renderer` | `TreeViewRenderer<T>` | Custom renderer (replaces default DomRenderer) |
| `navigationOverrides` | `TreeNavigationOverrides<T> \| null` | Replace individual keyboard-navigation methods — see [Keyboard navigation overrides](#keyboard-navigation-overrides). Reassign to swap at runtime; `null` restores the defaults |
| `controller` | `TreeViewController<T>` (read-only) | The public facade: every element method + `getNodeRef(path)`, `getFocusedNode()`, `getChildren(path)`, `getSiblings(path)`, `openContextMenu(path, x, y)`, `applyChanges(changes)`. Replaces the removed `getController()` |

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
| `sortCallback` | `({ items }) => LTreeNode[]` | Orders the children of one parent: `items` are siblings — return them in the new order. Parents-first insert order is internal; not called under `is-sorted` |
| `getCustomStylesCallback` | `(ctx) => string` | CSS injected into the shadow root (supports `@import`) |

### Render callbacks

| Property | Signature | Description |
|----------|-----------|-------------|
| `renderNodeCallback` | `({ node, contentElement, deviceClass, container, isExpanded, isChecked, isSelected, isFocused, level, hasChildren }) => void` | Custom node content rendering into `contentElement` |
| `renderIconCallback` | `({ node, value, iconElement, …renderState }) => void` | Custom per-node icon (SVG / unicode / markup) into `iconElement` |
| `renderEmptyStateCallback` | `({ containerElement }) => void` | "No items to display" rendering |
| `renderEmptyZoneCallback` | `({ containerElement }) => void` | Drop zone in an empty tree |
| `renderLoadingCallback` | `({ containerElement }) => void` | Loading-state rendering |
| `renderHeaderCallback` | `({ containerElement }) => void` | Tree header rendering |
| `renderFooterCallback` | `({ containerElement }) => void` | Tree footer rendering |
| `renderContextMenuCallback` | `({ node, path, parent, siblings, containerElement, controller }) => void` | Take over the whole context menu; close via `controller.closeContextMenu()` |
| `renderContextMenuItemCallback` | `({ node, path, parent, siblings, menuItem, buttonElement }) => void` | Fill one menu item button; leave it empty for the default |

### Context menu

| Property | Signature | Description |
|----------|-----------|-------------|
| `getContextMenuItemsCallback` | `({ node, path, parent, siblings, controller, element }) => TreeMenuEntry[]` | The menu entries for the right-clicked node (see below) |
| `beforeActionCallback` | `(detail: TreeViewActionEventDetail) => void \| false \| Promise<…>` | Runs before an item activates: `false` cancels its `onClick`, the `action` event and the built-in |

A `TreeMenuEntry` is one of:

- a **core action item** — `{ id, text, icon, shortcut, cssClass, isDanger, isDisabled, isVisible, isActive, tooltip, onClick(detail), children, getChildrenCallback(ctx), shouldCloseOnClick }`. The static fields have `get*Callback(ctx)` variants (text, icon, tooltip, class, visible, disabled, active). `onClick` receives the `action` detail. An enabled leaf closes the menu after it activates unless `shouldCloseOnClick: false`. `getChildrenCallback` loads a submenu lazily (sync or async — a loading row shows meanwhile).
- a **divider** — `{ divider: true, text? }` or `menuDivider(text?)` (exported from the package).
- a **built-in name** — `'copy' | 'cut' | 'paste' | 'delete' | 'expand' | 'collapse'` (acts on the node, or on the whole selection when the node is in it; default text, disabled and danger state).

Activation order: `beforeActionCallback` → item `onClick` → `action` event (+ `onAction`) → built-in. Menu buttons carry `data-action` (built-in name or `custom`) and `data-id`.

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
| `beforeExpandCallback` | `({ node, path, parent, siblings, controller }) => boolean \| void \| Promise<boolean \| void>` | Runs before a node expands via the toggle, the keyboard or `expandNodes()` (not `expandAll()`, expand-level seeding or accordion side-effects). `false` keeps it collapsed; a Promise defers the expand (loading state, repeat toggles ignored); resolving `false` or rejecting (warned) keeps it collapsed. See [Lazy loading](#lazy-loading) |

A throwing before-hook cancels the operation (the error is logged).

### Transforms

| Property | Signature | Description |
|----------|-----------|-------------|
| `nodeOutputTransformationCallback` | `({ data, operation, phase, isRoot, index, position, source, target }) => T` | OUTPUT (egress) transform — clean / redact `data` as a node leaves the source (copy / cut / copy-drop) |
| `nodeInputTransformationCallback` | `({ data, … }) => T \| null` | INPUT (ingress) transform — derive ids / values as a node lands (paste / copy-drop); return `null` to skip a node (skipping a root skips its subtree) |

The transform ctx is `NodeTransformContext` + `data`: `{ data, operation, phase: 'output' \| 'input', isRoot, index, position, source, target }`, where `source` and `target` are symmetric NodeRefs (`{ path, node, parent, siblings }`); `target` and `position` are `null` during the output phase. The `transform` arguments of `pasteNodes`, `duplicateNodes` and `copyNodeWithDescendants` take the same one-ctx shape.

### Event twins (`on*`)

Every event below has a camelCase `on*` property twin that receives the **detail** (not the `CustomEvent`): `onNodeClick`, `onNodeDoubleClick`, `onNodeCopy`, `onNodeCut`, `onNodePaste`, `onNodeDelete`, `onNodeDragStart`, `onNodeDragOver`, `onNodeDrop`, `onNodeDragReject`, `onNodeDropReject`, `onSelectionChange`, `onCheckedChange`, `onFocusChange`, `onTreeChange`, `onAction`, `onRenderStart`, `onRenderProgress`, `onRenderComplete`.

```javascript
tree.onNodeClick = ({ node, parent }) => console.log('clicked', node.path, 'under', parent?.path);
tree.addEventListener('node-paste', (e) => console.log('pasted', e.detail.count));
```

## Methods

All methods are available on the element **and** on `el.controller`.

| Method | Signature | Description |
|--------|-----------|-------------|
| `expandAll` | `(nodePath?, options?)` | Expand all nodes (or subtree). `{ exclusive?, noEmit? }` |
| `collapseAll` | `(nodePath?, options?)` | Collapse all nodes (or subtree). `{ noEmit? }` |
| `expandNodes` | `(nodePath \| string[], options?)` | Expand ancestors up to node(s) |
| `collapseNodes` | `(nodePath \| string[], options?)` | Collapse node(s) |
| `toggleNodeExpanded` | `(path)` | Toggle (honors `isAccordionExpand`) |
| `getExpandedPaths` / `setExpandedPaths` | `(): string[]` / `(paths[])` | Read / restore the expanded set |
| `filterNodes` | `(searchText)` | Filter tree by search text |
| `searchNodes` | `(searchText): LTreeNode[]` | Search without filtering |
| `scrollToPath` | `(path, options?): Promise<boolean>` | Scroll to (and optionally highlight) a node |
| `getNodeByPath` | `(path): LTreeNode \| null` | Look up a node |
| `getNodeRef` | `(path): NodeRef` | `{ path, node, parent, siblings }` for a path |
| `getChildren` / `getSiblings` | `(path): LTreeNode[]` | Children of a node / siblings of a node (including itself) |
| `getFocusedNode` | `(): LTreeNode \| null` | The focused node |
| `getVisibleFlatNodes` | `(): LTreeNode[]` | The visible rows in order |
| `getAllData` | `(): T[]` | Current data |
| `openContextMenu` | `(path, x, y)` | Open the context menu for a node at viewport coordinates |
| `closeContextMenu` | `()` | Close the context menu |
| `addNode` / `updateNode` / `removeNode` | `(parentPath, data, segment?)` / `(path, updates)` / `(path, includeDescendants?)` | Single-node mutations |
| `moveNode` / `moveNodes` | `(path \| paths[], targetPath, position)` | Move node(s) `'before' \| 'after' \| 'child'` |
| `duplicateNodes` | `(paths[], targetPath, position, transform?, sourceTree?)` | Copy node(s) with descendants; `transform({ data, … })` |
| `applyChanges` | `(changes: TreeChange[]): ApplyChangesResult` | Apply a batch of changes |
| `selectNode` | `(path, mode?, options?)` | Select one node. `mode`: `'replace'` (default) \| `'toggle'` \| `'range'` |
| `selectNodes` | `(paths[], options?)` | Add nodes to the selected set (**additive**) |
| `setSelectedPaths` | `(paths[], options?)` | Replace the entire selected set |
| `selectAll` | `(options?)` | Select every visible node (Ctrl+A) |
| `clearSelection` | `(paths?, options?)` | Clear the given paths, or all when omitted |
| `getSelectedNodes` | `(): LTreeNode[]` | All selected nodes |
| `getSelectedPaths` | `(): Set<string>` | All selected paths |
| `isNodeSelected` | `(path): boolean` | Check selected-set membership |
| `checkNode` | `(path, options?)` | Check one node (cascades in cascade mode) |
| `checkNodes` | `(paths[], options?)` | Check nodes (**additive**) |
| `setCheckedPaths` | `(paths[], options?)` | Replace the entire checkbox set |
| `checkAll` | `(options?)` | Check every selectable node |
| `uncheckNode` | `(path, options?)` | Uncheck one node (cascades in cascade mode) |
| `clearChecked` | `(paths?, options?)` | Uncheck the given paths, or all when omitted |
| `getCheckedNodes` | `(): LTreeNode[]` | All checked nodes |
| `getCheckedPaths` | `(): Set<string>` | All checked paths |
| `isNodeChecked` | `(path): boolean` | Check checked-set membership |
| `focusNode` | `(path, options?)` | Move focus to a node |
| `clearFocus` | `(options?)` | Clear the focused node |
| `copyNodes` | `(paths?)` | Copy selected/specified nodes to clipboard |
| `cutNodes` | `(paths?)` | Cut selected/specified nodes to clipboard |
| `pasteNodes` | `(targetPath, transform?, position?): PasteResult` | Paste clipboard at target; `transform({ data, … })`. `PasteResult.count` + `PasteResult.skipped` |
| `deleteNodes` | `(paths?)` | Delete selected/specified nodes (honors `beforeDeleteCallback`, fires `node-delete`) |
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
| `insertBranch` | `(parentPath, data[]): InsertBranchResult` | Insert a batch under `parentPath`, each item placed by its own path (whole subtrees OK). Returns `{ success, count, failed: [{ data, error }], parentNode }` — an item with a missing/empty path, a path not under `parentPath`, a duplicate path or a missing parent is skipped into `failed` (one `console.warn`) |
| `replaceBranch` | `(parentPath, data[]): ReplaceBranchResult` | Replace all descendants of a node (same rules as `insertBranch`); adds `removed` / `added` |
| `deleteBranch` | `(path, keepParent?): result` | Delete node and descendants |
| `getTree` | `(): Ltree<T>` | Access the underlying LTree |
| `update` | `(props: Partial<TreeViewConfig<T>>)` | Update multiple properties at once (element only) |

`el.getController()` (which returned the internal engine) is gone — use `el.controller`.

### Keyboard navigation overrides

Every navigation key goes through a navigation object — the built-in defaults merged with
`navigationOverrides` (`{ ...defaults, ...navigationOverrides }`, same as svelte-treeview). Replace
only the methods you need; the rest keep their default. The methods are called on the merged
object, so inside a `function` override `this` is the active navigation (`this.navTo(path)`,
`this.navNext()`). The defaults move through `navTo`, so overriding `navTo` affects every built-in
move. `el.controller.nav*()` routes through the overrides too. `beforeKeydownCallback` still runs
first and can suppress a key entirely.

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
| `Enter` / `Space` | `navToggle` | — |

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
| `selection-change` | `{ paths, nodes }` | Selected (Ctrl/Shift+click) set changed |
| `checked-change` | `{ paths, nodes }` | Checkbox/data-state checked set changed |
| `focus-change` | `{ focusedNode }` | Single-focused node changed |
| `tree-change` | context only | Tree state changed (expand, collapse, data) — fired once |
| `action` | `{ action, id, item, source: 'context-menu', node, path, parent, siblings, sourceEvent, triggerElement }` | A context-menu item was activated (after its `onClick`, before the built-in) |

Bulk `expandAll()` / `collapseAll()` (and expand-level seeding) fire **no** per-node `node-expand` / `node-collapse` — only the usual single `tree-change`. `expandNodes` / `collapseNodes` with `{ noEmit: true }` fire neither.

`silent: true` (the `TreeMutationOptions` flag on every select/check/focus mutator) suppresses both the `on*` twin AND the DOM event. The verbs are partitioned: `select*` drives the UI multi-select set, `check*` / `uncheck*` drive the checkbox/data set, `focus*` drives the single cursor.

## Lazy loading

Flag the unloaded nodes with `has-children-member` (so they get an expand toggle), then load
their children in `beforeExpandCallback`: return a Promise, `insertBranch` the children
and resolve. While it is pending the node's toggle shows a spinner
(`.wtv__toggle-icon--loading`, `--wtv-expand-spinner-*` variables), the row carries
`aria-busy="true"` + `data-loading`, and repeat toggles of that node are ignored. The hook
runs for the toggle, the keyboard (`ArrowRight` waits for the load, then moves into the first
child) and `expandNodes()`; resolve `false` (or reject — it's warned) to keep the node
collapsed.

```js
tree.hasChildrenMember = 'hasChildren';
tree.beforeExpandCallback = async ({ node, controller }) => {
  if (controller.getChildren(node.path).length > 0) return; // already loaded → expand now
  const rows = await fetch(`/api/children?path=${node.path}`).then((r) => r.json());
  controller.insertBranch(node.path, rows); // each row carries its full path
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

Disabled by default. Enable at runtime for debugging:

```javascript
import {
  enableLogging, disableLogging,
  setLogLevel, setCategoryLevel,
  enablePerfLogging, setPerfThreshold,
} from '@keenmate/web-treeview';

enableLogging();                              // global on
setCategoryLevel('TREEVIEW:DATA', 'debug');   // per-category
enablePerfLogging();
setPerfThreshold(5);                          // only log > 5ms
```

Categories: `TREEVIEW:INIT`, `TREEVIEW:DATA`, `TREEVIEW:INDEX`, `TREEVIEW:UI`, `TREEVIEW:DRAG`, `TREEVIEW:RENDER`.
