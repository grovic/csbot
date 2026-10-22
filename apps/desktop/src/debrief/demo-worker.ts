// The demo reader process (see demo.ts): parse one demo, send the truth (and the 2D replay) back, exit.
// It runs as Electron's utility process in the app (process.parentPort) or a forked Node process in
// tests (process.send).
import * as demo from '@csbot/demo';

type Port = { postMessage(m: unknown): void };
const file = process.argv[2] ?? '';
const parentPort = (process as unknown as { parentPort?: Port }).parentPort;

function answer(m: unknown): void {
  if (parentPort) { parentPort.postMessage(m); setTimeout(() => process.exit(0), 50); return; }
  if (process.send) { process.send(m, () => process.exit(0)); return; }
  process.exit(1);
}

try {
  const truth = demo.parseDemo(file);
  // The 2D replay is a bonus: a demo that can't give one still gives the truth.
  let replay: unknown;
  try { replay = 'parseReplay' in demo ? (demo as unknown as { parseReplay(f: string): unknown }).parseReplay(file) : undefined; } catch { replay = undefined; }
  answer({ ok: true, truth, replay });
} catch (e) {
  answer({ ok: false, error: (e as Error).message });
}
