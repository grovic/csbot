// Team playbook and engine-made calls. Claude picks among playbook entries (M5); until then, and whenever
// Claude is slow or unavailable, the engine produces these template calls itself.

import { argmax, type BuyProbs, type EnemyEconomy } from './economy.ts';
import type { Point } from './forecast.ts';

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

export interface Playbook { map: string; setups: readonly Setup[]; jobs: Readonly<Record<string, Readonly<Record<string, string>>>> }

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
  setups: [
    { id: 'antieco', name: 'Anti-eco · stack B 3–2', side: 'CT', spots: [
      { player: 'nyx', at: [150, 150], label: 'B van' }, { player: 'kairo', at: [330, 262], label: 'B bench' },
      { player: 'mbt', at: [165, 390], label: 'market' }, { player: 'zeph', at: [320, 430], label: 'window AWP' }, { player: 'rdx', at: [430, 715], label: 'A' }] },
    { id: 'std', name: 'Standard 2-1-2', side: 'CT', spots: [
      { player: 'nyx', at: [150, 150], label: 'B van' }, { player: 'kairo', at: [345, 305], label: 'short' },
      { player: 'zeph', at: [320, 430], label: 'window AWP' }, { player: 'mbt', at: [300, 668], label: 'ticket' }, { player: 'rdx', at: [470, 730], label: 'A site' }] },
  ],
  jobs: {
    antieco: { rdx: 'A site alone. Play deep and fall back to CT on contact.', kairo: 'B bench. Hold the apps exit, long angles only.', nyx: 'B van. Anchor, never peek apps.', mbt: 'Market. Rotate to whichever site gets hit.', zeph: 'Window AWP (random: his usual spot).' },
    std: { rdx: 'A site, crossfire with ticket. Molly palace on contact.', kairo: 'Short. Take early info, then fall back to market.', nyx: 'B van. Anchor alone and call contact fast.', mbt: 'Ticket. Crossfire A, rotate to B via CT if called.', zeph: 'Window AWP. Hold mid, don\'t duel Holo.' },
  },
};
