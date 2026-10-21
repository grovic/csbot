// What this screen is doing, and the actions the UI can take. One instance per page.
//   demo    browser, no host: fictional match through the real engine
//   none    browser, ?source=none: nothing to show
//   solo    desktop app, no room: this PC's own game
//   host    desktop app hosting a room (RoomHost over WebRTC, fed by this PC's snapshots)
//   member  web (invite link) or desktop app that joined someone's room (RoomClient)
// UI components only read `SessionView`; everything they render comes from a ScreenState.

import {
  DEFAULT_INVITE_BASE, HOST_ID, inviteUrl, newClientId, newRoomCode, newRoomKey, newSavedRoom, parseInvite,
  RoomClient, RoomHost, type Invite, type SavedRoom,
} from '@csbot/room';
import { trysteroTransport } from '@csbot/room/trystero';
import type { CsbotBridge, LinkStatus, LiveSnapshot, RoomPermissions, ScreenState } from '@csbot/protocol';
import { demoRoom } from './demoRoom.ts';
import { demoSource, readDemoOptions } from './demo.ts';
import { signalFromLink, signalFromPage, toSignaling } from './signal.ts';
import { noneSource, type SourceKind } from './source.ts';

export type Role = 'demo' | 'none' | 'solo' | 'host' | 'member';

export interface LinkView { status: LinkStatus; since: number; detail?: string }

export interface SessionView {
  role: Role;
  /** Where data comes from, for the pages that care (Settings, the waiting screen). */
  kind: SourceKind;
  device: 'desktop' | 'web';
  screen?: ScreenState;
  receivedAt: number;
  /** Host-time rate for the banner clock (0 = paused demo). */
  rate: number;
  /** Web member before joining: the join form. `invalid` = the link is broken. */
  join?: { invite?: Invite; invalid?: boolean; name: string };
  /** Member: connection to the host. */
  link?: LinkView;
  /** Host: the link to share. */
  inviteLink?: string;
  /** Room code while hosting or joined (also before the first state arrives). */
  code?: string;
  /** 'ws' = self-hosted relay; default public Nostr relays. */
  signaling: 'nostr' | 'ws';
  /** Member: the network couldn't connect to the host directly (strict NAT, blocked WebRTC). */
  netError?: string;
}

const LS = {
  name: 'csbot.name',
  clientId: 'csbot.clientId',
  hostRoom: 'csbot.hostRoom',
  hostName: 'csbot.hostName',
  memberRoom: 'csbot.memberRoom',
} as const;
/** Web member: the joined link, per tab (survives reloads, not new tabs). */
const SS_MEMBER = 'csbot.memberRoom';

function read<T>(store: Storage, key: string): T | undefined {
  try { const v = store.getItem(key); return v ? (JSON.parse(v) as T) : undefined; } catch { return undefined; }
}
function write(store: Storage, key: string, v: unknown): void {
  try { if (v === undefined) store.removeItem(key); else store.setItem(key, JSON.stringify(v)); } catch { /* storage full or blocked */ }
}

export function rememberedName(): string {
  return read<string>(localStorage, LS.name) ?? '';
}

function clientId(): string {
  let id = read<string>(localStorage, LS.clientId);
  if (!id) { id = newClientId(); write(localStorage, LS.clientId, id); }
  return id;
}

export class Session {
  private view: SessionView;
  private subs = new Set<() => void>();
  private stops: (() => void)[] = [];
  private host?: RoomHost;
  private client?: RoomClient;
  private lastLive?: LiveSnapshot;
  /** Leaves the room network. Cleared when the room closes itself (end/leave send a goodbye first). */
  private leaveNet?: () => void;
  private readonly bridge?: CsbotBridge;
  private readonly win: Window;
  /** Signaling the page itself was opened with (?signal=…), inherited by rooms we create. */
  private readonly pageSignal?: string;
  private memberLink?: string;

  constructor(win: Window = window) {
    this.win = win;
    this.bridge = win.csbot;
    this.pageSignal = signalFromPage(win.location);
    this.view = { role: 'none', kind: this.bridge ? 'desktop' : 'none', device: this.bridge ? 'desktop' : 'web', receivedAt: Date.now(), rate: 1, signaling: this.pageSignal ? 'ws' : 'nostr' };
    this.start();
    // Opening an invite link in a tab that already runs csbot only changes the hash: start joining.
    if (!this.bridge) {
      win.addEventListener('hashchange', () => {
        if (!/^#\/?r\//.test(win.location.hash)) return;
        const st = this.view.link?.status;
        const inRoom = !!this.client && st !== 'ended' && st !== 'removed' && st !== 'denied';
        if (!inRoom) this.showJoin(win.location.href);
      });
    }
  }

  // useSyncExternalStore
  getSnapshot = (): SessionView => this.view;
  subscribe = (cb: () => void): (() => void) => { this.subs.add(cb); return () => { this.subs.delete(cb); }; };

  // ---------------------------------------------------------------- startup

  private start(): void {
    const { win } = this;
    if (this.bridge) {
      const saved = read<SavedRoom>(localStorage, LS.hostRoom);
      if (saved?.code && saved.key) { this.startHost(saved, read<string>(localStorage, LS.hostName) ?? 'Host'); return; }
      const member = read<string>(localStorage, LS.memberRoom);
      if (member && parseInvite(member)) { this.startMember(member, rememberedName() || 'Player', 'desktop'); return; }
      if (/^#\/?r\//.test(win.location.hash)) {
        const link = win.location.href;
        if (parseInvite(link)) { this.startMember(link, rememberedName() || 'Player', 'desktop'); return; }
      }
      this.startSolo();
      return;
    }
    if (/^#\/?r\//.test(win.location.hash)) { this.showJoin(win.location.href); return; }
    const joined = read<string>(sessionStorage, SS_MEMBER);
    if (joined && parseInvite(joined)) { this.startMember(joined, rememberedName() || 'Player', 'web'); return; }
    if (new URLSearchParams(win.location.search).get('source') === 'none') { this.startSource('none'); return; }
    this.startSource('demo');
  }

  private startSource(which: 'demo' | 'none'): void {
    const src = which === 'demo' ? demoSource(readDemoOptions(this.win.location.search)) : noneSource();
    this.reset({ role: which, kind: which });
    this.stops.push(src.subscribe(live => {
      const screen: ScreenState = which === 'demo' ? { live, room: demoRoom(live.match?.map) } : { live };
      this.set({ screen, receivedAt: Date.now(), rate: src.rate() });
    }));
  }

  private startSolo(): void {
    const b = this.bridge!;
    this.reset({ role: 'solo', kind: 'desktop', device: 'desktop' });
    this.stops.push(b.onSnapshot(live => { this.lastLive = live; this.set({ screen: { live }, receivedAt: Date.now(), rate: 1 }); }));
  }

  // ---------------------------------------------------------------- hosting (desktop)

  createRoom(): void {
    if (!this.bridge || this.view.role !== 'solo') return;
    const room = newSavedRoom(newRoomCode(), newRoomKey());
    const hostName = this.lastLive?.me?.name || rememberedName() || 'Host';
    write(localStorage, LS.hostRoom, room);
    write(localStorage, LS.hostName, hostName);
    this.startHost(room, hostName);
  }

  private startHost(room: SavedRoom, hostName: string): void {
    const b = this.bridge!;
    const signaling = toSignaling(this.pageSignal);
    this.reset({ role: 'host', kind: 'desktop', device: 'desktop', code: room.code, inviteLink: this.inviteFor(room, this.pageSignal) });
    const transport = trysteroTransport({ code: room.code, key: room.key, role: 'host', ...(signaling ? { signaling } : {}) });
    const host = new RoomHost({ transport, room, hostName, onSave: r => write(localStorage, LS.hostRoom, r) });
    this.host = host;
    this.stops.push(b.onSnapshot(live => { this.lastLive = live; host.setLive(live); }));
    this.stops.push(host.subscribe(screen => this.set({ screen, receivedAt: Date.now(), rate: 1 })));
    this.leaveNet = () => transport.leave();
  }

  endRoom(): void {
    if (!this.host) return;
    const h = this.host;
    this.host = undefined;
    write(localStorage, LS.hostRoom, undefined);
    this.leaveNet = undefined; // end() tells members, then leaves the network itself
    h.end();
    this.startSolo();
  }

  approve(id: string) { this.host?.approve(id); }
  deny(id: string) { this.host?.deny(id); }
  remove(id: string) { this.host?.remove(id); }
  setPermissions(p: Partial<RoomPermissions>) { this.host?.setPermissions(p); }
  setTournament(on: boolean) { this.host?.setTournament(on); }

  /** Admin: any member (or HOST_ID). Member: their own slot, when allowed. */
  setSlot(memberId: string, slot: string | null): void {
    if (this.host) this.host.setSlot(memberId, slot);
    else if (this.client && memberId === this.view.screen?.room?.you) this.client.setSlot(slot);
  }

  // ---------------------------------------------------------------- joining

  private showJoin(link: string): void {
    const invite = parseInvite(link);
    this.reset({ role: 'member', kind: 'member', device: 'web', join: { ...(invite ? { invite } : { invalid: true }), name: rememberedName() }, ...(invite ? { code: invite.code } : {}) });
    this.memberLink = link;
  }

  /** Web join form submitted. */
  submitName(name: string): void {
    const n = name.trim().slice(0, 24);
    if (!n || !this.memberLink || !parseInvite(this.memberLink)) return;
    write(localStorage, LS.name, n);
    write(sessionStorage, SS_MEMBER, this.memberLink);
    this.startMember(this.memberLink, n, 'web');
    if (/^#\/?r\//.test(this.win.location.hash)) this.win.location.hash = '#/live';
  }

  /** Desktop: "Join a room" with a pasted link. Returns an error message for a bad link. */
  joinWithLink(link: string, name?: string): string | undefined {
    if (!this.bridge) return 'Joining from here needs the desktop app.';
    const inv = parseInvite(link);
    if (!inv) return "That doesn't look like a csbot invite link. It should end with #/r/CODE?k=…";
    const n = (name ?? '').trim().slice(0, 24) || this.lastLive?.me?.name || rememberedName() || 'Player';
    write(localStorage, LS.name, n);
    write(localStorage, LS.memberRoom, link.trim());
    this.startMember(link.trim(), n, 'desktop');
    return undefined;
  }

  private startMember(link: string, name: string, device: 'web' | 'desktop'): void {
    const inv = parseInvite(link)!;
    const signalUrl = signalFromLink(link) ?? this.pageSignal;
    const signaling = toSignaling(signalUrl);
    this.memberLink = link;
    this.reset({ role: 'member', kind: device === 'desktop' ? 'desktop' : 'member', device, code: inv.code, signaling: signaling ? 'ws' : 'nostr' });
    const transport = trysteroTransport({ code: inv.code, key: inv.key, role: 'member', ...(signaling ? { signaling } : {}) });
    const client = new RoomClient({ transport, clientId: clientId(), name, device });
    this.client = client;
    // Wrong-key errors become 'denied' inside RoomClient; anything else is a network problem worth showing.
    transport.onError(err => {
      if (/password|decrypt/i.test(err)) return;
      if (/connect|TURN|ICE/i.test(err)) this.set({ netError: "Your network blocked a direct connection to the host. Try another network (for example your phone's hotspot), or ask the admin about the TURN option." });
    });
    let lastLive: LiveSnapshot | undefined;
    this.stops.push(client.subscribe(st => {
      const link: LinkView = { status: st.status, since: st.since, ...(st.detail ? { detail: st.detail } : {}) };
      const fresh = !!st.screen && st.screen.live !== lastLive;
      if (st.screen) lastLive = st.screen.live;
      let screen = st.screen;
      if (screen && st.status !== 'approved' && screen.live.match) {
        // The host is away: its last timer would only drift, so show no clock until it's back.
        const { endsIn: _e, source: _s, ...clock } = screen.live.match.clock;
        screen = { ...screen, live: { ...screen.live, match: { ...screen.live.match, clock } } };
      }
      if (st.hint === 'key-mismatch' && st.status === 'connecting') {
        this.set({ netError: "No host answered with this link's key. The link may be old or mistyped: ask the admin for a fresh one." });
      }
      this.set({
        link, ...(screen ? { screen } : {}), ...(st.status === 'approved' ? { netError: undefined } : {}),
        ...(fresh ? { receivedAt: Date.now() } : {}), rate: 1,
      });
    }));
    if (device === 'desktop' && this.bridge?.onGsi) {
      const unsub = this.bridge.onGsi(p => client.sendGsi(p));
      this.stops.push(unsub);
    }
    this.leaveNet = () => transport.leave();
  }

  leaveRoom(): void {
    const c = this.client;
    if (!c) return;
    write(sessionStorage, SS_MEMBER, undefined);
    if (this.view.device === 'desktop') write(localStorage, LS.memberRoom, undefined);
    this.leaveNet = undefined; // leave() sends "bye", then leaves the network itself
    c.leave();
    if (this.view.device === 'desktop') this.startSolo();
  }

  /** After denied / removed / ended: desktop goes back to solo, web back to the join form. */
  backFromRoom(): void {
    write(sessionStorage, SS_MEMBER, undefined);
    if (this.bridge) { write(localStorage, LS.memberRoom, undefined); this.startSolo(); return; }
    if (this.memberLink) this.showJoin(this.memberLink);
  }

  // ---------------------------------------------------------------- helpers

  private inviteFor(room: Invite, signal?: string): string {
    const loc = this.win.location;
    const base = loc.protocol === 'http:' || loc.protocol === 'https:' ? loc.origin + loc.pathname : DEFAULT_INVITE_BASE;
    const url = inviteUrl(base, { code: room.code, key: room.key });
    return signal ? `${url}&signal=${encodeURIComponent(signal)}` : url;
  }

  private reset(patch: Partial<SessionView>): void {
    for (const s of this.stops.splice(0)) { try { s(); } catch { /* already closed */ } }
    this.leaveNet?.();
    this.leaveNet = undefined;
    this.host = undefined;
    this.client = undefined;
    const base: SessionView = { role: 'none', kind: this.bridge ? 'desktop' : 'none', device: this.bridge ? 'desktop' : 'web', receivedAt: Date.now(), rate: 1, signaling: this.pageSignal ? 'ws' : 'nostr' };
    this.view = { ...base, ...patch };
    this.notify();
  }

  private set(patch: Partial<SessionView>): void {
    this.view = { ...this.view, ...patch };
    this.notify();
  }

  private notify(): void { for (const cb of this.subs) cb(); }
}

export { HOST_ID };
