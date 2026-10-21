// Spike 8: CPU and memory of the desktop app while it hosts a match.
// Launches the built app hidden (CSBOT_HIDDEN=1), lets it idle, then replays a synthetic match through
// tools/gsi-replayer at real-time cadence and samples app.getAppMetrics() every second.
//
//   node tools/spikes/electron-footprint/measure.mjs [--idle 15] [--duration 120] [--speed 1] [--tick 0.25]
//
// Needs apps/desktop/dist (node apps/desktop/build.mjs) and apps/web/dist (pnpm --filter @csbot/web build).

import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const appDir = path.join(repo, 'apps/desktop');
const { values: a } = parseArgs({ options: {
  idle: { type: 'string', default: '15' }, duration: { type: 'string', default: '120' },
  speed: { type: 'string', default: '1' }, tick: { type: 'string', default: '0.25' }, out: { type: 'string' },
} });
const idleS = Number(a.idle), durS = Number(a.duration);

for (const f of ['apps/desktop/dist/main.cjs', 'apps/web/dist/index.html']) {
  if (!fs.existsSync(path.join(repo, f))) { console.error(`missing ${f}: build it first`); process.exit(2); }
}

const electronPath = createRequire(path.join(appDir, 'package.json'))('electron');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'csbot-footprint-'));
const userData = path.join(tmp, 'userData'), metricsFile = path.join(tmp, 'metrics.ndjson');
const env = { ...process.env, CSBOT_HIDDEN: '1', CSBOT_USER_DATA: userData, CSBOT_GSI_PORT: '0', CSBOT_METRICS_FILE: metricsFile, CSBOT_STEAM_PATH: path.join(tmp, 'no-steam') };
delete env.ELECTRON_RUN_AS_NODE; // otherwise Electron runs as plain Node

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...x) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...x);

log(`launching hidden app (userData ${userData})`);
const app = spawn(electronPath, [appDir], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let appOut = '';
app.stdout.on('data', d => { appOut += d; });
app.stderr.on('data', d => { appOut += d; });
let appExited = false;
app.on('exit', () => { appExited = true; });

const rtFile = path.join(userData, 'runtime.json');
for (let i = 0; i < 300 && !fs.existsSync(rtFile); i++) await sleep(100);
if (!fs.existsSync(rtFile)) { console.error('app did not start:\n' + appOut); app.kill(); process.exit(1); }
const runtime = JSON.parse(fs.readFileSync(rtFile, 'utf8'));
log(`app up, GSI at ${runtime.gsiUrl}; idling ${idleS} s`);
const tIdle = Date.now();
await sleep(idleS * 1000);

const tReplay = Date.now();
log(`replaying the full synthetic match (tick ${a.tick}, speed ${a.speed}) for ${durS} s`);
const replayer = spawn(process.execPath, [path.join(repo, 'tools/gsi-replayer/src/replay.ts'), '--synthetic=full', '--tick', a.tick, '--speed', a.speed, '--runtime', rtFile, '--quiet', '--loop'],
  { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let repOut = '';
replayer.stdout.on('data', d => { repOut += d; });
replayer.stderr.on('data', d => { repOut += d; });
await sleep(durS * 1000);
const tEnd = Date.now();
replayer.kill();
await sleep(1500);

// Payloads the app actually received: its own recording.
const recDir = path.join(userData, 'recordings');
const received = fs.existsSync(recDir) ? fs.readdirSync(recDir).reduce((n, f) => n + fs.readFileSync(path.join(recDir, f), 'utf8').split('\n').filter(Boolean).length, 0) : 0;

const samples = fs.readFileSync(metricsFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const pids = new Set(samples.flatMap(s => s.procs.map(p => p.pid)));
// Kill the whole tree: killing only the main process can leave GPU/utility children behind on Windows.
try { execFileSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { app.kill(); }
for (let i = 0; i < 50 && !appExited; i++) await sleep(100);
await sleep(1500);
const alive = [...pids].filter(pid => { try { return execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], { encoding: 'utf8' }).includes(String(pid)); } catch { return false; } });

const cores = os.cpus().length;
const avg = x => x.reduce((m, v) => m + v, 0) / Math.max(1, x.length);
const max = x => (x.length ? Math.max(...x) : 0);
/** One-core CPU % between two samples, from each process's cumulative CPU seconds. */
function cpuBetween(s0, s1) {
  let sec = 0;
  for (const p of s1.procs) {
    const q = s0.procs.find(x => x.pid === p.pid);
    if (q && p.cpuTotal !== undefined && q.cpuTotal !== undefined) sec += Math.max(0, p.cpuTotal - q.cpuTotal);
  }
  return (sec / ((s1.t - s0.t) / 1000)) * 100;
}
function stats(from, to) {
  const win = samples.filter(s => s.t >= from && s.t <= to);
  // Working set double-counts shared pages (DLLs) per process; private bytes is closer to Task Manager's "Memory".
  const ws = win.map(s => s.procs.reduce((m, p) => m + p.ws, 0) / 1024);
  const priv = win.map(s => s.procs.reduce((m, p) => m + (p.priv ?? 0), 0) / 1024);
  // Per sample, sum the processes of each type (there can be several utility processes), then average.
  const byType = {};
  for (const s of win) {
    const sum = {};
    for (const p of s.procs) { const t = (sum[p.type] ??= { ws: 0, priv: 0 }); t.ws += p.ws / 1024; t.priv += (p.priv ?? 0) / 1024; }
    for (const [k, v] of Object.entries(sum)) { const b = (byType[k] ??= { ws: [], priv: [], cpuSec: 0 }); b.ws.push(v.ws); b.priv.push(v.priv); }
  }
  const first = win[0], last = win[win.length - 1];
  for (const p of last?.procs ?? []) {
    const q = first.procs.find(x => x.pid === p.pid);
    if (q && p.cpuTotal !== undefined && q.cpuTotal !== undefined) byType[p.type].cpuSec += p.cpuTotal - q.cpuTotal;
  }
  const perSec = win.slice(1).map((s, i) => cpuBetween(win[i], s));
  const wall = first && last ? (last.t - first.t) / 1000 : 0;
  const cpuSec = Object.values(byType).reduce((m, b) => m + b.cpuSec, 0);
  const oneCore = wall ? (cpuSec / wall) * 100 : 0;
  return {
    samples: win.length,
    wsAvgMB: avg(ws), wsPeakMB: max(ws), privAvgMB: avg(priv), privPeakMB: max(priv),
    cpuOneCorePct: oneCore, cpuMachinePct: oneCore / cores, cpuPeakOneCorePct: max(perSec), cpuPeakMachinePct: max(perSec) / cores,
    byType: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, { wsAvgMB: avg(v.ws), privAvgMB: avg(v.priv), cpuSec: v.cpuSec }])),
  };
}
const idle = stats(tIdle + 3000, tReplay), replay = stats(tReplay + 2000, tEnd);
const f = n => n.toFixed(1);
const result = {
  at: new Date().toISOString(), electron: execFileSync(electronPath, ['--version'], { env, encoding: 'utf8' }).trim(), cores, os: `${os.type()} ${os.release()}`,
  options: { idleS, durS, speed: a.speed, tick: a.tick }, payloadsReceived: received, payloadRate: received / durS,
  idle, replay, leftoverProcesses: alive,
};
const row = (label, k, unit) => `${label.padEnd(26)}${f(idle[k]).padStart(8)} ${unit}${f(replay[k]).padStart(20)} ${unit}`;
console.log(`
Electron ${result.electron} · ${cores} logical cores · hidden window
payloads received while hosting: ${received} (${f(result.payloadRate)}/s)

                            idle (waiting)     hosting a match (replay)
${row('private memory avg', 'privAvgMB', 'MB')}
${row('private memory peak', 'privPeakMB', 'MB')}
${row('working set avg', 'wsAvgMB', 'MB')}
${row('working set peak', 'wsPeakMB', 'MB')}
${row('CPU avg, machine', 'cpuMachinePct', '% ')}
${row('CPU peak 1 s, machine', 'cpuPeakMachinePct', '% ')}
${row('CPU avg, one core', 'cpuOneCorePct', '% ')}

per process type while hosting (private MB / working set MB / CPU seconds):
${Object.entries(replay.byType).map(([k, v]) => `  ${k.padEnd(10)} ${f(v.privAvgMB).padStart(7)} / ${f(v.wsAvgMB).padStart(7)} / ${v.cpuSec.toFixed(2)} s`).join('\n')}

V1 exit criteria (< 400 MB, < 3% CPU, while hosting):
  memory: private ${f(replay.privPeakMB)} MB ${replay.privPeakMB < 400 ? 'PASS' : 'FAIL'} · working set ${f(replay.wsPeakMB)} MB ${replay.wsPeakMB < 400 ? 'PASS' : 'FAIL'}
  CPU:    ${f(replay.cpuMachinePct)} % machine-wide ${replay.cpuMachinePct < 3 ? 'PASS' : 'FAIL'}
leftover Electron processes: ${alive.length ? alive.join(', ') : 'none'}`);
if (repOut.trim()) console.log('replayer: ' + repOut.trim().split('\n').slice(-2).join(' | '));
const out = a.out ?? path.join(here, 'results.json');
fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
console.log(`\nwrote ${path.relative(repo, out)}`);
fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
