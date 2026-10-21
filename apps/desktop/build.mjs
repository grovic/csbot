// Bundles the main process and the preload into dist/ (CommonJS, Electron's Node).
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
fs.rmSync(path.join(here, 'dist'), { recursive: true, force: true });

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: true,
  external: ['electron'],
  logLevel: 'warning',
};

await Promise.all([
  build({ ...common, entryPoints: [path.join(here, 'src/main.ts')], outfile: path.join(here, 'dist/main.cjs') }),
  // Sandboxed preload: only 'electron' may be required at runtime.
  build({ ...common, entryPoints: [path.join(here, 'src/preload.ts')], outfile: path.join(here, 'dist/preload.cjs') }),
]);
console.log('built apps/desktop/dist/{main,preload}.cjs');
