// Premier scouting end to end in the hidden desktop app (no API keys, so nothing leaves the PC): the host
// pastes a console `status`, csbot lists the players with the host on our side, the host sorts four
// teammates, and the other five become the opponents. All players are fictional.

import path from 'node:path';
import { expect, test } from '@playwright/test';
import { FIRST_HALF, syntheticMatch } from '@csbot/gsi';
import { launchApp, postGsi, screens, shot, type LaunchedApp } from './helpers.ts';

test.describe.configure({ mode: 'serial' });
let app: LaunchedApp;

const BASE = 76561197960265728n;
const PLAYERS = [
  ['76561198000000001', 'rdx'], ['76561198000000002', 'kairo'], ['76561198000000003', 'nyx'], ['76561198000000004', 'mbt'], ['76561198000000005', 'zeph'],
  ['76561198000000011', 'Holo'], ['76561198000000012', 'sk1p'], ['76561198000000013', 'vex'], ['76561198000000014', 'Drift'], ['76561198000000015', 'Okami'],
] as const;
const STATUS = [
  'hostname: Valve Counter-Strike 2 eu_west Server', 'map     : de_mirage', '---------players--------', '  id     time ping loss      state   rate adr name',
  ...PLAYERS.map(([id, n], i) => `  ${i + 2}    03:1${i}   25    0     active 786432 [U:1:${BigInt(id) - BASE}] '${n}'`), '#end',
].join('\n');

test.beforeAll(async () => {
  app = await launchApp();
  // The host's CS2 is in a match: csbot knows the host's Steam ID.
  const rec = syntheticMatch({ rounds: FIRST_HALF.slice(0, 1), lean: true });
  for (const r of rec.slice(0, 3)) expect((await postGsi(app.runtime, r.p)).status).toBe(200);
});
test.afterAll(async () => { await app?.close(); });

test('the host pastes status, sorts four teammates, and the other five are the opponents', async () => {
  const p = app.page;
  await p.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: 'Scout' }).click();
  await p.getByTestId('status-input').fill('nothing useful');
  await p.getByTestId('status-submit').click();
  await expect(p.getByTestId('status-error')).toContainText('No players found');

  await p.getByTestId('status-input').fill(STATUS);
  await p.getByTestId('status-submit').click();
  await expect(p.getByTestId('unsorted-row')).toHaveCount(9, { timeout: 15_000 });
  await expect(p.getByTestId('versus')).toContainText('Premier · from status');
  await expect(p.getByTestId('our-card')).toHaveCount(1); // the host, from their own GSI
  await expect(p.getByTestId('unsorted')).toContainText('1 of 5 known');
  await expect(p.getByTestId('unsorted-row').first()).toContainText('FACEIT not checked');
  await shot(app, path.join(screens, 'desktop-premier-sort.png'));
  for (const n of ['kairo', 'nyx', 'mbt']) await p.getByTestId('unsorted-row').filter({ hasText: n }).getByTestId('mark-us').click();
  await expect(p.getByTestId('unsorted-row')).toHaveCount(6);
  await p.getByTestId('unsorted-row').filter({ hasText: 'zeph' }).getByTestId('mark-us').click();

  // Five on our side: the rest are the opponents.
  await expect(p.getByTestId('unsorted')).toHaveCount(0);
  await expect(p.getByTestId('enemy-card')).toHaveCount(5);
  await expect(p.getByTestId('our-card')).toHaveCount(5);
  // No keys: names are all csbot has, so no ranking facts and no briefing written from them.
  await expect(p.getByTestId('things')).toHaveCount(0);
  await expect(p.getByTestId('report-status')).toHaveAttribute('data-status', 'idle');
  await p.getByTestId('scout-run-report').click();
  await expect(p.getByTestId('report-refusal')).toContainText('Nothing to brief from yet');
  await shot(app, path.join(screens, 'desktop-premier.png'));

  // A mistake: move one back to the opponents' side.
  await p.getByTestId('our-card').filter({ hasText: 'zeph' }).getByTestId('move-them').click();
  await expect(p.getByTestId('our-card')).toHaveCount(4);
  await expect(p.getByTestId('unsorted-row')).toHaveCount(5);
});
