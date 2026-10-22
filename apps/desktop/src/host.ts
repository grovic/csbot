// The host pipeline: GSI HTTP endpoint → spectator guard → recorder → tracker → snapshots.
// Pure Node (no Electron import) so it runs in unit tests over real HTTP.

import fs from 'node:fs';
import path from 'node:path';
import { MatchTracker, PLAYBOOKS } from '@csbot/engine';
import { gsiConfig, spectatorGuard, toGameState, toLine, type GsiPayload, type Side } from '@csbot/gsi';
import { startGsiServer, type GsiServer } from '@csbot/gsi/server';
import type { CallView, ConnectionView, HostInfo, LiveSnapshot } from '@csbot/protocol';
import { cfgFilePath, cfgStatus, type Cs2Install } from './cs2.ts';

export interface HostOptions {
  userData: string;
  /** 0 = random free port. */
  port: number;
  token: string;
  version: string;
  playbookHandle?: string;
  source?: ConnectionView['source'];
  /** Stop recording past this size (default 200 MB). */
  maxRecordingBytes?: number;
  /** Minimum gap between payload-driven snapshots (default 100 ms, i.e. ≤ 10/s). */
  throttleMs?: number;
  /** Snapshot heartbeat so clocks and stale state move without payloads (default 1000 ms). */
  tickMs?: number;
  /** CS2 detection, injected so tests never look at the real install. */
  detectCs2?: () => Cs2Install | undefined;
  /** Disable the recorder (default on). */
  record?: boolean;
  /** The port settings asked for, when this session had to fall back to another one. */
  wantedPort?: number;
  /** Clock for snapshots and intel (tests move it forward). */
  now?: () => number;
}

export interface RuntimeInfo { gsiUrl: string; token: string; pid: number }

type Listener = (s: LiveSnapshot) => void;
type GsiListener = (p: GsiPayload) => void;

const pad = (n: number) => String(n).padStart(2, '0');
export function sessionFileName(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.ndjson`;
}

/** Our side from the payload itself: the player block is us when it isn't someone we're watching. */
function ownSide(p: GsiPayload): Side | undefined {
  const pl = p.player;
  if (!pl || !p.provider?.steamid || pl.steamid !== p.provider.steamid) return undefined;
  return pl.team === 'CT' || pl.team === 'T' ? pl.team : undefined;
}

/**
 * Put the coach's (Claude's) call on a snapshot. It only applies to the round and call kind it was
 * written for (pre-round from the previous round's end until a plant, post-plant after); otherwise the
 * engine call stays. Keeps the tracker's YOU line when it's the "you're dead" line, else uses our slot's job, and
 * moves the map's planned spots when Claude chose another playbook setup.
 */
export function withCoachCall(s: LiveSnapshot, coach: CallView | undefined, ourSlot?: string): LiveSnapshot {
  const engine = s.call;
  if (!coach || !engine || !s.match || coach.round !== engine.round || coach.kind !== engine.kind) return s;
  const dead = engine.you?.startsWith("You're dead") ? engine.you : undefined;
  const you = dead ?? (ourSlot ? coach.jobs[ourSlot] : undefined);
  const { you: _y, ...rest } = coach;
  const out: LiveSnapshot = { ...s, call: { ...rest, ...(you ? { you } : {}) } };
  if (coach.setup && coach.setup !== engine.setup) {
    const setup = PLAYBOOKS[s.match.map]?.setups.find(x => x.id === coach.setup);
    if (setup) out.setupSpots = setup.spots.map(sp => ({ player: sp.player, at: [sp.at[0], sp.at[1]] as const, label: sp.label }));
  }
  return out;
}

export class Host {
  readonly recordingsDir: string;
  private readonly o: HostOptions;
  private tracker: MatchTracker;
  private server?: GsiServer;
  private listeners = new Set<Listener>();
  private gsiListeners = new Set<GsiListener>();
  private last?: LiveSnapshot;
  private lastEmit = 0;
  private trailing?: NodeJS.Timeout;
  private tick?: NodeJS.Timeout;
  private side?: Side;
  private recFile?: string;
  private recStream?: fs.WriteStream;
  private recBytes = 0;
  private recStopped = false;
  private cs2?: Cs2Install | null;
  private rejected = { token: 0, json: 0, size: 0 };
  private coachCall?: CallView;
  /** The tracker's own call in the last snapshot (before a coach call replaced it). */
  private lastEngineCall?: CallView;

  constructor(o: HostOptions) {
    this.o = o;
    this.recordingsDir = path.join(o.userData, 'recordings');
    this.tracker = new MatchTracker({ source: o.source ?? 'game', ...(o.playbookHandle ? { playbookHandle: o.playbookHandle } : {}) });
  }

  get gsiUrl(): string {
    if (!this.server) throw new Error('host not started');
    return `http://127.0.0.1:${this.server.port}`;
  }

  private now(): number { return this.o.now ? this.o.now() : Date.now(); }

  get rejectedCounts() { return { ...this.rejected }; }
  get recordingFile(): string | undefined { return this.recFile; }

  async start(): Promise<void> {
    this.server = await startGsiServer({
      port: this.o.port,
      token: this.o.token,
      onPayload: (p, at) => this.ingest(p, at),
      onRejected: r => { this.rejected[r]++; },
    });
    const runtime: RuntimeInfo = { gsiUrl: this.gsiUrl, token: this.o.token, pid: process.pid };
    fs.mkdirSync(this.o.userData, { recursive: true });
    fs.writeFileSync(path.join(this.o.userData, 'runtime.json'), JSON.stringify(runtime, null, 2) + '\n');
    this.tick = setInterval(() => this.emit(), this.o.tickMs ?? 1000);
    this.tick.unref?.();
    this.emit();
  }

  async stop(): Promise<void> {
    if (this.tick) clearInterval(this.tick);
    if (this.trailing) clearTimeout(this.trailing);
    this.tick = this.trailing = undefined;
    await this.server?.close();
    this.server = undefined;
    await new Promise<void>(r => (this.recStream ? this.recStream.end(r) : r()));
    this.recStream = undefined;
    try { fs.rmSync(path.join(this.o.userData, 'runtime.json'), { force: true }); } catch { /* best effort */ }
  }

  onSnapshot(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  /**
   * Every payload after the spectator guard, token redacted: the same object the recorder writes.
   * A desktop app that joined someone else's room forwards these to that room's host.
   */
  onGsi(cb: GsiListener): () => void {
    this.gsiListeners.add(cb);
    return () => { this.gsiListeners.delete(cb); };
  }

  latest(): LiveSnapshot {
    return this.last ?? this.emit();
  }

  /** Build and broadcast a snapshot now. */
  emit(): LiveSnapshot {
    if (this.trailing) { clearTimeout(this.trailing); this.trailing = undefined; }
    const raw = this.tracker.snapshot(this.now());
    this.lastEngineCall = raw.call;
    const s = withCoachCall(raw, this.coachCall, this.o.playbookHandle);
    this.last = s;
    this.lastEmit = Date.now();
    for (const l of this.listeners) {
      try { l(s); } catch { /* a bad listener must not break the pipeline */ }
    }
    return s;
  }

  /** The engine's call in the latest snapshot, whatever the coach put on screen instead. */
  engineCall(): CallView | undefined { return this.lastEngineCall; }

  /**
   * Intel from this PC (map click, hotkey) or from a room member: `count` enemies in `zone`
   * (0 = clear). Moves the forecast and, when the read changes, the call. Emits right away.
   */
  addIntel(zone: string, count: number, by: string): { ok: boolean; error?: string } {
    const r = this.tracker.addIntel({ zone, count, by, at: this.now() });
    if (r.ok) this.emit();
    return r;
  }

  /** The team plan changed (already applied to the engine): redo the freeze-time call and show it now. */
  replan(): void {
    this.tracker.replan();
    this.emit();
  }

  /** The live coach's call (undefined = engine calls only). Shown right away. */
  setCoachCall(call: CallView | undefined): void {
    this.coachCall = call;
    this.emit();
  }

  /** The cfg text CS2 needs to reach this host. */
  cfgText(): string {
    return gsiConfig({ uri: this.gsiUrl, token: this.o.token });
  }

  info(): HostInfo {
    if (this.cs2 === undefined) this.cs2 = this.o.detectCs2?.() ?? null;
    const actual = this.server?.port;
    return {
      version: this.o.version,
      gsiUrl: this.server ? this.gsiUrl : '',
      cfgStatus: this.server ? cfgStatus(this.cs2?.cfgDir, this.cfgText()) : 'missing',
      ...(this.cs2 ? { cs2Path: this.cs2.cs2Path, cfgPath: cfgFilePath(this.cs2.cfgDir) } : {}),
      ...(this.o.wantedPort !== undefined && actual !== undefined && this.o.wantedPort !== actual ? { portFallback: { wanted: this.o.wantedPort, actual } } : {}),
      recordingsDir: this.recordingsDir,
    };
  }

  /** Forget the cached CS2 detection (after an install, or when the user retries). */
  redetectCs2(): Cs2Install | undefined {
    this.cs2 = undefined;
    this.info();
    return this.cs2 ?? undefined;
  }

  private ingest(raw: GsiPayload, at: number): void {
    this.side = ownSide(raw) ?? this.side;
    const { payload, dropped } = spectatorGuard(raw, { ourSide: this.side });
    if (dropped.length) this.tracker.noteGuardDrops(dropped.length);
    const redacted: GsiPayload = payload.auth ? { ...payload, auth: { token: 'redacted' } } : payload;
    this.record(redacted, at);
    for (const l of this.gsiListeners) {
      try { l(redacted); } catch { /* a bad listener must not break the pipeline */ }
    }
    this.tracker.ingest(toGameState(payload, at));
    const wait = (this.o.throttleMs ?? 100) - (Date.now() - this.lastEmit);
    if (wait <= 0) this.emit();
    else if (!this.trailing) this.trailing = setTimeout(() => this.emit(), wait);
  }

  private record(p: GsiPayload, at: number): void {
    if (this.o.record === false || this.recStopped) return;
    const line = toLine(p, at);
    const bytes = Buffer.byteLength(line);
    const max = this.o.maxRecordingBytes ?? 200 * 1024 * 1024;
    if (this.recBytes + bytes > max) { this.recStopped = true; return; }
    if (!this.recStream) {
      fs.mkdirSync(this.recordingsDir, { recursive: true });
      this.recFile = path.join(this.recordingsDir, sessionFileName());
      this.recStream = fs.createWriteStream(this.recFile, { flags: 'a' });
      this.recStream.on('error', () => { this.recStopped = true; });
    }
    this.recBytes += bytes;
    this.recStream.write(line);
  }
}
