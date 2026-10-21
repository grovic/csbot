// The live coach on the host (M5): watches the host's snapshots for game events, asks the warm Claude
// session for a call at freeze time, when intel changes the plan (M4a) and after a plant, answers
// questions from the room, and keeps
// the chat, the call log and the per-match budget. Pure Node (no Electron import): unit-tested with a
// fake session.
//
// The engine's call is always on screen first. A Claude call replaces it only for the round and phase
// it was written for; anything else (slow, failed, over budget, tournament) leaves the engine call.

import { CoachLedger, eventMessage, parseCoachOutput, questionMessage, type RosterEntry, type Trigger } from '@csbot/coach';
import {
  DEFAULT_COACH_CONFIG, EMPTY_COACH,
  type CallLogEntry, type CallView, type CoachAsker, type CoachConfig, type CoachMessage, type CoachStatus, type CoachView,
  type LiveSnapshot, type ScoutView,
} from '@csbot/protocol';
import { coachConfigFrom } from '../settings.ts';
import { CoachTimeout, type CoachReply, type CoachSession } from './session.ts';

export interface CoachServiceOptions {
  config?: Partial<CoachConfig>;
  /** Persist config changes (settings.json). */
  onConfig?: (c: CoachConfig) => void;
  /** A fresh session for the current config (the real one spawns `claude`). */
  makeSession: (c: CoachConfig) => CoachSession;
  /** Is Claude Code installed? Asked once by init(). */
  detect: () => Promise<boolean>;
  /** Put a Claude call on the host's screens (undefined = back to the engine call). */
  applyCall: (call: CallView | undefined) => void;
  /**
   * The engine's own call (the snapshots this service observes may already carry a Claude call).
   * Used to spot a new "plan changed" call from intel. Defaults to the observed snapshot's call.
   */
  engineCall?: () => CallView | undefined;
  scout?: () => ScoutView | undefined;
  hostName?: () => string;
  /** The host's own playbook slot when not in a room. */
  hostSlot?: () => string | undefined;
  now?: () => number;
  callTimeoutMs?: number;
  answerTimeoutMs?: number;
}

const MAX_MESSAGES = 120;
const MAX_CALLS = 60;
const EMPTY_LIVE: LiveSnapshot = { v: 1, seq: 0, at: 0, scoreboard: [], ticker: [], connection: { gsi: 'waiting', payloads: 0, source: 'game', guardDropped: 0 } };

/** Keep a patch from the renderer within sane bounds: each invalid field keeps its current value. */
export function sanitizeConfig(patch: Partial<CoachConfig> | undefined, base: CoachConfig = DEFAULT_COACH_CONFIG): CoachConfig {
  const valid = coachConfigFrom(patch);
  const out = { ...base };
  for (const k of Object.keys(patch ?? {}) as (keyof CoachConfig)[]) if (valid[k] === patch![k]) (out as Record<string, unknown>)[k] = valid[k];
  return out;
}

export class CoachService {
  private readonly o: CoachServiceOptions & { now: () => number; callTimeoutMs: number; answerTimeoutMs: number };
  private config: CoachConfig;
  private ledger: CoachLedger;
  private session?: CoachSession;
  private claude?: boolean;
  private tournament = false;
  private roster: RosterEntry[] = [];
  private live: LiveSnapshot = EMPTY_LIVE;
  private messages: CoachMessage[] = [];
  private calls: CallLogEntry[] = [];
  private busy = 0;
  private lastError?: string;
  private listeners = new Set<(v: CoachView) => void>();
  private seq = 0;
  // Trigger state.
  private map?: string;
  private lastRound = 0;
  private lastPhase?: string;
  private inMatch = false;
  private frozeRound = 0;
  private plantedRounds = new Set<number>();
  /** The engine "plan changed" call we last asked Claude about (round + site). */
  private midKey?: string;
  /** The Claude call on screen, if any (round + kind it belongs to). */
  private current?: CallView;
  /** applyCall makes the host emit a snapshot, which comes straight back here: don't re-run triggers. */
  private observing = false;

  constructor(o: CoachServiceOptions) {
    this.o = { now: Date.now, callTimeoutMs: 12_000, answerTimeoutMs: 30_000, ...o };
    this.config = sanitizeConfig(o.config);
    this.ledger = new CoachLedger(this.config);
  }

  private detecting?: Promise<void>;

  /** Ask once whether Claude Code is installed. Events that arrive meanwhile wait for the answer. */
  init(): Promise<void> {
    this.detecting ??= (async () => {
      this.claude = await this.o.detect().catch(() => false);
      this.emit();
    })();
    return this.detecting;
  }

  get view(): CoachView {
    const { status, detail } = this.status();
    return {
      status, ...(detail ? { detail } : {}), config: { ...this.config },
      budget: this.ledger.budget, quota: this.ledger.quota,
      messages: this.messages.slice(), calls: this.calls.slice(),
    };
  }

  onChange(cb: (v: CoachView) => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  setConfig(patch: Partial<CoachConfig>): void {
    const before = this.config;
    this.config = sanitizeConfig({ ...before, ...patch }, before);
    this.ledger.setConfig(this.config);
    // A different model or effort needs a new session; turning the coach off stops it.
    if (!this.config.enabled || before.model !== this.config.model || before.effort !== this.config.effort) this.stopSession();
    if (!this.config.enabled) this.clearCall();
    this.o.onConfig?.(this.config);
    this.emit();
  }

  /** The room's tournament mode (no live coaching, no forecast): intel from hotkeys is refused too. */
  get inTournament(): boolean { return this.tournament; }

  /** Room roster with slots (or none when solo) and the room-wide tournament switch. */
  setRoom(members: RosterEntry[], opts: { tournament?: boolean } = {}): void {
    this.roster = members.slice(0, 12).map(m => ({ name: m.name.slice(0, 32), ...(m.slot ? { slot: m.slot } : {}), ...(m.random ? { random: true } : {}) }));
    const t = !!opts.tournament;
    if (t !== this.tournament) {
      this.tournament = t;
      if (t) { this.stopSession(); this.clearCall(); this.system('Tournament mode is on: no live coaching.'); }
      else this.system('Tournament mode is off: live coaching is back.');
    }
    this.emit();
  }

  /** Every host snapshot. Detects the game events that trigger a call. */
  observe(live: LiveSnapshot): void {
    this.live = live;
    const m = live.match;
    if (!m || this.observing) return;
    this.observing = true;
    try { this.triggers(live, m); } finally { this.observing = false; }
  }

  private triggers(live: LiveSnapshot, m: NonNullable<LiveSnapshot['match']>): void {
    const phase = m.clock.phase;
    const newMatch = !this.inMatch || m.map !== this.map || (m.round < this.lastRound && m.round <= 1);
    if (newMatch && phase !== 'gameover') {
      this.inMatch = true;
      this.map = m.map;
      this.frozeRound = 0;
      this.plantedRounds.clear();
      this.midKey = undefined;
      this.ledger.newMatch(`${m.map}:${this.o.now()}`);
      this.messages = [];
      this.calls = [];
      this.clearCall();
      this.system(`New match on ${prettyMap(m.map)}.`);
      void this.event('warmup', live);
    }
    if (phase === 'freezetime' && m.round !== this.frozeRound) {
      this.frozeRound = m.round;
      void this.event('freeze', live);
    }
    // Intel changed the plan: the engine switched to a "plan changed" call (or flipped it to the other
    // site). Ask Claude for the mid-round call once per change; a stale Claude mid call goes away.
    const engine = this.engineNow();
    if (phase === 'live' && engine?.kind === 'mid' && engine.round === m.round) {
      const key = midKeyOf(engine);
      if (key !== this.midKey) {
        this.midKey = key;
        if (this.current?.kind === 'mid') this.clearCall();
        void this.event('intel', live);
      }
    }
    if (phase === 'bomb' && !this.plantedRounds.has(m.round)) {
      this.plantedRounds.add(m.round);
      if (this.config.postPlant) void this.event('plant', live);
    }
    if (phase === 'gameover' && this.lastPhase !== 'gameover') {
      this.inMatch = false;
      this.stopSession();
      this.system('Match over. The coach session is closed.');
      this.emit();
    }
    this.lastRound = m.round;
    this.lastPhase = phase;
  }

  /** A question for the coach. Returns right after the checks; the answer arrives in the chat. */
  ask(text: string, from?: CoachAsker): { ok: boolean; error?: string } {
    const q = text.trim().replace(/\s+/g, ' ').slice(0, 300);
    if (q.length < 2) return { ok: false, error: 'Type a question first.' };
    const gate = this.gate();
    if (gate) return { ok: false, error: gate };
    const asker: CoachAsker = from ?? { id: 'host', name: this.o.hostName?.() ?? 'Host', role: 'admin' };
    const can = this.ledger.canAsk(asker);
    if (!can.ok) { this.emit(); return can; }
    this.ledger.useAsk(asker);
    const question = this.push({ kind: 'question', author: asker.name, authorId: asker.id, text: q, ...(this.live.match ? { round: this.live.match.round } : {}) });
    const msg = questionMessage(q, asker, this.live, this.rosterNow(), this.scoutNow());
    void this.run('question', msg, this.o.answerTimeoutMs, 'question').then(r => {
      if (!r) return;
      try {
        const out = parseCoachOutput(r.reply.structured, this.live, 'pre');
        const text = out.type === 'answer' ? out.text : `${out.call.head}. ${out.call.sub}`.trim();
        this.push({ kind: 'answer', author: 'Coach', text, replyTo: question.id, ms: r.reply.ms, ...(this.live.match ? { round: this.live.match.round } : {}) });
        this.log({ trigger: 'question', status: 'ok', round: this.live.match?.round ?? 0, ms: r.reply.ms, ...meta(r.reply) });
      } catch {
        this.push({ kind: 'system', text: `The coach couldn't answer ${asker.name}'s question.`, replyTo: question.id });
        this.log({ trigger: 'question', status: 'error', round: this.live.match?.round ?? 0, error: 'unusable answer', ...meta(r.reply) });
      }
      this.emit();
    });
    this.emit();
    return { ok: true };
  }

  stop(): void { this.stopSession(); }

  // ---------------------------------------------------------------- internals

  /** Why nothing can be asked right now, or undefined. */
  private gate(): string | undefined {
    if (this.claude === false) return "Claude Code isn't installed on the host's PC.";
    if (!this.config.enabled) return 'The admin turned the live coach off.';
    if (this.tournament) return 'Tournament mode is on: no live coaching.';
    return undefined;
  }

  private async event(trigger: Exclude<Trigger, 'question'>, live: LiveSnapshot): Promise<void> {
    const round = live.match?.round ?? 0;
    if (this.claude === undefined && this.detecting) await this.detecting;
    const gate = this.gate() ?? (this.claude === undefined ? 'Claude Code was not detected yet.' : undefined);
    if (gate || !this.ledger.canCall()) {
      this.log({ trigger, round, status: 'skipped', error: gate ?? `budget of ${this.config.callBudget} calls used` });
      this.emit();
      return;
    }
    this.ledger.useCall();
    const kind: CallView['kind'] = trigger === 'plant' ? 'post' : trigger === 'intel' ? 'mid' : 'pre';
    const text = eventMessage(trigger, live, this.rosterNow(), this.scoutNow());
    const midKey = this.midKey;
    const relevant = () => {
      if (this.live.match?.round !== round) return false;
      if (trigger === 'plant') return this.live.match?.clock.phase === 'bomb';
      const engine = this.engineNow();
      // A mid call only fits while the engine still calls the same site, in the live phase.
      if (trigger === 'intel') return this.live.match?.clock.phase === 'live' && engine?.kind === 'mid' && midKeyOf(engine) === midKey;
      return engine?.kind === 'pre';
    };
    const apply = (reply: CoachReply, late: boolean) => {
      if (trigger === 'warmup') { this.log({ trigger, round, status: late ? 'late' : 'ok', ms: reply.ms, ...meta(reply) }); return; }
      let call: CallView;
      try {
        const out = parseCoachOutput(reply.structured, this.live, kind);
        if (out.type !== 'call') throw new Error('not a call');
        call = { ...out.call, round };
      } catch (e) {
        this.log({ trigger, round, status: 'error', error: `unusable call: ${(e as Error).message}`, ms: reply.ms, ...meta(reply) });
        return;
      }
      if (!relevant()) { this.log({ trigger, round, status: 'late', head: call.head, ms: reply.ms, ...meta(reply) }); return; }
      this.current = call;
      this.o.applyCall(call);
      this.push({ kind: 'call', author: 'Coach', text: [call.head, call.sub].filter(Boolean).join(' · '), round, ms: reply.ms });
      this.log({ trigger, round, status: late ? 'late' : 'ok', head: call.head, ms: reply.ms, ...meta(reply) });
    };
    const r = await this.run(trigger, text, this.o.callTimeoutMs, 'event', reply => { apply(reply, true); this.emit(); });
    if (r) apply(r.reply, false);
    this.emit();
  }

  /**
   * One request on the session (started on demand). Logs timeouts and errors itself; returns the
   * reply, or undefined when there is none (yet).
   */
  private async run(trigger: Trigger, text: string, timeoutMs: number, priority: 'event' | 'question', onLate?: (r: CoachReply) => void): Promise<{ reply: CoachReply } | undefined> {
    this.session ??= this.o.makeSession(this.config);
    this.busy++;
    this.emit();
    try {
      const reply = await this.session.request(text, { priority, timeoutMs, ...(onLate ? { onLate } : {}) });
      this.lastError = undefined;
      return { reply };
    } catch (e) {
      const round = this.live.match?.round ?? 0;
      if (e instanceof CoachTimeout) this.log({ trigger, round, status: 'timeout', error: e.message });
      else {
        this.lastError = (e as Error).message;
        this.log({ trigger, round, status: 'error', error: this.lastError });
        if (trigger === 'question') this.push({ kind: 'system', text: `The coach couldn't answer: ${this.lastError}` });
      }
      return undefined;
    } finally {
      this.busy--;
    }
  }

  private engineNow(): CallView | undefined {
    return this.o.engineCall ? this.o.engineCall() : this.live.call;
  }

  private stopSession(): void {
    this.session?.stop();
    this.session = undefined;
  }

  private clearCall(): void {
    if (this.current) { this.current = undefined; this.o.applyCall(undefined); }
  }

  private rosterNow(): RosterEntry[] {
    if (this.roster.length) return this.roster;
    const slot = this.o.hostSlot?.();
    return [{ name: this.o.hostName?.() ?? 'Host', ...(slot ? { slot } : {}) }];
  }

  private scoutNow(): ScoutView | undefined {
    const s = this.o.scout?.();
    return s?.status === 'ready' ? s : undefined;
  }

  private status(): { status: CoachStatus; detail?: string } {
    if (this.claude === false) return { status: 'off', detail: "Claude Code isn't installed on this PC. Calls come from the local engine." };
    if (!this.config.enabled) return { status: 'off', detail: 'The live coach is turned off. Calls come from the local engine.' };
    if (this.tournament) return { status: 'tournament', detail: 'Tournament mode is on for the room: no live coaching.' };
    if (this.inMatch && !this.ledger.canCall()) return { status: 'budget', detail: `The coach used its ${this.config.callBudget} calls for this match. Calls come from the local engine.` };
    if (this.busy > 0) return { status: 'busy' };
    if (this.lastError) return { status: 'error', detail: this.lastError };
    if (!this.inMatch) return { status: 'idle' };
    return { status: this.session?.running ? 'ready' : 'starting' };
  }

  private push(m: Omit<CoachMessage, 'id' | 'at'>): CoachMessage {
    const msg: CoachMessage = { id: `m${++this.seq}`, at: this.o.now(), ...m };
    this.messages.push(msg);
    if (this.messages.length > MAX_MESSAGES) this.messages.splice(0, this.messages.length - MAX_MESSAGES);
    return msg;
  }

  private system(text: string): void { this.push({ kind: 'system', text }); }

  private log(e: Omit<CallLogEntry, 'id' | 'at'>): void {
    this.calls.unshift({ id: `c${++this.seq}`, at: this.o.now(), ...e });
    if (this.calls.length > MAX_CALLS) this.calls.length = MAX_CALLS;
  }

  private emit(): void {
    const v = this.view;
    for (const cb of this.listeners) { try { cb(v); } catch { /* a bad listener must not break the coach */ } }
  }
}

/** One "plan changed" call per round and site (the engine's mid headline starts with the site). */
const midKeyOf = (c: CallView) => `${c.round}:${/^([AB]) /.exec(c.head)?.[1] ?? c.head}`;
const meta = (r: CoachReply) => ({ ...(r.model ? { model: r.model } : {}), ...(r.costUsd !== undefined ? { costUsd: r.costUsd } : {}) });
const prettyMap = (id: string) => (id === 'de_dust2' ? 'Dust II' : id.replace(/^de_/, '').replace(/^\w/, c => c.toUpperCase()));
