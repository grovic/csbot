import type { CsbotBridge, LiveSnapshot } from '@csbot/protocol';

declare global {
  interface Window { csbot?: CsbotBridge }
}

export type SourceKind = 'desktop' | 'demo' | 'none';

/** Where snapshots come from. Every screen renders only from snapshots. */
export interface SnapshotSource {
  kind: SourceKind;
  /**
   * How fast host time runs relative to wall time (1 = real time, 0 = paused, N = demo at N×).
   * The banner clock uses it to tick between snapshots.
   */
  rate(): number;
  subscribe(cb: (s: LiveSnapshot) => void): () => void;
}

/** A source with no data: the browser without a host (room joining arrives in M2). */
export function noneSource(): SnapshotSource {
  const snap: LiveSnapshot = {
    v: 1, seq: 1, at: Date.now(), scoreboard: [], ticker: [],
    connection: { gsi: 'waiting', payloads: 0, source: 'game', guardDropped: 0 },
  };
  return { kind: 'none', rate: () => 1, subscribe: cb => { cb(snap); return () => {}; } };
}
