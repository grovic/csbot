// Remember where the window was (the second screen) and restore it next launch. Pure Node logic;
// the caller passes the displays' work areas so this stays testable without Electron.

import fs from 'node:fs';
import path from 'node:path';

export interface Rect { x: number; y: number; width: number; height: number }
export interface WindowState extends Rect { maximized: boolean }

const FILE = 'window.json';

export function loadWindowState(dir: string): WindowState | undefined {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(dir, FILE), 'utf8')) as Partial<WindowState>;
    const nums = [s.x, s.y, s.width, s.height].every(v => typeof v === 'number' && Number.isFinite(v));
    return nums ? { x: s.x!, y: s.y!, width: s.width!, height: s.height!, maximized: !!s.maximized } : undefined;
  } catch {
    return undefined;
  }
}

export function saveWindowState(dir: string, s: WindowState): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, FILE), JSON.stringify(s) + '\n');
  } catch { /* losing the position is harmless */ }
}

/** Use the saved bounds only if a good part of the window is still on a connected display. */
export function restorableBounds(s: WindowState | undefined, workAreas: readonly Rect[], min = { width: 900, height: 600 }): WindowState | undefined {
  if (!s) return undefined;
  const width = Math.max(min.width, s.width), height = Math.max(min.height, s.height);
  const visible = workAreas.some(a => {
    const w = Math.min(s.x + width, a.x + a.width) - Math.max(s.x, a.x);
    const h = Math.min(s.y + height, a.y + a.height) - Math.max(s.y, a.y);
    return w >= 200 && h >= 120;
  });
  return visible ? { ...s, width, height } : undefined;
}
