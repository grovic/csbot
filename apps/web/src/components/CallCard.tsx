import { MIRAGE } from '@csbot/engine';
import type { LiveSnapshot } from '@csbot/protocol';
import { useEffect, useRef, useState } from 'react';
import { pct } from '../format.ts';

const planName = (id: string) => MIRAGE.plans.find(p => p.id === id)?.name ?? id;

export function CallCard({ snap }: { snap: LiveSnapshot }) {
  const c = snap.call;
  const [whyOpen, setWhy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const lastKind = useRef<string | undefined>(undefined);
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
  if (m?.clock.phase === 'gameover') {
    const r = m.score.us > m.score.them ? 'Match won' : m.score.us < m.score.them ? 'Match lost' : 'Match tied';
    return (
      <div className="call" data-testid="call" data-kind="gameover">
        <div className="kick">Final · {m.history.length} rounds</div>
        <div className="head" data-testid="call-head">{r} {m.score.us}–{m.score.them}</div>
        <div className="sub">The debrief (buy-read accuracy, money per round, what to work on) arrives in M6.</div>
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
  const kick = { pre: `Team call · round ${c.round}`, mid: `Update · round ${c.round}`, post: `Post-plant · round ${c.round}`, over: `Round ${c.round} result` }[c.kind];
  const plans = snap.forecast && snap.forecast.map === MIRAGE.id
    ? Object.entries(snap.forecast.plans).sort((a, b) => b[1] - a[1]).slice(0, 3)
    : [];
  return (
    <div className="call" ref={ref} data-testid="call" data-kind={c.kind}>
      <div className="kick">{kick}</div>
      <div className="head" data-testid="call-head">{c.head}</div>
      <div className="sub">{c.sub}</div>
      {c.you && (
        <div className="youline" data-testid="youline"><span className="yb">YOU</span><span>{c.you}</span></div>
      )}
      {c.steps.length > 0 && <ul className="steps">{c.steps.slice(0, 3).map(s => <li key={s}>{s}</li>)}</ul>}
      <div className="meta">
        <span>{c.source === 'engine' ? 'local engine' : 'Claude Code · on the host\'s desktop'}</span>
        {(c.why.length > 0 || plans.length > 0) && (
          <button className="lnk" type="button" onClick={() => setWhy(v => !v)} aria-expanded={whyOpen}>{whyOpen ? 'Hide why' : 'Why this call?'}</button>
        )}
      </div>
      {whyOpen && (
        <div className="why" data-testid="why">
          {c.why.length > 0 && <div><h4>Facts</h4><ul>{c.why.map(w => <li key={w}>{w}</li>)}</ul></div>}
          {plans.length > 0 && (
            <div><h4>Enemy plans (estimate)</h4><ul>{plans.map(([id, p]) => <li key={id}>{planName(id)} · {pct(p)}</li>)}</ul></div>
          )}
        </div>
      )}
    </div>
  );
}
