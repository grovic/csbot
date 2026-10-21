// File-backed cache for FACEIT/Steam responses (userData/cache/scout.json). Saves API calls across
// launches: player stats stay valid for hours. Debounced writes, expired entries dropped, size capped.

import fs from 'node:fs';
import path from 'node:path';
import type { CacheStore } from '@csbot/scout';

type Entry = { value: unknown; expires: number };

export interface FileStoreOptions {
  /** Default 5 MB. */
  maxBytes?: number;
  /** Default 1 s. */
  debounceMs?: number;
  now?: () => number;
}

export class FileStore implements CacheStore {
  private readonly file: string;
  private readonly o: Required<FileStoreOptions>;
  private map = new Map<string, Entry>();
  private timer?: NodeJS.Timeout;

  constructor(file: string, o: FileStoreOptions = {}) {
    this.file = file;
    this.o = { maxBytes: 5 * 1024 * 1024, debounceMs: 1000, now: Date.now, ...o };
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { entries?: Record<string, Entry> };
      const now = this.o.now();
      for (const [k, e] of Object.entries(raw.entries ?? {})) if (e && typeof e.expires === 'number' && e.expires > now) this.map.set(k, e);
    } catch { /* first run or a corrupt file: start empty */ }
  }

  get(key: string): Entry | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.expires <= this.o.now()) { this.map.delete(key); return undefined; }
    return e;
  }

  set(key: string, e: Entry): void {
    this.map.set(key, e);
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = undefined; this.flush(); }, this.o.debounceMs);
    this.timer.unref?.();
  }

  /** Write now: drop expired entries, then the soonest-expiring ones until under the size cap. */
  flush(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    const now = this.o.now();
    for (const [k, e] of this.map) if (e.expires <= now) this.map.delete(k);
    let text = this.serialize();
    if (Buffer.byteLength(text) > this.o.maxBytes) {
      const byExpiry = [...this.map.entries()].sort((a, b) => a[1].expires - b[1].expires);
      while (byExpiry.length && Buffer.byteLength(text) > this.o.maxBytes) {
        // Drop in chunks so huge caches don't re-serialize once per entry.
        for (const [k] of byExpiry.splice(0, Math.max(1, Math.ceil(byExpiry.length / 10)))) this.map.delete(k);
        text = this.serialize();
      }
    }
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, text);
      fs.renameSync(tmp, this.file);
    } catch { /* a cache that can't be written is only slower */ }
  }

  get size(): number { return this.map.size; }

  private serialize(): string {
    return JSON.stringify({ v: 1, entries: Object.fromEntries(this.map) });
  }
}
