// Talks to the csbot desktop app's control API on this PC. csbot writes where it listens and its key to
// control.json in its own data folder while "Stream Deck" is on in its Settings; this reads the file
// on every call, so a restarted csbot (new port) is found again without setup.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Command, ControlState, Csbot } from './core.ts';

export function controlFile(env: NodeJS.ProcessEnv = process.env): string {
  if (env.CSBOT_CONTROL_FILE) return env.CSBOT_CONTROL_FILE;
  const appData = env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appData, 'csbot', 'control.json');
}

interface Control { url: string; token: string }

function readControl(file: string): Control | undefined {
  try {
    const c = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<Control>;
    // Only csbot on this PC.
    return typeof c.url === 'string' && /^http:\/\/127\.0\.0\.1:\d+$/.test(c.url) && typeof c.token === 'string' ? { url: c.url, token: c.token } : undefined;
  } catch { return undefined; }
}

export function csbotClient(file = controlFile()): Csbot {
  const call = async (method: 'GET' | 'POST', p: string, body?: unknown): Promise<Response | undefined> => {
    const c = readControl(file);
    if (!c) return undefined;
    return fetch(c.url + p, {
      method,
      headers: { authorization: `Bearer ${c.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(1500),
    }).catch(() => undefined);
  };
  return {
    async state() {
      const r = await call('GET', '/v1/state');
      return r?.ok ? (await r.json()) as ControlState : undefined;
    },
    async command(cmd: Command) {
      const r = await call('POST', '/v1/command', cmd);
      if (!r) return { ok: false, error: 'csbot is not running, or Stream Deck is off in its Settings.' };
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      return { ok: r.ok && j.ok !== false, ...(j.error ? { error: j.error } : {}) };
    },
  };
}
