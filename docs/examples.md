# Examples / cookbook — `@keenmate/web-treeview`

End-to-end recipes for the most common features. See [usage.md](./usage.md) for the full attribute / property / method reference and [theming.md](./theming.md) for the CSS variable surface. Interactive demos live in the repo's `examples-*.html` files.

## Drag and drop

Enable drag-and-drop with the `drag-drop-mode` attribute:

```html
<!-- Internal reordering + cross-tree drops -->
<web-treeview drag-drop-mode="both"></web-treeview>

<!-- Cross-tree only (no internal reordering) -->
<web-treeview drag-drop-mode="cross" tree-id="source"></web-treeview>
<web-treeview drag-drop-mode="cross" tree-id="target"></web-treeview>
```

### Restricted drop positions

Control which drop positions (`before`, `after`, `child`) are valid per node:

```javascript
tree.data = [
  // Trash: only accept drops as children
  { id: 1, path: '1', name: 'Trash', allowedDropPositions: ['child'] },

  // Regular folder: all positions (default)
  { id: 2, path: '2', name: 'Projects' },

  // Files: can't drop INTO them
  { id: 3, path: '3', name: 'Readme.md', allowedDropPositions: ['before', 'after'] },
];

tree.allowedDropPositionsMember = 'allowedDropPositions';
```

For dynamic logic use `getAllowedDropPositionsCallback`:

```javascript
tree.getAllowedDropPositionsCallback = (node) => {
  if (node.data.isReadOnly) return [];
  if (node.data.kind === 'file') return ['before', 'after'];
  return null; // null = all positions allowed
};
```

### Drop-zone start

`dropZoneStart` controls where the "child" zone begins (percentage of the node width). Applies to both glow and floating modes:

```javascript
tree.dropZoneStart = '50%';  // Child zone starts at 50% (default: 33%)
```

### Drop validation / coercion

`beforeDropCallback` runs before the drop is applied. Return `false` to cancel, or an object to override `position` / `operation`. Unlike the migrated `on*` events, it deliberately keeps its 5-arg positional signature `(dropNode, draggedNode, position, event, operation)`:

```javascript
tree.beforeDropCallback = (dropNode, draggedNode, position, event, operation) => {
  // Cancel drops onto root nodes
  if (draggedNode.level === 0) return false;

  // Coerce: always treat as child drop
  return { position: 'child', operation: 'move' };
};
```

### Copy operations

```html
<web-treeview drag-drop-mode="both" allow-copy></web-treeview>
```

Hold Ctrl while dragging to copy instead of move. `shouldAutoHandleCopy` (default `true`) means the tree applies the copy itself; set `false` to receive `onNodeDrop` (`ctx.dropped === null`) and apply your own.

## Multi-select

Out of the box with no configuration in single mode; opt into multi mode for Ctrl / Shift modifiers.

```html
<web-treeview selection-mode="multi" range-selection-mode="visual"></web-treeview>
```

```javascript
// Programmatic multi-select
tree.highlightNodes(['1.1', '1.2', '1.3']);
tree.selectAll();
tree.clearHighlight();

// Query
const nodes = tree.getHighlightedNodes();
const paths = tree.getHighlightedPaths(); // Set<string>

// Listen for changes
tree.addEventListener('highlight-change', (e) => {
  console.log('Highlighted:', e.detail.paths);
});
```

### Range modes

- `range-selection-mode="visual"` (default): range uses the visible flat nodes.
- `range-selection-mode="logical"`: range walks the full tree structure even when nodes are collapsed.

### Checkboxes

```html
<web-treeview show-checkboxes checkbox-mode="cascade"></web-treeview>
```

- `checkbox-mode="independent"` (default) — checkbox state is per-node.
- `checkbox-mode="cascade"` — toggling a parent cascades to every descendant; partial selection shows an indeterminate state on the parent.
- `click-toggles-checkbox` — plain click toggles the checkbox instead of focusing.

Intercept a toggle (e.g. to require confirmation):

```javascript
tree.beforeCheckboxToggleCallback = (node, checked, affectedPaths) => {
  if (!confirm(`${checked ? 'Check' : 'Uncheck'} ${affectedPaths.length} node(s)?`)) {
    return false; // cancel
  }
  // return an array to override which paths are affected
  // return undefined / void to apply unchanged
};
```

See `examples-interaction.html` for interactive demos.

## Clipboard

```javascript
tree.copyNodes();             // Copy highlighted nodes
tree.cutNodes();              // Cut (dimmed via --wtv-cut-opacity)
const result = tree.pasteNodes('1.2'); // Paste at target
// result = { success, count, skipped, error?, entries?, operation? }
tree.deleteNodes();           // Delete highlighted (or specified) nodes
tree.cancelCut();             // Cancel a pending cut

// Built-in keyboard shortcuts when the tree has focus:
// Ctrl/Cmd+C, Ctrl/Cmd+X, Ctrl/Cmd+V, Delete / Shift+Delete, Escape (cancel cut)
// Set should-handle-keyboard-shortcuts="false" (shouldHandleKeyboardShortcuts) to opt out.
//
// onTreeKeydown runs first and can intercept any key — return true to suppress
// both the default navigation and the built-in shortcuts:
// tree.onTreeKeydown = (ctx) => { /* ctx = { event, focusedNode, highlightedNodes, controller } */ };
```

Cross-tree paste: the clipboard sits at the package level, so `cutNodes` on one tree and `pasteNodes` on another moves the nodes between trees.

### Clipboard events and interceptors

```javascript
// Fire-and-forget notifications (each gets one context object)
tree.onCopy   = (ctx) => console.log('copied', ctx.paths, ctx.nodes);   // { operation, paths, nodes }
tree.onCut    = (ctx) => console.log('cut', ctx.paths);                 // { operation, paths, nodes }
tree.onPaste  = (result) => console.log('pasted', result.count, 'skipped', result.skipped);
tree.onDelete = (ctx) => console.log('deleted', ctx.paths);            // { paths, nodes } (pre-removal snapshots)

// Interceptors — rewrite (return path[]) or block (return false)
tree.beforeCopyCallback   = (ctx) => ctx.paths;          // { operation, paths, nodes }
tree.beforeDeleteCallback = (ctx) => ctx.paths;          // { paths, nodes }
tree.beforePasteCallback  = (ctx) => ({ position: 'child' }); // { operation, target: { path, node }, entries }
```

### Paste transforms

Derive fresh ids / names as nodes land, or skip a node by returning `null` (skipping a root skips its subtree):

```javascript
import { uniqueName } from '@keenmate/web-treeview';

tree.copyNodeTransformationCallback = (data, ctx) => {
  // phase 'copy' — clean/redact before the node hits the shared clipboard
  const { internalToken, ...clean } = data;
  return clean;
};

tree.pasteNodeTransformationCallback = (data, ctx) => {
  // phase 'paste' — ctx = { operation, phase, isRoot, index, position, source, target }
  if (data.kind === 'archived') return null; // skip this node (and its subtree if a root)
  const landing = ctx.position === 'child' && ctx.target?.node
    ? Object.values(ctx.target.node.children)
    : (ctx.target?.siblings ?? []);
  return { ...data, id: crypto.randomUUID(), name: uniqueName(data.name, landing.map((s) => s.data?.name)) };
};
```

`uniqueName(base, taken, suffix?)` is an exported helper that returns a collision-free name (default `${base} Copy ${n}`).

### Empty-tree paste

Set `should-show-drop-placeholder-when-empty` to keep the empty drop zone visible and focusable, so a Ctrl/Cmd+V pastes into an empty tree after the user hovers or clicks the zone. Customize the empty-state text with `no-data-text`.

## Per-node icons

The toggle/icon column is unified (`--wtv-column-width`, default 24px) and shared by toggle arrows, leaf icons, and per-node icons. The indent step equals `--wtv-column-width` too, so labels at every depth align vertically.

### Via data field

```html
<web-treeview icon-member="icon"></web-treeview>

<script>
  tree.data = [
    { id: 1, path: '1',   displayValue: 'Documents', icon: 'icon-folder' },
    { id: 2, path: '1.1', displayValue: 'report.pdf', icon: 'icon-file-pdf' },
  ];
</script>
```

### Via callback

```javascript
tree.iconCallback = (node) => {
  if (node.hasChildren) return 'icon-folder';
  const ext = node.data.name.split('.').pop();
  return { ts: 'icon-ts', css: 'icon-css' }[ext] || 'icon-file';
};
```

`iconCallback` takes priority over `iconMember`. Both return CSS class name(s) applied to the toggle column element. Return `null` to fall back to `leafIconClass`.

## Render callbacks

The default renderer paints the node label from `displayValueMember`. Override the content for any slot:

```javascript
tree.renderNodeCallback = (node, container) => {
  container.innerHTML = `
    <span class="icon">${node.hasChildren ? '📁' : '📄'}</span>
    <span class="label">${node.displayValue}</span>
    <span class="badge">${node.children?.length ?? 0}</span>
  `;
};

tree.renderEmptyStateCallback = (container) => {
  container.innerHTML = '<p>No items to display</p>';
};

tree.renderLoadingCallback = (container) => {
  container.innerHTML = '<div class="my-spinner"></div>';
};
```

Other slots: `renderHeaderCallback`, `renderFooterCallback`, `renderEmptyZoneCallback`, `renderContextMenuCallback`, `renderContextMenuItemCallback`.

## Context menu

Right-click context menus are defined via `contextMenuCallback`:

```javascript
tree.contextMenuCallback = (node, closeMenu) => [
  { label: 'Edit', icon: 'fa fa-edit', shortcut: 'E', onclick: () => editNode(node) },
  { label: 'Duplicate', icon: 'fa fa-copy', onclick: () => duplicateNode(node) },
  { divider: true, label: 'Danger zone' },
  { label: 'Delete', className: 'danger', shortcut: 'Delete', onclick: () => deleteNode(node) },
];
```

### `ContextMenuItem`

| Field | Type | Description |
|-------|------|-------------|
| `label` | `string` | Display text (required) |
| `id` | `string` | Optional identifier |
| `icon` | `string` | CSS class(es) for the item icon |
| `shortcut` | `string` | Keyboard shortcut text (displayed + active while menu is open) |
| `isDisabled` | `boolean` | Grey out and prevent interaction |
| `isVisible` | `boolean` | Set `false` to hide the item |
| `className` | `string` | CSS class(es) on the item button (e.g. `'danger'`) |
| `onclick` | `() => void \| Promise<void>` | Action handler |
| `children` | `ContextMenuEntry[]` | Nested submenu items |

### `ContextMenuDivider`

| Field | Type | Description |
|-------|------|-------------|
| `divider` | `true` | Discriminator (required) |
| `label` | `string` | Optional label rendered as `──── label ────` |

### Per-item custom rendering

`renderContextMenuItemCallback` uses a "fill or fall through" pattern — populate the container for custom markup, or leave it empty to get the default rendering:

```javascript
tree.renderContextMenuItemCallback = (item, node, container) => {
  if (item.id === 'profile') {
    container.innerHTML = `
      <div class="avatar">${node.data.name[0]}</div>
      <div>
        <strong>${node.data.name}</strong>
        <small>${node.data.role}</small>
      </div>
    `;
    return;
  }
  // Other items: leave container empty → default rendering
};
```

### Menu positioning

```javascript
tree.contextMenuXOffset = 10;  // Shift menu 10px right
tree.contextMenuYOffset = -30; // Shift menu 30px up
```

Set `shouldDisplayContextMenuInDebugMode = true` to render the menu at a fixed offset from the tree (useful while developing context-menu CSS without right-clicking every time).

## Rendering modes

| Mode | Config | DOM Nodes | Best For |
|------|--------|-----------|----------|
| Flat (default) | `use-flat-rendering="true"` | All | Most trees (up to ~10k nodes) |
| Virtual | `virtual-scroll="true"` | ~50 | Large trees (10k+) |

```html
<!-- Virtual scroll for large trees -->
<web-treeview virtual-scroll virtual-container-height="500px"></web-treeview>

<!-- Flat mode (default) with progressive batching -->
<web-treeview progressive-render="true" initial-batch-size="200" max-batch-size="800"></web-treeview>
```

## Pluggable renderers

The default `DomRenderer` handles flat DOM rendering with event delegation. Replace it with a framework-specific renderer:

```typescript
import { WebTreeView } from '@keenmate/web-treeview';
import type { TreeViewRenderer } from '@keenmate/web-treeview';

const customRenderer: TreeViewRenderer<MyData> = {
  mount(container, controller, config) { /* ... */ },
  updateConfig(config) { /* ... */ },
  destroy() { /* ... */ },
};

const tree = new WebTreeView(element, options, customRenderer);

// Or swap at runtime:
tree.setRenderer(customRenderer);
```

See `examples-custom-layout.html` for a complete custom renderer pattern.
