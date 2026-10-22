// Live coach logic, pure: what Claude is told at each game event, the one output schema the warm
// session uses (calls and answers share it), how its output becomes a CallView, and the per-match
// budget and quotas. Spawning and talking to `claude` is the desktop host's job.
//
// Rules from spike 5 (tools/spikes/claude-latency): facts go in the message (no state tool), the
// schema has no length limits (we trim), a warm-up turn at match start, and the engine's call is
// already on screen, so Claude's only has to be better, not first.

import { z } from 'zod';
import { activeAntiStrat, activeOpponent, currentTeam, GEOS, isWingman, lossBonus, PLAYBOOKS, slotsFor } from '@csbot/engine';
import type { CallView, CoachAsker, CoachConfig, LiveSnapshot, ScoutView } from '@csbot/protocol';

export const COACH_SYSTEM = `You are the live coach inside csbot, a second-screen companion for a Counter-Strike 2 squad.
Every message is a game event with facts computed by csbot (economy estimates, forecast, playbook), or a question from a player.
For a game event, answer with type "call": the team call for this moment.
- head: the team headline, max 6 words. sub: one line, max 10 words.
- setup: the id of the playbook setup you choose, from the ones listed, or "" if none fits.
- jobs: one job per slot listed in the roster, max 12 words each, naming the player when the roster gives a name. Randoms can't hear the app: give them their usual spot and say the IGL relays it.
- steps: at most 3 chips of max 4 words.
- why: 1 to 3 short facts from the message that justify the call.
For a question, answer with type "answer": a direct, practical answer in under 45 words in "answer". Leave the call fields empty.
Rules: use only facts in the message and earlier messages of this match. Name places with the map's callouts listed in the facts. Never invent stats, positions or enemy habits. Enemy money and positions are estimates: say "likely". Plain English, no filler.`;

/** Output schema for `claude -p --json-schema` (one session, every turn). Lengths live in prose. */
export const COACH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['type'],
  properties: {
    type: { type: 'string', enum: ['call', 'answer'] },
    head: { type: 'string' },
    sub: { type: 'string' },
    setup: { type: 'string' },
    jobs: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['slot', 'job'], properties: { slot: { type: 'string' }, job: { type: 'string' } } } },
    steps: { type: 'array', items: { type: 'string' } },
    why: { type: 'array', items: { type: 'string' } },
    answer: { type: 'string' },
  },
} as const;

export type Trigger = 'warmup' | 'freeze' | 'intel' | 'plant' | 'question';

export interface RosterEntry { name: string; slot?: string; random?: boolean }

const NAMES: Record<string, string> = { de_dust2: 'Dust II' };
const mapName = (id?: string) => (!id ? 'unknown map' : NAMES[id] ?? id.replace(/^de_/, '').replace(/^\w/, c => c.toUpperCase()));
const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
const pct = (p: number) => `${Math.round(p * 100)}%`;

/** Compact facts for one moment of the match. Everything here was computed by csbot. */
export function matchFacts(live: LiveSnapshot, roster: readonly RosterEntry[], scout?: ScoutView): Record<string, unknown> {
  const m = live.match;
  const slots = slotsFor(m?.map, m?.ourSide, m?.mode);
  const bySlot = new Map(roster.filter(r => r.slot).map(r => [r.slot!, r]));
  // Wingman: two players on one site; the playbook's five-player setups don't apply.
  const pb = m?.map && !isWingman(m.mode) ? PLAYBOOKS[m.map] : undefined;
  const setups = pb?.setups.filter(s => s.side === m?.ourSide).map(s => ({
    id: s.id, name: s.name,
    spots: Object.fromEntries(s.spots.map(sp => [sp.player, sp.label])),
    jobs: pb.jobs[s.id] ?? {},
  })) ?? [];
  const last = m?.history.slice(-3).map(h => `R${h.round} ${h.winner === 'us' ? 'won' : 'lost'} (${h.reason}${h.inferred ? ', inferred' : ''})`);
  const facts: Record<string, unknown> = {
    map: mapName(m?.map), ...(isWingman(m?.mode) ? { mode: 'Wingman (2v2, one bomb site, first to 9)' } : {}), round: m?.round, phase: m?.clock.phase, ourSide: m?.ourSide,
    score: m ? `${m.score.us}-${m.score.them}` : undefined, lastRounds: last, ourLossStreak: m?.ourLossStreak,
    roster: slots.map(s => ({ slot: s.id, position: s.label, player: bySlot.get(s.id)?.name ?? 'unassigned', ...(bySlot.get(s.id)?.random ? { random: true } : {}) })),
  };
  const geo = m?.map ? GEOS[m.map] : undefined;
  if (geo) facts.callouts = geo.zones.map(z => z.name);
  if (live.enemy) {
    const e = live.enemy;
    facts.enemyEconomyEstimate = { perPlayer: `${money(e.lo)}-${money(e.hi)}`, read: e.read, buy: Object.fromEntries(Object.entries(e.buy).map(([k, v]) => [k, pct(v)])), lossBonusLevel: e.streak, nextLossPays: money(lossBonus(e.streak + 1)), savedLastRound: e.saved };
  }
  if (live.forecast) {
    const f = live.forecast;
    facts.forecastEstimate = f.enemy === 'CT'
      ? { theirLikelySetup: `${f.topPlan.name} ${pct(f.topPlan.p)}`, lighterSiteA: pct(f.site.A), lighterSiteB: pct(f.site.B), basis: f.basis }
      : { siteA: pct(f.site.A), siteB: pct(f.site.B), topPlan: `${f.topPlan.name} ${pct(f.topPlan.p)}`, basis: f.basis };
  }
  if (live.call) facts.engineCall = { head: live.call.head, setup: live.call.setup };
  if (setups.length) facts.playbookSetups = setups;
  // The squad's anti-strat for this opponent (their own words).
  const anti = activeAntiStrat(currentTeam(), m?.map);
  if (anti?.notes) facts.antiStrat = { opponent: activeOpponent(currentTeam()), notes: anti.notes };
  else facts.playbook = `No playbook for ${mapName(m?.map)} on ${m?.ourSide ?? 'this'} side yet: give general jobs per position.`;
  if (scout?.status === 'ready') {
    facts.opponents = scout.them.players.slice(0, 5).map(p => ({ nick: p.nickname, ...(p.role ? { role: `${p.role.label}${p.role.source === 'stats' ? ' (likely)' : ''}` } : {}), ...(p.tip ? { tip: p.tip } : {}) }));
  }
  return facts;
}

/** The message for one event. */
export function eventMessage(trigger: Exclude<Trigger, 'question'>, live: LiveSnapshot, roster: readonly RosterEntry[], scout?: ScoutView): string {
  const facts = JSON.stringify(matchFacts(live, roster, scout));
  switch (trigger) {
    case 'warmup':
      return `Match starting on ${mapName(live.match?.map)}. Get ready; calls come at each freeze time. Reply with type "answer" and answer "ready". Facts: ${facts}`;
    case 'freeze':
      return `Freeze time, round ${live.match?.round}. Write the team call for this round. Facts: ${facts}`;
    case 'intel': {
      const seen = (live.intel ?? []).map(i => `${i.by.join(' + ')}: ${i.count ? `${i.count} at ${i.zoneName}` : `${i.zoneName} clear`} (${i.t}s into the round)`).join('; ');
      const ask = live.match?.ourSide === 'T'
        ? 'Write the updated mid-round call: which site to hit and how the team gets there.'
        : 'Write the updated mid-round call: who rotates where, who holds.';
      return `Intel in round ${live.match?.round}: ${seen || 'none'}. The forecast moved (estimate). ${ask} Facts: ${facts}`;
    }
    case 'plant':
      return `The bomb was just planted in round ${live.match?.round} (the game doesn't tell players the site). Write the post-plant call. Facts: ${facts}`;
  }
}

export function questionMessage(text: string, from: CoachAsker, live: LiveSnapshot, roster: readonly RosterEntry[], scout?: ScoutView): string {
  return `Question from ${from.name} (${from.role === 'admin' ? 'the admin' : 'a member'}): "${text.replace(/"/g, "'").slice(0, 300)}". Answer it (type "answer"). Current facts: ${JSON.stringify(matchFacts(live, roster, scout))}`;
}

const Out = z.object({
  type: z.enum(['call', 'answer']),
  head: z.string().optional(), sub: z.string().optional(), setup: z.string().optional(),
  jobs: z.array(z.object({ slot: z.string(), job: z.string() })).optional(),
  steps: z.array(z.string()).optional(), why: z.array(z.string()).optional(), answer: z.string().optional(),
});

const cut = (s: string | undefined, n: number) => { const t = (s ?? '').trim().replace(/\s+/g, ' '); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t; };

export type CoachOutput = { type: 'call'; call: CallView } | { type: 'answer'; text: string };

/**
 * Validate Claude's structured output. Calls keep only known slots and a real playbook setup, and are
 * trimmed to fit the call card. Throws when the output isn't usable (the engine call stays).
 */
export function parseCoachOutput(raw: unknown, live: LiveSnapshot, kind: CallView['kind']): CoachOutput {
  const o = Out.parse(typeof raw === 'string' ? JSON.parse(raw) : raw);
  if (o.type === 'answer') {
    const text = cut(o.answer, 400);
    if (!text) throw new Error('empty answer');
    return { type: 'answer', text };
  }
  const head = cut(o.head, 48);
  if (!head) throw new Error('call without a headline');
  const map = live.match?.map;
  const slots = new Set(slotsFor(map).map(s => s.id));
  const jobs: Record<string, string> = {};
  for (const j of o.jobs ?? []) if (slots.has(j.slot) && j.job.trim()) jobs[j.slot] = cut(j.job, 110);
  const pb = map ? PLAYBOOKS[map] : undefined;
  const setup = o.setup && pb?.setups.some(s => s.id === o.setup && s.side === live.match?.ourSide) ? o.setup : undefined;
  return {
    type: 'call',
    call: {
      kind, round: live.match?.round ?? 0, head, sub: cut(o.sub, 90), jobs,
      steps: (o.steps ?? []).map(s => cut(s, 32)).filter(Boolean).slice(0, 3),
      why: (o.why ?? []).map(s => cut(s, 120)).filter(Boolean).slice(0, 3),
      ...(setup ? { setup } : {}), source: 'claude',
    },
  };
}

/** Per-match budget for Claude calls and per-member question quotas. */
export class CoachLedger {
  private used = 0;
  private asks = new Map<string, number>();
  private match?: string;
  private config: Pick<CoachConfig, 'callBudget' | 'memberQuota'>;
  constructor(config: Pick<CoachConfig, 'callBudget' | 'memberQuota'>) { this.config = config; }

  setConfig(c: Pick<CoachConfig, 'callBudget' | 'memberQuota'>): void { this.config = c; }

  /** A new match (by map + start) resets everything. */
  newMatch(key: string): boolean {
    if (key === this.match) return false;
    this.match = key; this.used = 0; this.asks.clear();
    return true;
  }

  get budget() { return { used: this.used, max: this.config.callBudget }; }
  get quota() { return { perMember: this.config.memberQuota, used: Object.fromEntries(this.asks) }; }
  canCall(): boolean { return this.used < this.config.callBudget; }
  useCall(): void { this.used++; }

  /** Members have a quota; the admin's questions only count against the match budget. */
  canAsk(from: CoachAsker): { ok: boolean; error?: string } {
    if (!this.canCall()) return { ok: false, error: `The coach has used its ${this.config.callBudget} calls for this match.` };
    if (from.role === 'admin') return { ok: true };
    const n = this.asks.get(from.id) ?? 0;
    return n < this.config.memberQuota ? { ok: true } : { ok: false, error: `You've asked your ${this.config.memberQuota} questions for this match.` };
  }
  useAsk(from: CoachAsker): void {
    this.useCall();
    if (from.role !== 'admin') this.asks.set(from.id, (this.asks.get(from.id) ?? 0) + 1);
  }
}
