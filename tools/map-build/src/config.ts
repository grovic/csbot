// Per-map choices the game files can't make for us: which callout volumes form one intel zone,
// display names, and how to lay out maps with stacked levels. Place names come from the map
// (env_cs_place); anything not listed here keeps its own zone with a name made from its place name.

export interface MapConfig {
  id: string;
  name: string;
  /** Place name → zone id. Several places can share a zone. Unlisted places get their own (slug). */
  zones?: Readonly<Record<string, string>>;
  /** Zone id → display name. */
  names?: Readonly<Record<string, string>>;
  /** Zones drawn over an overlapping upper floor (an underpass is worth clicking). */
  under?: readonly string[];
  /** Areas below this height (world z) are a lower level, drawn under the main one. */
  lower?: { below: number; name: string };
}

export const POOL: readonly MapConfig[] = [
  {
    id: 'de_dust2', name: 'Dust II',
    zones: { TunnelStairs: 'uppertunnel', ExtendedA: 'asite', Hole: 'bdoors' },
    names: { uppertunnel: 'Upper Tunnel', lowertunnel: 'Lower Tunnel', outsidetunnel: 'Outside Tunnel', middle: 'Mid', topofmid: 'Top Mid', longdoors: 'Long Doors', outsidelong: 'Outside Long', shortstairs: 'Short', catwalk: 'Catwalk', aramp: 'A Ramp', middoors: 'Mid Doors', bdoors: 'B Doors', pit: 'Pit', side: 'Side' },
    under: ['lowertunnel'],
  },
  {
    // Ids kept from the schematic Mirage (tests, hotkeys and saved intel use them).
    id: 'de_mirage', name: 'Mirage',
    zones: { Apartments: 'bapps', TopofMid: 'topmid', TRamp: 'aramp', PalaceInterior: 'palace', PalaceAlley: 'palalley', Underpass: 'under', Connector: 'conn', Catwalk: 'short', Shop: 'market', SnipersNest: 'window', Middle: 'mid', Scaffolding: 'asite', Truck: 'bsite' },
    names: { bapps: 'B Apps', topmid: 'Top Mid', aramp: 'A Ramp', palace: 'Palace', palalley: 'Palace Alley', under: 'Underpass', conn: 'Connector', short: 'Short', market: 'Market', window: 'Window', mid: 'Mid', ladder: 'Ladder Room', backalley: 'Back Alley', sidealley: 'Side Alley' },
    under: ['under'],
  },
  {
    id: 'de_inferno', name: 'Inferno',
    zones: { Kitchen: 'upstairs', Deck: 'upstairs', Bridge: 'secondmid', Underpass: 'middle', Quad: 'asite', Ruins: 'bsite' },
    names: { topofmid: 'Top Mid', secondmid: 'Second Mid', lowermid: 'Lower Mid', tramp: 'T Ramp', backalley: 'Back Alley', upstairs: 'Upstairs', middle: 'Mid', arch: 'Arch', library: 'Library', pit: 'Pit', balcony: 'Balcony', apartments: 'Apartments', banana: 'Banana' },
  },
  {
    id: 'de_nuke', name: 'Nuke',
    zones: { Rafters: 'asite', Crane: 'asite', Hut: 'hut', HutRoof: 'hut', Decon: 'bsite', Vending: 'lobby', Trophy: 'lobby' },
    names: { outside: 'Outside', lobby: 'Lobby', hut: 'Hut', ramp: 'Ramp', secret: 'Secret', silo: 'Silo', squeaky: 'Squeaky', heaven: 'Heaven', hell: 'Hell', mini: 'Mini', garage: 'Garage', tunnels: 'Tunnels', vents: 'Vents', roof: 'Roof' },
    // Lobby, squeaky and hut are under roofs players can stand on: the rooms matter more for intel.
    under: ['lobby', 'squeaky', 'hut'],
    lower: { below: -560, name: 'Lower' },
  },
  {
    id: 'de_ancient', name: 'Ancient',
    names: { topofmid: 'Top Mid', middle: 'Mid', mainhall: 'A Main', sidehall: 'Donut', sideentrance: 'Cave', tsidelower: 'B Lane', tsideupper: 'T Side', house: 'House', alley: 'Alley', ramp: 'B Ramp', outside: 'Outside', ruins: 'Ruins', water: 'Water', tunnel: 'Tunnel', ctspawn: 'CT Spawn', tspawn: 'T Spawn' },
  },
  {
    id: 'de_anubis', name: 'Anubis',
    zones: { TunnelStairs: 'tunnel', CTSideUpper: 'ctspawn', Heaven: 'asite', Fountain: 'asite', Bricks: 'palaceinterior' },
    names: { middle: 'Mid', middoors: 'Mid Doors', canal: 'Canal', bridge: 'Bridge', street: 'Street', tstairs: 'T Stairs', tsideupper: 'A Main', walkway: 'Walkway', palaceinterior: 'Palace', lowertunnel: 'Lower Tunnel', snipersnest: 'Snipers Nest', backofb: 'Back of B', outsidelong: 'B Main', ruins: 'Ruins', connector: 'Connector', alley: 'Alley', water: 'Water', tunnel: 'Tunnel', main: 'Main' },
  },
  {
    id: 'de_cache', name: 'Cache',
    zones: {
      Quad: 'asite', Corner: 'asite', Squeaky: 'asite', ABoost: 'asite', ForkLift: 'asite', Toxic: 'asite', Catwalk: 'highway', Ladder: 'highway', ElectricalBox: 'truck',
      AStairs: 'mid', Boost: 'mid', Cubby: 'mid', Middle: 'mid', Sandbags: 'mid', MidRoof: 'mid', Lockers: 'amain', Red: 'garage',
      Headshot: 'bsite', Playground: 'bsite', Rafters: 'bsite', Heaven: 'bsite', Bear: 'backhall', TTruck: 'tyard',
    },
    names: { amain: 'A Main', ahalls: 'A Halls', longa: 'A Long', outsidea: 'Outside A', highway: 'Highway', truck: 'Truck', mid: 'Mid', garage: 'Garage', tyard: 'T Yard', ctlane: 'CT', connector: 'Connector', busstop: 'Bus Stop', backhall: 'Back Hall', checkers: 'Checkers', useless: 'Useless', vents: 'Vents', treeroom: 'Tree Room', bmain: 'B Main', bhalls: 'B Halls', outsideb: 'Outside B', sunroom: 'Sun Room' },
  },
];
