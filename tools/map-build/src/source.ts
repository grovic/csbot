// Everything the map build reads from one map's package in the CS2 install (read-only): the nav mesh,
// callout volumes (env_cs_place), bomb sites (func_bomb_target) and spawn points.

import path from 'node:path';
import { arr, num, obj, readResourceKV3, strv, type KV } from './kv3.ts';
import { readNav, type NavMesh, type Vec3 } from './nav.ts';
import { openVpk } from './vpk.ts';

export type Volume = readonly Vec3[]; // convex hull vertices, world space

export interface Place { name: string; volumes: Volume[] }
export interface MapSource {
  id: string;
  nav: NavMesh;
  places: Place[];
  sites: { site: 'A' | 'B'; volumes: Volume[] }[];
  spawns: { T: Vec3[]; CT: Vec3[] };
}

export function defaultCsgoDir(): string {
  return process.env.CSBOT_CS2_DIR ?? 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive/game/csgo';
}

export function loadMapSource(id: string, csgo = defaultCsgoDir()): MapSource {
  const vpk = openVpk(path.join(csgo, 'maps', `${id}.vpk`));
  try {
    const nav = readNav(vpk.read(`maps/${id}.nav`));
    const lump = obj(readResourceKV3(vpk.read(`maps/${id}/entities/default_ents.vents_c`), 'DATA'));
    const ents = arr(lump.m_entityKeyValues).map(e => {
      const kv = obj(obj(e).keyValues3Data);
      return { ...obj(kv.values), ...obj(kv.attributes) };
    });

    const volumes = (e: Record<string, KV>): Volume[] => {
      const model = strv(e.model);
      if (!model) return [];
      const phys = obj(readResourceKV3(vpk.read(model + '_c'), 'PHYS'));
      const origin = arr(e.origin).map(v => num(v));
      const yaw = (num(arr(e.angles)[1]) * Math.PI) / 180;
      const c = Math.cos(yaw), s = Math.sin(yaw);
      const out: Volume[] = [];
      for (const part of arr(phys.m_parts)) {
        for (const h of arr(obj(obj(part).m_rnShape).m_hulls)) {
          const v = obj(obj(h).m_Hull).m_VertexPositions;
          if (!Buffer.isBuffer(v)) continue;
          const pts: Vec3[] = [];
          for (let i = 0; i + 12 <= v.length; i += 12) {
            const x = v.readFloatLE(i), y = v.readFloatLE(i + 4), z = v.readFloatLE(i + 8);
            pts.push([(origin[0] ?? 0) + x * c - y * s, (origin[1] ?? 0) + x * s + y * c, (origin[2] ?? 0) + z]);
          }
          if (pts.length) out.push(pts);
        }
      }
      return out;
    };

    const byName = new Map<string, Place>();
    for (const e of ents.filter(e => e.classname === 'env_cs_place')) {
      const name = strv(e.place_name);
      if (!name) continue;
      const pl = byName.get(name) ?? { name, volumes: [] };
      pl.volumes.push(...volumes(e));
      byName.set(name, pl);
    }
    const sites = ents.filter(e => e.classname === 'func_bomb_target')
      .map(e => ({ site: (strv(e.bomb_site_designation) === '1' ? 'B' : 'A') as 'A' | 'B', volumes: volumes(e) }));
    const point = (e: Record<string, KV>): Vec3 => { const o = arr(e.origin).map(v => num(v)); return [o[0] ?? 0, o[1] ?? 0, o[2] ?? 0]; };
    const spawnsOf = (cls: string) => ents.filter(e => e.classname === cls && e.enabled !== false).map(point);
    return { id, nav, places: [...byName.values()], sites, spawns: { T: spawnsOf('info_player_terrorist'), CT: spawnsOf('info_player_counterterrorist') } };
  } finally {
    vpk.close();
  }
}
