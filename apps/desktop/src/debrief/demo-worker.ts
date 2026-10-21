// Worker thread: parse one demo and post the truth back (see demo.ts).
import { parentPort, workerData } from 'node:worker_threads';
import { parseDemo } from '@csbot/demo';

const { file } = workerData as { file: string };
try {
  parentPort!.postMessage({ ok: true, truth: parseDemo(file) });
} catch (e) {
  parentPort!.postMessage({ ok: false, error: (e as Error).message });
}
