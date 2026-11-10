# Theming — `@keenmate/web-treeview`

The component publishes ~150 CSS variables. The contract follows the BlissFramework theming model: every color resolves through a `--base-*` design-system token (overridable host-wide), then a `--wtv-*` component token (overridable per-instance), with `light-dark()` fallbacks that flip automatically with `color-scheme` (Strategy B). See [usage.md](./usage.md) for the API surface.

## Overrides at three levels

```css
/* Design system level — affects ALL components sharing the system */
:root {
  --base-primary-color: #8b5cf6;
  --base-text-color-1: #1e293b;
  --base-border-color: #e2e8f0;
  --base-hover-bg: #f1f5f9;
  --base-rem: 10px; /* Base unit for all sizing */
}

/* Component level — affects only this treeview instance */
web-treeview {
  --wtv-accent-color: #8b5cf6;   /* Overrides --base-primary-color */
  --wtv-selected-bg: #ede9fe;
  --wtv-indent-size: 1.5rem;
  --wtv-node-height: 2rem;
  --wtv-border-radius-sm: 4px;
}

/* Per-instance theme via the attribute */
<web-treeview data-theme="dark">...</web-treeview>
<web-treeview data-theme="light">...</web-treeview>
```

`examples-theming.html` ships 8 complete themes (dark, neon, corporate, glassmorphism, etc.).

> **Derived `--base-*` tokens resolve where the contract declares them.** `@keenmate/base-css-variables`
> 2.0 computes tokens such as `--base-selected-bg` or `--base-primary-bg-subtle` on `:root`,
> `[data-theme]` and `.base-scope`. Setting an *input* (`--base-primary-color`) on a plain wrapper
> `<div>` does not recompute them there — add `class="base-scope"` to that wrapper, or set the
> `--wtv-*` variable directly.

## Custom CSS (shadow root)

CSS variables reach into the shadow root; selectors don't. To restyle internal parts (`.wtv__node-label`,
`.wtv__toggle-icon`, …) inject CSS into the shadow root (core `createCustomStyles()`). Two layers, each its
own `<style>`, the page one first so an instance overrides it:

```js
// Page-wide — every <web-treeview> on the page (one file, fetched once); assigning it updates live trees.
window.components['web-treeview'].customStyles = "@import url('/css/tree-tweaks.css');";
// …or computed per tree from its context (wins over customStyles on the same layer)
window.components['web-treeview'].getCustomStylesCallback = (ctx) =>
  ctx.element.dataset.dense ? '.wtv__node-content { padding-block: 0; }' : null;

// Per instance — the attribute / property, or the callback (wins over customStyles)
tree.customStyles = '.wtv__node-label { letter-spacing: 0.02em; }';
tree.getCustomStylesCallback = (ctx) => '.wtv__node-label { font-weight: 600; }';
```

```html
<web-treeview custom-styles=".wtv__node-label { font-style: italic; }"></web-treeview>
```

The instance `<style>` has the class `wtv-custom-styles`, the page one `wtv-custom-styles--page`. The component's
own CSS sits in `@layer component`, so injected rules win without specificity tricks. An `@import` is also linked
once in the document `<head>` (`<link data-km-custom-styles>`, shared by every tree, removed when the last one stops
importing it): Chromium ignores `@font-face` inside a shadow root, so an icon font such as FontAwesome would
otherwise draw boxes. The imported rules then reach the page too. The CSS is injected as-is — never pass
untrusted input.

## Dark mode — how it flips

Every color fallback in `variables.css` uses `light-dark(<light>, <dark>)`. The active branch follows the `color-scheme` the tree inherits from the page. With no signal at all the tree matches the page: light by default, and following the OS — live — when the page declares `html { color-scheme: light dark }`. There is deliberately no `prefers-color-scheme` rule in the component (same as web-multiselect), so a tree never turns dark on a light page. `dark-mode.css` sets `color-scheme: dark` (or `light`) on these signal selectors, in increasing specificity:

1. **Page signal**: `data-theme`, `data-bs-theme` or `.dark` / `.light` on `<html>` (then `<body>`) — Bootstrap 5.3+, Tailwind, Pure Admin. `@keenmate/web-components-core` detects it once per page, shares it with every Keenmate component and mirrors it onto the host as `data-context-theme`; `dark-mode.css` reads `:host([data-context-theme="dark|light"])`. No `:host-context()`, so it works in Firefox and Safari.
   - **A themed section** (signal on a wrapper, not `<html>` / `<body>`): add `theme-source="closest"` (nearest ancestor with a signal) or `theme-source="<selector>"` to the tree.
   - **Force every component**: `import { setThemeMode } from '@keenmate/web-components-core'; setThemeMode('dark')` (`'light' | 'dark' | 'auto'`).
2. **Per-instance attribute**: `:host([data-theme="dark"])` and `.wtv__container[data-theme="dark"]` — set `<web-treeview data-theme="dark">` to force a single tree against the page default.
3. **`theme` prop forwarding**: setting `tree.theme = 'dark'` is equivalent to `data-theme="dark"` (forwarded on the inner container).


## Cascade layers

`main.css` declares `@layer variables, component, overrides;` and wraps every `@import` in `layer(...)`. Component rules sit inside layers, so any consumer CSS *outside* a layer beats *any* component rule without specificity tricks. To override from inside a layer, declare a later layer in the consumer's own stylesheet.

> Caveat: an unlayered CSS reset (`* { all: unset }`) loaded after the component will still wipe component styles. The layer contract only protects rules consumers write; it does not insulate against blanket resets.

## CSS variable reference

### Core colors

| Variable | Default | Description |
|----------|---------|-------------|
| `--wtv-accent-color` | `--base-primary-color` \| `#3b82f6` | Primary accent color |
| `--wtv-accent-color-hover` | `--base-primary-color-hover` \| accent 15% toward black (white in dark) | Accent hover state |
| `--wtv-text-color-1` | `--base-text-color-1` \| `light-dark(#334155, #f1f5f9)` | Primary text color |
| `--wtv-text-color-3` | `--base-text-color-3` \| text color mixed 55% into the bg | Secondary / muted text |
| `--wtv-text-color-on-accent` | `--base-on-primary-text-color` \| black or white by APCA contrast on the accent | Text on accent backgrounds |
| `--wtv-main-bg` | `--base-main-bg` \| `light-dark(#fff, #1e293b)` | Main background |
| `--wtv-border-color` | `--base-border-color` \| the bg shifted in lightness (OKLCH) | Default border color (divider) |
| `--wtv-input-border-color` | `--base-input-border-color` \| text color mixed 45% / 35% into the bg | Control outline (checkbox border), stronger than the divider |
| `--wtv-shadow-color` | `--base-shadow-color` \| `light-dark(rgba(0,0,0,.15), rgba(0,0,0,.4))` | Shadow tint (tooltip, context menu, touch ghost) |
| `--wtv-success-color` | `--base-success-color` \| `#10b981` | Success / valid color |
| `--wtv-danger-color` | `--base-danger-color` \| `#dc2626` | Danger / invalid color (fills, borders, tints) |
| `--wtv-danger-text-color` | `--base-danger-text-color` \| `light-dark(#721c24, #f87171)` | Danger as text (context menu danger item) |
| `--wtv-elevated-bg` | `--base-elevated-bg` \| the bg shifted in lightness (OKLCH) | Elevated surface background (full-label popover) |
| `--wtv-disabled-opacity` | `--base-disabled-opacity` \| `0.65` | Disabled dimming (checkbox) |
| `--wtv-disabled-tree-opacity` | `--wtv-disabled-opacity` | The whole tree while `disabled` |

### Node states

| Variable | Default | Description |
|----------|---------|-------------|
| `--wtv-hover-bg` | `--base-hover-bg` \| `color-mix(text 8%, bg)` | Base hover background |
| `--wtv-active-bg` | `--base-active-bg` \| `color-mix(text 14%, bg)` | Base active / pressed background |
| `--wtv-node-bg-hover` | `= --wtv-hover-bg` | Node hover background |
| `--wtv-node-bg-active` | `= --wtv-active-bg` | Node active / pressed background |
| `--wtv-node-transition` | `none` | Node content transition (e.g. `background var(--wtv-transition-normal) var(--wtv-ease-standard)` to animate) |
| `--wtv-node-border-radius` | `= --wtv-border-radius-sm` | Corner radius of the row pill |
| `--wtv-selected-bg` | `--base-selected-bg` \| `--base-primary-bg-subtle` \| accent 10% (20% dark) | Selected row (click / Ctrl / Shift-click set) background tint; row class `.wtv__node-content--selected` |
| `--wtv-selected-bg-hover` | `--base-selected-bg-hover` \| `= --wtv-selected-bg` | Selected row background on hover |
| `--wtv-selected-text-color` | `--base-selected-text-color` \| `currentColor` | Selected row text color |
| `--wtv-selected-outline` | `--base-selected-outline` \| `none` | Selected row outline shorthand (drawn inset) |
| `--wtv-focused-bg` | `--base-focused-bg` \| `transparent` | Focused row background (only when not selected) |
| `--wtv-focused-text-color` | `--base-focused-text-color` \| `currentColor` | Focused row text color |
| `--wtv-focused-outline` | `--base-focused-outline` \| `1px solid --wtv-accent-color` | Default `.wtv__node-content--focused-default` ring — outline shorthand drawn inset (`none` to suppress) |
| `--wtv-focused-outline-offset` | `calc(-1 * var(--base-outline-width, 1px))` | Outline offset for the focus ring / selected ring (negative = inset; follows `--base-outline-width`) |

### Border

| Variable | Default | Description |
|----------|---------|-------------|
| `--wtv-border-width` | `--base-border-width` \| `1px` | Hairline width (context menu, checkbox, debug panel) |

### Typography

| Variable | Default | Description |
|----------|---------|-------------|
| `--wtv-font-family` | `--base-font-family` \| system sans-serif stack | Font family (optional; not declared) |
| `--wtv-font-size-xs` | `calc(1.2 * --wtv-rem)` | 12px |
| `--wtv-font-size-sm` | `calc(1.4 * --wtv-rem)` | 14px |
| `--wtv-font-size` | `= --wtv-font-size-sm` | Default font size |
| `--wtv-font-weight-medium` | `500` | Medium weight |
| `--wtv-font-weight-semibold` | `600` | Semibold weight |

### Spacing & layout

| Variable | Default | Description |
|----------|---------|-------------|
| `--wtv-rem` | `--base-rem` \| `10px` | Base unit for proportional scaling |
| `--wtv-spacing-xs` | `2px` | Extra small spacing |
| `--wtv-spacing-sm` | `4px` | Small spacing |
| `--wtv-spacing-md` | `8px` | Medium spacing |
| `--wtv-spacing-lg` | `12px` | Large spacing |
| `--wtv-spacing-xl` | `16px` | Extra large spacing |
| `--wtv-toggle-icon-width` | `calc(--wtv-rem * 2.4)` | Toggle / icon column width (24px) |
| `--wtv-indent-size` | `calc(--base-tree-indent` \| `1.6` `* --wtv-rem)` | Indent per level (16px) — its own knob; `--base-tree-indent` is a unitless page-wide multiplier |
| `--wtv-node-padding` | `--wtv-spacing-sm --wtv-spacing-md` | Node content padding (4px 8px) |
| `--wtv-node-height` | `calc(--wtv-rem * 2.4)` | Minimum row height (24px) |
| `--wtv-toggle-icon-size` | `= --wtv-font-size-xs` | Toggle glyph size (font-size of the column) |
| `--wtv-toggle-icon-color` | `= --wtv-text-color-3` | Toggle icon color |
| `--wtv-node-info-color` / `-color-hover` / `-bg-hover` | `= --wtv-text-color-3` / accent / primary tint | Info button (`node-title-overflow="info"`) |
| `--wtv-node-info-reveal-bg` / `-text-color` / `-border-color` | `= --wtv-elevated-bg` / `--wtv-text-color-1` / `--wtv-border-color` | Full-label popover |
| `--wtv-checkbox-gap` | `calc(--wtv-rem * 0.6)` | Space between the checkbox and the node pill |

### Border radius

| Variable | Default | Description |
|----------|---------|-------------|
| `--wtv-border-radius-sm` | `calc(0.4 * --wtv-rem)` | 4px |
| `--wtv-border-radius-lg` | `calc(0.8 * --wtv-rem)` | 8px |

### Motion

Only the contract's four speeds and its easings; there is no attribute for animations.

- **Motion off, this tree:** `web-treeview { --wtv-transition-fast: 0s; --wtv-transition-normal: 0s; --wtv-transition-medium: 0s; --wtv-transition-slow: 0s; }`
- **Motion off, page-wide (every Keenmate component):** `:root { --base-duration-fast: 0s; --base-duration-normal: 0s; --base-duration-medium: 0s; --base-duration-slow: 0s; }`
- **`prefers-reduced-motion: reduce`** sets the four `--wtv-transition-*` to `0s` (the contract does the same for `--base-duration-*`). The loader keeps turning, slower (the contract sets `--base-loader-duration: 1.5s`) — it shows state.

| Variable | Default | Description |
|----------|---------|-------------|
| `--wtv-transition-fast` | `--base-duration-fast` \| `0.1s` | Fast |
| `--wtv-transition-normal` | `--base-duration-normal` \| `0.15s` | Toggle turn, hover, tooltip fade, drop zones, checkbox, drag-denied badge |
| `--wtv-transition-medium` | `--base-duration-medium` \| `0.25s` | Medium |
| `--wtv-transition-slow` | `--base-duration-slow` \| `0.3s` | Drag-denied row tint |
| `--wtv-ease-standard` / `-out` / `-in` | `--base-ease-*` | Easings |
| `--wtv-scroll-behavior` | `--base-scroll-behavior` \| `smooth` (`auto` under reduced motion) | Programmatic jumps (`scrollToPath`, the paste reveal) when the caller passes no `behavior`; keyboard moves always scroll instantly |
| `--wtv-toggle-icon-transition` | `transform --wtv-transition-normal --wtv-ease-standard` | Expand / collapse turn of the glyph |

### Drag & drop — glow indicators

| Variable | Default | Description |
|----------|---------|-------------|
| `--wtv-drop-glow-before-color` | `rgba(134,179,152,0.8)` | Drop-before glow border color |
| `--wtv-drop-glow-after-color` | `rgba(242,182,158,0.8)` | Drop-after glow border color |
| `--wtv-drop-glow-child-color` | `rgba(167,155,198,0.8)` | Drop-as-child glow border color |
| `--wtv-drop-glow-child-bg` | `drop-glow-child-color 19%` | Drop-as-child row tint |
| `--wtv-drop-glow-size` | `3px` | Glow line thickness |
| `--wtv-drop-arrow-size` / `-position` | `calc(2.4 * --wtv-rem)` / `66%` | Drop arrow size and horizontal position |
| `--wtv-drop-arrow-{before,after,child}-rotation` | `0deg` / `0deg` / `45deg` | Drop arrow rotation |
| `--wtv-drop-arrow-{before,after,child}-image` | Lucide arrow (mask) | Drop arrow glyph |
| `--wtv-drop-zone-border-radius` | `0` | Floating drop zone radius |
| `--wtv-drop-zone-{before,after,child}-bg` | `rgba(... 0.25)` | Zone background |
| `--wtv-drop-zone-{before,after,child}-text-color` | `rgba(... 0.7)` | Zone text color |
| `--wtv-drop-zone-{before,after,child}-bg-active` | `rgba(... 0.85)` | Zone active background |
| `--wtv-drop-zone-{before,after,child}-text-color-active` | `rgb(...)` | Zone active text color |
| `--wtv-drop-zone-{before,after,child}-box-shadow-active` | `0 2px 12px rgba(... 0.4)` | Zone active box shadow |

The drop-indicator arrows are masks filled with the matching `--wtv-drop-glow-*-color` (alpha dropped),
so retinting a glow colour retints its arrow too.

### Drag & drop — state colors

| Variable | Default | Description |
|----------|---------|-------------|
| `--wtv-drag-over-bg` | `--base-drop-target-bg` \| `= --wtv-drop-valid-bg` | Drag-over node background (a valid drop target) |
| `--wtv-drag-over-border` | `2px dashed` `--base-drop-target-border-color` \| success | Drag-over node border |
| `--wtv-drag-over-box-shadow` | `0 0 8px` drop-target border color 40% | Drag-over glow shadow |
| `--wtv-drop-valid-bg` | `--base-success-bg-subtle` \| `success 10%` | Valid drop background |
| `--wtv-drop-valid-border-color` | `= --wtv-success-color` | Valid drop border color |
| `--wtv-drop-invalid-bg` | `--base-danger-bg-subtle` \| `danger 10%` | Invalid drop background |
| `--wtv-drop-invalid-border-color` | `= --wtv-danger-color` | Invalid drop border color |
| `--wtv-drag-over-highlight-bg` | `--base-drop-target-bg-active` \| `--base-success-bg-subtle-hover` \| `success 15%` | Dragover highlight background (the target under the pointer) |
| `--wtv-drag-over-highlight-border` | `2px dashed` `--base-drop-target-border-color` \| success | Dragover highlight border |
| `--wtv-touch-ghost-bg` | `accent 90%` | Touch drag ghost background |
| `--wtv-touch-ghost-text-color` | `= --wtv-text-color-on-accent` | Touch drag ghost text |
| `--wtv-touch-ghost-box-shadow` | `--base-shadow-lg` \| `0 4px 12px rgba(0,0,0,0.3)` | Touch ghost shadow |
| `--wtv-scroll-highlight-bg` | `accent 30%` | Scroll-to-node highlight |
| `--wtv-scroll-highlight-box-shadow` | `0 0 8px accent 40%` | Scroll highlight shadow |
| `--wtv-dragged-opacity` | `0.5` | Dragged node opacity |
| `--wtv-drag-denied-flash-bg` | `--base-danger-bg-subtle-hover` \| `danger 15%` (30% dark) | Row tint of the "can't move / drop here" feedback (fades in, held) |
| `--wtv-cut-opacity` | `0.4` | Cut node opacity (clipboard) |
| `--wtv-drop-placeholder-border` | `2px dashed` `--base-drop-target-border-color` \| success | Empty zone border (during drag) |
| `--wtv-drop-placeholder-bg` | `= --wtv-drag-over-bg` | Empty zone background |
| `--wtv-drop-placeholder-border-radius` | `= --wtv-border-radius-lg` | Empty zone border radius |
| `--wtv-drop-placeholder-color` | `--base-drop-target-border-color` \| success | Empty zone text |
| `--wtv-drop-placeholder-min-height` | `= --wtv-tree-min-height` | Empty zone min height |
| `--wtv-drop-placeholder-bg-hover` / `-border-color-hover` / `-box-shadow-hover` / `-scale-hover` | `= --wtv-drag-over-highlight-bg` / drop-target border color / 4px glow / `1` | Engaged zone (hover or a drag over it) |

### Context menu

The menu is core's shared menu. Every value resolves, highest precedence first:
**`--wtv-context-menu-*`** (this tree) → **`--km-menu-*`** (every Keenmate menu on the page) →
**`--base-*`** (theme) → core's default. The `--wtv-context-menu-*` variables are unset by
default (the tree maps each onto core's private `--_km-menu-*` with no fallback), so a
page-wide `--km-menu-*` reaches the tree's menu:

```css
:root { --km-menu-bg: #fffbe6; }                    /* every menu on the page */
web-treeview.files { --wtv-context-menu-bg: #eef; } /* just this tree's menu */
```

The `--km-menu-*` list (with each one's `--base-*` fallback and default) ships in
`@keenmate/web-components-core/component-variables.manifest.json`.

| Variable | Default | Description |
|----------|---------|-------------|
| `--wtv-context-menu-bg` | unset → `--km-menu-bg` | Menu background |
| `--wtv-context-menu-bg-hover` | unset → `--km-menu-hover-bg` | Item hover background |
| `--wtv-context-menu-text-color-hover` | unset → `--km-menu-hover-color` | Item text color on hover (default unchanged) |
| `--wtv-context-menu-text-color` | unset → `--km-menu-text-color` | Menu text color |
| `--wtv-context-menu-border` | unset → `--km-menu-border` | Menu border |
| `--wtv-context-menu-border-radius` | unset → `--km-menu-border-radius` | Menu border radius |
| `--wtv-context-menu-box-shadow` | unset → `--km-menu-shadow` | Menu shadow |
| `--wtv-context-menu-min-width` | unset → `--km-menu-min-width` | Menu min width |
| `--wtv-context-menu-padding` | unset → `--km-menu-padding` | Menu padding |
| `--wtv-context-menu-font-size` | unset → `--km-menu-font-size` | Menu font size |
| `--wtv-context-menu-item-padding` | unset → `--km-menu-item-padding` | Item padding |
| `--wtv-context-menu-item-gap` | unset → `--km-menu-item-gap` | Gap between icon, label, shortcut |
| `--wtv-context-menu-icon-width` | unset → `--km-menu-icon-size` | Item icon column width |
| `--wtv-context-menu-icon-font-size` | unset → `--km-menu-icon-font-size` | Item icon font size |
| `--wtv-context-menu-arrow-font-size` | unset → `--km-menu-arrow-font-size` | Submenu arrow font size |
| `--wtv-context-menu-danger-color` | unset → `--km-menu-danger-color` | Danger item text color |
| `--wtv-context-menu-danger-bg-hover` | unset → `--km-menu-danger-hover-bg` | Danger item hover background |
| `--wtv-context-menu-shortcut-color` | unset → `--km-menu-shortcut-color` | Optional: shortcut hint color |
| `--wtv-context-menu-shortcut-font-size` | unset → `--km-menu-shortcut-font-size` | Shortcut hint size |
| `--wtv-context-menu-divider-label-color` | unset → `--km-menu-divider-label-color` | Named divider label color |
| `--wtv-context-menu-toggled-color` | unset → `--km-menu-toggled-color` | Toggled item color |
| `--wtv-context-menu-divider-color` | unset → `--km-menu-divider-color` | Divider line color |
| `--wtv-context-menu-divider-margin` | unset → `--km-menu-divider-margin` | Divider margin |
| `--wtv-context-menu-disabled-opacity` | unset → `--km-menu-disabled-opacity` | Disabled item opacity |
| `--wtv-context-menu-z-index` | unset → `--km-menu-z-index` (10000) | Menu stacking order |

### Loading

| Variable | Default | Description |
|----------|---------|-------------|
| `--wtv-tree-min-height` | `calc(6 * --wtv-rem)` | Min height for empty / loading states (60px) |
| `--wtv-loader-icon` | `--base-loader-icon` \| the contract's arc | Loader shape (a `currentColor` mask) |
| `--wtv-loader-rotate` | `--base-loader-rotate` \| `1turn` | Rotation per loop (`0` = the SVG animates itself) |
| `--wtv-loader-duration` | `--base-loader-duration` \| `0.8s` | Loop period (a loop, not on the duration scale; the contract slows it to 1.5s under reduced motion — it never stops) |
| `--wtv-loader-size` | `--base-loader-size` \| `1.25em` | Loader size — the per-context sizes derive from it |
| `--wtv-loader-overlay-size` | `--wtv-loader-size * 2` | `isLoading` overlay loader |
| `--wtv-loader-inline-size` | `--wtv-loader-size * 0.75` | Per-node loader (async `beforeExpandCallback`) — the loader shape in place of the toggle glyph |
| `--wtv-loader-color` | `= --wtv-accent-color` | Loader colour (overlay + per-node) |
| `--wtv-loading-bg` | `--wtv-main-bg` at 80% | Loading overlay veil |
| `--wtv-loading-color` | `= --wtv-text-color-3` | "Loading more…" text |

The `isLoading` overlay draws through web-components-core's shared loader (`renderLoader`):
the instance `renderLoadingCallback`, else the page-wide `window.components.renderLoadingCallback`,
else the default `<span class="wtv__loader">` drawn from the tokens above. One page-wide change
(`--base-loader-*` or the page hook) restyles the loader of every Keenmate component.

### Tooltip

| Variable | Default | Description |
|----------|---------|-------------|
| `--wtv-tooltip-bg` | `--base-tooltip-bg` \| text 85% into the bg (light) / the bg lifted (dark) | Tooltip background |
| `--wtv-tooltip-text-color` | `--base-tooltip-text-color` \| `light-dark(<bg>, <text color>)` | Tooltip text color |
| `--wtv-tooltip-box-shadow` | `--base-shadow-md` \| `0 2px 8px var(--wtv-shadow-color)` | Tooltip shadow |

### Z-index

On the shared `--base-z-*` scale when the contract is loaded; the numbers are the standalone fallbacks.

| Variable | Default | Description |
|----------|---------|-------------|
| `--wtv-z-index-dropdown` | `--base-z-dropdown` \| `7500` | Context menu |
| `--wtv-tooltip-z-index` | `--base-z-tooltip` \| `9000` | Node tooltip |
| `--wtv-z-index-drop-zones` | `--base-z-tooltip + 1` \| `9001` | Floating drop-zone overlay |
| `--wtv-z-index-ghost` | `= --wtv-z-index-drop-zones + 1` | Touch drag ghost |
| `--wtv-z-index-overlay` | `10` | Loading overlay (local to the tree) |

## See also

- `component-variables.manifest.json` — the canonical machine-readable manifest of every `--wtv-*` variable, consumed by `@keenmate/theme-designer`.
- `src/css/variables.css` — the source declarations with full comments and `--base-*` chain.
- `src/css/dark-mode.css` — the Strategy B color-scheme flipping logic.
