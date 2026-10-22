// The browser demo's 2D replay: fictional movement made from csbot's own models. Our five walk to
// the call's planned spots, the enemy walks one of the map's plans (or holds a CT setup), with a few
// smokes, a molotov, kills and the plant. Everything is made up; the page says so.

import { enemyPositions, GEOS, mapToWorld, MAPS, PLAYBOOKS, type Point } from '@csbot/engine';
import type { DemoReplay, MatchRecord, ReplayRound, Side } from '@csbot/protocol';

const OURS = ['rdx', 'kairo', 'nyx', 'mbt', 'zeph'];
const THEIRS = ['Holo', 'vex', 'sk1p', 'Okami', 'Drift'];
const HZ = 4, DURATION = 45;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

export function demoReplay(rec?: MatchRecord): DemoReplay | undefined {
  if (!rec) return undefined;
  const geo = GEOS[rec.map], model = MAPS[rec.map], pb = PLAYBOOKS[rec.map];
  if (!geo || !model || !pb) return undefined;
  const world = (p: Point) => { const w = mapToWorld(geo, p[0], p[1]); return [Math.round(w.x), Math.round(w.y), 0] as const; };
  const rounds: ReplayRound[] = rec.rounds.map(r => {
    const rnd = rng(r.round * 97);
    const ourSide: Side = r.side, theirSide: Side = r.side === 'CT' ? 'T' : 'CT';
    // Our planned spots: the call's setup, else the side's default.
    const setup = pb.setups.find(s => s.id === r.call?.setup) ?? pb.setups.find(s => s.side === ourSide && !s.answers && !s.site) ?? pb.setups.find(s => s.side === ourSide);
    const spawn = ourSide === 'CT' ? geo.spawn.CT : geo.spawn.T;
    const spots: Point[] = (setup?.spots ?? []).map(s => s.at).concat(Array(5).fill(spawn)).slice(0, 5);
    // Theirs: an attack plan when they're T, a CT setup when they're CT.
    const theirModel = theirSide === 'T' ? model : model.ct ?? model;
    const plan = theirModel.plans[Math.floor(rnd() * theirModel.plans.length)]!;
    const won = r.winner === 'us';
    const ourDeaths = won ? 1 : 3, theirDeaths = won ? 4 : 2;
    const killT = (k: number) => 14 + k * 7 + rnd() * 4;
    const dies = new Map<string, number>();
    for (let k = 0; k < ourDeaths; k++) dies.set(`us${(k + r.round) % 5}`, killT(k));
    for (let k = 0; k < theirDeaths; k++) dies.set(`them${(k * 2 + r.round) % 5}`, killT(k) + 1.5);
    const players = [
      ...OURS.map((name, i) => ({ steamid: i === 0 && rec.me ? rec.me.steamid : `us${i}`, name, side: ourSide })),
      ...THEIRS.map((name, i) => ({ steamid: `them${i}`, name, side: theirSide })),
    ];
    const key = (i: number) => (i < 5 ? `us${i}` : `them${i - 5}`);
    const frames: number[][] = [];
    for (let f = 0; f <= DURATION * HZ; f++) {
      const t = f / HZ;
      const theirs = enemyPositions(theirModel, plan, t);
      const row: number[] = [];
      players.forEach((_, i) => {
        let p: Point;
        if (i < 5) {
          const k = Math.min(1, t / 9), s = spots[i]!;
          p = [spawn[0] + (s[0] - spawn[0]) * k + Math.sin(t + i) * 4, spawn[1] + (s[1] - spawn[1]) * k + Math.cos(t * 0.7 + i) * 4];
        } else p = theirs[i - 5] ?? spawn;
        const [x, y, z] = world(p);
        const dead = (dies.get(key(i)) ?? Infinity) <= t;
        row.push(x, y, z, dead ? 0 : 100);
      });
      frames.push(row);
    }
    const site = geo.zones.find(z => z.site === plan.site);
    const entry = site ? world(site.at) : [0, 0, 0] as const;
    const nades: ReplayRound['nades'] = site ? [
      { t: 12, kind: 'smoke', x: entry[0] + 150, y: entry[1] + 80, z: 0, duration: 18 },
      { t: 13, kind: 'smoke', x: entry[0] - 160, y: entry[1] - 60, z: 0, duration: 18 },
      { t: 22, kind: 'molotov', x: entry[0], y: entry[1] + 40, z: 0, duration: 7 },
      { t: 20, kind: 'flash', x: entry[0] + 60, y: entry[1], z: 0 },
    ] : [];
    const kills = [...dies].map(([victim, t]) => ({ t, victim: players[key2i(victim)]!.steamid, killer: victim.startsWith('us') ? 'them0' : (rec.me?.steamid ?? 'us0'), weapon: rnd() < 0.5 ? 'ak47' : 'm4a1_silencer' }));
    function key2i(k: string) { return k.startsWith('us') ? Number(k.slice(2)) : 5 + Number(k.slice(4)); }
    return {
      round: r.round, hz: HZ, duration: DURATION, players, frames, nades, kills: kills.sort((a, b) => a.t - b.t),
      ...(r.planted && site ? { plant: { t: 31, site: plan.site, x: entry[0], y: entry[1], z: 0 } } : {}),
    };
  });
  return { map: rec.map, rounds };
}
