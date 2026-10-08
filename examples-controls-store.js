// examples-controls-store.js
//
// Persist the control switches on a controls-driven example page to localStorage
// so the demo configuration survives a reload. Shared across example pages, like
// examples-copy-link.js / examples-chapter-nav.js.
//
// Usage — call ONCE, at the END of the page's own wiring (after the pickers have
// their options and the change-listeners are attached):
//
//     import { persistControls } from './examples-controls-store.js';
//     customElements.whenDefined('web-treeview').then(() => {
//         // ... configure trees, wire control listeners ...
//         persistControls('interaction');   // a stable per-page key
//     });
//
// It scans every <input>/<select> inside `.controls`, restores the saved values,
// then dispatches a `change` on each so the page's OWN listeners re-apply the
// configuration to the components — no page-specific persistence code needed.

const storeKey = (ns) => `web-treeview:examples:controls:${ns}`;

const keyFor = (el) =>
    el.type === 'checkbox' ? `chk:${el.id}`
    : el.type === 'radio' ? `radio:${el.name}`
    : `val:${el.id}`;

function readState(ns) {
    try {
        return JSON.parse(localStorage.getItem(storeKey(ns)) || '{}') || {};
    } catch {
        return {};
    }
}

function writeState(ns, controls) {
    const state = {};
    for (const el of controls) {
        if (el.type === 'radio') {
            if (el.checked) state[keyFor(el)] = el.value;
        } else if (el.type === 'checkbox') {
            state[keyFor(el)] = el.checked;
        } else {
            state[keyFor(el)] = el.value;
        }
    }
    try {
        localStorage.setItem(storeKey(ns), JSON.stringify(state));
    } catch {
        /* storage unavailable (private mode / quota) — degrade to no persistence */
    }
}

/**
 * Restore + persist all `.controls` inputs/selects under `root` for page `namespace`.
 * @param {string} namespace  stable per-page key (e.g. "interaction")
 * @param {ParentNode} [root]  defaults to document
 */
export function persistControls(namespace, root = document) {
    const controls = [...root.querySelectorAll('.controls input, .controls select')];
    if (controls.length === 0) return;

    // 1) Restore saved values onto the controls.
    const saved = readState(namespace);
    for (const el of controls) {
        const k = keyFor(el);
        if (!(k in saved)) continue;
        if (el.type === 'radio') el.checked = el.value === saved[k];
        else if (el.type === 'checkbox') el.checked = !!saved[k];
        else el.value = saved[k];
    }

    // 2) Re-apply to the components by firing the page's own change handlers.
    //    For radios only fire the checked one per group (an unchecked radio's
    //    handler is a no-op guarded by `if (e.target.checked)` anyway).
    const firedGroups = new Set();
    for (const el of controls) {
        if (el.type === 'radio') {
            if (!el.checked || firedGroups.has(el.name)) continue;
            firedGroups.add(el.name);
        }
        el.dispatchEvent(new Event('change', { bubbles: true }));
        // Value controls (select / color / range / number / text) are sometimes
        // wired on `input` rather than `change` — fire both so re-apply is reliable.
        if (el.type !== 'radio' && el.type !== 'checkbox') {
            el.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }

    // 3) Save on every subsequent change to a control (both events — `input`
    //    covers live range/color dragging, `change` covers checkboxes/radios/selects).
    const onMutate = (e) => {
        const t = e.target;
        if (t && t.closest && t.closest('.controls')) writeState(namespace, controls);
    };
    root.addEventListener('change', onMutate);
    root.addEventListener('input', onMutate);
}
