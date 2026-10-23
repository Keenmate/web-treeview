/**
 * Typed event emitter for TreeEngine notifications.
 * Lightweight (~50 lines), no dependencies.
 */

type Listener<T> = (data: T) => void;

export class EventEmitter<TEvents extends Record<string, any>> {
  private _listeners = new Map<keyof TEvents, Set<Listener<any>>>();

  /**
   * Subscribe to an event. Returns an unsubscribe function.
   */
  on<K extends keyof TEvents>(event: K, listener: Listener<TEvents[K]>): () => void {
    let set = this._listeners.get(event);
    if (!set) {
      set = new Set();
      this._listeners.set(event, set);
    }
    set.add(listener);
    return () => {
      set!.delete(listener);
      if (set!.size === 0) {
        this._listeners.delete(event);
      }
    };
  }

  /**
   * Emit an event to all registered listeners.
   */
  emit<K extends keyof TEvents>(event: K, data: TEvents[K]): void {
    const set = this._listeners.get(event);
    if (!set) return;
    for (const listener of set) {
      listener(data);
    }
  }

  /**
   * Remove all listeners for all events.
   */
  offAll(): void {
    this._listeners.clear();
  }
}
