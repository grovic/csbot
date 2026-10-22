// A member's side of the room (web app or desktop app in member mode): join, wait for approval,
// render the host's personalized screen, survive the host going away, share own GSI (desktop).

import { callKey, isHostMessage, ROOM_PROTOCOL, type CoachView, type DebriefView, type LinkStatus, type MemberMessage, type ScoutView, type ScreenState, sanitizeTeam, type TeamPlan } from '@csbot/protocol';
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
  private pendingCoach?: CoachView;
  private pendingTeam?: TeamPlan;
  private pendingDebrief?: DebriefView;
  private askWaiter?: (r: { ok: boolean; error?: string }) => void;
  /** The newest hosting generation seen (handover): messages from an older host are refused. */
  private hostEpoch = -1;
  private intelWaiters: ((r: { ok: boolean; error?: string }) => void)[] = [];
  /** The last call this screen told the host it shows (M9 timing). */
  private shownKey?: string;

  constructor(o: RoomClientOptions) {
    this.o = { now: Date.now, gsiMinGapMs: 100, ...o };
    this.state = { status: 'connecting', since: this.o.now() };
    const t = o.transport;
    t.onPeerJoin(peer => {
      if (this.closed) return;
      // Say hello to every host that shows up; the one with the newest epoch keeps us (handover).
      if (!this.host) this.host = peer;
      this.o.transport.send({ t: 'hello', v: ROOM_PROTOCOL, clientId: this.o.clientId, name: this.o.name, device: this.o.device } satisfies MemberMessage, peer);
      if (this.state.status === 'host-offline' && peer === this.host) this.set('connecting');
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
    t.onMessage((m, peer) => { if (this.follow(m, peer)) this.receive(m); });
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

  /** Squad check-in for our slot: on my spot, or rotating to a site. The marker updates in the next state. */
  checkIn(state: 'spot' | 'rotate', site?: 'A' | 'B'): boolean {
    if (this.state.status !== 'approved') return false;
    this.sendMsg({ t: 'checkin', state, ...(site ? { site } : {}) });
    return true;
  }

  /** Log intel (zone, enemies seen; 0 = clear). Resolves with the host's verdict; the effect arrives in the next state. */
  logIntel(zone: string, count: number, timeoutMs = 10_000): Promise<{ ok: boolean; error?: string }> {
    if (this.state.status !== 'approved') return Promise.resolve({ ok: false, error: 'Not connected to the host.' });
    return new Promise(resolve => {
      const done = (r: { ok: boolean; error?: string }) => { clearTimeout(timer); resolve(r); };
      const timer = setTimeout(() => {
        const i = this.intelWaiters.indexOf(done);
        if (i >= 0) { this.intelWaiters.splice(i, 1); resolve({ ok: false, error: "The host didn't confirm. Try again." }); }
      }, timeoutMs);
      this.intelWaiters.push(done);
      this.sendMsg({ t: 'intel', zone, count });
    });
  }

  /** Ask the coach. Resolves with the host's verdict (quota, permission), not the answer: that arrives in the chat. */
  ask(text: string, timeoutMs = 20_000): Promise<{ ok: boolean; error?: string }> {
    if (this.state.status !== 'approved') return Promise.resolve({ ok: false, error: 'Not connected to the host.' });
    if (this.askWaiter) return Promise.resolve({ ok: false, error: 'Your last question is still being sent.' });
    return new Promise(resolve => {
      const timer = setTimeout(() => { if (this.askWaiter === done) { this.askWaiter = undefined; resolve({ ok: false, error: "The host didn't answer. Try again." }); } }, timeoutMs);
      const done = (r: { ok: boolean; error?: string }) => { clearTimeout(timer); resolve(r); };
      this.askWaiter = done;
      this.sendMsg({ t: 'ask', text });
    });
  }
  rename(name: string): void { this.sendMsg({ t: 'rename', name }); }

  leave(): void {
    if (this.closed) return;
    this.sendMsg({ t: 'bye' });
    this.closed = true;
    this.set('ended', 'You left the room.');
    setTimeout(() => this.o.transport.leave(), 100);
  }

  /** Whether a message comes from the host we follow; switches to a newer host (handover), tells an older one. */
  private follow(m: unknown, peer: string): boolean {
    if (!isHostMessage(m)) return false;
    const epoch = m.t === 'welcome' || m.t === 'state' ? m.epoch ?? 0 : undefined;
    if (peer !== this.host) {
      if (epoch === undefined) return false;
      if (epoch < this.hostEpoch) { this.o.transport.send({ t: 'stale', epoch: this.hostEpoch } satisfies MemberMessage, peer); return false; }
      if (epoch === this.hostEpoch && this.host) return false;
      this.host = peer;
    }
    if (epoch !== undefined) {
      if (epoch < this.hostEpoch) { this.o.transport.send({ t: 'stale', epoch: this.hostEpoch } satisfies MemberMessage, peer); return false; }
      this.hostEpoch = epoch;
    }
    return true;
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
        const coach = this.state.screen?.coach ?? this.pendingCoach;
        const debrief = this.state.screen?.debrief ?? this.pendingDebrief;
        const team = this.state.screen?.team ?? this.pendingTeam;
        this.state = { ...this.state, status: 'approved', screen: { live: m.live, room: m.room, ...(scout ? { scout } : {}), ...(coach ? { coach } : {}), ...(debrief ? { debrief } : {}), ...(team ? { team } : {}) } };
        if (this.state.detail) delete this.state.detail;
        this.emit();
        // Tell the host when a new call is on this screen: it times how fast calls reach everyone.
        const key = callKey(m.live.call);
        if (key && key !== this.shownKey) { this.shownKey = key; this.sendMsg({ t: 'shown', key }); }
        break;
      }
      case 'coach':
        if (this.state.screen) { this.state = { ...this.state, screen: { ...this.state.screen, coach: m.coach } }; this.emit(); }
        else this.pendingCoach = m.coach;
        break;
      case 'intelResult': {
        this.intelWaiters.shift()?.({ ok: m.ok, ...(m.error ? { error: m.error } : {}) });
        break;
      }
      case 'askResult': {
        const w = this.askWaiter;
        this.askWaiter = undefined;
        w?.({ ok: m.ok, ...(m.error ? { error: m.error } : {}) });
        break;
      }
      case 'scout':
        // Scouting can arrive before the first state; keep it until there's a screen to attach it to.
        if (this.state.screen) { this.state = { ...this.state, screen: { ...this.state.screen, scout: m.scout } }; this.emit(); }
        else this.pendingScout = m.scout;
        break;
      case 'debrief':
        if (this.state.screen) { this.state = { ...this.state, screen: { ...this.state.screen, debrief: m.debrief } }; this.emit(); }
        else this.pendingDebrief = m.debrief;
        break;
      case 'team': {
        // Applied to this device's engine: never trust its shape.
        const team = sanitizeTeam(m.team);
        if (this.state.screen) { this.state = { ...this.state, screen: { ...this.state.screen, team } }; this.emit(); }
        else this.pendingTeam = team;
        break;
      }
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
