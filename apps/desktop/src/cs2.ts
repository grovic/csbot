// Find CS2's cfg folder and install csbot's GSI cfg there. Pure Node: no Electron import.
// Only ever writes gamestate_integration_csbot.cfg, and only when the user clicks "Install".

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CFG_FILE_NAME } from '@csbot/gsi';

export const CS2_APP_ID = '730';
export const DEFAULT_STEAM_PATH = 'C:\\Program Files (x86)\\Steam';
const DEFAULT_INSTALL_DIR = 'Counter-Strike Global Offensive';

export type Vdf = { [key: string]: string | Vdf };

/** Minimal Valve KeyValues (VDF/ACF) parser: quoted keys/values, nested braces, // comments. */
export function parseVdf(text: string): Vdf {
  let i = 0;
  const n = text.length;
  const skip = () => {
    for (;;) {
      while (i < n && /\s/.test(text[i]!)) i++;
      if (text[i] === '/' && text[i + 1] === '/') { while (i < n && text[i] !== '\n') i++; continue; }
      break;
    }
  };
  const str = (): string => {
    if (text[i] !== '"') {
      // Unquoted token (rare in Steam files).
      const s = i;
      while (i < n && !/[\s{}"]/.test(text[i]!)) i++;
      return text.slice(s, i);
    }
    i++;
    let out = '';
    while (i < n && text[i] !== '"') {
      if (text[i] === '\\' && i + 1 < n) {
        const c = text[i + 1]!;
        out += c === 'n' ? '\n' : c === 't' ? '\t' : c;
        i += 2;
      } else out += text[i++];
    }
    i++;
    return out;
  };
  const obj = (): Vdf => {
    const o: Vdf = {};
    for (;;) {
      skip();
      if (i >= n) return o;
      if (text[i] === '}') { i++; return o; }
      const key = str();
      skip();
      if (text[i] === '{') { i++; o[key] = obj(); }
      else o[key] = str();
    }
  };
  return obj();
}

/** Library folder (Steam root of that library) that has the app installed. */
export function libraryForApp(libraryFolders: Vdf, appId = CS2_APP_ID): string | undefined {
  const root = (libraryFolders.libraryfolders ?? libraryFolders.LibraryFolders) as Vdf | undefined;
  if (!root || typeof root !== 'object') return undefined;
  for (const entry of Object.values(root)) {
    if (typeof entry !== 'object') continue;
    const apps = entry.apps;
    if (typeof entry.path === 'string' && apps && typeof apps === 'object' && appId in apps) return entry.path;
  }
  return undefined;
}

/** Steam's install path from the registry (HKCU\Software\Valve\Steam\SteamPath), Windows only. */
export function steamPathFromRegistry(): string | undefined {
  if (process.platform !== 'win32') return undefined;
  try {
    const out = execFileSync('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { encoding: 'utf8', timeout: 3000, windowsHide: true });
    const m = /SteamPath\s+REG_SZ\s+(.+)/i.exec(out);
    return m ? path.normalize(m[1]!.trim()) : undefined;
  } catch {
    return undefined;
  }
}

export interface Cs2Install {
  steamPath: string;
  libraryPath: string;
  /** ...\steamapps\common\Counter-Strike Global Offensive */
  cs2Path: string;
  /** ...\game\csgo\cfg: where GSI cfgs go. */
  cfgDir: string;
}

export interface DetectOptions {
  /** Skip the registry (tests). */
  steamPath?: string;
}

export function detectCs2(o: DetectOptions = {}): Cs2Install | undefined {
  const candidates = o.steamPath ? [o.steamPath] : [steamPathFromRegistry(), DEFAULT_STEAM_PATH].filter((p): p is string => !!p);
  for (const steamPath of candidates) {
    let libraryPath = steamPath;
    try {
      const lf = parseVdf(fs.readFileSync(path.join(steamPath, 'steamapps', 'libraryfolders.vdf'), 'utf8'));
      libraryPath = libraryForApp(lf) ?? steamPath;
    } catch { /* no libraryfolders.vdf: try the Steam root itself */ }
    let installDir = DEFAULT_INSTALL_DIR;
    try {
      const acf = parseVdf(fs.readFileSync(path.join(libraryPath, 'steamapps', `appmanifest_${CS2_APP_ID}.acf`), 'utf8'));
      const st = acf.AppState as Vdf | undefined;
      if (st && typeof st.installdir === 'string' && st.installdir) installDir = st.installdir;
    } catch { /* manifest missing: default folder name */ }
    const cs2Path = path.join(libraryPath, 'steamapps', 'common', installDir);
    const cfgDir = path.join(cs2Path, 'game', 'csgo', 'cfg');
    if (fs.existsSync(cfgDir)) return { steamPath, libraryPath, cs2Path, cfgDir };
  }
  return undefined;
}

export const cfgFilePath = (cfgDir: string) => path.join(cfgDir, CFG_FILE_NAME);

export function isCfgInstalled(cfgDir: string | undefined): boolean {
  return !!cfgDir && fs.existsSync(cfgFilePath(cfgDir));
}

/** missing / current (same text as `expected`) / outdated (endpoint or token changed). */
export function cfgStatus(cfgDir: string | undefined, expected: string): 'missing' | 'current' | 'outdated' {
  if (!cfgDir) return 'missing';
  let text: string;
  try { text = fs.readFileSync(cfgFilePath(cfgDir), 'utf8'); } catch { return 'missing'; }
  const norm = (t: string) => t.replace(/\r\n/g, '\n').trim();
  return norm(text) === norm(expected) ? 'current' : 'outdated';
}

/**
 * Write csbot's cfg into an existing CS2 cfg folder. Never creates the folder, never touches
 * any other file there (other apps' gamestate_integration_*.cfg stay as they are).
 */
export function installCfg(cfgDir: string, text: string): string {
  if (!fs.existsSync(cfgDir) || !fs.statSync(cfgDir).isDirectory()) throw new Error(`CS2 cfg folder not found: ${cfgDir}`);
  const file = cfgFilePath(cfgDir);
  fs.writeFileSync(file, text, 'utf8');
  return file;
}
