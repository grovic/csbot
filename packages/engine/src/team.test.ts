import { sanitizeTeam, type TeamPlan } from '@csbot/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { buyProbs } from './economy.ts';
import { planPrior, siteForecast } from './forecast.ts';
import { MAPS, PLAYBOOKS, slotsFor } from './maps/index.ts';
import { engineRoundCall } from './playbook.ts';
import { activeAntiStrat, applyTeam, builtinModel, builtinPlaybook, playbookProblem, teamModel, teamPlaybook } from './team.ts';

const fullBuy = buyProbs({ lo: 2750, hi: 4900 }, { saved: true });
const ecoBuy = buyProbs({ lo: 1450, hi: 2800 });
const enemy = { lo: 2750, hi: 4900, streak: 0, saved: false };

/** csbot's Mirage playbook with our own names and an A stack as the standard setup. */
function ownMirage(): TeamPlan['playbooks'][string] {
  const pb = builtinPlaybook('de_mirage')!;
  return JSON.parse(JSON.stringify({
    ...pb,
    slots: pb.slots.map(s => (s.id === 'a' ? { ...s, label: 'Palace' } : s)),
    setups: pb.setups.map(s => (s.id === 'std' ? { ...s, name: 'Our 3-A', calls: { default: { head: 'Stack A', sub: 'Three on A', steps: ['Jungle smoke'] } } } : s)),
  }));
}

afterEach(() => applyTeam(undefined));

describe('team playbook', () => {
  it("replaces csbot's for its map, everywhere the engine reads it", () => {
    const team = sanitizeTeam({ playbooks: { de_mirage: ownMirage() }, antistrats: [] });
    expect(playbookProblem(team.playbooks.de_mirage!)).toBeUndefined();
    applyTeam(team);
    expect(slotsFor('de_mirage')[0]!.label).toBe('Palace');
    expect(engineRoundCall(PLAYBOOKS.de_mirage!, enemy, fullBuy).head).toBe('Stack A');
    expect(PLAYBOOKS.de_dust2).toBe(builtinPlaybook('de_dust2')); // other maps untouched
    applyTeam(undefined);
    expect(slotsFor('de_mirage')[0]!.label).toBe('A anchor');
  });

  it("an unusable team playbook falls back to csbot's", () => {
    const bad = { ...ownMirage(), setups: ownMirage().setups.filter(s => s.side === 'T') };
    const team = sanitizeTeam({ playbooks: { de_mirage: bad }, antistrats: [] });
    expect(playbookProblem(team.playbooks.de_mirage!)).toMatch(/CT setup/);
    expect(teamPlaybook(team, 'de_mirage')).toBe(builtinPlaybook('de_mirage'));
  });
});

describe('anti-strat', () => {
  const team = sanitizeTeam({
    playbooks: {},
    antistrats: [{ id: 'holo', name: 'Team Holo', updatedAt: 1, maps: { de_mirage: { tWeights: { bRush: 4, aExec: 0, split: 0 }, ctWeights: { stackB: 4 }, answers: { full: 'antieco' }, notes: 'They rush B when they buy.' } } }],
    active: 'holo',
  });

  it('only applies while active, and only on its maps', () => {
    expect(activeAntiStrat(team, 'de_mirage')?.notes).toMatch(/rush B/);
    expect(activeAntiStrat({ ...team, active: undefined }, 'de_mirage')).toBeUndefined();
    expect(teamModel(team, 'de_dust2')).toBe(builtinModel('de_dust2'));
  });

  it('their tendencies move the forecast: B much likelier, A plans gone', () => {
    const before = siteForecast(builtinModel('de_mirage')!, planPrior(builtinModel('de_mirage')!, fullBuy));
    const m = teamModel(team, 'de_mirage')!;
    const prior = planPrior(m, fullBuy);
    expect(prior.aExec).toBe(0);
    expect(prior.split).toBe(0);
    expect(siteForecast(m, prior).B).toBeGreaterThan(before.B + 0.2);
    expect(siteForecast(m, prior).B).toBeCloseTo(1, 5);
    // Their CT side: stack B likelier, so A reads light.
    const ctBefore = planPrior(builtinModel('de_mirage')!.ct!, fullBuy).stackB!;
    expect(planPrior(m.ct!, fullBuy).stackB).toBeGreaterThan(ctBefore * 1.5);
  });

  it('our answer per enemy buy picks the setup, the default still covers the rest', () => {
    applyTeam(team);
    expect(engineRoundCall(PLAYBOOKS.de_mirage!, enemy, fullBuy).setup).toBe('antieco');
    expect(engineRoundCall(PLAYBOOKS.de_mirage!, { lo: 1450, hi: 2800, streak: 1, saved: false }, ecoBuy).setup).toBe('antieco');
    const noAnswer = sanitizeTeam({ ...team, antistrats: [{ ...team.antistrats[0]!, maps: { de_mirage: { answers: { eco: 'std' } } } }] });
    applyTeam(noAnswer);
    // Eco moved to the default setup, which takes it because no other setup claims it any more.
    expect(engineRoundCall(PLAYBOOKS.de_mirage!, { lo: 1450, hi: 2800, streak: 1, saved: false }, ecoBuy).setup).toBe('std');
    expect(MAPS.de_mirage).toBe(builtinModel('de_mirage')); // no weights: csbot's odds
  });

  it('"never" on every plan they would run keeps the usual odds instead of none', () => {
    const allNever = Object.fromEntries(builtinModel('de_mirage')!.plans.map(p => [p.id, 0]));
    const t = sanitizeTeam({ playbooks: {}, antistrats: [{ id: 'x', name: 'X', updatedAt: 0, maps: { de_mirage: { tWeights: allNever } } }], active: 'x' });
    const prior = planPrior(teamModel(t, 'de_mirage')!, fullBuy);
    expect(Object.values(prior).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
  });
});

describe('sanitizeTeam', () => {
  it('drops what is malformed and caps sizes', () => {
    const t = sanitizeTeam({
      playbooks: { de_mirage: { ...ownMirage(), setups: [...ownMirage().setups, { id: 'bad id!', name: 'x', side: 'CT', spots: [] }] }, 'not a map': {}, de_x: 'nope' },
      antistrats: [{ id: 'a', name: 'A', maps: { de_mirage: { tWeights: { bRush: 9, aExec: 2 }, notes: 'x'.repeat(2000) } } }, { id: 'a', name: 'dup' }, { name: 'no id' }],
      active: 'zzz',
    });
    expect(Object.keys(t.playbooks)).toEqual(['de_mirage']);
    expect(t.playbooks.de_mirage!.setups.some(s => s.id === 'bad id!')).toBe(false);
    expect(t.antistrats).toHaveLength(1);
    expect(t.antistrats[0]!.maps.de_mirage!.tWeights).toEqual({ aExec: 2 }); // 9 is out of range
    expect(t.antistrats[0]!.maps.de_mirage!.notes).toHaveLength(600);
    expect(t.active).toBeUndefined();
    expect(sanitizeTeam('junk')).toEqual({ playbooks: {}, antistrats: [] });
  });
});
