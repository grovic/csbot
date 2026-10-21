// Auto-update from GitHub Releases (electron-updater). Packaged builds only, never in tests.
// Unsigned beta: electron-builder writes no publisherName into app-update.yml, so electron-updater
// skips the Windows signature check; the download is still verified against the sha512 in latest.yml.

import type { AppUpdater } from 'electron-updater';

export type UpdateState = 'off' | 'checking' | 'up-to-date' | 'downloading' | 'ready' | 'error';

export interface UpdateStatus {
  version: string;
  state: UpdateState;
  /** The version being downloaded or ready to install. */
  available?: string;
  error?: string;
}

const SIX_HOURS = 6 * 3600_000;

export class Updater {
  status: UpdateStatus;
  private updater?: AppUpdater;
  private readonly log: (...a: unknown[]) => void;

  constructor(version: string, log: (...a: unknown[]) => void) {
    this.status = { version, state: 'off' };
    this.log = log;
  }

  /** Start checking (now, then every 6 h). Call only for packaged, visible, non-test runs. */
  async start(): Promise<void> {
    const { autoUpdater } = await import('electron-updater');
    this.updater = autoUpdater;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = { info: () => {}, warn: (m: unknown) => this.log('update:', m), error: (m: unknown) => this.log('update error:', m), debug: () => {} } as never;
    autoUpdater.on('checking-for-update', () => this.set({ state: 'checking' }));
    autoUpdater.on('update-not-available', () => this.set({ state: 'up-to-date' }));
    autoUpdater.on('update-available', info => this.set({ state: 'downloading', available: info.version }));
    autoUpdater.on('update-downloaded', info => { this.set({ state: 'ready', available: info.version }); this.log(`update ${info.version} downloaded; installs when csbot quits`); });
    autoUpdater.on('error', err => this.set({ state: 'error', error: (err as Error).message.split('\n')[0]!.slice(0, 200) }));
    const check = () => { void autoUpdater.checkForUpdates().catch(err => this.set({ state: 'error', error: String((err as Error).message).slice(0, 200) })); };
    check();
    setInterval(check, SIX_HOURS).unref();
  }

  /**
   * Called from csbot's own quit path (which ends with app.exit, skipping the 'quit' event
   * electron-updater normally listens to): run the downloaded installer silently.
   */
  installOnQuit(): void {
    if (this.status.state !== 'ready' || !this.updater) return;
    try { (this.updater as unknown as { install(silent: boolean, runAfter: boolean): boolean }).install(true, false); } catch (e) { this.log('update install failed:', (e as Error).message); }
  }

  private set(patch: Partial<UpdateStatus>): void {
    const { error: _e, ...rest } = this.status;
    this.status = { ...rest, ...patch };
  }
}
