// Optional self-hosted signaling for csbot rooms (Trystero's WebSocket relay, MIT).
// Rooms don't need it: by default peers find each other through public Nostr relays. Use it for
// local tests, or if a squad wants its own signaling: run it anywhere reachable and open invite links
// with &signal=wss://your-host:port. It only ever sees encrypted handshakes, never room data.
//   node tools/room-relay/src/relay.ts [--port 8787] [--host 127.0.0.1]

import { pathToFileURL } from 'node:url';
import { createWsRelayServer, type WsRelayServer } from '@trystero-p2p/ws-relay/server';

export interface RoomRelay { url: string; port: number; close: () => Promise<void>; server: WsRelayServer }

export async function startRoomRelay(o: { port?: number; host?: string } = {}): Promise<RoomRelay> {
  const host = o.host ?? '127.0.0.1';
  const server = createWsRelayServer({ port: o.port ?? 0, host, maxSubscriptionsPerSocket: 64 });
  await server.ready;
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : (o.port ?? 0);
  return { url: `ws://${host}:${port}`, port, close: () => server.close(), server };
}

const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
  const relay = await startRoomRelay({ port: Number(arg('port') ?? 8787), host: arg('host') ?? '127.0.0.1' });
  console.log(`csbot room relay on ${relay.url} (Ctrl+C to stop)`);
  process.on('SIGINT', () => { void relay.close().then(() => process.exit(0)); });
}
