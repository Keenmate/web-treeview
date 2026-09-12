# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [2.0.0-rc09] - 2026-08-14

Parity sync with **`@keenmate/svelte-treeview` rc13 + rc14**: the remaining
clipboard/drag overhaul items plus the rc14 feature set. Most of rc13 had already
landed; this release closes the gap.

### Added

- **`iconSet` (attr `icon-set`, default `'chevron'`) — one disclosure-glyph knob
  chained to the shared `--base-icon-*` contract.** The toggle marker is now a
  single mask-image glyph read from ONE variable set (`--wtv-icon-expand` /
  `--wtv-icon-collapse` + `--wtv-icon-rotate-collapsed` / `-expanded`), and
  `icon-set` just re-points those variables — `chevron` → `--base-icon-chevron`,
  `triangle` → `--base-icon-caret-down`, `plus-minus` → `--base-icon-expand` /
  `--base-icon-collapse` (a swap set), `arrow` → inline Lucide arrows. A theme that
  reskins `--base-icon-chevron` now reskins the tree's disclosure alongside every
  other KeenMate component. The attribute reflects to the host so the
  `:host([icon-set])` CSS matches whether set via attribute or the JS property.
  Replaces the old family of four parallel text-glyph classes (`--expand-alt` /
  `--expand-plus` / `--expand-arrow` / …). Parity with `@keenmate/svelte-treeview`.
- **Per-set glyph rotation tokens (`--wtv-icon-rotate-collapsed` /
  `--wtv-icon-rotate-expanded`).** A base glyph won't always point the way the
  component assumes (a caret points down, a chevron points right), so each icon-set
  declares its own rotation offsets — same pattern as web-multiselect /
  web-daterangepicker's `--*-icon-rotate-*`. A correctly-oriented custom glyph
  leaves them at 0deg.

- **`displayValueFallback` (attr `display-value-fallback`, default `'[N/A]'`)** —
  the text shown for a node with no resolvable display value is now configurable
  (empty renders nothing). Carried as a mutable property on the LTree
  (`getNodeDisplayValue` reads it); a runtime change bumps the affected rows'
  `_rev` so the fallback labels repaint. Resolution order stays member → callback →
  fallback.
- **`touchDragDelay` (attr `touch-drag-delay`, default `300`)** — the long-press
  hold before a touch-drag engages is now configurable (was a hardcoded 300ms).
- **Blocked-action feedback — `onNodeDragDenied` / `onNodeDropDenied` events
  (`node-drag-denied` / `node-drop-denied` DOM events) + `shouldIndicateUndraggable`
  (attr `indicate-undraggable`, default `true`).** Long-pressing a locked
  (non-draggable) node now plays a "can't move this" reaction — a 🚫 badge held on
  the row (pulsing red tint) for as long as the finger stays down, plus a distinct
  haptic double-buzz. The target-side twin flashes the same 🚫 briefly on a node
  that refuses a drop. Both fire their event regardless of the built-in visual;
  `shouldIndicateUndraggable` toggles just the badge + haptic. New CSS hooks
  `.wtv__node-content--drag-denied` + `.wtv__drag-denied-badge`
  (`--wtv-drag-denied-flash-bg`).
- **`cascadeSelectPolicy` (attr `cascade-select-policy`, default `'rolled-up'`)** —
  a second, orthogonal checkbox knob controlling which paths the selection EMITS in
  cascade mode. The controller keeps the CANONICAL checked set on `_selectedPaths`
  (renderer checkboxes read it) and derives an emitted projection via
  `_projectSelection`: `'rolled-up'` = minimal cover (a fully-checked subtree
  collapses to its root), `'leaves'` = only checked leaves, `'all'` = every
  fully-checked node. `getSelectedPaths()` + the `selection-change` event now expose
  the projection; a parent SET of the checkbox set is cascade-expanded back to
  canonical, so round-trips are stable. New `emittedPaths` getter + exported
  `CascadeSelectPolicy` type. ONLY applies in cascade mode.
- **`beforeDragStartCallback(ctx) => string[] | false | void`** — a set-level
  PRE-drag interceptor that can prune, augment, or veto the dragged set. Fires once
  at drag start (mouse + touch) with the COMPLETE flattened set (`{ lead, dragged,
  event }`); return an authoritative `string[]` manifest (a descendant omitted from
  a kept root becomes a HOLE left behind), `false` to cancel, or `void` to keep the
  default. New `DragStartContext` type.
- **`moveNodes` / `duplicateNodes`** — symmetric batch move/copy primitives with a
  manifest-hole model. `moveNodes(paths, target, position)` relocates whole subtrees
  and re-homes any omitted descendant (hole) to its root's old parent;
  `duplicateNodes(paths, target, position, transform?, sourceTree?)` is the copy-side
  twin (a hole is simply not copied) and accepts a foreign `sourceTree` for
  cross-tree copies. The multi-drag move, the drag-copy branch, and `DropGroup`
  routing all delegate to them. `copyNodeWithDescendants` now passes the live source
  node to its transform and supports a `null` return (skip node + subtree).
- **`shouldEnableTreeDropZone` (attr `enable-tree-drop-zone`, default `false`)** —
  makes the whole populated tree ONE drop target: a drop anywhere lands with
  `target = null` regardless of per-node drop rules, so you route each item from
  `beforeDropCallback`. The container carries fallback `dragover`/`drop`; a node that
  rejects a drop forwards to the zone handler. Engaged outline via
  `.wtv__tree-drop-zone--active`.
- **Cross-tree AUTO-copy.** A cross-tree copy-drop (Ctrl+drag, or forced via
  `beforeDropCallback` returning `{ operation: 'copy' }`) with `shouldAutoHandleCopy`
  is now placed BY THE LIBRARY — it reaches the source tree through the clipboard
  registry and runs `duplicateNodes(sourceTree)`, honouring any `beforeDragStart`
  holes via a placement manifest published on both the module-level drag set and the
  drop `dataTransfer` (`application/svelte-treeview-manifest`, cross-compatible with
  svelte-treeview).
- **Drop-zone engaged feedback** — the empty drop zone lights up on hover AND while a
  drag hovers it (`.wtv__empty-zone--active`, since an in-flight HTML5 drag suppresses
  `:hover`).

### Changed

- **The checkbox is now a custom box-span control (was a native `<input>` styled with
  `accent-color`).** It renders the same structure as pure-admin `.pa-checkbox` and
  `@keenmate/svelte-treeview` — a `<label class="wtv__checkbox">` wrapping a
  visually-hidden native `<input>` plus a `.wtv__checkbox-box` span — so the whole
  KeenMate suite shares ONE checkbox implementation instead of three. The checkmark and
  tri-state dash are `currentColor` masks chained to the shared `--base-icon-check` /
  `--base-icon-indeterminate` contract (new `--wtv-icon-check` / `--wtv-icon-indeterminate`),
  tinted by the new `--wtv-checkbox-checkmark-color`; a full `--wtv-checkbox-*` var set
  (size, border, bg, checked bg/border) is now themeable. The native input stays the
  source of truth for `:checked` / `:indeterminate` and keyboard/a11y; the delegated
  click handler `preventDefault`s the label so only the controller toggles state. New
  manifest entries for the two base tokens + the `--wtv-icon-*` / `--wtv-checkbox-*` vars.
- **The default disclosure glyph is now the Lucide chevron, not the filled ▶/▼
  triangle**, and it renders as a currentColor mask instead of a Unicode text
  glyph (`content: '\25B6'`). This matches `@keenmate/svelte-treeview` and is an
  exact `--base-icon-chevron` match. Pass `icon-set="triangle"` to keep the old
  look. **Deprecated:** `expandIconClass` / `collapseIconClass` — for the built-in
  glyph, selection and expand↔collapse swap are now handled by `icon-set` +
  `toggleIconMode` in CSS. They remain a working **escape hatch** for a *custom*
  glyph class (e.g. FontAwesome), which isn't a CSS mask and so can't be repainted:
  in `swap` mode the renderer still swaps `expandIconClass` ↔ `collapseIconClass`,
  and in `rotate` mode the custom glyph still rotates (rotation is keyed off the
  shared `.wtv__toggle-icon.wtv__clickable`, not the built-in `--expand`, so a
  replaced glyph class still turns). `toggleIconMode` now reflects to the host
  attribute (needed by the swap CSS).
- **`beforeDropCallback` migrated from its 5-arg positional form to a single
  `BeforeDropContext` object** (`{ target, dragged, position, operation, event }`,
  symmetric with `NodeDropContext`), and its return widened to accept a
  **`DropGroup[]`** for content-addressed routing — fan one drop out to several
  destinations (the library auto-executes groups for same-tree nodes). New
  `BeforeDropContext` / `DropGroup` exports. **Breaking** for existing
  `beforeDropCallback` consumers.
- **The two clipboard transforms are renamed and made direction-neutral:**
  `copyNodeTransformationCallback` → **`nodeOutputTransformationCallback`** (egress),
  `pasteNodeTransformationCallback` → **`nodeInputTransformationCallback`** (ingress);
  `NodeTransformContext.phase` `'copy' | 'paste'` → **`'output' | 'input'`**. They
  now fire for BOTH clipboard and drag. **Breaking** rename.
- **Default cascade emission is now `'rolled-up'`, not the full checked set.** In
  cascade mode `getSelectedPaths()` + `selection-change` previously exposed every
  fully-checked node (= the new `'all'` policy); they now default to the minimal
  cover. Pass `cascadeSelectPolicy="all"` to restore. **Breaking** for cascade
  consumers.

### Fixed

- **Touch drag-and-drop under touch environments (most visibly Chrome DevTools
  device emulation).** The native `draggable` attr swallowed the synthetic
  `touchmove`/`touchend` stream (Chrome tried to hand the gesture to its
  mouse-driven HTML5 drag engine), freezing the drag mid-flight. On `touchstart` the
  node's `draggable` is now toggled off synchronously and restored on
  `touchend`/`touchcancel`. Scoped to touch, so mouse-drag is unaffected.

### Notes

- Virtual-scroll uniform-row-height (svelte-treeview rc14's `flatGap` fix) is **N/A**
  here: web-treeview is virtual-scroll-first and already enforces uniform rows
  (single-line label truncation + `min-height`), with no per-row level-transition
  margin in flat mode. No change required.

## [2.0.0-rc08] - 2026-08-04

Migrated onto **`@keenmate/web-components-core`** (`BlissElement` + the reactive
input model), following `@keenmate/web-multiselect` and
`@keenmate/web-daterangepicker`. The `WebTreeView` engine (`treeview.ts`,
`controller/`, `renderer/`, `ltree/`) and ALL CSS are UNCHANGED — only the
custom-element plumbing was replaced (the one deliberate engine touch is a
debug-only log line on expand/collapse; see Added). No consumer-facing
attribute/event/method changes.

### Changed

- **`web-component.ts`: the hand-coded plumbing is gone.** The `ATTRIBUTE_TABLE`,
  `JS_CALLBACK_FIELDS`, `observedAttributes`, `attributeChangedCallback`,
  `readAttrValue`, the `_scheduleUpdate` microtask batcher, and ~100
  property/callback getters/setters collapse into one `static inputs` table +
  `static events` on `BlissElement`. Core owns parsing, validation, reactivity
  coalescing, reflection, and the per-input accessors. The element keeps only the
  treeview-specific bridge to the engine (`reinit`/`update`/`connect`/`disconnect`
  hooks), the DOM-event wrappers, and the custom-styles (`@import`/`@font-face`)
  injection. The public imperative `update(props)` is preserved (it widens core's
  `update` hook). The 13 DOM events (`node-clicked`, `node-double-click`, `copy`,
  `cut`, `paste`, `delete`, `node-drag-*`, `highlight-change`, `selection-change`,
  `tree-changed`, `focused-node-changed`) are declared in `static events` with
  `property: false` (no managed `on<Name>` handler property — their names would
  collide with the identically-named engine callbacks, and the old API always used
  `addEventListener`). Event-bridge wrappers read `this.config` lazily, so
  assigning a bridged callback after connect now takes effect without breaking the
  DOM-event dispatch (the old wrappers captured the callback at build time).
- **`logger.ts` / `perf-logger.ts`: thin shims over core logging (SPEC §12.1).**
  The vendored `loglevel` + `loglevel-plugin-prefix` copies under `src/vendor/`
  are deleted. `logger.ts` builds its `TREEVIEW:{INIT,DATA,INDEX,UI,DRAG,RENDER}`
  loggers from core `createLoggers('TREEVIEW', …)`; `perf-logger.ts` keeps its rich
  timing API (threshold, items/sec, metadata, per-tree summaries — core's minimal
  `createPerfLogger` doesn't cover it) but sources its `TREEVIEW:PERF` logger from
  core too.
- **`index.ts`: the `window.components['web-treeview']` block → `registerComponent()`.**
  One core call publishes build metadata + the flattened logging controls and
  wires `getInstances()` to the live-instance registry BlissElement maintains.
- **CEM tooling added.** `custom-elements-manifest.config.mjs =
  blissAnalyzerConfig({ … })` with `cssVariablesFromManifestPlugin` + the VS Code /
  JetBrains editor-integration generators. `npm run build` now runs `cem analyze`
  first; the manifest (`custom-elements.json`), `web-types.json`, and the VS Code
  custom-data files ship from the `static inputs` / `static events` tables
  (67 attributes / 13 events).
- **Depends on `@keenmate/web-components-core@1.0.0-rc01`** (exact pin).
  `@floating-ui/dom` and `flexsearch` stay direct dependencies (the engine keeps
  its own positioning + search).

### Added

- **Expand/collapse now logs under the `UI` category.** `toggleNodeExpanded`
  (`controller/tree-controller.ts`) gains a `uiLogger.debug("Node expanded/collapsed:
  <path>", …)` line — clicking a node's toggle chevron previously produced no
  category log at all (only `TREEVIEW:PERF` timing, and only when perf logging was
  on), so the logging demo's promise that expand/collapse yields logs was untrue.
  The blocked-toggle collapsibility gate still returns before the log, so a
  no-op toggle correctly logs nothing.
- **`examples-logging.html` rebuilt around the `window.components` registry**, to
  match `@keenmate/web-multiselect`'s reworked page: a live registry inspector for
  `window.components['web-treeview']` (version / config / logging pills /
  `getInstances()` count), logging controls driven through the flattened
  `.logging` bundle, and an add/remove live-instance demo with a cross-instance
  fan-out. Fixes a stale reference: the missing **`INDEX`** category (search
  indexing) is now listed and gets its own "Only INDEX" button — the page had only
  5 of the 6 `TREEVIEW:*` categories. Perf logging and the debug overlay are kept
  as their own cards, labelled as a separate module (perf is not part of the
  `.logging` bundle).
- **All example pages audited against the current API and corrected.** Swept the
  root `examples-*.html` + `examples/vanilla.html` for stale attributes, enums,
  properties, methods, events, and code snippets. Fixes: `deselectAll()` (never a
  method) → `clearSelection()` in `examples-multiselect.html` (3×) and
  `examples-drag-drop.html` (2×); a dead `selected-node-changed` listener +
  `e.detail.selectedNode` → `focused-node-changed` + `e.detail.focusedNode` in
  `examples/vanilla.html` (and the same stale event name in `examples-basic.html`
  prose); `node.childrenCount` (not on `LTreeNode`) → `Object.keys(node.children).length`
  in `examples-icons-grid.html`; and three non-existent CSS variables in
  `examples-theming.html` (`--wtv-glow-above-color`/`--wtv-glow-below-color` →
  `--wtv-glow-before-color`/`--wtv-glow-after-color`; the inert `--wtv-border-radius-md`
  removed — the component only reads `-sm`/`-lg`).

### Fixed

- **`drop-zone-start` silently dropped the `px`/`%` string form (migration regression).**
  The config contract is `number | string` ("a number is a percentage of node
  width; a string is used as-is"), and the old property setter passed strings
  through — so `el.dropZoneStart = "50px"` worked. The migration wired the input to
  `toInt()`, which narrowed it to an integer, so a `px` string was coerced to a bare
  number and re-interpreted as a **percentage**. Restored parity with a dedicated
  `toCustom<number | string>` converter (bare-numeric attribute → number/percentage,
  matching the old `parseInt`; anything else kept as a string). The
  `examples-drag-drop.html` "33% or 50px" control now behaves as advertised.
- **`drag-drop-mode` IntelliSense/manifest description listed wrong values.** It read
  "off / internal / self / …"; the actual values are `none` (off), `self`, `cross`,
  `both`. Corrected the `InputDef` description (feeds `custom-elements.json` /
  web-types).

## [2.0.0-rc07] - 2026-07-05

Structural parity port of the `@keenmate/svelte-treeview` rc11–rc13 wave: every
event/callback signature is synchronized to a single context object, plus built-in
Delete, an `onTreeKeydown` interceptor, empty-tree paste, and the deep clipboard
machinery (cross-tree cut, transforms, per-entry skip).

### Changed

- **All fire-and-forget event callbacks now take ONE context object and use the `on*` naming** (was positional, mixed naming). `nodeClickedCallback(node)` → `onNodeClick(ctx)`, `nodeDragStartCallback(node, event)` → `onNodeDragStart(ctx)`, `nodeDragOverCallback(node, event)` → `onNodeDragOver(ctx)`, `nodeDropCallback(dropNode, draggedNode, position, event, operation)` → `onNodeDrop(ctx)`, `selectionChangeCallback(nodes, paths)` → `onSelectionChange(ctx)`, `highlightChangeCallback(paths, nodes)` → `onHighlightChange(ctx)`. `onNodeDoubleClick`, `onCopy`, `onCut` also switch from positional args to a ctx object. The shared shape is `NodeRef<T> = { path, node, parent, siblings }` (built by `controller.nodeRef()`), so a handler gets the node's live parent + siblings without a `getNodeByPath(parentPath)` round-trip. `onNodeDrop`'s `NodeDropContext` carries `{ source, target, dragged, dropped, position, operation, event }` — `dragged` is the full top-level set (a drop fires once even for a multi-drag) and `dropped` is the nodes the library placed (null cross-tree / when `shouldAutoHandle*` is false). `beforeDropCallback` is DELIBERATELY left 5-arg positional (the drop pair is asymmetric).
- **The clipboard interceptors take a context object too**: `beforeCopyCallback(ctx)` / `beforeCutCallback(ctx)` receive `{ operation, paths, nodes }`; `beforePasteCallback(ctx)` receives `{ operation, target: { path, node }, entries }` (was `(targetPath, operation, entries)`). Return shapes unchanged.
- **`PasteResult.pastedCount` is renamed `count`**, and gains `skipped` (entries dropped by the paste transform or the self-paste guard). `beforePasteCallback` returning `false` now fires `onPaste` with the blocked `{ success: false, count: 0 }` result (mirrors svelte-treeview).
- **DOM `CustomEvent` details mirror the ctx objects**: `highlight-change` / `selection-change` detail is now `{ paths, nodes }` (was `{ highlightedPaths, highlightedNodes }` / `{ selectedPaths, selectedNodes }`); `node-drop` detail is the `NodeDropContext`; `copy` / `cut` detail is `{ operation, paths, nodes }`; `node-clicked` / `node-double-click` detail is a `NodeRef` (so `.node` still resolves).
- **Indent step is now its own knob, decoupled from the toggle column.** The flat-mode per-level indent (`paddingLeft = (level − 1) × step`) previously read `--wtv-column-width` — the same variable that sizes the toggle/icon gutter — so nesting density couldn't be tuned without also resizing the twistie column, and the effective 24px/level ran wide. The indent now reads `--wtv-indent-size` (repurposed from a dead alias that pointed back at `--wtv-column-width` and was never consumed), defaulting to `16px`. Set `--wtv-indent-size` alone to tune density (mirrors svelte-treeview's `--stv-node-indent-per-level`). The `/examples/basic` "Simple File Tree" card gains Condensed / Compact / Generous indentation buttons demoing it.
- **No default marker on leaf nodes.** The default `leafIconClass` is now `wtv__toggle-icon--leaf-none` (empty marker) instead of `wtv__toggle-icon--leaf` (the `•` bullet dot) — a leaf now renders an empty toggle slot that still reserves `--wtv-column-width`, so its label stays aligned under its expandable siblings. The bullet is still available by explicitly setting `leafIconClass="wtv__toggle-icon--leaf"`. Mirrors svelte-treeview. (Indent math was already `(level − 1) × column-width` and the leaf slot was already full-width, so no realignment was needed on this side.)
- **`--wtv-node-height` is now a live row-height knob, and labels truncate with an ellipsis.** The token was declared (`32px`) but consumed nowhere — row height was emergent from padding + line-height, and `.wtv__node-label` had no `white-space`/`overflow`, so long labels WRAPPED. Since web-treeview is the virtual-scroll package (translateY math assumes uniform `index × rowHeight`), a wrapping row silently desynced the scroll position. Now `.wtv__node-content` gets `min-height: var(--wtv-node-height)` (+ `min-width: 0` so the flex label can shrink) and `.wtv__node-label` gets `white-space: nowrap; overflow: hidden; text-overflow: ellipsis`. Rows stay a uniform height regardless of label length; override the label hook + raise `--wtv-node-height` for multi-line rows. (svelte-treeview intentionally leaves `.stv__node-label` a bare hook because it isn't virtual-scroll-first, and it never had a node-height token — that token was a web-treeview-only leftover.)

### Fixed

- **Every property/attribute change rebuilt the entire tree, even purely cosmetic ones (A2 value-compare guard).** `buildConfig()` has no per-key dirty tracking — it resends EVERY set member + callback on any change — so `updateProps`'s recreation guard, a presence check (`updates.X !== undefined`), fired a full LTree teardown + `insertArray` (fresh node objects) on changes that touched nothing structural (a theme class, a cosmetic prop). The guard now compares each incoming value against the one baked into the live tree (`changed(next, current)`) and only recreates on a REAL change; references are stable across resends (`buildConfig` copies stored fields, it doesn't rebuild closures), so identity compare is sound for callbacks and string compare for members. This closes the perf half of the state-preservation issue above — cosmetic changes now cost nothing. Regression-covered by the "A2 guard" block in `e2e/state-persistence.spec.ts` (a same-value resend recreates NOTHING; a genuine change still does, asserted via the init logger's "Recreating LTree" line). **Sub-fix exposed by A2:** `expandLevel` is baked into the LTree's construction closure and was only ever *applied* as a side-effect of the (previously constant) recreation, so once cosmetic recreations stopped, a runtime `expandLevel` change did nothing. It's now tracked on the controller (`_expandLevel`), a real change forces the recreation explicitly, and — unlike a member change, which PRESERVES expansion — an explicit `expandLevel` change RE-SEEDS expansion at the new level (skips `_reapplyExpanded`). Covered by the `expandLevel=0/3` cases in `e2e/basic.spec.ts`.
- **Setting `sortCallback` at runtime was silently ignored.** Its property setter (`web-component.ts`) assigned the field but — unlike every other member/callback setter — never called `_scheduleUpdate()`, so the new sorter never reached the controller and the tree kept its old order. Added the missing `_scheduleUpdate()`; a fresh `sortCallback` reference is a real change under the A2 guard, so it now recreates the tree and re-sorts.
- **Changing any property/attribute at runtime silently reset the highlight set, checkbox selection, and expansion to their defaults.** Every config change resends the full config (`buildConfig()` → `treeview.update(...)`), whose member keys re-trigger `insertArray` — a full data re-insert that creates fresh node objects. Runtime state that lived ON the nodes (`isHighlighted`, `isSelected`, `visualState`, `isExpanded`) was wiped by that re-insert, so e.g. toggling a theme or a cosmetic prop after the user had highlighted/checked/expanded rows lost their state. Fixed web-grid-style by moving the source of truth off the nodes: the renderer now reads highlight + checkbox `checked` straight from the controller-owned `snapshot.highlightedPaths` / `snapshot.selectedPaths` (which survive the re-insert); `_reapplyRuntimeSelection()` re-applies the selection set onto the fresh nodes' `isSelected` and recomputes cascade `visualState` after every `insertArray`; and expansion (consumed by the LTree's own flattening, so it stays on the node) is captured before the re-insert (`_collectExpandedPaths`) and restored after (`_reapplyExpanded`). Regression-covered by `e2e/state-persistence.spec.ts`. (The wasteful re-insert on cosmetic changes is now ALSO eliminated — see the A2 value-compare guard below.)
- **Switching `checkboxMode` at runtime left an indeterminate parent stuck at `[-]`.** The setter / `updateProps` just assigned the field without re-deriving visual state. Ported `_reconcileVisualStatesForMode()` from svelte-treeview (switching to `independent` PROMOTES an indeterminate node to fully checked; switching to `cascade` recomputes the parent dashes) and wired it into both the setter and the `updateProps` checkboxMode branch. Combined with the state-preservation fix above, the switch now sticks across the config-triggered re-insert. Regression in `e2e/checkbox-mode.spec.ts`.
- **A desktop drag could drop onto a node with `isDropAllowed=false`.** web-treeview only enforced the per-node opt-out on the touch path; the desktop `dragOver` / `drop` / internal handlers + the glow-zone drop only checked the drag *mode*. Added the `node.isDropAllowed` gate to every desktop path, matching svelte-treeview. Regression in `e2e/drag-drop.spec.ts` (no-drop-node section).
- **A node crossing the leaf↔folder line kept a stale toggle marker.** Dropping/adding a child onto a leaf left it showing an empty leaf slot (no ▼) instead of an expand arrow, and moving/deleting the last child out of a folder left a phantom ▼ on the now-empty node. Two causes, both fixed: (1) `updateNode` only ever flipped the `expanded` class of a node that was *already* a folder — it never rebuilt the marker when `hasChildren` changed (create built it correctly, so create-vs-update had diverged); extracted a single `_applyToggleClasses(toggle, node)` helper that rebuilds the class from `hasChildren`, called by both create and update. (2) The reconcile-skip check re-rendered a node only when its `data-rev` or `data-expanded` changed, but `hasChildren` isn't captured by `_rev` (adding/removing a child doesn't bump the *parent's* `_rev`), so the transition was skipped before `updateNode` even ran; `hasChildren` is now tracked as a `data-has-children` attribute and included in the skip check, exactly like `data-expanded`. Regression-covered in `e2e/branch-operations.spec.ts` (leaf→folder via insertBranch, folder→leaf via deleteBranch keepParent).
- **Interactive-state DOM asymmetry eliminated — every `wtv__node-content--*` marker now lives on the content pill.** `draggable` and the `--draggable` / `--cut` / `--dragged` classes were applied to the OUTER `.wtv__node` (a consequence of event delegation making the whole row a drag handle + the reconciler keying on the outer node), while `--highlighted` / `--focused` / `--glow-*` already lived on the inner `.wtv__node-content`. That split is what made the earlier hover/active/dragged bugs possible (a class named for the content painting on a full-width parent). Moved `draggable` + all four classes onto `.wtv__node-content`, matching svelte-treeview (which puts `draggable` on `.stv__node-content`). The delegated `dragstart`/touch handlers are unchanged — they still resolve the row via `closest('.wtv__node')` — so only the grab handle narrows to the content pill (excludes the indent gutter, exactly like svelte). `data-rev`/`data-expanded`/`data-tree-path` stay on the outer node (the reconciler's key); the outer node now carries only structure (indent, min-height, `data-*`), never a visual-state class.
- **Pressing a row flooded the indent gutter + toggle column with the active background.** `.wtv__node:active` painted on the full-width outer `.wtv__node` (same outer-vs-content trap as hover). Scoped it to `.wtv__node-content:active` so the press feedback is a rounded pill on the content, and the outer node stays transparent. (svelte-treeview has no row press-background at all.)
- **Selected/hovered rows didn't "feel" like svelte-treeview** despite identical DOM — four token/CSS defaults had drifted. (1) **Font:** `--wtv-font-family` fell back to `inherit`, so the tree picked up the host page's font (often a serif); now defaults to the same system sans-serif stack svelte-treeview ships. (2) **Compactness:** the newly-wired `--wtv-node-height` was `32px` applied as `min-height` on `.wtv__node-content` — the element that paints the highlight — inflating the selected block; moved the floor to the ROW (`.wtv__node`) and dropped the default to `24px`, so rows are compact and the highlight hugs its text (nowrap already keeps virtual-scroll rows uniform, so no min-height on the content is needed). (3) **Rounding:** the base `.wtv__node .wtv__node-content` (2-class) hardcoded `border-radius: 0`, out-specifying the single-class `--highlighted`/`--focused` modifiers and squaring off their pill; base now rounds via `--wtv-border-radius-sm` like svelte's base content. (4) **Hover shape + padding:** hover painted on the full-width outer `.wtv__node` (a flat bar spanning indent + toggle) and node padding was flush-left (`… 0`); hover now paints on `.wtv__node-content` and padding is symmetric, so hover/highlight render as a rounded, content-hugging, inset pill exactly like svelte-treeview.
- **Dragging a node shoved its row (and highlight background) rightward, looking like a phantom indent.** `.wtv__node-content--dragged` applies `transform: scale(0.95)`, but web-treeview lands that class on the FULL-WIDTH `.wtv__node` (it drags the outer element; svelte-treeview scales the content-sized `.stv__node-content` instead). With the default center transform-origin, shrinking a full-width row pulls its left edge — and its gray highlight — inward by ~2.5% of the tree width on drag start. Added `transform-origin: left center` so the lift/dim shrink stays anchored at the left and the row no longer moves horizontally. (The visible "missing toggles" alongside it was the empty leaf toggle slots — leaves reserve the `--wtv-column-width` gutter but render no marker since the default `leafIconClass` is `--leaf-none` — made obvious by the rightward shove; folders keep their arrows throughout a drag.)
- **Floating drop zones and glow snap-zones rendered as unstyled text piled at the row start.** The `wtv__` BEM rename updated the CSS selectors (`.wtv__drop-zones--<layout>`, `.wtv__drop-zone--<pos>`, `.wtv__node-content--glow-<pos>`) but three class-emitting sites in `dom-renderer.ts` still produced the OLD flat names (`wtv-drop-zones-<layout>`, `wtv-drop-<pos>`, `wtv-glow-<pos>`). With no matching selector each `.wtv__drop-zone` kept only its base `position: absolute` with no offsets — collapsing all three zones onto 0,0 of the fixed overlay and losing their background colors — while the glow indicator was added under a name its own removal call never cleared. Emitters realigned to the BEM names; a full class-inventory audit (both directions) confirms no other stale `wtv-*` class strings remain.

### Added

- **Built-in Delete** — `deleteNodes(paths?)` (defaults to the current selection: highlight set, else focused node), the `beforeDeleteCallback(ctx)` interceptor (narrow via `string[]` / block via `false`), and the `onDelete(ctx)` event (fires with PRE-REMOVAL node snapshots). Wired to the `Delete` key (and `Shift+Delete` = cut, `Ctrl/Shift+Insert` CUA aliases) in the renderer keydown handler.
- **`onTreeKeydown(ctx)` interceptor** — `ctx = { event, focusedNode, highlightedNodes, controller }`; return `true` to suppress the default navigation + built-in shortcuts. Runs BEFORE the built-in shortcut handling.
- **`shouldHandleKeyboardShortcuts`** (default `true`) — opt out of the built-in Ctrl/Cmd+C/X/V + Delete + Esc-cancel-cut shortcuts. (Kept default-on so existing web-treeview demos don't regress; svelte-treeview defaults this off.)
- **`'self'` drag-drop mode** — `DragDropMode` gains `'self'` (was `'none' | 'cross' | 'both'`), the same-tree-only mode svelte-treeview already had: dragging is enabled but `isDropAllowedByMode` rejects any drop whose dragged node originated in another tree (the mirror of `'cross'`, which rejects same-tree drops). Set via the `drag-drop-mode` attribute / `dragDropMode` prop. Regression in `e2e/drag-drop.spec.ts` ("drag-drop-mode same-tree gate": `'self'` allows a same-tree drop, `'cross'` rejects it).
- **Deep clipboard, at full svelte-treeview parity** — a module-level cross-tree registry (`registerClipboardTree` / `unregisterClipboardTree` / `getClipboardTree`) so a cross-tree CUT removes the originals from the source tree; `copyNodeTransformationCallback(data, ctx)` / `pasteNodeTransformationCallback(data, ctx)` per-node transforms (paste transform returning `null` SKIPS a node — skipping a root skips its subtree); a per-entry self-paste guard (paste into self/descendant skips just that entry, not the batch); leaf-aware paste (a `'child'` paste onto a node that disallows `'child'` is redirected beside it, honoring `getAllowedDropPositionsCallback`); the `uniqueName(base, taken, suffix?)` collision-free naming helper; `shouldAutoHandlePaste` (default `true`; `false` forwards the cleaned entries via `PasteResult.entries`); and `setDragSet` / `getDragSet` so cross-tree multi-drag can expose the full set via `ctx.dragged`.
- **Empty-tree paste** — `shouldShowDropPlaceholderWhenEmpty` keeps the empty drop zone visible whenever the tree is empty (not only during a drag) and makes it focusable + focus-on-hover/pointerdown, so a Ctrl/Cmd+V pastes into an empty tree (paste targets the focused node, or the root when none).
- **`noDataText`** — configurable fallback text for an empty tree (was a hardcoded `"No data"`), used when no `renderEmptyStateCallback` is given.
- **New context types exported**: `NodeRef`, `NodeEventContext`, `NodeDragContext`, `NodeDropContext`, `ClipboardEventContext`, `SelectionChangeContext`, `TreeKeydownContext`, `NodeTransformContext`, `BeforeCopyContext`, `BeforeDeleteContext`, `BeforePasteContext`, plus the `ClipboardSourceTree` interface and the clipboard registry / drag-set / `uniqueName` functions.

### Internal

- New e2e fixture `/test/clipboard-extended.html` + `e2e/clipboard-extended.spec.ts` covering Delete (key + API + `beforeDelete` block), the paste-transform null-skip + `skipped` count, and the `onTreeKeydown` suppression. Existing `/test/*` fixtures and specs updated to the ctx-object signatures.
- **CSS custom-property cleanup.** `--wtv-node-padding` is now actually wired onto `.wtv__node-content` (it mirrors svelte-treeview's `--stv-node-content-padding`, which *is* consumed there — web-treeview declared it but never used it; pixels unchanged, left stays `0` so the highlight hugs the label). Removed 7 dead tokens with no consumer and no used svelte-treeview counterpart: `--wtv-border` (+ its now-orphaned `--wtv-border-width-base`), `--wtv-toggle-size` (a redundant alias of `--wtv-column-width`), `--wtv-transition-normal`, `--wtv-easing`, `--wtv-border-radius-md`, `--wtv-font-size-base`. A both-directions token/class audit now reports no remaining phantom variables.
- `examples-drag-drop.html` now hands each tree a `structuredClone` of its seed-data const (instead of the const itself), so in-place tree mutations can't pollute the shared literal and a hot-module reload — which re-runs interaction state but not the const literals — starts clean.
- **Runtime state moved off the node objects (web-grid house-pattern alignment).** Highlight + checkbox selection are read from controller-owned sets via the render snapshot (like `focusedNode`/`cutPaths` already were); selection is re-applied + visual state recomputed after each re-insert; expansion is captured/restored around a re-insert. New helpers on `TreeController`: `_reapplyRuntimeSelection`, `_reconcileVisualStatesForMode`, `_collectExpandedPaths`, `_reapplyExpanded`, `_applyToggleClasses`. Note: this deliberately diverges web-treeview's state model from svelte-treeview's (state-on-reactive-nodes) — the accepted trade for aligning with the web-grid pattern.
- **`examples-drag-drop.html` "Drag Between Trees" panel brought to svelte-treeview parity** — adds the Selection-mode (single/multi), Built-in-keyboard-shortcuts, and Show-drop-zone-when-empty controls; wires cross-tree clipboard (paste transform with `uniqueName`, self-paste redirect, copy/cut/paste/delete logging), live source/target highlight readouts, multi-drag cross-tree fan-out via `ctx.dragged`, and a 🔒-pinned (`isDraggable:false`) node (wired before `.data` so the stored flag is correct).
- New e2e coverage: `e2e/checkbox-mode.spec.ts` + `/test/checkbox-mode.html`, `e2e/state-persistence.spec.ts` (now also the A2-guard block — cosmetic resends don't recreate, genuine changes do), a no-drop-node section + a `drag-drop-mode` same-tree gate (`self`/`cross`) in `e2e/drag-drop.spec.ts`, and leaf↔folder toggle-transition tests in `e2e/branch-operations.spec.ts`.

## [2.0.0-rc06] - 2026-06-29

Parity port of four features that landed in `@keenmate/svelte-treeview` rc12.

### Added

- **`ContextMenuItem.shouldCloseOnClick?: boolean` (default `true`) — per-item opt-out of the context-menu auto-close**: the callback menu already auto-closed after a leaf item was activated (the right default for one-shot commands). Some items act *incrementally* — a toggle, a counter, a multi-step action — and want the menu to stay open. Setting `shouldCloseOnClick: false` suppresses the auto-close for that entry; the handler then owns dismissal via the `close` callback passed to `contextMenuCallback(node, close)`. Implemented in `dom-renderer.ts` by gating the leaf-item click close on `item.shouldCloseOnClick !== false` (the click handler now also awaits an async `onclick` in a `try/finally`, matching svelte-treeview). The shortcut-key path activates items via `el.click()`, so it inherits the same gate. `/test/context-menu.html` gains a "Bump (stays open)" item; `e2e/context-menu.spec.ts` asserts the menu survives repeated clicks and a normal item still dismisses afterward.
- **Data-driven per-row class hooks `nodeClass?: (node) => string` and `nodeContentClass?: (node) => string`**: previously the only per-row class hooks were *state* classes (`highlightedNodeClass` / `focusedNodeClass` / `dragOverNodeClass`) — there was no way to tag a row from its own data (`is-folder` / `is-file`, a status colour, a grid class) without `[data-tree-path]` selectors. The two callbacks run per node and return class(es) applied to `.wtv__node` (`nodeClass`) and `.wtv__node-content` (`nodeContentClass`). Plumbed through `NodeConfig` and applied in both the diff reconciler's create and update paths via a new `_applyCustomNodeClasses` helper that tracks the previously-applied classes in `data-*` attributes, so a re-render removes stale classes before adding new ones (the reconciler reuses row elements). Wired end-to-end on the web component (JS-only callback props + `_scheduleUpdate`) and through `mapToControllerConfig`. New `/test/feature-port.html` + `e2e/feature-port.spec.ts` assert the classes land on the right elements, by data.
- **Public `onNodeDoubleClick?: (node) => void` event + `node-double-click` DOM event — a real double-click notification, reliable under the flat diff reconciler**: there was no public double-click event, and the native `dblclick` listener only toggled expand in `select` mode (no callback). The native `dblclick` is unreliable here because the first click bumps `_rev` and the reconciler patches the row out from under the browser. Replaced with manual detection in the controller (`detectDoubleClick` — last path + timestamp, 400ms window), called by the renderer for every genuine plain UI click. Fires `onNodeDoubleClick` for every `clickBehavior`; `select` mode additionally keeps the expand/collapse-on-double. On a detected double the second click is consumed so the gesture reads as a single open, not a re-toggle. Surfaced as a `node-double-click` `CustomEvent` on the element.
- **Public `onCopy` / `onCut` / `onPaste` events — post-operation clipboard notifications**: `copyNodes` / `cutNodes` / `pasteNodes` existed but fired nothing on completion. Added `onCopy(paths)` / `onCut(paths)` (fired with the affected source paths after the operation succeeds) and `onPaste(result)` (fired with the `PasteResult`) on the controller, forwarded as web-component callback props and `copy` / `cut` / `paste` `CustomEvent`s. Covered by `e2e/feature-port.spec.ts`.
- **`beforeCopyCallback` / `beforeCutCallback` / `beforePasteCallback` clipboard interceptors — the *before* half of the clipboard surface, symmetric with the new `on*` events**: `beforeCopyCallback(paths)` / `beforeCutCallback(paths)` run before the operation and can return `false` to block it or a `string[]` to override which paths are copied/cut; `beforePasteCallback(targetPath, operation, entries)` runs before a paste and can return `false` to block or `{ targetPath?, position? }` to redirect it. Applied in the controller's `copyNodes` / `cutNodes` / `pasteNodes`, forwarded through `mapToControllerConfig` and exposed as web-component callback props. This brings web-treeview's clipboard to full parity with `@keenmate/svelte-treeview` (rewrite/block before, react after). Covered by `e2e/feature-port.spec.ts` (a `beforeCopy` path override and a `beforePaste` block).

### Changed

- **A rapid double-click on the same row no longer toggles twice** (consequence of the new double-click detection): in `expand` / `expand-and-focus` modes two clicks within 400ms previously expanded then collapsed (and a fast re-click on a checkbox row toggled it back); the second click is now consumed as part of a double-click gesture and fires `onNodeDoubleClick` instead. Distinct single clicks (>400ms apart) toggle as before. Three `e2e/interaction.spec.ts` cases that re-clicked the same row to assert a toggle were updated to space the clicks past the double-click window. Mirrors `@keenmate/svelte-treeview`.

## [2.0.0-rc05] - 2026-06-25 [PUBLISHED]

### Changed (BlissFramework `/validate-web-component` cleanup — breaking)

Three batches of fixes landed against the `validation_2026-06-19_1918.md` punch-list. The RC cycle is still active so these are clean breaking renames — no deprecation aliases.

- **Selection / highlight / focus API normalized into three symmetric verb-families** (mirrors `@keenmate/svelte-treeview`). The imperative methods had drifted: `selectNode`/`selectNodes` were `@deprecated` aliases for the *highlight* set, `selectAll` highlighted (didn't check boxes), the highlight set cleared with `clearHighlight()` but the checkbox set with `deselectAll()`, `highlightNodes()` silently *replaced* the set, and there was no path-targeted checkbox setter or imperative focus method. Now three concerns × one shape. **Highlight (`highlightedPaths`):** `highlightNode(path, mode?, opts?)`, `highlightNodes(paths, opts?)` (**additive**), `setHighlightedPaths(paths, opts?)` (replace), `highlightAll(opts?)` (was `selectAll`), `clearHighlight(paths?, opts?)` (path-optional). **Selection (`selectedPaths`):** `selectNode(path, opts?)` (now checks the box + cascades), `selectNodes(paths, opts?)` (additive), `setSelectedPaths(paths, opts?)`, `selectAll(opts?)` (now checks every box), `deselectNode(path, opts?)`, `clearSelection(paths?, opts?)` (was `deselectAll`). **Focus (`focusedNode`):** new `focusNode(path, opts?)` / `clearFocus(opts?)`. Two shared types replace the inline literals: `HighlightMode = 'replace' | 'toggle' | 'range'` and `TreeMutationOptions = { silent?: boolean }` (both re-exported). `Ctrl+A` now calls `highlightAll()` (was the highlight-`selectAll`); the navigation methods (`navTo`/`navNext`/…) repointed from the old highlight-`selectNode` to `highlightNode`. Breaking within the RC: `deselectAll` → `clearSelection`; `selectAll` is now checkbox-all, with highlight-all moved to `highlightAll`; `clearHighlight({silent})` → `clearHighlight(undefined, {silent})`; `selectNode`/`selectNodes` are now real checkbox setters; `highlightNodes` is additive (use `setHighlightedPaths` for replace). `vite build` clean; full e2e green (135 passing).
- **Theming migration to Strategy B (`color-scheme` flipping + `light-dark()`)**. The four dark-mode-signal blocks in `_dark-mode.css` (~100 lines of `--wtv-*` variable redeclarations) collapse to a single `color-scheme: dark` / `color-scheme: light` declaration on the same signal selectors (~50 lines). Every color fallback in `variables.css` now uses `light-dark(<light>, <dark>)` and the variables flip automatically based on the inherited `color-scheme`. `:root` selector dropped from `variables.css` (the rc09 subtree-theming bug: a consumer wrapping `<web-treeview>` in `<div style="--base-accent-color: red">` couldn't override anything because variables were resolved at `:root`). Hover / active / selected switched to `color-mix` chains so highlights stay visible at any base luminance. `--wtv-context-menu-bg` now chains through `--base-dropdown-bg` → `--base-elevated-bg`. Per-instance `:host([data-theme])` selectors added alongside the existing `.wtv__container[data-theme]` so consumers using `<web-treeview data-theme="dark">` get a flip without needing the JS-prop forwarder.
- **CSS structure cleanup**. The duplicate non-BEM `.web-treeview` class added in `render()` is gone (the BEM `.wtv__container` already lived on the same element; layout properties moved there). `main.css` now declares `@layer variables, component, overrides;` and wraps every `@import` in `layer(...)` so consumers can override component rules from outside the shadow root without specificity wars or `!important`. The four CSS files lost their SASS-partial `_` prefix (`_variables.css` → `variables.css`, etc.) — they're plain CSS modules, not partials. The 17 section markers in `tree.css` upgraded from box-drawing-char `── Section ──` to the canonical `==== SECTION ====` banner format.
- **Public API rename (every `on*` event handler → `*Callback`; boolean prefixes per `naming-conventions.md`)**. The web-component config now follows the `*Callback` convention universally (`on*` is the Svelte idiom — kept inside the internal renderer→controller `NodeCallbacks` bridge, but removed from every consumer-facing surface):
  - `onNodeClicked` → `nodeClickedCallback`
  - `onNodeDragStart` → `nodeDragStartCallback`
  - `onNodeDragOver` → `nodeDragOverCallback`
  - `onNodeDrop` → `nodeDropCallback`
  - `onSelectionChange` → `selectionChangeCallback`
  - `onHighlightChange` → `highlightChangeCallback`
  - `onRenderStart` → `renderStartCallback`
  - `onRenderProgress` → `renderProgressCallback`
  - `onRenderComplete` → `renderCompleteCallback`

  Boolean Config props now follow the `is*` / `should*` rule:
  - `accordionExpand` → `isAccordionExpand`
  - `progressiveRender` → `isProgressiveRender`
  - `useFlatRendering` → `isFlatRenderingEnabled`
  - `virtualScroll` → `isVirtualScrollEnabled`
  - `alignNodeIcons` → `shouldAlignNodeIcons`
  - `allowCopy` → `isCopyAllowed`
  - `autoHandleCopy` → `shouldAutoHandleCopy`
  - `autoHandleMove` → `shouldAutoHandleMove`
  - `showCheckboxes` → `shouldShowCheckboxes`
  - `clickTogglesCheckbox` → `shouldClickToggleCheckbox`

  HTML attribute names stay unchanged (`show-checkboxes`, `allow-copy`, `accordion-expand`, `virtual-scroll`, etc.) — they're already short and readable; the renames apply only to the JS property / config surface. The `ATTRIBUTE_TABLE` in `web-component.ts` maps each kebab-case attribute to its renamed camelCase config key (single source of truth — `observedAttributes` and the `buildConfig()` body both derive from it). Rename applied by `scripts/rename-api.mjs`, kept in-tree.

- **`component-variables.manifest.json` repaired.** Prefix field `tv` → `wtv`, all 108 entries renamed (`tv-*` → `wtv-*`), stale entries fixed (`glow-above` / `glow-below` → `glow-before` / `glow-after` to match the code, added missing `wtv-cut-opacity` and `wtv-font-family`).

- **`VALIDATION-NOTES.md` register** now documents four accepted deviations (C-CST-4/10 namespace-style Logic split, C-CSS-1 lean strategy, C-TC-15 `data-ready` FOUC guard, C-NC-6 D-NC-7=C member-only structural extractors). Future validation runs downgrade matching flags to ⚠️ Exception instead of re-promoting them on every run.

### Fixed
- **Escape now clears the highlight set instead of the checkbox set** (parity with the svelte-treeview rc13 fix). The previous handler in `dom-renderer.ts` Escape branch called `deselectAll()` (clears the checkbox / `selectedPaths` set) — that was written before the rc06 three-level selection split; in the new model the user's "selection" after Ctrl/Shift+click is the highlight set (`highlightedPaths`), not the checkbox set. Now Escape runs in priority order: pending cut → highlight set → fall through. Checkboxes are *not* cleared by Escape; consumers wanting that call `clearSelection()` themselves.
- **`.wtv__node-content--focused` is now a pure CSS hook with no default styles** (parity with the svelte-treeview rc13 fix). The rc03 always-on marker shipped a subtle outline as a built-in "keyboard focus is visible even without a custom `focusedNodeClass`" default, but consumers who explicitly chose to ship no focus visual were stuck with the ring anyway. Now the rule is empty — apps that want a built-in focus look write their own CSS targeting `.wtv__node-content--focused` (or pass a class via `focusedNodeClass`). `--wtv-focused-outline` is no longer referenced and is dropped. `.wtv__node-content--highlighted` keeps a default look — but it's now a fallback that yields to a configured class (see the next bullet).
- **`addNode` now also seeds `isCollapsible` / `allowedDropPositions` on added/copied nodes** (parity with the svelte-treeview rc13 `addNode` seed fix). web-treeview's `addNode` already seeded the drag/drop flags (`isDraggable` / `isDropAllowed` / `isExpanded` / `isSelectable` / `isSelected`) from the `getIs*Callback` / `*Member` props — so the cross-tree "dropped node is frozen" bug that hit svelte-treeview never manifested here — but it skipped these last two, meaning a node copied via `copyNodeWithDescendants` could silently lose its `allowedDropPositions` restriction. Added for completeness.
- **Multi-drag now respects per-node draggability — a locked node (`isDraggable=false`) in the highlight set no longer rides along** (parity with the svelte-treeview rc13 fix). The `isMultiDrag` branch in the controller's `_onNodeDrop` built its move list from `_getTopLevelHighlightedPaths()` without re-checking draggability, so a pinned node that was Ctrl/Shift-highlighted alongside draggable siblings got moved despite the single-drag path being gated at drag start. Fix adds a `getNodeIsDraggable()` `.filter()` on the top-level paths. Regression coverage: new "Multi-drag with a locked node" section in `test/drag-drop.html` + a case in `e2e/drag-drop.spec.ts`.
- **`.wtv__node-content--highlighted` marker is now a FALLBACK — it no longer fights a configured `highlightedNodeClass`** (parity with the svelte-treeview rc13 fix). The `DomRenderer` added the marker unconditionally whenever `node.isHighlighted`, then *also* added `highlightedNodeClass` on top — so the marker's default background/outline was painted underneath the consumer's chosen highlight style and fought it (e.g. "Bold" showed bold text over the marker tint). Both render paths now gate the marker on the class being unset: `_createNodeElement` adds `--highlighted` only in the `else` branch of `if (highlightedNodeClass)`, and `_updateNodeElement` toggles it with `!!node.isHighlighted && !hasCustomHighlight`. The marker still supplies a default when nothing is configured (so `selectionMode='multi'` has visible feedback out of the box) and steps aside entirely once a highlight class is set. Note: web-treeview's diff renderer only re-renders a row when its `_rev` bumps, so switching `highlighted-node-class` on an *already-highlighted* row doesn't hot-swap the class the way the Svelte reactive binding does — set the class before the row is highlighted. Covered by the new `test/highlight-focus.html` fixture + `e2e/highlight-focus.spec.ts` (7 tests).
- **`collapseNodes`, `collapseAll`, `expandAll` now bump `_rev` on every `isExpanded` mutation** (parity with `expandNodes`). Mirrors the rc13 `@keenmate/svelte-treeview` fix where the same gap manifested as a stale toggle chevron (collapsed node, chevron still pointing down) in `clickBehavior='select'` dblclick-collapse. The DOM renderer here keys node refreshes off `data-expanded` directly, so the user-visible symptom didn't surface — but custom `TreeViewRenderer<T>` implementations that key off `_rev` (matching the documented invariant) would have hit the same staleness. Four sites fixed in `src/ltree/ltree.ts`: `expandAll`'s `setExpandedRecursive`, `expandAll`'s spine-walk, `collapseAll`'s `collapseRecursive`, and `collapseNodes`. Each is guarded by an "actually changed" check so already-correct rows don't churn.
- **`tsc --noEmit` is clean again — the two unimported UMD loglevel copies are excluded from the project**. `src/vendor/loglevel/loglevel.js` and `loglevel-plugin-prefix.js` are the original UMD distributions kept for reference only; the code imports the `-esm.js` variants via `index.js` / `prefix.js`. Under the project's `declaration: true` + `emitDeclarationOnly: true` config the UMD IIFE wrapper can't be represented in declaration emit and threw `TS9005` ("requires using private name 'Logger'") on a standalone `tsc --noEmit -p tsconfig.json` run. The `vite build` dts pipeline already skipped them, so the real build never surfaced it — only the standalone typecheck did. Both files are now in the tsconfig `exclude` array (with an inline comment), so the standalone check and the build agree. The imported ESM versions are untouched; declaration output is unchanged.

### Added
- **`.wtv__node-content--highlight-glow` built-in highlight flavor** (parity with `@keenmate/svelte-treeview`'s `.stv__node-content--highlight-glow`). A fifth opt-in highlight class joining bold / border / brackets — a tinted background plus an accent-colored soft `box-shadow` glow ring. Pass it via the `highlighted-node-class` attribute / `highlightedNodeClass` config. (The Svelte build also ships a `--highlight-fill` variant; web-treeview doesn't yet — tracked separately as it needs a dedicated `--wtv-highlight-bg` token.)

## [2.0.0-rc04] - 2026-06-19

### Changed
- **BEM class shape**: every CSS class now follows the BlissFramework `naming-conventions.md` BEM rule (`<prefix>__element--modifier`, two underscore levels max). Mechanical for elements (`.wtv-X` → `.wtv__X`, e.g. `.wtv-node` → `.wtv__node`, `.wtv-node-content` → `.wtv__node-content`, `.wtv-context-menu-item` → `.wtv__context-menu-item`). State classes are explicit modifiers — `.wtv-drag-over` → `.wtv__node-content--drag-over`, `.wtv-context-menu-item-disabled` → `.wtv__context-menu-item--disabled`, `.wtv-icon-expand` → `.wtv__toggle-icon--expand`, `.wtv-drop-zones-around` → `.wtv__drop-zones--around`. Highlight family folded into BEM modifiers too: `.wtv-highlight-bold` → `.wtv__node-content--highlight-bold` (same for border / brackets), and the always-on `.wtv-highlighted` / `.wtv-focused` markers introduced in rc03 are now `.wtv__node-content--highlighted` / `--focused`. One non-BEM utility kept: `.wtv__clickable` (was `.wtv-clickable`) — applied to both the toggle-icon span and the node-content div, so it stays as a standalone block. CSS variables (`--wtv-*`) are unchanged. `BlissFramework/guidelines` reservation table now lists `wtv` (web-treeview) and `stv` (svelte-treeview) instead of the legacy `ltree` exception. The full rename was applied by `scripts/rename-bem.mjs`, kept in-tree.

## [2.0.0-rc03] - 2026-06-18 (unpublished)

Catch-up release pulling forward the features `@keenmate/svelte-treeview` shipped from `5.0.0-rc05` through `5.0.0-rc10` so the two packages expose the same surface again. Public API parity is the goal — prop names, method signatures, callback shapes, CSS class names, and event semantics mirror the Svelte side.

### Changed (5.0.0 consolidation rename)
- **CSS class prefix: `.ltree-*` → `.wtv-*`** across every class the package ships and applies. Every selector consumers may have written against the tree's DOM (e.g. `.ltree-node`, `.ltree-node-content`, `.ltree-checkbox`, `.ltree-context-menu`, `.ltree-drop-before`, `.ltree-glow-child`, etc.) must be renamed to the `wtv-` prefix. The `ltree-` prefix was inherited from the internal "LTree" data-structure name and leaked an implementation detail into the public CSS API; the new prefix is package-specific and parallels svelte-treeview's `stv-*` after the same 5.0.0 rename.
- **CSS variable prefix: `--tv-*` → `--wtv-*`** for the same reason. Every variable consumers override for theming (`--tv-accent-color`, `--tv-bg-color`, `--tv-node-height`, etc.) must rename to `--wtv-*`. The base-layer (`--base-accent-color`, `--base-text-color-1`, etc.) is **unchanged** — those are the shared KeenMate design tokens and continue to feed the component variables.
- **`.wtv-selected-{bold,border,brackets}` → `.wtv-highlight-{bold,border,brackets}`**: the three opt-in flavor classes you assign via the `highlightedNodeClass` prop are renamed to match the rc03 three-level model. In rc03 "selected" means the checkbox/data-state set (`selectedPaths`); "highlighted" means the multi-select set (`highlightedPaths`) — these classes paint the *highlighted* set, so the new name matches the semantics.
- **New always-on `.wtv-highlighted` marker class** applied to every node in the highlight set (in addition to whatever `highlightedNodeClass` you opt into). Ships a subtle default style (`--wtv-highlighted-bg` + `--wtv-highlighted-outline`) so enabling `selectionMode='multi'` produces visible feedback without configuring `highlightedNodeClass`. Pair it with `highlightedNodeClass="wtv-highlight-bold"` (or your own) for layered styling.
- **New always-on `.wtv-focused` marker class** applied to the single focused node, with a subtle default outline so keyboard navigation is visible without configuring `focusedNodeClass`.

### Added
- **Checkbox UI (`shouldShowCheckboxes`, `checkboxMode`, `beforeCheckboxToggleCallback`)**: Mirrors svelte-treeview rc06+. The DOM renderer draws an `.ltree-checkbox` element between the toggle column and the node content when `shouldShowCheckboxes` is true and the node is `isSelectable`. Clicks route through a new `nodeCallbacks.onCheckboxToggle` → `controller._onCheckboxToggle(node)` which honors:
  - **`checkboxMode='independent'`** (default): each checkbox is standalone; toggling a parent does NOT touch descendants and a parent never auto-checks itself from its descendants.
  - **`checkboxMode='cascade'`**: toggling a parent cascades to every descendant; a parent's `visualState` reflects its descendants (`selected` / `notSelected` / `indeterminate`) and is synced back to its `isSelected`.
  - **Bulk via highlight**: when the toggled node is in a multi-highlight set (`highlightedPaths.size > 1`), the toggle applies to every highlighted node.
  - **`beforeCheckboxToggleCallback(node, checked, affectedPaths)`** interceptor: return `false` to cancel, return a `string[]` to override which paths are actually affected, or return `void` to apply unchanged.
  - **`shouldClickToggleCheckbox`** (boolean, default `false`): when `true` AND `shouldShowCheckboxes` is on AND the node is selectable, a plain click on the node label runs the checkbox-toggle path instead of focusing/highlighting. Expand-on-click still fires when `clickBehavior` is `'expand'` or `'expand-and-focus'`.
- **`theme` prop / attribute** (`'dark' | 'light' | null`): Per-instance theme override forwarded to the root `.ltree-container` as `data-theme="..."`. The new `_dark-mode.css` partial flips the `--tv-*` color tokens against four signals — OS preference (`@media (prefers-color-scheme: dark)`), framework theme classes (`[data-theme="dark"]`, `[data-bs-theme="dark"]`, `.dark`), per-instance `data-theme` on the container, and symmetric `light` variants so a single tree can force light on a dark page. Default behaviour with `theme=null|undefined` is to inherit from the page. Mirrors `@keenmate/svelte-treeview` rc10's `theme` prop.
- **`getIsExpandedCallback`, `getIsSelectableCallback`, `getIsSelectedCallback`, `getIsDropAllowedCallback` props**: Callback variants for the matching `is*Member` data-field props, matching the same pattern as the existing `getIsDraggableCallback` / `getIsCollapsibleCallback` / `getAllowedDropPositionsCallback`. Seed-only: invoked once per node at `insertArray` / `addNode` time so subsequent user mutations (checkbox clicks, expand button) aren't overridden by the callback. Precedence: callback > member > default. Mirrors `@keenmate/svelte-treeview` rc09–rc10. Also: `getIsDraggableCallback` is now actually applied at seed time (previously the prop existed but didn't run during insert). New `getNodeIsDropAllowed(node)` method on the LTree mirrors the lazy lookup helpers (`getNodeIsDraggable`, `getNodeIsCollapsible`).
- **`isAccordionExpand` prop / `accordion-expand` attribute** (boolean, default `false`): Per-parent accordion behaviour — expanding a node via the toggle UI automatically collapses any expanded siblings. Respects `isCollapsibleMember` / `getIsCollapsibleCallback` (non-collapsible siblings are not force-collapsed). Programmatic `expandNodes` / `expandAll` are unaffected. Implemented via a new `toggleNodeExpanded(path)` method on the controller / facade; the DOM renderer's toggle-icon click now routes through it. While here, the renderer's toggle now also matches svelte-treeview's gate of blocking the toggle entirely on nodes where `getNodeIsCollapsible(node)` is false. Mirrors `@keenmate/svelte-treeview` rc03.
- **Array variants + option bags on `expandNodes` / `collapseNodes` / `expandAll` / `collapseAll`**: all four now accept `string | string[] | null` instead of a single path. `expandNodes` and `expandAll` take `{ exclusive?: boolean; noEmit?: boolean }`; `collapseNodes` and `collapseAll` take `{ noEmit?: boolean }`. `exclusive` collapses anything off the union-of-spines so downstream listeners (URL sync, virtualised renderers, transition animations) don't see the intermediate fully-collapsed state. `noEmit` skips the change emission so consumers can batch several mutations and emit once at the end via `tree.refresh()`. Single emit per call regardless of array length. Mirrors `@keenmate/svelte-treeview` rc08.

### Changed
- **`DropPosition` renamed `'above' | 'below' | 'child'` → `'before' | 'after' | 'child'`** for full naming parity with svelte-treeview (which renamed the same in its rc02). Knock-on effects:
  - Per-node `allowedDropPositions` data arrays must change from `['above', 'below']` → `['before', 'after']`. Same for the values returned by `getAllowedDropPositionsCallback`.
  - The `position` argument of `nodeDropCallback`, `beforeDropCallback`, `moveNode`, `pasteNodes`, `copyNodeWithDescendants` is now `'before' | 'after' | 'child'`.
  - CSS class names follow: `.ltree-drop-above` → `.ltree-drop-before`, `.ltree-drop-below` → `.ltree-drop-after`, `.ltree-glow-above` → `.ltree-glow-before`, `.ltree-glow-below` → `.ltree-glow-after`. Consumers theming the glow indicators or styling the drop zones via these classes will need to update their selectors.
  - CSS variables follow: `--tv-glow-above-*` → `--tv-glow-before-*`, `--tv-glow-below-*` → `--tv-glow-after-*`.
  - `dropZoneLayout` values (`'around' | 'above' | 'below' | 'wave' | 'wave2'`) are **unchanged** — those are layout names (where the floating zones sit), distinct from position values (which target the floating zones identify). The CSS class names `.ltree-drop-zones-above` / `.ltree-drop-zones-below` likewise stay.
- **Drag-and-drop: multi-drag, non-highlighted drag replaces highlight, `shouldAutoHandleMove` opt-out**:
  - **Multi-drag** (same-tree, `operation='move'`, `shouldAutoHandleMove=true`): when the dragged node is in `highlightedPaths` and the set has more than one entry, the controller moves every **top-level highlighted** subtree (a path whose nearest highlighted ancestor is NOT in the set). The first move uses the requested drop position; subsequent moves chain `'below'` the previously-moved node, so the whole set lands as siblings in source order: dropping `{A, B, C}` `'below D'` → `[D, A, B, C]`; `'above D'` → `[A, B, C, D]`; `'child of D'` → `D`'s children = `[A, B, C]`. Selected descendants of a top-level node are absorbed (they ride along inside their ancestor's subtree, not separately extracted).
  - **Non-highlighted drag**: dragging a node that isn't in `highlightedPaths` now replaces the highlight with that single node before the drag completes. Matches Windows Explorer / macOS Finder where mousedown on an unselected item selects it. Skipped when the node is already in the set (multi-drag) or is not selectable. Runs in a `requestAnimationFrame` after the browser commits the drag image so the source row's DOM isn't disturbed mid-drag.
  - **`shouldAutoHandleMove`** prop (boolean, default `true`): set to `false` to receive the `nodeDropCallback` callback without the controller mutating the tree (consumer handles the move). Mirrors svelte-treeview's `shouldAutoHandleMove`.
  - Mirrors `@keenmate/svelte-treeview` rc09.
- **Three-level selection model (`focusedNode` / `highlightedPaths` / `selectedPaths`)** — biggest behaviour change in rc03. Mirrors svelte-treeview rc06+.
  - **`focusedNode`** (was `selectedNode`): single focused node (click, arrow keys). The web component now dispatches `focused-node-changed` (was `selected-node-changed`) with `detail.focusedNode`. The controller getter / setter is `focusedNode`.
  - **`highlightedPaths`**: multi-select set built by Ctrl/Shift+click and arrow extensions. New methods `highlightNode(path, mode, options)` / `highlightNodes(paths, options)` / `clearHighlight(options)` / `getHighlightedNodes()` / `getHighlightedPaths()` / `isNodeHighlighted(path)`. The web component dispatches `highlight-change` with `detail.highlightedNodes` and `detail.highlightedPaths`.
  - **`selectedPaths`** is now the checkbox / data-state selection set (was: the multi-select set). When `shouldShowCheckboxes` is false, every change to `highlightedPaths` is mirrored into `selectedPaths` so consumers reading the form-style selection still reflect what the user picked via the mouse. With checkboxes visible, the two sets stay independent.
  - **`selectionMode` prop** (`'single' | 'multi'`, default `'single'`): in `'single'`, Ctrl/Shift+click degrade to plain click. In `'multi'`, Ctrl+click toggles, Shift+click range-extends.
  - **`shouldShowCheckboxes`**, **`shouldClickToggleCheckbox`** props added (wiring; checkbox UI ports in the next commit).
  - **`highlightChangeCallback`** callback added.
  - **`{ silent: true }`** option on `highlightNode` / `highlightNodes` / `clearHighlight` / `deselectAll` skips the change callback + mirror. Useful for URL-restore flows where firing the change would re-trigger external sync.
  - **`highlightedNodeClass`** (was `selectedNodeClass`) is the CSS class applied to every node in the highlight set. **`focusedNodeClass`** is new — applied only to the single focused node.
  - **`node.isHighlighted`** added to `LTreeNode` (the existing `node.isSelected` now means "checked", not "selected via mouse").
  - `selectNode` / `selectNodes` are kept as `@deprecated` aliases that forward to `highlightNode` / `highlightNodes`.
- **`.ltree-container` paints its own background**: `background: var(--tv-bg-color)` and `color: var(--tv-text-color)` are now declared directly on `.ltree-container` (previously the surface was inherited from whatever element the consumer wrapped the tree in). Lets the tree render a visible surface without a colored wrapper, and makes the dark-mode flip self-contained. Set `--tv-bg-color: transparent` to restore the pre-rc03 layered behaviour. Mirrors svelte-treeview rc10's `--ltree-bg`.

### Fixed
- **`isSelectedMember` / `getIsSelectedCallback` now actually seed `selectedPaths`**: the previous rc02 code applied the value (via the buggy routing — see below) to `node.isSelectable`, never to `node.isSelected`, and the controller never walked the tree post-`insertArray` to populate the `_selectedPaths` Set. Selecting nodes via the initial data field was therefore a no-op. The new `_seedSelectedPathsFromTree()` walk runs after every `insertArray` (constructor, `data` setter, and tree recreation) and adds every path where `node.isSelected` is truthy. Consumers reading `getSelectedPaths()` / `getSelectedNodes()` immediately reflect server-side initial selection. Mirrors svelte-treeview rc07.
- **`isSelectedMember` was being routed into the `isSelectableMember` factory slot**: In `mapToControllerConfig` the line `isSelectedMember: options.isSelectedMember ?? options.isSelectableMember` and the matching positional call to `createLTree` plumbed `isSelectedMember` into `_isSelectableMember`, so the value documented as marking nodes as initially-selected was actually flipping their `isSelectable` flag (and the real `isSelectable` couldn't take effect). The factory signature and the wiring are now distinct. While here, the controller's `createLTree` call passes the new `is*Member` / `getIs*Callback` props explicitly (parallel to `getIsDraggableCallback`) and `updateProps` recreates the tree when any of them changes.

---

## [2.0.0-rc02] - 2026-03-15 (unpublished)

### Added

#### Multi-Select
- **Ctrl+click** toggles individual nodes in/out of selection
- **Shift+click** range-selects between the last selected node and the clicked node
- Plain click replaces selection with a single node (backward-compatible)
- `rangeSelectionMode` config: `'visual'` (uses visible flat nodes, default) or `'logical'` (walks full tree)
- `selectNode(path, modifiers?)`, `selectNodes(paths)`, `deselectAll()`, `selectAll()` API methods
- `getSelectedNodes()`, `getSelectedPaths()`, `isNodeSelected(path)` query methods
- `selectionChangeCallback` callback and `selection-change` CustomEvent
- `range-selection-mode` HTML attribute on `<web-treeview>`
- `selectedPaths: Set<string>` in `TreeControllerSnapshot` for renderer access

#### Clipboard (Copy/Cut/Paste)
- Module-level clipboard singleton (`src/clipboard.ts`) enabling cross-tree copy/paste
- `copyNodes(paths?)`, `cutNodes(paths?)`, `pasteNodes(targetPath, transformData?, position?)` API methods
- `cancelCut()`, `hasClipboardContent()`, `getClipboardOperation()` helpers
- Cut nodes rendered with `.ltree-cut` class (dimmed via `--tv-cut-opacity: 0.4`, italic)
- Deep clone of node data and descendants with relative path preservation
- Cut+paste removes source nodes after successful paste

#### Keyboard Navigation
- Tree body gains focus on click (`tabindex="0"`)
- **Arrow Down/Up** — navigate to next/previous visible node at the same level (crosses parent boundaries)
- **Arrow Right** — expand and move to first child
- **Arrow Left** — move to parent node
- **Backspace** — collapse parent and move to it
- **Enter/Space** — toggle expand/collapse on current node
- **Home/End** — jump to first/last visible node
- **Ctrl+A** — select all visible nodes
- **Ctrl+C/X/V** — copy/cut/paste selected nodes
- **Escape** — cancel cut or deselect all
- Full navigation API: `navTo`, `navNext`, `navPrev`, `navInto`, `navOut`, `navBackOut`, `navToggle`, `navFirst`, `navLast`, `navNextSibling`, `navPrevSibling`
- `TreeNavigation<T>` and `TreeNavigationOverrides<T>` interfaces (`src/navigation.ts`)

#### Bulk Operations (LTree)
- `insertBranch(parentPath, data[])` — insert multiple children under a parent in one operation
- `replaceBranch(parentPath, data[])` — remove all children then insert new data
- `deleteBranch(path, keepParent?)` — remove a node and all descendants (optionally keep the parent)
- Single `_emitTreeChanged()` per bulk operation for efficient rendering
- Proxied through TreeController, WebTreeView facade, and WebTreeViewElement

#### Examples
- `examples-multiselect.html` — interactive demos: multi-select, keyboard navigation, cross-tree clipboard, bulk operations, range selection mode, clickBehavior setting (persisted to localStorage)

### Changed
- **`clickBehavior`** replaces `shouldToggleOnNodeClick` — new `ClickBehavior` type: `'select'` | `'expand'` | `'expand-and-focus'` (default)
  - `'expand-and-focus'`: single click selects + expands (same as old `shouldToggleOnNodeClick: true`)
  - `'select'`: single click selects only, double-click expands/collapses
  - `'expand'`: single click expands/collapses only, no selection
- `NodeCallbacks.nodeClickedCallback` signature extended with optional `SelectionModifiers` parameter
- `TreeControllerSnapshot` now includes `selectedPaths` and `cutPaths` sets
- DomRenderer click handler respects `clickBehavior` and skips toggle when Ctrl or Shift is held
- `.ltree-selected-border` uses `outline` instead of `border`+`padding` to prevent layout shift on selected nodes
- **Context menu `offset` middleware reduced from `4` to `0`**: The root menu's top-left now lands exactly at `(cursor.x + contextMenuXOffset, cursor.y + contextMenuYOffset)` with no implicit 4px vertical gap. Restores the pre-Floating UI positioning so consumers' `xOffset` / `yOffset` props are honored pixel-exactly. Submenu positioning is unchanged.
- **`scrollToPath` retries the DOM lookup across rAF frames before giving up**: With `isFlatRenderingEnabled` + `isProgressiveRender` (the default), `expandNodes` reveals new rows in rAF-deferred batches sized `initialBatchSize` (default 20) and doubling. Previously, `scrollToPath` queried the DOM after one microtask flush — only the immediate batch was rendered, so any target row past that batch produced a `console.warn("DOM element not found")` and the function returned `false` without scrolling or highlighting. Now retries for up to ~6 additional frames before giving up. Same fix as `@keenmate/svelte-treeview` rc-next.

### Removed
- `shouldToggleOnNodeClick` property/attribute — replaced by `clickBehavior`

---

## [2.0.0-rc01] - 2026-03-08

Complete rewrite as a framework-agnostic web component. The rendering engine, controller layer, and LTree core have been ported from `@keenmate/svelte-treeview` v4.0.0 to vanilla TypeScript with minimal runtime dependencies (`@floating-ui/dom` for context menu positioning, `flexsearch` for full-text indexing).

### Added

#### Core

- **Web Component** — `<web-treeview>` custom element with Shadow DOM, attribute/property binding, and SSR-safe base class
- **LTree Core Engine** — Hierarchical path-based tree data structure (`createLTree`) ported from svelte-treeview
  - Materialized path model (`1`, `1.1`, `1.1.2`) with configurable separator
  - Automatic parent path, level, and `hasChildren` calculation from paths
  - `insertArray`, `moveNode`, `removeNode`, `addNode`, `updateNode`, `applyChanges` mutations
  - `visibleFlatNodes` computed from expand/collapse and filter state
  - Full-text search indexing via FlexSearch with async batch indexing
  - `filterNodes` / `searchNodes` for tree filtering and search
  - `expandAll` / `collapseAll` / `expandNodes` / `collapseNodes`
  - `scrollToPath` with expand-ancestors, highlight, and smooth scroll options
- **TreeController** — Stateful controller managing tree logic, drag-and-drop, context menu, and progressive rendering
  - Ported from Svelte 5 runes (`$state`, `$derived`, `$effect`) to vanilla TS with `queueMicrotask` batching
  - Typed `EventEmitter` with `state-change`, `config-change`, `data-change` events
  - Snapshot pattern: controller emits frozen state snapshots, renderer never mutates controller
- **Pluggable Renderer Architecture** — `TreeViewRenderer<T>` interface for framework-specific renderers
  - `DomRenderer` — Default flat-mode DOM renderer with event delegation and keyed reconciliation
  - `setRenderer()` on `WebTreeView` to swap renderers at runtime without losing tree state
  - `RenderCoordinator` for progressive rendering with `requestAnimationFrame` batching
- **Batched Property Updates** — Web component property setters use `queueMicrotask` to coalesce multiple sync changes into a single update
- **Global API** — `window.components['web-treeview'].version()`, `.config`, `.register()`, `.getInstances()`
- **DOM Events** — Web component dispatches proper CustomEvents with `composed: true` to cross shadow DOM boundary: `node-clicked`, `selected-node-changed`, `node-drop`, `tree-changed`

#### Rendering

- **Two rendering modes** —
  - **Flat rendering** (`isFlatRenderingEnabled`, default `true`) — single DOM list with `paddingLeft` indentation
  - **Virtual scroll** (`isVirtualScrollEnabled`, default `false`) — only renders rows visible in the viewport, suitable for 100k+ node trees. Configurable via `virtualRowHeight`, `virtualOverscan`, `virtualContainerHeight`.
- **Progressive rendering** — `requestAnimationFrame`-batched rendering for smooth initial load of large trees
- **Full-width clickable node rows** — Entire node row is clickable including indent zone, with uniform hover highlight
- **Node row layout** — Each row is `[toggle/icon column] [content]` with unified `--tv-column-width` (24px) controlling toggle, icon, and indent step
- **Per-node icons** — `iconMember` (data field) and `iconCallback` (dynamic function) for assigning icons to individual nodes. `shouldAlignNodeIcons` reserves column width for alignment.
- **Custom render callbacks** — `renderNodeCallback`, `renderEmptyStateCallback`, `renderEmptyZoneCallback`, `renderLoadingCallback`, `renderHeaderCallback`, `renderFooterCallback`, `renderContextMenuCallback`

#### Drag and Drop

- **Full DnD support** ported from svelte-treeview
  - `dragDropMode`: `'none'` | `'cross'` | `'both'`
  - Drop zone modes: `'glow'` (CSS highlight) and `'floating'` (positioned drop targets)
  - Drop zone layouts: `'around'` | `'above'` | `'below'` | `'wave'` | `'wave2'`
  - Drop positions: `'above'` | `'below'` | `'child'`
  - Configurable `dropZoneStart` threshold for child zone
  - Per-node `allowedDropPositionsMember` for restricted drop positions
  - Copy operations with `isCopyAllowed` / `shouldAutoHandleCopy`
  - `beforeDropCallback` for validation/interception
  - Touch drag support with ghost element
  - Cross-tree drag detection via shared global state
- **Empty state vs empty zone** — `renderEmptyStateCallback` for informational "no data" display; `renderEmptyZoneCallback` for drop target in empty trees during drag

#### Context Menu

- **Multi-level context menu with Floating UI** — Viewport-aware positioning (flip, shift, offset). `ContextMenuItem` supports `children` for nested submenus at any depth. Submenus open on hover with a 150ms delay.
- **Unified ContextMenuItem interface** — Aligned types across `web-treeview`, `svelte-treeview`, and `canvas-tree`:
  - `ContextMenuEntry = ContextMenuItem | ContextMenuDivider` — discriminated union
  - `ContextMenuDivider` — `{ divider: true, label?: string }`. Named dividers render as `──── LABEL ────` (uppercase, letter-spaced).
  - `ContextMenuItem` fields: `label`, `id`, `icon`, `shortcut`, `isDisabled`, `isVisible`, `className`, `onclick`, `children`
- **Keyboard shortcuts** — `ContextMenuItem.shortcut` displays shortcut text and registers a `keydown` listener when menu is open. Escape closes the menu.
- **`renderContextMenuItemCallback`** — Per-item render callback with "fill or fall through" pattern for mixing custom and default items.
- **`contextMenuXOffset` / `contextMenuYOffset`** — Numeric offsets (px) applied via Floating UI `offset()` middleware.
- **`shouldDisplayContextMenuInDebugMode`** — Keeps context menu permanently open for debugging (ignores outside click and scroll).
- **Icon column alignment** — When any item in a menu level has an icon, all items reserve the icon column for label alignment.
- **19 scoped CSS variables** — `--tv-context-menu-*` variables for fully independent menu styling (bg, border, shadow, padding, font size, icon width, danger color, divider, disabled opacity).

#### CSS & Theming

- **Full CSS custom properties system** — All values flow from `--base-*` design system tokens through `--tv-*` component tokens with hardcoded fallbacks
- **`--base-*` variable alignment** — Uses canonical names from `@keenmate/theme-designer` (`--base-text-color-1`, `--base-text-color-3`, `--base-main-bg`, `--base-elevated-bg`)
- **90+ CSS variables** across 13 categories: colors, node states, typography, spacing, border radius, transitions, DnD glow indicators, DnD state colors, context menu, loading, empty zone, z-index layers
- **`customStylesCallback`** — Injects `<style>` into Shadow DOM for theme overrides
- **`component-variables.manifest.json`** — Machine-readable manifest of all base and component variables for `@keenmate/theme-designer`
- **`--tv-tree-min-height`** — Controls min-height for empty and loading states

#### Logging

- **Categorized Logging** — Runtime-configurable logging with categories: `TREEVIEW:INIT`, `TREEVIEW:DATA`, `TREEVIEW:INDEX`, `TREEVIEW:UI`, `TREEVIEW:DRAG`, `TREEVIEW:RENDER`
- **Performance Logging** — `enablePerfLogging()`, `setPerfThreshold()` for operation timing

#### Examples

- 8+ interactive example pages: basic usage, drag-drop, templates/context menus, programmatic API, logging, theming, icons grid, performance
- Example 3b: Node-aware context menu with `renderContextMenuItemCallback`, custom avatar/chip rendering, CSS variable config panel
- Live theme editor with `customStylesCallback` injection

### Changed

- **Architecture** — From monolithic web component to three-layer architecture:
  1. `WebTreeViewElement` (web component) — attribute/property binding, Shadow DOM
  2. `WebTreeView` (facade) — thin wrapper coordinating controller + renderer
  3. `TreeController` + `TreeViewRenderer` — decoupled state and rendering
- **Member Mapping Defaults** — Only `idMember` (`'id'`), `pathMember` (`'path'`), and `displayValueMember` (`'displayValue'`) have defaults. All other optional members are left `undefined` so LTree auto-calculates them from path structure.
- **`background-color:` → `background:`** — Themed surfaces use the `background` shorthand, allowing gradients or images through variables
- **Context menu offset handling** — Moved from controller (baked into raw coordinates) to renderer (applied as Floating UI `offset()` middleware)

### Removed

- **Svelte dependency** — No framework dependencies; pure vanilla TypeScript
- **Nested DOM rendering** — Replaced by flat rendering with CSS indentation for better performance at scale
