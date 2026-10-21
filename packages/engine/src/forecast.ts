// Enemy position forecast: a mixture over plans × players × timing, updated by the room's intel.
// Maps are the real layouts (map units 0..1000, see geometry.ts); routes walk the map's graph.

import { BUY_TYPES, type BuyProbs, type BuyType } from './economy.ts';
import { distanceToZone, routeThrough, walkableAt, type GeoZone, type MapGeo, type Point, type Site, type Waypoint } from './geometry.ts';

export type { Point, Site, Waypoint } from './geometry.ts';
export type Zone = GeoZone;

export interface Plan {
  id: string;
  name: string;
  site: Site;
  /** Pace as a share of knife-out run speed (a rush ≈ 0.85, a slow default ≈ 0.4). */
  speed: number;
  /** One route id per enemy player. */
  lineup: readonly string[];
  /** Seconds after the round goes live before each player starts walking. */
  delay: readonly number[];
}

/**
 * A map's enemy (T) plans as authored. Routes are zone ids walked in order from T spawn: each zone is
 * entered at its nearest doorway, or crossed through its middle with a trailing `*` (`palace*`).
 */
export interface MapPlans {
  map: string;
  roundTime?: number;
  routes: Readonly<Record<string, readonly string[]>>;
  plans: readonly Plan[];
  planPriorByBuy: Readonly<Record<BuyType, Readonly<Record<string, number>>>>;
}

export interface MapModel {
  id: string;
  name: string;
  roundTime: number;
  geo: MapGeo;
  zones: readonly Zone[];
  routes: Readonly<Record<string, readonly Waypoint[]>>;
  plans: readonly Plan[];
  planPriorByBuy: Readonly<Record<BuyType, Readonly<Record<string, number>>>>;
}

export function buildMapModel(geo: MapGeo, p: MapPlans): MapModel {
  if (p.map !== geo.id) throw new Error(`plans for ${p.map} given to ${geo.id}`);
  const routes: Record<string, readonly Waypoint[]> = {};
  for (const [id, zones] of Object.entries(p.routes)) routes[id] = routeThrough(geo, 'T', zones);
  for (const plan of p.plans) for (const r of plan.lineup) if (!routes[r]) throw new Error(`${geo.id}: plan ${plan.id} uses unknown route ${r}`);
  return { id: geo.id, name: geo.name, roundTime: p.roundTime ?? 115, geo, zones: geo.zones, routes, plans: p.plans, planPriorByBuy: p.planPriorByBuy };
}

export interface Intel {
  zone: string;
  /** Enemies seen. 0 means the zone was clear. */
  count: number;
  /** Seconds since the round went live. */
  t: number;
  by?: string;
}

export type PlanProbs = Record<string, number>;

const SPREAD: readonly Point[] = [[0, 0], [12, -9], [-10, 9], [9, 12], [-12, -8]];
/** Map units per second above which a route leg is a level change, not a walk (runs are ≤ ~70). */
const LEVEL_JUMP = 150;
const TIMING_SAMPLES: readonly (readonly [dt: number, w: number])[] = [[-6, 0.1], [-3, 0.2], [0, 0.4], [3, 0.2], [6, 0.1]];

export function positionOnRoute(route: readonly Waypoint[], tt: number): Point {
  const first = route[0]!;
  if (tt <= 0) return [first[0], first[1]];
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]!, b = route[i]!;
    if (tt <= b[2]) {
      // A leg far faster than anyone runs is a change of level drawn apart (Nuke): jump, don't slide.
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) > LEVEL_JUMP * Math.max(0.1, b[2] - a[2])) return tt < b[2] ? [a[0], a[1]] : [b[0], b[1]];
      const f = b[2] > a[2] ? (tt - a[2]) / (b[2] - a[2]) : 1;
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    }
  }
  const last = route[route.length - 1]!;
  return [last[0], last[1]];
}

export function enemyPositions(map: MapModel, plan: Plan, t: number): Point[] {
  return plan.lineup.map((routeId, i) => {
    const tt = Math.max(0, t - (plan.delay[i] ?? 0)) * plan.speed;
    const p = positionOnRoute(map.routes[routeId]!, tt);
    const o = SPREAD[i % SPREAD.length]!;
    return [p[0] + o[0], p[1] + o[1]] as const;
  });
}

export function planPrior(map: MapModel, buy: BuyProbs): PlanProbs {
  const prior: PlanProbs = {};
  for (const plan of map.plans) {
    let p = 0;
    for (const b of BUY_TYPES) p += buy[b] * (map.planPriorByBuy[b][plan.id] ?? 0);
    prior[plan.id] = p;
  }
  return normalize(prior);
}

function normalize(p: PlanProbs): PlanProbs {
  const sum = Object.values(p).reduce((a, b) => a + b, 0);
  if (sum <= 0) return p;
  const out: PlanProbs = {};
  for (const k in p) out[k] = p[k]! / sum;
  return out;
}

function zoneIndex(map: MapModel, id: string): number {
  const i = map.zones.findIndex(z => z.id === id);
  if (i < 0) throw new Error(`unknown zone ${id} on ${map.id}`);
  return i;
}

/** Expected number of a plan's players near a zone at time t. */
export function expectedInZone(map: MapModel, plan: Plan, zoneId: string, t: number): number {
  const zi = zoneIndex(map, zoneId);
  let e = 0;
  for (const p of enemyPositions(map, plan, t)) {
    const d = distanceToZone(map.geo, zi, p);
    e += Math.exp(-(d * d) / (2 * 30 * 30));
  }
  return e;
}

/**
 * Posterior over plans given intel. Poisson likelihood with a floor (fakes and miscounts happen)
 * and a 0.6 temper, so one call never makes a plan certain.
 */
export function planPosterior(map: MapModel, prior: PlanProbs, intel: readonly Intel[]): PlanProbs {
  if (!intel.length) return prior;
  const post: PlanProbs = {};
  for (const plan of map.plans) {
    let l = prior[plan.id] ?? 0;
    for (const it of intel) {
      const lam = expectedInZone(map, plan, it.zone, it.t) + 0.35;
      const k = Math.min(4, Math.max(0, Math.round(it.count)));
      let fact = 1;
      for (let i = 2; i <= k; i++) fact *= i;
      l *= Math.pow((Math.pow(lam, k) * Math.exp(-lam)) / fact, 0.6);
    }
    post[plan.id] = l;
  }
  const sum = Object.values(post).reduce((a, b) => a + b, 0);
  return sum > 0 ? normalize(post) : prior;
}

export function siteForecast(map: MapModel, post: PlanProbs): Record<Site, number> {
  const out: Record<Site, number> = { A: 0, B: 0 };
  for (const plan of map.plans) out[plan.site] += post[plan.id] ?? 0;
  return out;
}

export function topPlan(post: PlanProbs): string {
  return Object.keys(post).reduce((a, b) => ((post[a] ?? 0) >= (post[b] ?? 0) ? a : b));
}

/** Earliest time (s, knife out) a T can reach the zone from spawn. Undefined for unknown or unreachable zones. */
export function earliestArrival(map: MapModel, zoneId: string): number | undefined {
  const t = map.geo.arrive[zoneId]?.[0];
  return t !== undefined && t >= 0 ? t : undefined;
}

export function isWalkable(map: MapModel, x: number, y: number, pad = 0): boolean {
  return walkableAt(map.geo, x, y, pad);
}

export interface HeatOptions {
  size?: number;
  intel?: readonly Intel[];
  /** Seconds since live used for intel decay. Defaults to t. */
  now?: number;
  plantedSite?: Site;
}

const masks = new WeakMap<MapGeo, Map<number, Uint8Array>>();
function walkMask(geo: MapGeo, size: number): Uint8Array {
  let per = masks.get(geo);
  if (!per) { per = new Map(); masks.set(geo, per); }
  let m = per.get(size);
  if (!m) {
    m = new Uint8Array(size * size);
    const cell = 1000 / size;
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) m[j * size + i] = walkableAt(geo, (i + 0.5) * cell, (j + 0.5) * cell, 3) ? 1 : 0;
    per.set(size, m);
  }
  return m;
}

/**
 * Heat grid (row-major, size×size, values 0..1 after saturation), zero off the floor.
 * Every client computes this locally from the plan posterior, so only compact state crosses the wire.
 */
export function heatGrid(map: MapModel, post: PlanProbs, t: number, opts: HeatOptions = {}): Float32Array {
  const size = opts.size ?? 160;
  const cell = 1000 / size;
  const heat = new Float32Array(size * size);
  const splat = (x: number, y: number, a: number, sig: number) => {
    const cx = x / cell, cy = y / cell, s = sig / cell, R = Math.ceil(s * 3), inv = 1 / (2 * s * s);
    const x0 = Math.max(0, Math.floor(cx - R)), x1 = Math.min(size - 1, Math.ceil(cx + R));
    const y0 = Math.max(0, Math.floor(cy - R)), y1 = Math.min(size - 1, Math.ceil(cy + R));
    for (let j = y0; j <= y1; j++) {
      const dy = j + 0.5 - cy;
      for (let i = x0; i <= x1; i++) { const dx = i + 0.5 - cx; heat[j * size + i]! += a * Math.exp(-(dx * dx + dy * dy) * inv); }
    }
  };
  for (const plan of map.plans) {
    const w = post[plan.id] ?? 0;
    if (w < 0.004) continue;
    for (const [dt, sw] of TIMING_SAMPLES) {
      const tt = Math.max(0, t + dt);
      const sig = 18 + Math.min(tt, 45) * 0.35;
      for (const p of enemyPositions(map, plan, tt)) splat(p[0], p[1], w * sw, sig);
    }
  }
  if (opts.plantedSite) {
    const site = map.zones.find(z => z.site === opts.plantedSite);
    if (site) splat(site.at[0], site.at[1], 1.6, 55);
  }
  const now = opts.now ?? t;
  for (const it of opts.intel ?? []) {
    const age = now - it.t;
    if (age < 0 || age > 25 || !it.count) continue;
    const z = map.zones[zoneIndex(map, it.zone)]!;
    splat(z.at[0], z.at[1], 0.5 * it.count * Math.exp(-age / 10), 28);
  }
  const mask = walkMask(map.geo, size);
  for (let n = 0; n < size * size; n++) heat[n] = mask[n] ? 1 - Math.exp(-heat[n]! * 1.6) : 0;
  return heat;
}
