// In-browser demo: a fictional synthetic match replayed through the real engine on a virtual clock.
// Same code path as the host (toGameState → MatchTracker → snapshot), so the demo shows real behavior.

import { GEOS, MatchTracker } from '@csbot/engine';
import { FULL_MATCH, syntheticMatch, toGameState, type RecordedPayload } from '@csbot/gsi';
import type { LiveSnapshot } from '@csbot/protocol';
import { composeSquad, type CheckIn, type SlotInfo } from '@csbot/room';
import { demoRoom } from './demoRoom.ts';
import type { SnapshotSource } from './source.ts';

/**
 * The demo room's squad: the fictional teammates check in on their spots a few seconds into each live
 * round, and the viewer (rdx, slot a) checks in with the map buttons.
 */
function withSquad(s: LiveSnapshot, mine: Map<string, CheckIn>, liveAt: number | undefined): LiveSnapshot {
  const room = demoRoom(s.match?.map);
  const bySlot = new Map<string, SlotInfo>(room.members.filter(m => m.slot).map(m => [m.slot!, { name: m.name }]));
  const phase = s.match?.clock.phase;
  if ((phase === 'live' || phase === 'bomb') && liveAt !== undefined && s.at - liveAt > 4000) {
    for (const slot of ['short', 'rotator']) { const i = bySlot.get(slot); if (i) i.checkIn = { state: 'spot', at: liveAt + 4000 }; }
  }
  for (const [slot, c] of mine) { const i = bySlot.get(slot); if (i) i.checkIn = c; }
  const squad = composeSquad(s, bySlot);
  return squad ? { ...s, squad } : s;
}

export interface DemoOptions {
  /** Virtual seconds per real second. */
  speed?: number;
  /** Fast-forward to this payload index (or a named state, see findDemoIndex) before starting. */
  at?: number | string;
  /** Stay frozen after the fast-forward (deterministic screenshots). */
  pause?: boolean;
  /** Play the demo on this map (any map csbot has), Mirage by default. */
  map?: string;
}

export function demoRecording(map = 'de_mirage'): RecordedPayload[] {
  return syntheticMatch({ rounds: FULL_MATCH, lean: true, map });
}

/**
 * Named demo moments, e.g. "freeze-2", "live-2", "bomb-3", "over-3", "freeze-14", "gameover".
 * An optional "+N" picks the Nth payload inside that phase ("freeze-2+3").
 */
export function findDemoIndex(rec: readonly RecordedPayload[], spec: string): number {
  if (/^\d+$/.test(spec)) return Math.min(rec.length - 1, Number(spec));
  const m = /^(freeze|live|bomb|over|gameover)(?:-(\d+))?(?:\+(\d+))?$/.exec(spec);
  if (!m) return 0;
  const [, kind, round, offset] = m;
  const wantRound = round ? Number(round) : undefined;
  const hits: number[] = [];
  rec.forEach(({ p }, i) => {
    const r = (p.map?.round ?? 0) + 1;
    const phase = p.round?.phase;
    const ok =
      kind === 'gameover' ? p.map?.phase === 'gameover'
      : kind === 'freeze' ? phase === 'freezetime'
      : kind === 'live' ? phase === 'live' && p.round?.bomb !== 'planted'
      : kind === 'bomb' ? phase === 'live' && p.round?.bomb === 'planted'
      : phase === 'over' && p.map?.phase !== 'gameover';
    if (ok && (wantRound === undefined || r === wantRound)) hits.push(i);
  });
  if (!hits.length) return 0;
  return hits[Math.min(hits.length - 1, Number(offset ?? 0))]!;
}

export function readDemoOptions(search: string): DemoOptions {
  const q = new URLSearchParams(search);
  const speed = Number(q.get('speed'));
  const at = q.get('at');
  return {
    speed: Number.isFinite(speed) && speed > 0 ? speed : 1,
    at: at === null ? undefined : /^\d+$/.test(at) ? Number(at) : at,
    pause: q.get('pause') === '1',
    ...(q.get('map') && GEOS[q.get('map')!] ? { map: q.get('map')! } : {}),
  };
}

export function demoSource(opts: DemoOptions = {}): SnapshotSource {
  const rec = demoRecording(opts.map);
  const speed = opts.speed ?? 1;
  const first = rec[0]!.t, end = rec[rec.length - 1]!.t + 6000;
  let tracker = new MatchTracker({ source: 'demo', playbookHandle: 'a' });
  let next = 0;
  let virtualNow = first;
  let paused = !!opts.pause;
  const subs = new Set<(s: LiveSnapshot) => void>();
  let last: LiveSnapshot | undefined;

  const feedUntil = (now: number) => {
    while (next < rec.length && rec[next]!.t <= now) {
      const r = rec[next++]!;
      tracker.ingest(toGameState(r.p, r.t));
    }
  };
  // The viewer's own check-ins this round, and when the round went live (for the teammates' check-ins).
  const mine = new Map<string, CheckIn>();
  let squadRound = 0, liveAt: number | undefined;
  const snap = () => {
    const s = tracker.snapshot(virtualNow);
    const round = s.match?.round ?? 0;
    if (round !== squadRound) { squadRound = round; mine.clear(); liveAt = undefined; }
    if ((s.match?.clock.phase === 'live' || s.match?.clock.phase === 'bomb') && liveAt === undefined) liveAt = s.match.clock.phase === 'live' ? virtualNow - ((s.forecast?.liveT ?? 0) * 1000) : virtualNow;
    return withSquad(s, mine, liveAt);
  };
  const emit = () => {
    last = snap();
    for (const cb of subs) cb(last);
  };

  if (opts.at !== undefined) {
    const idx = typeof opts.at === 'number' ? Math.min(rec.length - 1, opts.at) : findDemoIndex(rec, opts.at);
    virtualNow = rec[idx]!.t;
    feedUntil(virtualNow);
  } else {
    feedUntil(virtualNow);
  }

  let timer: ReturnType<typeof setInterval> | undefined;
  let realLast = Date.now();
  const tick = () => {
    const realNow = Date.now();
    const dt = realNow - realLast;
    realLast = realNow;
    if (paused) return;
    virtualNow += dt * speed;
    if (virtualNow > end) {
      // Loop: a fresh tracker, like a new match.
      tracker = new MatchTracker({ source: 'demo', playbookHandle: 'a' });
      next = 0;
      virtualNow = first;
    }
    feedUntil(virtualNow);
    emit();
  };

  return {
    kind: 'demo',
    rate: () => (paused ? 0 : speed),
    checkIn(slot, state, site) {
      const phase = last?.match?.clock.phase;
      if (phase !== 'freezetime' && phase !== 'live' && phase !== 'bomb') return { ok: false, error: 'Check-ins are for the round in progress.' };
      mine.set(slot, { state, ...(site ? { site } : {}), at: virtualNow });
      emit();
      return { ok: true };
    },
    addIntel(zone, count, by) {
      // At the demo's own clock, so it lands in the round being shown (paused or not).
      const r = tracker.addIntel({ zone, count, by, at: virtualNow });
      if (r.ok) emit();
      return r;
    },
    subscribe(cb) {
      subs.add(cb);
      if (!last) last = snap();
      cb(last);
      if (!timer) { realLast = Date.now(); timer = setInterval(tick, 250); }
      return () => {
        subs.delete(cb);
        if (!subs.size && timer) { clearInterval(timer); timer = undefined; }
      };
    },
  };
}
