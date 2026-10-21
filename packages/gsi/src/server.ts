import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { GsiPayload } from './types.ts';

export interface GsiServerOptions {
  port: number;
  token: string;
  /** Localhost only by default. */
  host?: string;
  maxBytes?: number;
  onPayload: (p: GsiPayload, receivedAt: number) => void;
  onRejected?: (reason: 'token' | 'json' | 'size') => void;
}

export interface GsiServer { port: number; close: () => Promise<void> }

/** HTTP endpoint CS2 posts GSI payloads to. Always answers 200 so the game never retries forever. */
export function startGsiServer(opts: GsiServerOptions): Promise<GsiServer> {
  const max = opts.maxBytes ?? 1_000_000;
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('csbot gsi'); return; }
    let size = 0;
    const chunks: Buffer[] = [];
    let tooBig = false;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > max) { tooBig = true; req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      res.writeHead(200); res.end();
      if (tooBig) { opts.onRejected?.('size'); return; }
      let p: GsiPayload;
      try { p = JSON.parse(Buffer.concat(chunks).toString('utf8')) as GsiPayload; } catch { opts.onRejected?.('json'); return; }
      if (p.auth?.token !== opts.token) { opts.onRejected?.('token'); return; }
      opts.onPayload(p, Date.now());
    });
    req.on('error', () => { if (tooBig) opts.onRejected?.('size'); });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, opts.host ?? '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ port, close: () => new Promise<void>(r => server.close(() => r())) });
    });
  });
}
