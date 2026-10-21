// Host settings (userData/settings.json) and environment overrides. Pure Node: no Electron import.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_COACH_CONFIG, type CoachConfig } from '@csbot/protocol';

export const DEFAULT_GSI_PORT = 47400;
const TOKEN_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

export interface Settings {
  gsiPort: number;
  /** Shared secret CS2 sends with every payload (written into csbot's GSI cfg). */
  gsiToken: string;
  /** Our playbook slot (e.g. 'a'), for the YOU line when not in a room. */
  playbookHandle?: string;
  /** The host's FACEIT nickname (public), for recent matches and live-match detection. */
  faceitNickname?: string;
  /** Live coach (M5): model, budget, quotas. Defaults from DEFAULT_COACH_CONFIG. */
  coach?: CoachConfig;
  /** Numpad intel hotkeys (M4a). Off unless the user turns them on: they take the keys from the game. */
  intelHotkeys?: boolean;
  /** This PC's player, remembered from CS2's own data (matches demos to "us" when CS2 is closed). */
  steamId?: string;
}

/** A stored coach config, field by field (anything invalid falls back to the default). */
export function coachConfigFrom(raw: unknown): CoachConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<CoachConfig>;
  const d = DEFAULT_COACH_CONFIG;
  const int = (v: unknown, lo: number, hi: number, def: number) => (typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : def);
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : d.enabled,
    model: r.model === 'sonnet' || r.model === 'haiku' || r.model === 'opus' ? r.model : d.model,
    effort: r.effort === 'low' || r.effort === 'medium' || r.effort === 'high' ? r.effort : d.effort,
    callBudget: int(r.callBudget, 1, 200, d.callBudget),
    memberQuota: int(r.memberQuota, 0, 50, d.memberQuota),
    postPlant: typeof r.postPlant === 'boolean' ? r.postPlant : d.postPlant,
  };
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
    ...(typeof raw.faceitNickname === 'string' && raw.faceitNickname.trim() ? { faceitNickname: raw.faceitNickname.trim().slice(0, 32) } : {}),
    ...(raw.coach !== undefined ? { coach: coachConfigFrom(raw.coach) } : {}),
    ...(raw.intelHotkeys === true ? { intelHotkeys: true } : {}),
    ...(typeof raw.steamId === 'string' && /^7656\d{13}$/.test(raw.steamId) ? { steamId: raw.steamId } : {}),
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
  /** CSBOT_COACH=off: start with the live coach turned off for this run (tests), without saving it. */
  coachOff: boolean;
  /**
   * CSBOT_FAKE_HOTKEYS=1 (and every hidden run): intel hotkeys use a recording stand-in instead of
   * Electron's globalShortcut, so tests never take the numpad from the owner's game.
   */
  fakeHotkeys: boolean;
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
    coachOff: env.CSBOT_COACH === 'off',
    fakeHotkeys: env.CSBOT_FAKE_HOTKEYS === '1' || env.CSBOT_HIDDEN === '1',
  };
}
