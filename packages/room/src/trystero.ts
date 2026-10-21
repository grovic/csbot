// WebRTC transport through Trystero (MIT). Browser and Electron renderer only (needs RTCPeerConnection).
// Signaling defaults to public Nostr relays: no account, no server of ours. The room key is Trystero's
// password, so session descriptions are encrypted and a peer without the key can't connect at all.
//
// Topology: logically a star. Trystero meshes every peer in a room, and refusing member⇄member
// handshakes makes it retry in a tight loop (thousands of errors per minute, and a false "wrong key").
// So every csbot peer is accepted at the network level, and this transport only surfaces, accepts
// messages from, and sends to the other side: members see only the host, the host sees only members.
// Side effect: members also hold idle connections to each other (and so see each other's IP address).

import { joinRoom as joinNostr, selfId, type Room } from 'trystero';
import { joinRoom as joinWsRelay } from '@trystero-p2p/ws-relay';
import { MAX_MESSAGE_BYTES, ROOM_PROTOCOL } from '@csbot/protocol';
import { Emitter, type PeerRole, type Transport, type TransportOptions } from './transport.ts';

export const APP_ID = 'csbot-rooms-v1';

export function trysteroTransport(o: TransportOptions): Transport {
  const joins = new Emitter<[string]>(), leaves = new Emitter<[string]>();
  const messages = new Emitter<[unknown, string]>(), errors = new Emitter<[string]>();
  const roles = new Map<string, PeerRole>();
  const want: PeerRole = o.role === 'host' ? 'member' : 'host';
  /** Peers on the other side of the star, after the handshake. */
  const relevant = new Set<string>();

  const config = {
    appId: APP_ID,
    password: o.key,
    maxReceiveBytes: MAX_MESSAGE_BYTES,
    ...(o.signaling?.urls ? { relayConfig: { urls: o.signaling.urls } } : {}),
  };
  const callbacks = {
    onPeerHandshake: async (peer: string, send: (d: { role: string; v: number }) => Promise<void>, receive: () => Promise<{ data: unknown }>) => {
      await send({ role: o.role, v: ROOM_PROTOCOL });
      const { data } = await receive();
      const other = (data as { role?: unknown } | null)?.role;
      if (other !== 'host' && other !== 'member') throw new Error('csbot: not a csbot peer');
      roles.set(peer, other);
    },
    onJoinError: (d: { error: string }) => errors.emit(d.error),
    handshakeTimeoutMs: 10_000,
  };
  const roomId = `room-${o.code}`;
  const room: Room = (o.signaling?.kind === 'ws' ? joinWsRelay : joinNostr)(config as never, roomId, callbacks as never);
  const action = room.makeAction<string>('m');

  room.onPeerJoin = peer => {
    if (roles.get(peer) !== want) return;
    relevant.add(peer);
    joins.emit(peer);
  };
  room.onPeerLeave = peer => {
    roles.delete(peer);
    if (relevant.delete(peer)) leaves.emit(peer);
  };
  action.onMessage = (data, ctx) => {
    if (!relevant.has(ctx.peerId) || typeof data !== 'string' || data.length > MAX_MESSAGE_BYTES) return;
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
    send: (msg, to) => {
      const targets = to ? (relevant.has(to) ? [to] : []) : [...relevant];
      if (targets.length) void action.send(JSON.stringify(msg), { target: targets }).catch(() => undefined);
    },
    leave: () => { void room.leave(); },
  };
}
