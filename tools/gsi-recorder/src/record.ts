// Standalone GSI recorder: listens on localhost and writes every payload to NDJSON (token redacted).
// Runs with plain Node 24: node tools/gsi-recorder/src/record.ts --help
// The desktop app records on its own; this is for capturing raw feeds without the app.

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { gsiConfig, toLine, type GsiPayload } from '@csbot/gsi';
import { startGsiServer } from '@csbot/gsi/server';

const HELP = `csbot GSI recorder

  node tools/gsi-recorder/src/record.ts --token TOKEN [--port 47401] [--out file.ndjson] [--duration SECONDS]

Listens on http://127.0.0.1:PORT and appends {"t", "p"} lines (auth token redacted).
Point a CS2 GSI cfg at it (the cfg text is printed on start). Ctrl+C prints a summary.
`;

const { values: v } = parseArgs({
  options: {
    port: { type: 'string', default: '47401' },
    token: { type: 'string' },
    out: { type: 'string' },
    duration: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});
if (v.help) { console.log(HELP); process.exit(0); }
if (!v.token || !/^[A-Za-z0-9_-]{8,128}$/.test(v.token)) { console.error('record: --token is required (8-128 chars of A-Z a-z 0-9 _ -)\n\n' + HELP); process.exit(2); }
const port = Number(v.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) { console.error('record: bad --port'); process.exit(2); }
if (port === 47399) { console.error('record: 47399 belongs to the GSI probe; pick another port'); process.exit(2); }

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = path.resolve(v.out ?? `gsi-${stamp}.ndjson`);
fs.mkdirSync(path.dirname(out), { recursive: true });
const stream = fs.createWriteStream(out, { flags: 'a' });

const started = Date.now();
let count = 0, bytes = 0;
const maps = new Set<string>(), rounds = new Set<number>(), phases = new Map<string, number>();
const rejected = { token: 0, json: 0, size: 0 };

const server = await startGsiServer({
  port,
  token: v.token,
  onPayload: (p: GsiPayload, at) => {
    const line = toLine(p.auth ? { ...p, auth: { token: 'redacted' } } : p, at);
    stream.write(line);
    count++; bytes += Buffer.byteLength(line);
    if (p.map?.name) maps.add(p.map.name);
    if (p.map?.round !== undefined) rounds.add(p.map.round + 1);
    const ph = p.round?.phase ?? p.map?.phase ?? 'none';
    phases.set(ph, (phases.get(ph) ?? 0) + 1);
  },
  onRejected: r => { rejected[r]++; },
});

const uri = `http://127.0.0.1:${server.port}`;
console.log(`recording ${uri} → ${out}\n\ncfg for CS2 (gamestate_integration_<name>.cfg):\n`);
console.log(gsiConfig({ uri, token: v.token }));

const shutdown = async () => {
  await server.close();
  await new Promise<void>(r => stream.end(r));
  const secs = (Date.now() - started) / 1000;
  console.log(`\nrecorded ${count} payloads (${(bytes / 1024).toFixed(1)} KB) in ${secs.toFixed(0)} s → ${out}`);
  console.log(`maps: ${[...maps].join(', ') || '-'} · rounds seen: ${rounds.size ? Math.min(...rounds) + '–' + Math.max(...rounds) : '-'}`);
  console.log(`phases: ${[...phases].map(([k, n]) => `${k} ${n}`).join(', ') || '-'}`);
  if (rejected.token || rejected.json || rejected.size) console.log(`rejected: token ${rejected.token}, json ${rejected.json}, size ${rejected.size}`);
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
if (v.duration) setTimeout(() => void shutdown(), Number(v.duration) * 1000);
process.on('SIGTERM', () => void shutdown());
