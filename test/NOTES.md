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
`selectionMode !== 'multi'`; don't move focus, or emit `focus-change` if it does.

## 4. (TV-4) PageUp / PageDown / Shift-extend keyboard selection unimplemented

**Where:** `src/renderer/dom-renderer.ts` keyboard handler (~374-422).

**Symptom:** feature gap vs the Svelte build — PageUp/PageDown don't move
focus, Shift+Arrow/Home/End/PageUp/PageDown don't extend the selection.

**Test status:** the 10 `keyboard-nav.spec.ts` placeholders stay `test.skip`.
**Needs the user's go-ahead** (feature work, own WP) before implementing.

## 5. (TV-5) Multi-drag top-level absorption doesn't move

**Where:** multi-drag in `src/controller/tree-engine.ts` (drop of a selected set
where one selected node is a descendant of another selected node).

**Symptom:** dragging a selection that contains an ancestor and one of its
descendants does nothing — the descendant should ride along inside its
ancestor and the ancestor should move.

**Test status:** `drag-drop.spec.ts` "top-level absorption" stays `test.skip`
until fixed.
