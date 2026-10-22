// Reading a match demo: decompressed first when it's .gz or .zst (FACEIT), then parsed by the demo
// parser in a worker thread, so a 60-200 MB demo never blocks the app (or the GSI server).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Worker } from 'node:worker_threads';
import zlib from 'node:zlib';
import type { DemoReplay, DemoTruth } from '@csbot/protocol';

/** The worker bundle sits next to main.cjs (dist/demo-worker.cjs); tests point at the built one. */
const workerFile = () => process.env.CSBOT_DEMO_WORKER ?? path.join(__dirname, 'demo-worker.cjs');

async function decompressed(file: string): Promise<{ file: string; cleanup: () => void }> {
  const gz = /\.gz$/i.test(file), zst = /\.zst$/i.test(file);
  if (!gz && !zst) return { file, cleanup: () => {} };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csbot-demo-'));
  const out = path.join(dir, path.basename(file).replace(/\.(gz|zst)$/i, ''));
  await pipeline(fs.createReadStream(file), gz ? zlib.createGunzip() : zlib.createZstdDecompress(), fs.createWriteStream(out));
  return { file: out, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

export async function parseDemoFile(file: string, timeoutMs = 180_000): Promise<{ truth: DemoTruth; replay?: DemoReplay }> {
  const d = await decompressed(file);
  try {
    const { truth, replay } = await new Promise<{ truth: DemoTruth; replay?: DemoReplay }>((resolve, reject) => {
      const w = new Worker(workerFile(), { workerData: { file: d.file } });
      const timer = setTimeout(() => { void w.terminate(); reject(new Error('reading the demo took too long')); }, timeoutMs);
      w.once('message', (m: { ok: boolean; truth?: DemoTruth; replay?: DemoReplay; error?: string }) => {
        clearTimeout(timer);
        void w.terminate();
        if (m.ok && m.truth) resolve({ truth: m.truth, ...(m.replay ? { replay: m.replay } : {}) }); else reject(new Error(m.error ?? 'unknown error'));
      });
      w.once('error', e => { clearTimeout(timer); reject(e); });
    });
    // Keep the original file name (not the temp copy) in the record.
    return { truth: { ...truth, source: { ...truth.source, file: path.basename(file), bytes: fs.statSync(file).size } }, ...(replay ? { replay } : {}) };
  } finally {
    d.cleanup();
  }
}
