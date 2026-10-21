// Raw CS2 Game State Integration payload (the parts csbot reads). Every field is optional:
// the game only sends components requested in the cfg, and many only in some situations.

export type Side = 'CT' | 'T';

export interface GsiTeam {
  score?: number;
  consecutive_round_losses?: number;
  timeouts_remaining?: number;
  matches_won_this_series?: number;
}

export interface GsiPlayer {
  steamid?: string;
  name?: string;
  clan?: string;
  observer_slot?: number;
  team?: string;
  activity?: string;
  state?: {
    health?: number;
    armor?: number;
    helmet?: boolean;
    flashed?: number;
    smoked?: number;
    burning?: number;
    money?: number;
    round_kills?: number;
    round_killhs?: number;
    round_totaldmg?: number;
    equip_value?: number;
    defusekit?: boolean;
  };
  match_stats?: { kills?: number; assists?: number; deaths?: number; mvps?: number; score?: number };
  weapons?: Record<string, { name?: string; type?: string; state?: string; ammo_clip?: number; ammo_reserve?: number }>;
  /** "x, y, z": spectator-only per library docs; the probe settles it for a playing client. */
  position?: string;
  forward?: string;
}

export interface GsiPayload {
  provider?: { name?: string; appid?: number; version?: number; steamid?: string; timestamp?: number };
  map?: {
    mode?: string;
    name?: string;
    phase?: string;
    round?: number;
    team_ct?: GsiTeam;
    team_t?: GsiTeam;
    num_matches_to_win_series?: number;
    round_wins?: Record<string, string>;
  };
  round?: { phase?: string; bomb?: string; win_team?: string };
  player?: GsiPlayer;
  phase_countdowns?: { phase?: string; phase_ends_in?: string };
  /** Spectator-only components. csbot never requests them; the guard drops them if they arrive. */
  allplayers?: unknown;
  allgrenades?: unknown;
  bomb?: unknown;
  previously?: unknown;
  added?: unknown;
  auth?: { token?: string };
}
