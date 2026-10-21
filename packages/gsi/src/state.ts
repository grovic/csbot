import type { GsiPayload, Side } from './types.ts';

export type RoundReason = 'elimination' | 'bomb' | 'defuse' | 'time';

export interface TeamState { score: number; lossStreak: number; timeoutsLeft: number }

export interface PlayerState {
  steamid: string;
  name: string;
  team?: Side;
  /** True when GSI follows another player (we are dead or spectating). */
  observing: boolean;
  alive: boolean;
  health: number;
  armor: number;
  helmet: boolean;
  flashed: number;
  money: number;
  equipValue: number;
  roundKills: number;
  roundDamage: number;
  kills: number;
  assists: number;
  deaths: number;
  mvps: number;
  activeWeapon?: string;
  position?: readonly [number, number, number];
}

export interface RoundWin { winner: Side; reason: RoundReason }

export interface GameState {
  at: number;
  /** Steam ID of the person running this game client. */
  me?: string;
  mapName?: string;
  mode?: string;
  mapPhase?: string;
  /** 1-based number of the round being played. */
  round?: number;
  ct?: TeamState;
  t?: TeamState;
  roundWins: Readonly<Record<number, RoundWin>>;
  roundPhase?: string;
  bomb?: string;
  winTeam?: Side;
  player?: PlayerState;
  countdown?: { phase: string; endsIn: number };
}

const side = (s?: string): Side | undefined => (s === 'CT' || s === 'T' ? s : undefined);

export function parseRoundWin(code: string): RoundWin | undefined {
  const m = /^(ct|t)_win_(elimination|bomb|defuse|time)$/.exec(code);
  if (!m) return undefined;
  return { winner: m[1] === 'ct' ? 'CT' : 'T', reason: m[2] as RoundReason };
}

export function parseVec(v?: string): readonly [number, number, number] | undefined {
  if (!v) return undefined;
  const n = v.split(',').map(s => Number(s.trim()));
  return n.length === 3 && n.every(Number.isFinite) ? [n[0]!, n[1]!, n[2]!] : undefined;
}

const team = (t?: { score?: number; consecutive_round_losses?: number; timeouts_remaining?: number }): TeamState | undefined =>
  t ? { score: t.score ?? 0, lossStreak: t.consecutive_round_losses ?? 0, timeoutsLeft: t.timeouts_remaining ?? 0 } : undefined;

export function toGameState(p: GsiPayload, at = Date.now()): GameState {
  const roundWins: Record<number, RoundWin> = {};
  for (const [k, v] of Object.entries(p.map?.round_wins ?? {})) {
    const w = parseRoundWin(v);
    if (w) roundWins[Number(k)] = w;
  }
  const me = p.provider?.steamid;
  const pl = p.player;
  let player: PlayerState | undefined;
  if (pl?.steamid) {
    const st = pl.state ?? {};
    const ms = pl.match_stats ?? {};
    const active = Object.values(pl.weapons ?? {}).find(w => w.state === 'active');
    const health = st.health ?? 0;
    player = {
      steamid: pl.steamid,
      name: pl.name ?? '',
      team: side(pl.team),
      observing: !!me && pl.steamid !== me,
      alive: health > 0,
      health,
      armor: st.armor ?? 0,
      helmet: !!st.helmet,
      flashed: st.flashed ?? 0,
      money: st.money ?? 0,
      equipValue: st.equip_value ?? 0,
      roundKills: st.round_kills ?? 0,
      roundDamage: st.round_totaldmg ?? 0,
      kills: ms.kills ?? 0,
      assists: ms.assists ?? 0,
      deaths: ms.deaths ?? 0,
      mvps: ms.mvps ?? 0,
      activeWeapon: active?.name,
      position: parseVec(pl.position),
    };
  }
  const endsIn = Number(p.phase_countdowns?.phase_ends_in);
  return {
    at,
    me,
    mapName: p.map?.name,
    mode: p.map?.mode,
    mapPhase: p.map?.phase,
    round: p.map ? (p.map.round ?? 0) + 1 : undefined,
    ct: team(p.map?.team_ct),
    t: team(p.map?.team_t),
    roundWins,
    roundPhase: p.round?.phase,
    bomb: p.round?.bomb,
    winTeam: side(p.round?.win_team),
    player,
    countdown: p.phase_countdowns?.phase && Number.isFinite(endsIn) ? { phase: p.phase_countdowns.phase, endsIn } : undefined,
  };
}
