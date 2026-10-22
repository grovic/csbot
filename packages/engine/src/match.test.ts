import { FIRST_HALF, FULL_MATCH, syntheticMatch, toGameState, type RecordedPayload } from '@csbot/gsi';
import type { LiveSnapshot } from '@csbot/protocol';
import { describe, expect, it } from 'vitest';
import { isHalfStart, isWingman, MatchTracker, phaseOf, youTile } from './match.ts';
import { slotsFor } from './maps/index.ts';

/** Feed a recording; return the snapshot taken right after each payload. */
function run(rec: RecordedPayload[], t = new MatchTracker({ playbookHandle: 'a' })) {
  const snaps: LiveSnapshot[] = [];
  for (const { t: at, p } of rec) { t.ingest(toGameState(p, at)); snaps.push(t.snapshot(at)); }
  return { tracker: t, snaps, last: snaps[snaps.length - 1]! };
}

/** First snapshot of a given round in a given phase. */
const at = (snaps: LiveSnapshot[], round: number, phase: string) => snaps.find(s => s.match?.round === round && s.match.clock.phase === phase)!;

describe('MatchTracker on a full synthetic match', () => {
  for (const lean of [false, true]) {
    describe(lean ? 'lean payloads (no round_wins, no phase_countdowns)' : 'rich payloads', () => {
      const { snaps, last } = run(syntheticMatch({ rounds: FULL_MATCH, lean }));

      it('rebuilds every round result, with sides swapping at the half', () => {
        const h = last.match!.history;
        expect(h).toHaveLength(FULL_MATCH.length);
        h.forEach((r, i) => {
          expect(r.round).toBe(i + 1);
          expect(r.winner).toBe(FULL_MATCH[i]!.winner);
          expect(r.reason).toBe(FULL_MATCH[i]!.reason);
          expect(r.ourSide).toBe(i < 12 ? 'CT' : 'T');
          expect(!!r.inferred).toBe(lean);
        });
        expect(last.match!.score).toEqual({ us: 13, them: 8 });
        expect(last.match!.clock.phase).toBe('gameover');
      });

      it('reads pistol rounds and resets enemy money at the half', () => {
        expect(at(snaps, 1, 'freezetime').enemy!.read).toBe('pistol');
        expect(at(snaps, 13, 'freezetime').enemy!.read).toBe('pistol');
        expect(at(snaps, 13, 'freezetime').match!.pistolRound).toBe(true);
        expect(at(snaps, 13, 'freezetime').match!.ourSide).toBe('T');
        // We won the pistol round, so they lost: round 2 should read as an eco.
        const r2 = at(snaps, 2, 'freezetime').enemy!;
        expect(r2.read).toBe('eco');
        expect(r2.hi).toBeLessThan(2600);
      });

      it('times phases, from the game or derived', () => {
        const fz = at(snaps, 5, 'freezetime').match!.clock;
        expect(fz.source).toBe(lean ? 'derived' : 'gsi');
        expect(fz.endsIn).toBeGreaterThan(15);
        expect(fz.endsIn).toBeLessThanOrEqual(20);
        const bomb = at(snaps, 3, 'bomb').match!;
        expect(bomb.bombPlanted).toBe(true);
        expect(bomb.clock.endsIn).toBeGreaterThan(30);
      });
    });
  }
});

describe('round ends as CS2 sends them (real match, 2026-10-21)', () => {
  // The half's last round ends in a payload that's already intermission, the match's last round in a
  // gameover payload, and an exploded bomb is never reported.
  const { snaps, last } = run(syntheticMatch({ rounds: FULL_MATCH, lean: true, cs2Ends: true }));

  it('records every round, including the last of each half', () => {
    const h = last.match!.history;
    expect(h.map(r => r.round)).toEqual(FULL_MATCH.map((_, i) => i + 1));
    h.forEach((r, i) => {
      expect(r.winner).toBe(FULL_MATCH[i]!.winner);
      expect(r.ourSide).toBe(i < 12 ? 'CT' : 'T');
    });
    expect(last.match!.score).toEqual({ us: 13, them: 8 });
    expect(last.match!.clock.phase).toBe('gameover');
    expect(last.call?.head).toBe('Match won 13–8');
  });

  it('infers a bomb win from the timer when the game only clears round.bomb', () => {
    const h = last.match!.history;
    FULL_MATCH.forEach((rd, i) => { if (rd.reason === 'bomb' || rd.reason === 'defuse') expect(h[i]!.reason).toBe(rd.reason); });
    expect(FULL_MATCH.some(rd => rd.reason === 'bomb')).toBe(true);
  });

  it('credits a lost pistol round with $1,900', () => {
    // We won round 1, so round 2's enemy band starts from their pistol loss.
    expect(FULL_MATCH[0]!.winner).toBe('us');
    const r2 = at(snaps, 2, 'freezetime').enemy!;
    expect(r2.lo).toBe(1900);
    expect(r2.read).toBe('eco');
  });
});

describe('calls and the YOU line', () => {
  const { snaps } = run(syntheticMatch({ rounds: FIRST_HALF }));

  it('uses the Mirage playbook on CT and gives us our own job', () => {
    const c = at(snaps, 2, 'freezetime').call!;
    expect(c.kind).toBe('pre');
    expect(c.source).toBe('engine');
    expect(c.head).toBe('Anti-eco · stack B');
    expect(c.you).toMatch(/^A site/);
    expect(at(snaps, 2, 'freezetime').setupSpots).toHaveLength(5);
  });

  it('switches to a post-plant call and then a round result', () => {
    expect(at(snaps, 3, 'bomb').call!.kind).toBe('post');
    const over = at(snaps, 3, 'over').call!;
    expect(over.kind).toBe('over');
    expect(over.head).toBe('Round lost');
  });

  it('on T side: our T playbook call, our job, planned spots, and the read on their CT setup', () => {
    const { snaps: t } = run(syntheticMatch({ rounds: FIRST_HALF, ourSide: 'T' }));
    const s = at(t, 2, 'freezetime');
    expect(s.call!.setup).toMatch(/^t(Default|ExecA|ExecB|Eco|Force)$/);
    expect(s.call!.you).toBeTruthy();
    expect(Object.keys(s.call!.jobs).sort()).toEqual(['a', 'awp', 'b', 'rotator', 'short']);
    expect(s.setupSpots).toHaveLength(5);
    expect(s.call!.why[0]).toMatch(/^Your money \$[\d,]+ → /);
    const f = s.forecast!;
    expect(f.enemy).toBe('CT');
    expect(f.basis).toBe('prior');
    expect(f.site.A + f.site.B).toBeCloseTo(1, 6);
    expect(Object.keys(f.plans)).toEqual(expect.arrayContaining(['default', 'stackA', 'stackB']));
  });

  it('on T side: pistol rounds stay generic', () => {
    const { snaps: t } = run(syntheticMatch({ rounds: FIRST_HALF, ourSide: 'T' }));
    expect(at(t, 1, 'freezetime').call!.head).toBe('Pistol round');
  });

  it('on T side: intel of a B stack turns the call to "A likely light"', () => {
    const t = new MatchTracker({ playbookHandle: 'a' });
    let live: { at: number } | undefined;
    for (const { t: ts, p } of syntheticMatch({ rounds: FIRST_HALF, ourSide: 'T' })) {
      t.ingest(toGameState(p, ts));
      const s = t.snapshot(ts);
      if (s.match?.round === 3 && s.match.clock.phase === 'live') { live = { at: ts }; break; }
    }
    expect(live).toBeDefined();
    t.addIntel({ zone: 'bsite', count: 3, by: 'kairo', at: live!.at + 20_000 });
    const s = t.snapshot(live!.at + 20_000);
    expect(s.forecast!.basis).toBe('intel');
    expect(s.forecast!.site.A).toBeGreaterThan(0.7);
    expect(s.call!.kind).toBe('mid');
    expect(s.call!.head).toMatch(/^A likely light · \d+%$/);
    expect(s.call!.steps[0]).toBe('Go A');
    // Our A exec takes over: its jobs, our job as the YOU line, its planned spots.
    expect(s.call!.setup).toBe('tExecA');
    expect(s.call!.you).toBeTruthy();
    expect(s.setupSpots).toHaveLength(5);
  });

  it('forecasts the enemy plan from the buy read on CT', () => {
    const f = at(snaps, 2, 'freezetime').forecast!;
    expect(f.basis).toBe('prior');
    expect(f.site.B).toBeGreaterThan(f.site.A);
    expect(f.topPlan.id).toBe('bRush');
  });
});

describe('own player, spectating and the scoreboard', () => {
  const { snaps, last } = run(syntheticMatch({ rounds: FIRST_HALF }));

  it('marks us dead and follows the watched teammate', () => {
    const dead = snaps.find(s => s.match?.round === 3 && s.me?.observing)!;
    expect(dead.me!.alive).toBe(false);
    expect(dead.me!.observing!.name).toBe('mbt');
    expect(dead.youTile!.value).toBe('DEAD');
    const back = at(snaps, 4, 'freezetime');
    expect(back.me!.alive).toBe(true);
    expect(back.me!.observing).toBeUndefined();
  });

  it('keeps spectated teammates on the scoreboard with the round they were seen', () => {
    const rows = last.scoreboard;
    const me = rows.find(r => r.isMe)!;
    expect(me.source).toBe('host');
    expect(me.name).toBe('rdx');
    expect(me.adr).toBeGreaterThan(0);
    const spec = rows.filter(r => r.source === 'spectated');
    expect(spec.map(r => r.name).sort()).toEqual(['mbt', 'nyx']);
    expect(spec.every(r => (r.seenRound ?? 0) >= 3)).toBe(true);
  });

  it('writes a ticker, newest first', () => {
    expect(last.ticker[0]!.text).toBe('Match over · 8–4');
    expect(last.ticker[1]!.tag).toBe('ROUND 12');
    expect(last.ticker.length).toBeLessThanOrEqual(20);
  });
});

describe('connection and match lifecycle', () => {
  it('reports waiting, live and stale', () => {
    const t = new MatchTracker();
    expect(t.snapshot(0).connection.gsi).toBe('waiting');
    const rec = syntheticMatch({ rounds: FIRST_HALF.slice(0, 1) });
    const { t: at0, p } = rec[0]!;
    t.ingest(toGameState(p, at0));
    expect(t.snapshot(at0 + 1000).connection.gsi).toBe('live');
    expect(t.snapshot(at0 + 16_000).connection.gsi).toBe('stale');
  });

  it('resets on a new map', () => {
    const t = new MatchTracker();
    run(syntheticMatch({ rounds: FIRST_HALF.slice(0, 3) }), t);
    const { last } = run(syntheticMatch({ rounds: FIRST_HALF.slice(0, 1), map: 'de_vertigo', start: Date.UTC(2026, 9, 22) }), t);
    expect(last.match!.map).toBe('de_vertigo');
    expect(last.match!.history).toHaveLength(1);
    expect(last.forecast).toBeUndefined(); // no map model for Inferno yet
  });

  it('uses a wide money band when joining mid-half', () => {
    const rec = syntheticMatch({ rounds: FIRST_HALF, lean: true });
    const from = rec.findIndex(r => r.p.map?.round === 5);
    const { snaps } = run(rec.slice(from));
    const e = at(snaps, 6, 'freezetime').enemy!;
    expect(e.hi - e.lo).toBeGreaterThan(4000);
    expect(at(snaps, 6, 'freezetime').ticker[0]!.text).toMatch(/joined mid-half/);
  });

  it('counts guard drops', () => {
    const t = new MatchTracker();
    t.noteGuardDrops(2);
    expect(t.snapshot().connection.guardDropped).toBe(2);
  });
});

describe('Wingman (2v2)', () => {
  const rec = syntheticMatch({ rounds: FULL_MATCH.slice(0, 16), lean: true, mode: 'scrimcomp2v2', map: 'de_inferno' });
  const { snaps, last } = run(rec);

  it('8-round halves: sides swap after round 8', () => {
    expect(isWingman(last.match!.mode)).toBe(true);
    expect(last.match!.halfLength).toBe(8);
    const h = last.match!.history;
    expect(h).toHaveLength(16);
    expect(h[7]!.ourSide).toBe('CT');
    expect(h[8]!.ourSide).toBe('T');
    expect(at(snaps, 9, 'freezetime').call!.head).toMatch(/pistol/i); // round 9 is the second half's pistol
  });

  it("no five-player site forecast or setup; money calls; Wingman's 1:30 rounds", () => {
    const live3 = at(snaps, 3, 'live');
    expect(live3.forecast).toBeUndefined();
    expect(live3.setupSpots).toBeUndefined();
    const pre = at(snaps, 3, 'freezetime').call!;
    expect(pre.kind).toBe('pre');
    expect(pre.setup).toBeFalsy();
    // Lean payloads have no countdown: the clock comes from Wingman's round time.
    expect(live3.match!.clock.endsIn).toBeGreaterThan(80);
    expect(live3.match!.clock.endsIn).toBeLessThanOrEqual(90);
  });

  it('two positions', () => {
    expect(slotsFor('de_inferno', 'CT', 'scrimcomp2v2').map(s => s.id)).toEqual(['a', 'b']);
    expect(slotsFor('de_inferno', 'CT', 'competitive')).toHaveLength(5);
  });
});

describe('helpers', () => {
  it('knows where halves start, including MR3 overtime', () => {
    expect([1, 13, 25, 28, 31].map(r => isHalfStart(r, 12).start)).toEqual([true, true, true, true, true]);
    expect([2, 12, 24, 26, 27].map(r => isHalfStart(r, 12).start)).toEqual([false, false, false, false, false]);
    expect(isHalfStart(25, 12).overtime).toBe(true);
    expect(isHalfStart(9, 8).start).toBe(true); // wingman
  });

  it('maps GSI phases to banner phases', () => {
    const base = { at: 0, roundWins: {} };
    expect(phaseOf({ ...base, mapName: 'de_mirage', mapPhase: 'live', roundPhase: 'live', bomb: 'planted' })).toBe('bomb');
    expect(phaseOf({ ...base, mapName: 'de_mirage', mapPhase: 'intermission', roundPhase: 'over' })).toBe('halftime');
    expect(phaseOf({ ...base, mapName: 'de_mirage', mapPhase: 'warmup' })).toBe('warmup');
    expect(phaseOf(base)).toBe('idle');
  });

  it('advises the buy', () => {
    const me = { steamid: 'x', name: 'x', alive: true, health: 100, armor: 0, helmet: false, money: 5400, equipValue: 0, roundKills: 0, roundDamage: 0 };
    expect(youTile(me, 'freezetime', 'CT', 0, 5400, false)!.value).toBe('FULL BUY');
    expect(youTile({ ...me, money: 3300 }, 'freezetime', 'CT', 0, 3300, false)!.value).toBe('RIFLE');
    expect(youTile({ ...me, money: 1200 }, 'freezetime', 'CT', 0, 1200, false)!.value).toBe('SAVE');
    expect(youTile({ ...me, money: 800 }, 'freezetime', 'CT', 0, 800, true)!.value).toBe('PISTOL');
    expect(youTile({ ...me, money: 900, primary: 'weapon_m4a1' }, 'freezetime', 'CT', 0, 900, false)!.value).toBe('REFILL');
    // Bought already: the tile turns into the "if lost" advice.
    expect(youTile({ ...me, money: 400 }, 'freezetime', 'CT', 2, 5000, false)!.label).toBe('If round is lost');
    expect(youTile({ ...me, money: 2500 }, 'live', 'CT', 2, undefined, false)!.value).toBe('PLAY ON');
    expect(youTile({ ...me, money: 200 }, 'live', 'CT', 0, undefined, false)!.value).toBe('SAVE');
    expect(youTile({ ...me, alive: false }, 'live', 'CT', 0, undefined, false)!.value).toBe('DEAD');
  });
});

describe('review fixes', () => {
  const { snaps, last } = run(syntheticMatch({ rounds: FULL_MATCH }));
  it('ends with the match result, not a next-round read', () => {
    expect(last.call!.head).toBe('Match won 13–8');
  });
  it('does not count a lost pistol round as a save', () => {
    expect(at(snaps, 2, 'freezetime').enemy!.saved).toBe(false);
  });
  it('turns the YOU line into "watch and call" after dying', () => {
    const dead = snaps.find(s => s.match?.round === 3 && s.me?.observing)!;
    expect(dead.call!.you).toMatch(/^You're dead\. Watch mbt/);
  });
  it('spends money like a player in the synthetic match', () => {
    const fz = snaps.filter(s => s.match?.clock.phase === 'freezetime' && s.me);
    expect(fz.some(s => s.me!.money >= 1000)).toBe(true);
  });
});

describe('intel', () => {
  /** Snapshots of a lean full match, and a tracker paused live in a given round. */
  function liveIn(round: number) {
    const t = new MatchTracker({ playbookHandle: 'a' });
    const rec = syntheticMatch({ rounds: FULL_MATCH, lean: true });
    let at = 0;
    for (const { t: ts, p } of rec) {
      t.ingest(toGameState(p, ts));
      at = ts;
      const s = t.snapshot(ts);
      if (s.match?.round === round && s.match.clock.phase === 'live') break;
    }
    return { t, at };
  }

  it('refuses intel outside a live round or for unknown zones', () => {
    const t = new MatchTracker();
    expect(t.addIntel({ zone: 'bapps', count: 3, at: 0 }).ok).toBe(false);
    const { t: live, at } = liveIn(2);
    expect(live.addIntel({ zone: 'nowhere', count: 1, at }).error).toMatch(/Unknown zone/);
  });

  it('moves the forecast, merges duplicates, and lists who saw what', () => {
    const { t, at } = liveIn(5);
    const before = t.snapshot(at).forecast!;
    expect(before.basis).toBe('prior');
    t.addIntel({ zone: 'bapps', count: 3, by: 'kairo', at: at + 15_000 });
    t.addIntel({ zone: 'bapps', count: 2, by: 'nyx', at: at + 16_000 }); // same sighting
    const s = t.snapshot(at + 16_000);
    expect(s.forecast!.basis).toBe('intel');
    expect(s.forecast!.site.B).toBeGreaterThan(before.site.B);
    expect(s.intel).toEqual([{ zone: 'bapps', zoneName: 'B Apps', count: 3, t: 15, by: ['kairo', 'nyx'] }]);
    expect(s.ticker[0]!.text).toBe('nyx: 2 at B Apps');
  });

  it('turns the call into "plan changed" only when intel changes the read', () => {
    // Round 2: they're on an eco and the prior already says B.
    const eco = liveIn(2);
    eco.t.addIntel({ zone: 'bapps', count: 3, by: 'kairo', at: eco.at + 15_000 });
    expect(eco.t.snapshot(eco.at + 15_000).call!.kind).toBe('pre');
    // Round 5: a bigger buy, the prior isn't clear; 3 at B apps makes B clear.
    const full = liveIn(5);
    const prior = full.t.snapshot(full.at).forecast!.site;
    expect(Math.max(prior.A, prior.B)).toBeLessThan(0.7);
    full.t.addIntel({ zone: 'bapps', count: 3, by: 'kairo', at: full.at + 15_000 });
    const s = full.t.snapshot(full.at + 15_000);
    expect(s.call!.kind).toBe('mid');
    expect(s.call!.head).toMatch(/^B hit likely · \d+%$/);
    expect(s.call!.jobs.rotator).toMatch(/^Rotate to B now/);
    expect(s.call!.why[0]).toBe('kairo: 3 at B Apps');
    expect(s.ticker.some(x => x.tag === 'PLAN')).toBe(true);
    // A new round starts clean.
    const next = liveIn(6);
    expect(next.t.snapshot(next.at).intel).toBeUndefined();
  });
});
