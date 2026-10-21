// Stand-in for `claude` in tests (CSBOT_CLAUDE_BIN). Never calls a model.
//
// One-shot mode (scouting report): behaves like `claude -p --output-format json --json-schema …`.
// Reads the prompt on stdin, prints one JSON result.
//   FAKE_CLAUDE_MODE  ok (default) | error | garbage | hang
//   FAKE_CLAUDE_DELAY ms before answering (default 300)
//   FAKE_CLAUDE_LOG   file to append {args, stdinBytes} to, so tests can check the command line
//
// Stream mode (live coach): `--input-format stream-json`. One JSON user message per stdin line; for
// each, a StructuredOutput tool_use then a `result` line with structured_output. A call for
// "Freeze time…" / "Intel in round…" / "The bomb…", an answer for "Question from…" and "ready" for the warm-up.
//   FAKE_COACH_DELAY        ms per turn (default 200)
//   FAKE_COACH_SLOW         ms per turn for freeze calls only (tests the timeout and late results)
//   FAKE_COACH_CRASH_AFTER  exit(1) after this many results (tests restarts)
//   FAKE_COACH_ERROR        answer every turn with is_error (tests the error path)

import fs from 'node:fs';

const args = process.argv.slice(2);
if (args.includes('--version')) {
  process.stdout.write('9.9.9 (fake Claude Code for csbot tests)\n');
  process.exit(0);
}
const log = rec => { if (process.env.FAKE_CLAUDE_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify(rec) + '\n'); };

if (args.includes('--input-format') && args[args.indexOf('--input-format') + 1] === 'stream-json') stream();
else oneShot();

function stream() {
  const model = args[args.indexOf('--model') + 1] ?? 'sonnet';
  log({ args, cwd: process.cwd(), pid: process.pid, mode: 'stream' });
  let buf = '', results = 0, cost = 0, chain = Promise.resolve();
  const out = o => process.stdout.write(JSON.stringify(o) + '\n');
  const answerFor = text => {
    if (text.startsWith('Freeze time')) {
      const round = /round (\d+)/.exec(text)?.[1] ?? '?';
      return { type: 'call', head: `Claude: stack B, round ${round}`, sub: 'Likely eco, hold long angles', setup: 'antieco',
        jobs: [{ slot: 'a', job: 'Hold A alone, fall back to CT' }, { slot: 'b', job: 'Anchor B van' }, { slot: 'ghost', job: 'dropped' }],
        steps: ['Long angles', 'Trade in pairs'], why: ['Enemy likely on eco'] };
    }
    if (text.startsWith('Intel in round')) return { type: 'call', head: 'Claude: rotate on the intel', sub: 'They committed, collapse', jobs: [{ slot: 'rotator', job: 'Rotate now, call when in' }, { slot: 'a', job: 'Hold A, watch for a fake' }], steps: ['Rotate', 'Trade'], why: ['Intel moved the forecast'] };
    if (text.startsWith('The bomb')) return { type: 'call', head: 'Claude: retake together', sub: 'Kit first, utility on site', jobs: [{ slot: 'a', job: 'Smoke the entrance' }], steps: ['Group up'], why: ['Bomb planted'] };
    if (text.startsWith('Question from')) {
      const q = /"([^"]*)"/.exec(text)?.[1] ?? '';
      return { type: 'answer', answer: `Answer to: ${q}` };
    }
    return { type: 'answer', answer: 'ready' };
  };
  const handle = line => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    const text = msg?.message?.content ?? '';
    log({ turn: text.slice(0, 40) });
    const delay = text.startsWith('Freeze time') && process.env.FAKE_COACH_SLOW ? Number(process.env.FAKE_COACH_SLOW) : Number(process.env.FAKE_COACH_DELAY ?? 200);
    chain = chain.then(() => new Promise(resolve => setTimeout(() => {
      if (results === 0) out({ type: 'system', subtype: 'init', model, tools: ['StructuredOutput'] });
      const structured = answerFor(text);
      out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'StructuredOutput', input: structured }] } });
      cost += 0.004;
      if (process.env.FAKE_COACH_ERROR) out({ type: 'result', subtype: 'error', is_error: true, result: 'Not logged in · Please run /login', total_cost_usd: cost });
      else out({ type: 'result', subtype: 'success', is_error: false, result: '', structured_output: structured, total_cost_usd: cost, modelUsage: { [`claude-fake-${model}`]: { inputTokens: 1, outputTokens: 1 } } });
      results++;
      if (process.env.FAKE_COACH_CRASH_AFTER && results >= Number(process.env.FAKE_COACH_CRASH_AFTER)) process.exit(1);
      resolve();
    }, delay)));
  };
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => {
    buf += d;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, nl); buf = buf.slice(nl + 1); if (line.trim()) handle(line); }
  });
  process.stdin.on('end', () => { void chain.then(() => process.exit(0)); });
}

function oneShot() {
  let stdin = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { stdin += d; });
  process.stdin.on('end', () => {
    log({ args, stdinBytes: stdin.length, cwd: process.cwd() });
    const mode = process.env.FAKE_CLAUDE_MODE ?? 'ok';
    if (mode === 'hang') { setInterval(() => {}, 1000); return; }
    setTimeout(() => {
      if (mode === 'garbage') { process.stdout.write('not json at all'); return; }
      if (mode === 'error') {
        process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login' }));
        return;
      }
      // The debrief's "work on next" asks for { team, you }.
      const schema = args[args.indexOf('--json-schema') + 1] ?? '';
      if (schema.includes('"you"')) {
        process.stdout.write(JSON.stringify({
          type: 'result', subtype: 'success', is_error: false, result: '', total_cost_usd: 0,
          modelUsage: { 'claude-fake-opus': { inputTokens: 1, outputTokens: 1 } },
          structured_output: { team: ['Save on T when their read is a full buy.', 'Log intel earlier.'], you: ['Play the second angle on A.'] },
        }));
        return;
      }
      process.stdout.write(JSON.stringify({
        type: 'result', subtype: 'success', is_error: false, result: '', total_cost_usd: 0,
        modelUsage: { 'claude-fake-opus': { inputTokens: 1, outputTokens: 1 } },
        structured_output: {
          summary: 'team_kappa averages 2,108 ELO to our 2,034. Holo, their likely AWP, leads them.',
          things: ['Holo is their biggest threat.', 'Holo, vex and Okami queue together.', 'Mirage favours us.'],
          plan: ['Never dry-peek Holo.', 'Trade in pairs.'],
          veto: 'Ban Ancient and Train, then pick Mirage.',
          tips: [
            { player: 'Holo', tip: 'Use utility before peeking him and always trade.' },
            { player: 'sk1p', tip: 'Keep crosshairs at head height.' },
            { player: 'NotOnTheRoster', tip: 'should be dropped' },
          ],
        },
      }));
    }, Number(process.env.FAKE_CLAUDE_DELAY ?? 300));
  });
}
