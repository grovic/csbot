// Invariants of the 2D replay on a real CS2 demo (see demo.test.ts for where to get it). Skipped without it.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { DemoReplay, DemoTruth } from '@csbot/protocol';
import { parseDemo, parseReplay } from '../src/index.ts';

const DEMO = fileURLToPath(new URL('../testdata/test_demo.dem', import.meta.url));

describe.skipIf(!existsSync(DEMO))('a real CS2 demo as a 2D replay', () => {
  let replay: DemoReplay;
  let truth: DemoTruth;
  let ms = 0;
  beforeAll(() => {
    const t0 = performance.now();
    replay = parseReplay(DEMO);
    ms = performance.now() - t0;
    truth = parseDemo(DEMO);
  });

  it('parses in a few seconds into a few hundred KB of JSON', () => {
    expect(ms).toBeLessThan(10_000);
    expect(replay.map).toBe(truth.map);
    expect(Buffer.byteLength(JSON.stringify(replay))).toBeLessThan(1_000_000);
  });

  it('has parseDemo\'s rounds, with the same players on the same sides', () => {
    expect(replay.rounds.map(r => r.round)).toEqual(truth.rounds.map(r => r.round));
    for (const [i, r] of replay.rounds.entries()) {
      const side = new Map(r.players.map(p => [p.steamid, p.side]));
      for (const p of truth.rounds[i]!.players) expect([r.round, p.steamid, side.get(p.steamid)]).toEqual([r.round, p.steamid, p.side]);
      expect(r.players.length).toBeLessThanOrEqual(10);
      for (const p of r.players) expect(p.name).not.toBe('');
    }
  });

  it('has duration × hz + 1 frames of finite positions and hp per player', () => {
    for (const r of replay.rounds) {
      expect(r.hz).toBe(4);
      expect(r.duration).toBeGreaterThan(0);
      expect(r.duration).toBeLessThanOrEqual(175);
      expect(r.frames).toHaveLength(r.duration * r.hz + 1);
      const bad: string[] = [];
      r.frames.forEach((f, i) => {
        if (f.length !== r.players.length * 4) bad.push(`frame ${i}: ${f.length} numbers`);
        f.forEach((v, k) => {
          // x, y, z: integers inside the world; hp: 0-100
          const ok = Number.isInteger(v) && (k % 4 === 3 ? v >= 0 && v <= 100 : Math.abs(v) < 16_384);
          if (!ok) bad.push(`frame ${i}[${k}] = ${v}`);
        });
      });
      expect(bad, `round ${r.round}`).toEqual([]);
    }
  });

  it('shows a killed player alive before the kill and at 0 hp from half a second after it', () => {
    let checked = 0;
    for (const r of replay.rounds) {
      for (const k of r.kills) {
        const j = r.players.findIndex(p => p.steamid === k.victim);
        expect(j, `round ${r.round}: ${k.victim}`).toBeGreaterThanOrEqual(0);
        r.frames.forEach((f, i) => {
          const t = i / r.hz;
          if (t > k.t + 0.5) expect(f[j * 4 + 3], `round ${r.round} ${k.victim} at ${t}`).toBe(0);
          if (t < k.t - 0.5) expect(f[j * 4 + 3], `round ${r.round} ${k.victim} at ${t}`).toBeGreaterThan(0);
        });
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(replay.rounds.length * 3);
  });

  it('times kills like parseDemo\'s deaths', () => {
    for (const [i, r] of replay.rounds.entries()) {
      const deaths = truth.rounds[i]!.deaths;
      for (const k of r.kills) {
        expect(k.t).toBeLessThanOrEqual(r.duration);
        const d = deaths.find(x => x.steamid === k.victim);
        expect(d && [d.t, d.killer, d.weapon]).toEqual([k.t, k.killer, k.weapon]);
      }
      // Only deaths after the replay's end (post-round, past the 3 s tail) are left out.
      for (const d of deaths) if (d.t <= r.duration) expect(r.kills.some(k => k.victim === d.steamid)).toBe(true);
    }
  });

  it('keeps the plant and grenades inside the round, with smokes and their real duration', () => {
    for (const [i, r] of replay.rounds.entries()) {
      const t = truth.rounds[i]!;
      if (r.plant) {
        expect(r.plant.t).toBeGreaterThanOrEqual(0);
        expect(r.plant.t).toBeLessThanOrEqual(r.duration);
        expect(r.plant.site).toBe(t.plantSite);
      } else {
        expect(t.plantSite).toBeUndefined();
      }
      for (const n of r.nades) {
        expect(n.t).toBeGreaterThanOrEqual(0);
        expect(n.t).toBeLessThanOrEqual(r.duration);
        for (const v of [n.x, n.y, n.z]) expect(Number.isInteger(v)).toBe(true);
        if (n.kind === 'smoke' || n.kind === 'molotov') expect(n.duration).toBeGreaterThan(0);
        else expect(n.duration).toBeUndefined();
      }
    }
    const smokes = replay.rounds.flatMap(r => r.nades.filter(n => n.kind === 'smoke'));
    expect(smokes.length).toBeGreaterThan(0);
    // Most smokes have their smokegrenade_expired (about 22 s in CS2); the rest were cut by the round reset.
    expect(smokes.filter(s => s.duration! > 21 && s.duration! < 23).length).toBeGreaterThan(smokes.length / 2);
  });
});
