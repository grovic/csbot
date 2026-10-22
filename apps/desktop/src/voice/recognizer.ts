// Runs the speech helper (script.ts) and talks to it: one request at a time, answers matched by id.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { HELPER_FILE, HELPER_PS1 } from './script.ts';

export interface Heard { text: string; confidence: number; grammar?: string }

export interface Recognizer {
  /** Starts the helper; rejects with a sentence the user can act on. */
  start(): Promise<void>;
  setPhrases(phrases: readonly string[], question: string): Promise<void>;
  /** One utterance from the microphone (or a WAV file in tests); nothing heard = undefined. */
  listen(file?: string): Promise<Heard | undefined>;
  dispose(): void;
}

type Msg = { ev: string; id?: number; text?: string; confidence?: number; grammar?: string; error?: string; culture?: string };

export class SpeechHelper implements Recognizer {
  private proc?: ChildProcessWithoutNullStreams;
  private ready?: Promise<void>;
  private next = 1;
  private waiting = new Map<number, { resolve: (m: Msg) => void; reject: (e: Error) => void }>();

  private readonly o: { dir: string; culture?: string; log?: (m: string) => void; powershell?: string };
  constructor(o: { dir: string; culture?: string; log?: (m: string) => void; powershell?: string }) { this.o = o; }

  start(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise<void>((resolve, reject) => {
      if (process.platform !== 'win32') { reject(new Error('Push-to-talk needs Windows speech recognition.')); return; }
      const file = path.join(this.o.dir, HELPER_FILE);
      try {
        fs.mkdirSync(this.o.dir, { recursive: true });
        if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== HELPER_PS1) fs.writeFileSync(file, HELPER_PS1, 'utf8');
      } catch (e) { reject(new Error(`Couldn't write the speech helper: ${(e as Error).message}`)); return; }
      const exe = this.o.powershell ?? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      const p = spawn(exe, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], {
        windowsHide: true, stdio: 'pipe', env: { ...process.env, ...(this.o.culture ? { CSBOT_VOICE_CULTURE: this.o.culture } : {}) },
      });
      this.proc = p;
      let started = false;
      const fail = (e: Error) => {
        for (const w of this.waiting.values()) w.reject(e);
        this.waiting.clear();
        if (!started) reject(e);
      };
      p.on('error', e => fail(new Error(`Couldn't start Windows PowerShell: ${e.message}`)));
      p.on('exit', code => { this.proc = undefined; this.ready = undefined; fail(new Error(`The speech helper stopped (code ${code}).`)); });
      p.stderr.on('data', (d: Buffer) => this.o.log?.(`voice helper: ${d.toString('utf8').trim().slice(0, 300)}`));
      readline.createInterface({ input: p.stdout }).on('line', line => {
        let m: Msg;
        try { m = JSON.parse(line.replace(/^\uFEFF/, '')) as Msg; } catch { return; }
        if (!started) {
          started = true;
          if (m.ev === 'ready') resolve(); else { reject(new Error(m.error ?? 'The speech helper failed to start.')); p.kill(); }
          return;
        }
        const w = m.id !== undefined ? this.waiting.get(m.id) : undefined;
        if (!w) { if (m.ev === 'error') this.o.log?.(`voice helper: ${m.error}`); return; }
        this.waiting.delete(m.id!);
        if (m.ev === 'error') w.reject(new Error(m.error ?? 'speech error')); else w.resolve(m);
      });
    });
    this.ready.catch(() => { this.ready = undefined; });
    return this.ready;
  }

  private async request(op: Record<string, unknown>): Promise<Msg> {
    await this.start();
    const id = this.next++;
    return new Promise<Msg>((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.proc!.stdin.write(JSON.stringify({ ...op, id }) + '\n');
    });
  }

  async setPhrases(phrases: readonly string[], question: string): Promise<void> {
    await this.request({ op: 'grammar', phrases, question });
  }

  async listen(file?: string): Promise<Heard | undefined> {
    const m = await this.request({ op: 'listen', ...(file ? { file } : {}) });
    return m.ev === 'heard' && typeof m.text === 'string' ? { text: m.text, confidence: m.confidence ?? 0, ...(m.grammar ? { grammar: m.grammar } : {}) } : undefined;
  }

  dispose(): void {
    const p = this.proc;
    this.proc = undefined;
    this.ready = undefined;
    if (!p) return;
    try { p.stdin.write('{"op":"quit"}\n'); } catch { /* gone */ }
    setTimeout(() => { try { p.kill(); } catch { /* gone */ } }, 1500).unref();
  }
}

/** A stand-in for tests and hidden runs: answers each listen with the next scripted line. */
export class FakeRecognizer implements Recognizer {
  phrases: string[] = [];
  private readonly lines: string[];
  constructor(lines: string[]) { this.lines = [...lines]; }
  async start(): Promise<void> {}
  async setPhrases(phrases: readonly string[]): Promise<void> { this.phrases = [...phrases]; }
  async listen(): Promise<Heard | undefined> {
    const text = this.lines.shift();
    return text ? { text, confidence: 0.95, grammar: /^coach\b/i.test(text) ? 'question' : 'phrases' } : undefined;
  }
  dispose(): void {}
}
