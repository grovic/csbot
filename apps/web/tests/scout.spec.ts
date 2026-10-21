// Scout page: the browser demo (sample match scouted in the browser + a recorded briefing), and the
// desktop host flows over a mocked bridge driven with views computed here by the real scouting code.

import { EMPTY_SCOUT, type ScoutView } from '@csbot/protocol';
import { SAMPLE_MATCH_ID, SAMPLE_REPORT, sampleFaceit, sampleSteam, sampleSteamId, scoutFaceitMatch, withReport } from '@csbot/scout';
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCREENS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'screens');
fs.mkdirSync(SCREENS, { recursive: true });
const shot = (page: Page, name: string, fullPage = true) => page.screenshot({ path: path.join(SCREENS, `${name}.png`), fullPage });

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  return errors;
}

async function sampleView(sources: ScoutView['sources']): Promise<ScoutView> {
  return scoutFaceitMatch(
    { faceit: sampleFaceit(), steam: sampleSteam(), sources },
    { matchId: SAMPLE_MATCH_ID, platform: 'sample', ourSteamId: sampleSteamId('rdx'), room: { [sampleSteamId('rdx')!]: 'admin', [sampleSteamId('kairo')!]: 'member' } },
  );
}

test('demo: the sample match, scouted in the browser', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./?at=freeze-2%2B3&pause=1#/scout');
  const cards = page.getByTestId('enemy-card');
  await expect(cards).toHaveCount(5);
  await expect(page.getByTestId('scout-status')).toHaveAttribute('data-status', 'ready');
  await expect(page.getByTestId('sample-chip')).toBeVisible();
  await expect(cards.first()).toHaveAttribute('data-nick', 'Holo');
  await expect(cards.first()).toContainText('likely AWP');
  await expect(page.locator('[data-testid="enemy-card"][data-nick="Holo"] .party')).toHaveText('A');
  await expect(page.locator('[data-testid="enemy-card"][data-nick="sk1p"] .party')).toHaveText('B');
  await expect(page.locator('[data-testid="enemy-card"][data-nick="Okami"]')).toContainText('VAC ban');
  await expect(page.locator('[data-testid="veto-map"][data-map="de_ancient"]')).toHaveAttribute('data-action', 'ban');
  await expect(page.getByTestId('report-status')).toHaveAttribute('data-status', 'ready');
  await expect(page.getByTestId('report-summary')).toContainText('team_kappa averages');
  await expect(page.getByTestId('things')).toHaveAttribute('data-source', 'ai');
  await expect(page.getByTestId('win-chance')).toContainText("FACEIT's estimate");
  // No desktop app: no scouting controls.
  await expect(page.getByTestId('scout-run-report')).toHaveCount(0);
  await expect(page.getByTestId('scout-match-input')).toHaveCount(0);
  // The host (rdx) is marked YOU on our side.
  await expect(page.locator('[data-testid="our-card"][data-nick="rdx"]')).toContainText('YOU');
  await expect(page.locator('[data-testid="our-card"][data-nick="zeph"]')).toContainText('RANDOM');
  await shot(page, 'scout');

  await page.locator('[data-testid="enemy-card"][data-nick="sk1p"]').click();
  const detail = page.getByTestId('enemy-detail');
  await expect(detail).toHaveAttribute('data-nick', 'sk1p');
  await expect(detail).toContainText('Steam account 5 months old');
  await expect(detail).toContainText('Dust II');
  await detail.scrollIntoViewIfNeeded();
  await shot(page, 'scout-detail', false);
  expect(errors).toEqual([]);
});

test('demo: the Live scoreboard lists the enemy players from scouting', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./?at=freeze-2%2B3&pause=1#/live');
  const rows = page.locator('[data-testid="enemy-players"] tbody tr');
  await expect(rows).toHaveCount(5);
  await expect(rows.first()).toHaveAttribute('data-nick', 'Holo');
  await expect(rows.first()).toContainText('likely AWP');
  await expect(page.getByTestId('enemy-box')).toContainText('estimate');
  await page.getByTestId('scoreboard').screenshot({ path: path.join(SCREENS, 'live-enemy-panel.png') });
  expect(errors).toEqual([]);
});

test('demo: Scout at 820 px stacks without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1100 });
  await page.goto('./?at=freeze-2%2B3&pause=1#/scout');
  await expect(page.getByTestId('enemy-card')).toHaveCount(5);
  const scroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(scroll).toBeLessThanOrEqual(0);
});

test('desktop host: scout a match, the sample, the briefing and the API keys', async ({ page }) => {
  const errors = watchErrors(page);
  const empty: ScoutView = { ...EMPTY_SCOUT, sources: { faceit: 'missing-key', steam: 'missing-key', claude: 'live' } };
  const sample = await sampleView({ faceit: 'sample', steam: 'sample', claude: 'live' });
  const running: ScoutView = { ...sample, report: { status: 'running' } };
  const ready = withReport(sample, { ...SAMPLE_REPORT });
  await page.addInitScript(([empty, sample, running, ready]) => {
    type Cb = (x: unknown) => void;
    const calls: string[] = [];
    const scoutCbs = new Set<Cb>();
    let current: unknown = empty;
    const push = (s: unknown) => { current = s; for (const cb of scoutCbs) cb(s); };
    const w = window as unknown as Record<string, unknown>;
    w.__calls = calls;
    const snap = { v: 1, seq: 1, at: Date.now(), scoreboard: [], ticker: [], connection: { gsi: 'waiting', payloads: 0, source: 'game', guardDropped: 0 } };
    w.csbot = {
      onSnapshot: (cb: Cb) => { cb(snap); return () => {}; },
      onScout: (cb: Cb) => { scoutCbs.add(cb); cb(current); return () => scoutCbs.delete(cb); },
      getInfo: async () => ({ version: '0.1.0', gsiUrl: 'http://127.0.0.1:47400', cfgStatus: 'current', recordingsDir: 'C:\\csbot\\recordings' }),
      installCfg: async () => ({ ok: true }),
      openRecordings: async () => {},
      scoutMatch: async (link: string) => {
        calls.push('match:' + link);
        if (link.includes('bad')) return { ok: false, error: 'FACEIT has no match with that id. Check the link.' };
        return { ok: true };
      },
      scoutSample: async () => { calls.push('sample'); push(sample); },
      runScoutReport: async () => { calls.push('report'); push(running); setTimeout(() => push(ready), 400); },
      setApiKey: async (service: string, key: string | null) => { calls.push(`key:${service}:${key ? 'set' : 'clear'}`); return { ok: true }; },
    };
  }, [empty, sample, running, ready] as const);

  const calls = () => page.evaluate(() => (window as unknown as { __calls: string[] }).__calls);
  await page.goto('./#/scout');
  await expect(page.getByTestId('scout-empty')).toBeVisible();
  await expect(page.getByTestId('scout-empty')).toContainText('FACEIT API key');
  await shot(page, 'scout-empty-host', false);

  // A bad link: the host's error shows inline.
  await page.getByTestId('scout-match-input').fill('https://www.faceit.com/en/cs2/room/bad');
  await page.getByTestId('scout-match-submit').click();
  await expect(page.getByTestId('scout-error')).toContainText('no match with that id');
  // A good link goes to the host as typed.
  const link = 'https://www.faceit.com/en/cs2/room/1-6c8c1b43-1234-4d9e-9e2f-1234567890ab';
  await page.getByTestId('scout-match-input').fill(link);
  await page.getByTestId('scout-match-submit').click();
  await expect.poll(calls).toContain('match:' + link);

  // The sample: cards, then the briefing on demand.
  await page.getByTestId('scout-sample').click();
  await expect(page.getByTestId('enemy-card')).toHaveCount(5);
  await expect(page.getByTestId('report-status')).toHaveAttribute('data-status', 'idle');
  await expect(page.getByTestId('things')).toHaveAttribute('data-source', 'data');
  await page.getByTestId('scout-run-report').click();
  await expect(page.getByTestId('report-status')).toHaveAttribute('data-status', 'running');
  await expect(page.getByTestId('report-status')).toContainText('writing the briefing');
  await expect(page.getByTestId('report-status')).toHaveAttribute('data-status', 'ready');
  await expect(page.getByTestId('report-summary')).toContainText('team_kappa averages');
  await expect(page.getByTestId('scout-run-report')).toHaveText('Run again');
  expect(await calls()).toEqual(['match:https://www.faceit.com/en/cs2/room/bad', 'match:' + link, 'sample', 'report']);

  // API keys in Settings: saved through the bridge, never echoed back.
  await page.evaluate(() => { location.hash = '#/settings'; });
  await expect(page.getByTestId('data-sources')).toBeVisible();
  await expect(page.getByTestId('source-claude')).toHaveAttribute('data-state', 'live');
  await expect(page.getByTestId('source-faceit')).toHaveAttribute('data-state', 'sample');
  await page.getByTestId('key-faceit').fill('fake-faceit-key-123');
  await page.getByTestId('key-faceit-save').click();
  await expect(page.getByTestId('key-faceit')).toHaveValue('');
  await expect(page.getByTestId('data-sources')).toContainText('Saved on this PC');
  await expect(page.getByTestId('data-sources')).not.toContainText('fake-faceit-key-123');
  expect((await calls()).slice(-1)).toEqual(['key:faceit:set']);
  await page.getByTestId('data-sources').screenshot({ path: path.join(SCREENS, 'settings-data-sources.png') });
  expect(errors).toEqual([]);
});

test('desktop host: your FACEIT nickname lists recent matches, one click scouts one', async ({ page }) => {
  const errors = watchErrors(page);
  const base: ScoutView = { ...EMPTY_SCOUT, sources: { faceit: 'live', steam: 'live', claude: 'live' } };
  const withAccount: ScoutView = {
    ...base,
    account: { nickname: 'rdx', status: 'ok', level: 9, elo: 2050 },
    recent: [
      { id: '1-00000000-0000-4000-8000-0000000000aa', status: 'ONGOING', live: true, vs: 'team_kappa', startedAt: Date.UTC(2026, 9, 21, 20) },
      { id: '1-00000000-0000-4000-8000-0000000000bb', status: 'FINISHED', live: false, won: true, vs: 'team_delta', startedAt: Date.UTC(2026, 9, 20, 21) },
    ],
  };
  await page.addInitScript(([base, withAccount]) => {
    type Cb = (x: unknown) => void;
    const calls: string[] = [];
    const cbs = new Set<Cb>();
    let current: unknown = base;
    const w = window as unknown as Record<string, unknown>;
    w.__calls = calls;
    const snap = { v: 1, seq: 1, at: Date.now(), scoreboard: [], ticker: [], connection: { gsi: 'waiting', payloads: 0, source: 'game', guardDropped: 0 } };
    w.csbot = {
      onSnapshot: (cb: Cb) => { cb(snap); return () => {}; },
      onScout: (cb: Cb) => { cbs.add(cb); cb(current); return () => cbs.delete(cb); },
      getInfo: async () => ({ version: '0.1.0', gsiUrl: 'http://127.0.0.1:47400', cfgStatus: 'current', recordingsDir: 'C:\csbot\recordings' }),
      installCfg: async () => ({ ok: true }), openRecordings: async () => {},
      scoutMatch: async (id: string) => { calls.push('match:' + id); return { ok: true }; },
      scoutSample: async () => {}, runScoutReport: async () => ({ ok: true }), setApiKey: async () => ({ ok: true }),
      setFaceitNickname: async (nick: string | null) => {
        calls.push('nick:' + nick);
        if (nick === 'nobody') return { ok: false, error: 'FACEIT has no player called "nobody".' };
        current = withAccount; for (const cb of cbs) cb(current); return { ok: true };
      },
    };
  }, [base, withAccount] as const);
  const calls = () => page.evaluate(() => (window as unknown as { __calls: string[] }).__calls);

  await page.goto('./#/scout');
  await expect(page.getByTestId('scout-empty')).toContainText('Add your FACEIT nickname');
  await page.evaluate(() => { location.hash = '#/settings'; });
  await expect(page.getByTestId('faceit-account')).toHaveAttribute('data-state', 'none');
  await page.getByTestId('faceit-nickname').fill('nobody');
  await page.getByTestId('faceit-nickname-save').click();
  await expect(page.getByTestId('data-sources')).toContainText('no player called "nobody"');
  await page.getByTestId('faceit-nickname').fill('rdx');
  await page.getByTestId('faceit-nickname-save').click();
  await expect(page.getByTestId('faceit-account')).toHaveAttribute('data-state', 'ok');
  await expect(page.getByTestId('faceit-account')).toContainText('rdx · lvl 9 · 2,050 ELO');

  await page.evaluate(() => { location.hash = '#/scout'; });
  const items = page.getByTestId('recent-match');
  await expect(items).toHaveCount(2);
  await expect(items.first()).toHaveAttribute('data-live', '1');
  await expect(items.first()).toContainText('LIVE');
  await expect(items.nth(1)).toContainText('vs team_delta');
  await shot(page, 'scout-recent', false);
  await items.nth(1).click();
  await expect.poll(calls).toContain('match:1-00000000-0000-4000-8000-0000000000bb');
  expect(await calls()).toEqual(['nick:nobody', 'nick:rdx', 'match:1-00000000-0000-4000-8000-0000000000bb']);
  expect(errors).toEqual([]);
});

test('desktop host: a guessed side says so, and Swap teams scouts from the other side', async ({ page }) => {
  const errors = watchErrors(page);
  const sources = { faceit: 'live', steam: 'live', claude: 'off' } as const;
  // A real FACEIT match where nothing identified the host (CS2 closed, no nickname saved): first team, a guess.
  const scout = (x: object) => scoutFaceitMatch({ faceit: sampleFaceit(), steam: sampleSteam(), sources }, { matchId: SAMPLE_MATCH_ID, platform: 'faceit', ...x });
  const guessed = await scout({});
  const swapped = await scout({ swap: true });
  expect(guessed.sideBy).toBe('guess');
  await page.addInitScript(([guessed, swapped]) => {
    type Cb = (x: unknown) => void;
    const calls: string[] = [];
    const cbs = new Set<Cb>();
    let current: unknown = guessed;
    const w = window as unknown as Record<string, unknown>;
    w.__calls = calls;
    const snap = { v: 1, seq: 1, at: Date.now(), scoreboard: [], ticker: [], connection: { gsi: 'waiting', payloads: 0, source: 'game', guardDropped: 0 } };
    w.csbot = {
      onSnapshot: (cb: Cb) => { cb(snap); return () => {}; },
      onScout: (cb: Cb) => { cbs.add(cb); cb(current); return () => cbs.delete(cb); },
      getInfo: async () => ({ version: '0.1.0', gsiUrl: 'http://127.0.0.1:47400', cfgStatus: 'current', recordingsDir: 'C:\csbot\recordings' }),
      installCfg: async () => ({ ok: true }), openRecordings: async () => {},
      scoutMatch: async () => ({ ok: true }), scoutSample: async () => {}, runScoutReport: async () => ({ ok: true }), setApiKey: async () => ({ ok: true }),
      scoutSwap: async () => { calls.push('swap'); current = current === guessed ? swapped : guessed; for (const cb of cbs) cb(current); return { ok: true }; },
    };
  }, [guessed, swapped] as const);
  const calls = () => page.evaluate(() => (window as unknown as { __calls: string[] }).__calls);

  await page.goto('./#/scout');
  const note = page.getByTestId('side-note');
  await expect(note).toContainText(`Is ${guessed.us.name} your team?`);
  await expect(note).toContainText('Settings → Data sources');
  await expect(page.getByTestId('versus')).toContainText(guessed.us.name);
  await shot(page, 'scout-side-guessed', false);
  await page.getByTestId('swap-sides').click();
  await expect.poll(calls).toEqual(['swap']);
  await expect(note).toContainText('You swapped the teams');
  await expect(page.locator('.vs-side').first()).toContainText(swapped.us.name);
  expect(swapped.us.name).not.toBe(guessed.us.name);
  expect(errors).toEqual([]);
});
