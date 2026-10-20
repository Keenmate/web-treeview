# Theming — `@keenmate/web-treeview`

The component publishes ~110 CSS variables. The contract follows the BlissFramework theming model: every color resolves through a `--base-*` design-system token (overridable host-wide), then a `--wtv-*` component token (overridable per-instance), with `light-dark()` fallbacks that flip automatically with `color-scheme` (Strategy B). See [usage.md](./usage.md) for the API surface.

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
  --wtv-highlighted-bg: #ede9fe;
  --wtv-indent-size: 1.5rem;
  --wtv-node-height: 2rem;
  --wtv-border-radius-sm: 4px;
}

/* Per-instance theme via the attribute */
<web-treeview data-theme="dark">...</web-treeview>
<web-treeview theme="light">...</web-treeview>
```

`examples-theming.html` ships 8 complete themes (dark, neon, corporate, glassmorphism, etc.).

## Dark mode — how it flips

Every color fallback in `variables.css` uses `light-dark(<light>, <dark>)`. The active branch follows the inherited `color-scheme`. `dark-mode.css` sets `color-scheme: dark` (or `light`) on four signal selectors, in increasing specificity:

1. **OS preference**: `@media (prefers-color-scheme: dark) { :host { color-scheme: dark } }`. Default behavior — the component follows the user's OS choice with no consumer setup.
2. **Framework ancestor**: `:host-context([data-theme="dark"])`, `[data-bs-theme="dark"] .wtv__container`, `.dark .wtv__container`, plus the `light` symmetric variants. Works with Bootstrap 5.3+, Tailwind, and generic `[data-theme]` patterns.
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
| `--wtv-accent-color` | `--base-primary-color` \| `light-dark(#3b82f6, #60a5fa)` | Primary accent color |
| `--wtv-accent-color-hover` | `--base-primary-color-hover` \| `light-dark(#2563eb, #3b82f6)` | Accent hover state |
| `--wtv-text-color` | `--base-text-color-1` \| `light-dark(#1e293b, #f1f5f9)` | Primary text color |
| `--wtv-text-color-2` | `--base-text-color-3` \| `light-dark(#64748b, #94a3b8)` | Secondary / muted text |
| `--wtv-text-color-on-accent` | `--base-on-primary-text-color` \| `#ffffff` | Text on accent backgrounds |
| `--wtv-bg-color` | `--base-main-bg` \| `light-dark(#fff, #1a1a1a)` | Main background |
| `--wtv-border-color` | `--base-border-color` \| `light-dark(#e2e8f0, #3d3d3d)` | Default border color |
| `--wtv-success-color` | `--base-success-color` \| `light-dark(#198754, #4ade80)` | Success / valid color |
| `--wtv-danger-color` | `--base-danger-color` \| `light-dark(#dc3545, #f87c86)` | Danger / invalid color |
| `--wtv-light-bg` | `--base-elevated-bg` \| `light-dark(#f8f9fa, #2b2b2b)` | Elevated surface background |

### Node states

| Variable | Default | Description |
|----------|---------|-------------|
| `--wtv-hover-bg` | `--base-hover-bg` \| `color-mix(text 8%, bg)` | Base hover background |
| `--wtv-active-bg` | `--base-active-bg` \| `color-mix(text 14%, bg)` | Base active / pressed background |
| `--wtv-node-bg-hover` | `= --wtv-hover-bg` | Node hover background |
| `--wtv-node-bg-active` | `= --wtv-active-bg` | Node active / pressed background |
| `--wtv-node-transition` | `background 150ms, box-shadow 150ms ease` | Node content transition (set `none` to disable) |
| `--wtv-highlighted-bg` | `--base-highlighted-bg` \| `color-mix(accent 10%, transparent)` | Default `.wtv__node-content--highlighted` (multi-select) background tint |
| `--wtv-highlighted-bg-hover` | `--base-highlighted-bg-hover` \| `= --wtv-highlighted-bg` | Highlighted row background on hover |
| `--wtv-highlighted-text` | `--base-highlighted-text-color` \| `currentColor` | Highlighted row text color |
| `--wtv-highlighted-ring` | `--base-highlighted-outline` \| `none` | Highlighted row outline shorthand (drawn inset) |
| `--wtv-focused-bg` | `--base-focused-bg` \| `transparent` | Focused row background (only when not highlighted) |
| `--wtv-focused-text` | `--base-focused-text-color` \| `currentColor` | Focused row text color |
| `--wtv-focused-ring` | `--base-focused-outline` \| `1px solid --wtv-accent-color` | Default `.wtv__node-content--focused-default` ring — outline shorthand drawn inset (`none` to suppress) |
| `--wtv-focused-outline-offset` | `calc(-1 * var(--base-outline-width, 1px))` | Outline offset for the focus ring / highlighted border (negative = inset; follows `--base-outline-width`) |

### Border

| Variable | Default | Description |
|----------|---------|-------------|
| `--wtv-border-width-base` | `1px` | Base border width |
| `--wtv-border` | `1px solid --wtv-border-color` | Full border shorthand |

### Typography

| Variable | Default | Description |
|----------|---------|-------------|
| `--wtv-font-family` | `--base-font-family` \| `inherit` | Font family |
| `--wtv-font-size-xs` | `calc(1.2 * --wtv-rem)` | 12px |
| `--wtv-font-size-sm` | `calc(1.4 * --wtv-rem)` | 14px |
| `--wtv-font-size-base` | `calc(1.6 * --wtv-rem)` | 16px |
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
| `--wtv-column-width` | `calc(--wtv-rem * 2.4)` | Unified column width (24px) for toggle, icon, indent step |
| `--wtv-indent-size` | `= --wtv-column-width` | Tree indent per level |
| `--wtv-node-padding` | `4px 8px` | Node content padding |
| `--wtv-node-height` | `calc(--wtv-rem * 3.2)` | Node row height (32px) |
| `--wtv-icon-size` | `calc(--wtv-rem * 1.6)` | Node icon size (16px) |
| `--wtv-toggle-size` | `= --wtv-column-width` | Toggle icon column size |
| `--wtv-toggle-color` | `= --wtv-text-color-2` | Toggle icon color |

### Border radius

| Variable | Default | Description |
|----------|---------|-------------|
| `--wtv-border-radius-sm` | `calc(0.4 * --wtv-rem)` | 4px |
| `--wtv-border-radius-md` | `calc(0.6 * --wtv-rem)` | 6px |
| `--wtv-border-radius-lg` | `calc(0.8 * --wtv-rem)` | 8px |

### Transitions

| Variable | Default | Description |
|----------|---------|-------------|
| `--wtv-transition-speed` | `150ms` | Fast transition duration |
| `--wtv-transition-normal` | `200ms` | Normal transition duration |
| `--wtv-easing` | `cubic-bezier(0.4, 0, 0.2, 1)` | Default easing curve |

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

### Drag & drop — state colors

| Variable | Default | Description |
|----------|---------|-------------|
| `--wtv-drag-over-bg` | `accent 10%` | Drag-over node background |
| `--wtv-drag-over-border` | `2px dashed accent` | Drag-over node border |
| `--wtv-drag-over-glow-shadow` | `0 0 8px accent 40%` | Drag-over glow shadow |
| `--wtv-drop-valid-bg` | `success 10%` | Valid drop background |
| `--wtv-drop-valid-border-color` | `= --wtv-success-color` | Valid drop border color |
| `--wtv-drop-invalid-bg` | `danger 10%` | Invalid drop background |
| `--wtv-drop-invalid-border-color` | `= --wtv-danger-color` | Invalid drop border color |
| `--wtv-dragover-highlight-bg` | `success 15%` | Dragover highlight background |
| `--wtv-dragover-highlight-border` | `2px dashed success` | Dragover highlight border |
| `--wtv-touch-ghost-bg` | `accent 90%` | Touch drag ghost background |
| `--wtv-touch-ghost-shadow` | `0 4px 12px rgba(0,0,0,0.3)` | Touch ghost shadow |
| `--wtv-scroll-highlight-bg` | `accent 30%` | Scroll-to-node highlight |
| `--wtv-scroll-highlight-shadow` | `0 0 8px accent 40%` | Scroll highlight shadow |
| `--wtv-dragged-opacity` | `0.5` | Dragged node opacity |
| `--wtv-cut-opacity` | `0.4` | Cut node opacity (clipboard) |
| `--wtv-empty-zone-border` | `2px dashed accent` | Empty zone border (during drag) |
| `--wtv-empty-zone-bg` | `accent 10%` | Empty zone background |
| `--wtv-empty-zone-radius` | `= --wtv-border-radius-lg` | Empty zone border radius |

### Context menu

Each variable defaults to the corresponding higher-order `--wtv-*` variable, so the menu inherits the tree's theme by default but can be styled independently.

| Variable | Default | Description |
|----------|---------|-------------|
| `--wtv-context-menu-bg` | `--base-dropdown-bg` \| `--base-elevated-bg` \| `= --wtv-bg-color` | Menu background |
| `--wtv-context-menu-bg-hover` | `= --wtv-hover-bg` | Item hover background |
| `--wtv-context-menu-text-color` | `= --wtv-text-color` | Menu text color |
| `--wtv-context-menu-border` | `1px solid --wtv-border-color` | Menu border |
| `--wtv-context-menu-border-radius` | `= --wtv-border-radius-lg` | Menu border radius |
| `--wtv-context-menu-shadow` | `0 4px 16px rgba(0,0,0,0.12)` | Menu shadow |
| `--wtv-context-menu-min-width` | `calc(--wtv-rem * 15)` | Menu min width (~150px) |
| `--wtv-context-menu-padding` | `--wtv-spacing-sm 0` | Menu padding |
| `--wtv-context-menu-font-size` | `= --wtv-font-size-sm` | Menu font size |
| `--wtv-context-menu-item-padding` | `--wtv-spacing-md --wtv-spacing-xl` | Item padding |
| `--wtv-context-menu-item-gap` | `= --wtv-spacing-md` | Gap between icon, label, shortcut |
| `--wtv-context-menu-icon-width` | `= --wtv-icon-size` | Item icon column width |
| `--wtv-context-menu-icon-font-size` | `= --wtv-font-size-xs` | Item icon font size |
| `--wtv-context-menu-arrow-font-size` | `= --wtv-font-size-xs` | Submenu arrow font size |
| `--wtv-context-menu-danger-color` | `= --wtv-danger-color` | Danger item text color |
| `--wtv-context-menu-danger-bg-hover` | `danger 10%` | Danger item hover background |
| `--wtv-context-menu-divider-color` | `= --wtv-border-color` | Divider line color |
| `--wtv-context-menu-divider-margin` | `--wtv-spacing-sm 0` | Divider margin |
| `--wtv-context-menu-disabled-opacity` | `0.5` | Disabled item opacity |

### Loading

| Variable | Default | Description |
|----------|---------|-------------|
| `--wtv-tree-min-height` | `calc(6 * --wtv-rem)` | Min height for empty / loading states (60px) |
| `--wtv-spinner-size` | `32px` | Spinner size |
| `--wtv-spinner-track` | `= --wtv-border-color` | Spinner track color |
| `--wtv-spinner-color` | `= --wtv-accent-color` | Spinner accent color |
| `--wtv-loading-bg` | `light-dark(rgba(255,255,255,0.8), rgba(26,26,26,0.8))` | Loading overlay background |

### Z-index

| Variable | Default | Description |
|----------|---------|-------------|
| `--wtv-z-index-dropdown` | `1000` | Context menu, drop zones |
| `--wtv-z-index-ghost` | `10000` | Touch drag ghost |
| `--wtv-z-index-overlay` | `10` | Loading overlay |

## See also

- `component-variables.manifest.json` — the canonical machine-readable manifest of every `--wtv-*` variable, consumed by `@keenmate/theme-designer`.
- `src/css/variables.css` — the source declarations with full comments and `--base-*` chain.
- `src/css/dark-mode.css` — the Strategy B color-scheme flipping logic.
