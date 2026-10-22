// The plugin end to end without a Stream Deck: a fake Stream Deck app (WebSocket server) starts the
// built plugin the way the real one does, and a fake csbot answers its control API.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { ACTIONS, CsbotPlugin, commandFor, titleFor, wrap, type Command } from '../src/core.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const plugin = path.join(here, '..', 'com.grovic.csbot.sdPlugin', 'bin', 'plugin.js');
const pack = path.join(here, '..', 'dist', 'com.grovic.csbot.streamDeckPlugin');

describe('key titles and commands', () => {
  it('wraps to short lines', () => {
    expect(wrap('Anti-eco · stack B', 9, 2)).toBe('Anti-eco\nstack B');
    expect(wrap('Supercalifragilistic word', 9, 2)).toBe('Supercali\nword');
  });

  it('names the lane from csbot, and says when csbot is off', () => {
    const state = { mapName: 'Mirage', lanes: { b: 'B Apps' }, call: { head: 'Anti-eco · stack B' }, enemy: { read: 'eco' } };
    expect(titleFor(ACTIONS.intel, { lane: 'b', count: 3 }, state)).toBe('3\nB Apps');
    expect(titleFor(ACTIONS.intel, { lane: 'mid', count: 0 }, undefined)).toBe('CLEAR\nMid');
    expect(titleFor(ACTIONS.call, {}, state)).toBe('ECO\nAnti-eco\nstack B');
    expect(titleFor(ACTIONS.call, {}, undefined)).toBe('csbot\noff');
    expect(titleFor(ACTIONS.checkin, { checkin: 'B' }, state)).toBe('Rotate\nB');
    expect(commandFor(ACTIONS.checkin, {})).toEqual({ kind: 'checkin', state: 'spot' });
    expect(commandFor(ACTIONS.intel, { lane: 'a', count: 7 })).toEqual({ kind: 'intel', lane: 'a', count: 5 });
  });

  it('a refused command shows the alert, and titles are only sent when they change', async () => {
    const sent: any[] = [];
    const p = new CsbotPlugin(m => sent.push(m), { state: async () => ({ lanes: { a: 'A Ramp' } }), command: async () => ({ ok: false, error: 'off' }) });
    await p.handle({ event: 'willAppear', action: ACTIONS.intel, context: 'k1', payload: { settings: { lane: 'a', count: 2 } } });
    await p.poll();
    await p.poll();
    await p.handle({ event: 'keyDown', action: ACTIONS.intel, context: 'k1' });
    expect(sent.filter(m => m.event === 'setTitle').map(m => m.payload.title)).toEqual(['2\nA side', '2\nA Ramp']);
    expect(sent.at(-1)).toEqual({ event: 'showAlert', context: 'k1' });
  });
});

describe('the built plugin, started like the Stream Deck app does', () => {
  let child: ChildProcess | undefined;
  const closers: (() => void)[] = [];
  afterEach(() => { child?.kill(); child = undefined; for (const c of closers.splice(0)) c(); });

  it('registers, shows the call, and sends intel to csbot with its key', { timeout: 20_000 }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csbot-sd-'));
    closers.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    // A fake csbot.
    const commands: Command[] = [];
    const auths: string[] = [];
    const csbot = http.createServer((req, res) => {
      auths.push(req.headers.authorization ?? '');
      if (req.url === '/v1/state') { res.end(JSON.stringify({ mapName: 'Mirage', lanes: { a: 'A Ramp', mid: 'Top Mid', b: 'B Apps' }, call: { head: 'Stack B' }, enemy: { read: 'full' } })); return; }
      let b = '';
      req.on('data', d => { b += d; });
      req.on('end', () => { commands.push(JSON.parse(b)); res.end('{"ok":true}'); });
    });
    await new Promise<void>(r => csbot.listen(0, '127.0.0.1', () => r()));
    closers.push(() => csbot.close());
    const control = path.join(dir, 'control.json');
    fs.writeFileSync(control, JSON.stringify({ url: `http://127.0.0.1:${(csbot.address() as { port: number }).port}`, token: 'sd-key' }));

    // A fake Stream Deck app.
    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    closers.push(() => wss.close());
    await new Promise<void>(r => wss.on('listening', () => r()));
    const got: any[] = [];
    const conn = new Promise<WebSocket>(r => wss.on('connection', ws => { ws.on('message', d => got.push(JSON.parse(d.toString()))); r(ws); }));
    child = spawn(process.execPath, [plugin, '-port', String((wss.address() as { port: number }).port), '-pluginUUID', 'plugin-uuid', '-registerEvent', 'registerPlugin', '-info', '{}'],
      { env: { ...process.env, CSBOT_CONTROL_FILE: control }, stdio: 'ignore' });
    const ws = await conn;
    const until = async (f: () => boolean) => { const end = Date.now() + 8000; while (!f()) { if (Date.now() > end) throw new Error('timed out: ' + JSON.stringify(got)); await new Promise(r => setTimeout(r, 50)); } };

    await until(() => got.some(m => m.event === 'registerPlugin'));
    expect(got[0]).toEqual({ event: 'registerPlugin', uuid: 'plugin-uuid' });
    ws.send(JSON.stringify({ event: 'willAppear', action: ACTIONS.call, context: 'call-key', payload: { settings: {} } }));
    ws.send(JSON.stringify({ event: 'willAppear', action: ACTIONS.intel, context: 'intel-key', payload: { settings: { lane: 'b', count: 3 } } }));
    await until(() => got.some(m => m.event === 'setTitle' && m.context === 'call-key' && m.payload.title === 'FULL\nStack B'));
    await until(() => got.some(m => m.event === 'setTitle' && m.context === 'intel-key' && m.payload.title === '3\nB Apps'));
    ws.send(JSON.stringify({ event: 'keyDown', action: ACTIONS.intel, context: 'intel-key', payload: { settings: { lane: 'b', count: 3 } } }));
    await until(() => got.some(m => m.event === 'showOk' && m.context === 'intel-key'));
    expect(commands).toEqual([{ kind: 'intel', lane: 'b', count: 3 }]);
    expect(new Set(auths)).toEqual(new Set(['Bearer sd-key']));
  });

  it('the .streamDeckPlugin package holds the plugin folder', () => {
    expect(fs.existsSync(pack)).toBe(true);
    const tar = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
    if (process.platform !== 'win32' || !fs.existsSync(tar)) return;
    const list = execFileSync(tar, ['-tf', pack], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
    for (const f of ['manifest.json', 'bin/plugin.js', 'ui/intel.html', 'imgs/plugin.png', 'imgs/intel-key@2x.png']) expect(list).toContain(`com.grovic.csbot.sdPlugin/${f}`);
    const manifest = JSON.parse(execFileSync(tar, ['-xOf', pack, 'com.grovic.csbot.sdPlugin/manifest.json'], { encoding: 'utf8' }));
    for (const a of manifest.Actions) expect(Object.values(ACTIONS)).toContain(a.UUID);
  });
});
