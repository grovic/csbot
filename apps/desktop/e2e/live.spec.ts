// Production path, opt-in (CSBOT_LIVE=1): the desktop host signals over the default public Nostr
// relays, and a browser member opens the invite link on the live GitHub Pages site. Nothing local
// stands in for the network here, so this is the check that "open the link and join" really works.
// It talks to public infrastructure, so it never runs in CI by default. Fictional names and data.

import path from 'node:path';
import { chromium, expect, test, type Browser } from '@playwright/test';
import { FIRST_HALF, syntheticMatch } from '@csbot/gsi';
import { launchApp, postGsi, screens, waitFor, type LaunchedApp } from './helpers.ts';

test.skip(process.env.CSBOT_LIVE !== '1', 'set CSBOT_LIVE=1 to run against public Nostr relays and GitHub Pages');
test.describe.configure({ mode: 'serial' });

let host: LaunchedApp, browser: Browser;

test.beforeAll(async () => {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  host = await launchApp(); // no CSBOT_SIGNAL: default public Nostr signaling
});
test.afterAll(async () => {
  await browser?.close();
  await host?.close();
});

test('a browser member joins from the GitHub Pages link over public signaling', async () => {
  test.setTimeout(120_000);
  const p = host.page;
  await p.getByTestId('room-chip').click();
  await p.getByTestId('create-room').click();
  const invite = await waitFor(async () => {
    const v = await p.getByTestId('invite-link').inputValue().catch(() => '');
    return v.includes('#/r/') ? v : undefined;
  });
  expect(invite.startsWith('https://grovic.github.io/csbot/#/r/')).toBe(true);
  expect(invite).not.toContain('signal=');

  const rec = syntheticMatch({ rounds: FIRST_HALF.slice(0, 3), lean: true });
  const i = rec.findIndex(r => r.p.map?.round === 1 && r.p.round?.phase === 'freezetime');
  for (const r of rec.slice(0, i + 2)) await postGsi(host.runtime, r.p);

  const web = await (await browser.newContext()).newPage();
  const errors: string[] = [];
  web.on('pageerror', e => errors.push(e.message));
  const t0 = Date.now();
  await web.goto(invite);
  await web.getByTestId('join-name').fill('kairo');
  await web.getByTestId('join-submit').click();
  await expect(web.getByTestId('link-status')).toHaveAttribute('data-status', 'pending', { timeout: 60_000 });
  const pendingMs = Date.now() - t0;

  const row = p.getByTestId('pending-row').filter({ hasText: 'kairo' });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.getByTestId('approve').click();
  await web.goto(invite.replace(/#.*$/, '#/live'));
  await expect(web.getByTestId('call-head')).toHaveText('Anti-eco · stack B', { timeout: 30_000 });
  await expect(web.getByTestId('call-you')).not.toBeEmpty();
  console.log(`[live] link opened → waiting for approval in ${pendingMs} ms; member sees the host's call`);
  await web.screenshot({ path: path.join(screens, 'live-pages-member.png') });
  expect(errors).toEqual([]);
});
