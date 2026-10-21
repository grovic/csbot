// Host settings (userData/settings.json) and environment overrides. Pure Node: no Electron import.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_GSI_PORT = 47400;
const TOKEN_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

export interface Settings {
  gsiPort: number;
  /** Shared secret CS2 sends with every payload (written into csbot's GSI cfg). */
  gsiToken: string;
  /** Our playbook slot (e.g. 'a'), for the YOU line when not in a room. */
  playbookHandle?: string;
}

export function randomToken(n = 24): string {
  const bytes = crypto.randomBytes(n);
  let out = '';
  for (let i = 0; i < n; i++) out += TOKEN_ALPHABET[bytes[i]! % TOKEN_ALPHABET.length];
  return out;
}

const validToken = (t: unknown): t is string => typeof t === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(t);
const validPort = (p: unknown): p is number => typeof p === 'number' && Number.isInteger(p) && p > 0 && p < 65536;

/** Read settings.json from `dir`, filling in and persisting defaults on first run (or when invalid). */
export function loadSettings(dir: string): Settings {
  const file = path.join(dir, 'settings.json');
  let raw: Partial<Settings> = {};
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<Settings>; } catch { /* first run or unreadable */ }
  const s: Settings = {
    gsiPort: validPort(raw.gsiPort) ? raw.gsiPort : DEFAULT_GSI_PORT,
    gsiToken: validToken(raw.gsiToken) ? raw.gsiToken : randomToken(),
    ...(typeof raw.playbookHandle === 'string' && raw.playbookHandle ? { playbookHandle: raw.playbookHandle } : {}),
  };
  if (JSON.stringify(s) !== JSON.stringify(raw)) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(s, null, 2) + '\n');
  }
  return s;
}

export function saveSettings(dir: string, s: Settings): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(s, null, 2) + '\n');
}

export interface EnvConfig {
  /** CSBOT_USER_DATA: replaces Electron's userData dir (tests, measurements). */
  userData?: string;
  /** CSBOT_GSI_PORT: overrides the GSI port for this run only. 0 = random free port. */
  gsiPort?: number;
  /** CSBOT_HIDDEN=1: never show the window (tests and measurements on the owner's gaming PC). */
  hidden: boolean;
  /** CSBOT_WEB_URL: load the renderer from a dev server instead of apps/web/dist. */
  webUrl?: string;
  /** CSBOT_METRICS_FILE: append app.getAppMetrics() once per second as NDJSON (spike 8). */
  metricsFile?: string;
  /** CSBOT_STEAM_PATH: look for CS2 under this Steam root only (tests point it at a temp tree). */
  steamPath?: string;
  /**
   * CSBOT_SIGNAL: room signaling override (a self-hosted Trystero WebSocket relay, e.g. tests on
   * ws://127.0.0.1:PORT). Passed to the renderer as ?signal=. Default: public Nostr relays.
   */
  signal?: string;
}

/** Only wss:// anywhere, or ws:// on this machine (tests, a relay on the LAN host itself). */
export function validSignal(u: string | undefined): string | undefined {
  if (!u) return undefined;
  try {
    const url = new URL(u);
    if (url.protocol === 'wss:') return url.href;
    if (url.protocol === 'ws:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')) return url.href;
  } catch { /* invalid */ }
  return undefined;
}

export function readEnv(env: NodeJS.ProcessEnv = process.env): EnvConfig {
  const port = env.CSBOT_GSI_PORT !== undefined && env.CSBOT_GSI_PORT !== '' ? Number(env.CSBOT_GSI_PORT) : undefined;
  return {
    userData: env.CSBOT_USER_DATA || undefined,
    gsiPort: port !== undefined && Number.isInteger(port) && port >= 0 && port < 65536 ? port : undefined,
    hidden: env.CSBOT_HIDDEN === '1',
    webUrl: env.CSBOT_WEB_URL || undefined,
    metricsFile: env.CSBOT_METRICS_FILE || undefined,
    steamPath: env.CSBOT_STEAM_PATH || undefined,
    signal: validSignal(env.CSBOT_SIGNAL),
  };
}
