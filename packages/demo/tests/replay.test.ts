import { describe, expect, it } from 'vitest';
import {
  buildReplay, frameTicks, indexRows, nadeKind, packFrames, replaySpan, replayTicks, roundNades, roundPlayers, segmentRounds,
  REPLAY_HZ, REPLAY_STEP, SMOKE_SECONDS, TICK_RATE, type RawEvent, type RawTickRow, type RoundWindow,
} from '../src/index.ts';

// Fictional players: Ace and Ash (T), Bea and Bo (CT).
const ID = { ace: '76561190000000001', ash: '76561190000000002', bea: '76561190000000011', bo: '76561190000000012' };
const NAME: Record<string, string> = { [ID.ace]: 'Ace', [ID.ash]: 'Ash', [ID.bea]: 'Bea', [ID.bo]: 'Bo' };
const TEAM: Record<string, number> = { [ID.ace]: 2, [ID.ash]: 2, [ID.bea]: 3, [ID.bo]: 3 };

const ev = (event_name: string, tick: number, extra: Record<string, unknown> = {}): RawEvent => ({ event_name, tick, is_warmup_period: false, ...extra });
const end = (tick: number, winner: number, reason: number, played: number) => ev('round_end', tick, { winner, reason, total_rounds_played: played });
const death = (tick: number, victim: string, killer: string | null, weapon = 'ak47') =>
  ev('player_death', tick, {
    user_steamid: victim, user_name: NAME[victim], user_team_num: TEAM[victim], user_X: 1, user_Y: 2, user_Z: 3,
    attacker_steamid: killer, attacker_name: killer ? NAME[killer] : null, weapon,
  });
const nade = (event_name: string, tick: number, entityid: number, at = { x: 100.4, y: -200.6, z: 3.2 }) => ev(event_name, tick, { entityid, ...at });

const window = (w: Partial<RoundWindow>): RoundWindow =>
  ({ round: 1, startTick: 0, liveTick: 1280, boughtTick: 2560, endTick: 5000, nextTick: 5448, winner: 'T', ...w });

describe('ticks', () => {
  it('samples from the freeze end until 3 s after the round end, 16 ticks apart', () => {
    expect(REPLAY_STEP).toBe(16);
    const span = replaySpan(window({ liveTick: 1000, endTick: 4000 }));
    // 4000 + 192 = 4192; (4192 - 1000) / 16 = 199.5 -> 199 steps
    expect(span).toEqual({ zero: 1000, frames: 200, lastTick: 1000 + 199 * 16 });
    const ticks = frameTicks(span);
    expect(ticks).toHaveLength(200);
    expect([ticks[0], ticks[1], ticks.at(-1)]).toEqual([1000, 1016, 4184]);
  });

  it('caps a round at 175 s, stops before the next round, and starts a freeze-time surrender at the round start', () => {
    expect(replaySpan(window({ liveTick: 0, endTick: 200 * TICK_RATE, nextTick: 210 * TICK_RATE }))).toMatchObject({ frames: 175 * REPLAY_HZ + 1 });
    expect(replaySpan(window({ liveTick: 1000, endTick: 4000, nextTick: 4100 })).lastTick).toBeLessThan(4100);
    const surrender = replaySpan(window({ startTick: 6348, liveTick: undefined, boughtTick: 6400, endTick: 6400, nextTick: 6848 }));
    expect(surrender).toEqual({ zero: 6348, frames: 16, lastTick: 6348 + 15 * 16 });
  });

  it('asks parseTicks for every round\'s ticks, sorted, once each', () => {
    const rounds = [window({ liveTick: 1000, endTick: 1100, nextTick: 5000 }), window({ round: 2, startTick: 5000, liveTick: 6000, endTick: 6050, nextTick: 9000 })];
    const ticks = replayTicks(rounds);
    expect(ticks).toEqual([...frameTicks(replaySpan(rounds[0]!)), ...frameTicks(replaySpan(rounds[1]!))]);
    expect(ticks[0]).toBe(1000);
    expect(new Set(ticks).size).toBe(ticks.length);
  });
});

describe('grenades', () => {
  it('maps the detonation events to a kind', () => {
    expect(['smokegrenade_detonate', 'inferno_startburn', 'flashbang_detonate', 'hegrenade_detonate', 'decoy_started'].map(nadeKind))
      .toEqual(['smoke', 'molotov', 'flash', 'he', 'decoy']);
    for (const e of ['smokegrenade_expired', 'inferno_expire', 'player_death', 'molotov_detonate', undefined]) expect(nadeKind(e)).toBeUndefined();
  });

  it('times a smoke or inferno by its own end event, before the round resets', () => {
    const span = replaySpan(window({ liveTick: 1000, endTick: 4000, nextTick: 4448 }));
    const nades = roundNades([
      nade('smokegrenade_detonate', 1640, 50), nade('smokegrenade_expired', 1640 + 1412, 50),
      nade('smokegrenade_expired', 1700, 99), // another smoke's
      nade('inferno_startburn', 2000, 60), nade('inferno_expire', 2213, 60),
      nade('smokegrenade_detonate', 3800, 51), nade('smokegrenade_expired', 4500, 51), // after the reset: not this one's
      nade('inferno_startburn', 3900, 61),
    ], span, 4448);
    expect(nades.map(n => [n.kind, n.t, n.duration])).toEqual([
      ['smoke', 10, 22.06], ['molotov', 15.63, 3.33], ['smoke', 43.75, SMOKE_SECONDS], ['molotov', 45.31, 7],
    ]);
    expect(nades[0]).toMatchObject({ x: 100, y: -201, z: 3 });
  });
});

describe('players and frames', () => {
  const row = (tick: number, steamid: string, extra: Record<string, unknown>): RawTickRow => ({ tick, steamid, name: NAME[steamid] ?? null, ...extra });

  it('keeps players on a side with a position, T first', () => {
    const index = indexRows([
      { tick: 0, steamid: '0', name: 'GOTV', team_num: 1 },
      row(0, ID.bea, { team_num: 3, X: 1, Y: 2, Z: 3 }),
      row(0, ID.ace, { team_num: 2, X: 1, Y: 2, Z: 3 }),
      row(0, ID.bo, { team_num: 3, X: null, Y: null, Z: null }), // left before the round
      { tick: 16, steamid: '0', name: 'Kim', team_num: 3, X: 4, Y: 5, Z: 6 }, // a bot joins
      row(16, ID.ace, { team_num: 3, X: 1, Y: 2, Z: 3 }), // side from the first row
    ]);
    expect(roundPlayers(index, [0, 16])).toEqual([
      { steamid: ID.ace, name: 'Ace', side: 'T' },
      { steamid: ID.bea, name: 'Bea', side: 'CT' },
      { steamid: 'BOT Kim', name: 'Kim', side: 'CT' },
    ]);
  });

  it('packs [x, y, z, hp] per player per tick, filling gaps from the nearest sample', () => {
    const index = indexRows([
      row(0, ID.ace, { X: 1.4, Y: -2.6, Z: 3.5, health: 100, is_alive: true }),
      row(16, ID.bea, { X: 10, Y: 20, Z: 30, health: 88, is_alive: true }), // missing at tick 0: back-filled
      row(32, ID.ace, { X: -0.4, Y: 5, Z: 6, health: 0, is_alive: false }), // missing at tick 16: carried
      row(32, ID.bea, { X: null, Y: null, Z: null, health: 50, is_alive: true }), // no position: the last one
      row(48, ID.bea, { X: 11, Y: 21, Z: 31, health: 12, is_alive: false }), // dead: hp 0 whatever health says
    ]);
    const frames = packFrames(index, [ID.ace, ID.bea, 'nobody'], [0, 16, 32, 48]);
    expect(frames).toEqual([
      [1, -3, 4, 100, 10, 20, 30, 88, 0, 0, 0, 0],
      [1, -3, 4, 100, 10, 20, 30, 88, 0, 0, 0, 0],
      [0, 5, 6, 0, 10, 20, 30, 50, 0, 0, 0, 0],
      [0, 5, 6, 0, 11, 21, 31, 0, 0, 0, 0, 0],
    ]);
    expect(Object.is(frames[2]![0], 0)).toBe(true); // -0.4 rounds to 0, not -0
  });
});

describe('replay', () => {
  // Round 1: Alpha (T) plants A and wins; round 2 is won by CT; round 3 is a surrender in the freeze time.
  const EVENTS: RawEvent[] = [
    ev('round_start', 10, { is_warmup_period: true }),
    nade('smokegrenade_detonate', 20, 40),
    ev('begin_new_match', 100),
    nade('flashbang_detonate', 900, 41), // freeze time: nothing goes off, and not in the window anyway
    ev('round_freeze_end', 1000),
    nade('smokegrenade_detonate', 1640, 50), nade('smokegrenade_expired', 3052, 50),
    nade('inferno_startburn', 2000, 60), nade('inferno_expire', 2449, 60),
    nade('flashbang_detonate', 2100, 62), nade('hegrenade_detonate', 2200, 63), nade('decoy_started', 2300, 64),
    ev('buytime_ended', 2280),
    death(2328, ID.bea, ID.ace),
    ev('bomb_planted', 3000, { site: 7, user_steamid: ID.ace, user_last_place_name: 'BombsiteA', user_X: -300.26, user_Y: -2100.6, user_Z: -170 }),
    end(4000, 2, 9, 0),
    death(4100, ID.bo, ID.ace, 'glock'), // after the round end, inside the 3 s tail
    death(4300, ID.ash, ID.ash, 'world'), // after the tail: not in the replay
    ev('round_start', 4448),
    ev('round_freeze_end', 5728),
    death(5792, ID.ace, null, 'world'),
    end(5900, 3, 8, 1),
    ev('round_start', 6348),
    end(6400, 2, 18, 2),
  ];
  const rounds = segmentRounds(EVENTS);
  const DEATHS: Record<string, number> = { [ID.bea]: 2328, [ID.bo]: 4100, [ID.ace]: 5792 };
  const ROWS: RawTickRow[] = replayTicks(rounds).flatMap((tick) => {
    const round = rounds.find(r => tick >= r.startTick && tick < r.nextTick)!;
    const out: RawTickRow[] = [{ tick, steamid: '0', name: 'GOTV', team_num: 1 }];
    for (const id of [ID.ace, ID.ash, ID.bea, ID.bo]) {
      const died = DEATHS[id] !== undefined && DEATHS[id]! >= round.startTick && DEATHS[id]! < round.nextTick && tick >= DEATHS[id]!;
      out.push({ tick, steamid: id, name: NAME[id]!, team_num: TEAM[id], X: tick / 16, Y: -tick / 32, Z: 7.2, health: died ? 0 : 100, is_alive: !died });
    }
    return out;
  });
  const replay = buildReplay({ map: 'de_fictional', events: EVENTS, rows: ROWS });
  const [r1, r2, r3] = replay.rounds;

  it('has parseDemo\'s rounds, sampled at 4 Hz', () => {
    expect(replay.map).toBe('de_fictional');
    expect(replay.rounds.map(r => r.round)).toEqual(rounds.map(r => r.round));
    expect(replay.rounds.map(r => r.round)).toEqual([1, 2, 3]);
    expect(r1).toMatchObject({ hz: 4, duration: 49.75 });
    expect(r3).toMatchObject({ duration: 3.75 }); // from the round start: no freeze end
    for (const r of replay.rounds) {
      expect(r.frames).toHaveLength(r.duration * r.hz + 1);
      for (const f of r.frames) expect(f).toHaveLength(r.players.length * 4);
    }
  });

  it('lists the round\'s players without GOTV, and packs their positions and hp', () => {
    expect(r1!.players.map(p => p.name)).toEqual(['Ace', 'Ash', 'Bea', 'Bo']);
    expect(r1!.frames[0]).toEqual([63, -31, 7, 100, 63, -31, 7, 100, 63, -31, 7, 100, 63, -31, 7, 100]);
    const bea = r1!.players.findIndex(p => p.name === 'Bea');
    const hp = (i: number) => r1!.frames[i]![bea * 4 + 3];
    // Bea dies at tick 2328 = 1000 + 83 × 16, so frame 83 is the first with hp 0.
    expect([hp(0), hp(82), hp(83), hp(84), hp(r1!.frames.length - 1)]).toEqual([100, 100, 0, 0, 0]);
  });

  it('keeps grenades, kills and the plant inside the replay, timed from the freeze end', () => {
    expect(r1!.nades).toEqual([
      { t: 10, kind: 'smoke', x: 100, y: -201, z: 3, duration: 22.06 },
      { t: 15.63, kind: 'molotov', x: 100, y: -201, z: 3, duration: 7.02 },
      { t: 17.19, kind: 'flash', x: 100, y: -201, z: 3 },
      { t: 18.75, kind: 'he', x: 100, y: -201, z: 3 },
      { t: 20.31, kind: 'decoy', x: 100, y: -201, z: 3 },
    ]);
    expect(r1!.kills).toEqual([
      { t: 20.75, victim: ID.bea, killer: ID.ace, weapon: 'ak47' },
      { t: 48.44, victim: ID.bo, killer: ID.ace, weapon: 'glock' },
    ]);
    expect(r1!.plant).toEqual({ t: 31.25, site: 'A', x: -300, y: -2101, z: -170 });
    expect(r1!.plant!.t).toBeLessThanOrEqual(r1!.duration);
    expect(r2!.kills).toEqual([{ t: 1, victim: ID.ace, weapon: 'world' }]);
    expect(r2!.plant).toBeUndefined();
    expect(r2!.nades).toEqual([]);
    expect(r3!.kills).toEqual([]);
  });
});
