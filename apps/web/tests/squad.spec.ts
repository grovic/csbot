// Squad markers in a room (the demo room): planned spots, "on my spot", a rotation that moves along
// the route with a countdown. Positions are only what players report, never game data.
import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCREENS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../screens');

test('demo room: check in on my spot, then rotate to B with a countdown', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto('./?at=live-5%2B2&pause=1#/live');
  await expect(page.getByTestId('banner')).toHaveAttribute('data-phase', 'live');
  const you = page.getByTestId('marker-you');
  await expect(you).toHaveAttribute('data-state', 'planned');
  await expect(page.locator('[data-testid="marker"]')).toHaveCount(4);

  await page.getByTestId('checkin-spot').click();
  await expect(you).toHaveAttribute('data-state', 'spot');
  await expect(you).toContainText('on spot');

  // Paused demo: the host clock stands still, so the rotation shows its full countdown.
  await page.getByTestId('checkin-b').click();
  await expect(you).toHaveAttribute('data-state', 'rotating');
  await expect(you).toContainText(/→ B · \d+ s/);
  await page.getByTestId('map').screenshot({ path: path.join(SCREENS, 'squad-rotating.png') });
  expect(errors).toEqual([]);
});

test('check-ins wait for a round in progress', async ({ page }) => {
  await page.goto('./?at=over-3&pause=1#/live');
  await expect(page.getByTestId('banner')).toHaveAttribute('data-phase', 'over');
  await expect(page.getByTestId('checkin-spot')).toBeDisabled();
  await expect(page.getByTestId('checkin-spot')).toHaveAttribute('title', /round in progress/);
});
