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
<web-treeview theme="light">...</web-treeview>
```

`examples-theming.html` ships 8 complete themes (dark, neon, corporate, glassmorphism, etc.).

> **Derived `--base-*` tokens resolve where the contract declares them.** `@keenmate/base-css-variables`
> 2.0 computes tokens such as `--base-selected-bg` or `--base-primary-bg-subtle` on `:root`,
> `[data-theme]` and `.base-scope`. Setting an *input* (`--base-primary-color`) on a plain wrapper
> `<div>` does not recompute them there — add `class="base-scope"` to that wrapper, or set the
> `--wtv-*` variable directly.

## Dark mode — how it flips

Every color fallback in `variables.css` uses `light-dark(<light>, <dark>)`. The active branch follows the inherited `color-scheme`. `dark-mode.css` sets `color-scheme: dark` (or `light`) on four signal selectors, in increasing specificity:

1. **OS preference**: `@media (prefers-color-scheme: dark) { :host { color-scheme: dark } }`. Default behavior — the component follows the user's OS choice with no consumer setup.
2. **Page signal**: `data-theme`, `data-bs-theme` or `.dark` / `.light` on `<html>` (then `<body>`) — Bootstrap 5.3+, Tailwind, Pure Admin. `@keenmate/web-components-core` detects it once per page, shares it with every Keenmate component and mirrors it onto the host as `data-context-theme`; `dark-mode.css` reads `:host([data-context-theme="dark|light"])`. No `:host-context()`, so it works in Firefox and Safari, and a page set to light beats an OS set to dark.
   - **A themed section** (signal on a wrapper, not `<html>` / `<body>`): add `theme-source="closest"` (nearest ancestor with a signal) or `theme-source="<selector>"` to the tree.
   - **Force every component**: `import { setThemeMode } from '@keenmate/web-components-core'; setThemeMode('dark')` (`'light' | 'dark' | 'auto'`).
3. **Per-instance attribute**: `:host([data-theme="dark"])` and `.wtv__container[data-theme="dark"]` — set `<web-treeview data-theme="dark">` to force a single tree against the page default.
4. **`theme` prop forwarding**: setting `tree.theme = 'dark'` is equivalent to `data-theme="dark"` (forwarded on the inner container).

Edge case: if the consumer FORCES light (`:root { color-scheme: light }`) but the OS prefers dark, the component still flips to dark via signal #1. To lock a single instance to light in that case, use signal #3 (`<web-treeview data-theme="light">`).

## Cascade layers

`main.css` declares `@layer variables, component, overrides;` and wraps every `@import` in `layer(...)`. Component rules sit inside layers, so any consumer CSS *outside* a layer beats *any* component rule without specificity tricks. To override from inside a layer, declare a later layer in the consumer's own stylesheet.

> Caveat: an unlayered CSS reset (`* { all: unset }`) loaded after the component will still wipe component styles. The layer contract only protects rules consumers write; it does not insulate against blanket resets.

## CSS variable reference

### Core colors

| Variable | Default | Description |
|----------|---------|-------------|
| `--wtv-accent-color` | `--base-primary-color` \| `#0ea5e9` | Primary accent color |
| `--wtv-accent-color-hover` | `--base-primary-color-hover` \| accent 15% toward black (white in dark) | Accent hover state |
| `--wtv-text-color` | `--base-text-color-1` \| `light-dark(#1e293b, #f1f5f9)` | Primary text color |
| `--wtv-text-color-2` | `--base-text-color-3` \| `light-dark(#64748b, #94a3b8)` | Secondary / muted text |
| `--wtv-text-color-on-accent` | `--base-on-primary-text-color` \| `#ffffff` | Text on accent backgrounds |
| `--wtv-bg-color` | `--base-main-bg` \| `light-dark(#fff, #1a1a1a)` | Main background |
| `--wtv-border-color` | `--base-border-color` \| `light-dark(#e2e8f0, #3d3d3d)` | Default border color |
| `--wtv-success-color` | `--base-success-color` \| `#10b981` | Success / valid color |
| `--wtv-danger-color` | `--base-danger-color` \| `#dc2626` | Danger / invalid color (fills, borders, tints) |
| `--wtv-danger-text-color` | `--base-danger-text-color` \| `light-dark(#721c24, #f87171)` | Danger as text (context menu danger item) |
| `--wtv-light-bg` | `--base-elevated-bg` \| `light-dark(#f8f9fa, #2b2b2b)` | Elevated surface background |

### Node states

| Variable | Default | Description |
|----------|---------|-------------|
| `--wtv-hover-bg` | `--base-hover-bg` \| `color-mix(text 8%, bg)` | Base hover background |
| `--wtv-active-bg` | `--base-active-bg` \| `color-mix(text 14%, bg)` | Base active / pressed background |
| `--wtv-node-bg-hover` | `= --wtv-hover-bg` | Node hover background |
| `--wtv-node-bg-active` | `= --wtv-active-bg` | Node active / pressed background |
| `--wtv-node-transition` | `none` | Node content transition (e.g. `background var(--wtv-transition-speed)` to animate) |
| `--wtv-selected-bg` | `--base-selected-bg` \| `--base-primary-bg-subtle` \| accent 10% (20% dark) | Selected row (click / Ctrl / Shift-click set) background tint; row class `.wtv__node-content--highlighted` |
| `--wtv-selected-bg-hover` | `--base-selected-bg-hover` \| `= --wtv-selected-bg` | Selected row background on hover |
| `--wtv-selected-text` | `--base-selected-text-color` \| `currentColor` | Selected row text color |
| `--wtv-selected-ring` | `--base-selected-outline` \| `none` | Selected row outline shorthand (drawn inset) |
| `--wtv-focused-bg` | `--base-focused-bg` \| `transparent` | Focused row background (only when not selected) |
| `--wtv-focused-text` | `--base-focused-text-color` \| `currentColor` | Focused row text color |
| `--wtv-focused-ring` | `--base-focused-outline` \| `1px solid --wtv-accent-color` | Default `.wtv__node-content--focused-default` ring — outline shorthand drawn inset (`none` to suppress) |
| `--wtv-focused-outline-offset` | `calc(-1 * var(--base-outline-width, 1px))` | Outline offset for the focus ring / selected ring (negative = inset; follows `--base-outline-width`) |

The old `--wtv-highlighted-bg` / `-bg-hover` / `-text` / `-ring` names still work when set on the element (deprecated; removed with the `highlightedPaths` → `selectedPaths` API rename).

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
| `--wtv-column-width` | `calc(--wtv-rem * 2.4)` | Toggle / icon column width (24px) |
| `--wtv-indent-size` | `calc(--wtv-rem * 1.6)` | Indent per level (16px) — its own knob |
| `--wtv-node-padding` | `--wtv-spacing-sm --wtv-spacing-md` | Node content padding (4px 8px) |
| `--wtv-node-height` | `calc(--wtv-rem * 2.4)` | Minimum row height (24px) |
| `--wtv-icon-size` | `calc(--wtv-rem * 1.6)` | Node icon size (16px) |
| `--wtv-toggle-color` | `= --wtv-text-color-2` | Toggle icon color |
| `--wtv-checkbox-gap` | `calc(--wtv-rem * 0.6)` | Space between the checkbox and the node pill |

### Border radius

| Variable | Default | Description |
|----------|---------|-------------|
| `--wtv-border-radius-sm` | `calc(0.4 * --wtv-rem)` | 4px |
| `--wtv-border-radius-lg` | `calc(0.8 * --wtv-rem)` | 8px |

### Transitions

| Variable | Default | Description |
|----------|---------|-------------|
| `--wtv-transition-speed` | `--base-duration-normal` \| `150ms` | Transition duration (empty zone, tooltip fade) |

### Drag & drop — glow indicators

| Variable | Default | Description |
|----------|---------|-------------|
| `--wtv-glow-before-color` | `rgba(134,179,152,0.8)` | Drop-before glow border color |
| `--wtv-glow-after-color` | `rgba(242,182,158,0.8)` | Drop-after glow border color |
| `--wtv-glow-child-color` | `rgba(167,155,198,0.8)` | Drop-as-child glow border color |
| `--wtv-glow-{before,after,child}-bg` | `rgba(... 0.25)` | Zone background |
| `--wtv-glow-{before,after,child}-bg-active` | `rgba(... 0.85)` | Zone active background |
| `--wtv-glow-{before,after,child}-color-active` | `rgb(...)` | Zone active text color |
| `--wtv-glow-{before,after,child}-shadow` | `0 2px 12px rgba(... 0.4)` | Zone active box shadow |
| `--wtv-glow-{before,after,child}-text` | `rgba(... 0.7)` | Default zone text color |

The drop-indicator arrows are masks filled with the matching `--wtv-glow-*-color` (alpha dropped),
so retinting a glow colour retints its arrow too.

### Drag & drop — state colors

| Variable | Default | Description |
|----------|---------|-------------|
| `--wtv-drag-over-bg` | `--base-primary-bg-subtle` \| `accent 10%` | Drag-over node background |
| `--wtv-drag-over-border` | `2px dashed accent` | Drag-over node border |
| `--wtv-drag-over-glow-shadow` | `0 0 8px accent 40%` | Drag-over glow shadow |
| `--wtv-drop-valid-bg` | `--base-success-bg-subtle` \| `success 10%` | Valid drop background |
| `--wtv-drop-valid-border-color` | `= --wtv-success-color` | Valid drop border color |
| `--wtv-drop-invalid-bg` | `--base-danger-bg-subtle` \| `danger 10%` | Invalid drop background |
| `--wtv-drop-invalid-border-color` | `= --wtv-danger-color` | Invalid drop border color |
| `--wtv-dragover-highlight-bg` | `--base-success-bg-subtle-hover` \| `success 15%` | Dragover highlight background |
| `--wtv-dragover-highlight-border` | `2px dashed success` | Dragover highlight border |
| `--wtv-touch-ghost-bg` | `accent 90%` | Touch drag ghost background |
| `--wtv-touch-ghost-shadow` | `--base-shadow-lg` \| `0 4px 12px rgba(0,0,0,0.3)` | Touch ghost shadow |
| `--wtv-scroll-highlight-bg` | `accent 30%` | Scroll-to-node highlight |
| `--wtv-scroll-highlight-shadow` | `0 0 8px accent 40%` | Scroll highlight shadow |
| `--wtv-dragged-opacity` | `0.5` | Dragged node opacity |
| `--wtv-drag-denied-flash-bg` | `danger 18%` | Optional: pulse of the "can't move / drop here" row |
| `--wtv-cut-opacity` | `0.4` | Cut node opacity (clipboard) |
| `--wtv-empty-zone-border` | `2px dashed accent` | Empty zone border (during drag) |
| `--wtv-empty-zone-bg` | `--base-primary-bg-subtle` \| `accent 10%` | Empty zone background |
| `--wtv-empty-zone-radius` | `= --wtv-border-radius-lg` | Empty zone border radius |

### Context menu

Each variable defaults to the corresponding higher-order `--wtv-*` variable, so the menu inherits the tree's theme by default but can be styled independently.

| Variable | Default | Description |
|----------|---------|-------------|
| `--wtv-context-menu-bg` | `--base-dropdown-bg` \| `= --wtv-bg-color` | Menu background |
| `--wtv-context-menu-bg-hover` | `= --wtv-hover-bg` | Item hover background |
| `--wtv-context-menu-text-color` | `= --wtv-text-color` | Menu text color |
| `--wtv-context-menu-border` | `--base-dropdown-border` \| `--wtv-border-width solid --wtv-border-color` | Menu border |
| `--wtv-context-menu-border-radius` | `= --wtv-border-radius-sm` | Menu border radius |
| `--wtv-context-menu-shadow` | `--base-dropdown-box-shadow` \| `0 2px 10px rgba(0,0,0,0.15)` | Menu shadow |
| `--wtv-context-menu-min-width` | `calc(--wtv-rem * 15)` | Menu min width (~150px) |
| `--wtv-context-menu-padding` | `--wtv-spacing-sm 0` | Menu padding |
| `--wtv-context-menu-font-size` | `= --wtv-font-size-sm` | Menu font size |
| `--wtv-context-menu-item-padding` | `--wtv-spacing-md --wtv-spacing-xl` | Item padding |
| `--wtv-context-menu-item-gap` | `= --wtv-spacing-md` | Gap between icon, label, shortcut |
| `--wtv-context-menu-icon-width` | `= --wtv-icon-size` | Item icon column width |
| `--wtv-context-menu-icon-font-size` | `= --wtv-font-size-xs` | Item icon font size |
| `--wtv-context-menu-arrow-font-size` | `= --wtv-font-size-xs` | Submenu arrow font size |
| `--wtv-context-menu-danger-color` | `= --wtv-danger-text-color` | Danger item text color |
| `--wtv-context-menu-danger-bg-hover` | `--base-danger-bg-subtle` \| `danger 10%` | Danger item hover background |
| `--wtv-context-menu-shortcut-color` | `= --wtv-text-color-2` | Optional: shortcut hint color |
| `--wtv-context-menu-divider-color` | `= --wtv-border-color` | Divider line color |
| `--wtv-context-menu-divider-margin` | `--wtv-spacing-sm 0` | Divider margin |
| `--wtv-context-menu-disabled-opacity` | `--base-disabled-opacity` \| `0.5` | Disabled item opacity |

### Loading

| Variable | Default | Description |
|----------|---------|-------------|
| `--wtv-tree-min-height` | `calc(6 * --wtv-rem)` | Min height for empty / loading states (60px) |
| `--wtv-spinner-size` | `calc(--wtv-rem * 3.2)` | Spinner size (32px) |
| `--wtv-spinner-track` | `= --wtv-border-color` | Spinner track color |
| `--wtv-spinner-color` | `= --wtv-accent-color` | Spinner accent color |
| `--wtv-loading-bg` | `--wtv-bg-color` at 80% | Loading overlay veil |

### Tooltip

| Variable | Default | Description |
|----------|---------|-------------|
| `--wtv-tooltip-bg` | `--base-tooltip-bg` \| `light-dark(#333, #f5f5f5)` | Tooltip background |
| `--wtv-tooltip-color` | `--base-tooltip-text-color` \| `light-dark(#fff, #1a1a1a)` | Tooltip text color |
| `--wtv-tooltip-shadow` | `--base-shadow-md` \| `0 2px 8px rgba(0,0,0,0.15)` | Tooltip shadow |

### Z-index

On the shared `--base-z-*` scale when the contract is loaded; the numbers are the standalone fallbacks.

| Variable | Default | Description |
|----------|---------|-------------|
| `--wtv-z-index-dropdown` | `--base-z-dropdown` \| `1000` | Context menu |
| `--wtv-tooltip-z-index` | `--base-z-tooltip` \| `10000` | Node tooltip |
| `--wtv-z-index-drop-zones` | `--base-z-tooltip + 1` \| `10000` | Floating drop-zone overlay |
| `--wtv-z-index-ghost` | `= --wtv-z-index-drop-zones + 1` | Touch drag ghost |
| `--wtv-z-index-overlay` | `10` | Loading overlay (local to the tree) |

## See also

- `component-variables.manifest.json` — the canonical machine-readable manifest of every `--wtv-*` variable, consumed by `@keenmate/theme-designer`.
- `src/css/variables.css` — the source declarations with full comments and `--base-*` chain.
- `src/css/dark-mode.css` — the Strategy B color-scheme flipping logic.
