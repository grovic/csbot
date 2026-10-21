// node packages/demo/src/cli.ts <file.dem>
// Prints a compact per-round summary so a human can sanity-check what the parser read from a demo.

import type { DemoRound, Side } from '@csbot/protocol';
import { parseDemo } from './parse.ts';
import { teamScore } from './build.ts';

const file = process.argv[2];
if (!file) {
  console.error('usage: node packages/demo/src/cli.ts <file.dem>');
  process.exit(2);
}

const started = performance.now();
let truth;
try {
  truth = parseDemo(file);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
const ms = performance.now() - started;

const avg = (r: DemoRound, side: Side, key: 'startMoney' | 'equipValue') => {
  const ps = r.players.filter(p => p.side === side);
  return ps.length ? Math.round(ps.reduce((s, p) => s + p[key], 0) / ps.length) : 0;
};
const pad = (v: string | number, n: number) => String(v).padStart(n);

const score = teamScore(truth);
console.log(`${truth.map} · ${truth.rounds.length} rounds · ${truth.players.length} players · score ${score.startedT}-${score.startedCT} (team that started T - team that started CT)`);
console.log('');
console.log(' rnd  win  reason        T start  T equip  CT start CT equip  n(T/CT)  plant  deaths');
for (const r of truth.rounds) {
  const nT = r.players.filter(p => p.side === 'T').length;
  const nCT = r.players.filter(p => p.side === 'CT').length;
  console.log([
    pad(r.round, 4), pad(r.winner, 4), ' ' + (r.reason ?? '-').padEnd(12),
    pad(avg(r, 'T', 'startMoney'), 8), pad(avg(r, 'T', 'equipValue'), 8),
    pad(avg(r, 'CT', 'startMoney'), 9), pad(avg(r, 'CT', 'equipValue'), 8),
    pad(`${nT}/${nCT}`, 8), pad(r.plantSite ?? (r.plantAt ? '?' : '-'), 6), pad(r.deaths.length, 7),
  ].join(' '));
}
console.log('');
console.log(`parsed ${(truth.source.bytes / 1e6).toFixed(1)} MB in ${(ms / 1000).toFixed(2)} s`);
