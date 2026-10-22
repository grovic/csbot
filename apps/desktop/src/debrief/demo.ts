// Reading a match demo: decompressed first when it's .gz or .zst (FACEIT), then parsed by the demo
// parser in its own process, so a 60-200 MB demo never blocks the app (or the GSI server), and a
// parser crash never takes the app down.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fork } from 'node:child_process';
import zlib from 'node:zlib';
import type { DemoReplay, DemoTruth } from '@csbot/protocol';

/** The reader bundle sits next to main.cjs (dist/demo-worker.cjs); tests point at the built one. */
const workerFile = () => process.env.CSBOT_DEMO_WORKER ?? path.join(__dirname, 'demo-worker.cjs');

async function decompressed(file: string): Promise<{ file: string; cleanup: () => void }> {
  const gz = /\.gz$/i.test(file), zst = /\.zst$/i.test(file);
  if (!gz && !zst) return { file, cleanup: () => {} };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csbot-demo-'));
  const out = path.join(dir, path.basename(file).replace(/\.(gz|zst)$/i, ''));
  await pipeline(fs.createReadStream(file), gz ? zlib.createGunzip() : zlib.createZstdDecompress(), fs.createWriteStream(out));
  return { file: out, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

type ReaderMessage = { ok: boolean; truth?: DemoTruth; replay?: DemoReplay; error?: string };

/**
 * One reading in its own process: Electron's utility process in the app, a forked Node process under
 * plain Node (tests). The native parser crashed now and then under load when it ran in a worker
 * thread (M8), and a crash there takes the whole app down; in its own process it only fails this try.
 */
async function readOnce(file: string, timeoutMs: number): Promise<ReaderMessage | 'crashed'> {
  const electron = process.versions.electron ? await import('electron') : undefined;
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (v: ReaderMessage | 'crashed' | Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (v instanceof Error) reject(v); else resolve(v);
    };
    let kill: () => void;
    if (electron?.utilityProcess) {
      const child = electron.utilityProcess.fork(workerFile(), [file], { serviceName: 'csbot demo reader', stdio: 'ignore' });
      kill = () => { child.kill(); };
      child.on('message', (m: ReaderMessage) => done(m));
      child.on('exit', code => done(code === 0 ? new Error('the demo reader stopped without an answer') : 'crashed'));
    } else {
      const child = fork(workerFile(), [file], { stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
      kill = () => { child.kill(); };
      child.on('message', m => done(m as ReaderMessage));
      child.on('error', e => done(e));
      child.on('exit', code => done(code === 0 ? new Error('the demo reader stopped without an answer') : 'crashed'));
    }
    const timer = setTimeout(() => { kill(); done(new Error('reading the demo took too long')); }, timeoutMs);
  });
}

export async function parseDemoFile(file: string, timeoutMs = 180_000): Promise<{ truth: DemoTruth; replay?: DemoReplay }> {
  const d = await decompressed(file);
  try {
    // A crash is retried once; a demo the parser refuses is not.
    let m = await readOnce(d.file, timeoutMs);
    if (m === 'crashed') m = await readOnce(d.file, timeoutMs);
    if (m === 'crashed') throw new Error('the demo reader crashed twice');
    if (!m.ok || !m.truth) throw new Error(m.error ?? 'unknown error');
    const { truth, replay } = m;
    // Keep the original file name (not the temp copy) in the record.
    return { truth: { ...truth, source: { ...truth.source, file: path.basename(file), bytes: fs.statSync(file).size } }, ...(replay ? { replay } : {}) };
  } finally {
    d.cleanup();
  }
}
