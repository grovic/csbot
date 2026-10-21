import { MAPS } from '@csbot/engine';
import type { CoachView, LiveSnapshot, RoomView } from '@csbot/protocol';
import { useEffect, useRef, useState } from 'react';
import { claudeCallFor, secs } from '../data/coachInfo.ts';
import { clockStr, pct } from '../format.ts';

const planName = (map: string, ct: boolean, id: string) => (ct ? MAPS[map]?.ct : MAPS[map])?.plans.find(p => p.id === id)?.name ?? id;

/** "Claude Code · sonnet · 3.1 s", from the call log entry that wrote this round's call. */
function claudeMeta(coach: CoachView | undefined, round: number): string {
  const e = claudeCallFor(coach, round);
  return e ? `Claude Code${e.model ? ` · ${e.model}` : ''}${e.ms !== undefined ? ` · ${secs(e.ms)}` : ''}` : "Claude Code · on the host's desktop";
}

export function CallCard({ snap, room, coach }: { snap: LiveSnapshot; room?: RoomView; coach?: CoachView }) {
  const c = snap.call;
  const [whyOpen, setWhy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const lastKind = useRef<string | undefined>(undefined);
  const lastCall = useRef<{ round: number; kind: string; source: string } | undefined>(undefined);
  useEffect(() => {
    // A soft glow when Claude's call replaces the engine's for the same moment.
    const prev = lastCall.current;
    if (c && prev && prev.round === c.round && prev.kind === c.kind && prev.source === 'engine' && c.source === 'claude' && ref.current) {
      ref.current.classList.remove('upgraded');
      void ref.current.offsetWidth;
      ref.current.classList.add('upgraded');
    }
    lastCall.current = c ? { round: c.round, kind: c.kind, source: c.source } : undefined;
  }, [c?.round, c?.kind, c?.source]);
  useEffect(() => {
    // Flash once when the plan changes mid-round (post-plant now, intel updates from M4).
    const k = c?.kind;
    if (lastKind.current && k && k !== lastKind.current && (k === 'post' || k === 'mid') && ref.current) {
      ref.current.classList.remove('flash');
      void ref.current.offsetWidth;
      ref.current.classList.add('flash');
    }
    lastKind.current = k;
  }, [c?.kind, c?.round]);

  const m = snap.match;
  if (room?.tournament) {
    return (
      <div className="call" data-testid="call" data-kind="tournament">
        <div className="kick">Tournament mode</div>
        <div className="head" data-testid="call-head">Live coaching is off for the whole room</div>
        <div className="sub">The admin turned on tournament mode. The economy estimate and the scoreboard still work; the debrief comes after the match.</div>
      </div>
    );
  }
  if (m?.clock.phase === 'gameover') {
    const r = m.score.us > m.score.them ? 'Match won' : m.score.us < m.score.them ? 'Match lost' : 'Match tied';
    return (
      <div className="call" data-testid="call" data-kind="gameover">
        <div className="kick">Final · {m.history.length} rounds</div>
        <div className="head" data-testid="call-head">{r} {m.score.us}–{m.score.them}</div>
        <div className="sub">The debrief has the result, your rating and what to work on: <a href="#/debrief">open the Debrief</a>.</div>
      </div>
    );
  }
  if (!c) {
    return (
      <div className="call" data-testid="call">
        <div className="kick">Team call</div>
        <div className="head">No call yet</div>
        <div className="sub">The first call arrives at freeze time.</div>
      </div>
    );
  }
  const left = m?.clock.phase === 'live' ? m.clock.endsIn : undefined;
  const kick = { pre: `Team call · round ${c.round}`, mid: `Update · ${left !== undefined ? clockStr(left) : `round ${c.round}`}`, post: `Post-plant · round ${c.round}`, over: `Round ${c.round} result` }[c.kind];
  const fmap = snap.forecast && MAPS[snap.forecast.map] ? snap.forecast.map : undefined;
  const plans = fmap ? Object.entries(snap.forecast!.plans).sort((a, b) => b[1] - a[1]).slice(0, 3) : [];
  return (
    <div className="call" ref={ref} data-testid="call" data-kind={c.kind}>
      <div className="kick">{kick}</div>
      <div className="head" data-testid="call-head">{c.head}</div>
      <div className="sub">{c.sub}</div>
      {c.you && (
        <div className="youline" data-testid="youline"><span className="yb">YOU</span><span data-testid="call-you">{c.you}</span></div>
      )}
      {c.steps.length > 0 && <ul className="steps">{c.steps.slice(0, 3).map(s => <li key={s}>{s}</li>)}</ul>}
      <div className="meta">
        <span data-testid="call-source" data-source={c.source}>{c.source === 'engine' ? 'local engine' : claudeMeta(coach, c.round)}</span>
        {(c.why.length > 0 || plans.length > 0) && (
          <button className="lnk" type="button" onClick={() => setWhy(v => !v)} aria-expanded={whyOpen}>{whyOpen ? 'Hide why' : 'Why this call?'}</button>
        )}
      </div>
      {whyOpen && (
        <div className="why" data-testid="why">
          {c.why.length > 0 && <div><h4>Facts</h4><ul>{c.why.map(w => <li key={w}>{w}</li>)}</ul></div>}
          {plans.length > 0 && (
            <div><h4>{snap.forecast?.enemy === 'CT' ? 'Their setups (estimate)' : 'Enemy plans (estimate)'}</h4><ul>{plans.map(([id, p]) => <li key={id}>{planName(fmap!, snap.forecast?.enemy === 'CT', id)} · {pct(p)}</li>)}</ul></div>
          )}
        </div>
      )}
    </div>
  );
}
