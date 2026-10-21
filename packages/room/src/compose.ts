// One host snapshot → each member's own screen. Same call and forecast for everyone; the YOU line,
// map marker, buy tile and highlighted scoreboard row are each member's own.

import { deadYouLine } from '@csbot/engine';
import type { LiveSnapshot, MeView, PlayerRow, YouTile } from '@csbot/protocol';

export interface Personal {
  /** The member's playbook slot. */
  slot?: string;
  /** From the member's own GSI (desktop members who share it). */
  me?: MeView;
  youTile?: YouTile;
  steamid?: string;
  /** Room-wide tournament mode: no live coaching on any screen. */
  tournament: boolean;
}

export function personalize(live: LiveSnapshot, rows: readonly PlayerRow[], p: Personal): LiveSnapshot {
  const { me: _me, youTile: _tile, youHandle: _handle, ...base } = live;
  const out: LiveSnapshot = { ...base, scoreboard: rows.map(r => ({ ...r, isMe: !!p.steamid && r.steamid === p.steamid })) };
  if (p.me) out.me = p.me;
  if (p.youTile) out.youTile = p.youTile;
  if (p.slot) out.youHandle = p.slot;
  if (out.call) {
    const { you: _you, ...call } = out.call;
    const live = call.kind === 'pre' || call.kind === 'post';
    const you = !p.slot || !live ? undefined : p.me?.observing ? deadYouLine(p.me.observing.name) : call.jobs[p.slot];
    out.call = you ? { ...call, you } : call;
  }
  if (p.tournament) {
    delete out.call;
    delete out.forecast;
    delete out.setupSpots;
  }
  return out;
}

const RANK: Record<PlayerRow['source'], number> = { host: 3, room: 2, spectated: 1 };

/**
 * One scoreboard for the room: each player once, from the best source available
 * (their own GSI on the host, their own GSI through the room, or the latest spectate).
 */
export function mergeRows(rows: readonly PlayerRow[]): PlayerRow[] {
  const best = new Map<string, PlayerRow>();
  for (const r of rows) {
    const cur = best.get(r.steamid);
    const better = !cur || RANK[r.source] > RANK[cur.source] || (r.source === cur.source && (r.seenRound ?? 0) > (cur.seenRound ?? 0));
    if (better) best.set(r.steamid, { ...r, isMe: false });
  }
  return [...best.values()].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
}
