// Schematic Mirage (fictional geometry on a 1000×1000 grid). The production map model is generated
// from demo positions (place names + trajectories); this one keeps the prototype and tests running.

import type { MapModel } from '../forecast.ts';

export const MIRAGE: MapModel = {
  id: 'de_mirage',
  roundTime: 115,
  rushSpeed: 1.25,
  zones: [
    { id: 'tspawn', name: 'T Spawn', rect: [845, 360, 130, 240] },
    { id: 'talley', name: '', rect: [860, 200, 65, 170] },
    { id: 'tapps', name: 'T Apps', rect: [660, 110, 265, 105] },
    { id: 'bapps', name: 'B Apps', rect: [380, 120, 290, 75] },
    { id: 'bsite', name: 'B Site', rect: [110, 80, 280, 210], site: 'B' },
    { id: 'kitchen', name: 'Kitchen', rect: [200, 285, 85, 75] },
    { id: 'market', name: 'Market', rect: [140, 355, 150, 115] },
    { id: 'ctpath', name: '', rect: [170, 465, 60, 100] },
    { id: 'short', name: 'Short', rect: [290, 285, 160, 75] },
    { id: 'cat', name: '', rect: [390, 285, 60, 130] },
    { id: 'under', name: 'Under', rect: [470, 185, 70, 220] },
    { id: 'window', name: 'Window', rect: [290, 405, 105, 85] },
    { id: 'mid', name: 'Mid', rect: [390, 400, 350, 85] },
    { id: 'topmid', name: 'Top Mid', rect: [730, 380, 120, 120] },
    { id: 'conn', name: 'Conn.', rect: [470, 485, 70, 115] },
    { id: 'jungle', name: 'Jungle', rect: [360, 520, 115, 125] },
    { id: 'stairs', name: '', rect: [490, 595, 60, 60] },
    { id: 'ctspawn', name: 'CT Spawn', rect: [90, 560, 190, 150] },
    { id: 'ticket', name: 'Ticket', rect: [275, 640, 70, 60] },
    { id: 'asite', name: 'A Site', rect: [340, 640, 240, 220], site: 'A' },
    { id: 'aramp', name: 'A Ramp', rect: [575, 660, 185, 80] },
    { id: 'tramp', name: 'T Ramp', rect: [750, 590, 120, 150] },
    { id: 'palace', name: 'Palace', rect: [570, 815, 235, 75] },
    { id: 'palpath', name: '', rect: [800, 735, 60, 155] },
  ],
  routes: {
    B: [[910, 480, 0], [892, 300, 4], [880, 160, 8], [720, 160, 12], [560, 158, 17], [430, 158, 23], [330, 175, 30], [220, 180, 38]],
    A: [[910, 480, 0], [810, 640, 6], [690, 700, 11], [600, 700, 15], [500, 730, 22], [440, 760, 30]],
    P: [[910, 480, 0], [840, 640, 6], [830, 800, 10], [700, 850, 14], [590, 850, 18], [520, 800, 24], [460, 790, 30]],
    M: [[910, 480, 0], [790, 440, 4], [640, 442, 10], [505, 442, 15], [505, 540, 20], [520, 625, 25], [470, 700, 32]],
    S: [[910, 480, 0], [790, 440, 4], [600, 442, 9], [420, 442, 16], [420, 330, 21], [340, 320, 25], [300, 250, 32]],
    U: [[910, 480, 0], [790, 440, 4], [640, 442, 10], [505, 430, 16], [505, 300, 21], [505, 170, 26]],
  },
  plans: [
    { id: 'bRush', name: 'B apps rush', site: 'B', speed: 1.25, lineup: ['B', 'B', 'B', 'B', 'S'], delay: [0, 1, 2, 3, 0] },
    { id: 'bExec', name: 'B exec (apps + short)', site: 'B', speed: 0.8, lineup: ['B', 'B', 'B', 'S', 'S'], delay: [0, 2, 4, 0, 3] },
    { id: 'aExec', name: 'A exec (ramp + palace)', site: 'A', speed: 0.8, lineup: ['A', 'A', 'P', 'P', 'M'], delay: [0, 2, 0, 2, 1] },
    { id: 'split', name: 'Mid-to-A split', site: 'A', speed: 0.6, lineup: ['M', 'M', 'P', 'A', 'U'], delay: [0, 3, 0, 1, 4] },
    { id: 'slowB', name: 'Default → late B', site: 'B', speed: 0.45, lineup: ['S', 'M', 'B', 'P', 'U'], delay: [0, 2, 0, 4, 3] },
  ],
  planPriorByBuy: {
    eco: { bRush: 0.52, bExec: 0.12, aExec: 0.12, split: 0.08, slowB: 0.16 },
    force: { bRush: 0.3, bExec: 0.2, aExec: 0.22, split: 0.13, slowB: 0.15 },
    half: { bRush: 0.22, bExec: 0.22, aExec: 0.26, split: 0.15, slowB: 0.15 },
    full: { bRush: 0.06, bExec: 0.26, aExec: 0.36, split: 0.18, slowB: 0.14 },
  },
  timed: { bapps: ['B', 4], topmid: ['M', 1], aramp: ['A', 2], palace: ['P', 3], under: ['U', 4], conn: ['M', 4], short: ['S', 5] },
};
