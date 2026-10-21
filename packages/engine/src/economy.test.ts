import { describe, expect, it } from 'vitest';
import { applyRoundResult, argmax, buyProbs, lossBonus, nextRoundIfLost, PISTOL_SPEND, RULES_V1, startOfHalf } from './economy.ts';

describe('loss bonus', () => {
  it('follows the ladder and caps at the last step', () => {
    expect([1, 2, 3, 4, 5, 6].map(s => lossBonus(s))).toEqual([1400, 1900, 2400, 2900, 3400, 3400]);
  });
  it('treats 0 as a first loss', () => {
    expect(lossBonus(0)).toBe(1400);
  });
});

describe('buy probabilities', () => {
  it('sum to 1', () => {
    const p = buyProbs({ lo: 1450, hi: 2800 });
    expect(p.eco + p.force + p.half + p.full).toBeCloseTo(1, 10);
  });
  it('read a low band as an eco', () => {
    const p = buyProbs({ lo: 1450, hi: 2800 });
    expect(argmax(p)).toBe('eco');
    expect(p.eco).toBeGreaterThan(0.5);
  });
  it('read a rich band as a full buy', () => {
    expect(argmax(buyProbs({ lo: 5000, hi: 7000 }))).toBe('full');
  });
  it('make a full buy more likely right after a save', () => {
    const band = { lo: 2750, hi: 4900 };
    expect(buyProbs(band, { saved: true }).full).toBeGreaterThan(buyProbs(band).full);
    expect(argmax(buyProbs(band, { saved: true }))).toBe('full');
  });
});

describe('round results', () => {
  const r9 = { lo: 1450, hi: 2800, streak: 1, saved: false };

  it('adds the loss bonus after an eco loss and marks the save', () => {
    const e = applyRoundResult(r9, { enemyWon: false, reason: 'elimination', enemyPlanted: false, enemyBuy: 'eco' });
    expect(e.streak).toBe(2);
    expect(e.lo).toBe(1450 - 600 + 1900);
    expect(e.hi).toBe(2800 - 100 + 1900 + 300);
    expect(e.saved).toBe(true);
  });

  it('uses the loss streak read from GSI when present', () => {
    const e = applyRoundResult(r9, { enemyWon: false, reason: 'elimination', enemyPlanted: false, enemyBuy: 'eco', enemyLossStreak: 4 });
    expect(e.streak).toBe(4);
    expect(e.lo).toBe(1450 - 600 + 2900);
  });

  it('adds the plant bonus when they plant and lose', () => {
    const a = applyRoundResult(r9, { enemyWon: false, reason: 'defuse', enemyPlanted: true, enemyBuy: 'full' });
    const b = applyRoundResult(r9, { enemyWon: false, reason: 'defuse', enemyPlanted: false, enemyBuy: 'full' });
    expect(a.lo - b.lo).toBe(RULES_V1.plantBonus);
  });

  it('pays the win reward and lowers the loss streak on a win', () => {
    const e = applyRoundResult({ lo: 4000, hi: 5000, streak: 2, saved: false }, { enemyWon: true, reason: 'bomb', enemyPlanted: true, enemyBuy: 'full' });
    expect(e.streak).toBe(1);
    expect(e.lo).toBe(Math.max(0, 4000 - 5200) + 3500);
    expect(e.saved).toBe(false);
  });

  it('never goes above the money cap', () => {
    const e = applyRoundResult({ lo: 15000, hi: 16000, streak: 0, saved: false }, { enemyWon: true, reason: 'elimination', enemyPlanted: false, enemyBuy: 'eco' });
    expect(e.hi).toBe(16000);
  });

  it('starts each half at the start money', () => {
    // CS2 starts each half at loss-bonus level 1 (GSI's consecutive_round_losses reads 1 at a pistol round).
    expect(startOfHalf()).toEqual({ lo: 800, hi: 800, streak: 1, saved: false });
  });

  it('projects our own money for a lost round', () => {
    expect(nextRoundIfLost(4900, 0)).toBe(6300);
    expect(nextRoundIfLost(15500, 3)).toBe(16000);
  });
  it('pays $1,900 for a lost pistol round, as in a real CS2 match', () => {
    const e = applyRoundResult(startOfHalf(), { enemyWon: false, reason: 'elimination', enemyPlanted: false, enemyBuy: 'eco', spend: PISTOL_SPEND });
    expect(e.streak).toBe(2);
    expect(e.lo).toBe(1900); // spent all $800
    expect(e.hi).toBe(2500); // kept $300, plus kill-free slack
    expect(argmax(buyProbs(e))).toBe('eco');
  });
});
