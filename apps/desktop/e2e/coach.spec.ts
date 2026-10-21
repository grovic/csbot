// The live coach end to end in the hidden desktop app, on the fake `claude` (stream-json mode; never a
// real model): Claude's call replaces the engine's at freeze time, the Coach page shows the chat, the
// host and a browser member in a room ask questions, and a used-up budget falls back to the engine.

import fs from 'node:fs';
import path from 'node:path';
import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { FIRST_HALF, syntheticMatch, type RecordedPayload } from '@csbot/gsi';
import type { CoachView, LiveSnapshot } from '@csbot/protocol';
import { startRoomRelay, type RoomRelay } from '@csbot/room-relay';
import { launchApp, postGsi, screens, serveDir, shot, waitFor, webDist, type LaunchedApp } from './helpers.ts';

test.describe.configure({ mode: 'serial' });

let relay: RoomRelay, site: { url: string; close: () => Promise<void> }, browser: Browser;
let host: LaunchedApp, web: Page | undefined;

/** Payloads up to (and two into) a given round's freeze time. */
function upToFreeze(rec: RecordedPayload[], round: number): RecordedPayload[] {
  const i = rec.findIndex(r => r.p.map?.round === round - 1 && r.p.round?.phase === 'freezetime');
  return rec.slice(0, i + 2);
}

/** Collect every coach view and snapshot the renderer receives. */
async function watch(a: LaunchedApp): Promise<void> {
  await a.page.evaluate(() => {
    const w = window as unknown as { __coach: CoachView[]; __snaps: LiveSnapshot[] };
    w.__coach = []; w.__snaps = [];
    window.csbot!.onCoach!(v => { w.__coach.push(v); });
    window.csbot!.onSnapshot(s => { w.__snaps.push(s); if (w.__snaps.length > 50) w.__snaps.shift(); });
  });
}
const lastCoach = (a: LaunchedApp) => a.page.evaluate(() => { const c = (window as unknown as { __coach: CoachView[] }).__coach; return c[c.length - 1]; });
const lastSnap = (a: LaunchedApp) => a.page.evaluate(() => { const c = (window as unknown as { __snaps: LiveSnapshot[] }).__snaps; return c[c.length - 1]; });
const hasUi = async (p: Page, id: string) => (await p.getByTestId(id).count()) > 0;

test.beforeAll(async () => {
  if (!fs.existsSync(path.join(webDist, 'index.html'))) throw new Error('build apps/web first');
  relay = await startRoomRelay();
  site = await serveDir(webDist);
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  host = await launchApp({ CSBOT_COACH: 'on', FAKE_COACH_DELAY: '150', CSBOT_SIGNAL: relay.url });
  await watch(host);
});

test.afterAll(async () => {
  await browser?.close();
  await host?.close();
  await site?.close();
  await relay?.close();
});

test("at freeze time Claude's call replaces the engine call, and the log records it", async () => {
  await waitFor(async () => (await lastCoach(host))?.config.enabled === true).catch(async e => { console.log('coach view:', JSON.stringify(await lastCoach(host))); throw e; });
  for (const r of upToFreeze(syntheticMatch({ rounds: FIRST_HALF.slice(0, 3), lean: true }), 2)) expect((await postGsi(host.runtime, r.p)).status).toBe(200);
  const snap = await waitFor(async () => { const s = await lastSnap(host); return s?.call?.source === 'claude' && s.match?.round === 2 ? s : undefined; }, 20_000)
    .catch(async e => { const s = await lastSnap(host); console.log('snap:', JSON.stringify({ round: s?.match?.round, phase: s?.match?.clock.phase, call: s?.call?.head, src: s?.call?.source }), 'coach:', JSON.stringify((await lastCoach(host))?.calls)); throw e; });
  expect(snap.call!.head).toBe('Claude: stack B, round 2');
  expect(Object.keys(snap.call!.jobs)).toEqual(['a', 'b']); // the invented slot is dropped
  const v = await waitFor(async () => { const c = await lastCoach(host); return c?.calls.some(x => x.trigger === 'freeze' && x.round === 2 && x.status === 'ok') ? c : undefined; });
  // The replay is faster than real time, so round 1's call can land after round 2 began: logged as late, not shown.
  const log = v.calls.map(c => `${c.trigger}:${c.round}:${c.status}`).reverse().slice(0, 3);
  expect(log[0]).toBe('warmup:1:ok');
  expect(log[1]).toMatch(/^freeze:1:(ok|late)$/);
  expect(log[2]).toBe('freeze:2:ok');
  expect(v.calls[0]!.model).toBe('claude-fake-sonnet');
  expect(v.budget.used).toBe(3);
  expect(v.messages.filter(m => m.kind === 'call').map(m => m.text)).toContain('Claude: stack B, round 2 · Likely eco, hold long angles');
});

test('the Live page shows the Claude call with its source', async () => {
  test.skip(!(await hostHasCoachUi()), 'web Coach UI not built yet');
  const p = host.page;
  await p.evaluate(() => { location.hash = '#/live'; });
  await expect(p.getByTestId('call-head')).toHaveText('Claude: stack B, round 2', { timeout: 10_000 });
  await expect(p.getByTestId('call-source')).toHaveAttribute('data-source', 'claude');
});

test('the host asks from the Coach page and gets an answer in the chat', async () => {
  const p = host.page;
  if (await hostHasCoachUi()) {
    await p.evaluate(() => { location.hash = '#/coach'; });
    await expect(p.getByTestId('coach-page')).toBeVisible();
    await expect(p.getByTestId('coach-msg').filter({ hasText: 'Claude: stack B, round 2' }).first()).toBeVisible();
    await p.getByTestId('coach-input').fill('Where do they rush on ecos?');
    await p.getByTestId('coach-send').click();
    await expect(p.getByTestId('coach-msg').filter({ hasText: 'Answer to: Where do they rush on ecos?' })).toBeVisible({ timeout: 10_000 });
    await p.waitForTimeout(300);
    await shot(host, path.join(screens, 'desktop-coach.png'));
  } else {
    expect(await p.evaluate(() => window.csbot!.askCoach!('Where do they rush on ecos?'))).toEqual({ ok: true });
  }
  const v = await waitFor(async () => { const c = await lastCoach(host); return c?.messages.some(m => m.kind === 'answer') ? c : undefined; });
  const q = v.messages.find(m => m.kind === 'question')!;
  expect(q).toMatchObject({ authorId: 'host', text: 'Where do they rush on ecos?' });
  expect(v.messages.find(m => m.kind === 'answer')).toMatchObject({ replyTo: q.id, text: 'Answer to: Where do they rush on ecos?' });
});

test('a browser member in the room asks, and both screens get the answer', async () => {
  test.skip(!(await hostHasCoachUi()), 'web Coach UI not built yet');
  const p = host.page;
  await p.getByTestId('room-chip').click();
  await p.getByTestId('create-room').click();
  const invite = await waitFor(async () => { const v = await p.getByTestId('invite-link').inputValue().catch(() => ''); return v.includes('#/r/') ? v : undefined; });
  web = await (await browser.newContext()).newPage();
  const errors: string[] = [];
  web.on('pageerror', e => errors.push(e.message));
  await web.goto(site.url + invite.slice(invite.indexOf('#')));
  await web.getByTestId('join-name').fill('kairo');
  await web.getByTestId('join-submit').click();
  const row = p.getByTestId('pending-row').filter({ hasText: 'kairo' });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.getByTestId('approve').click();
  await expect(web.getByTestId('link-status')).toHaveAttribute('data-status', 'approved', { timeout: 15_000 });

  await web.goto(web.url().replace(/#.*$/, '#/coach'));
  await expect(web.getByTestId('coach-page')).toBeVisible();
  await expect(web.getByTestId('coach-msg').filter({ hasText: 'Answer to: Where do they rush on ecos?' })).toBeVisible({ timeout: 10_000 });
  await web.getByTestId('coach-input').fill('Should I save this round?');
  await web.getByTestId('coach-send').click();
  await expect(web.getByTestId('coach-msg').filter({ hasText: 'Answer to: Should I save this round?' })).toBeVisible({ timeout: 15_000 });
  const v = await waitFor(async () => { const c = await lastCoach(host); return c?.messages.some(m => m.text === 'Should I save this round?') ? c : undefined; });
  const q = v.messages.find(m => m.text === 'Should I save this round?')!;
  expect(q.author).toBe('kairo');
  expect(v.quota.used[q.authorId!]).toBe(1);
  expect(errors).toEqual([]);
});

test('a used-up budget falls back to the engine call and logs the skip', async () => {
  const b = await launchApp({ CSBOT_COACH: 'on', FAKE_COACH_DELAY: '100' });
  try {
    await watch(b);
    await waitFor(async () => (await lastCoach(b))?.config.enabled === true);
    await b.page.evaluate(() => window.csbot!.setCoachConfig!({ callBudget: 2 }));
    await waitFor(async () => (await lastCoach(b))?.budget.max === 2);
    for (const r of upToFreeze(syntheticMatch({ rounds: FIRST_HALF.slice(0, 3), lean: true }), 2)) await postGsi(b.runtime, r.p);
    const v = await waitFor(async () => { const c = await lastCoach(b); return c?.calls.some(x => x.status === 'skipped' && x.round === 2) ? c : undefined; });
    expect(v.status).toBe('budget');
    expect(v.calls.find(x => x.round === 2)).toMatchObject({ trigger: 'freeze', status: 'skipped' });
    await b.page.waitForTimeout(500);
    const s = await lastSnap(b);
    expect(s?.match?.round).toBe(2);
    expect(s?.call?.source).toBe('engine');
    expect(s?.call?.head).toBe('Anti-eco · stack B');
    // The budget setting is saved for next launch.
    const saved = JSON.parse(fs.readFileSync(path.join(b.dir, 'userData', 'settings.json'), 'utf8')) as { coach?: { callBudget?: number } };
    expect(saved.coach?.callBudget).toBe(2);
  } finally {
    await b.close();
  }
});

/** The web build has the Coach page (the web fork builds it alongside). */
async function hostHasCoachUi(): Promise<boolean> {
  const p = host.page;
  const before = await p.evaluate(() => location.hash);
  await p.evaluate(() => { location.hash = '#/coach'; });
  await p.waitForTimeout(300);
  const ok = await hasUi(p, 'coach-page');
  await p.evaluate(h => { location.hash = h; }, before);
  return ok;
}
