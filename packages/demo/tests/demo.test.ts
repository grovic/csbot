// Invariants on a real CS2 demo. The demo is not in the repo (60 MB, real players): download
// https://raw.githubusercontent.com/LaihoE/demoparser/main/src/parser/test_demo.dem (MIT) to
// packages/demo/testdata/test_demo.dem to run these. Without it they are skipped.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEvent, parseTicks } from '@laihoe/demoparser2';
import { beforeAll, describe, expect, it } from 'vitest';
import type { DemoTruth, Side } from '@csbot/protocol';
import { parseDemo, teamScore } from '../src/index.ts';

const DEMO = fileURLToPath(new URL('../testdata/test_demo.dem', import.meta.url));
const other = (s: Side): Side => (s === 'T' ? 'CT' : 'T');

describe.skipIf(!existsSync(DEMO))('a real CS2 demo', () => {
  let truth: DemoTruth;
  let ms = 0;
  beforeAll(() => {
    const t0 = performance.now();
    truth = parseDemo(DEMO);
    ms = performance.now() - t0;
  });

  it('parses in a few seconds', () => {
    expect(ms).toBeLessThan(10_000);
    expect(truth.source.bytes).toBeGreaterThan(1e6);
    expect(truth.map).toMatch(/^de_/);
  });

  it('has as many rounds as the final score, won by the right teams', () => {
    // The score as the game kept it (team entities), read independently of the parser.
    const lastEnd = Math.max(...(parseEvent(DEMO, 'round_end') as { tick: number }[]).map(e => e.tick));
    const window = Array.from({ length: 65 }, (_, i) => lastEnd + i);
    const rows = parseTicks(DEMO, ['team_num', 'team_rounds_total'], window) as { tick: number; team_num?: number; team_rounds_total?: number }[];
    const score: Record<number, number> = {};
    for (const r of rows) if (r.team_num === 2 || r.team_num === 3) score[r.team_num] = Math.max(score[r.team_num] ?? 0, r.team_rounds_total ?? 0);
    const total = (score[2] ?? 0) + (score[3] ?? 0);
    expect(total).toBeGreaterThan(0);
    expect(truth.rounds).toHaveLength(total);
    expect(truth.rounds.map(r => r.round)).toEqual(truth.rounds.map((_, i) => i + 1));
    const s = teamScore(truth);
    // The team that started T is team_num 2 again only after an even number of swaps; compare as a set.
    expect([s.startedT, s.startedCT].sort()).toEqual([score[2] ?? 0, score[3] ?? 0].sort());
  });

  it('has 10 players and 5 a side in every round that was played out', () => {
    expect(truth.players).toHaveLength(10);
    expect(truth.players.filter(p => p.startSide === 'T')).toHaveLength(5);
    for (const r of truth.rounds) {
      const t = r.players.filter(p => p.side === 'T').length;
      const ct = r.players.filter(p => p.side === 'CT').length;
      // A team usually surrenders because someone left, so that round may be short-handed.
      if (r.reason === 'surrender') {
        expect(t).toBeLessThanOrEqual(5);
        expect(ct).toBeLessThanOrEqual(5);
      } else {
        expect([r.round, t, ct]).toEqual([r.round, 5, 5]);
      }
    }
  });

  it('keeps money in range, with 800 in the pistol rounds', () => {
    for (const r of truth.rounds) {
      for (const p of r.players) {
        for (const v of [p.startMoney, p.spent, p.equipValue]) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(16_000);
        }
        if (r.round === 1 || r.round === 13) expect(p.startMoney).toBe(800);
      }
    }
  });

  it('places every death in the round with a position and a time', () => {
    let total = 0;
    for (const r of truth.rounds) {
      const victims = r.deaths.map(d => d.steamid);
      expect(new Set(victims).size).toBe(victims.length); // one death per player per round
      for (const d of r.deaths) {
        for (const v of [d.x, d.y, d.z]) expect(Number.isFinite(v)).toBe(true);
        expect(d.t).toBeGreaterThanOrEqual(0);
        expect(d.t).toBeLessThanOrEqual(175);
        expect(['T', 'CT']).toContain(d.side);
        total++;
      }
    }
    expect(total).toBeGreaterThan(truth.rounds.length * 3);
  });

  it('plants only on A or B, and every bomb or defuse round had a plant', () => {
    for (const r of truth.rounds) {
      if (r.plantAt) expect(['A', 'B']).toContain(r.plantSite);
      if (r.reason === 'bomb' || r.reason === 'defuse') expect(r.plantSite, `round ${r.round}`).toBeDefined();
    }
  });

  it('keeps sides through a half and swaps them at the half', () => {
    const start = new Map(truth.players.map(p => [p.steamid, p.startSide]));
    for (const r of truth.rounds) {
      if (r.round > 24) continue; // overtime has its own halves
      for (const p of r.players) {
        const s = start.get(p.steamid)!;
        expect(p.side).toBe(r.round <= 12 ? s : other(s));
      }
    }
  });
});
