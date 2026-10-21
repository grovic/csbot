// Spike 7: peer-to-peer rooms with no server and no accounts.
// One host page + N member pages in headless Edge (separate browser contexts, like separate devices),
// signaling over public Nostr relays via Trystero, data over WebRTC. Plus one intruder with the wrong key.
// Usage: node run.mjs [members=5]   Writes results.json.
// Limit: all peers run on this PC, so this measures signaling and the protocol, not NAT traversal.

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const N = Number(process.argv[2] ?? 5);
const dist = path.join(here, 'dist');
fs.mkdirSync(dist, { recursive: true });
await build({ entryPoints: [path.join(here, 'src/peer.ts')], bundle: true, format: 'esm', target: 'es2022', outfile: path.join(dist, 'peer.js'), logLevel: 'warning' });
fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><meta charset="utf-8"><title>p2p spike</title><script type="module" src="./peer.js"></script>');

const server = http.createServer((req, res) => {
  const f = path.join(dist, new URL(req.url, 'http://x').pathname.replace(/^\/$/, '/index.html'));
  if (!f.startsWith(dist) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'text/html' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/index.html`;

const room = 'spike-' + crypto.randomBytes(6).toString('hex');
const key = crypto.randomBytes(18).toString('base64url');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const open = async (role, name, k = key) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log(`[${name}] pageerror ${e.message}`));
  await page.goto(`${base}?role=${role}&room=${room}&key=${encodeURIComponent(k)}&name=${name}`);
  return { name, page };
};
const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]); };

console.log(`room ${room} · ${N} members + 1 intruder · signaling: public Nostr relays (Trystero defaults)`);
const t0 = Date.now();
const host = await open('host', 'host');
const members = [];
for (let i = 1; i <= N; i++) members.push(await open('member', `m${i}`));
const intruder = await open('member', 'intruder', 'wrong-' + key);

const deadline = Date.now() + 90_000;
let rs = [];
while (Date.now() < deadline) {
  rs = await Promise.all(members.map(m => m.page.evaluate(() => window.__result)));
  if (rs.every(r => r.done)) break;
  await new Promise(r => setTimeout(r, 1000));
}
await new Promise(r => setTimeout(r, 2000)); // let snapshot latency samples accumulate
rs = await Promise.all(members.map(m => m.page.evaluate(() => window.__result)));
const hostR = await host.page.evaluate(() => window.__result);
const intr = await intruder.page.evaluate(() => window.__result);

// Reconnect: reload one member and time how long until it hears the host again.
const m1 = members[0];
const tr = Date.now();
await m1.page.reload();
let reconnectMs = null;
while (Date.now() - tr < 60_000) {
  const r = await m1.page.evaluate(() => window.__result);
  if (r.firstSnapMs !== undefined) { reconnectMs = r.firstSnapMs; break; }
  await new Promise(r => setTimeout(r, 250));
}

const rows = rs.map(r => ({
  name: r.name,
  connected: r.hostJoinMs !== undefined,
  hostJoinMs: r.hostJoinMs ?? null,
  firstSnapMs: r.firstSnapMs ?? null,
  rttP50: pct(r.rtt ?? [], 0.5), rttP95: pct(r.rtt ?? [], 0.95),
  snapLatP50: pct(r.latency ?? [], 0.5), snapLatP95: pct(r.latency ?? [], 0.95),
  joinErrors: r.joinErrors,
}));
const out = {
  at: new Date().toISOString(), members: N, wallMs: Date.now() - t0,
  rows,
  hostSawMembers: Object.keys(hostR.joined ?? {}).length,
  intruder: { connected: intr.hostJoinMs !== undefined, joinErrors: intr.joinErrors },
  reconnectAfterReloadMs: reconnectMs,
  hostLog: hostR.log?.slice(0, 40),
};
fs.writeFileSync(path.join(here, 'results.json'), JSON.stringify(out, null, 2));
for (const r of rows) console.log(`${r.name.padEnd(4)} ${r.connected ? 'connected' : 'NOT CONNECTED'} · host seen ${String(r.hostJoinMs).padStart(5)} ms · first snapshot ${String(r.firstSnapMs).padStart(5)} ms · ping p50/p95 ${r.rttP50}/${r.rttP95} ms · snapshot latency p50/p95 ${r.snapLatP50}/${r.snapLatP95} ms`);
console.log(`host saw ${out.hostSawMembers}/${N} members · intruder connected: ${out.intruder.connected} (errors: ${out.intruder.joinErrors.length}) · reconnect after reload: ${reconnectMs} ms`);
await browser.close();
server.close();
