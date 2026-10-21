// Renders the csbot mark (icon.svg, icon-fullbleed.svg) to every size the apps need, with headless
// Edge, and packs Windows .ico files. Run after changing the SVGs: node tools/brand/make-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const web = path.join(root, 'apps', 'web', 'public');
const desk = path.join(root, 'apps', 'desktop', 'assets');
fs.mkdirSync(desk, { recursive: true });

const svg = { tile: fs.readFileSync(path.join(here, 'icon.svg'), 'utf8'), full: fs.readFileSync(path.join(here, 'icon-fullbleed.svg'), 'utf8') };
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ deviceScaleFactor: 1 });

async function png(kind, size) {
  const src = 'data:image/svg+xml;base64,' + Buffer.from(svg[kind]).toString('base64');
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent"><img src="${src}" width="${size}" height="${size}" style="display:block"></body></html>`);
  await page.waitForFunction(() => document.images[0]?.complete);
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

/** ICO with PNG-compressed entries (Windows Vista and later read these at every size). */
function ico(images) {
  const head = Buffer.alloc(6 + 16 * images.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(size >= 256 ? 0 : size, e); head.writeUInt8(size >= 256 ? 0 : size, e + 1);
    head.writeUInt8(0, e + 2); head.writeUInt8(0, e + 3);
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(data.length, e + 8); head.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...images.map(i => i.data)]);
}

const out = (file, data) => { fs.writeFileSync(file, data); console.log(`${path.relative(root, file)}  ${data.length} B`); };
/** One page renders one size at a time (in parallel the sizes would race on the same page). */
const sizes = async (kind, list) => { const out = []; for (const size of list) out.push({ size, data: await png(kind, size) }); return out; };

// Web app (GitHub Pages and the Electron renderer).
fs.copyFileSync(path.join(here, 'icon.svg'), path.join(web, 'favicon.svg'));
out(path.join(web, 'favicon.ico'), ico(await sizes('tile', [16, 32, 48])));
out(path.join(web, 'apple-touch-icon.png'), await png('full', 180));
out(path.join(web, 'icon-192.png'), await png('tile', 192));
out(path.join(web, 'icon-512.png'), await png('tile', 512));
out(path.join(web, 'icon-maskable-512.png'), await png('full', 512));
// Desktop app (window, taskbar, shortcut, and the installer later).
out(path.join(desk, 'icon.ico'), ico(await sizes('tile', [16, 20, 24, 32, 40, 48, 64, 128, 256])));
out(path.join(desk, 'icon.png'), await png('tile', 512));
// A contact sheet to eyeball small sizes.
const sheet = await sizes('tile', [16, 24, 32, 48, 64, 128]);
await page.setViewportSize({ width: 420, height: 150 });
await page.setContent(`<body style="margin:0;padding:12px;background:#2b2f36;display:flex;gap:14px;align-items:flex-end">${sheet.map(s => `<img src="data:image/png;base64,${s.data.toString('base64')}" width="${s.size}" height="${s.size}">`).join('')}<div style="width:14px"></div>${sheet.slice(0, 3).map(s => `<img src="data:image/png;base64,${s.data.toString('base64')}" width="${s.size}" height="${s.size}" style="background:#f3f3f3">`).join('')}</body>`);
await page.screenshot({ path: path.join(here, 'contact-sheet.png') });
await browser.close();
