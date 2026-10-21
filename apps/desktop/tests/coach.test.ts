import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MatchTracker } from '@csbot/engine';
import { FIRST_HALF, FULL_MATCH, syntheticMatch, toGameState } from '@csbot/gsi';
import type { CallView, CoachConfig, LiveSnapshot } from '@csbot/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { CoachService, sanitizeConfig } from '../src/coach/service.ts';
import { CoachTimeout, type CoachReply, type CoachSession, type RequestOptions } from '../src/coach/session.ts';
import { withCoachCall } from '../src/host.ts';
import { coachConfigFrom, loadSettings } from '../src/settings.ts';

// ------------------------------------------------------------------ a scripted session

interface Req { text: string; o: RequestOptions; resolve: (r: CoachReply) => void; reject: (e: Error) => void }

/** Auto mode answers like the fake claude; manual mode lets a test decide when and how. */
class FakeSession implements CoachSession {
  reqs: Req[] = [];
  stops = 0;
  running = true;
  private readonly auto: boolean;
  constructor(auto = true) { this.auto = auto; }
  request(text: string, o: RequestOptions): Promise<CoachReply> {
    return new Promise((resolve, reject) => {
      this.reqs.push({ text, o, resolve, reject });
      if (this.auto) queueMicrotask(() => resolve({ structured: answerFor(text), ms: 120, model: 'claude-fake-sonnet', costUsd: 0.004 * this.reqs.length }));
    });
  }
  stop(): void { this.stops++; this.running = false; }
  count(prefix: string) { return this.reqs.filter(r => r.text.startsWith(prefix)).length; }
}

function answerFor(text: string): unknown {
  if (text.startsWith('Freeze time')) return { type: 'call', head: `Claude R${/round (\d+)/.exec(text)?.[1]}`, sub: 'Stack B', setup: 'antieco', jobs: [{ slot: 'a', job: 'Hold A alone' }], steps: ['Long angles'], why: ['Likely eco'] };
  if (text.startsWith('Intel in round')) return { type: 'call', head: `Claude mid ${/(A|B) /.exec(text.slice(text.indexOf('engineCall')))?.[1] ?? ''}`.trim(), sub: 'Rotate', jobs: [{ slot: 'rotator', job: 'Go now' }] };
  if (text.startsWith('The bomb')) return { type: 'call', head: 'Claude: retake', sub: 'Kit first', jobs: [{ slot: 'a', job: 'Smoke' }] };
  if (text.startsWith('Question from')) return { type: 'answer', answer: 'Likely B apps.' };
  return { type: 'answer', answer: 'ready' };
}

const flush = () => new Promise(r => setImmediate(r));

function setup(o: { config?: Partial<CoachConfig>; auto?: boolean; claude?: boolean; callTimeoutMs?: number } = {}) {
  const sessions: FakeSession[] = [];
  let applied: CallView | undefined;
  const configs: CoachConfig[] = [];
  const coach = new CoachService({
    config: o.config ?? {},
    onConfig: c => configs.push(c),
    makeSession: () => { const s = new FakeSession(o.auto ?? true); sessions.push(s); return s; },
    detect: async () => o.claude ?? true,
    applyCall: c => { applied = c; },
    hostName: () => 'rdx',
    hostSlot: () => 'a',
    ...(o.callTimeoutMs ? { callTimeoutMs: o.callTimeoutMs } : {}),
  });
  return { coach, sessions, applied: () => applied, configs, session: () => sessions[sessions.length - 1]! };
}

/** Replay a synthetic half through a tracker and the coach, like the host does. */
async function replay(coach: CoachService, applied: () => CallView | undefined, rounds = FIRST_HALF, until?: (s: LiveSnapshot) => boolean) {
  const t = new MatchTracker({ playbookHandle: 'a' });
  let last: LiveSnapshot | undefined;
  for (const { t: at, p } of syntheticMatch({ rounds })) {
    t.ingest(toGameState(p, at));
    last = withCoachCall(t.snapshot(at), applied(), 'a');
    coach.observe(last);
    await flush();
    if (until?.(last)) break;
  }
  return last!;
}

const planted = FIRST_HALF.filter(r => r.planted).length;

describe('coach triggers over a match', () => {
  it('warms up once, calls every freeze time and every plant, and stops at match end', async () => {
    const { coach, applied, session } = setup();
    await coach.init();
    await replay(coach, applied);
    const s = session();
    expect(s.count('Match starting')).toBe(1);
    expect(s.count('Freeze time')).toBe(FIRST_HALF.length);
    expect(s.count('The bomb')).toBe(planted);
    expect(s.stops).toBe(1); // game over closes the session
    const v = coach.view;
    expect(v.calls.filter(c => c.status === 'ok')).toHaveLength(1 + FIRST_HALF.length + planted);
    expect(v.messages.filter(m => m.kind === 'call')).toHaveLength(FIRST_HALF.length + planted);
    expect(v.budget.used).toBe(1 + FIRST_HALF.length + planted);
    expect(v.calls[v.calls.length - 1]).toMatchObject({ trigger: 'warmup', status: 'ok', model: 'claude-fake-sonnet' });
  });

  it('skips the post-plant call when it is turned off', async () => {
    const { coach, applied, session } = setup({ config: { postPlant: false } });
    await coach.init();
    await replay(coach, applied);
    expect(session().count('The bomb')).toBe(0);
  });

  it("puts Claude's call on screen for its round, then the next round starts with the engine's", async () => {
    const { coach, applied, sessions } = setup({ auto: false });
    await coach.init();
    const t = new MatchTracker({ playbookHandle: 'a' });
    const rec = syntheticMatch({ rounds: FIRST_HALF.slice(0, 3) });
    let live: LiveSnapshot | undefined;
    const feed = async (stop: (s: LiveSnapshot) => boolean) => {
      while (rec.length) {
        const { t: at, p } = rec.shift()!;
        t.ingest(toGameState(p, at));
        live = withCoachCall(t.snapshot(at), applied(), 'a');
        coach.observe(live);
        await flush();
        if (stop(live)) return;
      }
    };
    await feed(s => s.match?.round === 2 && s.match.clock.phase === 'freezetime');
    expect(live!.call!.source).toBe('engine'); // the engine call shows first
    const s = sessions[0]!;
    for (const r of s.reqs.filter(r => !r.text.startsWith('Freeze time, round 2'))) r.resolve({ structured: answerFor(r.text), ms: 50 });
    s.reqs.find(r => r.text.startsWith('Freeze time, round 2'))!.resolve({ structured: answerFor('Freeze time, round 2'), ms: 3100 });
    await flush();
    expect(applied()).toMatchObject({ head: 'Claude R2', round: 2, kind: 'pre' });
    await feed(x => x.match?.round === 2 && x.match.clock.phase === 'live');
    expect(live!.call).toMatchObject({ head: 'Claude R2', source: 'claude', you: 'Hold A alone' }); // still this round
    await feed(x => x.match?.round === 3 && x.match.clock.phase === 'freezetime');
    expect(live!.call!.source).toBe('engine'); // a new round: the engine call until Claude's lands
    expect(coach.view.messages.filter(m => m.kind === 'call').map(m => m.text)).toContain('Claude R2 · Stack B');
  });
});

describe('budget, quotas and gates', () => {
  it('stops asking Claude when the match budget is used, and says so', async () => {
    const { coach, applied, session } = setup({ config: { callBudget: 3 } });
    await coach.init();
    await replay(coach, applied, FIRST_HALF.slice(0, 4), s => s.match?.round === 4 && s.match.clock.phase === 'live');
    expect(session().reqs).toHaveLength(3); // warm-up + rounds 1 and 2
    expect(coach.view.status).toBe('budget');
    expect(coach.view.detail).toMatch(/3 calls/);
    const skipped = coach.view.calls.filter(c => c.status === 'skipped');
    expect(skipped.map(c => c.round)).toEqual(expect.arrayContaining([3, 4]));
    expect(applied()?.round ?? 0).toBeLessThan(3); // rounds 3+ keep the engine call
    expect(coach.ask('anything?').error).toMatch(/3 calls/);
  });

  it('gives members a quota; the admin only uses the budget', async () => {
    const { coach, applied } = setup({ config: { memberQuota: 1 } });
    await coach.init();
    await replay(coach, applied, FIRST_HALF.slice(0, 1), s => s.match?.clock.phase === 'live');
    const kairo = { id: 'k1', name: 'kairo', role: 'member' as const };
    expect(coach.ask('Where on ecos?', kairo)).toEqual({ ok: true });
    expect(coach.ask('And now?', kairo).error).toMatch(/your 1 questions/);
    expect(coach.ask('Admin question')).toEqual({ ok: true });
    await flush(); await flush();
    const v = coach.view;
    expect(v.quota.used).toEqual({ k1: 1 });
    const q = v.messages.filter(m => m.kind === 'question');
    expect(q.map(m => m.author)).toEqual(['kairo', 'rdx']);
    const answers = v.messages.filter(m => m.kind === 'answer');
    expect(answers).toHaveLength(2);
    expect(answers[0]).toMatchObject({ replyTo: q[0]!.id, text: 'Likely B apps.' });
    expect(coach.ask(' ').error).toMatch(/Type a question/);
  });

  it('turns everything off in tournament mode, and back on', async () => {
    const { coach, applied, session } = setup();
    await coach.init();
    await replay(coach, applied, FIRST_HALF.slice(0, 2), s => s.match?.round === 1 && s.match.clock.phase === 'live');
    const before = session().reqs.length;
    coach.setRoom([{ name: 'rdx', slot: 'a' }, { name: 'kairo', slot: 'short' }], { tournament: true });
    expect(session().stops).toBe(1);
    expect(coach.view.status).toBe('tournament');
    expect(coach.inTournament).toBe(true); // main.ts refuses hotkey and map intel on this
    expect(applied()).toBeUndefined();
    expect(coach.ask('hello?').error).toMatch(/Tournament/);
    await replay(coach, applied, FIRST_HALF.slice(0, 2), s => s.match?.round === 2 && s.match.clock.phase === 'live');
    expect(coach.view.calls.some(c => c.status === 'skipped' && /Tournament/.test(c.error ?? ''))).toBe(true);
    coach.setRoom([{ name: 'rdx', slot: 'a' }], { tournament: false });
    expect(coach.view.status).not.toBe('tournament');
    expect(coach.inTournament).toBe(false);
    void before;
  });

  it('is off when disabled or when Claude Code is missing, and saves the config', async () => {
    const off = setup({ claude: false });
    await off.coach.init();
    expect(off.coach.view.status).toBe('off');
    expect(off.coach.view.detail).toMatch(/isn't installed/);
    expect(off.coach.ask('hi?').error).toMatch(/isn't installed/);

    const { coach, applied, sessions, configs } = setup();
    await coach.init();
    coach.setConfig({ enabled: false, callBudget: 25, model: 'nope' as never });
    expect(configs[0]).toMatchObject({ enabled: false, callBudget: 25, model: 'sonnet' });
    expect(coach.view.status).toBe('off');
    await replay(coach, applied, FIRST_HALF.slice(0, 1));
    expect(sessions).toHaveLength(0);
    expect(coach.view.calls.every(c => c.status === 'skipped')).toBe(true);
  });
});

describe('slow and late answers', () => {
  it('logs a timeout, then applies a late call only while it still fits', async () => {
    const { coach, applied, sessions } = setup({ auto: false, callTimeoutMs: 10_000 });
    await coach.init();
    const t = new MatchTracker({ playbookHandle: 'a' });
    const rec = syntheticMatch({ rounds: FIRST_HALF.slice(0, 3) });
    const feed = async (stop: (s: LiveSnapshot) => boolean) => {
      while (rec.length) {
        const { t: at, p } = rec.shift()!;
        t.ingest(toGameState(p, at));
        const s = withCoachCall(t.snapshot(at), applied(), 'a');
        coach.observe(s);
        await flush();
        if (stop(s)) return s;
      }
      throw new Error('ran out');
    };
    await feed(s => s.match?.round === 1 && s.match.clock.phase === 'freezetime');
    const s = sessions[0]!;
    // warm-up and round 1 queued: answer the warm-up, time round 1 out, then deliver it late.
    s.reqs[0]!.resolve({ structured: { type: 'answer', answer: 'ready' }, ms: 900 });
    await flush();
    const r1 = s.reqs.find(r => r.text.startsWith('Freeze time, round 1'))!;
    r1.reject(new CoachTimeout('No answer within 12 s.'));
    await flush();
    expect(coach.view.calls[0]).toMatchObject({ trigger: 'freeze', round: 1, status: 'timeout' });
    r1.o.onLate!({ structured: answerFor('Freeze time, round 1'), ms: 13_000 });
    await flush();
    expect(applied()).toMatchObject({ head: 'Claude R1', round: 1, source: 'claude' });
    expect(coach.view.calls[0]).toMatchObject({ round: 1, status: 'late', head: 'Claude R1' });
    // Round 2: its answer only lands after round 3 began → logged late, not shown.
    await feed(x => x.match?.round === 2 && x.match.clock.phase === 'freezetime');
    const r2 = s.reqs.find(r => r.text.startsWith('Freeze time, round 2'))!;
    await feed(x => x.match?.round === 3 && x.match.clock.phase === 'freezetime');
    r2.resolve({ structured: answerFor('Freeze time, round 2'), ms: 4000 });
    await flush();
    expect(applied()?.round).toBe(1);
    expect(coach.view.calls.find(c => c.round === 2 && c.trigger === 'freeze')).toMatchObject({ status: 'late', head: 'Claude R2' });
  });
});

describe('startup', () => {
  it('holds the first calls until Claude Code detection answers', async () => {
    let release!: (v: boolean) => void;
    const sessions: FakeSession[] = [];
    let applied: CallView | undefined;
    const coach = new CoachService({ makeSession: () => { const s = new FakeSession(); sessions.push(s); return s; }, detect: () => new Promise<boolean>(r => { release = r; }), applyCall: c => { applied = c; } });
    void coach.init();
    await replay(coach, () => applied, FIRST_HALF.slice(0, 1), s => s.match?.clock.phase === 'freezetime');
    expect(sessions).toHaveLength(0);
    release(true);
    await flush(); await flush();
    expect(sessions[0]!.count('Match starting')).toBe(1);
    expect(sessions[0]!.count('Freeze time')).toBe(1);
    expect(coach.view.calls.some(c => c.status === 'skipped')).toBe(false);
  });
});

describe('the call on screen', () => {
  const t = new MatchTracker({ playbookHandle: 'a' });
  let freeze2: LiveSnapshot | undefined, bomb3: LiveSnapshot | undefined, dead3: LiveSnapshot | undefined;
  for (const { t: at, p } of syntheticMatch({ rounds: FIRST_HALF })) {
    t.ingest(toGameState(p, at));
    const s = t.snapshot(at);
    if (!freeze2 && s.match?.round === 2 && s.match.clock.phase === 'freezetime') freeze2 = s;
    if (!dead3 && s.match?.round === 3 && s.me?.observing && s.call?.kind === 'pre') dead3 = s;
    if (!bomb3 && s.match?.round === 3 && s.match.clock.phase === 'bomb') bomb3 = s;
  }
  const call = (o: Partial<CallView>): CallView => ({ kind: 'pre', round: 2, head: 'Claude: stack B', sub: 'x', jobs: { a: 'Claude job for A', b: 'B job' }, steps: [], why: [], source: 'claude', ...o });

  it('shows the Claude call for its own round and kind only', () => {
    expect(withCoachCall(freeze2!, call({}), 'a').call).toMatchObject({ head: 'Claude: stack B', source: 'claude', you: 'Claude job for A' });
    expect(withCoachCall(freeze2!, call({ round: 1 }), 'a').call!.source).toBe('engine');
    expect(withCoachCall(bomb3!, call({ round: 3 }), 'a').call!.kind).toBe('post'); // a pre call doesn't cover a plant
    expect(withCoachCall(bomb3!, call({ round: 3, kind: 'post' }), 'a').call!.source).toBe('claude');
    expect(withCoachCall(freeze2!, undefined, 'a')).toBe(freeze2);
  });

  it("keeps the dead line and moves the map's spots to Claude's setup", () => {
    expect(withCoachCall(dead3!, call({ round: 3 }), 'a').call!.you).toMatch(/^You're dead/);
    const std = withCoachCall(freeze2!, call({ setup: 'std' }), 'a');
    expect(freeze2!.call!.setup).toBe('antieco');
    expect(std.setupSpots!.find(s => s.player === 'short')!.label).toBe('short');
    expect(freeze2!.setupSpots!.find(s => s.player === 'short')!.label).toBe('B bench');
  });
});

describe('coach config in settings', () => {
  const dirs: string[] = [];
  afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

  it('stores the config field by field and drops bad values', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csbot-coachcfg-'));
    dirs.push(dir);
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ gsiPort: 47400, gsiToken: 'tok_12345678', coach: { enabled: false, model: 'gpt', callBudget: 10, memberQuota: 999 } }));
    const s = loadSettings(dir);
    expect(s.coach).toEqual({ enabled: false, model: 'sonnet', effort: 'low', callBudget: 10, memberQuota: 5, postPlant: true });
    expect(coachConfigFrom(undefined).callBudget).toBe(40);
    expect(sanitizeConfig({ callBudget: 0, memberQuota: 3 }, coachConfigFrom({ callBudget: 12 }))).toMatchObject({ callBudget: 12, memberQuota: 3 });
  });
});

// ------------------------------------------------------------------ intel (M4a)

describe('intel: the mid-round call', () => {
  /** A coach fed like the host feeds it: the engine call separately from what's on screen. */
  async function liveRound5(o: { config?: Partial<CoachConfig> } = {}) {
    const sessions: FakeSession[] = [];
    let applied: CallView | undefined;
    const appliedLog: (CallView | undefined)[] = [];
    let engine: CallView | undefined;
    const coach = new CoachService({
      config: o.config ?? {}, makeSession: () => { const s = new FakeSession(); sessions.push(s); return s; },
      detect: async () => true, applyCall: c => { applied = c; appliedLog.push(c); }, engineCall: () => engine,
      hostName: () => 'rdx', hostSlot: () => 'a',
    });
    await coach.init();
    const t = new MatchTracker({ playbookHandle: 'a' });
    let at = 0;
    const observe = (ts: number) => {
      const raw = t.snapshot(ts);
      engine = raw.call;
      const s = withCoachCall(raw, applied, 'a');
      coach.observe(s);
      return s;
    };
    for (const { t: ts, p } of syntheticMatch({ rounds: FULL_MATCH })) {
      t.ingest(toGameState(p, ts));
      at = ts;
      const s = observe(ts);
      await flush();
      if (s.match?.round === 5 && s.match.clock.phase === 'live') break;
    }
    const intel = async (zone: string, count: number, dt: number) => {
      t.addIntel({ zone, count, by: 'kairo', at: at + dt });
      observe(at + dt);
      await flush();
      return observe(at + dt);
    };
    return { coach, intel, applied: () => applied, appliedLog, session: () => sessions[sessions.length - 1]!, engine: () => engine };
  }

  it('asks Claude once per plan change, again when the plan flips to the other site', async () => {
    const r = await liveRound5();
    const asked = () => r.session().count('Intel in round');
    let s = await r.intel('bapps', 3, 15_000);
    expect(r.engine()!.head).toMatch(/^B hit likely/);
    expect(asked()).toBe(1);
    expect(r.applied()).toMatchObject({ kind: 'mid', round: 5, source: 'claude' });
    expect(s.call!.source).toBe('claude'); // on screen
    expect(s.call!.kind).toBe('mid');
    // More intel on the same site: no new request.
    await r.intel('bapps', 2, 20_000);
    expect(asked()).toBe(1);
    // The read flips to A: the stale Claude call goes away and Claude is asked again.
    await r.intel('bapps', 0, 22_000);
    await r.intel('aramp', 4, 23_000);
    await r.intel('palace', 2, 24_000);
    s = await r.intel('aramp', 5, 26_000);
    expect(r.engine()!.head).toMatch(/^A hit likely/);
    expect(asked()).toBe(2);
    expect(r.appliedLog.includes(undefined)).toBe(true); // cleared before the new one
    expect(s.call!.source).toBe('claude');
    const log = r.coach.view.calls.filter(c => c.trigger === 'intel');
    expect(log.map(c => c.status)).toEqual(['ok', 'ok']);
    expect(r.coach.view.messages.filter(m => m.kind === 'call').length).toBeGreaterThanOrEqual(2);
  });

  it('logs a skipped intel call when the budget is used', async () => {
    const r = await liveRound5({ config: { callBudget: 1 } });
    await r.intel('bapps', 3, 15_000);
    expect(r.session().count('Intel in round')).toBe(0);
    expect(r.coach.view.calls[0]).toMatchObject({ trigger: 'intel', status: 'skipped' });
    expect(r.applied()?.kind).not.toBe('mid');
  });

  it('shows a Claude mid call only while the engine still calls a plan change in that round', () => {
    const t = new MatchTracker({ playbookHandle: 'a' });
    let s: LiveSnapshot | undefined;
    for (const { t: ts, p } of syntheticMatch({ rounds: FIRST_HALF })) { t.ingest(toGameState(p, ts)); s = t.snapshot(ts); if (s.match?.round === 2 && s.match.clock.phase === 'live') break; }
    const claudeMid: CallView = { kind: 'mid', round: 2, head: 'Claude mid', sub: '', jobs: { a: 'Hold' }, steps: [], why: [], source: 'claude' };
    expect(withCoachCall(s!, claudeMid, 'a').call!.source).toBe('engine'); // engine call is still 'pre'
    const engineMid = { ...s!, call: { ...s!.call!, kind: 'mid' as const } };
    expect(withCoachCall(engineMid, claudeMid, 'a').call).toMatchObject({ head: 'Claude mid', you: 'Hold' });
    expect(withCoachCall({ ...engineMid, call: { ...engineMid.call, kind: 'post' } }, claudeMid, 'a').call!.source).toBe('engine');
    expect(withCoachCall({ ...engineMid, match: { ...engineMid.match!, round: 3 } }, claudeMid, 'a').call!.source).toBe('engine');
  });
});
