// Electron main process: one window, the host pipeline, and the IPC bridge.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, globalShortcut, ipcMain, Menu, safeStorage, screen, session, shell, type IpcMainInvokeEvent } from 'electron';
import type { CfgInstallResult, CoachAsker, CoachConfig, CoachView, DebriefView, ScoutView, TeamPlan } from '@csbot/protocol';
import { COACH_SCHEMA, COACH_SYSTEM } from '@csbot/coach';
import { CoachService } from './coach/service.ts';
import { ClaudeCoachSession } from './coach/session.ts';
import { detectCs2, installCfg } from './cs2.ts';
import { Host, sessionFileName } from './host.ts';
import { fakeShortcuts, IntelHotkeys } from './hotkeys.ts';
import { PushToTalk } from './voice/ptt.ts';
import { FakeRecognizer, SpeechHelper } from './voice/recognizer.ts';
import { loadSettings, readEnv, saveSettings, type Settings } from './settings.ts';
import { rendererUrlFor, samePage, webIndexFor } from './urls.ts';
import { Updater } from './updater.ts';
import { loadWindowState, restorableBounds, saveWindowState } from './window-state.ts';
import { claudeCommand, detectClaude, runAnalyst, runClaudeJson } from './scout/claude.ts';
import { DebriefService } from './debrief/service.ts';
import { loadTeam, saveTeam } from './team.ts';
import { applyTeam, GEOS, LINEUPS, practiceConfig, practiceFileName } from '@csbot/engine';
import { parseDemoFile } from './debrief/demo.ts';
import { FileStore } from './scout/file-cache.ts';
import { KEY_SERVICES, Secrets, type KeyService } from './scout/secrets.ts';
import { ScoutService } from './scout/service.ts';
import { faceitClient, steamClient } from '@csbot/scout';

const env = readEnv();
if (env.userData) app.setPath('userData', path.resolve(env.userData));
app.setAppUserModelId('app.csbot');

const log = (...a: unknown[]) => console.log('[csbot]', ...a);

// The single-instance lock lives in userData, so test runs with their own dir never collide with the real app.
if (!app.requestSingleInstanceLock()) app.quit();
else run();

function run(): void {
  let win: BrowserWindow | null = null;
  let host: Host | null = null;
  let scout: ScoutService | null = null;
  let debrief: DebriefService | null = null;
  let coach: CoachService | null = null;
  let hotkeys: IntelHotkeys | null = null;
  let voice: PushToTalk | null = null;
  /** Names of the members in this host's room (set by the renderer that runs the room). */
  let roomRoster: string[] = [];
  let scoutCache: FileStore | null = null;
  let settings: Settings;
  const appDir = app.getAppPath();
  // Packaged: <app.asar>/web/index.html. Dev and the playtest copy: <app>/../web/dist/index.html.
  const webIndex = webIndexFor(appDir, p => fs.existsSync(p), (...p) => path.resolve(...p));
  const updater = new Updater(app.getVersion(), log);
  const rendererUrl = rendererUrlFor(env.webUrl ?? pathToFileURL(webIndex).href, env.signal);

  /** Only our renderer may navigate or call the bridge. */
  const isOurs = (url: string): boolean => !!url && samePage(url, rendererUrl);
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
    scoutCache?.flush();
    coach?.stop();
    hotkeys?.dispose();
    voice?.dispose();
    if (!host) return;
    e.preventDefault();
    const h = host;
    host = null;
    const done = () => { updater.installOnQuit(); app.exit(0); };
    const timeout = setTimeout(done, 3000);
    void h.stop().catch(() => undefined).finally(() => { clearTimeout(timeout); done(); });
  });

  void app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    // Updates from GitHub Releases: installed builds only, never hidden runs or tests.
    if (app.isPackaged && !env.hidden && process.env.CSBOT_NO_UPDATE !== '1') void updater.start().catch(err => log('updater:', (err as Error).message));
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
    // Our own guarded GSI, for a desktop member to forward to the room host it joined.
    host.onGsi(p => {
      for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('csbot:gsi', p);
    });

    // Scouting (M3). Keys are encrypted with the OS keychain and stay in this process.
    const userData = app.getPath('userData');
    const secrets = new Secrets(userData, safeStorage);
    scoutCache = new FileStore(path.join(userData, 'cache', 'scout.json'));
    const claude = claudeCommand();
    scout = new ScoutService({
      keys: secrets,
      cache: scoutCache,
      analyst: { detect: async () => (await detectClaude(claude)).found, run: v => runAnalyst(v, claude) },
      ourSteamId: () => host?.latest().me?.steamid,
      // The host is the admin; room members are matched by FACEIT nickname (they join under it).
      roomSteamIds: () => {
        const me = host?.latest().me?.steamid;
        return { ...(me ? { [me]: 'admin' as const } : {}), ...Object.fromEntries(roomRoster.map(n => [n.toLowerCase(), 'member' as const])) };
      },
    });
    const sendScout = (v: ScoutView) => {
      for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('csbot:scout', v);
    };
    scout.onChange(sendScout);

    // The team plan (M7): the squad's playbook and anti-strats, kept on this PC. The engine runs on it
    // (calls, jobs, spots, plan odds), and the room shares it read-only.
    let team: TeamPlan = loadTeam(userData);
    applyTeam(team);
    ipcMain.handle('csbot:teamLatest', e => { guard(e); return team; });
    ipcMain.handle('csbot:setTeam', (e, raw: unknown) => {
      guard(e);
      const r = saveTeam(userData, raw);
      if (!r.ok) return r;
      team = r.team;
      applyTeam(team);
      host?.replan(); // the call and the forecast change now, not at the next game update
      for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('csbot:team', team);
      return { ok: true };
    });

    // Debrief (M6): every match this PC sees is recorded; demos add the truth; Claude writes "work on next".
    // The installed app keeps the demo parser's native module unpacked under resources (see stage.mjs).
    if (app.isPackaged) process.env.CSBOT_PARSER_PATH = path.join(process.resourcesPath, 'app.asar.unpacked', 'native', 'demoparser2');
    const cs2 = detectCs2(env.steamPath ? { steamPath: env.steamPath } : {});
    debrief = new DebriefService({
      dir: path.join(userData, 'matches'),
      onChange: (v: DebriefView) => { for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('csbot:debrief', v); },
      runClaude: o => runClaudeJson({ ...o, model: 'opus', effort: 'high', timeoutMs: 120_000, tag: 'debrief' }, claude),
      parseDemo: parseDemoFile,
      ourSteamId: () => host?.latest().me?.steamid ?? settings.steamId,
      ...(cs2 ? { replaysDir: path.join(cs2.cs2Path, 'game', 'csgo', 'replays') } : {}),
      log,
    });
    host.onSnapshot(s => {
      debrief?.observe(s);
      // Remember our Steam ID (from our own GSI) for demos read later with CS2 closed.
      const id = s.me?.steamid;
      if (id && /^7656\d{13}$/.test(id) && settings.steamId !== id) { settings = { ...settings, steamId: id }; saveSettings(userData, settings); }
    });
    void scout.init().then(async () => {
      if (process.env.CSBOT_KEY_CHECK !== 'off') {
        const k = await scout?.verifyKeys();
        if (k) log(`saved keys: faceit ${k.faceit ?? 'none'}, steam ${k.steam ?? 'none'}`);
      }
      if (settings.faceitNickname) void scout?.setNickname(settings.faceitNickname);
    });
    // Live coach (M5): one warm session on the user's own Claude Code per match.
    coach = new CoachService({
      ...(settings.coach || env.coachOff ? { config: { ...settings.coach, ...(env.coachOff ? { enabled: false } : {}) } } : {}),
      onConfig: c => { settings = { ...settings, coach: c }; saveSettings(userData, settings); },
      makeSession: c => new ClaudeCoachSession({ model: c.model, effort: c.effort, system: COACH_SYSTEM, schema: COACH_SCHEMA, cmd: claude }),
      detect: async () => (await detectClaude(claude)).found,
      applyCall: call => host?.setCoachCall(call),
      engineCall: () => host?.engineCall(),
      scout: () => scout?.current,
      hostName: () => host?.latest().me?.name ?? 'Host',
      hostSlot: () => settings.playbookHandle,
    });
    const sendCoach = (v: CoachView) => {
      for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('csbot:coach', v);
    };
    coach.onChange(sendCoach);
    void coach.init();
    host.onSnapshot(s => coach?.observe(s));

    // Intel (M4a): from this PC (map clicks, numpad hotkeys) and from room members (the web host
    // passes their name). It moves the forecast; a changed read changes the call.
    const ownName = () => host?.latest().me?.name || 'host';
    hotkeys = new IntelHotkeys({
      // Hidden runs and tests never take real global keys (the owner may be playing).
      shortcuts: env.fakeHotkeys ? fakeShortcuts() : globalShortcut,
      log: (zone, count) => {
        // Tournament mode hides the forecast for the whole room: intel isn't taken either.
        if (coach?.inTournament) { log('hotkey intel ignored: tournament mode'); return; }
        const r = host?.addIntel(zone, count, ownName());
        if (r && !r.ok) log(`hotkey intel not logged: ${r.error}`);
      },
      // Check-ins go to the room, which lives in the renderer.
      checkIn: (state, site) => { if (win && !win.isDestroyed()) win.webContents.send('csbot:checkin', state, site); },
    });
    host.onSnapshot(s => hotkeys?.setMap(s.match?.map));
    hotkeys.setEnabled(!!settings.intelHotkeys);

    // Push-to-talk (M7): what's heard goes to the renderer, which logs it like a click (so a member's
    // intel reaches the room's host) or asks the coach. Hidden runs never open the microphone.
    const fakeVoiceKeys = fakeShortcuts();
    voice = new PushToTalk({
      shortcuts: env.fakeHotkeys ? fakeVoiceKeys : globalShortcut,
      recognizer: () => (env.fakeVoice ? new FakeRecognizer(env.fakeVoice) : new SpeechHelper({ dir: userData, log })),
      onEvent: ev => { if (win && !win.isDestroyed()) win.webContents.send('csbot:voice', ev); },
      log,
    });
    // Tests press the stand-in key from the main process.
    if (env.fakeHotkeys) (globalThis as { csbotPressVoice?: () => void }).csbotPressVoice = () => { for (const cb of fakeVoiceKeys.registered.values()) cb(); };
    host.onSnapshot(s => voice?.setMap(s.match?.map));
    if (settings.voice?.enabled) void voice.setEnabled(true, settings.voice.key).then(r => { if (!r.ok) log(`push-to-talk: ${r.error}`); });
    ipcMain.handle('csbot:setVoice', async (e, o: unknown) => {
      guard(e);
      const req = (o && typeof o === 'object' ? o : {}) as { enabled?: unknown; key?: unknown };
      if (typeof req.enabled !== 'boolean' || (req.key !== undefined && typeof req.key !== 'string')) return { ok: false, error: 'Invalid request.' };
      if (!voice) return { ok: false, error: 'csbot is shutting down' };
      const r = await voice.setEnabled(req.enabled, req.key as string | undefined);
      const st = voice.status();
      settings = { ...settings, voice: { enabled: req.enabled && r.ok, key: st.key } };
      saveSettings(userData, settings);
      return r;
    });
    ipcMain.handle('csbot:logIntel', (e, zone: unknown, count: unknown, from: unknown) => {
      guard(e);
      if (typeof zone !== 'string' || !/^[a-z0-9_]{1,32}$/.test(zone) || typeof count !== 'number' || !Number.isInteger(count) || count < 0 || count > 5) {
        return { ok: false, error: 'Invalid intel.' };
      }
      if (!host) return { ok: false, error: 'csbot is shutting down' };
      if (coach?.inTournament) return { ok: false, error: 'Tournament mode is on: no live forecast.' };
      const name = from && typeof from === 'object' && typeof (from as { name?: unknown }).name === 'string' ? (from as { name: string }).name.trim().slice(0, 32) : '';
      return host.addIntel(zone, count, name || ownName());
    });
    ipcMain.handle('csbot:setIntelHotkeys', (e, enabled: unknown) => {
      guard(e);
      if (typeof enabled !== 'boolean') return { ok: false, error: 'Invalid request.' };
      const { intelHotkeys: _old, ...rest } = settings;
      settings = enabled ? { ...rest, intelHotkeys: true } : rest;
      saveSettings(userData, settings);
      hotkeys?.setEnabled(enabled);
      const st = hotkeys?.status();
      return { ok: true, ...(st?.error ? { error: st.error } : {}) };
    });
    ipcMain.handle('csbot:coachLatest', e => { guard(e); return coach?.view; });
    ipcMain.handle('csbot:askCoach', (e, text: unknown, from: unknown) => {
      guard(e);
      if (typeof text !== 'string' || text.length > 1000) return { ok: false, error: 'Invalid question.' };
      return coach ? coach.ask(text, asker(from)) : { ok: false, error: 'csbot is shutting down' };
    });
    ipcMain.handle('csbot:setCoachConfig', (e, patch: unknown) => {
      guard(e);
      if (patch && typeof patch === 'object') coach?.setConfig(patch as Partial<CoachConfig>);
    });
    ipcMain.on('csbot:setRoomSlots', (e, members: unknown, opts: unknown) => {
      if (!isOurs(e.senderFrame?.url ?? '')) return;
      const list = Array.isArray(members) ? members.flatMap(m => {
        if (!m || typeof m !== 'object' || typeof (m as { name?: unknown }).name !== 'string') return [];
        const x = m as { name: string; slot?: unknown; random?: unknown };
        return [{ name: x.name.slice(0, 32), ...(typeof x.slot === 'string' && x.slot.length <= 24 ? { slot: x.slot } : {}), ...(x.random === true ? { random: true } : {}) }];
      }).slice(0, 12) : [];
      const tournament = !!(opts && typeof opts === 'object' && (opts as { tournament?: unknown }).tournament === true);
      coach?.setRoom(list, { tournament });
      // Scouting labels room members (not randoms) by name too.
      roomRoster = list.filter(m => !m.random).map(m => m.name);
      scout?.relabelRoom();
    });

    // Recent FACEIT matches every minute: a match that turns live gets scouted on its own.
    setInterval(() => { void scout?.refreshRecent(); }, 60_000).unref();
    ipcMain.handle('csbot:setFaceitNickname', async (e, nickname: unknown) => {
      guard(e);
      if (nickname !== null && (typeof nickname !== 'string' || nickname.length > 32)) return { ok: false, error: 'Invalid nickname.' };
      const nick = typeof nickname === 'string' ? nickname.trim() : '';
      const { faceitNickname: _old, ...rest } = settings;
      settings = nick ? { ...rest, faceitNickname: nick } : rest;
      saveSettings(userData, settings);
      return scout ? scout.setNickname(nick || null) : { ok: false, error: 'csbot is shutting down' };
    });
    ipcMain.handle('csbot:scoutLatest', e => { guard(e); return scout?.current; });
    ipcMain.handle('csbot:debriefLatest', e => { guard(e); return debrief?.view(); });
    ipcMain.handle('csbot:selectMatch', (e, id: unknown) => { guard(e); if (typeof id === 'string') debrief?.select(id); });
    ipcMain.handle('csbot:getReplay', (e, id: unknown) => { guard(e); return typeof id === 'string' ? debrief?.replay(id) : undefined; });
    ipcMain.handle('csbot:writeWorkOn', (e, id: unknown) => {
      guard(e);
      if (typeof id !== 'string') return { ok: false, error: 'Invalid request.' };
      if (coach?.inTournament) return { ok: false, error: 'Tournament mode is on: no coaching.' };
      return debrief ? debrief.writeWorkOn(id) : { ok: false, error: 'csbot is shutting down' };
    });
    ipcMain.handle('csbot:ingestDemo', async (e, file: unknown) => {
      guard(e);
      if (!debrief) return { ok: false, error: 'csbot is shutting down' };
      let f = typeof file === 'string' ? file : undefined;
      if (f !== undefined && !/\.dem(\.(gz|zst))?$/i.test(f)) return { ok: false, error: 'That is not a demo file (.dem, .dem.gz or .dem.zst).' };
      if (!f) {
        const w = BrowserWindow.fromWebContents(e.sender) ?? undefined;
        const { dialog } = await import('electron');
        const replays = debrief.view().demo?.replaysDir;
        const pick = await dialog.showOpenDialog(w!, {
          title: 'Add a match demo', properties: ['openFile'],
          ...(replays && fs.existsSync(replays) ? { defaultPath: replays } : {}),
          filters: [{ name: 'CS2 demos', extensions: ['dem', 'gz', 'zst'] }],
        });
        if (pick.canceled || !pick.filePaths[0]) return { ok: false, error: '' };
        f = pick.filePaths[0];
      }
      return debrief.ingest(f);
    });
    ipcMain.handle('csbot:openReplays', async e => {
      guard(e);
      const dir = debrief?.view().demo?.replaysDir;
      if (dir) { fs.mkdirSync(dir, { recursive: true }); await shell.openPath(dir); }
    });
    ipcMain.handle('csbot:scoutMatch', async (e, linkOrId: unknown) => {
      guard(e);
      if (typeof linkOrId !== 'string' || linkOrId.length > 500) return { ok: false, error: 'Paste a FACEIT match link.' };
      return scout ? scout.scoutMatch(linkOrId) : { ok: false, error: 'csbot is shutting down' };
    });
    ipcMain.handle('csbot:scoutSample', async e => { guard(e); await scout?.scoutSample(); });
    ipcMain.handle('csbot:scoutSwap', async e => { guard(e); return scout ? scout.swapSides() : { ok: false, error: 'csbot is shutting down' }; });
    ipcMain.handle('csbot:runScoutReport', async e => { guard(e); return scout ? scout.runReport() : { ok: false, error: 'csbot is shutting down' }; });
    ipcMain.on('csbot:setRoomRoster', (e, members: unknown) => {
      if (!isOurs(e.senderFrame?.url ?? '')) return;
      const names = Array.isArray(members) ? members.flatMap(m => (m && typeof m === 'object' && typeof (m as { name?: unknown }).name === 'string' ? [(m as { name: string }).name.slice(0, 32)] : [])).slice(0, 16) : [];
      roomRoster = names;
      scout?.relabelRoom();
    });
    ipcMain.handle('csbot:setApiKey', async (e, service: unknown, key: unknown) => {
      guard(e);
      if (!KEY_SERVICES.includes(service as KeyService) || (key !== null && typeof key !== 'string')) return { ok: false, error: 'Invalid request.' };
      // Check the key with the service before keeping it, so a typo shows up now, not mid-match.
      if (typeof key === 'string') {
        const check = await checkApiKey(service as KeyService, key.trim());
        if (!check.ok) return check;
      }
      const r = secrets.set(service as KeyService, typeof key === 'string' ? key.trim() : null);
      if (r.ok) {
        log(`${service} key ${key === null ? 'cleared' : 'saved'}`);
        scout?.refreshSources();
        // A new FACEIT key: look the saved nickname up again.
        if (service === 'faceit' && key !== null && settings.faceitNickname) void scout?.setNickname(settings.faceitNickname);
      }
      return r;
    });

    ipcMain.handle('csbot:latest', e => { guard(e); return host?.latest(); });
    ipcMain.handle('csbot:getInfo', e => {
      guard(e);
      return host ? { ...host.info(), update: updater.status, ...(hotkeys ? { intelHotkeys: hotkeys.status() } : {}), ...(voice ? { voice: voice.status() } : {}) } : undefined;
    });
    // Practice config (M7): the map's lineups (the team's, else csbot's) as a .cfg in CS2's cfg folder,
    // on the user's click. Generated here from the saved plan, never from text the page sends.
    ipcMain.handle('csbot:installPractice', (e, map: unknown) => {
      guard(e);
      if (typeof map !== 'string' || !GEOS[map]) return { ok: false, error: 'Unknown map.' };
      const cs2 = host?.redetectCs2();
      if (!cs2) return { ok: false, error: 'CS2 not found. Is Counter-Strike 2 installed through Steam on this PC?' };
      try {
        const file = path.join(cs2.cfgDir, practiceFileName(map));
        fs.writeFileSync(file, practiceConfig(map, LINEUPS[map] ?? []), 'utf8');
        log(`wrote ${file}`);
        return { ok: true, path: file };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    });
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
    // `--metrics` (used for real-match measurements) logs process metrics into userData/metrics.
    const metricsFile = env.metricsFile ?? (process.argv.includes('--metrics') ? path.join(app.getPath('userData'), 'metrics', sessionFileName()) : undefined);
    if (metricsFile) startMetrics(metricsFile);
  });

  function createWindow(): BrowserWindow {
    const userData = app.getPath('userData');
    const saved = env.hidden ? undefined : restorableBounds(loadWindowState(userData), screen.getAllDisplays().map(d => d.workArea));
    const w = new BrowserWindow({
      width: saved?.width ?? 1280,
      height: saved?.height ?? 820,
      ...(saved ? { x: saved.x, y: saved.y } : {}),
      minWidth: 900,
      minHeight: 600,
      backgroundColor: '#0b0f14',
      icon: path.join(app.getAppPath(), 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
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
    if (!env.hidden) w.once('ready-to-show', () => { if (saved?.maximized) w.maximize(); w.show(); });
    // Remember the position (typically the second screen) for next launch.
    if (!env.hidden) w.on('close', () => saveWindowState(userData, { ...w.getNormalBounds(), maximized: w.isMaximized() }));
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
      if (scout) w.webContents.send('csbot:scout', scout.current);
      if (coach) w.webContents.send('csbot:coach', coach.view);
      if (debrief) w.webContents.send('csbot:debrief', debrief.view());
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

/**
 * One cheap authenticated call. A refused key is never stored; when the service can't be reached
 * the key is kept (it may be fine) and the first real scout reports any problem.
 */
async function checkApiKey(service: KeyService, key: string): Promise<{ ok: boolean; error?: string }> {
  if (process.env.CSBOT_KEY_CHECK === 'off') return { ok: true }; // e2e tests use fake keys, offline
  try {
    if (service === 'faceit') await faceitClient({ apiKey: key, retryDelayMs: 300 }).ping?.();
    else await steamClient({ apiKey: key, retryDelayMs: 300 }).ping?.();
    return { ok: true };
  } catch (err) {
    const kind = (err as { kind?: string }).kind;
    if (kind === 'auth') return { ok: false, error: `${service === 'faceit' ? 'FACEIT' : 'Steam'} rejected this key. Copy it again from ${service === 'faceit' ? 'your FACEIT app (server side key)' : 'steamcommunity.com/dev/apikey'}.` };
    return { ok: true };
  }
}

/** A question's sender, as the renderer passes it (room members come from RoomHost). Default: the admin. */
function asker(from: unknown): CoachAsker | undefined {
  if (!from || typeof from !== 'object') return undefined;
  const f = from as Partial<CoachAsker>;
  if (typeof f.id !== 'string' || typeof f.name !== 'string' || (f.role !== 'admin' && f.role !== 'member')) return undefined;
  return { id: f.id.slice(0, 64), name: f.name.slice(0, 32), role: f.role };
}
