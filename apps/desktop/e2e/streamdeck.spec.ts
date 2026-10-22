// The Stream Deck control API end to end in the hidden desktop app: off by default; on from Settings it
// writes control.json, and the plugin's calls (made here directly) show the call and log intel the
// same way a click does.

import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { FULL_MATCH, syntheticMatch } from '@csbot/gsi';
import type { HostInfo, LiveSnapshot } from '@csbot/protocol';
import { launchApp, postGsi, screens, shot, waitFor, type LaunchedApp } from './helpers.ts';

test.describe.configure({ mode: 'serial' });
let host: LaunchedApp;

const info = (a: LaunchedApp) => a.page.evaluate(() => window.csbot!.getInfo()) as Promise<HostInfo>;
const controlFile = () => path.join(host.dir, 'userData', 'control.json');
async function api(method: 'GET' | 'POST', p: string, body?: unknown, token?: string) {
  const c = JSON.parse(fs.readFileSync(controlFile(), 'utf8')) as { url: string; token: string };
  const r = await fetch(c.url + p, { method, headers: { authorization: `Bearer ${token ?? c.token}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, body: await r.json() };
}

test.beforeAll(async () => {
  host = await launchApp();
  await host.page.evaluate(() => {
    const w = window as unknown as { __snaps: LiveSnapshot[] };
    w.__snaps = [];
    window.csbot!.onSnapshot(s => { w.__snaps.push(s); if (w.__snaps.length > 30) w.__snaps.shift(); });
  });
});
test.afterAll(async () => { await host?.close(); });

test('off by default; on from Settings, it writes control.json for the plugin', async () => {
  expect((await info(host)).streamDeck).toEqual({ enabled: false });
  expect(fs.existsSync(controlFile())).toBe(false);
  await host.page.getByRole('link', { name: 'Settings', exact: true }).click();
  await host.page.getByTestId('sd-toggle').check();
  await expect.poll(async () => (await info(host)).streamDeck?.enabled).toBe(true);
  expect(fs.existsSync(controlFile())).toBe(true);
  expect((await api('GET', '/v1/state', undefined, 'wrong')).status).toBe(401);
});

test("the plugin's keys: the call on a key, intel like a click, push-to-talk refused when off", async () => {
  test.setTimeout(60_000);
  const rec = syntheticMatch({ rounds: FULL_MATCH, lean: true });
  const live = rec.findIndex(r => r.p.map?.round === 0 && r.p.round?.phase === 'live');
  for (const r of rec.slice(0, live + 1)) expect((await postGsi(host.runtime, r.p)).status).toBe(200);
  await waitFor(async () => host.page.evaluate(() => { const c = (window as unknown as { __snaps: LiveSnapshot[] }).__snaps; return c[c.length - 1]?.match?.clock.phase === 'live' ? true : undefined; }));

  const s = await api('GET', '/v1/state');
  expect(s.status).toBe(200);
  expect(s.body).toMatchObject({ map: 'de_mirage', mapName: 'Mirage', phase: 'live', lanes: { a: 'A Ramp', mid: 'Top Mid', b: 'B Apps' } });
  expect(typeof s.body.call.head).toBe('string');

  expect(await api('POST', '/v1/command', { kind: 'intel', lane: 'b', count: 3 })).toEqual({ status: 200, body: { ok: true } });
  const toast = host.page.getByTestId('voice-toast');
  await expect(toast).toHaveAttribute('data-state', 'heard');
  await expect(toast).toContainText('3 B Apps');
  const snap = await waitFor(async () => host.page.evaluate(() => { const c = (window as unknown as { __snaps: LiveSnapshot[] }).__snaps; const x = c[c.length - 1]; return x?.intel?.length ? x : undefined; }));
  expect(snap.intel![0]).toMatchObject({ zone: 'bapps', count: 3 });
  await shot(host, path.join(screens, 'desktop-streamdeck.png'));

  // Push-to-talk is off in this app: the key says so.
  expect(await api('POST', '/v1/command', { kind: 'talk' })).toEqual({ status: 409, body: { ok: false, error: 'Push-to-talk is off in csbot Settings.' } });
  expect((await api('POST', '/v1/command', { kind: 'nope' })).status).toBe(400);
});

test('off again: the API and control.json are gone', async () => {
  const c = JSON.parse(fs.readFileSync(controlFile(), 'utf8')) as { url: string };
  await host.page.getByTestId('sd-toggle').uncheck();
  await expect.poll(async () => (await info(host)).streamDeck?.enabled).toBe(false);
  expect(fs.existsSync(controlFile())).toBe(false);
  await expect(fetch(c.url + '/v1/state')).rejects.toThrow();
});
