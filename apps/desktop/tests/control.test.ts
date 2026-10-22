import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CONTROL_FILE, parseCommand, startControl, type ControlCommand, type ControlServer } from '../src/control.ts';

let server: ControlServer | undefined;
const dirs: string[] = [];
afterEach(async () => { await server?.close(); server = undefined; for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

/** A raw request (fetch can't set Host or Origin freely). */
function req(url: string, o: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const r = http.request(url, { method: o.method ?? 'GET', headers: o.headers ?? {} }, res => {
      let b = '';
      res.on('data', d => { b += d; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: b ? JSON.parse(b) : undefined }));
    });
    r.on('error', reject);
    r.end(o.body);
  });
}

describe('local control API (Stream Deck)', () => {
  it('writes control.json, wants the key, refuses browsers and other host names, and removes the file when off', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csbot-control-'));
    dirs.push(dir);
    const got: ControlCommand[] = [];
    server = await startControl({ dir, token: 'k3y', state: () => ({ map: 'de_mirage', call: { head: 'Stack B' } }), command: c => { got.push(c); return { ok: true }; } });
    const ctl = JSON.parse(fs.readFileSync(path.join(dir, CONTROL_FILE), 'utf8'));
    expect(ctl).toMatchObject({ url: server.url, token: 'k3y' });
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const auth = { authorization: 'Bearer k3y' };

    expect((await req(server.url + '/v1/state')).status).toBe(401);
    expect((await req(server.url + '/v1/state', { headers: { authorization: 'Bearer nope' } })).status).toBe(401);
    expect((await req(server.url + '/v1/state', { headers: { ...auth, origin: 'https://evil.example' } })).status).toBe(403);
    expect((await req(server.url + '/v1/state', { headers: { ...auth, host: 'evil.example' } })).status).toBe(403);
    expect(await req(server.url + '/v1/state', { headers: auth })).toEqual({ status: 200, body: { map: 'de_mirage', call: { head: 'Stack B' } } });

    const post = (body: unknown) => req(server!.url + '/v1/command', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect((await post({ kind: 'intel', lane: 'b', count: 3 })).status).toBe(200);
    expect((await post({ kind: 'intel', lane: 'b', count: 9 })).status).toBe(400);
    expect((await post({ kind: 'rm -rf' })).status).toBe(400);
    expect(got).toEqual([{ kind: 'intel', lane: 'b', count: 3 }]);
    expect((await req(server.url + '/nope', { headers: auth })).status).toBe(404);

    await server.close();
    server = undefined;
    expect(fs.existsSync(path.join(dir, CONTROL_FILE))).toBe(false);
  });

  it('a refused command answers 409 with the reason', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csbot-control-'));
    dirs.push(dir);
    server = await startControl({ dir, token: 't', state: () => ({}), command: () => ({ ok: false, error: 'Push-to-talk is off in csbot Settings.' }) });
    const r = await req(server.url + '/v1/command', { method: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify({ kind: 'talk' }) });
    expect(r).toEqual({ status: 409, body: { ok: false, error: 'Push-to-talk is off in csbot Settings.' } });
  });

  it('parses only known commands', () => {
    expect(parseCommand({ kind: 'checkin', state: 'rotate', site: 'A' })).toEqual({ kind: 'checkin', state: 'rotate', site: 'A' });
    expect(parseCommand({ kind: 'checkin', state: 'rotate' })).toBeUndefined();
    expect(parseCommand({ kind: 'intel', lane: 'mid', count: 0 })).toEqual({ kind: 'intel', lane: 'mid', count: 0 });
    expect(parseCommand({ kind: 'intel', zone: 'bapps', count: 1 })).toBeUndefined();
    expect(parseCommand(null)).toBeUndefined();
  });
});
