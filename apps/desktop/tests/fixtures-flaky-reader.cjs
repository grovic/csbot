// A demo reader that crashes on its first run and answers on the second (demo.ts retries a crash once).
const fs = require('node:fs');
const marker = process.env.FLAKY_MARKER;
if (!fs.existsSync(marker)) { fs.writeFileSync(marker, 'crashed once'); process.exit(3); }
const truth = { source: { file: 'x.dem', parsedAt: 0, bytes: 1 }, map: 'de_mirage', players: [], rounds: [] };
process.send({ ok: true, truth }, () => process.exit(0));
