// Pre-match scouting: what the Scout page renders and what the host sends to room members.
// Every number comes from FACEIT / Steam data (or a labeled sample); the AI report only adds words.

export type DataSourceState = 'live' | 'sample' | 'missing-key' | 'error' | 'off';

export interface ThreatPart { label: string; value: number; weight: number }

export interface ScoutPlayer {
  /** FACEIT player id (or Steam ID when not on FACEIT). */
  id: string;
  steamid?: string;
  nickname: string;
  country?: string;
  side: 'us' | 'them';
  level?: number;
  elo?: number;
  /** Our side only: in the room (member/admin) or a random teammate. */
  room?: 'admin' | 'member' | 'random';
  /** Premade group label (A, B…) when two or more players queued together. */
  party?: string;
  stats: {
    matches?: number;
    winRate?: number;
    kd?: number;
    hs?: number;
    adr?: number;
    /** Most recent first. */
    recent?: ('W' | 'L')[];
  };
  /** Per map (de_mirage…): FACEIT segment stats. */
  maps: Record<string, { matches: number; winRate: number; kd?: number }>;
  steam?: { accountAgeYears?: number; cs2Hours?: number; vacBans?: number; gameBans?: number; daysSinceLastBan?: number; private?: boolean };
  threat?: { score: number; parts: ThreatPart[] };
  /** One standout number, e.g. "1.46 K/D on Mirage". */
  keyStat?: string;
  /** Role guess and where it came from. Demos (M4) replace stats-based guesses. */
  role?: { label: string; source: 'stats' | 'demos' | 'ai' };
  /** Short warnings: "VAC ban 2 years ago", "account 3 months old". */
  flags: string[];
  /** "How to play him" from the AI report. */
  tip?: string;
}

export interface ScoutTeam {
  name: string;
  avgElo?: number;
  players: ScoutPlayer[];
}

export interface ScoutMapRow {
  map: string;
  them: { matches: number; winRate: number };
  us: { matches: number; winRate: number };
  /** Our win rate minus theirs, in points. Positive favors us. */
  edge: number;
  /** Suggested veto action. */
  action?: 'ban' | 'pick' | 'their-ban' | 'their-pick' | 'decider' | 'neutral';
}

export interface ScoutReport {
  status: 'idle' | 'running' | 'ready' | 'error' | 'off';
  model?: string;
  ms?: number;
  at?: number;
  error?: string;
  summary?: string;
  /** "3 things to know", AI-worded. */
  things?: string[];
  /** Our plan in 2-4 short points. */
  plan?: string[];
  veto?: string;
  /** Per enemy nickname: "how to play him". */
  tips?: Record<string, string>;
}

/** One of the host's recent FACEIT matches (from their history). */
export interface RecentMatch {
  id: string;
  startedAt?: number;
  /** FACEIT status: FINISHED, ONGOING, READY, VOTING, CONFIGURING, CANCELLED… */
  status: string;
  /** Not finished or cancelled yet: worth scouting now. */
  live: boolean;
  won?: boolean;
  /** Opposing team's name. */
  vs?: string;
}

export interface ScoutView {
  v: 1;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error?: string;
  platform: 'faceit' | 'premier' | 'sample' | 'unknown';
  matchId?: string;
  matchUrl?: string;
  /** Picked or current map, when known. */
  map?: string;
  fetchedAt?: number;
  us: ScoutTeam;
  them: ScoutTeam;
  winChance?: { value: number; basis: string };
  maps: ScoutMapRow[];
  /** "3 things to know", engine-derived (always present, AI wording optional). */
  facts: string[];
  report: ScoutReport;
  sources: { faceit: DataSourceState; steam: DataSourceState; claude: DataSourceState };
  /**
   * How csbot knows which team is ours: the host's Steam ID from CS2, the FACEIT account saved in Settings,
   * room members found on a roster, a guess (none of those matched: first team), or the host swapped it.
   */
  sideBy?: 'steam' | 'account' | 'room' | 'guess' | 'manual';
  /** The host's own FACEIT account (set by nickname in Settings). */
  account?: { nickname: string; status: 'ok' | 'not-found' | 'error'; level?: number; elo?: number; error?: string };
  /** The host's recent matches, newest first. A live one gets scouted automatically. */
  recent?: RecentMatch[];
}

export const EMPTY_SCOUT: ScoutView = {
  v: 1, status: 'idle', platform: 'unknown',
  us: { name: 'Your team', players: [] }, them: { name: 'Opponents', players: [] },
  maps: [], facts: [], report: { status: 'idle' },
  sources: { faceit: 'off', steam: 'off', claude: 'off' },
};
