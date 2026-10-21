import type { GameState, RoundReason } from './state.ts';
import type { Side } from './types.ts';

export type GsiEvent =
  | { type: 'map'; name: string; mode?: string }
  | { type: 'freezeStart'; round: number }
  | { type: 'roundLive'; round: number }
  | { type: 'bomb'; state: 'planted' | 'defused' | 'exploded' }
  | { type: 'roundEnd'; round: number; winner: Side; reason: RoundReason }
  | { type: 'money'; steamid: string; from: number; to: number }
  | { type: 'died'; steamid: string }
  | { type: 'observing'; target: string | null }
  | { type: 'halftime' }
  | { type: 'matchEnd' };

/** Turn two consecutive states into domain events. `prev` is undefined for the first payload. */
export function diffStates(prev: GameState | undefined, next: GameState): GsiEvent[] {
  const ev: GsiEvent[] = [];
  if (next.mapName && next.mapName !== prev?.mapName) ev.push({ type: 'map', name: next.mapName, mode: next.mode });

  if (next.roundPhase !== prev?.roundPhase && next.round !== undefined) {
    if (next.roundPhase === 'freezetime') ev.push({ type: 'freezeStart', round: next.round });
    if (next.roundPhase === 'live') ev.push({ type: 'roundLive', round: next.round });
  }

  if (next.bomb && next.bomb !== prev?.bomb && (next.bomb === 'planted' || next.bomb === 'defused' || next.bomb === 'exploded')) {
    ev.push({ type: 'bomb', state: next.bomb });
  }

  for (const [k, w] of Object.entries(next.roundWins)) {
    const r = Number(k);
    if (!prev?.roundWins[r]) ev.push({ type: 'roundEnd', round: r, winner: w.winner, reason: w.reason });
  }

  const pp = prev?.player, np = next.player;
  if (np) {
    const sameTarget = pp?.steamid === np.steamid;
    if (np.observing !== !!pp?.observing || (np.observing && !sameTarget)) ev.push({ type: 'observing', target: np.observing ? np.steamid : null });
    if (sameTarget && pp) {
      if (pp.money !== np.money) ev.push({ type: 'money', steamid: np.steamid, from: pp.money, to: np.money });
      if (pp.alive && !np.alive) ev.push({ type: 'died', steamid: np.steamid });
    }
  }

  if (next.mapPhase !== prev?.mapPhase) {
    if (next.mapPhase === 'intermission') ev.push({ type: 'halftime' });
    if (next.mapPhase === 'gameover') ev.push({ type: 'matchEnd' });
  }
  return ev;
}
