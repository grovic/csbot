// The Debrief page in the browser demo: the fictional match recorded by the real recorder, a
// fictional demo truth next to it, notes, and progress across (fictional) past matches.
import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCREENS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../screens');

test('demo debrief: result, rating, accuracy, money chart, deaths, rounds, progress', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto('./#/debrief');
  await expect(page.getByTestId('debrief')).toBeVisible();
  await expect(page.getByTestId('debrief-fictional')).toBeVisible();
  await expect(page.getByTestId('debrief-result')).toContainText(/(Win|Loss|Draw) \d+–\d+/);
  await expect(page.getByTestId('debrief-rating')).toContainText(/\d\.\d\d/);
  await expect(page.getByTestId('debrief-buyread')).toContainText(/\d+%/);
  await expect(page.getByTestId('debrief-siteread')).toContainText(/%|no plants/);
  await expect(page.getByTestId('workon').locator('li').first()).toBeVisible();
  await expect(page.getByTestId('enemy-money').locator('circle.truth').first()).toBeVisible();
  await expect(page.getByTestId('debrief-deaths')).toBeVisible();
  const rows = page.getByTestId('debrief-rounds').locator('tbody tr');
  expect(await rows.count()).toBeGreaterThan(15);
  await expect(page.getByTestId('demo-status')).toHaveAttribute('data-status', 'ready');
  await expect(page.getByTestId('match-row')).toHaveCount(7);
  await page.screenshot({ path: path.join(SCREENS, 'debrief.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('demo debrief follows the demo map', async ({ page }) => {
  await page.goto('./?map=de_dust2#/debrief');
  await expect(page.getByTestId('debrief-result')).toContainText('Dust II');
});
