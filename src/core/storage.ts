/**
 * Safe key/value persistence. `localStorage` can throw (private mode, quota, disabled cookies)
 * or be missing entirely (tests, workers); every access is guarded and falls back to memory.
 */
export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): boolean;
  remove(key: string): void;
}

export class MemoryStore implements KeyValueStore {
  private map = new Map<string, string>();
  get(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  set(key: string, value: string): boolean {
    this.map.set(key, value);
    return true;
  }
  remove(key: string): void {
    this.map.delete(key);
  }
}

export class LocalStore implements KeyValueStore {
  private fallback = new MemoryStore();
  private get ls(): Storage | null {
    try {
      return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch {
      return null;
    }
  }
  get(key: string): string | null {
    try {
      return this.ls?.getItem(key) ?? this.fallback.get(key);
    } catch {
      return this.fallback.get(key);
    }
  }
  set(key: string, value: string): boolean {
    try {
      if (this.ls) {
        this.ls.setItem(key, value);
        return true;
      }
    } catch {
      /* quota exceeded / disabled — keep the data in memory for this session */
    }
    this.fallback.set(key, value);
    return false;
  }
  remove(key: string): void {
    try {
      this.ls?.removeItem(key);
    } catch {}
    this.fallback.remove(key);
  }
}
