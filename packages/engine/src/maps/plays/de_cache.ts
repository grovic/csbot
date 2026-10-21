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
  // The same five players on T: roles instead of positions.
  tSlots: [
    { id: 'a', label: 'Entry' }, { id: 'short', label: 'Support / flashes' }, { id: 'b', label: 'Lurk' },
    { id: 'rotator', label: 'IGL / flex' }, { id: 'awp', label: 'AWP' },
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
    // Our T halves.
    {
      id: 'tDefault', name: 'Default · A main, mid, B halls', side: 'T',
      calls: { default: { head: 'Default · A main, mid, B halls', sub: 'Take mid and main control, then hit the light site', steps: ['Smoke Z, take mid', 'Hold A main', 'Call contact'] } },
      spots: [
        { player: 'a', zone: 'amain', label: 'A main' }, { player: 'short', zone: 'mid', label: 'white box' },
        { player: 'b', zone: 'bhalls', label: 'B halls' }, { player: 'rotator', zone: 'garage', label: 'garage' }, { player: 'awp', zone: 'garage', label: 'garage AWP' },
      ],
    },
    {
      id: 'tExecA', name: 'A exec · main + squeaky', side: 'T', site: 'A',
      calls: { default: { head: 'Hit A · main + squeaky', sub: 'Smoke highway and truck, molly quad, flash main', steps: ['Smoke highway + truck', 'Flash main', 'Plant default'] } },
      spots: [
        { player: 'a', zone: 'amain', label: 'A main' }, { player: 'short', zone: 'amain', label: 'main flash' },
        { player: 'b', zone: 'ahalls', label: 'squeaky' }, { player: 'rotator', zone: 'amain', label: 'main smokes' }, { player: 'awp', zone: 'mid', label: 'mid AWP' },
      ],
    },
    {
      id: 'tExecB', name: 'B exec · main + vents', side: 'T', site: 'B',
      calls: { default: { head: 'Hit B · main + vents', sub: 'Smoke heaven and tree room, molly headshot, vents splits', steps: ['Smoke heaven + tree', 'Flash main', 'Vents drops in'] } },
      spots: [
        { player: 'a', zone: 'bmain', label: 'B main' }, { player: 'short', zone: 'bmain', label: 'main flash' },
        { player: 'b', zone: 'vents', label: 'vents' }, { player: 'rotator', zone: 'bmain', label: 'main smokes' }, { player: 'awp', zone: 'bhalls', label: 'B halls AWP' },
      ],
    },
    {
      id: 'tEco', name: 'Eco · B rush together', side: 'T', answers: ['eco'],
      calls: { default: { head: 'Eco · B rush together', sub: 'All five through B main at once · trade every duel', steps: ['Go together', 'Trade', 'Grab their guns'] } },
      spots: [
        { player: 'a', zone: 'bmain', label: 'B main' }, { player: 'short', zone: 'bmain', label: 'B main' },
        { player: 'b', zone: 'bhalls', label: 'B halls' }, { player: 'rotator', zone: 'bhalls', label: 'B halls' }, { player: 'awp', zone: 'bhalls', label: 'B halls' },
      ],
    },
    {
      id: 'tForce', name: 'Force · A main rush', side: 'T', answers: ['force'],
      calls: { default: { head: 'Force · A main rush', sub: 'Three through main fast, one squeaky, one mid for highway', steps: ['Flash main', 'Go fast', 'Trade'] } },
      spots: [
        { player: 'a', zone: 'amain', label: 'A main' }, { player: 'short', zone: 'amain', label: 'A main' },
        { player: 'b', zone: 'ahalls', label: 'squeaky' }, { player: 'rotator', zone: 'amain', label: 'A main' }, { player: 'awp', zone: 'mid', label: 'mid' },
      ],
    },
  ],
  jobs: {
    antieco: { a: 'Truck. Play deep for the retake, call A main or squeaky contact.', short: 'Highway. Long angle on mid only, fall back to truck on contact.', b: 'Headshot. Hold B main from the site, call numbers, never peek main.', rotator: 'Heaven. Hold checkers and the vents drop, trade the anchor.', awp: 'Tree room. Hold B main deep across the site, long angle only.' },
    std: { a: 'Quad. Hold A main and squeaky, molly main on a rush, fall back to truck.', short: 'Highway. Hold mid and catwalk, help A on contact, never push mid alone.', b: 'Headshot. Anchor B alone, hold B main and call contact fast.', rotator: 'Back hall. Hold checkers and the vents drop, rotate to B first.', awp: 'Connector AWP. Hold mid to garage and watch vents, fall back to CT if smoked.' },
    tDefault: { a: 'A main. Take control with a flash, call quad and squeaky contact.', short: 'White box. Smoke Z connector, flash out of garage, take mid.', b: "B halls. Lurk quiet, call B main numbers, don't peek headshot alone.", rotator: 'Garage. Watch vents and highway, read the map, call the hit.', awp: 'Garage AWP. Take the first pick down mid, then join the hit.' },
    tExecA: { a: 'A main. Swing first off the flash, clear quad and forklift.', short: 'Main flash. Molly quad, pop two flashes over main, trade the entry.', b: 'Squeaky. Open the door as main flashes pop, take the close corners.', rotator: 'A main. Smoke highway and truck, third onto site, plant default.', awp: 'Mid AWP. Hold Z connector to cut the rotation, then watch the flank.' },
    tExecB: { a: 'B main. First onto site off the flash, clear headshot, then back site.', short: 'Main flash. Molly headshot, pop two flashes over main, trade the entry.', b: 'Vents. Drop to checkers as main hits, clear it and pinch the site.', rotator: 'B main. Smoke heaven and tree room, third in, call the plant.', awp: 'B halls AWP. Hold the useless flank, then cover the plant from main.' },
    tEco: { a: 'B main. First onto site, clear headshot, trade fast.', short: 'B main. Right behind the entry, trade him.', b: 'B halls. Third in, clear back site with the fourth.', rotator: 'B halls. Fourth in, check checkers, pick up a gun.', awp: 'B halls. Last in, watch useless for the flank.' },
    tForce: { a: 'A main. First through off the flash, clear quad and forklift.', short: 'A main. Flash over main for the entry, trade him.', b: 'Squeaky. Open the door with the main flash, take the close corners.', rotator: 'A main. Smoke highway if you can, third in, plant default.', awp: 'Mid. Push toward highway to split their crossfire, watch Z.' },
  },
};
