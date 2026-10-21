// Enemy position forecast: a mixture over plans × players × timing, updated by the room's intel.
// Coordinates are map units 0..1000 (schematic). Real maps are built from demo positions later.

import { BUY_TYPES, type BuyProbs, type BuyType } from './economy.ts';

export type Site = 'A' | 'B';
export type Point = readonly [x: number, y: number];
export type Rect = readonly [x: number, y: number, w: number, h: number];
/** [x, y, seconds since round start at full run speed] */
export type Waypoint = readonly [x: number, y: number, t: number];

export interface Zone { id: string; name: string; rect: Rect; site?: Site }
export interface Plan { id: string; name: string; site: Site; speed: number; lineup: readonly string[]; delay: readonly number[] }

export interface MapModel {
  id: string;
  roundTime: number;
  zones: readonly Zone[];
  routes: Readonly<Record<string, readonly Waypoint[]>>;
  plans: readonly Plan[];
  planPriorByBuy: Readonly<Record<BuyType, Readonly<Record<string, number>>>>;
  /** Zone → [route, waypoint index] used for "earliest enemy arrival". */
  timed: Readonly<Record<string, readonly [string, number]>>;
  /** Fastest plan speed, used for earliest arrivals. */
  rushSpeed: number;
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

const SPREAD: readonly Point[] = [[0, 0], [16, -12], [-14, 12], [12, 16], [-16, -10]];
const TIMING_SAMPLES: readonly (readonly [dt: number, w: number])[] = [[-6, 0.1], [-3, 0.2], [0, 0.4], [3, 0.2], [6, 0.1]];

export function positionOnRoute(route: readonly Waypoint[], tt: number): Point {
  const first = route[0]!;
  if (tt <= 0) return [first[0], first[1]];
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]!, b = route[i]!;
    if (tt <= b[2]) {
      const f = (tt - a[2]) / (b[2] - a[2]);
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

export function distanceToRect(p: Point, r: Rect): number {
  const dx = Math.max(r[0] - p[0], 0, p[0] - (r[0] + r[2]));
  const dy = Math.max(r[1] - p[1], 0, p[1] - (r[1] + r[3]));
  return Math.hypot(dx, dy);
}

function zone(map: MapModel, id: string): Zone {
  const z = map.zones.find(z => z.id === id);
  if (!z) throw new Error(`unknown zone ${id} on ${map.id}`);
  return z;
}

/** Expected number of a plan's players near a zone at time t. */
export function expectedInZone(map: MapModel, plan: Plan, zoneId: string, t: number): number {
  const r = zone(map, zoneId).rect;
  let e = 0;
  for (const p of enemyPositions(map, plan, t)) {
    const d = distanceToRect(p, r);
    e += Math.exp(-(d * d) / (2 * 35 * 35));
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

export function earliestArrival(map: MapModel, zoneId: string): number | undefined {
  const timed = map.timed[zoneId];
  if (!timed) return undefined;
  const wp = map.routes[timed[0]]?.[timed[1]];
  return wp ? wp[2] / map.rushSpeed : undefined;
}

export function isWalkable(map: MapModel, x: number, y: number, pad = 0): boolean {
  return map.zones.some(z => x >= z.rect[0] - pad && x <= z.rect[0] + z.rect[2] + pad && y >= z.rect[1] - pad && y <= z.rect[1] + z.rect[3] + pad);
}

export interface HeatOptions {
  size?: number;
  intel?: readonly Intel[];
  /** Seconds since live used for intel decay. Defaults to t. */
  now?: number;
  plantedSite?: Site;
}

/**
 * Heat grid (row-major, size×size, values 0..1 after saturation), zero outside walkable zones.
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
      const sig = 24 + Math.min(tt, 45) * 0.45;
      for (const p of enemyPositions(map, plan, tt)) splat(p[0], p[1], w * sw, sig);
    }
  }
  if (opts.plantedSite) {
    const site = map.zones.find(z => z.site === opts.plantedSite);
    if (site) splat(site.rect[0] + site.rect[2] / 2, site.rect[1] + site.rect[3] / 2, 1.6, 70);
  }
  const now = opts.now ?? t;
  for (const it of opts.intel ?? []) {
    const age = now - it.t;
    if (age < 0 || age > 25 || !it.count) continue;
    const r = zone(map, it.zone).rect;
    splat(r[0] + r[2] / 2, r[1] + r[3] / 2, 0.5 * it.count * Math.exp(-age / 10), 34);
  }
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const n = j * size + i;
      heat[n] = isWalkable(map, (i + 0.5) * cell, (j + 0.5) * cell, 4) ? 1 - Math.exp(-heat[n]! * 1.6) : 0;
    }
  }
  return heat;
}
