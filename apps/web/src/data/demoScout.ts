// Scouting for the browser demo: the fictional sample match, scouted in the browser by the real
// scouting code (same derivations as the desktop host), plus a real recorded AI briefing.
// Loaded on demand: only the demo needs the scouting code in the browser.

import type { ScoutView } from '@csbot/protocol';

let cached: Promise<ScoutView> | undefined;

export function demoScout(): Promise<ScoutView> {
  cached ??= (async () => {
    const S = await import('@csbot/scout');
    const room: Record<string, 'admin' | 'member'> = {};
    for (const [nick, r] of Object.entries(S.SAMPLE_ROOM)) {
      const sid = S.sampleSteamId(nick);
      if (sid && r !== 'random') room[sid] = r;
    }
    const view = await S.scoutFaceitMatch(
      { faceit: S.sampleFaceit(), steam: S.sampleSteam(), sources: { faceit: 'sample', steam: 'sample', claude: 'sample' } },
      { matchId: S.SAMPLE_MATCH_ID, platform: 'sample', ourSteamId: S.sampleSteamId('rdx'), room },
    );
    return S.withReport(view, { ...S.SAMPLE_REPORT });
  })();
  return cached;
}

/**
 * Who "you" are in the demo's scouting: rdx, the host. Equal to `SAMPLE_ME` in @csbot/scout, kept as a
 * literal so the main bundle doesn't pull in the scouting code (the demo test checks rdx is YOU).
 */
export const DEMO_ME = '76561198000000107';
