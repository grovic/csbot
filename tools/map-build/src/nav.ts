// CS2 navigation mesh (.nav, versions 31-36): walkable areas and their connections. Layout per
// ValveResourceFormat's NavMeshFile/NavMeshArea (MIT). Only the areas are read; ladders and
// generation parameters after them are not needed.

import { readKV3 } from './kv3.ts';

export type Vec3 = readonly [number, number, number];

export interface NavArea {
  id: number;
  hull: number;
  corners: readonly Vec3[];
  /** Neighbour area ids per polygon edge (edge i runs from corner i to corner i+1). */
  edges: readonly (readonly number[])[];
}

export interface NavMesh { version: number; areas: NavArea[] }

export function readNav(b: Buffer): NavMesh {
  let p = 0;
  const u8 = () => b[p++]!;
  const u16 = () => { const v = b.readUInt16LE(p); p += 2; return v; };
  const u32 = () => { const v = b.readUInt32LE(p); p += 4; return v; };
  const f32 = () => { const v = b.readFloatLE(p); p += 4; return v; };
  const kv3 = () => { p = (p + 7) & ~7; p = readKV3(b, p).end; };

  if (u32() !== 0xfeedface) throw new Error('not a nav mesh');
  const version = u32();
  if (version < 31 || version > 36) throw new Error(`nav version ${version} not supported`);
  u32(); // sub-version
  u8(); // analyzed
  const places = u16();
  for (let i = 0; i < places; i++) { const n = u16(); p += n; }
  u8(); // has unnamed areas
  if (version >= 36) kv3(); // movable mesh settings

  const corners: Vec3[] = [];
  const nc = u32();
  for (let i = 0; i < nc; i++) corners.push([f32(), f32(), f32()]);
  const polygons: Vec3[][] = [];
  const np = u32();
  for (let i = 0; i < np; i++) {
    const n = u8();
    const poly: Vec3[] = [];
    for (let k = 0; k < n; k++) poly.push(corners[u32()]!);
    if (version >= 35) u32(); // movable mesh id
    polygons.push(poly);
  }
  if (version >= 32) { const flags = u32(); if (flags & 1) { const n = u32(); p += n * 12; } } // corner gravity
  if (version >= 35) { const n = u32(); for (let i = 0; i < n; i++) { while (b[p++] !== 0); p += 48; } } // movable meshes
  if (version >= 36) kv3(); // game data

  const areas: NavArea[] = [];
  const na = u32();
  for (let i = 0; i < na; i++) {
    const id = u32();
    p += 8; // attribute flags
    const hull = u8();
    const poly = polygons[u32()];
    if (!poly) throw new Error(`nav area ${id}: bad polygon index`);
    f32();
    const edges: number[][] = [];
    for (let e = 0; e < poly.length; e++) {
      const n = u32();
      const list: number[] = [];
      for (let k = 0; k < n; k++) { list.push(u32()); u32(); }
      edges.push(list);
    }
    if (u8() !== 0) throw new Error(`nav area ${id}: hiding spots not supported`);
    if (u32() !== 0) throw new Error(`nav area ${id}: encounter paths not supported`);
    const above = u32(); p += above * 4; // ladders above
    const below = u32(); p += below * 4; // ladders below
    areas.push({ id, hull, corners: poly, edges });
  }
  return { version, areas };
}
