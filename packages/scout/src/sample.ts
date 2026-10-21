// A fictional FACEIT match (the prototype's squad vs team_kappa), as FACEIT and Steam would return
// it. Lets csbot scout with no API keys: demo mode, tests, and the desktop app until keys are added.
// All names, ids and numbers are made up.

import type { FaceitApi, FaceitHistoryItem, FaceitMatch, FaceitPlayer, FaceitPlayerStats } from './faceit.ts';
import type { SteamApi, SteamBans, SteamSummary } from './steam.ts';

export const SAMPLE_MATCH_ID = '1-00000000-0000-4000-8000-000000000001';
export const SAMPLE_POOL = ['de_mirage', 'de_ancient', 'de_nuke', 'de_anubis', 'de_inferno', 'de_dust2', 'de_train'] as const;
const LABEL: Record<string, string> = { de_mirage: 'Mirage', de_ancient: 'Ancient', de_nuke: 'Nuke', de_anubis: 'Anubis', de_inferno: 'Inferno', de_dust2: 'Dust2', de_train: 'Train' };

type MapLine = [matches: number, winRate: number, kd: number];
interface SamplePlayer {
  nick: string; side: 'us' | 'them'; level: number; elo: number; kd: number; adr: number; hs: number; wr: number; n: number;
  sniper: number; entry: number; recent: string; maps: Record<string, MapLine>;
  steam: { years: number; hours?: number; vac?: [bans: number, days: number]; private?: boolean };
}

// Map order in each tuple list: mirage, ancient, nuke, anubis, inferno, dust2, train.
const m = (...rows: MapLine[]): Record<string, MapLine> => Object.fromEntries(SAMPLE_POOL.map((id, i) => [id, rows[i]!]));

const PLAYERS: SamplePlayer[] = [
  // team_kappa
  { nick: 'Holo', side: 'them', level: 10, elo: 2640, kd: 1.41, adr: 92, hs: 38, wr: 63, n: 912, sniper: 0.38, entry: 0.12, recent: 'WWLWW',
    maps: m([120, 61, 1.46], [140, 70, 1.52], [18, 39, 1.1], [20, 45, 1.2], [95, 57, 1.33], [40, 55, 1.3], [4, 50, 1.2]), steam: { years: 9, hours: 4120 } },
  { nick: 'sk1p', side: 'them', level: 9, elo: 1980, kd: 1.17, adr: 84, hs: 57, wr: 54, n: 1203, sniper: 0.03, entry: 0.31, recent: 'LWWLW',
    maps: m([160, 53, 1.19], [90, 66, 1.1], [10, 40, 1.0], [25, 44, 1.1], [70, 50, 1.12], [150, 59, 1.25], [6, 33, 1.0]), steam: { years: 0.4, hours: 610 } },
  { nick: 'vex', side: 'them', level: 10, elo: 2310, kd: 1.08, adr: 79, hs: 44, wr: 58, n: 1874, sniper: 0.04, entry: 0.14, recent: 'WWLWW',
    maps: m([210, 58, 1.1], [190, 66, 1.12], [15, 33, 0.9], [14, 43, 1.0], [160, 55, 1.04], [60, 53, 1.05], [10, 50, 1.0]), steam: { years: 11, hours: 6890 } },
  { nick: 'Drift', side: 'them', level: 8, elo: 1720, kd: 0.97, adr: 71, hs: 41, wr: 51, n: 640, sniper: 0.02, entry: 0.09, recent: 'LWLWW',
    maps: m([90, 50, 0.95], [60, 68, 1.0], [8, 38, 0.9], [12, 42, 0.95], [40, 48, 0.9], [30, 53, 0.97], [3, 33, 0.8]), steam: { years: 6, private: true } },
  { nick: 'Okami', side: 'them', level: 9, elo: 1890, kd: 0.94, adr: 68, hs: 36, wr: 55, n: 1510, sniper: 0.05, entry: 0.1, recent: 'WWWLW',
    maps: m([170, 56, 0.92], [150, 67, 0.99], [14, 43, 0.88], [10, 50, 0.9], [80, 52, 0.9], [50, 56, 0.95], [5, 40, 0.9]), steam: { years: 7, hours: 3310, vac: [1, 912] } },
  // our squad
  { nick: 'kairo', side: 'us', level: 10, elo: 2210, kd: 1.21, adr: 88, hs: 58, wr: 57, n: 1490, sniper: 0.04, entry: 0.28, recent: 'WWLWW',
    maps: m([200, 62, 1.25], [60, 47, 1.1], [50, 50, 1.2], [45, 53, 1.2], [90, 56, 1.2], [70, 58, 1.2], [15, 40, 1.1]), steam: { years: 8, hours: 3900 } },
  { nick: 'zeph', side: 'us', level: 10, elo: 2100, kd: 1.15, adr: 80, hs: 33, wr: 54, n: 1105, sniper: 0.33, entry: 0.1, recent: 'WLWWL',
    maps: m([150, 60, 1.2], [50, 46, 1.1], [40, 48, 1.1], [35, 51, 1.15], [80, 55, 1.1], [60, 57, 1.1], [10, 45, 1.0]), steam: { years: 5, hours: 2750 } },
  { nick: 'rdx', side: 'us', level: 9, elo: 2050, kd: 1.12, adr: 83, hs: 49, wr: 56, n: 1320, sniper: 0.06, entry: 0.16, recent: 'WLWWL',
    maps: m([180, 61, 1.15], [55, 48, 1.05], [45, 50, 1.1], [40, 52, 1.1], [85, 55, 1.1], [65, 58, 1.1], [12, 42, 1.0]), steam: { years: 10, hours: 5100 } },
  { nick: 'nyx', side: 'us', level: 9, elo: 1940, kd: 1.03, adr: 76, hs: 45, wr: 55, n: 980, sniper: 0.03, entry: 0.11, recent: 'LWLWW',
    maps: m([140, 60, 1.05], [40, 47, 1.0], [35, 49, 1.0], [30, 52, 1.0], [70, 54, 1.0], [50, 59, 1.05], [8, 38, 0.9]), steam: { years: 4, hours: 2200 } },
  { nick: 'mbt', side: 'us', level: 9, elo: 1870, kd: 0.95, adr: 70, hs: 41, wr: 58, n: 1650, sniper: 0.02, entry: 0.08, recent: 'WWWLW',
    maps: m([190, 62, 0.98], [45, 46, 0.9], [50, 49, 0.95], [40, 53, 0.95], [95, 55, 0.95], [70, 58, 0.97], [14, 43, 0.9]), steam: { years: 12, hours: 7400 } },
];

/** Room status of our squad in the sample: rdx hosts, zeph is a random teammate. */
export const SAMPLE_ROOM: Record<string, 'admin' | 'member' | 'random'> = { rdx: 'admin', kairo: 'member', nyx: 'member', mbt: 'member', zeph: 'random' };

const pid = (nick: string) => `sample-${nick.toLowerCase()}`;
const steamid = (i: number) => `765611980000001${String(i).padStart(2, '0')}`;
const NOW = Date.UTC(2026, 9, 21, 20, 0, 0);

function faceitPlayer(p: SamplePlayer, i: number): FaceitPlayer {
  return {
    player_id: pid(p.nick), nickname: p.nick, country: ['fr', 'de', 'se', 'pl', 'dk'][i % 5],
    steam_id_64: steamid(i), games: { cs2: { faceit_elo: p.elo, skill_level: p.level, game_player_id: steamid(i), game_player_name: p.nick, region: 'EU' } },
  };
}

function faceitStats(p: SamplePlayer): FaceitPlayerStats {
  const pct = (x: number) => String(Math.round(x));
  return {
    player_id: pid(p.nick), game_id: 'cs2',
    lifetime: {
      Matches: String(p.n), Wins: String(Math.round(p.n * p.wr / 100)), 'Win Rate %': pct(p.wr), 'Average K/D Ratio': p.kd.toFixed(2),
      'Average Headshots %': pct(p.hs), ADR: String(p.adr), 'Sniper Kill Rate': p.sniper.toFixed(2), 'Entry Rate': p.entry.toFixed(2),
      // FACEIT lists recent results oldest first.
      'Recent Results': [...p.recent].reverse().map(c => (c === 'W' ? '1' : '0')),
    },
    segments: Object.entries(p.maps).map(([id, [n, wr, kd]]) => ({
      label: LABEL[id]!, mode: '5v5', type: 'Map',
      stats: { Matches: String(n), Wins: String(Math.round(n * wr / 100)), 'Win Rate %': pct(wr), 'Average K/D Ratio': kd.toFixed(2) },
    })),
  };
}

/** Recent matches: party A (Holo, vex, Okami) and party B (sk1p, Drift) queue together. */
function history(p: SamplePlayer): FaceitHistoryItem[] {
  const partyA = ['Holo', 'vex', 'Okami'], partyB = ['sk1p', 'Drift'];
  const party = partyA.includes(p.nick) ? partyA : partyB.includes(p.nick) ? partyB : [p.nick];
  return Array.from({ length: 20 }, (_, k) => {
    const together = party.length > 1 && k % 5 !== 4; // 16 of 20 with the party
    const mates = together ? party : [p.nick];
    const id = together ? `sample-h-${party.join('')}-${k}` : `sample-h-${p.nick}-${k}`;
    return {
      match_id: id, started_at: NOW / 1000 - (k + 1) * 86_400, finished_at: NOW / 1000 - (k + 1) * 86_400 + 2400, status: 'FINISHED', game_mode: '5v5',
      playing_players: mates.map(pid),
      teams: { faction1: { players: mates.map(n => ({ player_id: pid(n), nickname: n })) }, faction2: { players: [] } },
      results: { winner: k % 3 ? 'faction1' : 'faction2' },
    };
  });
}

export function sampleMatch(): FaceitMatch {
  const roster = (side: 'us' | 'them') => PLAYERS.map((p, i) => ({ p, i })).filter(x => x.p.side === side)
    .map(({ p, i }) => ({ player_id: pid(p.nick), nickname: p.nick, game_player_id: steamid(i), game_skill_level: p.level }));
  return {
    match_id: SAMPLE_MATCH_ID, game: 'cs2', status: 'ONGOING', competition_name: '5v5 RANKED',
    faceit_url: `https://www.faceit.com/{lang}/cs2/room/${SAMPLE_MATCH_ID}`,
    teams: {
      faction1: { faction_id: 'sample-f1', name: 'team_rdx', leader: pid('rdx'), roster: roster('us'), stats: { winProbability: 0.45, skillLevel: { average: 9 } } },
      faction2: { faction_id: 'sample-f2', name: 'team_kappa', leader: pid('vex'), roster: roster('them'), stats: { winProbability: 0.55, skillLevel: { average: 9 } } },
    },
    voting: { map: { pick: ['de_mirage'] } },
    started_at: NOW / 1000,
  };
}

const byId = new Map(PLAYERS.map((p, i) => [pid(p.nick), { p, i }]));
const bySteam = new Map(PLAYERS.map((p, i) => [steamid(i), { p, i }]));
const missing = (what: string) => Object.assign(new Error(`sample: no ${what}`), { status: 404 });

export function sampleFaceit(): FaceitApi {
  return {
    match: async id => { if (id !== SAMPLE_MATCH_ID) throw missing(`match ${id}`); return sampleMatch(); },
    player: async id => { const x = byId.get(id); if (!x) throw missing(`player ${id}`); return faceitPlayer(x.p, x.i); },
    playerBySteamId: async sid => { const x = bySteam.get(sid); if (!x) throw missing(`steam ${sid}`); return faceitPlayer(x.p, x.i); },
    stats: async id => { const x = byId.get(id); if (!x) throw missing(`stats ${id}`); return faceitStats(x.p); },
    history: async (id, limit = 20) => { const x = byId.get(id); if (!x) throw missing(`history ${id}`); return { items: history(x.p).slice(0, limit) }; },
  };
}

export function sampleSteam(): SteamApi {
  const year = 365.25 * 86_400;
  return {
    summaries: async ids => ids.flatMap(id => {
      const x = bySteam.get(id);
      return x ? [{ steamid: id, personaname: x.p.nick, communityvisibilitystate: x.p.steam.private ? 1 : 3, timecreated: Math.round(NOW / 1000 - x.p.steam.years * year) } satisfies SteamSummary] : [];
    }),
    bans: async ids => ids.flatMap(id => {
      const x = bySteam.get(id);
      return x ? [{ SteamId: id, VACBanned: !!x.p.steam.vac, NumberOfVACBans: x.p.steam.vac?.[0] ?? 0, DaysSinceLastBan: x.p.steam.vac?.[1] ?? 0, NumberOfGameBans: 0 } satisfies SteamBans] : [];
    }),
    cs2Minutes: async id => { const x = bySteam.get(id); return x && !x.p.steam.private ? (x.p.steam.hours ?? 0) * 60 : undefined; },
  };
}

/** Steam ID of a sample player (tests and the demo use it to say which one is "us"). */
export const sampleSteamId = (nick: string) => { const i = PLAYERS.findIndex(p => p.nick === nick); return i >= 0 ? steamid(i) : undefined; };

/** "You" in the sample: rdx, the host. */
export const SAMPLE_ME = sampleSteamId('rdx')!;

/**
 * A real Claude Code (opus, high effort) report on the sample match, recorded 2026-10-21 in 16.9 s.
 * The demo shows it so the Scout page looks like the real thing without spending anyone's plan.
 */
export const SAMPLE_REPORT = {
  status: 'ready' as const, model: 'opus', ms: 16_939, at: Date.UTC(2026, 9, 21, 17, 40),
  summary: 'team_kappa averages 2,108 ELO to our 2,034. Holo, their likely AWP at 2,640, leads them. Win chance is 48%, a coin flip. Mirage favours us: we win 61%, they win 56%.',
  things: [
    'Holo is their biggest threat: likely AWP, 2,640 ELO, 1.46 K/D on Mirage.',
    'Holo, vex and Okami queue together. Expect practised trades and set plays.',
    'On Mirage we win 61% and they win 56%. Our whole roster is 60%+ there.',
  ],
  plan: [
    'Never dry-peek Holo. Smoke or flash his angles, or trade him in pairs.',
    'Stay close together for trades against the Holo-vex-Okami three-stack.',
    'Lean on kairo, 1.25 K/D on Mirage, to open rounds, with quick refrags.',
  ],
  veto: "Ban Ancient (they win 67%, we win 47%) and Train, then pick Mirage. They'll likely ban Nuke and Anubis.",
  tips: {
    Holo: 'Likely AWP, 1.46 K/D on Mirage. Use utility before peeking him and always trade.',
    vex: '2,310 ELO with 210 Mirage games. Queues with Holo, so expect him to trade.',
    sk1p: 'Likely Entry, 57% headshots. Keep crosshairs at head height and trade his openings fast.',
    Okami: '0.92 K/D on Mirage, the weakest fragger in their three-stack. Take duels against him.',
    Drift: 'Lowest ELO at 1,720 with 0.95 K/D on Mirage. Punish him when you find him.',
  },
};
