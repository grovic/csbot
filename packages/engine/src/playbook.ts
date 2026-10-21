// Team playbook and engine-made calls. Claude picks among playbook entries (M5); until then, and whenever
// Claude is slow or unavailable, the engine produces these template calls itself.

import { argmax, type BuyProbs, type EnemyEconomy } from './economy.ts';
import type { Point } from './forecast.ts';

/** `player` is a playbook slot id (see Playbook.slots). Rooms assign members to slots. */
export interface SetupSpot { player: string; at: Point; label: string }
export interface Setup { id: string; name: string; side: 'CT' | 'T'; spots: readonly SetupSpot[] }

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
 * for any squad and gather-mode randoms just fill a slot.
 */
export interface Playbook {
  map: string;
  slots: readonly SlotDef[];
  setups: readonly Setup[];
  jobs: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

const fmt$ = (n: number) => '$' + Math.round(n).toLocaleString('en-US');

/** Engine template for the pre-round call (no Claude). Picks the setup by the enemy buy read. */
export function engineRoundCall(pb: Playbook, enemy: EnemyEconomy, buy: BuyProbs): Call {
  const b = argmax(buy);
  const band = `${fmt$(enemy.lo)}–${fmt$(enemy.hi)}`;
  const pick = (id: string) => pb.setups.find(s => s.id === id) ?? pb.setups[0]!;
  if (b === 'eco') {
    const s = pick('antieco');
    return { kind: 'pre', head: 'Anti-eco · stack B', sub: '3 on B · 1 on A · AWP in window', jobs: pb.jobs[s.id] ?? {}, setup: s.id, source: 'engine',
      steps: ['Long angles only', 'Trade in pairs'], why: [`Enemy est. ${band} each → eco ${Math.round(buy.eco * 100)}%`] };
  }
  const s = pick('std');
  const head = b === 'force' ? 'Anti-force · play safe' : 'Standard 2-1-2';
  return { kind: 'pre', head, sub: b === 'force' ? '2-1-2 · fall back on contact' : 'AWP in window · early info from short', jobs: pb.jobs[s.id] ?? {}, setup: s.id, source: 'engine',
    steps: b === 'force' ? ['No early peeks', 'Rotate on 3+ seen'] : ['No dry-peek on top mid', 'Rotate via CT: 9 s'], why: [`Enemy est. ${band} each → ${b} ${Math.round(buy[b] * 100)}%`] };
}

export const MIRAGE_PLAYBOOK: Playbook = {
  map: 'de_mirage',
  slots: [
    { id: 'a', label: 'A anchor' }, { id: 'short', label: 'Short / B support' }, { id: 'b', label: 'B anchor' },
    { id: 'rotator', label: 'Rotator' }, { id: 'awp', label: 'AWP' },
  ],
  setups: [
    { id: 'antieco', name: 'Anti-eco · stack B 3–2', side: 'CT', spots: [
      { player: 'b', at: [150, 150], label: 'B van' }, { player: 'short', at: [330, 262], label: 'B bench' },
      { player: 'rotator', at: [165, 390], label: 'market' }, { player: 'awp', at: [320, 430], label: 'window AWP' }, { player: 'a', at: [430, 715], label: 'A' }] },
    { id: 'std', name: 'Standard 2-1-2', side: 'CT', spots: [
      { player: 'b', at: [150, 150], label: 'B van' }, { player: 'short', at: [345, 305], label: 'short' },
      { player: 'awp', at: [320, 430], label: 'window AWP' }, { player: 'rotator', at: [300, 668], label: 'ticket' }, { player: 'a', at: [470, 730], label: 'A site' }] },
  ],
  jobs: {
    antieco: { a: 'A site alone. Play deep and fall back to CT on contact.', short: 'B bench. Hold the apps exit, long angles only.', b: 'B van. Anchor, never peek apps.', rotator: 'Market. Rotate to whichever site gets hit.', awp: 'Window AWP. Hold mid from the window.' },
    std: { a: 'A site, crossfire with ticket. Molly palace on contact.', short: 'Short. Take early info, then fall back to market.', b: 'B van. Anchor alone and call contact fast.', rotator: 'Ticket. Crossfire A, rotate to B via CT if called.', awp: 'Window AWP. Hold mid, don\'t duel Holo.' },
  },
};

export const PLAYBOOKS: Readonly<Record<string, Playbook>> = { de_mirage: MIRAGE_PLAYBOOK };

/** Positions used when a map has no playbook yet. */
export const DEFAULT_SLOTS: readonly SlotDef[] = [
  { id: 'a', label: 'A player' }, { id: 'short', label: 'Support' }, { id: 'b', label: 'B player' },
  { id: 'rotator', label: 'Rotator' }, { id: 'awp', label: 'AWP' },
];

export function slotsFor(map?: string): readonly SlotDef[] {
  return (map ? PLAYBOOKS[map]?.slots : undefined) ?? DEFAULT_SLOTS;
}
