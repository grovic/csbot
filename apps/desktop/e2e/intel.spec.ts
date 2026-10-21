// Intel end to end in the hidden desktop app (M4a): intel logged through the bridge moves the forecast,
// turns the call into "plan changed", and the live coach (fake claude, never a real model) replaces it
// with its own mid-round call. Numpad hotkeys are switched on and off through the bridge; hidden runs
// use a recording stand-in, so the owner's numpad is never taken.

import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { FULL_MATCH, syntheticMatch } from '@csbot/gsi';
import type { CoachView, HostInfo, LiveSnapshot } from '@csbot/protocol';
import { launchApp, postGsi, screens, shot, waitFor, type LaunchedApp } from './helpers.ts';

test.describe.configure({ mode: 'serial' });

let host: LaunchedApp;

async function watch(p: Page): Promise<void> {
  await p.evaluate(() => {
    const w = window as unknown as { __coach: CoachView[]; __snaps: LiveSnapshot[] };
    w.__coach = []; w.__snaps = [];
    window.csbot!.onCoach!(v => { w.__coach.push(v); });
    window.csbot!.onSnapshot(s => { w.__snaps.push(s); if (w.__snaps.length > 50) w.__snaps.shift(); });
  });
}
const lastSnap = (a: LaunchedApp) => a.page.evaluate(() => { const c = (window as unknown as { __snaps: LiveSnapshot[] }).__snaps; return c[c.length - 1]; });
const lastCoach = (a: LaunchedApp) => a.page.evaluate(() => { const c = (window as unknown as { __coach: CoachView[] }).__coach; return c[c.length - 1]; });

test.beforeAll(async () => {
  host = await launchApp({ CSBOT_COACH: 'on', FAKE_COACH_DELAY: '150' });
  await watch(host.page);
  await waitFor(async () => (await lastCoach(host))?.config.enabled === true);
});
test.afterAll(async () => { await host?.close(); });

test('intel is refused before a live round', async () => {
  const r = await host.page.evaluate(() => window.csbot!.logIntel!('bapps', 3));
  expect(r.ok).toBe(false);
});

test('intel moves the forecast, the call turns "plan changed", and Claude writes the mid-round call', async () => {
  test.setTimeout(90_000);
  const rec = syntheticMatch({ rounds: FULL_MATCH, lean: true });
  const live5 = rec.findIndex(r => r.p.map?.round === 4 && r.p.round?.phase === 'live');
  for (const r of rec.slice(0, live5 + 1)) expect((await postGsi(host.runtime, r.p)).status).toBe(200);
  const before = await waitFor(async () => { const s = await lastSnap(host); return s?.match?.round === 5 && s.match.clock.phase === 'live' ? s : undefined; });
  expect(before.forecast!.basis).toBe('prior');
  // Intel is timed from the round going live: wait until a B rush reaches B apps (~15 s in on the real Mirage).
  await host.page.waitForTimeout(16_000);
  const r = await host.page.evaluate(() => window.csbot!.logIntel!('bapps', 3));
  expect(r).toEqual({ ok: true });
  const s = await waitFor(async () => { const x = await lastSnap(host); return x?.call?.kind === 'mid' && x.call.source === 'claude' ? x : undefined; }, 20_000)
    .catch(async e => { const x = await lastSnap(host); console.log('snap:', JSON.stringify({ call: x?.call?.head, kind: x?.call?.kind, src: x?.call?.source, fc: x?.forecast?.site })); throw e; });
  expect(s.forecast!.basis).toBe('intel');
  expect(s.forecast!.site.B).toBeGreaterThan(0.7);
  expect(s.call!.head).toBe('Claude: rotate on the intel');
  expect(s.intel![0]).toMatchObject({ zone: 'bapps', zoneName: 'B Apps', count: 3, by: ['rdx'] }); // the host's in-game name
  const coach = await waitFor(async () => { const c = await lastCoach(host); return c?.calls.some(x => x.trigger === 'intel' && x.status === 'ok') ? c : undefined; });
  expect(coach.messages.some(m => m.kind === 'call' && m.text.startsWith('Claude: rotate on the intel'))).toBe(true);

  // A room member's intel arrives through the web host with their name.
  const r2 = await host.page.evaluate(() => window.csbot!.logIntel!('topmid', 0, { id: 'client-kairo', name: 'kairo' }));
  expect(r2).toEqual({ ok: true });
  const s2 = await waitFor(async () => { const x = await lastSnap(host); return x?.intel?.length === 2 ? x : undefined; });
  expect(s2.intel![1]).toMatchObject({ zone: 'topmid', count: 0, by: ['kairo'] });
  // Bad input never reaches the tracker.
  expect(await host.page.evaluate(() => window.csbot!.logIntel!('B Apps', 3))).toEqual({ ok: false, error: 'Invalid intel.' });
  expect(await host.page.evaluate(() => window.csbot!.logIntel!('bapps', 9))).toEqual({ ok: false, error: 'Invalid intel.' });
});

test('numpad hotkeys switch on and off, with the keys for the current map (never real global keys here)', async () => {
  const info0 = await host.page.evaluate(() => window.csbot!.getInfo()) as HostInfo;
  expect(info0.intelHotkeys!.enabled).toBe(false); // off by default
  expect(await host.page.evaluate(() => window.csbot!.setIntelHotkeys!(true))).toEqual({ ok: true });
  const info = await host.page.evaluate(() => window.csbot!.getInfo()) as HostInfo;
  expect(info.intelHotkeys!.enabled).toBe(true);
  expect(info.intelHotkeys!.keys.map(k => `${k.key} ${k.zoneName} ${k.kind}`)).toEqual([
    'Num7 A Ramp sighting', 'Num8 Top Mid sighting', 'Num9 B Apps sighting', 'Num1 A Ramp clear', 'Num2 Top Mid clear', 'Num3 B Apps clear',
    'Num5 On my spot checkin', 'Num4 Rotating → A checkin', 'Num6 Rotating → B checkin',
  ]);
  const settings = JSON.parse(fs.readFileSync(path.join(host.dir, 'userData', 'settings.json'), 'utf8')) as { intelHotkeys?: boolean };
  expect(settings.intelHotkeys).toBe(true);
  expect(await host.page.evaluate(() => window.csbot!.setIntelHotkeys!(false))).toEqual({ ok: true });
  expect(((await host.page.evaluate(() => window.csbot!.getInfo())) as HostInfo).intelHotkeys!.enabled).toBe(false);
});

test('a map click logs intel from the Live page (when the web build has the intel controls)', async () => {
  const p = host.page;
  await p.evaluate(() => { location.hash = '#/live'; });
  const zone = p.locator('[data-testid="map-zone"][data-zone="aramp"]');
  test.skip((await zone.count()) === 0, 'this web build has no map intel controls yet');
  await zone.click();
  await p.locator('[data-testid="intel-count"][data-count="2"]').click();
  await expect(p.locator('[data-testid="intel-pin"][data-zone="aramp"]')).toBeVisible({ timeout: 10_000 });
  const s = await waitFor(async () => { const x = await lastSnap(host); return x?.intel?.some(i => i.zone === 'aramp') ? x : undefined; });
  expect(s.intel!.find(i => i.zone === 'aramp')).toMatchObject({ count: 2, by: ['rdx'] });
  await shot(host, path.join(screens, 'desktop-intel.png'));
});
