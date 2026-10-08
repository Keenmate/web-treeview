# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This project is a **web-component-first** treeview (`<web-treeview>`) built with vanilla TypeScript. No framework dependencies. Consistent with sibling projects `web-multiselect` and `web-daterangepicker`.

## Development Commands

### Build & Development
```bash
npm run dev          # Start development server on port 21111
npm run build        # Clean dist + Vite build
npm run preview      # Preview production build
npm run package      # Build + npm pack
npm run clean        # Remove dist and tarballs
npm run clean:dist   # Remove dist only
```

### Makefile
```bash
make help            # Show all available targets
make setup           # npm install
make dev             # Start dev server
make build           # Production build
make package         # Build + pack
make publish-dry     # Dry-run publish
```

## Architecture

### File Structure
```
src/
├── index.ts              # Entry point, global API, exports
├── web-component.ts      # WebTreeViewElement (extends HTMLElement)
├── treeview.ts           # WebTreeView facade (controller + renderer)
├── types.ts              # All TypeScript interfaces
├── clipboard.ts          # Module-level clipboard singleton (cross-tree copy/cut/paste)
├── navigation.ts         # TreeNavigation<T> interface definitions
├── vite-env.d.ts         # Vite environment types
├── controller/
│   ├── types.ts          # Controller config, snapshot, SelectionModifiers
│   ├── tree-controller.ts# TreeController (state, multi-select, clipboard, nav, DnD)
│   └── event-emitter.ts  # Typed EventEmitter base class
├── ltree/
│   ├── types.ts          # Ltree interface, bulk ops, context menu types
│   ├── ltree.ts          # createLTree factory (core tree engine)
│   ├── wtv-node.ts     # LTreeNode class
│   ├── flex.ts           # FlexSearch integration
│   └── indexer.ts        # Async search indexing
├── renderer/
│   ├── types.ts          # TreeViewRenderer interface
│   ├── dom-renderer.ts   # DomRenderer (flat DOM, event delegation, keyboard)
│   └── render-coordinator.ts # Progressive rendering coordinator
└── css/
    ├── main.css          # Entry point + @layer declaration
    ├── variables.css     # CSS custom properties with --base fallbacks + light-dark()
    ├── base.css          # :host shell, FOUC guard
    ├── tree.css          # Component styles (nodes, DnD, context menu, cut state)
    └── dark-mode.css     # Conditional color-scheme flips (Strategy B)
```

### Three-Layer Architecture
1. **`WebTreeViewElement<T>`** (`web-component.ts`) — Custom element wrapper. Extends `HTMLElement`, uses Shadow DOM, proxies attributes/properties to the engine, dispatches `CustomEvent`s.
2. **`WebTreeView<T>`** (`treeview.ts`) — Thin facade wrapping TreeController + TreeViewRenderer. Can be used standalone without the web component.
3. **`TreeController<T>`** (`controller/tree-controller.ts`) — All state & logic: multi-select, clipboard, navigation, drag-and-drop, context menu, progressive rendering. Uses `LTree` for tree data.
4. **`DomRenderer<T>`** (`renderer/dom-renderer.ts`) — Default renderer with flat DOM, event delegation, keyed reconciliation, keyboard handling.

### Data Flow
- **Attributes** (kebab-case HTML) → `attributeChangedCallback` → engine config
- **Properties** (camelCase JS) → setters → engine `update()`
- **Engine → Events**: Tree interactions dispatch `CustomEvent`s on the host element

### CSS Custom Properties
All CSS variables use the `--wtv-` prefix and fall back to `--base-*` variables from the design system:
```css
--wtv-accent-color: var(--base-accent-color, #3b82f6);
--wtv-text-color: var(--base-text-color-1, #1e293b);
--wtv-indent-size: calc(var(--wtv-rem) * 2);
```

### Build Output
- **ES Module**: `dist/web-treeview.js`
- **UMD**: `dist/web-treeview.umd.js`
- **Types**: `dist/index.d.ts`
- **Styles**: `dist/style.css`

### Build-Time Constants
Defined in `vite.config.ts` from `package.json`:
- `__VERSION__`, `__PACKAGE_NAME__`, `__AUTHOR__`, `__LICENSE__`, `__REPOSITORY__`, `__HOMEPAGE__`

### Global API
```js
window.components['web-treeview'].version()
window.components['web-treeview'].config
window.components['web-treeview'].register()
window.components['web-treeview'].getInstances()
```

## Key Technical Considerations

### Tree Data Model
- Uses LTree-style hierarchical paths: `"1"`, `"1.1"`, `"1.1.2"`
- `TreeNode<T>` wraps user data with tree metadata (path, level, expanded, selected, etc.)
- `TreeViewConfig<T>` specifies member mappings (`idMember`, `pathMember`, etc.) to map arbitrary data shapes

### SSR Safety
Web component uses the `BaseElement` pattern for SSR compatibility:
```ts
const BaseElement = (typeof HTMLElement !== 'undefined' ? HTMLElement : class {}) as typeof HTMLElement;
```

### Instance Tracking
All mounted `<web-treeview>` elements are tracked in a `Set` and exposed via `getAllInstances()`.

## Dependencies

- **Runtime**: `@floating-ui/dom` (context menu positioning); `@keenmate/web-components-core` (`/positioning` → `createTooltip` for node tooltips; shared with web-multiselect)
- **Dev**: Vite, TypeScript, vite-plugin-dts, rimraf

## Node tooltips (hover/focus)

`show-node-tooltips` + `getNodeTooltipCallback(node) => string | HTMLElement | null` (text or rich element — the analog of svelte-treeview's `tooltip` snippet). Each row's tooltip is created via the shared **`createTooltip`** core primitive (same one web-multiselect uses), portaled into the shadow container, Floating-UI positioned. The renderer (`dom-renderer.ts`) keeps a per-row `tooltips: Map<key, TooltipHandle>` — created in `_createNodeElement`, refreshed in `_updateNodeElement` (so content tracks `_rev`), destroyed on row removal / `_renderEmpty` / `_fullRender` / `destroy`. Options: `tooltip-placement` (`top-start`), `tooltip-delay` (`{show:400,hide:100}`), `tooltip-offset` (`8`), `tooltip-follow-cursor`. Surface `.wtv__tooltip` / `--visible` uses the shared `--base-tooltip-*` tokens → identical to svelte-treeview's `.stv__tooltip` + ms's option tooltip under one theme. Size: `--wtv-tooltip-*` (auto/shrink by default capped by `-max-width`; set `-width` for a fixed box + `-max-width:none`, or `-min-width` for a floor). Demo `examples-tooltips.html`; e2e `test/tooltip.html` + `e2e/tooltip.spec.ts`.

## Render context (device + node state)

The render callbacks receive a `NodeRenderContext` as their LAST arg — `renderNodeCallback(node, el, ctx)`, `renderIconCallback(node, value, el, ctx)`. ctx = { deviceClass: 'mobile'|'tablet'|'desktop', container: {width,height}, isExpanded, isSelected, isHighlighted, isFocused, level, hasChildren }. device/container come from `@keenmate/web-components-core/environment` (`classifyDevice` + `observeEnvironment`/`observeElementSize`, set up in the renderer's `mount`, torn down in `destroy`); a device-class FLIP forces `_fullRender`, container size updates silently (virtual-scroll-first). Built by `_buildRenderContext(node, snapshot)`; node-state from node + snapshot. Back-compat (extra arg ignored). Parity with svelte-treeview's NodeRenderContext. Requires core ≥ rc10. e2e `test/render-context.html` + `e2e/render-context.spec.ts`.

## Per-node icons (every node)

`iconMember` / `iconCallback` resolve a per-node icon VALUE; it renders as a dedicated `.wtv__node-icon` element on EVERY node (branch + leaf) between the toggle/checkbox and the label — NOT folded into the leaf toggle slot anymore (so branches get icons and the toggle keeps its chevron). Default render is `<i class="wtv__node-icon {value}">` (FontAwesome-friendly); override with `renderIconCallback(node, value, iconEl)` for SVG/unicode/markup. COLOR via `iconColorMember` / `iconColorCallback` (inline) or `--wtv-node-icon-color` (default currentColor). `shouldAlignNodeIcons` reserves the column (`--wtv-node-icon-width`). Renderer: `_applyNodeIcon(row, node)` (called from `_createNodeElement` + `_updateNodeElement`); `renderIconCallback` lives on RendererConfig (like renderNodeCallback) and a post-data assignment triggers `_fullRender`. Parity with svelte-treeview's `iconMember`/`getIconCallback`/`iconColorMember`/`getIconColorCallback` + `icon` snippet. e2e `test/node-icons.html` + `e2e/node-icons.spec.ts`. NOTE: FontAwesome classes resolve inside the shadow root only if FA's CSS is injected via `customStylesCallback`.

## Comparison with sibling package `@keenmate/svelte-treeview`

The two packages render the same logical tree but have different DOM strategies. Useful when porting features or debugging visual differences.

| | svelte-treeview | web-treeview |
|---|---|---|
| **Rendering modes** | Recursive (default) + flat | Flat only |
| **Children DOM** | `.stv__children` wrapper holds real descendants in recursive mode | None — siblings under `.wtv__tree` |
| **Indent math** | `margin-left: level × indent` (flat) or compounded per nesting level (recursive) | `padding-left: (level − 1) × indent` — root at zero offset |
| **Virtual scroll** | Flat mode only | Built-in (three-div spacer/translateY structure) |
| **Label markup** | `<span class="stv__node-label">` by default — replace via `nodeTemplate` snippet | `<span class="wtv__node-label">` by default — replace via `renderNodeCallback` |
| **Checkbox** | Single styled `<input class="stv__checkbox">` (appearance:none, ::after mask glyph, `--indeterminate` modifier class) | Single styled `<input class="wtv__checkbox">` — same canonical KeenMate contract; indeterminate via `.wtv__checkbox--indeterminate` + `aria-checked="mixed"` (survives the diff reconciler + virtual scroll), NOT the native `.indeterminate` prop |
| **`draggable` attr** | On `.stv__node-content` (inner) | On `.wtv__node` (outer) |
| **Extra dataset attrs** | `data-tree-path` only | `data-tree-path` + `data-rev` + `data-expanded` (used by the diff-based reconciler) |
| **Update mechanism** | Svelte 5 runes + per-node `_rev` keyed `{#each}` | Imperative reconciler comparing `data-rev` / `data-expanded` and patching DOM |
| **Highlight padding** | Symmetric (~8px both sides via `--stv-node-content-padding`) | `padding-left: 0` hardcoded → highlight hugs label |

Neither is "more mature" — svelte-treeview is broader (two rendering modes, easier vertical guide lines via CSS on `.stv__children`); web-treeview is purpose-built for virtual scrolling over large datasets with a flatter DOM and dirty-attribute reconciliation.

## Callback & event API (rc07 — ctx-object parity with svelte-treeview)

Every fire-and-forget event callback takes ONE context object and uses `on*` naming.
Interceptors keep `before*Callback` / data providers keep `get*Callback`. The shared
shape is `NodeRef<T> = { path, node, parent, siblings }`, built by `controller.nodeRef()`.

- Events: `onNodeClick(NodeRef)`, `onNodeDoubleClick(NodeRef)`, `onNodeDragStart` /
  `onNodeDragOver(NodeDragContext = NodeRef + { event, dragged })`,
  `onNodeDrop(NodeDropContext = { source, target, dragged, dropped, position, operation, event })`,
  `onHighlightChange` / `onSelectionChange(SelectionChangeContext = { paths, nodes })`,
  `onCopy` / `onCut` / `onDelete(ClipboardEventContext = { operation?, paths, nodes })`,
  `onPaste(PasteResult)`.
- Interceptors: `beforeCopyCallback` / `beforeCutCallback(BeforeCopyContext)`,
  `beforePasteCallback(BeforePasteContext)`, `beforeDeleteCallback(BeforeDeleteContext)`,
  `onTreeKeydown(TreeKeydownContext = { event, focusedNode, highlightedNodes, controller })` —
  return `true` to suppress default + built-in shortcuts. `beforeDropCallback(ctx: BeforeDropContext)`
  is now a ctx object too (migrated off its old 5-arg positional form): `false` blocks,
  `{ position?, operation? }` redirects, a `DropGroup[]` fans one drop out to several
  destinations, `void` proceeds; async-capable. `beforeDragStartCallback(ctx: DragStartContext)`
  is the set-level pre-drag interceptor (prune/augment/veto the dragged manifest).
- Transforms (direction-based, rc13 rename — fire for BOTH clipboard AND drag):
  `nodeOutputTransformationCallback(data, ctx: NodeTransformContext)` = OUTPUT/egress (clean/redact
  at snapshot), `nodeInputTransformationCallback(data, ctx)` = INPUT/ingress (derive ids/names at
  insert; returning `null` skips a node + its subtree).
- DOM `CustomEvent` `detail` mirrors the ctx object (e.g. `highlight-change` detail is
  `{ paths, nodes }`; `node-drop` detail is the `NodeDropContext`).

New surface: `deleteNodes(paths?)` + Delete/Shift+Delete keys; `shouldHandleKeyboardShortcuts`
(default `true`, opt-out); `noDataText`; `shouldShowDropPlaceholderWhenEmpty` (empty-tree
Ctrl/Cmd+V paste — focusable empty zone); `shouldAutoHandlePaste`; `PasteResult` is now
`{ success, count, skipped, error?, entries?, operation? }` (`count` was `pastedCount`);
cross-tree cut removes the source via the clipboard registry
(`registerClipboardTree` / `getClipboardTree`); `uniqueName(base, taken, suffix?)` helper.

E2E: new features covered by `/test/clipboard-extended.html` + `e2e/clipboard-extended.spec.ts`
(Delete, paste-transform null-skip + `skipped`, `onTreeKeydown` suppression). The ctx-object
migration touched every `/test/*` fixture that read the old event-detail shapes.
