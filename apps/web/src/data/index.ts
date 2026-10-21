import { demoSource, readDemoOptions } from './demo.ts';
import { desktopSource } from './desktop.ts';
import { noneSource, type SnapshotSource } from './source.ts';

/** Desktop host when the preload bridge is present, otherwise the in-browser demo. */
export function pickSource(win: Window = window): SnapshotSource {
  if (win.csbot) return desktopSource(win.csbot);
  const q = new URLSearchParams(win.location.search);
  if (q.get('source') === 'none') return noneSource();
  return demoSource(readDemoOptions(win.location.search));
}

export type { SnapshotSource } from './source.ts';
