// Cache: enemy (T) plans and our CT playbook. Routes are zones walked in order from T spawn
// (ids from maps/geo/de_cache.ts). Plan odds by enemy buy are first estimates until demo data.
// Note: Valve's "Useless" (the garage → B halls passage, T side) is its own zone, `useless`;
// `checkers` is the CT-side strip by the vents exit.

import type { MapPlans } from '../../forecast.ts';
import type { PlaybookDef } from '../../playbook.ts';

export const PLANS_CACHE: MapPlans = {
  map: 'de_cache',
  routes: {
    M: ['outsidea', 'amain*', 'asite'],
    L: ['outsidea', 'longa*', 'ahalls', 'asite'],
    H: ['garage', 'mid*', 'highway*', 'asite'],
    B: ['outsideb', 'bhalls', 'bmain*', 'bsite'],
    C: ['garage', 'useless', 'bhalls', 'bmain*', 'bsite'],
    V: ['garage', 'mid*', 'vents', 'checkers', 'bsite'],
  },
  plans: [
    { id: 'aRush', name: 'A main rush (+ squeaky)', site: 'A', speed: 0.85, lineup: ['M', 'M', 'M', 'L', 'L'], delay: [0, 1, 2, 0, 1] },
    { id: 'aExec', name: 'A exec (main + squeaky + highway)', site: 'A', speed: 0.55, lineup: ['M', 'M', 'L', 'L', 'H'], delay: [8, 10, 6, 8, 4] },
    { id: 'midA', name: 'Mid to A split (highway + main)', site: 'A', speed: 0.5, lineup: ['H', 'H', 'M', 'L', 'B'], delay: [3, 6, 10, 9, 14] },
    { id: 'bRush', name: 'B halls rush', site: 'B', speed: 0.9, lineup: ['B', 'B', 'B', 'B', 'C'], delay: [0, 1, 2, 3, 0] },
    { id: 'bExec', name: 'B exec (main + vents)', site: 'B', speed: 0.55, lineup: ['B', 'B', 'B', 'V', 'V'], delay: [8, 10, 12, 3, 5] },
    { id: 'midB', name: 'Mid to B split (vents + main)', site: 'B', speed: 0.5, lineup: ['V', 'V', 'C', 'B', 'L'], delay: [4, 6, 8, 10, 8] },
    { id: 'slowA', name: 'Default → late A', site: 'A', speed: 0.4, lineup: ['M', 'L', 'H', 'B', 'V'], delay: [8, 6, 10, 4, 12] },
  ],
  planPriorByBuy: {
    eco: { aRush: 0.26, aExec: 0.06, midA: 0.06, bRush: 0.38, bExec: 0.08, midB: 0.06, slowA: 0.1 },
    force: { aRush: 0.22, aExec: 0.12, midA: 0.1, bRush: 0.26, bExec: 0.12, midB: 0.08, slowA: 0.1 },
    half: { aRush: 0.14, aExec: 0.18, midA: 0.14, bRush: 0.16, bExec: 0.16, midB: 0.1, slowA: 0.12 },
    full: { aRush: 0.05, aExec: 0.26, midA: 0.18, bRush: 0.06, bExec: 0.18, midB: 0.13, slowA: 0.14 },
  },
  defense: {
    setups: [
      { id: 'default', name: 'Standard 2-1-2 (A + highway, Z AWP, checkers + B)', holds: ['asite', 'highway', 'connector', 'checkers', 'bsite'] },
      { id: 'stackA', name: 'Stack A (quad + truck + highway)', holds: ['asite', 'truck', 'highway', 'connector', 'bsite'] },
      { id: 'stackB', name: 'Stack B (headshot + heaven + checkers)', holds: ['asite', 'connector', 'checkers', 'bsite', 'bsite'] },
      { id: 'midPush', name: 'Mid push (highway + Z up to white box)', holds: ['asite', 'mid', 'mid', 'checkers', 'bsite'] },
      { id: 'retake', name: 'Light sites, play the retake', holds: ['truck', 'connector', 'ctlane', 'ctspawn', 'treeroom'] },
    ],
    priorByBuy: {
      eco: { default: 0.2, stackA: 0.24, stackB: 0.26, midPush: 0.2, retake: 0.1 },
      force: { default: 0.3, stackA: 0.17, stackB: 0.19, midPush: 0.2, retake: 0.14 },
      half: { default: 0.38, stackA: 0.14, stackB: 0.16, midPush: 0.17, retake: 0.15 },
      full: { default: 0.48, stackA: 0.1, stackB: 0.11, midPush: 0.16, retake: 0.15 },
    },
  },
};

export const PLAYBOOK_CACHE: PlaybookDef = {
  map: 'de_cache',
  slots: [
    { id: 'a', label: 'A anchor' }, { id: 'short', label: 'Mid / highway' }, { id: 'b', label: 'B anchor' },
    { id: 'rotator', label: 'Rotator' }, { id: 'awp', label: 'AWP' },
  ],
  setups: [
    {
      id: 'antieco', name: 'Anti-eco · stack B 3–2', side: 'CT', answers: ['eco'],
      calls: { default: { head: 'Anti-eco · stack B', sub: '3 on B · 2 on A side · long angles', steps: ['Long angles only', 'Trade in pairs'] } },
      spots: [
        { player: 'b', zone: 'bsite', label: 'headshot' }, { player: 'rotator', zone: 'bsite', label: 'heaven' },
        { player: 'awp', zone: 'treeroom', label: 'tree room' }, { player: 'short', zone: 'highway', label: 'highway' }, { player: 'a', zone: 'truck', label: 'truck' },
      ],
    },
    {
      id: 'std', name: 'Standard 2-1-2', side: 'CT',
      calls: {
        default: { head: 'Standard 2-1-2', sub: 'AWP mid from connector · rotator on checkers', steps: ['No dry peeks on A main', 'Rotate via CT: 10 s'] },
        force: { head: 'Anti-force · play safe', sub: '2-1-2 · fall back on contact', steps: ['No early peeks', 'Rotate on 3+ seen'] },
      },
      spots: [
        { player: 'a', zone: 'asite', label: 'quad' }, { player: 'short', zone: 'highway', label: 'highway' },
        { player: 'awp', zone: 'connector', label: 'connector AWP' }, { player: 'rotator', zone: 'backhall', label: 'back hall' }, { player: 'b', zone: 'bsite', label: 'headshot' },
      ],
    },
  ],
  jobs: {
    antieco: { a: 'Truck. Play deep for the retake, call A main or squeaky contact.', short: 'Highway. Long angle on mid only, fall back to truck on contact.', b: 'Headshot. Hold B main from the site, call numbers, never peek main.', rotator: 'Heaven. Hold checkers and the vents drop, trade the anchor.', awp: 'Tree room. Hold B main deep across the site, long angle only.' },
    std: { a: 'Quad. Hold A main and squeaky, molly main on a rush, fall back to truck.', short: 'Highway. Hold mid and catwalk, help A on contact, never push mid alone.', b: 'Headshot. Anchor B alone, hold B main and call contact fast.', rotator: 'Back hall. Hold checkers and the vents drop, rotate to B first.', awp: 'Connector AWP. Hold mid to garage and watch vents, fall back to CT if smoked.' },
  },
};
