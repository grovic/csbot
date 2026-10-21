// Intel (M4a): click a map zone during a live round, choose how many enemies (or clear), and the
// forecast, the call and the banner update for everyone. Demo (the browser's own tracker), the desktop
// bridge (mocked here), and a room over real WebRTC (local relay from global-setup.ts).

import { MatchTracker } from '@csbot/engine';
import { FULL_MATCH, syntheticMatch, toGameState } from '@csbot/gsi';
import type { LiveSnapshot } from '@csbot/protocol';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCREENS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'screens');
fs.mkdirSync(SCREENS, { recursive: true });

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  return errors;
}

/**
 * Host snapshot in round `round`, `k` payloads into the live phase (lean synthetic match, Mirage CT),
 * optionally after some intel. Round 5: a bigger enemy buy, so the forecast isn't clear yet.
 */
function liveSnap(round = 5, k = 2, intel: { zone: string; count: number; by: string }[] = []): LiveSnapshot {
  const t = new MatchTracker({ playbookHandle: 'a' });
  const rec = syntheticMatch({ rounds: FULL_MATCH, lean: true });
  const live = rec.map((r, i) => ({ r, i })).filter(({ r }) => (r.p.map?.round ?? 0) + 1 === round && r.p.round?.phase === 'live' && r.p.round?.bomb !== 'planted');
  const stop = live[Math.min(k, live.length - 1)]!.i;
  for (const r of rec.slice(0, stop + 1)) t.ingest(toGameState(r.p, r.t));
  const at = rec[stop]!.t;
  for (const i of intel) t.addIntel({ ...i, at });
  return t.snapshot(at);
}

const zone = (page: Page, id: string) => page.locator(`[data-testid="map-zone"][data-zone="${id}"]`);
const count = (page: Page, n: number) => page.locator(`[data-testid="intel-count"][data-count="${n}"]`);

test('demo: click B Apps, 3 seen → pin, forecast updated by intel, PLAN CHANGED, B hit call', async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto('./?at=live-5%2B2&pause=1#/live');
  await expect(page.getByTestId('banner')).toHaveAttribute('data-phase', 'live');
  await expect(page.getByTestId('forecast-basis')).toHaveAttribute('data-basis', 'prior');
  await expect(page.getByTestId('call')).toHaveAttribute('data-kind', 'pre');

  await zone(page, 'bapps').click();
  await expect(page.getByTestId('intel-pop')).toBeVisible();
  await expect(page.getByTestId('intel-pop')).toContainText('Enemies at B Apps');
  await page.getByTestId('map').screenshot({ path: path.join(SCREENS, 'intel-popover.png') });
  await count(page, 3).click();

  await expect(page.getByTestId('intel-pop')).toHaveCount(0);
  const pin = page.locator('[data-testid="intel-pin"][data-zone="bapps"]');
  await expect(pin).toBeVisible();
  await expect(pin).toContainText('3');
  await expect(pin).toHaveAttribute('title', /^rdx: 3 at B Apps · \d:\d\d$/);
  await expect(page.getByTestId('forecast-basis')).toHaveAttribute('data-basis', 'intel');
  await expect(page.getByTestId('forecast-basis')).toHaveText('updated by intel');
  await expect(page.getByTestId('banner')).toHaveAttribute('data-state', 'alert');
  await expect(page.getByTestId('banner')).toContainText('PLAN CHANGED');
  await expect(page.getByTestId('call')).toHaveAttribute('data-kind', 'mid');
  await expect(page.getByTestId('call-head')).toHaveText(/^B hit likely · \d+%$/);
  await expect(page.getByTestId('call')).toContainText(/^Update · \d:\d\d/);
  await expect(page.getByTestId('ticker')).toContainText(/PLAN|rdx: 3 at B Apps/);
  await page.getByTestId('map').screenshot({ path: path.join(SCREENS, 'live-intel.png') });
  await page.screenshot({ path: path.join(SCREENS, 'live-plan-changed.png') });

  // Esc and keys: a clear for A Ramp with the 0 key.
  await zone(page, 'aramp').click();
  await expect(page.getByTestId('intel-pop')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('intel-pop')).toHaveCount(0);
  await zone(page, 'aramp').click();
  await page.keyboard.press('0');
  await expect(page.locator('[data-testid="intel-pin"][data-zone="aramp"]')).toHaveAttribute('data-count', '0');

  // The +10 s heat toggle.
  await page.getByTestId('forecast-seg').getByText('+10 s').click();
  await expect(page.getByTestId('forecast-seg').locator('button.on')).toHaveText('+10 s');

  // Coach reasoning lists the intel and says the forecast moved (same page: only the hash changes).
  await page.evaluate(() => { location.hash = '#/coach'; });
  await expect(page.getByTestId('coach-intel')).toContainText('rdx · 3 at B Apps');
  await expect(page.getByTestId('coach-intel')).toContainText('rdx · A Ramp clear');
  await expect(page.getByTestId('forecast-note')).toContainText('updated by 2 intel this round');
  expect(errors).toEqual([]);
});

test('demo: during freeze time a click explains that intel waits for the live round', async ({ page }) => {
  await page.goto('./?at=freeze-5%2B2&pause=1#/live');
  await expect(page.getByTestId('banner')).toHaveAttribute('data-phase', 'freezetime');
  await zone(page, 'bapps').click();
  await expect(page.getByTestId('intel-pop')).toHaveCount(0);
  await expect(page.getByTestId('intel-error')).toContainText('while the round is live');
});

/** A desktop bridge mock: snapshots, logIntel (refuses "mid") and the hotkeys switch. */
async function bridgeMock(ctx: BrowserContext | Page, snap: LiveSnapshot) {
  await ctx.addInitScript(s => {
    type Cb = (x: unknown) => void;
    const calls: string[] = [];
    const snaps = new Set<Cb>();
    let last: unknown = s;
    let hotkeys = false;
    const w = window as unknown as Record<string, unknown>;
    w.__calls = calls;
    w.__pushSnap = (x: unknown) => { last = x; for (const cb of snaps) cb(x); };
    const keys = [
      { key: 'Num7', zone: 'aramp', zoneName: 'A Ramp', kind: 'sighting' }, { key: 'Num8', zone: 'topmid', zoneName: 'Top Mid', kind: 'sighting' },
      { key: 'Num9', zone: 'bapps', zoneName: 'B Apps', kind: 'sighting' }, { key: 'Num1', zone: 'aramp', zoneName: 'A Ramp', kind: 'clear' },
      { key: 'Num2', zone: 'topmid', zoneName: 'Top Mid', kind: 'clear' }, { key: 'Num3', zone: 'bapps', zoneName: 'B Apps', kind: 'clear' },
    ];
    w.csbot = {
      onSnapshot: (cb: Cb) => { snaps.add(cb); cb(last); return () => snaps.delete(cb); },
      getInfo: async () => ({ version: '0.5.0', gsiUrl: 'http://127.0.0.1:47400', cfgStatus: 'current', recordingsDir: 'C:\\csbot\\recordings', intelHotkeys: { enabled: hotkeys, keys } }),
      installCfg: async () => ({ ok: true }),
      openRecordings: async () => {},
      logIntel: async (zone: string, n: number, from?: { id: string; name: string }) => {
        calls.push(`intel:${zone}:${n}${from ? ':' + from.name : ''}`);
        return zone === 'mid' ? { ok: false, error: 'Unknown zone "mid".' } : { ok: true };
      },
      setIntelHotkeys: async (on: boolean) => { calls.push(`hotkeys:${on}`); hotkeys = on; return { ok: true }; },
    };
  }, snap);
}
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __calls: string[] }).__calls);

test('desktop: a map click logs intel through the bridge; refusals show; hotkeys switch', async ({ page }) => {
  const errors = watchErrors(page);
  await bridgeMock(page, liveSnap());
  await page.goto('./#/live');
  await zone(page, 'bapps').click();
  await count(page, 3).click();
  await expect.poll(() => calls(page)).toEqual(['intel:bapps:3']);
  await zone(page, 'mid').click();
  await count(page, 1).click();
  await expect(page.getByTestId('intel-error')).toContainText('Unknown zone "mid"');

  await page.evaluate(() => { location.hash = '#/settings'; });
  const toggle = page.getByTestId('hotkeys-toggle');
  await expect(toggle).not.toBeChecked();
  await expect(page.getByTestId('hotkeys-list')).toHaveAttribute('data-enabled', '0');
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(page.getByTestId('hotkeys-list')).toHaveAttribute('data-enabled', '1');
  await expect(page.getByTestId('hotkeys-list')).toContainText('Num7');
  await expect(page.getByTestId('hotkeys-list')).toContainText('B Apps seen');
  await expect(page.getByTestId('hotkeys-list')).toContainText('A Ramp clear');
  expect((await calls(page)).slice(-1)).toEqual(['hotkeys:true']);
  await page.getByTestId('hotkeys-card').screenshot({ path: path.join(SCREENS, 'settings-hotkeys.png') });
  expect(errors).toEqual([]);
});

test('room: a member logs intel through the host, sees the pin, and is refused when intel is off', async ({ browser }) => {
  test.setTimeout(120_000);
  const relay = process.env.CSBOT_RELAY!;
  const hostCtx = await browser.newContext();
  await bridgeMock(hostCtx, liveSnap());
  const host = await hostCtx.newPage();
  const hostErrors = watchErrors(host);
  await host.goto(`./?signal=${encodeURIComponent(relay)}#/room`);
  await host.getByTestId('create-room').click();
  const invite = await host.getByTestId('invite-link').inputValue();

  const memCtx = await browser.newContext();
  const mem = await memCtx.newPage();
  const memErrors = watchErrors(mem);
  await mem.goto(invite);
  await mem.getByTestId('join-name').fill('kairo');
  await mem.getByTestId('join-submit').click();
  await expect(host.getByTestId('pending-row')).toContainText('kairo', { timeout: 30_000 });
  await host.getByTestId('pending-row').getByTestId('approve').click();
  await expect(mem.getByTestId('link-status')).toHaveCount(0, { timeout: 30_000 }).catch(() => undefined);
  await mem.evaluate(() => { location.hash = '#/live'; });
  await expect(mem.getByTestId('banner')).toHaveAttribute('data-phase', 'live', { timeout: 30_000 });

  // The member's click reaches the host's bridge with who saw it.
  await zone(mem, 'bapps').click();
  await count(mem, 3).click();
  await expect.poll(() => calls(host), { timeout: 15_000 }).toContain('intel:bapps:3:kairo');

  // The host's next snapshot carries the intel: the member sees the pin.
  await host.evaluate(s => (window as unknown as { __pushSnap: (x: unknown) => void }).__pushSnap(s), liveSnap(5, 2, [{ zone: 'bapps', count: 3, by: 'kairo' }]));
  await expect(mem.locator('[data-testid="intel-pin"][data-zone="bapps"]')).toBeVisible({ timeout: 15_000 });
  await expect(mem.getByTestId('banner')).toHaveAttribute('data-state', 'alert');

  // The admin turns member intel off: the member's click is refused right away.
  await host.getByTestId('perm-intel').click();
  await expect.poll(async () => mem.evaluate(() => document.querySelector('[data-testid="map"] .map')?.className ?? ''), { timeout: 15_000 }).not.toContain('can-intel');
  await zone(mem, 'aramp').click();
  await expect(mem.getByTestId('intel-error')).toContainText('turned off intel');
  expect(hostErrors).toEqual([]);
  expect(memErrors).toEqual([]);
  await memCtx.close();
  await hostCtx.close();
});
