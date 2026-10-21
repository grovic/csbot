// A member's side of the room (web app or desktop app in member mode): join, wait for approval,
// render the host's personalized screen, survive the host going away, share own GSI (desktop).

import { isHostMessage, ROOM_PROTOCOL, type LinkStatus, type MemberMessage, type ScoutView, type ScreenState } from '@csbot/protocol';
import type { Transport } from './transport.ts';

export interface RoomClientOptions {
  transport: Transport;
  clientId: string;
  name: string;
  device: 'web' | 'desktop';
  now?: () => number;
  /** Minimum gap between forwarded GSI payloads (default 100 ms). */
  gsiMinGapMs?: number;
}

export interface ClientState {
  status: LinkStatus;
  since: number;
  detail?: string;
  /** Last screen from the host. Kept while the host is offline. */
  screen?: ScreenState;
  /**
   * A wrong-key handshake was seen while still connecting. Only a hint: in a meshed room an
   * intruder's failed handshake can land on any peer, so it never ends the connection attempt.
   */
  hint?: 'key-mismatch';
}

export class RoomClient {
  private readonly o: Required<RoomClientOptions>;
  private host?: string;
  private state: ClientState;
  private listeners = new Set<(s: ClientState) => void>();
  private lastGsi = 0;
  private closed = false;
  private pendingScout?: ScoutView;

  constructor(o: RoomClientOptions) {
    this.o = { now: Date.now, gsiMinGapMs: 100, ...o };
    this.state = { status: 'connecting', since: this.o.now() };
    const t = o.transport;
    t.onPeerJoin(peer => {
      if (this.closed) return;
      this.host = peer;
      this.sendMsg({ t: 'hello', v: ROOM_PROTOCOL, clientId: this.o.clientId, name: this.o.name, device: this.o.device });
      if (this.state.status === 'host-offline') this.set('connecting');
    });
    t.onPeerLeave(peer => {
      if (peer !== this.host || this.closed) return;
      this.host = undefined;
      if (this.state.status === 'approved' || this.state.status === 'pending' || this.state.status === 'connecting') this.set('host-offline');
    });
    t.onError(err => {
      if (/password|decrypt/i.test(err) && this.state.status === 'connecting' && !this.state.hint) {
        this.state = { ...this.state, hint: 'key-mismatch' };
        this.emit();
      }
    });
    t.onMessage((m, peer) => { if (peer === this.host) this.receive(m); });
  }

  get current(): ClientState { return this.state; }

  subscribe(cb: (s: ClientState) => void): () => void {
    this.listeners.add(cb);
    cb(this.state);
    return () => { this.listeners.delete(cb); };
  }

  /** Forward this device's own GSI payload to the host (desktop members). */
  sendGsi(payload: Record<string, unknown>): void {
    if (this.o.device !== 'desktop' || this.state.status !== 'approved') return;
    const now = this.o.now();
    if (now - this.lastGsi < this.o.gsiMinGapMs) return;
    this.lastGsi = now;
    this.sendMsg({ t: 'gsi', payload });
  }

  setSlot(slot: string | null): void { this.sendMsg({ t: 'slot', slot }); }
  rename(name: string): void { this.sendMsg({ t: 'rename', name }); }

  leave(): void {
    if (this.closed) return;
    this.sendMsg({ t: 'bye' });
    this.closed = true;
    this.set('ended', 'You left the room.');
    setTimeout(() => this.o.transport.leave(), 100);
  }

  private receive(m: unknown): void {
    if (!isHostMessage(m)) return;
    switch (m.t) {
      case 'welcome':
        if (m.status === 'approved') this.set('approved');
        else if (m.status === 'pending') this.set('pending');
        else this.set('denied', m.status === 'full' ? 'The room is full.' : m.status === 'version' ? (m.detail ?? 'Update csbot to join this room.') : 'The admin declined your request.');
        break;
      case 'state': {
        const scout = this.state.screen?.scout ?? this.pendingScout;
        this.state = { ...this.state, status: 'approved', screen: { live: m.live, room: m.room, ...(scout ? { scout } : {}) } };
        if (this.state.detail) delete this.state.detail;
        this.emit();
        break;
      }
      case 'scout':
        // Scouting can arrive before the first state; keep it until there's a screen to attach it to.
        if (this.state.screen) { this.state = { ...this.state, screen: { ...this.state.screen, scout: m.scout } }; this.emit(); }
        else this.pendingScout = m.scout;
        break;
      case 'removed': this.set('removed', m.reason); break;
      case 'ended': this.set('ended', 'The admin closed the room.'); break;
    }
  }

  private set(status: LinkStatus, detail?: string): void {
    const { screen, hint } = this.state;
    this.state = { status, since: this.o.now(), ...(detail ? { detail } : {}), ...(screen ? { screen } : {}), ...(hint && status === 'connecting' ? { hint } : {}) };
    this.emit();
  }

  private emit(): void {
    const s = this.state;
    const link = { status: s.status, since: s.since, ...(s.detail ? { detail: s.detail } : {}) };
    if (s.screen) s.screen = { ...s.screen, link };
    for (const cb of this.listeners) cb(s);
  }

  private sendMsg(m: MemberMessage): void {
    if (this.host) this.o.transport.send(m, this.host);
  }
}
