// Enemy economy model: an interval of money per player, updated from round results.
// Values are data (rules v1) and get checked against demo truth before release.

export type BuyType = 'eco' | 'force' | 'half' | 'full';
export const BUY_TYPES: readonly BuyType[] = ['eco', 'force', 'half', 'full'];
export type BuyProbs = Record<BuyType, number>;
export type RoundReason = 'elimination' | 'bomb' | 'defuse' | 'time';

export interface EconomyRules {
  /** Loss bonus by consecutive losses, 1st loss first. The last value repeats. */
  lossLadder: readonly number[];
  winElimination: number;
  winBomb: number;
  winDefuse: number;
  winTime: number;
  /** Paid to every T when they plant and still lose. */
  plantBonus: number;
  startMoney: number;
  maxMoney: number;
}

export const RULES_V1: EconomyRules = {
  lossLadder: [1400, 1900, 2400, 2900, 3400],
  winElimination: 3250,
  winBomb: 3500,
  winDefuse: 3500,
  winTime: 3250,
  plantBonus: 800,
  startMoney: 800,
  maxMoney: 16000,
};

/** Typical spend per player for each buy type, [low, high]. */
export const SPEND: Record<BuyType, readonly [number, number]> = {
  eco: [100, 600],
  force: [1800, 3000],
  half: [2200, 3400],
  full: [3900, 5200],
};

export interface MoneyBand {
  lo: number;
  hi: number;
}

export interface EnemyEconomy extends MoneyBand {
  /** Consecutive round losses (GSI `team_x.consecutive_round_losses`). */
  streak: number;
  /** They saved last round (lost on an eco), which makes a full buy more likely now. */
  saved: boolean;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function lossBonus(streak: number, rules: EconomyRules = RULES_V1): number {
  const ladder = rules.lossLadder;
  return ladder[clamp(streak, 1, ladder.length) - 1] ?? ladder[ladder.length - 1] ?? 0;
}

export function winReward(reason: RoundReason, rules: EconomyRules = RULES_V1): number {
  switch (reason) {
    case 'bomb': return rules.winBomb;
    case 'defuse': return rules.winDefuse;
    case 'time': return rules.winTime;
    default: return rules.winElimination;
  }
}

/**
 * Probability of each buy type given a per-player money band.
 * Integrates a buy-decision table across the band, then boosts a full buy after a save.
 */
export function buyProbs(band: MoneyBand, opts: { saved?: boolean } = {}): BuyProbs {
  const p: BuyProbs = { eco: 0, force: 0, half: 0, full: 0 };
  const steps = 24;
  for (let k = 0; k <= steps; k++) {
    const m = band.lo + ((band.hi - band.lo) * k) / steps;
    const row = m < 2000 ? [0.85, 0.12, 0.03, 0] : m < 3000 ? [0.35, 0.45, 0.18, 0.02] : m < 4100 ? [0.08, 0.32, 0.45, 0.15] : [0.02, 0.05, 0.13, 0.8];
    p.eco += row[0]!; p.force += row[1]!; p.half += row[2]!; p.full += row[3]!;
  }
  if (opts.saved) p.full *= 1.6;
  const sum = p.eco + p.force + p.half + p.full;
  for (const k of BUY_TYPES) p[k] /= sum;
  return p;
}

export function argmax<K extends string>(o: Record<K, number>): K {
  const keys = Object.keys(o) as K[];
  return keys.reduce((a, b) => (o[a] >= o[b] ? a : b));
}

export interface RoundResult {
  enemyWon: boolean;
  reason: RoundReason;
  /** The enemy planted the bomb (only matters when they lose as T). */
  enemyPlanted: boolean;
  /** Enemy loss streak read from GSI after the round. Overrides the model's own count when present. */
  enemyLossStreak?: number;
  /** Buy type the enemy most likely used this round. */
  enemyBuy: BuyType;
  /** Spend range per player, when it isn't the buy type's (the pistol round: PISTOL_SPEND). */
  spend?: readonly [number, number];
}

/** A pistol round spends most of the $800 (kevlar, or a pistol and utility). */
export const PISTOL_SPEND: readonly [number, number] = [500, 800];

/** Update the enemy money band after a round. */
export function applyRoundResult(e: EnemyEconomy, r: RoundResult, rules: EconomyRules = RULES_V1): EnemyEconomy {
  const spend = r.spend ?? SPEND[r.enemyBuy];
  let lo = Math.max(0, e.lo - spend[1]);
  let hi = Math.max(0, e.hi - spend[0]);
  let streak: number;
  if (r.enemyWon) {
    const w = winReward(r.reason, rules);
    lo += w;
    hi += w + 600; // kill rewards on a win
    streak = r.enemyLossStreak ?? Math.max(0, e.streak - 1);
  } else {
    streak = r.enemyLossStreak ?? Math.min(rules.lossLadder.length, e.streak + 1);
    const lb = lossBonus(streak, rules);
    lo += lb;
    hi += lb + 300;
    if (r.enemyPlanted) { lo += rules.plantBonus; hi += rules.plantBonus; }
  }
  return {
    lo: clamp(lo, 0, rules.maxMoney),
    hi: clamp(hi, 0, rules.maxMoney),
    streak,
    saved: !r.enemyWon && r.enemyBuy === 'eco',
  };
}

/**
 * `streak` is CS2's loss-bonus level, as GSI reports it in `consecutive_round_losses`. Each half starts at
 * level 1, so a lost pistol round pays level 2 ($1,900). Seen in a real match (2026-10-21).
 */
export function startOfHalf(rules: EconomyRules = RULES_V1): EnemyEconomy {
  return { lo: rules.startMoney, hi: rules.startMoney, streak: 1, saved: false };
}

/** Money for one of our players next round if this round is lost. */
export function nextRoundIfLost(money: number, ourLossStreak: number, rules: EconomyRules = RULES_V1): number {
  return Math.min(rules.maxMoney, money + lossBonus(ourLossStreak + 1, rules));
}

export const FULL_BUY_CT = 4700;
