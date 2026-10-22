import { MatchTracker } from '@csbot/engine';
import { FIRST_HALF, syntheticMatch, toGameState, type GsiPayload } from '@csbot/gsi';
import { EMPTY_COACH, EMPTY_SCOUT, type LiveSnapshot } from '@csbot/protocol';
import { describe, expect, it } from 'vitest';
import {
  formatCode, HOST_ID, inviteUrl, isRoomCode, isRoomKey, MemoryNetwork, newRoomCode, newRoomKey, newSavedRoom, parseInvite,
  RoomClient, RoomHost, ROOM_TTL_MS, roomExpiresAt, takeoverRoom, type ClientState, type SavedRoom,
} from '../src/index.ts';

const CODE = 'K7P2QX', KEY = 'abcdefghijklmnopqrstuv12';

/** Host-side live snapshot at round 2 freeze time on Mirage CT (anti-eco call). */
function hostLiveAtFreeze2(): LiveSnapshot {
  const t = new MatchTracker();
  const rec = syntheticMatch({ rounds: FIRST_HALF });
  let snap: LiveSnapshot | undefined;
  for (const { t: at, p } of rec) {
    t.ingest(toGameState(p, at));
    const s = t.snapshot(at);
    if (s.match?.round === 2 && s.match.clock.phase === 'freezetime') { snap = s; break; }
  }
  return snap!;
}

/** A member's own GSI: same match, their own Steam ID and name. */
function memberPayloads(steamid: string, name: string): GsiPayload[] {
  return syntheticMatch({ rounds: FIRST_HALF.slice(0, 2), me: steamid, name }).map(r => r.p);
}

async function setup(o: { saved?: SavedRoom; maxMembers?: number } = {}) {
  const net = new MemoryNetwork();
  let saved = o.saved ?? newSavedRoom(CODE, KEY, 1000);
  const host = new RoomHost({ transport: net.transport({ code: CODE, key: KEY, role: 'host' }), room: saved, hostName: 'Host', throttleMs: 0, onSave: r => { saved = r; }, ...(o.maxMembers ? { maxMembers: o.maxMembers } : {}) });
  const join = (clientId: string, name: string, device: 'web' | 'desktop' = 'web', key = KEY) => {
    const client = new RoomClient({ transport: net.transport({ code: CODE, key, role: 'member' }), clientId, name, device, gsiMinGapMs: 0 });
    const states: ClientState[] = [];
    client.subscribe(s => states.push(s));
    return { client, states, last: () => states[states.length - 1]! };
  };
  const flush = async () => { for (let i = 0; i < 6; i++) { await net.settle(); await new Promise(r => setTimeout(r, 1)); } };
  return { net, host, join, flush, saved: () => saved };
}

describe('invite codes', () => {
  it('makes valid codes and keys', () => {
    for (let i = 0; i < 50; i++) { expect(isRoomCode(newRoomCode())).toBe(true); expect(isRoomKey(newRoomKey())).toBe(true); }
    expect(formatCode('K7P2QX')).toBe('K7P-2QX');
  });
  it('round-trips an invite link and tolerates how people paste it', () => {
    const url = inviteUrl('https://grovic.github.io/csbot', { code: CODE, key: KEY });
    expect(url).toBe(`https://grovic.github.io/csbot/#/r/${CODE}?k=${KEY}`);
    expect(parseInvite(url)).toEqual({ code: CODE, key: KEY });
    expect(parseInvite(`  #/r/k7p-2qx?k=${KEY} `)).toEqual({ code: CODE, key: KEY });
    expect(parseInvite(`/r/${CODE}?k=${KEY}`)).toEqual({ code: CODE, key: KEY });
    expect(parseInvite(`#/r/${CODE}`)).toBeUndefined();
    expect(parseInvite(`#/r/${CODE}?k=short`)).toBeUndefined();
    expect(parseInvite('#/live')).toBeUndefined();
  });
});

describe('joining a room', () => {
  it('waits for the admin, then shows the room with a personal YOU line', async () => {
    const { host, join, flush, saved } = await setup();
    host.setLive(hostLiveAtFreeze2());
    const kairo = join('client-kairo', 'kairo');
    await flush();
    expect(kairo.last().status).toBe('pending');
    expect(host.screen().room!.pending.map(p => p.name)).toEqual(['kairo']);

    host.approve('client-kairo');
    await flush();
    const s = kairo.last();
    expect(s.status).toBe('approved');
    const room = s.screen!.room!;
    expect(room.you).toBe('client-kairo');
    expect(room.pending).toEqual([]); // members never see the queue
    expect(room.members.map(m => m.name)).toEqual(['rdx', 'kairo']);
    expect(room.hostName).toBe('rdx'); // from the host's own GSI
    const live = s.screen!.live;
    const slot = room.members.find(m => m.id === 'client-kairo')!.slot!;
    expect(live.youHandle).toBe(slot);
    expect(live.call!.head).toBe('Anti-eco · stack B');
    expect(live.call!.you).toBe(live.call!.jobs[slot]);
    expect(live.me).toBeUndefined(); // a web member's own money isn't known
    expect(saved().approved.map(m => m.id)).toEqual(['client-kairo']);
  });

  it('tells a declined member', async () => {
    const { host, join, flush } = await setup();
    const x = join('client-x', 'stranger');
    await flush();
    host.deny('client-x');
    await flush();
    expect(x.last().status).toBe('denied');
    expect(host.screen().room!.pending).toEqual([]);
  });

  it('refuses a link with the wrong key before anything is exchanged', async () => {
    const { host, join, flush } = await setup();
    const x = join('client-x', 'x', 'web', 'wrong-key-wrong-key-wrong');
    await flush();
    // Never reaches the host; the client keeps trying and shows a hint, not a verdict.
    expect(x.last().status).toBe('connecting');
    expect(x.last().hint).toBe('key-mismatch');
    expect(host.screen().room!.pending).toEqual([]);
  });

  it('turns people away when the room is full', async () => {
    const { host, join, flush } = await setup({ maxMembers: 1 });
    join('client-a', 'a'); await flush(); host.approve('client-a'); await flush();
    const b = join('client-b', 'b');
    await flush();
    expect(b.last().status).toBe('denied');
    expect(b.last().detail).toMatch(/full/);
  });
});

describe('staying connected', () => {
  it('lets an approved member back in without asking again', async () => {
    const { host, join, flush } = await setup();
    const k1 = join('client-kairo', 'kairo'); await flush(); host.approve('client-kairo'); await flush();
    k1.client.leave(); await flush();
    expect(host.screen().room!.members.find(m => m.id === 'client-kairo')!.online).toBe(false);
    const k2 = join('client-kairo', 'kairo');
    await flush();
    expect(k2.last().status).toBe('approved');
    expect(host.screen().room!.pending).toEqual([]);
  });

  it('keeps the last screen while the host is offline and reconnects when it is back', async () => {
    const { net, host, join, flush, saved } = await setup();
    host.setLive(hostLiveAtFreeze2());
    const k = join('client-kairo', 'kairo'); await flush(); host.approve('client-kairo'); await flush();
    host.end(); // the admin's app closes (end() also tells members; simulate a crash instead below)
    await new Promise(r => setTimeout(r, 250)); await flush();
    expect(k.last().status).toBe('ended');

    // Crash case: a new host instance with the saved room, the member's transport still there.
    const k2 = join('client-kairo2', 'kairo-phone'); await flush();
    expect(k2.last().status).toBe('connecting'); // no host yet
    const host2 = new RoomHost({ transport: net.transport({ code: CODE, key: KEY, role: 'host' }), room: saved(), hostName: 'rdx', throttleMs: 0 });
    await flush();
    expect(k2.last().status).toBe('pending');
    expect(host2.screen().room!.members.map(m => m.id)).toContain('client-kairo'); // remembered
  });

  it('marks the host offline when its connection drops, keeping the last screen', async () => {
    const { net, host, join, flush, saved } = await setup();
    host.setLive(hostLiveAtFreeze2());
    const k = join('client-kairo', 'kairo'); await flush(); host.approve('client-kairo'); await flush();
    expect(k.last().screen!.live.call!.head).toBe('Anti-eco · stack B');
    // The host's connection drops without ending the room (crash, network loss).
    const nodes = (net as unknown as { nodes: Set<{ role: string; t: { leave(): void } }> }).nodes;
    for (const n of [...nodes]) if (n.role === 'host') n.t.leave();
    await flush();
    expect(k.last().status).toBe('host-offline');
    expect(k.last().screen!.live.call!.head).toBe('Anti-eco · stack B');
    expect(k.last().screen!.link!.status).toBe('host-offline');
    // The host comes back with its saved room: the member is let straight back in.
    const host2 = new RoomHost({ transport: net.transport({ code: CODE, key: KEY, role: 'host' }), room: saved(), hostName: 'rdx', throttleMs: 0 });
    host2.setLive(hostLiveAtFreeze2());
    await flush();
    expect(k.last().status).toBe('approved');
    expect(host2.screen().room!.members.find(m => m.id === 'client-kairo')!.online).toBe(true);
  });

  it('moves a member to their newest tab', async () => {
    const { host, join, flush } = await setup();
    const a = join('client-kairo', 'kairo'); await flush(); host.approve('client-kairo'); await flush();
    const b = join('client-kairo', 'kairo');
    await flush();
    expect(b.last().status).toBe('approved');
    expect(a.last().status).toBe('removed');
  });
});

describe('slots and permissions', () => {
  it('keeps one player per slot', async () => {
    const { host, join, flush } = await setup();
    host.setLive(hostLiveAtFreeze2());
    join('client-kairo', 'kairo'); await flush(); host.approve('client-kairo'); await flush();
    host.setSlot(HOST_ID, 'a');
    host.setSlot('client-kairo', 'a');
    await flush();
    const room = host.screen().room!;
    expect(room.members.find(m => m.id === 'client-kairo')!.slot).toBe('a');
    expect(room.members.find(m => m.id === HOST_ID)!.slot).toBeUndefined();
    host.setSlot('client-kairo', 'not-a-slot');
    expect(host.screen().room!.members.find(m => m.id === 'client-kairo')!.slot).toBe('a');
  });

  it('lets members pick their own slot only when allowed', async () => {
    const { host, join, flush } = await setup();
    host.setLive(hostLiveAtFreeze2());
    const k = join('client-kairo', 'kairo'); await flush(); host.approve('client-kairo'); await flush();
    k.client.setSlot('awp'); await flush();
    expect(k.last().screen!.room!.members.find(m => m.id === 'client-kairo')!.slot).toBe('awp');
    host.setPermissions({ editSlot: false });
    k.client.setSlot('b'); await flush();
    expect(k.last().screen!.room!.members.find(m => m.id === 'client-kairo')!.slot).toBe('awp');
    expect(k.last().screen!.room!.permissions.editSlot).toBe(false);
  });

  it('turns live coaching off for everyone in tournament mode', async () => {
    const { host, join, flush } = await setup();
    host.setLive(hostLiveAtFreeze2());
    const k = join('client-kairo', 'kairo'); await flush(); host.approve('client-kairo'); await flush();
    host.setTournament(true); await flush();
    for (const live of [k.last().screen!.live, host.screen().live]) {
      expect(live.call).toBeUndefined();
      expect(live.forecast).toBeUndefined();
      expect(live.enemy).toBeDefined(); // the economy estimate stays
    }
  });
});

describe('sharing GSI from a desktop member', () => {
  it('gives the member their own money tile and a live scoreboard row', async () => {
    const { host, join, flush } = await setup();
    host.setLive(hostLiveAtFreeze2());
    const k = join('client-kairo', 'kairo', 'desktop'); await flush(); host.approve('client-kairo'); await flush();
    for (const p of memberPayloads('76561198000000002', 'kairo')) k.client.sendGsi(p as Record<string, unknown>);
    await flush();
    const live = k.last().screen!.live;
    expect(live.me!.name).toBe('kairo');
    expect(live.youTile).toBeDefined();
    const rows = live.scoreboard;
    expect(rows.find(r => r.name === 'kairo')).toMatchObject({ source: 'room', isMe: true });
    expect(rows.find(r => r.name === 'rdx')).toMatchObject({ source: 'host', isMe: false });
    expect(host.screen().live.scoreboard.find(r => r.name === 'rdx')!.isMe).toBe(true);
    expect(host.screen().room!.members.find(m => m.id === 'client-kairo')!.sharesGsi).toBe(true);
  });

  it('drops spectator-only data from members (room-wide guard)', async () => {
    const { host, join, flush } = await setup();
    host.setLive(hostLiveAtFreeze2());
    const k = join('client-kairo', 'kairo', 'desktop'); await flush(); host.approve('client-kairo'); await flush();
    const p = { ...memberPayloads('76561198000000002', 'kairo')[0]!, allplayers: { x: {} }, bomb: { state: 'carried' } };
    k.client.sendGsi(p as Record<string, unknown>);
    await flush();
    expect(host.guardDropped).toBe(2);
  });

  it('ignores GSI from web members', async () => {
    const { host, join, flush } = await setup();
    const w = join('client-web', 'web', 'web'); await flush(); host.approve('client-web'); await flush();
    w.client.sendGsi(memberPayloads('76561198000000009', 'web')[0] as Record<string, unknown>);
    await flush();
    expect(host.screen().room!.members.find(m => m.id === 'client-web')!.sharesGsi).toBe(false);
  });
});

describe('scouting in a room', () => {
  it('sends scouting to members on approval and on every change', async () => {
    const { host, join, flush } = await setup();
    host.setLive(hostLiveAtFreeze2());
    const scout = { ...EMPTY_SCOUT, status: 'ready' as const, platform: 'sample' as const, facts: ['Holo is their AWP'] };
    host.setScout(scout);
    const k = join('client-kairo', 'kairo'); await flush(); host.approve('client-kairo'); await flush();
    expect(k.last().screen!.scout!.facts).toEqual(['Holo is their AWP']);
    host.setScout({ ...scout, facts: ['Holo is their AWP', 'They ban Nuke'] });
    host.setLive({ ...hostLiveAtFreeze2(), seq: 999 });
    await flush();
    expect(k.last().screen!.scout!.facts).toHaveLength(2); // survives later state messages
    expect(host.screen().scout!.facts).toHaveLength(2);
  });

  it("the team plan reaches members (sanitized), joiners included, and survives state updates", async () => {
    const { host, join, flush } = await setup();
    host.setLive(hostLiveAtFreeze2());
    const team = { playbooks: {}, antistrats: [{ id: 'holo', name: 'Team Holo', updatedAt: 1, maps: { de_mirage: { tWeights: { bRush: 4 }, notes: 'Rush B on buys' } } }], active: 'holo' };
    host.setTeam(team);
    const k = join('client-kairo', 'kairo'); await flush(); host.approve('client-kairo'); await flush();
    expect(k.last().screen!.team).toEqual(team);
    host.setTeam({ ...team, active: 'nope' } as typeof team);
    host.setLive({ ...hostLiveAtFreeze2(), seq: 999 });
    await flush();
    expect(k.last().screen!.team!.active).toBeUndefined(); // an unknown anti-strat id is dropped
    expect(k.last().screen!.team!.antistrats[0]!.name).toBe('Team Holo');
    expect(host.screen().team!.antistrats).toHaveLength(1);
  });
});

describe('asking the coach from a room', () => {
  it('passes questions on with the asker, and respects the ask permission', async () => {
    const net = new MemoryNetwork();
    const asked: string[] = [];
    const host = new RoomHost({
      transport: net.transport({ code: CODE, key: KEY, role: 'host' }), room: newSavedRoom(CODE, KEY), hostName: 'rdx', throttleMs: 0,
      onAsk: async (from, text) => { asked.push(`${from.name}:${from.role}:${text}`); return text.includes('quota') ? { ok: false, error: 'No questions left.' } : { ok: true }; },
    });
    const client = new RoomClient({ transport: net.transport({ code: CODE, key: KEY, role: 'member' }), clientId: 'client-kairo', name: 'kairo', device: 'web' });
    const flush = async () => { for (let i = 0; i < 6; i++) { await net.settle(); await new Promise(r => setTimeout(r, 1)); } };
    await flush(); host.approve('client-kairo'); await flush();
    host.setCoach({ ...EMPTY_COACH, messages: [{ id: 'm1', at: 1, kind: 'system', text: 'Coach ready' }] });
    await flush();
    expect(client.current.screen!.coach!.messages[0]!.text).toBe('Coach ready');
    expect(await client.ask('Where do they hit on ecos?')).toEqual({ ok: true });
    expect(await client.ask('over quota?')).toEqual({ ok: false, error: 'No questions left.' });
    host.setPermissions({ ask: false });
    await flush();
    expect((await client.ask('still there?')).error).toMatch(/turned off questions/);
    expect(asked).toEqual(['kairo:member:Where do they hit on ecos?', 'kairo:member:over quota?']);
  });
});

describe('intel from a room', () => {
  it('passes intel on with the member name, and respects the intel permission and tournament mode', async () => {
    const net = new MemoryNetwork();
    const got: string[] = [];
    const host = new RoomHost({
      transport: net.transport({ code: CODE, key: KEY, role: 'host' }), room: newSavedRoom(CODE, KEY), hostName: 'rdx', throttleMs: 0,
      onIntel: async (from, zone, count) => { got.push(`${from.name}:${zone}:${count}`); return zone === 'nowhere' ? { ok: false, error: 'Unknown zone' } : { ok: true }; },
    });
    const client = new RoomClient({ transport: net.transport({ code: CODE, key: KEY, role: 'member' }), clientId: 'client-kairo', name: 'kairo', device: 'web' });
    const flush = async () => { for (let i = 0; i < 6; i++) { await net.settle(); await new Promise(r => setTimeout(r, 1)); } };
    await flush(); host.approve('client-kairo'); await flush();
    expect(await client.logIntel('bapps', 3)).toEqual({ ok: true });
    expect(await client.logIntel('nowhere', 1)).toEqual({ ok: false, error: 'Unknown zone' });
    host.setTournament(true); await flush();
    expect((await client.logIntel('bapps', 1)).error).toMatch(/Tournament/);
    host.setTournament(false); host.setPermissions({ intel: false }); await flush();
    expect((await client.logIntel('bapps', 1)).error).toMatch(/turned off intel/);
    expect(got).toEqual(['kairo:bapps:3', 'kairo:nowhere:1']);
  });
});

/** Host-side live snapshots for the whole first rounds of the match (Mirage CT). */
function hostLives(): LiveSnapshot[] {
  const t = new MatchTracker();
  return syntheticMatch({ rounds: FIRST_HALF.slice(0, 3) }).map(({ t: at, p }) => { t.ingest(toGameState(p, at)); return t.snapshot(at); });
}

describe('squad markers', () => {
  it('shows planned spots, check-ins and rotations for everyone, and resets each round', async () => {
    const { host, join, flush } = await setup();
    const lives = hostLives();
    const freeze2 = lives.find(s => s.match?.round === 2 && s.match.clock.phase === 'freezetime')!;
    host.setLive(freeze2);
    const kairo = join('client-kairo', 'kairo');
    await flush(); host.approve('client-kairo'); await flush();
    const slot = host.screen().room!.members.find(m => m.id === 'client-kairo')!.slot!;
    const squad = () => kairo.last().screen!.live.squad!;
    expect(squad()).toHaveLength(5);
    const mine = () => squad().find(m => m.slot === slot)!;
    expect(mine()).toMatchObject({ name: 'kairo', state: 'planned' });
    // Slots nobody in the room plays are open (gather mode: randoms).
    expect(squad().filter(m => m.open).length).toBe(4);

    expect(kairo.client.checkIn('spot')).toBe(true);
    await flush();
    expect(mine()).toMatchObject({ state: 'spot' });

    kairo.client.checkIn('rotate', 'A');
    await flush();
    const rot = mine();
    expect(rot.state).toBe('rotating');
    expect(rot.to).toBe('A');
    expect(rot.route!.length).toBeGreaterThan(1);
    expect(rot.route![rot.route!.length - 1]![2]).toBeGreaterThan(0);
    // The admin sees the same markers.
    expect(host.screen().live.squad!.find(m => m.slot === slot)!.state).toBe('rotating');

    // A new round: back to the plan.
    host.setLive(lives.find(s => s.match?.round === 3 && s.match.clock.phase === 'freezetime')!);
    await flush();
    expect(mine().state).toBe('planned');
  });

  it("refuses a check-in without a slot or outside a round, and hides markers in tournament mode", async () => {
    const { host, flush } = await setup();
    const lives = hostLives();
    host.setLive(lives.find(s => s.match?.round === 2 && s.match.clock.phase === 'freezetime')!);
    expect(host.checkIn(HOST_ID, 'spot').error).toMatch(/Take a slot/);
    host.setSlot(HOST_ID, 'a');
    expect(host.checkIn(HOST_ID, 'rotate').error).toMatch(/which site/);
    expect(host.checkIn(HOST_ID, 'spot')).toEqual({ ok: true });
    await flush();
    expect(host.screen().live.squad!.find(m => m.slot === 'a')).toMatchObject({ state: 'spot', name: 'rdx' });
    host.setTournament(true);
    await flush();
    expect(host.screen().live.squad).toBeUndefined();
    host.setLive(lives.find(s => s.match?.clock.phase === 'over')!);
    expect(host.checkIn(HOST_ID, 'spot').error).toMatch(/round in progress/);
  });

  it('turns a member into a cross when their own GSI says they died', async () => {
    const { host, join, flush } = await setup();
    const lives = hostLives();
    const k = join('client-kairo', 'kairo', 'desktop');
    await flush(); host.approve('client-kairo'); await flush();
    const slot = host.screen().room!.members.find(m => m.id === 'client-kairo')!.slot!;
    // kairo's own game: alive at round 2 live, then dead.
    const mine = syntheticMatch({ rounds: FIRST_HALF.slice(0, 2), me: '76561198000000202', name: 'kairo' }).map(r => r.p);
    const live2 = lives.find(s => s.match?.round === 2 && s.match.clock.phase === 'live')!;
    host.setLive(live2);
    const p = mine.find(x => x.map?.round === 1 && x.round?.phase === 'live')!;
    k.client.sendGsi({ ...p, player: { ...p.player!, state: { ...p.player!.state!, health: 0 } } });
    await flush();
    expect(host.screen().live.squad!.find(m => m.slot === slot)!.state).toBe('dead');
  });
});

describe('host handover', () => {
  it('a desktop member takes over when the host drops; everyone follows; the old host steps down on return', async () => {
    const net = new MemoryNetwork();
    const flush = async () => { for (let i = 0; i < 8; i++) { await net.settle(); await new Promise(r => setTimeout(r, 1)); } };
    const saved = newSavedRoom(CODE, KEY, 1000);
    const hostA = new RoomHost({ transport: net.transport({ code: CODE, key: KEY, role: 'host' }), room: saved, hostName: 'rdx', clientId: 'dev-rdx', throttleMs: 0 });
    hostA.setLive(hostLiveAtFreeze2());
    const join = (id: string, name: string, device: 'web' | 'desktop') => {
      const client = new RoomClient({ transport: net.transport({ code: CODE, key: KEY, role: 'member' }), clientId: id, name, device });
      const states: ClientState[] = [];
      client.subscribe(st => states.push(st));
      return { client, last: () => states[states.length - 1]! };
    };
    const kairo = join('client-kairo', 'kairo', 'desktop'), nyx = join('client-nyx', 'nyx', 'web');
    await flush(); hostA.approve('client-kairo'); hostA.approve('client-nyx'); await flush();
    expect(nyx.last().screen!.room!.epoch).toBe(0);
    expect(nyx.last().screen!.room!.hostClientId).toBe('dev-rdx');
    const savedA = hostA.savedRoom;

    // rdx's PC drops: members keep the last screen, the host shows offline.
    (hostA as unknown as { o: { transport: { leave(): void } } }).o.transport.leave();
    await flush();
    expect(nyx.last().status).toBe('host-offline');
    expect(nyx.last().screen!.live.call).toBeDefined();

    // kairo takes over from his last room view: same code and key, one epoch up.
    const view = kairo.last().screen!.room!;
    const takeover = takeoverRoom(view, KEY, 5000);
    expect(takeover.epoch).toBe(1);
    expect(takeover.approved.map(m => m.id).sort()).toEqual(['client-nyx', 'dev-rdx']);
    kairo.client.leave();
    const hostB = new RoomHost({ transport: net.transport({ code: CODE, key: KEY, role: 'host' }), room: takeover, hostName: 'kairo', clientId: 'client-kairo', throttleMs: 0 });
    hostB.setLive(hostLiveAtFreeze2());
    await flush();
    // nyx follows the new host without asking again.
    expect(nyx.last().status).toBe('approved');
    expect(nyx.last().screen!.room!.epoch).toBe(1);
    expect(nyx.last().screen!.room!.hostName).toBe('rdx'); // the host's in-game name from the snapshot

    // rdx's csbot comes back with the old room (epoch 0): nyx tells it, and it steps down.
    let superseded: number | undefined;
    const hostA2 = new RoomHost({ transport: net.transport({ code: CODE, key: KEY, role: 'host' }), room: savedA, hostName: 'rdx', clientId: 'dev-rdx', throttleMs: 0, onSuperseded: e => { superseded = e; } });
    hostA2.setLive(hostLiveAtFreeze2());
    await flush();
    expect(superseded).toBe(1);
    expect(nyx.last().screen!.room!.epoch).toBe(1);
    // rdx rejoins as a member under his device id: already approved by the new host.
    const rdx = join('dev-rdx', 'rdx', 'desktop');
    await flush();
    expect(rdx.last().status).toBe('approved');
    expect(rdx.last().screen!.room!.epoch).toBe(1);
  });

  it('rooms expire a day after their last use', () => {
    const r = newSavedRoom(CODE, KEY, 1000);
    expect(roomExpiresAt(r)).toBe(1000 + ROOM_TTL_MS);
    expect(roomExpiresAt({ ...r, lastActiveAt: 50_000 })).toBe(50_000 + ROOM_TTL_MS);
  });
});

describe('robustness', () => {
  it('ignores malformed messages and rate-limits floods', async () => {
    const { net, host, join, flush } = await setup();
    const k = join('client-kairo', 'kairo'); await flush(); host.approve('client-kairo'); await flush();
    const raw = net.transport({ code: CODE, key: KEY, role: 'member' });
    await flush();
    for (const junk of [null, 42, 'x', { t: 'hello' }, { t: 'gsi', payload: 'nope' }, { t: 'slot', slot: 5 }, { t: 'rename', name: '' }]) raw.send(junk);
    await flush();
    expect(host.screen().room!.pending).toEqual([]);
    // 100 renames in one burst from an approved member: at most the rate limit gets through.
    let renames = 0;
    host.subscribe(s => { if (s.room!.members.some(m => m.name.startsWith('spam'))) renames++; });
    for (let i = 0; i < 100; i++) k.client.rename(`spam${i}`);
    await flush();
    const name = host.screen().room!.members.find(m => m.id === 'client-kairo')!.name;
    expect(Number(name.slice(4))).toBeLessThan(30);
    expect(renames).toBeGreaterThan(0);
  });
});

describe('gather mode', () => {
  it('gives randoms the slots nobody in the room plays, by their usual role', async () => {
    const { gatherSlots } = await import('../src/index.ts');
    const slots = [{ id: 'a', label: 'A' }, { id: 'short', label: 'Short' }, { id: 'b', label: 'B' }, { id: 'rotator', label: 'Rot' }, { id: 'awp', label: 'AWP' }];
    expect(gatherSlots(slots, new Set(['a', 'b']), [{ name: 'r1' }, { name: 'sniper', role: 'AWP' }, { name: 'r3' }]))
      .toEqual([{ slot: 'awp', name: 'sniper' }, { slot: 'short', name: 'r1' }, { slot: 'rotator', name: 'r3' }]);
    // No AWP random: the AWP slot is filled last.
    expect(gatherSlots(slots, new Set(['a']), [{ name: 'x' }, { name: 'y' }]).map(r => r.slot)).toEqual(['short', 'b']);
    expect(gatherSlots(slots, new Set(['a', 'short', 'b', 'rotator', 'awp']), [{ name: 'x' }])).toEqual([]);
  });

  it('names randoms on the map and in the room view', async () => {
    const { host, flush } = await setup();
    host.setLive(hostLiveAtFreeze2());
    host.setSlot(HOST_ID, 'a');
    host.setRandoms([{ slot: 'awp', name: 'sniper' }]);
    await flush();
    const s = host.screen();
    expect(s.room!.randoms).toEqual([{ slot: 'awp', name: 'sniper' }]);
    expect(s.live.squad!.find(m => m.slot === 'awp')).toMatchObject({ name: 'sniper', open: true, state: 'planned' });
    expect(s.live.squad!.find(m => m.slot === 'a')).toMatchObject({ name: 'rdx' });
  });
});
