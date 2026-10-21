// Room-wide spectator guard. csbot never shows data a live player can't see: spectator-only components
// are dropped from every device's payload, and positions are kept only for our own team.

import type { GsiPayload, Side } from './types.ts';

export const SPECTATOR_ONLY = ['allplayers', 'allgrenades', 'bomb'] as const;

export interface GuardContext {
  /** Our team's side this half. Unknown means positions are dropped. */
  ourSide?: Side;
}

export interface GuardResult { payload: GsiPayload; dropped: string[] }

export function spectatorGuard(p: GsiPayload, ctx: GuardContext): GuardResult {
  const dropped: string[] = [];
  const out: GsiPayload = { ...p };
  for (const key of SPECTATOR_ONLY) {
    if (out[key] !== undefined) { delete out[key]; dropped.push(key); }
  }
  delete out.previously;
  delete out.added;
  if (out.player && (out.player.position !== undefined || out.player.forward !== undefined)) {
    const teammate = !!ctx.ourSide && out.player.team === ctx.ourSide;
    if (!teammate) {
      const { position: _p, forward: _f, ...rest } = out.player;
      out.player = rest;
      dropped.push('player.position');
    }
  }
  return { payload: out, dropped };
}
