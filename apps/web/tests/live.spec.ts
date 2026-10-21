import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCREENS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'screens');
fs.mkdirSync(SCREENS, { recursive: true });

/** Fail the test on any console error or uncaught exception. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  return errors;
}

async function open(page: Page, query: string, hash = '#/live') {
  const errors = watchErrors(page);
  await page.goto(`./?${query}${hash}`);
  return errors;
}

const shot = (page: Page, name: string, fullPage = true) => page.screenshot({ path: path.join(SCREENS, `${name}.png`), fullPage });

test('demo plays: banner, call, tiles, map, scoreboard', async ({ page }) => {
  const errors = await open(page, 'speed=20');
  await expect(page.getByTestId('banner')).toBeVisible();
  await expect(page.getByTestId('call')).toBeVisible();
  await expect(page.getByTestId('tiles')).toBeVisible();
  await expect(page.getByTestId('map')).toBeVisible();
  await expect(page.getByTestId('scoreboard')).toBeVisible();
  await expect(page.getByTestId('conn-chip')).toContainText('DEMO');
  // The demo advances: within a few seconds at 20× the first round result lands in the strip.
  await expect(page.locator('.rc[data-winner]').first()).toBeVisible({ timeout: 15_000 });
  expect(errors).toEqual([]);
});

test('freeze time, round 2: anti-eco call with my job', async ({ page }) => {
  const errors = await open(page, 'at=freeze-2%2B3&pause=1');
  await expect(page.getByTestId('banner')).toHaveAttribute('data-phase', 'freezetime');
  await expect(page.getByTestId('banner-clock')).toHaveText(/≈\s*0:1\d/);
  await expect(page.getByTestId('call-head')).toHaveText('Anti-eco · stack B');
  await expect(page.getByTestId('youline')).toContainText('A site alone');
  await expect(page.getByTestId('tile-enemy')).toContainText('ECO');
  await expect(page.getByTestId('tile-enemy')).toContainText('estimate');
  await expect(page.getByTestId('tile-hit')).toContainText('B site');
  await expect(page.getByTestId('marker-you')).toBeVisible();
  await expect(page.getByTestId('heat')).toBeVisible();
  await expect(page.getByTestId('score-us')).toHaveText('1');
  await page.getByRole('button', { name: 'Why this call?' }).click();
  await expect(page.getByTestId('why')).toContainText('Enemy est.');
  await shot(page, 'live-freeze-r2');
  expect(errors).toEqual([]);
});

test('round live', async ({ page }) => {
  const errors = await open(page, 'at=live-2%2B2&pause=1');
  await expect(page.getByTestId('banner')).toHaveAttribute('data-phase', 'live');
  await expect(page.getByTestId('tile-you')).toContainText(/If round is lost|You/);
  await shot(page, 'live-round-live');
  expect(errors).toEqual([]);
});

test('bomb planted: red banner and post-plant call', async ({ page }) => {
  const errors = await open(page, 'at=bomb-3%2B1&pause=1');
  await expect(page.getByTestId('banner')).toHaveAttribute('data-phase', 'bomb');
  await expect(page.getByTestId('banner')).toHaveClass(/bomb/);
  await expect(page.getByTestId('call')).toHaveAttribute('data-kind', 'post');
  await expect(page.getByTestId('call-head')).toHaveText('Bomb planted · retake');
  await expect(page.getByTestId('tile-hit')).toContainText("doesn't tell players the bomb site");
  await shot(page, 'live-bomb');
  expect(errors).toEqual([]);
});

test('round over: result call and history', async ({ page }) => {
  const errors = await open(page, 'at=over-3&pause=1');
  await expect(page.getByTestId('banner')).toHaveAttribute('data-phase', 'over');
  await expect(page.getByTestId('call')).toHaveAttribute('data-kind', 'over');
  await expect(page.getByTestId('call-head')).toHaveText('Round lost');
  await expect(page.locator('.rc[data-round="3"]')).toHaveAttribute('data-winner', 'them');
  await shot(page, 'live-round-over');
  expect(errors).toEqual([]);
});

test('second half on T: our T playbook call, our job and spot, and the read on their CT setup', async ({ page }) => {
  const errors = await open(page, 'at=freeze-14%2B3&pause=1');
  await expect(page.getByTestId('banner')).toHaveAttribute('data-phase', 'freezetime');
  await expect(page.getByTestId('scorebox')).toContainText('Round 14');
  await expect(page.getByTestId('call-head')).not.toHaveText(/^Enemy /);
  await expect(page.getByTestId('youline')).toBeVisible();
  await expect(page.getByTestId('marker-you')).toBeVisible();
  await expect(page.getByTestId('tile-hit')).toContainText('Likely light');
  await expect(page.getByTestId('tile-hit')).toContainText(/they likely play .+ · estimate/);
  await expect(page.getByTestId('forecast-basis')).toHaveAttribute('data-basis', 'prior');
  await expect(page.getByTestId('heat')).toBeVisible();
  await expect(page.getByTestId('map-note')).toHaveCount(0);
  await expect(page.locator('.rhalf-h').nth(1)).toContainText('you T');
  await shot(page, 'live-second-half-t');
  expect(errors).toEqual([]);
});

test('match over', async ({ page }) => {
  const errors = await open(page, 'at=gameover&pause=1');
  await expect(page.getByTestId('banner')).toHaveAttribute('data-phase', 'gameover');
  await expect(page.getByTestId('score-us')).toHaveText('13');
  await expect(page.getByTestId('score-them')).toHaveText('8');
  await expect(page.getByTestId('call-head')).toHaveText('Match won 13–8');
  await expect(page.getByTestId('tile-you')).toContainText('Match over');
  await expect(page.locator('.rc[data-winner]')).toHaveCount(21);
  await expect(page.getByTestId('our-team')).toContainText('seen R');
  await shot(page, 'live-match-over');
  expect(errors).toEqual([]);
});

test('waiting for CS2 when there is no source', async ({ page }) => {
  const errors = await open(page, 'source=none');
  await expect(page.getByTestId('waiting')).toContainText('Waiting for CS2');
  await expect(page.getByTestId('try-demo')).toBeVisible();
  await expect(page.getByTestId('conn-chip')).toContainText('Waiting for CS2');
  await shot(page, 'live-waiting', false);
  expect(errors).toEqual([]);
});

test('settings in the browser explains hosting', async ({ page }) => {
  const errors = await open(page, 'at=live-2&pause=1', '#/settings');
  await expect(page.getByTestId('browser-card')).toContainText('desktop app');
  await expect(page.getByTestId('gsi-status')).toContainText('source: demo');
  await shot(page, 'settings-browser');
  expect(errors).toEqual([]);
});

test('every page is real: Debrief and Coach have no placeholders left', async ({ page }) => {
  const errors = await open(page, 'at=live-2&pause=1', '#/debrief');
  await expect(page.getByTestId('debrief')).toBeVisible();
  await page.goto('./?at=live-2&pause=1#/coach');
  await expect(page.getByTestId('coach-page')).toBeVisible();
  await expect(page.getByTestId('placeholder')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('narrow 820 px layout stacks', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1100 });
  const errors = await open(page, 'at=freeze-2%2B3&pause=1');
  await expect(page.getByTestId('call-head')).toHaveText('Anti-eco · stack B');
  const call = await page.getByTestId('call').boundingBox();
  const map = await page.getByTestId('map').boundingBox();
  expect(map!.y).toBeGreaterThan(call!.y + call!.height - 1); // map below the call column
  const scroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(scroll).toBeLessThanOrEqual(0);
  await shot(page, 'live-narrow-820');
  expect(errors).toEqual([]);
});

test('desktop bridge: snapshots and settings come over the bridge', async ({ page }) => {
  const errors = watchErrors(page);
  await page.addInitScript(() => {
    const calls: string[] = [];
    (window as unknown as { __calls: string[] }).__calls = calls;
    const snap = {
      v: 1, seq: 1, at: Date.now(), scoreboard: [], ticker: [],
      connection: { gsi: 'waiting', payloads: 0, source: 'game', guardDropped: 0 },
    };
    (window as unknown as { csbot: unknown }).csbot = {
      onSnapshot: (cb: (s: unknown) => void) => { cb(snap); return () => {}; },
      getInfo: async () => ({ version: '0.1.0', gsiUrl: 'http://127.0.0.1:47400', cfgStatus: 'missing', cfgPath: 'C:\\Games\\Counter-Strike Global Offensive\\game\\csgo\\cfg\\gamestate_integration_csbot.cfg', cs2Path: 'C:\\Games\\Counter-Strike Global Offensive', recordingsDir: 'C:\\Users\\player\\AppData\\Roaming\\csbot\\recordings' }),
      installCfg: async () => { calls.push('install'); return { ok: true, path: 'C:\\Games\\Counter-Strike Global Offensive\\game\\csgo\\cfg\\gamestate_integration_csbot.cfg' }; },
      openRecordings: async () => { calls.push('open'); },
    };
  });
  await page.goto('./#/live');
  await expect(page.getByTestId('waiting')).toBeVisible();
  await expect(page.getByTestId('try-demo')).toHaveCount(0);
  await page.goto('./#/settings');
  await expect(page.getByTestId('host-card')).toContainText('not installed');
  await expect(page.getByTestId('host-card')).toContainText('gamestate_integration_csbot.cfg');
  await page.getByTestId('install-cfg').click();
  await expect(page.getByTestId('install-result')).toContainText('Installed');
  expect(await page.evaluate(() => (window as unknown as { __calls: string[] }).__calls)).toEqual(['install']);
  await shot(page, 'settings-desktop');
  expect(errors).toEqual([]);
});
