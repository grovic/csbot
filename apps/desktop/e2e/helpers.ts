// Shared e2e helpers. Every app instance is hidden (this PC is the owner's gaming PC), has its own
// temp user data and a random GSI port, and is killed as a whole process tree afterwards.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import type { GsiPayload } from '@csbot/gsi';
import electronPath from 'electron';

export const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const webDist = path.resolve(appDir, '..', 'web', 'dist');
export const screens = path.join(appDir, 'screens');

export async function waitFor<T>(fn: () => T | undefined | null | false | Promise<T | undefined | null | false>, ms = 20_000, every = 100): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out');
    await new Promise(r => setTimeout(r, every));
  }
}

export interface Runtime { gsiUrl: string; token: string; pid: number }
export interface LaunchedApp { app: ElectronApplication; page: Page; dir: string; runtime: Runtime; close: () => Promise<void> }

/** Launch the built desktop app hidden, with its own temp user data and a random GSI port. */
export async function launchApp(extraEnv: Record<string, string> = {}): Promise<LaunchedApp> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csbot-e2e-'));
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  // A fake Steam root with no CS2 in it: detection never looks at the real game folder.
  fs.mkdirSync(path.join(dir, 'Steam'), { recursive: true });
  Object.assign(env, { CSBOT_HIDDEN: '1', CSBOT_USER_DATA: path.join(dir, 'userData'), CSBOT_GSI_PORT: '0', CSBOT_STEAM_PATH: path.join(dir, 'Steam'), CSBOT_KEY_CHECK: 'off' }, extraEnv);
  const app = await electron.launch({ executablePath: electronPath as unknown as string, args: [appDir], env });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  const rtFile = path.join(dir, 'userData', 'runtime.json');
  const runtime = await waitFor(() => (fs.existsSync(rtFile) ? JSON.parse(fs.readFileSync(rtFile, 'utf8')) as Runtime : undefined));
  const close = async () => {
    const pid = app.process().pid;
    const closed = await Promise.race([app.close().then(() => true, () => false), new Promise<boolean>(r => setTimeout(() => r(false), 10_000))]);
    if (!closed && pid) killTree(pid);
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  };
  return { app, page, dir, runtime, close };
}

/** Never leave Electron (or its GPU/utility children) running on the owner's PC. */
export function killTree(pid: number): void {
  try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* already gone */ }
}

export function postGsi(rt: Runtime, p: GsiPayload): Promise<Response> {
  return fetch(rt.gsiUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...p, auth: { token: rt.token } }) });
}

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.map': 'application/json' };

/** Minimal static server (the web build for browser members, probe pages). */
export async function serveDir(root: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    const file = path.join(root, rel.endsWith('/') ? rel + 'index.html' : rel);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}/`, close: () => new Promise<void>(r => server.close(() => r())) };
}

/**
 * Screenshot of a hidden app window. Playwright's screenshot can stall on a second hidden instance
 * (no frames get produced), so fall back to Electron's own capturePage.
 */
export async function shot(a: LaunchedApp, file: string): Promise<void> {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    await a.page.screenshot({ path: file, timeout: 8_000 });
  } catch {
    const b64 = await a.app.evaluate(async ({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]!;
      return (await w.webContents.capturePage()).toPNG().toString('base64');
    });
    fs.writeFileSync(file, Buffer.from(b64, 'base64'));
  }
}
