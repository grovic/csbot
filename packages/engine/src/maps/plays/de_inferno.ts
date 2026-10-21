// Inferno: enemy (T) plans and our CT playbook. Routes are zones walked in order from T spawn
// (ids from maps/geo/de_inferno.ts). Plan odds by enemy buy are first estimates until demo data.
// Map notes: Ts reach upper apartments over the bridge (in `secondmid`), down through `backalley`
// and up the apps stairs; `apartments` also covers the boiler stairs down to short (`topofmid`).

import type { MapPlans } from '../../forecast.ts';
import type { PlaybookDef } from '../../playbook.ts';

export const PLANS_INFERNO: MapPlans = {
  map: 'de_inferno',
  routes: {
    B: ['tramp', 'banana*', 'bsite'],
    MB: ['tramp', 'middle*', 'banana', 'bsite'],
    AP: ['upstairs', 'apartments', 'balcony*', 'asite'],
    BO: ['upstairs', 'apartments', 'backalley', 'topofmid', 'asite'],
    S: ['tramp', 'middle', 'topofmid*', 'asite'],
    SM: ['secondmid', 'topofmid', 'asite'],
    L: ['tramp', 'middle', 'topofmid', 'arch*', 'asite'],
  },
  plans: [
    { id: 'bRush', name: 'B banana rush', site: 'B', speed: 0.9, lineup: ['B', 'B', 'B', 'B', 'B'], delay: [0, 1, 2, 3, 4] },
    { id: 'bExec', name: 'B exec (banana control)', site: 'B', speed: 0.55, lineup: ['B', 'B', 'B', 'B', 'S'], delay: [0, 2, 8, 10, 6] },
    { id: 'aRush', name: 'A rush (apps + short)', site: 'A', speed: 0.9, lineup: ['AP', 'AP', 'AP', 'S', 'S'], delay: [0, 0, 1, 1, 2] },
    { id: 'aExec', name: 'A exec (apps + short)', site: 'A', speed: 0.6, lineup: ['AP', 'AP', 'BO', 'S', 'S'], delay: [0, 2, 1, 7, 9] },
    { id: 'aSplit', name: 'Mid-to-A split (short + arch + apps)', site: 'A', speed: 0.55, lineup: ['S', 'S', 'L', 'SM', 'AP'], delay: [6, 8, 8, 5, 1] },
    { id: 'slowB', name: 'Default → late B', site: 'B', speed: 0.4, lineup: ['B', 'B', 'MB', 'MB', 'AP'], delay: [2, 5, 0, 2, 0] },
    { id: 'slowA', name: 'Default → late A', site: 'A', speed: 0.4, lineup: ['AP', 'AP', 'S', 'SM', 'B'], delay: [0, 3, 4, 2, 0] },
  ],
  planPriorByBuy: {
    eco: { bRush: 0.38, bExec: 0.08, aRush: 0.24, aExec: 0.06, aSplit: 0.04, slowB: 0.1, slowA: 0.1 },
    force: { bRush: 0.24, bExec: 0.14, aRush: 0.2, aExec: 0.12, aSplit: 0.08, slowB: 0.11, slowA: 0.11 },
    half: { bRush: 0.14, bExec: 0.2, aRush: 0.12, aExec: 0.17, aSplit: 0.11, slowB: 0.13, slowA: 0.13 },
    full: { bRush: 0.04, bExec: 0.25, aRush: 0.04, aExec: 0.24, aSplit: 0.15, slowB: 0.14, slowA: 0.14 },
  },
  // Enemy CT setups for our T halves: one hold zone per defender (`:mid` = counts toward neither site).
  // The arch player is the mid rotator (`arch:mid`): Inferno's arch is on the A side but rotates to B via CT.
  defense: {
    setups: [
      { id: 'default', name: 'Standard 2-1-2 (pit, short, arch, banana, B)', holds: ['pit', 'topofmid', 'arch:mid', 'banana', 'bsite'] },
      { id: 'stackA', name: 'Stack A (pit, short, site)', holds: ['pit', 'topofmid', 'asite', 'arch:mid', 'bsite'] },
      { id: 'stackB', name: 'Stack B (banana + 2 on site)', holds: ['asite', 'arch:mid', 'banana', 'bsite', 'bsite'] },
      { id: 'bananaPush', name: 'Banana control push (2 up banana)', holds: ['pit', 'topofmid', 'banana', 'banana', 'bsite'] },
      { id: 'retake', name: 'Light sites, play the retake', holds: ['library', 'arch:mid', 'ctspawn', 'ctspawn', 'bsite'] },
    ],
    priorByBuy: {
      eco: { default: 0.18, stackA: 0.24, stackB: 0.28, bananaPush: 0.22, retake: 0.08 },
      force: { default: 0.28, stackA: 0.18, stackB: 0.22, bananaPush: 0.2, retake: 0.12 },
      half: { default: 0.36, stackA: 0.15, stackB: 0.17, bananaPush: 0.18, retake: 0.14 },
      full: { default: 0.45, stackA: 0.11, stackB: 0.12, bananaPush: 0.17, retake: 0.15 },
    },
  },
};

export const PLAYBOOK_INFERNO: PlaybookDef = {
  map: 'de_inferno',
  slots: [
    { id: 'a', label: 'A anchor' }, { id: 'short', label: 'Short / Apps' }, { id: 'b', label: 'B anchor (banana)' },
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
      calls: { default: { head: 'Anti-eco · stack B', sub: '3 on B · 2 on A · no banana fights', steps: ['Long angles only', 'Trade in pairs'] } },
      spots: [
        { player: 'b', zone: 'bsite', label: 'coffins' }, { player: 'awp', zone: 'bsite', label: 'B site AWP' },
        { player: 'rotator', zone: 'bsite', label: 'dark' }, { player: 'a', zone: 'pit', label: 'pit' }, { player: 'short', zone: 'library', label: 'library' },
      ],
    },
    {
      id: 'std', name: 'Standard 2-1-2', side: 'CT',
      calls: {
        default: { head: 'Standard 2-1-2', sub: 'Banana control early · arch watches mid', steps: ['Molly banana early', 'Call apps fast', 'Arch → B via CT: 12 s'] },
        force: { head: 'Anti-force · play safe', sub: '2-1-2 · no banana duels · fall back', steps: ['No early peeks', 'Rotate on 3+ seen'] },
      },
      spots: [
        { player: 'b', zone: 'banana', label: 'banana car' }, { player: 'awp', zone: 'bsite', label: 'B site AWP' },
        { player: 'rotator', zone: 'arch', label: 'arch' }, { player: 'short', zone: 'topofmid', label: 'short' }, { player: 'a', zone: 'pit', label: 'pit' },
      ],
    },
    // Our T halves.
    {
      id: 'tDefault', name: 'Default · banana, mid, apps', side: 'T',
      calls: { default: { head: 'Default · banana, mid, apps', sub: 'Take banana control, then hit the light site', steps: ['Take banana', 'Mid control', 'Call contact'] } },
      spots: [
        { player: 'a', zone: 'banana', label: 'banana' }, { player: 'short', zone: 'banana', label: 'lower banana' },
        { player: 'b', zone: 'apartments', label: 'apps' }, { player: 'rotator', zone: 'middle', label: 'mid' }, { player: 'awp', zone: 'middle', label: 'mid AWP' },
      ],
    },
    {
      id: 'tExecA', name: 'A exec · apps + short', side: 'T', site: 'A',
      calls: { default: { head: 'Hit A · apps + short', sub: 'Smoke pit, CT and arch, flash out of apps, short together', steps: ['Smoke pit, CT, arch', 'Flash balcony', 'Plant default'] } },
      spots: [
        { player: 'a', zone: 'balcony', label: 'balcony' }, { player: 'short', zone: 'apartments', label: 'apps' },
        { player: 'b', zone: 'banana', label: 'banana lurk' }, { player: 'rotator', zone: 'topofmid', label: 'short' }, { player: 'awp', zone: 'middle', label: 'mid AWP' },
      ],
    },
    {
      id: 'tExecB', name: 'B exec · banana', side: 'T', site: 'B',
      calls: { default: { head: 'Hit B · banana', sub: 'Smoke CT and coffins, molly new box, flash out of banana', steps: ['Smoke CT + coffins', 'Molly new box', 'Flash and go'] } },
      spots: [
        { player: 'a', zone: 'banana', label: 'top banana' }, { player: 'short', zone: 'banana', label: 'car' },
        { player: 'b', zone: 'apartments', label: 'apps lurk' }, { player: 'rotator', zone: 'banana', label: 'logs' }, { player: 'awp', zone: 'banana', label: 'banana AWP' },
      ],
    },
    {
      id: 'tEco', name: 'Eco · apps rush together', side: 'T', answers: ['eco'],
      calls: { default: { head: 'Eco · apps rush together', sub: 'Four out of balcony at once, one drops boiler to short', steps: ['Go together', 'Trade', 'Grab their guns'] } },
      spots: [
        { player: 'a', zone: 'apartments', label: 'apps' }, { player: 'short', zone: 'apartments', label: 'apps' },
        { player: 'b', zone: 'apartments', label: 'boiler' }, { player: 'rotator', zone: 'apartments', label: 'apps' }, { player: 'awp', zone: 'secondmid', label: 'second mid' },
      ],
    },
    {
      id: 'tForce', name: 'Force · banana rush', side: 'T', answers: ['force'],
      calls: { default: { head: 'Force · banana rush', sub: 'Four up banana fast, one in apps to hold A', steps: ['Molly + flash', 'Go fast', 'Trade'] } },
      spots: [
        { player: 'a', zone: 'banana', label: 'top banana' }, { player: 'short', zone: 'banana', label: 'banana' },
        { player: 'b', zone: 'apartments', label: 'apps' }, { player: 'rotator', zone: 'banana', label: 'banana' }, { player: 'awp', zone: 'banana', label: 'lower banana' },
      ],
    },
  ],
  jobs: {
    antieco: {
      a: 'Pit. Long angle on balcony and short, fall back to library on 2+.',
      short: 'Library. Hold short and the site from deep, trade the pit.',
      b: 'Coffins. Hold the banana exit, never peek banana.',
      rotator: 'Dark. Crossfire the banana exit with coffins, rotate to A via CT if called.',
      awp: 'B site AWP. Hold banana from deep site, reposition after each shot.',
    },
    std: {
      a: 'Pit. Hold balcony and the site, call apps contact, fall back on 2+.',
      short: 'Short. Hold top mid and boiler, fall back to the site if apps fills up.',
      b: 'Banana car. Molly banana early, fight for control, fall back to coffins.',
      rotator: 'Arch. Watch top mid with short, rotate to B via CT if called.',
      awp: 'B site AWP. Hold the banana exit from the site, trade the car player.',
    },
    tDefault: {
      a: 'Banana. Take control off the flash, clear car and logs, call what holds B.',
      short: 'Lower banana. Molly car, flash over the top for your entry, trade him.',
      b: "Apps. Lurk quiet, call balcony and boiler contact, don't peek alone.",
      rotator: 'Mid. Flash top mid for info, read the map, call the hit.',
      awp: 'Mid AWP. Take the first pick on top mid or short, then join the hit.',
    },
    tExecA: {
      a: 'Balcony. First out off the flash, clear close corners and the site.',
      short: 'Apps. Smoke pit, flash out over balcony, trade the entry.',
      b: 'Banana lurk. Molly anyone pushing up banana, call the B rotate.',
      rotator: 'Short. Smoke CT and arch, push short when apps hits, call the plant.',
      awp: 'Mid AWP. Hold top mid until short goes, then cover the plant from short.',
    },
    tExecB: {
      a: 'Top banana. First out off the flash, clear first oranges and the site.',
      short: 'Car. Molly new box, flash over the top, trade the entry.',
      b: 'Apps lurk. Make noise on balcony to hold A, then watch the flank.',
      rotator: 'Logs. Smoke CT and coffins, go in third, plant safe.',
      awp: 'Banana AWP. Hold the site through the smokes, then cover the plant from banana.',
    },
    tEco: {
      a: 'Apps. First onto balcony, aim for the site player, trade fast.',
      short: 'Apps. Right behind the entry, clear pit and trade him.',
      b: 'Boiler. Drop to short as balcony swings, catch them looking up.',
      rotator: 'Apps. Third out, call the plant, pick up a gun.',
      awp: 'Second mid. Last in, watch the flank, grab the first rifle you can.',
    },
    tForce: {
      a: 'Top banana. First out, clear car, logs and new box.',
      short: 'Banana. Molly coffins and flash over the top, trade the entry.',
      b: 'Apps. Make noise to hold the A players, watch for a push through apps.',
      rotator: 'Banana. Third in, smoke CT, call the plant.',
      awp: 'Lower banana. Last in, hold the banana flank behind the plant.',
    },
  },
};
