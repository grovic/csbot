import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { FIRST_HALF, syntheticMatch, type GsiPayload } from '@csbot/gsi';
import type { CsbotBridge, LiveSnapshot } from '@csbot/protocol';
import electronPath from 'electron';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const screens = path.join(appDir, 'screens');

let tmp: string, steam: string, cfgDir: string;
let app: ElectronApplication, page: Page;
let runtime: { gsiUrl: string; token: string; pid: number };

declare global { interface Window { __snaps: LiveSnapshot[]; csbot?: CsbotBridge } }

/** Fake Steam tree so CS2 detection (and a cfg install) never touch the real game folder. */
function fakeSteam(root: string) {
  const s = path.join(root, 'Steam');
  fs.mkdirSync(path.join(s, 'steamapps'), { recursive: true });
  fs.writeFileSync(path.join(s, 'steamapps', 'libraryfolders.vdf'),
    `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${s.split(path.sep).join('\\\\')}"\n\t\t"apps"\n\t\t{\n\t\t\t"730"\t\t"1"\n\t\t}\n\t}\n}\n`);
  const cfg = path.join(s, 'steamapps', 'common', 'Counter-Strike Global Offensive', 'game', 'csgo', 'cfg');
  fs.mkdirSync(cfg, { recursive: true });
  fs.writeFileSync(path.join(cfg, 'gamestate_integration_logitech.cfg'), '"logitech" {}');
  return { steam: s, cfgDir: cfg };
}

async function waitFor<T>(fn: () => T | undefined | Promise<T | undefined>, ms = 15_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out');
    await new Promise(r => setTimeout(r, 100));
  }
}

const post = (p: GsiPayload) =>
  fetch(runtime.gsiUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...p, auth: { token: runtime.token } }) });

test.beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'csbot-e2e-'));
  ({ steam, cfgDir } = fakeSteam(tmp));
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  Object.assign(env, { CSBOT_HIDDEN: '1', CSBOT_USER_DATA: path.join(tmp, 'userData'), CSBOT_GSI_PORT: '0', CSBOT_STEAM_PATH: steam });
  app = await electron.launch({ executablePath: electronPath as unknown as string, args: [appDir], env });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  const rtFile = path.join(tmp, 'userData', 'runtime.json');
  runtime = await waitFor(() => (fs.existsSync(rtFile) ? JSON.parse(fs.readFileSync(rtFile, 'utf8')) : undefined));
});

test.afterAll(async () => {
  if (app) {
    const pid = app.process().pid;
    const closed = await Promise.race([app.close().then(() => true), new Promise<boolean>(r => setTimeout(() => r(false), 10_000))]);
    // Never leave Electron (or its GPU/utility children) running on the owner's PC.
    if (!closed && pid) try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F']); } catch { /* already gone */ }
  }
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
});

test('never shows a window and keeps Node out of the renderer', async () => {
  const visible = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(w => w.isVisible()));
  expect(visible).toEqual([false]);
  const exposed = await page.evaluate(() => ({ require: typeof (window as unknown as { require?: unknown }).require, process: typeof (window as unknown as { process?: unknown }).process, csbot: typeof window.csbot }));
  expect(exposed).toEqual({ require: 'undefined', process: 'undefined', csbot: 'object' });
});

test('GSI payloads reach the renderer as snapshots', async () => {
  await page.evaluate(() => { window.__snaps = []; window.csbot!.onSnapshot(s => window.__snaps.push(s)); });
  const rec = syntheticMatch({ rounds: FIRST_HALF.slice(0, 5), lean: true });
  // Everything up to round 5's freeze time: rounds 1-4 played (won, won, lost, won).
  const upTo = rec.findIndex(r => r.p.map?.round === 4 && r.p.round?.phase === 'freezetime') + 2;
  for (const r of rec.slice(0, upTo)) expect((await post(r.p)).status).toBe(200);
  const last = await waitFor(() => page.evaluate(n => {
    const s = window.__snaps[window.__snaps.length - 1];
    return s && s.connection.payloads === n ? s : undefined;
  }, upTo));
  expect(last.connection.gsi).toBe('live');
  expect(last.match?.map).toBe('de_mirage');
  expect(last.match?.round).toBe(5);
  expect(last.match?.clock.phase).toBe('freezetime');
  expect(last.match?.score).toEqual({ us: 3, them: 1 });
  expect(last.call?.kind).toBe('pre');
  expect(last.me?.name).toBe('rdx');

  // The real web build renders it (score box test ids from apps/web).
  await expect(page.getByTestId('score-us')).toHaveText('3');
  await expect(page.getByTestId('score-them')).toHaveText('1');
  await expect(page.getByTestId('banner')).toHaveAttribute('data-phase', 'freezetime');
  await expect(page.getByTestId('call-head')).not.toBeEmpty();
  await page.waitForTimeout(400);
  fs.mkdirSync(screens, { recursive: true });
  await page.screenshot({ path: path.join(screens, 'desktop-live.png') });
});

test('host info and cfg install go through the bridge, into the detected folder only', async () => {
  const info = await page.evaluate(() => window.csbot!.getInfo());
  expect(info.gsiUrl).toBe(runtime.gsiUrl);
  expect(info.cs2Path).toBe(path.dirname(path.dirname(path.dirname(cfgDir))));
  expect(info.cfgStatus).toBe('missing');
  expect(info.cfgPath).toBe(path.join(cfgDir, 'gamestate_integration_csbot.cfg'));
  const res = await page.evaluate(() => window.csbot!.installCfg());
  expect(res.ok).toBe(true);
  expect(res.path).toBe(path.join(cfgDir, 'gamestate_integration_csbot.cfg'));
  const cfg = fs.readFileSync(res.path!, 'utf8');
  expect(cfg).toContain(`"uri"       "${runtime.gsiUrl}"`);
  expect(cfg).toContain(`"token"   "${runtime.token}"`);
  expect(cfg).not.toMatch(/allplayers|allgrenades|"bomb"/);
  expect(fs.readFileSync(path.join(cfgDir, 'gamestate_integration_logitech.cfg'), 'utf8')).toBe('"logitech" {}');
  expect((await page.evaluate(() => window.csbot!.getInfo())).cfgStatus).toBe('current');
  // A cfg pointing at another endpoint (old port or token) shows as outdated.
  fs.writeFileSync(res.path!, cfg.replace(runtime.gsiUrl, 'http://127.0.0.1:1'));
  expect((await page.evaluate(() => window.csbot!.getInfo())).cfgStatus).toBe('outdated');
});

test('records the session with the token redacted', async () => {
  const dir = path.join(tmp, 'userData', 'recordings');
  const files = fs.readdirSync(dir);
  expect(files).toHaveLength(1);
  const text = fs.readFileSync(path.join(dir, files[0]!), 'utf8');
  expect(text.trim().split('\n').length).toBeGreaterThan(50);
  expect(text).not.toContain(runtime.token);
});
