// Push-to-talk end to end in the hidden desktop app (M7). Hidden runs never open the microphone or take
// a real global key: the key is a stand-in pressed from the main process, and the recognizer "hears"
// the lines in CSBOT_FAKE_VOICE. What's heard goes through the renderer like a click: intel lands in
// the forecast, a question reaches the coach, and anything else is "didn't catch that".

import path from 'node:path';
import { expect, test } from '@playwright/test';
import { FULL_MATCH, syntheticMatch } from '@csbot/gsi';
import type { CoachView, HostInfo, LiveSnapshot } from '@csbot/protocol';
import { launchApp, postGsi, screens, shot, waitFor, type LaunchedApp } from './helpers.ts';

test.describe.configure({ mode: 'serial' });
let host: LaunchedApp;

const press = (a: LaunchedApp) => a.app.evaluate(() => { (globalThis as { csbotPressVoice?: () => void }).csbotPressVoice!(); });
const info = (a: LaunchedApp) => a.page.evaluate(() => window.csbot!.getInfo()) as Promise<HostInfo>;

test.beforeAll(async () => {
  host = await launchApp({ CSBOT_FAKE_VOICE: 'three B apps|coach should we save this round|mumble words', CSBOT_COACH: 'on', FAKE_COACH_DELAY: '100' });
  await host.page.evaluate(() => {
    const w = window as unknown as { __snaps: LiveSnapshot[]; __coach?: CoachView };
    w.__snaps = [];
    window.csbot!.onSnapshot(s => { w.__snaps.push(s); if (w.__snaps.length > 30) w.__snaps.shift(); });
    window.csbot!.onCoach!(v => { w.__coach = v; });
  });
});
test.afterAll(async () => { await host?.close(); });

test('push-to-talk is off by default and switches on from Settings', async () => {
  expect((await info(host)).voice).toMatchObject({ enabled: false, key: 'Num0' });
  const p = host.page;
  await p.getByRole('link', { name: 'Settings' }).click().catch(() => p.evaluate(() => { location.hash = '#/settings'; }));
  await p.getByTestId('ptt-toggle').check();
  await expect(p.getByTestId('ptt-toggle')).toBeChecked();
  expect((await info(host)).voice).toMatchObject({ enabled: true, key: 'Num0' });
  await p.getByTestId('ptt-key').selectOption('F9');
  await expect.poll(async () => (await info(host)).voice?.key).toBe('F9');
});

test('heard intel lands in the forecast, a question reaches the coach, anything else is not acted on', async () => {
  test.setTimeout(90_000);
  const rec = syntheticMatch({ rounds: FULL_MATCH, lean: true });
  const live = rec.findIndex(r => r.p.map?.round === 1 && r.p.round?.phase === 'live');
  for (const r of rec.slice(0, live + 1)) expect((await postGsi(host.runtime, r.p)).status).toBe(200);
  await waitFor(async () => host.page.evaluate(() => { const c = (window as unknown as { __snaps: LiveSnapshot[] }).__snaps; const x = c[c.length - 1]; return x?.match?.clock.phase === 'live' ? true : undefined; }));
  // The Mirage zone names are now in the grammar.
  await expect.poll(async () => (await info(host)).voice?.examples[0]).toMatch(/^three /);
  await expect(host.page.getByTestId('ptt-examples')).toContainText('three A ramp', { timeout: 10_000 });

  await press(host);
  const toast = host.page.getByTestId('voice-toast');
  await expect(toast).toHaveAttribute('data-state', 'heard', { timeout: 10_000 });
  await expect(toast).toContainText('3 B Apps');
  const s = await waitFor(async () => host.page.evaluate(() => { const c = (window as unknown as { __snaps: LiveSnapshot[] }).__snaps; const x = c[c.length - 1]; return x?.intel?.length ? x : undefined; }));
  expect(s.intel![0]).toMatchObject({ zone: 'bapps', count: 3 });
  await shot(host, path.join(screens, 'desktop-voice.png'));

  await press(host);
  await expect(toast).toContainText('Asked: Should we save this round?', { timeout: 10_000 });
  const coach = await waitFor(async () => {
    const c = await host.page.evaluate(() => (window as unknown as { __coach?: CoachView }).__coach);
    return c?.messages.some(m => m.kind === 'question' && /save this round/i.test(m.text)) ? c : undefined;
  });
  expect(coach.messages.some(m => /save this round/i.test(m.text))).toBe(true);

  await press(host);
  await expect(toast).toHaveAttribute('data-state', 'none', { timeout: 10_000 });
  await expect(toast).toContainText("Didn't catch that");
});

test('switching it off lets go of the key', async () => {
  await host.page.getByTestId('ptt-toggle').uncheck();
  await expect.poll(async () => (await info(host)).voice?.enabled).toBe(false);
  // A press now does nothing (the stand-in key is unregistered).
  await press(host);
  await expect(host.page.getByTestId('voice-toast')).toHaveAttribute('data-state', 'none');
});
