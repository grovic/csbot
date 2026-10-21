// Scouting end to end in the hidden desktop app: the sample match through the bridge, the AI report on a
// fake `claude` (CSBOT_CLAUDE_BIN, never a real model), the key flow, and the Scout page when it exists.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { ScoutView } from '@csbot/protocol';
import { launchApp, screens, shot, waitFor, type LaunchedApp } from './helpers.ts';

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-claude.mjs');

test.describe.configure({ mode: 'serial' });
let app: LaunchedApp;

test.beforeAll(async () => {
  app = await launchApp({ CSBOT_CLAUDE_BIN: FAKE, FAKE_CLAUDE_DELAY: '300' });
  await app.page.evaluate(() => {
    const w = window as unknown as { __scout: ScoutView[] };
    w.__scout = [];
    window.csbot!.onScout!(v => { w.__scout.push(v); });
  });
});
test.afterAll(async () => { await app?.close(); });

const views = () => app.page.evaluate(() => (window as unknown as { __scout: ScoutView[] }).__scout);
const last = async () => { const v = await views(); return v[v.length - 1]!; };

test('the bridge sends the current scouting view right away', async () => {
  const v = await waitFor(async () => (await views())[0]);
  expect(v.status).toBe('idle');
  // Claude Code detection runs once at startup (the fake answers --version).
  await waitFor(async () => (await last()).sources.claude === 'live');
  expect((await last()).sources.faceit).toBe('missing-key');
});

test('the sample match scouts, then the AI report runs on its own and fills the tips', async () => {
  await app.page.evaluate(() => window.csbot!.scoutSample!());
  const ready = await waitFor(async () => { const v = await last(); return v.report.status === 'ready' ? v : undefined; }, 20_000);
  expect(ready.platform).toBe('sample');
  expect(ready.them.players[0]!.nickname).toBe('Holo');
  expect(ready.report.model).toBe('claude-fake-opus');
  expect(ready.them.players.find(p => p.nickname === 'Holo')!.tip).toBe('Use utility before peeking him and always trade.');
  expect(ready.report.tips).not.toHaveProperty('NotOnTheRoster');
  const seen = await views();
  expect(seen.some(v => v.status === 'loading')).toBe(true);
  expect(seen.some(v => v.report.status === 'running')).toBe(true);
});

test('a manual re-run goes through the bridge', async () => {
  const before = (await views()).length;
  await app.page.evaluate(() => window.csbot!.runScoutReport!());
  await waitFor(async () => (await views()).slice(before).some(v => v.report.status === 'ready'));
});

test('scouting a FACEIT link without a key explains what to do', async () => {
  const r = await app.page.evaluate(() => window.csbot!.scoutMatch!('https://www.faceit.com/en/cs2/room/1-6c8c1b43-1234-4d9e-9e2f-1234567890ab'));
  expect(r).toEqual({ ok: false, error: 'Add your FACEIT API key in Settings, or try the sample match.' });
  const bad = await app.page.evaluate(() => window.csbot!.scoutMatch!('hello'));
  expect(bad.ok).toBe(false);
});

test('saving a key is encrypted on disk and only its state reaches the renderer', async () => {
  const key = 'test-faceit-key-0000-1111';
  const r = await app.page.evaluate(k => window.csbot!.setApiKey!('faceit', k), key);
  const file = path.join(app.dir, 'userData', 'secrets.json');
  console.log(`[scout e2e] OS encryption ${r.ok ? 'available: key stored encrypted' : 'unavailable: key refused'}`);
  if (r.ok) {
    await waitFor(async () => (await last()).sources.faceit === 'live');
    expect(fs.readFileSync(file, 'utf8')).not.toContain(key);
    // Nothing the renderer received carries the key.
    expect(JSON.stringify(await views())).not.toContain(key);
    expect((await app.page.evaluate(() => window.csbot!.setApiKey!('faceit', null))).ok).toBe(true);
    // Back to "no key": shown as 'sample' while the sample match is loaded, else 'missing-key'.
    await waitFor(async () => { const v = await last(); return v.sources.faceit === (v.platform === 'sample' ? 'sample' : 'missing-key'); });
  } else {
    // No OS encryption in this environment: csbot must refuse rather than store plain text.
    expect(r.error).toMatch(/encrypt/);
    expect(fs.existsSync(file)).toBe(false);
  }
  const junk = await app.page.evaluate(() => window.csbot!.setApiKey!('faceit', 'not a key!'));
  expect(junk.ok).toBe(false);
});

test('the Scout page runs the sample match from the UI', async () => {
  const p = app.page;
  await p.evaluate(() => { location.hash = '#/scout'; });
  const hasPage = await p.getByTestId('scout-page').waitFor({ timeout: 5000 }).then(() => true, () => false);
  test.fixme(!hasPage, 'The web Scout page (apps/web) is not built yet.');
  // Earlier tests already scouted the sample, so the page may show it with the form tucked away.
  const sample = p.getByTestId('scout-sample').first();
  if (await sample.isVisible()) await sample.click();
  else await p.evaluate(() => window.csbot!.scoutSample!());
  await expect(p.getByTestId('scout-status')).toHaveAttribute('data-status', 'ready', { timeout: 20_000 });
  await expect(p.getByTestId('enemy-card').first()).toBeVisible();
  await expect(p.locator('[data-testid="enemy-card"][data-nick="Holo"]')).toBeVisible();
  await expect(p.getByTestId('report-status')).toHaveAttribute('data-status', 'ready', { timeout: 20_000 });
  await expect(p.getByTestId('report-summary')).not.toBeEmpty();
  await expect(p.locator('[data-testid="veto-map"][data-map="de_ancient"]')).toHaveAttribute('data-action', 'ban');
  fs.mkdirSync(screens, { recursive: true });
  await shot(app, path.join(screens, 'desktop-scout.png'));
});
