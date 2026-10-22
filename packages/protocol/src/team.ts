// The team plan (M7): the squad's own playbook per map, and anti-strats for specific opponents. The
// room admin edits it in their desktop app (it stays on that PC); the room shares it read-only. Every
// device applies it to its own engine, so calls, jobs, planned spots and the forecast agree.

import type { BuyType } from './index.ts';

export type TeamPoint = readonly [number, number];
export interface TeamSlot { id: string; label: string }
export interface TeamSpot { player: string; at: TeamPoint; label: string }
export interface TeamCallText { head: string; sub: string; steps: readonly string[] }

/** One setup, the engine's own shape (packages/engine Setup). */
export interface TeamSetup {
  id: string;
  name: string;
  side: 'CT' | 'T';
  spots: readonly TeamSpot[];
  /** Buys this setup answers. CT: the enemy's buy. T: our own buy. Omitted = the side's default. */
  answers?: readonly BuyType[];
  /** T executes: the site it hits. */
  site?: 'A' | 'B';
  calls?: Partial<Readonly<Record<BuyType | 'default', TeamCallText>>>;
}

/** A whole map's playbook, the engine's own shape (packages/engine Playbook). */
export interface TeamPlaybook {
  map: string;
  slots: readonly TeamSlot[];
  tSlots?: readonly TeamSlot[];
  setups: readonly TeamSetup[];
  jobs: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

/** How an opponent plays one map, and how we answer. */
export interface AntiStratMap {
  /** Their T plans (by plan id): how often they run it compared with most teams (see WEIGHTS). */
  tWeights?: Readonly<Record<string, number>>;
  /** Their CT setups (by plan id), the same way. */
  ctWeights?: Readonly<Record<string, number>>;
  /** Our CT setup (by id) against each of their buys. */
  answers?: Partial<Readonly<Record<BuyType, string>>>;
  /** For the squad and the coach: what to remember about them here. */
  notes?: string;
}

export interface AntiStrat {
  id: string;
  /** The opponent (team or player names). */
  name: string;
  maps: Readonly<Record<string, AntiStratMap>>;
  updatedAt: number;
}

export type LineupKind = 'smoke' | 'molotov' | 'flash' | 'he';

/** A utility lineup: where it's thrown from and where it lands (map units), and how. */
export interface Lineup {
  id: string;
  name: string;
  kind: LineupKind;
  side: 'CT' | 'T';
  from: TeamPoint;
  to: TeamPoint;
  /** The technique: "Jumpthrow", "Run + jumpthrow", "Stand, right click"… */
  how?: string;
  notes?: string;
  /**
   * The exact spot from your own practice server (setpos x y z and setang pitch yaw), for the practice
   * config. Without it the config puts you near the throw spot, facing the landing spot.
   */
  exact?: { pos: readonly [number, number, number]; ang: readonly [number, number] };
  /** The setups (ids) that use it: their calls list it. */
  setups?: readonly string[];
}

export interface TeamPlan {
  /** Only the maps the team changed; the rest use csbot's playbook. */
  playbooks: Readonly<Record<string, TeamPlaybook>>;
  /** Utility lineups, for the maps the team changed; the rest use csbot's starter list. */
  lineups?: Readonly<Record<string, readonly Lineup[]>>;
  antistrats: readonly AntiStrat[];
  /** The anti-strat in use (its id), if any. */
  active?: string;
}

export const EMPTY_TEAM: TeamPlan = { playbooks: {}, antistrats: [] };

/** The weights an anti-strat can give a plan, and what the editor calls them. */
export const WEIGHTS: readonly { w: number; label: string }[] = [
  { w: 0, label: 'Never' }, { w: 0.5, label: 'Less' }, { w: 1, label: 'Usual' }, { w: 2, label: 'More' }, { w: 4, label: 'Mostly' },
];

const BUYS: readonly BuyType[] = ['eco', 'force', 'half', 'full'];
const ID = /^[a-z0-9_-]{1,32}$/i;
const MAP = /^de_[a-z0-9_]{1,24}$/;

const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);
const obj = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined);
const arr = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);
const num = (v: unknown, lo: number, hi: number): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined);

function slots(v: unknown): TeamSlot[] | undefined {
  const out = arr(v, 8).flatMap(s => {
    const o = obj(s), id = str(o?.id, 24), label = str(o?.label, 24);
    return id && ID.test(id) && label ? [{ id, label }] : [];
  });
  return out.length ? out : undefined;
}

function callText(v: unknown): TeamCallText | undefined {
  const o = obj(v), head = str(o?.head, 60), sub = str(o?.sub, 120);
  if (!head) return undefined;
  return { head, sub: sub ?? '', steps: arr(o?.steps, 3).flatMap(s => { const t = str(s, 40); return t ? [t] : []; }) };
}

function setup(v: unknown): TeamSetup | undefined {
  const o = obj(v);
  const id = str(o?.id, 32), name = str(o?.name, 40);
  if (!id || !ID.test(id) || !name || (o?.side !== 'CT' && o?.side !== 'T')) return undefined;
  const spots = arr(o.spots, 8).flatMap(s => {
    const p = obj(s), player = str(p?.player, 24), at = Array.isArray(p?.at) ? p.at : [];
    const x = num(at[0], 0, 1000), y = num(at[1], 0, 1000);
    return player && x !== undefined && y !== undefined ? [{ player, at: [Math.round(x), Math.round(y)] as const, label: str(p?.label, 40) ?? '' }] : [];
  });
  const answers = arr(o.answers, 4).filter((b): b is BuyType => BUYS.includes(b as BuyType));
  const calls: Partial<Record<BuyType | 'default', TeamCallText>> = {};
  const co = obj(o.calls);
  for (const k of [...BUYS, 'default'] as const) { const c = callText(co?.[k]); if (c) calls[k] = c; }
  return {
    id, name, side: o.side, spots,
    ...(answers.length ? { answers: [...new Set(answers)] } : {}),
    ...(o.site === 'A' || o.site === 'B' ? { site: o.site } : {}),
    ...(Object.keys(calls).length ? { calls } : {}),
  };
}

function playbook(map: string, v: unknown): TeamPlaybook | undefined {
  const o = obj(v);
  const s = slots(o?.slots);
  if (!o || !s) return undefined;
  const t = slots(o.tSlots);
  const setups = arr(o.setups, 24).flatMap(x => { const y = setup(x); return y ? [y] : []; });
  const ids = new Set<string>();
  const unique = setups.filter(x => (ids.has(x.id) ? false : (ids.add(x.id), true)));
  const jobs: Record<string, Record<string, string>> = {};
  const jo = obj(o.jobs);
  for (const sid of ids) {
    const j = obj(jo?.[sid]);
    if (!j) continue;
    const per: Record<string, string> = {};
    for (const [slot, text] of Object.entries(j).slice(0, 8)) { const t2 = str(text, 80); if (ID.test(slot) && t2) per[slot] = t2; }
    jobs[sid] = per;
  }
  return unique.length ? { map, slots: s, ...(t ? { tSlots: t } : {}), setups: unique, jobs } : undefined;
}

function weights(v: unknown): Record<string, number> | undefined {
  const o = obj(v);
  if (!o) return undefined;
  const out: Record<string, number> = {};
  for (const [k, w] of Object.entries(o).slice(0, 24)) { const n = num(w, 0, 4); if (ID.test(k) && n !== undefined && n !== 1) out[k] = n; }
  return Object.keys(out).length ? out : undefined;
}

function antistrat(v: unknown): AntiStrat | undefined {
  const o = obj(v);
  const id = str(o?.id, 32), name = str(o?.name, 48);
  if (!o || !id || !ID.test(id) || !name) return undefined;
  const maps: Record<string, AntiStratMap> = {};
  for (const [map, raw] of Object.entries(obj(o.maps) ?? {}).slice(0, 12)) {
    const m = obj(raw);
    if (!MAP.test(map) || !m) continue;
    const tw = weights(m.tWeights), cw = weights(m.ctWeights), notes = str(m.notes, 600);
    const answers: Partial<Record<BuyType, string>> = {};
    const ao = obj(m.answers);
    for (const b of BUYS) { const s = str(ao?.[b], 32); if (s && ID.test(s)) answers[b] = s; }
    const one: AntiStratMap = {
      ...(tw ? { tWeights: tw } : {}), ...(cw ? { ctWeights: cw } : {}),
      ...(Object.keys(answers).length ? { answers } : {}), ...(notes ? { notes } : {}),
    };
    if (Object.keys(one).length) maps[map] = one;
  }
  return { id, name, maps, updatedAt: num(o.updatedAt, 0, 1e14) ?? 0 };
}

const KINDS: readonly LineupKind[] = ['smoke', 'molotov', 'flash', 'he'];
const pt = (v: unknown): TeamPoint | undefined => {
  const a = Array.isArray(v) ? v : [];
  const x = num(a[0], 0, 1000), y = num(a[1], 0, 1000);
  return x !== undefined && y !== undefined ? [Math.round(x), Math.round(y)] : undefined;
};

function lineup(v: unknown): Lineup | undefined {
  const o = obj(v);
  const id = str(o?.id, 32), name = str(o?.name, 48), from = pt(o?.from), to = pt(o?.to);
  if (!o || !id || !ID.test(id) || !name || !from || !to || !KINDS.includes(o.kind as LineupKind) || (o.side !== 'CT' && o.side !== 'T')) return undefined;
  const how = str(o.how, 40), notes = str(o.notes, 300);
  const ex = obj(o.exact), pos = Array.isArray(ex?.pos) ? ex.pos : [], ang = Array.isArray(ex?.ang) ? ex.ang : [];
  const p = [num(pos[0], -20000, 20000), num(pos[1], -20000, 20000), num(pos[2], -20000, 20000)];
  const a = [num(ang[0], -90, 90), num(ang[1], -360, 360)];
  const exact = p.every(x => x !== undefined) && a.every(x => x !== undefined)
    ? { pos: p.map(x => Math.round(x! * 100) / 100) as unknown as readonly [number, number, number], ang: a.map(x => Math.round(x! * 100) / 100) as unknown as readonly [number, number] }
    : undefined;
  const setups = arr(o.setups, 12).flatMap(s => { const t = str(s, 32); return t && ID.test(t) ? [t] : []; });
  return {
    id, name, kind: o.kind as LineupKind, side: o.side, from, to,
    ...(how ? { how } : {}), ...(notes ? { notes } : {}), ...(exact ? { exact } : {}), ...(setups.length ? { setups: [...new Set(setups)] } : {}),
  };
}

/** "setpos 1 2 3;setang 4 5 6" (from the console of your own practice server) → an exact spot. */
export function parseSetpos(text: string): Lineup['exact'] | undefined {
  const n = String.raw`(-?\d+(?:\.\d+)?)`;
  const pos = new RegExp(String.raw`setpos(?:_exact)?\s+` + `${n}\\s+${n}\\s+${n}`, 'i').exec(text);
  const ang = new RegExp(String.raw`setang(?:_exact)?\s+` + `${n}\\s+${n}`, 'i').exec(text);
  if (!pos || !ang) return undefined;
  const l = lineup({ id: 'x', name: 'x', kind: 'smoke', side: 'T', from: [0, 0], to: [0, 0], exact: { pos: [Number(pos[1]), Number(pos[2]), Number(pos[3])], ang: [Number(ang[1]), Number(ang[2])] } });
  return l?.exact;
}

/** A team plan from anywhere (disk, the room): anything malformed is dropped, sizes are capped. */
export function sanitizeTeam(raw: unknown): TeamPlan {
  const o = obj(raw);
  if (!o) return EMPTY_TEAM;
  const playbooks: Record<string, TeamPlaybook> = {};
  for (const [map, pb] of Object.entries(obj(o.playbooks) ?? {}).slice(0, 12)) {
    if (!MAP.test(map)) continue;
    const p = playbook(map, pb);
    if (p) playbooks[map] = p;
  }
  const ids = new Set<string>();
  const antistrats = arr(o.antistrats, 40).flatMap(a => { const x = antistrat(a); return x && !ids.has(x.id) ? (ids.add(x.id), [x]) : []; });
  const active = typeof o.active === 'string' && ids.has(o.active) ? o.active : undefined;
  const lineups: Record<string, Lineup[]> = {};
  for (const [map, list] of Object.entries(obj(o.lineups) ?? {}).slice(0, 12)) {
    if (!MAP.test(map)) continue;
    const seen = new Set<string>();
    lineups[map] = arr(list, 80).flatMap(x => { const l = lineup(x); return l && !seen.has(l.id) ? (seen.add(l.id), [l]) : []; });
  }
  return { playbooks, antistrats, ...(active ? { active } : {}), ...(Object.keys(lineups).length ? { lineups } : {}) };
}
