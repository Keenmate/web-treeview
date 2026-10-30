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

- **Selected / checked — the names of `@keenmate/base-css-variables` 2.0** (breaking within the RC) — The click / Ctrl / Shift-click set is now **selected** and the checkbox state is **checked**, the same words web-multiselect and the shared `--base-selected-*` tokens use. Checkbox API: `selectedPaths` → `checkedPaths`, `selectNode` / `selectNodes` / `selectAll` / `deselectNode` / `clearSelection` → `checkNode` / `checkNodes` / `checkAll` / `uncheckNode` / `clearChecked`, `getSelected*` / `setSelectedPaths` / `isNodeSelected` → `getChecked*` / `setCheckedPaths` / `isNodeChecked`, `isSelectedMember` / `getIsSelectedCallback` → `isCheckedMember` / `getIsCheckedCallback`, `selectedNodeClass` → `checkedNodeClass`, `cascadeSelectPolicy` → `cascadeCheckPolicy`, `onSelectionChange` / `selection-change` → `onCheckedChange` / `checked-change`. Then the highlight API takes the freed names: `highlightedPaths` → `selectedPaths`, `highlightNode` / `highlightNodes` / `highlightAll` / `clearHighlight` → `selectNode` / `selectNodes` / `selectAll` / `clearSelection`, `getHighlighted*` / `setHighlightedPaths` / `isNodeHighlighted` → `getSelected*` / `setSelectedPaths` / `isNodeSelected`, `highlightedNodeClass` → `selectedNodeClass`, `onHighlightChange` / `highlight-change` → `onSelectionChange` / `selection-change`, `HighlightMode` → `SelectMode`; render context and node flags `isSelected` → `isChecked`, `isHighlighted` → `isSelected`. CSS: row class `.wtv__node-content--highlighted` → `--selected`, presets `--highlight-bold` / `-border` / `-fill` / `-brackets` / `-glow` → `--selected-*`, the `--wtv-highlighted-*` aliases are gone. No deprecated aliases — `selectedPaths` keeps its type but changes meaning, so search your code for every name above.
- **Core platform — migrated onto `@keenmate/web-components-core` (`BlissElement`)** — The hand-written custom-element plumbing in `web-component.ts` (the `ATTRIBUTE_TABLE`, `observedAttributes` / `attributeChangedCallback`, the microtask batcher, ~100 property getters/setters) collapses into one `static inputs` table + `static events`, with core owning attribute parsing, validation, reactivity coalescing, and reflection. `logger.ts` / `perf-logger.ts` are now thin shims over core logging and the vendored `loglevel` copies are gone. The dependency is pinned to `@keenmate/web-components-core@1.0.0-rc10`, whose `environment` module backs the new render context. CEM tooling (`cem analyze`) now generates `custom-elements.json`, `web-types.json`, and the VS Code custom-data files from the input/event tables.
- **Callbacks & events — one context object, `on*` naming, parity with `@keenmate/svelte-treeview`** — Every fire-and-forget callback now takes a single `NodeRef`-based context object (`onNodeClick`, `onNodeDrop`, `onCheckedChange`, `onSelectionChange`, `onCopy` / `onCut` / `onPaste`, `onNodeDoubleClick`) so a handler gets the node's live parent + siblings for free, and DOM `CustomEvent` details mirror those shapes. The clipboard gains the full *before* half — `beforeCopyCallback` / `beforeCutCallback` / `beforePasteCallback` interceptors — plus built-in **Delete** (`deleteNodes`, `Delete` / `Shift+Delete` keys, `beforeDeleteCallback`, `onDelete`), an `onTreeKeydown` interceptor, cross-tree cut via a clipboard registry, and direction-neutral `nodeOutputTransformationCallback` / `nodeInputTransformationCallback` transforms that fire for both clipboard and drag.
- **Render context — callbacks adapt to device, space, and live node state** — `renderNodeCallback` and `renderIconCallback` now receive a `NodeRenderContext` as their last argument: `{ deviceClass, container: { width, height }, isExpanded, isChecked, isSelected, isFocused, level, hasChildren }`. `deviceClass` / `container` come from core's `environment` module (`classifyDevice` + `observeEnvironment`); a device-class change forces a re-render while container resizes update silently, keeping the virtual-scroll-first design intact. It's backward compatible — existing callbacks ignore the extra arg.
- **Per-node icons on every node + hover/focus tooltips** — `iconMember` / `iconCallback` now render a dedicated `.wtv__node-icon` on **every** node (branch and leaf), between the toggle/checkbox and the label, with per-node color (`iconColorMember` / `iconColorCallback`) and a `renderIconCallback` hook for SVG/unicode/custom markup. Separately, `show-node-tooltips` + `getNodeTooltipCallback` add hover/focus tooltips built on the shared `createTooltip` core primitive (the same one web-multiselect uses), themeable through the shared `--base-tooltip-*` tokens and configurable via `tooltip-placement` / `tooltip-delay` / `tooltip-offset`.
- **Disclosure glyphs + canonical checkbox on the `--base-icon-*` contract** — A single `iconSet` knob (`chevron` default, `triangle`, `plus-minus`, `arrow`) re-points the toggle marker at the shared `--base-icon-*` variables, so a theme reskins the tree's disclosure alongside every other Keenmate component; `expandIconClass` / `collapseIconClass` are deprecated to a custom-glyph escape hatch. The checkbox is unified onto the canonical single styled `<input>` (`appearance: none`, `::after` mask glyph, scale via `--base-checkbox-scale`), with the indeterminate state carried as a `.wtv__checkbox--indeterminate` + `aria-checked="mixed"` modifier so it survives the diff reconciler and virtual-scroll row recycling.
- **Drag-and-drop overhaul** — New `moveNodes` / `duplicateNodes` batch primitives with a manifest-hole model back the multi-drag move, drag-copy, and `DropGroup` routing; cross-tree copy-drops are now placed by the library through the clipboard registry. A `beforeDragStartCallback` can prune/augment/veto the dragged set, the dragged visual dims every traveling node (whole multi-drag set + subtree descendants, not just the lead), `shouldEnableTreeDropZone` turns the whole tree into one routable target, and blocked actions get feedback via `onNodeDragDenied` / `onNodeDropDenied` + `shouldIndicateUndraggable` (🚫 badge + haptic). `beforeDropCallback` migrated to a `BeforeDropContext` object and can return a `DropGroup[]` to fan one drop out to several destinations.
- **Runtime state now survives config changes (headline fix)** — Changing any property or attribute at runtime used to silently reset the selected set, checked set, and expansion to defaults (a full data re-insert wiped node-held state), and *every* change — even a cosmetic theme class — rebuilt the entire tree. Both are fixed: runtime state is sourced from controller-owned sets through the render snapshot and re-applied after each re-insert, and an A2 value-compare guard recreates the tree only on a genuine structural change. Checkboxes also gain `cascadeCheckPolicy` (`rolled-up` default) to control which paths cascade mode emits.

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

Tune any input per device class (`mobile` / `tablet` / `desktop`) without app-side viewport code — the
generic core mechanism ([core SPEC §6.7](https://github.com/KeenMate/web-components-core/blob/main/docs/SPEC.md)).
A rule is a partial config (`TreeViewResponsiveMap`) or a function of the environment
(`TreeViewResponsiveCallback`, `(ctx) => partial | null | undefined`), set at three levels:

```js
// page-wide (every KeenMate component; unknown keys are skipped silently)
window.components.responsive = { mobile: { expandLevel: 1 } };
// per tag
window.components['web-treeview'].responsive = { mobile: { expandLevel: 1, isNodeTooltipsShown: false } };
window.components['web-treeview'].responsiveCallback = ({ deviceClass, env }) =>
  env.orientation === 'landscape' ? { expandLevel: 2 } : undefined;
// one instance (property, or the JSON attribute responsive='{"tablet":{"expandLevel":2}}')
tree.responsive = { tablet: { expandLevel: 2 } };
```

Precedence, later wins key by key: global map → global callback → per-tag map → per-tag callback →
**attributes / properties set on the instance** → instance map → instance callback. So
`<web-treeview expand-level="3">` keeps `3` whatever the page rules say; an instance rule returning `null`
ignores all page rules. Responsive values never reflect to attributes; `el.expandLevel` / `el.config` read
the effective value. `mobile` means a touch-primary device with a short side under 600 px (core
`classifyDevice`).

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
