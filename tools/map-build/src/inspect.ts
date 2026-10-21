// Print a map's zones and, if it has plays, check them and show when each plan's players reach
// each zone. For writing packages/engine/src/maps/plays/<map>.ts.
//
//   node tools/map-build/src/inspect.ts de_inferno

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildMapModel, defenseShare, zoneAt, zoneSides, type MapGeo, type MapPlans, type PlaybookDef } from '@csbot/engine';
import { validatePlays } from '@csbot/engine';

const id = process.argv[2];
if (!id) throw new Error('usage: inspect.ts <map id>');
const engine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../packages/engine/src/maps');
const geoMod = await import(pathToFileURL(path.join(engine, 'geo', `${id}.ts`)).href) as Record<string, MapGeo>;
const geo = Object.values(geoMod)[0]!;

console.log(`${geo.name} (${geo.id}): ${geo.zones.length} zones. Earliest arrival from spawn, knife out: T / CT seconds. Side = which site a CT holding there counts toward.`);
const sides = zoneSides(geo);
for (const z of geo.zones) {
  const [t, ct] = geo.arrive[z.id] ?? [-1, -1];
  console.log(`  ${z.id.padEnd(15)} ${z.name.padEnd(16)} ${z.site ? `site ${z.site}` : '      '}  T ${String(t).padStart(5)}  CT ${String(ct).padStart(5)}  side ${String(sides[z.id]).padEnd(3)}${z.level ? '  (lower level)' : ''}`);
}

const playsFile = path.join(engine, 'plays', `${id}.ts`);
if (!fs.existsSync(playsFile)) { console.log(`\nNo plays yet (${path.relative(process.cwd(), playsFile)}).`); process.exit(0); }
const mod = await import(pathToFileURL(playsFile).href) as Record<string, unknown>;
const plans = Object.values(mod).find(v => (v as MapPlans).routes) as MapPlans;
const playbook = Object.values(mod).find(v => (v as PlaybookDef).setups) as PlaybookDef;
const problems = validatePlays(geo, plans, playbook);
console.log(problems.length ? `\nProblems:\n${problems.map(p => '  - ' + p).join('\n')}` : '\nPlays check out.');
if (problems.length && problems.some(p => p.includes('unknown zone') || p.includes('no path'))) process.exit(1);

const model = buildMapModel(geo, plans);
console.log('\nRoutes (zone entered @ seconds at knife speed):');
for (const [rid, r] of Object.entries(model.routes)) {
  const seen: string[] = [];
  for (const w of r) { const z = zoneAt(geo, w[0], w[1])?.id ?? '·'; if (!seen.length || !seen[seen.length - 1]!.startsWith(z + '@')) seen.push(`${z}@${w[2]}`); }
  console.log(`  ${rid.padEnd(4)} ${seen.join(' → ')}`);
}
console.log('\nPlans: when each player reaches the plan site (seconds since live, at the plan pace):');
for (const p of model.plans) {
  const site = p.site === 'A' ? 'asite' : 'bsite';
  const times = p.lineup.map((rid, i) => {
    const r = model.routes[rid]!;
    const w = r.find(q => zoneAt(geo, q[0], q[1])?.id === site);
    return w ? (p.delay[i]! + w[2] / p.speed).toFixed(0) + 's' : '—';
  });
  console.log(`  ${p.id.padEnd(10)} ${p.site} speed ${p.speed}  ${times.join(' ')}`);
}
if (plans.defense) {
  console.log('\nEnemy CT setups (our T halves): holds, and how clearly each site is the lighter one to hit:');
  for (const st of plans.defense.setups) {
    const sh = defenseShare(geo, st.holds);
    console.log(`  ${st.id.padEnd(10)} A light ${Math.round(sh.A * 100)}%  B light ${Math.round(sh.B * 100)}%  ${st.holds.join(', ')}`);
  }
}
