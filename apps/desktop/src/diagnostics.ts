// Real-match measurements (M9). Only in measurement runs (the playtest shortcut starts csbot with
// --metrics): one NDJSON line per event, next to the per-second process metrics. tools/real-match turns
// both into the V1 numbers (memory and CPU while a match is on, how fast calls reach every screen,
// room reconnects). Nothing here leaves the PC.

import fs from 'node:fs';
import path from 'node:path';
import { CALL_KEY, callKey, type CoachView, type LiveSnapshot, type RoomTrace, type ScoutView } from '@csbot/protocol';

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const DEVICES = new Set(['host', 'desktop', 'web']);

/** A trace from the renderer, rebuilt from known fields only (or undefined). */
export function parseTrace(raw: unknown): RoomTrace | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || !ID.test(o.id) || typeof o.name !== 'string' || typeof o.device !== 'string' || !DEVICES.has(o.device)) return undefined;
  const base = { id: o.id, name: o.name.slice(0, 32), device: o.device as RoomTrace['device'] };
  if (o.ev === 'shown') return typeof o.key === 'string' && CALL_KEY.test(o.key) ? { ev: 'shown', ...base, key: o.key } : undefined;
  if (o.ev === 'online' || o.ev === 'offline') return { ev: o.ev, ...base };
  return undefined;
}

export class MatchLog {
  readonly file: string;
  private readonly now: () => number;
  private phase?: string;
  private call?: string;
  private coachSeen = new Set<string>();
  private recent?: string;

  constructor(file: string, now: () => number = Date.now) {
    this.file = file;
    this.now = now;
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  }

  /** The events file that goes with a metrics file: `<session>.events.ndjson`. */
  static fileFor(metricsFile: string): string {
    return metricsFile.replace(/(\.ndjson)?$/, '.events.ndjson');
  }

  note(ev: Record<string, unknown>): void {
    try { fs.appendFileSync(this.file, JSON.stringify({ t: this.now(), ...ev }) + '\n'); } catch { /* measurement only */ }
  }

  /** Every host snapshot: phase changes (round end is when "over" starts) and each new call on this PC. */
  snapshot(s: LiveSnapshot): void {
    const m = s.match;
    if (m) {
      const p = `${m.round}:${m.clock.phase}`;
      if (p !== this.phase) { this.phase = p; this.note({ ev: 'phase', round: m.round, phase: m.clock.phase, map: m.map, ...(m.mode ? { mode: m.mode } : {}) }); }
    }
    const key = callKey(s.call);
    if (key && key !== this.call) { this.call = key; this.note({ ev: 'call', key, head: s.call!.head }); }
  }

  /** New entries of the coach's call log: Claude's own time per call. */
  coach(v: CoachView): void {
    for (const c of [...v.calls].reverse()) {
      if (this.coachSeen.has(c.id)) continue;
      this.coachSeen.add(c.id);
      this.note({ ev: 'coach', trigger: c.trigger, round: c.round, status: c.status, ...(c.ms !== undefined ? { ms: c.ms } : {}), ...(c.model ? { model: c.model } : {}), ...(c.costUsd !== undefined ? { costUsd: c.costUsd } : {}) });
    }
  }

  /** The host's recent FACEIT matches as the API lists them (does a match show up while it's played?). */
  scout(v: ScoutView): void {
    const list = (v.recent ?? []).map(r => `${r.id}:${r.status}`).join(',');
    if (list === this.recent) return;
    this.recent = list;
    this.note({ ev: 'faceitRecent', matches: (v.recent ?? []).map(r => ({ id: r.id, status: r.status, live: r.live })) });
  }

  trace(e: RoomTrace): void { this.note({ ...e }); }

  /** Keep a pasted text next to the run (`<session>.<what>-<n>.txt`), e.g. a Premier status. */
  keep(what: string, text: string): void {
    const base = this.file.replace(/\.events\.ndjson$/, '');
    let n = 1;
    while (fs.existsSync(`${base}.${what}-${n}.txt`)) n++;
    try { fs.writeFileSync(`${base}.${what}-${n}.txt`, text.slice(0, 50_000)); } catch { /* measurement only */ }
    this.note({ ev: 'kept', what, n });
  }
}
