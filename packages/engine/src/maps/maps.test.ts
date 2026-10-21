import { describe, expect, it } from 'vitest';
import { buyProbs } from '../economy.ts';
import { heatGrid, planPosterior, planPrior, siteForecast } from '../forecast.ts';
import { gridCells, routeThrough, walkableAt, zoneAt } from '../geometry.ts';
import { engineRoundCall, SLOT_IDS } from '../playbook.ts';
import { GEOS, MAP_POOL, MAPS, PLAYBOOKS, slotsFor } from './index.ts';
import { validatePlays } from './validate.ts';
import { GEO_DUST2 } from './geo/de_dust2.ts';
import { PLANS_DUST2, PLAYBOOK_DUST2 } from './plays/de_dust2.ts';

const POOL = ['de_ancient', 'de_anubis', 'de_cache', 'de_dust2', 'de_inferno', 'de_mirage', 'de_nuke'];

describe('map pool', () => {
  it('has the seven competitive maps, each with plans and a playbook', () => {
    expect([...MAP_POOL].sort()).toEqual(POOL);
    for (const id of POOL) {
      expect(MAPS[id], id).toBeDefined();
      expect(PLAYBOOKS[id], id).toBeDefined();
      expect(slotsFor(id).map(s => s.id).sort(), id).toEqual([...SLOT_IDS].sort());
    }
  });
});

describe.each(POOL)('%s geometry', id => {
  const geo = GEOS[id]!;

  it('has both sites, spawns on the floor, and every zone where its label is', () => {
    expect(geo.zones.filter(z => z.site).map(z => z.site).sort()).toEqual(['A', 'B']);
    for (const team of ['T', 'CT'] as const) expect(walkableAt(geo, geo.spawn[team][0], geo.spawn[team][1], 6), team).toBe(true);
    for (const z of geo.zones) {
      expect(zoneAt(geo, z.at[0], z.at[1])?.id, z.id).toBe(z.id);
      expect(z.path.startsWith('M'), z.id).toBe(true);
      expect(z.name.length, z.id).toBeGreaterThan(1);
    }
    expect(new Set(geo.zones.map(z => z.id)).size).toBe(geo.zones.length);
  });

  it('decodes its lookup grid, mostly empty around the map', () => {
    const cells = gridCells(geo);
    const floor = cells.reduce((n, v) => n + (v ? 1 : 0), 0);
    expect(floor / cells.length).toBeGreaterThan(0.1);
    expect(floor / cells.length).toBeLessThan(0.7);
  });

  it('gives sensible earliest arrivals: Ts reach a site in 6-25 s, CTs first', () => {
    for (const site of ['asite', 'bsite']) {
      const [t, ct] = geo.arrive[site]!;
      expect(t, site).toBeGreaterThan(6);
      expect(t, site).toBeLessThan(25);
      expect(ct, site).toBeLessThan(t);
    }
    expect(geo.arrive.tspawn?.[0]).toBe(0);
    expect(geo.arrive.ctspawn?.[1]).toBe(0);
  });

  it('walks from either spawn to both sites', () => {
    for (const from of ['T', 'CT'] as const) {
      for (const site of ['asite', 'bsite']) {
        const r = routeThrough(geo, from, [site]);
        const last = r[r.length - 1]!;
        expect(zoneAt(geo, last[0], last[1])?.id, `${from}→${site}`).toBe(site);
        expect(last[2]).toBeGreaterThan(0);
        expect(last[2]).toBeLessThan(40);
      }
    }
  });
});

describe.each(POOL)('%s plays', id => {
  const model = MAPS[id]!;

  it('pass the plays checks', async () => {
    const mod = await import(`./plays/${id}.ts`) as Record<string, unknown>;
    const plans = Object.values(mod).find(v => (v as { routes?: unknown }).routes) as Parameters<typeof validatePlays>[1];
    const playbook = Object.values(mod).find(v => (v as { setups?: unknown }).setups) as Parameters<typeof validatePlays>[2];
    expect(validatePlays(GEOS[id]!, plans, playbook)).toEqual([]);
  });

  it('forecast: an eco prior and a full-buy prior both cover both sites; heat stays on the floor', () => {
    for (const buy of [buyProbs({ lo: 1400, hi: 2700 }), buyProbs({ lo: 2800, hi: 5000 }, { saved: true })]) {
      const s = siteForecast(model, planPrior(model, buy));
      expect(s.A + s.B).toBeCloseTo(1, 6);
      expect(s.A).toBeGreaterThan(0.1);
      expect(s.B).toBeGreaterThan(0.1);
    }
    const heat = heatGrid(model, planPrior(model, buyProbs({ lo: 1400, hi: 2700 })), 20, { size: 100 });
    let off = 0;
    for (let j = 0; j < 100; j++) for (let i = 0; i < 100; i++) if (heat[j * 100 + i]! > 0 && !walkableAt(model.geo, i * 10 + 5, j * 10 + 5, 12)) off++;
    expect(off).toBe(0);
    expect(Math.max(...heat)).toBeGreaterThan(0.3);
  });

  it('our T halves: their CT setups cover both sites, intel of a stack points at the other site', () => {
    const ct = model.ct!;
    expect(ct.intelFit).toBe('holds');
    const prior = planPrior(ct, buyProbs({ lo: 2800, hi: 5000 }, { saved: true }));
    const s = siteForecast(ct, prior);
    expect(s.A + s.B).toBeCloseTo(1, 6);
    expect(Math.abs(s.A - 0.5)).toBeLessThan(0.2); // no strong lean before any intel
    const heat = heatGrid(ct, prior, 15, { size: 100 });
    expect(Math.max(...heat)).toBeGreaterThan(0.3);
    // Four defenders seen on B: A becomes the lighter site, and the reverse.
    expect(siteForecast(ct, planPosterior(ct, prior, [{ zone: 'bsite', count: 4, t: 20 }])).A).toBeGreaterThan(0.6);
    expect(siteForecast(ct, planPosterior(ct, prior, [{ zone: 'asite', count: 4, t: 20 }])).B).toBeGreaterThan(0.6);
  });

  it('engine calls pick the anti-eco setup on an eco and give all five slots a job', () => {
    const pb = PLAYBOOKS[id]!;
    const eco = engineRoundCall(pb, { lo: 1400, hi: 2700, streak: 1, saved: false }, buyProbs({ lo: 1400, hi: 2700 }));
    expect(pb.setups.find(s => s.id === eco.setup)?.answers).toContain('eco');
    expect(Object.keys(eco.jobs).sort()).toEqual([...SLOT_IDS].sort());
    const full = engineRoundCall(pb, { lo: 2800, hi: 5000, streak: 2, saved: true }, buyProbs({ lo: 2800, hi: 5000 }, { saved: true }));
    expect(pb.setups.find(s => s.id === full.setup)?.answers).toBeUndefined();
    for (const s of pb.setups) for (const sp of s.spots) expect(walkableAt(model.geo, sp.at[0], sp.at[1], 8), `${s.id}/${sp.player}`).toBe(true);
  });
});

describe('validatePlays', () => {
  it('reports broken plays in words', () => {
    const bad = { ...PLANS_DUST2, routes: { ...PLANS_DUST2.routes, X: ['topofmid'] }, plans: [...PLANS_DUST2.plans, { id: 'x', name: 'x', site: 'A' as const, speed: 1.4, lineup: ['X'], delay: [0] }] };
    const out = validatePlays(GEO_DUST2, bad, { ...PLAYBOOK_DUST2, slots: PLAYBOOK_DUST2.slots.slice(0, 4) });
    expect(out).toEqual(expect.arrayContaining([
      'route X should end on a bomb site (ends at topofmid)',
      'plan x needs 5 players and 5 delays',
      'plan x: speed is a share of knife speed (0-1]',
      expect.stringMatching(/^planPriorByBuy\.eco misses plan x$/),
      'slots must be a, short, b, rotator, awp',
    ]));
  });
});
