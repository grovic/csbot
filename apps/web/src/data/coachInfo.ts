import type { CallLogEntry, CoachView } from '@csbot/protocol';

/** The latest successful Claude request that wrote the call for a round (model and seconds for the call card). */
export function claudeCallFor(coach: CoachView | undefined, round: number): CallLogEntry | undefined {
  return coach?.calls.find(e => e.round === round && e.status === 'ok' && (e.trigger === 'freeze' || e.trigger === 'plant'));
}

export const secs = (ms?: number) => (ms === undefined ? '–' : `${(ms / 1000).toFixed(1)} s`);
