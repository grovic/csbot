// Host-side match tracker: GSI game states in, LiveSnapshot out.
// Works with what a playing client receives. Round results and phase timers come from transitions;
// map.round_wins and phase_countdowns are used only when the game happens to send them.

import { diffStates, type GameState, type GsiEvent } from '@csbot/gsi';
import type {
  BuyRead, CallView, ConnectionView, EnemyView, ForecastView, IntelView, LiveSnapshot, MeView, Phase, PlayerRow,
  RoundRecord, SetupSpot, Side, TickerItem, YouTile,
} from '@csbot/protocol';
import { applyRoundResult, argmax, buyProbs, FULL_BUY_CT, lossBonus, PISTOL_SPEND, RULES_V1, startOfHalf, winReward, type BuyProbs, type EnemyEconomy, type RoundReason } from './economy.ts';
import { planPosterior, planPrior, siteForecast, topPlan, type Intel, type MapModel, type Site } from './forecast.ts';
import { MAPS, PLAYBOOKS } from './maps/index.ts';
import { engineRoundCall, engineTCall, ourBuyType, type Playbook, type Setup } from './playbook.ts';

export interface PhaseLengths { freezetime: number; live: number; bomb: number; over: number }
/** Valve matchmaking defaults. Freeze time is re-learned from the first full freeze seen. */
export const DEFAULT_PHASES: PhaseLengths = { freezetime: 20, live: 115, bomb: 40, over: 7 };
/** CS2 MR12 overtime start money. To be checked against demo truth (M0 spike 9). */
export const OT_START_MONEY = 12_500;
export const FULL_BUY_T = 4100;
const OT_HALF = 3;
/** Seconds from plant to explosion in CS2. */
const BOMB_TIMER = 40;

export interface TrackerOptions {
  source?: ConnectionView['source'];
  maps?: Readonly<Record<string, MapModel>>;
  playbooks?: Readonly<Record<string, Playbook>>;
  /** Our playbook slot (e.g. 'a') so the call can carry our own job as the YOU line. */
  playbookHandle?: string;
  phases?: Partial<PhaseLengths>;
  /** GSI heartbeat is 10 s; silent longer than this = stale. */
  staleAfterMs?: number;
  tickerSize?: number;
}

const other = (s: Side): Side => (s === 'CT' ? 'T' : 'CT');
/** The YOU line once you're dead and watching a teammate. */
export const deadYouLine = (watching: string) => `You're dead. Watch ${watching} and call what you see.`;
const fmt$ = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
const pct = (p: number) => Math.round(p * 100) + '%';
const READ_WORD: Record<BuyRead, string> = { eco: 'eco', force: 'force-buy', half: 'half-buy', full: 'full buy', pistol: 'pistol round' };

export function phaseOf(s: GameState): Phase {
  if (s.mapPhase === 'warmup') return 'warmup';
  if (s.mapPhase === 'gameover') return 'gameover';
  if (s.mapPhase === 'intermission') return 'halftime';
  if (s.countdown?.phase === 'paused' || s.countdown?.phase?.startsWith('timeout')) return 'paused';
  switch (s.roundPhase) {
    case 'freezetime': return 'freezetime';
    case 'live': return s.bomb === 'planted' ? 'bomb' : 'live';
    case 'over': return 'over';
    default: return s.mapName ? 'live' : 'idle';
  }
}

/** Wingman (2v2, GSI map.mode "scrimcomp2v2"). */
export const isWingman = (mode?: string): boolean => mode === 'scrimcomp2v2';

/** Rounds per half for a GSI map.mode. */
export function halfLengthFor(mode?: string): number {
  return isWingman(mode) ? 8 : 12;
}

/** Wingman's timings: 10 s freeze, 1:30 rounds (the bomb and the round end are the same). */
export const WINGMAN_PHASES: Partial<PhaseLengths> = { freezetime: 10, live: 90 };

/** First round of a half (regulation or MR3 overtime): money resets, pistol round in regulation. */
export function isHalfStart(round: number, half: number): { start: boolean; overtime: boolean } {
  if (round === 1 || round === half + 1) return { start: true, overtime: false };
  if (round > 2 * half && (round - 2 * half - 1) % OT_HALF === 0) return { start: true, overtime: true };
  return { start: false, overtime: false };
}

/** The buy/"if lost" tile for the player whose data this is. */
export function youTile(me: MeView | undefined, phase: Phase, side: Side | undefined, ourLossStreak: number, freezeMoney: number | undefined, pistol: boolean): YouTile | undefined {
  if (!me) return undefined;
  const full = side === 'T' ? FULL_BUY_T : FULL_BUY_CT;
  const nextIfLost = me.money + lossBonus(Math.min(5, ourLossStreak + 1));
  const bought = freezeMoney !== undefined && me.money < freezeMoney - 400;
  if (phase === 'freezetime' && !bought) {
    if (pistol) return { label: 'Your buy', value: 'PISTOL', sub: `${fmt$(me.money)} · armor or utility` };
    if (me.primary) return { label: 'Your buy', value: 'REFILL', sub: `${fmt$(me.money)} · gun kept, buy utility` };
    if (me.money >= full + 300) return { label: 'Your buy', value: 'FULL BUY', sub: `${fmt$(me.money)} · rifle, armor${side === 'T' ? '' : ', kit'}, utility` };
    if (me.money >= (side === 'T' ? 2700 : 3100)) return { label: 'Your buy', value: 'RIFLE', sub: `${fmt$(me.money)} · ${side === 'T' ? 'light utility' : 'skip the kit'}` };
    return { label: 'Your buy', value: 'SAVE', sub: `${fmt$(me.money)} · pistol + armor at most` };
  }
  if (phase === 'over') {
    const can = !!me.primary && me.alive ? true : me.money >= full;
    return { label: 'Next round', value: can ? 'BUY' : 'SAVE', sub: fmt$(me.money) + (me.primary && me.alive ? ' · gun kept' : '') };
  }
  if (phase === 'freezetime' || phase === 'live' || phase === 'bomb') {
    if (!me.alive) return { label: 'You', value: 'DEAD', sub: `${fmt$(nextIfLost)} next round if lost` };
    const ok = nextIfLost >= full;
    return { label: 'If round is lost', value: ok ? 'PLAY ON' : 'SAVE', sub: (ok ? 'still a full buy · ' : 'keep your gun · ') + fmt$(nextIfLost) + ' next' };
  }
  return undefined;
}

function genericCall(round: number, read: BuyRead, buy: BuyProbs, enemy: EnemyEconomy, side: Side | undefined): CallView {
  const why = [`Enemy est. ${fmt$(enemy.lo)}–${fmt$(enemy.hi)} each → ${READ_WORD[read]}${read === 'pistol' ? '' : ' ' + pct(buy[read])}`];
  if (enemy.streak) why.push(`Enemy loss bonus level ${enemy.streak} (a loss pays ${fmt$(lossBonus(enemy.streak + 1))})${enemy.saved ? ' · they saved last round' : ''}`);
  const base = { kind: 'pre' as const, round, jobs: {}, why, source: 'engine' as const };
  switch (read) {
    case 'pistol': return { ...base, head: 'Pistol round', sub: 'Armor first · play in pairs and trade', steps: ['Buy armor', 'Trade in pairs'] };
    case 'eco': return { ...base, head: 'Enemy eco likely', sub: side === 'T' ? 'Take space · don\'t feed them rifles' : 'Long angles · no free kills up close', steps: ['Long angles only', 'Trade in pairs'] };
    case 'force': return { ...base, head: 'Enemy force-buy likely', sub: 'Expect SMGs and close fights · keep distance', steps: ['No close peeks', 'Fall back on contact'] };
    case 'half': return { ...base, head: 'Enemy half-buy likely', sub: 'Mixed guns · win the first duel with utility', steps: ['Flash your peeks', 'Trade fast'] };
    default: return { ...base, head: 'Enemy full buy', sub: 'Standard round · play your default', steps: ['Use your utility', 'Trade fast'] };
  }
}

export class MatchTracker {
  private readonly o: Required<Omit<TrackerOptions, 'playbookHandle' | 'phases'>> & { playbookHandle?: string; phases: PhaseLengths };
  private prev?: GameState;
  private seq = 0;
  private payloads = 0;
  private lastAt?: number;
  private guardDropped = 0;

  private map?: string;
  private mode?: string;
  private round = 0;
  private phase: Phase = 'idle';
  private phaseStartedAt?: number;
  /** We saw this phase begin, so a derived timer is meaningful. */
  private phaseStartSeen = false;
  private liveStartedAt?: number;
  private freezeLearned?: number;
  private gsiCountdown?: { phase: string; endsIn: number; at: number };

  private ourSide?: Side;
  private score = { us: 0, them: 0 };
  private ourLossStreak = 0;
  private history = new Map<number, RoundRecord>();
  private settled = new Set<number>();

  private enemy: EnemyEconomy = startOfHalf();
  private enemyBuy?: BuyProbs;
  private enemyRead?: BuyRead;
  private plantedThisRound = false;
  /** When the plant was first seen (round.bomb isn't reported as "exploded": it's just cleared). */
  private plantedAt?: number;
  private pistol = false;
  /** The round that just ended (the next round's call is worked out from it). */
  private lastResult?: { round: number; won: boolean; reason: RoundReason; inferred: boolean };
  /** The next round's enemy estimate and forecast, worked out with its call at round end. */
  private nextView?: LiveSnapshot['next'];

  private me?: MeView;
  private freezeMoney?: number;
  private myDamageTotal = 0;
  private myRoundDamage = 0;
  private myRoundsCounted = 0;
  private myStats = { kills: 0, assists: 0, deaths: 0, mvps: 0 };
  private spectated = new Map<string, PlayerRow>();

  private call?: CallView;
  private setupSpots?: SetupSpot[];
  /** This round's intel (reset at freeze time). */
  private intel: (Omit<Intel, 'by'> & { by: string[]; at: number })[] = [];
  /** The call before intel changed the plan (mid calls are built from it). */
  private baseCall?: CallView;
  private ticker: TickerItem[] = [];

  private readonly customPhases: boolean;

  constructor(opts: TrackerOptions = {}) {
    this.customPhases = !!opts.phases;
    this.o = {
      source: opts.source ?? 'game',
      maps: opts.maps ?? MAPS,
      playbooks: opts.playbooks ?? PLAYBOOKS,
      playbookHandle: opts.playbookHandle,
      phases: { ...DEFAULT_PHASES, ...opts.phases },
      staleAfterMs: opts.staleAfterMs ?? 15_000,
      tickerSize: opts.tickerSize ?? 20,
    };
  }

  /** Count spectator-only nodes the guard removed (shown in Settings as proof the guard works). */
  noteGuardDrops(n: number): void { this.guardDropped += n; }

  /**
   * Intel from anyone in the room: `count` enemies seen in `zone` (0 = clear) at `at` (epoch ms).
   * Updates the forecast; when it now points clearly at one site, the call becomes a "plan changed"
   * call. Two logs of the same zone within 3 s are merged (both authors kept).
   */
  addIntel(i: { zone: string; count: number; by?: string; at: number }): { ok: boolean; error?: string } {
    const model = this.map ? this.o.maps[this.map] : undefined;
    if (!model) return { ok: false, error: `No map model for ${this.map ?? 'this map'} yet: intel can't move the forecast.` };
    const zone = model.zones.find(z => z.id === i.zone);
    if (!zone) return { ok: false, error: `Unknown zone "${i.zone}".` };
    if (this.phase !== 'live' && this.phase !== 'bomb') return { ok: false, error: 'Intel is logged during a live round.' };
    if (this.liveStartedAt === undefined) return { ok: false, error: 'Wait for the round to go live.' };
    const count = Math.max(0, Math.min(5, Math.round(i.count)));
    const t = Math.max(0, (i.at - this.liveStartedAt) / 1000);
    const by = i.by?.trim() || 'someone';
    const dup = this.intel.find(x => x.zone === zone.id && Math.abs(x.t - t) <= 3);
    if (dup) {
      dup.count = Math.max(dup.count, count);
      if (!dup.by.includes(by)) dup.by.push(by);
    } else {
      this.intel.push({ zone: zone.id, count, t, by: [by], at: i.at });
    }
    const name = zone.name || zone.id;
    this.push(i.at, 'INTEL', `${by}: ${count ? `${count} at ${name}` : `${name} clear`}`);
    if (this.phase === 'live') this.maybePlanChanged(i.at);
    return { ok: true };
  }

  ingest(s: GameState): GsiEvent[] {
    this.payloads++;
    this.lastAt = s.at;
    if (this.isNewMatch(s)) this.reset(s);
    const events = diffStates(this.prev, s);
    this.prev = s;
    if (s.mapName) { this.map = s.mapName; this.mode = s.mode ?? this.mode; }
    if (s.player?.team) this.ourSide = s.player.team;
    if (s.countdown) this.gsiCountdown = { ...s.countdown, at: s.at };

    this.updatePlayers(s);
    if (this.ourSide) {
      const ours = this.ourSide === 'CT' ? s.ct : s.t, theirs = this.ourSide === 'CT' ? s.t : s.ct;
      if (ours && theirs) this.score = { us: ours.score, them: theirs.score };
      if (ours) this.ourLossStreak = ours.lossStreak;
    }

    const next = phaseOf(s);
    const round = s.round ?? this.round;
    if (next === 'freezetime' && (this.phase !== 'freezetime' || round !== this.round)) this.onFreeze(round, s);
    else if ((next === 'live' || next === 'bomb') && this.round === 0) this.round = round; // joined mid-round
    if (next === 'live' && this.phase === 'freezetime') this.onLive(s);
    if (next === 'bomb' && this.phase !== 'bomb') this.onPlant(s);
    if (next === 'over' && this.phase !== 'over') this.onRoundOver(s);
    // CS2 can end the half's last round with a payload that's already in intermission, and the match's
    // last round with one that's already gameover (round.phase "freezetime"). Settle the round there too.
    else if ((next === 'halftime' || next === 'gameover') && this.phase !== next && s.winTeam) this.onRoundOver(s);
    if (next !== this.phase) {
      if (this.phase === 'freezetime' && this.phaseStartSeen && this.phaseStartedAt !== undefined) {
        const len = (s.at - this.phaseStartedAt) / 1000;
        if (len >= 5 && len <= 40) this.freezeLearned = Math.round(len);
      }
      this.phaseStartSeen = this.phase !== 'idle';
      this.phaseStartedAt = s.at;
      if (next === 'halftime') this.push(s.at, 'HALFTIME', 'Sides swap. Enemy money resets.');
      if (next === 'gameover') {
        const { us, them } = this.score;
        this.call = {
          kind: 'over', round: this.round, head: us > them ? `Match won ${us}–${them}` : us < them ? `Match lost ${us}–${them}` : `Draw ${us}–${them}`,
          sub: 'The debrief builds from the demo once it\'s available', jobs: {}, steps: [], why: [], source: 'engine',
        };
        this.push(s.at, 'MATCH', `Match over · ${us}–${them}`);
      }
      if (next === 'warmup') this.push(s.at, 'WARMUP', `Warmup on ${this.map ?? 'the map'}`);
      this.phase = next;
    }

    for (const e of events) {
      if (e.type === 'roundEnd') {
        // Authoritative result from map.round_wins when the game sends it.
        const won = e.winner === this.sideIn(e.round);
        this.history.set(e.round, { round: e.round, winner: won ? 'us' : 'them', reason: e.reason, ourSide: this.sideIn(e.round) });
      }
      if (e.type === 'died' && e.steamid === s.me) this.push(s.at, 'YOU', 'You died. Watching your team.');
    }
    return events;
  }

  snapshot(now = Date.now()): LiveSnapshot {
    const connection: ConnectionView = {
      gsi: !this.payloads ? 'waiting' : now - (this.lastAt ?? 0) <= this.o.staleAfterMs ? 'live' : 'stale',
      lastPayloadAt: this.lastAt,
      payloads: this.payloads,
      source: this.o.source,
      guardDropped: this.guardDropped,
    };
    const snap: LiveSnapshot = { v: 1, seq: ++this.seq, at: now, connection, scoreboard: this.scoreboard(), ticker: this.ticker.slice() };
    if (!this.map) return snap;
    const half = halfLengthFor(this.mode);
    snap.match = {
      map: this.map,
      mode: this.mode,
      round: this.round,
      clock: { phase: this.phase, ...this.clock(now) },
      ourSide: this.ourSide,
      score: { ...this.score },
      ourLossStreak: this.ourLossStreak,
      history: [...this.history.values()].sort((a, b) => a.round - b.round),
      halfLength: half,
      pistolRound: this.pistol,
      bombPlanted: this.phase === 'bomb',
    };
    if (this.me) snap.me = { ...this.me };
    if (this.enemyBuy && this.enemyRead) {
      snap.enemy = { lo: this.enemy.lo, hi: this.enemy.hi, streak: this.enemy.streak, saved: this.enemy.saved, buy: { ...this.enemyBuy }, read: this.enemyRead } satisfies EnemyView;
    }
    const fc = this.forecast(now);
    if (fc) snap.forecast = fc;
    if (this.call) snap.call = { ...this.call };
    if (this.nextView && this.phase === 'over' && this.call?.kind === 'pre' && this.call.round === this.nextView.round) snap.next = structuredClone(this.nextView);
    if (this.setupSpots) snap.setupSpots = this.setupSpots.map(s => ({ ...s }));
    if (this.o.playbookHandle) snap.youHandle = this.o.playbookHandle;
    if (this.intel.length) {
      snap.intel = this.intel.map(x => ({ zone: x.zone, zoneName: this.zoneName(x.zone), count: x.count, t: Math.round(x.t), by: [...x.by] }) satisfies IntelView);
    }
    const tile = youTile(this.me, this.phase, this.ourSide, this.ourLossStreak, this.freezeMoney, this.pistol);
    if (tile) snap.youTile = tile;
    return snap;
  }

  // ---------------------------------------------------------------- internals

  private isNewMatch(s: GameState): boolean {
    if (!this.map) return false;
    if (s.mapName && s.mapName !== this.map) return true;
    return s.round !== undefined && s.round < this.round - 1 && s.roundPhase !== 'over';
  }

  private reset(s: GameState): void {
    this.prev = undefined;
    this.map = s.mapName; this.mode = s.mode; this.round = 0; this.phase = 'idle';
    this.history.clear(); this.settled.clear(); this.spectated.clear();
    this.enemy = startOfHalf(); this.enemyBuy = undefined; this.enemyRead = undefined;
    this.myDamageTotal = 0; this.myRoundDamage = 0; this.myRoundsCounted = 0;
    this.call = undefined; this.setupSpots = undefined; this.freezeLearned = undefined; this.gsiCountdown = undefined; this.lastResult = undefined; this.nextView = undefined;
    this.push(s.at, 'MATCH', `New match on ${s.mapName ?? 'a new map'}`);
  }

  /** Our side in a given round, from the current side and the half structure. */
  private sideIn(round: number): Side | undefined {
    if (!this.ourSide) return undefined;
    const known = this.history.get(round)?.ourSide;
    if (known) return known;
    const half = halfLengthFor(this.mode);
    const halfIndex = (r: number) => (r <= 2 * half ? Math.floor((r - 1) / half) : 2 + Math.floor((r - 2 * half - 1) / OT_HALF));
    const flips = halfIndex(this.round || round) - halfIndex(round);
    return flips % 2 === 0 ? this.ourSide : other(this.ourSide);
  }

  private updatePlayers(s: GameState): void {
    const p = s.player;
    if (!p) return;
    if (!p.observing) {
      this.me = {
        steamid: p.steamid, name: p.name, alive: p.alive, health: p.health, armor: p.armor, helmet: p.helmet,
        money: p.money, equipValue: p.equipValue, activeWeapon: p.activeWeapon, primary: p.primary,
        roundKills: p.roundKills, roundDamage: p.roundDamage,
      };
      this.myStats = { kills: p.kills, assists: p.assists, deaths: p.deaths, mvps: p.mvps };
      this.myRoundDamage = Math.max(this.myRoundDamage, p.roundDamage);
    } else {
      // In competitive a dead player can only watch their own team: this is a teammate.
      if (this.me) this.me = { ...this.me, alive: false, health: 0, primary: undefined, observing: { steamid: p.steamid, name: p.name } };
      if (this.call && (this.call.kind === 'pre' || this.call.kind === 'post') && s.roundPhase !== 'freezetime') {
        this.call = { ...this.call, you: deadYouLine(p.name) };
      }
      this.spectated.set(p.steamid, {
        steamid: p.steamid, name: p.name, money: p.money, kills: p.kills, assists: p.assists, deaths: p.deaths, mvps: p.mvps,
        source: 'spectated', seenRound: this.round || s.round,
      });
    }
  }

  private onFreeze(round: number, s: GameState): void {
    this.round = round;
    this.nextView = undefined;
    this.intel = [];
    this.baseCall = undefined;
    this.plantedThisRound = false;
    this.plantedAt = undefined;
    this.myRoundDamage = 0;
    this.liveStartedAt = undefined;
    this.freezeMoney = this.me && !this.me.observing ? this.me.money : undefined;
    if (this.me?.observing) this.me = { ...this.me, observing: undefined, alive: true };
    const half = halfLengthFor(this.mode);
    const hs = isHalfStart(round, half);
    const firstSeen = !this.enemyRead;
    if (hs.start) this.enemy = hs.overtime ? { lo: OT_START_MONEY, hi: OT_START_MONEY, streak: 0, saved: false } : startOfHalf();
    else if (firstSeen) this.enemy = { lo: 1400, hi: 9000, streak: 0, saved: false }; // joined mid-half: wide band
    const theirs = this.ourSide === 'CT' ? s.t : this.ourSide === 'T' ? s.ct : undefined;
    if (theirs && !hs.start) this.enemy = { ...this.enemy, streak: theirs.lossStreak };
    this.pistol = hs.start && !hs.overtime;
    this.enemyBuy = buyProbs(this.enemy, { saved: this.enemy.saved });
    this.enemyRead = this.pistol ? 'pistol' : argmax(this.enemyBuy);
    this.call = this.preRoundCall(round);
    const tag = `ROUND ${round}`;
    this.push(s.at, tag, this.pistol ? 'Pistol round.' : `Enemy est. ${fmt$(this.enemy.lo)}–${fmt$(this.enemy.hi)} each → ${READ_WORD[this.enemyRead]} ${pct(this.enemyBuy[this.enemyRead as keyof BuyProbs])}${firstSeen && !hs.start ? ' (joined mid-half: wide estimate)' : ''}`);
  }

  /**
   * The team plan changed (playbook, anti-strat): during freeze time (or between rounds), redo the engine call so
   * the new setup, words and spots show now. Later in the round the call stays (players already moved).
   */
  replan(): void {
    if (this.call?.kind !== 'pre' || this.call.source !== 'engine' || !this.enemyBuy) return;
    if (this.phase === 'freezetime') this.call = this.preRoundCall(this.call.round);
    // Between rounds the call is already the next round's: redo it the same way.
    else if (this.phase === 'over' && this.call.round === this.round + 1 && this.prev) this.call = this.nextRoundCall(this.prev) ?? this.call;
  }

  private preRoundCall(round: number): CallView {
    const pb = this.map ? this.o.playbooks[this.map] : undefined;
    const enemy = this.enemy, buy = this.enemyBuy!, read = this.enemyRead!;
    // Wingman: the playbook's setups are for five; the call is about money and the one site.
    const usable = pb && !isWingman(this.mode) && pb.setups.some(s => s.side === this.ourSide);
    if (!usable || read === 'pistol') {
      this.setupSpots = undefined;
      const call = genericCall(round, read, buy, enemy, this.ourSide);
      // On T, the setup read says which site their buy leaves lighter, when it leans one way.
      const fc = this.ourSide === 'T' ? this.forecast(this.lastAt ?? 0, true) : undefined;
      if (fc) {
        const site: Site = fc.site.B > fc.site.A ? 'B' : 'A';
        call.why = [...call.why, `Their likely setup: ${fc.topPlan.name} · ${site} lighter ${pct(fc.site[site])} (estimate)`];
        if (fc.site[site] >= 0.55) call.steps = [...call.steps.slice(0, 2), `Lean ${site}`];
      }
      return call;
    }
    let c;
    if (this.ourSide === 'T') {
      // Our buy picks eco/force plays; with money, the exec toward the site their setup leaves light.
      const fc = this.forecast(this.lastAt ?? 0, true);
      const lighter = fc ? (fc.site.A >= fc.site.B ? { site: 'A' as const, p: fc.site.A } : { site: 'B' as const, p: fc.site.B }) : undefined;
      c = engineTCall(pb, ourBuyType(this.me?.money), lighter, this.me?.money);
      c = { ...c, why: [...c.why, `Enemy est. ${fmt$(enemy.lo)}–${fmt$(enemy.hi)} each → ${READ_WORD[read]}`].slice(0, 3) };
    } else c = engineRoundCall(pb, enemy, buy);
    this.useSetup(pb.setups.find(s => s.id === c.setup));
    const you = this.o.playbookHandle ? c.jobs[this.o.playbookHandle] : undefined;
    return { kind: 'pre', round, head: c.head, sub: c.sub, jobs: { ...c.jobs }, ...(you ? { you } : {}), steps: [...c.steps], why: [...c.why], setup: c.setup, source: 'engine' };
  }

  /** Planned spots on the map come from the setup the call uses. */
  private useSetup(setup: Setup | undefined): void {
    this.setupSpots = setup?.spots.map(s => ({ player: s.player, at: [s.at[0], s.at[1]] as const, label: s.label }));
  }

  private onLive(s: GameState): void {
    this.liveStartedAt = s.at;
  }

  private onPlant(s: GameState): void {
    this.plantedThisRound = true;
    this.plantedAt = s.at;
    const ct = this.ourSide === 'CT';
    const prev = this.call;
    this.call = {
      kind: 'post', round: this.round,
      head: ct ? 'Bomb planted · retake' : 'Bomb planted · hold the plant',
      sub: ct ? '40 s on the bomb · regroup, kit first' : 'Crossfires on the bomb · no solo peeks',
      jobs: prev?.jobs ?? {}, ...(this.me?.observing ? { you: deadYouLine(this.me.observing.name) } : prev?.you ? { you: prev.you } : {}),
      steps: ct ? ['Group up', 'Utility on the site'] : ['Hold crossfires', 'Play the timer'],
      why: ['The game reported the bomb as planted. Its site isn\'t sent to players.'], setup: prev?.setup, source: 'engine',
    };
    this.push(s.at, 'BOMB', ct ? 'Bomb planted. Retake together.' : 'Bomb planted. Hold the plant.');
  }

  private onRoundOver(s: GameState): void {
    const r = this.round || s.round || 0;
    if (!r || this.settled.has(r)) return;
    this.settled.add(r);
    const ourSide = this.ourSide;
    const winSide = s.winTeam ?? (s.roundWins[r]?.winner);
    if (!winSide || !ourSide) return;
    const known = s.roundWins[r];
    let reason: RoundReason;
    let inferred = false;
    if (known) reason = known.reason;
    else {
      inferred = true;
      const liveFor = this.liveStartedAt !== undefined ? (s.at - this.liveStartedAt) / 1000 : 0;
      // A T win that ends a full bomb timer after the plant is the bomb (the first "planted" payload can lag
      // the plant by a second or two; post-plant eliminations in the real match ended 7-31 s after it).
      const sincePlant = this.plantedAt !== undefined ? (s.at - this.plantedAt) / 1000 : 0;
      reason = s.bomb === 'exploded' || (winSide === 'T' && this.plantedThisRound && sincePlant >= BOMB_TIMER - 4) ? 'bomb'
        : s.bomb === 'defused' ? 'defuse'
        : winSide === 'CT' && !this.plantedThisRound && liveFor >= this.phases().live - 3 ? 'time' : 'elimination';
    }
    const won = winSide === ourSide;
    this.history.set(r, { round: r, winner: won ? 'us' : 'them', reason, ourSide, ...(inferred ? { inferred } : {}) });

    const enemySide = other(ourSide);
    const read = this.enemyRead ?? 'eco';
    // The round-end payload already carries the enemy's new loss-bonus level.
    const theirs = enemySide === 'CT' ? s.ct : s.t;
    this.enemy = applyRoundResult(this.enemy, {
      enemyWon: !won, reason, enemyPlanted: enemySide === 'T' && (this.plantedThisRound || reason === 'defuse'),
      enemyBuy: read === 'pistol' ? 'eco' : read,
      ...(read === 'pistol' ? { spend: PISTOL_SPEND } : {}),
      ...(theirs ? { enemyLossStreak: theirs.lossStreak } : {}),
    });
    // Losing a pistol round isn't a save: everyone spends their $800.
    if (read === 'pistol') this.enemy = { ...this.enemy, saved: false };
    this.myDamageTotal += this.myRoundDamage;
    this.myRoundsCounted++;

    const nextBuy = buyProbs(this.enemy, { saved: this.enemy.saved });
    const nextRead = argmax(nextBuy);
    const half = halfLengthFor(this.mode);
    const resets = isHalfStart(r + 1, half).start;
    this.call = {
      kind: 'over', round: r,
      head: won ? 'Round won' : 'Round lost',
      sub: resets ? 'Half over · money resets' : `Next: enemy ${READ_WORD[nextRead]} ${pct(nextBuy[nextRead])} (est. ${fmt$(this.enemy.lo)}–${fmt$(this.enemy.hi)})`,
      jobs: this.call?.jobs ?? {}, steps: [], why: [`Round ${r}: ${won ? 'won' : 'lost'} by ${reason}${inferred ? ' (inferred)' : ''}`], source: 'engine',
    };
    this.push(s.at, `ROUND ${r}`, `${won ? 'Won' : 'Lost'} · ${reason}${inferred ? '' : ''} · ${this.score.us}–${this.score.them}`);
    // The next round's call right away (the coach starts on it now, so its call is ready by freeze time).
    this.lastResult = { round: r, won, reason, inferred };
    const next = this.nextRoundCall(s);
    if (next) this.call = next;
  }

  /**
   * At round end: round N+1's pre-round call, worked out from what's known now (the enemy's new money
   * band, our money). Freeze time redoes it with the freeze payload. None when the next round starts a
   * half (sides swap, money resets) or the match is decided. Leaves the round's enemy read and forecast
   * as they are: the debrief records them for the round that just ended.
   */
  private nextRoundCall(s: GameState): CallView | undefined {
    const res = this.lastResult;
    if (!res || res.round !== this.round || !this.ourSide) return undefined;
    const round = res.round + 1;
    const half = halfLengthFor(this.mode);
    if (isHalfStart(round, half).start || this.decided(res.round, half)) return undefined;
    const keep = { enemy: this.enemy, enemyBuy: this.enemyBuy, enemyRead: this.enemyRead, pistol: this.pistol, me: this.me };
    try {
      const theirs = this.ourSide === 'CT' ? s.t : s.ct;
      if (theirs) this.enemy = { ...this.enemy, streak: theirs.lossStreak };
      this.pistol = false;
      this.enemyBuy = buyProbs(this.enemy, { saved: this.enemy.saved });
      this.enemyRead = argmax(this.enemyBuy);
      // Watching a teammate, our own money isn't sent: add what this round paid us.
      if (this.me?.observing) this.me = { ...this.me, money: Math.min(RULES_V1.maxMoney, this.me.money + this.roundPay(res.won, res.reason)) };
      const c = this.preRoundCall(round);
      const fc = this.forecast(this.lastAt ?? 0, true);
      if (fc) delete fc.liveT; // the round that ended is still "live" while its last payload is read
      this.nextView = {
        round,
        enemy: { lo: this.enemy.lo, hi: this.enemy.hi, streak: this.enemy.streak, saved: this.enemy.saved, buy: { ...this.enemyBuy }, read: this.enemyRead },
        ...(fc ? { forecast: fc } : {}),
      };
      const result = `Round ${res.round} ${res.won ? 'won' : 'lost'} by ${res.reason}${res.inferred ? ' (inferred)' : ''}`;
      return { ...c, why: [result, ...c.why].slice(0, 3) };
    } finally {
      this.enemy = keep.enemy; this.enemyBuy = keep.enemyBuy; this.enemyRead = keep.enemyRead; this.pistol = keep.pistol; this.me = keep.me;
    }
  }

  /** What one of our players earned for the round that just ended. */
  private roundPay(won: boolean, reason: RoundReason): number {
    if (won) return winReward(reason);
    return lossBonus(this.ourLossStreak) + (this.ourSide === 'T' && this.plantedThisRound ? RULES_V1.plantBonus : 0);
  }

  /** One team has won after `round` (regulation: half + 1 wins; MR3 overtime: 4 of the block's 6). */
  private decided(round: number, half: number): boolean {
    const top = Math.max(this.score.us, this.score.them);
    if (round <= 2 * half) return top >= half + 1;
    const block = Math.floor((round - 2 * half - 1) / (2 * OT_HALF));
    return top >= half + OT_HALF * block + OT_HALF + 1;
  }

  private clock(now: number): { endsIn?: number; source?: 'gsi' | 'derived' } {
    const cd = this.gsiCountdown;
    if (cd && this.lastAt !== undefined && cd.at === this.lastAt) {
      return { endsIn: Math.max(0, cd.endsIn - (now - cd.at) / 1000), source: 'gsi' };
    }
    const ph = this.phases();
    const lens: Partial<Record<Phase, number>> = {
      freezetime: this.freezeLearned ?? ph.freezetime, live: ph.live, bomb: ph.bomb, over: ph.over,
    };
    const len = lens[this.phase];
    if (len === undefined || !this.phaseStartSeen || this.phaseStartedAt === undefined) return {};
    const since = this.phase === 'live' && this.liveStartedAt !== undefined ? this.liveStartedAt : this.phaseStartedAt;
    return { endsIn: Math.max(0, len - (now - since) / 1000), source: 'derived' };
  }

  /** Phase lengths for this mode (Wingman's are shorter), unless the tests set their own. */
  private phases(): PhaseLengths {
    return isWingman(this.mode) && !this.customPhases ? { ...this.o.phases, ...WINGMAN_PHASES } : this.o.phases;
  }

  /**
   * The plan model for the enemy we face: their attack on our CT halves, their setups on our T halves.
   * None in Wingman: the plans are for five players and two sites, Wingman is two players on one site.
   */
  private sideModel(): MapModel | undefined {
    if (isWingman(this.mode)) return undefined;
    const model = this.map ? this.o.maps[this.map] : undefined;
    return this.ourSide === 'CT' ? model : this.ourSide === 'T' ? model?.ct : undefined;
  }

  /** The enemy plan forecast; `priorOnly` leaves this round's intel out (a pre-round call is made before any). */
  private forecast(now: number, priorOnly = false): ForecastView | undefined {
    const model = this.sideModel();
    if (!model || !this.enemyBuy) return undefined;
    const buy = this.enemyRead === 'pistol' ? { eco: 1, force: 0, half: 0, full: 0 } : this.enemyBuy;
    const prior = planPrior(model, buy);
    const intel = priorOnly ? [] : this.intel;
    const plans = intel.length ? planPosterior(model, prior, intel.map(({ zone, count, t }) => ({ zone, count, t }))) : prior;
    const top = topPlan(plans);
    const liveT = this.liveStartedAt !== undefined && (this.phase === 'live' || this.phase === 'bomb') ? (now - this.liveStartedAt) / 1000 : undefined;
    return {
      map: model.id, plans, site: siteForecast(model, plans),
      topPlan: { id: top, name: model.plans.find(p => p.id === top)?.name ?? top, p: plans[top] ?? 0 },
      ...(liveT !== undefined ? { liveT } : {}), basis: intel.length ? 'intel' : 'prior',
      ...(this.ourSide === 'T' ? { enemy: 'CT' as const } : {}),
    };
  }

  /**
   * After new intel: if one site is now clearly likely (≥ 70%) and the call doesn't already say so,
   * switch to a "plan changed" call. On CT: the rotator goes to the site they're hitting. On T: go to
   * the site their setup leaves light.
   */
  private maybePlanChanged(now: number): void {
    const fc = this.forecast(now);
    if (!fc || !this.call || (this.call.kind !== 'pre' && this.call.kind !== 'mid')) return;
    const site: Site = fc.site.B >= fc.site.A ? 'B' : 'A';
    const p = fc.site[site];
    if (p < 0.7) return;
    if (this.call.kind === 'mid') {
      if (this.call.head.startsWith(`${site} `)) return; // already calling this site
    } else {
      // Only when intel changed the read: the likely site flipped, or became clear (≥ 70%) from unclear.
      const model = this.sideModel()!;
      const buy = this.enemyRead === 'pistol' ? { eco: 1, force: 0, half: 0, full: 0 } : this.enemyBuy!;
      const before = siteForecast(model, planPrior(model, buy));
      const beforeSite: Site = before.B >= before.A ? 'B' : 'A';
      if (beforeSite === site && before[site] >= 0.7) return;
    }
    const base = this.baseCall ?? this.call;
    this.baseCall = base;
    const seen = this.intel.slice(-3).map(x => `${x.by.join(' + ')}: ${x.count ? `${x.count} at ${this.zoneName(x.zone)}` : `${this.zoneName(x.zone)} clear`}`);
    const handle = this.o.playbookHandle;
    if (fc.enemy === 'CT') {
      // Our T half: their setup leaves `site` light. The headline starts with the site (the coach keys on it).
      // The jobs come from our exec for that site, when the playbook has one.
      const other: Site = site === 'A' ? 'B' : 'A';
      const pb = this.o.playbooks[this.map!];
      const exec = pb?.setups.find(s => s.side === 'T' && s.site === site && !s.answers);
      const jobs = exec ? { ...(pb!.jobs[exec.id] ?? {}) } : { ...base.jobs };
      if (exec) this.useSetup(exec);
      this.call = {
        kind: 'mid', round: this.round,
        head: `${site} likely light · ${pct(p)}`,
        sub: `${other} looks stacked · go ${site} together`,
        jobs, ...(handle && jobs[handle] ? { you: jobs[handle] } : {}),
        steps: [`Go ${site}`, 'Trade, no solo peeks', 'Plant for the crossfire'],
        why: [...seen, `Forecast: ${site} lighter ${pct(p)} (${fc.topPlan.name}) · estimate`].slice(0, 3),
        ...(exec ? { setup: exec.id } : base.setup ? { setup: base.setup } : {}), source: 'engine',
      };
      this.push(now, 'PLAN', `Plan changed: ${site} looks light (${pct(p)}). Go ${site}.`);
      return;
    }
    const jobs = { ...base.jobs };
    if (jobs.rotator !== undefined || Object.keys(jobs).length === 0) jobs.rotator = `Rotate to ${site} now. Call when you're in position.`;
    this.call = {
      kind: 'mid', round: this.round,
      head: `${site} hit likely · ${pct(p)}`,
      sub: `Rotate to ${site}, hold the other site`,
      jobs, ...(handle && jobs[handle] ? { you: jobs[handle] } : {}),
      steps: [`Rotate to ${site}`, 'Hold the other site', 'Trade, no solo peeks'],
      why: [...seen, `Forecast ${site} ${pct(p)} (${fc.topPlan.name}) · estimate`].slice(0, 3),
      ...(base.setup ? { setup: base.setup } : {}), source: 'engine',
    };
    this.push(now, 'PLAN', `Plan changed: ${site} likely (${pct(p)}). Rotate.`);
  }

  private zoneName(id: string): string {
    const z = this.map ? this.o.maps[this.map]?.zones.find(x => x.id === id) : undefined;
    return z?.name || id;
  }

  private scoreboard(): PlayerRow[] {
    const rows: PlayerRow[] = [];
    if (this.me) {
      rows.push({
        steamid: this.me.steamid, name: this.me.name, money: this.me.money, ...this.myStats,
        adr: this.myRoundsCounted ? Math.round(this.myDamageTotal / this.myRoundsCounted) : undefined,
        source: 'host', isMe: true,
      });
    }
    for (const r of this.spectated.values()) if (r.steamid !== this.me?.steamid) rows.push({ ...r });
    return rows.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  }

  private push(at: number, tag: string, text: string): void {
    this.ticker.unshift({ at, tag, text });
    if (this.ticker.length > this.o.tickerSize) this.ticker.length = this.o.tickerSize;
  }
}
