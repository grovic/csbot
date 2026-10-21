// Replays a GSI recording (or a synthetic match) to a GSI endpoint over HTTP, with the recorded spacing.
// Runs with plain Node 24 (native TypeScript type stripping): node tools/gsi-replayer/src/replay.ts --help

import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { FIRST_HALF, FULL_MATCH, readRecording, syntheticMatch, type RecordedPayload } from '@csbot/gsi';

const HELP = `csbot GSI replayer

  node tools/gsi-replayer/src/replay.ts <recording.ndjson | --synthetic[=half|full]> <target> [options]

Target (one of):
  --runtime <userData>/runtime.json   read url + token written by a running csbot desktop app
  --url http://127.0.0.1:PORT --token TOKEN

Options:
  --lean            synthetic only: leave out round_wins and phase_countdowns
  --tick N          synthetic only: seconds between payloads in freeze time (default 2; ~0.25 = real cadence)
  --speed N         playback speed (default 1 = recorded spacing; 0 = as fast as possible)
  --from N          start at payload index N
  --loop            start over at the end (Ctrl+C to stop)
  --quiet           only print the summary
`;

// Allow a bare --synthetic (parseArgs string options need a value).
const argv = process.argv.slice(2).map(a => (a === '--synthetic' ? '--synthetic=half' : a));
const { values: v, positionals } = parseArgs({
  args: argv,
  allowPositionals: true,
  options: {
    synthetic: { type: 'string' },
    lean: { type: 'boolean', default: false },
    tick: { type: 'string' },
    runtime: { type: 'string' },
    url: { type: 'string' },
    token: { type: 'string' },
    speed: { type: 'string', default: '1' },
    from: { type: 'string', default: '0' },
    loop: { type: 'boolean', default: false },
    quiet: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

function fail(msg: string): never {
  console.error(`replay: ${msg}\n`);
  console.error(HELP);
  process.exit(2);
}

if (v.help) { console.log(HELP); process.exit(0); }

let url = v.url, token = v.token;
if (v.runtime) {
  try {
    const rt = JSON.parse(fs.readFileSync(v.runtime, 'utf8')) as { gsiUrl?: string; token?: string };
    url ??= rt.gsiUrl; token ??= rt.token;
  } catch (e) { fail(`can't read ${v.runtime}: ${(e as Error).message}`); }
}
if (!url || !token) fail('a target is needed: --runtime <file> or --url + --token');

let records: RecordedPayload[];
let label: string;
if (v.synthetic !== undefined) {
  if (v.synthetic !== 'half' && v.synthetic !== 'full') fail('--synthetic takes half or full');
  const tick = v.tick ? Number(v.tick) : undefined;
  if (tick !== undefined && !(tick > 0)) fail('--tick must be > 0');
  records = syntheticMatch({ rounds: v.synthetic === 'full' ? FULL_MATCH : FIRST_HALF, lean: v.lean, ...(tick ? { tick } : {}) });
  label = `synthetic ${v.synthetic}${v.lean ? ' (lean)' : ''}`;
} else {
  const file = positionals[0];
  if (!file) fail('give a recording file or --synthetic');
  try { records = readRecording(fs.readFileSync(file, 'utf8')); } catch (e) { fail(`can't read ${file}: ${(e as Error).message}`); }
  label = file;
}
const speed = Number(v.speed), from = Number(v.from);
if (!(speed >= 0)) fail('--speed must be >= 0');
if (!Number.isInteger(from) || from < 0 || from >= records.length) fail(`--from must be 0..${records.length - 1}`);

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
let stopping = false, sent = 0, failed = 0, consecutiveFails = 0;
const started = Date.now();
process.on('SIGINT', () => { stopping = true; });

const describe = (r: RecordedPayload) => {
  const p = r.p;
  const round = p.map?.round !== undefined ? p.map.round + 1 : '?';
  return `${p.map?.name ?? '?'} round ${round} ${p.round?.phase ?? p.map?.phase ?? ''}${p.round?.bomb ? ' · bomb ' + p.round.bomb : ''}`;
};

if (!v.quiet) console.log(`replaying ${label}: ${records.length - from} payloads → ${url} at ${speed || 'max'}×${v.loop ? ', looping' : ''}`);

do {
  const t0 = Date.now(), base = records[from]!.t;
  let lastDesc = '';
  for (let i = from; i < records.length && !stopping; i++) {
    const r = records[i]!;
    if (speed > 0) {
      const wait = t0 + (r.t - base) / speed - Date.now();
      if (wait > 0) await sleep(wait);
    }
    if (stopping) break;
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...r.p, auth: { token } }) });
      await res.arrayBuffer();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      sent++; consecutiveFails = 0;
    } catch (e) {
      failed++; consecutiveFails++;
      if (consecutiveFails >= 5) { console.error(`replay: ${url} is not answering (${(e as Error).message}). Is csbot running?`); stopping = true; process.exitCode = 1; break; }
    }
    const d = describe(r);
    if (!v.quiet && d !== lastDesc) {
      console.log(`[${((Date.now() - started) / 1000).toFixed(1).padStart(6)}s] #${String(i).padStart(5)}/${records.length}  ${d}`);
      lastDesc = d;
    }
  }
} while (v.loop && !stopping);

console.log(`replay: sent ${sent}, failed ${failed}, ${((Date.now() - started) / 1000).toFixed(1)} s`);
