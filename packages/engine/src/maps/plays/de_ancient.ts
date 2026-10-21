// Ancient: enemy (T) plans and our CT playbook. Routes are zones walked in order from T spawn
// (ids from maps/geo/de_ancient.ts). Plan odds by enemy buy are first estimates until demo data.
// The zone `sideentrance` (shown as "Cave") is the mid-to-B cave.

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
  // Enemy CT setups for our T halves: one hold zone per defender. B is far from CT spawn, so low buys
  // lean towards stacking it.
  defense: {
    setups: [
      { id: 'default', name: 'Standard 2-1-2 (donut, top mid, cave)', holds: ['asite', 'sidehall', 'topofmid', 'sideentrance', 'bsite'] },
      { id: 'stackA', name: 'Stack A (main + donut)', holds: ['asite', 'asite', 'sidehall', 'topofmid', 'bsite'] },
      { id: 'stackB', name: 'Stack B (site + cave)', holds: ['asite', 'topofmid', 'sideentrance', 'bsite', 'bsite'] },
      { id: 'midPush', name: 'Mid control push (3 mid)', holds: ['asite', 'topofmid', 'middle', 'middle', 'bsite'] },
      { id: 'retake', name: 'Light sites, play the retake', holds: ['asite', 'ctspawn', 'house', 'alley', 'bsite'] },
    ],
    priorByBuy: {
      eco: { default: 0.2, stackA: 0.25, stackB: 0.27, midPush: 0.18, retake: 0.1 },
      force: { default: 0.3, stackA: 0.18, stackB: 0.2, midPush: 0.18, retake: 0.14 },
      half: { default: 0.38, stackA: 0.15, stackB: 0.15, midPush: 0.17, retake: 0.15 },
      full: { default: 0.44, stackA: 0.11, stackB: 0.11, midPush: 0.19, retake: 0.15 },
    },
  },
};

export const PLAYBOOK_ANCIENT: PlaybookDef = {
  map: 'de_ancient',
  slots: [
    { id: 'a', label: 'A anchor' }, { id: 'short', label: 'Donut / A support' }, { id: 'b', label: 'B anchor' },
    { id: 'rotator', label: 'Mid / cave' }, { id: 'awp', label: 'AWP' },
  ],
  // The same five players on T: roles instead of positions.
  tSlots: [
    { id: 'a', label: 'Entry' }, { id: 'short', label: 'Support / flashes' }, { id: 'b', label: 'Lurk' },
    { id: 'rotator', label: 'IGL / flex' }, { id: 'awp', label: 'AWP' },
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
    // Our T halves.
    {
      id: 'tDefault', name: 'Default · A main, mid, B lane', side: 'T',
      calls: { default: { head: 'Default · A main, mid, B lane', sub: 'Take mid control, then hit the light site', steps: ['Smoke top mid', 'Take mid', 'Call contact'] } },
      spots: [
        { player: 'a', zone: 'mainhall', label: 'A main' }, { player: 'short', zone: 'middle', label: 'mid' },
        { player: 'b', zone: 'tsidelower', label: 'B lane' }, { player: 'rotator', zone: 'middle', label: 'mid' }, { player: 'awp', zone: 'tsideupper', label: 'cave entrance AWP' },
      ],
    },
    {
      id: 'tExecA', name: 'A exec · main + donut', side: 'T', site: 'A',
      calls: { default: { head: 'Hit A · main + donut', sub: 'Smoke CT and top mid, flash Elbow, donut splits', steps: ['Smoke CT + top mid', 'Flash Elbow', 'Plant default'] } },
      spots: [
        { player: 'a', zone: 'mainhall', label: 'Elbow' }, { player: 'short', zone: 'mainhall', label: 'Elbow flash' },
        { player: 'b', zone: 'sidehall', label: 'donut' }, { player: 'rotator', zone: 'mainhall', label: 'A main' }, { player: 'awp', zone: 'sidehall', label: 'donut AWP' },
      ],
    },
    {
      id: 'tExecB', name: 'B exec · ramp + cave', side: 'T', site: 'B',
      calls: { default: { head: 'Hit B · ramp + cave', sub: 'Smoke CT, flash over ramp, cave splits the site', steps: ['Smoke CT', 'Flash ramp', 'Cave splits'] } },
      spots: [
        { player: 'a', zone: 'ramp', label: 'B ramp' }, { player: 'short', zone: 'ramp', label: 'ramp flash' },
        { player: 'b', zone: 'sideentrance', label: 'cave' }, { player: 'rotator', zone: 'tsidelower', label: 'B lane' }, { player: 'awp', zone: 'sideentrance', label: 'cave AWP' },
      ],
    },
    {
      id: 'tEco', name: 'Eco · B ramp rush together', side: 'T', answers: ['eco'],
      calls: { default: { head: 'Eco · B rush together', sub: 'All five up ramp at once · trade every duel', steps: ['Go together', 'Trade', 'Grab their guns'] } },
      spots: [
        { player: 'a', zone: 'ramp', label: 'B ramp' }, { player: 'short', zone: 'ramp', label: 'B ramp' },
        { player: 'b', zone: 'ramp', label: 'B ramp' }, { player: 'rotator', zone: 'tsidelower', label: 'B lane' }, { player: 'awp', zone: 'tsidelower', label: 'B lane' },
      ],
    },
    {
      id: 'tForce', name: 'Force · A main rush', side: 'T', answers: ['force'],
      calls: { default: { head: 'Force · A main rush', sub: 'Four through main fast, one donut for the crossfire', steps: ['Flash Elbow', 'Go fast', 'Trade'] } },
      spots: [
        { player: 'a', zone: 'mainhall', label: 'Elbow' }, { player: 'short', zone: 'mainhall', label: 'A main' },
        { player: 'b', zone: 'mainhall', label: 'A main' }, { player: 'rotator', zone: 'mainhall', label: 'A main' }, { player: 'awp', zone: 'sidehall', label: 'donut' },
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
    tDefault: {
      a: 'A main. Walk up to Elbow, flash out for info, call what holds A.',
      short: 'Mid. Flash top mid as the IGL pushes, then take donut control.',
      b: "B lane. Lurk quiet near ramp, call B numbers, don't peek alone.",
      rotator: 'Mid. Smoke top mid, take mid control, read the map and call the hit.',
      awp: 'Cave entrance AWP. Hold cave for the early CT push, take the first pick, then join the hit.',
    },
    tExecA: {
      a: 'Elbow. Swing first off the flash, clear the close corners, push deep.',
      short: 'Elbow flash. Pop it over Elbow for the entry, then trade him.',
      b: 'Donut. Smoke top mid behind you, then push out of donut as main hits.',
      rotator: 'A main. Smoke CT from main, molly the close corner past Elbow, then plant default.',
      awp: 'Donut AWP. Second through donut, hold the CT rotate, then cover the plant.',
    },
    tExecB: {
      a: 'B ramp. First up off the flash, clear close and back site.',
      short: 'Ramp flash. Pop it over the top of ramp, trade the entry.',
      b: 'Cave. Flash out of cave when ramp hits, clear the near side, trade.',
      rotator: 'B lane. Smoke CT to cut the alley rotate, molly back site, then plant.',
      awp: 'Cave AWP. Second out of cave, hold the CT rotate, then cover the plant.',
    },
    tEco: {
      a: 'B ramp. First up, aim for the anchor, trade fast.',
      short: 'B ramp. Right behind the entry, flash if you have one, trade him.',
      b: 'B ramp. Third up, clear back site.',
      rotator: 'B lane. Come up fourth, pick up a gun, help the plant.',
      awp: 'B lane. Last in, watch cave for the CT flank.',
    },
    tForce: {
      a: 'Elbow. First out onto A, clear the close corners, keep moving.',
      short: 'A main. Flash over Elbow and trade the entry.',
      b: 'A main. Third in, clear deep site toward CT.',
      rotator: 'A main. Smoke CT on the way in, plant default.',
      awp: 'Donut. Push donut with the rush to split their crossfire.',
    },
  },
};
