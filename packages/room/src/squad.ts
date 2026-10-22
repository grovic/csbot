// Squad markers: where each of our players is on the room map, by plan or by their own check-in.
// Positions are never read from the game (players don't get teammates' positions from GSI): a marker
// sits on the call's planned spot, moves when its player says "rotating to B", and turns into a
// cross when that player's own game data says they died.

import { GEOS, routeFrom, slotsFor, type Site } from '@csbot/engine';
import type { LiveSnapshot, SquadMarker } from '@csbot/protocol';

export interface CheckIn { state: 'spot' | 'rotate'; site?: Site; at: number }

/** What the room knows about the player in one slot. */
export interface SlotInfo {
  /** The member holding the slot (absent = nobody in the room plays it). */
  name?: string;
  /** A random from the match plays it (gather mode): named, but not in the room. */
  random?: boolean;
  /** From that player's own GSI, when they share it. */
  alive?: boolean;
  checkIn?: CheckIn;
}

/** Rotations at a jog with the gun out, a bit under knife speed. */
const ROTATE_PACE = 0.85;
const r0 = (n: number) => Math.round(n);
const r1 = (n: number) => Math.round(n * 10) / 10;

export function composeSquad(live: LiveSnapshot, bySlot: ReadonlyMap<string, SlotInfo>): SquadMarker[] | undefined {
  const spots = live.setupSpots;
  const map = live.match?.map;
  const geo = map ? GEOS[map] : undefined;
  if (!spots?.length || !geo) return undefined;
  const labels = new Map(slotsFor(map, live.match?.ourSide, live.match?.mode).map(s => [s.id, s.label]));
  const phase = live.match?.clock.phase;
  const live_ = phase === 'live' || phase === 'bomb';
  return spots.map((sp): SquadMarker => {
    const info = bySlot.get(sp.player);
    const base = {
      slot: sp.player, name: info?.name ?? labels.get(sp.player) ?? sp.player, ...(info?.name && !info.random ? {} : { open: true }),
      at: [sp.at[0], sp.at[1]] as const, label: sp.label,
    };
    if (live_ && info?.alive === false) return { ...base, state: 'dead' };
    const c = info?.checkIn;
    if (c?.state === 'rotate' && c.site) {
      const route = routeFrom(geo, sp.at, [c.site === 'A' ? 'asite' : 'bsite']).map(w => [r0(w[0]), r0(w[1]), r1(w[2] / ROTATE_PACE)] as const);
      return { ...base, state: 'rotating', to: c.site, route, since: c.at };
    }
    if (c?.state === 'spot') return { ...base, state: 'spot', since: c.at };
    return { ...base, state: 'planned' };
  });
}
