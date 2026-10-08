/**
 * Minimal typed event emitter.
 *
 * `Events` maps an event name to its listener signature, e.g.
 * `{ sfx: (name: string, pitch?: number) => void }`. Emitting passes arguments positionally
 * (no payload object allocated per emit), which matters for high-frequency events like `sfx`.
 */
type Listener = (...args: any[]) => void;
export type EventMap = { [K: string]: Listener };

export class Emitter<E extends EventMap> {
  private listeners: { [K in keyof E]?: E[K][] } = {};

  on<K extends keyof E>(type: K, fn: E[K]): () => void {
    (this.listeners[type] ??= []).push(fn);
    return () => this.off(type, fn);
  }

  off<K extends keyof E>(type: K, fn: E[K]): void {
    const list = this.listeners[type];
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  emit<K extends keyof E>(type: K, ...args: Parameters<E[K]>): void {
    const list = this.listeners[type];
    if (!list) return;
    for (let i = 0; i < list.length; i++) list[i]!(...args);
  }

  clear(): void {
    this.listeners = {};
  }
}
