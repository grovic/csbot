import { describe, expect, it } from 'vitest';
import {
  ANALYST_SCHEMA, analystInput, ApiError, faceitClient, MemoryStore, parseAnalyst, parseFaceitMatch, recentFromHistory, SAMPLE_MATCH_ID, sampleFaceit,
  sampleSteam, sampleSteamId, scoutFaceitMatch, steamClient, withReport, type FetchLike,
} from '../src/index.ts';

const scoutSample = () => scoutFaceitMatch(
  { faceit: sampleFaceit(), steam: sampleSteam(), sources: { faceit: 'sample', steam: 'sample', claude: 'off' }, now: () => Date.UTC(2026, 9, 21, 20) },
  { matchId: SAMPLE_MATCH_ID, platform: 'sample', ourSteamId: sampleSteamId('rdx'), room: { [sampleSteamId('rdx')!]: 'admin', [sampleSteamId('kairo')!]: 'member', [sampleSteamId('nyx')!]: 'member', [sampleSteamId('mbt')!]: 'member' } },
);

describe('scouting the sample match', () => {
  it('builds both teams with stats, threat and room status', async () => {
    const v = await scoutSample();
    expect(v.status).toBe('ready');
    expect(v.map).toBe('de_mirage');
    expect(v.us.players.map(p => p.nickname).sort()).toEqual(['kairo', 'mbt', 'nyx', 'rdx', 'zeph']);
    expect(v.us.players.find(p => p.nickname === 'zeph')!.room).toBe('random');
    expect(v.us.players.find(p => p.nickname === 'rdx')!.room).toBe('admin');
    expect(v.them.players[0]!.nickname).toBe('Holo'); // sorted by threat
    const holo = v.them.players[0]!;
    expect(holo.elo).toBe(2640);
    expect(holo.stats.kd).toBe(1.41);
    expect(holo.stats.recent).toEqual(['W', 'W', 'L', 'W', 'W']);
    expect(holo.maps.de_mirage).toEqual({ matches: 120, winRate: 61, kd: 1.46 });
    expect(holo.role).toEqual({ label: 'AWP', source: 'stats' });
    expect(holo.keyStat).toBe('1.46 K/D on Mirage');
    expect(holo.threat!.score).toBeGreaterThan(v.them.players[4]!.threat!.score);
    expect(holo.threat!.parts.map(p => p.label)).toEqual(['ELO', 'K/D', 'Form (last 5)', 'Mirage K/D']);
    expect(v.us.avgElo).toBe(2034);
    expect(v.them.avgElo).toBe(2108);
  });

  it('finds the premade groups from shared recent matches', async () => {
    const v = await scoutSample();
    const party = Object.fromEntries(v.them.players.map(p => [p.nickname, p.party]));
    expect(party.Holo).toBe('A');
    expect(party.vex).toBe('A');
    expect(party.Okami).toBe('A');
    expect(party.sk1p).toBe('B');
    expect(party.Drift).toBe('B');
  });

  it('flags bans, young accounts and private profiles from Steam', async () => {
    const v = await scoutSample();
    const by = (n: string) => v.them.players.find(p => p.nickname === n)!;
    expect(by('Okami').flags[0]).toMatch(/^VAC ban on record, last 2\.5 years ago$/);
    expect(by('sk1p').flags).toContain('Steam account 5 months old');
    expect(by('Drift').flags).toContain('private Steam profile');
    expect(by('Drift').steam!.cs2Hours).toBeUndefined();
    expect(by('Holo').flags).toEqual([]);
  });

  it('compares the map pool and suggests a veto', async () => {
    const v = await scoutSample();
    const row = (m: string) => v.maps.find(r => r.map === m)!;
    expect(row('de_ancient').action).toBe('ban'); // they win far more there
    expect(row('de_ancient').edge).toBeLessThan(-15);
    expect(row('de_nuke').action).toBe('their-ban'); // they barely play it: their likely ban
    expect(row('de_anubis').action).toBe('their-ban');
    expect(v.maps.filter(r => r.action === 'pick')).toHaveLength(1);
    expect(row('de_mirage').edge).toBeGreaterThan(0);
  });

  it('prefers FACEIT\'s own win estimate and writes three facts', async () => {
    const v = await scoutSample();
    expect(v.winChance!.basis).toMatch(/^FACEIT's estimate 45% · Mirage edge \+\d+$/);
    expect(v.winChance!.value).toBeGreaterThan(0.45);
    expect(v.facts).toHaveLength(3);
    expect(v.facts[0]).toMatch(/^Holo \(AWP · 2,640 ELO\) is their biggest threat: 1\.46 K\/D on Mirage\.$/);
    expect(v.facts[1]).toMatch(/^Mirage: you win \d+%, they win \d+%/);
    expect(v.facts[2]).toMatch(/^Holo, vex and Okami queue together/);
  });

  it('keeps going when one player lookup fails', async () => {
    const f = sampleFaceit();
    const flaky = { ...f, stats: async (id: string) => { if (id === 'sample-drift') throw new Error('boom'); return f.stats(id); } };
    const v = await scoutFaceitMatch({ faceit: flaky, steam: sampleSteam(), sources: { faceit: 'sample', steam: 'sample', claude: 'off' } }, { matchId: SAMPLE_MATCH_ID, platform: 'sample' });
    const drift = v.them.players.find(p => p.nickname === 'Drift')!;
    expect(drift.elo).toBe(1720); // from the player call
    expect(drift.stats).toEqual({});
    expect(v.status).toBe('ready');
  });
});

describe('recent matches', () => {
  it('lists recent matches with result, opponent and live status', async () => {
    const f = sampleFaceit();
    const me = await f.playerByNickname!('RDX');
    const recent = recentFromHistory(me.player_id, await f.history(me.player_id, 20), 5);
    expect(recent).toHaveLength(5);
    expect(recent[0]).toMatchObject({ status: 'FINISHED', live: false, vs: 'team_opp0', won: false });
    expect(recent[1]!.won).toBe(true);
    const live = recentFromHistory('p', { items: [{ match_id: '1-x', status: 'ONGOING', teams: { faction1: { players: [{ player_id: 'p' }] }, faction2: { nickname: 'team_live' } } }] });
    expect(live[0]).toMatchObject({ live: true, vs: 'team_live' });
  });
});

describe('API clients', () => {
  const fakeFetch = (routes: Record<string, () => { status: number; body?: unknown; headers?: Record<string, string> }>, seen: { url: string; headers?: Record<string, string> }[] = []): FetchLike =>
    async (url, init) => {
      seen.push({ url, ...(init?.headers ? { headers: init.headers } : {}) });
      const key = Object.keys(routes).find(k => url.includes(k));
      const r = key ? routes[key]!() : { status: 404 };
      return { ok: r.status < 400, status: r.status, headers: { get: (n: string) => r.headers?.[n.toLowerCase()] ?? null }, json: async () => r.body, text: async () => JSON.stringify(r.body) };
    };

  it('FACEIT: bearer key, cs2 paths, cache, retry on 429', async () => {
    const seen: { url: string; headers?: Record<string, string> }[] = [];
    let calls = 0;
    const cache = new MemoryStore();
    const c = faceitClient({ apiKey: 'k-123', cache, retryDelayMs: 0, fetch: fakeFetch({
      '/players?game=cs2&game_player_id=7656': () => ({ status: 200, body: { player_id: 'p1', nickname: 'x' } }),
      '/players/p1/stats/cs2': () => (++calls === 1 ? { status: 429, headers: { 'retry-after': '0' } } : { status: 200, body: { player_id: 'p1', game_id: 'cs2', lifetime: {}, segments: [] } }),
    }, seen) });
    expect((await c.playerBySteamId('7656')).player_id).toBe('p1');
    expect(seen[0]!.headers!.authorization).toBe('Bearer k-123');
    expect((await c.stats('p1')).game_id).toBe('cs2');
    expect(calls).toBe(2);
    await c.stats('p1');
    expect(calls).toBe(2); // cached
  });

  it('FACEIT: a bad key is an auth error', async () => {
    const c = faceitClient({ apiKey: 'bad', retryDelayMs: 0, fetch: fakeFetch({ '/matches/': () => ({ status: 401 }) }) });
    const err = await c.match('1-x').catch(e => e as ApiError);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).kind).toBe('auth');
  });

  it('Steam: never leaks the key in errors', async () => {
    const c = steamClient({ apiKey: 'SECRETKEY', retryDelayMs: 0, fetch: fakeFetch({ GetPlayerBans: () => ({ status: 403 }) }) });
    const err = (await c.bans(['1']).catch(e => e)) as ApiError;
    expect(err.kind).toBe('auth');
    expect(err.message).not.toContain('SECRETKEY');
  });

  it('checks keys with one cheap call', async () => {
    const seen: { url: string }[] = [];
    const ok = faceitClient({ apiKey: 'good', retryDelayMs: 0, fetch: fakeFetch({ '/games?offset=0&limit=1': () => ({ status: 200, body: { items: [] } }) }, seen) });
    await expect(ok.ping!()).resolves.toBeUndefined();
    expect(seen[0]!.url).toBe('https://open.faceit.com/data/v4/games?offset=0&limit=1');
    const bad = steamClient({ apiKey: 'BADKEY', retryDelayMs: 0, fetch: fakeFetch({ GetSupportedAPIList: () => ({ status: 403 }) }) });
    const err = (await bad.ping!().catch(e => e)) as ApiError;
    expect(err.kind).toBe('auth');
    expect(err.message).not.toContain('BADKEY');
  });

  it('reads FACEIT room links and ids', () => {
    const id = '1-6c8c1b43-1234-4d9e-9e2f-1234567890ab';
    expect(parseFaceitMatch(`https://www.faceit.com/en/cs2/room/${id}`)).toBe(id);
    expect(parseFaceitMatch(`https://www.faceit.com/fr/cs2/room/${id}/scoreboard`)).toBe(id);
    expect(parseFaceitMatch(` ${id} `)).toBe(id);
    expect(parseFaceitMatch('https://www.faceit.com/en/players/someone')).toBeUndefined();
  });
});

describe('AI report', () => {
  it('sends only computed facts and keeps tips to real enemy names', async () => {
    const v = await scoutSample();
    const input = JSON.parse(analystInput(v));
    expect(input.them.players).toHaveLength(5);
    expect(input.map).toBe('Mirage');
    expect(ANALYST_SCHEMA.required).toEqual(['summary', 'things', 'plan', 'veto', 'tips']);
    const parsed = parseAnalyst({
      summary: 'A strong AWP-led premade.', things: ['a', 'b', 'c', 'd'], plan: ['smoke window'], veto: 'Ban Ancient.',
      tips: [{ player: 'holo', tip: 'Never dry-peek mid.' }, { player: 'Ghost', tip: 'invented player' }],
    }, v);
    expect(parsed.things).toHaveLength(3);
    expect(parsed.tips).toEqual({ Holo: 'Never dry-peek mid.' });
    const withTips = withReport(v, { status: 'ready', ...parsed });
    expect(withTips.them.players.find(p => p.nickname === 'Holo')!.tip).toBe('Never dry-peek mid.');
    expect(() => parseAnalyst({ summary: 'x' }, v)).toThrow();
  });
});
