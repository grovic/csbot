import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FIRST_HALF, readRecording, syntheticMatch, type GsiPayload } from '@csbot/gsi';
import type { LiveSnapshot } from '@csbot/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Host } from '../src/host.ts';
import { loadSettings, randomToken, readEnv } from '../src/settings.ts';

const TOKEN = 'test_token_123456';
let tmp: string;
let host: Host;

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'csbot-host-'));
  host = new Host({ userData: tmp, port: 0, token: TOKEN, version: '0.0.0-test', playbookHandle: 'rdx', throttleMs: 0, tickMs: 60_000, detectCs2: () => undefined });
  await host.start();
});
afterEach(async () => {
  await host.stop();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const post = (p: GsiPayload, token = TOKEN) =>
  fetch(host.gsiUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...p, auth: { token } }) });

async function feed(payloads: GsiPayload[]) {
  for (const p of payloads) {
    const r = await post(p);
    expect(r.status).toBe(200);
  }
}

describe('host pipeline over HTTP', () => {
  it('hands every guarded payload to onGsi listeners (what a desktop member forwards)', async () => {
    const got: GsiPayload[] = [];
    host.onGsi(p => got.push(p));
    const [first] = syntheticMatch({ rounds: FIRST_HALF.slice(0, 1), lean: true }).map(r => r.p);
    await feed([{ ...first!, allplayers: { x: {} }, bomb: { state: 'carried' } } as GsiPayload]);
    expect(got).toHaveLength(1);
    expect(got[0]!.allplayers).toBeUndefined();
    expect(got[0]!.bomb).toBeUndefined();
    expect(got[0]!.auth).toEqual({ token: 'redacted' });
    expect(got[0]!.player?.name).toBe('rdx');
  });


  it('writes runtime.json for tools and tests', () => {
    const rt = JSON.parse(fs.readFileSync(path.join(tmp, 'runtime.json'), 'utf8'));
    expect(rt.gsiUrl).toBe(host.gsiUrl);
    expect(rt.token).toBe(TOKEN);
    expect(rt.pid).toBe(process.pid);
  });

  it('turns a synthetic segment into snapshots', async () => {
    const got: LiveSnapshot[] = [];
    host.onSnapshot(s => got.push(s));
    const rec = syntheticMatch({ rounds: FIRST_HALF.slice(0, 3), lean: true });
    await feed(rec.map(r => r.p));
    const s = host.emit();
    expect(got.length).toBeGreaterThan(rec.length / 2);
    expect(s.connection.gsi).toBe('live');
    expect(s.connection.payloads).toBe(rec.length);
    expect(s.match!.map).toBe('de_mirage');
    expect(s.match!.round).toBe(3);
    expect(s.match!.clock.phase).toBe('gameover');
    expect(s.match!.score).toEqual({ us: 2, them: 1 });
    expect(s.match!.history.map(h => h.winner)).toEqual(['us', 'us', 'them']);
    expect(s.me!.name).toBe('rdx');
    expect(s.youHandle).toBe('rdx');
    // Snapshots are seq-ordered.
    expect(got.every((x, i) => i === 0 || x.seq > got[i - 1]!.seq)).toBe(true);
  });

  it('records guarded payloads with the token redacted', async () => {
    const rec = syntheticMatch({ rounds: FIRST_HALF.slice(0, 1) });
    await feed(rec.map(r => r.p));
    await host.stop();
    const file = host.recordingFile!;
    expect(path.dirname(file)).toBe(host.recordingsDir);
    expect(path.basename(file)).toMatch(/^\d{4}-\d{2}-\d{2}_\d{6}\.ndjson$/);
    const lines = readRecording(fs.readFileSync(file, 'utf8'));
    expect(lines).toHaveLength(rec.length);
    expect(fs.readFileSync(file, 'utf8')).not.toContain(TOKEN);
    expect(lines.every(l => l.p.auth?.token === 'redacted')).toBe(true);
  });

  it('drops spectator-only data before it reaches the tracker or the recording', async () => {
    const [first] = syntheticMatch({ rounds: FIRST_HALF.slice(0, 1) });
    await post({ ...first!.p, allplayers: { x: { name: 'enemy' } }, bomb: { state: 'carried', position: '1, 2, 3' }, allgrenades: {} });
    const s = host.emit();
    expect(s.connection.guardDropped).toBe(3);
    await host.stop();
    const text = fs.readFileSync(host.recordingFile!, 'utf8');
    expect(text).not.toContain('allplayers');
    expect(text).not.toContain('allgrenades');
    expect(text).not.toContain('"bomb":{');
  });

  it('keeps an enemy position out but a teammate position in', async () => {
    const [first] = syntheticMatch({ rounds: FIRST_HALF.slice(0, 1) });
    const p = first!.p;
    await post(p); // establishes that we are CT
    // A watched T player's position must go, a watched CT teammate's may stay.
    await post({ ...p, player: { ...p.player!, steamid: '76561198000000099', team: 'T', position: '1, 2, 3' } });
    expect(host.emit().connection.guardDropped).toBe(1);
    await post({ ...p, player: { ...p.player!, steamid: '76561198000000002', team: 'CT', position: '1, 2, 3' } });
    expect(host.emit().connection.guardDropped).toBe(1);
  });

  it('rejects a bad token and bad JSON without crashing', async () => {
    const [first] = syntheticMatch({ rounds: FIRST_HALF.slice(0, 1) });
    expect((await post(first!.p, 'wrong_token_000')).status).toBe(200);
    expect((await fetch(host.gsiUrl, { method: 'POST', body: '{nope' })).status).toBe(200);
    await new Promise(r => setTimeout(r, 20));
    expect(host.rejectedCounts).toEqual({ token: 1, json: 1, size: 0 });
    expect(host.emit().connection.payloads).toBe(0);
    expect(host.emit().connection.gsi).toBe('waiting');
  });

  it('reports host info', () => {
    const info = host.info();
    expect(info.gsiUrl).toBe(host.gsiUrl);
    expect(info.cfgStatus).toBe('missing');
    expect(info.portFallback).toBeUndefined();
    expect(info.cs2Path).toBeUndefined();
    expect(info.recordingsDir).toBe(path.join(tmp, 'recordings'));
  });

  it('throttles snapshot bursts', async () => {
    await host.stop();
    host = new Host({ userData: tmp, port: 0, token: TOKEN, version: 't', throttleMs: 200, tickMs: 60_000, record: false });
    await host.start();
    const got: LiveSnapshot[] = [];
    host.onSnapshot(s => got.push(s));
    const burst = syntheticMatch({ rounds: FIRST_HALF.slice(0, 2) }).slice(0, 30);
    const t0 = Date.now();
    await feed(burst.map(r => r.p));
    await new Promise(r => setTimeout(r, 250));
    const elapsed = Date.now() - t0;
    expect(got.length).toBeLessThanOrEqual(Math.ceil(elapsed / 200) + 1);
    // The trailing snapshot still carries the last payload of the burst.
    expect(got[got.length - 1]!.connection.payloads).toBe(burst.length);
  });
});

describe('settings', () => {
  it('creates settings on first run and keeps them after', () => {
    const dir = path.join(tmp, 'ud');
    const a = loadSettings(dir);
    expect(a.gsiPort).toBe(47400);
    expect(a.gsiToken).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(loadSettings(dir)).toEqual(a);
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ gsiPort: 'x', gsiToken: 'bad token', playbookHandle: 'rdx' }));
    const b = loadSettings(dir);
    expect(b.gsiPort).toBe(47400);
    expect(b.gsiToken).not.toBe('bad token');
    expect(b.playbookHandle).toBe('rdx');
  });

  it('reads env overrides', () => {
    expect(readEnv({ CSBOT_GSI_PORT: '0', CSBOT_HIDDEN: '1' })).toMatchObject({ gsiPort: 0, hidden: true });
    expect(readEnv({ CSBOT_GSI_PORT: 'abc' }).gsiPort).toBeUndefined();
    expect(readEnv({}).hidden).toBe(false);
    expect(new Set(Array.from({ length: 20 }, () => randomToken())).size).toBe(20);
  });
});
