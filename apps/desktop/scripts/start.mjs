// Launch the desktop app. ELECTRON_RUN_AS_NODE is removed: when it's set (some IDE terminals set it),
// Electron runs as plain Node and no window ever opens.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [appDir, ...process.argv.slice(2)], { stdio: 'inherit', env, windowsHide: false });
child.on('exit', code => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill());
