// Steam Web API (https://api.steampowered.com), public profile data only.

import { cached, TTL, type CacheStore } from './cache.ts';
import { getJson, type FetchLike } from './http.ts';

export interface SteamSummary {
  steamid: string;
  personaname?: string;
  /** 3 = public. */
  communityvisibilitystate?: number;
  timecreated?: number;
  loccountrycode?: string;
}
export interface SteamBans {
  SteamId: string;
  VACBanned?: boolean;
  NumberOfVACBans?: number;
  DaysSinceLastBan?: number;
  NumberOfGameBans?: number;
}
export interface SteamPlaytime { appid: number; playtime_forever?: number }

export interface SteamApi {
  summaries(ids: string[]): Promise<SteamSummary[]>;
  bans(ids: string[]): Promise<SteamBans[]>;
  /** Minutes played in CS2, or undefined when the profile hides it. */
  cs2Minutes(id: string): Promise<number | undefined>;
  /** Cheapest authenticated call: throws ApiError (kind 'auth') for a bad key. */
  ping?(): Promise<void>;
}

export const CS2_APP_ID = 730;

export interface SteamClientOptions { apiKey: string; fetch?: FetchLike; cache?: CacheStore; retryDelayMs?: number }

export function steamClient(o: SteamClientOptions): SteamApi {
  const base = 'https://api.steampowered.com';
  const get = <T>(path: string) => getJson<T>(`${base}${path}${path.includes('?') ? '&' : '?'}key=${encodeURIComponent(o.apiKey)}`, {
    service: 'Steam', ...(o.fetch ? { fetch: o.fetch } : {}), ...(o.retryDelayMs !== undefined ? { retryDelayMs: o.retryDelayMs } : {}),
  });
  const ids = (a: string[]) => [...new Set(a)].slice(0, 100).join(',');
  return {
    summaries: list => cached(o.cache, `steam:sum:${ids(list)}`, TTL.steam, async () =>
      (await get<{ response: { players: SteamSummary[] } }>(`/ISteamUser/GetPlayerSummaries/v2/?steamids=${ids(list)}`)).response.players ?? []),
    bans: list => cached(o.cache, `steam:bans:${ids(list)}`, TTL.steam, async () =>
      (await get<{ players: SteamBans[] }>(`/ISteamUser/GetPlayerBans/v1/?steamids=${ids(list)}`)).players ?? []),
    cs2Minutes: id => cached(o.cache, `steam:cs2:${id}`, TTL.steam, async () => {
      const r = await get<{ response: { games?: SteamPlaytime[] } }>(`/IPlayerService/GetOwnedGames/v1/?steamid=${id}&include_played_free_games=1&appids_filter%5B0%5D=${CS2_APP_ID}`);
      return r.response.games?.find(g => g.appid === CS2_APP_ID)?.playtime_forever;
    }),
    // Lists the interfaces this key can use; 403 for a bad key.
    ping: async () => { await get<unknown>('/ISteamWebAPIUtil/GetSupportedAPIList/v1/'); },
  };
}
