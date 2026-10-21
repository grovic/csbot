// Browser entry for the transport e2e: one Trystero room peer (host or member) over a given
// signaling relay. Bundled to an IIFE that sets window.__probe.
import { trysteroTransport } from '../../../../packages/room/src/trystero.ts';

interface ProbeState { role?: string; peers: string[]; got: unknown[]; errors: string[] }
const state: ProbeState = { peers: [], got: [], errors: [] };

function caps() {
  return {
    secure: window.isSecureContext,
    subtle: typeof crypto !== 'undefined' && !!crypto.subtle,
    rtc: typeof RTCPeerConnection === 'function',
    origin: location.origin,
  };
}

function start(role: 'host' | 'member', code: string, key: string, url: string) {
  state.role = role;
  const t = trysteroTransport({ code, key, role, signaling: { kind: 'ws', urls: [url] } });
  t.onPeerJoin(p => { state.peers.push(p); t.send({ hello: role }, p); });
  t.onMessage(m => { state.got.push(m); });
  t.onError(e => { state.errors.push(e); });
  (window as unknown as { __send: (m: unknown) => void }).__send = m => t.send(m);
}

(window as unknown as { __probe: unknown }).__probe = { caps, start, state };
