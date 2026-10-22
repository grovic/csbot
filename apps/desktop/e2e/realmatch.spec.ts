// The real-match measurement run end to end (M9): a hidden host started like the playtest shortcut
// (--metrics, here CSBOT_METRICS_FILE) with the live coach on the fake `claude`, and a browser member
// in its room. A few rounds later, the events file holds the round ends and each screen's calls, and
// tools/real-match turns it into the V1 numbers. Also: between rounds the call is already the next
// round's, and Claude's lands before freeze time.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { FIRST_HALF, syntheticMatch } from '@csbot/gsi';
import { startRoomRelay, type RoomRelay } from '@csbot/room-relay';
import { analyze, type Event, type Sample } from '../../../tools/real-match/src/analyze.ts';
import { launchApp, postGsi, screens, serveDir, shot, waitFor, webDist, type LaunchedApp } from './helpers.ts';

test.describe.configure({ mode: 'serial' });

let relay: RoomRelay, site: { url: string; close: () => Promise<void> }, browser: Browser;
let host: LaunchedApp, web: Page, metricsDir: string;
const metricsFile = () => path.join(metricsDir, 'run.ndjson');
const lines = <T>(f: string) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as T) : []);

test.beforeAll(async () => {
  if (!fs.existsSync(path.join(webDist, 'index.html'))) throw new Error('build apps/web first');
  metricsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csbot-realmatch-'));
  relay = await startRoomRelay();
  site = await serveDir(webDist);
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  host = await launchApp({ CSBOT_SIGNAL: relay.url, CSBOT_COACH: 'on', FAKE_COACH_DELAY: '300', CSBOT_METRICS_FILE: metricsFile() });
});

test.afterAll(async () => {
  await browser?.close();
  await host?.close().catch(() => {});
  await site?.close();
  await relay?.close();
  fs.rmSync(metricsDir, { recursive: true, force: true });
});

test('a member joins the host\'s room', async () => {
  const p = host.page;
  await p.getByTestId('room-chip').click();
  await p.getByTestId('create-room').click();
  const invite = await waitFor(async () => { const v = await p.getByTestId('invite-link').inputValue().catch(() => ''); return v.includes('#/r/') ? v : undefined; });
  web = await (await browser.newContext()).newPage();
  await web.goto(site.url + invite.slice(invite.indexOf('#')));
  await web.getByTestId('join-name').fill('kairo');
  await web.getByTestId('join-submit').click();
  const row = host.page.getByTestId('pending-row').filter({ hasText: 'kairo' });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.getByTestId('approve').click();
  await expect(web.getByTestId('link-status')).toHaveAttribute('data-status', 'approved', { timeout: 15_000 });
  await web.goto(web.url().replace(/#.*$/, '#/live'));
  await host.page.goto(host.page.url().replace(/#.*$/, '#/live'));
});

test("between rounds the call is already the next round's, and Claude's lands before freeze time", async () => {
  test.setTimeout(90_000);
  const rec = syntheticMatch({ rounds: FIRST_HALF.slice(0, 4), lean: true });
  let shotTaken = false;
  for (const [i, r] of rec.entries()) {
    expect((await postGsi(host.runtime, r.p)).status).toBe(200);
    const next = rec[i + 1];
    // Phases last seconds in a real match; here, long enough for the host's snapshot throttle (100 ms).
    if (next && next.p.round?.phase !== r.p.round?.phase) await host.page.waitForTimeout(150);
    // A round just ended (the next payload starts the next freeze time): give the coach time to answer.
    if (r.p.round?.phase === 'over' && next?.p.round?.phase === 'freezetime') {
      const round = (r.p.map?.round ?? 0) + 2; // GSI counts finished rounds: round N ends with map.round N - 1
      await expect(host.page.getByTestId('call')).toHaveAttribute('data-kind', 'pre');
      await expect(host.page.getByTestId('call-source')).toHaveAttribute('data-source', 'claude', { timeout: 10_000 });
      await expect(host.page.locator('.call .kick')).toHaveText(`Next round · round ${round}`);
      await expect(web.getByTestId('call-source')).toHaveAttribute('data-source', 'claude', { timeout: 10_000 });
      if (!shotTaken && round === 3) { shotTaken = true; await shot(host, path.join(screens, 'desktop-next-round.png')); }
    }
  }
});

test('the events file holds the V1 numbers for every screen', async () => {
  await host.page.waitForTimeout(1500);
  const events = lines<Event>(metricsFile().replace(/\.ndjson$/, '.events.ndjson'));
  expect(events[0]).toMatchObject({ ev: 'start', lowMemory: true });
  expect(events.some(e => e.ev === 'window')).toBe(true);
  expect(events).toContainEqual(expect.objectContaining({ ev: 'online', name: 'kairo', device: 'web' }));
  expect(events.filter(e => e.ev === 'shown' && e.device === 'web').map(e => e.key)).toEqual(expect.arrayContaining(['2:pre:engine', '2:pre:claude', '3:pre:claude']));
  expect(events.filter(e => e.ev === 'coach' && e.trigger === 'freeze').length).toBeGreaterThanOrEqual(3);

  const [m] = analyze(lines<Sample>(metricsFile()), events, { cores: os.cpus().length });
  expect(m).toMatchObject({ map: 'de_mirage', rounds: 4 });
  expect(m!.calls.roundEnds).toBe(3);
  const screensSeen = m!.calls.screens.map(s => s.device).sort();
  expect(screensSeen).toEqual(['host', 'web']);
  for (const s of m!.calls.screens) {
    expect(s.firstCall.n).toBe(3);
    expect(s.claudeCall.n).toBe(3);
  }
  expect(m!.calls.firstCallP95!).toBeLessThan(2);
  expect(m!.calls.claudeCallP95!).toBeLessThan(8);
  expect(m!.calls.pass).toBe(true);
  expect(m!.coach.requests).toBeGreaterThanOrEqual(3);
  expect(m!.footprint?.samples).toBeGreaterThan(2);
});
