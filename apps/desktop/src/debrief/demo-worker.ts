// Worker thread: parse one demo and post the truth back (see demo.ts).
import { parentPort, workerData } from 'node:worker_threads';
import * as demo from '@csbot/demo';

const { file } = workerData as { file: string };
try {
  const truth = demo.parseDemo(file);
  // The 2D replay is a bonus: a demo that can't give one still gives the truth.
  let replay: unknown;
  try { replay = 'parseReplay' in demo ? (demo as unknown as { parseReplay(f: string): unknown }).parseReplay(file) : undefined; } catch { replay = undefined; }
  parentPort!.postMessage({ ok: true, truth, replay });
} catch (e) {
  parentPort!.postMessage({ ok: false, error: (e as Error).message });
}
