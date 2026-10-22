// Turns one map's source (nav mesh + callout volumes) into MapGeo: zones, outlines, a lookup grid,
// a walking graph between zones, and arrival times. Pure: no file access.

import { encodeGrid, type MapGeo, type GeoZone, type Point } from '@csbot/engine/geometry';
import type { MapConfig } from './config.ts';
import type { Vec3 } from './nav.ts';
import type { MapSource, Volume } from './source.ts';

const RUN = 250; // knife-out run speed, units/s
const R = 500; // drawing raster (2 map units per cell)
const G = 250; // runtime lookup grid
const MARGIN = 20; // map units around the map

type P2 = [number, number];

// ---------- small geometry helpers ----------

function hull2d(pts: readonly Vec3[]): P2[] {
  const p = pts.map(q => [q[0], q[1]] as P2).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: P2, a: P2, b: P2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: P2[] = [], up: P2[] = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2]!, lo[lo.length - 1]!, q) <= 0) lo.pop(); lo.push(q); }
  for (const q of [...p].reverse()) { while (up.length >= 2 && cross(up[up.length - 2]!, up[up.length - 1]!, q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

function inConvex(poly: readonly P2[], x: number, y: number): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
    const c = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
    if (c === 0) continue;
    const s = c > 0 ? 1 : -1;
    if (sign && s !== sign) return false;
    sign = s;
  }
  return true;
}

const polyArea = (poly: readonly P2[]) => { let s = 0; for (let i = 0; i < poly.length; i++) { const a = poly[i]!, b = poly[(i + 1) % poly.length]!; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };

function simplify(pts: P2[], eps: number): P2[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const A = pts[a]!, B = pts[b]!;
    const dx = B[0] - A[0], dy = B[1] - A[1], len = Math.hypot(dx, dy) || 1;
    let best = -1, bd = eps;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * (pts[i]![0] - A[0]) - dx * (pts[i]![1] - A[1])) / len;
      if (d > bd) { bd = d; best = i; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Closed ring simplification: split at the two farthest-apart points, simplify both halves. */
function simplifyRing(ring: P2[], eps: number): P2[] {
  if (ring.length < 4) return ring;
  let far = 0, fd = -1;
  for (let i = 1; i < ring.length; i++) { const d = (ring[i]![0] - ring[0]![0]) ** 2 + (ring[i]![1] - ring[0]![1]) ** 2; if (d > fd) { fd = d; far = i; } }
  const a = simplify(ring.slice(0, far + 1), eps);
  const b = simplify([...ring.slice(far), ring[0]!], eps);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

/** Boundary rings of the cells where `inside(i)` holds, in cell-corner coordinates. */
function traceRings(n: number, inside: (i: number) => boolean): P2[][] {
  const key = (x: number, y: number) => y * (n + 1) + x;
  const out = new Map<number, number[]>(); // start vertex → end vertices
  const add = (x0: number, y0: number, x1: number, y1: number) => { const k = key(x0, y0); const l = out.get(k); if (l) l.push(key(x1, y1)); else out.set(k, [key(x1, y1)]); };
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < n && y < n && inside(y * n + x);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!inside(y * n + x)) continue;
      if (!at(x, y - 1)) add(x, y, x + 1, y);
      if (!at(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!at(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!at(x - 1, y)) add(x, y + 1, x, y);
    }
  }
  const rings: P2[][] = [];
  for (const [start] of out) {
    while ((out.get(start)?.length ?? 0) > 0) {
      const ring: P2[] = [];
      let cur = start;
      let prevDir: P2 = [0, 0];
      for (let guard = 0; guard < 4 * n * n; guard++) {
        const list = out.get(cur);
        if (!list || !list.length) break;
        const cx = cur % (n + 1), cy = Math.floor(cur / (n + 1));
        // At a pinch point, turn right (keeps diagonal neighbours apart).
        let pick = 0;
        if (list.length > 1) {
          let bestScore = Infinity;
          list.forEach((nk, i) => {
            const d: P2 = [(nk % (n + 1)) - cx, Math.floor(nk / (n + 1)) - cy];
            const turn = prevDir[0] * d[1] - prevDir[1] * d[0];
            if (turn < bestScore) { bestScore = turn; pick = i; }
          });
        }
        const next = list.splice(pick, 1)[0]!;
        ring.push([cx, cy]);
        prevDir = [(next % (n + 1)) - cx, Math.floor(next / (n + 1)) - cy];
        cur = next;
        if (cur === start) break;
      }
      // Drop collinear points.
      const clean = ring.filter((p, i) => {
        const a = ring[(i - 1 + ring.length) % ring.length]!, b = ring[(i + 1) % ring.length]!;
        return (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]) !== 0;
      });
      if (clean.length >= 3) rings.push(clean);
    }
  }
  return rings;
}

function ringsToPath(rings: P2[][], scale: number, eps: number, minArea: number): string {
  let d = '';
  for (const r of rings) {
    if (Math.abs(polyArea(r)) < minArea) continue;
    const s = simplifyRing(r, eps);
    if (s.length < 3) continue;
    // Integer map units, relative moves after the first point (compact, and exact for a 1000-unit map).
    const pts = s.map(p => [Math.round(p[0] * scale), Math.round(p[1] * scale)] as P2);
    const rel: string[] = [];
    for (let i = 1; i < pts.length; i++) { const dx = pts[i]![0] - pts[i - 1]![0], dy = pts[i]![1] - pts[i - 1]![1]; if (dx || dy) rel.push(`${dx} ${dy}`); }
    if (rel.length < 2) continue;
    d += (`M${pts[0]![0]} ${pts[0]![1]}l` + rel.join(' ') + 'z').replace(/ -/g, '-');
  }
  return d;
}

// ---------- naming ----------

export function zoneIdFor(place: string, cfg: MapConfig): string {
  const mapped = cfg.zones?.[place];
  if (mapped) return mapped;
  if (/^bombsite\s*a$/i.test(place)) return 'asite';
  if (/^bombsite\s*b$/i.test(place)) return 'bsite';
  return place.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function prettyName(place: string): string {
  if (/^bombsite\s*a$/i.test(place)) return 'A Site';
  if (/^bombsite\s*b$/i.test(place)) return 'B Site';
  return place
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .replace(/\bTopof\b/, 'Top of')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------- build ----------

export interface BuildReport { warnings: string[]; areas: number; zones: number; edges: number }

export function buildGeo(src: MapSource, cfg: MapConfig): { geo: MapGeo; report: BuildReport } {
  const warnings: string[] = [];
  const areas = src.nav.areas.filter(a => a.hull === 0);
  const idx = new Map(areas.map((a, i) => [a.id, i]));
  const cen = areas.map(a => { const n = a.corners.length; return [a.corners.reduce((s, c) => s + c[0], 0) / n, a.corners.reduce((s, c) => s + c[1], 0) / n, a.corners.reduce((s, c) => s + c[2], 0) / n] as const; });

  // Levels: Nuke's lower floor is moved below the main one so both can be drawn.
  const level = areas.map((_, i) => (cfg.lower && cen[i]![2] < cfg.lower.below ? 1 : 0));
  const bbox = (lv: number) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    areas.forEach((a, i) => { if (level[i] !== lv) return; for (const c of a.corners) { x0 = Math.min(x0, c[0]); y0 = Math.min(y0, c[1]); x1 = Math.max(x1, c[0]); y1 = Math.max(y1, c[1]); } });
    return { x0, y0, x1, y1 };
  };
  const main = bbox(0);
  const levels: { name: string; below?: number; dx: number; dy: number }[] = [{ name: 'Main', dx: 0, dy: 0 }];
  if (cfg.lower) {
    const lo = bbox(1);
    // Directly below the main floor (world y is up, so lower on the map means smaller y).
    levels.push({ name: cfg.lower.name, below: cfg.lower.below, dx: Math.round((main.x0 + main.x1) / 2 - (lo.x0 + lo.x1) / 2), dy: Math.round(main.y0 - 200 - lo.y1) });
  }
  const shift = (i: number): P2 => { const L = levels[level[i]!]!; return [L.dx, L.dy]; };
  let X0 = Infinity, Y0 = Infinity, X1 = -Infinity, Y1 = -Infinity;
  areas.forEach((a, i) => { const [dx, dy] = shift(i); for (const c of a.corners) { X0 = Math.min(X0, c[0] + dx); Y0 = Math.min(Y0, c[1] + dy); X1 = Math.max(X1, c[0] + dx); Y1 = Math.max(Y1, c[1] + dy); } });
  const s = (1000 - 2 * MARGIN) / Math.max(X1 - X0, Y1 - Y0);
  const ox = MARGIN + ((1000 - 2 * MARGIN) - (X1 - X0) * s) / 2 - X0 * s;
  const oy = MARGIN + ((1000 - 2 * MARGIN) - (Y1 - Y0) * s) / 2 + Y1 * s;
  const toMap = (x: number, y: number, i: number): P2 => { const [dx, dy] = shift(i); return [(x + dx) * s + ox, oy - (y + dy) * s]; };

  // Place of each area: the smallest callout volume holding its centre, else the nearest labelled area.
  const vols = src.places.flatMap(pl => pl.volumes.map(v => {
    const poly = hull2d(v);
    return { name: pl.name, poly, zmin: Math.min(...v.map(q => q[2])), zmax: Math.max(...v.map(q => q[2])), area: Math.abs(polyArea(poly)) };
  })).sort((a, b) => a.area - b.area);
  const placeOf: (string | undefined)[] = cen.map(c => vols.find(v => c[2] >= v.zmin - 32 && c[2] <= v.zmax + 32 && inConvex(v.poly, c[0], c[1]))?.name);
  const nbrs = areas.map(a => [...new Set(a.edges.flat().map(id => idx.get(id)).filter((v): v is number => v !== undefined))]);
  const undirected = nbrs.map(l => [...l]);
  nbrs.forEach((l, i) => { for (const j of l) if (!undirected[j]!.includes(i)) undirected[j]!.push(i); });
  {
    let frontier = placeOf.map((p, i) => (p ? i : -1)).filter(i => i >= 0);
    while (frontier.length) {
      const next: number[] = [];
      for (const i of frontier) for (const j of undirected[i]!) if (!placeOf[j]) { placeOf[j] = placeOf[i]; next.push(j); }
      frontier = next;
    }
  }
  const unplaced = placeOf.filter(p => !p).length;
  if (unplaced) warnings.push(`${unplaced} nav areas aren't connected to any callout`);

  // Zones.
  const zoneIds = [...new Set(placeOf.filter((p): p is string => !!p).map(p => zoneIdFor(p, cfg)))].sort();
  for (const k of Object.keys(cfg.zones ?? {})) if (!src.places.some(p => p.name === k)) warnings.push(`config zone for unknown place ${k}`);
  for (const k of Object.keys(cfg.names ?? {})) if (!zoneIds.includes(k)) warnings.push(`config name for unknown zone ${k}`);
  if (!zoneIds.includes('asite') || !zoneIds.includes('bsite')) throw new Error(`${src.id}: no bomb site zones`);
  if (zoneIds.length > 62) throw new Error(`${src.id}: too many zones (${zoneIds.length})`);
  const zoneOfArea = placeOf.map(p => (p ? zoneIds.indexOf(zoneIdFor(p, cfg)) : -1));
  const firstPlace = new Map<string, string>();
  for (const pl of src.places) { const id = zoneIdFor(pl.name, cfg); if (!firstPlace.has(id) || pl.name.toLowerCase().replace(/[^a-z0-9]/g, '') === id) firstPlace.set(id, pl.name); }
  const under = new Set((cfg.under ?? []).map(id => zoneIds.indexOf(id)));

  // Drawing raster: zone per cell (highest floor wins, unless the lower one is an "under" zone).
  const cellZ = new Float32Array(R * R).fill(-Infinity);
  const cell = new Int16Array(R * R).fill(-1);
  const cellArea = new Int32Array(R * R).fill(-1);
  const k = R / 1000;
  areas.forEach((a, i) => {
    const z = zoneOfArea[i]!;
    if (z < 0) return;
    const poly = a.corners.map(c => { const m = toMap(c[0], c[1], i); return [m[0] * k, m[1] * k] as P2; });
    const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
    for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(R - 1, Math.ceil(Math.max(...ys))); y++) {
      for (let x = Math.max(0, Math.floor(Math.min(...xs))); x <= Math.min(R - 1, Math.ceil(Math.max(...xs))); x++) {
        if (!inConvex(poly, x + 0.5, y + 0.5)) continue;
        const c = y * R + x, prev = cell[c]!;
        const wins = prev < 0 || (under.has(z) && !under.has(prev)) || (!(under.has(prev) && !under.has(z)) && cen[i]![2] > cellZ[c]!);
        if (wins) { cell[c] = z; cellZ[c] = cen[i]![2]; cellArea[c] = i; }
      }
    }
  });
  // Close one-cell cracks between nav polygons.
  for (let pass = 0; pass < 2; pass++) {
    const fill: [number, number, number][] = [];
    for (let y = 1; y < R - 1; y++) {
      for (let x = 1; x < R - 1; x++) {
        const c = y * R + x;
        if (cell[c]! >= 0) continue;
        const l = cell[c - 1]!, r = cell[c + 1]!, u = cell[c - R]!, d = cell[c + R]!;
        if (l >= 0 && r >= 0) fill.push([c, l, cellArea[c - 1]!]);
        else if (u >= 0 && d >= 0) fill.push([c, u, cellArea[c - R]!]);
      }
    }
    for (const [c, z, a] of fill) { cell[c] = z; cellArea[c] = a; }
  }

  // Zone anchors: the cell deepest inside each zone (ties: nearest the zone's centre).
  const depth = new Int32Array(R * R);
  let frontier: number[] = [];
  for (let c = 0; c < R * R; c++) {
    if (cell[c]! < 0) continue;
    const x = c % R, y = (c - x) / R, z = cell[c]!;
    const edge = x === 0 || y === 0 || x === R - 1 || y === R - 1 || cell[c - 1] !== z || cell[c + 1] !== z || cell[c - R] !== z || cell[c + R] !== z;
    if (edge) { depth[c] = 1; frontier.push(c); }
  }
  for (let dpt = 2; frontier.length; dpt++) {
    const next: number[] = [];
    for (const c of frontier) {
      for (const nc of [c - 1, c + 1, c - R, c + R]) {
        if (nc < 0 || nc >= R * R || depth[nc] || cell[nc] !== cell[c]) continue;
        depth[nc] = dpt; next.push(nc);
      }
    }
    frontier = next;
  }
  const sums = zoneIds.map(() => ({ x: 0, y: 0, n: 0 }));
  for (let c = 0; c < R * R; c++) { const z = cell[c]!; if (z >= 0) { const q = sums[z]!; q.x += c % R; q.y += Math.floor(c / R); q.n++; } }
  const anchorCell = zoneIds.map((_, z) => {
    const q = sums[z]!;
    if (!q.n) return -1;
    const mx = q.x / q.n, my = q.y / q.n;
    let best = -1, bd = -1, bdist = Infinity;
    for (let c = 0; c < R * R; c++) {
      if (cell[c] !== z) continue;
      const d = depth[c]!, dist = (c % R - mx) ** 2 + (Math.floor(c / R) - my) ** 2;
      // Prefer depth, but a cell near the centre that's almost as deep reads better.
      const score = Math.min(d, 12);
      if (score > bd || (score === bd && dist < bdist)) { bd = score; bdist = dist; best = c; }
    }
    return best;
  });
  const missing = zoneIds.filter((_, z) => anchorCell[z]! < 0);
  if (missing.length) warnings.push(`zones hidden by upper floors: ${missing.join(', ')}`);

  // Outlines.
  const scale = 1000 / R;
  const floor = ringsToPath(traceRings(R, c => cell[c]! >= 0), scale, 0.75, 6);
  const zones: GeoZone[] = zoneIds.map((id, z) => {
    const ac = anchorCell[z]!;
    const place = firstPlace.get(id) ?? id;
    const zl = ac >= 0 ? level[cellArea[ac]!]! : 0;
    const g: GeoZone = {
      id, name: cfg.names?.[id] ?? (id === 'asite' ? 'A Site' : id === 'bsite' ? 'B Site' : prettyName(place)),
      at: ac >= 0 ? [Math.round(((ac % R) + 0.5) * scale), Math.round((Math.floor(ac / R) + 0.5) * scale)] : [0, 0],
      path: ringsToPath(traceRings(R, c => cell[c] === z), scale, 1, 8),
    };
    if (id === 'asite') g.site = 'A';
    if (id === 'bsite') g.site = 'B';
    if (zl) g.level = zl;
    // Its usual floor height (the median over its visible cells), for practice-server teleports.
    const zs: number[] = [];
    for (let c = 0; c < R * R; c++) if (cell[c] === z && cellArea[c]! >= 0) zs.push(cen[cellArea[c]!]![2]);
    if (zs.length) { zs.sort((a, b) => a - b); g.z = Math.round(zs[zs.length >> 1]!); }
    return g;
  });

  // Lookup grid (G×G), majority zone of each 2×2 block.
  const f = R / G;
  const grid = new Uint8Array(G * G);
  for (let y = 0; y < G; y++) {
    for (let x = 0; x < G; x++) {
      const counts = new Map<number, number>();
      for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) { const z = cell[(y * f + dy) * R + x * f + dx]!; if (z >= 0) counts.set(z, (counts.get(z) ?? 0) + 1); }
      let best = -1, bn = 0;
      for (const [z, n] of counts) if (n > bn) { bn = n; best = z; }
      grid[y * G + x] = best + 1;
    }
  }
  // A zone's label always sits on its own cell, so clicking a label hits that zone.
  zones.forEach((z, i) => { if (anchorCell[i]! >= 0) grid[Math.floor((z.at[1] / 1000) * G) * G + Math.floor((z.at[0] / 1000) * G)] = i + 1; });

  // Walking graph. Nodes are the shared edges between nav areas (their midpoints), so paths don't
  // zigzag through triangle centres; each path is then pulled straight along the floor raster.
  const N = areas.length;
  interface Spot { area: number; x: number; y: number; z: number }
  const mids: Spot[] = [];
  const midOf = new Map<number, number>();
  const areaMids: number[][] = areas.map(() => []);
  areas.forEach((ar, i) => {
    ar.edges.forEach((list, e) => {
      for (const nid of list) {
        const j = idx.get(nid);
        if (j === undefined || j === i) continue;
        const key = i < j ? i * N + j : j * N + i;
        if (midOf.has(key)) continue;
        const c0 = ar.corners[e]!, c1 = ar.corners[(e + 1) % ar.corners.length]!;
        midOf.set(key, mids.length);
        areaMids[i]!.push(mids.length);
        areaMids[j]!.push(mids.length);
        mids.push({ area: i, x: (c0[0] + c1[0]) / 2, y: (c0[1] + c1[1]) / 2, z: (c0[2] + c1[2]) / 2 });
      }
    });
  });
  const d3 = (a: Spot, b: Spot) => Math.hypot(a.x - b.x, a.y - b.y, (a.z - b.z) * 0.5);
  const madj: [number, number][][] = mids.map(() => []);
  for (const list of areaMids) for (const p of list) for (const q of list) if (p !== q) madj[p]!.push([q, d3(mids[p]!, mids[q]!)]);

  interface Search { d: Float64Array; prev: Int32Array; src: Int32Array }
  const search = (from: readonly Spot[]): Search => {
    const d = new Float64Array(mids.length).fill(Infinity), prev = new Int32Array(mids.length).fill(-1), src = new Int32Array(mids.length).fill(-1);
    const heap: [number, number][] = [];
    const push = (v: number, key: number) => { heap.push([key, v]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p]![0] <= heap[i]![0]) break; [heap[p], heap[i]] = [heap[i]!, heap[p]!]; i = p; } };
    const pop = () => { const top = heap[0]!; const last = heap.pop()!; if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l; if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i]!, heap[m]!]; i = m; } } return top; };
    from.forEach((s0, q) => { for (const m of areaMids[s0.area]!) { const c = d3(s0, mids[m]!); if (c < d[m]!) { d[m] = c; src[m] = q; push(m, c); } } });
    while (heap.length) {
      const [du, u] = pop();
      if (du > d[u]!) continue;
      for (const [v, w] of madj[u]!) { const nd = du + w; if (nd < d[v]!) { d[v] = nd; prev[v] = u; src[v] = src[u]!; push(v, nd); } }
    }
    return { d, prev, src };
  };
  const lv = (s0: Spot) => level[s0.area]!;
  const mapOf = (s0: Spot): P2 => toMap(s0.x, s0.y, s0.area);
  const los = (a: P2, b: P2) => {
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * k * 2));
    for (let q = 0; q <= n; q++) {
      const x = Math.floor((a[0] + ((b[0] - a[0]) * q) / n) * k), y = Math.floor((a[1] + ((b[1] - a[1]) * q) / n) * k);
      if (x < 0 || y < 0 || x >= R || y >= R || cell[y * R + x]! < 0) return false;
    }
    return true;
  };
  /** Straighten a chain of spots along the floor; returns the kept spots and the walking length. */
  const pull = (chain: Spot[]): { pts: Spot[]; len: number } => {
    const m = chain.map(mapOf);
    const keep = [0];
    for (let i = 0; i < chain.length - 1;) {
      let j = i + 1;
      while (j + 1 < chain.length && lv(chain[i]!) === lv(chain[j + 1]!) && los(m[i]!, m[j + 1]!)) j++;
      keep.push(j);
      i = j;
    }
    const pts = keep.map(i => chain[i]!);
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += d3(pts[i - 1]!, pts[i]!);
    return { pts, len };
  };
  /** Fastest path from a search's sources to a spot (or to a mid node when `to` is a number). */
  const pathTo = (r: Search, from: readonly Spot[], to: Spot | number): { pts: Spot[]; len: number } | undefined => {
    let end = -1, best = Infinity;
    if (typeof to === 'number') { end = to; best = r.d[to]!; } else {
      const direct = from.findIndex(f => f.area === to.area);
      if (direct >= 0) return pull([from[direct]!, to]);
      for (const m of areaMids[to.area]!) { const c = r.d[m]! + d3(mids[m]!, to); if (c < best) { best = c; end = m; } }
    }
    if (end < 0 || !Number.isFinite(best)) return undefined;
    const chain: Spot[] = [];
    for (let v = end; v >= 0; v = r.prev[v]!) chain.unshift(mids[v]!);
    chain.unshift(from[r.src[end]!]!);
    if (typeof to !== 'number') chain.push(to);
    return pull(chain);
  };

  const nearestArea = (p: Vec3) => {
    let best = -1, bd = Infinity;
    cen.forEach((c, i) => { const d = Math.hypot(c[0] - p[0], c[1] - p[1], (c[2] - p[2]) * 2); if (d < bd) { bd = d; best = i; } });
    return best;
  };
  const spotAt = (p: Vec3): Spot => ({ area: nearestArea(p), x: p[0], y: p[1], z: p[2] });
  const tSpots = src.spawns.T.map(spotAt), ctSpots = src.spawns.CT.map(spotAt);
  if (!tSpots.length || !ctSpots.length) throw new Error(`${src.id}: missing spawns`);
  const mean = (pts: Vec3[]): Vec3 => [pts.reduce((t, p) => t + p[0], 0) / pts.length, pts.reduce((t, p) => t + p[1], 0) / pts.length, pts.reduce((t, p) => t + p[2], 0) / pts.length];
  const tHub = spotAt(mean(src.spawns.T)), ctHub = spotAt(mean(src.spawns.CT));
  const sec = (len: number) => Math.round((len / RUN) * 10) / 10;

  // Earliest arrival per zone (stepping over its border) from each team's spawns.
  const fromT = search(tSpots), fromCT = search(ctSpots);
  const arrive: Record<string, [number, number]> = {};
  const firstIn = (r: Search, spots: Spot[], z: number) => {
    if (spots.some(p => zoneOfArea[p.area] === z)) return 0;
    let end = -1, best = Infinity;
    areas.forEach((_, i) => { if (zoneOfArea[i] !== z) return; for (const m of areaMids[i]!) if (r.d[m]! < best) { best = r.d[m]!; end = m; } });
    if (end < 0) return -1;
    const p = pathTo(r, spots, end);
    return p ? sec(p.len) : -1;
  };
  zoneIds.forEach((id, z) => {
    arrive[id] = [firstIn(fromT, tSpots, z), firstIn(fromCT, ctSpots, z)];
    if (arrive[id]![0] < 0 && arrive[id]![1] < 0) warnings.push(`zone ${id} is unreachable`);
  });

  // Zone hubs: the nav area under each zone's anchor; spawn zones use the spawn centre.
  const hubs: Spot[] = zoneIds.map((id, z) => {
    if (id === 'tspawn') return tHub;
    if (id === 'ctspawn') return ctHub;
    const ac = anchorCell[z]!;
    let best = ac >= 0 && cellArea[ac]! >= 0 && zoneOfArea[cellArea[ac]!] === z ? cellArea[ac]! : -1;
    if (best < 0) {
      let bd = Infinity;
      const at = zones[z]!.at;
      areas.forEach((_, i) => { if (zoneOfArea[i] !== z) return; const m = toMap(cen[i]![0], cen[i]![1], i); const d = (m[0] - at[0]) ** 2 + (m[1] - at[1]) ** 2; if (d < bd) { bd = d; best = i; } });
    }
    return { area: best, x: cen[best]![0], y: cen[best]![1], z: cen[best]![2] };
  });

  // Portals: where one zone opens into another, clustered so a wide doorway is one portal and two
  // separate doorways stay two.
  const nz = zoneIds.length;
  const crossings = new Map<string, { a: number; b: number; pts: Spot[] }>();
  for (const [key, m] of midOf) {
    const i = Math.floor(key / N), j = key % N;
    const za = zoneOfArea[i]!, zb = zoneOfArea[j]!;
    if (za < 0 || zb < 0 || za === zb) continue;
    const kk = `${Math.min(za, zb)}:${Math.max(za, zb)}`;
    const g = crossings.get(kk) ?? { a: Math.min(za, zb), b: Math.max(za, zb), pts: [] };
    g.pts.push(mids[m]!);
    crossings.set(kk, g);
  }
  const portalSpots: Spot[] = [];
  const portals: [number, number][] = [];
  for (const g of [...crossings.values()].sort((p, q) => p.a - q.a || p.b - q.b)) {
    const clusters: Spot[][] = [];
    for (const pt of g.pts) {
      const c = clusters.find(cl => cl.some(q => Math.hypot(q.x - pt.x, q.y - pt.y) < 220 && Math.abs(q.z - pt.z) < 120));
      if (c) c.push(pt); else clusters.push([pt]);
    }
    for (const cl of clusters) {
      const mx = cl.reduce((t, q) => t + q.x, 0) / cl.length, my = cl.reduce((t, q) => t + q.y, 0) / cl.length;
      portalSpots.push(cl.reduce((best, q) => (Math.hypot(q.x - mx, q.y - my) < Math.hypot(best.x - mx, best.y - my) ? q : best)));
      portals.push([g.a, g.b]);
    }
  }
  const nodeSpots = [...hubs, tHub, ctHub, ...portalSpots];
  const nodes: Point[] = nodeSpots.map(p => { const m = mapOf(p); return [Math.round(m[0]), Math.round(m[1])]; });

  // Edges: the fastest walk between any two nodes of the same zone (its hub, its portals, a spawn in it).
  const members = zoneIds.map((_, z) => [z]);
  portals.forEach(([a, b], q) => { members[a]!.push(nz + 2 + q); members[b]!.push(nz + 2 + q); });
  const tz = zoneOfArea[tHub.area]!, ctz = zoneOfArea[ctHub.area]!;
  if (tz >= 0) members[tz]!.push(nz);
  if (ctz >= 0) members[ctz]!.push(nz + 1);
  const edges: number[][] = [];
  const seen = new Set<string>();
  for (const list of members) {
    for (const u of list) {
      const from = [nodeSpots[u]!];
      const r = search(from);
      for (const v of list) {
        if (u === v || seen.has(`${u}>${v}`)) continue;
        seen.add(`${u}>${v}`);
        const p = pathTo(r, from, nodeSpots[v]!);
        if (!p) continue;
        const via = simplify(p.pts.map(mapOf), 4).slice(1, -1).flatMap(q => [Math.round(q[0]), Math.round(q[1])]);
        edges.push([u, v, sec(p.len), ...via]);
      }
    }
  }
  edges.sort((p, q) => p[0]! - q[0]! || p[1]! - q[1]!);

  const spawnPt = (i: number): Point => nodes[i]!;
  const geo: MapGeo = {
    id: src.id, name: cfg.name,
    world: { s: Math.round(s * 1e6) / 1e6, ox: Math.round(ox * 100) / 100, oy: Math.round(oy * 100) / 100, levels },
    floor, zones, grid: { size: G, rle: encodeGrid(grid) },
    spawn: { T: spawnPt(nz), CT: spawnPt(nz + 1) },
    arrive, nodes, portals, edges,
  };
  return { geo, report: { warnings, areas: areas.length, zones: zones.length, edges: edges.length } };
}
