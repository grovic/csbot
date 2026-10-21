// The live coach shown with the browser demo: a fictional chat and call log that match the sample
// match (team_kappa, Holo on the AWP, B apps rushes on their ecos). Nothing here calls Claude.

import { DEFAULT_COACH_CONFIG, type CoachView } from '@csbot/protocol';

const T0 = Date.UTC(2026, 9, 21, 20, 0, 0);
const at = (min: number) => T0 + min * 60_000;

export function demoCoach(): CoachView {
  return {
    status: 'ready',
    config: { ...DEFAULT_COACH_CONFIG },
    budget: { used: 14, max: DEFAULT_COACH_CONFIG.callBudget },
    quota: { perMember: DEFAULT_COACH_CONFIG.memberQuota, used: { 'demo-kairo': 1 } },
    messages: [
      { id: 'd1', at: at(0), kind: 'system', text: 'Demo: a fictional match. In a real room these come from the host\'s own Claude Code.' },
      { id: 'd2', at: at(1), kind: 'call', round: 1, text: 'Pistol round · armor first, play in pairs and trade.' },
      { id: 'd3', at: at(3), kind: 'call', round: 2, text: 'Anti-eco · stack B. Likely eco after their pistol loss: long angles, no free kills.' },
      { id: 'd4', at: at(3.4), kind: 'question', author: 'kairo', authorId: 'demo-kairo', round: 2, text: 'Where do they hit on ecos?' },
      { id: 'd5', at: at(3.5), kind: 'answer', replyTo: 'd4', round: 2, ms: 2900, text: 'Likely a B apps rush: their prior on ecos is B apps 52%. Hold long from bench and van, trade in pairs, and don\'t peek apps alone.' },
      { id: 'd6', at: at(6), kind: 'call', round: 3, text: 'Standard 2-1-2 · AWP in window. They likely buy full after two losses.' },
      { id: 'd7', at: at(7.2), kind: 'call', round: 3, text: 'Bomb planted · retake. Regroup at CT, kit first, utility on the site.' },
      { id: 'd8', at: at(7.5), kind: 'question', author: 'rdx', authorId: 'host', round: 3, text: 'How do we play Holo on the AWP?' },
      { id: 'd9', at: at(7.6), kind: 'answer', replyTo: 'd8', round: 3, ms: 3300, text: 'Never dry-peek mid: smoke window and make him rotate. Holo is likely their AWP (1.46 K/D on Mirage); trade every duel with him.' },
    ],
    calls: [
      { id: 'c6', at: at(7.6), round: 3, trigger: 'question', status: 'ok', model: 'sonnet', ms: 3300, head: 'Answer to rdx', costUsd: 0.071 },
      { id: 'c5', at: at(7.2), round: 3, trigger: 'plant', status: 'ok', model: 'sonnet', ms: 3100, head: 'Bomb planted · retake', costUsd: 0.064 },
      { id: 'c4', at: at(6), round: 3, trigger: 'freeze', status: 'ok', model: 'sonnet', ms: 3900, head: 'Standard 2-1-2', costUsd: 0.058 },
      { id: 'c3', at: at(3.5), round: 2, trigger: 'question', status: 'ok', model: 'sonnet', ms: 2900, head: 'Answer to kairo', costUsd: 0.046 },
      { id: 'c2', at: at(3), round: 2, trigger: 'freeze', status: 'ok', model: 'sonnet', ms: 3200, head: 'Anti-eco · stack B', costUsd: 0.039 },
      { id: 'c1', at: at(1), round: 1, trigger: 'freeze', status: 'skipped', head: 'Pistol round', error: 'The engine call covers pistol rounds.' },
      { id: 'c0', at: at(0), round: 0, trigger: 'warmup', status: 'ok', model: 'sonnet', ms: 5600, costUsd: 0.012 },
    ],
  };
}
