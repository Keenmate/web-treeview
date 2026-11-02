/**
 * Page-wide "a tree node is being dragged over the page" tracker — the source of
 * the `armed` state (`highlight-on-page-drag`) on `<web-treeview>`. Mirrors
 * web-dropzone's page-file-drag tracker (same shape, same names), but counts
 * treeview node drags (`application/svelte-treeview`) instead of files.
 *
 * ONE shared listener set for every instance on the page: the first subscriber
 * adds the window listeners, the last unsubscribe removes them.
 *
 * Start: the first node-drag `dragenter` (or `dragover`) anywhere on the page.
 * End, whichever comes first:
 *  - `drop` anywhere (also outside every tree);
 *  - the drag leaves the window — an enter/leave depth counter, because every
 *    element crossed fires its own enter/leave pair;
 *  - `dragend` / Escape;
 *  - the `dragover` heartbeat stops for {@link HEARTBEAT_TIMEOUT_MS} (a live
 *    native drag pulses `dragover` continuously).
 *
 * The listeners sit on `window` in the capture phase, so a drop target that calls
 * `stopPropagation()` can't hide the `drop` / `dragover` from the tracker.
 */

/** The dataTransfer type every treeview node drag carries. */
const NODE_DRAG_TYPE = 'application/svelte-treeview';

/** Called with `true` when a node drag starts over the page, `false` when it ends. */
export type PageNodeDragListener = (isNodeDragActive: boolean) => void;

/** Silence after which a drag without `dragover` pulses counts as ended. */
const HEARTBEAT_TIMEOUT_MS = 350;
const HEARTBEAT_CHECK_MS = 150;

const listeners = new Set<PageNodeDragListener>();
let isActive = false;
let depth = 0;
let lastPulseAt = 0;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

const CAPTURE: AddEventListenerOptions = { capture: true };

function carriesNode(e: DragEvent): boolean {
  const types = e.dataTransfer?.types;
  if (!types) return false;
  // DOMStringList (older engines) has `contains`, arrays have `includes`.
  return Array.prototype.includes.call(types, NODE_DRAG_TYPE);
}

function setActive(next: boolean): void {
  if (isActive === next) return;
  isActive = next;
  if (next) {
    lastPulseAt = performance.now();
    heartbeatTimer = setInterval(() => {
      if (performance.now() - lastPulseAt > HEARTBEAT_TIMEOUT_MS) end();
    }, HEARTBEAT_CHECK_MS);
  } else {
    depth = 0;
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }
  for (const listener of [...listeners]) listener(next);
}

function end(): void {
  setActive(false);
}

function onDragEnter(e: DragEvent): void {
  if (!carriesNode(e)) return;
  depth++;
  setActive(true);
}

function onDragOver(e: DragEvent): void {
  if (!carriesNode(e)) return;
  lastPulseAt = performance.now();
  // A drag that started before the first subscriber (or whose enter was missed)
  // still arms on its next pulse.
  if (!isActive) {
    depth = Math.max(depth, 1);
    setActive(true);
  }
}

function onDragLeave(e: DragEvent): void {
  if (!isActive || !carriesNode(e)) return;
  depth = Math.max(0, depth - 1);
  if (depth === 0) end();
}

function onKeyDown(e: KeyboardEvent): void {
  if (isActive && e.key === 'Escape') end();
}

function addListeners(): void {
  window.addEventListener('dragenter', onDragEnter, CAPTURE);
  window.addEventListener('dragover', onDragOver, CAPTURE);
  window.addEventListener('dragleave', onDragLeave, CAPTURE);
  window.addEventListener('drop', end, CAPTURE);
  window.addEventListener('dragend', end, CAPTURE);
  window.addEventListener('keydown', onKeyDown, CAPTURE);
}

function removeListeners(): void {
  window.removeEventListener('dragenter', onDragEnter, CAPTURE);
  window.removeEventListener('dragover', onDragOver, CAPTURE);
  window.removeEventListener('dragleave', onDragLeave, CAPTURE);
  window.removeEventListener('drop', end, CAPTURE);
  window.removeEventListener('dragend', end, CAPTURE);
  window.removeEventListener('keydown', onKeyDown, CAPTURE);
}

/**
 * Subscribe to page-wide node drags. The listener is NOT called with the current
 * state on subscribe — read {@link isPageNodeDragActive} for that.
 * Returns the unsubscribe function (idempotent).
 */
export function subscribePageNodeDrag(listener: PageNodeDragListener): () => void {
  if (typeof window === 'undefined') return () => { /* SSR: nothing to track */ };
  if (listeners.size === 0) addListeners();
  listeners.add(listener);
  return () => {
    if (!listeners.delete(listener)) return;
    if (listeners.size === 0) {
      removeListeners();
      setActive(false);
    }
  };
}

/** True while a node drag is in progress over the page (only tracked while someone is subscribed). */
export function isPageNodeDragActive(): boolean {
  return isActive;
}

/** The host attribute / custom state that marks an armed drop target. */
export const ARMED_STATE = 'armed';

/**
 * Expose the armed state on a host the way core exposes `ready`: the `armed`
 * attribute (the portable CSS hook, `:host([armed])`) plus `:state(armed)` when
 * the engine has CustomStateSet.
 */
export function applyArmedState(host: HTMLElement, internals: ElementInternals | null | undefined, isArmed: boolean): void {
  host.toggleAttribute(ARMED_STATE, isArmed);
  try {
    if (isArmed) internals?.states?.add(ARMED_STATE);
    else internals?.states?.delete(ARMED_STATE);
  } catch {
    // CustomStateSet unavailable, or an engine that only accepts `--dashed`
    // idents — the attribute is the hook then.
  }
}
