// Pure part of the 2D replay: turns demoparser2's events and sampled player rows into a DemoReplay.
// The rounds are parseDemo's (segmentRounds: same numbers, warmup and backup restores handled the same
// way). Each round is sampled REPLAY_HZ times a second from the freeze end until a few seconds after the
// round end, so only those ticks are asked of parseTicks.

import type { DemoReplay, ReplayRound, Side } from '@csbot/protocol';
import {
  byTick, EVENT_NAMES, num, playerKey, roundPlant, segmentRounds, sideOf, siteResolver, TICK_RATE,
  type RawEvent, type RawTickRow, type RoundWindow,
} from './build.ts';

/** Samples per second. */
export const REPLAY_HZ = 4;
/** Ticks between two samples (64 ticks/s ÷ 4 Hz = 16). */
export const REPLAY_STEP = TICK_RATE / REPLAY_HZ;
/** Sampling goes on this long after round_end (the next round starts 7 s after it). */
export const REPLAY_TAIL_SECONDS = 3;
/** A round's replay never covers more than this (a mid-round pause would otherwise run on). */
export const REPLAY_MAX_SECONDS = 175;
/**
 * How long a smoke lasts when the demo has no smokegrenade_expired for it. CS2's own detonate → expired
 * is 22.06 s for every smoke in the test demo (a smoke without one was still up at the round reset).
 */
export const SMOKE_SECONDS = 22;
/** How long a molotov or incendiary burns when the demo has no inferno_expire for it. */
export const INFERNO_SECONDS = 7;

export type NadeKind = ReplayRound['nades'][number]['kind'];

/** The event each grenade goes off with. Molotovs and incendiaries both start an inferno. */
export const NADE_EVENTS: Readonly<Record<string, NadeKind>> = {
  smokegrenade_detonate: 'smoke',
  inferno_startburn: 'molotov',
  flashbang_detonate: 'flash',
  hegrenade_detonate: 'he',
  decoy_started: 'decoy',
};
/** Grenades whose effect lasts: the event that ends it (same entityid) and the duration when it is missing. */
export const NADE_ENDS: Readonly<Partial<Record<NadeKind, { event: string; seconds: number }>>> = {
  smoke: { event: 'smokegrenade_expired', seconds: SMOKE_SECONDS },
  molotov: { event: 'inferno_expire', seconds: INFERNO_SECONDS },
};

const NADE_END_EVENTS: readonly string[] = Object.values(NADE_ENDS).map(e => e!.event);
/** Events parseReplay asks demoparser2 for: parseDemo's (rounds, plants, deaths) plus the grenades. */
export const REPLAY_EVENT_NAMES: readonly string[] = [...EVENT_NAMES, ...Object.keys(NADE_EVENTS), ...NADE_END_EVENTS];
/** Player props read at every sampled tick. */
export const REPLAY_TICK_PROPS = ['X', 'Y', 'Z', 'health', 'is_alive', 'team_num'] as const;

export function nadeKind(eventName: unknown): NadeKind | undefined {
  return typeof eventName === 'string' ? NADE_EVENTS[eventName] : undefined;
}

/** Rounded to an integer (never -0, so JSON and equality stay clean). */
const int = (v: number) => Math.round(v) || 0;
const r2 = (v: number) => Math.round(v * 100) / 100;

// ---------------------------------------------------------------- ticks

/** The ticks a round's replay covers: `frames` samples REPLAY_STEP apart, the first at `zero`. */
export interface ReplaySpan {
  /** The freeze end (the round start when the round ended during the freeze time); t = 0. */
  zero: number;
  frames: number;
  /** The last sampled tick. */
  lastTick: number;
}

/** From the freeze end until the round end + REPLAY_TAIL_SECONDS, before the next round, at most REPLAY_MAX_SECONDS. */
export function replaySpan(w: RoundWindow): ReplaySpan {
  const zero = w.liveTick ?? w.startTick;
  const until = Math.min(w.endTick + REPLAY_TAIL_SECONDS * TICK_RATE, w.nextTick - 1, zero + REPLAY_MAX_SECONDS * TICK_RATE);
  const frames = Math.max(0, Math.floor((until - zero) / REPLAY_STEP)) + 1;
  return { zero, frames, lastTick: zero + (frames - 1) * REPLAY_STEP };
}

export function frameTicks(span: ReplaySpan): number[] {
  return Array.from({ length: span.frames }, (_, i) => span.zero + i * REPLAY_STEP);
}

/** Every round's sampled ticks, sorted: what parseReplay passes to parseTicks. */
export function replayTicks(rounds: readonly RoundWindow[]): number[] {
  const ticks = new Set<number>();
  for (const r of rounds) for (const t of frameTicks(replaySpan(r))) ticks.add(t);
  return [...ticks].sort((a, b) => a - b);
}

// ---------------------------------------------------------------- players and frames

/** Rows by tick, then by player key. */
export type TickIndex = ReadonlyMap<number, ReadonlyMap<string, RawTickRow>>;

export function indexRows(rows: readonly RawTickRow[]): TickIndex {
  const out = new Map<number, Map<string, RawTickRow>>();
  for (const row of rows) {
    const key = playerKey(row.steamid, row.name);
    if (!key) continue;
    let at = out.get(row.tick);
    if (!at) out.set(row.tick, (at = new Map()));
    at.set(key, row);
  }
  return out;
}

/**
 * Who played the round: everyone on T or CT with a position at one of its ticks (GOTV, spectators and
 * players who already left have neither). Side and name from their first such row. T first, then by key
 * (parseDemo's order).
 */
export function roundPlayers(index: TickIndex, ticks: readonly number[]): ReplayRound['players'] {
  const seen = new Map<string, { name: string; side: Side }>();
  for (const tick of ticks) {
    for (const [key, row] of index.get(tick) ?? []) {
      if (seen.has(key)) continue;
      const side = sideOf(row.team_num);
      if (!side || num(row.X) === undefined || num(row.Y) === undefined || num(row.Z) === undefined) continue;
      seen.set(key, { name: typeof row.name === 'string' && row.name ? row.name : key, side });
    }
  }
  return [...seen]
    .map(([steamid, p]) => ({ steamid, name: p.name, side: p.side }))
    .sort((a, b) => (a.side === b.side ? a.steamid.localeCompare(b.steamid) : a.side === 'T' ? -1 : 1));
}

type Sample = [x: number, y: number, z: number, hp: number];

/** One player's [x, y, z, hp] from a row; what the row lacks comes from the previous sample. */
function sampleOf(row: RawTickRow, prev: Sample | undefined): Sample | undefined {
  const x = num(row.X), y = num(row.Y), z = num(row.Z);
  const pos = x !== undefined && y !== undefined && z !== undefined ? [int(x), int(y), int(z)] as const : prev;
  if (!pos) return undefined;
  const health = num(row.health);
  const hp = row.is_alive === false ? 0 : health !== undefined ? Math.max(0, int(health)) : (prev?.[3] ?? 0);
  return [pos[0], pos[1], pos[2], hp];
}

/**
 * One flat [x0, y0, z0, hp0, x1, …] per tick, players in `keys` order. A tick without a row for a player
 * repeats their previous sample; before their first row, their first sample is used. A dead player's
 * pawn stays where they died, with hp 0.
 */
export function packFrames(index: TickIndex, keys: readonly string[], ticks: readonly number[]): number[][] {
  const frames = ticks.map(() => new Array<number>(keys.length * 4).fill(0));
  const put = (i: number, j: number, s: Sample) => { frames[i]!.splice(j * 4, 4, ...s); };
  for (let j = 0; j < keys.length; j++) {
    let last: Sample | undefined;
    let firstAt = -1;
    for (let i = 0; i < ticks.length; i++) {
      const row = index.get(ticks[i]!)?.get(keys[j]!);
      if (row) last = sampleOf(row, last);
      if (!last) continue;
      if (firstAt < 0) firstAt = i;
      put(i, j, last);
    }
    for (let i = 0; i < firstAt; i++) put(i, j, frames[firstAt]!.slice(j * 4, j * 4 + 4) as Sample);
  }
  return frames;
}

// ---------------------------------------------------------------- timeline

/**
 * The grenades that went off in [zero, lastTick], in order. Smokes and infernos last until the first end
 * event of the same entity before `resetTick` (the next round, which removes them), or a default.
 */
export function roundNades(events: readonly RawEvent[], span: ReplaySpan, resetTick: number): ReplayRound['nades'] {
  const out: ReplayRound['nades'] = [];
  for (const e of events) {
    const kind = nadeKind(e.event_name);
    if (!kind || e.tick < span.zero || e.tick > span.lastTick || e.is_warmup_period === true) continue;
    const x = num(e.x), y = num(e.y), z = num(e.z);
    if (x === undefined || y === undefined || z === undefined) continue;
    const nade: ReplayRound['nades'][number] = { t: r2((e.tick - span.zero) / TICK_RATE), kind, x: int(x), y: int(y), z: int(z) };
    const ends = NADE_ENDS[kind];
    if (ends) {
      const id = num(e.entityid);
      let endTick: number | undefined;
      if (id !== undefined) {
        for (const f of events) {
          if (f.event_name === ends.event && num(f.entityid) === id && f.tick >= e.tick && f.tick <= resetTick && (endTick === undefined || f.tick < endTick)) endTick = f.tick;
        }
      }
      nade.duration = endTick !== undefined ? r2((endTick - e.tick) / TICK_RATE) : ends.seconds;
    }
    out.push(nade);
  }
  return out.sort((a, b) => a.t - b.t);
}

// ---------------------------------------------------------------- replay

export interface ReplayInput {
  map: string;
  events: readonly RawEvent[];
  /** parseTicks rows (REPLAY_TICK_PROPS) covering replayTicks(rounds). */
  rows: readonly RawTickRow[];
  /** segmentRounds(events), when already computed. */
  rounds?: readonly RoundWindow[];
}

export function buildReplay(input: ReplayInput): DemoReplay {
  const windows = input.rounds ?? segmentRounds(input.events);
  const events = [...input.events].sort(byTick);
  const plants = events.filter(e => e.event_name === 'bomb_planted');
  const siteOf = siteResolver(plants);
  const deaths = events.filter(e => e.event_name === 'player_death' && e.is_warmup_period !== true);
  const nadeEvents = events.filter(e => nadeKind(e.event_name) || NADE_END_EVENTS.includes(e.event_name));
  const index = indexRows(input.rows);

  const rounds = windows.map((w): ReplayRound => {
    const span = replaySpan(w);
    const ticks = frameTicks(span);
    const players = roundPlayers(index, ticks);
    const at = (tick: number) => r2(Math.max(0, (tick - span.zero) / TICK_RATE));

    // Deaths as parseDemo counts them for the round (from its start), as far as the replay goes.
    const kills: ReplayRound['kills'] = [];
    for (const e of deaths) {
      if (e.tick < w.startTick || e.tick > span.lastTick) continue;
      const victim = playerKey(e.user_steamid, e.user_name);
      if (!victim) continue;
      const killer = playerKey(e.attacker_steamid, e.attacker_name);
      const weapon = typeof e.weapon === 'string' && e.weapon ? e.weapon : undefined;
      kills.push({ t: at(e.tick), victim, ...(killer && killer !== victim ? { killer } : {}), ...(weapon ? { weapon } : {}) });
    }

    const round: ReplayRound = {
      round: w.round, hz: REPLAY_HZ, duration: (span.frames - 1) / REPLAY_HZ, players,
      frames: packFrames(index, players.map(p => p.steamid), ticks),
      nades: roundNades(nadeEvents, span, w.nextTick),
      kills,
    };

    const plant = roundPlant(plants, w);
    const x = num(plant?.user_X), y = num(plant?.user_Y), z = num(plant?.user_Z);
    if (plant && plant.tick <= span.lastTick && x !== undefined && y !== undefined && z !== undefined) {
      const site = siteOf(plant);
      round.plant = { t: at(plant.tick), ...(site ? { site } : {}), x: int(x), y: int(y), z: int(z) };
    }
    return round;
  });

  return { map: input.map, rounds };
}
