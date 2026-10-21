import type { ScoutView } from './scout.ts';

// Wire types shared by the host, the desktop renderer and (from M2) room members.
// The host builds a LiveSnapshot from its GSI feed; every screen renders only from snapshots.
// Plain JSON only (no Maps, Dates or typed arrays) so it can cross IPC and the relay unchanged.

export type Side = 'CT' | 'T';
export type BuyType = 'eco' | 'force' | 'half' | 'full';
export type BuyRead = BuyType | 'pistol';
export type RoundReason = 'elimination' | 'bomb' | 'defuse' | 'time';

/** What the banner shows. `idle` = no match data yet. */
export type Phase = 'idle' | 'warmup' | 'freezetime' | 'live' | 'bomb' | 'over' | 'halftime' | 'gameover' | 'paused';

export interface PhaseClock {
  phase: Phase;
  /** Seconds left in this phase at `LiveSnapshot.at`. Absent when unknown. */
  endsIn?: number;
  /** 'gsi' = phase_countdowns from the game; 'derived' = from the phase start time and known phase lengths. */
  source?: 'gsi' | 'derived';
}

export interface RoundRecord {
  round: number;
  winner: 'us' | 'them';
  reason: RoundReason;
  /** Our side in that round. */
  ourSide?: Side;
  /** True when the reason was inferred from transitions (the game didn't send round_wins). */
  inferred?: boolean;
}

export interface MatchView {
  map: string;
  mode?: string;
  /** 1-based round being played (or just finished, during `over`). */
  round: number;
  clock: PhaseClock;
  ourSide?: Side;
  score: { us: number; them: number };
  /** Our loss-bonus level from GSI (0 = none). */
  ourLossStreak: number;
  history: RoundRecord[];
  /** Rounds per half for this mode (12 in competitive, 8 in wingman). */
  halfLength: number;
  pistolRound: boolean;
  bombPlanted: boolean;
}

export interface MeView {
  steamid: string;
  name: string;
  alive: boolean;
  health: number;
  armor: number;
  helmet: boolean;
  money: number;
  equipValue: number;
  activeWeapon?: string;
  /** Primary weapon currently owned (rifle, SMG, sniper, shotgun, MG). */
  primary?: string;
  roundKills: number;
  roundDamage: number;
  /** Set while we're dead and the game follows a teammate. */
  observing?: { steamid: string; name: string };
}

/** Enemy economy estimate. Always shown as an estimate. */
export interface EnemyView {
  lo: number;
  hi: number;
  streak: number;
  saved: boolean;
  buy: Record<BuyType, number>;
  read: BuyRead;
}

export interface ForecastView {
  /** Map model id the plan ids belong to (engine map models). */
  map: string;
  /** Prior or posterior over enemy plans. */
  plans: Record<string, number>;
  site: { A: number; B: number };
  topPlan: { id: string; name: string; p: number };
  /** Seconds since the round went live (for the heat map). */
  liveT?: number;
  /** 'prior' = from the buy read only; 'intel' = updated by logged intel (M4). */
  basis: 'prior' | 'intel';
}

export interface SetupSpot { player: string; at: readonly [number, number]; label: string }

export interface CallView {
  kind: 'pre' | 'mid' | 'post' | 'over';
  round: number;
  head: string;
  sub: string;
  /** One job per player handle. Each screen shows its own as the YOU line. */
  jobs: Record<string, string>;
  /** This screen's job, when the host knows who we are in the playbook. */
  you?: string;
  steps: string[];
  why: string[];
  setup?: string;
  source: 'engine' | 'claude';
}

export interface YouTile { label: string; value: string; sub: string }

export type RowSource = 'host' | 'room' | 'spectated';

export interface PlayerRow {
  steamid: string;
  name: string;
  money: number;
  kills: number;
  assists: number;
  deaths: number;
  mvps?: number;
  adr?: number;
  source: RowSource;
  /** Round in which a spectated row was last refreshed. */
  seenRound?: number;
  isMe?: boolean;
}

export interface TickerItem { at: number; tag: string; text: string }

export interface ConnectionView {
  /** waiting = nothing received yet; live = payload within the heartbeat window; stale = silent. */
  gsi: 'waiting' | 'live' | 'stale';
  lastPayloadAt?: number;
  payloads: number;
  /** Where payloads come from: the game, a recording being replayed, or the in-browser demo. */
  source: 'game' | 'replay' | 'demo';
  /** Spectator-only nodes the guard has dropped this session. */
  guardDropped: number;
}

export interface LiveSnapshot {
  v: 1;
  seq: number;
  /** Host clock, epoch ms. */
  at: number;
  connection: ConnectionView;
  match?: MatchView;
  me?: MeView;
  enemy?: EnemyView;
  forecast?: ForecastView;
  call?: CallView;
  setupSpots?: SetupSpot[];
  /** Our handle in the playbook/room (matches SetupSpot.player and CallView.jobs keys), when known. */
  youHandle?: string;
  youTile?: YouTile;
  /** Our team. Enemy rows come from scouting (M3). */
  scoreboard: PlayerRow[];
  /** Newest first. */
  ticker: TickerItem[];
}

/** Host-side info the desktop shell exposes to its own renderer (not sent to the room). */
export interface HostInfo {
  version: string;
  gsiUrl: string;
  /**
   * csbot's GSI cfg in the detected CS2 folder: missing, current (points at this host's endpoint
   * with this host's token), or outdated (exists but the endpoint or token changed: reinstall).
   */
  cfgStatus: 'missing' | 'current' | 'outdated';
  /** Full path of csbot's cfg file (whether or not it exists yet). */
  cfgPath?: string;
  /** Set when the configured GSI port was busy and this session listens elsewhere. */
  portFallback?: { wanted: number; actual: number };
  cs2Path?: string;
  recordingsDir: string;
}

export interface CfgInstallResult { ok: boolean; path?: string; error?: string }

/**
 * What the desktop preload exposes to its renderer as `window.csbot`.
 * The web build checks for it: present = desktop host, absent = browser (demo now, room member from M2).
 */
export interface CsbotBridge {
  /** Called with every new snapshot. Returns an unsubscribe function. */
  onSnapshot(cb: (s: LiveSnapshot) => void): () => void;
  getInfo(): Promise<HostInfo>;
  /** Writes csbot's GSI cfg into the detected CS2 cfg folder. Only ever on a user click. */
  installCfg(): Promise<CfgInstallResult>;
  openRecordings(): Promise<void>;
  /**
   * This PC's own GSI payloads, after the spectator guard. A desktop app that joins someone else's
   * room forwards them to that room's host.
   */
  onGsi?(cb: (payload: Record<string, unknown>) => void): () => void;
  /** Scouting for the current match (M3). Called with the latest view right away. */
  onScout?(cb: (s: ScoutView) => void): () => void;
  /** Scout a FACEIT match from its room link or id. */
  scoutMatch?(linkOrId: string): Promise<{ ok: boolean; error?: string }>;
  /** Load the fictional sample match (no keys needed). */
  scoutSample?(): Promise<void>;
  /** Run (or re-run) the AI scouting report on the host's Claude Code. Refusals (budget, no Claude) come back as errors. */
  runScoutReport?(): Promise<{ ok: boolean; error?: string }>;
  /**
   * Who's in this host's room, so scouting can tell room members from randoms. Matched against
   * FACEIT nicknames (case-insensitive): members should join under their FACEIT name.
   */
  setRoomRoster?(members: { name: string }[]): void;
  /** Save or clear an API key (stored encrypted on this PC; never sent to the room). */
  setApiKey?(service: 'faceit' | 'steam', key: string | null): Promise<{ ok: boolean; error?: string }>;
}
export * from './room.ts';
export * from './scout.ts';
