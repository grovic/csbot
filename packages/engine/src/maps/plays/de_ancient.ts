// Ancient: enemy (T) plans and our CT playbook. Routes are zones walked in order from T spawn
// (ids from maps/geo/de_ancient.ts). Plan odds by enemy buy are first estimates until demo data.
// The zone `sideentrance` (shown as "B Side") is the mid-to-B cave.

import type { MapPlans } from '../../forecast.ts';
import type { PlaybookDef } from '../../playbook.ts';

export const PLANS_ANCIENT: MapPlans = {
  map: 'de_ancient',
  routes: {
    M: ['outside', 'mainhall', 'asite'],
    D: ['outside', 'middle', 'sidehall', 'asite'],
    R: ['tunnel', 'water', 'ruins', 'tsidelower', 'ramp', 'bsite'],
    C: ['outside', 'middle', 'tsideupper', 'sideentrance', 'bsite'],
  },
  plans: [
    { id: 'aRush', name: 'A main rush', site: 'A', speed: 0.85, lineup: ['M', 'M', 'M', 'M', 'D'], delay: [0, 1, 2, 3, 0] },
    { id: 'aExec', name: 'A exec (main + donut)', site: 'A', speed: 0.55, lineup: ['M', 'M', 'M', 'D', 'D'], delay: [8, 10, 12, 6, 9] },
    { id: 'midA', name: 'Mid control into A split', site: 'A', speed: 0.5, lineup: ['D', 'D', 'D', 'M', 'C'], delay: [4, 7, 10, 8, 6] },
    { id: 'bRush', name: 'B ramp rush', site: 'B', speed: 0.88, lineup: ['R', 'R', 'R', 'R', 'C'], delay: [0, 1, 2, 3, 0] },
    { id: 'bExec', name: 'B exec (ramp + cave)', site: 'B', speed: 0.55, lineup: ['R', 'R', 'R', 'C', 'C'], delay: [8, 10, 12, 5, 8] },
    { id: 'midB', name: 'Mid to B split (cave + ramp)', site: 'B', speed: 0.55, lineup: ['C', 'C', 'C', 'R', 'D'], delay: [2, 4, 6, 8, 6] },
    { id: 'slowA', name: 'Default → late A', site: 'A', speed: 0.4, lineup: ['M', 'M', 'D', 'D', 'C'], delay: [8, 12, 6, 9, 2] },
  ],
  planPriorByBuy: {
    eco: { aRush: 0.24, aExec: 0.06, midA: 0.05, bRush: 0.42, bExec: 0.08, midB: 0.05, slowA: 0.1 },
    force: { aRush: 0.2, aExec: 0.12, midA: 0.1, bRush: 0.26, bExec: 0.12, midB: 0.08, slowA: 0.12 },
    half: { aRush: 0.12, aExec: 0.18, midA: 0.14, bRush: 0.16, bExec: 0.16, midB: 0.1, slowA: 0.14 },
    full: { aRush: 0.05, aExec: 0.24, midA: 0.2, bRush: 0.06, bExec: 0.2, midB: 0.12, slowA: 0.13 },
  },
};

export const PLAYBOOK_ANCIENT: PlaybookDef = {
  map: 'de_ancient',
  slots: [
    { id: 'a', label: 'A anchor' }, { id: 'short', label: 'Donut / A support' }, { id: 'b', label: 'B anchor' },
    { id: 'rotator', label: 'Mid / cave' }, { id: 'awp', label: 'AWP' },
  ],
  setups: [
    {
      id: 'antieco', name: 'Anti-eco · stack B 3–2', side: 'CT', answers: ['eco'],
      calls: { default: { head: 'Anti-eco · stack B', sub: '3 on B · 2 on A · long angles', steps: ['Long angles only', 'Trade in pairs'] } },
      spots: [
        { player: 'b', zone: 'bsite', label: 'B site' }, { player: 'rotator', zone: 'bsite', label: 'back B' },
        { player: 'short', zone: 'alley', label: 'alley' }, { player: 'a', zone: 'asite', label: 'A site' }, { player: 'awp', zone: 'asite', label: 'A site AWP' },
      ],
    },
    {
      id: 'std', name: 'Standard 2-1-2', side: 'CT',
      calls: {
        default: { head: 'Standard 2-1-2', sub: 'AWP top mid · early donut and cave', steps: ['No dry peeks into mid', 'Rotate via house: 14 s'] },
        force: { head: 'Anti-force · play safe', sub: '2-1-2 · fall back on contact', steps: ['No early peeks', 'Rotate on 3+ seen'] },
      },
      spots: [
        { player: 'a', zone: 'asite', label: 'A site' }, { player: 'short', zone: 'sidehall', label: 'donut' },
        { player: 'awp', zone: 'topofmid', label: 'top mid AWP' }, { player: 'rotator', zone: 'sideentrance', label: 'cave' }, { player: 'b', zone: 'bsite', label: 'B site' },
      ],
    },
  ],
  jobs: {
    antieco: {
      a: 'A site, donut side. Long angle on the donut exit, fall back to CT on 2+.',
      short: 'Alley. Third B player: trade from behind, rotate to A through house if called.',
      b: 'B site. Deep angle on the ramp, never peek it.',
      rotator: 'Back B. Hold the cave exit from range and trade the anchor.',
      awp: 'A site AWP. Hold the main exit from deep, never peek Elbow.',
    },
    std: {
      a: 'A site. Hold the main exit and call Elbow contact fast.',
      short: 'Donut. Take early control, fall back to A site on contact.',
      b: 'B site. Hold the ramp alone and call contact fast.',
      rotator: 'Cave. Hold it from the B side, fall back to B site on contact.',
      awp: 'Top mid AWP. Hold mid, don\'t re-peek after a shot.',
    },
  },
};
