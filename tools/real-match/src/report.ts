// The V1 numbers from a real match played with the playtest build (csbot started with --metrics).
//
//   node tools/real-match/src/report.ts [--dir %APPDATA%\csbot\metrics] [--session 2026-10-23_210512]
//
// Reads <session>.ndjson (process metrics) and <session>.events.ndjson (round ends, calls on every
// screen, the coach, room members), prints the numbers, and writes <session>.report.json next to them.
// Everything stays on this PC (member names and match ids are in there).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { analyze, type Event, type MatchReport, type Sample, type Stat } from './analyze.ts';

const { values: a } = parseArgs({ options: { dir: { type: 'string' }, session: { type: 'string' } } });
const dir = a.dir ?? path.join(process.env.APPDATA ?? os.homedir(), 'csbot', 'metrics');
if (!fs.existsSync(dir)) { console.error(`no metrics folder at ${dir}`); process.exit(2); }
const sessions = fs.readdirSync(dir).filter(f => f.endsWith('.events.ndjson')).map(f => f.replace(/\.events\.ndjson$/, '')).sort();
const session = a.session ?? sessions[sessions.length - 1];
if (!session) { console.error(`no measurement runs with events in ${dir} (csbot 0.20+ started with --metrics)`); process.exit(2); }

const lines = (f: string) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } }) : []);
const samples = lines(path.join(dir, `${session}.ndjson`)) as Sample[];
const events = lines(path.join(dir, `${session}.events.ndjson`)) as Event[];
const reports = analyze(samples, events, { cores: os.cpus().length });

const s = (x: Stat) => (x.n ? `p50 ${x.p50} s · p95 ${x.p95} s · max ${x.max} s (n=${x.n})` : 'none');
const ok = (b: boolean | undefined) => (b === undefined ? 'n/a' : b ? 'PASS' : 'FAIL');
const start = events.find(e => e.ev === 'start');
console.log(`session ${session} · csbot ${start?.version ?? '?'} · low-memory ${start?.lowMemory ?? '?'} · ${samples.length} metric samples, ${events.length} events`);
if (!reports.length) console.log('No match in this run.');
for (const m of reports as MatchReport[]) {
  console.log(`\n== ${m.map}${m.mode ? ` (${m.mode})` : ''} · ${m.rounds} rounds · ${m.minutes} min · ${m.finished ? 'finished' : 'not finished'}`);
  const f = m.footprint;
  if (f) {
    console.log(`memory (private, all csbot processes): avg ${f.privAvgMB} MB, peak ${f.privPeakMB} MB → ${ok(f.pass.memory)} (< 400 MB)`);
    console.log(`CPU (whole machine): avg ${f.cpuMachinePct}%, peak 1 s ${f.cpuPeakMachinePct}% → ${ok(f.pass.cpu)} (< 3%)`);
    console.log(`window on screen: ${f.windowVisible !== undefined ? `${Math.round(f.windowVisible * 100)}% of the match` : 'unknown'}`);
    console.log(`by process: ${Object.entries(f.byType).map(([k, v]) => `${k} ${v.privAvgMB} MB / ${v.cpuSec} s CPU`).join(' · ')}`);
  } else console.log('memory and CPU: no samples (was csbot started with --metrics?)');
  console.log(`calls after ${m.calls.roundEnds} round ends → ${ok(m.calls.pass)} (p95 ≤ 8 s)`);
  for (const sc of m.calls.screens) console.log(`  ${sc.device.padEnd(7)} ${sc.name.padEnd(16)} first call ${s(sc.firstCall)} | Claude's ${s(sc.claudeCall)}`);
  console.log(`coach: ${m.coach.requests} requests ${JSON.stringify(m.coach.byStatus)} · Claude ${s(m.coach.ms)}${m.coach.model ? ` · ${m.coach.model}` : ''}${m.coach.costUsd !== undefined ? ` · plan usage ≈ $${m.coach.costUsd.toFixed(2)} at API prices` : ''}`);
  console.log(`room: ${m.room.members.length ? m.room.members.join(', ') : 'no members'}${m.room.reconnects.length ? ` · reconnects ${m.room.reconnects.map(r => `${r.name} ${r.seconds} s`).join(', ')} → ${ok((m.room.reconnectP95 ?? 0) < 5)} (< 5 s)` : ''}`);
  console.log(`FACEIT recent matches: ${m.faceit.seen ? (m.faceit.liveStatuses.length ? `a match showed as ${m.faceit.liveStatuses.join('/')} while played` : 'no match showed as live') : 'not checked (no key or nickname)'}`);
}
const out = path.join(dir, `${session}.report.json`);
fs.writeFileSync(out, JSON.stringify({ session, at: new Date().toISOString(), reports }, null, 2) + '\n');
console.log(`\nwrote ${out}`);
