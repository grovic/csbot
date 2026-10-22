import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MatchTracker } from '@csbot/engine';
import { FULL_MATCH, syntheticMatch, toGameState } from '@csbot/gsi';
import type { DebriefView, DemoReplay, DemoTruth } from '@csbot/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { DebriefService } from '../src/debrief/service.ts';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

function play(svc: DebriefService, rounds = FULL_MATCH, map = 'de_mirage', start?: number) {
  const t = new MatchTracker({ playbookHandle: 'a' });
  for (const { t: at, p } of syntheticMatch({ rounds, lean: true, map, ...(start ? { start } : {}) })) { t.ingest(toGameState(p, at)); svc.observe(t.snapshot(at)); }
}

function service(extra: Partial<ConstructorParameters<typeof DebriefService>[0]> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csbot-debrief-'));
  dirs.push(dir);
  const views: DebriefView[] = [];
  const svc = new DebriefService({ dir, onChange: v => views.push(v), ...extra });
  return { svc, dir, views };
}

describe('debrief service', () => {
  it('records the match round by round, keeps it on disk and reloads it', () => {
    const { svc, dir, views } = service();
    play(svc);
    const v = svc.view();
    expect(v.record?.finished).toBe(true);
    expect(v.matches).toHaveLength(1);
    expect(v.matches[0]!.rating).toBeGreaterThan(0);
    expect(views.length).toBeGreaterThan(10); // saved after every round
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    expect(files).toHaveLength(1);
    const again = new DebriefService({ dir, onChange: () => {} });
    expect(again.view().record?.id).toBe(v.record!.id);
    expect(again.view().record?.rounds.length).toBe(v.record!.rounds.length);
    // The call kept per round is the round's call, not the round-over summary.
    expect(v.record!.rounds.every(r => !r.call || r.call.kind !== 'over')).toBe(true);
  });

  it('attaches a demo to its match and refuses one that fits no record', async () => {
    let truth: DemoTruth | undefined;
    const { svc } = service({ parseDemo: async () => truth! });
    play(svc);
    const rec = svc.view().record!;
    const file = path.join(os.tmpdir(), `csbot-fake-${Date.now()}.dem`);
    fs.writeFileSync(file, 'x');
    try {
      truth = { source: { file, parsedAt: 0, bytes: 1 }, map: 'de_dust2', players: [], rounds: [] };
      const bad = await svc.ingest(file);
      expect(bad.ok).toBe(false);
      expect(bad.error).toMatch(/No dust2 match/);
      truth = { source: { file, parsedAt: 0, bytes: 1 }, map: 'de_mirage', players: [], rounds: rec.rounds.map(r => ({ round: r.round, winner: r.side, players: [], deaths: [] })) };
      expect(await svc.ingest(file)).toEqual({ ok: true });
      expect(svc.view().record?.truth?.map).toBe('de_mirage');
      expect(svc.view().matches[0]!.hasDemo).toBe(true);
      expect(svc.view().demo?.status).toBe('ready');
      expect(svc.view().replay).toBeUndefined();
    } finally { fs.rmSync(file, { force: true }); }
  });

  it("keeps the demo's 2D replay gzipped next to the record and serves it back", async () => {
    const { svc, dir } = service();
    play(svc);
    const rec = svc.view().record!;
    const truth: DemoTruth = { source: { file: 'x.dem', parsedAt: 0, bytes: 1 }, map: 'de_mirage', players: [], rounds: rec.rounds.map(r => ({ round: r.round, winner: r.side, players: [], deaths: [] })) };
    const replay: DemoReplay = { map: 'de_mirage', rounds: [{ round: 1, hz: 4, duration: 1, players: [{ steamid: 'a', name: 'rdx', side: 'CT' }], frames: [[0, 0, 0, 100], [10, 0, 0, 100], [20, 0, 0, 0]], nades: [], kills: [] }] };
    const svc2 = new DebriefService({ dir, onChange: () => {}, parseDemo: async () => ({ truth, replay }) });
    const file = path.join(os.tmpdir(), `csbot-fake-${Date.now()}.dem`);
    fs.writeFileSync(file, 'x');
    try {
      expect(await svc2.ingest(file)).toEqual({ ok: true });
      expect(fs.existsSync(path.join(dir, `${rec.id}.replay.json.gz`))).toBe(true);
      expect(svc2.view().replay).toBe(true);
      expect(svc2.replay(rec.id)).toEqual(replay);
      expect(svc2.replay('../etc')).toBeUndefined();
      expect(svc2.replay('nope')).toBeUndefined();
    } finally { fs.rmSync(file, { force: true }); }
    expect(svc.replay(rec.id)).toEqual(replay); // any service on the folder reads it
  });

  it("asks Claude for the work-on-next notes and keeps them", async () => {
    let input = '';
    const { svc } = service({ runClaude: async o => { input = o.input; return { output: { team: ['Save more on T.', 'Trade B.'], you: ['Second angle.'] }, model: 'claude-opus-test' }; } });
    play(svc);
    const id = svc.view().record!.id;
    expect(await svc.writeWorkOn(id)).toEqual({ ok: true });
    expect(svc.view().record!.workOn).toMatchObject({ team: ['Save more on T.', 'Trade B.'], you: ['Second angle.'], model: 'claude-opus-test' });
    expect(input).toContain('"map":"de_mirage"');
    expect(await svc.writeWorkOn('nope')).toEqual({ ok: false, error: 'No such match.' });
  });

  it('keeps separate records for separate matches, newest first', () => {
    const { svc } = service();
    play(svc, FULL_MATCH.slice(0, 3), 'de_mirage', Date.UTC(2026, 9, 20, 18));
    play(svc, FULL_MATCH.slice(0, 3), 'de_dust2', Date.UTC(2026, 9, 21, 18));
    const v = svc.view();
    expect(v.matches.map(m => m.map)).toEqual(['de_dust2', 'de_mirage']);
    svc.select(v.matches[1]!.id);
    expect(svc.view().record?.map).toBe('de_mirage');
  });
});

describe('the demo reader runs in its own process', () => {
  it('a crash is retried once (and a second crash is an error, not a crashed app)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csbot-reader-'));
    dirs.push(dir);
    const demo = path.join(dir, 'm.dem');
    fs.writeFileSync(demo, 'x');
    process.env.CSBOT_DEMO_WORKER = path.resolve(__dirname, 'fixtures-flaky-reader.cjs');
    process.env.FLAKY_MARKER = path.join(dir, 'marker');
    try {
      const { parseDemoFile } = await import('../src/debrief/demo.ts');
      const r = await parseDemoFile(demo);
      expect(r.truth.map).toBe('de_mirage');
      expect(fs.existsSync(process.env.FLAKY_MARKER)).toBe(true); // it did crash first
      // Always crashing: a clean error.
      process.env.CSBOT_DEMO_WORKER = path.join(dir, 'crash.cjs');
      fs.writeFileSync(process.env.CSBOT_DEMO_WORKER, 'process.exit(3);');
      await expect(parseDemoFile(demo)).rejects.toThrow('the demo reader crashed twice');
    } finally { delete process.env.CSBOT_DEMO_WORKER; delete process.env.FLAKY_MARKER; }
  });
});

describe('reading the test demo (when present)', () => {
  const demo = path.resolve(__dirname, '../../../packages/demo/testdata/test_demo.dem');
  const worker = path.resolve(__dirname, '../dist/demo-worker.cjs');
  const have = fs.existsSync(demo) && fs.existsSync(worker);

  it.skipIf(!have)('parses it in a worker and rebuilds a match csbot never saw, from a player in it', async () => {
    process.env.CSBOT_DEMO_WORKER = worker;
    const { parseDemoFile } = await import('../src/debrief/demo.ts');
    const t0 = Date.now();
    const { truth } = await parseDemoFile(demo);
    expect(Date.now() - t0).toBeLessThan(15_000);
    expect(truth.map).toBe('de_mirage');
    expect(truth.rounds.length).toBeGreaterThan(5);
    expect(truth.source.file).toBe('test_demo.dem');
    const someone = truth.players.find(p => /^7656\d{13}$/.test(p.steamid))!.steamid;
    const { svc } = service({ parseDemo: parseDemoFile, ourSteamId: () => someone });
    expect(await svc.ingest(demo)).toEqual({ ok: true });
    const v = svc.view();
    expect(v.record?.truth?.rounds.length).toBe(truth.rounds.length);
    expect(v.record!.score.us + v.record!.score.them).toBe(truth.rounds.length);
    expect(v.matches[0]!.hasDemo).toBe(true);
  });
});
