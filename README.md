# @keenmate/web-treeview

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://img.shields.io/npm/v/@keenmate/web-treeview.svg)](https://www.npmjs.com/package/@keenmate/web-treeview)

A lightweight, framework-agnostic treeview web component built with vanilla TypeScript. Drop `<web-treeview>` into any framework or plain HTML.

## What is it

`@keenmate/web-treeview` is a custom element that renders a hierarchical data list with full keyboard navigation, drag-and-drop, multi-select, search, context menus, and pluggable rendering. Works in any framework or plain HTML — assign `nodes`, and the tree renders.

Built on the same LTree path-based engine as [`@keenmate/svelte-treeview`](https://github.com/KeenMate/svelte-treeview) and ported to vanilla TypeScript with zero framework dependencies. If you know svelte-treeview, you already know the API surface.

### How it differs from `@keenmate/svelte-treeview`

Same logical tree, different DOM strategy — neither is "more mature", they target different priorities.

| | svelte-treeview | web-treeview |
|---|---|---|
| Rendering modes | Recursive (default) + flat | Flat only |
| Children DOM | `.stv__children` wrapper (recursive mode) | None — siblings under `.wtv__tree` |
| Indent math | `level × indent` | `(level − 1) × indent` (root at zero offset) |
| Virtual scroll | Flat mode only | Built-in (three-div spacer / `translateY`) |
| Label markup | `<span class="stv__node-label">` by default — replace via `nodeTemplate` snippet | `<span class="wtv__node-label">` by default — replace via `renderNodeCallback` |
| Checkbox | `<label>` + custom `.stv__checkbox-box` span | Bare native `<input type="checkbox">` |
| Update mechanism | Svelte 5 runes + per-node `_rev` keyed `{#each}` | Imperative reconciler diffing `data-rev` / `data-expanded` attributes |

svelte-treeview is broader (two rendering modes, easier vertical guide lines via `.stv__children`); web-treeview is purpose-built for virtual scrolling over large datasets with a flatter DOM.

## What's New in v2.0.0-rc06

- **Names — one vocabulary with `@keenmate/base-css-variables` 2.0 and svelte-treeview** (breaking within the RC) — The click / Ctrl / Shift-click set is now **selected** (`selectedPaths`, `selectNode`, `selection-change`, `.wtv__node-content--selected`) and the checkbox state is **checked** (`checkedPaths`, `checkNode` / `uncheckNode`, `checked-change`), the words web-multiselect and the shared `--base-selected-*` tokens use. A wider naming pass followed: booleans read `is*` / `should*` / `show-*` / `enable-*`, state is a property (`expandedPaths`, `selectedPaths`, `checkedPaths`, `focusedNode` — no `get*` / `set*` twins), *remove* is programmatic (`removeNode(s)`) and *delete* is the user command (Delete key, `beforeDeleteCallback`, `node-delete`). There are no deprecated aliases, so search your code for the old names; the CHANGELOG lists every rename.
- **Callbacks & events — one context object, `el.controller`, core actions** — Every callback now takes ONE ctx carrying the node plus non-enumerable `controller` (the public `TreeViewController` facade, also `el.controller`) and `element`; `el.getController()`, which leaked the internal engine, is gone. Events are present tense, `composed: false`, and each has an `on*` twin receiving the same detail (`node-click`, `node-drop`, `selection-change`, `tree-change`, `action`, …). Interceptors share core's before-hook contract: `false` cancels, a value redirects, a throw cancels (`beforeCopy/Cut/Paste/Delete/DragStart/Drop/Expand/Keydown/CheckboxToggleCallback`). The context menu runs on core `/menu` with action items, dividers and built-ins (`'copy' | 'cut' | 'paste' | 'delete' | 'expand' | 'collapse'`), plus `renderContextMenuCallback` for a fully custom menu.
- **Window trees — the LTree keeps a path index** (breaking for direct LTree users) — `LTreeNode.children` is now an ordered array, and paths resolve through an internal path → node index, so lookups no longer walk segment by segment from the root. A node whose `parentPath` is null, `''` or its own path is top-level whatever its path, so a window cut from a big database ltree (`1.20.302` without `1` / `1.20`) renders with its real paths: map `parentPathMember` and send the rows as they come. Levels count from the parent, so `expandLevel` works inside a window.
- **Scrolling — the container, never the page; `beforeScrollCallback`** — Keyboard moves, `scrollToPath` and the reveal after a paste scroll only the row's scroll container (the tree's own or a wrapper around the element) through core's `scrollIntoContainer`, honouring `scroll-padding` / `scroll-margin`. `beforeScrollCallback({ node, path, source, container, options })` runs first for each of them (`source: 'keyboard' | 'scroll-to-path' | 'paste'`): return `false` to skip the scroll, or options such as `{ block: 'start' }` to replace the defaults. `scrollToPath` gains `shouldRevealContainer` (default on), which first scrolls the page to a tree that's off-screen. Keyboard moves always scroll instantly; programmatic jumps read `--wtv-scroll-behavior`.
- **Drag and drop — page-wide arming, a new empty drop zone, batch moves** — `highlight-on-page-drag` (same option and names as web-dropzone) arms a tree as soon as any node is dragged anywhere on the page: the host gets the `armed` attribute and `:state(armed)`, and an empty tree shows its drop zone at once. The empty zone has a new look (an icon above "Drop here", a thin dashed accent border, and a spotlight with the standard `--base-shadow-lg` lift when engaged), and it no longer stays engaged after the pointer leaves across a fractional edge. Underneath sit the `moveNodes` / `duplicateNodes` batch primitives, multi-drag, cross-tree copy through the clipboard registry, `DropGroup[]` fan-out from `beforeDropCallback`, `enable-tree-drop-zone`, and reject feedback (`node-drag-reject` / `node-drop-reject`, the 🚫 badge).
- **Core platform — `BlissElement`, responsive rules, motion level, the shared loader** — The element runs on `@keenmate/web-components-core` (^1.0.0-rc17): one `static inputs` table, `defer` / `release()` / `ready` with a FOUC guard, and generated `custom-elements.json` / `web-types.json` / VS Code data. Responsive rules (`responsive` / `responsiveCallback`, keyed by device or breakpoint) swap in a partial config per device class or window width. `motion="auto | none | snappy | smooth"`, `window.components.motion` or a `data-motion` ancestor sets every transition speed and the scroll behaviour; the OS reduced-motion setting always wins. Loading states draw the shared KeenMate loader (`renderLoadingCallback`, `--wtv-loader-*`).
- **Theming — one token list with svelte-treeview on the base-css-variables 2.0 contract** — Every `--wtv-*` token falls back to a `--base-*` token (^2.0.0-rc08), and the list matches svelte-treeview's `--stv-*` one for one, so one theme drives both packages and every KeenMate component. Drop targets use the contract's green `--base-drop-target-*` tokens, the indent reads `--base-tree-indent`, and `icon-set` (`chevron`, `triangle`, `plus-minus`, `arrow`) points the disclosure glyph at the shared `--base-icon-*` masks. The checkbox is the canonical single styled `<input>`, and its indeterminate state survives virtual-scroll row recycling.
- **Icons, tooltips and render context** — `iconMember` / `getIconCallback` put a dedicated `.wtv__node-icon` on every node, branch and leaf, with per-node colour and a `renderIconCallback` hook for SVG or custom markup. `show-node-tooltips` + `getNodeTooltipCallback({ node })` add hover / focus tooltips (text or a rich element) on core's shared `createTooltip`, styled by the shared `--base-tooltip-*` tokens. The render callbacks receive the device class, the container size and the live node state in their ctx. UI strings are configurable through `labels`.

## What's New in v2.0.0-rc05

This release lands the BlissFramework `/validate-web-component` punch-list and bumps the API surface to current naming conventions. Since the RC cycle is still active, breaking changes are direct renames without deprecation aliases.

- **Strategy B theming.** `_dark-mode.css` collapses from ~100 lines of variable redeclarations to ~50 lines of conditional `color-scheme: dark` / `color-scheme: light` flips. Every color fallback in `variables.css` now uses `light-dark(<light>, <dark>)` and the variables flip automatically based on the inherited `color-scheme`. The rc09 subtree-theming bug is fixed (`:root` co-selector dropped from `variables.css`). Hover / active / selected switched to `color-mix` chains so highlights stay visible at any base luminance. `:host([data-theme])` selectors added alongside `.wtv__container[data-theme]`.
- **API rename per BlissFramework `naming-conventions.md`.** Callback props that were `on*` (Svelte idiom) are now `*Callback` (`nodeClickedCallback`, `nodeDropCallback`, `selectionChangeCallback`, `highlightChangeCallback`, `renderStartCallback`, etc.). Boolean Config props gained `is*` / `should*` prefixes (`isAccordionExpand`, `isCopyAllowed`, `shouldShowCheckboxes`, `shouldClickToggleCheckbox`, `isVirtualScrollEnabled`, etc.). HTML attribute names are **unchanged** (`show-checkboxes`, `allow-copy`, `accordion-expand`, `virtual-scroll` are still kebab-case as written) — only the JS surface follows the new convention. The `ATTRIBUTE_TABLE` in `src/web-component.ts` is now the single source of truth for the attribute ⇄ config wiring.
- **Selection / highlight / focus API normalized.** The imperative method surface is now three symmetric verb-families mirroring `@keenmate/svelte-treeview`: **highlight** (`highlightNode` / `highlightNodes` / `setHighlightedPaths` / `highlightAll` / `clearHighlight`), **selection / checkboxes** (`selectNode` / `selectNodes` / `setSelectedPaths` / `selectAll` / `deselectNode` / `clearSelection`), and **focus** (`focusNode` / `clearFocus`). Breaking within the RC: `deselectAll` → `clearSelection`; `selectAll` now checks every box (highlight-all moved to `highlightAll`); `selectNode` / `selectNodes` are now real checkbox setters; `highlightNodes` is additive (use `setHighlightedPaths` to replace). Two shared types — `HighlightMode` and `TreeMutationOptions` — replace the inline literals. `Ctrl+A` now highlights every node, and `Escape` clears the highlight set rather than the checkboxes.
- **CSS structure cleanup.** `@layer variables, component, overrides;` added to `main.css` so consumers can override component rules without specificity wars. The duplicate non-BEM `.web-treeview` class is gone (`.wtv__container` does the layout job). CSS files dropped their SASS-partial `_` prefix.
- **New `--highlight-glow` flavor + smarter highlight marker.** A fifth opt-in `highlightedNodeClass` value (`wtv__node-content--highlight-glow`) joins bold / border / brackets — a tinted background plus an accent-colored soft glow ring, parity with svelte-treeview. The always-on `.wtv__node-content--highlighted` default marker is now a *fallback*: it only paints when no `highlightedNodeClass` is configured, so a configured highlight style no longer fights the built-in tint underneath it.
- **Manifest repaired.** `component-variables.manifest.json` prefix is now `wtv` (was the stale `tv` from rc02). All 108 entries renamed; stale `glow-above` / `glow-below` → `glow-before` / `glow-after`; added missing `wtv-cut-opacity` and `wtv-font-family`.
- **README split.** Most of the prose moved into `docs/`; this file is the landing page.

See [CHANGELOG.md](./CHANGELOG.md) for the full release history.

## Quick start

> **Breaking change in the next release — interaction model.** Every callback takes ONE context
> object (`getIconCallback({ node })`, `getContextMenuItemsCallback({ node, path, parent, siblings })`, …),
> context-menu entries are core action items (`{ id, text, isDanger, onClick(detail) }`), events are
> renamed to present tense (`node-click`, `node-copy` / `node-paste`, `tree-change`, `focus-change`, new
> `action`), and `el.getController()` is replaced by the public `el.controller` facade. See the
> [`[Unreleased]` section of the CHANGELOG](./CHANGELOG.md#unreleased) for the full old → new table.

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

```bash
npm install @keenmate/web-treeview
```

See [docs/usage.md](./docs/usage.md) for the full API and [docs/examples.md](./docs/examples.md) for end-to-end recipes.

## Responsive rules

Tune any input per device class or window width without app-side viewport code — the generic core
mechanism ([core SPEC §6.7](https://github.com/KeenMate/web-components-core/blob/main/docs/SPEC.md)).
A rule is a map of partial configs (`TreeViewResponsiveMap`) or a function of the environment
(`TreeViewResponsiveCallback`, `(ctx) => partial | null | undefined`), set at three levels. A map has two
axes, each keyed `mobile` / `tablet` / `desktop`:

- **`device`** — the kind of device, by capability: `mobile` = a touch-primary phone (short side under
  600 px), `tablet` = a larger touch device; a mouse / trackpad device is `desktop` at any width.
- **`breakpoint`** — the window width (768 / 1024 px lines): a desktop window narrowed below 768 px is
  `mobile`.

The breakpoint entry applies first, the device entry over it (device wins on the same key). Your own
widths or combinations (e.g. "desktop AND narrower than 600 px") go in a `responsiveCallback`.

```js
// page-wide (every KeenMate component; unknown keys are skipped silently)
window.components.responsive = { device: { mobile: { expandLevel: 1 } } };
// per tag: phones by capability, plus any narrow window
window.components['web-treeview'].responsive = {
  device: { mobile: { expandLevel: 1, isNodeTooltipsShown: false } },
  breakpoint: { mobile: { expandLevel: 1 } },
};
// own widths / combinations → callback (re-runs as the window width changes)
window.components['web-treeview'].responsiveCallback = ({ deviceClass, env }) =>
  deviceClass === 'desktop' && env.viewportWidth < 600 ? { isNodeTooltipsShown: false } : undefined;
// one instance (property, or the JSON attribute responsive='{"device":{"tablet":{"expandLevel":2}}}')
tree.responsive = { device: { tablet: { expandLevel: 2 } } };
```

Precedence, later wins key by key: global map → global callback → per-tag map → per-tag callback →
**attributes / properties set on the instance** → instance map → instance callback. So
`<web-treeview expand-level="3">` keeps `3` whatever the page rules say; an instance rule returning `null`
ignores all page rules. Responsive values never reflect to attributes; `el.expandLevel` / `el.config` read
the effective value. Any other top-level map key (the pre-rc15 `{ mobile: … }` shape) warns and is ignored.

## Features

- **Two rendering modes** — flat (default, up to ~10k nodes) and virtual scroll (~50 DOM nodes for trees of 100k+).
- **LTree path model** — materialized path hierarchy (`'1'`, `'1.1'`, `'1.2.3'`) with configurable separator.
- **Three node states** — single focus (arrow keys, Home/End, PageUp/PageDown), selected set (Ctrl / Shift+click, Shift+Arrow/Home/End/PageUp/PageDown), checked set (checkboxes). Navigation methods are replaceable via `navigationOverrides`.
- **Full drag and drop** — internal reorder, cross-tree drag, glow / floating drop zones, touch support, copy operations.
- **Multi-level context menus** — viewport-aware positioning via Floating UI, keyboard shortcuts, named dividers, custom item rendering; entries are core action items (built-ins `'copy' | 'cut' | 'paste' | 'delete' | 'expand' | 'collapse'`, lazy submenus, an `action` event).
- **Bulk operations** — `addBranch`, positioned `insertBranch`, `replaceBranch`, `removeBranch` for efficient batch mutations.
- **Clipboard** — `copyNodes` / `cutNodes` / `pasteNodes`, cross-tree paste, cut nodes dimmed via `--wtv-cut-opacity`.
- **Full-text search** — FlexSearch-powered indexing with filter and highlight modes.
- **Theming** — ~110 CSS variables, Strategy B dark mode (auto-flip via `color-scheme` + `light-dark()`), `--base-*` design-system tokens, `@layer` cascade contract.
- **Pluggable renderers** — `TreeViewRenderer<T>` interface for building custom (Canvas, WebGL, framework-specific) renderers.
- **TypeScript** — fully typed API with generic `<T>` data support.
- **SSR safe** — compatible with server-side rendering environments.

## Demos & docs

- [Usage / API reference](./docs/usage.md) — every attribute, property, method, event.
- [Theming contract](./docs/theming.md) — CSS variables, Strategy B dark mode, `@layer` cascade.
- [Examples / cookbook](./docs/examples.md) — drag-drop, multi-select, clipboard, render callbacks, context menus.
- [Accessibility](./docs/accessibility.md) — keyboard navigation, focus model, ARIA status.
- [Release history](./CHANGELOG.md)

Live HTML demos sit at the repo root — one page per topic, each a stack of coded sections with live control panels and a floating chapter-nav: `examples-basic.html`, `examples-data.html`, `examples-search.html`, `examples-interaction.html`, `examples-drag-drop.html`, `examples-icons.html`, `examples-tooltips.html`, `examples-context-menu.html`, `examples-custom-layout.html`, `examples-tree-editor.html`, `examples-responsive.html`, `examples-theming.html`, `examples-performance.html`, `examples-logging.html` (start from `index.html`). `npm run dev` serves them on port 21111.

## Development

```bash
npm install
npm run dev          # Dev server on port 21111
npm run build        # Production build
npm run package      # Build + npm pack
npm run test:e2e     # Playwright e2e (Chromium)
```

## About

Authored and maintained by [Keenmate](https://keenmate.com/). The component ships standalone with sensible light/dark defaults; when mounted inside [Pure Admin](https://pureadmin.io/) — or any host that publishes the `--base-*` taxonomy via [`@keenmate/theme-designer`](https://www.npmjs.com/package/@keenmate/theme-designer) — it adopts the host's colors, typography, and sizing automatically. There is no runtime dependency on Pure Admin; the integration is opt-in via CSS variables.

## Built with BlissFramework

Follows the [BlissFramework component guidelines](https://blissframework.dev/) for structure, theming, color-scheme, and accessibility. The `VALIDATION-NOTES.md` register documents the four accepted deviations against `/validate-web-component`.

## License

MIT
