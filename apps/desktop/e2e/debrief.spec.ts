// The debrief end to end in the hidden desktop app: a match played through GSI is recorded and kept,
// the Debrief page shows it, the (fake) Claude writes the notes, and a real demo is read by the
// native parser in a worker thread inside Electron.

import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { FIRST_HALF, syntheticMatch } from '@csbot/gsi';
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
