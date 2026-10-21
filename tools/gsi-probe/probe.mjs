#!/usr/bin/env node
// csbot GSI probe: answers "when does CS2 send player positions?"
// Listens on localhost only, logs every payload, and prints a verdict when you press Ctrl+C.
// Node 18+, no dependencies.  Usage: node probe.mjs
// env: PORT=47399  TOKEN=csbot-probe  LOG_DIR=.  MAX_LOG_LINES=60000 (raw payloads kept; counting continues after)
// Also writes summary.txt in LOG_DIR every 20 s while payloads arrive, so an unattended run can be read later.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.PORT || 47399);
const TOKEN = process.env.TOKEN || 'csbot-probe';
const LOG_DIR = process.env.LOG_DIR || '.';
const MAX_LOG_LINES = Number(process.env.MAX_LOG_LINES || 60000);
fs.mkdirSync(LOG_DIR, { recursive: true });
const logFile = path.join(LOG_DIR, `gsi-probe-${new Date().toISOString().replace(/[:.]/g, '-')}.ndjson`);
const summaryFile = path.join(LOG_DIR, 'summary.txt');
const log = fs.createWriteStream(logFile);
let logLines = 0;
let summaryDirty = false;

const buckets = new Map();
let lastLine = '';
let total = 0;
let badToken = 0;

// Which situation is this payload from?
function situation(p) {
  const me = p.provider?.steamid;
  const pl = p.player || {};
  if (!p.map || pl.activity === 'menu') return 'menu / loading';
  const watchingOther = pl.steamid && me && pl.steamid !== me;
  if (watchingOther) return p.allplayers ? 'watching another player (full observer)' : 'dead, watching a teammate';
  if ((pl.state?.health ?? 0) > 0) return 'alive, playing';
  return 'dead, own camera';
}

function bucket(name) {
  if (!buckets.has(name)) buckets.set(name, { n: 0, playerPos: 0, playerFwd: 0, allplayers: 0, allplayersPos: 0, teamsSeen: new Set(), watched: new Set(), samplePos: null });
  return buckets.get(name);
}

function record(p) {
  const name = situation(p);
  const b = bucket(name);
  const pl = p.player || {};
  b.n++;
  if (typeof pl.position === 'string') { b.playerPos++; b.samplePos = pl.position; }
  if (typeof pl.forward === 'string') b.playerFwd++;
  if (p.allplayers) {
    b.allplayers++;
    const players = Object.values(p.allplayers);
    if (players.some(x => typeof x.position === 'string')) b.allplayersPos++;
    players.forEach(x => x.team && b.teamsSeen.add(x.team));
  }
  if (pl.steamid && pl.steamid !== p.provider?.steamid) b.watched.add(`${pl.name || '?'} (${pl.team || '?'})`);
  const line = `[${name}] hp=${pl.state?.health ?? '-'} team=${pl.team ?? '-'} player.position=${pl.position ? 'YES ' + pl.position : 'no'} allplayers=${p.allplayers ? Object.keys(p.allplayers).length : 'no'}`;
  if (line !== lastLine) { console.log(line); lastLine = line; }
}

function summary() {
  const out = [];
  const console = { log: (line = '') => out.push(line) };
  console.log('\n================ csbot GSI probe: results ================');
  console.log(`payloads: ${total}${badToken ? ` (ignored ${badToken} with a wrong token)` : ''} · log: ${logFile}\n`);
  for (const [name, b] of buckets) {
    console.log(`${name}`);
    console.log(`  payloads ............ ${b.n}`);
    console.log(`  player.position ..... ${b.playerPos}/${b.n}${b.samplePos ? `  (e.g. ${b.samplePos})` : ''}`);
    console.log(`  player.forward ...... ${b.playerFwd}/${b.n}`);
    console.log(`  allplayers .......... ${b.allplayers}/${b.n}${b.allplayers ? `  teams: ${[...b.teamsSeen].join(', ')} · with positions: ${b.allplayersPos}` : ''}`);
    if (b.watched.size) console.log(`  watched ............. ${[...b.watched].join(', ')}`);
    console.log('');
  }
  const alive = buckets.get('alive, playing');
  const deadMate = buckets.get('dead, watching a teammate');
  console.log('Verdict');
  console.log(`  1. Own position while alive:        ${!alive ? 'not tested' : alive.playerPos ? 'YES → room members can share their live position' : 'NO → use check-ins and spotters'}`);
  console.log(`  2. Teammate position while dead:    ${!deadMate ? 'not tested' : deadMate.playerPos ? 'YES → dead room members become live spotters' : 'NO'}`);
  console.log(`  3. allplayers while playing/dead:   ${[alive, deadMate].some(b => b && b.allplayers) ? 'PRESENT → the spectator guard must drop it' : 'absent (good)'}`);
  console.log('\nPaste this block back to the team.');
  return out.join('\n');
}

http.createServer((req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(req.url === '/summary' ? summary() : 'csbot gsi probe · open /summary for the results');
    return;
  }
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    res.writeHead(200); res.end();
    try {
      const p = JSON.parse(body);
      if (p.auth?.token !== TOKEN) { badToken++; return; }
      total++;
      if (logLines < MAX_LOG_LINES) { log.write(JSON.stringify({ t: Date.now(), p }) + '\n'); logLines++; }
      record(p);
      summaryDirty = true;
    } catch { /* ignore malformed payloads */ }
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log(`csbot GSI probe listening on http://127.0.0.1:${PORT} (token "${TOKEN}")`);
  console.log('Start CS2 and follow the steps in README.md. Press Ctrl+C (or open /summary) for the results.\n');
});

const writeSummary = () => { fs.writeFileSync(summaryFile, `updated ${new Date().toISOString()}\n${summary()}\n`); summaryDirty = false; };
setInterval(() => { if (summaryDirty) writeSummary(); }, 20000).unref();

process.on('SIGINT', () => { writeSummary(); console.log(summary()); log.end(() => process.exit(0)); });
