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
tree.getAllowedDropPositionsCallback = ({ node }) => {
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

`beforeDropCallback` runs before the drop is applied (it may be async). It takes one ctx — `{ target, dragged, position, operation, event, controller, element }`. Return `false` to cancel, an object to override `position` / `operation`, or a `DropGroup[]` to route the drop to several destinations:

```javascript
tree.beforeDropCallback = ({ target, dragged }) => {
  // Cancel drops of root nodes
  if (dragged.some((ref) => ref.node?.level === 0)) return false;

  // Coerce: always treat as child drop
  return { position: 'child', operation: 'move' };
};
```

### Copy operations

```html
<web-treeview drag-drop-mode="both" allow-copy></web-treeview>
```

Hold Ctrl while dragging to copy instead of move. `shouldAutoHandleCopy` (default `true`) means the tree applies the copy itself; set `false` to receive `node-drop` / `onNodeDrop` (`detail.dropped === null`) and apply your own.

## Multi-select

Out of the box with no configuration in single mode; opt into multi mode for Ctrl / Shift modifiers.

```html
<web-treeview selection-mode="multi" range-selection-mode="visual"></web-treeview>
```

```javascript
// Programmatic multi-select
tree.selectNodes(['1.1', '1.2', '1.3']);
tree.checkAll();
tree.clearSelection();

// Query
const nodes = tree.getSelectedNodes();
const paths = tree.selectedPaths; // Set<string>

// Listen for changes
tree.addEventListener('selection-change', (e) => {
  console.log('Selected:', e.detail.paths);
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
tree.beforeCheckboxToggleCallback = ({ node, isChecked, affectedPaths }) => {
  if (!confirm(`${isChecked ? 'Check' : 'Uncheck'} ${affectedPaths.length} node(s)?`)) {
    return false; // cancel
  }
  // return an array to override which paths are affected
  // return undefined / void to apply unchanged
};
```

See `examples-interaction.html` for interactive demos.

## Clipboard

```javascript
tree.copyNodes();             // Copy selected nodes
tree.cutNodes();              // Cut (dimmed via --wtv-cut-opacity)
const result = tree.pasteNodes('1.2'); // Paste at target
// result = { success, count, skipped, error?, entries?, operation? }
tree.removeNodes([...tree.selectedPaths]); // Remove nodes (no veto / node-delete — that is the Delete key)
tree.cancelCut();             // Cancel a pending cut

// Built-in keyboard shortcuts when the tree has focus:
// Ctrl/Cmd+C, Ctrl/Cmd+X, Ctrl/Cmd+V, Delete / Shift+Delete, Escape (cancel cut)
// Set handle-keyboard-shortcuts="false" (shouldHandleKeyboardShortcuts) to opt out.
//
// beforeKeydownCallback runs first and can intercept any key — return false to suppress
// both the default navigation and the built-in shortcuts for that key:
tree.beforeKeydownCallback = ({ event, focusedNode, selectedNodes, controller }) => {
  if (event.key === 'F2' && focusedNode) { startRename(focusedNode); return false; }
};
```

Cross-tree paste: the clipboard sits at the package level, so `cutNodes` on one tree and `pasteNodes` on another moves the nodes between trees.

### Clipboard events and interceptors

```javascript
// Notifications — node-copy / node-cut / node-paste / node-delete events, or their on* twins
// (the twin receives the event detail)
tree.onNodeCopy   = ({ paths, nodes }) => console.log('copied', paths, nodes); // { operation, paths, nodes }
tree.onNodeCut    = ({ paths }) => console.log('cut', paths);                  // { operation, paths, nodes }
tree.onNodePaste  = ({ count, skipped }) => console.log('pasted', count, 'skipped', skipped); // the PasteResult
tree.onNodeDelete = ({ paths }) => console.log('deleted', paths);              // { paths, nodes } (pre-removal snapshots)
tree.addEventListener('node-paste', (e) => console.log('pasted', e.detail.count));

// Interceptors — rewrite (return path[]) or block (return false)
tree.beforeCopyCallback   = ({ paths }) => paths;          // { operation, paths, nodes }
tree.beforeDeleteCallback = ({ paths }) => paths;          // { paths, nodes }
tree.beforePasteCallback  = () => ({ position: 'child' }); // { operation, target: { path, node }, entries }
```

### Paste transforms

Derive fresh ids / names as nodes land, or skip a node by returning `null` (skipping a root skips its subtree):

```javascript
import { uniqueName } from '@keenmate/web-treeview';

tree.nodeOutputTransformationCallback = ({ data }) => {
  // phase 'output' — clean/redact before the node hits the shared clipboard
  const { internalToken, ...clean } = data;
  return clean;
};

tree.nodeInputTransformationCallback = ({ data, position, target }) => {
  // phase 'input' — ctx = { data, operation, phase, isRoot, index, position, source, target }
  if (data.kind === 'archived') return null; // skip this node (and its subtree if a root)
  const landing = position === 'child' && target?.node
    ? Object.values(target.node.children)
    : (target?.siblings ?? []);
  return { ...data, id: crypto.randomUUID(), name: uniqueName(data.name, landing.map((s) => s.data?.name)) };
};

// One-off transform for a single paste — same one-ctx shape:
tree.pasteNodes('1.2', ({ data }) => ({ ...data, id: crypto.randomUUID() }));
```

`uniqueName(base, taken, suffix?)` is an exported helper that returns a collision-free name (default `${base} Copy ${n}`).

### Empty-tree paste

Set `show-drop-placeholder-when-empty` to keep the empty drop zone visible and focusable, so a Ctrl/Cmd+V pastes into an empty tree after the user hovers or clicks the zone. Customize the empty-state text with `no-data-text`.

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
tree.getIconCallback = ({ node }) => {
  if (node.hasChildren) return 'icon-folder';
  const ext = node.data.name.split('.').pop();
  return { ts: 'icon-ts', css: 'icon-css' }[ext] || 'icon-file';
};
```

`getIconCallback` takes priority over `iconMember`. Both return a CSS class list (or an emoji / symbol, rendered as text) for the node's `.wtv__node-icon`. Return `null` for no icon. Per-node color: `iconColorMember` / `getIconColorCallback({ node })`; full custom markup: `renderIconCallback({ node, value, iconElement })`.

## Render callbacks

The default renderer paints the node label from `displayValueMember`. Override the content for any slot:

```javascript
tree.renderNodeCallback = ({ node, contentElement, isExpanded, level }) => {
  contentElement.innerHTML = `
    <span class="icon">${node.hasChildren ? '📁' : '📄'}</span>
    <span class="label">${node.displayValue}</span>
    <span class="badge">${node.children?.length ?? 0}</span>
  `;
};

tree.renderEmptyStateCallback = ({ containerElement }) => {
  containerElement.innerHTML = '<p>No items to display</p>';
};

tree.renderLoadingCallback = ({ containerElement }) => {
  containerElement.innerHTML = '<div class="my-spinner"></div>';
};
```

`renderNodeCallback` also receives the render state (`deviceClass`, `container`, `isExpanded`, `isChecked`, `isSelected`, `isFocused`, `level`, `hasChildren`). Other slots (all one ctx with `containerElement`): `renderHeaderCallback`, `renderFooterCallback`, `renderEmptyZoneCallback`; plus `renderContextMenuCallback({ node, …, containerElement })` and `renderContextMenuItemCallback({ node, …, menuItem, buttonElement })`.

## Context menu

Right-click context menus are defined via `getContextMenuItemsCallback`. It receives one ctx — `{ node, path, parent, siblings, controller, element }` — and returns core action items, dividers, or built-in names:

```javascript
import { menuDivider } from '@keenmate/web-treeview';

tree.getContextMenuItemsCallback = ({ node }) => [
  { id: 'edit', text: 'Edit', icon: 'fa fa-edit', shortcut: 'E', onClick: () => editNode(node) },
  { id: 'duplicate', text: 'Duplicate', icon: 'fa fa-copy', onClick: () => duplicateNode(node) },
  'copy', 'cut', 'paste',                       // built-ins (act on the node or the selection)
  menuDivider('Danger zone'),                   // or { divider: true, text: 'Danger zone' }
  { id: 'delete', text: 'Delete', isDanger: true, shortcut: 'Delete', onClick: () => deleteNode(node) },
];
```

An enabled leaf closes the menu after it activates (no `close()` to call); set `shouldCloseOnClick: false` to keep it open. Every activation also fires the `action` event (+ `el.onAction`), and `beforeActionCallback(detail)` can cancel it by returning `false`:

```javascript
tree.addEventListener('action', (e) => {
  const { action, id, node } = e.detail;   // action: built-in name or 'custom'
  console.log(action, id, node.path);
});
tree.beforeActionCallback = ({ action }) => action === 'delete' ? confirm('Delete?') : undefined;
```

### Action item (`TreeMenuItem`)

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Identifier (reported as `detail.id`, rendered as `data-id`) |
| `text` | `string` | Display text |
| `icon` | `string` | CSS class(es) for the item icon |
| `shortcut` | `string` | Keyboard shortcut text (displayed + active while menu is open) |
| `tooltip` | `string` | Tooltip text |
| `cssClass` | `string` | CSS class(es) on the item button |
| `isDanger` | `boolean` | Danger styling |
| `isDisabled` | `boolean` | Grey out and prevent interaction |
| `isVisible` | `boolean` | Set `false` to hide the item |
| `isToggled` | `boolean` | Toggle state is on — the menu item is a `menuitemcheckbox` with `aria-checked` |
| `onClick` | `(detail) => void \| Promise<void>` | Handler; gets the `action` detail (the menu ctx + `action`, `id`, `item`, `source: 'context-menu'`) |
| `children` | `TreeMenuEntry[]` | Nested submenu items |
| `getChildrenCallback` | `(ctx) => TreeMenuEntry[] \| Promise<…>` | Lazy submenu (a loading row shows meanwhile) |
| `shouldCloseOnClick` | `boolean` | `false` keeps the menu open after activation |
| `getTextCallback`, `getIconCallback`, `getTooltipCallback`, `getClassCallback`, `getIsVisibleCallback`, `getIsDisabledCallback`, `getIsToggledCallback` | `(ctx) => …` | Dynamic variants of the static fields |

### Divider

| Field | Type | Description |
|-------|------|-------------|
| `divider` | `true` | Discriminator (required) |
| `text` | `string` | Optional label rendered as `──── text ────` |

### Built-ins

`'copy' | 'cut' | 'paste' | 'delete' | 'expand' | 'collapse'` as plain strings — default text, disabled state (paste with an empty clipboard, expand/collapse on a leaf) and danger state (delete). They act on the node, or on the whole selection when the node is in it. Buttons carry `data-action` (built-in name or `custom`) and `data-id`.

### Per-item custom rendering

`renderContextMenuItemCallback` uses a "fill or fall through" pattern — populate `buttonElement` for custom markup, or leave it empty to get the default rendering:

```javascript
tree.renderContextMenuItemCallback = ({ node, menuItem, buttonElement }) => {
  if (menuItem.id === 'profile') {
    buttonElement.innerHTML = `
      <div class="avatar">${node.data.name[0]}</div>
      <div>
        <strong>${node.data.name}</strong>
        <small>${node.data.role}</small>
      </div>
    `;
    return;
  }
  // Other items: leave buttonElement empty → default rendering
};
```

### Menu positioning

```javascript
tree.contextMenuXOffset = 10;  // Shift menu 10px right
tree.contextMenuYOffset = -30; // Shift menu 30px up
```

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
  mount(container, engine, config) { /* engine = the internal TreeEngine */ },
  updateConfig(config) { /* ... */ },
  destroy() { /* ... */ },
};

const tree = new WebTreeView(element, options, customRenderer);

// Or swap at runtime:
tree.setRenderer(customRenderer);
```

See `examples-custom-layout.html` for a complete custom renderer pattern.
