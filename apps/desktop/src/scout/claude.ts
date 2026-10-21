// Runs the AI scouting report on the user's own Claude Code (their claude.ai login).
// AGENTS.md: spawn the user's own unmodified `claude`, never touch its credentials, never --bare.
// It runs in an empty app-owned temp dir with every built-in tool off, so it can only answer.

import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ANALYST_SCHEMA, ANALYST_SYSTEM, analystInput, parseAnalyst } from '@csbot/scout';
import type { ScoutReport, ScoutView } from '@csbot/protocol';

export interface ClaudeCommand {
  command: string;
  /** Arguments that go before csbot's own (a script path when the command is Node). */
  prefix: string[];
  /** Extra env for the child. */
  env: Record<string, string>;
}

/**
 * The `claude` on PATH, or CSBOT_CLAUDE_BIN (tests point it at a fake). A .js/.mjs/.cjs override
 * runs on this process's own runtime (Electron as Node, or Node in unit tests).
 */
export function claudeCommand(env: NodeJS.ProcessEnv = process.env): ClaudeCommand {
  const override = env.CSBOT_CLAUDE_BIN;
  if (override && /\.(c|m)?js$/i.test(override)) return { command: process.execPath, prefix: [override], env: { ELECTRON_RUN_AS_NODE: '1' } };
  return { command: override || 'claude', prefix: [], env: {} };
}

export function childEnv(cmd: ClaudeCommand): NodeJS.ProcessEnv {
  // Inherit the user's environment unchanged (their login, their PATH). Only drop the flag that would
  // turn an Electron-based launcher into plain Node; a Node-script override sets it back on purpose.
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  return { ...env, ...cmd.env };
}

export function killTree(child: ChildProcess): void {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch { /* gone */ }
  } else child.kill('SIGKILL');
}

interface Run { code: number | null; stdout: string; stderr: string; timedOut: boolean }

function run(cmd: ClaudeCommand, args: string[], o: { stdin?: string; cwd?: string; timeoutMs: number }): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd.command, [...cmd.prefix, ...args], { cwd: o.cwd, env: childEnv(cmd), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '', stderr = '', timedOut = false;
    child.stdout.on('data', d => { if (stdout.length < 4_000_000) stdout += d; });
    child.stderr.on('data', d => { if (stderr.length < 100_000) stderr += d; });
    child.on('error', reject);
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, o.timeoutMs);
    child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(o.stdin ?? '');
  });
}

/** Is Claude Code installed? Asked once at startup. */
export async function detectClaude(cmd = claudeCommand(), timeoutMs = 8000): Promise<{ found: boolean; version?: string }> {
  try {
    const r = await run(cmd, ['--version'], { timeoutMs });
    const version = r.stdout.trim().split(/\r?\n/)[0];
    return r.code === 0 && !r.timedOut ? { found: true, ...(version ? { version } : {}) } : { found: false };
  } catch {
    return { found: false };
  }
}

export interface AnalystOptions { model?: string; effort?: string; timeoutMs?: number }
export type AnalystResult = Pick<ScoutReport, 'summary' | 'things' | 'plan' | 'veto' | 'tips'> & { model: string; ms: number };

export class AnalystError extends Error {}

/**
 * One structured call on the user's Claude Code: `claude -p --output-format json --json-schema …`, the
 * system prompt from a file, the input on stdin, every tool off, in an empty temp dir.
 */
export async function runClaudeJson(o: { system: string; schema: object; input: string; model: string; effort: string; timeoutMs: number; tag: string }, cmd = claudeCommand()): Promise<{ output: unknown; model: string; ms: number }> {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), `csbot-${o.tag}-`));
  const t0 = Date.now();
  try {
    fs.writeFileSync(path.join(work, 'system.md'), o.system);
    const args = [
      '-p', '--output-format', 'json', '--json-schema', JSON.stringify(o.schema),
      '--model', o.model, '--effort', o.effort,
      '--system-prompt-file', path.join(work, 'system.md'),
      '--tools', '', '--strict-mcp-config', '--permission-mode', 'dontAsk', '--no-session-persistence',
    ];
    let r: Run;
    try {
      r = await run(cmd, args, { stdin: o.input, cwd: work, timeoutMs: o.timeoutMs });
    } catch (e) {
      throw new AnalystError((e as NodeJS.ErrnoException).code === 'ENOENT' ? "Claude Code isn't installed on this PC." : `Couldn't start Claude Code: ${(e as Error).message}`);
    }
    const ms = Date.now() - t0;
    if (r.timedOut) throw new AnalystError(`Claude Code took longer than ${Math.round(o.timeoutMs / 1000)} s.`);
    let out: { is_error?: boolean; result?: unknown; structured_output?: unknown; modelUsage?: Record<string, unknown> };
    try { out = JSON.parse(r.stdout); } catch { throw new AnalystError(r.code === 0 ? 'Claude Code returned something that isn\'t JSON.' : `Claude Code stopped (exit ${r.code}).`); }
    if (out.is_error) throw new AnalystError(`Claude Code: ${String(out.result ?? 'error').slice(0, 200)}`);
    if (out.structured_output === undefined) throw new AnalystError('Claude Code returned no structured answer.');
    return { output: out.structured_output, model: Object.keys(out.modelUsage ?? {})[0] ?? o.model, ms };
  } finally {
    fs.rmSync(work, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
}

/** The scouting report: the scouting file on stdin, the analyst schema back. */
export async function runAnalyst(view: ScoutView, cmd = claudeCommand(), o: AnalystOptions = {}): Promise<AnalystResult> {
  const r = await runClaudeJson({
    system: ANALYST_SYSTEM, schema: ANALYST_SCHEMA, input: 'Scouting file for the next match:\n' + analystInput(view),
    model: o.model ?? 'opus', effort: o.effort ?? 'high', timeoutMs: o.timeoutMs ?? 90_000, tag: 'analyst',
  }, cmd);
  let parsed: ReturnType<typeof parseAnalyst>;
  try { parsed = parseAnalyst(r.output, view); } catch { throw new AnalystError("Claude Code's report didn't match the expected format."); }
  return { ...parsed, model: r.model, ms: r.ms };
}
