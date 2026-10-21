// Sandboxed preload: exposes window.csbot (CsbotBridge) to the renderer. Only electron's renderer
// modules are available here, so this file imports nothing at runtime except 'electron'.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { CfgInstallResult, CsbotBridge, HostInfo, LiveSnapshot, ScoutView } from '@csbot/protocol';

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
  onGsi(cb) {
    const handler = (_e: IpcRendererEvent, p: Record<string, unknown>) => cb(p);
    ipcRenderer.on('csbot:gsi', handler);
    return () => { ipcRenderer.removeListener('csbot:gsi', handler); };
  },
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
  runScoutReport: () => ipcRenderer.invoke('csbot:runScoutReport') as Promise<{ ok: boolean; error?: string }>,
  setRoomRoster: members => { ipcRenderer.send('csbot:setRoomRoster', members); },
  setApiKey: (service, key) => ipcRenderer.invoke('csbot:setApiKey', service, key) as Promise<{ ok: boolean; error?: string }>,
};

contextBridge.exposeInMainWorld('csbot', bridge);
