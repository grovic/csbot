// TTL cache for API responses. The desktop host persists it to a file; tests use memory.

export interface CacheStore {
  get(key: string): { value: unknown; expires: number } | undefined;
  set(key: string, entry: { value: unknown; expires: number }): void;
}

export class MemoryStore implements CacheStore {
  readonly map = new Map<string, { value: unknown; expires: number }>();
  get(key: string) { return this.map.get(key); }
  set(key: string, e: { value: unknown; expires: number }) { this.map.set(key, e); }
}

export const TTL = {
  player: 6 * 3600_000,
  stats: 6 * 3600_000,
  history: 3600_000,
  /** An ongoing match changes (veto, results); a finished one doesn't. */
  matchLive: 20_000,
  matchDone: 7 * 24 * 3600_000,
  steam: 24 * 3600_000,
} as const;

export async function cached<T>(store: CacheStore | undefined, key: string, ttl: number, fn: () => Promise<T>, now = Date.now): Promise<T> {
  const hit = store?.get(key);
  if (hit && hit.expires > now()) return hit.value as T;
  const value = await fn();
  store?.set(key, { value, expires: now() + ttl });
  return value;
}
