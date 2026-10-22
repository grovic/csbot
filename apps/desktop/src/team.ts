// The team plan on this PC (userData/team.json): the squad's playbook edits and anti-strats. Pure
// Node. Read through sanitizeTeam, so a hand-edited or old file can't break the engine.

import fs from 'node:fs';
import path from 'node:path';
import { playbookProblem } from '@csbot/engine';
import { EMPTY_TEAM, sanitizeTeam, type TeamPlan } from '@csbot/protocol';

const FILE = 'team.json';

export function loadTeam(dir: string): TeamPlan {
  try { return sanitizeTeam(JSON.parse(fs.readFileSync(path.join(dir, FILE), 'utf8'))); } catch { return EMPTY_TEAM; }
}

/** Check and keep a new plan; the error says what's wrong with it. */
export function saveTeam(dir: string, raw: unknown): { ok: true; team: TeamPlan } | { ok: false; error: string } {
  const team = sanitizeTeam(raw);
  for (const pb of Object.values(team.playbooks)) {
    const problem = playbookProblem(pb);
    if (problem) return { ok: false, error: problem };
  }
  try {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, FILE + '.tmp');
    fs.writeFileSync(tmp, JSON.stringify(team));
    fs.renameSync(tmp, path.join(dir, FILE));
  } catch (e) {
    return { ok: false, error: `Couldn't save the playbook: ${(e as Error).message}` };
  }
  return { ok: true, team };
}
