// The AI scouting report: one structured call to the host's own Claude Code (claude -p --json-schema).
// The prompt carries only computed facts; the answer is validated and trimmed before anyone sees it.
// Spawning the process is the desktop host's job; this file is pure.

import { z } from 'zod';
import type { ScoutReport, ScoutView } from '@csbot/protocol';
import { mapName } from './derive.ts';

export const ANALYST_SYSTEM = `You are the analyst inside csbot, a second-screen companion for a Counter-Strike 2 squad.
You get a JSON scouting file for the next match: both rosters with FACEIT and Steam stats, map win rates, premade groups, veto advice and win chance. All numbers were computed by csbot.
Write a short pre-match briefing that a player can read in 20 seconds, in plain English.
Rules:
- Use only facts present in the file. Never invent stats, roles, habits or history. If something isn't in the file, don't mention it.
- Roles marked source "stats" are guesses from kill-rate stats: say "likely" for them.
- Be concrete and practical: who to watch, which maps, what to do about it.
- Keep every string short: summary under 40 words, each item under 18 words.
- Tips: one per enemy player, keyed by their exact nickname.`;

/** JSON Schema passed to `claude -p --json-schema`. Lengths live in descriptions (rejections cost retries). */
export const ANALYST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'things', 'plan', 'veto', 'tips'],
  properties: {
    summary: { type: 'string', description: 'Under 40 words: who they are and how the match likely goes.' },
    things: { type: 'array', items: { type: 'string' }, description: 'Exactly 3 things to know, each under 18 words.' },
    plan: { type: 'array', items: { type: 'string' }, description: '2 to 4 points for our game plan, each under 18 words.' },
    veto: { type: 'string', description: 'Map veto advice in one sentence.' },
    tips: {
      type: 'array',
      description: 'One tip per enemy player.',
      items: {
        type: 'object', additionalProperties: false, required: ['player', 'tip'],
        properties: { player: { type: 'string', description: 'Exact enemy nickname.' }, tip: { type: 'string', description: 'How to play against him, under 18 words.' } },
      },
    },
  },
} as const;

/** The facts the model sees: compact, numbers only from csbot. */
export function analystInput(v: ScoutView): string {
  const player = (p: ScoutView['us']['players'][number]) => ({
    nickname: p.nickname, level: p.level, elo: p.elo, ...(p.room ? { room: p.room } : {}), ...(p.party ? { party: p.party } : {}),
    ...(p.role ? { role: p.role } : {}), stats: p.stats, threat: p.threat?.score, keyStat: p.keyStat,
    maps: Object.fromEntries(Object.entries(p.maps).map(([m, s]) => [mapName(m), s])), flags: p.flags,
  });
  return JSON.stringify({
    platform: v.platform, map: v.map ? mapName(v.map) : 'not picked yet',
    winChance: v.winChance, factsFromCsbot: v.facts,
    us: { name: v.us.name, avgElo: v.us.avgElo, players: v.us.players.map(player) },
    them: { name: v.them.name, avgElo: v.them.avgElo, players: v.them.players.map(player) },
    maps: v.maps.map(r => ({ map: mapName(r.map), them: r.them, us: r.us, edge: r.edge, csbotAdvice: r.action })),
  });
}

const Out = z.object({
  summary: z.string(),
  things: z.array(z.string()),
  plan: z.array(z.string()),
  veto: z.string(),
  tips: z.array(z.object({ player: z.string(), tip: z.string() })),
});

const cut = (s: string, n: number) => { const t = s.trim().replace(/\s+/g, ' '); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t; };

/**
 * Validate the model's structured output. Tips for names that aren't on the enemy roster are dropped
 * (no invented players); everything is trimmed to fit the cards.
 */
export function parseAnalyst(raw: unknown, v: ScoutView): Pick<ScoutReport, 'summary' | 'things' | 'plan' | 'veto' | 'tips'> {
  const r = Out.parse(typeof raw === 'string' ? JSON.parse(raw) : raw);
  const enemies = new Map(v.them.players.map(p => [p.nickname.toLowerCase(), p.nickname]));
  const tips: Record<string, string> = {};
  for (const t of r.tips) {
    const nick = enemies.get(t.player.trim().toLowerCase());
    if (nick && t.tip.trim()) tips[nick] = cut(t.tip, 140);
  }
  return {
    summary: cut(r.summary, 320),
    things: r.things.filter(t => t.trim()).slice(0, 3).map(t => cut(t, 140)),
    plan: r.plan.filter(t => t.trim()).slice(0, 4).map(t => cut(t, 140)),
    veto: cut(r.veto, 200),
    tips,
  };
}

/** Put the report (and each tip) into the view. */
export function withReport(v: ScoutView, report: ScoutReport): ScoutView {
  const tips = report.tips ?? {};
  return {
    ...v, report,
    them: { ...v.them, players: v.them.players.map(p => (tips[p.nickname] ? { ...p, tip: tips[p.nickname] } : p)) },
  };
}
