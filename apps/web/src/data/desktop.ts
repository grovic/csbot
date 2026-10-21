import type { CsbotBridge } from '@csbot/protocol';
import type { SnapshotSource } from './source.ts';

/** Snapshots pushed by the desktop host over IPC (preload exposes `window.csbot`). */
export function desktopSource(bridge: CsbotBridge): SnapshotSource {
  return { kind: 'desktop', rate: () => 1, subscribe: cb => bridge.onSnapshot(cb) };
}
