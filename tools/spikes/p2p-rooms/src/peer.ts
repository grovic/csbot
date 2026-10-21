// Spike 7 peer: runs in a browser page as the room host or as a member.
// URL: index.html?role=host|member&room=R&key=K&name=N
// Signaling: Trystero's default strategy (public Nostr relays), session descriptions encrypted with `key`.
// Topology: star. The handshake exchanges roles; members refuse other members, the host refuses
// anyone who isn't a member (and Trystero itself refuses peers with the wrong key).

import { joinRoom, selfId } from 'trystero';

type Role = 'host' | 'member';
interface Snap { seq: number; t: number; pad: string }
interface Ping { i: number; t: number }

const q = new URLSearchParams(location.search);
const role = (q.get('role') ?? 'member') as Role;
const name = q.get('name') ?? role;
const t0 = performance.now();
const since = () => Math.round(performance.now() - t0);

const result: Record<string, unknown> = { role, name, selfId, joinErrors: [] as string[] };
(window as unknown as { __result: Record<string, unknown> }).__result = result;
const logLines: string[] = [];
result.log = logLines;
const log = (m: string) => { logLines.push(`${since()} ${m}`); };

const room = joinRoom(
  { appId: 'csbot-spike-p2p-rooms', password: q.get('key') ?? '' },
  q.get('room') ?? 'spike',
  {
    onJoinError: d => { (result.joinErrors as string[]).push(String(d.error)); log(`join error ${d.error}`); },
    onPeerHandshake: async (peerId, send, receive) => {
      await send({ role, name });
      const { data } = await receive();
      const other = (data as { role?: Role }).role;
      const ok = role === 'host' ? other === 'member' : other === 'host';
      log(`handshake ${peerId.slice(0, 6)} role=${other} → ${ok ? 'accept' : 'refuse'}`);
      if (!ok) throw new Error('star topology: refused');
    },
  },
);

const snap = room.makeAction<Snap>('snap');
const ping = room.makeAction<Ping>('ping');
const pong = room.makeAction<Ping>('pong');
const pad = 'x'.repeat(2000); // a realistic patch is 1–3 KB

if (role === 'host') {
  const joined: Record<string, number> = {};
  result.joined = joined;
  room.onPeerJoin = peerId => { joined[peerId] = since(); log(`member joined ${peerId.slice(0, 6)}`); };
  room.onPeerLeave = peerId => { log(`member left ${peerId.slice(0, 6)}`); };
  ping.onMessage = (d, { peerId }) => { void pong.send(d, { target: peerId }); };
  let seq = 0;
  setInterval(() => { void snap.send({ seq: ++seq, t: Date.now(), pad }); }, 250);
} else {
  const lat: number[] = [], rtt: number[] = [];
  let host: string | undefined;
  result.latency = lat; result.rtt = rtt;
  room.onPeerJoin = peerId => {
    host = peerId; result.hostJoinMs = since(); log('host connected');
    // 20 sequential pings once connected.
    let i = 0;
    const next = () => { if (i < 20) void ping.send({ i: i++, t: performance.now() }, { target: peerId }); };
    pong.onMessage = d => { rtt.push(performance.now() - d.t); next(); if (rtt.length === 20) result.done = true; };
    setTimeout(next, 300);
  };
  room.onPeerLeave = peerId => { if (peerId === host) { result.hostLeftAt = since(); log('host left'); } };
  snap.onMessage = s => {
    if (result.firstSnapMs === undefined) result.firstSnapMs = since();
    if (lat.length < 200) lat.push(Date.now() - s.t);
  };
}
