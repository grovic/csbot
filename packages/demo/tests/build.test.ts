import { describe, expect, it } from 'vitest';
import {
  buildTruth, latestRows, placeToSite, playerKey, reasonName, sampleTicks, segmentRounds, sideOf, siteResolver, teamScore,
  BUY_SECONDS, TICK_RATE, type RawEvent, type RawTickRow,
} from '../src/index.ts';

// Fictional players: team "Alpha" (Ace, Ash, then the substitute Sub) and team "Bravo" (Bea, Bo).
const ID = { ace: '76561190000000001', ash: '76561190000000002', sub: '76561190000000003', bea: '76561190000000011', bo: '76561190000000012' };
const NAME: Record<string, string> = { [ID.ace]: 'Ace', [ID.ash]: 'Ash', [ID.sub]: 'Sub', [ID.bea]: 'Bea', [ID.bo]: 'Bo' };

const ev = (event_name: string, tick: number, extra: Record<string, unknown> = {}): RawEvent => ({ event_name, tick, is_warmup_period: false, ...extra });
const end = (tick: number, winner: number, reason: number | string, played: number) => ev('round_end', tick, { winner, reason, total_rounds_played: played });
const death = (tick: number, victim: string, team: number, killer: string | null, at = { x: 100.04, y: -200.06, z: 3 }, weapon = 'ak47') =>
  ev('player_death', tick, {
    user_steamid: victim, user_name: NAME[victim], user_team_num: team, user_X: at.x, user_Y: at.y, user_Z: at.z,
    attacker_steamid: killer, attacker_name: killer ? NAME[killer] : null, weapon,
  });
const plant = (tick: number, site: number, place: string, who = ID.ace) =>
  ev('bomb_planted', tick, { site, user_steamid: who, user_last_place_name: place, user_X: -300.26, user_Y: -2100.5, user_Z: -170 });

// A short fictional match. Alpha is T in rounds 1-2 and CT from round 3 (a side swap); Ash leaves after
// round 2 and Sub takes his place. Round 4 is played twice (a backup restore), round 5 is a surrender.
const EVENTS: RawEvent[] = [
  // warmup
  ev('round_start', 10, { is_warmup_period: true }),
  death(20, ID.bea, 3, ID.ace),
  { ...end(30, 2, 9, 0), is_warmup_period: true },
  ev('begin_new_match', 100),
  // round 1: Alpha (T) plants A and wins on the bomb; a kill after the round end still counts
  ev('round_freeze_end', 1000),
  ev('buytime_ended', 2280),
  death(2328, ID.bea, 3, ID.ace),
  plant(3000, 7, 'BombsiteA'),
  end(4000, 2, 1, 0),
  death(4200, ID.bo, 3, ID.ace, { x: 1, y: 2, z: 3 }, 'glock'),
  // round 2: over before buy time ends; a plant after the round end is not this round's plant
  ev('round_start', 4448),
  ev('round_freeze_end', 5728),
  death(5792, ID.ace, 2, ID.bea),
  death(5808, ID.ash, 2, null, undefined, 'world'),
  end(5900, 3, 8, 1),
  plant(6000, 8, 'Palace', ID.ash),
  // round 3: sides swapped, Bravo (now T) plants at the site whose place name is not a bombsite
  ev('round_start', 6348),
  ev('round_freeze_end', 7628),
  ev('buytime_ended', 8908),
  plant(9000, 8, 'Ramp', ID.bea),
  end(9500, 2, 'bomb_exploded', 2),
  // round 4, then restored from a backup and replayed (no buytime_ended event this time)
  ev('round_start', 9948),
  ev('round_freeze_end', 11228),
  end(12000, 3, 8, 3),
  ev('round_start', 12448),
  ev('round_freeze_end', 13728),
  end(15500, 2, 9, 3),
  // round 5: surrender during the freeze time, then everyone leaves the server
  ev('round_start', 15948),
  end(16000, 2, 18, 4),
  death(16600, ID.ace, 3, ID.ace, undefined, 'world'),
];

const row = (tick: number, steamid: string, team: number, start: number, spent: number, equip: number): RawTickRow =>
  ({ tick, steamid, name: NAME[steamid], team_num: team, start_balance: start, cash_spent_this_round: spent, balance: start - spent, current_equip_value: equip });

// Player rows at (or just before) each round's bought tick.
const ROWS: RawTickRow[] = [
  // round 1, bought at 2280: the exact tick is missing, rows two ticks earlier are used; GOTV has no team
  row(2278, ID.ace, 2, 800, 700, 900), row(2278, ID.ash, 2, 800, 0, 200),
  row(2278, ID.bea, 3, 800, 650, 850), row(2278, ID.bo, 3, 800, 800, 1000),
  { tick: 2278, steamid: '0', name: 'GOTV', team_num: 1 },
  row(2272, ID.ace, 2, 800, 0, 200), // older row for Ace: the latest one wins
  // round 2, bought at the round end (5900)
  row(5900, ID.ace, 2, 3400, 3300, 3500), row(5900, ID.ash, 2, 3900, 3700, 3900),
  // Bea's row has no start_balance: start = balance + spent
  { tick: 5900, steamid: ID.bea, name: 'Bea', team_num: 3, balance: 1900, cash_spent_this_round: 0, current_equip_value: 200 },
  row(5900, ID.bo, 3, 2050, 0, 200),
  // round 3, swapped: Alpha is CT, Sub replaced Ash
  row(8908, ID.ace, 3, 800, 650, 850), row(8908, ID.sub, 3, 800, 0, 200),
  row(8908, ID.bea, 2, 800, 800, 1000), row(8908, ID.bo, 2, 800, 700, 900),
  // round 4 (the replayed one), bought at the freeze end + 20 s
  ...[ID.ace, ID.sub].map(id => row(13728 + BUY_SECONDS * TICK_RATE, id, 3, 2000, 1000, 1200)),
  ...[ID.bea, ID.bo].map(id => row(13728 + BUY_SECONDS * TICK_RATE, id, 2, 3000, 2900, 3100)),
  // round 5, surrender: read at the round end; a bot fills Sub's slot
  row(16000, ID.ace, 3, 1900, 0, 200),
  { tick: 16000, steamid: '0', name: 'Bot Kim', team_num: 3, start_balance: 1900, cash_spent_this_round: 0, balance: 1900, current_equip_value: 200 },
  row(16000, ID.bea, 2, 5000, 0, 3000), row(16000, ID.bo, 2, 5000, 0, 3000),
];

const SOURCE = { file: 'fictional.dem', parsedAt: 0, bytes: 1 };

describe('small mappings', () => {
  it('maps bombsite place names to a site letter', () => {
    for (const p of ['BombsiteA', 'Bombsite A', 'bombsite_a', 'SiteA', 'ASite']) expect(placeToSite(p)).toBe('A');
    for (const p of ['BombsiteB', 'Bombsite B', 'SiteB', 'BSite']) expect(placeToSite(p)).toBe('B');
    for (const p of ['TSpawn', 'Apartments', 'Arch', 'BombsiteC', '', undefined, 184]) expect(placeToSite(p)).toBeUndefined();
  });

  it('maps team numbers and round end reasons', () => {
    expect([sideOf(2), sideOf(3), sideOf('CT'), sideOf(1), sideOf(0), sideOf(undefined)]).toEqual(['T', 'CT', 'CT', undefined, undefined, undefined]);
    expect([1, 7, 8, 9, 12, 17, 18].map(reasonName)).toEqual(['bomb', 'defuse', 'elimination', 'elimination', 'time', 'surrender', 'surrender']);
    expect(['t_killed', 'ct_killed', 'bomb_defused', 'bomb_exploded', 't_saved', 'ct_surrender'].map(reasonName))
      .toEqual(['elimination', 'elimination', 'defuse', 'bomb', 'time', 'surrender']);
    expect(reasonName(99)).toBe('reason 99');
    expect(reasonName(undefined)).toBeUndefined();
  });

  it('keys bots by name', () => {
    expect(playerKey('76561190000000001', 'Ace')).toBe('76561190000000001');
    expect(playerKey('0', 'Kim')).toBe('BOT Kim');
    expect(playerKey(null, null)).toBeUndefined();
  });

  it('learns the site of a bomb target from plants in a named bombsite', () => {
    const resolve = siteResolver([plant(1, 7, 'BombsiteA'), plant(2, 7, 'Ramp'), plant(3, 8, 'Ramp')]);
    expect(resolve(plant(9, 7, 'Ramp'))).toBe('A');
    expect(resolve(plant(9, 8, 'Ramp'))).toBe('B'); // the other index is the other site
    expect(resolve(plant(9, 8, 'BombsiteA'))).toBe('A'); // the place name wins
    expect(siteResolver([plant(1, 7, 'Ramp')])(plant(2, 7, 'Ramp'))).toBeUndefined();
  });

  it('takes each player\'s latest row in a window', () => {
    const rows = [row(10, ID.ace, 2, 800, 0, 200), row(12, ID.ace, 2, 800, 500, 700), row(13, ID.ace, 2, 800, 800, 1000)];
    expect(latestRows(rows, 5, 12).get(ID.ace)?.tick).toBe(12);
  });
});

describe('rounds', () => {
  const rounds = segmentRounds(EVENTS);

  it('keeps real rounds only and replaces a round replayed from a backup', () => {
    expect(rounds.map(r => r.round)).toEqual([1, 2, 3, 4, 5]);
    expect(rounds.map(r => r.winner)).toEqual(['T', 'CT', 'T', 'T', 'T']);
    expect(rounds.map(r => r.reason)).toEqual(['bomb', 'elimination', 'bomb', 'elimination', 'surrender']);
    expect(rounds[3]).toMatchObject({ startTick: 12448, liveTick: 13728, endTick: 15500 });
  });

  it('starts round 1 at the match start and reads money once buying is over', () => {
    expect(rounds[0]).toMatchObject({ startTick: 100, liveTick: 1000, boughtTick: 2280, nextTick: 4448 });
    expect(rounds[1]!.boughtTick).toBe(5900); // round over before buy time ended
    expect(rounds[3]!.boughtTick).toBe(13728 + BUY_SECONDS * TICK_RATE); // no buytime_ended event: live + 20 s
    expect(rounds[4]).toMatchObject({ startTick: 15948, boughtTick: 16000, nextTick: 16448 });
    expect(rounds[4]!.liveTick).toBeUndefined();
  });

  it('skips draws and anything before the last begin_new_match', () => {
    const r = segmentRounds([end(5, 2, 9, 0), ev('begin_new_match', 10), end(20, 1, 10, 0), ev('round_start', 30), end(40, 3, 12, 0)]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ round: 1, startTick: 30, winner: 'CT', reason: 'time' });
  });

  it('asks for a short tick window per round', () => {
    const ticks = sampleTicks(rounds);
    expect(ticks).toContain(2280);
    expect(ticks).toContain(2272);
    expect(ticks).not.toContain(2271);
  });
});

describe('truth', () => {
  const truth = buildTruth({ source: SOURCE, map: 'de_fictional', events: EVENTS, rows: ROWS });
  const [r1, r2, r3, r4, r5] = truth.rounds;

  it('reads money and equipment per player', () => {
    expect(r1!.players).toHaveLength(4); // GOTV left out
    expect(r1!.players.find(p => p.steamid === ID.ace)).toEqual({ steamid: ID.ace, side: 'T', startMoney: 800, equipValue: 900, spent: 700 });
    expect(r2!.players.find(p => p.steamid === ID.bea)).toEqual({ steamid: ID.bea, side: 'CT', startMoney: 1900, equipValue: 200, spent: 0 });
    expect(r5!.players.map(p => p.steamid)).toContain('BOT Bot Kim');
  });

  it('places plants on a site, only while the round is live', () => {
    expect(r1).toMatchObject({ plantSite: 'A', plantAt: { x: -300.3, y: -2100.5, z: -170 } });
    expect(r2!.plantSite).toBeUndefined();
    expect(r2!.plantAt).toBeUndefined();
    expect(r3!.plantSite).toBe('B');
  });

  it('times deaths from the freeze end and keeps post-round kills, not warmup or leaving', () => {
    expect(r1!.deaths).toEqual([
      { steamid: ID.bea, side: 'CT', t: 20.75, x: 100, y: -200.1, z: 3, killer: ID.ace, weapon: 'ak47' },
      { steamid: ID.bo, side: 'CT', t: 50, x: 1, y: 2, z: 3, killer: ID.ace, weapon: 'glock' },
    ]);
    expect(r2!.deaths.map(d => d.t)).toEqual([1, 1.25]);
    expect(r2!.deaths[1]!.killer).toBeUndefined();
    expect(r4!.deaths).toEqual([]);
    expect(r5!.deaths).toEqual([]);
  });

  it('lists everyone with their round 1 side, a substitute taking his team\'s', () => {
    expect(truth.players).toEqual([
      { steamid: ID.ace, name: 'Ace', startSide: 'T' },
      { steamid: ID.ash, name: 'Ash', startSide: 'T' },
      { steamid: 'BOT Bot Kim', name: 'Bot Kim', startSide: 'T' },
      { steamid: ID.sub, name: 'Sub', startSide: 'T' },
      { steamid: ID.bea, name: 'Bea', startSide: 'CT' },
      { steamid: ID.bo, name: 'Bo', startSide: 'CT' },
    ]);
  });

  it('scores rounds for teams across the side swap', () => {
    // Alpha won 1 (as T); Bravo won 2 (CT), 3, 4 and 5 (as T after the swap).
    expect(teamScore(truth)).toEqual({ startedT: 1, startedCT: 4 });
  });
});
