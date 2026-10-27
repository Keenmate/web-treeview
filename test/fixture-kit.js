// Tiny shared helpers for the e2e fixture pages (not a test of anything).
//
//   import { setupTree, logTo, logEvents, fmtPaths } from './fixture-kit.js';
//
// Every page keeps its own data + config inline so it stays readable on its own;
// this only removes the repeated member wiring and the event-log plumbing.

/** Numeric-aware path order ("1.10" after "1.9"), deterministic across pages. */
export const byPath = (a, b) => String(a.path).localeCompare(String(b.path), undefined, { numeric: true });

/**
 * Wire the usual members (id / path / name), a path-order sort, extra props,
 * then `data`. Everything lands in one coalesced core batch.
 */
export function setupTree(tree, data, extra = {}) {
    tree.idMember = 'id';
    tree.pathMember = 'path';
    tree.displayValueMember = 'name';
    tree.sortCallback = ({ nodes }) => [...nodes].sort(byPath);
    Object.assign(tree, extra);
    tree.data = data;
    return tree;
}

/** Sorted, comma-joined paths from a Set / array of paths or nodes. */
export function fmtPaths(paths) {
    return [...(paths ?? [])]
        .map((p) => (typeof p === 'string' ? p : p?.path))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .join(',');
}

/** Append `line` to `<pre data-testid="{testId}">`. */
export function logTo(testId, line) {
    const pre = document.querySelector(`[data-testid="${testId}"]`);
    pre.textContent += line + '\n';
}

/** Default one-line summary of a treeview event detail. */
export function fmtDetail(type, d) {
    if (!d) return '';
    switch (type) {
        case 'selection-change':
        case 'checked-change':
            return fmtPaths(d.paths);
        case 'focus-change':
            return d.focusedNode?.path ?? '';
        case 'node-copy':
        case 'node-cut':
        case 'node-delete':
            return fmtPaths(d.paths);
        case 'node-paste':
            return `success=${d.success} count=${d.count}`;
        case 'node-drop':
            return `${d.operation} ${(d.dragged ?? []).map((n) => n.path ?? n).join('+') || d.source?.path} ${d.position} ${d.target?.path ?? 'null'}`;
        case 'node-click':
        case 'node-double-click':
            return d.node?.path ?? d.path ?? '';
        case 'tree-change':
            return '';
        default:
            return d.node?.path ?? d.path ?? '';
    }
}

/** Log every listed event type as `type:summary` into the page's log. */
export function logEvents(tree, testId, types, fmt = fmtDetail) {
    for (const type of types) {
        tree.addEventListener(type, (e) => logTo(testId, `${type}:${fmt(type, e.detail)}`));
    }
}
