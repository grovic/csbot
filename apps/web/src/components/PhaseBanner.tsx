import type { LiveSnapshot } from '@csbot/protocol';
import { clockStr, PHASE_UI } from '../format.ts';
import { useTicker } from '../hooks.ts';

export function PhaseBanner({ snap, receivedAt, rate }: { snap: LiveSnapshot; receivedAt: number; rate: number }) {
  const clock = snap.match?.clock;
  const phase = clock?.phase ?? 'idle';
  // Intel changed the plan mid-round: the one alarm the banner raises (amber), until the round moves on.
  const changed = phase === 'live' && snap.call?.kind === 'mid';
  const ui = changed ? { cls: 'alert', label: 'PLAN CHANGED', hint: 'Read the call' } : PHASE_UI[phase];
  const ticking = clock?.endsIn !== undefined && rate > 0;
  const now = useTicker(250, ticking);
  const rem = clock?.endsIn === undefined ? undefined : Math.max(0, clock.endsIn - (Math.max(0, now - receivedAt) / 1000) * rate);
  const derived = clock?.source === 'derived';
  return (
    <div className={'pb ' + ui.cls} data-testid="banner" data-phase={phase} data-state={changed ? 'alert' : ui.cls} role="status">
      <span className="ph">{ui.label}</span>
      <span className="hint">{ui.hint}</span>
      {rem !== undefined && (
        <span className="clk" data-testid="banner-clock"
          title={derived ? 'Estimated from when the phase started (the game doesn\'t send timers to players)' : 'Timer from the game'}>
          {derived && <span className="approx">≈</span>}{clockStr(rem)}
        </span>
      )}
    </div>
  );
}
