// Sandboxed preload: exposes window.csbot (CsbotBridge) to the renderer. Only electron's renderer
// modules are available here, so this file imports nothing at runtime except 'electron'.

import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import type { CfgInstallResult, CoachView, CsbotBridge, DebriefView, HostInfo, LiveSnapshot, ScoutView } from '@csbot/protocol';

const bridge: CsbotBridge = {
  onSnapshot(cb) {
    let lastSeq = -1;
    const deliver = (s: LiveSnapshot | undefined) => {
      if (!s || s.seq <= lastSeq) return;
      lastSeq = s.seq;
      cb(s);
    };
    const handler = (_e: IpcRendererEvent, s: LiveSnapshot) => deliver(s);
    ipcRenderer.on('csbot:snapshot', handler);
    // The latest snapshot right away, so a fresh renderer never waits for the next payload.
    void ipcRenderer.invoke('csbot:latest').then(deliver, () => undefined);
    return () => { ipcRenderer.removeListener('csbot:snapshot', handler); };
  },
  getInfo: () => ipcRenderer.invoke('csbot:getInfo') as Promise<HostInfo>,
  installCfg: () => ipcRenderer.invoke('csbot:installCfg') as Promise<CfgInstallResult>,
  openRecordings: () => ipcRenderer.invoke('csbot:openRecordings') as Promise<void>,
  onCheckIn(cb) {
    const handler = (_e: IpcRendererEvent, state: 'spot' | 'rotate', site?: 'A' | 'B') => cb(state, site);
    ipcRenderer.on('csbot:checkin', handler);
    return () => { ipcRenderer.removeListener('csbot:checkin', handler); };
  },
  onGsi(cb) {
    const handler = (_e: IpcRendererEvent, p: Record<string, unknown>) => cb(p);
    ipcRenderer.on('csbot:gsi', handler);
    return () => { ipcRenderer.removeListener('csbot:gsi', handler); };
  },
  onDebrief(cb) {
    let pushed = false;
    const handler = (_e: IpcRendererEvent, v: DebriefView) => { pushed = true; cb(v); };
    ipcRenderer.on('csbot:debrief', handler);
    void ipcRenderer.invoke('csbot:debriefLatest').then((v: DebriefView | undefined) => { if (v && !pushed) cb(v); }, () => undefined);
    return () => { ipcRenderer.removeListener('csbot:debrief', handler); };
  },
  selectMatch: id => ipcRenderer.invoke('csbot:selectMatch', id) as Promise<void>,
  ingestDemo: file => ipcRenderer.invoke('csbot:ingestDemo', file) as Promise<{ ok: boolean; error?: string }>,
  writeWorkOn: id => ipcRenderer.invoke('csbot:writeWorkOn', id) as Promise<{ ok: boolean; error?: string }>,
  openReplays: () => ipcRenderer.invoke('csbot:openReplays') as Promise<void>,
  pathForFile: file => webUtils.getPathForFile(file),
  onScout(cb) {
    let pushed = false;
    const handler = (_e: IpcRendererEvent, v: ScoutView) => { pushed = true; cb(v); };
    ipcRenderer.on('csbot:scout', handler);
    // The current view right away, unless a newer one was pushed in the meantime.
    void ipcRenderer.invoke('csbot:scoutLatest').then((v: ScoutView | undefined) => { if (v && !pushed) cb(v); }, () => undefined);
    return () => { ipcRenderer.removeListener('csbot:scout', handler); };
  },
  scoutMatch: linkOrId => ipcRenderer.invoke('csbot:scoutMatch', linkOrId) as Promise<{ ok: boolean; error?: string }>,
  scoutSample: () => ipcRenderer.invoke('csbot:scoutSample') as Promise<void>,
  scoutSwap: () => ipcRenderer.invoke('csbot:scoutSwap') as Promise<{ ok: boolean; error?: string }>,
  runScoutReport: () => ipcRenderer.invoke('csbot:runScoutReport') as Promise<{ ok: boolean; error?: string }>,
  setRoomRoster: members => { ipcRenderer.send('csbot:setRoomRoster', members); },
  setFaceitNickname: nickname => ipcRenderer.invoke('csbot:setFaceitNickname', nickname) as Promise<{ ok: boolean; error?: string }>,
  setApiKey: (service, key) => ipcRenderer.invoke('csbot:setApiKey', service, key) as Promise<{ ok: boolean; error?: string }>,
  onCoach(cb) {
    let pushed = false;
    const handler = (_e: IpcRendererEvent, v: CoachView) => { pushed = true; cb(v); };
    ipcRenderer.on('csbot:coach', handler);
    void ipcRenderer.invoke('csbot:coachLatest').then((v: CoachView | undefined) => { if (v && !pushed) cb(v); }, () => undefined);
    return () => { ipcRenderer.removeListener('csbot:coach', handler); };
  },
  askCoach: (text, from) => ipcRenderer.invoke('csbot:askCoach', text, from) as Promise<{ ok: boolean; error?: string }>,
  setCoachConfig: patch => ipcRenderer.invoke('csbot:setCoachConfig', patch) as Promise<void>,
  setRoomSlots: (members, opts) => { ipcRenderer.send('csbot:setRoomSlots', members, opts); },
  logIntel: (zone, count, from) => ipcRenderer.invoke('csbot:logIntel', zone, count, from) as Promise<{ ok: boolean; error?: string }>,
  setIntelHotkeys: enabled => ipcRenderer.invoke('csbot:setIntelHotkeys', enabled) as Promise<{ ok: boolean; error?: string }>,
};

contextBridge.exposeInMainWorld('csbot', bridge);
