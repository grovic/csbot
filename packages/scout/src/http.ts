// Small fetch wrapper for the data APIs: timeout, one retry on 429/5xx, typed errors.
// Runs on the host only (Electron main), so API keys never reach a renderer or the room.

export type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean; status: number; headers: { get(name: string): string | null }; json(): Promise<unknown>; text(): Promise<string>;
}>;

export class ApiError extends Error {
  readonly status: number;
  readonly service: string;
  constructor(service: string, status: number, message: string) {
    super(message);
    this.service = service;
    this.status = status;
  }
  get kind(): 'auth' | 'not-found' | 'rate-limit' | 'server' | 'network' {
    if (this.status === 401 || this.status === 403) return 'auth';
    if (this.status === 404) return 'not-found';
    if (this.status === 429) return 'rate-limit';
    if (this.status === 0) return 'network';
    return 'server';
  }
}

export interface HttpOptions {
  service: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  headers?: Record<string, string>;
  /** Wait before the single retry (tests pass 0). */
  retryDelayMs?: number;
}

export async function getJson<T>(url: string, o: HttpOptions): Promise<T> {
  const f = o.fetch ?? (globalThis.fetch as unknown as FetchLike);
  let attempt = 0;
  for (;;) {
    attempt++;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), o.timeoutMs ?? 10_000);
    try {
      const res = await f(url, { headers: { accept: 'application/json', ...o.headers }, signal: ac.signal });
      if (res.ok) return (await res.json()) as T;
      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt === 1) {
        const ra = Number(res.headers.get('retry-after'));
        await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 5000) : (o.retryDelayMs ?? 800));
        continue;
      }
      throw new ApiError(o.service, res.status, `${o.service} ${res.status} for ${redact(url)}`);
    } catch (e) {
      if (e instanceof ApiError) throw e;
      if (attempt === 1) { await sleep(o.retryDelayMs ?? 800); continue; }
      throw new ApiError(o.service, 0, `${o.service} unreachable: ${(e as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
/** Never put keys in error messages (Steam passes its key in the query string). */
export const redact = (url: string) => url.replace(/([?&]key=)[^&]+/i, '$1•••');

/** Run tasks with at most `n` in flight. */
export async function pool<T, R>(items: readonly T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const worker = async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]!); } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}
