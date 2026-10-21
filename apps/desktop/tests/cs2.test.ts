import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CFG_FILE_NAME, gsiConfig } from '@csbot/gsi';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectCs2, installCfg, isCfgInstalled, libraryForApp, parseVdf } from '../src/cs2.ts';

const LIBRARY_VDF = `"libraryfolders"
{
\t"0"
\t{
\t\t"path"\t\t"STEAM_ROOT"
\t\t"label"\t\t""
\t\t"apps"
\t\t{
\t\t\t"228980"\t\t"512648667"
\t\t}
\t}
\t"1"
\t{
\t\t"path"\t\t"LIB2"
\t\t// a comment
\t\t"apps"
\t\t{
\t\t\t"730"\t\t"76027351245"
\t\t}
\t}
}
`;

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'csbot-cs2-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const esc = (p: string) => p.replace(/\\/g, '\\\\');

/** A fake Steam tree: Steam root + a second library that holds CS2. */
function fakeSteam(opts: { installdir?: string } = {}) {
  const steam = path.join(tmp, 'Steam'), lib2 = path.join(tmp, 'Games', 'SteamLibrary');
  fs.mkdirSync(path.join(steam, 'steamapps'), { recursive: true });
  fs.writeFileSync(path.join(steam, 'steamapps', 'libraryfolders.vdf'), LIBRARY_VDF.replace('STEAM_ROOT', esc(steam)).replace('LIB2', esc(lib2)));
  const dir = opts.installdir ?? 'Counter-Strike Global Offensive';
  if (opts.installdir) {
    fs.mkdirSync(path.join(lib2, 'steamapps'), { recursive: true });
    fs.writeFileSync(path.join(lib2, 'steamapps', 'appmanifest_730.acf'), `"AppState"\n{\n\t"appid"\t\t"730"\n\t"installdir"\t\t"${dir}"\n}\n`);
  }
  const cfgDir = path.join(lib2, 'steamapps', 'common', dir, 'game', 'csgo', 'cfg');
  fs.mkdirSync(cfgDir, { recursive: true });
  return { steam, lib2, cfgDir };
}

describe('VDF parsing', () => {
  it('parses nested keys, escaped backslashes and comments', () => {
    const v = parseVdf(LIBRARY_VDF.replace('STEAM_ROOT', 'C:\\\\Program Files (x86)\\\\Steam').replace('LIB2', 'D:\\\\SteamLibrary'));
    const root = v.libraryfolders as Record<string, Record<string, unknown>>;
    expect(root['0']!.path).toBe('C:\\Program Files (x86)\\Steam');
    expect(libraryForApp(v)).toBe('D:\\SteamLibrary');
    expect(libraryForApp(v, '999')).toBeUndefined();
  });
});

describe('CS2 detection', () => {
  it('finds CS2 in a secondary library', () => {
    const { steam, lib2, cfgDir } = fakeSteam();
    const found = detectCs2({ steamPath: steam })!;
    expect(found.libraryPath).toBe(lib2);
    expect(found.cfgDir).toBe(cfgDir);
  });

  it('follows the installdir from the app manifest', () => {
    const { steam, cfgDir } = fakeSteam({ installdir: 'CS2 Custom' });
    expect(detectCs2({ steamPath: steam })!.cfgDir).toBe(cfgDir);
  });

  it('returns undefined when CS2 is missing', () => {
    expect(detectCs2({ steamPath: path.join(tmp, 'nowhere') })).toBeUndefined();
  });
});

describe('cfg install', () => {
  it('writes only csbot\'s cfg and leaves other GSI cfgs untouched', () => {
    const { cfgDir } = fakeSteam();
    const other = path.join(cfgDir, 'gamestate_integration_logitech.cfg');
    fs.writeFileSync(other, '"logitech" {}');
    const before = fs.statSync(other).mtimeMs;
    expect(isCfgInstalled(cfgDir)).toBe(false);
    const file = installCfg(cfgDir, gsiConfig({ uri: 'http://127.0.0.1:47400', token: 'tok_abcdefgh' }));
    expect(path.basename(file)).toBe(CFG_FILE_NAME);
    expect(isCfgInstalled(cfgDir)).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toContain('"token"   "tok_abcdefgh"');
    expect(fs.readFileSync(other, 'utf8')).toBe('"logitech" {}');
    expect(fs.statSync(other).mtimeMs).toBe(before);
    expect(fs.readdirSync(cfgDir).sort()).toEqual([CFG_FILE_NAME, 'gamestate_integration_logitech.cfg'].sort());
  });

  it('never creates a missing cfg folder', () => {
    const missing = path.join(tmp, 'no', 'cfg');
    expect(() => installCfg(missing, 'x')).toThrow(/not found/);
    expect(fs.existsSync(missing)).toBe(false);
  });
});
