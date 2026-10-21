// Debrief numbers from a MatchRecord, and from its DemoTruth when the demo was provided.

import type { BuyKind, DemoRound, MatchRecord, Side } from '@csbot/protocol';
import { buyKind } from './recorder.ts';

export interface Tally { played: number; won: number }

export interface TruthStats {
  /** Rounds where the enemy buy read matched what they actually bought. */
  buyRead: { correct: number; total: number };
  /** Rounds where their real average money fell inside the estimated band. */
  band: { inside: number; total: number };
  /** Our CT rounds with a plant: the forecast's likely site was the site they hit. */
  siteRead: { correct: number; total: number };
  /** Rounds where the first death was theirs. */
  openings: { won: number; total: number };
  /** Where the host player died (world units), for the map. */
  myDeaths: { round: number; t: number; x: number; y: number; z: number; weapon?: string }[];
  /** Their real money per round next to the estimate. */
  enemyMoney: { round: number; truth: number; truthBuy: BuyKind; lo?: number; hi?: number; read?: string }[];
  /** Rounds the demo and the record have in common. */
  rounds: number;
}

export interface DebriefStats {
  rounds: number;
  won: number;
  /** HLTV 1.0-style rating from the host player's own rounds (kills, deaths, multi-kills). */
  rating?: number;
  kpr?: number;
  adr?: number;
  bySide: Record<Side, Tally>;
  byBuy: Partial<Record<BuyKind, Tally>>;
  planChanges: number;
  intel: number;
  truth?: TruthStats;
}

const pistolRound = (n: number) => n === 1 || n === 13;

export function debriefStats(rec: MatchRecord): DebriefStats {
  const played = rec.rounds.filter(r => r.winner);
  const bySide: Record<Side, Tally> = { CT: { played: 0, won: 0 }, T: { played: 0, won: 0 } };
  const byBuy: Partial<Record<BuyKind, Tally>> = {};
  for (const r of played) {
    const win = r.winner === 'us' ? 1 : 0;
    bySide[r.side].played++; bySide[r.side].won += win;
    if (r.ourBuy) { const t = byBuy[r.ourBuy] ??= { played: 0, won: 0 }; t.played++; t.won += win; }
  }
  const mine = played.filter(r => r.me);
  let rating: number | undefined, kpr: number | undefined, adr: number | undefined;
  if (mine.length >= 3) {
    const n = mine.length;
    const kills = mine.reduce((s, r) => s + r.me!.kills, 0);
    const deaths = mine.filter(r => r.me!.died).length;
    const multi = mine.reduce((s, r) => s + Math.min(5, r.me!.kills) ** 2, 0);
    kpr = kills / n;
    adr = mine.reduce((s, r) => s + r.me!.damage, 0) / n;
    rating = (kpr / 0.679 + (0.7 * ((n - deaths) / n)) / 0.317 + multi / n / 1.277) / 2.7;
  }
  const out: DebriefStats = {
    rounds: played.length, won: played.filter(r => r.winner === 'us').length,
    ...(rating !== undefined ? { rating: Math.round(rating * 100) / 100, kpr: Math.round(kpr! * 100) / 100, adr: Math.round(adr!) } : {}),
    bySide, byBuy,
    planChanges: rec.rounds.filter(r => r.call?.planChanged).length,
    intel: rec.rounds.reduce((s, r) => s + r.intel, 0),
  };
  if (rec.truth) out.truth = truthStats(rec);
  return out;
}

function truthStats(rec: MatchRecord): TruthStats {
  const truth = rec.truth!;
  const meId = rec.me?.steamid;
  const res: TruthStats = { buyRead: { correct: 0, total: 0 }, band: { inside: 0, total: 0 }, siteRead: { correct: 0, total: 0 }, openings: { won: 0, total: 0 }, myDeaths: [], enemyMoney: [], rounds: 0 };
  for (const r of rec.rounds) {
    const d: DemoRound | undefined = truth.rounds.find(x => x.round === r.round);
    if (!d) continue;
    res.rounds++;
    const ourSide = r.side;
    const enemies = d.players.filter(p => p.side !== ourSide);
    if (enemies.length) {
      const avgStart = enemies.reduce((s, p) => s + p.startMoney, 0) / enemies.length;
      const avgEquip = enemies.reduce((s, p) => s + p.equipValue, 0) / enemies.length;
      const truthBuy = buyKind(avgEquip, ourSide === 'CT' ? 'T' : 'CT', pistolRound(r.round));
      res.enemyMoney.push({ round: r.round, truth: Math.round(avgStart), truthBuy, ...(r.enemy ? { lo: r.enemy.lo, hi: r.enemy.hi, read: r.enemy.read } : {}) });
      if (r.enemy) {
        res.buyRead.total++;
        // A "half" read is right for a half or force buy; pistol rounds count when we called pistol.
        const read = r.enemy.read;
        if (read === truthBuy || (read === 'half' && truthBuy === 'force') || (read === 'force' && truthBuy === 'half')) res.buyRead.correct++;
        res.band.total++;
        if (avgStart >= r.enemy.lo - 50 && avgStart <= r.enemy.hi + 50) res.band.inside++;
      }
    }
    if (ourSide === 'CT' && d.plantSite && r.forecast?.enemy === 'T') {
      res.siteRead.total++;
      const called = r.forecast.site.B >= r.forecast.site.A ? 'B' : 'A';
      if (called === d.plantSite) res.siteRead.correct++;
    }
    const first = [...d.deaths].sort((a, b) => a.t - b.t)[0];
    if (first) { res.openings.total++; if (first.side !== ourSide) res.openings.won++; }
    if (meId) for (const death of d.deaths) if (death.steamid === meId) res.myDeaths.push({ round: r.round, t: death.t, x: death.x, y: death.y, z: death.z, ...(death.weapon ? { weapon: death.weapon } : {}) });
  }
  return res;
}
