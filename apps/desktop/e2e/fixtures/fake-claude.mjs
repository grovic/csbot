// Stand-in for `claude` in tests (CSBOT_CLAUDE_BIN). Never calls a model. Behaves like
// `claude -p --output-format json --json-schema …`: reads the prompt on stdin, prints one JSON result.
//   FAKE_CLAUDE_MODE  ok (default) | error | garbage | hang
//   FAKE_CLAUDE_DELAY ms before answering (default 300)
//   FAKE_CLAUDE_LOG   file to append {args, stdinBytes} to, so tests can check the command line

import fs from 'node:fs';

const args = process.argv.slice(2);
if (args.includes('--version')) {
  process.stdout.write('9.9.9 (fake Claude Code for csbot tests)\n');
  process.exit(0);
}

let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { stdin += d; });
process.stdin.on('end', () => {
  if (process.env.FAKE_CLAUDE_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ args, stdinBytes: stdin.length, cwd: process.cwd() }) + '\n');
  const mode = process.env.FAKE_CLAUDE_MODE ?? 'ok';
  if (mode === 'hang') { setInterval(() => {}, 1000); return; }
  setTimeout(() => {
    if (mode === 'garbage') { process.stdout.write('not json at all'); return; }
    if (mode === 'error') {
      process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login' }));
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
