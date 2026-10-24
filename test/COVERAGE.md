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
| `isSorted` / `orderMember` / `sortCallback` order | ✗ | | |
| `getDisplayValueCallback` | ✗ | | |
| `parentPathMember` / `levelMember` / `idMember` | ✗ | | |
| `data` reassign re-renders | ✗ | | |
| Leaf ↔ folder toggle reconciliation | ✓ | `branch-operations.spec.ts` | `branch-operations.html` |
| Per-row class hooks (`getNodeClassCallback` / `getNodeContentClassCallback`) | ✓ | `feature-port.spec.ts` | `feature-port.html` |
| Per-node icons (`icon-member`, `icon-color-member`, emoji, `renderIconCallback`) | ✓ | `node-icons.spec.ts` | `node-icons.html` |
| `icon-set` (chevron/triangle/plus-minus/arrow, custom classes) | ✓ | `icon-set.spec.ts` | `icon-set.html` |
| Render ctx (device, container, node state) | ✓ | `render-context.spec.ts` | `render-context.html` |
| Empty-state / loading / header / footer / empty-zone callbacks | ✗ | | |
| `no-data-text`, `is-loading` | ✗ | | |
| `getCustomStylesCallback` lands in the shadow root | ✗ | | |
| `body-class`, `leaf-icon-class`, `align-node-icons` | ✗ | | |
| Virtual scroll (DOM rows ≈ viewport + overscan, scroll window, far `scrollToPath`) | ✓ | `virtual-scroll.spec.ts` | `virtual-scroll.html` |
| `use-flat-rendering` + `flat-indent-size` (runtime change: NOTES #9) | △ | `virtual-scroll.spec.ts` | `virtual-scroll.html` |
| `progressive-render` batches complete (NOTES #10) | ✗ (test.fail) | `virtual-scroll.spec.ts` | `virtual-scroll.html` |
| Lazy load (`hasChildrenMember` toggle → expand → `insertBranch`) | ✓ | `lazy-load.spec.ts` | `lazy-load.html` |

## 2. Expand / collapse

| Feature | Status | Spec | Fixture |
| --- | :-: | --- | --- |
| `expandNodes` / `collapseNodes` (string, array, exclusive) | ✓ | `expand-collapse.spec.ts` | `expand-collapse.html` |
| `expandAll` / `collapseAll` (all, subtree, array, exclusive) | ✓ | `expand-collapse.spec.ts` | `expand-collapse.html` |
| `accordion-expand` | ✓ | `basic.spec.ts` | `basic.html` |
| Exclusive expand collapses previously-open sibling | ✓ | `exclusive-expand.spec.ts` | `exclusive-expand.html` |
| `scrollToPath` highlights the target | ✓ | `basic.spec.ts` | `basic.html` |
| `get/setExpandedPaths` round-trip | ✗ | | |
| `isExpandedMember` / `getIsExpandedCallback` | ✗ | | |
| `isCollapsibleMember` ignores toggle | ✗ | | |
| `scroll-highlight-class` / `-timeout` | ✗ | | |

## 3. Click, selection & focus

| Feature | Status | Spec | Fixture |
| --- | :-: | --- | --- |
| `click-behavior` expand / select / expand-and-focus | ✓ | `interaction.spec.ts` | `interaction.html` |
| Ctrl+click / Shift+click multi-selection | ✓ | `interaction.spec.ts` | `interaction.html` |
| Double-click (`node-double-click`) | ✓ | `feature-port.spec.ts` | `feature-port.html` |
| Selected / focused markers, `selected-node-class`, `focused-node-class` | ✓ | `selection-focus.spec.ts`, `focused-style-bug.spec.ts` | `selection-focus.html` |
| `selectNode` / `selectNodes` / `clearSelection` / `clearChecked` loud + silent | ✓ | `silent-selection.spec.ts` | `silent-selection.html` |
| `rangeSelectionMode` visual | ✓ | `range-selection.spec.ts` | `range-selection.html` |
| `rangeSelectionMode` logical includes collapsed descendants (NOTES #7) | ✗ (test.fail) | `range-selection.spec.ts` | `range-selection.html` |
| `selectionMode='single'` blocks Ctrl/Shift click | ✓ | `range-selection.spec.ts` | `range-selection.html` |
| `selectionMode='single'` blocks Ctrl+A / `selectAll` (NOTES #3) | ✗ (test.fail) | `range-selection.spec.ts` | `range-selection.html` |
| `selectAll` moves focus + emits `focus-change` | ✓ | `range-selection.spec.ts` | `range-selection.html` |
| `selectAll`, `setSelectedPaths`, `focusNode` / `clearFocus`, `focus-change` | ✗ | | |
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
| PageUp/PageDown + Shift-extend | ✗ (feature gap, NOTES #4) | `keyboard-nav.spec.ts` (skipped) | `keyboard-nav.html` |
| Delete key + `beforeDeleteCallback` | ✓ | `clipboard-extended.spec.ts` | `clipboard-extended.html` |
| `beforeKeydownCallback` returning false suppresses | ✓ | `clipboard-extended.spec.ts` | `clipboard-extended.html` |
| Ctrl+C/X/V, Ctrl/Shift+Insert, Shift+Del, Esc cancels cut | ✓ | `keyboard-clipboard.spec.ts` | `keyboard-clipboard.html` |
| Cut rows are dimmed (NOTES #6) | ✗ (test.fail) | `keyboard-clipboard.spec.ts` | `keyboard-clipboard.html` |
| Copy + paste keeps both rows rendered (NOTES #8) | ✗ (test.fail) | `keyboard-clipboard.spec.ts` | `keyboard-clipboard.html` |
| `handle-keyboard-shortcuts=false` | ✓ | `keyboard-clipboard.spec.ts` | `keyboard-clipboard.html` |
| Ctrl+A selects visible selectable; Esc clears selection, keeps checks | ✓ | `keyboard-clipboard.spec.ts` | `keyboard-clipboard.html` |
| `navTo/Next/Prev/Into/Toggle` API | ✗ | | |

## 6. Clipboard & mutation API

| Feature | Status | Spec | Fixture |
| --- | :-: | --- | --- |
| `insertBranch` / `replaceBranch` / `deleteBranch` | ✓ | `branch-operations.spec.ts` | `branch-operations.html` |
| `insertBranch` failed count (NOTES #1) | ✗ (skip) | `branch-operations.spec.ts` | `branch-operations.html` |
| Cut / paste branch, paste-into-self error | ✓ | `branch-operations.spec.ts` | `branch-operations.html` |
| Copy/paste/cut events, `beforeCopyCallback`, `beforePasteCallback` | ✓ | `feature-port.spec.ts` | `feature-port.html` |
| `nodeInputTransformationCallback` null skips | ✓ | `clipboard-extended.spec.ts` | `clipboard-extended.html` |
| `deleteNodes()` API | ✓ | `clipboard-extended.spec.ts` | `clipboard-extended.html` |
| `beforeCutCallback`, `nodeOutputTransformationCallback` | ✗ | | |
| `cancelCut` / `hasClipboardContent` / `getClipboardOperation`, `allow-copy` | ✗ | | |
| `auto-handle-copy/paste=false` | ✗ | | |
| `addNode/updateNode/removeNode/moveNode(s)/duplicateNodes/copyNodeWithDescendants/applyChanges` | ✓ | `mutation-api.spec.ts` | `mutation-api.html` |
| `duplicateNodes` without transform keeps rows rendered (NOTES #8) | ✗ (test.fail) | `mutation-api.spec.ts` | `mutation-api.html` |

## 7. Drag & drop

| Feature | Status | Spec | Fixture |
| --- | :-: | --- | --- |
| Single-tree drag, before / child positions | ✓ | `drag-drop.spec.ts` | `drag-drop.html` |
| `allowedDropPositionsMember` / `getAllowedDropPositionsCallback` | ✓ | `drag-drop.spec.ts` | `drag-drop.html` |
| Multi-drag (child / after, locked node) | ✓ | `drag-drop.spec.ts` | `drag-drop.html` |
| Multi-drag top-level absorption (NOTES #5, not reproducible) | ✓ | `drag-drop.spec.ts` | `drag-drop.html` |
| `isDropAllowed=false`, `drag-drop-mode` self/cross | ✓ | `drag-drop.spec.ts` | `drag-drop.html` |
| Esc during drag restores selection | ✓ | `drag-esc-cancel.spec.ts` | `drag-esc-cancel.html` |
| Touch drag (ghost, highlight, drop) | ✓ | `touch-drag.spec.ts` | `drag-drop.html` |
| `beforeDropCallback` false / redirect / copy / `DropGroup[]` / async | ✓ | `drag-hooks.spec.ts` | `drag-hooks.html` |
| `beforeDragStartCallback` prune + veto | ✓ | `drag-hooks.spec.ts` | `drag-hooks.html` |
| Cross-tree drag, Ctrl-drag copy | ✗ | | |
| Drag visuals (reject classes, `indicate-undraggable`, tree drop zone, `drop-zone-*`) | ✗ | | |

## 8. Search

| Feature | Status | Spec | Fixture |
| --- | :-: | --- | --- |
| Filter / clear / Escape / `searchNodes` | ✓ | `search.spec.ts` | `search.html` |
| Result navigation expands + scrolls collapsed hits | ✓ | `search-deep.spec.ts` | `search-deep.html` |
| `search-text` attribute, `searchValueMember` / `getSearchValueCallback` | ✗ | | |
| Internal index off; `filterNodes` | ✗ | | |

## 9. Context menu & actions

| Feature | Status | Spec | Fixture |
| --- | :-: | --- | --- |
| `getContextMenuItemsCallback` items, submenu, disabled, divider | ✓ | `context-menu.spec.ts` | `context-menu.html` |
| Core action items, built-ins, `beforeActionCallback`, `action` event | ✓ | `interaction-model.spec.ts` | `interaction-model.html` |
| One-ctx callbacks + `el.controller` | ✓ | `interaction-model.spec.ts` | `interaction-model.html` |
| `renderContextMenuCallback` / `renderContextMenuItemCallback` | ✗ | | |
| `openContextMenu(path,x,y)` + offsets; keyboard in menu | ✗ | | |

## 10. Tooltips, theming, misc

| Feature | Status | Spec | Fixture |
| --- | :-: | --- | --- |
| Node tooltips (text, rich, follow-cursor, toggle off) | ✓ | `tooltip.spec.ts` | `tooltip.html` |
| `tooltip-placement` / `-offset` / `-delay` | ✗ | | |
| Theming (library defaults, brand light-dark, page signals, `theme`) | ✓ | `theming.spec.ts` | `theming.html` |
| Attribute removal resets to default; `setAttributes` batch; prop→method sync | ✗ | | |
| Lifecycle: re-parent keeps expansion/selection/listeners | ✗ | | |
| Logging silent by default; `should-display-debug-information`, `tree-id` | ✗ | | |
| Uncaught page errors fail every test (`e2e/fixtures.ts`) | ✓ | all | — |
