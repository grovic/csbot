// The debrief end to end in the hidden desktop app: a match played through GSI is recorded and kept,
// the Debrief page shows it, the (fake) Claude writes the notes, and a real demo is read by the
// native parser in a worker thread inside Electron.

import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { FIRST_HALF, syntheticMatch } from '@csbot/gsi';
import { parseDemo } from '@csbot/demo';
import { appDir, launchApp, postGsi, screens, shot, waitFor, type LaunchedApp } from './helpers.ts';

test.describe.configure({ mode: 'serial' });
let host: LaunchedApp;

test.beforeAll(async () => { host = await launchApp(); });
test.afterAll(async () => { await host?.close(); });

test('a match played through GSI is recorded, kept on disk and shown on the Debrief page', async () => {
  test.setTimeout(90_000);
  const rec = syntheticMatch({ rounds: FIRST_HALF.slice(0, 6), lean: true });
  for (const r of rec) expect((await postGsi(host.runtime, r.p)).status).toBe(200);
  const p = host.page;
  await p.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: 'Debrief' }).click();
  await expect(p.getByTestId('debrief-result')).toContainText(/Mirage/, { timeout: 15_000 });
  await expect(p.getByTestId('debrief-rounds').locator('tbody tr')).toHaveCount(6, { timeout: 15_000 });
  const files = await waitFor(async () => {
    const dir = path.join(host.dir, 'userData', 'matches');
    const f = fs.existsSync(dir) ? fs.readdirSync(dir).filter(x => x.endsWith('.json')) : [];
    return f.length ? f : undefined;
  });
  expect(files).toHaveLength(1);
});

test("Claude's work-on-next notes, written on demand", async () => {
  const p = host.page;
  await p.getByTestId('workon-write').click();
  await expect(p.getByTestId('workon').locator('li').first()).toContainText('Save on T', { timeout: 15_000 });
  await shot(host, path.join(screens, 'desktop-debrief.png'));
});

test('a real demo is read by the native parser inside Electron', async () => {
  const demo = path.resolve(appDir, '..', '..', 'packages', 'demo', 'testdata', 'test_demo.dem');
  test.skip(!fs.existsSync(demo), 'packages/demo/testdata/test_demo.dem not downloaded');
  // The test demo is a real match this app never saw and its player isn't in: csbot reads it, then
  // says it fits no record (proof the parser ran: the error names the demo's map).
  const r = await host.page.evaluate(f => window.csbot!.ingestDemo!(f), demo);
  expect(r.ok).toBe(false);
  expect(r.error).toMatch(/^No mirage match in csbot's records fits this demo/);
  await expect(host.page.getByTestId('demo-error')).toContainText('No mirage match');
});

test("your own demo: a match csbot never saw is rebuilt, with its 2D replay", async () => {
  test.setTimeout(90_000);
  const demo = path.resolve(appDir, '..', '..', 'packages', 'demo', 'testdata', 'test_demo.dem');
  test.skip(!fs.existsSync(demo), 'packages/demo/testdata/test_demo.dem not downloaded');
  // Play as one of the demo's players (the Steam ID csbot remembers from your GSI).
  const steamId = parseDemo(demo).players.find(p => /^7656\d{13}$/.test(p.steamid))!.steamid;
  const app = await launchApp({}, { settings: { steamId } });
  try {
    const p = app.page;
    expect(await p.evaluate(f => window.csbot!.ingestDemo!(f), demo)).toEqual({ ok: true });
    const kept = fs.readdirSync(path.join(app.dir, 'userData', 'matches'));
    expect(kept.some(f => f.endsWith('.replay.json.gz'))).toBe(true);
    await p.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: 'Debrief' }).click();
    await p.getByTestId('replay-open').click();
    const replay = p.getByTestId('replay');
    await expect(replay.locator('.pl circle')).toHaveCount(10, { timeout: 15_000 });
    expect(await p.getByTestId('replay-round').count()).toBeGreaterThan(5);
    await p.getByTestId('replay-round').nth(1).click();
    await p.getByTestId('replay-time').fill('38');
    await expect(replay.locator('.nade.smoke').first()).toBeVisible();
    await expect(p.getByTestId('replay-feed').locator('li').first()).toBeVisible();
    // Hidden windows can't take element screenshots: capture the window, cropped to the card.
    const box = await p.getByTestId('replay-card').evaluate(el => {
      document.querySelector<HTMLElement>('.hdr')!.style.position = 'static';
      el.scrollIntoView({ block: 'start' });
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(Math.min(r.height, window.innerHeight - r.y)) };
    });
    // A hidden window paints lazily: the first capture wakes it, the second is current.
    const png = await app.app.evaluate(async ({ BrowserWindow }, rect) => {
      const wc = BrowserWindow.getAllWindows()[0]!.webContents;
      await wc.capturePage(rect);
      wc.invalidate();
      await new Promise(r => setTimeout(r, 600));
      return (await wc.capturePage(rect)).toPNG().toString('base64');
    }, box);
    fs.writeFileSync(path.join(screens, 'desktop-replay.png'), Buffer.from(png, 'base64'));
  } finally { await app.close(); }
});
