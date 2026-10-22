// Pure part of the demo parser: turns demoparser2's events and tick rows into a DemoTruth.
// No file access here, so every rule can be unit-tested with small fictional inputs.

import type { DemoPlayer, DemoRound, DemoTruth, Side } from '@csbot/protocol';

/** CS2 servers and demos run at 64 ticks per second. */
export const TICK_RATE = 64;
/** Buying stays open this long after the freeze time ends (mp_buytime 20). */
export const BUY_SECONDS = 20;
/** Not every tick carries entity data (gaps at round changes), so each sample looks back this many ticks. */
export const SAMPLE_SPAN = 8;
/** Time between round_end and the next round (mp_round_restart_delay 7). Bounds the last round's deaths. */
export const POST_ROUND_SECONDS = 7;

/** One game event as demoparser2 returns it (only the fields read here are typed). */
export interface RawEvent { event_name: string; tick: number; [key: string]: unknown }

/** One player row from demoparser2's parseTicks. */
export interface RawTickRow { tick: number; steamid?: string | null; name?: string | null; [key: string]: unknown }

/** Where a round sits in the demo, in ticks. */
export interface RoundWindow {
  round: number;
  /** The round begins (freeze time starts). */
  startTick: number;
  /** Freeze time ends and the round goes live. Missing when the round ended first (a surrender vote). */
  liveTick?: number;
  /** Buy time is over (or the round ended before that): money and equipment are read here. */
  boughtTick: number;
  /** round_end. */
  endTick: number;
  /**
   * The next round begins; deaths up to here (after the round end too) belong to this round. For the last
   * round, the end plus the post-round delay: players leaving after the match "die" later than that.
   */
  nextTick: number;
  winner: Side;
  reason?: string;
}

/** Events parseDemo asks demoparser2 for. */
export const EVENT_NAMES = [
  'begin_new_match', 'round_start', 'round_freeze_end', 'buytime_ended', 'round_end', 'bomb_planted', 'player_death',
] as const;
/** Player props added to events (prefixed `user_` / `attacker_` in the output). */
export const EVENT_PLAYER_PROPS = ['X', 'Y', 'Z', 'team_num', 'last_place_name'] as const;
/** Game-rule props added to events. */
export const EVENT_OTHER_PROPS = ['is_warmup_period', 'total_rounds_played'] as const;
/** Player props read at each round's bought tick. */
export const TICK_PROPS = ['team_num', 'balance', 'start_balance', 'cash_spent_this_round', 'current_equip_value'] as const;

// ---------------------------------------------------------------- small mappings

export function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** team_num 2 = T, 3 = CT (also accepts the names some tools print). */
export function sideOf(v: unknown): Side | undefined {
  if (v === 2 || v === '2' || v === 'T' || v === 'TERRORIST') return 'T';
  if (v === 3 || v === '3' || v === 'CT') return 'CT';
  return undefined;
}

export function otherSide(s: Side): Side {
  return s === 'T' ? 'CT' : 'T';
}

/** A bombsite place name ("BombsiteA", "Bombsite B", "SiteA", "ASite") to its letter. */
export function placeToSite(place: unknown): 'A' | 'B' | undefined {
  if (typeof place !== 'string') return undefined;
  const p = place.toLowerCase().replace(/[^a-z]/g, '');
  const m = /^(?:bomb)?site([ab])$/.exec(p) ?? /^([ab])(?:bomb)?site$/.exec(p);
  return m ? (m[1]!.toUpperCase() as 'A' | 'B') : undefined;
}

// round_end `reason` codes (CS RoundEndReason, as sent in the event) and the names demoparser2 uses for them.
const REASON_CODES: Readonly<Record<number, string>> = {
  1: 'bomb', 7: 'defuse', 8: 'elimination', 9: 'elimination', 10: 'draw', 11: 'hostages', 12: 'time', 13: 'time',
  17: 'surrender', 18: 'surrender',
};
const REASON_NAMES: Readonly<Record<string, string>> = {
  bomb_exploded: 'bomb', target_bombed: 'bomb', bomb_defused: 'defuse', t_killed: 'elimination', ct_killed: 'elimination',
  t_saved: 'time', target_saved: 'time', time_ran_out: 'time', hostage_rescued: 'hostages', draw: 'draw',
  t_surrender: 'surrender', ct_surrender: 'surrender',
};

/** A short reason: elimination, bomb, defuse, time, surrender (or the raw value when unknown). */
export function reasonName(v: unknown): string | undefined {
  if (typeof v === 'number') return REASON_CODES[v] ?? `reason ${v}`;
  if (typeof v === 'string' && v) return REASON_NAMES[v] ?? v;
  return undefined;
}

/** A stable key per player. Bots have no Steam ID, so they are keyed by name. */
export function playerKey(steamid: unknown, name: unknown): string | undefined {
  if (typeof steamid === 'string' && steamid && steamid !== '0') return steamid;
  if (typeof steamid === 'number' && steamid > 0) return String(steamid);
  return typeof name === 'string' && name ? `BOT ${name}` : undefined;
}

/**
 * bomb_planted's `site` is an entity index, not a letter. Learn index -> letter from the plants whose
 * planter stood in a named bombsite, then use it for the others. With one index known, the other one
 * is the other site (defuse maps have two).
 */
export function siteResolver(plants: readonly RawEvent[]): (plant: RawEvent) => 'A' | 'B' | undefined {
  const byIndex = new Map<number, 'A' | 'B'>();
  for (const e of plants) {
    const site = placeToSite(e.user_last_place_name);
    const idx = num(e.site);
    if (site && idx !== undefined && !byIndex.has(idx)) byIndex.set(idx, site);
  }
  return (e) => {
    const fromPlace = placeToSite(e.user_last_place_name);
    if (fromPlace) return fromPlace;
    const idx = num(e.site);
    if (idx === undefined) return undefined;
    const known = byIndex.get(idx);
    if (known) return known;
    if (byIndex.size === 1) {
      const [only] = byIndex.values();
      return only === 'A' ? 'B' : 'A';
    }
    return undefined;
  };
}

// ---------------------------------------------------------------- rounds

export const byTick = (a: RawEvent, b: RawEvent) => a.tick - b.tick;

/**
 * Real rounds only: after the last begin_new_match (warmup and restarts before it are dropped), never
 * during warmup, and only round_end events with a winning side. A backup restore (total_rounds_played
 * going back) drops the rounds that were replayed.
 */
export function segmentRounds(events: readonly RawEvent[]): RoundWindow[] {
  const sorted = [...events].sort(byTick);
  const starts = sorted.filter(e => e.event_name === 'begin_new_match');
  const matchStart = starts.length ? starts[starts.length - 1]!.tick : 0;

  const kept: RoundWindow[] = [];
  let start = matchStart;
  let live: number | undefined;
  let bought: number | undefined;
  for (const e of sorted) {
    if (e.tick < matchStart || e.is_warmup_period === true) continue;
    switch (e.event_name) {
      case 'round_start':
        start = e.tick; live = undefined; bought = undefined;
        break;
      case 'round_freeze_end':
        if (live === undefined) live = e.tick;
        break;
      case 'buytime_ended':
        if (live !== undefined && bought === undefined && e.tick >= live) bought = e.tick;
        break;
      case 'round_end': {
        const winner = sideOf(e.winner);
        if (!winner) break;
        const played = num(e.total_rounds_played);
        if (played !== undefined && played < kept.length) kept.length = played;
        const end = e.tick;
        const boughtTick = Math.min(bought ?? (live !== undefined ? live + BUY_SECONDS * TICK_RATE : end), end);
        const reason = reasonName(e.reason);
        kept.push({
          round: kept.length + 1, startTick: start, ...(live !== undefined ? { liveTick: live } : {}), boughtTick, endTick: end,
          nextTick: end + POST_ROUND_SECONDS * TICK_RATE, winner, ...(reason ? { reason } : {}),
        });
        break;
      }
    }
  }
  for (let i = 0; i < kept.length - 1; i++) kept[i]!.nextTick = kept[i + 1]!.startTick;
  return kept;
}

/** The round's plant: the first bomb_planted while it was live (a plant after the round end is not its plant). */
export function roundPlant(plants: readonly RawEvent[], w: RoundWindow): RawEvent | undefined {
  if (w.liveTick === undefined) return undefined;
  return plants.find(e => e.event_name === 'bomb_planted' && e.tick >= w.liveTick! && e.tick <= w.endTick && e.is_warmup_period !== true);
}

/** The ticks to ask parseTicks for: a short window ending at each round's bought tick. */
export function sampleTicks(rounds: readonly RoundWindow[]): number[] {
  const ticks = new Set<number>();
  for (const r of rounds) {
    for (let t = Math.max(r.startTick, r.boughtTick - SAMPLE_SPAN); t <= r.boughtTick; t++) ticks.add(t);
  }
  return [...ticks].sort((a, b) => a - b);
}

/** Each player's latest row in [from, to]. */
export function latestRows(rows: readonly RawTickRow[], from: number, to: number): Map<string, RawTickRow> {
  const out = new Map<string, RawTickRow>();
  for (const row of rows) {
    if (row.tick < from || row.tick > to) continue;
    const key = playerKey(row.steamid, row.name);
    if (!key) continue;
    const prev = out.get(key);
    if (!prev || row.tick >= prev.tick) out.set(key, row);
  }
  return out;
}

// ---------------------------------------------------------------- truth

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

export interface BuildInput {
  source: DemoTruth['source'];
  map: string;
  events: readonly RawEvent[];
  /** parseTicks rows covering sampleTicks(rounds). */
  rows: readonly RawTickRow[];
  /** segmentRounds(events), when already computed. */
  rounds?: readonly RoundWindow[];
}

export function buildTruth(input: BuildInput): DemoTruth {
  const windows = input.rounds ?? segmentRounds(input.events);
  const plants = input.events.filter(e => e.event_name === 'bomb_planted');
  const siteOf = siteResolver(plants);
  const deaths = input.events.filter(e => e.event_name === 'player_death' && e.is_warmup_period !== true).sort(byTick);
  const names = new Map<string, string>();

  const rounds: DemoRound[] = windows.map((w) => {
    const players: DemoRound['players'] = [];
    for (const [key, row] of latestRows(input.rows, Math.max(w.startTick, w.boughtTick - SAMPLE_SPAN), w.boughtTick)) {
      const side = sideOf(row.team_num);
      if (!side) continue;
      if (!names.has(key) && typeof row.name === 'string') names.set(key, row.name);
      const balance = num(row.balance);
      const spentProp = num(row.cash_spent_this_round);
      const startMoney = num(row.start_balance) ?? (balance !== undefined ? balance + (spentProp ?? 0) : 0);
      const spent = spentProp ?? Math.max(0, startMoney - (balance ?? startMoney));
      players.push({ steamid: key, side, startMoney, equipValue: num(row.current_equip_value) ?? 0, spent });
    }
    players.sort((a, b) => (a.side === b.side ? a.steamid.localeCompare(b.steamid) : a.side === 'T' ? -1 : 1));
    const sideByPlayer = new Map(players.map(p => [p.steamid, p.side]));

    const round: DemoRound = { round: w.round, winner: w.winner, ...(w.reason ? { reason: w.reason } : {}), players, deaths: [] };

    const plant = roundPlant(plants, w);
    if (plant) {
      const site = siteOf(plant);
      if (site) round.plantSite = site;
      const x = num(plant.user_X), y = num(plant.user_Y), z = num(plant.user_Z);
      if (x !== undefined && y !== undefined && z !== undefined) round.plantAt = { x: r1(x), y: r1(y), z: r1(z) };
    }

    const zero = w.liveTick ?? w.startTick;
    for (const e of deaths) {
      if (e.tick < w.startTick || e.tick >= w.nextTick) continue;
      const steamid = playerKey(e.user_steamid, e.user_name);
      const x = num(e.user_X), y = num(e.user_Y), z = num(e.user_Z);
      if (!steamid || x === undefined || y === undefined || z === undefined) continue;
      const side = sideOf(e.user_team_num) ?? sideByPlayer.get(steamid);
      if (!side) continue;
      const killer = playerKey(e.attacker_steamid, e.attacker_name);
      const weapon = typeof e.weapon === 'string' && e.weapon ? e.weapon : undefined;
      round.deaths.push({
        steamid, side, t: r2(Math.max(0, (e.tick - zero) / TICK_RATE)), x: r1(x), y: r1(y), z: r1(z),
        ...(killer && killer !== steamid ? { killer } : {}), ...(weapon ? { weapon } : {}),
      });
    }
    return round;
  });

  return { source: input.source, map: input.map, players: rosterOf(rounds, names), rounds };
}

/**
 * Everyone who played a round, with their side in round 1. A player who joined later takes the start
 * side of a teammate from their first round (so a second-half substitute still lines up with their team).
 */
export function rosterOf(rounds: readonly DemoRound[], names: ReadonlyMap<string, string>): DemoPlayer[] {
  const first = new Map<string, { round: DemoRound; side: Side }>();
  for (const round of rounds) for (const p of round.players) if (!first.has(p.steamid)) first.set(p.steamid, { round, side: p.side });
  const opening = rounds[0];
  const startSide = new Map<string, Side>();
  for (const p of opening?.players ?? []) startSide.set(p.steamid, p.side);

  const out: DemoPlayer[] = [];
  for (const [steamid, seen] of first) {
    let side = startSide.get(steamid);
    if (!side) {
      const mate = seen.round.players.find(p => p.side === seen.side && startSide.has(p.steamid));
      side = mate ? startSide.get(mate.steamid)! : seen.side;
    }
    out.push({ steamid, name: names.get(steamid) ?? steamid, startSide: side });
  }
  return out.sort((a, b) => (a.startSide === b.startSide ? a.name.localeCompare(b.name) : a.startSide === 'T' ? -1 : 1));
}

/** Rounds won by the team that started T and the team that started CT. */
export function teamScore(truth: Pick<DemoTruth, 'players' | 'rounds'>): { startedT: number; startedCT: number } {
  const startSide = new Map(truth.players.map(p => [p.steamid, p.startSide]));
  let startedT = 0, startedCT = 0;
  for (const r of truth.rounds) {
    const ref = r.players.find(p => startSide.has(p.steamid));
    // The team that started T is on this round's side `sideOfStartedT`.
    const sideOfStartedT = ref ? (startSide.get(ref.steamid) === 'T' ? ref.side : otherSide(ref.side)) : 'T';
    if (r.winner === sideOfStartedT) startedT++; else startedCT++;
  }
  return { startedT, startedCT };
}
