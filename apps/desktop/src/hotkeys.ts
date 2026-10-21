// Numpad intel hotkeys (M4a): log what you see without leaving the game. Off by default, because a
// global hotkey takes the key away from every other app, CS2 included (some players bind the numpad).
// Fair play: csbot only listens for these keys; it never sends input to the game.
//
// Per map: three entry zones. Num7/8/9 = enemies seen there (press n times within 1.5 s = n enemies),
// Num1/2/3 = the same zones clear. Pure logic with an injectable shortcut API: tests never register
// real global hotkeys.

import { GEOS } from '@csbot/engine';
import type { HostInfo } from '@csbot/protocol';

export interface ShortcutApi {
  register(accelerator: string, cb: () => void): boolean;
  unregister(accelerator: string): void;
}

export interface HotkeyDef {
  /** Electron accelerator, e.g. "num7". */
  accelerator: string;
  /** What the user reads, e.g. "Num7". */
  key: string;
  zone: string;
  kind: 'sighting' | 'clear';
}

/** Entry zones per map, A approach / mid / B approach, in Num7/8/9 (sighting) and Num1/2/3 (clear) order. */
export const HOTKEY_ZONES: Readonly<Record<string, readonly [string, string, string]>> = {
  de_ancient: ['mainhall', 'middle', 'tsidelower'],
  de_anubis: ['tsideupper', 'middle', 'outsidelong'],
  de_cache: ['amain', 'mid', 'bmain'],
  de_dust2: ['longdoors', 'topofmid', 'uppertunnel'],
  de_inferno: ['apartments', 'middle', 'banana'],
  de_mirage: ['aramp', 'topmid', 'bapps'],
  de_nuke: ['lobby', 'outside', 'ramp'],
};

export function hotkeysFor(map: string | undefined): HotkeyDef[] {
  const zones = map ? HOTKEY_ZONES[map] : undefined;
  if (!zones) return [];
  return [
    ...zones.map((zone, i) => ({ accelerator: `num${7 + i}`, key: `Num${7 + i}`, zone, kind: 'sighting' as const })),
    ...zones.map((zone, i) => ({ accelerator: `num${1 + i}`, key: `Num${1 + i}`, zone, kind: 'clear' as const })),
  ];
}

const zoneName = (map: string | undefined, zone: string) => (map ? GEOS[map]?.zones.find(z => z.id === zone)?.name : undefined) || zone;

export interface TimerApi {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}
const realTimers: TimerApi = { set: (fn, ms) => setTimeout(fn, ms), clear: h => clearTimeout(h as NodeJS.Timeout) };

/**
 * Turns key presses into intel. A sighting key counts presses (max 5) and logs once after
 * `windowMs` of quiet; a clear key logs the zone clear right away (and drops a pending count there).
 */
export class IntelAggregator {
  private pending = new Map<string, { count: number; timer: unknown }>();
  private readonly log: (zone: string, count: number) => void;
  private readonly windowMs: number;
  private readonly timers: TimerApi;

  constructor(log: (zone: string, count: number) => void, o: { windowMs?: number; timers?: TimerApi } = {}) {
    this.log = log;
    this.windowMs = o.windowMs ?? 1500;
    this.timers = o.timers ?? realTimers;
  }

  press(def: Pick<HotkeyDef, 'zone' | 'kind'>): void {
    const p = this.pending.get(def.zone);
    if (def.kind === 'clear') {
      if (p) { this.timers.clear(p.timer); this.pending.delete(def.zone); }
      this.log(def.zone, 0);
      return;
    }
    const count = Math.min(5, (p?.count ?? 0) + 1);
    if (p) this.timers.clear(p.timer);
    const timer = this.timers.set(() => { this.pending.delete(def.zone); this.log(def.zone, count); }, this.windowMs);
    this.pending.set(def.zone, { count, timer });
  }

  /** Log what's pending now (e.g. when the map changes). */
  flush(): void {
    for (const [zone, p] of this.pending) { this.timers.clear(p.timer); this.log(zone, p.count); }
    this.pending.clear();
  }

  cancel(): void {
    for (const p of this.pending.values()) this.timers.clear(p.timer);
    this.pending.clear();
  }
}

export class IntelHotkeys {
  private enabled = false;
  private map?: string;
  private registered: string[] = [];
  private failed: string[] = [];
  private readonly agg: IntelAggregator;
  private readonly shortcuts: ShortcutApi;

  constructor(o: { shortcuts: ShortcutApi; log: (zone: string, count: number) => void; windowMs?: number; timers?: TimerApi }) {
    this.shortcuts = o.shortcuts;
    this.agg = new IntelAggregator(o.log, { ...(o.windowMs !== undefined ? { windowMs: o.windowMs } : {}), ...(o.timers ? { timers: o.timers } : {}) });
  }

  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    this.sync();
  }

  /** The current map (from the host's snapshots). Re-registers when it changes. */
  setMap(map: string | undefined): void {
    if (map === this.map) return;
    this.map = map;
    if (this.enabled) this.sync();
  }

  /** Unregister everything (quit). */
  dispose(): void {
    this.enabled = false;
    this.sync();
  }

  status(): NonNullable<HostInfo['intelHotkeys']> {
    const defs = hotkeysFor(this.map);
    const error = this.map === undefined
      ? undefined
      : !defs.length
        ? 'No map model for this map yet.'
        : this.failed.length
          ? `${this.failed.join(', ')} ${this.failed.length > 1 ? 'are' : 'is'} taken by another app.`
          : undefined;
    // Keys for the current map (none before the first match, or on a map without a model).
    return {
      enabled: this.enabled,
      keys: defs.map(d => ({ key: d.key, zone: d.zone, zoneName: zoneName(this.map, d.zone), kind: d.kind })),
      ...(error ? { error } : {}),
    };
  }

  private sync(): void {
    for (const acc of this.registered) { try { this.shortcuts.unregister(acc); } catch { /* already gone */ } }
    this.registered = [];
    this.failed = [];
    this.agg.cancel();
    if (!this.enabled) return;
    for (const def of hotkeysFor(this.map)) {
      let ok = false;
      try { ok = this.shortcuts.register(def.accelerator, () => this.agg.press(def)); } catch { ok = false; }
      if (ok) this.registered.push(def.accelerator);
      else this.failed.push(def.key);
    }
  }
}

/** A stand-in for Electron's globalShortcut that only records (tests, hidden runs). */
export function fakeShortcuts(): ShortcutApi & { registered: Map<string, () => void> } {
  const registered = new Map<string, () => void>();
  return {
    registered,
    register: (acc, cb) => { registered.set(acc, cb); return true; },
    unregister: acc => { registered.delete(acc); },
  };
}
