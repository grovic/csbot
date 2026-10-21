// Coach: the chat with the host's Claude Code on the right, and every detailed panel the other pages
// draw from on the left (round reasoning, economy, call log, coach settings). Shared with the room:
// everyone sees the same chat; members ask within their quota, the admin changes the settings.

import { lossBonus, MAPS, PLAYBOOKS, slotsFor } from '@csbot/engine';
import type { CallLogEntry, CoachConfig, CoachMessage, CoachModel, CoachView, LiveSnapshot, RoomView } from '@csbot/protocol';
import { useEffect, useMemo, useRef, useState } from 'react';
import { claudeCallFor, secs } from '../data/coachInfo.ts';
import { coachOf, type Session, type SessionView } from '../data/session.ts';
import { fmt$, fmtK, mapName, pct } from '../format.ts';

type Tab = 'reasoning' | 'economy' | 'calls' | 'config';
const TABS: { id: Tab; label: string }[] = [
  { id: 'reasoning', label: 'Round reasoning' },
  { id: 'economy', label: 'Economy' },
  { id: 'calls', label: 'Call log' },
  { id: 'config', label: 'Coach config' },
];

const BUY_LABEL = { eco: 'Eco', force: 'Force', half: 'Half buy', full: 'Full buy' } as const;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export const STATUS: Record<CoachView['status'], { dot: 'ok' | 'warn' | 'off'; text: string }> = {
  ready: { dot: 'ok', text: 'Ready' },
  busy: { dot: 'ok', text: 'Writing…' },
  starting: { dot: 'warn', text: 'Starting Claude Code…' },
  idle: { dot: 'off', text: 'Starts with the next match' },
  budget: { dot: 'warn', text: 'Calls used up: engine calls only' },
  tournament: { dot: 'off', text: 'Tournament mode: live coaching off' },
  off: { dot: 'off', text: 'Off' },
  error: { dot: 'warn', text: 'Error' },
};

function BarRow({ label, v, max = false, us = false, val }: { label: string; v: number; max?: boolean; us?: boolean; val?: string }) {
  return (
    <div className={'br' + (max ? ' max' : '') + (us ? ' us' : '')}>
      <span className="bl" title={label}>{label}</span>
      <div className="bt"><div className="bf" style={{ width: `${(clamp01(v) * 100).toFixed(1)}%` }} /></div>
      <span className="bv">{val ?? pct(v)}</span>
    </div>
  );
}

// ------------------------------------------------------------------ status strip

function Strip({ coach }: { coach: CoachView }) {
  const st = STATUS[coach.status];
  const detail = coach.status === 'off' || coach.status === 'error' ? coach.detail : undefined;
  return (
    <div className="coach-strip">
      <span className="chip" data-testid="coach-status" data-status={coach.status} title={coach.detail ?? ''}>
        {coach.status === 'busy' ? <span className="pulse" /> : <i className={'dot ' + st.dot} />}
        {coach.status === 'off' && coach.detail ? `Off: ${coach.detail}` : st.text}
      </span>
      <span className="chip" data-testid="coach-model">Claude Code · {coach.config.model} · {coach.config.effort} effort</span>
      <span className="chip" data-testid="coach-budget">{coach.budget.used} of {coach.budget.max} calls</span>
      {detail && coach.status === 'error' && <span className="muted small">{detail}</span>}
    </div>
  );
}

// ------------------------------------------------------------------ panels

function Reasoning({ live, room, coach }: { live?: LiveSnapshot; room?: RoomView; coach: CoachView }) {
  const c = live?.call;
  const map = live?.match?.map;
  const slots = room?.slots ?? slotsFor(map, live?.match?.ourSide).map(s => ({ ...s }));
  const nameOf = (slot: string) => room?.members.find(m => m.slot === slot)?.name;
  const setupName = c?.setup && map ? PLAYBOOKS[map]?.setups.find(s => s.id === c.setup)?.name : undefined;
  const entry = c ? claudeCallFor(coach, c.round) : undefined;
  const fc = live?.forecast;
  const plans = fc ? Object.entries(fc.plans).sort((a, b) => b[1] - a[1]).slice(0, 5) : [];
  const planName = (id: string) => (fc ? (fc.enemy === 'CT' ? MAPS[fc.map]?.ct : MAPS[fc.map])?.plans.find(p => p.id === id)?.name : undefined) ?? id;
  const buy = live?.enemy?.buy;
  const top = buy ? (Object.keys(buy) as (keyof typeof buy)[]).reduce((a, b) => (buy[a] >= buy[b] ? a : b)) : undefined;
  return (
    <div className="grid2">
      <div className="card" data-testid="coach-reasoning">
        <div className="card-h">
          <h3>Current call</h3>
          <span className="muted small">{c ? (c.source === 'claude' ? `Claude Code${entry?.model ? ` · ${entry.model}` : ''}${entry?.ms ? ` · ${secs(entry.ms)}` : ''}` : 'local engine') : ''}</span>
        </div>
        {!c ? (
          <div className="muted">No call yet. The first one arrives at freeze time.</div>
        ) : (
          <>
            <div className="kick">{{ pre: `Team call · round ${c.round}`, mid: `Update · round ${c.round}`, post: `Post-plant · round ${c.round}`, over: `Round ${c.round} result` }[c.kind]}</div>
            <div className="c-head">{c.head}</div>
            <div className="muted">{c.sub}</div>
            {c.you && <div className="youline sm"><span className="yb">YOU</span><span>{c.you}</span></div>}
            {Object.keys(c.jobs).length > 0 && (
              <>
                <div className="h4">Everyone's job{setupName ? ` · ${setupName}` : ''}</div>
                <ul className="ul">
                  {slots.filter(s => c.jobs[s.id]).map(s => (
                    <li key={s.id}><b>{nameOf(s.id) ?? s.label}</b>{nameOf(s.id) ? <span className="muted"> · {s.label}</span> : null} · {c.jobs[s.id]}</li>
                  ))}
                </ul>
              </>
            )}
            {c.steps.length > 0 && <><div className="h4">Steps</div><ul className="steps sm">{c.steps.map(s => <li key={s}>{s}</li>)}</ul></>}
            {c.why.length > 0 && <><div className="h4">Why</div><ul className="ul">{c.why.map(w => <li key={w}>{w}</li>)}</ul></>}
          </>
        )}
      </div>
      <div className="card">
        <div className="card-h"><h3>{fc?.enemy === 'CT' ? 'Their CT setup' : 'Enemy plans'}</h3><span className="chip est">estimate</span></div>
        {fc ? (
          <>
            <div className="bars" style={{ ['--lw' as string]: '170px' }}>
              {plans.map(([id, p], i) => <BarRow key={id} label={planName(id)} v={p} max={i === 0} />)}
            </div>
            <div className="h4">{fc.enemy === 'CT' ? 'Lighter site' : 'Site forecast'}</div>
            <div className="bars" style={{ ['--lw' as string]: '64px' }}>
              <BarRow label="A site" v={fc.site.A} max={fc.site.A > fc.site.B} />
              <BarRow label="B site" v={fc.site.B} max={fc.site.B >= fc.site.A} />
            </div>
            <div className="note" data-testid="forecast-note">Forecast: {fc.basis === 'intel' ? `updated by ${live?.intel?.length ?? 0} intel this round` : 'from the buy read'}. First estimates per map, until demo data calibrates them.</div>
          </>
        ) : (
          <div className="muted">The forecast arrives at freeze time, from the enemy buy read.</div>
        )}
        <div className="h4">Intel this round</div>
        {live?.intel?.length ? (
          <ul className="ul" data-testid="coach-intel">
            {live.intel.map(i => (
              <li key={i.zone + i.t}><b>{i.by.join(' + ')}</b> · {i.count ? `${i.count} at ${i.zoneName}` : `${i.zoneName} clear`} <span className="muted">· {i.t}s into the round</span></li>
            ))}
          </ul>
        ) : (
          <div className="muted small" data-testid="coach-intel-empty">None yet. Anyone in the room can click a map zone during the round.</div>
        )}
        {buy && (
          <>
            <div className="h4">Enemy buy read</div>
            <div className="bars" style={{ ['--lw' as string]: '64px' }}>
              {(['eco', 'force', 'half', 'full'] as const).map(k => <BarRow key={k} label={BUY_LABEL[k]} v={buy[k]} max={k === top} />)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Economy({ live }: { live?: LiveSnapshot }) {
  const e = live?.enemy;
  const rows = live?.scoreboard ?? [];
  const X = (v: number) => clamp01(v / 8000) * 100;
  const full = rows.filter(r => r.money >= 4700).length;
  const avg = rows.length ? rows.reduce((a, r) => a + r.money, 0) / rows.length : 0;
  const top = e ? (Object.keys(e.buy) as (keyof typeof e.buy)[]).reduce((a, b) => (e.buy[a] >= e.buy[b] ? a : b)) : undefined;
  return (
    <div className="grid2">
      <div className="card" data-testid="coach-economy">
        <div className="card-h"><h3><i className="key t" />Enemy economy</h3><span className="chip est">estimate</span></div>
        {!e ? (
          <div className="muted">The estimate starts with the first round.</div>
        ) : (
          <>
            <div className="teamline">per player · from scores, loss bonus levels and round results</div>
            <div className="econ-big">{fmt$(e.lo)} – {fmt$(e.hi)}</div>
            <div className="band">
              <div className="axis" />
              <div className="rng" style={{ left: `${X(e.lo)}%`, width: `${Math.max(1, X(e.hi) - X(e.lo))}%` }} />
              <div className="thr" style={{ left: `${X(2000)}%` }} /><div className="thr" style={{ left: `${X(4100)}%` }} />
              <span className="tl2" style={{ left: `${X(2000)}%` }}>force $2k</span>
              <span className="tl2" style={{ left: `${X(4100)}%` }}>full buy $4.1k</span>
            </div>
            <div className="teamline" style={{ margin: '8px 0' }}>
              Loss bonus level <span className="pips">{[0, 1, 2, 3, 4].map(i => <i key={i} className={i < e.streak ? 'on' : ''} />)}</span>
              next loss pays {fmt$(lossBonus(e.streak + 1))}{e.saved ? ' · saved last round' : ''}
            </div>
            <div className="bars" style={{ ['--lw' as string]: '64px' }}>
              {(['eco', 'force', 'half', 'full'] as const).map(k => <BarRow key={k} label={BUY_LABEL[k]} v={e.buy[k]} max={k === top} />)}
            </div>
          </>
        )}
      </div>
      <div className="card">
        <div className="card-h"><h3><i className="key ct" />Your team money</h3><span className="muted small">host GSI + members' shared GSI</span></div>
        {rows.length === 0 ? (
          <div className="muted">Your team's money shows once the game sends it.</div>
        ) : (
          <>
            <div className="econ-big">{fmt$(avg)} <span className="muted small">avg</span></div>
            <div className="teamline">{full} of {rows.length} can full-buy (≥ $4,700)</div>
            <div className="bars" style={{ ['--lw' as string]: '130px', marginTop: 8 }}>
              {rows.map(r => <BarRow key={r.steamid} label={r.name + (r.source === 'spectated' ? ` · seen R${r.seenRound ?? '?'}` : '')} v={r.money / 8000} us val={fmtK(r.money)} />)}
            </div>
            <div className="note">Teammates who don't share their game data show what was seen while spectating them.</div>
          </>
        )}
      </div>
    </div>
  );
}

const TRIGGER: Record<CallLogEntry['trigger'], string> = { freeze: 'Freeze-time call', intel: 'Intel update', plant: 'Post-plant call', question: 'Question', warmup: 'Warm-up' };
const STATUS_CHIP: Record<CallLogEntry['status'], string> = { ok: 'ok', late: 'late', timeout: 'timed out', error: 'error', skipped: 'skipped' };

function Calls({ coach }: { coach: CoachView }) {
  const ok = coach.calls.filter(c => c.status === 'ok' && c.ms !== undefined).map(c => c.ms!).sort((a, b) => a - b);
  const p50 = ok.length ? ok[Math.floor(ok.length / 2)]! : undefined;
  const memberQs = coach.messages.filter(m => m.kind === 'question' && m.authorId !== 'host').length;
  const usage = coach.calls.reduce((a, c) => Math.max(a, c.costUsd ?? 0), 0);
  return (
    <>
      <div className="kpis">
        {[
          ['Calls this match', `${coach.budget.used} / ${coach.budget.max}`, 'budget per match, then engine calls'],
          ['Median time', p50 === undefined ? '–' : secs(p50), 'event → call on every screen'],
          ['Member questions', String(memberQs), `max ${coach.quota.perMember} per member`],
          ['Plan usage', usage ? `$${usage.toFixed(2)}` : '–', 'API-equivalent, this session'],
        ].map(([l, v, s]) => <div className="card kpi" key={l}><div className="lbl">{l}</div><div className="val">{v}</div><div className="sub">{s}</div></div>)}
      </div>
      <div className="card mt">
        <div className="card-h"><h3>Every Claude Code request</h3><span className="muted small">newest first · usage is cumulative for the session</span></div>
        {coach.calls.length === 0 ? (
          <div className="muted">Nothing yet. The coach warms up when a match starts.</div>
        ) : (
          <div className="tw">
            <table className="t" data-testid="call-log">
              <thead><tr><th>Round</th><th>Type</th><th>Status</th><th>Model</th><th className="r">Time</th><th>Headline</th><th className="r">Usage</th></tr></thead>
              <tbody>
                {coach.calls.map(c => (
                  <tr key={c.id} data-testid="call-log-row" data-status={c.status}>
                    <td>{c.round ? `R${c.round}` : 'pre-match'}</td>
                    <td>{TRIGGER[c.trigger]}</td>
                    <td><span className={'logst ' + c.status} title={c.error ?? ''}>{STATUS_CHIP[c.status]}</span></td>
                    <td>{c.model ?? '–'}</td>
                    <td className="r">{secs(c.ms)}</td>
                    <td className="ellip" title={c.error ?? c.head ?? ''}>{c.head ?? (c.error ? <span className="muted">{c.error}</span> : '–')}</td>
                    <td className="r">{c.costUsd !== undefined ? `$${c.costUsd.toFixed(3)}` : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

const MODELS: { id: CoachModel; note: string }[] = [
  { id: 'sonnet', note: 'default: good calls in about 3–5 s' },
  { id: 'haiku', note: 'fastest, but weaker calls' },
  { id: 'opus', note: 'strongest, slowest, uses the most of your plan' },
];

function NumberField({ value, min, max, onSave, testId }: { value: number; min: number; max: number; onSave: (n: number) => void; testId: string }) {
  const [v, setV] = useState(String(value));
  useEffect(() => { setV(String(value)); }, [value]);
  const commit = () => {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n < min || n > max) { setV(String(value)); return; }
    if (n !== value) onSave(n);
  };
  return (
    <input className="inp num" type="number" min={min} max={max} value={v} data-testid={testId}
      onChange={e => setV(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }} />
  );
}

function Config({ coach, admin, adminName, onSave }: { coach: CoachView; admin: boolean; adminName: string; onSave: (p: Partial<CoachConfig>) => void }) {
  const c = coach.config;
  return (
    <>
      {!admin && (
        <div className="banner-note"><span className="rolebadge member">READ-ONLY</span>Managed by {adminName}: the coach runs on their Claude Code. You can see the settings but not change them.</div>
      )}
      <fieldset className="plain" disabled={!admin}>
        <div className="grid2">
          <div className="card">
            <div className="card-h"><h3>Live coach</h3><span className="muted small">runs on the host's own Claude Code</span></div>
            <div className="cfg">
              <span className="k">Coach</span>
              <label className="toggle"><input type="checkbox" checked={c.enabled} onChange={e => onSave({ enabled: e.target.checked })} data-testid="cfg-enabled" /> {c.enabled ? 'on' : 'off: engine calls only'}</label>
              <span className="k">Model</span>
              <span>
                <select className="sel" value={c.model} onChange={e => onSave({ model: e.target.value as CoachModel })} data-testid="cfg-model">
                  {MODELS.map(m => <option key={m.id} value={m.id}>{m.id}</option>)}
                </select>{' '}
                <span className="muted small">{MODELS.find(m => m.id === c.model)?.note}</span>
              </span>
              <span className="k">Effort</span>
              <select className="sel" value={c.effort} onChange={e => onSave({ effort: e.target.value as CoachConfig['effort'] })} data-testid="cfg-effort">
                <option value="low">low (fastest)</option><option value="medium">medium</option><option value="high">high (slow)</option>
              </select>
              <span className="k">Post-plant calls</span>
              <label className="toggle"><input type="checkbox" checked={c.postPlant} onChange={e => onSave({ postPlant: e.target.checked })} data-testid="cfg-postplant" /> one more call per planted round</label>
            </div>
          </div>
          <div className="card">
            <div className="card-h"><h3>Budget</h3><span className="muted small">keeps plan usage predictable</span></div>
            <div className="cfg">
              <span className="k">Calls per match</span>
              <span><NumberField value={c.callBudget} min={0} max={200} onSave={n => onSave({ callBudget: n })} testId="cfg-budget" /> <span className="muted small">then engine calls only</span></span>
              <span className="k">Questions per member</span>
              <span><NumberField value={c.memberQuota} min={0} max={50} onSave={n => onSave({ memberQuota: n })} testId="cfg-quota" /> <span className="muted small">per match · the admin's own questions use the call budget</span></span>
            </div>
            <div className="note">Changes apply from the next call. Each call and answer counts against the host's Claude plan.</div>
          </div>
        </div>
      </fieldset>
      <details className="card mt">
        <summary className="small muted">How the host runs Claude Code</summary>
        <pre className="code">{`claude -p --input-format stream-json --output-format stream-json --verbose \\
  --json-schema <call schema> --model ${c.model} --effort ${c.effort} \\
  --system-prompt-file <live coach prompt> \\
  --tools "" --strict-mcp-config --permission-mode dontAsk --no-session-persistence`}</pre>
        <div className="note">The user's own, unmodified Claude Code with their own login. One warm session per match; every message carries the facts csbot computed, and the answer comes back as structured output.</div>
      </details>
    </>
  );
}

// ------------------------------------------------------------------ chat

/** Questions with their answers right below; everything else in time order. */
function thread(messages: CoachMessage[]): { m: CoachMessage; reply?: boolean }[] {
  const answers = new Map<string, CoachMessage[]>();
  const questions = new Set(messages.filter(m => m.kind === 'question').map(m => m.id));
  for (const m of messages) if (m.kind === 'answer' && m.replyTo && questions.has(m.replyTo)) answers.set(m.replyTo, [...(answers.get(m.replyTo) ?? []), m]);
  const out: { m: CoachMessage; reply?: boolean }[] = [];
  for (const m of messages) {
    if (m.kind === 'answer' && m.replyTo && questions.has(m.replyTo)) continue;
    out.push({ m });
    for (const a of answers.get(m.id) ?? []) out.push({ m: a, reply: true });
  }
  return out;
}

function Message({ m, reply, me }: { m: CoachMessage; reply?: boolean; me: string }) {
  const when = m.round ? `R${m.round}` : new Date(m.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (m.kind === 'system') {
    return <div className="msg sys" data-testid="coach-msg" data-kind="system"><div className="msg-b">{m.text}</div></div>;
  }
  if (m.kind === 'call') {
    return (
      <div className="msg call" data-testid="coach-msg" data-kind="call">
        <div className="msg-h"><span className="tag">CALL</span><span>{when}</span></div>
        <div className="msg-b">{m.text}</div>
      </div>
    );
  }
  if (m.kind === 'question') {
    return (
      <div className={'msg human' + (m.authorId === me ? ' mine' : ' other')} data-testid="coach-msg" data-kind="question">
        <div className="msg-h"><span className="tag">{(m.author ?? 'someone').toUpperCase()}</span><span>{when}</span><span className="src">question</span></div>
        <div className="msg-b">{m.text}</div>
      </div>
    );
  }
  return (
    <div className={'msg ai' + (reply ? ' reply' : '')} data-testid="coach-msg" data-kind="answer">
      <div className="msg-h"><span className="tag">COACH</span><span>{when}</span><span className="src">Claude Code{m.ms ? ` · ${secs(m.ms)}` : ''}</span></div>
      <div className="msg-b">{m.text}</div>
    </div>
  );
}

const QUICK = ['Should we force next round?', 'Where is their AWP?', 'Timeout talking points'];

function Chat({ view, session, coach, me, role }: { view: SessionView; session: Session; coach: CoachView; me: string; role: SessionView['role'] }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const feed = useRef<HTMLDivElement>(null);
  const items = useMemo(() => thread(coach.messages), [coach.messages]);
  useEffect(() => {
    const el = feed.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length]);

  const room = view.screen?.room;
  const member = role === 'member';
  const used = coach.quota.used[me] ?? 0;
  const left = Math.max(0, coach.quota.perMember - used);
  const tournament = coach.status === 'tournament' || !!room?.tournament;
  const reason =
    role === 'demo' ? "Demo: in a real room, questions go to the host's Claude Code."
      : role === 'none' ? "Questions go to the host's Claude Code, in the desktop app or a room."
        : member && view.link?.status !== 'approved' ? 'Not connected to the host.'
          : tournament ? 'Tournament mode is on: no live coaching.'
            : coach.status === 'off' ? (coach.detail ?? 'The coach is off.')
              : coach.status === 'budget' || coach.budget.used >= coach.budget.max ? `The coach has used its ${coach.budget.max} calls for this match.`
                : member && room && !room.permissions.ask ? 'The admin turned off questions for members.'
                  : member && left <= 0 ? `You've asked your ${coach.quota.perMember} questions for this match.`
                    : undefined;

  const send = async (q: string) => {
    if (reason || busy || q.trim().length < 2) return;
    setBusy(true); setErr(undefined);
    const e = await session.askCoach(q);
    setBusy(false);
    if (e) setErr(e); else setText('');
  };
  return (
    <aside className="card chat" data-testid="coach-chat-card">
      <div className="card-h"><h3>Coach chat</h3><span className="muted small">shared with the room</span></div>
      <div className="feed" ref={feed} data-testid="coach-chat">
        {items.length === 0 ? <div className="muted small">No messages yet. Calls and answers show up here during the match.</div>
          : items.map(({ m, reply }) => <Message key={m.id} m={m} reply={reply} me={me} />)}
      </div>
      <form className="ask" autoComplete="off" onSubmit={e => { e.preventDefault(); void send(text); }}>
        <input value={text} onChange={e => setText(e.target.value)} placeholder="Ask the coach…" maxLength={300} disabled={!!reason || busy} data-testid="coach-input" aria-label="Ask the coach" />
        <button className="btn primary" type="submit" disabled={!!reason || busy || text.trim().length < 2} data-testid="coach-send">{busy ? 'Sending…' : 'Send'}</button>
      </form>
      <div className="qchips">
        {QUICK.map(q => <button key={q} type="button" disabled={!!reason || busy} onClick={() => setText(q)}>{q}</button>)}
      </div>
      {reason && <div className="note" data-testid="coach-ask-reason">{reason}</div>}
      {!reason && member && <div className="note" data-testid="coach-quota">{left} of {coach.quota.perMember} questions left this match</div>}
      {!reason && !member && <div className="note" data-testid="coach-quota">Your questions use the match budget: {Math.max(0, coach.budget.max - coach.budget.used)} calls left</div>}
      {err && <div className="result err" data-testid="coach-ask-error">{err}</div>}
    </aside>
  );
}

// ------------------------------------------------------------------ page

export function CoachPage({ view, session }: { view: SessionView; session: Session }) {
  const [tab, setTab] = useState<Tab>('reasoning');
  const coach = coachOf(view);
  const live = view.screen?.live;
  const room = view.screen?.room;
  const me = view.role === 'member' ? room?.you ?? '' : room?.you ?? 'host';
  const admin = session.canConfigureCoach;
  const adminName = room?.hostName ?? 'the admin';
  return (
    <section data-testid="coach-page">
      <Strip coach={coach} />
      {view.role === 'demo' && <div className="chip sample" style={{ marginBottom: 10 }}>Demo coach · fictional chat and call log</div>}
      <div className="coach">
        <div>
          <div className="subnav" role="tablist">
            {TABS.map(t => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)} data-testid={`coach-tab-${t.id}`}>{t.label}</button>
            ))}
          </div>
          {tab === 'reasoning' && <Reasoning live={live} room={room} coach={coach} />}
          {tab === 'economy' && <Economy live={live} />}
          {tab === 'calls' && <Calls coach={coach} />}
          {tab === 'config' && <Config coach={coach} admin={admin} adminName={adminName} onSave={p => void session.setCoachConfig(p)} />}
          {live?.match && <p className="note">{mapName(live.match.map)} · round {live.match.round || '–'} · everything above is computed by csbot; enemy numbers are estimates.</p>}
        </div>
        <Chat view={view} session={session} coach={coach} me={me} role={view.role} />
      </div>
    </section>
  );
}
