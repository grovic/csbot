// Install or remove a frozen copy of the current build for a real-match test on this PC.
//   node apps/desktop/scripts/playtest.ts install    (after building apps/web and apps/desktop)
//   node apps/desktop/scripts/playtest.ts uninstall
// install: copies the build to %LOCALAPPDATA%\csbot-playtest (so ongoing development never changes
// what the owner launches), writes csbot's GSI cfg into CS2's cfg folder (only that file), and puts a
// "csbot" shortcut on the desktop that starts the app with --metrics.
// uninstall: removes the shortcut, the cfg file and the copy. Recordings and settings in
// %APPDATA%\csbot stay (they hold the match data we want to look at).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';
import { gsiConfig } from '@csbot/gsi';
import { cfgFilePath, detectCs2, installCfg } from '../src/cs2.ts';
import { loadSettings } from '../src/settings.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const webDist = path.resolve(desktopDir, '..', 'web', 'dist');
const local = process.env.LOCALAPPDATA!, roaming = process.env.APPDATA!;
const target = path.join(local, 'csbot-playtest');
const userData = path.join(roaming, 'csbot'); // Electron's userData for productName "csbot"

function ps(script: string): string {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true }).trim();
}
const desktopFolder = () => ps('[Environment]::GetFolderPath("Desktop")');
const shortcutPath = () => path.join(desktopFolder(), 'csbot.lnk');

function portFree(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
  });
}

async function install(): Promise<void> {
  for (const f of [path.join(desktopDir, 'dist', 'main.cjs'), path.join(desktopDir, 'dist', 'preload.cjs'), path.join(webDist, 'index.html')]) {
    if (!fs.existsSync(f)) throw new Error(`missing build output ${f}: build apps/web and apps/desktop first`);
  }
  const cs2 = detectCs2();
  if (!cs2) throw new Error('CS2 not found');
  const settings = loadSettings(userData);
  if (!(await portFree(settings.gsiPort))) throw new Error(`port ${settings.gsiPort} is busy; close whatever uses it first`);

  // Frozen copy of the build.
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.join(target, 'desktop'), { recursive: true });
  fs.cpSync(path.join(desktopDir, 'dist'), path.join(target, 'desktop', 'dist'), { recursive: true });
  const pkg = JSON.parse(fs.readFileSync(path.join(desktopDir, 'package.json'), 'utf8')) as Record<string, unknown>;
  fs.writeFileSync(path.join(target, 'desktop', 'package.json'), JSON.stringify({ name: pkg.name, productName: pkg.productName, version: pkg.version, main: pkg.main }, null, 2) + '\n');
  fs.cpSync(webDist, path.join(target, 'web', 'dist'), { recursive: true });

  // csbot's GSI cfg (only this one file in CS2's cfg folder).
  const cfg = installCfg(cs2.cfgDir, gsiConfig({ uri: `http://127.0.0.1:${settings.gsiPort}`, token: settings.gsiToken }));

  // Desktop shortcut. Explorer doesn't carry ELECTRON_RUN_AS_NODE, so the shortcut can start Electron directly.
  const lnk = shortcutPath();
  const q = (s: string) => s.replace(/'/g, "''");
  ps([
    `$s = (New-Object -ComObject WScript.Shell).CreateShortcut('${q(lnk)}')`,
    `$s.TargetPath = '${q(String(electronPath))}'`,
    `$s.Arguments = '"${q(path.join(target, 'desktop'))}" --metrics'`,
    `$s.WorkingDirectory = '${q(path.join(target, 'desktop'))}'`,
    `$s.Description = 'csbot (playtest build)'`,
    `$s.Save()`,
  ].join('; '));

  console.log(`build copy  ${target}`);
  console.log(`GSI cfg     ${cfg}`);
  console.log(`shortcut    ${lnk}`);
  console.log(`user data   ${userData} (settings, recordings, metrics)`);
}

function uninstall(): void {
  const lnk = shortcutPath();
  fs.rmSync(lnk, { force: true });
  const cs2 = detectCs2();
  if (cs2) fs.rmSync(cfgFilePath(cs2.cfgDir), { force: true });
  fs.rmSync(target, { recursive: true, force: true });
  console.log(`removed ${lnk}, ${cs2 ? cfgFilePath(cs2.cfgDir) : '(CS2 not found)'} and ${target}`);
}

const cmd = process.argv[2];
if (cmd === 'install') await install();
else if (cmd === 'uninstall') uninstall();
else { console.error('usage: node apps/desktop/scripts/playtest.ts install|uninstall'); process.exit(2); }
