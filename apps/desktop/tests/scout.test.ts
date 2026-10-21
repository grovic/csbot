import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiError, sampleFaceit, sampleSteam, sampleSteamId, type FaceitApi } from '@csbot/scout';
import type { ScoutView } from '@csbot/protocol';
import { claudeCommand, detectClaude, runAnalyst } from '../src/scout/claude.ts';
import { FileStore } from '../src/scout/file-cache.ts';
import { Secrets, type Encryptor } from '../src/scout/secrets.ts';
import { ERRORS, ScoutService, type AnalystRunner, type KeyStore } from '../src/scout/service.ts';

const FAKE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'e2e', 'fixtures', 'fake-claude.mjs');
const tmps: string[] = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'csbot-scout-')); tmps.push(d); return d; };
afterEach(() => { for (const d of tmps.splice(0)) fs.rmSync(d, { recursive: true, force: true }); delete process.env.FAKE_CLAUDE_MODE; delete process.env.FAKE_CLAUDE_LOG; delete process.env.FAKE_CLAUDE_DELAY; });

/** Reversible fake "encryption" so tests can see nothing is stored in plain text. */
const fakeEnc = (available = true): Encryptor => ({
  isEncryptionAvailable: () => available,
  encryptString: s => Buffer.from('enc:' + [...s].reverse().join('')),
  decryptString: b => { const t = b.toString(); if (!t.startsWith('enc:')) throw new Error('bad'); return [...t.slice(4)].reverse().join(''); },
});

const keys = (k: Partial<Record<'faceit' | 'steam', string>> = {}): KeyStore => ({ get: s => k[s] });

const fakeAnalyst = (o: { found?: boolean; delay?: number; fail?: string } = {}): AnalystRunner & { calls: number } => {
  const a = {
    calls: 0,
    detect: async () => o.found ?? true,
    run: async (v: ScoutView) => {
      a.calls++;
      await new Promise(r => setTimeout(r, o.delay ?? 5));
      if (o.fail) throw new Error(o.fail);
      return { summary: `About ${v.them.name}`, things: ['a', 'b', 'c'], plan: ['p'], veto: 'Ban Ancient.', tips: { Holo: 'Trade him.' }, model: 'fake-opus', ms: 5 };
    },
  };
  return a;
};

const until = async (fn: () => boolean, ms = 3000) => { const end = Date.now() + ms; while (!fn()) { if (Date.now() > end) throw new Error('timed out'); await new Promise(r => setTimeout(r, 5)); } };

describe('secrets', () => {
  it('stores keys encrypted and reads them back', () => {
    const dir = tmp();
    const s = new Secrets(dir, fakeEnc());
    expect(s.has('faceit')).toBe(false);
    expect(s.set('faceit', '  0b1c2d3e-aaaa-bbbb-cccc-1234567890ab ')).toEqual({ ok: true });
    const raw = fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8');
    expect(raw).not.toContain('0b1c2d3e-aaaa-bbbb-cccc-1234567890ab');
    expect(new Secrets(dir, fakeEnc()).get('faceit')).toBe('0b1c2d3e-aaaa-bbbb-cccc-1234567890ab');
    expect(s.set('faceit', null)).toEqual({ ok: true });
    expect(new Secrets(dir, fakeEnc()).has('faceit')).toBe(false);
  });

  it('refuses to store a key without encryption, and rejects junk', () => {
    const dir = tmp();
    const s = new Secrets(dir, fakeEnc(false));
    const r = s.set('steam', 'ABCDEF0123456789ABCDEF0123456789');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/encrypt/);
    expect(fs.existsSync(path.join(dir, 'secrets.json'))).toBe(false);
    expect(new Secrets(dir, fakeEnc()).set('steam', 'has spaces and "quotes"').ok).toBe(false);
  });

  it('treats a key it cannot decrypt as missing', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify({ v: 1, faceit: Buffer.from('garbage').toString('base64') }));
    expect(new Secrets(dir, fakeEnc()).get('faceit')).toBeUndefined();
  });
});

describe('file cache', () => {
  it('persists entries, drops expired ones and caps the size', () => {
    const dir = tmp();
    let now = 1000;
    const file = path.join(dir, 'cache', 'scout.json');
    const a = new FileStore(file, { now: () => now, debounceMs: 10_000 });
    a.set('keep', { value: { x: 1 }, expires: 10_000 });
    a.set('old', { value: 1, expires: 1500 });
    a.flush();
    now = 2000;
    const b = new FileStore(file, { now: () => now });
    expect(b.get('keep')?.value).toEqual({ x: 1 });
    expect(b.get('old')).toBeUndefined();
    const c = new FileStore(file, { now: () => now, maxBytes: 2000 });
    for (let i = 0; i < 50; i++) c.set(`k${i}`, { value: 'x'.repeat(100), expires: 5000 + i });
    c.flush();
    expect(fs.statSync(file).size).toBeLessThanOrEqual(2000);
    const d = new FileStore(file, { now: () => now });
    expect(d.get('k49')).toBeDefined(); // the latest-expiring entries survive
    expect(d.get('k0')).toBeUndefined();
  });
});

describe('scout service', () => {
  it('scouts the sample and runs the AI report once on its own', async () => {
    const analyst = fakeAnalyst();
    const svc = new ScoutService({ keys: keys(), analyst });
    await svc.init();
    const seen: ScoutView[] = [];
    svc.onChange(v => seen.push(v));
    await svc.scoutSample();
    expect(seen[0]!.status).toBe('loading');
    await until(() => svc.current.report.status === 'ready');
    const v = svc.current;
    expect(v.platform).toBe('sample');
    expect(v.sources).toEqual({ faceit: 'sample', steam: 'sample', claude: 'live' });
    expect(v.us.players.find(p => p.nickname === 'rdx')!.room).toBe('admin');
    expect(v.us.players.find(p => p.nickname === 'zeph')!.room).toBe('random');
    expect(v.report).toMatchObject({ status: 'ready', model: 'fake-opus', summary: 'About team_kappa' });
    expect(v.them.players.find(p => p.nickname === 'Holo')!.tip).toBe('Trade him.');
    expect(seen.some(s => s.report.status === 'running')).toBe(true);
    expect(analyst.calls).toBe(1);
  });

  it('allows two manual re-runs per match, then says the budget is used', async () => {
    const analyst = fakeAnalyst();
    const svc = new ScoutService({ keys: keys(), analyst });
    await svc.init();
    await svc.scoutSample();
    await until(() => svc.current.report.status === 'ready');
    expect((await svc.runReport()).ok).toBe(true);
    expect((await svc.runReport()).ok).toBe(true);
    const third = await svc.runReport();
    expect(third).toEqual({ ok: false, error: ERRORS.budget });
    expect(analyst.calls).toBe(3);
    expect(svc.current.report.status).toBe('ready'); // the last good report stays
  });

  it('re-scouting a match keeps its report without another call', async () => {
    const analyst = fakeAnalyst();
    const svc = new ScoutService({ keys: keys(), analyst });
    await svc.init();
    await svc.scoutSample();
    await until(() => svc.current.report.status === 'ready');
    await svc.scoutSample();
    expect(svc.current.status).toBe('ready');
    expect(svc.current.report).toMatchObject({ status: 'ready', summary: 'About team_kappa' });
    expect(svc.current.them.players.find(p => p.nickname === 'Holo')!.tip).toBe('Trade him.');
    await new Promise(r => setTimeout(r, 30));
    expect(analyst.calls).toBe(1);
  });

  it('works without Claude Code: data only, report marked off', async () => {
    const svc = new ScoutService({ keys: keys(), analyst: fakeAnalyst({ found: false }) });
    await svc.init();
    await svc.scoutSample();
    await until(() => svc.current.report.status === 'off');
    expect(svc.current.status).toBe('ready');
    expect(svc.current.sources.claude).toBe('off');
    expect(svc.current.report.error).toBe(ERRORS.noClaude);
  });

  it('keeps the previous report when a re-run fails', async () => {
    let fail = false;
    const analyst: AnalystRunner = { detect: async () => true, run: async () => { if (fail) throw new Error('Claude Code took longer than 90 s.'); return { summary: 's', things: [], plan: [], veto: 'v', tips: {}, model: 'm', ms: 1 }; } };
    const svc = new ScoutService({ keys: keys(), analyst });
    await svc.init();
    await svc.scoutSample();
    await until(() => svc.current.report.status === 'ready');
    fail = true;
    await svc.runReport();
    expect(svc.current.report).toMatchObject({ status: 'ready', summary: 's', error: 'Claude Code took longer than 90 s.' });
  });

  it('asks for a key, a valid link, and explains FACEIT errors', async () => {
    const svc = new ScoutService({ keys: keys(), analyst: fakeAnalyst() });
    expect(await svc.scoutMatch('not a link')).toEqual({ ok: false, error: ERRORS.badLink });
    expect(await svc.scoutMatch('https://www.faceit.com/en/cs2/room/1-6c8c1b43-1234-4d9e-9e2f-1234567890ab')).toEqual({ ok: false, error: ERRORS.noKey });
    expect(svc.current.sources.faceit).toBe('missing-key');

    const failing = (status: number): FaceitApi => ({ ...sampleFaceit(), match: async () => { throw new ApiError('FACEIT', status, 'x'); } });
    for (const [status, msg] of [[401, ERRORS.auth], [404, ERRORS.notFound], [429, ERRORS.rateLimit], [0, ERRORS.network], [503, ERRORS.server]] as const) {
      const s = new ScoutService({ keys: keys({ faceit: 'faceit-key-0000000000' }), makeFaceit: () => failing(status), autoReport: false });
      const r = await s.scoutMatch('1-6c8c1b43-1234-4d9e-9e2f-1234567890ab');
      expect(r).toEqual({ ok: false, error: msg });
      expect(s.current.status).toBe('error');
      expect(s.current.sources.faceit).toBe(status === 401 ? 'error' : 'live');
    }
  });

  it('scouts a real match id with the live clients (stand-ins here)', async () => {
    const svc = new ScoutService({
      keys: keys({ faceit: 'faceit-key-0000000000', steam: 'ABCDEF0123456789ABCDEF0123456789' }),
      makeFaceit: () => ({ ...sampleFaceit(), match: async () => ({ ...(await sampleFaceit().match('1-00000000-0000-4000-8000-000000000001')), match_id: '1-6c8c1b43-1234-4d9e-9e2f-1234567890ab' }) }),
      makeSteam: () => sampleSteam(),
      autoReport: false,
    });
    const r = await svc.scoutMatch('https://www.faceit.com/en/cs2/room/1-6c8c1b43-1234-4d9e-9e2f-1234567890ab');
    expect(r).toEqual({ ok: true });
    expect(svc.current).toMatchObject({ status: 'ready', platform: 'faceit', matchId: '1-6c8c1b43-1234-4d9e-9e2f-1234567890ab' });
    expect(svc.current.sources).toMatchObject({ faceit: 'live', steam: 'live' });
  });

  it('drops a slow scout once a newer one started', async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const slow: FaceitApi = { ...sampleFaceit(), match: async id => { await gate; return sampleFaceit().match(id); } };
    const svc = new ScoutService({ keys: keys({ faceit: 'faceit-key-0000000000' }), makeFaceit: () => slow, autoReport: false });
    const first = svc.scoutMatch('1-00000000-0000-4000-8000-000000000001');
    await svc.scoutSample();
    release();
    await first;
    expect(svc.current.platform).toBe('sample');
  });

  it('clears a refused-key error once a new key is saved', async () => {
    let key = 'faceit-key-0000000000';
    const svc = new ScoutService({ keys: { get: s => (s === 'faceit' ? key : undefined) }, autoReport: false });
    svc.markAuthError('faceit');
    expect(svc.current.sources.faceit).toBe('error');
    key = 'faceit-key-1111111111';
    svc.refreshSources();
    expect(svc.current.sources.faceit).toBe('live');
  });
});

describe('room labels', () => {
  it('labels room members by FACEIT nickname and follows room changes', async () => {
    let roster: Record<string, 'admin' | 'member'> = { [sampleSteamId('rdx')!]: 'admin' };
    const svc = new ScoutService({ keys: keys({ faceit: 'faceit-key-0000000000' }), makeFaceit: () => sampleFaceit(), roomSteamIds: () => roster, autoReport: false });
    expect((await svc.scoutMatch('1-00000000-0000-4000-8000-000000000001')).ok).toBe(true);
    const room = () => Object.fromEntries(svc.current.us.players.map(p => [p.nickname, p.room]));
    expect(room()).toEqual({ rdx: 'admin', kairo: 'random', zeph: 'random', nyx: 'random', mbt: 'random' });
    roster = { ...roster, KAIRO: 'member', nyx: 'member' }; // members join under their FACEIT name, any case
    svc.relabelRoom();
    expect(room()).toMatchObject({ rdx: 'admin', kairo: 'member', nyx: 'member', zeph: 'random' });
  });
});

describe("which team is the host's", () => {
  it('uses the saved FACEIT account when CS2 is not running, and swaps on request', async () => {
    // No Steam ID from GSI (CS2 closed); the host's account plays on the second faction.
    const svc = new ScoutService({ keys: keys({ faceit: 'faceit-key-0000000000' }), makeFaceit: () => sampleFaceit(), autoReport: false });
    expect((await svc.setNickname('Holo')).ok).toBe(true);
    expect((await svc.scoutMatch('1-00000000-0000-4000-8000-000000000001')).ok).toBe(true);
    const us = () => svc.current.us.players.map(p => p.nickname);
    expect(svc.current.sideBy).toBe('account');
    expect(us()).toContain('Holo');
    expect(svc.current.us.players.find(p => p.nickname === 'Holo')!.room).toBe('admin');

    expect((await svc.swapSides()).ok).toBe(true);
    expect(svc.current.sideBy).toBe('manual');
    expect(us()).toContain('rdx');
    expect((await svc.swapSides()).ok).toBe(true);
    expect(svc.current.sideBy).toBe('account');
    expect(us()).toContain('Holo');
  });

  it('flags a guess when nothing identifies the host', async () => {
    const svc = new ScoutService({ keys: keys({ faceit: 'faceit-key-0000000000' }), makeFaceit: () => sampleFaceit(), autoReport: false });
    await svc.scoutMatch('1-00000000-0000-4000-8000-000000000001');
    expect(svc.current.sideBy).toBe('guess');
    expect((await new ScoutService({ keys: keys(), autoReport: false }).swapSides()).ok).toBe(false);
  });
});

describe('your FACEIT account and recent matches', () => {
  it('needs a key, finds the account, lists recent matches', async () => {
    const none = new ScoutService({ keys: keys(), autoReport: false });
    expect((await none.setNickname('rdx')).ok).toBe(false);
    expect(none.current.account!.status).toBe('error');

    const svc = new ScoutService({ keys: keys({ faceit: 'faceit-key-0000000000' }), makeFaceit: () => sampleFaceit(), autoReport: false });
    expect((await svc.setNickname('RDX')).ok).toBe(true);
    expect(svc.current.account).toMatchObject({ nickname: 'rdx', status: 'ok', level: 9, elo: 2050 });
    expect(svc.current.account).not.toHaveProperty('playerId'); // internal id stays on the host
    expect(svc.current.recent).toHaveLength(6);
    // Scouting keeps the account and the list.
    await svc.scoutSample();
    expect(svc.current.recent).toHaveLength(6);
    expect((await svc.setNickname('nobody-here')).error).toMatch(/no player called/);
    expect(svc.current.account!.status).toBe('not-found');
  });

  it('scouts a match that turns live, once', async () => {
    const f = sampleFaceit();
    let live = false;
    const faceit: FaceitApi = {
      ...f,
      history: async id => {
        const h = await f.history(id, 6);
        return live ? { items: [{ match_id: '1-00000000-0000-4000-8000-000000000001', status: 'ONGOING', teams: { faction1: { players: [{ player_id: id }] } } }, ...h.items] } : h;
      },
    };
    const svc = new ScoutService({ keys: keys({ faceit: 'faceit-key-0000000000' }), makeFaceit: () => faceit, autoReport: false });
    await svc.setNickname('rdx');
    expect(svc.current.status).toBe('idle');
    live = true;
    await svc.refreshRecent();
    expect(svc.current.status).toBe('ready');
    expect(svc.current.matchId).toBe('1-00000000-0000-4000-8000-000000000001');
    expect(svc.current.recent![0]!.live).toBe(true);
    const fetchedAt = svc.current.fetchedAt;
    await svc.refreshRecent();
    expect(svc.current.fetchedAt).toBe(fetchedAt); // not scouted again
  });
});

describe('saved keys at startup', () => {
  it('marks a refused key without touching a good one', async () => {
    const refusing: FaceitApi = { ...sampleFaceit(), ping: async () => { throw new ApiError('FACEIT', 401, 'nope'); } };
    const steamOk = { ...sampleSteam(), ping: async () => {} };
    const svc = new ScoutService({ keys: keys({ faceit: 'faceit-key-0000000000', steam: 'ABCDEF0123456789ABCDEF0123456789' }), makeFaceit: () => refusing, makeSteam: () => steamOk, autoReport: false });
    expect(await svc.verifyKeys()).toEqual({ faceit: false, steam: true });
    expect(svc.current.sources.faceit).toBe('error');
    expect(svc.current.sources.steam).toBe('live');
  });
});

describe('claude runner (fake binary)', () => {
  const cmd = () => claudeCommand({ CSBOT_CLAUDE_BIN: FAKE });
  const sampleView = async () => {
    const svc = new ScoutService({ keys: keys(), autoReport: false });
    await svc.scoutSample();
    return svc.current;
  };

  it('detects the binary and reports a missing one', async () => {
    expect(await detectClaude(cmd())).toMatchObject({ found: true });
    expect(await detectClaude(claudeCommand({ CSBOT_CLAUDE_BIN: path.join(tmp(), 'no-such-claude.exe') }))).toEqual({ found: false });
  });

  it('passes the agreed flags, the facts on stdin, and parses the structured result', async () => {
    const log = path.join(tmp(), 'calls.ndjson');
    process.env.FAKE_CLAUDE_LOG = log;
    const r = await runAnalyst(await sampleView(), cmd());
    expect(r.model).toBe('claude-fake-opus');
    expect(r.tips).toEqual({ Holo: 'Use utility before peeking him and always trade.', sk1p: 'Keep crosshairs at head height.' });
    const call = JSON.parse(fs.readFileSync(log, 'utf8').trim()) as { args: string[]; stdinBytes: number; cwd: string };
    const a = call.args;
    expect(a.slice(0, 3)).toEqual(['-p', '--output-format', 'json']);
    expect(a[a.indexOf('--model') + 1]).toBe('opus');
    expect(a[a.indexOf('--effort') + 1]).toBe('high');
    expect(a[a.indexOf('--tools') + 1]).toBe('');
    expect(a).toEqual(expect.arrayContaining(['--strict-mcp-config', '--no-session-persistence', '--json-schema', '--system-prompt-file']));
    expect(a[a.indexOf('--permission-mode') + 1]).toBe('dontAsk');
    expect(a).not.toContain('--bare');
    expect(call.stdinBytes).toBeGreaterThan(1000);
    expect(fs.existsSync(call.cwd)).toBe(false); // the app-owned work dir is cleaned up
  });

  it('turns failures into readable errors', async () => {
    const v = await sampleView();
    process.env.FAKE_CLAUDE_MODE = 'error';
    await expect(runAnalyst(v, cmd())).rejects.toThrow(/Not logged in/);
    process.env.FAKE_CLAUDE_MODE = 'garbage';
    await expect(runAnalyst(v, cmd())).rejects.toThrow(/isn't JSON/);
    process.env.FAKE_CLAUDE_MODE = 'hang';
    const t0 = Date.now();
    await expect(runAnalyst(v, cmd(), { timeoutMs: 1500 })).rejects.toThrow(/longer than 2 s/);
    expect(Date.now() - t0).toBeLessThan(10_000);
    await expect(runAnalyst(v, claudeCommand({ CSBOT_CLAUDE_BIN: path.join(tmp(), 'missing-claude.exe') }))).rejects.toThrow(/isn't installed/);
  });
});

describe('claude runner (real Claude Code, opt-in)', () => {
  // One real call on the owner's plan: run only with CSBOT_LIVE=1.
  it.runIf(process.env.CSBOT_LIVE === '1')('writes a grounded report for the sample match', async () => {
    const svc = new ScoutService({ keys: keys(), autoReport: false });
    await svc.scoutSample();
    const r = await runAnalyst(svc.current);
    expect(r.summary!.length).toBeGreaterThan(20);
    expect(r.things!.length).toBeGreaterThan(0);
    expect(Object.keys(r.tips ?? {}).every(n => svc.current.them.players.some(p => p.nickname === n))).toBe(true);
  }, 120_000);
});
