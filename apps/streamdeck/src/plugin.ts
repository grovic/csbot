// Entry point, run by the Stream Deck app: `plugin.js -port N -pluginUUID U -registerEvent E -info {...}`.
// Registers over the Stream Deck WebSocket, hands events to CsbotPlugin, and refreshes key titles
// every second while csbot is reachable.

import WebSocket from 'ws';
import { CsbotPlugin, type SdEvent } from './core.ts';
import { csbotClient } from './csbot.ts';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`-${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const port = Number(arg('port'));
const uuid = arg('pluginUUID');
const registerEvent = arg('registerEvent');
if (!port || !uuid || !registerEvent) {
  console.error('csbot Stream Deck plugin: started without the Stream Deck arguments');
  process.exit(1);
}

const ws = new WebSocket(`ws://127.0.0.1:${port}`);
const send = (m: object) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };
const plugin = new CsbotPlugin(send, csbotClient());

ws.on('open', () => {
  ws.send(JSON.stringify({ event: registerEvent, uuid }));
  void plugin.poll();
});
ws.on('message', data => {
  let e: SdEvent;
  try { e = JSON.parse(data.toString()) as SdEvent; } catch { return; }
  void plugin.handle(e);
});
ws.on('close', () => process.exit(0));

const timer = setInterval(() => { void plugin.poll(); }, 1000);
timer.unref?.();
// Keep running while the socket is open.
setInterval(() => {}, 1 << 30);
