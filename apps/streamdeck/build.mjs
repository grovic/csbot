// Bundles the plugin into com.grovic.csbot.sdPlugin/bin/plugin.js (ws included) and packs the folder
// into dist/com.grovic.csbot.streamDeckPlugin, the file users double-click to install the plugin.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const folder = 'com.grovic.csbot.sdPlugin';
const root = path.join(here, folder);

// The plugin's version follows the desktop app's.
const version = JSON.parse(fs.readFileSync(path.join(here, '..', 'desktop', 'package.json'), 'utf8')).version;
const manifestFile = path.join(root, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
if (manifest.Version !== `${version}.0`) {
  manifest.Version = `${version}.0`;
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
}

await build({
  entryPoints: [path.join(here, 'src/plugin.ts')],
  outfile: path.join(root, 'bin/plugin.js'),
  bundle: true, platform: 'node', format: 'cjs', target: 'node20', logLevel: 'warning',
  // ws's optional native speedups: absent is fine.
  external: ['bufferutil', 'utf-8-validate'],
});

// The bundle is CommonJS: say so next to it, whatever package.json sits above the plugin folder.
fs.writeFileSync(path.join(root, 'bin', 'package.json'), JSON.stringify({ type: 'commonjs' }) + '\n');

// Every file under the folder, with forward slashes, inside the folder name.
const files = [];
const walk = dir => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else files.push(p);
  }
};
walk(root);
const { zip } = await import('./src/zip.ts');
const pkg = zip(files.sort().map(f => ({ name: `${folder}/${path.relative(root, f).split(path.sep).join('/')}`, data: fs.readFileSync(f) })));
fs.mkdirSync(path.join(here, 'dist'), { recursive: true });
fs.writeFileSync(path.join(here, 'dist', 'com.grovic.csbot.streamDeckPlugin'), pkg);
console.log(`built ${folder}/bin/plugin.js and dist/com.grovic.csbot.streamDeckPlugin (${files.length} files, ${Math.round(pkg.length / 1024)} KB)`);
