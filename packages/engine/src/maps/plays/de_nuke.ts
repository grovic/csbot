// Nuke: enemy (T) plans and our CT playbook. Routes are zones walked in order from T spawn
// (ids from maps/geo/de_nuke.ts). Plan odds by enemy buy are first estimates until demo data.
//
// Geometry notes: `roof` in M only picks the yard-side doorway by T spawn, so outside players walk
// the yard instead of cutting through lobby and A site to reach main/mini.

import type { MapPlans } from '../../forecast.ts';
import type { PlaybookDef } from '../../playbook.ts';

export const PLANS_NUKE: MapPlans = {
  map: 'de_nuke',
  routes: {
    H: ['lobby*', 'hut', 'asite'],
    Q: ['lobby', 'squeaky', 'asite'],
    M: ['roof', 'mini', 'asite'],
    R: ['lobby', 'control', 'ramp', 'bsite'],
    S: ['outside', 'secret', 'tunnels', 'bsite'],
    DH: ['lobby', 'control*', 'lobby*', 'hut', 'asite'],
    DQ: ['lobby', 'control*', 'lobby*', 'squeaky', 'asite'],
  },
  plans: [
    { id: 'aRush', name: 'Lobby A rush (hut + squeaky)', site: 'A', speed: 0.88, lineup: ['H', 'H', 'H', 'Q', 'Q'], delay: [2, 3, 4, 2, 3] },
    { id: 'aExec', name: 'A exec (lobby + outside main)', site: 'A', speed: 0.5, lineup: ['H', 'H', 'Q', 'M', 'M'], delay: [11, 13, 12, 0, 2] },
    { id: 'rampRush', name: 'Ramp rush to B', site: 'B', speed: 0.9, lineup: ['R', 'R', 'R', 'R', 'R'], delay: [0, 1, 1, 2, 2] },
    { id: 'bSplit', name: 'B split (ramp + secret)', site: 'B', speed: 0.6, lineup: ['R', 'R', 'R', 'S', 'S'], delay: [8, 9, 10, 0, 1] },
    { id: 'secretB', name: 'Outside take → secret B', site: 'B', speed: 0.55, lineup: ['S', 'S', 'S', 'S', 'R'], delay: [0, 1, 3, 5, 10] },
    { id: 'slowA', name: 'Default → late A', site: 'A', speed: 0.4, lineup: ['DH', 'DQ', 'M', 'M', 'R'], delay: [2, 1, 2, 4, 4] },
  ],
  planPriorByBuy: {
    eco: { aRush: 0.38, aExec: 0.06, rampRush: 0.3, bSplit: 0.06, secretB: 0.06, slowA: 0.14 },
    force: { aRush: 0.26, aExec: 0.14, rampRush: 0.24, bSplit: 0.12, secretB: 0.08, slowA: 0.16 },
    half: { aRush: 0.16, aExec: 0.22, rampRush: 0.14, bSplit: 0.16, secretB: 0.12, slowA: 0.2 },
    full: { aRush: 0.06, aExec: 0.32, rampRush: 0.06, bSplit: 0.2, secretB: 0.14, slowA: 0.22 },
  },
};

export const PLAYBOOK_NUKE: PlaybookDef = {
  map: 'de_nuke',
  slots: [
    { id: 'a', label: 'A anchor' }, { id: 'short', label: 'Outside / mini' }, { id: 'b', label: 'B anchor' },
    { id: 'rotator', label: 'Ramp' }, { id: 'awp', label: 'AWP' },
  ],
  setups: [
    {
      id: 'antieco', name: 'Anti-eco · stack A 3–2', side: 'CT', answers: ['eco'],
      calls: { default: { head: 'Anti-eco · stack A', sub: '3 on A · 2 hold ramp from B', steps: ['Long angles only', 'Trade in pairs'] } },
      spots: [
        { player: 'a', zone: 'asite', label: 'A site' }, { player: 'awp', zone: 'heaven', label: 'heaven AWP' },
        { player: 'short', zone: 'mini', label: 'mini' }, { player: 'rotator', zone: 'bsite', label: 'back of B' }, { player: 'b', zone: 'bsite', label: 'decon' },
      ],
    },
    {
      id: 'std', name: 'Standard 2-1-1-1', side: 'CT',
      calls: {
        default: { head: 'Standard 2-1-1-1', sub: 'Heaven AWP · outside from garage', steps: ['Call lobby and ramp early', 'No dry peeks on outside'] },
        force: { head: 'Anti-force · play safe', sub: '2-1-1-1 · fall back on contact', steps: ['No early peeks', 'Rotate on 3+ seen'] },
      },
      spots: [
        { player: 'a', zone: 'asite', label: 'A site' }, { player: 'awp', zone: 'heaven', label: 'heaven AWP' },
        { player: 'short', zone: 'garage', label: 'garage' }, { player: 'rotator', zone: 'ramp', label: 'top of ramp' }, { player: 'b', zone: 'bsite', label: 'B site' },
      ],
    },
  ],
  jobs: {
    antieco: {
      a: 'A site. Long angles on hut and squeaky, trade off heaven.',
      short: 'Mini. Third A player: hold the site from mini, trade on contact.',
      b: 'Decon. Crossfire the ramp exit with the ramp player, listen for secret.',
      rotator: 'Back of B. Hold the ramp exit from deep, never push up ramp.',
      awp: 'Heaven AWP. Hold hut and squeaky from deep in heaven, let the rush come to you.',
    },
    std: {
      a: 'A site. Crossfire hut and squeaky with heaven, call lobby noise early.',
      short: 'Garage. Watch outside and secret, call numbers, give ground on a full push.',
      b: 'B site. Anchor alone, call secret and ramp contact fast.',
      rotator: 'Top of ramp. Hold the ramp room from admin, fall back down ramp to B on contact.',
      awp: 'Heaven AWP. Hold hut and squeaky from above, reposition after every shot.',
    },
  },
};
