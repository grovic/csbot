// Anubis: enemy (T) plans and our CT playbook. Routes are zones walked in order from T spawn
// (ids from maps/geo/de_anubis.ts). Plan odds by enemy buy are first estimates until demo data.

import type { MapPlans } from '../../forecast.ts';
import type { PlaybookDef } from '../../playbook.ts';

export const PLANS_ANUBIS: MapPlans = {
  map: 'de_anubis',
  routes: {
    B: ['ruins', 'outsidelong', 'bsite'],
    C: ['tstairs', 'canal', 'connector', 'bsite'],
    A: ['street', 'tsideupper*', 'main', 'asite'],
    W: ['tstairs', 'canal*', 'main', 'asite'],
    M: ['bridge', 'middle', 'walkway', 'asite'],
  },
  plans: [
    { id: 'bRush', name: 'B main rush', site: 'B', speed: 0.88, lineup: ['B', 'B', 'B', 'B', 'C'], delay: [1, 2, 3, 4, 0] },
    { id: 'bExec', name: 'B exec (main + connector)', site: 'B', speed: 0.6, lineup: ['B', 'B', 'B', 'C', 'C'], delay: [8, 10, 12, 3, 5] },
    { id: 'midB', name: 'Canal to B split (connector + main)', site: 'B', speed: 0.5, lineup: ['C', 'C', 'B', 'B', 'M'], delay: [2, 4, 10, 12, 3] },
    { id: 'aRush', name: 'A main rush', site: 'A', speed: 0.88, lineup: ['A', 'A', 'A', 'W', 'W'], delay: [0, 1, 2, 1, 3] },
    { id: 'aExec', name: 'A exec (main + water + walkway)', site: 'A', speed: 0.55, lineup: ['A', 'A', 'W', 'W', 'M'], delay: [6, 8, 5, 7, 4] },
    { id: 'midA', name: 'Mid to A split (walkway + main)', site: 'A', speed: 0.55, lineup: ['M', 'M', 'M', 'A', 'A'], delay: [2, 4, 6, 3, 5] },
    { id: 'slowA', name: 'Default → late A', site: 'A', speed: 0.4, lineup: ['A', 'A', 'W', 'M', 'B'], delay: [3, 6, 0, 2, 4] },
  ],
  planPriorByBuy: {
    eco: { bRush: 0.38, bExec: 0.1, midB: 0.08, aRush: 0.22, aExec: 0.06, midA: 0.06, slowA: 0.1 },
    force: { bRush: 0.26, bExec: 0.15, midB: 0.1, aRush: 0.18, aExec: 0.11, midA: 0.09, slowA: 0.11 },
    half: { bRush: 0.16, bExec: 0.18, midB: 0.12, aRush: 0.12, aExec: 0.16, midA: 0.13, slowA: 0.13 },
    full: { bRush: 0.05, bExec: 0.22, midB: 0.14, aRush: 0.05, aExec: 0.24, midA: 0.16, slowA: 0.14 },
  },
  defense: {
    setups: [
      { id: 'default', name: 'Standard 2-1-2', holds: ['asite', 'walkway', 'middle:mid', 'backofb', 'bsite'] },
      { id: 'stackA', name: 'Stack A (site + heaven + walkway)', holds: ['asite', 'asite', 'walkway', 'middle:mid', 'bsite'] },
      { id: 'stackB', name: 'Stack B (site + pillar + connector)', holds: ['asite', 'middle:mid', 'connector', 'bsite', 'bsite'] },
      { id: 'midPush', name: 'Mid control (mid doors + canal push)', holds: ['asite', 'middle:mid', 'middoors', 'canal', 'bsite'] },
      { id: 'bMainPush', name: 'B main push for info', holds: ['asite', 'walkway', 'middle:mid', 'outsidelong', 'bsite'] },
      { id: 'retake', name: 'Light sites, play the retake', holds: ['asite', 'tunnel', 'ctspawn', 'palaceinterior', 'bsite'] },
    ],
    priorByBuy: {
      eco: { default: 0.16, stackA: 0.22, stackB: 0.24, midPush: 0.14, bMainPush: 0.16, retake: 0.08 },
      force: { default: 0.26, stackA: 0.17, stackB: 0.18, midPush: 0.13, bMainPush: 0.14, retake: 0.12 },
      half: { default: 0.34, stackA: 0.14, stackB: 0.14, midPush: 0.13, bMainPush: 0.11, retake: 0.14 },
      full: { default: 0.42, stackA: 0.11, stackB: 0.11, midPush: 0.13, bMainPush: 0.09, retake: 0.14 },
    },
  },
};

export const PLAYBOOK_ANUBIS: PlaybookDef = {
  map: 'de_anubis',
  slots: [
    { id: 'a', label: 'A anchor' }, { id: 'short', label: 'Mid / walkway' }, { id: 'b', label: 'B anchor' },
    { id: 'rotator', label: 'Palace / rotator' }, { id: 'awp', label: 'AWP' },
  ],
  // The same five players on T: roles instead of positions.
  tSlots: [
    { id: 'a', label: 'Entry' }, { id: 'short', label: 'Support / flashes' }, { id: 'b', label: 'Lurk' },
    { id: 'rotator', label: 'IGL / flex' }, { id: 'awp', label: 'AWP' },
  ],
  setups: [
    {
      id: 'antieco', name: 'Anti-eco · stack B 3–2', side: 'CT', answers: ['eco'],
      calls: { default: { head: 'Anti-eco · stack B', sub: '3 on B · A site + Heaven AWP', steps: ['Long angles only', 'Trade in pairs'] } },
      spots: [
        { player: 'b', zone: 'bsite', label: 'B site' }, { player: 'short', zone: 'backofb', label: 'back of B' },
        { player: 'rotator', zone: 'alley', label: 'alley' }, { player: 'a', zone: 'asite', label: 'A site' }, { player: 'awp', zone: 'asite', label: 'Heaven AWP' },
      ],
    },
    {
      id: 'std', name: 'Standard 2-1-2', side: 'CT',
      calls: {
        default: { head: 'Standard 2-1-2', sub: 'AWP top mid · walkway for early info', steps: ['No dry peeks on bridge', 'A↔B via CT: 14 s'] },
        force: { head: 'Anti-force · play safe', sub: '2-1-2 · fall back on contact', steps: ['No early peeks', 'Rotate on 3+ seen'] },
      },
      spots: [
        { player: 'a', zone: 'asite', label: 'A site' }, { player: 'short', zone: 'walkway', label: 'walkway' },
        { player: 'awp', zone: 'middle', label: 'top mid AWP' }, { player: 'rotator', zone: 'palaceinterior', label: 'palace' }, { player: 'b', zone: 'bsite', label: 'B site' },
      ],
    },
    // Our T halves.
    {
      id: 'tDefault', name: 'Default · A main, canals, B main', side: 'T',
      calls: { default: { head: 'Default · A main, canals, B main', sub: 'Take control, then hit the light site', steps: ['Take A main', 'Canals + bridge', 'Call contact'] } },
      spots: [
        { player: 'a', zone: 'tsideupper', label: 'A main' }, { player: 'short', zone: 'canal', label: 'canals' },
        { player: 'b', zone: 'outsidelong', label: 'B main' }, { player: 'rotator', zone: 'bridge', label: 'bridge' }, { player: 'awp', zone: 'bridge', label: 'mid AWP' },
      ],
    },
    {
      id: 'tExecA', name: 'A exec · main + water', side: 'T', site: 'A',
      calls: { default: { head: 'Hit A · main + water', sub: 'Smoke Heaven, walkway and CT, flash over main', steps: ['Smoke Heaven + walkway', 'Flash main', 'Plant default'] } },
      spots: [
        { player: 'a', zone: 'main', label: 'A main' }, { player: 'short', zone: 'tsideupper', label: 'A main flash' },
        { player: 'b', zone: 'middle', label: 'mid' }, { player: 'rotator', zone: 'canal', label: 'water' }, { player: 'awp', zone: 'tsideupper', label: 'A main AWP' },
      ],
    },
    {
      id: 'tExecB', name: 'B exec · main + connector', side: 'T', site: 'B',
      calls: { default: { head: 'Hit B · main + connector', sub: 'Smoke alley and palace, flash over main, pinch from connector', steps: ['Smoke alley + palace', 'Flash main', 'Plant safe'] } },
      spots: [
        { player: 'a', zone: 'outsidelong', label: 'B main entry' }, { player: 'short', zone: 'outsidelong', label: 'B main flash' },
        { player: 'b', zone: 'connector', label: 'connector' }, { player: 'rotator', zone: 'outsidelong', label: 'B main' }, { player: 'awp', zone: 'canal', label: 'canals' },
      ],
    },
    {
      id: 'tEco', name: 'Eco · B main rush together', side: 'T', answers: ['eco'],
      calls: { default: { head: 'Eco · B main rush together', sub: 'All five out of B main at once · trade every duel', steps: ['Go together', 'Trade', 'Grab their guns'] } },
      spots: [
        { player: 'a', zone: 'outsidelong', label: 'B main' }, { player: 'short', zone: 'outsidelong', label: 'B main' },
        { player: 'b', zone: 'outsidelong', label: 'B main' }, { player: 'rotator', zone: 'ruins', label: 'ruins' }, { player: 'awp', zone: 'ruins', label: 'ruins' },
      ],
    },
    {
      id: 'tForce', name: 'Force · A main + water rush', side: 'T', answers: ['force'],
      calls: { default: { head: 'Force · A main + water rush', sub: 'Three up A main, two up water · hit at the same time', steps: ['Flash main', 'Go fast', 'Trade'] } },
      spots: [
        { player: 'a', zone: 'main', label: 'A main' }, { player: 'short', zone: 'tsideupper', label: 'A main' },
        { player: 'b', zone: 'canal', label: 'water' }, { player: 'rotator', zone: 'tsideupper', label: 'A main' }, { player: 'awp', zone: 'canal', label: 'water' },
      ],
    },
  ],
  jobs: {
    antieco: {
      a: 'A site alone. Play deep off A main and walkway, fall back to CT on contact.',
      short: 'Back of B. Hold the connector exit, long angles only.',
      b: 'B site. Hold B main from deep, never peek out toward ruins.',
      rotator: 'Alley. Trade the B anchor, rotate to A through CT if called.',
      awp: 'Heaven AWP. Hold A main from Heaven, don\'t chase.',
    },
    std: {
      a: 'A site. Hold A main and water, crossfire with walkway.',
      short: 'Walkway. Early look at mid, then help A on contact.',
      b: 'B site. Anchor alone on B main, call connector contact fast.',
      rotator: 'Palace. Help B on connector pushes, cover top mid if the AWP falls.',
      awp: 'Top mid AWP. Hold the bridge, never peek mid doors early.',
    },
    tDefault: {
      a: 'A main. Take control with a flash, call what holds the site.',
      short: 'Canals. Flash your way into the water, trade A main or the bridge.',
      b: "B main. Lurk quiet, call B numbers, don't peek alone.",
      rotator: 'Bridge. Smoke mid doors after the AWP looks, read the map, call the hit.',
      awp: 'Mid AWP. Look for the first pick down mid from the bridge, then join the hit.',
    },
    tExecA: {
      a: 'A main. First onto the site off the flash, clear the close corners and default.',
      short: 'A main flash. Pop flashes over main for the entry, then trade him.',
      b: 'Mid. Hold mid for the rotate, push walkway once the smoke fades to pinch.',
      rotator: 'Water. Smoke Heaven and walkway, push up water when main hits, call the plant.',
      awp: 'A main AWP. Smoke CT, then hold the site from main and cover the plant.',
    },
    tExecB: {
      a: 'B main. First onto the site after the flash, clear pillar and the close corners.',
      short: 'B main flash. Pop flashes over the site for the entry, then trade him.',
      b: 'Connector. Molly back of B as main hits, push through once it burns out.',
      rotator: 'B main. Smoke alley and palace, then plant safe behind the smokes.',
      awp: 'Canals. Watch mid for the flank, then hold connector and cover the plant.',
    },
    tEco: {
      a: 'B main. First onto the site, aim for the anchor, trade fast.',
      short: 'B main. Right behind the entry, flash if you have one, trade him.',
      b: 'B main. Third in, clear pillar and back of B with the second.',
      rotator: 'Ruins. Come in fourth, pick up a gun.',
      awp: 'Ruins. Last in, watch connector for the flank.',
    },
    tForce: {
      a: 'A main. First onto the site off the flash, clear the close corners.',
      short: 'A main. Flash over main for the entry and trade him.',
      b: 'Water. Hit with main, take the walkway side of the site for the crossfire.',
      rotator: 'A main. Smoke Heaven if you bought one, plant default.',
      awp: 'Water. Last up, watch walkway and mid for the flank, hold the plant.',
    },
  },
};
