// One warm `claude -p` session per match for the live coach (M5). Stream-json in and out, one
// structured output per turn (--json-schema), one request in flight, game events ahead of questions.
// AGENTS.md: the user's own unmodified `claude`, never its credentials, never --bare.
//
// Measured by hand: structured output arrives on every turn of one session, about 20 ms after the
// StructuredOutput tool_use (5.6 s cold, 3.1 s warm with sonnet at low effort).

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { childEnv, claudeCommand, killTree, type ClaudeCommand } from '../scout/claude.ts';

export interface CoachReply {
  structured: unknown;
  ms: number;
  model?: string;
  /** Cumulative for the session, as Claude Code reports it. */
  costUsd?: number;
}

export interface RequestOptions {
  priority: 'event' | 'question';
  /** Soft timeout: the promise rejects with CoachTimeout, but the turn keeps running. */
  timeoutMs: number;
  /** Called if the reply lands after the soft timeout (the caller decides if it's still useful). */
  onLate?: (r: CoachReply) => void;
}

/** What CoachService needs from a session (a fake implements it in tests). */
export interface CoachSession {
  request(text: string, o: RequestOptions): Promise<CoachReply>;
  stop(): void;
  readonly running: boolean;
}

export class CoachTimeout extends Error {}
export class CoachError extends Error {}

export interface SessionOptions {
  model: string;
  effort: string;
  system: string;
  schema: unknown;
  cmd?: ClaudeCommand;
  /** A turn that takes longer than this kills the process (it restarts on the next request). */
  hardTimeoutMs?: number;
}

interface Item {
  text: string;
  o: RequestOptions;
  resolve: (r: CoachReply) => void;
  reject: (e: Error) => void;
  sentAt?: number;
  timedOut?: boolean;
  soft?: NodeJS.Timeout;
  hard?: NodeJS.Timeout;
}

export class ClaudeCoachSession implements CoachSession {
  private readonly o: Required<Omit<SessionOptions, 'cmd'>> & { cmd: ClaudeCommand };
  private child?: ChildProcess;
  private dir?: string;
  private buf = '';
  private queue: Item[] = [];
  private inFlight?: Item;
  private stopped = false;
  private stderr = '';
  /** How many processes this session has started (restarts after a crash count too). */
  starts = 0;

  constructor(o: SessionOptions) {
    this.o = { hardTimeoutMs: 60_000, ...o, cmd: o.cmd ?? claudeCommand() };
  }

  get running(): boolean { return !!this.child; }

  request(text: string, o: RequestOptions): Promise<CoachReply> {
    if (this.stopped) return Promise.reject(new CoachError('The coach session was stopped.'));
    return new Promise((resolve, reject) => {
      const item: Item = { text, o, resolve, reject };
      // Game events go ahead of questions; FIFO otherwise.
      const at = o.priority === 'event' ? this.queue.findIndex(q => q.o.priority === 'question') : -1;
      if (at >= 0) this.queue.splice(at, 0, item); else this.queue.push(item);
      this.pump();
    });
  }

  stop(): void {
    this.stopped = true;
    const err = new CoachError('The coach session was stopped.');
    for (const q of this.queue.splice(0)) q.reject(err);
    if (this.inFlight) this.finish(this.inFlight, undefined, err);
    this.kill();
  }

  // ---------------------------------------------------------------- internals

  private start(): void {
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csbot-coach-'));
    fs.writeFileSync(path.join(this.dir, 'system.md'), this.o.system);
    const args = [
      '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
      '--json-schema', JSON.stringify(this.o.schema), '--model', this.o.model, '--effort', this.o.effort,
      '--system-prompt-file', path.join(this.dir, 'system.md'),
      '--tools', '', '--strict-mcp-config', '--permission-mode', 'dontAsk', '--no-session-persistence',
    ];
    const child = spawn(this.o.cmd.command, [...this.o.cmd.prefix, ...args], { cwd: this.dir, env: childEnv(this.o.cmd), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.child = child;
    this.starts++;
    this.buf = '';
    this.stderr = '';
    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', (d: string) => this.read(d));
    child.stderr!.on('data', d => { if (this.stderr.length < 20_000) this.stderr += d; });
    child.stdin!.on('error', () => undefined);
    child.on('error', (e: NodeJS.ErrnoException) => {
      const msg = e.code === 'ENOENT' ? "Claude Code isn't installed on this PC." : `Couldn't start Claude Code: ${e.message}`;
      this.crashed(child, msg);
    });
    child.on('close', code => this.crashed(child, `Claude Code stopped (exit ${code ?? '?'})${this.stderr ? `: ${this.stderr.trim().split(/\r?\n/).pop()!.slice(0, 160)}` : ''}`));
  }

  private crashed(child: ChildProcess, msg: string): void {
    if (this.child !== child) return;
    this.child = undefined;
    this.cleanDir();
    if (this.inFlight) this.finish(this.inFlight, undefined, new CoachError(msg));
    // Restart lazily: the next queued request starts a fresh process.
    if (!this.stopped) setImmediate(() => this.pump());
  }

  private pump(): void {
    if (this.inFlight || this.stopped || !this.queue.length) return;
    const item = this.queue.shift()!;
    if (!this.child) {
      try { this.start(); } catch (e) { item.reject(new CoachError(`Couldn't start Claude Code: ${(e as Error).message}`)); this.pump(); return; }
    }
    this.inFlight = item;
    item.sentAt = Date.now();
    item.soft = setTimeout(() => {
      item.timedOut = true;
      item.reject(new CoachTimeout(`No answer within ${Math.round(item.o.timeoutMs / 1000)} s.`));
    }, item.o.timeoutMs);
    item.hard = setTimeout(() => {
      // Stuck: kill the process; the next request restarts it.
      const child = this.child;
      if (child) { killTree(child); this.crashed(child, 'Claude Code took too long and was restarted.'); }
    }, Math.max(this.o.hardTimeoutMs, item.o.timeoutMs));
    this.child!.stdin!.write(JSON.stringify({ type: 'user', message: { role: 'user', content: item.text } }) + '\n');
  }

  private read(d: string): void {
    this.buf += d;
    let nl;
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      if (!line.trim()) continue;
      let ev: { type?: string; is_error?: boolean; result?: unknown; structured_output?: unknown; total_cost_usd?: number; modelUsage?: Record<string, unknown> };
      try { ev = JSON.parse(line); } catch { continue; }
      if (ev.type !== 'result' || !this.inFlight) continue;
      const item = this.inFlight;
      if (ev.is_error) { this.finish(item, undefined, new CoachError(`Claude Code: ${String(ev.result ?? 'error').slice(0, 200)}`)); continue; }
      if (ev.structured_output === undefined) { this.finish(item, undefined, new CoachError('Claude Code returned no structured output.')); continue; }
      const reply: CoachReply = {
        structured: ev.structured_output,
        ms: Date.now() - (item.sentAt ?? Date.now()),
        ...(Object.keys(ev.modelUsage ?? {})[0] ? { model: Object.keys(ev.modelUsage!)[0]! } : { model: this.o.model }),
        ...(typeof ev.total_cost_usd === 'number' ? { costUsd: ev.total_cost_usd } : {}),
      };
      this.finish(item, reply);
    }
  }

  private finish(item: Item, reply?: CoachReply, err?: Error): void {
    if (item.soft) clearTimeout(item.soft);
    if (item.hard) clearTimeout(item.hard);
    if (this.inFlight === item) this.inFlight = undefined;
    if (item.timedOut) { if (reply) item.o.onLate?.(reply); }
    else if (reply) item.resolve(reply);
    else item.reject(err ?? new CoachError('Claude Code failed.'));
    this.pump();
  }

  private kill(): void {
    const child = this.child;
    this.child = undefined;
    if (child) { try { child.stdin?.end(); } catch { /* closed */ } killTree(child); }
    this.cleanDir();
  }

  private cleanDir(): void {
    if (this.dir) { try { fs.rmSync(this.dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch { /* best effort */ } }
    this.dir = undefined;
  }
}
