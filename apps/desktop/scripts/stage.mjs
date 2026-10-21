// Stage a self-contained app folder for electron-builder (no pnpm symlinks, no workspace deps):
//   build/app/{package.json, dist/main.cjs, dist/preload.cjs, web/, assets/}
// main.cjs is an esbuild bundle of everything it needs (workspace packages and electron-updater),
// so the packaged app has no node_modules at all.
//   node scripts/stage.mjs        (after building apps/web)

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';

/** Node builtins (bundles may reference them without the node: prefix). */
const BUILTINS = new Set(builtinModules);

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, '..');
const webDist = path.resolve(desktop, '..', 'web', 'dist');
const out = path.join(desktop, 'build', 'app');

if (!fs.existsSync(path.join(webDist, 'index.html'))) throw new Error('build apps/web first (pnpm --filter @csbot/web build)');
execFileSync(process.execPath, [path.join(desktop, 'build.mjs')], { stdio: 'inherit' });

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'dist'), { recursive: true });
for (const f of ['main.cjs', 'preload.cjs', 'demo-worker.cjs']) fs.copyFileSync(path.join(desktop, 'dist', f), path.join(out, 'dist', f));

// The demo parser is a native module (prebuilt per platform): stage its package and the Windows binary.
const { createRequire } = await import('node:module');
const parserDir = fs.realpathSync(path.dirname(createRequire(path.join(desktop, 'package.json')).resolve('@laihoe/demoparser2/package.json')));
// The platform binary is the parser's own optional dependency (pnpm keeps it next to the parser).
const binDir = fs.realpathSync(path.dirname(createRequire(path.join(parserDir, 'package.json')).resolve('@laihoe/demoparser2-win32-x64-msvc/package.json')));
// Only what loads at runtime: the loader (index.js, package.json) and the binary right next to it,
// which the loader tries first (electron-builder drops the separate platform package).
const parserOut = path.join(out, 'native', 'demoparser2');
fs.mkdirSync(parserOut, { recursive: true });
for (const f of ['index.js', 'package.json']) fs.copyFileSync(path.join(parserDir, f), path.join(parserOut, f));
const bin = fs.readdirSync(binDir).find(f => f.endsWith('.node'));
if (!bin) throw new Error('demo parser binary missing');
fs.copyFileSync(path.join(binDir, bin), path.join(parserOut, bin));
fs.cpSync(webDist, path.join(out, 'web'), { recursive: true });
fs.cpSync(path.join(desktop, 'assets'), path.join(out, 'assets'), { recursive: true });

const pkg = JSON.parse(fs.readFileSync(path.join(desktop, 'package.json'), 'utf8'));
fs.writeFileSync(path.join(out, 'package.json'), JSON.stringify({
  name: 'csbot', productName: pkg.productName, version: pkg.version, main: 'dist/main.cjs',
  description: 'Second-screen companion for Counter-Strike 2 squads', author: 'csbot', license: 'UNLICENSED',
}, null, 2) + '\n');

// The bundle must not need anything at runtime besides Electron itself.
const main = fs.readFileSync(path.join(out, 'dist', 'main.cjs'), 'utf8');
const requires = [...new Set([...main.matchAll(/require\("([^".][^"]*)"\)/g)].map(m => m[1]))]
  .filter(r => !r.startsWith('node:') && !BUILTINS.has(r) && r !== 'electron');
if (requires.length) throw new Error(`main.cjs still requires ${requires.join(', ')}: bundle them or stage them`);
console.log(`staged ${path.relative(desktop, out)} (csbot ${pkg.version})`);

