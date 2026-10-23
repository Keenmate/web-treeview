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
classes. Same shape as the date-range-picker namespace-split documented
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

## C-TC-15 — FOUC prevention via `data-ready` attribute

Instead of the canonical `<tag>:not(:defined)` rule in `base.css`, the
component uses a `data-ready` attribute set in the Element constructor's
`requestAnimationFrame` callback (`src/web-component.ts:205-207`) and
hidden via `:host(:not([data-ready])) { visibility: hidden }`
(`src/css/base.css`). Functionally equivalent to the
`:not(:defined)` pattern but works with shadow-DOM inline-style
injection (which the component does in the constructor — `base.css`
can't reach the light DOM tag selector from inside the shadow root).
PASS with note.

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

