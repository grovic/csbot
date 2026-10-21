// Team playbook and engine-made calls. Claude picks among playbook entries (M5); until then, and whenever
// Claude is slow or unavailable, the engine produces these template calls itself.

import { argmax, type BuyProbs, type BuyType, type EnemyEconomy } from './economy.ts';
import { walkableAt, type MapGeo, type Point } from './geometry.ts';

/** `player` is a playbook slot id (see Playbook.slots). Rooms assign members to slots. */
export interface SetupSpot { player: string; at: Point; label: string }

/** The engine's words for a setup: headline, one line, up to 3 chips. */
export interface CallText { head: string; sub: string; steps: readonly string[] }

export interface Setup {
  id: string;
  name: string;
  side: 'CT' | 'T';
  spots: readonly SetupSpot[];
  /** Enemy buys this setup answers (the engine picks it for them). Omitted = the default setup. */
  answers?: readonly BuyType[];
  /** Call text per enemy buy, else `default`. */
  calls?: Partial<Readonly<Record<BuyType | 'default', CallText>>>;
}

export type CallKind = 'pre' | 'mid' | 'post' | 'over';

export interface Call {
  kind: CallKind;
  head: string;
  sub: string;
  /** One job per player. Each client shows its own as the YOU line. */
  jobs: Readonly<Record<string, string>>;
  steps: readonly string[];
  setup: string;
  why: readonly string[];
  source: 'engine' | 'claude';
}

export interface SlotDef { id: string; label: string }

/**
 * A team's plays for one map. Jobs and spots are keyed by slot (a position in the team, like
 * "A anchor"), not by player: the room maps its members to slots, so the same playbook works
 * for any squad and gather-mode randoms just fill a slot. Every map uses the same five slot ids
 * (a, short, b, rotator, awp) with its own labels, so room assignments survive a map change.
 */
export interface Playbook {
  map: string;
  slots: readonly SlotDef[];
  setups: readonly Setup[];
  jobs: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

/** Authored form: spots name a zone; positions come from the map. */
export interface SpotDef { player: string; zone: string; label: string; at?: Point }
export interface SetupDef extends Omit<Setup, 'spots'> { spots: readonly SpotDef[] }
export interface PlaybookDef extends Omit<Playbook, 'setups'> { setups: readonly SetupDef[] }

export const SLOT_IDS = ['a', 'short', 'b', 'rotator', 'awp'] as const;

/** Positions used when a map has no playbook yet. */
export const DEFAULT_SLOTS: readonly SlotDef[] = [
  { id: 'a', label: 'A player' }, { id: 'short', label: 'Support' }, { id: 'b', label: 'B player' },
  { id: 'rotator', label: 'Rotator' }, { id: 'awp', label: 'AWP' },
];

const NUDGE: readonly Point[] = [[0, 40], [32, 24], [-32, 24], [0, -40], [32, -24], [-32, -24], [0, 60], [0, 24], [0, 0]];

/** Resolve zone-based spots to map points (players sharing a zone are spread a little). */
export function buildPlaybook(geo: MapGeo, def: PlaybookDef): Playbook {
  if (def.map !== geo.id) throw new Error(`playbook for ${def.map} given to ${geo.id}`);
  const slots = new Set(def.slots.map(s => s.id));
  const setups = def.setups.map(s => {
    const used = new Map<string, number>();
    const spots = s.spots.map(sp => {
      if (!slots.has(sp.player)) throw new Error(`${geo.id}/${s.id}: unknown slot ${sp.player}`);
      if (sp.at) return { player: sp.player, at: sp.at, label: sp.label };
      const z = geo.zones.find(x => x.id === sp.zone);
      if (!z) throw new Error(`${geo.id}/${s.id}: unknown zone ${sp.zone}`);
      const n = used.get(z.id) ?? 0;
      used.set(z.id, n + 1);
      // The n-th free nudge that stays on the floor.
      let k = 0, at: Point = z.at;
      for (const d of NUDGE) {
        const p: Point = [z.at[0] + d[0], z.at[1] + d[1]];
        if (!walkableAt(geo, p[0], p[1])) continue;
        if (k++ === n) { at = p; break; }
      }
      return { player: sp.player, at, label: sp.label };
    });
    return { ...s, spots };
  });
  for (const s of setups) for (const id of Object.keys(def.jobs[s.id] ?? {})) if (!slots.has(id)) throw new Error(`${geo.id}/${s.id}: job for unknown slot ${id}`);
  return { map: def.map, slots: def.slots, setups, jobs: def.jobs };
}

const fmt$ = (n: number) => '$' + Math.round(n).toLocaleString('en-US');

const GENERIC: Readonly<Record<BuyType, CallText>> = {
  eco: { head: 'Anti-eco', sub: 'Hold long angles · trade in pairs', steps: ['Long angles only', 'Trade in pairs'] },
  force: { head: 'Anti-force · play safe', sub: 'Default setup · fall back on contact', steps: ['No early peeks', 'Rotate on 3+ seen'] },
  half: { head: 'Default setup', sub: 'Hold your spots · call contact fast', steps: ['No dry peeks', 'Call numbers'] },
  full: { head: 'Default setup', sub: 'Hold your spots · call contact fast', steps: ['No dry peeks', 'Call numbers'] },
};

/** Engine template for the pre-round call on CT (no Claude). Picks the setup by the enemy buy read. */
export function engineRoundCall(pb: Playbook, enemy: EnemyEconomy, buy: BuyProbs): Call {
  const b = argmax(buy);
  const band = `${fmt$(enemy.lo)}–${fmt$(enemy.hi)}`;
  const ct = pb.setups.filter(s => s.side === 'CT');
  const s = ct.find(x => x.answers?.includes(b)) ?? ct.find(x => !x.answers) ?? ct[0] ?? pb.setups[0]!;
  const text = s.calls?.[b] ?? s.calls?.default ?? GENERIC[b];
  return {
    kind: 'pre', head: text.head, sub: text.sub, jobs: pb.jobs[s.id] ?? {}, setup: s.id, source: 'engine',
    steps: [...text.steps], why: [`Enemy est. ${band} each → ${b} ${Math.round(buy[b] * 100)}%`],
  };
}
