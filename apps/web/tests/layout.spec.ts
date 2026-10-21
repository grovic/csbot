// Phone and portrait screens (PROPOSAL §8: phone as second screen, portrait 1080×1920): every page
// fits the width (no sideways scrolling) and the key controls stay on screen.
import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCREENS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../screens');
const SIZES = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'portrait', width: 1080, height: 1920 },
] as const;
const PAGES = [
  { route: '#/live', query: '?at=live-5%2B2&pause=1', ready: 'banner' },
  { route: '#/scout', query: '', ready: 'scout-page' },
  { route: '#/debrief', query: '', ready: 'debrief' },
  { route: '#/coach', query: '?at=live-5%2B2&pause=1', ready: 'coach-chat' },
  { route: '#/room', query: '', ready: 'room-page' },
] as const;

for (const size of SIZES) {
  for (const p of PAGES) {
    test(`${size.name} ${size.width}×${size.height}: ${p.route} fits the width`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto(`./${p.query}${p.route}`);
      await expect(page.getByTestId(p.ready).first()).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(300);
      const overflow = await page.evaluate(() => {
        const w = document.documentElement.clientWidth;
        const wide = [...document.querySelectorAll<HTMLElement>('body *')]
          .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > w + 1 && !el.closest('.scroll-x') && getComputedStyle(el).position !== 'fixed'; })
          .slice(0, 5).map(el => `${el.tagName.toLowerCase()}.${el.className} ${Math.round(el.getBoundingClientRect().right)}px`);
        return { scroll: document.documentElement.scrollWidth - w, wide };
      });
      await page.screenshot({ path: path.join(SCREENS, `layout-${size.name}-${p.route.slice(2)}.png`) });
      expect(overflow.wide, `elements wider than the screen: ${overflow.wide.join(', ')}`).toEqual([]);
      expect(overflow.scroll).toBeLessThanOrEqual(1);
    });
  }
}
