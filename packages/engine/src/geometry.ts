// Map geometry built from the CS2 map files by tools/map-build: the walkable floor, callout zones,
// a walking graph between zones, and earliest arrival times. Map units are 0..1000 on both axes
// (north up, like the in-game radar). Times are seconds at knife-out run speed (250 u/s).

export type Site = 'A' | 'B';
export type Point = readonly [x: number, y: number];

export interface GeoZone {
  id: string;
  name: string;
  site?: Site;
  /** Label and pin anchor: the point deepest inside the zone. */
  at: Point;
  /** Outline as SVG path data (map units). */
  path: string;
  /** 1 for a lower level drawn apart (Nuke). */
  level?: number;
}

export interface MapGeo {
  id: string;
  name: string;
  /** world → map units: x' = (x + dx) * s + ox, y' = oy - (y + dy) * s, with (dx, dy) per level. */
  world: { s: number; ox: number; oy: number; levels: readonly { name: string; below?: number; dx: number; dy: number }[] };
  /** Walkable floor, SVG path data (even-odd: obstacles are holes). */
  floor: string;
  zones: readonly GeoZone[];
  /** Zone lookup: size×size cells, each the zone index + 1 (0 = not walkable), run-length encoded. */
  grid: { size: number; rle: string };
  /** Where each team starts (mean spawn, map units). */
  spawn: Readonly<Record<'T' | 'CT', Point>>;
  /** Earliest arrival in each zone from each team's spawn: [T, CT] seconds. */
  arrive: Readonly<Record<string, readonly [t: number, ct: number]>>;
  /** Walking graph nodes: one hub per zone (in zone order), the two spawns (T, CT), then the portals. */
  nodes: readonly Point[];
  /** For each portal node (after the spawns): the two zones it joins. */
  portals: readonly (readonly [a: number, b: number])[];
  /** Directed edges [from, to, seconds, ...via points as x, y pairs]. */
  edges: readonly (readonly number[])[];
}

// Grid alphabet: '.' = wall, then one character per zone index.
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export const GRID_ALPHABET = '.' + ALPHA;

export function encodeGrid(cells: ArrayLike<number>): string {
  let out = '';
  for (let i = 0; i < cells.length;) {
    const v = cells[i]!;
    let n = 1;
    while (i + n < cells.length && cells[i + n] === v) n++;
    out += GRID_ALPHABET[v]! + (n > 1 ? String(n) : '');
    i += n;
  }
  return out;
}

const decoded = new WeakMap<MapGeo, Uint8Array>();

/** Zone index + 1 per grid cell (0 = wall). Decoded once per map. */
export function gridCells(geo: MapGeo): Uint8Array {
  let cells = decoded.get(geo);
  if (cells) return cells;
  cells = new Uint8Array(geo.grid.size * geo.grid.size);
  const s = geo.grid.rle;
  let o = 0;
  for (let i = 0; i < s.length;) {
    const v = GRID_ALPHABET.indexOf(s[i]!);
    if (v < 0) throw new Error(`${geo.id}: bad grid character`);
    let j = i + 1;
    while (j < s.length && s.charCodeAt(j) >= 48 && s.charCodeAt(j) <= 57) j++;
    const n = j > i + 1 ? Number(s.slice(i + 1, j)) : 1;
    cells.fill(v, o, o + n);
    o += n;
    i = j;
  }
  if (o !== cells.length) throw new Error(`${geo.id}: grid has ${o} cells, expected ${cells.length}`);
  decoded.set(geo, cells);
  return cells;
}

/** The zone at a map point, or undefined on walls. */
export function zoneAt(geo: MapGeo, x: number, y: number): GeoZone | undefined {
  const n = geo.grid.size;
  const i = Math.floor((x / 1000) * n), j = Math.floor((y / 1000) * n);
  if (i < 0 || j < 0 || i >= n || j >= n) return undefined;
  const v = gridCells(geo)[j * n + i]!;
  return v ? geo.zones[v - 1] : undefined;
}

/** Walkable at a map point, optionally within `pad` map units of the floor. */
export function walkableAt(geo: MapGeo, x: number, y: number, pad = 0): boolean {
  const n = geo.grid.size, cells = gridCells(geo), r = Math.ceil((pad / 1000) * n);
  const i = Math.floor((x / 1000) * n), j = Math.floor((y / 1000) * n);
  for (let dj = -r; dj <= r; dj++) {
    for (let di = -r; di <= r; di++) {
      const a = i + di, b = j + dj;
      if (a >= 0 && b >= 0 && a < n && b < n && cells[b * n + a]) return true;
    }
  }
  return false;
}

const boundaries = new WeakMap<MapGeo, Map<number, Point[]>>();

/** Map distance from a point to a zone (0 inside). Uses the zone's grid cells. */
export function distanceToZone(geo: MapGeo, zoneIndex: number, p: Point): number {
  const n = geo.grid.size, cell = 1000 / n, cells = gridCells(geo);
  const i = Math.floor(p[0] / cell), j = Math.floor(p[1] / cell);
  if (i >= 0 && j >= 0 && i < n && j < n && cells[j * n + i] === zoneIndex + 1) return 0;
  let per = boundaries.get(geo);
  if (!per) { per = new Map(); boundaries.set(geo, per); }
  let pts = per.get(zoneIndex);
  if (!pts) {
    pts = [];
    const v = zoneIndex + 1;
    for (let b = 0; b < n; b++) {
      for (let a = 0; a < n; a++) {
        if (cells[b * n + a] !== v) continue;
        const edge = a === 0 || b === 0 || a === n - 1 || b === n - 1 || cells[b * n + a - 1] !== v || cells[b * n + a + 1] !== v || cells[(b - 1) * n + a] !== v || cells[(b + 1) * n + a] !== v;
        if (edge) pts.push([(a + 0.5) * cell, (b + 0.5) * cell]);
      }
    }
    per.set(zoneIndex, pts);
  }
  let best = Infinity;
  for (const q of pts) { const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2; if (d < best) best = d; }
  return Math.sqrt(best);
}

/** [x, y, seconds since round start at knife-out speed] */
export type Waypoint = readonly [x: number, y: number, t: number];

const graphs = new WeakMap<MapGeo, { adj: Map<number, (readonly number[])[]>; members: number[][] }>();
function graphOf(geo: MapGeo) {
  let g = graphs.get(geo);
  if (g) return g;
  const adj = new Map<number, (readonly number[])[]>();
  for (const e of geo.edges) { const l = adj.get(e[0]!) ?? []; l.push(e); adj.set(e[0]!, l); }
  const nz = geo.zones.length;
  const members = geo.zones.map((_, z) => [z]);
  geo.portals.forEach(([a, b], k) => { members[a]?.push(nz + 2 + k); members[b]?.push(nz + 2 + k); });
  g = { adj, members };
  graphs.set(geo, g);
  return g;
}

/**
 * A walking route from a team's spawn through zones in order (zone ids), on the map's walking graph.
 * Each zone on the way is entered by its nearest doorway, or walked through its middle when the id
 * ends with `*` (e.g. `palace*`). The route ends at the last zone's hub.
 */
export function routeThrough(geo: MapGeo, from: 'T' | 'CT', zones: readonly string[]): Waypoint[] {
  const start = from === 'T' ? geo.zones.length : geo.zones.length + 1;
  return walkFrom(geo, start, [[geo.nodes[start]![0], geo.nodes[start]![1], 0]], 0, zones);
}

/**
 * A walking route from any map point (a player's spot) through zones in order: first to the hub of
 * the zone the point is in (or the nearest hub), then on the walking graph as in routeThrough.
 */
export function routeFrom(geo: MapGeo, from: Point, zones: readonly string[]): Waypoint[] {
  const here = zoneAt(geo, from[0], from[1]);
  let start = here ? geo.zones.indexOf(here) : -1;
  if (start < 0) {
    let best = Infinity;
    geo.zones.forEach((_, i) => { const n = geo.nodes[i]!; const d = Math.hypot(n[0] - from[0], n[1] - from[1]); if (d < best) { best = d; start = i; } });
  }
  const hub = geo.nodes[start]!;
  // Straight to the hub at about knife speed (map units per second vary by map: use the world scale).
  const toHub = Math.hypot(hub[0] - from[0], hub[1] - from[1]) / (geo.world.s * 250);
  const out: Waypoint[] = [[from[0], from[1], 0]];
  if (toHub > 0.05) out.push([hub[0], hub[1], Math.round(toHub * 10) / 10]);
  return walkFrom(geo, start, out, toHub, zones);
}

function walkFrom(geo: MapGeo, start: number, out: Waypoint[], t0: number, zones: readonly string[]): Waypoint[] {
  const { adj, members } = graphOf(geo);
  let at = start, t = t0;
  zones.forEach((step, k) => {
    const id = step.replace(/\*$/, '');
    const z = geo.zones.findIndex(x => x.id === id);
    if (z < 0) throw new Error(`${geo.id}: unknown zone ${id}`);
    const middle = k === zones.length - 1 || step.endsWith('*');
    const targets = new Set(middle ? [z] : members[z]!);
    if (targets.has(at)) return;
    // Dijkstra on the small portal graph, to the nearest target.
    const dist = new Map<number, number>([[at, 0]]);
    const prev = new Map<number, readonly number[]>();
    const open = new Set([at]);
    let reached = -1;
    while (open.size) {
      let u = -1, du = Infinity;
      for (const n of open) { const d = dist.get(n)!; if (d < du) { du = d; u = n; } }
      open.delete(u);
      if (targets.has(u)) { reached = u; break; }
      for (const e of adj.get(u) ?? []) {
        const v = e[1]!, nd = du + e[2]!;
        if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prev.set(v, e); open.add(v); }
      }
    }
    if (reached < 0) throw new Error(`${geo.id}: no path to ${id}`);
    const legs: (readonly number[])[] = [];
    for (let v = reached; v !== at;) { const e = prev.get(v)!; legs.unshift(e); v = e[0]!; }
    for (const e of legs) {
      const a = geo.nodes[e[0]!]!, b = geo.nodes[e[1]!]!;
      const pts: Point[] = [a];
      for (let q = 3; q + 1 < e.length; q += 2) pts.push([e[q]!, e[q + 1]!]);
      pts.push(b);
      // Spread the leg's time over its points by length.
      let len = 0;
      for (let q = 1; q < pts.length; q++) len += Math.hypot(pts[q]![0] - pts[q - 1]![0], pts[q]![1] - pts[q - 1]![1]);
      let acc = 0;
      for (let q = 1; q < pts.length; q++) {
        acc += Math.hypot(pts[q]![0] - pts[q - 1]![0], pts[q]![1] - pts[q - 1]![1]);
        out.push([pts[q]![0], pts[q]![1], Math.round((t + (len ? (acc / len) * e[2]! : e[2]!)) * 10) / 10]);
      }
      t += e[2]!;
    }
    at = reached;
  });
  return out;
}

const sides = new WeakMap<MapGeo, Record<string, Site | 'mid'>>();
/**
 * Which site each zone belongs to, by walking time from its hub to each site's hub: clearly closer to
 * one site (under 70% of the time to the other) is that site's side, else mid.
 */
export function zoneSides(geo: MapGeo): Readonly<Record<string, Site | 'mid'>> {
  let out = sides.get(geo);
  if (out) return out;
  const { adj } = graphOf(geo);
  const timesFrom = (start: number) => {
    const dist = new Map<number, number>([[start, 0]]);
    const open = new Set([start]);
    while (open.size) {
      let u = -1, du = Infinity;
      for (const n of open) { const d = dist.get(n)!; if (d < du) { du = d; u = n; } }
      open.delete(u);
      for (const e of adj.get(u) ?? []) { const nd = du + e[2]!; if (nd < (dist.get(e[1]!) ?? Infinity)) { dist.set(e[1]!, nd); open.add(e[1]!); } }
    }
    return dist;
  };
  const ai = geo.zones.findIndex(z => z.site === 'A'), bi = geo.zones.findIndex(z => z.site === 'B');
  const fromA = timesFrom(ai), fromB = timesFrom(bi);
  out = {};
  geo.zones.forEach((z, i) => {
    const ta = fromA.get(i) ?? Infinity, tb = fromB.get(i) ?? Infinity;
    out![z.id] = z.site ?? (ta < 0.7 * tb ? 'A' : tb < 0.7 * ta ? 'B' : 'mid');
  });
  sides.set(geo, out);
  return out;
}
