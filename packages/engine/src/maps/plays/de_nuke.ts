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
  defense: {
    setups: [
      { id: 'default', name: 'Standard (heaven, A, garage, ramp, B)', holds: ['heaven', 'asite', 'garage:mid', 'ramp:B', 'bsite'] },
      { id: 'stackA', name: 'Stack A (ramp to hell, outside to mini)', holds: ['heaven', 'asite', 'hell:A', 'mini', 'bsite'] },
      { id: 'stackB', name: 'Stack B (ramp + secret + 2 on B)', holds: ['heaven', 'ramp:B', 'secret:B', 'bsite', 'bsite'] },
      { id: 'outsidePush', name: 'Outside push for picks', holds: ['heaven', 'outside:mid', 'outside:mid', 'ramp:B', 'bsite'] },
      { id: 'retakeB', name: 'Light B, ramp + admin retake', holds: ['heaven', 'asite', 'garage:mid', 'ramp:B', 'admin'] },
    ],
    priorByBuy: {
      eco: { default: 0.18, stackA: 0.28, stackB: 0.22, outsidePush: 0.2, retakeB: 0.12 },
      force: { default: 0.28, stackA: 0.22, stackB: 0.18, outsidePush: 0.18, retakeB: 0.14 },
      half: { default: 0.36, stackA: 0.17, stackB: 0.14, outsidePush: 0.16, retakeB: 0.17 },
      full: { default: 0.45, stackA: 0.13, stackB: 0.1, outsidePush: 0.15, retakeB: 0.17 },
    },
  },
};

export const PLAYBOOK_NUKE: PlaybookDef = {
  map: 'de_nuke',
  slots: [
    { id: 'a', label: 'A anchor' }, { id: 'short', label: 'Outside / mini' }, { id: 'b', label: 'B anchor' },
    { id: 'rotator', label: 'Ramp' }, { id: 'awp', label: 'AWP' },
  ],
  // The same five players on T: roles instead of positions.
  tSlots: [
    { id: 'a', label: 'Entry' }, { id: 'short', label: 'Support / flashes' }, { id: 'b', label: 'Lurk' },
    { id: 'rotator', label: 'IGL / flex' }, { id: 'awp', label: 'AWP' },
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
    // Our T halves.
    {
      id: 'tDefault', name: 'Default · outside, lobby, ramp', side: 'T',
      calls: { default: { head: 'Default · outside, lobby, ramp', sub: 'Take ramp and outside, then hit the light site', steps: ['Take ramp', 'Take outside', 'Call contact'] } },
      spots: [
        { player: 'a', zone: 'ramp', label: 'ramp' }, { player: 'short', zone: 'control', label: 'control' },
        { player: 'b', zone: 'lobby', label: 'lobby' }, { player: 'rotator', zone: 'outside', label: 'outside' }, { player: 'awp', zone: 'silo', label: 'silo AWP' },
      ],
    },
    {
      id: 'tExecA', name: 'A exec · hut + squeaky', side: 'T', site: 'A',
      calls: { default: { head: 'Hit A · hut + squeaky', sub: 'Smoke heaven and mini, lobby flash, hut and squeaky together', steps: ['Smoke heaven + mini', 'Lobby flash', 'Hit together'] } },
      spots: [
        { player: 'a', zone: 'hut', label: 'hut' }, { player: 'short', zone: 'lobby', label: 'lobby flash' },
        { player: 'b', zone: 'control', label: 'control' }, { player: 'rotator', zone: 'squeaky', label: 'squeaky' }, { player: 'awp', zone: 'roof', label: 'roof AWP' },
      ],
    },
    {
      id: 'tExecB', name: 'B exec · ramp + secret', side: 'T', site: 'B',
      calls: { default: { head: 'Hit B · ramp + secret', sub: 'Molly headshot, smoke doors, flash down ramp, secret splits', steps: ['Molly headshot', 'Smoke doors', 'Flash down ramp'] } },
      spots: [
        { player: 'a', zone: 'ramp', label: 'ramp entry' }, { player: 'short', zone: 'ramp', label: 'ramp flash' },
        { player: 'b', zone: 'secret', label: 'secret' }, { player: 'rotator', zone: 'control', label: 'control' }, { player: 'awp', zone: 'ramp', label: 'back ramp AWP' },
      ],
    },
    {
      id: 'tEco', name: 'Eco · A rush together', side: 'T', answers: ['eco'],
      calls: { default: { head: 'Eco · A rush together', sub: 'All five through hut and squeaky at once · trade every duel', steps: ['Go together', 'Trade', 'Grab their guns'] } },
      spots: [
        { player: 'a', zone: 'hut', label: 'hut' }, { player: 'short', zone: 'squeaky', label: 'squeaky' },
        { player: 'b', zone: 'hut', label: 'hut' }, { player: 'rotator', zone: 'squeaky', label: 'squeaky' }, { player: 'awp', zone: 'lobby', label: 'lobby' },
      ],
    },
    {
      id: 'tForce', name: 'Force · ramp rush B', side: 'T', answers: ['force'],
      calls: { default: { head: 'Force · ramp rush B', sub: 'Flash ramp, molly headshot, all five down to B fast', steps: ['Flash ramp', 'Go fast', 'Trade'] } },
      spots: [
        { player: 'a', zone: 'ramp', label: 'ramp' }, { player: 'short', zone: 'control', label: 'control' },
        { player: 'b', zone: 'ramp', label: 'ramp' }, { player: 'rotator', zone: 'ramp', label: 'top of ramp' }, { player: 'awp', zone: 'lobby', label: 'lobby' },
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
    tDefault: {
      a: 'Ramp. Take the ramp room off the control flash, clear headshot, call what holds B.',
      short: 'Control. Flash into ramp for your entry and molly headshot, then trade him.',
      b: "Lobby. Lurk quiet by hut and squeaky, call A numbers, don't open squeaky alone.",
      rotator: 'Outside. Smoke CT red, take outside with the AWP, read the map and call the hit.',
      awp: 'Silo AWP. Hold outside for a garage or mini peek, take the first pick, then join the call.',
    },
    tExecA: {
      a: 'Hut. First on site off the lobby flash, clear rafters and the close corners.',
      short: 'Lobby flash. Pop it over hut and squeaky for the entry, then trade through hut.',
      b: 'Control. Hold the ramp flank during the hit, call a CT push, then join late.',
      rotator: 'Squeaky. Smoke mini, open the door with the hut entry, then call the plant.',
      awp: 'Roof AWP. Smoke heaven first, then hold outside for the main and mini rotate.',
    },
    tExecB: {
      a: 'Ramp entry. First down to B off the flash, clear the close corners, then decon.',
      short: 'Ramp flash. Smoke doors, flash down ramp for the entry, then trade him.',
      b: 'Secret. Smoke garage as you cross outside, drop secret, come in through dark on the hit.',
      rotator: 'Control. Molly headshot to take ramp, go down third, call the plant.',
      awp: 'Back ramp AWP. Hold the ramp exit through the hit, then hold the plant from back ramp.',
    },
    tEco: {
      a: 'Hut. First in, aim for the A anchor, trade fast.',
      short: 'Squeaky. Open the door as hut goes, trade the first duel.',
      b: 'Hut. Right behind the entry, trade him, clear rafters.',
      rotator: 'Squeaky. Second through the door, clear the site, pick up a gun.',
      awp: 'Lobby. Last in, watch the ramp flank through control, grab a rifle.',
    },
    tForce: {
      a: 'Ramp. First down to B off the flash, clear the close corners.',
      short: 'Control. Flash into ramp and down to B, trade the entry.',
      b: 'Ramp. Third in, clear decon and watch doors.',
      rotator: 'Top of ramp. Molly headshot, follow down, plant and call the post-plant.',
      awp: 'Lobby. Watch the hut and squeaky flank, then hold the plant from back ramp.',
    },
  },
};
