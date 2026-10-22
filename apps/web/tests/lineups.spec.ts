// Playbook → Lineups in the browser demo: csbot's starter lineups, editing one (drag, rename, an exact
// spot pasted from a practice server), a new one, the practice config download, and the utility line
// on the call card.
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCREENS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../screens');

test('lineups: edit, add, and download the practice config', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 1400, height: 1100 });
  await page.goto('./#/playbook');
  await page.getByTestId('pb-tab-lineups').click();
  const items = page.getByTestId('lu-item');
  expect(await items.count()).toBeGreaterThanOrEqual(5);
  await expect(page.getByTestId('lu-line')).toHaveCount(await items.count());
  await items.filter({ hasText: /^Window smoke/ }).click();

  // Drag where it lands.
  const land = page.locator('[data-testid="lu-line"][data-id="window"] [data-testid="lu-to"]');
  const before = await land.getAttribute('cx');
  const box = (await land.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 20, box.y + box.height / 2 + 12, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => land.getAttribute('cx')).not.toBe(before);

  await page.getByTestId('lu-name').fill('Window smoke (deep)');
  await page.getByTestId('lu-paste').fill('setpos 1216.031250 -211.968750 -159.968750;setang -48.000000 -144.500000 0.000000');
  await page.getByTestId('lu-paste-save').click();
  await expect(page.getByTestId('lu-exact')).toContainText('setpos 1216.03 -211.97 -159.97');

  await page.getByTestId('lu-new').click();
  await page.getByTestId('lu-name').fill('Our B fake smoke');
  await page.getByTestId('lu-kind-smoke').click();
  await page.getByTestId('lu-setup-tExecB').check();
  await expect(page.getByTestId('pb-save')).toHaveAttribute('data-state', 'saved');
  await page.screenshot({ path: path.join(SCREENS, 'lineups.png') });

  const dl = page.waitForEvent('download');
  await page.getByTestId('practice-download').click();
  const file = await (await dl).path();
  const cfg = fs.readFileSync(file, 'utf8');
  expect((await dl).suggestedFilename()).toBe('csbot_de_mirage.cfg');
  expect(cfg).toContain('sv_cheats 1');
  expect(cfg).toMatch(/alias lineup1 "setpos 1216.03 -211.97 -159.97; setang -48 -144.5 0; give weapon_smokegrenade; use weapon_smokegrenade; echo lineup1 Window smoke \(deep\) \(T\) - Jumpthrow"/);
  expect(cfg).toContain('Our B fake smoke (T)');
  // The browser can't write into CS2's folder.
  await expect(page.getByTestId('practice-install')).toHaveCount(0);

  // Reset: csbot's starter list again.
  await page.getByTestId('lu-reset').click();
  await expect(items.filter({ hasText: 'Our B fake smoke' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("the call lists its setup's utility", async ({ page }) => {
  await page.goto('./?speed=4#/live');
  await expect(page.getByTestId('call-utility')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('call-utility')).toContainText(/smoke|molotov|flash/i);
});
