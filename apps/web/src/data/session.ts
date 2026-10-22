// What this screen is doing, and the actions the UI can take. One instance per page.
//   demo    browser, no host: fictional match through the real engine
//   none    browser, ?source=none: nothing to show
//   solo    desktop app, no room: this PC's own game
//   host    desktop app hosting a room (RoomHost over WebRTC, fed by this PC's snapshots)
//   member  web (invite link) or desktop app that joined someone's room (RoomClient)
// UI components only read `SessionView`; everything they render comes from a ScreenState.

import {
  DEFAULT_INVITE_BASE, gatherSlots, HOST_ID, inviteUrl, newClientId, newRoomCode, newRoomKey, newSavedRoom, parseInvite, roomExpiresAt, takeoverRoom,
  RoomClient, RoomHost, type Invite, type SavedRoom,
} from '@csbot/room';
import { trysteroTransport } from '@csbot/room/trystero';
import {
  EMPTY_COACH, EMPTY_DEBRIEF, EMPTY_SCOUT, type CoachConfig, type CoachView, type CsbotBridge, type DebriefView, type DemoReplay, type VoiceEvent, type LinkStatus, type LiveSnapshot, type RoomPermissions,
  type ScoutView, type ScreenState,
} from '@csbot/protocol';
import { demoCoach } from './demoCoach.ts';
import { demoRoom } from './demoRoom.ts';
import { demoScout } from './demoScout.ts';
import { demoSource, readDemoOptions } from './demo.ts';
import { signalFromLink, signalFromPage, toSignaling } from './signal.ts';
import { noneSource, type SnapshotSource, type SourceKind } from './source.ts';

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
  /** A one-off message about the room (it expired, hosting moved). */
  notice?: string;
  /** Desktop push-to-talk: what it's doing or just did (the toast). */
  voice?: { state: VoiceEvent['state']; text?: string; said?: string; error?: string; at: number };
  /**
   * Scouting from this PC's own source (demo, or the desktop host). In a room members get it in
   * `screen.scout` instead; read both through `scoutOf(view)`.
   */
  scout?: ScoutView;
  /** The live coach from this PC's own source (demo, or the desktop app). Read through `coachOf(view)`. */
  coach?: CoachView;
  /** The debrief from this PC's own source (demo, or the desktop app). Read through `debriefOf(view)`. */
  debrief?: DebriefView;
}

/** The scouting this screen shows: from the room when joined, else this PC's own. */
export function scoutOf(v: SessionView): ScoutView {
  return v.screen?.scout ?? v.scout ?? EMPTY_SCOUT;
}

/** The debrief this screen shows: from the room when joined, else this PC's own. */
export function debriefOf(v: SessionView): DebriefView {
  return v.screen?.debrief ?? v.debrief ?? EMPTY_DEBRIEF;
}

/** The coach this screen shows: from the room when joined, else this PC's own. */
export function coachOf(v: SessionView): CoachView {
  return v.screen?.coach ?? v.coach ?? EMPTY_COACH;
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
  /** The demo's own source (it takes intel locally). */
  private demo?: SnapshotSource;

  constructor(win: Window = window) {
    this.win = win;
    this.bridge = win.csbot;
    this.pageSignal = signalFromPage(win.location);
    this.view = { role: 'none', kind: this.bridge ? 'desktop' : 'none', device: this.bridge ? 'desktop' : 'web', receivedAt: Date.now(), rate: 1, signaling: this.pageSignal ? 'ws' : 'nostr' };
    this.start();
    // Desktop: squad check-in hotkeys (Num4/5/6) arrive from the main process.
    this.bridge?.onCheckIn?.((state, site) => { void this.checkIn(state, site); });
    // Desktop: push-to-talk. A heard command goes the same way as a click, so a member's intel and
    // questions reach the room's host.
    this.bridge?.onVoice?.(ev => { void this.onVoice(ev); });
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
      if (saved?.code && saved.key) {
        if (Date.now() < roomExpiresAt(saved)) { this.startHost(saved, read<string>(localStorage, LS.hostName) ?? 'Host'); return; }
        // A day without use: the room is gone, and its invite link with it.
        write(localStorage, LS.hostRoom, undefined);
        this.startSolo();
        this.set({ notice: 'Your room expired after a day without use. Create a new one to get a fresh invite link.' });
        return;
      }
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
    this.reset({ role: which, kind: which, ...(which === 'demo' ? { scout: { ...EMPTY_SCOUT, status: 'loading' as const }, coach: demoCoach() } : {}) });
    if (which === 'demo') void import('./demoDebrief.ts').then(m => { if (this.view.role === 'demo') this.set({ debrief: m.demoDebrief(readDemoOptions(this.win.location.search).map) }); });
    this.demo = which === 'demo' ? src : undefined;
    let alive = true;
    this.stops.push(() => { alive = false; });
    if (which === 'demo') {
      void demoScout().then(s => {
        if (!alive) return;
        this.set({ scout: s, ...(this.view.screen ? { screen: { ...this.view.screen, scout: s } } : {}) });
      });
    }
    this.stops.push(src.subscribe(live => {
      const scout = this.view.scout?.status === 'ready' ? this.view.scout : undefined;
      const coach = this.view.coach;
      const screen: ScreenState = which === 'demo' ? { live, room: demoRoom(live.match?.map), ...(scout ? { scout } : {}), ...(coach ? { coach } : {}) } : { live };
      this.set({ screen, receivedAt: Date.now(), rate: src.rate() });
    }));
  }

  private startSolo(): void {
    const b = this.bridge!;
    this.reset({ role: 'solo', kind: 'desktop', device: 'desktop' });
    this.watchOwnScout();
    this.watchOwnCoach();
    this.watchOwnDebrief();
    this.stops.push(b.onSnapshot(live => {
      this.lastLive = live;
      const { scout, coach } = this.view;
      this.set({ screen: { live, ...(scout ? { scout } : {}), ...(coach ? { coach } : {}) }, receivedAt: Date.now(), rate: 1 });
    }));
  }

  /** Desktop solo/host: the live coach, from the main process. */
  private watchOwnCoach(onCoach?: (c: CoachView) => void): void {
    const b = this.bridge;
    if (!b?.onCoach) return;
    this.stops.push(b.onCoach(c => {
      onCoach?.(c);
      this.set({ coach: c, ...(this.view.screen ? { screen: { ...this.view.screen, coach: c } } : {}) });
    }));
  }

  /** Desktop solo/host: this PC's scouting, from the main process. */
  private watchOwnDebrief(onDebrief?: (d: DebriefView) => void): void {
    const b = this.bridge;
    if (!b?.onDebrief) return;
    this.stops.push(b.onDebrief(d => {
      onDebrief?.(d);
      this.set({ debrief: d });
    }));
  }

  // ---------------------------------------------------------------- debrief (desktop solo / host)

  /** This screen runs the debrief (the desktop app, not joined to someone else's room). */
  get canDebrief(): boolean {
    return !!this.bridge?.onDebrief && (this.view.role === 'solo' || this.view.role === 'host');
  }
  selectMatch(id: string): void { if (this.canDebrief) void this.bridge!.selectMatch?.(id); }
  /** A kept match's 2D replay: from this PC's desktop app, or the demo's fictional one. */
  async getReplay(id: string): Promise<DemoReplay | undefined> {
    if (this.view.role === 'demo') return (await import('./demoReplay.ts')).demoReplay(debriefOf(this.view).record);
    return this.canDebrief ? this.bridge?.getReplay?.(id) : undefined;
  }
  async ingestDemo(file?: string): Promise<string | undefined> {
    if (!this.canDebrief || !this.bridge?.ingestDemo) return 'Adding demos needs the csbot desktop app.';
    const r = await this.bridge.ingestDemo(file);
    return r.ok ? undefined : r.error || undefined;
  }
  async writeWorkOn(id: string): Promise<string | undefined> {
    if (!this.canDebrief || !this.bridge?.writeWorkOn) return "Claude's notes come from the csbot desktop app.";
    const r = await this.bridge.writeWorkOn(id);
    return r.ok ? undefined : r.error ?? 'Not written.';
  }
  openReplays(): void { if (this.canDebrief) void this.bridge?.openReplays?.(); }
  pathForFile(f: File): string | undefined { try { return this.bridge?.pathForFile?.(f); } catch { return undefined; } }

  private watchOwnScout(onScout?: (s: ScoutView) => void): void {
    const b = this.bridge;
    if (!b?.onScout) return;
    this.stops.push(b.onScout(s => {
      onScout?.(s);
      this.set({ scout: s, ...(this.view.screen ? { screen: { ...this.view.screen, scout: s } } : {}) });
    }));
  }

  // ---------------------------------------------------------------- scouting (desktop solo / host)

  /** This screen can start scouting (the desktop app, not joined to someone else's room). */
  get canScout(): boolean {
    return !!this.bridge?.scoutSample && (this.view.role === 'solo' || this.view.role === 'host');
  }

  /** Scout a FACEIT match from its room link. Returns an error message to show, if any. */
  async scoutMatch(link: string): Promise<string | undefined> {
    if (!this.canScout || !this.bridge?.scoutMatch) return 'Scouting runs in the csbot desktop app.';
    try {
      const r = await this.bridge.scoutMatch(link.trim());
      return r.ok ? undefined : r.error ?? 'Could not scout that match.';
    } catch (e) {
      return String((e as Error)?.message ?? e);
    }
  }

  async scoutSample(): Promise<void> { if (this.canScout) await this.bridge!.scoutSample!(); }
  /** csbot picked the wrong team: scout the match again from the other side. */
  async swapScoutSides(): Promise<string | undefined> {
    if (!this.canScout || !this.bridge?.scoutSwap) return undefined;
    const r = await this.bridge.scoutSwap();
    return r.ok ? undefined : r.error ?? 'Could not swap the teams.';
  }
  /** Returns a refusal (budget used, no Claude Code) as an error message to show next to the button. */
  async runScoutReport(): Promise<string | undefined> {
    if (!this.canScout) return undefined;
    const r = await this.bridge!.runScoutReport?.();
    return r && !r.ok ? r.error ?? 'The briefing could not run.' : undefined;
  }

  /** The host's FACEIT nickname (public): recent matches and live-match detection. */
  async setFaceitNickname(nickname: string | null): Promise<{ ok: boolean; error?: string }> {
    if (!this.bridge?.setFaceitNickname) return { ok: false, error: 'This needs the csbot desktop app.' };
    try { return await this.bridge.setFaceitNickname(nickname); } catch (e) { return { ok: false, error: String((e as Error)?.message ?? e) }; }
  }

  /** Save (or clear with null) an API key on this PC. Never echoes the key back. */
  async setApiKey(service: 'faceit' | 'steam', key: string | null): Promise<{ ok: boolean; error?: string }> {
    if (!this.bridge?.setApiKey) return { ok: false, error: 'API keys are stored by the csbot desktop app.' };
    try { return await this.bridge.setApiKey(service, key); } catch (e) { return { ok: false, error: String((e as Error)?.message ?? e) }; }
  }

  // ---------------------------------------------------------------- coach

  /** This screen runs the coach (the desktop app, solo or hosting), so it can change its settings. */
  get canConfigureCoach(): boolean {
    return !!this.bridge?.setCoachConfig && (this.view.role === 'solo' || this.view.role === 'host');
  }

  /**
   * Ask the coach. Desktop solo/host: the main process (as the admin). Member: through the room, and
   * the host checks permission and quota. Returns a refusal to show, if any; the answer arrives in the chat.
   */
  async askCoach(text: string): Promise<string | undefined> {
    const q = text.trim().slice(0, 300);
    if (q.length < 2) return 'Type a question first.';
    try {
      if (this.view.role === 'member') {
        if (!this.client) return 'Not connected to the host.';
        const r = await this.client.ask(q);
        return r.ok ? undefined : r.error ?? 'The host refused the question.';
      }
      if ((this.view.role === 'solo' || this.view.role === 'host') && this.bridge?.askCoach) {
        const r = await this.bridge.askCoach(q);
        return r.ok ? undefined : r.error ?? 'The coach could not take the question.';
      }
      return 'Questions go to the host\'s Claude Code, in the csbot desktop app or a room.';
    } catch (e) {
      return String((e as Error)?.message ?? e);
    }
  }

  /** Act on what push-to-talk heard; the toast shows the result (or why it was refused). */
  async onVoice(ev: VoiceEvent): Promise<void> {
    const at = Date.now();
    const base = { ...(ev.text ? { text: ev.text } : {}), ...(ev.said ? { said: ev.said } : {}) };
    if (ev.state !== 'heard' || !ev.command) {
      this.set({ voice: { state: ev.state, ...base, ...(ev.error ? { error: ev.error } : {}), at } });
      return;
    }
    const c = ev.command;
    const err = c.kind === 'intel' ? await this.logIntel(c.zone, c.count)
      : c.kind === 'checkin' ? await this.checkIn(c.state, c.site)
      : await this.askCoach(c.text);
    this.set({ voice: { state: err ? 'error' : 'heard', ...base, ...(err ? { error: err } : {}), at } });
  }

  async setCoachConfig(patch: Partial<CoachConfig>): Promise<void> {
    if (!this.canConfigureCoach) return;
    try { await this.bridge!.setCoachConfig!(patch); } catch { /* the next coach update shows the real state */ }
  }

  // ---------------------------------------------------------------- intel

  /**
   * Why intel can't be logged from this screen right now, or undefined when it can. The host checks
   * again (and may still refuse); this is what the map shows before anyone clicks.
   */
  intelBlock(): string | undefined {
    const v = this.view, live = v.screen?.live, room = v.screen?.room;
    if (v.role === 'none') return 'No match to log intel in.';
    if (v.role === 'member' && v.link?.status !== 'approved') return 'Not connected to the host.';
    if (room?.tournament) return 'Tournament mode is on: no live forecast.';
    if (v.role === 'member' && room && !room.permissions.intel) return 'The admin turned off intel from members.';
    const phase = live?.match?.clock.phase;
    if (phase !== 'live' && phase !== 'bomb') return 'Intel is logged while the round is live.';
    return undefined;
  }

  /** Log intel: `count` enemies seen in `zone` (0 = clear). Returns a refusal to show, if any. */
  async logIntel(zone: string, count: number): Promise<string | undefined> {
    const block = this.intelBlock();
    if (block) return block;
    try {
      if (this.view.role === 'demo') {
        const r = this.demo?.addIntel?.(zone, count, 'rdx');
        return !r ? 'The demo is not running.' : r.ok ? undefined : r.error ?? 'Not logged.';
      }
      if (this.view.role === 'member') {
        if (!this.client) return 'Not connected to the host.';
        const r = await this.client.logIntel(zone, count);
        return r.ok ? undefined : r.error ?? 'The host refused the intel.';
      }
      if ((this.view.role === 'solo' || this.view.role === 'host') && this.bridge?.logIntel) {
        const r = await this.bridge.logIntel(zone, count);
        return r.ok ? undefined : r.error ?? 'Not logged.';
      }
      return 'Intel needs the csbot desktop app or a room.';
    } catch (e) {
      return String((e as Error)?.message ?? e);
    }
  }

  /** Why a squad check-in can't be sent right now (undefined = it can). */
  checkInBlock(): string | undefined {
    const v = this.view, live = v.screen?.live, room = v.screen?.room;
    if (v.role === 'solo') return 'Check-ins are for rooms: create one so your squad sees your spot.';
    if (v.role !== 'demo' && v.role !== 'host' && v.role !== 'member') return 'Join a room to check in.';
    if (v.role === 'member' && v.link?.status !== 'approved') return 'Not connected to the host.';
    if (room?.tournament) return 'Tournament mode is on: no planned spots.';
    const me = room?.members.find(m => m.id === room.you);
    if (!me?.slot) return 'Take a slot in the room first: your marker is your slot.';
    const phase = live?.match?.clock.phase;
    if (phase !== 'freezetime' && phase !== 'live' && phase !== 'bomb') return 'Check-ins are for the round in progress.';
    return undefined;
  }

  /** Squad check-in: on my spot, or rotating to a site. Returns a refusal to show, if any. */
  async checkIn(state: 'spot' | 'rotate', site?: 'A' | 'B'): Promise<string | undefined> {
    const block = this.checkInBlock();
    if (block) return block;
    const room = this.view.screen?.room;
    const slot = room?.members.find(m => m.id === room.you)?.slot;
    if (this.view.role === 'demo') {
      const r = slot ? this.demo?.checkIn?.(slot, state, site) : undefined;
      return !r ? 'The demo is not running.' : r.ok ? undefined : r.error ?? 'Not sent.';
    }
    if (this.view.role === 'member') return this.client?.checkIn(state, site) ? undefined : 'Not connected to the host.';
    if (this.view.role === 'host' && this.host) {
      const r = this.host.checkIn(HOST_ID, state, site);
      return r.ok ? undefined : r.error;
    }
    return 'Join a room to check in.';
  }

  /** The desktop app runs the game connection (solo or hosting): host-only settings apply. */
  get isHostSide(): boolean {
    return !!this.bridge && (this.view.role === 'solo' || this.view.role === 'host');
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
    const host = new RoomHost({
      transport, room, hostName, onSave: r => write(localStorage, LS.hostRoom, r), clientId: clientId(),
      // A member took over while this PC was away: rejoin the same room as a member.
      onSuperseded: () => {
        write(localStorage, LS.hostRoom, undefined);
        const link = this.inviteFor(room, this.pageSignal);
        write(localStorage, LS.memberRoom, link);
        this.startMember(link, this.lastLive?.me?.name || hostName, 'desktop');
        this.set({ notice: 'Another member took over hosting while your csbot was away. You rejoined as a member.' });
      },
      // Members' questions go to this PC's coach with who asked (it applies their quota).
      onAsk: (from, text) => (b.askCoach ? b.askCoach(text, from) : Promise.resolve({ ok: false, error: "The host's coach isn't available." })),
      // Members' intel goes into this PC's tracker with who saw it.
      onIntel: (from, zone, count) => (b.logIntel ? b.logIntel(zone, count, from) : Promise.resolve({ ok: false, error: "The host can't take intel right now." })),
    });
    this.host = host;
    // Scouting and the coach go to every member on each update (and to joiners on approval).
    this.watchOwnScout(s => host.setScout(s));
    this.watchOwnDebrief(d => host.setDebrief(d));
    this.watchOwnCoach(c => host.setCoach(c));
    this.stops.push(b.onSnapshot(live => { this.lastLive = live; host.setLive(live); }));
    // Tell the host process who's in the room, so scouting labels members vs randoms.
    // And the slots (plus tournament mode), so the coach names players in calls and stops in tournaments.
    let roster = '', slots = '';
    this.stops.push(host.subscribe(screen => {
      const names = (screen.room?.members ?? []).filter(m => m.role !== 'admin').map(m => m.name);
      const key = JSON.stringify(names);
      if (key !== roster) { roster = key; b.setRoomRoster?.(names.map(name => ({ name }))); }
      // Gather mode: the match's randoms (from scouting) take the slots nobody in the room plays.
      const members = screen.room?.members ?? [];
      const scouted = this.view.scout?.status === 'ready' ? this.view.scout.us.players.filter(p => p.room === 'random') : [];
      const randoms = gatherSlots(screen.room?.slots ?? [], new Set(members.filter(m => m.slot).map(m => m.slot!)), scouted.map(p => ({ name: p.nickname, ...(p.role ? { role: p.role.label } : {}) })));
      host.setRandoms(randoms);
      const withSlots = [
        ...members.map(m => ({ name: m.name, ...(m.slot ? { slot: m.slot } : {}), random: false })),
        ...randoms.map(r => ({ name: r.name, slot: r.slot, random: true })),
      ];
      const tournament = !!screen.room?.tournament;
      const sKey = JSON.stringify([withSlots, tournament]);
      if (sKey !== slots) { slots = sKey; b.setRoomSlots?.(withSlots, { tournament }); }
      this.set({ screen, receivedAt: Date.now(), rate: 1 });
    }));
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

  /**
   * A desktop member can take over hosting when the host has been offline a while (and the admin
   * allows it): the room keeps its code, key and members, and the economy read continues from this
   * PC's own game data.
   */
  canTakeOver(now = Date.now()): boolean {
    const v = this.view, room = v.screen?.room;
    return v.role === 'member' && v.device === 'desktop' && !!this.bridge && v.link?.status === 'host-offline'
      && now - v.link.since >= 10_000 && !!room && room.permissions.handover !== false && !!this.memberLink && !!parseInvite(this.memberLink);
  }

  takeOver(): string | undefined {
    if (!this.canTakeOver()) return 'Taking over needs the desktop app, an offline host for 10 s, and the admin allowing handover.';
    const room = this.view.screen!.room!;
    const inv = parseInvite(this.memberLink!)!;
    const saved = takeoverRoom(room, inv.key);
    const name = this.lastLive?.me?.name || room.members.find(m => m.id === room.you)?.name || rememberedName() || 'Host';
    write(localStorage, LS.memberRoom, undefined);
    write(localStorage, LS.hostRoom, saved);
    write(localStorage, LS.hostName, name);
    this.startHost(saved, name);
    this.set({ notice: `You're hosting room ${room.code} now. Members rejoin by themselves.` });
    return undefined;
  }

  dismissNotice(): void { this.set({ notice: undefined }); }

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
    this.demo = undefined;
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
