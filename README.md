# @keenmate/web-treeview

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://img.shields.io/npm/v/@keenmate/web-treeview.svg)](https://www.npmjs.com/package/@keenmate/web-treeview)

> A lightweight, framework-agnostic treeview web component — virtual scroll, drag and drop, multi-select, search, context menus — built with vanilla TypeScript.

## Demos & docs

- 🚀 [Showcase](https://web-treeview.keenmate.dev)
- 🧪 [Live demo](https://examples.web-treeview.keenmate.dev)
- 📘 [Usage / API reference](./docs/usage.md) — every attribute, property, method, event.
- 🎨 [Theming](./docs/theming.md) — `--wtv-*` variables, dark mode, `@layer` cascade.
- 📚 [Examples / cookbook](./docs/examples.md) — drag-drop, multi-select, clipboard, render callbacks, context menus.
- ♿ [Accessibility](./docs/accessibility.md) — keyboard navigation, focus model, ARIA status.
- 📜 [Release history](./CHANGELOG.md)

## What is it

`@keenmate/web-treeview` is a custom element (`<web-treeview>`) that renders a hierarchical data list with full keyboard navigation, drag-and-drop, multi-select, search, context menus, and pluggable rendering. Framework-agnostic — works in React, Vue, Svelte, Blazor, plain HTML: assign `nodes`, and the tree renders.

Built on the same LTree path-based engine as [`@keenmate/svelte-treeview`](https://github.com/KeenMate/svelte-treeview) and ported to vanilla TypeScript with zero framework dependencies. If you know svelte-treeview, you already know the API surface.

**Headline features:**

- Flat rendering (up to ~10k nodes) and built-in virtual scroll (~50 DOM nodes for trees of 100k+).
- LTree path model (`'1'`, `'1.1'`, `'1.2.3'`) — including window trees cut from a big database ltree.
- Three node states — the focused row, the selected set (Ctrl / Shift+click, Shift+arrows) and the checked set (checkboxes, cascade policies).
- Drag and drop — reorder, cross-tree, multi-drag, touch, glow / floating drop zones, page-wide arming.
- Multi-level context menus on core `/menu`, clipboard (`copyNodes` / `cutNodes` / `pasteNodes`, cross-tree), bulk branch operations.
- FlexSearch full-text search with filter and highlight modes.
- Theming via `--wtv-*` variables on the `--base-*` contract — one theme drives svelte-treeview and every KeenMate component.
- Render callbacks for rows, icons, tooltips, menus and empty / loading states; a pluggable `TreeViewRenderer<T>`; fully typed generic `<T>` API; SSR safe.

### How it differs from `@keenmate/svelte-treeview`

Same logical tree, different DOM strategy — neither is "more mature", they target different priorities.

| | svelte-treeview | web-treeview |
|---|---|---|
| Rendering modes | Recursive (default) + flat | Flat only |
| Children DOM | `.stv__children` wrapper (recursive mode) | None — siblings under `.wtv__tree` |
| Indent math | `level × indent` | `(level − 1) × indent` (root at zero offset) |
| Virtual scroll | Flat mode only | Built-in (three-div spacer / `translateY`) |
| Label markup | `<span class="stv__node-label">` by default — replace via `nodeTemplate` snippet | `<span class="wtv__node-label">` by default — replace via `renderNodeCallback` |
| Update mechanism | Svelte 5 runes + per-node `_rev` keyed `{#each}` | Imperative reconciler diffing `data-rev` / `data-expanded` attributes |

svelte-treeview is broader (two rendering modes, easier vertical guide lines via `.stv__children`); web-treeview is purpose-built for virtual scrolling over large datasets with a flatter DOM.

## What's New in v2.0.0-rc07

- **Batch writes go through core — `el.update()` is gone** (breaking within the RC) — The element's `update()` is now core's protected hook. Write several inputs at once with core's `el.setAttributes({ nodes, expandLevel, … })`: one validated batch, one engine update, and it returns the refused values (each also fires `input-rejected`). The old public `update(props)` skipped validation and was forgotten by the element, so the next unrelated write could bring the previous `nodes` back. `WebTreeView.update()` (the engine wrapper) is unchanged.
- **Custom CSS — page-wide, per instance, and icon fonts** — `window.components['web-treeview'].customStyles` (or `.getCustomStylesCallback(ctx)`) styles every tree on the page; a tree's own `custom-styles` attribute / `customStyles` property or `getCustomStylesCallback` comes after it and overrides it. An `@import` is also linked once in the document head, so an imported icon font (FontAwesome) registers. Core `createCustomStyles()`; the `<style>` class is now `wtv-custom-styles`.
- **Core 1.0.0-rc18 → rc20** — Every refused write fires `input-rejected`; `drop-zone-max-width` / `dropZoneMaxWidth` takes a CSS length or a number of pixels; `flat-indent-size` and `virtual-scroll-container-height` are CSS lengths too (a bare number means px, `30rem` sizes the virtual window correctly); `drag-drop-mode` refuses unknown modes, and `null` on these three is refused (`undefined` or removing the attribute resets); enum getters read their real default. The full-label popover (`node-title-overflow="info"`) closes on any scroll that moves its row and on a click the tree stops (a checkbox); the context menu closes only on a scroll that moves the tree, not on an unrelated scroller or a bare mouse wheel. The context-menu divider factory is `createMenuDivider(text?)` and the default loader is `.wtv__loader`.
- **Safari** — A search jump (`scrollToPath`) into a branch that is still rendering progressively now reaches its row: WebKit cancelled the smooth scroll when rows were inserted mid-glide.

## What's New in v2.0.0-rc06

- **Names — one vocabulary with `@keenmate/base-css-variables` 2.0 and svelte-treeview** (breaking within the RC) — The click / Ctrl / Shift-click set is now **selected** (`selectedPaths`, `selectNode`, `selection-change`, `.wtv__node-content--selected`) and the checkbox state is **checked** (`checkedPaths`, `checkNode` / `uncheckNode`, `checked-change`), the words web-multiselect and the shared `--base-selected-*` tokens use. A wider naming pass followed: booleans read `is*` / `should*` / `show-*` / `enable-*`, state is a property (`expandedPaths`, `selectedPaths`, `checkedPaths`, `focusedNode` — no `get*` / `set*` twins), *remove* is programmatic (`removeNode(s)`) and *delete* is the user command (Delete key, `beforeDeleteCallback`, `node-delete`). There are no deprecated aliases, so search your code for the old names; the CHANGELOG lists every rename.
- **Callbacks & events — one context object, `el.controller`, core actions** — Every callback now takes ONE ctx carrying the node plus non-enumerable `controller` (the public `TreeViewController` facade, also `el.controller`) and `element`; `el.getController()`, which leaked the internal engine, is gone. Events are present tense, `composed: false`, and each has an `on*` twin receiving the same detail (`node-click`, `node-drop`, `selection-change`, `tree-change`, `action`, …). Interceptors share core's before-hook contract: `false` cancels, a value redirects, a throw cancels (`beforeCopy/Cut/Paste/Delete/DragStart/Drop/Expand/Keydown/CheckboxToggleCallback`). The context menu runs on core `/menu` with action items, dividers and built-ins (`'copy' | 'cut' | 'paste' | 'delete' | 'expand' | 'collapse'`), plus `renderContextMenuCallback` for a fully custom menu.
- **Window trees — the LTree keeps a path index** (breaking for direct LTree users) — `LTreeNode.children` is now an ordered array, and paths resolve through an internal path → node index, so lookups no longer walk segment by segment from the root. A node whose `parentPath` is null, `''` or its own path is top-level whatever its path, so a window cut from a big database ltree (`1.20.302` without `1` / `1.20`) renders with its real paths: map `parentPathMember` and send the rows as they come. Levels count from the parent, so `expandLevel` works inside a window.
- **Scrolling — the container, never the page; `beforeScrollCallback`** — Keyboard moves, `scrollToPath` and the reveal after a paste scroll only the row's scroll container (the tree's own or a wrapper around the element) through core's `scrollIntoContainer`, honouring `scroll-padding` / `scroll-margin`. `beforeScrollCallback({ node, path, source, container, options })` runs first for each of them (`source: 'keyboard' | 'scroll-to-path' | 'paste'`): return `false` to skip the scroll, or options such as `{ block: 'start' }` to replace the defaults. `scrollToPath` gains `shouldRevealContainer` (default on), which first scrolls the page to a tree that's off-screen. Keyboard moves always scroll instantly; programmatic jumps read `--wtv-scroll-behavior`.
- **Drag and drop — page-wide arming, a new empty drop zone, batch moves** — `highlight-on-page-drag` (same option and names as web-dropzone) arms a tree as soon as any node is dragged anywhere on the page: the host gets the `armed` attribute and `:state(armed)`, and an empty tree shows its drop zone at once. The empty zone has a new look (an icon above "Drop here", a thin dashed accent border, and a spotlight with the standard `--base-shadow-lg` lift when engaged), and it no longer stays engaged after the pointer leaves across a fractional edge. Underneath sit the `moveNodes` / `duplicateNodes` batch primitives, multi-drag, cross-tree copy through the clipboard registry, `DropGroup[]` fan-out from `beforeDropCallback`, `enable-tree-drop-zone`, and reject feedback (`node-drag-reject` / `node-drop-reject`, the 🚫 badge).
- **Core platform — `BlissElement`, responsive rules, motion level, the shared loader** — The element runs on `@keenmate/web-components-core` (^1.0.0-rc17): one `static inputs` table, `defer` / `release()` / `ready` with a FOUC guard, and generated `custom-elements.json` / `web-types.json` / VS Code data. Responsive rules (`responsive` / `responsiveCallback`, keyed by device or breakpoint) swap in a partial config per device class or window width. `motion="auto | none | snappy | smooth"`, `window.components.motion` or a `data-motion` ancestor sets every transition speed and the scroll behaviour; the OS reduced-motion setting always wins. Loading states draw the shared KeenMate loader (`renderLoadingCallback`, `--wtv-loader-*`).
- **Theming — one token list with svelte-treeview on the base-css-variables 2.0 contract** — Every `--wtv-*` token falls back to a `--base-*` token (^2.0.0-rc08), and the list matches svelte-treeview's `--stv-*` one for one, so one theme drives both packages and every KeenMate component. Drop targets use the contract's green `--base-drop-target-*` tokens, the indent reads `--base-tree-indent`, and `icon-set` (`chevron`, `triangle`, `plus-minus`, `arrow`) points the disclosure glyph at the shared `--base-icon-*` masks. The checkbox is the canonical single styled `<input>`, and its indeterminate state survives virtual-scroll row recycling.
- **Icons, tooltips and render context** — `iconMember` / `getIconCallback` put a dedicated `.wtv__node-icon` on every node, branch and leaf, with per-node colour and a `renderIconCallback` hook for SVG or custom markup. `show-node-tooltips` + `getNodeTooltipCallback({ node })` add hover / focus tooltips (text or a rich element) on core's shared `createTooltip`, styled by the shared `--base-tooltip-*` tokens. The render callbacks receive the device class, the container size and the live node state in their ctx. UI strings are configurable through `labels`.

See [CHANGELOG.md](./CHANGELOG.md) for the full release history.

## Install

```bash
npm install @keenmate/web-treeview
```

## Quick start

```html
<script type="module" src="./node_modules/@keenmate/web-treeview/dist/web-treeview.js"></script>

<web-treeview id="my-tree" expand-level="2"></web-treeview>

<script type="module">
  const tree = document.getElementById('my-tree');
  tree.nodes = [
    { id: 1, path: '1',     displayValue: 'Documents' },
    { id: 2, path: '1.1',   displayValue: 'Projects' },
    { id: 3, path: '1.1.1', displayValue: 'Web App' },
    { id: 4, path: '1.1.2', displayValue: 'Mobile App' },
    { id: 5, path: '1.2',   displayValue: 'Photos' },
    { id: 6, path: '2',     displayValue: 'Downloads' },
  ];
  tree.addEventListener('node-click', (e) => console.log(e.detail.path));
</script>
```

Map your own data shape with `idMember` / `pathMember` / `displayValueMember` (or `parentPathMember` for window trees). See [docs/usage.md](./docs/usage.md) for the full API and [docs/examples.md](./docs/examples.md) for end-to-end recipes.

## Styling

Theme the tree with CSS variables (`--wtv-*`, falling back to the shared `--base-*` tokens) — see
[docs/theming.md](./docs/theming.md). To restyle internal parts, inject CSS into the shadow root: per tree with
`custom-styles` / `getCustomStylesCallback`, or for every tree on the page with
`window.components['web-treeview'].customStyles` ([Custom CSS](./docs/theming.md#custom-css-shadow-root)).

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

## Editor IntelliSense

The package ships editor metadata so you get autocomplete and hover docs for the
element's attributes, events, and all `--wtv-*` CSS custom properties. All of it is
generated from the component's source on every build, so it never drifts.

- **JetBrains** (WebStorm / IntelliJ) — works automatically. The IDE discovers
  `web-types.json` via the `web-types` field in `package.json`; no setup needed.
- **VS Code** — the data files ship but VS Code doesn't auto-discover them from a
  dependency, so point your workspace at them once in `.vscode/settings.json`:

  ```json
  {
    "html.customData": [
      "./node_modules/@keenmate/web-treeview/vscode.html-custom-data.json"
    ],
    "css.customData": [
      "./node_modules/@keenmate/web-treeview/vscode.css-custom-data.json"
    ]
  }
  ```

  `html.customData` powers tag/attribute completion on `<web-treeview>`;
  `css.customData` powers completion for the `--wtv-*` theming variables. Reload
  the window after adding them.

## HTML Injection (XSS) Notice

The tree inserts node data as **plain text**: display values, `labels`, tooltip strings
(`getNodeTooltipCallback` returning a string) and context-menu item `text` / `tooltip` are all
written with `textContent`, so untrusted node names are safe by default.

These inputs are **raw markup** — intentionally not XSS-safe, so you control the output.
Sanitize any untrusted text before passing it in:

| Input | Output used in |
|---|---|
| Context-menu item `icon` | The menu item's icon slot (innerHTML — meant for an `<svg>` / `<i class>` / glyph) |
| `customStyles` / `getCustomStylesCallback`, page-wide `window.components['web-treeview'].customStyles` / `.getCustomStylesCallback` | CSS injected into the shadow root |

The render callbacks (`renderNodeCallback`, `renderIconCallback`, `renderContextMenuCallback`,
`renderContextMenuItemCallback`, `render{EmptyState,EmptyZone,Loading,Header,Footer}Callback`) and a
tooltip callback returning an `HTMLElement` hand you a DOM element — whatever you write into it
(`innerHTML` included) is on you.

## Browser support

Modern evergreen browsers — the standalone colour fallbacks use CSS relative-colour syntax (`oklch(from …)`), the same floor as `@keenmate/base-css-variables` 2.x:

- Chrome / Edge 119+
- Firefox 128+
- Safari 18+

No polyfills are shipped. SSR-safe: the module imports without crashing in Node, but renders only after hydration in the browser.

## Development

```bash
npm install
npm run dev          # Dev server on port 12300 (make dev)
npm run build        # Production build
npm run package      # Build + npm pack
npm run test:e2e     # Playwright e2e (Chromium)
```

Live HTML demos sit at the repo root, one page per topic (start from `index.html`): `examples-basic.html`, `examples-data.html`, `examples-search.html`, `examples-interaction.html`, `examples-drag-drop.html`, `examples-icons.html`, `examples-tooltips.html`, `examples-context-menu.html`, `examples-custom-layout.html`, `examples-tree-editor.html`, `examples-responsive.html`, `examples-theming.html`, `examples-performance.html`, `examples-logging.html`. `npm run build:examples` builds the static site into `dist-examples/`; the page chrome comes from [@keenmate/web-components-devkit](https://github.com/keenmate/web-components).

## About

Authored and maintained by [Keenmate](https://keenmate.com/). The component ships standalone with sensible light/dark defaults; when mounted inside [Pure Admin](https://pureadmin.io/) — or any host that publishes the `--base-*` taxonomy via [`@keenmate/theme-designer`](https://www.npmjs.com/package/@keenmate/theme-designer) — it adopts the host's colors, typography, and sizing automatically. There is no runtime dependency on Pure Admin; the integration is opt-in via CSS variables.

## Built with BlissFramework

Follows the [BlissFramework component guidelines](https://blissframework.dev/) for structure, theming, color-scheme, and accessibility. The `VALIDATION-NOTES.md` register documents the four accepted deviations against `/validate-web-component`.

## License

MIT
