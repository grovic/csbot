// FACEIT Data API v4 (https://open.faceit.com/data/v4), the parts csbot reads.
// Types follow the published swagger; stat blocks are free-form string maps, read defensively.

import { cached, TTL, type CacheStore } from './cache.ts';
import { getJson, type FetchLike } from './http.ts';

export interface FaceitGameDetail { faceit_elo?: number; skill_level?: number; game_player_id?: string; game_player_name?: string; region?: string }
export interface FaceitPlayer {
  player_id: string;
  nickname: string;
  country?: string;
  steam_id_64?: string;
  games?: Record<string, FaceitGameDetail>;
  activated_at?: string;
}
export type StatBlock = Record<string, string | number | string[] | undefined>;
export interface FaceitPlayerStats {
  player_id: string;
  game_id: string;
  lifetime: StatBlock;
  segments: { label: string; mode?: string; type?: string; stats: StatBlock }[];
}
export interface FaceitRosterEntry { player_id: string; nickname: string; game_player_id?: string; game_skill_level?: number }
export interface FaceitFaction {
  faction_id?: string;
  name?: string;
  leader?: string;
  roster: FaceitRosterEntry[];
  stats?: { rating?: number; skillLevel?: { average?: number }; winProbability?: number };
}
export interface FaceitMatch {
  match_id: string;
  game?: string;
  status?: string;
  competition_name?: string;
  faceit_url?: string;
  teams: Record<string, FaceitFaction>;
  voting?: { map?: { pick?: string[] } };
  results?: { winner?: string; score?: Record<string, number> };
  started_at?: number;
  finished_at?: number;
}
export interface FaceitHistoryItem {
  match_id: string;
  started_at?: number;
  finished_at?: number;
  status?: string;
  game_mode?: string;
  playing_players?: string[];
  teams?: Record<string, { nickname?: string; players?: { player_id: string; nickname?: string }[] }>;
  results?: { winner?: string };
}
export interface FaceitHistory { items: FaceitHistoryItem[] }

/** What scouting needs from FACEIT. Real client below; the sample client implements the same thing. */
export interface FaceitApi {
  match(id: string): Promise<FaceitMatch>;
  player(id: string): Promise<FaceitPlayer>;
  playerBySteamId(steamid: string): Promise<FaceitPlayer>;
  stats(id: string): Promise<FaceitPlayerStats>;
  history(id: string, limit?: number): Promise<FaceitHistory>;
  /** Cheapest authenticated call: throws ApiError (kind 'auth') for a bad key. */
  ping?(): Promise<void>;
  /** Look a player up by FACEIT nickname (exact). */
  playerByNickname?(nickname: string): Promise<FaceitPlayer>;
}

export const FACEIT_GAME = 'cs2';

export interface FaceitClientOptions { apiKey: string; fetch?: FetchLike; cache?: CacheStore; baseUrl?: string; retryDelayMs?: number }

export function faceitClient(o: FaceitClientOptions): FaceitApi {
  const base = o.baseUrl ?? 'https://open.faceit.com/data/v4';
  const get = <T>(path: string) => getJson<T>(base + path, {
    service: 'FACEIT', headers: { authorization: `Bearer ${o.apiKey}` }, ...(o.fetch ? { fetch: o.fetch } : {}),
    ...(o.retryDelayMs !== undefined ? { retryDelayMs: o.retryDelayMs } : {}),
  });
  const enc = encodeURIComponent;
  return {
    match: async id => {
      const key = `faceit:match:${id}`;
      const hit = o.cache?.get(key);
      if (hit && hit.expires > Date.now()) return hit.value as FaceitMatch;
      const m = await get<FaceitMatch>(`/matches/${enc(id)}`);
      o.cache?.set(key, { value: m, expires: Date.now() + (m.status === 'FINISHED' ? TTL.matchDone : TTL.matchLive) });
      return m;
    },
    player: id => cached(o.cache, `faceit:player:${id}`, TTL.player, () => get<FaceitPlayer>(`/players/${enc(id)}`)),
    playerBySteamId: sid => cached(o.cache, `faceit:steam:${sid}`, TTL.player, () => get<FaceitPlayer>(`/players?game=${FACEIT_GAME}&game_player_id=${enc(sid)}`)),
    stats: id => cached(o.cache, `faceit:stats:${id}`, TTL.stats, () => get<FaceitPlayerStats>(`/players/${enc(id)}/stats/${FACEIT_GAME}`)),
    history: (id, limit = 20) => cached(o.cache, `faceit:history:${id}:${limit}`, TTL.history, () => get<FaceitHistory>(`/players/${enc(id)}/history?game=${FACEIT_GAME}&offset=0&limit=${limit}`)),
    ping: async () => { await get<unknown>('/games?offset=0&limit=1'); },
    playerByNickname: nick => cached(o.cache, `faceit:nick:${nick.toLowerCase()}`, TTL.player, () => get<FaceitPlayer>(`/players?nickname=${enc(nick)}`)),
  };
}

/** Accept a FACEIT match room link or a bare match id. */
export function parseFaceitMatch(input: string): string | undefined {
  const s = input.trim();
  const m = /(?:faceit\.com\/[a-z-]+\/cs2\/room\/|^)(1-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(s);
  return m?.[1];
}

// ------------------------------------------------------------------ stat readers

/** First present key among several spellings, as a number (FACEIT sends numbers as strings). */
export function num(b: StatBlock | undefined, ...keys: string[]): number | undefined {
  if (!b) return undefined;
  for (const k of keys) {
    const v = b[k];
    if (v === undefined || Array.isArray(v)) continue;
    const n = typeof v === 'number' ? v : Number(String(v).replace('%', '').replace(',', '.'));
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export function recentResults(b: StatBlock | undefined): ('W' | 'L')[] | undefined {
  const r = b?.['Recent Results'];
  if (!Array.isArray(r)) return undefined;
  return r.map(x => (String(x) === '1' ? 'W' : 'L')).reverse().slice(0, 5);
}

/** FACEIT segment labels ("Mirage", "Dust2", "de_mirage") → map ids. */
export function mapId(label: string): string {
  const l = label.toLowerCase().replace(/\s+/g, '');
  if (l.startsWith('de_')) return l;
  const fixes: Record<string, string> = { dustii: 'de_dust2', dust2: 'de_dust2' };
  return fixes[l] ?? `de_${l}`;
}

/** Statuses after which a match is over. Anything else (READY, VOTING, CONFIGURING, ONGOING) is live. */
const DONE = new Set(['FINISHED', 'CANCELLED', 'ABORTED']);

/** A player's history as a short list for the Scout page (newest first). */
export function recentFromHistory(playerId: string, h: FaceitHistory, limit = 6): import('@csbot/protocol').RecentMatch[] {
  return h.items.slice(0, limit).map(it => {
    const teams = Object.entries(it.teams ?? {});
    const ours = teams.find(([, t]) => t.players?.some(p => p.player_id === playerId))?.[0];
    const theirs = teams.find(([k]) => k !== ours)?.[1] as { nickname?: string } | undefined;
    const status = (it.status ?? 'FINISHED').toUpperCase();
    return {
      id: it.match_id, status, live: !DONE.has(status),
      ...(it.started_at ? { startedAt: it.started_at * 1000 } : {}),
      ...(ours && it.results?.winner ? { won: it.results.winner === ours } : {}),
      ...(theirs?.nickname ? { vs: theirs.nickname } : {}),
    };
  });
}
