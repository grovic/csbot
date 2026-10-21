import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadWindowState, restorableBounds, saveWindowState } from '../src/window-state.ts';

const primary = { x: 0, y: 0, width: 2560, height: 1400 };
const second = { x: 2560, y: 0, width: 1920, height: 1040 };

describe('window state', () => {
  it('round-trips through window.json', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csbot-win-'));
    expect(loadWindowState(dir)).toBeUndefined();
    saveWindowState(dir, { x: 2600, y: 40, width: 1280, height: 820, maximized: true });
    expect(loadWindowState(dir)).toEqual({ x: 2600, y: 40, width: 1280, height: 820, maximized: true });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('restores onto the second screen while it is connected', () => {
    const s = { x: 2600, y: 40, width: 1280, height: 820, maximized: false };
    expect(restorableBounds(s, [primary, second])).toEqual(s);
  });

  it('falls back to the default position when that screen is gone', () => {
    expect(restorableBounds({ x: 2600, y: 40, width: 1280, height: 820, maximized: false }, [primary])).toBeUndefined();
  });

  it('never restores below the minimum size', () => {
    expect(restorableBounds({ x: 10, y: 10, width: 300, height: 200, maximized: false }, [primary])).toMatchObject({ width: 900, height: 600 });
  });
});
