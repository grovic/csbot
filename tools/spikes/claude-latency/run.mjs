// Spike: warm `claude -p` stream-json session + MCP publish_call. Measures event → call on screen.
// Usage: node run.mjs [models=haiku,sonnet]. Writes results.json and prints a table.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const models = (process.argv[2] ?? 'haiku,sonnet').split(',');
const LIVE = process.argv[3] === 'live'; // v2: no state tool, warm-up turn first

const WARMUP = { label: 'warm-up (match start)', state: {}, ask: 'Match starting on de_mirage, we are CT. Reply with the single word: ready. Do not call any tool.' };
const ROUNDS0 = [
  { label: 'R9 freeze (enemy eco read)', state: { round: 9, phase: 'freezetime', score: '5-3', side: 'CT', enemy: { money: '$1,450–2,800 each', buy: { eco: 0.55, force: 0.32, half: 0.12, full: 0.01 }, lossStreak: 1 }, plans: { bRush: 0.41, aExec: 0.17, bExec: 0.16, slowB: 0.16, split: 0.1 }, randoms: ['zeph'] },
    ask: 'Round 9 freeze time just started. Enemy economy read: eco 55% ($1,450–2,800 each). Playbook options: antieco (stack B 3–2) or std (2-1-2). Publish the call.' },
  { label: 'R9 live intel (3 at B apps)', state: { round: 9, phase: 'live', clock: '1:39', intel: [{ by: 'kairo', zone: 'B Apps', count: 3, t: 16 }], site: { A: 0.06, B: 0.94 }, topPlan: 'bRush' },
    ask: 'Live 1:39. kairo logged 3 enemies at B Apps. Forecast now B 94% (B apps rush). rdx is the A player. Publish the updated call.' },
  { label: 'R10 freeze (full buy read)', state: { round: 10, phase: 'freezetime', score: '6-3', enemy: { money: '$2,750–4,900 each', buy: { full: 0.49, half: 0.25, force: 0.19, eco: 0.07 }, saved: true } },
    ask: 'Round 10 freeze time. We won R9. Enemy saved and now reads full buy 49%. After a save they open A 41%. Publish the call.' },
];

const ROUNDS = LIVE ? [WARMUP, ...ROUNDS0] : ROUNDS0;
const SYSTEM = `You are the live coach inside csbot, a second-screen app for a CS2 squad (rdx, kairo, nyx, mbt; zeph is a random who is not in the room).
Every request is a game event. Answer ONLY by calling the publish_call tool exactly once, with a short team headline, one sub-line, one job per player (max 12 words each) and at most 3 short steps.
Use only facts from the request${LIVE ? '' : ' or get_match_state'}. Never invent stats. Do not write any other text.`;

function runModel(model) {
  return new Promise((resolve, reject) => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'csbot-spike-'));
    const statePath = path.join(work, 'state.json'), callsPath = path.join(work, 'calls.ndjson');
    fs.writeFileSync(callsPath, '');
    const mcp = { mcpServers: { csbot: { command: process.execPath, args: [path.join(here, 'mcp-server.mjs'), statePath, callsPath] } } };
    fs.writeFileSync(path.join(work, 'mcp.json'), JSON.stringify(mcp));
    fs.writeFileSync(path.join(work, 'system.md'), SYSTEM);
    const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
      '--model', model, '--effort', 'low', '--system-prompt-file', path.join(work, 'system.md'),
      '--mcp-config', path.join(work, 'mcp.json'), '--strict-mcp-config',
      '--tools', '', '--allowedTools', 'mcp__csbot__*', '--permission-mode', 'dontAsk', '--no-session-persistence'];
    const t0 = Date.now();
    const child = spawn('claude', args, { cwd: work, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, CSBOT_LIVE: LIVE ? '1' : '0' } });
    const res = { model, initMs: null, rounds: [], stderr: '' };
    let buf = '', i = -1, sentAt = 0, cur = null;
    const sendNext = () => {
      i++;
      if (i >= ROUNDS.length) { child.stdin.end(); return; }
      const r = ROUNDS[i];
      fs.writeFileSync(statePath, JSON.stringify(r.state));
      cur = { label: r.label, toolMs: null, resultMs: null, toolCalls: [], costUsd: null, inTokens: null, outTokens: null, cacheRead: null };
      sentAt = Date.now();
      child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: r.ask } }) + '\n');
    };
    child.stdout.on('data', d => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === 'system' && ev.subtype === 'init' && res.initMs === null) {
          res.initMs = Date.now() - t0;
          res.mcp = ev.mcp_servers; res.tools = (ev.tools || []).filter(t => t.startsWith('mcp__'));
        }
        if (ev.type === 'assistant' && cur) {
          for (const c of ev.message?.content ?? []) if (c.type === 'tool_use') {
            cur.toolCalls.push(c.name);
            if (c.name === 'mcp__csbot__publish_call' && cur.toolMs === null) { cur.toolMs = Date.now() - sentAt; cur.call = c.input; }
          }
        }
        if (ev.type === 'result' && cur) {
          cur.resultMs = Date.now() - sentAt; cur.costUsd = ev.total_cost_usd; cur.isError = ev.is_error;
          cur.inTokens = ev.usage?.input_tokens; cur.outTokens = ev.usage?.output_tokens; cur.cacheRead = ev.usage?.cache_read_input_tokens; cur.cacheWrite = ev.usage?.cache_creation_input_tokens;
          res.rounds.push(cur); cur = null; sendNext();
        }
      }
    });
    child.stderr.on('data', d => { res.stderr += d; });
    // stream-json input: the session starts on the first message, so round 1 includes the cold start.
    sendNext();
    child.on('error', reject);
    child.on('close', code => { res.exit = code; res.totalMs = Date.now() - t0; res.published = fs.readFileSync(callsPath, 'utf8').trim().split('\n').filter(Boolean).length; fs.rmSync(work, { recursive: true, force: true }); resolve(res); });
    setTimeout(() => { child.kill(); }, 240000).unref();
  });
}

const all = [];
for (const m of models) { console.log(`running ${m}…`); all.push(await runModel(m)); }
fs.writeFileSync(path.join(here, LIVE ? 'results-live.json' : 'results.json'), JSON.stringify(all, null, 2));
for (const r of all) {
  console.log(`\n${r.model}: init ${r.initMs} ms · exit ${r.exit} · published ${r.published} · mcp ${JSON.stringify(r.mcp)}`);
  for (const x of r.rounds) console.log(`  ${x.label.padEnd(30)} call on screen ${String(x.toolMs).padStart(6)} ms · turn done ${String(x.resultMs).padStart(6)} ms · tools ${x.toolCalls.join(',')} · in ${x.inTokens} cache ${x.cacheRead}/${x.cacheWrite} out ${x.outTokens} · est $${x.costUsd}`);
  if (r.stderr) console.log('  stderr:', r.stderr.slice(0, 400));
}
