// Gather mode (PROPOSAL §3.6): fewer than five of us in the room, so the match's randoms take the
// slots nobody in the room plays. A random goes to the slot their usual role fits (AWP, entry), the
// rest fill the remaining slots, the AWP slot last (a random rarely brings the AWP).

import type { SlotDef } from '@csbot/engine';

export interface RandomPlayer { name: string; /** Role guess from scouting: 'AWP', 'Entry'. */ role?: string }
export interface RandomSlot { slot: string; name: string }

const prefers = (r: RandomPlayer) => (/awp|sniper/i.test(r.role ?? '') ? 'awp' : /entry/i.test(r.role ?? '') ? 'a' : undefined);

export function gatherSlots(slots: readonly SlotDef[], taken: ReadonlySet<string>, randoms: readonly RandomPlayer[]): RandomSlot[] {
  const free = slots.map(s => s.id).filter(id => !taken.has(id));
  const out: RandomSlot[] = [];
  const left: RandomPlayer[] = [];
  for (const r of randoms) {
    const p = prefers(r);
    const i = p ? free.indexOf(p) : -1;
    if (i >= 0) { out.push({ slot: free[i]!, name: r.name }); free.splice(i, 1); } else left.push(r);
  }
  const order = [...free.filter(s => s !== 'awp'), ...free.filter(s => s === 'awp')];
  for (const r of left) {
    const s = order.shift();
    if (!s) break;
    out.push({ slot: s, name: r.name });
  }
  return out;
}
