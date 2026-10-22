// Debrief (M6): what csbot keeps from a match and what the demo adds.
//
// A MatchRecord is built on the host from its own game data (GSI) as the match runs: one entry per
// round with our buy, the enemy estimate, the forecast, the call and the intel. A DemoTruth is parsed
// from the match demo afterwards (when someone provides it): real enemy money, plant sites, deaths
// with positions. The debrief compares the two.

import type { RoundReason, Side } from './index.ts';

export type BuyKind = 'pistol' | 'eco' | 'force' | 'half' | 'full';

export interface DebriefRound {
  round: number;
  /** Our side in that round. */
  side: Side;
  winner?: 'us' | 'them';
  reason?: RoundReason;
  /** The host's own money at freeze time and what they had on them once the round went live. */
  money?: number;
  equip?: number;
  /** Our team's buy, read from the host's own equipment. */
  ourBuy?: BuyKind;
  /** The enemy money estimate at freeze time (per player). */
  enemy?: { lo: number; hi: number; read: string; buy: Readonly<Record<'eco' | 'force' | 'half' | 'full', number>> };
  /** The forecast at the end of the round: enemy T (our CT) = where they hit, enemy CT = which site was light. */
  forecast?: { enemy: 'T' | 'CT'; site: { A: number; B: number }; top: string; basis: 'prior' | 'intel' };
  /** The last call of the round. */
  call?: { head: string; kind: string; setup?: string; source: 'engine' | 'claude'; planChanged: boolean };
  /** Intel logged in the room this round. */
  intel: number;
  planted: boolean;
  /** The host player in that round (from their own GSI). */
  me?: { kills: number; damage: number; died: boolean; mvp: boolean };
}

export interface MatchRecord {
  /** `<startedAt>-<map>`, also the file name on the host. */
  id: string;
  map: string;
  mode?: string;
  startedAt: number;
  endedAt?: number;
  /** Reached the end of the match (gameover). Unfinished records are kept too (crashes, leaving). */
  finished: boolean;
  score: { us: number; them: number };
  /** Whose game data this record comes from. */
  me?: { name: string; steamid: string };
  rounds: DebriefRound[];
  /** The player's totals at the end (from GSI match stats). */
  totals?: { kills: number; assists: number; deaths: number; mvps: number };
  /** The FACEIT match, when the record could be linked to the one scouted. */
  faceitMatchId?: string;
  /** Parsed from the match demo, once provided. */
  truth?: DemoTruth;
  /** Claude's "work on next", once written. */
  workOn?: WorkOn;
}

export interface WorkOn {
  at: number;
  /** Up to three things for the team. */
  team: string[];
  /** Up to two things for the player whose record this is. */
  you: string[];
  model?: string;
}

// ---------------------------------------------------------------- demo truth

export interface DemoPlayer { steamid: string; name: string; /** Side in round 1. */ startSide: Side }

export interface DemoRound {
  round: number;
  winner: Side;
  reason?: string;
  /** Per player: money at the round start (before buying), equipment value once bought, spent. */
  players: { steamid: string; side: Side; startMoney: number; equipValue: number; spent: number }[];
  /** The site the bomb was planted at, if it was, and where (world units). */
  plantSite?: 'A' | 'B';
  plantAt?: { x: number; y: number; z: number };
  /** Every death: who, where (world units) and when (seconds since the round went live). */
  deaths: { steamid: string; side: Side; t: number; x: number; y: number; z: number; killer?: string; weapon?: string }[];
}

export interface DemoTruth {
  /** Where the truth came from. */
  source: { file: string; parsedAt: number; bytes: number };
  map: string;
  players: DemoPlayer[];
  rounds: DemoRound[];
}

// ---------------------------------------------------------------- what the page shows

export interface MatchSummary {
  id: string;
  map: string;
  startedAt: number;
  finished: boolean;
  score: { us: number; them: number };
  rating?: number;
  hasDemo: boolean;
}

export interface DebriefView {
  /** The match being reviewed (the latest by default). */
  record?: MatchRecord;
  /** Every match kept on this PC, newest first. */
  matches: MatchSummary[];
  /** Demo ingest state for the record. */
  demo?: { status: 'none' | 'parsing' | 'ready' | 'error'; detail?: string; replaysDir?: string };
  /** The record has a 2D replay on this PC (from its demo). */
  replay?: boolean;
}

export const EMPTY_DEBRIEF: DebriefView = { matches: [] };

// ---------------------------------------------------------------- 2D replay (from the demo)

/** One round's movement, sampled `hz` times a second from freeze end until a few seconds after it ends. */
export interface ReplayRound {
  round: number;
  hz: number;
  /** Seconds of play covered (frames = duration × hz + 1). */
  duration: number;
  players: { steamid: string; name: string; side: import('./index.ts').Side }[];
  /**
   * One entry per frame: per player (in `players` order) x, y, z (world units, rounded) and hp (0 = dead),
   * flattened: [x0, y0, z0, hp0, x1, y1, z1, hp1, …].
   */
  frames: number[][];
  /** Grenades as they went off: t (seconds since freeze end), kind, where, and how long the effect lasts. */
  nades: { t: number; kind: 'smoke' | 'molotov' | 'flash' | 'he' | 'decoy'; x: number; y: number; z: number; duration?: number }[];
  /** Kills and the plant, for the timeline. */
  kills: { t: number; victim: string; killer?: string; weapon?: string }[];
  plant?: { t: number; site?: 'A' | 'B'; x: number; y: number; z: number };
}

export interface DemoReplay {
  map: string;
  rounds: ReplayRound[];
}
