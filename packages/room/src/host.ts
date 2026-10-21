// The room on the admin's desktop: who's in, who's waiting, which slot each member plays, and
// every member's personalized screen. Pure TS: runs in the desktop renderer (WebRTC) and in tests.

import { MatchTracker, slotsFor } from '@csbot/engine';
import { spectatorGuard, toGameState, type GsiPayload } from '@csbot/gsi';
import {
  DEFAULT_PERMISSIONS, parseMemberMessage, ROOM_PROTOCOL,
  type DeviceKind, type HostMessage, type JoinRequest, type LiveSnapshot, type MemberMessage, type PlayerRow,
  type CoachAsker, type CoachView, type RoomMember, type RoomPermissions, type RoomView, type ScoutView, type ScreenState,
} from '@csbot/protocol';
import { mergeRows, personalize } from './compose.ts';
import type { Transport } from './transport.ts';

export const HOST_ID = 'host';

export interface SavedMember { id: string; name: string; slot?: string }

/** What the host keeps between launches (so approved members rejoin without asking again). */
export interface SavedRoom {
  code: string;
  key: string;
  createdAt: number;
  approved: SavedMember[];
  permissions: RoomPermissions;
  tournament: boolean;
  hostSlot?: string;
}

export function newSavedRoom(code: string, key: string, now = Date.now()): SavedRoom {
  return { code, key, createdAt: now, approved: [], permissions: { ...DEFAULT_PERMISSIONS }, tournament: false };
}

export interface RoomHostOptions {
  transport: Transport;
  room: SavedRoom;
  hostName: string;
  /** Members besides the host (default 9: a 5-stack plus subs and a coach). */
  maxMembers?: number;
  now?: () => number;
  /** Called whenever something worth persisting changes. */
  onSave?: (r: SavedRoom) => void;
  /** Minimum gap between state broadcasts (default 250 ms, so ≤ 4/s per member). */
  throttleMs?: number;
  /** Per-peer message budget per second before messages are dropped (default 30). */
  rateLimit?: number;
  /** A member's question for the coach (already checked against the room's ask permission). */
  onAsk?: (from: CoachAsker, text: string) => Promise<{ ok: boolean; error?: string }>;
  /** A member's intel (already checked against the room's intel permission and tournament mode). */
  onIntel?: (from: { id: string; name: string }, zone: string, count: number) => Promise<{ ok: boolean; error?: string }>;
}

interface Peer { id: string; memberId?: string; device?: DeviceKind; times: number[] }
interface Member extends SavedMember { device: DeviceKind; peer?: string; tracker?: MatchTracker; lastGsiAt?: number }

const EMPTY_LIVE: LiveSnapshot = {
  v: 1, seq: 0, at: 0, scoreboard: [], ticker: [],
  connection: { gsi: 'waiting', payloads: 0, source: 'game', guardDropped: 0 },
};

export class RoomHost {
  private readonly o: Required<Omit<RoomHostOptions, 'onSave' | 'onAsk' | 'onIntel'>> & Pick<RoomHostOptions, 'onSave' | 'onAsk' | 'onIntel'>;
  private saved: SavedRoom;
  private peers = new Map<string, Peer>();
  private members = new Map<string, Member>();
  private pending = new Map<string, JoinRequest & { peer: string }>();
  private live: LiveSnapshot = EMPTY_LIVE;
  private scout?: ScoutView;
  private coach?: CoachView;
  private listeners = new Set<(s: ScreenState) => void>();
  private timer?: ReturnType<typeof setTimeout>;
  private lastBroadcast = 0;
  private ended = false;
  /** Spectator-only nodes dropped from members' GSI (room-wide guard). */
  guardDropped = 0;

  constructor(o: RoomHostOptions) {
    this.o = { maxMembers: 9, now: Date.now, throttleMs: 250, rateLimit: 30, ...o };
    this.saved = structuredClone(o.room);
    for (const m of this.saved.approved) this.members.set(m.id, { ...m, device: 'web' });
    const t = o.transport;
    t.onPeerJoin(peer => { this.peers.set(peer, { id: peer, times: [] }); });
    t.onPeerLeave(peer => this.dropPeer(peer));
    t.onMessage((raw, peer) => this.receive(peer, raw));
  }

  // ------------------------------------------------------------- admin actions

  setLive(s: LiveSnapshot): void { this.live = s; this.schedule(); }

  /** New coach state (chat, call log, budget): every member gets it now; joiners on approval. */
  setCoach(c: CoachView): void {
    this.coach = c;
    for (const m of this.members.values()) if (m.peer) this.send(m.peer, { t: 'coach', coach: c });
    this.schedule(true);
  }

  /** New scouting: every member gets it now; joiners get it on approval. */
  setScout(s: ScoutView): void {
    this.scout = s;
    for (const m of this.members.values()) if (m.peer) this.send(m.peer, { t: 'scout', scout: s });
    this.schedule(true);
  }

  approve(id: string): void {
    const req = this.pending.get(id);
    if (!req || this.ended) return;
    this.pending.delete(id);
    const m: Member = { id, name: req.name, device: req.device, peer: req.peer, slot: this.freeSlot() };
    this.members.set(id, m);
    const p = this.peers.get(req.peer);
    if (p) p.memberId = id;
    this.save();
    this.send(req.peer, { t: 'welcome', v: ROOM_PROTOCOL, status: 'approved' });
    if (this.scout) this.send(req.peer, { t: 'scout', scout: this.scout });
    if (this.coach) this.send(req.peer, { t: 'coach', coach: this.coach });
    this.schedule(true);
  }

  deny(id: string): void {
    const req = this.pending.get(id);
    if (!req) return;
    this.pending.delete(id);
    this.send(req.peer, { t: 'welcome', v: ROOM_PROTOCOL, status: 'denied' });
    this.schedule(true);
  }

  remove(id: string): void {
    const m = this.members.get(id);
    if (!m) return;
    this.members.delete(id);
    if (m.peer) {
      this.send(m.peer, { t: 'removed', reason: 'The admin removed you from the room.' });
      const p = this.peers.get(m.peer);
      if (p) p.memberId = undefined;
    }
    this.save();
    this.schedule(true);
  }

  /** Assign a slot to a member (or the host with HOST_ID). A slot belongs to one player at a time. */
  setSlot(id: string, slot: string | null): void {
    if (slot !== null && !slotsFor(this.live.match?.map).some(s => s.id === slot)) return;
    for (const m of this.members.values()) if (slot && m.slot === slot && m.id !== id) m.slot = undefined;
    if (slot && this.saved.hostSlot === slot && id !== HOST_ID) this.saved.hostSlot = undefined;
    if (id === HOST_ID) this.saved.hostSlot = slot ?? undefined;
    else { const m = this.members.get(id); if (!m) return; m.slot = slot ?? undefined; }
    this.save();
    this.schedule(true);
  }

  setPermissions(p: Partial<RoomPermissions>): void { this.saved.permissions = { ...this.saved.permissions, ...p }; this.save(); this.schedule(true); }
  setTournament(on: boolean): void { this.saved.tournament = on; this.save(); this.schedule(true); }

  /** Close the room for everyone. */
  end(): void {
    if (this.ended) return;
    this.ended = true;
    this.o.transport.send({ t: 'ended' } satisfies HostMessage);
    if (this.timer) clearTimeout(this.timer);
    setTimeout(() => this.o.transport.leave(), 200);
  }

  // ------------------------------------------------------------- views

  /** The admin's own screen. */
  screen(): ScreenState {
    return { live: this.personalLive(HOST_ID), room: this.view(HOST_ID), ...(this.scout ? { scout: this.scout } : {}), ...(this.coach ? { coach: this.coach } : {}) };
  }

  subscribe(cb: (s: ScreenState) => void): () => void {
    this.listeners.add(cb);
    cb(this.screen());
    return () => { this.listeners.delete(cb); };
  }

  view(forId: string): RoomView {
    const host: RoomMember = {
      id: HOST_ID, name: this.hostName, role: 'admin', device: 'host', online: true,
      sharesGsi: this.live.connection.payloads > 0, ...(this.saved.hostSlot ? { slot: this.saved.hostSlot } : {}),
    };
    const now = this.o.now();
    const members: RoomMember[] = [...this.members.values()].map(m => ({
      id: m.id, name: m.name, role: 'member', device: m.device, online: !!m.peer,
      sharesGsi: !!m.lastGsiAt && now - m.lastGsiAt < 15_000, ...(m.slot ? { slot: m.slot } : {}),
    }));
    return {
      code: this.saved.code, hostName: this.hostName, members: [host, ...members],
      pending: forId === HOST_ID ? [...this.pending.values()].map(({ peer: _p, ...r }) => r) : [],
      permissions: { ...this.saved.permissions }, tournament: this.saved.tournament,
      slots: slotsFor(this.live.match?.map, this.live.match?.ourSide).map(s => ({ ...s })), you: forId, createdAt: this.saved.createdAt,
    };
  }

  get savedRoom(): SavedRoom { return structuredClone(this.saved); }

  /** The host's in-game name once CS2 reports it, else the name given at creation. */
  get hostName(): string { return this.live.me?.name || this.o.hostName; }

  // ------------------------------------------------------------- internals

  private receive(peerId: string, raw: unknown): void {
    if (this.ended) return;
    const peer = this.peers.get(peerId) ?? { id: peerId, times: [] };
    this.peers.set(peerId, peer);
    const now = this.o.now();
    peer.times = peer.times.filter(t => now - t < 1000);
    if (peer.times.length >= this.o.rateLimit) return;
    peer.times.push(now);
    const m = parseMemberMessage(raw);
    if (!m) return;
    if (m.t === 'hello') { this.hello(peer, m); return; }
    const member = peer.memberId ? this.members.get(peer.memberId) : undefined;
    if (!member) return; // only approved members can do anything else
    switch (m.t) {
      case 'gsi': this.memberGsi(member, m.payload as GsiPayload, now); break;
      case 'slot': if (this.saved.permissions.editSlot) this.setSlot(member.id, m.slot); break;
      case 'rename': member.name = m.name; this.save(); this.schedule(true); break;
      case 'bye': this.dropPeer(peerId); break;
      case 'ask': void this.ask(member, m.text, peerId); break;
      case 'intel': void this.intel(member, m.zone, m.count, peerId); break;
    }
  }

  private hello(peer: Peer, m: Extract<MemberMessage, { t: 'hello' }>): void {
    if (m.v !== ROOM_PROTOCOL) {
      this.send(peer.id, { t: 'welcome', v: ROOM_PROTOCOL, status: 'version', detail: `This room runs csbot protocol ${ROOM_PROTOCOL}; update the app.` });
      return;
    }
    peer.device = m.device;
    const known = this.members.get(m.clientId);
    if (known) {
      // A returning member: reattach (the newest connection wins if they opened a second tab).
      if (known.peer && known.peer !== peer.id) {
        const old = this.peers.get(known.peer);
        if (old) old.memberId = undefined;
        this.send(known.peer, { t: 'removed', reason: 'You joined from another tab or device.' });
      }
      known.peer = peer.id;
      known.device = m.device;
      known.name = m.name;
      peer.memberId = known.id;
      this.send(peer.id, { t: 'welcome', v: ROOM_PROTOCOL, status: 'approved' });
      if (this.scout) this.send(peer.id, { t: 'scout', scout: this.scout });
      if (this.coach) this.send(peer.id, { t: 'coach', coach: this.coach });
      this.schedule(true);
      return;
    }
    if (this.members.size >= this.o.maxMembers) {
      this.send(peer.id, { t: 'welcome', v: ROOM_PROTOCOL, status: 'full' });
      return;
    }
    this.pending.set(m.clientId, { id: m.clientId, name: m.name, device: m.device, at: this.o.now(), peer: peer.id });
    this.send(peer.id, { t: 'welcome', v: ROOM_PROTOCOL, status: 'pending' });
    this.schedule(true);
  }

  private async ask(member: Member, text: string, peer: string): Promise<void> {
    if (!this.saved.permissions.ask) { this.send(peer, { t: 'askResult', ok: false, error: 'The admin turned off questions for members.' }); return; }
    if (this.saved.tournament) { this.send(peer, { t: 'askResult', ok: false, error: 'Tournament mode is on: no live coaching.' }); return; }
    if (!this.o.onAsk) { this.send(peer, { t: 'askResult', ok: false, error: "The host's coach isn't available." }); return; }
    const r = await this.o.onAsk({ id: member.id, name: member.name, role: 'member' }, text).catch((e: Error) => ({ ok: false, error: e.message }));
    this.send(peer, { t: 'askResult', ok: r.ok, ...(r.error ? { error: r.error } : {}) });
  }

  private async intel(member: Member, zone: string, count: number, peer: string): Promise<void> {
    const refuse = (error: string) => this.send(peer, { t: 'intelResult', ok: false, error });
    if (!this.saved.permissions.intel) { refuse('The admin turned off intel from members.'); return; }
    if (this.saved.tournament) { refuse('Tournament mode is on: no live forecast.'); return; }
    if (!this.o.onIntel) { refuse("The host can't take intel right now."); return; }
    const r = await this.o.onIntel({ id: member.id, name: member.name }, zone, count).catch((e: Error) => ({ ok: false, error: e.message }));
    this.send(peer, { t: 'intelResult', ok: r.ok, ...(r.error ? { error: r.error } : {}) });
  }

  private memberGsi(member: Member, payload: GsiPayload, now: number): void {
    if (member.device !== 'desktop') return;
    // Room-wide spectator guard: no device may bring spectator-only data into the room.
    const { payload: guarded, dropped } = spectatorGuard(payload, { ourSide: this.live.match?.ourSide });
    this.guardDropped += dropped.length;
    member.tracker ??= new MatchTracker({ source: 'game' });
    member.tracker.ingest(toGameState(guarded, now));
    member.lastGsiAt = now;
    this.schedule();
  }

  private dropPeer(peerId: string): void {
    const p = this.peers.get(peerId);
    this.peers.delete(peerId);
    for (const [id, r] of this.pending) if (r.peer === peerId) this.pending.delete(id);
    if (p?.memberId) {
      const m = this.members.get(p.memberId);
      if (m && m.peer === peerId) m.peer = undefined;
    }
    this.schedule(true);
  }

  private freeSlot(): string | undefined {
    const taken = new Set([this.saved.hostSlot, ...[...this.members.values()].map(m => m.slot)]);
    return slotsFor(this.live.match?.map).find(s => !taken.has(s.id))?.id;
  }

  private save(): void {
    this.saved.approved = [...this.members.values()].map(m => ({ id: m.id, name: m.name, ...(m.slot ? { slot: m.slot } : {}) }));
    this.o.onSave?.(structuredClone(this.saved));
  }

  /** Coalesce bursts: at most one broadcast per throttle window; `soon` skips the wait for UI actions. */
  private schedule(soon = false): void {
    if (this.ended) return;
    const wait = soon ? 0 : Math.max(0, this.o.throttleMs - (this.o.now() - this.lastBroadcast));
    if (this.timer && !soon) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = undefined; this.broadcast(); }, wait);
  }

  private rows(): PlayerRow[] {
    const rows: PlayerRow[] = [...this.live.scoreboard];
    const now = this.o.now();
    for (const m of this.members.values()) {
      if (!m.tracker) continue;
      const s = m.tracker.snapshot(now);
      for (const r of s.scoreboard) rows.push(r.isMe ? { ...r, source: 'room', name: r.name || m.name } : r);
    }
    return mergeRows(rows);
  }

  private personalLive(id: string, rows = this.rows()): LiveSnapshot {
    if (id === HOST_ID) {
      return personalize(this.live, rows, {
        slot: this.saved.hostSlot, me: this.live.me, youTile: this.live.youTile, steamid: this.live.me?.steamid, tournament: this.saved.tournament,
      });
    }
    const m = this.members.get(id);
    const own = m?.tracker?.snapshot(this.o.now());
    return personalize(this.live, rows, {
      slot: m?.slot, me: own?.me, youTile: own?.youTile, steamid: own?.me?.steamid, tournament: this.saved.tournament,
    });
  }

  private broadcast(): void {
    this.lastBroadcast = this.o.now();
    const rows = this.rows();
    for (const m of this.members.values()) {
      if (!m.peer) continue;
      this.send(m.peer, { t: 'state', room: this.view(m.id), live: this.personalLive(m.id, rows) });
    }
    if (this.listeners.size) {
      const s: ScreenState = { live: this.personalLive(HOST_ID, rows), room: this.view(HOST_ID), ...(this.scout ? { scout: this.scout } : {}), ...(this.coach ? { coach: this.coach } : {}) };
      for (const cb of this.listeners) cb(s);
    }
  }

  private send(peer: string, msg: HostMessage): void { this.o.transport.send(msg, peer); }
}
