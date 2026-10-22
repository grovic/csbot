// Renders the plugin's images (SVG below) to the PNG sizes Stream Deck wants, with headless Edge.
// Run once after changing a design: node scripts/icons.mjs (the PNGs are committed).
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'com.grovic.csbot.sdPlugin', 'imgs');
fs.mkdirSync(out, { recursive: true });

const BG = '#14171c';
const logo = (fg = '#14171c') => `
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd98a"/><stop offset="1" stop-color="#e3a01f"/></linearGradient></defs>
  <rect x="140" y="140" width="232" height="232" rx="34" fill="url(#g)" transform="rotate(45 256 256)"/>
  <rect x="206" y="206" width="100" height="100" rx="14" fill="${fg}" transform="rotate(45 256 256)"/>`;

// Glyphs on a 512 canvas.
const GLYPH = {
  intel: c => `<circle cx="256" cy="256" r="120" fill="none" stroke="${c}" stroke-width="36"/><circle cx="256" cy="256" r="34" fill="${c}"/><path d="M256 76v80M256 356v80M76 256h80M356 256h80" stroke="${c}" stroke-width="36" stroke-linecap="round"/>`,
  checkin: c => `<path d="M256 450s150-150 150-260a150 150 0 0 0-300 0c0 110 150 260 150 260z" fill="none" stroke="${c}" stroke-width="36" stroke-linejoin="round"/><circle cx="256" cy="192" r="52" fill="${c}"/>`,
  talk: c => `<rect x="186" y="66" width="140" height="240" rx="70" fill="${c}"/><path d="M130 236a126 126 0 0 0 252 0M256 362v80M190 446h132" fill="none" stroke="${c}" stroke-width="34" stroke-linecap="round"/>`,
  call: c => `<path d="M96 160h320M96 256h320M96 352h200" stroke="${c}" stroke-width="40" stroke-linecap="round"/>`,
};
const KEY_COLOR = { intel: '#f2bd4b', checkin: '#7fb0ef', talk: '#e5534b', call: '#a99cf0' };

const svg = (inner, viewBox = '0 0 512 512', bg) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="512" height="512">${bg ? `<rect width="512" height="512" fill="${bg}"/>` : ''}${inner}</svg>`;

const images = [
  // Plugin and category icons.
  { name: 'plugin', sizes: [256, 512], svg: svg(`<rect width="512" height="512" rx="96" fill="${BG}"/><g transform="translate(256 256) scale(1.25) translate(-256 -256)">${logo()}</g>`) },
  { name: 'category', sizes: [28, 56], svg: svg(`<rect x="140" y="140" width="232" height="232" rx="34" fill="none" stroke="#fff" stroke-width="44" transform="rotate(45 256 256)"/>`, '76 76 360 360') },
  // Action list icons: white on transparent.
  ...Object.keys(GLYPH).map(k => ({ name: k, sizes: [20, 40], svg: svg(GLYPH[k]('#fff')) })),
  // Key images: a dim glyph behind the title, the action's colour along the top.
  ...Object.keys(GLYPH).map(k => ({
    name: `${k}-key`, sizes: [72, 144],
    svg: svg(`<rect width="512" height="20" fill="${KEY_COLOR[k]}"/><g opacity="${k === 'talk' ? 0.9 : 0.22}" transform="${k === 'talk' ? 'translate(156 80) scale(0.39)' : 'translate(56 56) scale(0.78)'}">${GLYPH[k](KEY_COLOR[k])}</g>`, '0 0 512 512', BG),
  })),
];

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage();
for (const img of images) {
  for (const [i, size] of img.sizes.entries()) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:transparent">${img.svg.replace('width="512" height="512"', `width="${size}" height="${size}"`)}</body></html>`);
    const file = path.join(out, `${img.name}${i ? '@2x' : ''}.png`);
    await page.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  }
}
await browser.close();
console.log(`wrote ${images.length * 2} images to ${path.relative(process.cwd(), out)}`);
