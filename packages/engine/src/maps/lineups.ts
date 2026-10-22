// csbot's starter utility lineups: the well-known smokes, molotovs and flashes for each map, as "thrown
// from this callout, lands in that one", linked to the playbook setups that use them. Their exact aim
// isn't here: the team adds it from their own practice (Playbook → Lineups), and the practice config
// teleports to the throw spot facing the landing spot until they do.

import type { Lineup, LineupKind } from '@csbot/protocol';
import type { MapGeo } from '../geometry.ts';

interface LineupDef { id: string; name: string; kind: LineupKind; side: 'CT' | 'T'; from: string; to: string; how?: string; setups?: readonly string[] }

const T_A = ['tExecA'] as const, T_B = ['tExecB'] as const, T_AD = ['tExecA', 'tDefault'] as const, CT = ['std', 'antieco'] as const;

export const STARTER_LINEUPS: Readonly<Record<string, readonly LineupDef[]>> = {
  de_mirage: [
    { id: 'window', name: 'Window smoke', kind: 'smoke', side: 'T', from: 'tspawn', to: 'window', how: 'Jumpthrow', setups: T_AD },
    { id: 'stairs', name: 'Stairs smoke', kind: 'smoke', side: 'T', from: 'tspawn', to: 'stairs', how: 'Jumpthrow', setups: T_A },
    { id: 'jungle', name: 'Jungle smoke', kind: 'smoke', side: 'T', from: 'aramp', to: 'jungle', how: 'Jumpthrow', setups: T_A },
    { id: 'ctsmoke', name: 'CT smoke', kind: 'smoke', side: 'T', from: 'aramp', to: 'ctspawn', how: 'Jumpthrow', setups: T_A },
    { id: 'firebox', name: 'Site molotov', kind: 'molotov', side: 'T', from: 'palace', to: 'asite', how: 'Stand, left click', setups: T_A },
    { id: 'market', name: 'Market window smoke', kind: 'smoke', side: 'T', from: 'bapps', to: 'market', how: 'Jumpthrow', setups: T_B },
    { id: 'shortb', name: 'Short smoke', kind: 'smoke', side: 'T', from: 'bapps', to: 'short', how: 'Stand, left click', setups: T_B },
    { id: 'bench', name: 'Bench molotov', kind: 'molotov', side: 'T', from: 'bapps', to: 'bsite', how: 'Run + throw', setups: T_B },
    { id: 'rampmolly', name: 'Ramp molotov', kind: 'molotov', side: 'CT', from: 'asite', to: 'aramp', how: 'Stand, left click', setups: CT },
    { id: 'appsmolly', name: 'Apps molotov', kind: 'molotov', side: 'CT', from: 'bsite', to: 'bapps', how: 'Stand, left click', setups: CT },
  ],
  de_dust2: [
    { id: 'xbox', name: 'Xbox smoke', kind: 'smoke', side: 'T', from: 'outsidetunnel', to: 'middle', how: 'Jumpthrow', setups: T_AD },
    { id: 'ctcross', name: 'CT cross smoke', kind: 'smoke', side: 'T', from: 'longa', to: 'asite', how: 'Jumpthrow', setups: T_A },
    { id: 'longflash', name: 'Long doors flash', kind: 'flash', side: 'T', from: 'outsidelong', to: 'longa', how: 'Right click over the wall', setups: T_A },
    { id: 'carmolly', name: 'Car molotov', kind: 'molotov', side: 'T', from: 'longa', to: 'asite', how: 'Run + jumpthrow', setups: T_A },
    { id: 'bdoors', name: 'B doors smoke', kind: 'smoke', side: 'T', from: 'uppertunnel', to: 'bdoors', how: 'Stand, left click', setups: T_B },
    { id: 'bwindow', name: 'B window smoke', kind: 'smoke', side: 'T', from: 'uppertunnel', to: 'bsite', how: 'Jumpthrow', setups: T_B },
    { id: 'middoors', name: 'Mid doors smoke', kind: 'smoke', side: 'CT', from: 'ctspawn', to: 'middoors', how: 'Stand, left click', setups: CT },
    { id: 'longmolly', name: 'Long doors molotov', kind: 'molotov', side: 'CT', from: 'asite', to: 'longdoors', how: 'Jumpthrow', setups: CT },
  ],
  de_inferno: [
    { id: 'library', name: 'Library smoke', kind: 'smoke', side: 'T', from: 'apartments', to: 'library', how: 'Jumpthrow', setups: T_A },
    { id: 'arch', name: 'Arch smoke', kind: 'smoke', side: 'T', from: 'secondmid', to: 'arch', how: 'Jumpthrow', setups: T_A },
    { id: 'pit', name: 'Pit molotov', kind: 'molotov', side: 'T', from: 'apartments', to: 'pit', how: 'Run + throw', setups: T_A },
    { id: 'coffins', name: 'Coffins smoke', kind: 'smoke', side: 'T', from: 'banana', to: 'bsite', how: 'Jumpthrow', setups: T_B },
    { id: 'ctb', name: 'CT smoke (B)', kind: 'smoke', side: 'T', from: 'banana', to: 'ctspawn', how: 'Jumpthrow', setups: T_B },
    { id: 'bananaflash', name: 'Banana flash', kind: 'flash', side: 'T', from: 'banana', to: 'bsite', how: 'Right click', setups: ['tExecB', 'tDefault'] },
    { id: 'bananamolly', name: 'Banana molotov', kind: 'molotov', side: 'CT', from: 'bsite', to: 'banana', how: 'Stand, left click', setups: CT },
    { id: 'appsmolly', name: 'Apartments molotov', kind: 'molotov', side: 'CT', from: 'balcony', to: 'apartments', how: 'Stand, left click', setups: CT },
  ],
  de_nuke: [
    { id: 'garage', name: 'Garage smoke', kind: 'smoke', side: 'T', from: 'outside', to: 'garage', how: 'Jumpthrow', setups: T_B },
    { id: 'mini', name: 'Mini smoke', kind: 'smoke', side: 'T', from: 'outside', to: 'mini', how: 'Jumpthrow', setups: ['tExecB', 'tDefault'] },
    { id: 'heaven', name: 'Heaven smoke', kind: 'smoke', side: 'T', from: 'lobby', to: 'heaven', how: 'Jumpthrow', setups: T_A },
    { id: 'hutflash', name: 'Hut flash', kind: 'flash', side: 'T', from: 'lobby', to: 'hut', how: 'Right click', setups: T_A },
    { id: 'hutmolly', name: 'Hut molotov', kind: 'molotov', side: 'CT', from: 'asite', to: 'hut', how: 'Stand, left click', setups: CT },
    { id: 'rampmolly', name: 'Ramp molotov', kind: 'molotov', side: 'CT', from: 'bsite', to: 'ramp', how: 'Stand, left click', setups: CT },
  ],
  de_ancient: [
    { id: 'donut', name: 'Donut smoke', kind: 'smoke', side: 'T', from: 'mainhall', to: 'sidehall', how: 'Jumpthrow', setups: T_A },
    { id: 'cta', name: 'CT smoke (A)', kind: 'smoke', side: 'T', from: 'mainhall', to: 'ctspawn', how: 'Jumpthrow', setups: T_A },
    { id: 'cave', name: 'Cave smoke', kind: 'smoke', side: 'T', from: 'tsidelower', to: 'sideentrance', how: 'Jumpthrow', setups: T_B },
    { id: 'bsmoke', name: 'B site smoke', kind: 'smoke', side: 'T', from: 'tsidelower', to: 'bsite', how: 'Jumpthrow', setups: T_B },
    { id: 'midsmoke', name: 'Mid smoke', kind: 'smoke', side: 'T', from: 'tsideupper', to: 'middle', how: 'Stand, left click', setups: ['tDefault'] },
    { id: 'rampmolly', name: 'B ramp molotov', kind: 'molotov', side: 'CT', from: 'bsite', to: 'ramp', how: 'Stand, left click', setups: CT },
    { id: 'mainmolly', name: 'A main molotov', kind: 'molotov', side: 'CT', from: 'asite', to: 'mainhall', how: 'Stand, left click', setups: CT },
  ],
  de_anubis: [
    { id: 'asmoke', name: 'A site smoke', kind: 'smoke', side: 'T', from: 'tsideupper', to: 'asite', how: 'Jumpthrow', setups: T_A },
    { id: 'conn', name: 'Connector smoke', kind: 'smoke', side: 'T', from: 'middle', to: 'connector', how: 'Jumpthrow', setups: ['tExecA', 'tDefault'] },
    { id: 'nest', name: 'Snipers nest smoke', kind: 'smoke', side: 'T', from: 'outsidelong', to: 'snipersnest', how: 'Jumpthrow', setups: T_B },
    { id: 'bmolly', name: 'B site molotov', kind: 'molotov', side: 'T', from: 'outsidelong', to: 'bsite', how: 'Run + throw', setups: T_B },
    { id: 'bmainmolly', name: 'B main molotov', kind: 'molotov', side: 'CT', from: 'bsite', to: 'outsidelong', how: 'Stand, left click', setups: CT },
    { id: 'amainmolly', name: 'A main molotov', kind: 'molotov', side: 'CT', from: 'asite', to: 'tsideupper', how: 'Stand, left click', setups: CT },
  ],
  de_cache: [
    { id: 'highway', name: 'Highway smoke', kind: 'smoke', side: 'T', from: 'amain', to: 'highway', how: 'Jumpthrow', setups: T_A },
    { id: 'across', name: 'A cross smoke', kind: 'smoke', side: 'T', from: 'amain', to: 'asite', how: 'Jumpthrow', setups: T_A },
    { id: 'truck', name: 'Truck smoke', kind: 'smoke', side: 'T', from: 'longa', to: 'truck', how: 'Jumpthrow', setups: T_A },
    { id: 'checkers', name: 'Checkers smoke', kind: 'smoke', side: 'T', from: 'bmain', to: 'checkers', how: 'Jumpthrow', setups: T_B },
    { id: 'bmolly', name: 'B site molotov', kind: 'molotov', side: 'T', from: 'bmain', to: 'bsite', how: 'Run + throw', setups: T_B },
    { id: 'midsmoke', name: 'Mid smoke', kind: 'smoke', side: 'T', from: 'mid', to: 'connector', how: 'Stand, left click', setups: ['tDefault'] },
    { id: 'amainmolly', name: 'A main molotov', kind: 'molotov', side: 'CT', from: 'asite', to: 'amain', how: 'Stand, left click', setups: CT },
    { id: 'bmainmolly', name: 'B main molotov', kind: 'molotov', side: 'CT', from: 'bsite', to: 'bmain', how: 'Stand, left click', setups: CT },
  ],
};

/** The starter list for a map, placed at its callouts (throw spot and landing spot at the zone anchors). */
export function buildLineups(geo: MapGeo, defs: readonly LineupDef[]): Lineup[] {
  const at = (zone: string) => {
    const z = geo.zones.find(x => x.id === zone);
    if (!z) throw new Error(`${geo.id}: lineup zone ${zone} unknown`);
    return z.at;
  };
  return defs.map(d => ({
    id: d.id, name: d.name, kind: d.kind, side: d.side, from: at(d.from), to: at(d.to),
    ...(d.how ? { how: d.how } : {}), ...(d.setups ? { setups: d.setups } : {}),
  }));
}
