import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MatchTracker } from '@csbot/engine';
import { FIRST_HALF, syntheticMatch, toGameState } from '@csbot/gsi';
import { EMPTY_COACH, type CoachView } from '@csbot/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { MatchLog, parseTrace } from '../src/diagnostics.ts';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'csbot-diag-')); dirs.push(d); return d; };
const read = (f: string) => fs.readFileSync(f, 'utf8').trim().split('\n').map(l => JSON.parse(l) as Record<string, unknown>);

describe('the match log (measurement runs only)', () => {
  it('sits next to the metrics file', () => {
    expect(MatchLog.fileFor('C:/x/metrics/2026-10-23_210512.ndjson')).toBe('C:/x/metrics/2026-10-23_210512.events.ndjson');
  });

  it('notes each phase change and each new call once, with the round end before the next call', () => {
    const file = path.join(tmp(), 'm', 'run.events.ndjson');
    let now = 0;
    const log = new MatchLog(file, () => now);
    const t = new MatchTracker({ playbookHandle: 'a' });
    for (const { t: at, p } of syntheticMatch({ rounds: FIRST_HALF.slice(0, 3) })) {
      t.ingest(toGameState(p, at));
      now = at;
      log.snapshot(t.snapshot(at));
      log.snapshot(t.snapshot(at)); // the 1 s heartbeat repeats snapshots: no duplicates
    }
    const ev = read(file);
    const phases = ev.filter(e => e.ev === 'phase').map(e => `${e.round}:${e.phase}`);
    expect(phases.slice(0, 4)).toEqual(['1:freezetime', '1:live', '1:over', '2:freezetime']);
    expect(new Set(phases).size).toBe(phases.length);
    const calls = ev.filter(e => e.ev === 'call').map(e => e.key);
    expect(calls).toContain('2:pre:engine');
    expect(new Set(calls).size).toBe(calls.length);
    // Round 1 ends, then round 2's call: logged in that order, same moment.
    const over1 = ev.findIndex(e => e.ev === 'phase' && e.round === 1 && e.phase === 'over');
    const call2 = ev.findIndex(e => e.ev === 'call' && e.key === '2:pre:engine');
    expect(call2).toBeGreaterThan(over1);
    expect(ev[call2]!.t).toBe(ev[over1]!.t);
  });

  it("notes the coach's new log entries once, oldest first", () => {
    const file = path.join(tmp(), 'run.events.ndjson');
    const log = new MatchLog(file, () => 1);
    const v = (ids: string[]): CoachView => ({ ...EMPTY_COACH, calls: ids.map(id => ({ id, at: 1, round: Number(id.slice(1)), trigger: 'freeze', status: 'ok', ms: 3000, model: 'claude-sonnet', costUsd: 0.01 })) });
    log.coach(v(['c1']));
    log.coach(v(['c2', 'c1']));
    expect(read(file).map(e => e.round)).toEqual([1, 2]);
    expect(read(file)[1]).toMatchObject({ ev: 'coach', trigger: 'freeze', status: 'ok', ms: 3000, model: 'claude-sonnet', costUsd: 0.01 });
  });

  it('keeps a pasted status next to the run, numbered', () => {
    const dir = tmp();
    const log = new MatchLog(path.join(dir, 'run.events.ndjson'), () => 1);
    log.keep('status', 'first');
    log.keep('status', 'second');
    expect(fs.readFileSync(path.join(dir, 'run.status-2.txt'), 'utf8')).toBe('second');
    expect(read(path.join(dir, 'run.events.ndjson')).map(e => e.n)).toEqual([1, 2]);
  });

  it("takes the renderer's traces from known fields only", () => {
    expect(parseTrace({ ev: 'shown', id: 'client-kairo', name: 'kairo', device: 'web', key: '4:pre:claude', extra: 'x' })).toEqual({ ev: 'shown', id: 'client-kairo', name: 'kairo', device: 'web', key: '4:pre:claude' });
    expect(parseTrace({ ev: 'offline', id: 'host', name: 'x'.repeat(50), device: 'desktop' })).toEqual({ ev: 'offline', id: 'host', name: 'x'.repeat(32), device: 'desktop' });
    for (const bad of [null, 'x', { ev: 'shown', id: 'a', name: 'a', device: 'web', key: 'nope' }, { ev: 'hack', id: 'a', name: 'a', device: 'web' }, { ev: 'online', id: '../x', name: 'a', device: 'web' }, { ev: 'online', id: 'a', name: 'a', device: 'phone' }]) {
      expect(parseTrace(bad)).toBeUndefined();
    }
  });
});
