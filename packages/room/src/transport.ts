// The network under a room. Production: WebRTC through Trystero (trystero.ts). Tests: in memory
// (memory.ts). Either way the topology is a star: members only talk to the host.

export type PeerRole = 'host' | 'member';

/** How peers find each other. Default: public Nostr relays (no account, no server of ours). */
export type Signaling =
  | { kind: 'nostr'; urls?: string[] }
  /** A self-hosted Trystero WebSocket relay (local tests, or a squad that wants its own). */
  | { kind: 'ws'; urls: string[] };

export interface TransportOptions {
  code: string;
  key: string;
  role: PeerRole;
  signaling?: Signaling;
}

export interface Transport {
  readonly selfId: string;
  /** A peer passed the handshake (for a member: the host). */
  onPeerJoin(cb: (peerId: string) => void): void;
  onPeerLeave(cb: (peerId: string) => void): void;
  onMessage(cb: (msg: unknown, peerId: string) => void): void;
  /** Connection problems worth showing (wrong key, blocked network). */
  onError(cb: (error: string) => void): void;
  /** To one peer, or to every connected peer. */
  send(msg: unknown, to?: string): void;
  leave(): void;
}

export type TransportFactory = (o: TransportOptions) => Transport;

/** Small helper so transports can expose multi-listener events. */
export class Emitter<A extends unknown[]> {
  private cbs: ((...a: A) => void)[] = [];
  on(cb: (...a: A) => void): void { this.cbs.push(cb); }
  emit(...a: A): void { for (const cb of this.cbs) { try { cb(...a); } catch (e) { console.error('[room]', e); } } }
}
