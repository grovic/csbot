// The browser demo's debrief: the fictional synthetic match recorded through the real recorder, a
// fictional "demo truth" next to it, fictional notes, and a few fictional past matches for progress.
// Everything here is made up and labelled so on the page.

import { GEOS, mapToWorld, MatchTracker, PLAYBOOKS } from '@csbot/engine';
import { debriefStats, MatchRecorder } from '@csbot/debrief';
import { FULL_MATCH, syntheticMatch, toGameState } from '@csbot/gsi';
import type { DebriefView, DemoTruth, MatchRecord, MatchSummary, Side } from '@csbot/protocol';

/** A deterministic pseudo-random sequence (same demo every load). */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

function fictionalTruth(rec: MatchRecord): DemoTruth {
  const rnd = rng(7);
  const geo = GEOS[rec.map];
  const me = rec.me?.steamid ?? '76561198000000101';
  const spots = PLAYBOOKS[rec.map]?.setups.find(s => s.id === 'std')?.spots ?? [];
  return {
    source: { file: 'fictional-demo.dem', parsedAt: rec.endedAt ?? rec.startedAt, bytes: 0 },
    map: rec.map,
    players: [],
    rounds: rec.rounds.map(r => {
      const enemySide: Side = r.side === 'CT' ? 'T' : 'CT';
      // Their real money: near the middle of our band, sometimes off it.
      const mid = r.enemy ? (r.enemy.lo + r.enemy.hi) / 2 : 800;
      const truthMoney = Math.max(0, Math.round(mid + (rnd() - 0.5) * (r.enemy ? (r.enemy.hi - r.enemy.lo) * 1.4 : 200)));
      const pistol = r.round === 1 || r.round === 13;
      const equip = pistol ? 650 : truthMoney < 2000 ? 600 : truthMoney < 3600 ? 2600 : 4700;
      const players = Array.from({ length: 5 }, (_, i) => ({ steamid: `enemy-${i}`, side: enemySide, startMoney: truthMoney, equipValue: equip, spent: Math.max(0, equip - 200) }));
      const plantSite = r.planted ? (rnd() < 0.7 && r.forecast ? (r.forecast.site.B >= r.forecast.site.A ? 'B' : 'A') : (rnd() < 0.5 ? 'A' : 'B')) as 'A' | 'B' : undefined;
      const deaths: DemoTruth['rounds'][number]['deaths'] = [];
      const first = rnd() < 0.55 ? enemySide : r.side;
      deaths.push({ steamid: first === enemySide ? 'enemy-0' : 'mate-1', side: first, t: 8 + rnd() * 20, x: 0, y: 0, z: 0 });
      if (r.me?.died && geo && spots.length) {
        const sp = spots[Math.floor(rnd() * spots.length)]!;
        const w = mapToWorld(geo, sp.at[0] + (rnd() - 0.5) * 40, sp.at[1] + (rnd() - 0.5) * 40);
        deaths.push({ steamid: me, side: r.side, t: 20 + rnd() * 40, ...w, killer: 'enemy-1', weapon: rnd() < 0.5 ? 'ak47' : 'awp' });
      }
      return { round: r.round, winner: r.winner === 'us' ? r.side : enemySide, players, ...(plantSite ? { plantSite } : {}), deaths };
    }),
  };
}

function pastMatches(now: number): MatchSummary[] {
  const maps = ['de_dust2', 'de_inferno', 'de_mirage', 'de_ancient', 'de_nuke', 'de_anubis'];
  const rnd = rng(11);
  return maps.map((map, i) => {
    const us = 8 + Math.floor(rnd() * 6), them = 13;
    const win = rnd() < 0.5;
    return {
      id: `${now - (i + 1) * 86_400_000 * 2}-${map}`, map, startedAt: now - (i + 1) * 86_400_000 * 2, finished: true,
      score: win ? { us: 13, them: us } : { us, them }, rating: Math.round((0.85 + rnd() * 0.5) * 100) / 100, hasDemo: i % 2 === 0,
    };
  });
}

export function demoDebrief(map = 'de_mirage'): DebriefView {
  const t = new MatchTracker({ playbookHandle: 'a' });
  const r = new MatchRecorder();
  for (const { t: at, p } of syntheticMatch({ rounds: FULL_MATCH, lean: true, map })) { t.ingest(toGameState(p, at)); r.observe(t.snapshot(at)); }
  const rec = r.record!;
  rec.truth = fictionalTruth(rec);
  rec.workOn = {
    at: rec.endedAt ?? rec.startedAt, model: 'fictional',
    team: [
      'We lost 4 of 5 force buys on T: when their CT read is a full buy, save and buy the round after instead.',
      'B fell to fast rushes three times before the rotator arrived: start the B support closer to short in eco rounds.',
      'Intel came late (after 0:30) in most rounds: log first contact right away so the plan-changed call can help.',
    ],
    you: ['You died first in 5 rounds on A: play the second angle behind the anchor instead of the first contact spot.'],
  };
  const stats = debriefStats(rec);
  const summary: MatchSummary = { id: rec.id, map: rec.map, startedAt: rec.startedAt, finished: rec.finished, score: rec.score, ...(stats.rating !== undefined ? { rating: stats.rating } : {}), hasDemo: true };
  return { record: rec, matches: [summary, ...pastMatches(rec.startedAt)], demo: { status: 'ready', detail: 'fictional-demo.dem' } };
}
