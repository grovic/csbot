// Local control API (M7), for the Stream Deck plugin. Off by default (Settings → Stream Deck).
// Listens on 127.0.0.1 only, wants the key from control.json (in csbot's data folder, where the plugin
// reads it), and refuses browsers (any Origin header) and other host names (DNS rebinding).
//
//   GET  /v1/state     the call, the buy read, the map's three lanes
//   POST /v1/command   {kind:"intel",lane:"a"|"mid"|"b",count:0-5} · {kind:"checkin",state:"spot"|"rotate",site?}
//                      · {kind:"talk"} (push-to-talk)
//
// Fair play: this only takes commands for csbot itself; nothing reaches the game.

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

export type Lane = 'a' | 'mid' | 'b';
export type ControlCommand =
  | { kind: 'intel'; lane: Lane; count: number }
  | { kind: 'checkin'; state: 'spot' | 'rotate'; site?: 'A' | 'B' }
  | { kind: 'talk' };

export interface ControlOptions {
  /** csbot's data folder: control.json goes here while the API runs. */
  dir: string;
  token: string;
  port?: number;
  state(): unknown;
  command(c: ControlCommand): Promise<{ ok: boolean; error?: string }> | { ok: boolean; error?: string };
}

export interface ControlServer { url: string; close(): Promise<void> }

export const CONTROL_FILE = 'control.json';

/** A command from JSON, or undefined when it isn't one. */
export function parseCommand(raw: unknown): ControlCommand | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  if (o.kind === 'intel' && (o.lane === 'a' || o.lane === 'mid' || o.lane === 'b') && typeof o.count === 'number' && Number.isInteger(o.count) && o.count >= 0 && o.count <= 5) {
    return { kind: 'intel', lane: o.lane, count: o.count };
  }
  if (o.kind === 'checkin' && o.state === 'spot') return { kind: 'checkin', state: 'spot' };
  if (o.kind === 'checkin' && o.state === 'rotate' && (o.site === 'A' || o.site === 'B')) return { kind: 'checkin', state: 'rotate', site: o.site };
  if (o.kind === 'talk') return { kind: 'talk' };
  return undefined;
}

const same = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function startControl(o: ControlOptions): Promise<ControlServer> {
  return new Promise((resolve, reject) => {
    let port = 0;
    const json = (res: http.ServerResponse, code: number, body: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    const server = http.createServer((req, res) => {
      if (req.headers.origin !== undefined) return json(res, 403, { ok: false, error: 'Browsers are not allowed.' });
      const host = req.headers.host ?? '';
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return json(res, 403, { ok: false, error: 'Wrong host.' });
      const auth = req.headers.authorization ?? '';
      if (!same(auth, `Bearer ${o.token}`)) return json(res, 401, { ok: false, error: 'Wrong key.' });
      const url = (req.url ?? '').split('?')[0];
      if (req.method === 'GET' && url === '/v1/state') return json(res, 200, o.state() ?? {});
      if (req.method === 'POST' && url === '/v1/command') {
        let body = '';
        req.setEncoding('utf8');
        req.on('data', (d: string) => { body += d; if (body.length > 4096) req.destroy(); });
        req.on('end', () => {
          let cmd: ControlCommand | undefined;
          try { cmd = parseCommand(JSON.parse(body)); } catch { cmd = undefined; }
          if (!cmd) return json(res, 400, { ok: false, error: 'Unknown command.' });
          Promise.resolve(o.command(cmd)).then(r => json(res, r.ok ? 200 : 409, r), e => json(res, 500, { ok: false, error: String((e as Error)?.message ?? e) }));
        });
        return;
      }
      json(res, 404, { ok: false, error: 'Not found.' });
    });
    server.on('error', reject);
    server.listen(o.port ?? 0, '127.0.0.1', () => {
      port = (server.address() as { port: number }).port;
      const url = `http://127.0.0.1:${port}`;
      const file = path.join(o.dir, CONTROL_FILE);
      try {
        fs.mkdirSync(o.dir, { recursive: true });
        fs.writeFileSync(file, JSON.stringify({ url, token: o.token, pid: process.pid }, null, 2) + '\n');
      } catch (e) { server.close(); reject(e); return; }
      resolve({
        url,
        close: () => new Promise<void>(r => {
          try { fs.rmSync(file, { force: true }); } catch { /* best effort */ }
          server.close(() => r());
          server.closeAllConnections?.();
        }),
      });
    });
  });
}
