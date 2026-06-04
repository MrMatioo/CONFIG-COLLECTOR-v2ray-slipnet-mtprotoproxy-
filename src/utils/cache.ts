interface CacheEntry<T> {
  data: T;
  lastUpdated: number;
}

class Cache<T> {
  private store: Map<string, CacheEntry<T>> = new Map();
  private ttl: number;

  constructor(ttlSeconds: number = 3600) {
    this.ttl = ttlSeconds * 1000;
  }

  set(key: string, data: T): void {
    this.store.set(key, { data, lastUpdated: Date.now() });
  }

  get(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() - entry.lastUpdated > this.ttl) {
      this.store.delete(key);
      return null;
    }
    return entry.data;
  }

  clear(): void {
    this.store.clear();
  }
}

export const configCache = new Cache<string>(3600);
export const proxyCache = new Cache<string>(3600);
