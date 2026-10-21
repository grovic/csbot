// Rooms end to end: the desktop app hosts, a browser and a second desktop app join through an invite
// link, the admin approves them, and everyone sees the host's call with their own YOU line. A desktop
// member's own GSI reaches the host through the room. Signaling uses a local relay (tools/room-relay)
// via CSBOT_SIGNAL, so no public network is needed. Every Electron window stays hidden.
//
// CSBOT_MEASURE=1 adds a footprint measurement of the host with a room open and one member connected.

import fs from 'node:fs';
import path from 'node:path';
import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { FIRST_HALF, syntheticMatch, type RecordedPayload } from '@csbot/gsi';
import { startRoomRelay, type RoomRelay } from '@csbot/room-relay';
import { appDir, launchApp, postGsi, screens, serveDir, shot, waitFor, webDist, type LaunchedApp } from './helpers.ts';

test.describe.configure({ mode: 'serial' });

let relay: RoomRelay, site: { url: string; close: () => Promise<void> }, browser: Browser;
let host: LaunchedApp, deskMember: LaunchedApp | undefined, web: Page, invite: string;

/** A member's row on the Room page, matched on the name cell (other cells can mention names too). */
const memberRow = (p: Page, name: string) => p.getByTestId('member-row').filter({ has: p.locator('td:first-child b', { hasText: new RegExp(`^${name}$`) }) });

/** Payloads up to (and two into) a given round's freeze time. */
function upToFreeze(rec: RecordedPayload[], round: number): RecordedPayload[] {
  const i = rec.findIndex(r => r.p.map?.round === round - 1 && r.p.round?.phase === 'freezetime');
  return rec.slice(0, i + 2);
}

test.beforeAll(async () => {
  if (!fs.existsSync(path.join(webDist, 'index.html'))) throw new Error('build apps/web first');
  relay = await startRoomRelay();
  site = await serveDir(webDist);
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  host = await launchApp({ CSBOT_SIGNAL: relay.url });
});

test.afterAll(async () => {
  await browser?.close();
  await deskMember?.close();
  await host?.close().catch(() => {});
  await site?.close();
  await relay?.close();
});

test('the admin creates a room and gets an invite link', async () => {
  const p = host.page;
  await p.getByTestId('room-chip').click();
  await p.getByTestId('create-room').click();
  invite = await waitFor(async () => {
    const v = await p.getByTestId('invite-link').inputValue().catch(() => '');
    return v.includes('#/r/') ? v : undefined;
  });
  expect(invite).toMatch(/#\/r\/[A-Z2-9]{6}\?k=[A-Za-z0-9_-]{22,}/);
  expect(invite).toContain('signal=');
  await expect(p.getByTestId('room-code')).toHaveText(/^[A-Z2-9]{3}-[A-Z2-9]{3}$/);
});

test('a browser member joins with the link, waits, and is let in', async () => {
  web = await (await browser.newContext()).newPage();
  const errors: string[] = [];
  web.on('pageerror', e => errors.push(e.message));
  await web.goto(site.url + invite.slice(invite.indexOf('#')));
  await web.getByTestId('join-name').fill('kairo');
  await web.getByTestId('join-submit').click();
  await expect(web.getByTestId('link-status')).toHaveAttribute('data-status', 'pending', { timeout: 30_000 });

  const row = host.page.getByTestId('pending-row').filter({ hasText: 'kairo' });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.getByTestId('approve').click();
  await expect(web.getByTestId('link-status')).toHaveAttribute('data-status', 'approved', { timeout: 15_000 });
  await expect(memberRow(host.page, 'kairo')).toContainText('online');
  expect(errors).toEqual([]);
});

test("the member sees the host's call with their own job", async () => {
  // The host plays round 1 and reaches round 2's freeze time: anti-eco call.
  for (const r of upToFreeze(syntheticMatch({ rounds: FIRST_HALF.slice(0, 3), lean: true }), 2)) expect((await postGsi(host.runtime, r.p)).status).toBe(200);
  await web.goto(web.url().replace(/#.*$/, '#/live'));
  await expect(web.getByTestId('call-head')).toHaveText('Anti-eco · stack B', { timeout: 15_000 });
  await expect(web.getByTestId('score-us')).toHaveText('1');
  // First free slot goes to the first member: A anchor.
  await expect(web.getByTestId('call-you')).toHaveText('A site alone. Play deep and fall back to CT on contact.');

  // The admin moves kairo to B anchor: the member's YOU line follows.
  await memberRow(host.page, 'kairo').getByTestId('slot-select').selectOption('b');
  await expect(web.getByTestId('call-you')).toHaveText('B van. Anchor, never peek apps.', { timeout: 10_000 });

  // Tournament mode turns live coaching off on every screen, then back on.
  // (Controlled checkbox: it flips once the room state comes back, so click and wait for it.)
  const toggle = host.page.getByTestId('tournament-toggle');
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(web.getByTestId('call-head')).toHaveText('Live coaching is off for the whole room', { timeout: 10_000 });
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(web.getByTestId('call-head')).toHaveText('Anti-eco · stack B', { timeout: 10_000 });

  await host.page.evaluate(() => window.scrollTo(0, 0));
  await host.page.waitForTimeout(300);
  await shot(host, path.join(screens, 'desktop-room.png'));
  await web.screenshot({ path: path.join(screens, 'browser-member-live.png') });
});

test('a member can leave, and shows as offline', async () => {
  await web.goto(web.url().replace(/#.*$/, '#/room'));
  await web.getByTestId('leave-room').click();
  await expect(memberRow(host.page, 'kairo')).toContainText('offline', { timeout: 15_000 });
});

test('a desktop member shares their own GSI through the room', async () => {
  deskMember = await launchApp({ CSBOT_SIGNAL: relay.url });
  const m = deskMember.page;
  await m.getByTestId('room-chip').click();
  await m.getByTestId('join-link-input').fill(invite);
  await m.getByTestId('join-link-name').fill('vex');
  await m.getByTestId('join-link-submit').click();
  const row = host.page.getByTestId('pending-row').filter({ hasText: 'vex' });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.getByTestId('approve').click();
  await expect(m.getByTestId('link-status')).toHaveAttribute('data-status', 'approved', { timeout: 15_000 });

  // vex's own CS2 (a different Steam ID) posts to vex's own desktop app.
  const own = syntheticMatch({ rounds: FIRST_HALF.slice(0, 3), lean: true, me: '76561198000000007', name: 'vex' });
  for (const r of upToFreeze(own, 2)) expect((await postGsi(deskMember.runtime, r.p)).status).toBe(200);

  const vexRow = memberRow(host.page, 'vex');
  await expect(vexRow).toContainText('✓ yes', { timeout: 15_000 });
  await expect(vexRow).toContainText('desktop', { ignoreCase: true });

  // The host's scoreboard now has vex's live row, sourced through the room.
  await host.page.goto(host.page.url().replace(/#.*$/, '#/live'));
  const hostRow = host.page.getByTestId('our-team').locator('tr').filter({ hasText: 'vex' });
  await expect(hostRow).toContainText('room', { timeout: 15_000 });
  await expect(host.page.getByTestId('our-team').locator('tr').filter({ hasText: 'rdx' })).toContainText('host GSI');

  // vex's own screen: the host's match, vex highlighted as "you", vex's own buy tile.
  await m.goto(m.url().replace(/#.*$/, '#/live'));
  await expect(m.getByTestId('score-us')).toHaveText('1', { timeout: 15_000 });
  await expect(m.getByTestId('our-team').locator('tr.me-row')).toContainText('vex');
  await shot(deskMember, path.join(screens, 'desktop-member-live.png'));
});

// Refusing member⇄member handshakes (the star) makes Trystero retry in a tight loop: tens of thousands
// of "incorrect password for overlapping room" errors per member, which RoomClient reads as a wrong
// key, so the second member gets "denied". The fix in packages/room/src/trystero.ts accepts every csbot
// peer and keeps the star in the transport (only the host is surfaced to members). Enabled once the
// refusal is gone.
const trysteroSrc = fs.readFileSync(path.resolve(appDir, '..', '..', 'packages', 'room', 'src', 'trystero.ts'), 'utf8');
const membersCoexist = !trysteroSrc.includes('not a host/member pair');
let bothIn = false;

test('two members at once: each keeps their own screen', async () => {
  test.fixme(!membersCoexist, 'needs packages/room/src/trystero.ts to stop refusing member⇄member handshakes');
  // kairo comes back with the same link (same device id): let straight back in, no approval needed.
  // (Opened fresh: after "you left", a same-tab hash change alone doesn't bring the join form back.)
  await web.goto(site.url + invite.slice(invite.indexOf('#')));
  await web.reload();
  await web.getByTestId('join-name').fill('kairo');
  await web.getByTestId('join-submit').click();
  await expect(web.getByTestId('link-status')).toHaveAttribute('data-status', 'approved', { timeout: 30_000 });
  await expect(deskMember!.page.getByTestId('link-status')).toHaveAttribute('data-status', 'approved');
  await host.page.getByTestId('room-chip').click();
  await expect(memberRow(host.page, 'kairo')).toContainText('online', { timeout: 15_000 });
  await expect(memberRow(host.page, 'vex')).toContainText('online');
  // Different slots, different YOU lines, same call.
  await web.goto(web.url().replace(/#.*$/, '#/live'));
  await expect(web.getByTestId('call-head')).toHaveText('Anti-eco · stack B', { timeout: 15_000 });
  const vexYou = await deskMember!.page.getByTestId('call-you').textContent({ timeout: 15_000 });
  const kairoYou = await web.getByTestId('call-you').textContent();
  expect(kairoYou).toBe('B van. Anchor, never peek apps.');
  expect(vexYou).toBeTruthy();
  expect(vexYou).not.toBe(kairoYou);
  bothIn = true;
});

let handedOver = false;

test("the host's PC drops: the desktop member takes over and the browser member follows", async () => {
  test.skip(!bothIn, 'needs both members in the room');
  test.setTimeout(120_000);
  await host.close();
  const m = deskMember!.page;
  await expect(m.getByTestId('link-status')).toHaveAttribute('data-status', 'host-offline', { timeout: 30_000 });
  // After 10 s offline, a desktop member may take over (the admin allowed handover by default).
  await m.getByTestId('take-over').click({ timeout: 30_000 });
  await expect(m.getByTestId('notice')).toContainText("You're hosting room");
  // The browser member follows the new host by itself: same link, no approval.
  await expect(web.getByTestId('link-status')).toHaveAttribute('data-status', 'approved', { timeout: 45_000 });
  await m.getByTestId('room-chip').click();
  await expect(memberRow(m, 'kairo')).toContainText('online', { timeout: 15_000 });
  await shot(deskMember!, path.join(screens, 'desktop-took-over.png'));
  handedOver = true;
});

test('ending the room tells everyone', async () => {
  const admin = handedOver ? deskMember! : host;
  await admin.page.getByTestId('room-chip').click();
  await admin.page.getByTestId('end-room').click();
  if (!handedOver) await expect(deskMember!.page.getByTestId('link-status')).toHaveAttribute('data-status', 'ended', { timeout: 15_000 });
  if (bothIn) await expect(web.getByTestId('link-status')).toHaveAttribute('data-status', 'ended', { timeout: 15_000 });
});

test('footprint with a room open and a member connected', async () => {
  test.skip(process.env.CSBOT_MEASURE !== '1' || handedOver, 'set CSBOT_MEASURE=1 to measure (and skip the handover test)');
  test.setTimeout(300_000);
  // Fresh room with one browser member, then a real-time replay while sampling the host's processes.
  await host.page.getByTestId('room-chip').click();
  await host.page.getByTestId('create-room').click();
  const link = await waitFor(async () => { const v = await host.page.getByTestId('invite-link').inputValue().catch(() => ''); return v.includes('#/r/') ? v : undefined; });
  const member = await (await browser.newContext()).newPage();
  await member.goto(site.url + link.slice(link.indexOf('#')));
  await member.getByTestId('join-name').fill('kairo');
  await member.getByTestId('join-submit').click();
  await host.page.getByTestId('pending-row').filter({ hasText: 'kairo' }).getByTestId('approve').click({ timeout: 30_000 });
  await expect(member.getByTestId('link-status')).toHaveAttribute('data-status', 'approved', { timeout: 15_000 });
  await host.page.goto(host.page.url().replace(/#.*$/, '#/live'));

  const sample = () => host.app.evaluate(({ app }) => app.getAppMetrics().map(p => ({
    type: p.type, priv: p.memory.privateBytes ?? 0, ws: p.memory.workingSetSize, cpuS: (p.cpu as { cumulativeCPUUsage?: number }).cumulativeCPUUsage ?? 0,
  })));
  const rec = syntheticMatch({ rounds: FIRST_HALF, lean: true, tick: 0.5 });
  const dur = 90_000, t0 = Date.now(), samples: Awaited<ReturnType<typeof sample>>[] = [];
  const replay = (async () => {
    let i = 0;
    while (Date.now() - t0 < dur) {
      const r = rec[i % rec.length]!, next = rec[(i + 1) % rec.length]!;
      await postGsi(host.runtime, r.p);
      i++;
      await new Promise(res => setTimeout(res, Math.max(50, Math.min(2000, next.t - r.t))));
    }
    return i;
  })();
  while (Date.now() - t0 < dur) { samples.push(await sample()); await new Promise(r => setTimeout(r, 1000)); }
  const posted = await replay;
  const sum = (s: typeof samples[number], k: 'priv' | 'ws') => s.reduce((a, p) => a + p[k], 0) / 1024;
  const priv = samples.map(s => sum(s, 'priv')), ws = samples.map(s => sum(s, 'ws'));
  const cpuS = (s: typeof samples[number]) => s.reduce((a, p) => a + p.cpuS, 0);
  const cores = (await import('node:os')).cpus().length;
  const cpuMachinePct = ((cpuS(samples[samples.length - 1]!) - cpuS(samples[0]!)) / ((samples.length - 1) || 1)) * 100 / cores;
  const avg = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
  const out = {
    at: new Date().toISOString(), scenario: 'host with a room open, 1 browser member, real-time synthetic replay', durationS: dur / 1000, payloadsPosted: posted, cores,
    privAvgMB: Math.round(avg(priv)), privPeakMB: Math.round(Math.max(...priv)), wsAvgMB: Math.round(avg(ws)), cpuMachinePctAvg: Number(cpuMachinePct.toFixed(2)),
    byType: Object.fromEntries([...new Set(samples[samples.length - 1]!.map(p => p.type))].map(t => [t, Math.round(samples[samples.length - 1]!.filter(p => p.type === t).reduce((a, p) => a + p.priv, 0) / 1024)])),
  };
  fs.writeFileSync(path.join(appDir, '..', '..', 'tools', 'spikes', 'electron-footprint', 'results-room.json'), JSON.stringify(out, null, 2) + '\n');
  console.log('FOOTPRINT', JSON.stringify(out));
  await member.context().close();
});
