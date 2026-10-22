// Practice-config export (M7): a .cfg for your own private server (sv_cheats) that sets up a grenade
// practice session and binds one alias per lineup: teleport to the throw spot, face the landing spot,
// get the grenade. Lineups with an exact spot (from your own practice) use it; the rest are close
// (the callout's floor height, aim toward the landing spot) and say so.

import type { Lineup, LineupKind } from '@csbot/protocol';
import { zoneAt, type MapGeo, type Point } from './geometry.ts';
import { GEOS } from './maps/index.ts';

const GRENADE: Record<LineupKind, (side: 'CT' | 'T') => string> = {
  smoke: () => 'weapon_smokegrenade',
  molotov: side => (side === 'T' ? 'weapon_molotov' : 'weapon_incgrenade'),
  flash: () => 'weapon_flashbang',
  he: () => 'weapon_hegrenade',
};
/** A starting pitch when the aim isn't known: a bit up for long throws. */
const PITCH: Record<LineupKind, number> = { smoke: -20, molotov: -10, flash: -15, he: -10 };
/** Teleport this far above the callout's usual floor; the player drops onto it. */
const DROP = 16;

const r1 = (v: number) => Math.round(v * 10) / 10;
/** Console-safe text: ASCII letters, digits and a few signs (no quotes or semicolons). */
const safe = (s: string) => s.normalize('NFKD').replace(/[^A-Za-z0-9 ,.()+\-/]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);

/** A map point in world units, on the level it's drawn on (Nuke's lower floor is drawn apart). */
function world(geo: MapGeo, p: Point): { x: number; y: number; z: number } {
  const zone = zoneAt(geo, p[0], p[1]);
  const lv = geo.world.levels[zone?.level ?? 0] ?? geo.world.levels[0]!;
  const w = geo.world;
  return { x: (p[0] - w.ox) / w.s - lv.dx, y: (w.oy - p[1]) / w.s - lv.dy, z: zone?.z ?? 0 };
}

/** setpos/setang for a lineup: the exact one, or near the throw spot facing the landing spot. */
export function lineupSpot(map: string, l: Lineup): { pos: [number, number, number]; ang: [number, number]; exact: boolean } | undefined {
  if (l.exact) return { pos: [...l.exact.pos], ang: [...l.exact.ang], exact: true };
  const geo = GEOS[map];
  if (!geo) return undefined;
  const a = world(geo, l.from), b = world(geo, l.to);
  const yaw = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  return { pos: [r1(a.x), r1(a.y), r1(a.z + DROP)], ang: [PITCH[l.kind], r1(yaw)], exact: false };
}

export const practiceFileName = (map: string) => `csbot_${map.replace(/[^a-z0-9_]/g, '')}.cfg`;

/** The whole .cfg text. */
export function practiceConfig(map: string, lineups: readonly Lineup[], date = new Date()): string {
  const name = GEOS[map]?.name ?? map;
  const lines = [
    `// csbot practice config: ${safe(name)}, ${lineups.length} lineup${lineups.length === 1 ? '' : 's'} (${date.toISOString().slice(0, 10)})`,
    '// For your own private server only: it turns on sv_cheats.',
    `// Put this file in CS2's game/csgo/cfg folder, start a practice match on ${map}, then type in the console:`,
    `//   exec ${practiceFileName(map).replace(/\.cfg$/, '')}`,
    '// Each lineupN puts you at the throw spot facing the landing spot, with the grenade in hand.',
    '// "near" = close to the spot with the aim roughly toward the landing spot: find the exact aim, then save it in csbot (Playbook, Lineups).',
    '',
    'sv_cheats 1',
    'mp_warmup_end',
    'mp_limitteams 0; mp_autoteambalance 0; bot_kick',
    'mp_freezetime 0; mp_roundtime 60; mp_roundtime_defuse 60; mp_buytime 9999; mp_buy_anywhere 1',
    'mp_maxmoney 60000; mp_startmoney 60000; mp_respawn_on_death_ct 1; mp_respawn_on_death_t 1',
    'sv_infinite_ammo 1; ammo_grenade_limit_total 5',
    'sv_grenade_trajectory_prac_pipreview 1; sv_showimpacts 1',
    'mp_restartgame 1',
    '',
  ];
  const list: string[] = [];
  lineups.forEach((l, i) => {
    const s = lineupSpot(map, l);
    if (!s) return;
    const n = `lineup${i + 1}`;
    const g = GRENADE[l.kind](l.side);
    const label = `${n} ${safe(l.name)} (${l.side})${l.how ? ' - ' + safe(l.how) : ''}${s.exact ? '' : ' - near'}`;
    lines.push(`alias ${n} "setpos ${s.pos.join(' ')}; setang ${s.ang[0]} ${s.ang[1]} 0; give ${g}; use ${g}; echo ${label}"`);
    list.push(`echo ${label}`);
  });
  lines.push('', `alias csbot_list "${list.length ? list.join('; ') : 'echo No lineups.'}"`, 'csbot_list', '');
  return lines.join('\n');
}
