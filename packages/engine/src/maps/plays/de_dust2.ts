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
  // Enemy CT setups for our T halves: one hold zone per defender.
  defense: {
    setups: [
      { id: 'default', name: 'Standard 2-1-2', holds: ['longa', 'asite', 'middoors', 'bsite', 'bsite'] },
      { id: 'stackA', name: 'Stack A (long + short)', holds: ['longa', 'asite', 'shortstairs', 'middoors', 'bsite'] },
      { id: 'stackB', name: 'Stack B (3 on B)', holds: ['asite', 'middoors', 'bdoors', 'bsite', 'bsite'] },
      { id: 'longPush', name: 'Long push for info', holds: ['longdoors', 'longa', 'asite', 'middoors', 'bsite'] },
      { id: 'retake', name: 'Light sites, play the retake', holds: ['asite', 'ctspawn', 'middoors', 'bdoors', 'bsite'] },
    ],
    priorByBuy: {
      eco: { default: 0.2, stackA: 0.25, stackB: 0.25, longPush: 0.2, retake: 0.1 },
      force: { default: 0.3, stackA: 0.18, stackB: 0.18, longPush: 0.2, retake: 0.14 },
      half: { default: 0.38, stackA: 0.15, stackB: 0.15, longPush: 0.17, retake: 0.15 },
      full: { default: 0.45, stackA: 0.12, stackB: 0.12, longPush: 0.16, retake: 0.15 },
    },
  },
};

export const PLAYBOOK_DUST2: PlaybookDef = {
  map: 'de_dust2',
  slots: [
    { id: 'a', label: 'Long A' }, { id: 'short', label: 'Short / Cat' }, { id: 'b', label: 'B anchor' },
    { id: 'rotator', label: 'Mid / rotator' }, { id: 'awp', label: 'AWP' },
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
    // Our T halves.
    {
      id: 'tDefault', name: 'Default · long, mid, tunnels', side: 'T',
      calls: { default: { head: 'Default · long, mid, tunnels', sub: 'Take control, then hit the light site', steps: ['Take long', 'Mid control', 'Call contact'] } },
      spots: [
        { player: 'a', zone: 'longdoors', label: 'long doors' }, { player: 'short', zone: 'outsidelong', label: 'outside long' },
        { player: 'b', zone: 'uppertunnel', label: 'upper tunnels' }, { player: 'rotator', zone: 'topofmid', label: 'top mid' }, { player: 'awp', zone: 'topofmid', label: 'mid AWP' },
      ],
    },
    {
      id: 'tExecA', name: 'A exec · long + short', side: 'T', site: 'A',
      calls: { default: { head: 'Hit A · long + short', sub: 'Smoke cross and CT, flash long, cat from short', steps: ['Smoke CT + cross', 'Flash long', 'Plant default'] } },
      spots: [
        { player: 'a', zone: 'longa', label: 'long' }, { player: 'short', zone: 'longa', label: 'long flash' },
        { player: 'b', zone: 'catwalk', label: 'cat' }, { player: 'rotator', zone: 'catwalk', label: 'cat' }, { player: 'awp', zone: 'longdoors', label: 'long doors AWP' },
      ],
    },
    {
      id: 'tExecB', name: 'B exec · tunnels', side: 'T', site: 'B',
      calls: { default: { head: 'Hit B · tunnels', sub: 'Smoke doors and window, flash out of tunnels', steps: ['Smoke doors + window', 'Flash out', 'Plant safe'] } },
      spots: [
        { player: 'a', zone: 'uppertunnel', label: 'tunnels entry' }, { player: 'short', zone: 'uppertunnel', label: 'tunnels flash' },
        { player: 'b', zone: 'lowertunnel', label: 'lower tunnels' }, { player: 'rotator', zone: 'uppertunnel', label: 'tunnels' }, { player: 'awp', zone: 'outsidetunnel', label: 'outside tunnels' },
      ],
    },
    {
      id: 'tEco', name: 'Eco · B rush together', side: 'T', answers: ['eco'],
      calls: { default: { head: 'Eco · B rush together', sub: 'All five through tunnels at once · trade every duel', steps: ['Go together', 'Trade', 'Grab their guns'] } },
      spots: [
        { player: 'a', zone: 'uppertunnel', label: 'tunnels' }, { player: 'short', zone: 'uppertunnel', label: 'tunnels' },
        { player: 'b', zone: 'uppertunnel', label: 'tunnels' }, { player: 'rotator', zone: 'outsidetunnel', label: 'outside tunnels' }, { player: 'awp', zone: 'outsidetunnel', label: 'outside tunnels' },
      ],
    },
    {
      id: 'tForce', name: 'Force · long rush', side: 'T', answers: ['force'],
      calls: { default: { head: 'Force · long rush', sub: 'Four through long doors fast, one cat for the crossfire', steps: ['Flash doors', 'Go fast', 'Trade'] } },
      spots: [
        { player: 'a', zone: 'longdoors', label: 'long doors' }, { player: 'short', zone: 'longdoors', label: 'long doors' },
        { player: 'b', zone: 'outsidelong', label: 'outside long' }, { player: 'rotator', zone: 'outsidelong', label: 'outside long' }, { player: 'awp', zone: 'catwalk', label: 'cat' },
      ],
    },
  ],
  jobs: {
    antieco: { a: 'Long corner. Long angles only, fall back on 2+.', short: 'B doors. Crossfire tunnels with the B anchor.', b: 'B site. Hold the tunnels exit from the back plat.', rotator: 'B back plat. Trade the anchor, never peek tunnels.', awp: 'A site AWP. Hold long and cat from the site.' },
    std: { a: 'Long corner. Hold long doors, fall back to the site on contact.', short: 'Short. Hold cat in a crossfire with the A site.', b: 'B site. Anchor alone and call tunnels contact fast.', rotator: 'Mid doors. Early look at mid, then rotate where called.', awp: 'A site AWP. Hold long from the site, never peek long doors.' },
    tDefault: { a: 'Long doors. Take control with a flash, call what holds long.', short: 'Outside long. Flash your entry through doors, trade him.', b: "Upper tunnels. Lurk quiet, call B numbers, don't peek alone.", rotator: 'Top mid. Smoke mid doors, read the map, call the hit.', awp: 'Mid AWP. Take the first pick down mid, then join the hit.' },
    tExecA: { a: 'Long. Swing first off the flash, clear pit and car.', short: 'Long flash. Pop it over doors, trade the entry.', b: 'Cat. Smoke CT from short, push up when long hits.', rotator: 'Cat. Second through short, clear goose, call the plant.', awp: 'Long doors AWP. Hold cross after the smoke, then hold the plant.' },
    tExecB: { a: 'Tunnels entry. First out after the flash, clear close left.', short: 'Tunnels flash. Pop it over the exit, trade the entry.', b: 'Lower tunnels. Watch mid doors, then join through lower.', rotator: 'Tunnels. Smoke doors and window, then plant.', awp: 'Outside tunnels. Hold the flank, then cover the plant from tunnels.' },
    tEco: { a: 'Tunnels. First out, aim for the anchor, trade fast.', short: 'Tunnels. Right behind the entry, trade him.', b: 'Tunnels. Clear back plat with the third.', rotator: 'Outside tunnels. Come in fourth, pick up a gun.', awp: 'Outside tunnels. Last in, watch the flank.' },
    tForce: { a: 'Long doors. First through, clear blue and pit.', short: 'Long doors. Flash and trade the entry.', b: 'Outside long. Third in, take car.', rotator: 'Outside long. Watch the CT cross, plant default.', awp: 'Cat. Pressure short to split their crossfire.' },
  },
};
