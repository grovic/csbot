// The warm coach session against the fake `claude` (stream-json mode), as a real child process.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COACH_SCHEMA, COACH_SYSTEM } from '@csbot/coach';
import { afterEach, describe, expect, it } from 'vitest';
import { claudeCommand } from '../src/scout/claude.ts';
import { ClaudeCoachSession, CoachError, CoachTimeout, type CoachReply } from '../src/coach/session.ts';

const FAKE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'e2e', 'fixtures', 'fake-claude.mjs');
const ENV_KEYS = ['FAKE_COACH_DELAY', 'FAKE_COACH_SLOW', 'FAKE_COACH_CRASH_AFTER', 'FAKE_COACH_ERROR', 'FAKE_CLAUDE_LOG'];
const sessions: ClaudeCoachSession[] = [];
const tmp: string[] = [];

afterEach(() => {
  for (const s of sessions.splice(0)) s.stop();
  for (const k of ENV_KEYS) delete process.env[k];
  for (const d of tmp.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function session(env: Record<string, string> = {}, model = 'haiku') {
  Object.assign(process.env, { FAKE_COACH_DELAY: '60', ...env });
  const s = new ClaudeCoachSession({ model, effort: 'low', system: COACH_SYSTEM, schema: COACH_SCHEMA, cmd: claudeCommand({ CSBOT_CLAUDE_BIN: FAKE }) });
  sessions.push(s);
  return s;
}
const logFile = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'csbot-coachlog-')); tmp.push(d); return path.join(d, 'log.ndjson'); };
const readLog = (f: string) => fs.readFileSync(f, 'utf8').trim().split('\n').map(l => JSON.parse(l) as { args?: string[]; turn?: string; cwd?: string });

describe('warm coach session (fake claude)', () => {
  it('answers each request on one process, with the right command line', async () => {
    const log = logFile();
    const s = session({ FAKE_CLAUDE_LOG: log });
    const warm = await s.request('Match starting on Mirage.', { priority: 'event', timeoutMs: 5000 });
    expect(warm.structured).toEqual({ type: 'answer', answer: 'ready' });
    const call = await s.request('Freeze time, round 2. Write the team call.', { priority: 'event', timeoutMs: 5000 });
    expect(call.structured).toMatchObject({ type: 'call', head: 'Claude: stack B, round 2' });
    expect(call.model).toBe('claude-fake-haiku');
    expect(call.costUsd).toBeCloseTo(0.008);
    expect(s.starts).toBe(1);
    const start = readLog(log)[0]!;
    const a = start.args!;
    expect(a.slice(0, 6)).toEqual(['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose']);
    expect(JSON.parse(a[a.indexOf('--json-schema') + 1]!)).toEqual(COACH_SCHEMA);
    expect(a[a.indexOf('--model') + 1]).toBe('haiku');
    expect(a).toEqual(expect.arrayContaining(['--tools', '', '--strict-mcp-config', '--permission-mode', 'dontAsk', '--no-session-persistence']));
    expect(a).not.toContain('--bare');
    expect(path.basename(start.cwd!)).toMatch(/^csbot-coach-/);
    s.stop();
    expect(fs.existsSync(start.cwd!)).toBe(false);
  });

  it('serves game events ahead of queued questions', async () => {
    const log = logFile();
    const s = session({ FAKE_CLAUDE_LOG: log, FAKE_COACH_DELAY: '120' });
    const first = s.request('Match starting on Mirage.', { priority: 'event', timeoutMs: 5000 });
    const q = s.request('Question from kairo (a member): "where?"', { priority: 'question', timeoutMs: 5000 });
    const ev = s.request('Freeze time, round 3. Write the team call.', { priority: 'event', timeoutMs: 5000 });
    await Promise.all([first, q, ev]);
    const turns = readLog(log).filter(r => r.turn).map(r => r.turn!.slice(0, 13));
    expect(turns).toEqual(['Match startin', 'Freeze time, ', 'Question from']);
  });

  it('restarts after a crash, on the next request', async () => {
    const s = session({ FAKE_COACH_CRASH_AFTER: '1' });
    await s.request('Match starting on Mirage.', { priority: 'event', timeoutMs: 5000 });
    await new Promise(r => setTimeout(r, 300));
    expect(s.running).toBe(false);
    const r = await s.request('Freeze time, round 1. Write the team call.', { priority: 'event', timeoutMs: 5000 });
    expect(r.structured).toMatchObject({ type: 'call' });
    expect(s.starts).toBe(2);
  });

  it('times out softly and still hands over a late reply', async () => {
    const s = session({ FAKE_COACH_SLOW: '700' });
    let late: CoachReply | undefined;
    const p = s.request('Freeze time, round 4. Write the team call.', { priority: 'event', timeoutMs: 150, onLate: r => { late = r; } });
    await expect(p).rejects.toBeInstanceOf(CoachTimeout);
    await new Promise(r => setTimeout(r, 900));
    expect(late?.structured).toMatchObject({ head: 'Claude: stack B, round 4' });
    expect(late!.ms).toBeGreaterThanOrEqual(600);
    // The session keeps going afterwards.
    const next = await s.request('Question from rdx (the admin): "ok?"', { priority: 'question', timeoutMs: 5000 });
    expect(next.structured).toEqual({ type: 'answer', answer: 'Answer to: ok?' });
  });

  it('reports Claude Code errors (signed out) and rejects everything on stop', async () => {
    const s = session({ FAKE_COACH_ERROR: '1' });
    await expect(s.request('Freeze time, round 1.', { priority: 'event', timeoutMs: 5000 })).rejects.toThrow(/Not logged in/);
    const pending = s.request('Freeze time, round 2.', { priority: 'event', timeoutMs: 5000 });
    s.stop();
    await expect(pending).rejects.toBeInstanceOf(CoachError);
    await expect(s.request('again', { priority: 'event', timeoutMs: 100 })).rejects.toThrow(/stopped/);
  });

  it('explains a missing claude binary', async () => {
    const s = new ClaudeCoachSession({ model: 'sonnet', effort: 'low', system: COACH_SYSTEM, schema: COACH_SCHEMA, cmd: { command: 'csbot-no-such-claude-binary', prefix: [], env: {} } });
    sessions.push(s);
    await expect(s.request('Freeze time, round 1.', { priority: 'event', timeoutMs: 5000 })).rejects.toThrow(/isn't installed/);
  });
});

// One real session, opt-in (CSBOT_LIVE=1): warm-up + one freeze call on the owner's Claude Code.
describe.skipIf(process.env.CSBOT_LIVE !== '1')('warm coach session (real Claude Code, opt-in)', () => {
  it('warms up and writes one call; reports latency and memory', async () => {
    const { MatchTracker } = await import('@csbot/engine');
    const { FIRST_HALF, syntheticMatch, toGameState } = await import('@csbot/gsi');
    const { eventMessage, parseCoachOutput } = await import('@csbot/coach');
    const t = new MatchTracker({ playbookHandle: 'a' });
    let live;
    for (const { t: at, p } of syntheticMatch({ rounds: FIRST_HALF })) {
      t.ingest(toGameState(p, at));
      const sn = t.snapshot(at);
      if (sn.match?.round === 2 && sn.match.clock.phase === 'freezetime') { live = sn; break; }
    }
    const roster = [{ name: 'rdx', slot: 'a' }, { name: 'kairo', slot: 'short' }, { name: 'nyx', slot: 'b' }, { name: 'mbt', slot: 'rotator' }, { name: 'zeph', slot: 'awp', random: true }];
    const s = new ClaudeCoachSession({ model: 'sonnet', effort: 'low', system: COACH_SYSTEM, schema: COACH_SCHEMA });
    sessions.push(s);
    const warm = await s.request(eventMessage('warmup', live!, roster), { priority: 'event', timeoutMs: 60_000 });
    const call = await s.request(eventMessage('freeze', live!, roster), { priority: 'event', timeoutMs: 60_000 });
    const out = parseCoachOutput(call.structured, live!, 'pre');
    const { execFileSync } = await import('node:child_process');
    const mem = (() => {
      try {
        // Only claude processes this test spawned (the developer's own Claude Code session matches the same flags).
        const csv = execFileSync('powershell.exe', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq ${process.pid} -and $_.Name -like 'claude*' } | Measure-Object -Property WorkingSetSize -Sum | ForEach-Object { $_.Sum }`], { encoding: 'utf8' });
        return Math.round(Number(csv.trim()) / 1048576);
      } catch { return undefined; }
    })();
    const line = `[live coach] warm-up ${warm.ms} ms · call ${call.ms} ms (${call.model}) · ${out.type === 'call' ? out.call.head : 'answer?'} · claude process ~${mem} MB working set · cost so far $${call.costUsd}`;
    console.log(line);
    // Vitest hides console output of passing tests: keep the measurement in a file too.
    (await import('node:fs')).appendFileSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'csbot-live-coach.log'), `${line}${String.fromCharCode(10)}`);
    expect(out.type).toBe('call');
  }, 180_000);
});
