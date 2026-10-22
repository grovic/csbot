// The Playbook page in the browser demo: the team's own setups (rename, call text, drag a spot) and an
// anti-strat for the scouted opponent. The demo keeps them in this browser and runs on them.
import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCREENS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../screens');

test('our plays: edit a setup, drag a spot, and it sticks after a reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto('./#/playbook');
  await expect(page.getByTestId('playbook')).toBeVisible();
  await expect(page.getByTestId('pb-map')).toHaveAttribute('data-map', 'de_mirage');
  await expect(page.getByTestId('pb-spot')).toHaveCount(5);
  await page.getByTestId('pb-setup').filter({ hasText: 'Standard' }).click();
  await page.getByTestId('pb-name').fill('Our 3-A');
  await page.getByTestId('pb-call-head').fill('Stack A · three on A');
  await page.getByTestId('pb-job-b').fill('Hold B alone, fall back to the arch');
  await expect(page.getByTestId('pb-save')).toHaveAttribute('data-state', 'saved');

  // Drag the B anchor's spot somewhere else on the floor.
  const spot = page.locator('[data-testid="pb-spot"][data-player="b"] circle');
  const before = await spot.getAttribute('cx');
  const box = (await spot.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 25, box.y + box.height / 2 + 10, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => spot.getAttribute('cx')).not.toBe(before);
  await expect(page.getByTestId('pb-save')).toHaveAttribute('data-state', 'saved');
  await page.screenshot({ path: path.join(SCREENS, 'playbook.png') });

  await page.reload();
  await page.getByTestId('pb-setup').filter({ hasText: 'Our 3-A' }).click();
  await expect(page.getByTestId('pb-call-head')).toHaveValue('Stack A · three on A');
  await expect(page.getByTestId('pb-job-b')).toHaveValue('Hold B alone, fall back to the arch');
  // Back to csbot's playbook.
  await page.getByTestId('pb-reset').click();
  await expect(page.getByTestId('pb-setup').filter({ hasText: 'Our 3-A' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('anti-strat: their tendencies move the odds, and it can be put in use', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto('./#/playbook');
  await page.getByTestId('pb-tab-anti').click();
  await page.getByTestId('as-new').click();
  // Named after the scouted opponent (the demo's fictional sample match).
  await expect(page.getByTestId('as-name')).not.toHaveValue('');
  const preview = page.getByTestId('as-preview');
  const full = async () => Number(/→ (\d+)%/.exec((await preview.textContent()) ?? '')?.[1]);
  const b0 = await full();
  await page.getByTestId('as-t-bRush-mostly').click();
  await page.getByTestId('as-t-aExec-never').click();
  await page.getByTestId('as-t-split-never').click();
  await expect.poll(full).toBeGreaterThan(b0);
  await page.getByTestId('as-answer-full').selectOption('antieco');
  await page.getByTestId('as-notes').fill('They rush B apps on every buy. Stack B early.');
  await page.getByTestId('as-active').check();
  await expect(page.getByTestId('pb-tab-anti')).toContainText('•');
  await expect(page.getByTestId('pb-save')).toHaveAttribute('data-state', 'saved');
  await page.screenshot({ path: path.join(SCREENS, 'antistrat.png') });
  await page.reload();
  await page.getByTestId('pb-tab-anti').click();
  await expect(page.getByTestId('as-active')).toBeChecked();
  await expect(page.getByTestId('as-notes')).toHaveValue(/rush B apps/);
  await page.getByTestId('as-delete').click();
  await expect(page.getByTestId('as-item')).toHaveCount(0);
  expect(errors).toEqual([]);
});
