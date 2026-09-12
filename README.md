# @keenmate/web-treeview

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://img.shields.io/npm/v/@keenmate/web-treeview.svg)](https://www.npmjs.com/package/@keenmate/web-treeview)

A lightweight, framework-agnostic treeview web component built with vanilla TypeScript. Drop `<web-treeview>` into any framework or plain HTML.

## What is it

`@keenmate/web-treeview` is a custom element that renders a hierarchical data list with full keyboard navigation, drag-and-drop, multi-select, search, context menus, and pluggable rendering. Works in any framework or plain HTML — assign `data`, and the tree renders.

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

```bash
npm install @keenmate/web-treeview
```

See [docs/usage.md](./docs/usage.md) for the full API and [docs/examples.md](./docs/examples.md) for end-to-end recipes.

## Features

- **Two rendering modes** — flat (default, up to ~10k nodes) and virtual scroll (~50 DOM nodes for trees of 100k+).
- **LTree path model** — materialized path hierarchy (`'1'`, `'1.1'`, `'1.2.3'`) with configurable separator.
- **Three-level selection** — single focus (arrow keys), multi-highlight set (Ctrl / Shift+click), checkbox / data state.
- **Full drag and drop** — internal reorder, cross-tree drag, glow / floating drop zones, touch support, copy operations.
- **Multi-level context menus** — viewport-aware positioning via Floating UI, keyboard shortcuts, named dividers, custom item rendering.
- **Bulk operations** — `insertBranch`, `replaceBranch`, `deleteBranch` for efficient batch mutations.
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

Live HTML demos sit at the repo root: `examples-basic.html`, `examples-drag-drop.html`, `examples-multiselect.html`, `examples-templates.html`, `examples-theming.html`, `examples-performance.html`, `examples-api.html`, `examples-logging.html`. `npm run dev` serves them on port 21111.

## Development

```bash
npm install
npm run dev          # Dev server on port 21111
npm run build        # Production build
npm run package      # Build + npm pack
npm run test:e2e     # Playwright e2e (Chromium)
```

## About

Authored and maintained by [KeenMate](https://keenmate.com/). The component ships standalone with sensible light/dark defaults; when mounted inside [Pure Admin](https://pureadmin.io/) — or any host that publishes the `--base-*` taxonomy via [`@keenmate/theme-designer`](https://www.npmjs.com/package/@keenmate/theme-designer) — it adopts the host's colors, typography, and sizing automatically. There is no runtime dependency on Pure Admin; the integration is opt-in via CSS variables.

## Built with BlissFramework

Follows the [BlissFramework component guidelines](https://blissframework.dev/) for structure, theming, color-scheme, and accessibility. The `VALIDATION-NOTES.md` register documents the four accepted deviations against `/validate-web-component`.

## License

MIT
