// Wingman in the browser demo (?mode=wingman): a 2v2 match with 8-round halves. No five-player site
// forecast (one site), money calls, and a room of two positions.
import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCREENS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../screens');

test('Wingman demo: mode, two positions, no site forecast, money calls', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 1400, height: 950 });
  await page.goto('./?mode=wingman&map=de_inferno&at=live-3&pause=1#/live');
  await expect(page.getByTestId('scorebox')).toContainText('Inferno · Wingman');
  await expect(page.getByTestId('tile-hit')).toContainText('Wingman: one site, no site forecast');
  await expect(page.getByTestId('call-head')).not.toHaveText('');
  await expect(page.getByTestId('map-note')).toContainText('Wingman: one site, no forecast');
  await page.screenshot({ path: path.join(SCREENS, 'wingman.png') });
  await page.goto('./?mode=wingman&map=de_inferno&at=live-3&pause=1#/room');
  // Two players, two positions to pick from.
  await expect(page.getByTestId('slot-select')).toHaveCount(2);
  await expect(page.getByTestId('slot-select').first().locator('option')).toHaveText(['no slot', 'Player 1', 'Player 2']);
  expect(errors).toEqual([]);
});
