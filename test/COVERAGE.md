# E2E Test Coverage Checklist

Tracks which features of `web-treeview` have end-to-end test coverage in
`e2e/`. Each row is one user-observable feature. Status legend:

- `✗` — no coverage
- `△` — partial coverage (some paths)
- `✓` — covered

When a row is marked `✓`/`△`, the **Spec** column points at the file under
`e2e/` that exercises it, and **Fixture** at the dedicated HTML page under
`test/` (the specs hit no example pages, only fixtures). Known component bugs
are numbered in `test/NOTES.md` (`#N`); tests pinning them are `test.fail`.

Run privately: `npx playwright test -c node_modules/.pw-12520.config.mjs --workers=2`.

---

## 1. Rendering & data

| Feature | Status | Spec | Fixture |
| --- | :-: | --- | --- |
| Renders nodes at `expand-level` | ✓ | `basic.spec.ts` | `basic.html` |
| Dot-path hierarchy (`path-member`) | ✓ | `data.spec.ts` | `data.html` |
| Custom `tree-path-separator` (`/`, `::`) | ✓ | `data.spec.ts` | `data.html` |
| `insertResult` diagnostics (orphans, empty, duplicate) | ✓ | `data.spec.ts` | `data.html` |
| `display-value-fallback` | ✓ | `data.spec.ts` | `data.html` |
| Default display-value order, `order-member`, sibling `sortCallback` (descending, children kept) | ✓ | `data-members.spec.ts` | `data-members.html` |
| `sortCallback` called once per sibling group, never on the flat list (NOTES #16) | ✓ | `data-members.spec.ts` | `data-members.html` |
| `is-sorted` hint: pre-sorted data rendered as given, no sort runs, misordered child → `failed`; `insertBranch` still re-sorts the affected parent | ✓ | `data-members.spec.ts` | `data-members.html` |
| `getDisplayValueCallback` | ✓ | `data-members.spec.ts` | `data-members.html` |
| `parent-path-member` / `level-member` / `id-member` | ✓ | `data-members.spec.ts` | `data-members.html` |
| `data` reassign re-renders, keeps collapsed state (NOTES #17) | △ (test.fail) | `data-members.spec.ts` | `data-members.html` |
| Leaf ↔ folder toggle reconciliation | ✓ | `branch-operations.spec.ts` | `branch-operations.html` |
| Per-row class hooks (`getNodeClassCallback` / `getNodeContentClassCallback`) | ✓ | `feature-port.spec.ts` | `feature-port.html` |
| Per-node icons (`icon-member`, `icon-color-member`, emoji, `renderIconCallback`) | ✓ | `node-icons.spec.ts` | `node-icons.html` |
| `icon-set` (chevron/triangle/plus-minus/arrow, custom classes) | ✓ | `icon-set.spec.ts` | `icon-set.html` |
| Render ctx (device, container, node state) | ✓ | `render-context.spec.ts` | `render-context.html` |
| Empty-state / header / footer callbacks, empty drop zone | ✓ | `render-callbacks.spec.ts` | `render-callbacks.html` |
| `renderLoadingCallback` (NOTES #19), late `renderEmptyZoneCallback` (NOTES #20) | ✗ (test.fail) | `render-callbacks.spec.ts` | `render-callbacks.html` |
| `no-data-text`, `is-loading` on/off | ✓ | `render-callbacks.spec.ts` | `render-callbacks.html` |
| `getCustomStylesCallback` lands in the shadow root | ✓ | `render-callbacks.spec.ts` | `render-callbacks.html` |
| `body-class`, `leaf-icon-class`, `align-node-icons` (default on / off) | ✓ | `render-callbacks.spec.ts` | `render-callbacks.html` |
| Virtual scroll (DOM rows ≈ viewport + overscan, scroll window, far `scrollToPath`) | ✓ | `virtual-scroll.spec.ts` | `virtual-scroll.html` |
| `use-flat-rendering` + `flat-indent-size`, runtime changes incl. `progressive-render` (NOTES #9) | ✓ | `virtual-scroll.spec.ts` | `virtual-scroll.html` |
| `progressive-render` batches complete, also after a mid-flight tree change (NOTES #10) | ✓ | `virtual-scroll.spec.ts` | `virtual-scroll.html` |
| Lazy load via `beforeExpandCallback` (async load → `insertBranch` → expand; re-expand no reload) | ✓ | `lazy-load.spec.ts` | `lazy-load.html` |
| `beforeExpandCallback`: `false` cancels, rejection (warn), spinner + `aria-busy` while pending, repeat toggles ignored, keyboard waits for the load, no call for `expandAll` | ✓ | `lazy-load.spec.ts` | `lazy-load.html` |
| `node-expand` / `node-collapse` for click, keyboard, `expandNodes` / `collapseNodes`; none for `expandAll` / `collapseAll` | ✓ | `lazy-load.spec.ts` | `lazy-load.html` |

## 2. Expand / collapse

| Feature | Status | Spec | Fixture |
| --- | :-: | --- | --- |
| `expandNodes` / `collapseNodes` (string, array, exclusive) | ✓ | `expand-collapse.spec.ts` | `expand-collapse.html` |
| `expandAll` / `collapseAll` (all, subtree, array, exclusive) | ✓ | `expand-collapse.spec.ts` | `expand-collapse.html` |
| `accordion-expand` | ✓ | `basic.spec.ts` | `basic.html` |
| Exclusive expand collapses previously-open sibling | ✓ | `exclusive-expand.spec.ts` | `exclusive-expand.html` |
| `scrollToPath` highlights the target | ✓ | `basic.spec.ts` | `basic.html` |
| `get/setExpandedPaths` round-trip | ✓ | `expand-members.spec.ts` | `expand-members.html` |
| `is-expanded-member` | ✓ | `expand-members.spec.ts` | `expand-members.html` |
| `getIsExpandedCallback` reading `node.data` on the initial load (NOTES #12) | ✓ | `expand-members.spec.ts` | `expand-members.html` |
| `is-collapsible-member` ignores toggle | ✓ | `expand-members.spec.ts` | `expand-members.html` |
| `scroll-highlight-class` / `-timeout` | ✓ | `nav-api.spec.ts` | `nav-api.html` |

## 3. Click, selection & focus

| Feature | Status | Spec | Fixture |
| --- | :-: | --- | --- |
| `click-behavior` expand / select / expand-and-focus | ✓ | `interaction.spec.ts` | `interaction.html` |
| Ctrl+click / Shift+click multi-selection | ✓ | `interaction.spec.ts` | `interaction.html` |
| Double-click (`node-double-click`) | ✓ | `feature-port.spec.ts` | `feature-port.html` |
| Selected / focused markers, `selected-node-class`, `focused-node-class` | ✓ | `selection-focus.spec.ts`, `focused-style-bug.spec.ts` | `selection-focus.html` |
| `selectNode` / `selectNodes` / `clearSelection` / `clearChecked` loud + silent | ✓ | `silent-selection.spec.ts` | `silent-selection.html` |
| `rangeSelectionMode` visual | ✓ | `range-selection.spec.ts` | `range-selection.html` |
| `rangeSelectionMode` logical includes collapsed descendants, forwards + backwards (NOTES #7) | ✓ | `range-selection.spec.ts` | `range-selection.html` |
| `selectionMode='single'` blocks Ctrl/Shift click | ✓ | `range-selection.spec.ts` | `range-selection.html` |
| `selectionMode='single'` blocks Ctrl+A / `selectAll` (NOTES #3) | ✗ (test.fail) | `range-selection.spec.ts` | `range-selection.html` |
| `selectAll` moves focus + emits `focus-change` | ✓ | `range-selection.spec.ts` | `range-selection.html` |
| `selectAll`, `setSelectedPaths` (+ silent), `focusNode` / `clearFocus`, `focus-change` payload | ✓ | `selection-api.spec.ts` | `selection-api.html` |
| Silent focus / select fire no `focus-change` (NOTES #11) | ✓ | `selection-api.spec.ts` | `selection-api.html` |
| Runtime state survives a config-change re-insert | ✓ | `state-persistence.spec.ts` | `selection-focus.html` |

## 4. Checkboxes

| Feature | Status | Spec | Fixture |
| --- | :-: | --- | --- |
| `show-checkboxes`, cascade vs independent | ✓ | `interaction.spec.ts` | `interaction.html` |
| `checkbox-mode` switch re-derives indeterminate | ✓ | `checkbox-mode.spec.ts` | `checkbox-mode.html` |
| `click-toggles-checkbox` | ✓ | `interaction.spec.ts` | `interaction.html` |
| `isSelectableMember` / `isCheckedMember` / `checkedPaths` | ✓ | `member-props.spec.ts` | `member-props.html` |
| `checkNode/checkNodes/setCheckedPaths/checkAll/uncheckNode` (+ silent) | ✓ | `checkbox-api.spec.ts` | `checkbox-api.html` |
| `cascade-check-policy` rolled-up / leaves / all | ✓ | `checkbox-api.spec.ts` | `checkbox-api.html` |
| `beforeCheckboxToggleCallback` (ctx, false cancels, `string[]` overrides) | ✓ | `checkbox-api.spec.ts` | `checkbox-api.html` |

## 5. Keyboard

| Feature | Status | Spec | Fixture |
| --- | :-: | --- | --- |
| Arrow Up/Down/Left/Right, Backspace, Space, Home/End | ✓ | `keyboard-nav.spec.ts` | `keyboard-nav.html` |
| PageUp/PageDown + Shift+Arrow/Home/End/PageUp/PageDown extend (multi; no-op in single) | ✓ | `keyboard-nav.spec.ts` | `keyboard-nav.html` |
| `navigationOverrides` (single-key override, `navTo` override, controller routing, runtime swap / `null`, `beforeKeydownCallback` first) | ✓ | `keyboard-nav.spec.ts` | `keyboard-nav.html` |
| Keyboard moves scroll the focused node into view (`block: 'nearest'`): PageDown ×3, End/Home, Shift+End, no scroll inside the viewport / on click, `navTo` override; virtual End/Home + PageDown | ✓ | `keyboard-scroll.spec.ts` | `keyboard-scroll.html`, `virtual-scroll.html` |
| Delete key + `beforeDeleteCallback` | ✓ | `clipboard-extended.spec.ts` | `clipboard-extended.html` |
| `beforeKeydownCallback` returning false suppresses | ✓ | `clipboard-extended.spec.ts` | `clipboard-extended.html` |
| Ctrl+C/X/V, Ctrl/Shift+Insert, Shift+Del, Esc cancels cut | ✓ | `keyboard-clipboard.spec.ts` | `keyboard-clipboard.html` |
| Cut rows are dimmed, Escape un-dims (NOTES #6) | ✓ | `keyboard-clipboard.spec.ts` | `keyboard-clipboard.html` |
| Copy + paste keeps both rows rendered (rows keyed by path, NOTES #8) | ✓ | `keyboard-clipboard.spec.ts` | `keyboard-clipboard.html` |
| `handle-keyboard-shortcuts=false` | ✓ | `keyboard-clipboard.spec.ts` | `keyboard-clipboard.html` |
| Ctrl+A selects visible selectable; Esc clears selection, keeps checks | ✓ | `keyboard-clipboard.spec.ts` | `keyboard-clipboard.html` |
| `navTo/Next/Prev/First/Last/Into/Out/Toggle/NextSibling/PrevSibling` API | ✓ | `nav-api.spec.ts` | `nav-api.html` |

## 6. Clipboard & mutation API

| Feature | Status | Spec | Fixture |
| --- | :-: | --- | --- |
| `insertBranch` / `replaceBranch` / `deleteBranch` | ✓ | `branch-operations.spec.ts` | `branch-operations.html` |
| `insertBranch` failed[] (mixed validity, empty / duplicate / not-under-parent / orphan), subtree insert, warn once; `replaceBranch` shape (NOTES #1) | ✓ | `branch-operations.spec.ts` | `branch-operations.html` |
| `replaceBranch` notifies the tree once (NOTES #2) | ✓ | `branch-operations.spec.ts` | (LTree direct) |
| Cut / paste branch, paste-into-self error | ✓ | `branch-operations.spec.ts` | `branch-operations.html` |
| Copy/paste/cut events, `beforeCopyCallback`, `beforePasteCallback` | ✓ | `feature-port.spec.ts` | `feature-port.html` |
| `nodeInputTransformationCallback` null skips | ✓ | `clipboard-extended.spec.ts` | `clipboard-extended.html` |
| `deleteNodes()` API | ✓ | `clipboard-extended.spec.ts` | `clipboard-extended.html` |
| `beforeCutCallback` veto / override, `nodeOutputTransformationCallback` on copy-paste | ✓ | `clipboard-extended.spec.ts` | `clipboard-extended.html` |
| `cancelCut` / `hasClipboardContent` / `getClipboardOperation` | ✓ | `clipboard-extended.spec.ts` | `clipboard-extended.html` |
| `auto-handle-paste=false` (event with entries, no mutation) | ✓ | `clipboard-extended.spec.ts` | `clipboard-extended.html` |
| `auto-handle-copy=false` (copy-drop only notifies) | ✓ | `drag-cross-tree.spec.ts` | `drag-cross-tree.html` |
| `addNode/updateNode/removeNode/moveNode(s)/duplicateNodes/copyNodeWithDescendants/applyChanges` | ✓ | `mutation-api.spec.ts` | `mutation-api.html` |
| `duplicateNodes` without transform keeps rows rendered (NOTES #8) | ✓ | `mutation-api.spec.ts` | `mutation-api.html` |

## 7. Drag & drop

| Feature | Status | Spec | Fixture |
| --- | :-: | --- | --- |
| Single-tree drag, before / child positions | ✓ | `drag-drop.spec.ts` | `drag-drop.html` |
| `allowedDropPositionsMember` / `getAllowedDropPositionsCallback` | ✓ | `drag-drop.spec.ts` | `drag-drop.html` |
| Multi-drag (child / after, locked node) | ✓ | `drag-drop.spec.ts` | `drag-drop.html` |
| Multi-drag top-level absorption — child + after drop (NOTES #5, closed) | ✓ | `drag-drop.spec.ts` | `drag-drop.html` |
| Cross-tree absorption: move carries top-level paths only, Ctrl copy-drop no duplicates (NOTES #5) | ✓ | `drag-cross-tree.spec.ts` | `drag-cross-tree.html?multi` |
| Cross-tree `dragged` refs resolve to the source nodes (NOTES #26) | ✓ | `drag-cross-tree.spec.ts` | `drag-cross-tree.html?multi` |
| `isDropAllowed=false`, `drag-drop-mode` self/cross | ✓ | `drag-drop.spec.ts` | `drag-drop.html` |
| Esc during drag restores selection | ✓ | `drag-esc-cancel.spec.ts` | `drag-esc-cancel.html` |
| Touch drag (ghost, highlight, drop) | ✓ | `touch-drag.spec.ts` | `drag-drop.html` |
| `beforeDropCallback` false / redirect / copy / `DropGroup[]` / async | ✓ | `drag-hooks.spec.ts` | `drag-hooks.html` |
| `beforeDragStartCallback` prune + veto | ✓ | `drag-hooks.spec.ts` | `drag-hooks.html` |
| Cross-tree move (consumer-owned, `dropped=null`), Ctrl-drag copy same/cross tree, `allow-copy` | ✓ | `drag-cross-tree.spec.ts` | `drag-cross-tree.html` |
| `nodeOutputTransformationCallback` on copy-drop (NOTES #21) | ✗ (test.fail) | `drag-cross-tree.spec.ts` | `drag-cross-tree.html` |
| Drag classes (`--dragged`, `dragged-node-class`, glow), floating `drop-zone-*` | ✓ | `drag-visuals.spec.ts` | `drag-visuals.html` |
| Touch: `node-drag-reject` + 🚫, `indicate-undraggable=false`, `touch-drag-delay` | ✓ | `drag-visuals.spec.ts` | `drag-visuals.html` |
| Desktop: drop on no-drop node refused | ✓ | `drag-visuals.spec.ts` | `drag-visuals.html` |
| Desktop: `node-drop-reject` + `enable-tree-drop-zone` routing (NOTES #22) | ✗ (test.fail) | `drag-visuals.spec.ts` | `drag-visuals.html` |

## 8. Search

| Feature | Status | Spec | Fixture |
| --- | :-: | --- | --- |
| Filter / clear / Escape / `searchNodes` | ✓ | `search.spec.ts` | `search.html` |
| Result navigation expands + scrolls collapsed hits | ✓ | `search-deep.spec.ts` | `search-deep.html` |
| `search-text` attribute / `searchText` prop at runtime (NOTES #18) | ✗ (test.fail) | `search-config.spec.ts` | `search-config.html` |
| `search-value-member` / `getSearchValueCallback` | ✓ | `search-config.spec.ts` | `search-config.html` |
| Internal index off; `filterNodes` | ✓ | `search-config.spec.ts` | `search-config.html` |

## 9. Context menu & actions

| Feature | Status | Spec | Fixture |
| --- | :-: | --- | --- |
| `getContextMenuItemsCallback` items, submenu, disabled, divider | ✓ | `context-menu.spec.ts` | `context-menu.html` |
| Core action items, built-ins, `beforeActionCallback`, `action` event | ✓ | `interaction-model.spec.ts` | `interaction-model.html` |
| One-ctx callbacks + `el.controller` | ✓ | `interaction-model.spec.ts` | `interaction-model.html` |
| `renderContextMenuCallback` / `renderContextMenuItemCallback` | ✓ | `context-menu-render.spec.ts` | `context-menu-render.html` |
| `openContextMenu(path,x,y)` + offsets, `closeContextMenu`; shortcut keys + Escape in menu | ✓ | `context-menu-render.spec.ts` | `context-menu-render.html` |
| Context menu keyboard (WAI-ARIA): Shift+F10 / ContextMenu key open, ↑↓ wrap + skip disabled, Home/End, →/Enter submenu, ←/Esc back, Enter/Space run, Esc/Tab close + focus return, mouse-opened menu operable, menu roles | ✓ | `context-menu-render.spec.ts` | `context-menu-render.html` |

## 10. Tooltips, theming, misc

| Feature | Status | Spec | Fixture |
| --- | :-: | --- | --- |
| Node tooltips (text, rich, follow-cursor, toggle off) | ✓ | `tooltip.spec.ts` | `tooltip.html` |
| `tooltip-placement` / `-offset`, `tooltip-delay` attribute | ✓ | `tooltip.spec.ts` | `tooltip.html` |
| `tooltipDelay = { show, hide }` property (NOTES #23) | ✗ (test.fail) | `tooltip.spec.ts` | `tooltip.html` |
| Theming (library defaults, brand light-dark, page signals, `theme`) | ✓ | `theming.spec.ts` | `theming.html` |
| Attribute removal resets to default (`show-checkboxes`, `selected-node-class`) | ✓ | `attr-reactivity.spec.ts` | `attr-reactivity.html` |
| Removing `expand-level` resets to roots only (NOTES #14) | ✓ | `attr-reactivity.spec.ts` | `attr-reactivity.html` |
| `setAttributes` batch | ✓ | `attr-reactivity.spec.ts` | `attr-reactivity.html` |
| `el.prop = x; el.method()` sees x (NOTES #13; element methods flush first) | ✓ | `attr-reactivity.spec.ts` | `attr-reactivity.html` |
| Lifecycle: listeners survive a move, fire once; detached config applied on reconnect | ✓ | `lifecycle.spec.ts` | `lifecycle.html` |
| Lifecycle: re-parent / remove + re-append keeps expansion, selection, checks, focus, search (NOTES #15, D1) | ✓ | `lifecycle.spec.ts` | `lifecycle.html` |
| Lifecycle: virtual-scroll offset survives a move | ✓ | `lifecycle.spec.ts` | `virtual-scroll.html` |
| Lifecycle: no duplicated document/window listeners after N moves; released while detached; open context menu closes on a move | ✓ | `lifecycle.spec.ts` | `lifecycle.html` |
| Logging silent by default (NOTES #24) | ✗ (test.fail) | `logging.spec.ts` | `logging.html` |
| `logging.enableLogging()` turns categories on | ✓ | `logging.spec.ts` | `logging.html` |
| `should-display-debug-information`, `tree-id` | ✓ | `logging.spec.ts` | `logging.html` |
| Uncaught page errors fail every test (`e2e/fixtures.ts`) | ✓ | all | — |
