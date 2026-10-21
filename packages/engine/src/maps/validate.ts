// Checks a map's authored plays against its geometry. Used by the engine tests and by
// tools/map-build/src/inspect.ts while writing plays.

import { BUY_TYPES } from '../economy.ts';
import { buildMapModel, defenseShare, parseHold, type MapModel, type MapPlans } from '../forecast.ts';
import { zoneAt, type MapGeo } from '../geometry.ts';
import { buildPlaybook, SLOT_IDS, type PlaybookDef } from '../playbook.ts';

/** First time (s since live) a plan's player on `route` is inside `zone`, at the plan's pace. */
export function firstInZone(model: MapModel, route: string, zone: string, speed: number, delay: number): number | undefined {
  const r = model.routes[route];
  if (!r) return undefined;
  for (const w of r) if (zoneAt(model.geo, w[0], w[1])?.id === zone) return Math.round((delay + w[2] / speed) * 10) / 10;
  return undefined;
}

export function validatePlays(geo: MapGeo, plans: MapPlans, playbook: PlaybookDef): string[] {
  const out: string[] = [];
  let model: MapModel;
  try { model = buildMapModel(geo, plans); } catch (e) { return [(e as Error).message]; }
  try { buildPlaybook(geo, playbook); } catch (e) { out.push((e as Error).message); }

  const site = (id: string) => geo.zones.find(z => z.id === id)?.site;
  for (const [id, route] of Object.entries(plans.routes)) {
    if (!route.length) out.push(`route ${id} is empty`);
    const last = route[route.length - 1]?.replace(/\*$/, '');
    if (last && !site(last)) out.push(`route ${id} should end on a bomb site (ends at ${last})`);
  }
  const ids = new Set<string>();
  for (const p of plans.plans) {
    if (ids.has(p.id)) out.push(`duplicate plan ${p.id}`);
    ids.add(p.id);
    if (p.lineup.length !== 5 || p.delay.length !== 5) out.push(`plan ${p.id} needs 5 players and 5 delays`);
    if (p.speed <= 0 || p.speed > 1) out.push(`plan ${p.id}: speed is a share of knife speed (0-1]`);
    // Most of the plan's players should end on its site.
    const onSite = p.lineup.filter(r => site(plans.routes[r]?.[plans.routes[r]!.length - 1]?.replace(/\*$/, '') ?? '') === p.site).length;
    if (onSite < 3) out.push(`plan ${p.id} (${p.site}) sends only ${onSite} players to ${p.site}`);
  }
  if (!plans.plans.some(p => p.site === 'A') || !plans.plans.some(p => p.site === 'B')) out.push('plans should cover both sites');
  for (const b of BUY_TYPES) {
    const row = plans.planPriorByBuy[b];
    const sum = Object.values(row).reduce((s, v) => s + v, 0);
    if (Math.abs(sum - 1) > 0.011) out.push(`planPriorByBuy.${b} sums to ${sum.toFixed(3)}, not 1`);
    for (const k of Object.keys(row)) if (!ids.has(k)) out.push(`planPriorByBuy.${b} names unknown plan ${k}`);
    for (const k of ids) if (row[k] === undefined) out.push(`planPriorByBuy.${b} misses plan ${k}`);
  }

  if (!plans.defense) out.push('needs enemy CT setups (defense) for our T halves');
  else {
    const d = plans.defense;
    const sids = new Set<string>();
    for (const s of d.setups) {
      if (sids.has(s.id)) out.push(`duplicate CT setup ${s.id}`);
      sids.add(s.id);
      if (s.holds.length !== 5) out.push(`CT setup ${s.id} needs 5 holds`);
      for (const h of s.holds) {
        if (!geo.zones.some(z => z.id === parseHold(geo, h).zone)) out.push(`CT setup ${s.id}: unknown zone ${h}`);
        if (h.includes(':') && !/:(A|B|mid)$/.test(h)) out.push(`CT setup ${s.id}: ${h} — the side after ':' is A, B or mid`);
      }
    }
    if (d.setups.length < 4) out.push('needs at least 4 CT setups');
    const shares = d.setups.map(s => defenseShare(geo, s.holds).A);
    if (!shares.some(a => a > 0.6)) out.push('needs a CT setup that leaves A light (stacks B)');
    if (!shares.some(a => a < 0.4)) out.push('needs a CT setup that leaves B light (stacks A)');
    if (!shares.some(a => a >= 0.4 && a <= 0.6)) out.push('needs a balanced CT setup');
    for (const b of BUY_TYPES) {
      const row = d.priorByBuy[b];
      const sum = Object.values(row).reduce((t, v) => t + v, 0);
      if (Math.abs(sum - 1) > 0.011) out.push(`defense.priorByBuy.${b} sums to ${sum.toFixed(3)}, not 1`);
      for (const k of Object.keys(row)) if (!sids.has(k)) out.push(`defense.priorByBuy.${b} names unknown setup ${k}`);
      for (const k of sids) if (row[k] === undefined) out.push(`defense.priorByBuy.${b} misses setup ${k}`);
    }
  }

  const slots = playbook.slots.map(s => s.id).sort();
  if (slots.join() !== [...SLOT_IDS].sort().join()) out.push(`slots must be ${SLOT_IDS.join(', ')}`);
  const tSetups = playbook.setups.filter(s => s.side === 'T');
  if (!playbook.tSlots) out.push('needs tSlots: T-side labels for the same slot ids');
  else if (playbook.tSlots.map(s => s.id).sort().join() !== [...SLOT_IDS].sort().join()) out.push(`tSlots must be ${SLOT_IDS.join(', ')}`);
  if (!tSetups.some(s => !s.answers && !s.site)) out.push('needs a default T setup (no answers, no site)');
  for (const site of ['A', 'B'] as const) if (!tSetups.some(s => s.site === site && !s.answers)) out.push(`needs a T exec for ${site} (site: '${site}', no answers)`);
  if (!tSetups.some(s => s.answers?.includes('eco'))) out.push('needs a T setup that answers eco (our eco)');
  if (!tSetups.some(s => s.answers?.includes('force'))) out.push('needs a T setup that answers force (our force buy)');
  for (const s of tSetups) if (!s.calls?.default) out.push(`T setup ${s.id} needs a default call`);
  const ct = playbook.setups.filter(s => s.side === 'CT');
  if (!ct.some(s => s.answers?.includes('eco'))) out.push('needs a CT setup that answers eco');
  if (!ct.some(s => !s.answers)) out.push('needs a default CT setup (no answers)');
  for (const s of playbook.setups) {
    const who = s.spots.map(sp => sp.player).sort();
    if (who.join() !== [...SLOT_IDS].sort().join()) out.push(`setup ${s.id} must place every slot once`);
    const jobs = playbook.jobs[s.id] ?? {};
    for (const id of SLOT_IDS) if (!jobs[id]) out.push(`setup ${s.id} has no job for ${id}`);
    for (const [k, t] of Object.entries(s.calls ?? {})) {
      if (!t) continue;
      if (t.head.length > 40) out.push(`setup ${s.id} call ${k}: head over 40 chars`);
      if (t.steps.length > 3) out.push(`setup ${s.id} call ${k}: more than 3 steps`);
    }
    for (const [slot, job] of Object.entries(jobs)) if (job.length > 110) out.push(`setup ${s.id} job ${slot} over 110 chars`);
  }
  return out;
}
