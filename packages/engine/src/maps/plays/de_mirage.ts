// Mirage: enemy (T) plans and our CT playbook. Routes are zones walked in order from T spawn
// (ids from maps/geo/de_mirage.ts). Plan odds by enemy buy are first estimates until demo data.

import type { MapPlans } from '../../forecast.ts';
import type { PlaybookDef } from '../../playbook.ts';

export const PLANS_MIRAGE: MapPlans = {
  map: 'de_mirage',
  routes: {
    B: ['house', 'backalley', 'bapps*', 'bsite'],
    A: ['palalley', 'aramp*', 'asite'],
    P: ['palace*', 'asite'],
    M: ['topmid', 'mid*', 'conn*', 'asite'],
    S: ['topmid', 'mid*', 'short*', 'bsite'],
    U: ['topmid', 'mid*', 'under*', 'bsite'],
  },
  plans: [
    { id: 'bRush', name: 'B apps rush', site: 'B', speed: 0.9, lineup: ['B', 'B', 'B', 'B', 'S'], delay: [0, 1, 2, 3, 0] },
    { id: 'bExec', name: 'B exec (apps + short)', site: 'B', speed: 0.6, lineup: ['B', 'B', 'B', 'S', 'S'], delay: [6, 8, 10, 4, 7] },
    { id: 'aExec', name: 'A exec (ramp + palace)', site: 'A', speed: 0.55, lineup: ['A', 'A', 'P', 'P', 'M'], delay: [9, 11, 9, 11, 6] },
    { id: 'split', name: 'Mid-to-A split', site: 'A', speed: 0.5, lineup: ['M', 'M', 'P', 'A', 'U'], delay: [4, 7, 10, 10, 8] },
    { id: 'slowB', name: 'Default → late B', site: 'B', speed: 0.35, lineup: ['S', 'M', 'B', 'P', 'U'], delay: [0, 2, 4, 6, 3] },
  ],
  planPriorByBuy: {
    eco: { bRush: 0.52, bExec: 0.12, aExec: 0.12, split: 0.08, slowB: 0.16 },
    force: { bRush: 0.3, bExec: 0.2, aExec: 0.22, split: 0.13, slowB: 0.15 },
    half: { bRush: 0.22, bExec: 0.22, aExec: 0.26, split: 0.15, slowB: 0.15 },
    full: { bRush: 0.06, bExec: 0.26, aExec: 0.36, split: 0.18, slowB: 0.14 },
  },
  // Enemy CT setups for our T halves: one hold zone per defender (`:mid` = counts toward neither site).
  defense: {
    setups: [
      { id: 'default', name: 'Standard (A, connector, window, short, B)', holds: ['asite', 'conn:mid', 'window:mid', 'short:mid', 'bsite'] },
      { id: 'stackA', name: 'Stack A (ramp + palace)', holds: ['asite', 'asite', 'jungle', 'window:mid', 'bsite'] },
      { id: 'stackB', name: 'Stack B (market + van)', holds: ['asite', 'short', 'market', 'bsite', 'bsite'] },
      { id: 'midPush', name: 'Aggressive mid (top mid + short)', holds: ['asite', 'topmid', 'short', 'window:mid', 'bsite'] },
      { id: 'retake', name: 'Light sites, play the retake', holds: ['asite', 'ctspawn', 'ctspawn', 'market', 'bsite'] },
    ],
    priorByBuy: {
      eco: { default: 0.2, stackA: 0.25, stackB: 0.25, midPush: 0.2, retake: 0.1 },
      force: { default: 0.3, stackA: 0.18, stackB: 0.18, midPush: 0.2, retake: 0.14 },
      half: { default: 0.38, stackA: 0.15, stackB: 0.15, midPush: 0.17, retake: 0.15 },
      full: { default: 0.45, stackA: 0.12, stackB: 0.12, midPush: 0.16, retake: 0.15 },
    },
  },
};

export const PLAYBOOK_MIRAGE: PlaybookDef = {
  map: 'de_mirage',
  slots: [
    { id: 'a', label: 'A anchor' }, { id: 'short', label: 'Short / B support' }, { id: 'b', label: 'B anchor' },
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
      calls: { default: { head: 'Anti-eco · stack B', sub: '3 on B · 1 on A · AWP in window', steps: ['Long angles only', 'Trade in pairs'] } },
      spots: [
        { player: 'b', zone: 'bsite', label: 'B van' }, { player: 'short', zone: 'bsite', label: 'B bench' },
        { player: 'rotator', zone: 'market', label: 'market' }, { player: 'awp', zone: 'window', label: 'window AWP' }, { player: 'a', zone: 'asite', label: 'A' },
      ],
    },
    {
      id: 'std', name: 'Standard 2-1-2', side: 'CT',
      calls: {
        default: { head: 'Standard 2-1-2', sub: 'AWP in window · early info from short', steps: ['No dry-peek on top mid', 'Rotate via CT: 9 s'] },
        force: { head: 'Anti-force · play safe', sub: '2-1-2 · fall back on contact', steps: ['No early peeks', 'Rotate on 3+ seen'] },
      },
      spots: [
        { player: 'b', zone: 'bsite', label: 'B van' }, { player: 'short', zone: 'short', label: 'short' },
        { player: 'awp', zone: 'window', label: 'window AWP' }, { player: 'rotator', zone: 'asite', label: 'ticket' }, { player: 'a', zone: 'asite', label: 'A site' },
      ],
    },
    // Our T halves.
    {
      id: 'tDefault', name: 'Default · ramp, mid, apps', side: 'T',
      calls: { default: { head: 'Default · ramp, mid, apps', sub: 'Smoke window, take control, then hit the light site', steps: ['Smoke window', 'Take short', 'Call contact'] } },
      spots: [
        { player: 'a', zone: 'aramp', label: 'A ramp' }, { player: 'short', zone: 'short', label: 'short' },
        { player: 'b', zone: 'bapps', label: 'B apps' }, { player: 'rotator', zone: 'palace', label: 'palace' }, { player: 'awp', zone: 'topmid', label: 'top mid AWP' },
      ],
    },
    {
      id: 'tExecA', name: 'A exec · ramp + palace', side: 'T', site: 'A',
      calls: { default: { head: 'Hit A · ramp + palace', sub: 'Smoke jungle, CT and stairs, flash out together', steps: ['Smoke jungle + CT', 'Flash ramp', 'Plant default'] } },
      spots: [
        { player: 'a', zone: 'aramp', label: 'A ramp' }, { player: 'short', zone: 'aramp', label: 'ramp flash' },
        { player: 'b', zone: 'bapps', label: 'B apps' }, { player: 'rotator', zone: 'palace', label: 'palace' }, { player: 'awp', zone: 'topmid', label: 'top mid' },
      ],
    },
    {
      id: 'tExecB', name: 'B exec · apps + short', side: 'T', site: 'B',
      calls: { default: { head: 'Hit B · apps + short', sub: 'Smoke market window and door, flash out of apps', steps: ['Smoke market', 'Flash apps', 'Plant safe'] } },
      spots: [
        { player: 'a', zone: 'bapps', label: 'apps entry' }, { player: 'short', zone: 'bapps', label: 'apps flash' },
        { player: 'b', zone: 'palace', label: 'palace' }, { player: 'rotator', zone: 'short', label: 'short' }, { player: 'awp', zone: 'topmid', label: 'top mid AWP' },
      ],
    },
    {
      id: 'tEco', name: 'Eco · B apps rush together', side: 'T', answers: ['eco'],
      calls: { default: { head: 'Eco · B apps rush together', sub: 'All five out of apps at once · trade every duel', steps: ['Go together', 'Trade', 'Grab their guns'] } },
      spots: [
        { player: 'a', zone: 'bapps', label: 'apps' }, { player: 'short', zone: 'bapps', label: 'apps' },
        { player: 'b', zone: 'bapps', label: 'apps' }, { player: 'rotator', zone: 'backalley', label: 'back alley' }, { player: 'awp', zone: 'backalley', label: 'back alley' },
      ],
    },
    {
      id: 'tForce', name: 'Force · A ramp + palace', side: 'T', answers: ['force'],
      calls: { default: { head: 'Force · A ramp + palace', sub: 'Ramp and palace hit together, fast · one mid for the cross', steps: ['Flash ramp', 'Go fast', 'Trade'] } },
      spots: [
        { player: 'a', zone: 'aramp', label: 'A ramp' }, { player: 'short', zone: 'aramp', label: 'A ramp' },
        { player: 'b', zone: 'palace', label: 'palace' }, { player: 'rotator', zone: 'palace', label: 'palace' }, { player: 'awp', zone: 'topmid', label: 'top mid' },
      ],
    },
  ],
  jobs: {
    antieco: { a: 'A site alone. Play deep and fall back to CT on contact.', short: 'B bench. Hold the apps exit, long angles only.', b: 'B van. Anchor, never peek apps.', rotator: 'Market. Rotate to whichever site gets hit.', awp: 'Window AWP. Hold mid from the window.' },
    std: { a: 'A site, crossfire with ticket. Molly palace on contact.', short: 'Short. Take early info, then fall back to market.', b: 'B van. Anchor alone and call contact fast.', rotator: 'Ticket. Crossfire A, rotate to B via CT if called.', awp: 'Window AWP. Hold mid, don\'t duel Holo.' },
    tDefault: { a: 'A ramp. Take ramp behind a flash, clear tetris, call what holds stairs.', short: 'Short. Smoke window from T spawn, then take short behind a flash.', b: "B apps. Lurk quiet, call B numbers, don't peek out of apps alone.", rotator: 'Palace. Flash out once for info, read the map, call the hit.', awp: 'Top mid AWP. Take the first pick down mid, then join the hit.' },
    tExecA: { a: 'A ramp. Swing first off the flash, clear tetris, then sandwich.', short: 'A ramp. Smoke stairs, flash over A ramp, trade the entry.', b: 'B apps. Make noise to freeze B, call the rotation, then hold the flank.', rotator: 'Palace. Smoke CT, molly firebox, come out with the ramp hit and call the plant.', awp: 'Top mid. Smoke jungle, then hold mid and short against the rotate.' },
    tExecB: { a: 'B apps. Swing first off the flash, clear van and bench.', short: 'B apps. Molly bench, flash out of apps, trade the entry.', b: 'Palace. Fake A with noise and a flash, call the rotation through connector.', rotator: 'Short. Smoke market window and door, come down short with the hit, plant.', awp: 'Top mid AWP. Smoke window, then hold mid and cover the plant from short.' },
    tEco: { a: 'B apps. First out, aim for van and bench, trade fast.', short: 'B apps. Pop a flash out of apps if you have one, trade the entry.', b: 'B apps. Third out, clear back site and market door.', rotator: 'Back alley. Come in fourth, pick up a gun.', awp: 'Back alley. Last in, watch short for the flank.' },
    tForce: { a: 'A ramp. First up, clear tetris and sandwich fast.', short: 'A ramp. Flash over A ramp, trade the entry.', b: 'Palace. Come out with the ramp hit, clear firebox.', rotator: 'Palace. Smoke CT, follow the hit, plant default.', awp: 'Top mid. Smoke window, then push connector to split their crossfire.' },
  },
};
