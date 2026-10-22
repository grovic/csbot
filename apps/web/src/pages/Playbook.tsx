// The team's playbook and anti-strats (M7). The room admin edits them on their desktop app (the
// browser demo keeps its own in this browser); members see the admin's, read-only. Every change is
// saved right away, and every screen's engine runs on it: calls, jobs, planned spots, plan odds.

import {
  builtinModel, builtinPlaybook, GEOS, MAP_POOL, planPrior, siteForecast, teamModel, walkableAt, type BuyProbs,
} from '@csbot/engine';
import {
  WEIGHTS, type AntiStrat, type AntiStratMap, type BuyType, type TeamPlan, type TeamPlaybook, type TeamSetup, type TeamSlot,
} from '@csbot/protocol';
import { useEffect, useMemo, useRef, useState } from 'react';
import { viewOf } from '../components/MapPanel.tsx';
import { teamOf, scoutOf, type Session, type SessionView } from '../data/session.ts';
import { mapName } from '../format.ts';

const BUYS: readonly BuyType[] = ['eco', 'force', 'half', 'full'];
const BUY_NAME: Record<BuyType, string> = { eco: 'eco', force: 'force', half: 'half buy', full: 'full buy' };
const ONLY: (b: BuyType) => BuyProbs = b => ({ eco: 0, force: 0, half: 0, full: 0, [b]: 1 });
const pct = (p: number) => `${Math.round(p * 100)}%`;
const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** The map's playbook as the team has it (csbot's until they change it). */
function playbookOf(plan: TeamPlan, map: string): TeamPlaybook | undefined {
  return plan.playbooks[map] ?? (builtinPlaybook(map) as TeamPlaybook | undefined);
}

/** Saves a little after the last change (typing), or right away (a drag, a click). */
function useAutosave(session: Session, shown: TeamPlan) {
  const [plan, setPlan] = useState(shown);
  const [state, setState] = useState<{ s: 'saved' | 'saving' | 'error'; error?: string }>({ s: 'saved' });
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Someone else's save (another window, the host for a member): take it unless we're mid-edit.
  useEffect(() => { if (!dirty.current) setPlan(shown); }, [shown]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const save = async (p: TeamPlan) => {
    setState({ s: 'saving' });
    const err = await session.saveTeam(p);
    dirty.current = false;
    setState(err ? { s: 'error', error: err } : { s: 'saved' });
  };
  const change = (p: TeamPlan, now = false) => {
    dirty.current = true;
    setPlan(p);
    clearTimeout(timer.current);
    if (now) void save(p);
    else { setState({ s: 'saving' }); timer.current = setTimeout(() => void save(p), 700); }
  };
  return { plan, change, state };
}

export function PlaybookPage({ view, session }: { view: SessionView; session: Session }) {
  const editable = session.canEditTeam;
  const shown = teamOf(view);
  const { plan, change, state } = useAutosave(session, shown);
  const match = view.screen?.live.match;
  const [map, setMap] = useState(() => (match?.map && GEOS[match.map] ? match.map : 'de_mirage'));
  const [tab, setTab] = useState<'plays' | 'anti'>('plays');
  const pb = playbookOf(plan, map);
  const own = !!plan.playbooks[map];
  return (
    <div className="page playbook" data-testid="playbook">
      <div className="pb-top">
        <div className="seg" role="tablist" aria-label="Map">
          {MAP_POOL.map(m => <button key={m} type="button" className={m === map ? 'on' : ''} onClick={() => setMap(m)} data-testid={`pb-map-${m}`}>{mapName(m)}{plan.playbooks[m] ? ' •' : ''}</button>)}
        </div>
        <div className="seg" role="tablist" aria-label="View">
          <button type="button" className={tab === 'plays' ? 'on' : ''} onClick={() => setTab('plays')} data-testid="pb-tab-plays">Our plays</button>
          <button type="button" className={tab === 'anti' ? 'on' : ''} onClick={() => setTab('anti')} data-testid="pb-tab-anti">Anti-strat{plan.active ? ' •' : ''}</button>
        </div>
        <span className={'pb-save ' + state.s} data-testid="pb-save" data-state={state.s}>
          {!editable ? (view.role === 'member' ? "The room admin's playbook · read-only" : 'Read-only') : state.s === 'saving' ? 'Saving…' : state.s === 'error' ? state.error : view.role === 'demo' ? 'Saved in this browser' : 'Saved on this PC'}
        </span>
      </div>
      {!pb ? <p className="muted">No playbook for {mapName(map)} yet.</p>
        : tab === 'plays'
          ? <Plays key={map} map={map} pb={pb} own={own} editable={editable} ourSide={match?.map === map ? match.ourSide : undefined}
              onChange={(next, now) => change({ ...plan, playbooks: { ...plan.playbooks, [map]: next } }, now)}
              onReset={() => { const { [map]: _gone, ...rest } = plan.playbooks; change({ ...plan, playbooks: rest }, true); }} />
          : <AntiStrats map={map} plan={plan} pb={pb} editable={editable} suggested={scoutOf(view).status === 'ready' ? scoutOf(view).them.name : undefined} onChange={change} />}
      {view.role === 'demo' && <p className="note">Browser demo: your changes stay in this browser and drive the demo match. In the desktop app the room admin's playbook goes to every member.</p>}
    </div>
  );
}

// ---------------------------------------------------------------- our plays

function Plays({ map, pb, own, editable, ourSide, onChange, onReset }: {
  map: string; pb: TeamPlaybook; own: boolean; editable: boolean; ourSide?: 'CT' | 'T';
  onChange: (pb: TeamPlaybook, now?: boolean) => void; onReset: () => void;
}) {
  const [side, setSide] = useState<'CT' | 'T'>(ourSide ?? 'CT');
  const setups = pb.setups.filter(s => s.side === side);
  const [sel, setSel] = useState(setups[0]?.id);
  const setup = setups.find(s => s.id === sel) ?? setups[0];
  const slots = (side === 'T' ? pb.tSlots ?? pb.slots : pb.slots) as readonly TeamSlot[];
  const put = (s: TeamSetup, now?: boolean) => onChange({ ...pb, setups: pb.setups.map(x => (x.id === s.id ? s : x)) }, now);
  const add = (from: TeamSetup) => {
    const id = newId(side === 'CT' ? 'ct' : 't');
    const copy: TeamSetup = { ...from, id, name: `${from.name} (copy)`, answers: [] };
    onChange({ ...pb, setups: [...pb.setups, copy], jobs: { ...pb.jobs, [id]: { ...(pb.jobs[from.id] ?? {}) } } }, true);
    setSel(id);
  };
  const remove = (s: TeamSetup) => {
    if (setups.length < 2) return;
    const { [s.id]: _gone, ...jobs } = pb.jobs;
    onChange({ ...pb, setups: pb.setups.filter(x => x.id !== s.id), jobs }, true);
    setSel(setups.find(x => x.id !== s.id)?.id);
  };
  const setSlotLabel = (id: string, label: string) => {
    const next = slots.map(s => (s.id === id ? { ...s, label } : s));
    onChange(side === 'T' ? { ...pb, tSlots: next } : { ...pb, slots: next });
  };
  return (
    <div className="pb-grid">
      <div className="card pb-list">
        <div className="card-h">
          <div className="seg" aria-label="Side">
            {(['CT', 'T'] as const).map(s => <button key={s} type="button" className={side === s ? 'on' : ''} onClick={() => { setSide(s); setSel(pb.setups.find(x => x.side === s)?.id); }} data-testid={`pb-side-${s}`}>{s}</button>)}
          </div>
          {own && editable && <button type="button" className="btn small" onClick={onReset} data-testid="pb-reset">Reset to csbot's</button>}
        </div>
        <ul className="pb-setups" data-testid="pb-setups">
          {setups.map(s => (
            <li key={s.id}>
              <button type="button" className={s.id === setup?.id ? 'on' : ''} onClick={() => setSel(s.id)} data-testid="pb-setup">
                <b>{s.name}</b>
                <span className="muted small">{whenText(s)}</span>
              </button>
            </li>
          ))}
        </ul>
        {editable && setup && <p style={{ margin: '8px 0 0', display: 'flex', gap: 6 }}>
          <button type="button" className="btn small" onClick={() => add(setup)} data-testid="pb-duplicate">Duplicate</button>
          <button type="button" className="btn small" disabled={setups.length < 2} onClick={() => remove(setup)} data-testid="pb-delete">Delete</button>
        </p>}
        <h4 className="pb-h">Positions ({side})</h4>
        <ul className="pb-slots">
          {slots.map(s => (
            <li key={s.id}><span className="slot-id">{s.id}</span>
              {editable ? <input className="inp" value={s.label} maxLength={24} onChange={e => setSlotLabel(s.id, e.target.value)} aria-label={`Position ${s.id}`} /> : <span>{s.label}</span>}
            </li>
          ))}
        </ul>
      </div>
      {setup && <SpotMap map={map} setup={setup} slots={slots} editable={editable} onMove={(player, at) => put({ ...setup, spots: setup.spots.map(sp => (sp.player === player ? { ...sp, at } : sp)) }, true)} />}
      {setup && <SetupForm setup={setup} slots={slots} jobs={pb.jobs[setup.id] ?? {}} editable={editable}
        onSetup={put}
        onJobs={jobs => onChange({ ...pb, jobs: { ...pb.jobs, [setup.id]: jobs } })} />}
    </div>
  );
}

function whenText(s: TeamSetup): string {
  const site = s.site ? ` · hits ${s.site}` : '';
  if (!s.answers) return (s.side === 'CT' ? 'default' : 'default with a full buy') + site;
  if (!s.answers.length) return 'not picked automatically' + site;
  return (s.side === 'CT' ? 'their ' : 'our ') + s.answers.map(b => BUY_NAME[b]).join(', ') + site;
}

/** The setup's spots on the map; drag a dot to move a player (it stays on the walkable floor). */
function SpotMap({ map, setup, slots, editable, onMove }: {
  map: string; setup: TeamSetup; slots: readonly TeamSlot[]; editable: boolean; onMove: (player: string, at: readonly [number, number]) => void;
}) {
  const geo = GEOS[map]!;
  const v = viewOf(geo);
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ player: string; at: readonly [number, number] }>();
  const label = new Map(slots.map(s => [s.id, s.label]));
  const toMap = (e: React.PointerEvent): readonly [number, number] | undefined => {
    const m = svg.current?.getScreenCTM();
    if (!m) return undefined;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return [Math.round(Math.max(0, Math.min(1000, p.x))), Math.round(Math.max(0, Math.min(1000, p.y)))];
  };
  return (
    <div className="card pb-map">
      <svg ref={svg} viewBox={`${v.x} ${v.y} ${v.w} ${v.h}`} className="pb-svg" data-testid="pb-map" data-map={map}
        onPointerMove={e => { if (!drag) return; const p = toMap(e); if (p && walkableAt(geo, p[0], p[1])) setDrag({ ...drag, at: p }); }}
        onPointerUp={() => { if (drag) { onMove(drag.player, drag.at); setDrag(undefined); } }}
        onPointerLeave={() => { if (drag) { onMove(drag.player, drag.at); setDrag(undefined); } }}>
        <path d={geo.floor} fill="#20252d" fillRule="evenodd" stroke="#3a4250" strokeWidth={4} strokeLinejoin="round" />
        <g>{geo.zones.filter(z => z.site).map(z => <path key={z.id} d={z.path} fill="#2a313c" fillRule="evenodd" />)}</g>
        <g fill="none" stroke="#2d343f" strokeWidth={1.4}>{geo.zones.map(z => <path key={z.id} d={z.path} />)}</g>
        <g className="pb-zone-names">{geo.zones.map(z => <text key={z.id} x={z.at[0]} y={z.at[1]}>{z.name}</text>)}</g>
        {setup.spots.map(sp => {
          const at = drag?.player === sp.player ? drag.at : sp.at;
          return (
            <g key={sp.player} className={'pb-spot ' + setup.side.toLowerCase() + (editable ? ' movable' : '')} data-testid="pb-spot" data-player={sp.player}
              onPointerDown={e => { if (!editable) return; (e.target as Element).setPointerCapture?.(e.pointerId); setDrag({ player: sp.player, at: sp.at }); }}>
              <circle cx={at[0]} cy={at[1]} r={13} />
              <text x={at[0]} y={at[1] - 19}>{label.get(sp.player) ?? sp.player}</text>
            </g>
          );
        })}
      </svg>
      {editable && <p className="note">Drag a player to move their spot. Squad markers and calls use these spots.</p>}
    </div>
  );
}

function SetupForm({ setup, slots, jobs, editable, onSetup, onJobs }: {
  setup: TeamSetup; slots: readonly TeamSlot[]; jobs: Readonly<Record<string, string>>; editable: boolean;
  onSetup: (s: TeamSetup, now?: boolean) => void; onJobs: (j: Record<string, string>) => void;
}) {
  const call = setup.calls?.default ?? { head: setup.name, sub: '', steps: [] };
  const setCall = (c: { head: string; sub: string; steps: readonly string[] }) => onSetup({ ...setup, calls: { ...setup.calls, default: c } });
  const buys = setup.side === 'CT' ? BUYS : (['eco', 'force'] as const);
  const toggle = (b: BuyType) => {
    const cur = setup.answers ?? [];
    const next = cur.includes(b) ? cur.filter(x => x !== b) : [...cur, b];
    const { answers: _a, ...rest } = setup;
    onSetup(next.length ? { ...rest, answers: next } : rest, true);
  };
  const dis = !editable;
  return (
    <div className="card pb-form" data-testid="pb-form">
      <label className="pb-field"><span>Name</span><input className="inp" value={setup.name} maxLength={40} disabled={dis} onChange={e => onSetup({ ...setup, name: e.target.value })} data-testid="pb-name" /></label>
      <div className="pb-field"><span>Used for</span>
        <div className="chips">
          {buys.map(b => (
            <label key={b} className="chip-check"><input type="checkbox" disabled={dis} checked={!!setup.answers?.includes(b)} onChange={() => toggle(b)} data-testid={`pb-answer-${b}`} />{setup.side === 'CT' ? `their ${BUY_NAME[b]}` : `our ${BUY_NAME[b]}`}</label>
          ))}
        </div>
        <span className="muted small">None ticked: {setup.side === 'CT' ? 'the default setup' : 'the default with a full buy'}.</span>
      </div>
      {setup.side === 'T' && (
        <div className="pb-field"><span>Hits</span>
          <div className="seg">
            {([undefined, 'A', 'B'] as const).map(s => <button key={s ?? 'none'} type="button" disabled={dis} className={setup.site === s ? 'on' : ''} onClick={() => { const { site: _s, ...rest } = setup; onSetup(s ? { ...rest, site: s } : rest, true); }}>{s ? `${s} site` : 'No set site'}</button>)}
          </div>
        </div>
      )}
      <label className="pb-field"><span>Call</span><input className="inp" value={call.head} maxLength={60} disabled={dis} onChange={e => setCall({ ...call, head: e.target.value })} data-testid="pb-call-head" /></label>
      <label className="pb-field"><span>Detail</span><input className="inp" value={call.sub} maxLength={120} disabled={dis} onChange={e => setCall({ ...call, sub: e.target.value })} data-testid="pb-call-sub" /></label>
      <h4 className="pb-h">Jobs and spots</h4>
      <ul className="pb-jobs">
        {slots.map(s => {
          const spot = setup.spots.find(sp => sp.player === s.id);
          return (
            <li key={s.id}>
              <b>{s.label}</b>
              <input className="inp" placeholder="Job (the YOU line)" value={jobs[s.id] ?? ''} maxLength={80} disabled={dis} onChange={e => onJobs({ ...jobs, [s.id]: e.target.value })} data-testid={`pb-job-${s.id}`} />
              {spot && <input className="inp" placeholder="Spot name" value={spot.label} maxLength={40} disabled={dis} onChange={e => onSetup({ ...setup, spots: setup.spots.map(sp => (sp.player === s.id ? { ...sp, label: e.target.value } : sp)) })} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- anti-strats

function AntiStrats({ map, plan, pb, editable, suggested, onChange }: {
  map: string; plan: TeamPlan; pb: TeamPlaybook; editable: boolean; suggested?: string; onChange: (p: TeamPlan, now?: boolean) => void;
}) {
  const [sel, setSel] = useState(plan.active ?? plan.antistrats[0]?.id);
  const a = plan.antistrats.find(x => x.id === sel) ?? plan.antistrats[0];
  const putA = (next: AntiStrat, now?: boolean) => onChange({ ...plan, antistrats: plan.antistrats.map(x => (x.id === next.id ? next : x)) }, now);
  const create = () => {
    const id = newId('as');
    const name = suggested && !plan.antistrats.some(x => x.name === suggested) ? suggested : `Opponent ${plan.antistrats.length + 1}`;
    onChange({ ...plan, antistrats: [...plan.antistrats, { id, name, maps: {}, updatedAt: Date.now() }] }, true);
    setSel(id);
  };
  const remove = (x: AntiStrat) => {
    const rest = plan.antistrats.filter(y => y.id !== x.id);
    const { active: _a, ...base } = plan;
    onChange({ ...base, antistrats: rest, ...(plan.active && plan.active !== x.id ? { active: plan.active } : {}) }, true);
    setSel(rest[0]?.id);
  };
  return (
    <div className="pb-grid anti">
      <div className="card pb-list">
        <div className="card-h"><h3>Opponents</h3>{editable && <button type="button" className="btn small" onClick={create} data-testid="as-new">New anti-strat</button>}</div>
        {!plan.antistrats.length && <p className="muted small" style={{ margin: 0 }}>None yet. An anti-strat tells csbot how one opponent plays: which plans they run more or never, and how you answer each of their buys.</p>}
        <ul className="pb-setups">
          {plan.antistrats.map(x => (
            <li key={x.id}><button type="button" className={x.id === a?.id ? 'on' : ''} onClick={() => setSel(x.id)} data-testid="as-item">
              <b>{x.name}</b><span className="muted small">{plan.active === x.id ? 'in use' : `${Object.keys(x.maps).length} map${Object.keys(x.maps).length === 1 ? '' : 's'}`}</span>
            </button></li>
          ))}
        </ul>
      </div>
      {a && <AntiStratForm key={a.id + map} a={a} map={map} pb={pb} plan={plan} editable={editable} onChange={putA} onRemove={() => remove(a)}
        onActive={on => { const { active: _x, ...base } = plan; onChange(on ? { ...base, active: a.id } : base, true); }} />}
    </div>
  );
}

function AntiStratForm({ a, map, pb, plan, editable, onChange, onRemove, onActive }: {
  a: AntiStrat; map: string; pb: TeamPlaybook; plan: TeamPlan; editable: boolean;
  onChange: (a: AntiStrat, now?: boolean) => void; onRemove: () => void; onActive: (on: boolean) => void;
}) {
  const m: AntiStratMap = a.maps[map] ?? {};
  const base = builtinModel(map);
  const putM = (next: AntiStratMap, now?: boolean) => onChange({ ...a, maps: { ...a.maps, [map]: next }, updatedAt: Date.now() }, now);
  const weight = (key: 'tWeights' | 'ctWeights', plan: string, w: number) => {
    const cur = { ...(m[key] ?? {}) };
    if (w === 1) delete cur[plan]; else cur[plan] = w;
    const { [key]: _old, ...rest } = m;
    putM(Object.keys(cur).length ? { ...rest, [key]: cur } : rest, true);
  };
  // What it changes, before vs with the anti-strat (this anti-strat, as if in use).
  const preview = useMemo(() => {
    if (!base) return undefined;
    const withIt = teamModel({ ...plan, active: a.id }, map)!;
    const t = (mm: typeof base, b: BuyType) => siteForecast(mm, planPrior(mm, ONLY(b)));
    return {
      full: { before: t(base, 'full'), after: t(withIt, 'full') },
      eco: { before: t(base, 'eco'), after: t(withIt, 'eco') },
      ...(base.ct && withIt.ct ? { ct: { before: t(base.ct, 'full'), after: t(withIt.ct, 'full') } } : {}),
    };
  }, [a, map, plan, base]);
  const ctSetups = pb.setups.filter(s => s.side === 'CT');
  const dis = !editable;
  return (
    <div className="card pb-form" data-testid="as-form">
      <div className="pb-field"><span>Opponent</span>
        <input className="inp" value={a.name} maxLength={48} disabled={dis} onChange={e => onChange({ ...a, name: e.target.value })} data-testid="as-name" />
      </div>
      <label className="toggle-row" style={{ margin: '4px 0 10px' }}>
        <input type="checkbox" disabled={dis} checked={plan.active === a.id} onChange={e => onActive(e.target.checked)} data-testid="as-active" />
        <span><b>{plan.active === a.id ? 'In use' : 'Not in use'}</b> · While in use, the forecast and the calls on every screen follow it.</span>
      </label>
      {base && (
        <>
          <h4 className="pb-h">Their T side on {mapName(map)}</h4>
          <WeightRows plans={base.plans} weights={m.tWeights} disabled={dis} onPick={(p, w) => weight('tWeights', p, w)} testid="as-t" />
          {base.ct && <>
            <h4 className="pb-h">Their CT side</h4>
            <WeightRows plans={base.ct.plans} weights={m.ctWeights} disabled={dis} onPick={(p, w) => weight('ctWeights', p, w)} testid="as-ct" />
          </>}
        </>
      )}
      <h4 className="pb-h">Our CT answer</h4>
      <ul className="pb-jobs">
        {(['eco', 'force', 'full'] as const).map(b => (
          <li key={b}><b>Their {BUY_NAME[b]}</b>
            <select className="inp" disabled={dis} value={m.answers?.[b] ?? ''} data-testid={`as-answer-${b}`} onChange={e => {
              const answers = { ...(m.answers ?? {}) };
              if (e.target.value) answers[b] = e.target.value; else delete answers[b];
              const { answers: _old, ...rest } = m;
              putM(Object.keys(answers).length ? { ...rest, answers } : rest, true);
            }}>
              <option value="">As in our plays</option>
              {ctSetups.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </li>
        ))}
      </ul>
      <label className="pb-field"><span>Notes</span>
        <textarea className="inp" rows={3} maxLength={600} disabled={dis} value={m.notes ?? ''} placeholder="What to remember about them here (the coach reads this too)"
          onChange={e => { const { notes: _n, ...rest } = m; putM(e.target.value ? { ...rest, notes: e.target.value } : rest); }} data-testid="as-notes" />
      </label>
      {preview && (
        <div className="as-preview" data-testid="as-preview">
          <span>Their full buy on T: <b>B {pct(preview.full.before.B)} → {pct(preview.full.after.B)}</b></span>
          <span>Their eco on T: <b>B {pct(preview.eco.before.B)} → {pct(preview.eco.after.B)}</b></span>
          {preview.ct && <span>On our T side, A light: <b>{pct(preview.ct.before.A)} → {pct(preview.ct.after.A)}</b></span>}
        </div>
      )}
      {editable && <p style={{ margin: '10px 0 0' }}><button type="button" className="btn small" onClick={onRemove} data-testid="as-delete">Delete this anti-strat</button></p>}
      <p className="note">Plan odds are estimates. An anti-strat only scales csbot's own plan odds for this opponent; it never reads anything from the game.</p>
    </div>
  );
}

function WeightRows({ plans, weights, disabled, onPick, testid }: {
  plans: readonly { id: string; name: string }[]; weights?: Readonly<Record<string, number>>; disabled: boolean; onPick: (plan: string, w: number) => void; testid: string;
}) {
  return (
    <ul className="as-weights" data-testid={testid}>
      {plans.map(p => {
        const cur = weights?.[p.id] ?? 1;
        return (
          <li key={p.id}><span>{p.name}</span>
            <div className="seg">{WEIGHTS.map(w => <button key={w.w} type="button" disabled={disabled} className={cur === w.w ? 'on' : ''} onClick={() => onPick(p.id, w.w)} data-testid={`${testid}-${p.id}-${w.label.toLowerCase()}`}>{w.label}</button>)}</div>
          </li>
        );
      })}
    </ul>
  );
}
