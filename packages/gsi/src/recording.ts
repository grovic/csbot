// Recordings are NDJSON: one {"t": epochMs, "p": payload} per line (the probe writes the same format).

import type { GsiPayload } from './types.ts';

export interface RecordedPayload { t: number; p: GsiPayload }

export function toLine(p: GsiPayload, t = Date.now()): string {
  return JSON.stringify({ t, p }) + '\n';
}

export function readRecording(text: string): RecordedPayload[] {
  const out: RecordedPayload[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as RecordedPayload;
      if (typeof r.t === 'number' && r.p && typeof r.p === 'object') out.push(r);
    } catch { /* skip a torn last line */ }
  }
  return out;
}

/** Replace Steam IDs and names so a real recording can become a committed fixture. */
export function anonymize(rec: RecordedPayload[], names: Record<string, string> = {}): RecordedPayload[] {
  const ids = new Map<string, string>();
  const id = (s?: string) => {
    if (!s) return s;
    // Non-numeric on purpose: can never collide with a real SteamID64.
    if (!ids.has(s)) ids.set(s, `anon-${ids.size + 1}`);
    return ids.get(s);
  };
  return rec.map(({ t, p }) => {
    const q: GsiPayload = JSON.parse(JSON.stringify(p));
    if (q.provider) q.provider.steamid = id(q.provider.steamid);
    if (q.player) { q.player.steamid = id(q.player.steamid); if (q.player.name) q.player.name = names[q.player.name] ?? `player${ids.size}`; }
    if (q.auth) q.auth.token = 'redacted';
    return { t, p: q };
  });
}
