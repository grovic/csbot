// Sandboxed preload: exposes window.csbot (CsbotBridge) to the renderer. Only electron's renderer
// modules are available here, so this file imports nothing at runtime except 'electron'.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { CfgInstallResult, CsbotBridge, HostInfo, LiveSnapshot } from '@csbot/protocol';

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
};

contextBridge.exposeInMainWorld('csbot', bridge);
