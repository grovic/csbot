// Minimal csbot MCP server for the latency spike (stdio). The product uses streamable HTTP on localhost.
// argv[2] = state.json path (match state the host writes), argv[3] = calls.ndjson path (published calls).
// CSBOT_LIVE=1 is the live-path variant: no state tool (facts come in the prompt), loose schema.
import fs from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const [statePath, callsPath] = process.argv.slice(2);
const LIVE = process.env.CSBOT_LIVE === '1';
const server = new McpServer({ name: 'csbot', version: '0.0.0' });

if (!LIVE) server.registerTool('get_match_state', {
  description: 'Full current match state: score, round, phase, economy model, forecast, room members and their positions.',
  inputSchema: {},
}, async () => ({ content: [{ type: 'text', text: fs.readFileSync(statePath, 'utf8') }] }));

// Limits live in the descriptions and are enforced by trimming here: a schema rejection makes the model retry (seconds lost).
const trim = (v, n) => (typeof v === 'string' && v.length > n ? v.slice(0, n - 1) + '…' : v);
const job = z.string().describe('max 12 words');
server.registerTool('publish_call', {
  description: 'Publish the round call to every screen in the room. Call exactly once per request.',
  inputSchema: {
    head: z.string().describe('Team headline, max 6 words, e.g. "Anti-eco · stack B"'),
    sub: z.string().describe('max 10 words'),
    jobs: z.object({ rdx: job, kairo: job, nyx: job, mbt: job, zeph: job }).describe('One short job per player'),
    steps: z.array(z.string()).describe('at most 3 chips of max 4 words'),
  },
}, async (args) => {
  const call = {
    head: trim(args.head, 48),
    sub: trim(args.sub, 80),
    jobs: Object.fromEntries(Object.entries(args.jobs).map(([k, v]) => [k, trim(v, 90)])),
    steps: (args.steps ?? []).slice(0, 3).map((v) => trim(v, 32)),
  };
  fs.appendFileSync(callsPath, JSON.stringify({ t: Date.now(), call }) + '\n');
  return { content: [{ type: 'text', text: 'published to 4 screens' }] };
});

await server.connect(new StdioServerTransport());
