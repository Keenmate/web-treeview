# Test infrastructure notes

Running notes from the e2e harness. Each entry is something noticed while
building fixtures + specs that looks like a bug, friction point, or
worth-revisiting design decision in the component itself — not a problem with
the tests. Specs that pin a known bug use `test.fail(true, 'NOTES.md #N')`
(the test asserts the *correct* behaviour, so it turns red-to-"unexpected
pass" once the bug is fixed — then drop the `test.fail`).

Entries 1–5 are the audit's known bugs TV-1…TV-5
(`web-components-core/docs/e2e-coverage-plan.md`, WP-TV).

---

## Open questions for the user (2026-10-24 e2e run)

- ~~**TV-4** (PageUp/PageDown + Shift-extend)~~ — implemented 2026-10-25 (see #4).
- ~~**D1 for the treeview** (#15)~~ — decided (a move keeps ALL state) and
  implemented 2026-10-25 (see #15).
- ~~**TV-5** (#5)~~ — closed 2026-10-25 (child, after and cross-tree variants all pass).
- **TV-1** (#1): the `insertBranch` mixed-validity test stays skipped — which
  items should count as invalid for `addNode` (empty / duplicate path? missing
  id?) needs a decision before the return shape (`failed`) can be specified.
- **No expand/collapse event**: lazy loading has to hook `node-click` or
  `tree-change` (a toggle click emits only `tree-change`). Add a
  `node-expand` / `node-collapse` event (with a before-hook for async loads)?
- **Context menu keyboard**: only item shortcut letters + Escape work; no
  ArrowUp/Down/Enter navigation inside the menu (a11y). Wanted?
- **#16 / is-sorted semantics**: fix the code (one sibling-sort meaning) or
  document "is-sorted = input pre-sorted, parents first"?

---

## 1. (TV-1) `insertBranch` never reports failures

**Where:** `src/ltree/ltree.ts` `insertBranch()` (~1541-1556).

**Symptom:** always returns `{ success: true, count }` — items that `addNode`
rejected are silently dropped; there is no `failed` count / list, so a caller
can't tell a partial insert from a full one.

**Repro:** `insertBranch('1', [valid, { path: '' }, orphan])` → `success: true,
count: 1`, no failure info.

**Suggested fix:** collect the `addNode` failures and return
`{ success: failed.length === 0, count, failed }` (mirrors `insertArray`'s
`insertResult.failed`).

**Test status:** `branch-operations.spec.ts` "insertBranch with mixed-validity
items reports failed count" stays `test.skip` until the return shape exists.

## 2. (TV-2) `replaceBranch` emits tree-changed twice; `removed` counts direct children only

**Where:** `src/ltree/ltree.ts` `replaceBranch()` (~1582-1584).

**Symptom:** it calls `insertBranch()` (which emits `_emitTreeChanged()`) and
then emits again → two `tree-change` notifications for one operation.
`removed` is the number of *direct* children removed, not the number of nodes
(descendants are removed too but not counted).

**Suggested fix:** use an internal non-emitting insert, emit once; count
removed descendants (sum of `removeNode` results).

## 3. (TV-3) `selectAll` ignores `selectionMode='single'` and moves focus silently

**Where:** `src/controller/tree-engine.ts` `selectAll()` (~1664-1679).

**Symptom:** in `selectionMode="single"` `selectAll()` still selects every
visible node; it also sets `_focusedNode` to the last visible node without
emitting `focus-change`.

**Suggested fix:** no-op (or select only the focused node) when
`selectionMode !== 'multi'`.

**Test status:** `range-selection.spec.ts` "Ctrl+A does not select everything"
(single mode) is `test.fail`. The focus half did NOT reproduce: `selectAll()`
moves focus to the last visible row and a `focus-change` *is* emitted (pinned
as a passing test in the same spec).

## 4. ~~(TV-4) PageUp / PageDown / Shift-extend keyboard selection unimplemented~~ — resolved

**Where:** `src/renderer/dom-renderer.ts` keyboard handler +
`src/controller/tree-engine.ts` `createDefaultNavigation()`.

**Was:** feature gap vs the Svelte build — PageUp/PageDown didn't move focus,
Shift+Arrow/Home/End/PageUp/PageDown didn't extend the selection.

**Resolved 2026-10-25:** ported 1:1 from svelte-treeview — PageDown/PageUp
jump ±10 visible rows (clamped); the Shift variants extend the selected range
from the anchor in multi mode (no-op in single); `navHighlight*` became
`navSelect*` (this package's vocabulary). New `navigationOverrides` property
merges over the defaults (svelte's `{ ...createDefaultNavigation(), ...overrides }`).
The 10 `keyboard-nav.spec.ts` skips are now real tests, plus anchor / single-mode
/ `navigationOverrides` tests (39 in the spec, all green).

## 5. ~~(TV-5) Multi-drag top-level absorption doesn't move~~ — closed (not reproducible)

**Where:** multi-drag in `src/controller/tree-engine.ts` (drop of a selected set
where one selected node is a descendant of another selected node).

**Symptom:** dragging a selection that contains an ancestor and one of its
descendants does nothing — the descendant should ride along inside its
ancestor and the ancestor should move.

**Status 2026-10-24: does NOT reproduce.** Written out as a real test
(select A-1, Ctrl-select A and B, drag A onto D as child): A and B land under
D, A-1 stays inside A, 6 rows. It passes (3/3 repeats), so the skip was
replaced by a passing test in `drag-drop.spec.ts`. Likely fixed by the
`moveNodes` manifest/holes rework; close TV-5 unless the user saw it in a
different setup (e.g. absorption with an `after` drop or cross-tree).

**Closed 2026-10-25.** The other setups pass too (3/3 repeats each):
- `drag-drop.spec.ts` — same selection dropped AFTER D: roots C, D, A, B;
  A-1 / A-2 stay A's direct children; 6 rows, one `node-drop`.
- `drag-cross-tree.spec.ts` (`drag-cross-tree.html?multi`) — dropped into
  tree B as a child of B-Folder. A cross-tree MOVE is consumer-owned (trees
  untouched, `dropped=null`): `node-drop` on B carries exactly the top-level
  paths `['1', '2']` (A-1 absorbed, no duplicate). A Ctrl copy-drop lands
  A (with A-1, A-2 inside) and B under B-Folder, no duplicates; tree A keeps
  everything. One unrelated bug surfaced there — #26.

## 6. Cut rows are never dimmed (and never un-dimmed)

**Where:** `src/renderer/dom-renderer.ts` keyed reconcile (~945-963) +
`src/controller/tree-engine.ts` `cutNodes()` / `cancelCut()`.

**Symptom:** Ctrl+X / `cutNodes()` sets `engine.cutPaths` but the row never
gets `.wtv__node-content--cut`. The reconciler only calls
`_updateNodeElement` when `_rev` / expanded / hasChildren / focused / selected
changed, and cutting changes none of those, so the class toggle at ~1427
never runs. The same goes for removing the class on `cancelCut()` / Escape
(if the row was re-rendered for another reason while cut).

**Repro:** `keyboard-clipboard.html` — click Notes, Ctrl+X → no dimming.

**Suggested fix:** bump `_rev` on every node entering/leaving `cutPaths`
(cut, cancel, paste), or add a `data-cut` attribute to the reconcile guard like
`data-focused` / `data-selected`.

**Test status:** `keyboard-clipboard.spec.ts` "a cut row … is dimmed" is
`test.fail`.

## 7. `range-selection-mode="logical"` only ranges over root nodes

**Where:** `src/controller/tree-engine.ts` `_rangeSelect()` (~1697-1700) uses
`this.tree.tree` for logical mode; `ltree.ts` `get tree()` (~168) returns
`Object.values(root.children)` — the ROOTS only, not a flat depth-first list.

**Symptom:** in logical mode a Shift+click whose anchor or target is not a
root finds no index and silently does nothing (selection stays on the anchor);
between two roots it selects only the roots, never their (collapsed)
descendants — the opposite of what "logical" promises.

**Repro:** `range-selection.html?range=logical` — click A1 (1.1), Shift+click
B1 (2.1) → selection stays `['1.1']`.

**Suggested fix:** walk the full tree depth-first in sort order (like
`visibleFlatNodes` but ignoring `isExpanded`) for logical mode.

**Test status:** two `test.fail` tests in `range-selection.spec.ts`.

## 8. Copies keep the source `id` → the keyed renderer drops rows

**Where:** `src/renderer/dom-renderer.ts` reconcile keys rows by
`String(node.id || node.path)` (~931); copy paths
(`tree-engine.ts` paste / `duplicateNodes` / copy-drop) keep `data.id` unless
the consumer's `nodeInputTransformationCallback` / `transform` assigns a new one.

**Symptom:** after a default copy + paste (Ctrl+C / Ctrl+V, `pasteNodes`,
`duplicateNodes` without a transform) the model holds two nodes with the same
id, both share one DOM key, and one of them (the original) disappears from
the rendered tree. Nothing warns.

**Repro:** `keyboard-clipboard.html` — click Notes, Ctrl+C, click Pic,
Ctrl+V → `getChildren('2.1')` has Notes, but only one "Notes" row is rendered.
`mutation-api.html` — `duplicateNodes(['1','1.1','1.2'], '3', 'child')` → the
original Fruits/Apple/Banana rows vanish.

**Suggested fix:** key rows by `path` (unique by construction) or by
`treeId + path`, or have the copy path assign fresh ids when no transform did
— copy-DROP already does this via `_defaultCopyTransform`
(`tree-engine.ts` ~4325), paste / `duplicateNodes` don't (and warn on
duplicate ids in `insertArray`).

**Test status:** `test.fail` in `keyboard-clipboard.spec.ts` ("both the
original and the copy are rendered") and `mutation-api.spec.ts`
("duplicateNodes without a transform keeps every row rendered").

## 9. Flat / progressive inputs are construction-only (runtime changes ignored)

**Where:** `src/controller/tree-engine.ts` — `flatIndentSize`,
`isFlatRenderingEnabled`, `isProgressiveRender`, `initialBatchSize`,
`maxBatchSize` are read in the constructor (~744-748) but the `update(updates)`
handler (~3440-3460) never applies them, although the inputs are declared
`on: 'update'` in `web-component.ts` (~179-183).

**Symptom:** `el.setAttribute('flat-indent-size', '10px')` (or the property)
after the tree was built changes nothing. Configured before the first connect
it works.

**Suggested fix:** apply them in `update()` (+ `_scheduleNotify()` / full
render), or declare them `on: 'reinit'`.

**Test status:** `virtual-scroll.spec.ts` "changing flat-indent-size at
runtime re-indents the rows" is `test.fail`.

## 10. Progressive rendering stalls — most rows of a large tree never render

**Where:** `src/controller/tree-engine.ts` `_updateProgressiveRendering()`
(~3753-3815). Likely cause: when it runs again while a batch queue is still
pending, it *replaces* `flatRenderQueue` with the new call's remainder
(`this.flatRenderQueue = [...remaining]`) instead of appending, so the old
queue is lost.

**Symptom:** `virtual-scroll.html?mode=progressive` (2000 rows,
`use-flat-rendering` + `progressive-render`, configured before connect):
the DOM grows 20 → 40 → 80 → 109 rows and stays at 109 forever
(`getVisibleFlatNodes()` also reports 109). Flat + progressive are the
DEFAULTS when virtual scroll is off, so any large, sorted, non-virtual tree
is affected.

**Bisect** (2000 rows, expand-level=1, element configured before connect,
rows counted after 2.5 s):

| config | rows rendered |
| --- | --- |
| defaults | 2000 ✓ |
| `use-flat-rendering` + `progressive-render` explicit | 2000 ✓ |
| + `initial-batch-size="10"` only | **1990** (the first batch is lost) |
| + `isSorted` + `sortCallback` only | **119** (stalls) |
| all of the above | **109** |

So the trigger is a re-run of `_updateProgressiveRendering` (sorting re-inserts
/ re-orders → new tracker) while a queue is pending, and a non-default initial
batch loses rows on its own.

**Suggested fix:** append new ids to the pending queue (de-duplicated) and
keep the current batch size; make sure the immediate batch survives a
`flatRenderedIds` reset; add unit tests for repeated calls.

**Test status:** `virtual-scroll.spec.ts` "a large tree renders in growing
batches until every row is in the DOM" is `test.fail`.

## 11. Silent focus / selection still fire `focus-change`

**Where:** `src/treeview.ts` (~106-116) emits `focus-change` from the
engine's `state-change` whenever the focused path differs; the engine's
`focusNode(path, _options)` / `clearFocus(_options)` ignore `silent`, and a
silent `selectNode` moves focus too.

**Symptom:** `focusNode('1.2', { silent: true })`, `clearFocus({ silent: true })`
and `selectNode('1.2', 'replace', { silent: true })` each fire `focus-change`.
That breaks the URL-restore use case the silent flag exists for (restoring
state without echoing events).

**Suggested fix:** let the engine mark a silent focus move (e.g. set
`lastFocusedPath` through a silent channel / carry a `silentFocus` flag on the
snapshot) so the facade skips that one `focus-change`.

**Test status:** two `test.fail` in `selection-api.spec.ts`.

## 12. Per-node `get*Callback`s see `node.data === undefined` during the initial load

**Where:** `src/ltree/ltree.ts` `insertArray()` (~292-314): the per-node
callbacks (`getIsExpandedCallback`, `getIsSelectableCallback`,
`getIsCheckedCallback`, `getIsDraggableCallback`, `getIsDropAllowedCallback`)
run BEFORE `node.data = row` is assigned (~314). `addNode()` (~1260) assigns
`data` first, so the two paths disagree.

**Symptom:** `getIsExpandedCallback = ({ node }) => node.data.name.startsWith('Open')`
throws `Cannot read properties of undefined (reading 'name')` on load and the
tree renders nothing.

**Suggested fix:** assign `node.data = row` right after the path is validated,
before any callback runs.

**Test status:** `expand-members.spec.ts` "getIsExpandedCallback seeds
expansion per node" is `test.fail`.

## 13. Public element methods don't `flush()` pending property writes

**Where:** `src/web-component.ts` — the proxied methods (`getNodeByPath`,
`checkNode`, `expandAll`, …, ~536-820) call `this.#treeview?.x()` directly.
Only `createController()` (~826) calls `this.flush()`. Core's rule (CLAUDE.md
"whenSettled()/flush()"): an imperative method that reads/mutates live state
calls `this.flush()` first, so `el.prop = x; el.method()` sees `x`.

**Symptom:** `el.data = more; el.getNodeByPath('3.1')` → `null`;
`el.checkboxMode = 'independent'; el.checkNode('1')` still cascades. The same
sequence through `el.controller` works.

**Suggested fix:** `this.flush()` at the top of every public method (a small
`#live()` helper returning `this.#treeview` after a flush).

**Test status:** two `test.fail` in `attr-reactivity.spec.ts`.

## 14. Removing `expand-level` is a no-op

**Where:** `src/web-component.ts` ~116 — `expandLevel` has no `default`, so
removing the attribute resets it to `undefined`; the engine's update guard
(`updates.expandLevel !== undefined`, `tree-engine.ts` ~3310) then ignores it.

**Symptom:** `<web-treeview expand-level="2">` → `removeAttribute('expand-level')`
keeps level 2 open; core's contract is "absent == default" (roots only).

**Suggested fix:** `default: 0` on the input (or a nullable converter so the
removal forwards `null`, which the engine already treats as "no auto-expand").
Worth auditing the other inputs without a `default` for the same pattern.

**Test status:** `attr-reactivity.spec.ts` "expand-level removed" is `test.fail`.

## 15. ~~A DOM move rebuilds the tree — expansion, selection, checks, focus lost~~ — resolved

**Resolved 2026-10-25 (D1: a DOM move keeps ALL state).** The `WebTreeView`
(engine + renderer) is built once in `reinit()` and kept; `disconnect()` →
`WebTreeView.deactivate()` stops only live resources — renderer: environment /
size observers, the document `dragend` listener, context-menu autoUpdate +
keydown, shown tooltips; engine: open context menu (its document / window
dismiss listeners), an in-flight touch drag, the cross-tree clipboard registry
entry. `connect()` → `activate()` restarts them and restores the body scroll
offset (tracked while connected — a detached element reads 0 and the browser
resets it on re-insert). Body listeners live inside the shadow root and stay
attached. Expansion, selection, checks, focus, search and scroll survive a move
and a remove + re-append. Tests: the two `test.fail` in `lifecycle.spec.ts`
are green; added remove + re-append, virtual-scroll offset, "no duplicated
document/window listeners after N moves" (+ released while detached) and
"open context menu closes on a move" tests.

Original report:

**Where:** `src/web-component.ts` `disconnect()` (~404-407) destroys the
`WebTreeView` (engine + renderer); `connect()` (~399-401) builds a fresh one
from config. Core's lifecycle is build-once + activate/deactivate: a move is
`disconnect()` → `connect()` and should re-activate without a rebuild.

**Symptom:** expand A, select A1 + B, check A2, then `appendChild` the tree
elsewhere → back to the `expand-level` seed, selection / checks / focus gone
(runtime state not in `data`). Same for remove + re-append. Listeners do
re-attach (clicks / keys work, no duplicates).

**Decision context:** D1 in `web-components-core/docs/e2e-coverage-plan.md`
decided "a DOM move keeps state" for dropzone / editor / daterangepicker; the
WP-TV row asks the same of the treeview (re-parent keeps expansion /
selection / listeners). **Confirm with the user** that D1 applies here too.

**Suggested fix:** keep the `WebTreeView` across disconnect; in
`disconnect()` only stop live resources (environment observers, tooltips'
autoUpdate, document-level listeners, context menu), restart them in
`connect()`; destroy on `reinit()` only.

**Test status:** was two `test.fail` in `lifecycle.spec.ts` — now passing.

## 16. `sortCallback` means two different things depending on `is-sorted`

**Where:** `src/ltree/ltree.ts` — with `isSorted` unset, `insertArray()`
(~321-323) applies `sortCallback` to the WHOLE flat input list before
inserting; with `isSorted` set, `visibleFlatNodes` (~210) applies it per
sibling group at render time. The input docs say "Custom sibling sort" and
"is-sorted: Keep siblings sorted".

**Symptom:** a plain sibling comparator (descending by name) without
`is-sorted` puts children before their parents in the insert order → the
children are dropped as orphans (`insertResult.failed`), silently from the
UI's point of view. `data-members.html?mode=callback-unsorted` renders
Cucumber / Banana / Apple with no children.

Related: with `is-sorted` the input must already list parents before
children — a child listed before its parent is dropped as an orphan too
(only visible in `getInsertResult().failed`).

**Suggested fix:** always apply `sortCallback` per sibling group (insert in
level/path order first), or document `is-sorted` as "input is pre-sorted
(parents first); sortCallback orders siblings at render" and warn (console)
when orphans appear.

**Test status:** `data-members.spec.ts` "a sibling sortCallback without
is-sorted keeps every node" is `test.fail`.

## 17. Reassigning `data` re-expands branches the user collapsed (when none were open)

**Where:** `src/controller/tree-engine.ts` `_reapplyExpanded()` (~3726):
`if (... expanded.size === 0) return;` — an EMPTY preserved set is treated as
"nothing to restore", so the fresh insert's `expand-level` seed stands.

**Symptom:** expand-level=2, collapse the only branch (Apple), assign new
`data` → Apple is open again. With at least one other branch still open the
collapsed one stays collapsed, so the behaviour depends on unrelated state.

**Suggested fix:** distinguish "no previous tree" from "previous tree had no
expanded branches" (e.g. pass `null` vs an empty set).

**Test status:** `data-members.spec.ts` "reassigning data … keeps the
expansion" is `test.fail`.

## 18. Every config update re-inserts `data` — `search-text` is wiped immediately

**Where:** `src/web-component.ts` `update()` (~384-396) sends the FULL config
(incl. `data`) on every batch; `tree-engine.ts` `updateProps()` applies
`searchText` (~3348 → `tree.filterNodes`) and later, because `updates.data`
is always present, `this.data = updates.data` (~3575) → `_onDataChanged()`
(~3648) → `insertArray()`, which rebuilds the tree and drops the filter.

**Symptom:** `el.setAttribute('search-text', 'sushi')` / `el.searchText = …`
on a built tree never filters (`filterNodes()` called directly works). Side
effects of the same root cause: ANY attribute change (e.g.
`selected-node-class`) re-inserts and re-indexes the whole data set (cost
grows with the tree), resets progressive rendering, and re-seeds expansion
(see #17).

**Suggested fix:** in `updateProps`, skip the re-insert when
`updates.data === this._data` (identity), and apply `searchText` after any
re-insert (or re-apply the active filter after `insertArray`).

**Test status:** two `test.fail` in `search-config.spec.ts`.

## 19. `renderLoadingCallback` is never called

**Where:** declared in `web-component.ts` (~231), mapped in `treeview.ts`
(~719) and typed in `renderer/types.ts` (~43), but `dom-renderer.ts` never
reads it: the loading overlay is always the built-in
`<div class="wtv__loading-spinner">` (~146-150, toggled at ~865).

**Symptom:** `is-loading="true"` + `renderLoadingCallback` → only the default
spinner; the callback never runs.

**Suggested fix:** in `mount()` / `updateConfig()`, if the callback is set,
clear `loadingEl` and call it (like header/footer).

**Test status:** `render-callbacks.spec.ts` "renderLoadingCallback renders the
loading content" is `test.fail`.

## 20. `renderEmptyZoneCallback` assigned after the first render is ignored

**Where:** `dom-renderer.ts` `_renderEmpty()` (~1015-1040): the
`.wtv__empty-zone` is built (and the callback consulted) only when no zone
exists yet; afterwards the existing zone is reused. `updateConfig()` doesn't
reset it.

**Symptom:** markup `<web-treeview show-drop-placeholder-when-empty>` + the
callback assigned from a module script (the normal pattern — the element
upgrades and renders first) → the zone keeps the default "Drop here" content.
(`renderEmptyStateCallback` doesn't have this problem: it is re-run on every
empty render.)

**Suggested fix:** drop the cached zone when `renderEmptyZoneCallback` changes
(or re-run the callback on every empty render, like the empty state).

**Test status:** `render-callbacks.spec.ts` "renderEmptyZoneCallback (assigned
after markup upgrade) fills the zone" is `test.fail`.

## 21. `nodeOutputTransformationCallback` is not applied on copy-drop

**Where:** `src/controller/tree-engine.ts` — the output transform runs only in
`_collectClipboardEntry()` (~2841, clipboard copy/cut). The copy-drop branches
of `_handleDrop()` (~4320 same-tree, ~4341 cross-tree) call `duplicateNodes()`
with only the INPUT transform (or `_defaultCopyTransform`).

**Symptom:** the input doc says "OUTPUT (egress) transform — clean/redact
`ctx.data` as a node leaves the source (copy/cut/copy-drop)", but a Ctrl-drop
copy (same tree or A → B) lands the unredacted data.

**Suggested fix:** in both copy-drop branches, run the SOURCE tree's output
transform over each manifest node before the input transform (phase
`'output'`, `target` = the drop ref), as the clipboard path does.

**Test status:** two `test.fail` in `drag-cross-tree.spec.ts`.

## 22. Desktop drops on a refusing node: no `node-drop-reject`, tree drop zone bypassed

**Where:** `src/renderer/dom-renderer.ts` `_onBodyDrop` (~576-586) routes a
node drop to the engine's public `drop()` (`tree-engine.ts` ~2986), which
silently skips a node with `isDropAllowed=false`. The reject feedback
(`_indicateDropDenied` → `onNodeDropDenied` → `node-drop-reject`, 🚫 flash)
and the `enable-tree-drop-zone` rerouting live in `_onNodeDropInternal`
(~4465-4495), which the DOM renderer never calls. (A real browser also needs
`dragover` to be accepted on the refusing row for `drop` to fire at all.)

**Symptom:** a real (Playwright) drag onto "NoDrop" does nothing visible:
no `node-drop-reject`, no 🚫; with `enable-tree-drop-zone` the drop is not
routed to the tree (no `node-drop` with `target=null`). The touch path
(long-press a locked node → `node-drag-reject`) works.

**Suggested fix:** have the renderer use the same gate as
`_onNodeDropInternal` (or make `drop()` call `_indicateDropDenied` /
`handleTreeZoneDrop`), and accept `dragover` on refusing rows when a tree drop
zone or reject feedback is wanted.

**Test status:** two `test.fail` in `drag-visuals.spec.ts`.

## 23. `tooltipDelay = { show, hide }` is rejected by the input converter

**Where:** `src/web-component.ts` ~140 — `tooltipDelay` uses `toInt()`, but
its documented type is `number | { show?: number; hide?: number }` ("the JS
property also accepts { show, hide }").

**Symptom:** `el.tooltipDelay = { show: 0, hide: 800 }` →
`[BlissElement] <web-treeview> rejected invalid value for property
"tooltipDelay"` and the default `{ show: 400, hide: 100 }` stays.

**Suggested fix:** a `toCustom` converter accepting an int (attribute: both)
or a `{ show?, hide? }` object (property), validated in one place.

**Test status:** `tooltip.spec.ts` "tooltipDelay = { show, hide }" is
`test.fail`.

## 24. Not silent by default: INIT debug on + raw `console.log` in drag paths

**Where:**
- `src/logger.ts` ~79-81: `logging.disableLogging()` then
  `initLogger.setLevel('debug')` — INIT logs at debug by default ("historically"),
  and the core logger persists that level to `localStorage`
  (`km-log:TREEVIEW:INIT`), so it sticks even after a later default change.
- Raw `console.log` calls bypassing `/logging`: `renderer/dom-renderer.ts`
  ~458, 506, 511, 521, 593, 1005 (`[DomRenderer] _onBodyDragOver/…/renderEmpty`)
  and `controller/tree-engine.ts` ~4930, 4942, 4973, 4990 (`[Controller]
  handleTree*Drag*`), plus `[wtv:cfg]` ones gated by `globalThis.__WTV_DEBUG`.

**Symptom:** a plain page logs `[TREEVIEW:INIT] build engine …`,
`TreeEngine created …`, and every drag spams `[DomRenderer] …` /
`[Controller] …` lines to the console.

**Suggested fix:** leave INIT silent like the other categories (enable via
`window.components['web-treeview'].logging`), and route the drag diagnostics
through `dragLogger.debug` (or delete them).

**Test status:** `logging.spec.ts` "silent by default" is `test.fail`.

## 25. Double-click tracker ignores Ctrl/Shift-clicks and checkbox clicks in between

**Where:** `src/controller/tree-engine.ts` `detectDoubleClick()` (~4137) — only
plain clicks update `_lastClickPath` / `_lastClickTime`.

**Symptom:** plain-click A1, Ctrl+click B, click A2's checkbox, then plain-click
A1 again — all within 400 ms — reads as a double-click on A1: `node-double-click`
fires, `node-click` / `selection-change` do not. Found while writing the D1
lifecycle tests (fast Playwright clicks); unlikely by hand but possible.

**Suggested fix:** reset the tracker on any intervening click on another node
(modifier click or checkbox toggle).

**Test status:** none (the lifecycle test clicks a different row to stay clear).

## 26. Cross-tree `dragged` refs resolve the source paths in the TARGET tree

**Where:** `src/controller/tree-engine.ts` `_draggedRefs()` (~1117-1120) —
the cross-tree branch maps the published source paths through
`this.nodeRef(p)`, which looks the path up in THIS (the target) tree.

**Symptom:** drag tree A's `1` + `2` onto tree B: `node-drop` on B has
`dragged[0].node` = B's own node `1` (B-Folder) and `dragged[1].node` = null
(B has no `2`). The paths are right; the nodes are wrong (or null where the
doc comment promises null for every cross-tree ref). `source` is correct.

**Repro:** `drag-cross-tree.html?multi`, select A-1, Ctrl A, Ctrl B in tree A,
drag A onto B-Folder → `window.lastDrop.dragged` = `['B-Folder', undefined]`.

**Suggested fix:** resolve cross-tree refs against the SOURCE tree
(`getClipboardTree(sourceTreeId)` / the registry) or return path-only refs
(`node: null`) as documented — never look them up in the target tree.

**Test status:** `drag-cross-tree.spec.ts` "the cross-tree dragged refs carry
the SOURCE nodes" is `test.fail`.
