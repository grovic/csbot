// Rooms end to end over real WebRTC between headless Edge contexts, with signaling through a local
// relay (global-setup.ts). The host is the web app with a mocked desktop bridge (window.csbot) that the
// test drives with snapshots computed here by the real engine.

import { MatchTracker } from '@csbot/engine';
import { FIRST_HALF, syntheticMatch, toGameState, type GsiPayload } from '@csbot/gsi';
import type { LiveSnapshot } from '@csbot/protocol';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCREENS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'screens');
fs.mkdirSync(SCREENS, { recursive: true });
const shot = (page: Page, name: string, fullPage = true) => page.screenshot({ path: path.join(SCREENS, `${name}.png`), fullPage });

test.describe.configure({ timeout: 120_000 });

const relay = () => process.env.CSBOT_RELAY!;

/** Host snapshot at round 2 freeze time on Mirage CT: the anti-eco call. */
function hostSnapshot(): LiveSnapshot {
  const t = new MatchTracker();
  for (const { t: at, p } of syntheticMatch({ rounds: FIRST_HALF })) {
    t.ingest(toGameState(p, at));
    const s = t.snapshot(at);
    if (s.match?.round === 2 && s.match.clock.phase === 'freezetime') return s;
  }
  throw new Error('no round 2 freeze');
}

/** A member's own GSI (same match, their Steam ID and name) up to round 2 freeze time. */
function memberPayloads(steamid: string, name: string): GsiPayload[] {
  const rec = syntheticMatch({ rounds: FIRST_HALF.slice(0, 3), me: steamid, name });
  const i = rec.findIndex(r => (r.p.map?.round ?? 0) === 1 && r.p.round?.phase === 'freezetime');
  return rec.slice(0, i + 3).map(r => r.p);
}

/** A fake desktop bridge the test drives: __pushSnap(snapshot), __pushGsi(payload). */
async function mockBridge(ctx: BrowserContext) {
  await ctx.addInitScript(() => {
    type Cb = (x: unknown) => void;
    const snapCbs = new Set<Cb>(), gsiCbs = new Set<Cb>();
    let last: unknown;
    const w = window as unknown as Record<string, unknown>;
    w.__pushSnap = (s: unknown) => { last = s; for (const cb of snapCbs) cb(s); };
    w.__pushGsi = (p: unknown) => { for (const cb of gsiCbs) cb(p); };
    w.csbot = {
      onSnapshot: (cb: Cb) => { snapCbs.add(cb); if (last) cb(last); return () => snapCbs.delete(cb); },
      onGsi: (cb: Cb) => { gsiCbs.add(cb); return () => gsiCbs.delete(cb); },
      getInfo: async () => ({ version: '0.1.0', gsiUrl: 'http://127.0.0.1:47400', cfgStatus: 'current', recordingsDir: 'C:\\csbot\\recordings' }),
      installCfg: async () => ({ ok: true }),
      openRecordings: async () => {},
    };
  });
}

const pushSnap = (page: Page, s: LiveSnapshot) => page.evaluate(x => (window as unknown as { __pushSnap: (s: unknown) => void }).__pushSnap(x), s);

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  return errors;
}

/** A desktop host page that creates a room; returns the invite link. */
async function openHost(ctx: BrowserContext, create = true) {
  const page = await ctx.newPage();
  const errors = watchErrors(page);
  await page.goto(`./?signal=${encodeURIComponent(relay())}#/room`);
  await pushSnap(page, hostSnapshot());
  if (create) await page.getByTestId('create-room').click();
  const invite = await page.getByTestId('invite-link').inputValue();
  return { page, errors, invite };
}

async function joinFromBrowser(page: Page, invite: string, name: string) {
  await page.goto(invite);
  await page.getByTestId('join-name').fill(name);
  await page.getByTestId('join-submit').click();
}

const status = (page: Page) => page.getByTestId('link-status');
/** A member's row on the Room page (not the host's own row). */
const memberRow = (page: Page, name: string) => page.locator('[data-testid="member-row"]:not([data-member-id="host"])').filter({ hasText: name });

test('room: join, approve, personal YOU, slots, tournament, host offline and back, end', async ({ browser }) => {
  const hostCtx = await browser.newContext();
  await mockBridge(hostCtx);
  const host = await openHost(hostCtx);
  expect(host.invite).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/#\/r\/[A-Z0-9]{6}\?k=[\w-]+&signal=/);
  await expect(host.page.getByTestId('room-code')).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/);
  await expect(host.page.getByTestId('room-chip')).toContainText('ADMIN');

  // A teammate opens the link in a browser: a name, then waiting for the admin.
  const memCtx = await browser.newContext();
  const mem = await memCtx.newPage();
  const memErrors = watchErrors(mem);
  await mem.goto(host.invite);
  await expect(mem.getByTestId('join')).toBeVisible();
  await mem.getByTestId('join-name').fill('kairo');
  await shot(mem, 'join', false);
  await mem.getByTestId('join-submit').click();
  await expect(status(mem)).toHaveAttribute('data-status', 'pending', { timeout: 30_000 });
  await shot(mem, 'pending', false);

  // The admin lets them in.
  const pending = host.page.getByTestId('pending-row');
  await expect(pending).toContainText('kairo');
  await pending.getByTestId('approve').click();
  await expect(status(mem)).toHaveAttribute('data-status', 'approved', { timeout: 15_000 });

  // Same call as the host, with the member's own job (first free slot: A anchor).
  await expect(mem.getByTestId('call-head')).toHaveText('Anti-eco · stack B');
  await expect(mem.getByTestId('call-you')).toContainText('A site alone');
  await expect(mem.getByTestId('marker-you')).toBeVisible();
  await expect(mem.getByTestId('tile-you')).toContainText('desktop app'); // a web member has no money tile
  await expect(mem.getByTestId('room-chip')).toContainText('MEMBER');
  await shot(mem, 'member-live');

  // The admin moves them to the AWP slot: their YOU line follows.
  const row = memberRow(host.page, 'kairo');
  await row.getByTestId('slot-select').selectOption('awp');
  await expect(mem.getByTestId('call-you')).toContainText('Window AWP', { timeout: 10_000 });
  // The host gets the A slot and the map shows the member's name on the AWP spot.
  await host.page.getByTestId('member-row').filter({ hasText: '(you)' }).getByTestId('slot-select').selectOption('a');
  await expect(mem.locator('[data-slot="a"]')).toContainText('rdx');
  await shot(host.page, 'room-host');

  // Room page from the member's side: read-only slots for others, their own device card.
  await mem.evaluate(() => { location.hash = '#/room'; });
  await expect(mem.getByTestId('room-page')).toBeVisible();
  await expect(mem.getByTestId('your-device')).toContainText('desktop app');
  await expect(mem.getByTestId('member-row').filter({ hasText: 'rdx' }).getByTestId('slot-select')).toBeDisabled();
  await shot(mem, 'room-member');
  await mem.evaluate(() => { location.hash = '#/live'; });

  // Tournament mode: no live call on any screen.
  await host.page.getByTestId('tournament-toggle').check();
  await expect(mem.getByTestId('call')).toHaveAttribute('data-kind', 'tournament', { timeout: 10_000 });
  await host.page.getByTestId('tournament-toggle').uncheck();
  await expect(mem.getByTestId('call-head')).toHaveText('Anti-eco · stack B', { timeout: 10_000 });

  // The admin's app closes: the member keeps the last screen and says the host is offline.
  expect(host.errors).toEqual([]);
  await host.page.close();
  await expect(status(mem)).toHaveAttribute('data-status', 'host-offline', { timeout: 45_000 });
  await expect(mem.getByTestId('call-head')).toHaveText('Anti-eco · stack B');
  await shot(mem, 'host-offline');

  // The admin reopens csbot: the room comes back by itself and the member is let straight back in.
  const host2 = await openHost(hostCtx, false);
  await expect(status(mem)).toHaveAttribute('data-status', 'approved', { timeout: 45_000 });
  await expect(host2.page.getByTestId('pending-row')).toHaveCount(0);
  await expect(memberRow(host2.page, 'kairo')).toContainText('online');
  expect(host2.invite).toBe(host.invite);

  // End room: everyone is told.
  await host2.page.getByTestId('end-room').click();
  await expect(status(mem)).toHaveAttribute('data-status', 'ended', { timeout: 15_000 });
  await expect(host2.page.getByTestId('create-room')).toBeVisible();
  expect(memErrors).toEqual([]);
  expect(host2.errors).toEqual([]);
  await hostCtx.close();
  await memCtx.close();
});

test('room: a link with the wrong key is refused', async ({ browser }) => {
  const hostCtx = await browser.newContext();
  await mockBridge(hostCtx);
  const host = await openHost(hostCtx);
  const wrong = host.invite.replace(/k=[\w-]+/, 'k=AAAAAAAAAAAAAAAAAAAAAA');
  const memCtx = await browser.newContext();
  const mem = await memCtx.newPage();
  await joinFromBrowser(mem, wrong, 'stranger');
  // Depending on which side receives the encrypted offer, the member either gets an explicit
  // "wrong key" (denied) or simply never finds the room. Either way it never gets in.
  await expect(mem.getByTestId('slow-hint').or(mem.locator('[data-testid="link-status"][data-status="denied"]'))).toBeVisible({ timeout: 45_000 });
  await expect(status(mem)).not.toHaveAttribute('data-status', /approved|pending/);
  await expect(host.page.getByTestId('pending-row')).toHaveCount(0);
  await shot(mem, 'wrong-key', false);
  await hostCtx.close();
  await memCtx.close();
});

test('room: a declined request', async ({ browser }) => {
  const hostCtx = await browser.newContext();
  await mockBridge(hostCtx);
  const host = await openHost(hostCtx);
  const memCtx = await browser.newContext();
  const mem = await memCtx.newPage();
  await joinFromBrowser(mem, host.invite, 'stranger');
  await host.page.getByTestId('pending-row').filter({ hasText: 'stranger' }).getByTestId('deny').click({ timeout: 30_000 });
  await expect(status(mem)).toHaveAttribute('data-status', 'denied', { timeout: 15_000 });
  await expect(status(mem)).toContainText('declined');
  await mem.getByTestId('link-back').click();
  await expect(mem.getByTestId('join')).toBeVisible();
  await hostCtx.close();
  await memCtx.close();
});

test('room: a desktop member shares their own GSI and gets their own money tile', async ({ browser }) => {
  const hostCtx = await browser.newContext();
  await mockBridge(hostCtx);
  const host = await openHost(hostCtx);

  const memCtx = await browser.newContext();
  await mockBridge(memCtx);
  const mem = await memCtx.newPage();
  const memErrors = watchErrors(mem);
  await mem.goto('./#/room');
  await expect(mem.getByTestId('room-chip')).toContainText('No room');
  await mem.getByTestId('join-link-input').fill(host.invite);
  await mem.getByTestId('join-link-name').fill('mbt');
  await mem.getByTestId('join-link-submit').click();
  await host.page.getByTestId('pending-row').filter({ hasText: 'mbt' }).getByTestId('approve').click({ timeout: 30_000 });
  await expect(status(mem)).toHaveAttribute('data-status', 'approved', { timeout: 15_000 });

  for (const p of memberPayloads('76561198000000004', 'mbt')) {
    await mem.evaluate(x => (window as unknown as { __pushGsi: (p: unknown) => void }).__pushGsi(x), p);
    await mem.waitForTimeout(120);
  }
  await mem.evaluate(() => { location.hash = '#/live'; });
  await expect(mem.getByTestId('tile-you')).toContainText('$', { timeout: 10_000 });
  await expect(mem.getByTestId('our-team')).toContainText('mbt (you)');
  await expect(mem.getByTestId('our-team')).toContainText('room');
  await expect(memberRow(host.page, 'mbt')).toContainText('✓ yes');
  await expect(host.page.getByTestId('room-chip')).toContainText('2 online');

  // Leaving brings the desktop app back to its own game.
  await mem.evaluate(() => { location.hash = '#/room'; });
  await mem.getByTestId('leave-room').click();
  await expect(mem.getByTestId('create-room')).toBeVisible();
  await expect(memberRow(host.page, 'mbt')).toContainText('offline', { timeout: 15_000 });
  expect(memErrors).toEqual([]);
  await hostCtx.close();
  await memCtx.close();
});

test('demo: a read-only fictional room, also at 820 px', async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 820, height: 1100 });
  await page.goto('./?at=freeze-2%2B3&pause=1#/room');
  await expect(page.getByTestId('room-code')).toHaveText('K7P-2QX');
  await expect(page.getByTestId('member-row')).toHaveCount(5);
  await expect(page.getByTestId('create-room')).toHaveCount(0);
  await expect(page.getByTestId('end-room')).toHaveCount(0);
  await expect(page.getByTestId('tournament-toggle')).toBeDisabled();
  await expect(page.getByTestId('slot-select').first()).toBeDisabled();
  const scroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(scroll).toBeLessThanOrEqual(0);
  await shot(page, 'room-demo-narrow');
  // The demo map labels spots with the fictional members' names.
  await page.goto('./?at=freeze-2%2B3&pause=1#/live');
  await expect(page.locator('[data-slot="awp"]')).toContainText('zeph');
  expect(errors).toEqual([]);
});
