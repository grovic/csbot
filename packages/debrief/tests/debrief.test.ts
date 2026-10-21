import { MatchTracker } from '@csbot/engine';
import { FULL_MATCH, syntheticMatch, toGameState } from '@csbot/gsi';
import type { DemoTruth, MatchRecord } from '@csbot/protocol';
import { describe, expect, it } from 'vitest';
import { buyKind, debriefStats, MatchRecorder } from '../src/index.ts';

/** The synthetic full match (fictional), recorded the way the desktop host does it. */
function recordMatch(): { rec: MatchRecord; finished: MatchRecord[] } {
  const finished: MatchRecord[] = [];
  const t = new MatchTracker({ playbookHandle: 'a' });
  const r = new MatchRecorder({ onFinish: x => finished.push(x) });
  for (const { t: at, p } of syntheticMatch({ rounds: FULL_MATCH, lean: true })) {
    t.ingest(toGameState(p, at));
    r.observe(t.snapshot(at));
  }
  return { rec: r.record!, finished };
}

describe('match recorder', () => {
  it('records every round of a full match with buys, estimates, calls and the result', () => {
    const { rec, finished } = recordMatch();
    expect(rec.finished).toBe(true);
    expect(finished).toHaveLength(1);
    expect(rec.map).toBe('de_mirage');
    expect(rec.me?.name).toBeTruthy();
    const n = rec.score.us + rec.score.them;
    expect(rec.rounds).toHaveLength(n);
    expect(rec.rounds.map(r => r.round)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
    for (const r of rec.rounds) {
      expect(r.winner, `round ${r.round}`).toMatch(/^(us|them)$/);
      expect(r.side).toMatch(/^(CT|T)$/);
    }
    expect(rec.rounds[0]!.ourBuy).toBe('pistol');
    expect(rec.rounds.filter(r => r.enemy).length).toBeGreaterThan(n - 3);
    expect(rec.rounds.filter(r => r.call).length).toBeGreaterThan(n - 3);
    expect(rec.rounds[0]!.side).not.toBe(rec.rounds[13]!.side); // halves swap
    expect(rec.totals?.kills).toBeGreaterThan(0);
  });

  it('starts a new record for a new match', () => {
    const t = new MatchTracker();
    const r = new MatchRecorder();
    const first = syntheticMatch({ rounds: FULL_MATCH.slice(0, 2), lean: true });
    for (const { t: at, p } of first) { t.ingest(toGameState(p, at)); r.observe(t.snapshot(at)); }
    const id1 = r.record!.id;
    const t2 = new MatchTracker();
    const start = first[first.length - 1]!.t + 3600_000;
    for (const { t: at, p } of syntheticMatch({ rounds: FULL_MATCH.slice(0, 2), lean: true, map: 'de_dust2', start })) { t2.ingest(toGameState(p, at)); r.observe(t2.snapshot(at)); }
    expect(r.record!.id).not.toBe(id1);
    expect(r.record!.map).toBe('de_dust2');
  });
});

describe('debrief stats', () => {
  it('rates the player, splits wins by side and by our buy', () => {
    const { rec } = recordMatch();
    const s = debriefStats(rec);
    expect(s.rounds).toBe(rec.score.us + rec.score.them);
    expect(s.won).toBe(rec.score.us);
    expect(s.rating).toBeGreaterThan(0.2);
    expect(s.rating).toBeLessThan(3);
    expect(s.bySide.CT.played + s.bySide.T.played).toBe(s.rounds);
    expect(Object.values(s.byBuy).reduce((n, t) => n + t!.played, 0)).toBeGreaterThan(s.rounds - 3);
    expect(s.truth).toBeUndefined();
  });

  it('compares the estimates with the demo truth', () => {
    const { rec } = recordMatch();
    const me = rec.me!.steamid;
    // A fictional truth: enemies always hold exactly the middle of our band, and buy what we read.
    const truth: DemoTruth = {
      source: { file: 'fixture.dem', parsedAt: 0, bytes: 0 }, map: rec.map, players: [],
      rounds: rec.rounds.map(r => {
        const enemySide = r.side === 'CT' ? 'T' : 'CT';
        const mid = r.enemy ? (r.enemy.lo + r.enemy.hi) / 2 : 800;
        const equip = r.round === 1 || r.round === 13 ? 700 : r.enemy?.read === 'eco' ? 500 : r.enemy?.read === 'full' ? 4800 : 3000;
        return {
          round: r.round, winner: r.winner === 'us' ? r.side : enemySide,
          players: Array.from({ length: 5 }, (_, i) => ({ steamid: `e${i}`, side: enemySide, startMoney: mid, equipValue: equip, spent: 0 })),
          ...(r.side === 'CT' && r.planted ? { plantSite: (r.forecast && r.forecast.site.B >= r.forecast.site.A ? 'B' : 'A') as 'A' | 'B' } : {}),
          deaths: [{ steamid: 'e0', side: enemySide, t: 12, x: 0, y: 0, z: 0 }, { steamid: me, side: r.side, t: 30, x: 100, y: 200, z: 0, weapon: 'ak47' }],
        };
      }),
    };
    const s = debriefStats({ ...rec, truth });
    const t = s.truth!;
    expect(t.rounds).toBe(rec.rounds.length);
    expect(t.band.inside).toBe(t.band.total);
    expect(t.openings.won).toBe(t.openings.total);
    expect(t.myDeaths).toHaveLength(rec.rounds.length);
    expect(t.enemyMoney[0]).toMatchObject({ round: 1, truthBuy: 'pistol' });
    expect(t.siteRead.correct).toBe(t.siteRead.total);
    expect(t.buyRead.correct / t.buyRead.total).toBeGreaterThan(0.6);
  });

  it('classifies buys from equipment value', () => {
    expect(buyKind(700, 'T', true)).toBe('pistol');
    expect(buyKind(4500, 'CT', false)).toBe('full');
    expect(buyKind(3800, 'T', false)).toBe('full');
    expect(buyKind(3000, 'CT', false)).toBe('half');
    expect(buyKind(1800, 'CT', false)).toBe('force');
    expect(buyKind(400, 'T', false)).toBe('eco');
  });
});
