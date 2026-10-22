// Premier and other Valve matchmaking: scout the players from a pasted `status` (spike 3). Each player's
// Steam profile (with a Steam key) and FACEIT account by Steam ID (with a FACEIT key), when they have one.
// Valve doesn't say who's on which team. Our side is what csbot knows: this PC's Steam ID, teammates
// seen while spectating, room members by name. The host sorts the rest; once one side has five, the
// others go to the other side.

import type { DataSourceState, ScoutPlayer, ScoutView } from '@csbot/protocol';
import { buildPlayer, DEFAULT_POOL, factsOf, keyStatOf, mapRows, teamOf, threatOf, winChance, type SteamInfo } from './derive.ts';
import type { FaceitApi, FaceitPlayer, FaceitPlayerStats } from './faceit.ts';
import { pool } from './http.ts';
import type { SteamApi } from './steam.ts';
import type { StatusPlayer } from './status.ts';

export type PremierSide = 'us' | 'them';

export interface PremierPlayer {
  status: StatusPlayer;
  faceit?: FaceitPlayer;
  stats?: FaceitPlayerStats;
  steam?: SteamInfo;
}

export interface PremierData {
  players: PremierPlayer[];
  map?: string;
  sources: Pick<ScoutView['sources'], 'faceit' | 'steam'>;
}

const settle = async <T>(p: Promise<T>): Promise<T | undefined> => { try { return await p; } catch { return undefined; } };

/** Every player's public data, fetched once: sorting sides later needs no new requests. */
export async function fetchPremier(deps: { faceit?: FaceitApi; steam?: SteamApi }, players: StatusPlayer[], map?: string): Promise<PremierData> {
  const ids = players.map(p => p.steamid);
  let steamState: DataSourceState = deps.steam ? 'live' : 'missing-key';
  const steam = new Map<string, SteamInfo>();
  if (deps.steam && ids.length) {
    const [sums, bans] = await Promise.all([settle(deps.steam.summaries(ids)), settle(deps.steam.bans(ids))]);
    if (!sums && !bans) steamState = 'error';
    const minutes = await pool(ids, 4, id => settle(deps.steam!.cs2Minutes(id)));
    ids.forEach((id, i) => steam.set(id, {
      ...(sums?.find(s => s.steamid === id) ? { summary: sums.find(s => s.steamid === id)! } : {}),
      ...(bans?.find(b => b.SteamId === id) ? { bans: bans.find(b => b.SteamId === id)! } : {}),
      ...(minutes[i] !== undefined ? { minutes: minutes[i]! } : {}),
    }));
  }
  const faceitState: DataSourceState = deps.faceit ? 'live' : 'missing-key';
  const fetched = await pool(players, 4, async p => {
    // Most Premier players have no FACEIT account: a miss is normal, not an error.
    const fp = deps.faceit ? await settle(deps.faceit.playerBySteamId(p.steamid)) : undefined;
    const stats = fp && deps.faceit ? await settle(deps.faceit.stats(fp.player_id)) : undefined;
    return { status: p, ...(fp ? { faceit: fp } : {}), ...(stats ? { stats } : {}), ...(steam.has(p.steamid) ? { steam: steam.get(p.steamid)! } : {}) } satisfies PremierPlayer;
  });
  return { players: fetched, ...(map ? { map } : {}), sources: { faceit: faceitState, steam: steamState } };
}

/** The display name: FACEIT nickname, else Steam name, else the name in status, else the Steam ID. */
export const premierName = (p: PremierPlayer) => p.faceit?.nickname ?? p.steam?.summary?.personaname ?? p.status.name ?? p.status.steamid;

/**
 * Each player's side: the host's own sorting, else ours when csbot knows them (`ours`: Steam IDs or
 * lower-case names). Once a side has `teamSize` players, the rest go to the other side; until then
 * they stay unsorted (undefined).
 */
export function premierSides(players: PremierPlayer[], ours: ReadonlySet<string>, manual: Readonly<Record<string, PremierSide>>, teamSize = 5): Map<string, PremierSide | undefined> {
  const known = (p: PremierPlayer) => ours.has(p.status.steamid) || [p.status.name, p.steam?.summary?.personaname, p.faceit?.nickname].some(n => !!n && ours.has(n.toLowerCase()));
  const out = new Map<string, PremierSide | undefined>(players.map(p => [p.status.steamid, manual[p.status.steamid] ?? (known(p) ? 'us' : undefined)]));
  const count = (s: PremierSide) => [...out.values()].filter(v => v === s).length;
  const fill = count('us') >= teamSize ? 'them' : count('them') >= teamSize ? 'us' : undefined;
  if (fill) for (const [id, v] of out) if (!v) out.set(id, fill);
  return out;
}

export function premierView(data: PremierData, sides: Map<string, PremierSide | undefined>, o: {
  matchId: string; claude: DataSourceState; now: number;
  /** Room roles by Steam ID or lower-case name (others on our side are randoms). */
  room?: Record<string, 'admin' | 'member'>;
}): ScoutView {
  const room = new Map(Object.entries(o.room ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const build = (p: PremierPlayer, side: PremierSide): ScoutPlayer => {
    const roleIn = room.get(p.status.steamid) ?? [p.status.name, premierName(p)].map(n => (n ? room.get(n.toLowerCase()) : undefined)).find(r => r !== undefined);
    const pl = buildPlayer({
      side,
      roster: { player_id: p.faceit?.player_id ?? p.status.steamid, nickname: premierName(p), game_player_id: p.status.steamid },
      ...(p.faceit ? { player: p.faceit } : {}), ...(p.stats ? { stats: p.stats } : {}), ...(p.steam ? { steam: p.steam } : {}),
      ...(side === 'us' ? { room: roleIn ?? 'random' } : {}),
      now: o.now,
    });
    if (!p.faceit && data.sources.faceit === 'live') pl.flags = [...pl.flags, 'No FACEIT account'];
    pl.threat = threatOf(pl, data.map);
    const ks = keyStatOf(pl, data.map);
    if (ks) pl.keyStat = ks;
    return pl;
  };
  const us = data.players.filter(p => sides.get(p.status.steamid) === 'us').map(p => build(p, 'us'));
  const them = data.players.filter(p => sides.get(p.status.steamid) === 'them').map(p => build(p, 'them'))
    .sort((a, b) => (b.threat?.score ?? 0) - (a.threat?.score ?? 0));
  const unsorted = data.players.filter(p => !sides.get(p.status.steamid)).map(p => build(p, 'them'));
  const usT = teamOf('Your team', us), themT = teamOf('Opponents', them);
  const maps = mapRows(usT, themT, DEFAULT_POOL);
  const view: ScoutView = {
    v: 1, status: 'ready', platform: 'premier', matchId: o.matchId,
    ...(data.map ? { map: data.map } : {}),
    fetchedAt: o.now, us: usT, them: themT, maps, facts: [], report: { status: 'idle' },
    sources: { ...data.sources, claude: o.claude }, sideBy: 'manual',
    ...(unsorted.length ? { unsorted } : {}),
  };
  const wc = winChance(usT, themT, undefined, data.map ? maps.find(r => r.map === data.map) : undefined);
  if (wc && !unsorted.length) view.winChance = wc;
  view.facts = factsOf(view);
  return view;
}

/** A stable id for a Premier lobby (the same players give the same id). */
export function premierMatchId(players: StatusPlayer[]): string {
  let h = 5381;
  for (const c of players.map(p => p.steamid).sort().join(',')) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0;
  return `premier-${h.toString(36)}`;
}
