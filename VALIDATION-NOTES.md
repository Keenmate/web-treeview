# Validation notes — accepted deviations

This file records deviations from the BlissFramework component guidelines
that the team has accepted as the correct outcome for this component.
Each entry explains *why the deviation is correct here*; future
`/validate-web-component` runs read this file and downgrade matching
flags from ❌ Fail to ⚠️ Exception (or ✅ Pass), removing them from
the punch-list.

Deferrals ("we'll fix this later") are **not** valid entries — they get
re-promoted to Fails on every run by design. Only architectural
decisions belong here.

## C-CST-4 / C-CST-10 — Namespace-style Logic class split

The component's Logic class is organized across folder-scoped subsystems
(`src/controller/`, `src/renderer/`, `src/ltree/`) rather than a flat
`src/<feature>.ts`. The `EventEmitter` (`src/controller/event-emitter.ts`)
is a Side-layer base class consumed by `TreeEngine`, not a Service.
The `flex` / `indexer` / `ltree-node` files inside `src/ltree/` are pure
data-structure helpers composed by `ltree.ts`, not independent Service
classes; `interaction.ts` → `clipboard.ts` is a type-only import of the
clipboard's public result types. Same shape as the date-range-picker namespace-split documented
in the validator spec. PASS with note; the C-CST-4 auto-script's
import-pair regex flags these as service-to-service but they're
single-Logic-class subsystem internals.

## C-CSS-1 — Lean strategy (D-CSS-1 = B)

The component uses the lean CSS strategy: only the four files actually
needed (`variables.css`, `base.css`, `tree.css`, `dark-mode.css`)
rather than the canonical eight-file set. The component has no Tier-2
surfaces (no controls, no floating, no animations, no cross-feature
state modifiers worth their own file). PASS with note; the C-CSS-1
auto-script expects the canonical set.

## C-TC-15 — FOUC prevention via the core `ready` attribute

Instead of the canonical `<tag>:not(:defined)` rule in `base.css`, the
component hides the host until core `BlissElement` marks the first build
live — the `ready` host attribute (also `:state(ready)` + the `ready`
event, SPEC §6.3) — via `:host(:not([ready])) { visibility: hidden }`
(`src/css/base.css`). Functionally equivalent to the `:not(:defined)`
pattern but works with shadow-DOM style injection (`base.css` can't
reach the light DOM tag selector from inside the shadow root), and it
also covers a `defer`-held element. PASS with note.

## C-NC-6 — D-NC-7 = C (member-only data extractors)

The component ships six `*Member` fields without a paired
`get<Name>Callback`: `idMember`, `pathMember`, `parentPathMember`,
`levelMember`, `hasChildrenMember`, `orderMember`. They are
structural / auto-derived fields (path-based tree identity) — no
consumer would want a per-node computed override for "what is this
node's id". `iconMember` / `iconColorMember` are paired with the
canonical `getIconCallback` / `getIconColorCallback`. The selectable
/ draggable / collapsible / drop-allowed extractors all follow the
canonical `is<Name>Member` + `getIs<Name>Callback` pair. PASS with
note; D-NC-7 = C member-only is documented for the structural fields.

## C-NC-3 — `SelectionModifiers.ctrl` / `.shift` (modifier-key snapshot)

`SelectionModifiers { ctrl, shift }` is not configuration: it is the
modifier-key state of one pointer gesture, handed from the renderer to the
engine (`_nodeClickedCallback(node, modifiers)`), mirroring the DOM's own
`ctrlKey` / `shiftKey`. An `is*` prefix would read as a setting. PASS with note.

## C-NC-8 / C-CSS-7 — `.wtv-loader` is core's class

The default loader is drawn by core `renderLoader` (SPEC §12.14) as
`<span class="<prefix>-loader">` — the same contract every Keenmate
component styles (`--<prefix>-loader-*` → `--base-loader-*`). The class name
is core's, not the component's; renaming it here would leave the default
loader unstyled. Raised in the rulebook (core-generated class). PASS with note.

## Responsive overlay — not applicable (D-RO-1 = B)

The tree is inline and opens no overlay panel of its own; the context menu
is core's `/menu`, which owns its own phone presentation. The suite's gate
agrees (SKIP, no floating-panel signals) since the rulebook stopped counting
`position: fixed` bubbles and `::after` glyphs as panels (2026-11-04), so
`kmwc.rulebook.skippedChecks` is no longer needed.
