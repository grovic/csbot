// Scouting math: every number shown on the Scout page is computed here from API data.
// The AI report only words it. Weights are shown in the UI next to the threat score.

import type { ScoutMapRow, ScoutPlayer, ScoutTeam, ScoutView, ThreatPart } from '@csbot/protocol';
import { mapId, num, recentResults, type FaceitHistoryItem, type FaceitPlayer, type FaceitPlayerStats, type FaceitRosterEntry } from './faceit.ts';
import type { SteamBans, SteamSummary } from './steam.ts';

export const MAP_NAMES: Record<string, string> = {
  de_mirage: 'Mirage', de_ancient: 'Ancient', de_nuke: 'Nuke', de_anubis: 'Anubis', de_inferno: 'Inferno',
  de_dust2: 'Dust II', de_train: 'Train', de_vertigo: 'Vertigo', de_overpass: 'Overpass',
};
export const mapName = (id: string) => MAP_NAMES[id] ?? id.replace(/^de_/, '').replace(/^\w/, c => c.toUpperCase());

/** Active duty pool used when the match doesn't say. Data, not code: update when Valve rotates maps. */
export const DEFAULT_POOL = ['de_mirage', 'de_ancient', 'de_nuke', 'de_anubis', 'de_inferno', 'de_dust2', 'de_train'];

export const THREAT_WEIGHTS = { elo: 0.35, kd: 0.35, form: 0.15, map: 0.15 } as const;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

export interface SteamInfo { summary?: SteamSummary; bans?: SteamBans; minutes?: number }

export function buildPlayer(o: {
  side: 'us' | 'them';
  roster: FaceitRosterEntry;
  player?: FaceitPlayer;
  stats?: FaceitPlayerStats;
  steam?: SteamInfo;
  room?: ScoutPlayer['room'];
  now?: number;
}): ScoutPlayer {
  const g = o.player?.games?.cs2;
  const life = o.stats?.lifetime;
  const maps: ScoutPlayer['maps'] = {};
  for (const seg of o.stats?.segments ?? []) {
    if (seg.type && seg.type !== 'Map') continue;
    if (seg.mode && seg.mode !== '5v5') continue;
    const matches = num(seg.stats, 'Matches');
    const winRate = num(seg.stats, 'Win Rate %');
    if (matches === undefined || winRate === undefined) continue;
    const kd = num(seg.stats, 'Average K/D Ratio', 'K/D Ratio');
    maps[mapId(seg.label)] = { matches, winRate, ...(kd !== undefined ? { kd } : {}) };
  }
  const steamid = g?.game_player_id ?? o.roster.game_player_id ?? o.player?.steam_id_64;
  const p: ScoutPlayer = {
    id: o.roster.player_id,
    ...(steamid ? { steamid } : {}),
    nickname: o.player?.nickname ?? o.roster.nickname,
    ...(o.player?.country ? { country: o.player.country } : {}),
    side: o.side,
    ...(g?.skill_level ?? o.roster.game_skill_level ? { level: g?.skill_level ?? o.roster.game_skill_level } : {}),
    ...(g?.faceit_elo ? { elo: g.faceit_elo } : {}),
    ...(o.room ? { room: o.room } : {}),
    stats: compact({
      matches: num(life, 'Matches'), winRate: num(life, 'Win Rate %'), kd: num(life, 'Average K/D Ratio', 'K/D Ratio'),
      hs: num(life, 'Average Headshots %', 'Total Headshots %'), adr: num(life, 'ADR', 'Average ADR'), recent: recentResults(life),
    }),
    maps,
    flags: [],
  };
  const role = roleOf(o.stats);
  if (role) p.role = { label: role, source: 'stats' };
  if (o.steam) {
    const now = o.now ?? Date.now();
    const s = o.steam;
    p.steam = compact({
      accountAgeYears: s.summary?.timecreated ? round((now / 1000 - s.summary.timecreated) / (365.25 * 86_400), 1) : undefined,
      cs2Hours: s.minutes !== undefined ? Math.round(s.minutes / 60) : undefined,
      vacBans: s.bans?.NumberOfVACBans, gameBans: s.bans?.NumberOfGameBans,
      daysSinceLastBan: s.bans && ((s.bans.NumberOfVACBans ?? 0) + (s.bans.NumberOfGameBans ?? 0)) > 0 ? s.bans.DaysSinceLastBan : undefined,
      private: s.summary ? s.summary.communityvisibilitystate !== 3 : undefined,
    });
    p.flags = flagsOf(p);
  }
  return p;
}

function compact<T extends Record<string, unknown>>(o: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as never;
}

/** Only when FACEIT exposes the rates (to verify against real responses once keys exist). */
export function roleOf(stats?: FaceitPlayerStats): string | undefined {
  const sniper = num(stats?.lifetime, 'Sniper Kill Rate');
  const entry = num(stats?.lifetime, 'Entry Rate');
  if (sniper !== undefined && sniper >= 0.25) return 'AWP';
  if (entry !== undefined && entry >= 0.22) return 'Entry';
  return undefined;
}

export function flagsOf(p: ScoutPlayer): string[] {
  const f: string[] = [];
  const s = p.steam;
  if (!s) return f;
  if (s.vacBans || s.gameBans) {
    const what = s.vacBans ? `VAC ban${s.vacBans > 1 ? 's' : ''}` : 'game ban';
    const ago = s.daysSinceLastBan !== undefined ? (s.daysSinceLastBan >= 365 ? `${round(s.daysSinceLastBan / 365, 1)} years ago` : `${s.daysSinceLastBan} days ago`) : '';
    f.push(`${what} on record${ago ? `, last ${ago}` : ''}`);
  }
  if (s.accountAgeYears !== undefined && s.accountAgeYears < 1) f.push(`Steam account ${Math.max(1, Math.round(s.accountAgeYears * 12))} months old`);
  if (s.cs2Hours !== undefined && s.cs2Hours < 800 && (p.elo ?? 0) >= 2000) f.push(`only ${s.cs2Hours} h in CS2 for ${p.elo} ELO`);
  if (s.private) f.push('private Steam profile');
  return f;
}

export function threatOf(p: ScoutPlayer, map?: string): { score: number; parts: ThreatPart[] } {
  const parts: ThreatPart[] = [];
  const add = (label: string, value: number | undefined, weight: number) => { if (value !== undefined) parts.push({ label, value: round(clamp01(value)), weight }); };
  add('ELO', p.elo !== undefined ? (p.elo - 1000) / 2000 : undefined, THREAT_WEIGHTS.elo);
  add('K/D', p.stats.kd !== undefined ? (p.stats.kd - 0.7) / 0.8 : undefined, THREAT_WEIGHTS.kd);
  const recent = p.stats.recent;
  add('Form (last 5)', recent?.length ? recent.filter(r => r === 'W').length / recent.length : undefined, THREAT_WEIGHTS.form);
  const mm = map ? p.maps[map] : undefined;
  add(map ? `${mapName(map)} K/D` : 'Map', mm?.kd !== undefined && mm.matches >= 10 ? (mm.kd - 0.7) / 0.8 : undefined, THREAT_WEIGHTS.map);
  const w = parts.reduce((a, x) => a + x.weight, 0);
  const score = w ? Math.round((parts.reduce((a, x) => a + x.value * x.weight, 0) / w) * 100) : 0;
  return { score, parts };
}

export function keyStatOf(p: ScoutPlayer, map?: string): string | undefined {
  const mm = map ? p.maps[map] : undefined;
  if (mm?.kd !== undefined && mm.matches >= 20 && mm.kd >= 1.2) return `${mm.kd.toFixed(2)} K/D on ${mapName(map!)}`;
  if (p.stats.hs !== undefined && p.stats.hs >= 55) return `${Math.round(p.stats.hs)}% headshots`;
  if (p.stats.adr !== undefined && p.stats.adr >= 88) return `${Math.round(p.stats.adr)} ADR`;
  if (mm && mm.matches >= 20 && mm.winRate >= 60) return `${Math.round(mm.winRate)}% wins on ${mapName(map!)}`;
  if (p.stats.kd !== undefined) return `${p.stats.kd.toFixed(2)} K/D`;
  return undefined;
}

/**
 * Premade groups from recent history: two players who shared at least `minShared` of their last
 * matches on the same team queued together. Groups get labels A, B, …
 */
export function parties(ids: readonly string[], histories: Readonly<Record<string, FaceitHistoryItem[] | undefined>>, minShared = 5): Record<string, string> {
  const parent = new Map(ids.map(i => [i, i]));
  const find = (x: string): string => { const p = parent.get(x)!; if (p === x) return x; const r = find(p); parent.set(x, r); return r; };
  const teamOf = (h: FaceitHistoryItem, id: string) => Object.entries(h.teams ?? {}).find(([, t]) => t.players?.some(p => p.player_id === id))?.[0];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i]!, b = ids[j]!;
      const hb = new Map((histories[b] ?? []).map(h => [h.match_id, h]));
      let shared = 0;
      for (const h of histories[a] ?? []) {
        const o = hb.get(h.match_id);
        if (o && teamOf(h, a) !== undefined && teamOf(h, a) === teamOf(o, b)) shared++;
      }
      if (shared >= minShared) parent.set(find(a), find(b));
    }
  }
  const groups = new Map<string, string[]>();
  for (const id of ids) { const r = find(id); groups.set(r, [...(groups.get(r) ?? []), id]); }
  const out: Record<string, string> = {};
  let label = 0;
  for (const g of [...groups.values()].filter(g => g.length > 1).sort((x, y) => y.length - x.length)) {
    const name = String.fromCharCode(65 + label++);
    for (const id of g) out[id] = name;
  }
  return out;
}

export function teamOf(name: string, players: ScoutPlayer[]): ScoutTeam {
  const elos = players.map(p => p.elo).filter((e): e is number => e !== undefined);
  return { name, players, ...(elos.length ? { avgElo: Math.round(elos.reduce((a, b) => a + b, 0) / elos.length) } : {}) };
}

/** Matches-weighted team win rate per map, and the veto advice. */
export function mapRows(us: ScoutTeam, them: ScoutTeam, pool = DEFAULT_POOL, minMatches = 25): ScoutMapRow[] {
  const agg = (t: ScoutTeam, map: string) => {
    let n = 0, w = 0;
    for (const p of t.players) { const m = p.maps[map]; if (m) { n += m.matches; w += m.matches * m.winRate; } }
    return { matches: n, winRate: n ? Math.round(w / n) : 0 };
  };
  const rows: ScoutMapRow[] = pool.map(map => {
    const a = agg(us, map), b = agg(them, map);
    return { map, us: a, them: b, edge: a.matches && b.matches ? a.winRate - b.winRate : 0 };
  });
  // Veto advice (FACEIT BO1: alternate bans until one map is left).
  const known = rows.filter(r => r.us.matches >= minMatches && r.them.matches >= minMatches);
  const worst = [...known].sort((x, y) => x.edge - y.edge).slice(0, 2);
  // They play few games on a map they always ban: low data on their side is their ban signal.
  const theirBans = [...rows].filter(r => !worst.includes(r)).sort((x, y) => x.them.matches - y.them.matches).slice(0, 2);
  for (const r of worst) r.action = 'ban';
  for (const r of theirBans) if (!r.action) r.action = 'their-ban';
  const rest = rows.filter(r => !r.action).sort((x, y) => y.edge - x.edge);
  if (rest[0]) rest[0].action = 'pick';
  for (const r of rows) r.action ??= 'neutral';
  return rows;
}

/** FACEIT's own estimate when the match has one; otherwise ELO, nudged by the map edge. */
export function winChance(us: ScoutTeam, them: ScoutTeam, faceitProbability?: number, map?: ScoutMapRow): ScoutView['winChance'] {
  const edge = map && map.us.matches && map.them.matches ? Math.max(-0.08, Math.min(0.08, map.edge / 100 / 2)) : 0;
  const mapNote = map && edge ? ` · ${mapName(map.map)} edge ${map.edge > 0 ? '+' : ''}${map.edge}` : '';
  if (faceitProbability !== undefined) {
    return { value: round(clamp01(faceitProbability + edge)), basis: `FACEIT's estimate ${Math.round(faceitProbability * 100)}%${mapNote}` };
  }
  if (us.avgElo === undefined || them.avgElo === undefined) return undefined;
  const p = 1 / (1 + 10 ** ((them.avgElo - us.avgElo) / 400));
  return { value: round(clamp01(p + edge)), basis: `ELO ${us.avgElo.toLocaleString('en-US')} vs ${them.avgElo.toLocaleString('en-US')}${mapNote}` };
}

/** "3 things to know", from data only. */
export function factsOf(v: Pick<ScoutView, 'them' | 'maps' | 'map'>): string[] {
  const out: string[] = [];
  const top = [...v.them.players].sort((a, b) => (b.threat?.score ?? 0) - (a.threat?.score ?? 0))[0];
  if (top) {
    const bits = [top.role?.label, top.elo ? `${top.elo.toLocaleString('en-US')} ELO` : undefined].filter(Boolean).join(' · ');
    out.push(`${top.nickname}${bits ? ` (${bits})` : ''} is their biggest threat${top.keyStat ? `: ${top.keyStat}` : ''}.`);
  }
  const ban = v.maps.filter(r => r.action === 'ban').sort((a, b) => a.edge - b.edge)[0];
  const here = v.map ? v.maps.find(r => r.map === v.map) : undefined;
  if (here && here.us.matches && here.them.matches) {
    out.push(`${mapName(here.map)}: you win ${here.us.winRate}%, they win ${here.them.winRate}% (${here.edge >= 0 ? 'edge to you' : 'edge to them'}).`);
  } else if (ban) {
    out.push(`Ban ${mapName(ban.map)}: they win ${ban.them.winRate}% there, you ${ban.us.winRate}%.`);
  }
  const groups = new Map<string, string[]>();
  for (const p of v.them.players) if (p.party) groups.set(p.party, [...(groups.get(p.party) ?? []), p.nickname]);
  const biggest = [...groups.values()].sort((a, b) => b.length - a.length)[0];
  const flagged = v.them.players.find(p => p.flags.length);
  if (biggest && biggest.length >= 2) out.push(`${listNames(biggest)} queue together: expect practiced trades and set plays.`);
  else if (flagged) out.push(`${flagged.nickname}: ${flagged.flags[0]}.`);
  return out.slice(0, 3);
}

const listNames = (n: string[]) => (n.length <= 2 ? n.join(' and ') : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`);
