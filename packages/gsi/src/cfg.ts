// The GSI config csbot installs into CS2's cfg folder (only on an explicit user click).
//
// Only components a playing client is documented to receive. Not requested:
// - allplayers_*, allgrenades, bomb: spectator/GOTV only (fair-play rule: never requested).
// - map_round_wins, phase_countdowns, player_position: availability to a playing client is unconfirmed,
//   so csbot derives round results and phase timers from transitions instead (see engine/match.ts).

export const PLAYER_COMPONENTS = [
  'provider',
  'map',
  'round',
  'player_id',
  'player_state',
  'player_weapons',
  'player_match_stats',
] as const;

export const SPECTATOR_COMPONENTS = [
  'allplayers_id',
  'allplayers_state',
  'allplayers_match_stats',
  'allplayers_weapons',
  'allplayers_position',
  'allgrenades',
  'bomb',
] as const;

export const CFG_FILE_NAME = 'gamestate_integration_csbot.cfg';

export interface GsiCfgOptions {
  /** e.g. http://127.0.0.1:47400 */
  uri: string;
  token: string;
  components?: readonly string[];
}

export function gsiConfig(o: GsiCfgOptions): string {
  const components = o.components ?? PLAYER_COMPONENTS;
  const bad = components.filter(c => (SPECTATOR_COMPONENTS as readonly string[]).includes(c));
  if (bad.length) throw new Error(`spectator-only GSI components are never requested: ${bad.join(', ')}`);
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(o.token)) throw new Error('GSI token must be 8-128 chars of [A-Za-z0-9_-]');
  if (!/^https?:\/\/[^\s"]+$/.test(o.uri)) throw new Error('GSI uri must be an http(s) URL');
  const pad = (k: string) => `"${k}"`.padEnd(22);
  return [
    '"csbot"',
    '{',
    `  "uri"       "${o.uri}"`,
    '  "timeout"   "1.1"',
    '  "buffer"    "0.1"',
    '  "throttle"  "0.25"',
    '  "heartbeat" "10.0"',
    '  "auth"',
    '  {',
    `    "token"   "${o.token}"`,
    '  }',
    '  "data"',
    '  {',
    ...components.map(c => `    ${pad(c)}"1"`),
    '  }',
    '}',
    '',
  ].join('\r\n');
}
