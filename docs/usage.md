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
  onNodeClick: (ctx) => console.log('Clicked:', ctx.node),
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

All attributes use kebab-case. Equivalent camelCase property setters exist on the element (JS property always wins over the HTML attribute). The single source of truth for the attribute ⇄ config wiring is `ATTRIBUTE_TABLE` in `src/web-component.ts`.

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
| `is-selected-member` | `string` | — | Property name for selected state in data |
| `is-draggable-member` | `string` | — | Property name for per-node draggable flag |
| `is-drop-allowed-member` | `string` | — | Property name for per-node drop-allowed flag |
| `is-collapsible-member` | `string` | — | Property name for per-node collapsible flag |
| `is-selectable-member` | `string` | — | Property name for per-node selectable flag |
| `search-value-member` | `string` | — | Property name for search text (defaults to display value) |
| `order-member` | `string` | — | Property name for sort order |
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
| `is-sorted` | `boolean` | `false` | Apply `sortCallback` to children on insert |
| `should-use-internal-search-index` | `boolean` | `false` | Build FlexSearch index for fast filter |
| `indexer-batch-size` | `number` | — | Items per requestIdleCallback batch |
| `indexer-timeout` | `number` | — | Idle-callback deadline (ms) |
| `search-text` | `string` | — | Current search/filter text |
| `theme` | `'dark' \| 'light'` | — | Per-instance theme override |
| `is-loading` | `boolean` | `false` | Show loading overlay |
| `should-handle-keyboard-shortcuts` | `boolean` | `true` | Opt out of built-in Ctrl/Cmd+C/X/V + Delete/Shift+Delete + Esc shortcuts (config key: `shouldHandleKeyboardShortcuts`) |
| `should-auto-handle-paste` | `boolean` | `true` | Apply pastes automatically; set `false` to forward cleaned entries via `PasteResult.entries` for manual insert (config key: `shouldAutoHandlePaste`) |
| `no-data-text` | `string` | `'No data'` | Fallback text shown for an empty tree (config key: `noDataText`) |
| `should-show-drop-placeholder-when-empty` | `boolean` | `false` | Keep the empty drop zone visible + focusable so Ctrl/Cmd+V pastes into an empty tree (config key: `shouldShowDropPlaceholderWhenEmpty`) |

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
| `selection-mode` | `string` | `'single'` | `'single'` (Ctrl/Shift+click degrade to plain click) \| `'multi'` (Ctrl+toggle, Shift+range) |
| `range-selection-mode` | `string` | `'visual'` | `'visual'` (visible flat nodes) \| `'logical'` (tree walk) |
| `show-checkboxes` | `boolean` | `false` | Render checkbox per selectable node (config key: `shouldShowCheckboxes`) |
| `checkbox-mode` | `string` | `'independent'` | `'independent'` (per-node) \| `'cascade'` (parent → descendants) |
| `click-toggles-checkbox` | `boolean` | `false` | Plain click toggles checkbox instead of focusing (config key: `shouldClickToggleCheckbox`) |

### Visual / CSS hooks

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `body-class` | `string` | — | Extra class on `.wtv__container` |
| `highlighted-node-class` | `string` | — | Extra class on each highlighted node-content |
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

| Property | Type | Description |
|----------|------|-------------|
| `data` | `T[]` | Array of data objects to display |
| `renderer` | `TreeViewRenderer<T>` | Custom renderer (replaces default DomRenderer) |
| `onNodeClick` | `(ctx: NodeRef) => void` | Click handler. `ctx = { path, node, parent, siblings }` (clicked node = `ctx.node`) |
| `onNodeDoubleClick` | `(ctx: NodeRef) => void` | Double-click handler. `ctx = { path, node, parent, siblings }` |
| `onNodeDragStart` | `(ctx: NodeDragContext) => void` | Drag start handler. `ctx` = NodeRef of the grabbed node + `{ event, dragged }` |
| `onNodeDragOver` | `(ctx: NodeDragContext) => void` | Drag over handler. `ctx` = NodeRef of the hovered node + `{ event, dragged }` |
| `onNodeDrop` | `(ctx: NodeDropContext) => void` | Drop handler. `ctx = { source, target, dragged, dropped, position, operation, event }` (source = NodeRef of the dragged lead node, target = NodeRef\|null of the drop node, dragged = full NodeRef[] set, dropped = placed NodeRef[]\|null) |
| `beforeDropCallback` | `(dropNode, draggedNode, position, event, operation) => boolean \| { position?, operation? } \| void` | Drop validation / coercion (deliberately 5-arg positional — not migrated) |
| `contextMenuCallback` | `(node, close) => ContextMenuEntry[]` | Context menu items |
| `renderContextMenuItemCallback` | `(item, node, container) => void` | Per-item custom rendering |
| `iconCallback` | `(node) => string \| null` | Dynamic icon class resolution (overrides `iconMember`) |
| `renderNodeCallback` | `(node, container) => void` | Custom node content rendering |
| `renderEmptyStateCallback` | `(container) => void` | "No items to display" rendering |
| `renderEmptyZoneCallback` | `(container) => void` | Drop zone in an empty tree |
| `renderLoadingCallback` | `(container) => void` | Loading-state rendering |
| `renderHeaderCallback` | `(container) => void` | Tree header rendering |
| `renderFooterCallback` | `(container) => void` | Tree footer rendering |
| `onSelectionChange` | `(ctx: { paths, nodes }) => void` | Selection (checkbox / data) set changed |
| `onHighlightChange` | `(ctx: { paths, nodes }) => void` | Highlight (Ctrl/Shift+click) set changed |
| `renderStartCallback` | `() => void` | First render batch starting |
| `renderProgressCallback` | `(stats) => void` | Render batch progress tick |
| `renderCompleteCallback` | `(stats) => void` | All render batches done |
| `sortCallback` | `(items) => items` | Custom sort function |
| `getDisplayValueCallback` | `(node) => string` | Dynamic display value |
| `getSearchValueCallback` | `(node) => string` | Dynamic search value |
| `getIsDraggableCallback` | `(node) => boolean` | Dynamic draggable check |
| `getIsCollapsibleCallback` | `(node) => boolean` | Dynamic collapsible check |
| `getIsSelectableCallback` | `(node) => boolean` | Dynamic selectable check |
| `getIsSelectedCallback` | `(node) => boolean` | Seed initial `isSelected` per node |
| `getIsExpandedCallback` | `(node) => boolean` | Seed initial `isExpanded` per node |
| `getIsDropAllowedCallback` | `(node) => boolean` | Dynamic drop-allowed check |
| `getAllowedDropPositionsCallback` | `(node) => DropPosition[] \| null` | Dynamic per-position constraint |
| `indexingCompleteCallback` | `() => void` | FlexSearch indexer done |
| `beforeCheckboxToggleCallback` | `(node, checked, affectedPaths) => boolean \| string[] \| void` | Intercept checkbox toggle |
| `onCopy` | `(ctx: { operation, paths, nodes }) => void` | Fires after a copy; `nodes` live |
| `onCut` | `(ctx: { operation, paths, nodes }) => void` | Fires after a cut; `nodes` still live (cut only dims until paste) |
| `onPaste` | `(result: PasteResult) => void` | Fires after a paste; `result = { success, count, skipped, error?, entries?, operation? }` |
| `onDelete` | `(ctx: { paths, nodes }) => void` | Fires after built-in Delete (or `deleteNodes()`); `nodes` are pre-removal snapshots |
| `beforeCopyCallback` | `(ctx: { operation, paths, nodes }) => string[] \| false \| void` | Rewrite the copy set (new `path[]`) or block (`false`) |
| `beforeCutCallback` | `(ctx: { operation, paths, nodes }) => string[] \| false \| void` | Rewrite the cut set or block (same shape as `beforeCopyCallback`) |
| `beforePasteCallback` | `(ctx: { operation, target: { path, node }, entries }) => { targetPath?, position? } \| false \| void` | Batch-policy interceptor: redirect target/position or block |
| `beforeDeleteCallback` | `(ctx: { paths, nodes }) => string[] \| false \| void` | Narrow (return `path[]`) or block (`false`) the built-in Delete set |
| `copyNodeTransformationCallback` | `(data, ctx: NodeTransformContext) => T` | Per-node transform at snapshot time (clean/redact fields) |
| `pasteNodeTransformationCallback` | `(data, ctx: NodeTransformContext) => T \| null` | Per-node transform at insert; return `null` to skip a node (skipping a root skips its subtree) |
| `onTreeKeydown` | `(ctx: { event, focusedNode, highlightedNodes, controller }) => boolean \| void` | Keydown interceptor; return `true` to suppress default + built-in shortcuts. Runs before built-in handling |

`NodeTransformContext` = `{ operation, phase: 'copy' \| 'paste', isRoot, index, position, source, target }`, where `source` and `target` are symmetric NodeRefs (`{ path, node, parent, siblings }`); `target` and `position` are `null` during phase `'copy'`.

## Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `expandAll` | `(nodePath?, options?)` | Expand all nodes (or subtree). `{ exclusive?, noEmit? }` |
| `collapseAll` | `(nodePath?, options?)` | Collapse all nodes (or subtree). `{ noEmit? }` |
| `expandNodes` | `(nodePath \| string[], options?)` | Expand ancestors up to node(s) |
| `collapseNodes` | `(nodePath \| string[], options?)` | Collapse node(s) |
| `toggleNodeExpanded` | `(path)` | Toggle (honors `isAccordionExpand`) |
| `filterNodes` | `(searchText)` | Filter tree by search text |
| `searchNodes` | `(searchText): LTreeNode[]` | Search without filtering |
| `scrollToPath` | `(path, options?): Promise<boolean>` | Scroll to (and optionally highlight) a node |
| `closeContextMenu` | `()` | Close the context menu |
| `highlightNode` | `(path, mode?, options?)` | Highlight one node. `mode`: `'replace'` (default) \| `'toggle'` \| `'range'` |
| `highlightNodes` | `(paths[], options?)` | Add nodes to the highlight set (**additive**) |
| `setHighlightedPaths` | `(paths[], options?)` | Replace the entire highlight set |
| `highlightAll` | `(options?)` | Highlight every visible node (Ctrl+A) |
| `clearHighlight` | `(paths?, options?)` | Clear the given paths, or all when omitted |
| `getHighlightedNodes` | `(): LTreeNode[]` | All highlighted nodes |
| `getHighlightedPaths` | `(): Set<string>` | All highlighted paths |
| `isNodeHighlighted` | `(path): boolean` | Check highlight membership |
| `selectNode` | `(path, options?)` | Check one node (cascades in cascade mode) |
| `selectNodes` | `(paths[], options?)` | Check nodes (**additive**) |
| `setSelectedPaths` | `(paths[], options?)` | Replace the entire checkbox set |
| `selectAll` | `(options?)` | Check every selectable node |
| `deselectNode` | `(path, options?)` | Uncheck one node (cascades in cascade mode) |
| `clearSelection` | `(paths?, options?)` | Uncheck the given paths, or all when omitted (was `deselectAll`) |
| `getSelectedNodes` | `(): LTreeNode[]` | All checkbox-selected nodes |
| `getSelectedPaths` | `(): Set<string>` | All checkbox-selected paths |
| `isNodeSelected` | `(path): boolean` | Check selection membership |
| `focusNode` | `(path, options?)` | Move focus to a node |
| `clearFocus` | `(options?)` | Clear the focused node |
| `copyNodes` | `(paths?)` | Copy highlighted/specified nodes to clipboard |
| `cutNodes` | `(paths?)` | Cut highlighted/specified nodes to clipboard |
| `pasteNodes` | `(targetPath, transformData?, position?): PasteResult` | Paste clipboard at target. `PasteResult.count` (formerly `pastedCount`) + `PasteResult.skipped` |
| `deleteNodes` | `(paths?)` | Delete highlighted/specified nodes (honors `beforeDeleteCallback`, fires `onDelete`) |
| `cancelCut` | `()` | Cancel pending cut |
| `navTo` | `(path)` | Focus a specific node |
| `navNext` / `navPrev` | `()` | Focus next / previous visible node |
| `navNextSibling` / `navPrevSibling` | `()` | Focus next / previous sibling at same level |
| `navInto` / `navOut` | `()` | Move into child / to parent |
| `navBackOut` | `()` | Collapse parent and focus it |
| `navToggle` | `()` | Toggle expand/collapse on current node |
| `navFirst` / `navLast` | `()` | Focus first / last visible node |
| `insertBranch` | `(parentPath, data[]): result` | Insert multiple children at once |
| `replaceBranch` | `(parentPath, data[]): result` | Replace all children of a node |
| `deleteBranch` | `(path, keepParent?): result` | Delete node and descendants |
| `getTree` | `(): Ltree<T>` | Access the underlying LTree |
| `getController` | `(): TreeController<T>` | Access the TreeController |
| `update` | `(props: Partial<TreeViewConfig<T>>)` | Update multiple properties at once |

## Events

`CustomEvent` instances dispatched from the host element.

| Event | Detail | Description |
|-------|--------|-------------|
| `node-clicked` | `{ path, node, parent, siblings }` | Node was clicked (NodeRef; `.node` = clicked node) |
| `node-double-click` | `{ path, node, parent, siblings }` | Node was double-clicked (NodeRef) |
| `node-drop` | `{ source, target, dragged, dropped, position, operation, event }` | Drop completed (NodeDropContext) |
| `copy` | `{ operation, paths, nodes }` | Nodes copied to clipboard |
| `cut` | `{ operation, paths, nodes }` | Nodes cut to clipboard |
| `highlight-change` | `{ paths, nodes }` | Highlight (Ctrl/Shift+click) set changed |
| `selection-change` | `{ paths, nodes }` | Checkbox/data-state selection changed |
| `focused-node-changed` | `{ focusedNode }` | Single-focused node changed |
| `search-text-changed` | `{ searchText }` | `searchText` config updated |
| `tree-changed` | — | Tree state changed (expand, collapse, data) |
| `data-changed` | `{ data }` | Underlying data array swapped |

`silent: true` (the `TreeMutationOptions` flag on every highlight/selection/focus mutator) suppresses both the user callback AND the DOM event. The verbs are partitioned: `highlight*` drives the UI multi-select set, `select*` drives the checkbox/data set, `focus*` drives the single cursor.

## Architecture

```
WebTreeViewElement (custom element)
  └── WebTreeView (facade)
        ├── TreeController (state, logic, DnD)
        │     └── LTree (path-based tree engine)
        └── TreeViewRenderer (pluggable rendering)
              └── DomRenderer (default, flat DOM + event delegation)
```

- **TreeController** owns all state and emits snapshots via `EventEmitter`.
- **TreeViewRenderer** subscribes to snapshots and renders the DOM.
- **LTree** is the pure data engine — usable headlessly without any DOM.
- **WebTreeViewElement** is the custom-element wrapper. Attribute parsing is table-driven (`ATTRIBUTE_TABLE` in `src/web-component.ts`).

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
