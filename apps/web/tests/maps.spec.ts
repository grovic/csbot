// Every map in the pool renders from its real geometry: floor, callouts, planned spots, the forecast
// heat on CT, and intel clicks anywhere inside a zone.
import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAP_POOL } from '@csbot/engine';

const SCREENS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../screens');

for (const map of MAP_POOL) {
  test(`${map}: real map, callouts, forecast and a click-anywhere zone`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.goto(`./?map=${map}&at=live-5%2B2&pause=1#/live`);
    await expect(page.getByTestId('banner')).toHaveAttribute('data-phase', 'live');
    await expect(page.getByTestId('map-floor')).toHaveAttribute('data-map', map);
    await expect(page.locator('.zlabel.site')).toHaveCount(2);
    await expect(page.getByTestId('heat')).toBeVisible();
    await expect(page.getByTestId('forecast-basis')).toHaveAttribute('data-basis', 'prior');
    await expect(page.getByTestId('marker-you')).toBeVisible();
    // A click in the middle of the B site opens intel for B.
    const box = (await page.locator('[data-testid="map-zone"][data-zone="bsite"]').boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2 + 6);
    await expect(page.getByTestId('intel-pop')).toContainText('Enemies at B Site');
    await page.keyboard.press('Escape');
    await page.getByTestId('map').screenshot({ path: path.join(SCREENS, `map-${map}.png`) });
    expect(errors).toEqual([]);
  });
}
