// The live coach in the web app (M5): the Coach page (demo, desktop host, room member), the Claude
// call on the Live card, and voice callouts. The desktop bridge is mocked and driven from here with
// snapshots computed by the real engine; rooms run over real WebRTC through the local relay.

import { MatchTracker } from '@csbot/engine';
import { FIRST_HALF, syntheticMatch, toGameState } from '@csbot/gsi';
import { DEFAULT_COACH_CONFIG, type CoachView, type LiveSnapshot } from '@csbot/protocol';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCREENS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'screens');
fs.mkdirSync(SCREENS, { recursive: true });
const shot = (page: Page, name: string, fullPage = true) => page.screenshot({ path: path.join(SCREENS, `${name}.png`), fullPage });

test.describe.configure({ timeout: 120_000 });

/** Snapshots at freeze time of each round (Mirage, CT side), with our playbook slot 'a' for a YOU line. */
function freezeSnaps(): Map<number, LiveSnapshot> {
  const t = new MatchTracker({ playbookHandle: 'a' });
  const out = new Map<number, LiveSnapshot>();
  for (const { t: at, p } of syntheticMatch({ rounds: FIRST_HALF })) {
    t.ingest(toGameState(p, at));
    const s = t.snapshot(at);
    if (s.match?.clock.phase === 'freezetime' && !out.has(s.match.round)) out.set(s.match.round, s);
  }
  return out;
}
const SNAPS = freezeSnaps();

const coachView = (patch: Partial<CoachView> = {}): CoachView => ({
  status: 'ready', config: { ...DEFAULT_COACH_CONFIG }, budget: { used: 3, max: 40 },
  quota: { perMember: 5, used: {} }, messages: [{ id: 's1', at: Date.UTC(2026, 9, 21, 20), kind: 'system', text: 'Coach ready: Claude Code warmed up for Mirage.' }],
  calls: [{ id: 'w', at: Date.UTC(2026, 9, 21, 20), round: 0, trigger: 'warmup', status: 'ok', model: 'sonnet', ms: 5600 }],
  ...patch,
});

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  return errors;
}

/**
 * A fake desktop bridge with the coach: __pushSnap, __pushCoach drive it; __calls records asks
 * ("ask:<text>:<role>:<name>") and config patches; __slots records setRoomSlots.
 * askCoach refuses any question containing "budget".
 */
async function mockBridge(ctx: BrowserContext, speech = false) {
  await ctx.addInitScript((stubSpeech: boolean) => {
    type Cb = (x: unknown) => void;
    const snapCbs = new Set<Cb>(), coachCbs = new Set<Cb>();
    let last: unknown, lastCoach: unknown;
    const w = window as unknown as Record<string, unknown>;
    const calls: string[] = [], patches: unknown[] = [], slots: unknown[] = [];
    Object.assign(w, { __calls: calls, __patches: patches, __slots: slots });
    w.__pushSnap = (s: unknown) => { last = s; for (const cb of snapCbs) cb(s); };
    w.__pushCoach = (c: unknown) => { lastCoach = c; for (const cb of coachCbs) cb(c); };
    w.csbot = {
      onSnapshot: (cb: Cb) => { snapCbs.add(cb); if (last) cb(last); return () => snapCbs.delete(cb); },
      onCoach: (cb: Cb) => { coachCbs.add(cb); if (lastCoach) cb(lastCoach); return () => coachCbs.delete(cb); },
      getInfo: async () => ({ version: '0.1.0', gsiUrl: 'http://127.0.0.1:47400', cfgStatus: 'current', recordingsDir: 'C:\\csbot\\recordings' }),
      installCfg: async () => ({ ok: true }),
      openRecordings: async () => {},
      askCoach: async (text: string, from?: { id: string; name: string; role: string }) => {
        calls.push(`ask:${text}:${from?.role ?? 'admin'}:${from?.name ?? ''}:${from?.id ?? ''}`);
        return text.includes('budget') ? { ok: false, error: 'The coach has used its 40 calls for this match.' } : { ok: true };
      },
      setCoachConfig: async (patch: Record<string, unknown>) => {
        patches.push(patch);
        const c = lastCoach as { config: Record<string, unknown> } | undefined;
        if (c) (w.__pushCoach as Cb)({ ...c, config: { ...c.config, ...patch } });
      },
      setRoomSlots: (members: unknown, opts: unknown) => { slots.push({ members, opts }); },
      setRoomRoster: () => {},
    };
    if (stubSpeech) {
      const spoken: string[] = [];
      w.__spoken = spoken;
      class Utterance { text: string; rate = 1; constructor(t: string) { this.text = t; } }
      Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: Utterance, configurable: true, writable: true });
      Object.defineProperty(window, 'speechSynthesis', { value: { speak: (u: Utterance) => { spoken.push(u.text); }, cancel: () => {} }, configurable: true });
    }
  }, speech);
}

const pushSnap = (page: Page, s: LiveSnapshot) => page.evaluate(x => (window as unknown as { __pushSnap: (s: unknown) => void }).__pushSnap(x), s);
const pushCoach = (page: Page, c: CoachView) => page.evaluate(x => (window as unknown as { __pushCoach: (c: unknown) => void }).__pushCoach(x), c);
const recorded = <T,>(page: Page, key: '__calls' | '__patches' | '__slots' | '__spoken') => page.evaluate(k => (window as unknown as Record<string, unknown>)[k], key) as Promise<T[]>;

test('demo: the Coach page shows a fictional chat, reasoning, economy, call log and read-only config', async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('./?at=freeze-2%2B3&pause=1#/coach');
  await expect(page.getByTestId('coach-page')).toBeVisible();
  await expect(page.getByTestId('coach-status')).toHaveAttribute('data-status', 'ready');
  await expect(page.getByTestId('coach-budget')).toHaveText('14 of 40 calls');
  const msgs = page.getByTestId('coach-msg');
  await expect(msgs).toHaveCount(9);
  await expect(page.locator('[data-testid="coach-msg"][data-kind="question"]').first()).toContainText('KAIRO');
  // Answers sit right under their question.
  const kinds = await msgs.evaluateAll(els => els.map(e => e.getAttribute('data-kind')));
  expect(kinds.indexOf('answer')).toBe(kinds.indexOf('question') + 1);
  await expect(page.getByTestId('coach-reasoning')).toContainText('Anti-eco · stack B');
  await expect(page.getByTestId('coach-reasoning')).toContainText("Everyone's job");
  await expect(page.getByTestId('coach-input')).toBeDisabled();
  await expect(page.getByTestId('coach-ask-reason')).toContainText('Demo');
  await shot(page, 'coach', false);

  await page.getByTestId('coach-tab-economy').click();
  await expect(page.getByTestId('coach-economy')).toContainText('estimate');
  await expect(page.getByTestId('coach-economy')).toContainText('next loss pays');
  await page.getByTestId('coach-tab-calls').click();
  await expect(page.getByTestId('call-log-row')).toHaveCount(7);
  await expect(page.locator('[data-testid="call-log-row"][data-status="skipped"]')).toHaveCount(1);
  await page.getByTestId('coach-tab-config').click();
  await expect(page.getByTestId('cfg-model')).toBeDisabled();
  await expect(page.getByTestId('cfg-model')).toHaveValue('sonnet');
  await expect(page.getByText('READ-ONLY')).toBeVisible();
  expect(errors).toEqual([]);
});

test('desktop: Claude\'s call on the Live card, asking, a refusal, and the coach settings', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await mockBridge(ctx);
  const page = await ctx.newPage();
  const errors = watchErrors(page);
  await page.goto('./#/live');
  const engine = SNAPS.get(2)!;
  await pushSnap(page, engine);
  await pushCoach(page, coachView({
    calls: [
      { id: 'c2', at: Date.UTC(2026, 9, 21, 20, 3), round: 2, trigger: 'freeze', status: 'ok', model: 'sonnet', ms: 3140, head: 'Anti-eco: stack B 3-2', costUsd: 0.04 },
      { id: 'w', at: Date.UTC(2026, 9, 21, 20), round: 0, trigger: 'warmup', status: 'ok', model: 'sonnet', ms: 5600, costUsd: 0.012 },
    ],
  }));
  await expect(page.getByTestId('call-source')).toHaveAttribute('data-source', 'engine');
  await expect(page.getByTestId('call-source')).toHaveText('local engine');
  // Claude's call replaces the engine's for the same moment.
  await pushSnap(page, { ...engine, seq: engine.seq + 1, call: { ...engine.call!, source: 'claude', head: 'Anti-eco: stack B 3-2', sub: 'Likely eco: long angles, trade in pairs' } });
  await expect(page.getByTestId('call-source')).toHaveAttribute('data-source', 'claude');
  await expect(page.getByTestId('call-source')).toHaveText('Claude Code · sonnet · 3.1 s');
  await expect(page.getByTestId('call')).toHaveClass(/upgraded/);
  await expect(page.getByTestId('call-head')).toHaveText('Anti-eco: stack B 3-2');
  await shot(page, 'live-claude-call', false);

  // Asking as the host (admin): it goes to askCoach with no "from".
  await page.evaluate(() => { location.hash = '#/coach'; });
  await expect(page.getByTestId('coach-quota')).toContainText('match budget: 37 calls left');
  await page.getByTestId('coach-input').fill('Where is their AWP?');
  await page.getByTestId('coach-send').click();
  await expect(page.getByTestId('coach-input')).toHaveValue('');
  await page.getByTestId('coach-input').fill('Can we go over budget?');
  await page.getByTestId('coach-send').click();
  await expect(page.getByTestId('coach-ask-error')).toContainText('used its 40 calls');
  expect(await recorded<string>(page, '__calls')).toEqual(['ask:Where is their AWP?:admin::', 'ask:Can we go over budget?:admin::']);

  // An answer arrives in the chat, under its question.
  await pushCoach(page, coachView({
    messages: [
      { id: 'q1', at: 1, kind: 'question', author: 'rdx', authorId: 'host', round: 2, text: 'Where is their AWP?' },
      { id: 'c1', at: 2, kind: 'call', round: 2, text: 'Anti-eco: stack B 3-2 · Likely eco: long angles, trade in pairs' },
      { id: 'a1', at: 3, kind: 'answer', replyTo: 'q1', round: 2, ms: 2800, text: 'Holo is likely their AWP: expect him mid from top mid or window.' },
    ],
  }));
  const kinds = await page.getByTestId('coach-msg').evaluateAll(els => els.map(e => e.getAttribute('data-kind')));
  expect(kinds).toEqual(['question', 'answer', 'call']);
  await expect(page.locator('[data-kind="question"]')).toHaveClass(/mine/);

  // Settings: each change goes to the host process.
  await page.getByTestId('coach-tab-config').click();
  await page.getByTestId('cfg-model').selectOption('haiku');
  await page.getByTestId('cfg-budget').fill('30');
  await page.getByTestId('cfg-budget').press('Enter');
  await page.getByTestId('cfg-quota').fill('3');
  await page.getByTestId('cfg-quota').press('Tab');
  await page.getByTestId('cfg-postplant').uncheck();
  await expect(page.getByTestId('cfg-model')).toHaveValue('haiku');
  await shot(page, 'coach-config', false);
  await page.getByTestId('cfg-enabled').uncheck();
  expect(await recorded(page, '__patches')).toEqual([{ model: 'haiku' }, { callBudget: 30 }, { memberQuota: 3 }, { postPlant: false }, { enabled: false }]);
  // A bad number is refused locally (not sent).
  await page.getByTestId('cfg-budget').fill('-4');
  await page.getByTestId('cfg-budget').press('Enter');
  await expect(page.getByTestId('cfg-budget')).toHaveValue('30');
  expect(await recorded(page, '__patches')).toHaveLength(5);
  expect(errors).toEqual([]);
  await ctx.close();
});

const relay = () => process.env.CSBOT_RELAY!;
const status = (page: Page) => page.getByTestId('link-status');

async function hostRoom(browserCtx: BrowserContext) {
  const page = await browserCtx.newPage();
  const errors = watchErrors(page);
  await page.goto(`./?signal=${encodeURIComponent(relay())}#/room`);
  await pushSnap(page, SNAPS.get(2)!);
  await page.getByTestId('create-room').click();
  const invite = await page.getByTestId('invite-link').inputValue();
  return { page, errors, invite };
}

test('room: a member asks the coach within their quota and sees the answer', async ({ browser }) => {
  const hostCtx = await browser.newContext();
  await mockBridge(hostCtx);
  const host = await hostRoom(hostCtx);
  await pushCoach(host.page, coachView());

  const memCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const mem = await memCtx.newPage();
  const memErrors = watchErrors(mem);
  await mem.goto(host.invite);
  await mem.getByTestId('join-name').fill('kairo');
  await mem.getByTestId('join-submit').click();
  const pending = host.page.getByTestId('pending-row').filter({ hasText: 'kairo' });
  await pending.getByTestId('approve').click({ timeout: 30_000 });
  await expect(status(mem)).toHaveAttribute('data-status', 'approved', { timeout: 15_000 });

  // The host process learns the room's slots (and that tournament mode is off).
  await expect.poll(async () => {
    const s = await recorded<{ members: { name: string; slot?: string }[]; opts: { tournament: boolean } }>(host.page, '__slots');
    const last = s[s.length - 1];
    return last ? { names: last.members.map(m => m.name), kairoSlot: !!last.members.find(m => m.name === 'kairo')?.slot, tournament: last.opts.tournament } : undefined;
  }).toEqual({ names: ['rdx', 'kairo'], kairoSlot: true, tournament: false });

  await mem.evaluate(() => { location.hash = '#/coach'; });
  await expect(mem.getByTestId('coach-status')).toHaveAttribute('data-status', 'ready', { timeout: 10_000 });
  await expect(mem.getByTestId('coach-quota')).toHaveText('5 of 5 questions left this match');
  await mem.getByTestId('coach-input').fill('Where do they hit on ecos?');
  await mem.getByTestId('coach-send').click();
  await expect(mem.getByTestId('coach-input')).toHaveValue('', { timeout: 15_000 });
  const asks = await recorded<string>(host.page, '__calls');
  expect(asks).toHaveLength(1);
  const [, text, role, name, id] = asks[0]!.split(':');
  expect({ text, role, name }).toEqual({ text: 'Where do they hit on ecos?', role: 'member', name: 'kairo' });

  // The host's coach answers: the member sees it, and their quota goes down.
  await pushCoach(host.page, coachView({
    budget: { used: 4, max: 40 }, quota: { perMember: 5, used: { [id!]: 1 } },
    messages: [
      { id: 'q1', at: 1, kind: 'question', author: 'kairo', authorId: id, round: 2, text: 'Where do they hit on ecos?' },
      { id: 'a1', at: 2, kind: 'answer', replyTo: 'q1', round: 2, ms: 2900, text: 'Likely a B apps rush: hold long from bench and van, trade in pairs.' },
    ],
  }));
  await expect(mem.locator('[data-testid="coach-msg"][data-kind="answer"]')).toContainText('B apps rush', { timeout: 10_000 });
  await expect(mem.locator('[data-testid="coach-msg"][data-kind="question"]')).toHaveClass(/mine/);
  await expect(mem.getByTestId('coach-quota')).toHaveText('4 of 5 questions left this match');
  await expect(mem.getByTestId('coach-tab-config')).toBeVisible();
  await mem.getByTestId('coach-tab-config').click();
  await expect(mem.getByTestId('cfg-model')).toBeDisabled();
  await mem.getByTestId('coach-tab-reasoning').click();
  await shot(mem, 'coach-member', false);

  // Tournament mode: the host process is told, and the member can't ask.
  await host.page.getByTestId('tournament-toggle').check();
  await expect.poll(async () => {
    const s = await recorded<{ opts: { tournament: boolean } }>(host.page, '__slots');
    return s[s.length - 1]?.opts.tournament;
  }).toBe(true);
  await expect(mem.getByTestId('coach-ask-reason')).toContainText('Tournament mode', { timeout: 10_000 });
  expect(memErrors).toEqual([]);
  expect(host.errors).toEqual([]);
  await hostCtx.close();
  await memCtx.close();
});

test('voice: reads your job once per new call, never in tournament mode', async ({ browser }) => {
  const ctx = await browser.newContext();
  await mockBridge(ctx, true);
  const host = await hostRoom(ctx);
  // The host plays the A slot, so its screen has a YOU line.
  await host.page.getByTestId('member-row').filter({ hasText: '(you)' }).getByTestId('slot-select').selectOption('a');
  await host.page.evaluate(() => { location.hash = '#/live'; });
  await expect(host.page.getByTestId('call-you')).toBeVisible();

  const toggle = host.page.getByTestId('voice-toggle');
  await expect(toggle).toHaveAttribute('data-state', 'off');
  await toggle.click();
  await expect(toggle).toHaveAttribute('data-state', 'on');
  expect(await host.page.evaluate(() => localStorage.getItem('csbot.voice'))).toBe('on');
  // Turning voice on doesn't read the current call.
  await host.page.waitForTimeout(300);
  expect(await recorded(host.page, '__spoken')).toEqual([]);

  const r3 = SNAPS.get(3)!;
  await pushSnap(host.page, r3);
  await expect.poll(() => recorded(host.page, '__spoken')).toEqual([r3.call!.jobs.a]);
  // The same call again: no repeat.
  await pushSnap(host.page, { ...r3, seq: r3.seq + 1 });
  await host.page.waitForTimeout(400);
  expect(await recorded(host.page, '__spoken')).toHaveLength(1);

  // Tournament mode: silence.
  await host.page.evaluate(() => { location.hash = '#/room'; });
  await host.page.getByTestId('tournament-toggle').check();
  await host.page.evaluate(() => { location.hash = '#/live'; });
  await pushSnap(host.page, SNAPS.get(4)!);
  await expect(host.page.getByTestId('call')).toHaveAttribute('data-kind', 'tournament');
  await host.page.waitForTimeout(400);
  expect(await recorded(host.page, '__spoken')).toHaveLength(1);
  expect(host.errors).toEqual([]);
  await ctx.close();
});
