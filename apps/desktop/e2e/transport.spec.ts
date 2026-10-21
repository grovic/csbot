// The Electron renderer can carry a peer-to-peer room: secure context, WebCrypto and WebRTC are
// there, and a room host inside the (hidden, sandboxed) desktop window talks to a member in a
// browser through @csbot/room's Trystero transport. Signaling goes through a local relay
// (tools/room-relay), so the test needs no network.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, expect, test, type Browser } from '@playwright/test';
import { startRoomRelay, type RoomRelay } from '@csbot/room-relay';
import { build } from 'esbuild';
import { launchApp, serveDir, waitFor, type LaunchedApp } from './helpers.ts';

type Probe = {
  caps(): { secure: boolean; subtle: boolean; rtc: boolean; origin: string };
  start(role: 'host' | 'member', code: string, key: string, url: string): void;
  state: { peers: string[]; got: unknown[]; errors: string[] };
};
declare global { interface Window { __probe: Probe; __send: (m: unknown) => void } }

let probeDir: string, relay: RoomRelay, desk: LaunchedApp, browser: Browser, site: { url: string; close: () => Promise<void> };

const CODE = 'K7P2QX', KEY = 'transport_test_key_0123456789';

test.beforeAll(async () => {
  probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csbot-probe-'));
  await build({
    entryPoints: [path.join(import.meta.dirname, 'fixtures', 'transport-probe.ts')],
    bundle: true, format: 'iife', platform: 'browser', target: 'es2022', outfile: path.join(probeDir, 'probe.js'), logLevel: 'warning',
  });
  fs.writeFileSync(path.join(probeDir, 'index.html'), '<!doctype html><meta charset="utf-8"><title>probe</title><script src="probe.js"></script>');
  relay = await startRoomRelay();
  site = await serveDir(probeDir);
  desk = await launchApp({ CSBOT_WEB_URL: pathToFileURL(path.join(probeDir, 'index.html')).href });
  browser = await chromium.launch({ channel: 'msedge', headless: true });
});

test.afterAll(async () => {
  await browser?.close();
  await desk?.close();
  await site?.close();
  await relay?.close();
  fs.rmSync(probeDir, { recursive: true, force: true });
});

test('the desktop renderer is a secure context with WebCrypto and WebRTC', async () => {
  const caps = await desk.page.evaluate(() => window.__probe.caps());
  expect(caps).toMatchObject({ secure: true, subtle: true, rtc: true });
  // localStorage survives a reload (the host keeps its room there).
  await desk.page.evaluate(() => localStorage.setItem('csbot.test', '1'));
  await desk.page.reload();
  expect(await desk.page.evaluate(() => localStorage.getItem('csbot.test'))).toBe('1');
});

test('a room host in the desktop window talks to a member in a browser', async () => {
  await desk.page.evaluate(([c, k, u]) => window.__probe.start('host', c, k, u), [CODE, KEY, relay.url] as const);
  const member = await (await browser.newContext()).newPage();
  await member.goto(site.url);
  await member.evaluate(([c, k, u]) => window.__probe.start('member', c, k, u), [CODE, KEY, relay.url] as const);

  await waitFor(() => desk.page.evaluate(() => window.__probe.state.peers.length === 1), 30_000);
  await waitFor(() => member.evaluate(() => window.__probe.state.peers.length === 1), 30_000);
  // Each side greets on join; then both directions carry room-sized messages.
  await member.evaluate(() => window.__send({ t: 'gsi', payload: { pad: 'x'.repeat(8000) } }));
  await desk.page.evaluate(() => window.__send({ t: 'state', pad: 'y'.repeat(8000) }));
  const hostGot = await waitFor(() => desk.page.evaluate(() => window.__probe.state.got.length >= 2 && window.__probe.state.got), 15_000);
  const memberGot = await waitFor(() => member.evaluate(() => window.__probe.state.got.length >= 2 && window.__probe.state.got), 15_000);
  expect(hostGot).toContainEqual({ hello: 'member' });
  expect(JSON.stringify(hostGot)).toContain('x'.repeat(8000));
  expect(memberGot).toContainEqual({ hello: 'host' });
  expect(JSON.stringify(memberGot)).toContain('y'.repeat(8000));

  // A second "member" with the wrong key never reaches the host.
  const intruder = await (await browser.newContext()).newPage();
  await intruder.goto(site.url);
  await intruder.evaluate(([c, u]) => window.__probe.start('member', c, 'wrong_key_wrong_key_wrong_key', u), [CODE, relay.url] as const);
  // Whichever side receives the other's encrypted offer reports the wrong password (Trystero picks
  // the offering side by peer ID), so it shows up on the host or on the intruder; nobody connects.
  const wrongKey = (errors: string[]) => errors.some(e => /password/.test(e));
  await waitFor(async () => wrongKey(await desk.page.evaluate(() => window.__probe.state.errors)) || wrongKey(await intruder.evaluate(() => window.__probe.state.errors)), 20_000);
  expect(await intruder.evaluate(() => window.__probe.state.peers.length)).toBe(0);
  expect(await desk.page.evaluate(() => window.__probe.state.peers.length)).toBe(1);
});
