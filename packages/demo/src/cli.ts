// node packages/demo/src/cli.ts [--replay] <file.dem>
// Prints a compact per-round summary so a human can sanity-check what the parser read from a demo.
// With --replay: the 2D replay instead (frames, grenades, kills, the plant) and its JSON size.

import { statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import type { DemoReplay, DemoRound, DemoTruth, Side } from '@csbot/protocol';
import { parseDemo, parseReplay } from './parse.ts';
import { teamScore } from './build.ts';
import { REPLAY_HZ, type NadeKind } from './replay.ts';

const args = process.argv.slice(2);
const replay = args.includes('--replay');
const file = args.find(a => !a.startsWith('--'));
if (!file) {
  console.error('usage: node packages/demo/src/cli.ts [--replay] <file.dem>');
  process.exit(2);
}

const pad = (v: string | number, n: number) => String(v).padStart(n);

function timed<T>(parse: (f: string) => T): { out: T; ms: number } {
  const started = performance.now();
  try {
    const out = parse(file!);
    return { out, ms: performance.now() - started };
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

function printTruth(truth: DemoTruth, ms: number): void {
  const avg = (r: DemoRound, side: Side, key: 'startMoney' | 'equipValue') => {
    const ps = r.players.filter(p => p.side === side);
    return ps.length ? Math.round(ps.reduce((s, p) => s + p[key], 0) / ps.length) : 0;
  };
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
}

function printReplay(rep: DemoReplay, ms: number): void {
  const kinds: NadeKind[] = ['smoke', 'molotov', 'flash', 'he', 'decoy'];
  console.log(`${rep.map} · ${rep.rounds.length} rounds · replay at ${REPLAY_HZ} Hz`);
  console.log('');
  console.log(' rnd  players  frames   secs  smoke molly flash   he decoy  kills  plant');
  for (const r of rep.rounds) {
    const count = (k: NadeKind) => r.nades.filter(n => n.kind === k).length;
    const plant = r.plant ? `${r.plant.site ?? '?'} @ ${r.plant.t.toFixed(1)} s` : '-';
    console.log([
      pad(r.round, 4), pad(r.players.length, 8), pad(r.frames.length, 7), pad(r.duration.toFixed(2), 6),
      ...kinds.map((k, i) => pad(count(k), i === 3 ? 4 : 5)), pad(r.kills.length, 6), '  ' + plant,
    ].join(' '));
  }
  const json = JSON.stringify(rep);
  const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;
  console.log('');
  console.log(`JSON ${kb(Buffer.byteLength(json))} (gzip ${kb(gzipSync(json).length)}) · ${rep.rounds.reduce((s, r) => s + r.frames.length, 0)} frames`);
  console.log(`parsed ${(statSync(file!).size / 1e6).toFixed(1)} MB in ${(ms / 1000).toFixed(2)} s`);
}

if (replay) {
  const { out, ms } = timed(parseReplay);
  printReplay(out, ms);
} else {
  const { out, ms } = timed(parseDemo);
  printTruth(out, ms);
}
