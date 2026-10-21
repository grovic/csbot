// The map pool: geometry built from the CS2 map files (geo/, generated) plus our plays (plays/).

import { buildMapModel, type MapModel, type MapPlans } from '../forecast.ts';
import type { MapGeo } from '../geometry.ts';
import { buildPlaybook, DEFAULT_SLOTS, type Playbook, type PlaybookDef, type SlotDef } from '../playbook.ts';
import { GEO_ANCIENT } from './geo/de_ancient.ts';
import { GEO_ANUBIS } from './geo/de_anubis.ts';
import { GEO_CACHE } from './geo/de_cache.ts';
import { GEO_DUST2 } from './geo/de_dust2.ts';
import { GEO_INFERNO } from './geo/de_inferno.ts';
import { GEO_MIRAGE } from './geo/de_mirage.ts';
import { GEO_NUKE } from './geo/de_nuke.ts';
import { PLANS_ANCIENT, PLAYBOOK_ANCIENT } from './plays/de_ancient.ts';
import { PLANS_ANUBIS, PLAYBOOK_ANUBIS } from './plays/de_anubis.ts';
import { PLANS_CACHE, PLAYBOOK_CACHE } from './plays/de_cache.ts';
import { PLANS_DUST2, PLAYBOOK_DUST2 } from './plays/de_dust2.ts';
import { PLANS_INFERNO, PLAYBOOK_INFERNO } from './plays/de_inferno.ts';
import { PLANS_MIRAGE, PLAYBOOK_MIRAGE } from './plays/de_mirage.ts';
import { PLANS_NUKE, PLAYBOOK_NUKE } from './plays/de_nuke.ts';

interface Entry { geo: MapGeo; plans?: MapPlans; playbook?: PlaybookDef }

const ENTRIES: readonly Entry[] = [
  { geo: GEO_ANCIENT, plans: PLANS_ANCIENT, playbook: PLAYBOOK_ANCIENT },
  { geo: GEO_ANUBIS, plans: PLANS_ANUBIS, playbook: PLAYBOOK_ANUBIS },
  { geo: GEO_CACHE, plans: PLANS_CACHE, playbook: PLAYBOOK_CACHE },
  { geo: GEO_DUST2, plans: PLANS_DUST2, playbook: PLAYBOOK_DUST2 },
  { geo: GEO_INFERNO, plans: PLANS_INFERNO, playbook: PLAYBOOK_INFERNO },
  { geo: GEO_MIRAGE, plans: PLANS_MIRAGE, playbook: PLAYBOOK_MIRAGE },
  { geo: GEO_NUKE, plans: PLANS_NUKE, playbook: PLAYBOOK_NUKE },
];

/** Every map we have geometry for (the competitive pool), by map id. */
export const GEOS: Readonly<Record<string, MapGeo>> = Object.fromEntries(ENTRIES.map(e => [e.geo.id, e.geo]));

/** Maps with an enemy plan model (forecast + intel). */
export const MAPS: Readonly<Record<string, MapModel>> = Object.fromEntries(
  ENTRIES.filter(e => e.plans).map(e => [e.geo.id, buildMapModel(e.geo, e.plans!)]),
);

export const PLAYBOOKS: Readonly<Record<string, Playbook>> = Object.fromEntries(
  ENTRIES.filter(e => e.playbook).map(e => [e.geo.id, buildPlaybook(e.geo, e.playbook!)]),
);

export const MAP_POOL: readonly string[] = ENTRIES.map(e => e.geo.id);

export const MIRAGE: MapModel = MAPS.de_mirage!;
export const MIRAGE_PLAYBOOK: Playbook = PLAYBOOKS.de_mirage!;

export function slotsFor(map?: string): readonly SlotDef[] {
  return (map ? PLAYBOOKS[map]?.slots : undefined) ?? DEFAULT_SLOTS;
}
