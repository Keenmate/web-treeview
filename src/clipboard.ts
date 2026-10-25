/**
 * Tree clipboard — module-level singleton for cross-tree copy/cut/paste.
 * Ported to full parity with @keenmate/svelte-treeview rc13.
 */

import type { LTreeNode } from './ltree/ltree-node';

export interface ClipboardEntry<T> {
  sourceTreeId: string;
  sourcePath: string;
  data: T; // structuredClone of node.data
  descendants: Array<{
    relativePath: string; // path relative to source (e.g. "1.2" under "1" → ".2")
    data: T;
  }>;
}

export type ClipboardOperation = 'copy' | 'cut';

export interface TreeClipboard<T> {
  operation: ClipboardOperation;
  entries: ClipboardEntry<T>[];
  /** The tree the entries came from — used to reach back on a cross-tree cut. */
  sourceTreeId: string;
}

export interface PasteResult<T> {
  success: boolean;
  count: number;
  /** Entries skipped by the per-node transform (returned null) or the self-paste guard. */
  skipped: number;
  error?: string;
  /** Included when shouldAutoHandlePaste=false — clipboard data for the consumer to handle. */
  entries?: ClipboardEntry<T>[];
  operation?: ClipboardOperation;
  targetPath?: string;
  position?: 'child' | 'before' | 'after';
}

// ── Module singleton ────────────────────────────────────────────────────
// Shared across all TreeEngine instances on the page.

let _clipboard: TreeClipboard<any> | null = null;

export function setClipboard<T>(clip: TreeClipboard<T>): void {
  _clipboard = clip;
}

export function getClipboard<T>(): TreeClipboard<T> | null {
  return _clipboard as TreeClipboard<T> | null;
}

export function clearClipboard(): void {
  _clipboard = null;
}

export function hasClipboard(): boolean {
  return _clipboard !== null && _clipboard.entries.length > 0;
}

export function getClipboardOperation(): ClipboardOperation | null {
  return _clipboard?.operation ?? null;
}

// ─── Cross-tree controller registry ───────────────────────────────────────
// Minimal registry so a paste can reach back to the SOURCE tree it came from
// (identified by clipboard.sourceTreeId) — needed to remove the originals on a
// cross-tree CUT (a same-tree cut removes them directly). Kept to a tiny surface
// (just removeNode) to avoid a circular type dependency on TreeEngine.
export interface ClipboardSourceTree {
  removeNode(path: string, includeDescendants?: boolean): unknown;
  /** The source tree's live Ltree — read by a cross-tree AUTO-copy so the library
   *  can duplicate the source's live nodes into the target. Typed loosely to avoid
   *  a circular dependency on the ltree types. */
  tree?: unknown;
  /** Resolve one of the source tree's paths to its NodeRef (path / node / parent /
   *  siblings) — used to build a cross-tree drop's `dragged` refs from the SOURCE
   *  tree. Typed loosely (see `tree`). */
  nodeRef?(path: string): unknown;
}

const _trees = new Map<string, ClipboardSourceTree>();

export function registerClipboardTree(id: string, tree: ClipboardSourceTree): void {
  if (id) _trees.set(id, tree);
}

export function unregisterClipboardTree(id: string, tree: ClipboardSourceTree): void {
  if (_trees.get(id) === tree) _trees.delete(id);
}

export function getClipboardTree(id: string): ClipboardSourceTree | undefined {
  return _trees.get(id);
}

// ─── Cross-tree drag set ──────────────────────────────────────────────────
// The top-level dragged paths, published by the SOURCE tree on drag start so a
// CROSS-TREE drop/dragover can expose the full multi-drag set via ctx.dragged.
// The target controller only receives ONE reconstituted node (from dataTransfer)
// and can't see the source's selected set, so it reads the set from here. Same-
// tree drops don't need this — they compute the set from their own live selection.
// `paths` = the top-level dragged set (for ctx.dragged). `manifest` = the COMPLETE
// placement set (every descendant, or a curated beforeDragStart override with
// holes) used by a cross-tree AUTO-copy. (svelte-treeview rc13)
let _dragSet: { sourceTreeId: string; paths: string[]; manifest: string[] } | null = null;

export function setDragSet(sourceTreeId: string, paths: string[], manifest: string[] = paths): void {
  _dragSet = { sourceTreeId, paths, manifest };
}

export function getDragSet(): { sourceTreeId: string; paths: string[]; manifest: string[] } | null {
  return _dragSet;
}

export function clearDragSet(): void {
  _dragSet = null;
}

/**
 * Pick a name that doesn't collide with `taken`, appending a suffix until free.
 * Convenience for collision-aware paste naming inside a
 * pasteNodeTransformationCallback:
 *   `name: uniqueName(data.name, ctx.target.siblings.map(s => s.data?.name))`.
 * Because the transform reads the pristine clipboard snapshot every paste, `base`
 * is never pre-suffixed — no "Copy 1 Copy 1".
 *
 * @param base   The desired name.
 * @param taken  Names already in use (e.g. read off the destination's siblings).
 * @param suffix Formats the n-th alternative; defaults to `${base} Copy ${n}`.
 */
export function uniqueName(
  base: string,
  taken: Iterable<string>,
  suffix: (base: string, n: number) => string = (b, n) => `${b} Copy ${n}`
): string {
  const takenSet = taken instanceof Set ? (taken as Set<string>) : new Set(taken);
  if (!takenSet.has(base)) return base;
  let n = 1;
  while (takenSet.has(suffix(base, n))) n++;
  return suffix(base, n);
}
