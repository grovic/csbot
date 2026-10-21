// Dust II: enemy (T) plans and our CT playbook. Routes are zones walked in order from T spawn
// (ids from maps/geo/de_dust2.ts). Plan odds by enemy buy are first estimates until demo data.

import type { MapPlans } from '../../forecast.ts';
import type { PlaybookDef } from '../../playbook.ts';

export const PLANS_DUST2: MapPlans = {
  map: 'de_dust2',
  routes: {
    L: ['outsidelong', 'longdoors', 'longa', 'asite'],
    S: ['topofmid', 'middle', 'catwalk', 'shortstairs', 'asite'],
    T: ['outsidetunnel', 'uppertunnel', 'bsite'],
    LT: ['topofmid', 'middle', 'lowertunnel', 'uppertunnel', 'bsite'],
    MD: ['topofmid', 'middle', 'middoors', 'bdoors', 'bsite'],
  },
  plans: [
    { id: 'longRush', name: 'Long A rush', site: 'A', speed: 0.85, lineup: ['L', 'L', 'L', 'L', 'L'], delay: [0, 1, 2, 3, 4] },
    { id: 'longTake', name: 'Long take (3 long, 2 short)', site: 'A', speed: 0.55, lineup: ['L', 'L', 'L', 'S', 'S'], delay: [0, 2, 4, 0, 3] },
    { id: 'aSplit', name: 'A split (long + short)', site: 'A', speed: 0.5, lineup: ['L', 'L', 'S', 'S', 'S'], delay: [3, 5, 0, 2, 4] },
    { id: 'bRush', name: 'B tunnels rush', site: 'B', speed: 0.85, lineup: ['T', 'T', 'T', 'T', 'T'], delay: [0, 1, 2, 3, 4] },
    { id: 'bExec', name: 'B exec (tunnels + lower)', site: 'B', speed: 0.55, lineup: ['T', 'T', 'T', 'LT', 'LT'], delay: [0, 2, 4, 0, 3] },
    { id: 'midB', name: 'Mid to B split', site: 'B', speed: 0.45, lineup: ['LT', 'LT', 'MD', 'T', 'L'], delay: [0, 3, 2, 0, 0] },
  ],
  planPriorByBuy: {
    eco: { longRush: 0.22, longTake: 0.12, aSplit: 0.08, bRush: 0.38, bExec: 0.1, midB: 0.1 },
    force: { longRush: 0.2, longTake: 0.17, aSplit: 0.12, bRush: 0.25, bExec: 0.14, midB: 0.12 },
    half: { longRush: 0.12, longTake: 0.22, aSplit: 0.18, bRush: 0.15, bExec: 0.18, midB: 0.15 },
    full: { longRush: 0.05, longTake: 0.28, aSplit: 0.26, bRush: 0.06, bExec: 0.2, midB: 0.15 },
  },
};

export const PLAYBOOK_DUST2: PlaybookDef = {
  map: 'de_dust2',
  slots: [
    { id: 'a', label: 'Long A' }, { id: 'short', label: 'Short / Cat' }, { id: 'b', label: 'B anchor' },
    { id: 'rotator', label: 'Mid / rotator' }, { id: 'awp', label: 'AWP' },
  ],
  setups: [
    {
      id: 'antieco', name: 'Anti-eco · stack B 3–2', side: 'CT', answers: ['eco'],
      calls: { default: { head: 'Anti-eco · stack B', sub: '3 on B · 2 on A · long angles', steps: ['Long angles only', 'Trade in pairs'] } },
      spots: [
        { player: 'b', zone: 'bsite', label: 'B site' }, { player: 'rotator', zone: 'bsite', label: 'B back plat' },
        { player: 'short', zone: 'bdoors', label: 'B doors' }, { player: 'a', zone: 'longa', label: 'long corner' }, { player: 'awp', zone: 'asite', label: 'A site AWP' },
      ],
    },
    {
      id: 'std', name: 'Standard 2-1-2', side: 'CT',
      calls: {
        default: { head: 'Standard 2-1-2', sub: 'AWP on long · mid doors for early info', steps: ['No dry peeks on long', 'Rotate via CT: 5 s'] },
        force: { head: 'Anti-force · play safe', sub: '2-1-2 · fall back on contact', steps: ['No early peeks', 'Rotate on 3+ seen'] },
      },
      spots: [
        { player: 'a', zone: 'longa', label: 'long corner' }, { player: 'awp', zone: 'asite', label: 'A site AWP' },
        { player: 'short', zone: 'shortstairs', label: 'short' }, { player: 'rotator', zone: 'middoors', label: 'mid doors' }, { player: 'b', zone: 'bsite', label: 'B site' },
      ],
    },
  ],
  jobs: {
    antieco: { a: 'Long corner. Long angles only, fall back on 2+.', short: 'B doors. Crossfire tunnels with the B anchor.', b: 'B site. Hold the tunnels exit from the back plat.', rotator: 'B back plat. Trade the anchor, never peek tunnels.', awp: 'A site AWP. Hold long and cat from the site.' },
    std: { a: 'Long corner. Hold long doors, fall back to the site on contact.', short: 'Short. Hold cat in a crossfire with the A site.', b: 'B site. Anchor alone and call tunnels contact fast.', rotator: 'Mid doors. Early look at mid, then rotate where called.', awp: 'A site AWP. Hold long from the site, never peek long doors.' },
  },
};
