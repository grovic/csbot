import { MatchTracker } from '@csbot/engine';
import { FIRST_HALF, syntheticMatch, toGameState } from '@csbot/gsi';
import type { LiveSnapshot } from '@csbot/protocol';
import { describe, expect, it } from 'vitest';
import { COACH_SCHEMA, CoachLedger, eventMessage, matchFacts, parseCoachOutput, questionMessage } from '../src/index.ts';

function freeze2(): LiveSnapshot {
  const t = new MatchTracker();
  for (const { t: at, p } of syntheticMatch({ rounds: FIRST_HALF })) {
    t.ingest(toGameState(p, at));
    const s = t.snapshot(at);
    if (s.match?.round === 2 && s.match.clock.phase === 'freezetime') return s;
  }
  throw new Error('no freeze 2');
}
const ROSTER = [{ name: 'rdx', slot: 'a' }, { name: 'kairo', slot: 'short' }, { name: 'nyx', slot: 'b' }, { name: 'mbt', slot: 'rotator' }, { name: 'zeph', slot: 'awp', random: true }];

describe('what the coach is told', () => {
  it('sends computed facts: economy, forecast, playbook setups, the roster with randoms', () => {
    const f = matchFacts(freeze2(), ROSTER) as Record<string, any>;
    expect(f.map).toBe('Mirage');
    expect(f.round).toBe(2);
    expect(f.ourSide).toBe('CT');
    expect(f.enemyEconomyEstimate.read).toBe('eco');
    expect(f.forecastEstimate.siteB).toMatch(/%$/);
    expect(f.playbookSetups.map((s: { id: string }) => s.id)).toEqual(['antieco', 'std']);
    expect(f.roster.find((r: { slot: string }) => r.slot === 'awp')).toEqual({ slot: 'awp', position: 'AWP', player: 'zeph', random: true });
    expect(f.engineCall.head).toBe('Anti-eco · stack B');
    expect(eventMessage('freeze', freeze2(), ROSTER)).toMatch(/^Freeze time, round 2\. /);
    expect(questionMessage('Where do they "rush"?', { id: 'k', name: 'kairo', role: 'member' }, freeze2(), ROSTER)).toMatch(/^Question from kairo \(a member\): "Where do they 'rush'\?"/);
    expect(COACH_SCHEMA.required).toEqual(['type']);
  });
});

describe("reading Claude's output", () => {
  it('turns a call into a CallView with known slots and a real setup only', () => {
    const live = freeze2();
    const out = parseCoachOutput({
      type: 'call', head: 'Anti-eco: stack B 3-2', sub: 'Likely eco, play long angles', setup: 'antieco',
      jobs: [{ slot: 'a', job: 'rdx holds A alone, falls back on contact' }, { slot: 'ghost', job: 'invented' }],
      steps: ['Long angles', 'Trade in pairs', 'No peeks', 'extra'], why: ['Enemy est. $1.6k-2.4k: eco 59%'],
    }, live, 'pre');
    expect(out.type).toBe('call');
    if (out.type !== 'call') return;
    expect(out.call).toMatchObject({ kind: 'pre', round: 2, source: 'claude', setup: 'antieco', jobs: { a: 'rdx holds A alone, falls back on contact' } });
    expect(Object.keys(out.call.jobs)).toEqual(['a']);
    expect(out.call.steps).toHaveLength(3);
    expect(parseCoachOutput({ type: 'call', head: 'x', setup: 'made-up' }, live, 'pre')).toMatchObject({ call: { head: 'x' } });
    expect((parseCoachOutput({ type: 'call', head: 'x', setup: 'made-up' }, live, 'pre') as { call: { setup?: string } }).call.setup).toBeUndefined();
  });

  it('reads answers and refuses unusable output', () => {
    expect(parseCoachOutput({ type: 'answer', answer: ' Likely B apps rush on ecos. ' }, freeze2(), 'pre')).toEqual({ type: 'answer', text: 'Likely B apps rush on ecos.' });
    expect(() => parseCoachOutput({ type: 'call' }, freeze2(), 'pre')).toThrow(/headline/);
    expect(() => parseCoachOutput({ type: 'answer', answer: '' }, freeze2(), 'pre')).toThrow();
    expect(() => parseCoachOutput({ nope: 1 }, freeze2(), 'pre')).toThrow();
  });
});

describe('budget and quotas', () => {
  it('caps calls per match and questions per member; the admin only uses the budget', () => {
    const l = new CoachLedger({ callBudget: 3, memberQuota: 1 });
    l.newMatch('m1');
    const kairo = { id: 'k', name: 'kairo', role: 'member' as const }, rdx = { id: 'host', name: 'rdx', role: 'admin' as const };
    expect(l.canAsk(kairo).ok).toBe(true);
    l.useAsk(kairo);
    expect(l.canAsk(kairo).error).toMatch(/your 1 questions/);
    expect(l.canAsk(rdx).ok).toBe(true);
    l.useAsk(rdx); l.useCall();
    expect(l.canCall()).toBe(false);
    expect(l.canAsk(rdx).error).toMatch(/used its 3 calls/);
    expect(l.newMatch('m1')).toBe(false);
    expect(l.newMatch('m2')).toBe(true);
    expect(l.budget).toEqual({ used: 0, max: 3 });
    expect(l.quota).toEqual({ perMember: 1, used: {} });
  });
});
