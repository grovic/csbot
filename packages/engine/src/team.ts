// Applies the team plan (protocol team.ts) to the engine's registry (MAPS, PLAYBOOKS): the team's
// playbook replaces csbot's on the maps it changed, and the active anti-strat reweights the enemy's
// plan odds and picks our CT setup per enemy buy. Every device applies the same plan, so calls, jobs,
// planned spots and the forecast agree everywhere. The tracker reads the registry at every update,
// so a change applies right away.

import type { AntiStratMap, BuyType, Lineup, TeamPlan, TeamPlaybook } from '@csbot/protocol';
import { BUY_TYPES } from './economy.ts';
import type { MapModel } from './forecast.ts';
import { GEOS, LINEUPS, MAPS, PLAYBOOKS } from './maps/index.ts';
import { SLOT_IDS, type Playbook } from './playbook.ts';

const BUILTIN_MAPS: Readonly<Record<string, MapModel>> = { ...MAPS };
const BUILTIN_PLAYBOOKS: Readonly<Record<string, Playbook>> = { ...PLAYBOOKS };
const BUILTIN_LINEUPS: Readonly<Record<string, readonly Lineup[]>> = { ...LINEUPS };

/** csbot's starter lineups for a map. */
export const builtinLineups = (map: string): readonly Lineup[] => BUILTIN_LINEUPS[map] ?? [];

/** The lineups a map uses: the team's (once they changed any) or csbot's starter list. */
export function teamLineups(team: TeamPlan | undefined, map: string): readonly Lineup[] {
  return team?.lineups?.[map] ?? BUILTIN_LINEUPS[map] ?? [];
}

/** csbot's own playbook for a map, whatever the team changed. */
export const builtinPlaybook = (map: string): Playbook | undefined => BUILTIN_PLAYBOOKS[map];
/** csbot's own plan model for a map, without any anti-strat. */
export const builtinModel = (map: string): MapModel | undefined => BUILTIN_MAPS[map];

const sameIds = (a: readonly { id: string }[]) => a.map(s => s.id).sort().join() === [...SLOT_IDS].sort().join();

/** Why a team playbook can't be used (or undefined when it can). */
export function playbookProblem(pb: TeamPlaybook): string | undefined {
  if (!GEOS[pb.map] || !BUILTIN_PLAYBOOKS[pb.map]) return 'No csbot map for this playbook.';
  if (!sameIds(pb.slots) || (pb.tSlots && !sameIds(pb.tSlots))) return 'The playbook must keep the five positions.';
  for (const side of ['CT', 'T'] as const) if (!pb.setups.some(s => s.side === side)) return `The playbook needs a ${side} setup.`;
  for (const s of pb.setups) {
    for (const sp of s.spots) if (!(SLOT_IDS as readonly string[]).includes(sp.player)) return `${s.name}: unknown position ${sp.player}.`;
  }
  return undefined;
}

/** The active anti-strat's plan for a map, if any. */
export function activeAntiStrat(team: TeamPlan | undefined, map: string | undefined): AntiStratMap | undefined {
  if (!team?.active || !map) return undefined;
  return team.antistrats.find(a => a.id === team.active)?.maps[map];
}

/** The active anti-strat's opponent name, if any. */
export function activeOpponent(team: TeamPlan | undefined): string | undefined {
  return team?.active ? team.antistrats.find(a => a.id === team.active)?.name : undefined;
}

/**
 * The playbook the engine uses on a map: the team's (when usable) or csbot's. The anti-strat's answers
 * move each enemy buy to the chosen CT setup (the default setup takes every buy no other setup claims).
 */
export function teamPlaybook(team: TeamPlan | undefined, map: string): Playbook | undefined {
  const own = team?.playbooks[map];
  const base: Playbook | undefined = own && !playbookProblem(own) ? (own as Playbook) : BUILTIN_PLAYBOOKS[map];
  const answers = activeAntiStrat(team, map)?.answers;
  if (!base || !answers) return base;
  const ct = new Set(base.setups.filter(s => s.side === 'CT').map(s => s.id));
  const chosen = (Object.entries(answers) as [BuyType, string][]).filter(([, id]) => ct.has(id));
  if (!chosen.length) return base;
  const moved = new Set(chosen.map(([b]) => b));
  const setups = base.setups.map(s => {
    if (s.side !== 'CT' || !s.answers) return s;
    const answersNext = [...s.answers.filter(b => !moved.has(b)), ...chosen.filter(([, id]) => id === s.id).map(([b]) => b)];
    return { ...s, answers: answersNext };
  });
  return { ...base, setups };
}

/** Their plan odds scaled by the anti-strat's weights (a plan they never run gets 0). */
function reweight(model: MapModel, w: Readonly<Record<string, number>> | undefined): MapModel {
  if (!w) return model;
  const prior = {} as Record<BuyType, Record<string, number>>;
  for (const b of BUY_TYPES) {
    const base = model.planPriorByBuy[b];
    const next: Record<string, number> = {};
    let sum = 0;
    for (const p of model.plans) { next[p.id] = (base[p.id] ?? 0) * (w[p.id] ?? 1); sum += next[p.id]!; }
    prior[b] = sum > 0 ? next : { ...base }; // "never" on every plan they'd run with this buy: keep the usual odds
  }
  return { ...model, planPriorByBuy: prior };
}

/** The plan model the engine uses on a map: csbot's, reweighted by the active anti-strat. */
export function teamModel(team: TeamPlan | undefined, map: string): MapModel | undefined {
  const base = BUILTIN_MAPS[map];
  const a = activeAntiStrat(team, map);
  if (!base || !a || (!a.tWeights && !a.ctWeights)) return base;
  const m = reweight(base, a.tWeights);
  return base.ct ? { ...m, ct: reweight(base.ct, a.ctWeights) } : m;
}

let current: TeamPlan | undefined;
/** The team plan the engine runs on (as last applied). */
export const currentTeam = (): TeamPlan | undefined => current;

/** Make the team plan the engine's (no plan = csbot's own everywhere). */
export function applyTeam(team: TeamPlan | undefined): void {
  current = team;
  const maps = MAPS as Record<string, MapModel>;
  const pbs = PLAYBOOKS as Record<string, Playbook>;
  for (const id of Object.keys(BUILTIN_MAPS)) maps[id] = teamModel(team, id)!;
  for (const id of Object.keys(BUILTIN_PLAYBOOKS)) pbs[id] = teamPlaybook(team, id)!;
  const lus = LINEUPS as Record<string, readonly Lineup[]>;
  for (const id of Object.keys(BUILTIN_LINEUPS)) lus[id] = teamLineups(team, id);
}
