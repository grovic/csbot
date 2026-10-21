// Claude's "work on next" after a match: the prompt, the output schema and the parser. The desktop
// host runs it with the user's own Claude Code (one call per match, on demand).

import type { MatchRecord, WorkOn } from '@csbot/protocol';
import { debriefStats, type DebriefStats } from './stats.ts';

export const WORKON_SYSTEM = `You are the post-match coach in csbot, a companion app for a Counter-Strike 2 squad.
You get one match as numbers csbot recorded from the game: every round with our side, our buy, the enemy money estimate, the forecast, the team call, the intel logged, the result, and the player's own round (kills, damage, died). Sometimes the match demo's truth is included (real enemy money, plant sites, deaths).
Write what to work on next:
- team: 1 to 3 items for the whole team, one sentence each, at most 25 words, concrete and tied to the numbers (rounds, buys, sides, calls).
- you: 1 or 2 items for the player whose data this is, at most 25 words each.
Rules: use only facts in the message. Never invent stats, positions or enemy habits. Enemy money is an estimate unless the demo truth says otherwise. Plain English, no filler, no praise.`;

export const WORKON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['team', 'you'],
  properties: {
    team: { type: 'array', items: { type: 'string' } },
    you: { type: 'array', items: { type: 'string' } },
  },
} as const;

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : 'n/a');

/** The facts sent to Claude: compact, no names besides the player's own. */
export function workOnInput(rec: MatchRecord, stats: DebriefStats = debriefStats(rec)): string {
  const facts = {
    map: rec.map, result: `${rec.score.us}-${rec.score.them}`, finished: rec.finished,
    player: rec.me?.name, rating: stats.rating, kpr: stats.kpr, adr: stats.adr, totals: rec.totals,
    sides: { CT: `${stats.bySide.CT.won}/${stats.bySide.CT.played}`, T: `${stats.bySide.T.won}/${stats.bySide.T.played}` },
    winsByOurBuy: Object.fromEntries(Object.entries(stats.byBuy).map(([k, t]) => [k, `${t!.won}/${t!.played}`])),
    planChanges: stats.planChanges, intelLogged: stats.intel,
    rounds: rec.rounds.map(r => ({
      r: r.round, side: r.side, won: r.winner === 'us', why: r.reason, ourBuy: r.ourBuy,
      enemyEstimate: r.enemy ? `${r.enemy.read} $${Math.round(r.enemy.lo)}-${Math.round(r.enemy.hi)}` : undefined,
      forecast: r.forecast ? `${r.forecast.enemy === 'CT' ? 'lighter' : 'hit'} A ${Math.round(r.forecast.site.A * 100)}% B ${Math.round(r.forecast.site.B * 100)}% (${r.forecast.top})` : undefined,
      call: r.call ? `${r.call.head}${r.call.planChanged ? ' (plan changed)' : ''}` : undefined,
      intel: r.intel || undefined, planted: r.planted || undefined,
      me: r.me ? `${r.me.kills}k ${r.me.damage}dmg${r.me.died ? ' died' : ''}` : undefined,
    })),
    ...(stats.truth ? {
      demoTruth: {
        buyReadAccuracy: pct(stats.truth.buyRead.correct, stats.truth.buyRead.total),
        moneyBandCoverage: pct(stats.truth.band.inside, stats.truth.band.total),
        siteReadAccuracy: pct(stats.truth.siteRead.correct, stats.truth.siteRead.total),
        openingDuelsWon: `${stats.truth.openings.won}/${stats.truth.openings.total}`,
        playerDeaths: stats.truth.myDeaths.map(d => `r${d.round} at ${Math.round(d.t)}s${d.weapon ? ` (${d.weapon})` : ''}`),
      },
    } : {}),
  };
  return JSON.stringify(facts);
}

const cut = (s: string, n: number) => { const t = s.trim().replace(/\s+/g, ' '); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t; };

export function parseWorkOn(raw: unknown, model?: string, at = Date.now()): WorkOn {
  const o = (typeof raw === 'string' ? JSON.parse(raw) : raw) as { team?: unknown; you?: unknown };
  const list = (v: unknown, n: number) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map(x => cut(x, 180)).slice(0, n) : []);
  const team = list(o?.team, 3), you = list(o?.you, 2);
  if (!team.length) throw new Error('no team items');
  return { at, team, you, ...(model ? { model } : {}) };
}
