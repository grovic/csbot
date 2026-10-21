// Fails if anything shaped like an API key is in a tracked file. Runs in CI on every PR and push.
// Real keys only ever live in the desktop app's encrypted store (%APPDATA%\csbot\secrets.json),
// outside the repo; this is the backstop in case one gets pasted somewhere by mistake.
//   node tools/check-secrets.mjs

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const PATTERNS = [
  // Steam Web API keys: 32 uppercase hex characters.
  { name: 'Steam Web API key', re: /(?<![0-9A-Za-z])[0-9A-F]{32}(?![0-9A-Za-z])/g },
  // FACEIT keys are UUIDs. FACEIT match ids look like "1-<uuid>", so a UUID right after "1-" is a match id.
  { name: 'FACEIT API key (UUID)', re: /(?<![0-9A-Za-z-]|1-)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![0-9A-Za-z])/gi },
  // Hard-coded bearer tokens and Anthropic keys.
  { name: 'Bearer token', re: /Bearer\s+[A-Za-z0-9._~+/-]{20,}=*/g },
  { name: 'Anthropic API key', re: /sk-ant-[A-Za-z0-9_-]{20,}/g },
];

/** Fictional or public values that look like keys (add with a comment saying why). */
const ALLOW = new Set([
  '00000000-0000-4000-8000-000000000001', // sample FACEIT match id (fictional)
  '0b1c2d3e-aaaa-bbbb-cccc-1234567890ab', // fake FACEIT key in desktop tests
  'ABCDEF0123456789ABCDEF0123456789', // fake Steam key in desktop tests
]);

const SKIP = [/^pnpm-lock\.yaml$/, /\.(png|jpe?g|ico|woff2?)$/i, /^tools\/check-secrets\.mjs$/];

const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(f => f && !SKIP.some(s => s.test(f)));
const hits = [];
for (const f of files) {
  let text;
  try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
  text.split('\n').forEach((line, i) => {
    for (const p of PATTERNS) {
      for (const m of line.matchAll(p.re)) {
        if (ALLOW.has(m[0])) continue;
        hits.push(`${f}:${i + 1}  ${p.name}: ${m[0].slice(0, 6)}…`);
      }
    }
  });
}

if (hits.length) {
  console.error(`Possible secrets in tracked files (${hits.length}):\n  ${hits.join('\n  ')}\nRemove them, or allowlist a fictional value in tools/check-secrets.mjs with a comment.`);
  process.exit(1);
}
console.log(`check-secrets: ${files.length} tracked files, nothing key-shaped.`);
