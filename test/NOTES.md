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

## 4. (TV-4) PageUp / PageDown / Shift-extend keyboard selection unimplemented

**Where:** `src/renderer/dom-renderer.ts` keyboard handler (~374-422).

**Symptom:** feature gap vs the Svelte build — PageUp/PageDown don't move
focus, Shift+Arrow/Home/End/PageUp/PageDown don't extend the selection.

**Test status:** the 10 `keyboard-nav.spec.ts` placeholders stay `test.skip`.
**Needs the user's go-ahead** (feature work, own WP) before implementing.

## 5. ~~(TV-5) Multi-drag top-level absorption doesn't move~~ — not reproducible

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
(and warn on duplicate ids in `insertArray`).

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

## 15. A DOM move rebuilds the tree — expansion, selection, checks, focus lost

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

**Test status:** two `test.fail` in `lifecycle.spec.ts`.
