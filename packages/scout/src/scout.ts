// Scout one FACEIT match: fetch the rosters and every player's public data, then derive the view.
// Partial data is fine: a failed player lookup leaves a thinner card, never a failed scout.

import type { DataSourceState, ScoutPlayer, ScoutView } from '@csbot/protocol';
import { buildPlayer, DEFAULT_POOL, factsOf, keyStatOf, mapRows, parties, teamOf, threatOf, winChance, type SteamInfo } from './derive.ts';
import type { FaceitApi, FaceitFaction, FaceitHistoryItem, FaceitPlayer, FaceitPlayerStats } from './faceit.ts';
import { pool } from './http.ts';
import type { SteamApi } from './steam.ts';

export interface ScoutDeps {
  faceit: FaceitApi;
  steam?: SteamApi;
  sources: ScoutView['sources'];
  now?: () => number;
}

export interface ScoutInput {
  matchId: string;
  platform: 'faceit' | 'sample';
  /** Our own Steam ID (from GSI), to know which faction is "us". */
  ourSteamId?: string;
  /** Steam IDs (or nicknames for the sample) of room members → their room role. Others on our side are randoms. */
  room?: Record<string, 'admin' | 'member'>;
  mapPool?: string[];
}

const settle = async <T>(p: Promise<T>): Promise<T | undefined> => { try { return await p; } catch { return undefined; } };

export async function scoutFaceitMatch(deps: ScoutDeps, input: ScoutInput): Promise<ScoutView> {
  const now = deps.now ?? Date.now;
  const match = await deps.faceit.match(input.matchId);
  const factions = Object.entries(match.teams);
  if (factions.length !== 2) throw new Error('FACEIT returned a match without two teams');
  const ourKey = factions.find(([, f]) => f.roster.some(r => r.game_player_id && r.game_player_id === input.ourSteamId))?.[0] ?? factions[0]![0];
  const ours = factions.find(([k]) => k === ourKey)![1];
  const theirs = factions.find(([k]) => k !== ourKey)![1];

  const roster = [...ours.roster.map(r => ({ r, side: 'us' as const })), ...theirs.roster.map(r => ({ r, side: 'them' as const }))];
  const fetched = await pool(roster, 4, async ({ r, side }) => {
    const [player, stats, history] = await Promise.all([
      settle<FaceitPlayer>(deps.faceit.player(r.player_id)),
      settle<FaceitPlayerStats>(deps.faceit.stats(r.player_id)),
      side === 'them' ? settle(deps.faceit.history(r.player_id, 20)) : Promise.resolve(undefined),
    ]);
    return { r, side, player, stats, history: history?.items as FaceitHistoryItem[] | undefined };
  });

  // Steam: two batched calls plus playtime per player (private profiles just return nothing).
  const steamIds = fetched.map(f => f.player?.games?.cs2?.game_player_id ?? f.r.game_player_id).filter((s): s is string => !!s);
  let steamState: DataSourceState = deps.sources.steam;
  const steam = new Map<string, SteamInfo>();
  if (deps.steam && steamIds.length) {
    const [sums, bans] = await Promise.all([settle(deps.steam.summaries(steamIds)), settle(deps.steam.bans(steamIds))]);
    if (!sums && !bans) steamState = 'error';
    const minutes = await pool(steamIds, 4, id => settle(deps.steam!.cs2Minutes(id)));
    steamIds.forEach((id, i) => steam.set(id, {
      ...(sums?.find(s => s.steamid === id) ? { summary: sums.find(s => s.steamid === id)! } : {}),
      ...(bans?.find(b => b.SteamId === id) ? { bans: bans.find(b => b.SteamId === id)! } : {}),
      ...(minutes[i] !== undefined ? { minutes: minutes[i]! } : {}),
    }));
  }

  const map = match.voting?.map?.pick?.[0];
  const roomOf = (p: { nick: string; steamid?: string }): ScoutPlayer['room'] =>
    input.room?.[p.steamid ?? ''] ?? input.room?.[p.nick] ?? 'random';
  const players = fetched.map(f => {
    const sid = f.player?.games?.cs2?.game_player_id ?? f.r.game_player_id;
    const p = buildPlayer({
      side: f.side, roster: f.r, ...(f.player ? { player: f.player } : {}), ...(f.stats ? { stats: f.stats } : {}),
      ...(sid && steam.has(sid) ? { steam: steam.get(sid)! } : {}),
      ...(f.side === 'us' ? { room: roomOf({ nick: f.r.nickname, ...(sid ? { steamid: sid } : {}) }) } : {}),
      now: now(),
    });
    p.threat = threatOf(p, map);
    const ks = keyStatOf(p, map);
    if (ks) p.keyStat = ks;
    return p;
  });

  const themIds = fetched.filter(f => f.side === 'them').map(f => f.r.player_id);
  const party = parties(themIds, Object.fromEntries(fetched.filter(f => f.side === 'them').map(f => [f.r.player_id, f.history])));
  for (const p of players) if (party[p.id]) p.party = party[p.id];

  const us = teamOf(teamName(ours, 'Your team'), players.filter(p => p.side === 'us'));
  const them = teamOf(teamName(theirs, 'Opponents'), players.filter(p => p.side === 'them').sort((a, b) => (b.threat?.score ?? 0) - (a.threat?.score ?? 0)));
  const maps = mapRows(us, them, input.mapPool ?? DEFAULT_POOL);
  const view: ScoutView = {
    v: 1, status: 'ready', platform: input.platform, matchId: match.match_id,
    ...(match.faceit_url ? { matchUrl: match.faceit_url.replace('{lang}', 'en') } : {}),
    ...(map ? { map } : {}),
    fetchedAt: now(), us, them, maps, facts: [],
    report: { status: 'idle' },
    sources: { ...deps.sources, steam: steamState },
  };
  const wc = winChance(us, them, ours.stats?.winProbability, map ? maps.find(r => r.map === map) : undefined);
  if (wc) view.winChance = wc;
  view.facts = factsOf(view);
  return view;
}

const teamName = (f: FaceitFaction, fallback: string) => f.name || fallback;
