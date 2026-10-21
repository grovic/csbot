// WebRTC transport through Trystero (MIT). Browser and Electron renderer only (needs RTCPeerConnection).
// Signaling defaults to public Nostr relays: no account, no server of ours. The room key is Trystero's
// password, so session descriptions are encrypted and a peer without the key can't connect at all.

import { joinRoom as joinNostr, selfId, type Room } from 'trystero';
import { joinRoom as joinWsRelay } from '@trystero-p2p/ws-relay';
import { MAX_MESSAGE_BYTES, ROOM_PROTOCOL } from '@csbot/protocol';
import { Emitter, type Transport, type TransportOptions } from './transport.ts';

export const APP_ID = 'csbot-rooms-v1';

export function trysteroTransport(o: TransportOptions): Transport {
  const joins = new Emitter<[string]>(), leaves = new Emitter<[string]>();
  const messages = new Emitter<[unknown, string]>(), errors = new Emitter<[string]>();

  const config = {
    appId: APP_ID,
    password: o.key,
    maxReceiveBytes: MAX_MESSAGE_BYTES,
    ...(o.signaling?.urls ? { relayConfig: { urls: o.signaling.urls } } : {}),
  };
  const callbacks = {
    // Star topology: the host accepts members, members accept the host. Everything else is refused
    // here, before the peer is ever active.
    onPeerHandshake: async (_peer: string, send: (d: { role: string; v: number }) => Promise<void>, receive: () => Promise<{ data: unknown }>) => {
      await send({ role: o.role, v: ROOM_PROTOCOL });
      const { data } = await receive();
      const other = (data as { role?: unknown } | null)?.role;
      if (o.role === 'host' ? other !== 'member' : other !== 'host') throw new Error('csbot: not a host/member pair');
    },
    onJoinError: (d: { error: string }) => {
      // Member⇄member refusals are expected noise in a star; report the rest.
      if (!/host\/member pair/.test(d.error)) errors.emit(d.error);
    },
    handshakeTimeoutMs: 10_000,
  };
  const roomId = `room-${o.code}`;
  const room: Room = (o.signaling?.kind === 'ws' ? joinWsRelay : joinNostr)(config as never, roomId, callbacks as never);
  const action = room.makeAction<string>('m');

  room.onPeerJoin = peer => joins.emit(peer);
  room.onPeerLeave = peer => leaves.emit(peer);
  action.onMessage = (data, ctx) => {
    if (typeof data !== 'string' || data.length > MAX_MESSAGE_BYTES) return;
    let msg: unknown;
    try { msg = JSON.parse(data); } catch { return; }
    messages.emit(msg, ctx.peerId);
  };

  return {
    selfId,
    onPeerJoin: cb => joins.on(cb),
    onPeerLeave: cb => leaves.on(cb),
    onMessage: cb => messages.on(cb),
    onError: cb => errors.on(cb),
    send: (msg, to) => { void action.send(JSON.stringify(msg), to ? { target: to } : undefined).catch(() => undefined); },
    leave: () => { void room.leave(); },
  };
}
