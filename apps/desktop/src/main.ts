// Electron main process: one window, the host pipeline, and the IPC bridge.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, ipcMain, Menu, session, shell, type IpcMainInvokeEvent } from 'electron';
import type { CfgInstallResult } from '@csbot/protocol';
import { detectCs2, installCfg } from './cs2.ts';
import { Host } from './host.ts';
import { loadSettings, readEnv, saveSettings, type Settings } from './settings.ts';

const env = readEnv();
if (env.userData) app.setPath('userData', path.resolve(env.userData));
app.setAppUserModelId('app.csbot');

const log = (...a: unknown[]) => console.log('[csbot]', ...a);
const stripHash = (u: string) => u.split('#')[0]!;

// The single-instance lock lives in userData, so test runs with their own dir never collide with the real app.
if (!app.requestSingleInstanceLock()) app.quit();
else run();

function run(): void {
  let win: BrowserWindow | null = null;
  let host: Host | null = null;
  let settings: Settings;
  const appDir = app.getAppPath();
  const webIndex = path.resolve(appDir, '..', 'web', 'dist', 'index.html');
  const rendererUrl = env.webUrl ?? pathToFileURL(webIndex).href;

  /** Only our renderer may navigate or call the bridge. */
  const isOurs = (url: string): boolean => {
    if (!url) return false;
    if (rendererUrl.startsWith('file:')) return stripHash(url) === stripHash(rendererUrl);
    try { return new URL(url).origin === new URL(rendererUrl).origin; } catch { return false; }
  };
  const guard = (e: IpcMainInvokeEvent) => {
    if (!isOurs(e.senderFrame?.url ?? '')) throw new Error('csbot bridge: unknown sender');
  };

  const startHost = async (port: number, wantedPort?: number): Promise<Host> => {
    const h = new Host({
      userData: app.getPath('userData'),
      port,
      ...(wantedPort !== undefined ? { wantedPort } : {}),
      token: settings.gsiToken,
      version: app.getVersion(),
      ...(settings.playbookHandle ? { playbookHandle: settings.playbookHandle } : {}),
      detectCs2: () => detectCs2(env.steamPath ? { steamPath: env.steamPath } : {}),
    });
    await h.start();
    return h;
  };

  app.on('second-instance', () => {
    if (!win || env.hidden) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

  app.on('window-all-closed', () => app.quit());

  // Stop the GSI server and flush the recording before exiting. A second app.quit() is ignored
  // while a quit is in progress, so finish with app.exit(), with a timeout in case cleanup stalls.
  app.on('will-quit', e => {
    if (!host) return;
    e.preventDefault();
    const h = host;
    host = null;
    const done = () => app.exit(0);
    const timeout = setTimeout(done, 3000);
    void h.stop().catch(() => undefined).finally(() => { clearTimeout(timeout); done(); });
  });

  void app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    settings = loadSettings(app.getPath('userData'));
    const port = env.gsiPort ?? settings.gsiPort;
    try {
      host = await startHost(port);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE' || port === 0) throw err;
      // Another program holds the port. Take a free one and keep it for next time; Settings then
      // shows the cfg as outdated so the user reinstalls it once.
      host = await startHost(0, port);
      const actual = Number(new URL(host.gsiUrl).port);
      if (env.gsiPort === undefined) { settings = { ...settings, gsiPort: actual }; saveSettings(app.getPath('userData'), settings); }
      log(`GSI port ${port} is busy; listening on ${actual} instead (saved for next launch).`);
    }
    log(`GSI endpoint ${host.gsiUrl}`);
    host.onSnapshot(s => {
      for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('csbot:snapshot', s);
    });

    ipcMain.handle('csbot:latest', e => { guard(e); return host?.latest(); });
    ipcMain.handle('csbot:getInfo', e => { guard(e); return host?.info(); });
    ipcMain.handle('csbot:installCfg', (e): CfgInstallResult => {
      guard(e);
      if (!host) return { ok: false, error: 'csbot is shutting down' };
      const cs2 = host.redetectCs2();
      if (!cs2) return { ok: false, error: 'CS2 not found. Is Counter-Strike 2 installed through Steam on this PC?' };
      try {
        const file = installCfg(cs2.cfgDir, host.cfgText());
        log(`installed ${file}`);
        return { ok: true, path: file };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    });
    ipcMain.handle('csbot:openRecordings', async e => {
      guard(e);
      if (!host) return;
      fs.mkdirSync(host.recordingsDir, { recursive: true });
      await shell.openPath(host.recordingsDir);
    });

    win = createWindow();
    if (env.metricsFile) startMetrics(env.metricsFile);
  });

  function createWindow(): BrowserWindow {
    const w = new BrowserWindow({
      width: 1280,
      height: 820,
      minWidth: 900,
      minHeight: 600,
      backgroundColor: '#0b0f14',
      title: 'csbot',
      show: false,
      paintWhenInitiallyHidden: true,
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: false,
        backgroundThrottling: !env.hidden,
      },
    });
    if (!env.hidden) w.once('ready-to-show', () => w.show());
    w.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    w.webContents.on('will-navigate', (e, url) => {
      if (isOurs(url)) return;
      e.preventDefault();
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    });
    w.webContents.on('did-finish-load', () => {
      if (host) w.webContents.send('csbot:snapshot', host.latest());
    });
    if (!app.isPackaged) {
      w.webContents.on('before-input-event', (_e, input) => {
        if (input.type === 'keyDown' && input.key === 'F12') w.webContents.toggleDevTools();
      });
    }
    if (env.webUrl || fs.existsSync(webIndex)) void w.loadURL(rendererUrl);
    else {
      const html = `<body style="background:#0b0f14;color:#cfd8e3;font:15px system-ui;padding:40px">
        <h2>csbot</h2><p>The web app isn't built yet. Run <code>pnpm --filter @csbot/web build</code>.</p></body>`;
      void w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    }
    w.on('closed', () => { if (win === w) win = null; });
    return w;
  }
}

/** Spike 8: one NDJSON line per second with every Electron process's CPU and memory. */
function startMetrics(file: string): void {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const t = setInterval(() => {
    const procs = app.getAppMetrics().map(p => ({
      pid: p.pid,
      type: p.type,
      name: p.name,
      cpu: p.cpu.percentCPUUsage,
      cpuTotal: (p.cpu as { cumulativeCPUUsage?: number }).cumulativeCPUUsage,
      wakeups: p.cpu.idleWakeupsPerSecond,
      ws: p.memory.workingSetSize,
      peakWs: p.memory.peakWorkingSetSize,
      priv: p.memory.privateBytes,
    }));
    try { fs.appendFileSync(file, JSON.stringify({ t: Date.now(), procs }) + '\n'); } catch { /* measurement only */ }
  }, 1000);
  t.unref();
}
