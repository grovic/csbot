import { describe, expect, it } from 'vitest';
import { buyProbs } from './economy.ts';
import { earliestArrival, expectedInZone, heatGrid, isWalkable, planPosterior, planPrior, siteForecast, topPlan } from './forecast.ts';
import { MIRAGE } from './maps/mirage.ts';
import { engineRoundCall, MIRAGE_PLAYBOOK } from './playbook.ts';

const ecoBuy = buyProbs({ lo: 1450, hi: 2800 });
const fullBuy = buyProbs({ lo: 2750, hi: 4900 }, { saved: true });

describe('plan prior', () => {
  it('sums to 1 and favours the B rush on an eco', () => {
    const prior = planPrior(MIRAGE, ecoBuy);
    expect(Object.values(prior).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(topPlan(prior)).toBe('bRush');
  });
});

describe('plan posterior', () => {
  it('reads 3 seen in B apps at 0:16 as a strong but not certain B hit', () => {
    const post = planPosterior(MIRAGE, planPrior(MIRAGE, ecoBuy), [{ zone: 'bapps', count: 3, t: 16 }]);
    const fc = siteForecast(MIRAGE, post);
    expect(topPlan(post)).toBe('bRush');
    expect(fc.B).toBeGreaterThan(0.9);
    expect(fc.B).toBeLessThan(0.99);
  });

  it('reads palace contact plus a clear B apps as an A hit', () => {
    const prior = planPrior(MIRAGE, fullBuy);
    const afterPalace = siteForecast(MIRAGE, planPosterior(MIRAGE, prior, [{ zone: 'palace', count: 2, t: 20 }]));
    const afterClear = siteForecast(MIRAGE, planPosterior(MIRAGE, prior, [{ zone: 'palace', count: 2, t: 20 }, { zone: 'bapps', count: 0, t: 23 }]));
    expect(afterPalace.A).toBeGreaterThan(0.6);
    expect(afterClear.A).toBeGreaterThan(afterPalace.A);
    expect(afterClear.A).toBeGreaterThan(0.8);
  });

  it('returns the prior when there is no intel', () => {
    const prior = planPrior(MIRAGE, ecoBuy);
    expect(planPosterior(MIRAGE, prior, [])).toBe(prior);
  });
});

describe('timing model', () => {
  it('puts a rushing player in B apps around 0:16', () => {
    const rush = MIRAGE.plans.find(p => p.id === 'bRush')!;
    expect(expectedInZone(MIRAGE, rush, 'bapps', 16)).toBeGreaterThan(2.5);
  });
  it('computes earliest enemy arrivals', () => {
    expect(earliestArrival(MIRAGE, 'topmid')).toBeCloseTo(3.2, 5);
    expect(earliestArrival(MIRAGE, 'bapps')).toBeCloseTo(13.6, 5);
    expect(earliestArrival(MIRAGE, 'nowhere')).toBeUndefined();
  });
});

describe('heat grid', () => {
  it('concentrates in T spawn at the start of the round and stays zero off the map', () => {
    const size = 100, heat = heatGrid(MIRAGE, planPrior(MIRAGE, ecoBuy), 0, { size });
    const at = (x: number, y: number) => heat[Math.floor(y / 10) * size + Math.floor(x / 10)]!;
    expect(at(910, 480)).toBeGreaterThan(0.8);
    expect(isWalkable(MIRAGE, 50, 950)).toBe(false);
    expect(at(50, 950)).toBe(0);
    expect(Math.max(...heat)).toBeLessThanOrEqual(1);
  });
});

describe('engine calls', () => {
  it('stack B on an eco and give every player a job', () => {
    const call = engineRoundCall(MIRAGE_PLAYBOOK, { lo: 1450, hi: 2800, streak: 1, saved: false }, ecoBuy);
    expect(call.setup).toBe('antieco');
    expect(Object.keys(call.jobs).sort()).toEqual(['a', 'awp', 'b', 'rotator', 'short']);
    expect(call.source).toBe('engine');
  });
  it('play standard on a full buy', () => {
    const call = engineRoundCall(MIRAGE_PLAYBOOK, { lo: 2750, hi: 4900, streak: 2, saved: true }, fullBuy);
    expect(call.setup).toBe('std');
    expect(call.head).toBe('Standard 2-1-2');
  });
});
