import { describe, expect, it } from 'vitest';
import { fetchPremier, parseStatus, premierMatchId, premierSides, premierView, sampleFaceit, sampleSteam, sampleSteamId, steamIdOf } from '../src/index.ts';

const BASE = 76561197960265728n;
const id3 = (nick: string) => `[U:1:${BigInt(sampleSteamId(nick)!) - BASE}]`;
const NICKS = ['Holo', 'sk1p', 'vex', 'Drift', 'Okami', 'kairo', 'zeph', 'rdx', 'nyx', 'mbt'];

// Fictional players and IDs, in the forms status output has used.
const CS2_STYLE = [
  'hostname: Valve Counter-Strike 2 eu_west Server', 'map     : de_mirage', '---------players--------',
  '  id     time ping loss      state   rate adr name',
  ...NICKS.map((n, i) => `  ${i + 2}    12:0${i}   23    0     active 786432 ${id3(n)} '${n}'`),
  "  12    12:00    0    0     active      0 BOT 'Bot Ringo'", '#end',
].join('\n');
const CSGO_STYLE = [
  '# userid name uniqueid connected ping loss state rate',
  `# 2 1 "vex 'the' one" STEAM_1:1:50000001 05:12 45 0 active 196608`,
  '# 3 2 "sk1p" STEAM_1:0:50000002 05:12 45 0 active 196608',
  '# 3 2 "sk1p" STEAM_1:0:50000002 05:12 45 0 active 196608',
].join('\n');

describe('players from a pasted status', () => {
  it('reads SteamID3, SteamID2 and 64-bit IDs', () => {
    expect(steamIdOf('[U:1:1]')).toBe('76561197960265729');
    expect(steamIdOf('STEAM_1:1:0')).toBe('76561197960265729');
    expect(steamIdOf('x 76561198000000007 y')).toBe('76561198000000007');
    expect(steamIdOf('no id here')).toBeUndefined();
  });

  it('lists the players with their names, skipping bots and repeats, and the map', () => {
    const r = parseStatus(CS2_STYLE);
    expect(r.map).toBe('de_mirage');
    expect(r.players.map(p => p.name)).toEqual(NICKS);
    expect(r.players[0]!.steamid).toBe(sampleSteamId('Holo'));
    expect(parseStatus(CSGO_STYLE).players).toEqual([
      { steamid: String(BASE + 100000003n), name: "vex 'the' one" },
      { steamid: String(BASE + 100000004n), name: 'sk1p' },
    ]);
    expect(parseStatus('hello').players).toEqual([]);
  });

  it('gives the same lobby the same id', () => {
    const a = parseStatus(CS2_STYLE).players;
    expect(premierMatchId(a)).toBe(premierMatchId([...a].reverse()));
    expect(premierMatchId(a)).not.toBe(premierMatchId(a.slice(1)));
  });
});

describe('Premier scouting', () => {
  const roster = parseStatus(CS2_STYLE);

  it("each player's FACEIT account by Steam ID and their Steam profile", async () => {
    const d = await fetchPremier({ faceit: sampleFaceit(), steam: sampleSteam() }, roster.players, roster.map);
    expect(d.sources).toEqual({ faceit: 'live', steam: 'live' });
    const holo = d.players.find(p => p.status.name === 'Holo')!;
    expect(holo.faceit?.nickname).toBe('Holo');
    expect(holo.stats).toBeDefined();
    expect(holo.steam?.minutes).toBe(4120 * 60);
    // Someone without a FACEIT account is fine.
    const lone = await fetchPremier({ faceit: sampleFaceit() }, [{ steamid: '76561190000000000', name: 'stranger' }]);
    expect(lone.players[0]).toEqual({ status: { steamid: '76561190000000000', name: 'stranger' } });
    expect(lone.sources).toEqual({ faceit: 'live', steam: 'missing-key' });
  });

  it('sorts sides: known players are ours, the host marks the rest, five on a side fills the other', async () => {
    const d = await fetchPremier({}, roster.players);
    const ours = new Set([sampleSteamId('rdx')!, 'kairo']);
    let sides = premierSides(d.players, ours, {});
    expect([...sides.values()].filter(s => s === 'us')).toHaveLength(2);
    expect([...sides.values()].filter(s => s === undefined)).toHaveLength(8);
    sides = premierSides(d.players, ours, { [sampleSteamId('zeph')!]: 'us', [sampleSteamId('nyx')!]: 'us', [sampleSteamId('mbt')!]: 'us' });
    expect(d.players.map(p => sides.get(p.status.steamid))).toEqual(['them', 'them', 'them', 'them', 'them', 'us', 'us', 'us', 'us', 'us']);
    // Five marked as opponents works the same way.
    sides = premierSides(d.players, new Set(), Object.fromEntries(NICKS.slice(0, 5).map(n => [sampleSteamId(n)!, 'them' as const])));
    expect([...sides.values()].filter(s => s === 'us')).toHaveLength(5);
  });

  it('builds the Scout view: opponents by threat, unsorted players apart, no win chance until sorted', async () => {
    const d = await fetchPremier({ faceit: sampleFaceit(), steam: sampleSteam() }, roster.players, roster.map);
    const now = Date.UTC(2026, 9, 22);
    const partial = premierView(d, premierSides(d.players, new Set([sampleSteamId('rdx')!]), {}), { matchId: 'premier-x', claude: 'off', now, room: { kairo: 'member' } });
    expect(partial).toMatchObject({ platform: 'premier', map: 'de_mirage', status: 'ready' });
    expect(partial.us.players.map(p => p.nickname)).toEqual(['rdx']);
    expect(partial.us.players[0]!.room).toBe('random');
    expect(partial.unsorted).toHaveLength(9);
    expect(partial.winChance).toBeUndefined();
    const sorted = premierView(d, premierSides(d.players, new Set(['rdx', 'kairo', 'zeph', 'nyx', 'mbt']), {}), { matchId: 'premier-x', claude: 'off', now, room: { kairo: 'member' } });
    expect(sorted.unsorted).toBeUndefined();
    expect(sorted.them.players.map(p => p.nickname)[0]).toBe('Holo');
    expect(sorted.us.players.find(p => p.nickname === 'kairo')!.room).toBe('member');
    expect(sorted.winChance?.basis).toMatch(/^ELO /);
    expect(sorted.facts[0]).toMatch(/Holo/);
    // Without a FACEIT account the card says so (when FACEIT was asked).
    const lone = await fetchPremier({ faceit: sampleFaceit() }, [{ steamid: '76561190000000000', name: 'stranger' }, { steamid: sampleSteamId('rdx')!, name: 'rdx' }]);
    const v = premierView(lone, premierSides(lone.players, new Set([sampleSteamId('rdx')!]), {}), { matchId: 'p', claude: 'off', now: 0 });
    expect(v.unsorted![0]).toMatchObject({ nickname: 'stranger', flags: ['No FACEIT account'] });
  });
});
