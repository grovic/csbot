// Builds a MatchRecord from the host's live snapshots as a match runs: one entry per round with our
// buy, the enemy estimate, the forecast, the last call, the intel and the host player's own round.
// Pure: the desktop host feeds it every snapshot and saves the record; tests feed recorded matches.

import type { BuyKind, DebriefRound, LiveSnapshot, MatchRecord } from '@csbot/protocol';

/** Our buy from the host's own equipment once the round went live (team buys follow the same call). */
export function buyKind(equip: number, side: 'CT' | 'T', pistol: boolean): BuyKind {
  if (pistol) return 'pistol';
  if (equip >= (side === 'T' ? 3700 : 4100)) return 'full';
  if (equip >= 2500) return 'half';
  if (equip >= 1300) return 'force';
  return 'eco';
}

/** First round of each half (MR12) and of each overtime half (MR3): pistol rounds in regulation only. */
const isPistol = (round: number) => round === 1 || round === 13;

export class MatchRecorder {
  private rec?: MatchRecord;
  private lastAt = 0;
  private readonly onFinish: ((r: MatchRecord) => void) | undefined;
  private finishedSent = false;

  constructor(o: { onFinish?: (r: MatchRecord) => void } = {}) { this.onFinish = o.onFinish; }

  get record(): MatchRecord | undefined { return this.rec; }

  /** Start fresh (e.g. a record loaded for a match still running is replaced). */
  reset(): void { this.rec = undefined; this.finishedSent = false; }

  observe(s: LiveSnapshot): MatchRecord | undefined {
    const m = s.match;
    if (!m || m.clock.phase === 'warmup' || m.clock.phase === 'idle') { this.lastAt = s.at; return this.rec; }
    // A new match: another map, the round count going back, or a long gap after the last one ended.
    const r0 = this.rec;
    const restarted = r0 && (r0.map !== m.map || m.round < (r0.rounds[r0.rounds.length - 1]?.round ?? 0) - 1 || (r0.finished && m.clock.phase !== 'gameover') || s.at - this.lastAt > 30 * 60_000);
    if (!r0 || restarted) {
      this.rec = { id: `${s.at}-${m.map}`, map: m.map, ...(m.mode ? { mode: m.mode } : {}), startedAt: s.at, finished: false, score: { ...m.score }, rounds: [] };
      this.finishedSent = false;
    }
    const rec = this.rec!;
    this.lastAt = s.at;
    rec.score = { ...m.score };
    if (s.me) rec.me = { name: s.me.name, steamid: s.me.steamid };
    const mine = s.scoreboard.find(r => r.isMe);
    if (mine) rec.totals = { kills: mine.kills, assists: mine.assists, deaths: mine.deaths, mvps: mine.mvps ?? 0 };

    // The round in play.
    const phase = m.clock.phase;
    if (m.ourSide && m.round > 0 && (phase === 'freezetime' || phase === 'live' || phase === 'bomb' || phase === 'over')) {
      let r = rec.rounds.find(x => x.round === m.round);
      if (!r) {
        r = { round: m.round, side: m.ourSide, intel: 0, planted: false };
        rec.rounds.push(r);
        rec.rounds.sort((a, b) => a.round - b.round);
      }
      r.side = m.ourSide;
      if (phase === 'freezetime') {
        if (s.me && r.money === undefined) r.money = s.me.money;
        if (s.enemy) r.enemy = { lo: s.enemy.lo, hi: s.enemy.hi, read: s.enemy.read, buy: { ...s.enemy.buy } };
      }
      if ((phase === 'live' || phase === 'bomb') && s.me && s.me.alive && !s.me.observing) {
        r.equip = Math.max(r.equip ?? 0, s.me.equipValue);
        r.ourBuy = buyKind(r.equip, m.ourSide, isPistol(m.round));
      }
      if (s.forecast) r.forecast = { enemy: s.forecast.enemy === 'CT' ? 'CT' : 'T', site: { ...s.forecast.site }, top: s.forecast.topPlan.name, basis: s.forecast.basis };
      // The round's call (pre-round, plan changed, post-plant), not the round-over summary.
      if (s.call && s.call.round === m.round && s.call.kind !== 'over') {
        const changed = (r.call?.planChanged ?? false) || s.call.kind === 'mid';
        r.call = { head: s.call.head, kind: s.call.kind, ...(s.call.setup ? { setup: s.call.setup } : {}), source: s.call.source, planChanged: changed };
      }
      r.intel = Math.max(r.intel, s.intel?.length ?? 0);
      if (m.bombPlanted) r.planted = true;
      if (s.me && !s.me.observing) {
        const me = r.me ?? { kills: 0, damage: 0, died: false, mvp: false };
        me.kills = Math.max(me.kills, s.me.roundKills);
        me.damage = Math.max(me.damage, s.me.roundDamage);
        if ((phase === 'live' || phase === 'bomb' || phase === 'over') && !s.me.alive) me.died = true;
        r.me = me;
      } else if (s.me?.observing && r.me) r.me.died = true;
    }
    // Results as the match view knows them (rounds the recorder never saw live still get their result).
    for (const h of m.history) {
      let r = rec.rounds.find(x => x.round === h.round);
      if (!r) {
        const side = h.ourSide ?? m.ourSide;
        if (!side) continue;
        r = { round: h.round, side, intel: 0, planted: false };
        rec.rounds.push(r);
        rec.rounds.sort((a, b) => a.round - b.round);
      }
      r.winner = h.winner; r.reason = h.reason;
    }
    if (phase === 'gameover') {
      rec.finished = true;
      rec.endedAt ??= s.at;
      if (!this.finishedSent) { this.finishedSent = true; this.onFinish?.(rec); }
    }
    return rec;
  }
}

/**
 * A match csbot wasn't open for, rebuilt from its demo alone, from one player's point of view: sides,
 * results, that player's kills and deaths. No buys, estimates or calls (csbot didn't see them live).
 */
export function recordFromTruth(truth: import('@csbot/protocol').DemoTruth, steamid: string, startedAt: number): MatchRecord | undefined {
  const me = truth.players.find(p => p.steamid === steamid);
  if (!me) return undefined;
  const rounds: DebriefRound[] = truth.rounds.map(d => {
    const side = d.players.find(p => p.steamid === steamid)?.side ?? (d.round <= 12 ? me.startSide : me.startSide === 'CT' ? 'T' : 'CT');
    const kills = d.deaths.filter(x => x.killer === steamid && x.side !== side).length;
    return {
      round: d.round, side, winner: d.winner === side ? 'us' : 'them',
      ...(d.reason === 'elimination' || d.reason === 'bomb' || d.reason === 'defuse' || d.reason === 'time' ? { reason: d.reason } : {}),
      intel: 0, planted: !!d.plantSite,
      me: { kills, damage: 0, died: d.deaths.some(x => x.steamid === steamid), mvp: false },
    };
  });
  const us = rounds.filter(r => r.winner === 'us').length;
  return {
    id: `${Math.round(startedAt)}-${truth.map.toLowerCase().replace(/[^a-z0-9_]/g, '')}`, map: truth.map, startedAt, endedAt: startedAt, finished: true,
    score: { us, them: rounds.length - us }, me: { name: me.name, steamid }, rounds, truth,
  };
}
