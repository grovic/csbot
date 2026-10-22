// Playbook → Lineups (M7): the team's utility lineups per map (csbot's starter list until they change
// it). Each is a throw spot and a landing spot on the map, a technique, the setups whose calls list
// it, and optionally the exact spot from their own practice server. The practice config turns them
// into a .cfg for a private server.

import { builtinLineups, GEOS, practiceConfig, practiceFileName, walkableAt } from '@csbot/engine';
import { parseSetpos, type Lineup, type LineupKind, type TeamPlaybook, type TeamPoint } from '@csbot/protocol';
import { useRef, useState } from 'react';
import { viewOf } from '../components/MapPanel.tsx';
import type { Session } from '../data/session.ts';

const KINDS: readonly { k: LineupKind; label: string }[] = [
  { k: 'smoke', label: 'Smoke' }, { k: 'molotov', label: 'Molotov' }, { k: 'flash', label: 'Flash' }, { k: 'he', label: 'HE' },
];
const HOW = ['Jumpthrow', 'Run + jumpthrow', 'Stand, left click', 'Stand, right click', 'Crouch, left click', 'Walk + throw'];
const newId = () => `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export function Lineups({ map, lineups, own, pb, editable, session, onChange, onReset }: {
  map: string; lineups: readonly Lineup[]; own: boolean; pb: TeamPlaybook; editable: boolean; session: Session;
  onChange: (l: readonly Lineup[], now?: boolean) => void; onReset: () => void;
}) {
  const [side, setSide] = useState<'CT' | 'T'>('T');
  const shown = lineups.filter(l => l.side === side);
  const [sel, setSel] = useState<string | undefined>(shown[0]?.id);
  const cur = shown.find(l => l.id === sel) ?? shown[0];
  const put = (l: Lineup, now?: boolean) => onChange(lineups.map(x => (x.id === l.id ? l : x)), now);
  const add = () => {
    const geo = GEOS[map]!;
    const spawn = side === 'T' ? geo.spawn.T : geo.spawn.CT;
    const site = geo.zones.find(z => z.site === 'A')!.at;
    const l: Lineup = { id: newId(), name: 'New lineup', kind: 'smoke', side, from: [Math.round(spawn[0]), Math.round(spawn[1])], to: site, how: 'Jumpthrow' };
    onChange([...lineups, l], true);
    setSel(l.id);
  };
  return (
    <>
      <div className="pb-grid">
        <div className="card pb-list">
          <div className="card-h">
            <div className="seg" aria-label="Side">
              {(['T', 'CT'] as const).map(s => <button key={s} type="button" className={side === s ? 'on' : ''} onClick={() => { setSide(s); setSel(lineups.find(l => l.side === s)?.id); }} data-testid={`lu-side-${s}`}>{s}</button>)}
            </div>
            {editable && <button type="button" className="btn small" onClick={add} data-testid="lu-new">New lineup</button>}
          </div>
          <ul className="pb-setups" data-testid="lu-list">
            {shown.map(l => (
              <li key={l.id}><button type="button" className={l.id === cur?.id ? 'on' : ''} onClick={() => setSel(l.id)} data-testid="lu-item">
                <b><i className={'nade-dot ' + l.kind} />{l.name}</b>
                <span className="muted small">{l.how ?? '—'}{l.exact ? ' · exact spot' : ''}{l.setups?.length ? ` · ${l.setups.length} setup${l.setups.length > 1 ? 's' : ''}` : ''}</span>
              </button></li>
            ))}
          </ul>
          {own && editable && <p style={{ margin: '8px 0 0' }}><button type="button" className="btn small" onClick={onReset} data-testid="lu-reset">Reset to csbot's</button></p>}
        </div>
        <LineupMap map={map} lineups={shown} sel={cur?.id} editable={editable} onPick={setSel} onMove={(id, end, at) => { const l = lineups.find(x => x.id === id); if (l) put({ ...l, [end]: at }, true); }} />
        {cur && <LineupForm key={cur.id} l={cur} pb={pb} editable={editable} onChange={put} onDelete={() => { onChange(lineups.filter(x => x.id !== cur.id), true); setSel(undefined); }} />}
      </div>
      <PracticeCard map={map} lineups={lineups} session={session} />
    </>
  );
}

function LineupMap({ map, lineups, sel, editable, onPick, onMove }: {
  map: string; lineups: readonly Lineup[]; sel?: string; editable: boolean; onPick: (id: string) => void; onMove: (id: string, end: 'from' | 'to', at: TeamPoint) => void;
}) {
  const geo = GEOS[map]!;
  const v = viewOf(geo);
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ id: string; end: 'from' | 'to'; at: TeamPoint }>();
  const toMap = (e: React.PointerEvent): TeamPoint | undefined => {
    const m = svg.current?.getScreenCTM();
    if (!m) return undefined;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return [Math.round(Math.max(0, Math.min(1000, p.x))), Math.round(Math.max(0, Math.min(1000, p.y)))];
  };
  const end = () => { if (drag) { onMove(drag.id, drag.end, drag.at); setDrag(undefined); } };
  const grab = (l: Lineup, which: 'from' | 'to') => (e: React.PointerEvent) => {
    onPick(l.id);
    if (!editable || l.id !== sel) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDrag({ id: l.id, end: which, at: l[which] });
  };
  return (
    <div className="card pb-map">
      <svg ref={svg} viewBox={`${v.x} ${v.y} ${v.w} ${v.h}`} className="pb-svg" data-testid="lu-map" data-map={map}
        onPointerMove={e => {
          if (!drag) return;
          const p = toMap(e);
          // The thrower stands on the floor; a grenade can land anywhere.
          if (p && (drag.end === 'to' || walkableAt(geo, p[0], p[1]))) setDrag({ ...drag, at: p });
        }}
        onPointerUp={end} onPointerLeave={end}>
        <path d={geo.floor} fill="#20252d" fillRule="evenodd" stroke="#3a4250" strokeWidth={4} strokeLinejoin="round" />
        <g>{geo.zones.filter(z => z.site).map(z => <path key={z.id} d={z.path} fill="#2a313c" fillRule="evenodd" />)}</g>
        <g className="pb-zone-names">{geo.zones.map(z => <text key={z.id} x={z.at[0]} y={z.at[1]}>{z.name}</text>)}</g>
        {lineups.map(l => {
          const from = drag?.id === l.id && drag.end === 'from' ? drag.at : l.from;
          const to = drag?.id === l.id && drag.end === 'to' ? drag.at : l.to;
          const on = l.id === sel;
          return (
            <g key={l.id} className={'lu ' + l.kind + (on ? ' on' : '') + (on && editable ? ' movable' : '')} data-testid="lu-line" data-id={l.id}>
              <line x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]} />
              <circle className="land" cx={to[0]} cy={to[1]} r={l.kind === 'smoke' ? 22 : l.kind === 'molotov' ? 17 : 12} onPointerDown={grab(l, 'to')} data-testid="lu-to" />
              <circle className="throw" cx={from[0]} cy={from[1]} r={7} onPointerDown={grab(l, 'from')} data-testid="lu-from" />
              {on && <text x={to[0]} y={to[1] - 28}>{l.name}</text>}
            </g>
          );
        })}
      </svg>
      <p className="note">Small dot: where it's thrown from. Circle: where it lands. {editable ? 'Pick a lineup, then drag either end.' : ''}</p>
    </div>
  );
}

function LineupForm({ l, pb, editable, onChange, onDelete }: { l: Lineup; pb: TeamPlaybook; editable: boolean; onChange: (l: Lineup, now?: boolean) => void; onDelete: () => void }) {
  const [paste, setPaste] = useState('');
  const [pasteErr, setPasteErr] = useState<string>();
  const dis = !editable;
  const setups = pb.setups.filter(s => s.side === l.side);
  const opt = (k: 'how' | 'notes', v: string) => { const next: Lineup = { ...l }; if (v) next[k] = v; else delete next[k]; onChange(next); };
  return (
    <div className="card pb-form" data-testid="lu-form">
      <label className="pb-field"><span>Name</span><input className="inp" value={l.name} maxLength={48} disabled={dis} onChange={e => onChange({ ...l, name: e.target.value })} data-testid="lu-name" /></label>
      <div className="pb-field"><span>Grenade</span>
        <div className="seg">{KINDS.map(k => <button key={k.k} type="button" disabled={dis} className={l.kind === k.k ? 'on' : ''} onClick={() => onChange({ ...l, kind: k.k }, true)} data-testid={`lu-kind-${k.k}`}>{k.label}</button>)}</div>
      </div>
      <label className="pb-field"><span>Technique</span>
        <input className="inp" list="lu-how" value={l.how ?? ''} maxLength={40} disabled={dis} onChange={e => opt('how', e.target.value)} data-testid="lu-how" />
        <datalist id="lu-how">{HOW.map(h => <option key={h} value={h} />)}</datalist>
      </label>
      <div className="pb-field"><span>Used in</span>
        <div className="chips">
          {setups.map(s => (
            <label key={s.id} className="chip-check"><input type="checkbox" disabled={dis} checked={!!l.setups?.includes(s.id)} data-testid={`lu-setup-${s.id}`}
              onChange={e => { const cur = l.setups ?? []; const next = e.target.checked ? [...cur, s.id] : cur.filter(x => x !== s.id); const { setups: _s, ...rest } = l; onChange(next.length ? { ...rest, setups: next } : rest, true); }} />{s.name}</label>
          ))}
        </div>
        <span className="muted small">These setups' calls list it.</span>
      </div>
      <div className="pb-field"><span>Exact spot</span>
        {l.exact
          ? <span data-testid="lu-exact">setpos {l.exact.pos.join(' ')} · setang {l.exact.ang.join(' ')} {editable && <button type="button" className="lnk" onClick={() => { const { exact: _e, ...rest } = l; onChange(rest, true); }}>Remove</button>}</span>
          : editable
            ? <form className="krow" onSubmit={e => { e.preventDefault(); const ex = parseSetpos(paste); if (!ex) { setPasteErr('Paste the setpos and setang lines from the console.'); return; } setPasteErr(undefined); setPaste(''); onChange({ ...l, exact: ex }, true); }}>
                <input className="inp" style={{ flex: 1 }} placeholder="setpos … ; setang …" value={paste} onChange={e => setPaste(e.target.value)} data-testid="lu-paste" />
                <button className="btn small" type="submit" data-testid="lu-paste-save">Save</button>
              </form>
            : <span className="muted">Not saved yet: the practice config puts you close to the throw spot.</span>}
        {pasteErr && <span className="result err">{pasteErr}</span>}
        {!l.exact && editable && <span className="muted small">On your practice server, stand on the lineup, type <code>getpos</code> in the console and paste the result here. csbot never reads the console itself.</span>}
      </div>
      <label className="pb-field"><span>Notes</span><textarea className="inp" rows={2} maxLength={300} disabled={dis} value={l.notes ?? ''} onChange={e => opt('notes', e.target.value)} data-testid="lu-notes" /></label>
      {editable && <p style={{ margin: 0 }}><button type="button" className="btn small" onClick={onDelete} data-testid="lu-delete">Delete lineup</button></p>}
    </div>
  );
}

/** The practice config: download it, copy it, or (desktop) put it in CS2's cfg folder. */
function PracticeCard({ map, lineups, session }: { map: string; lineups: readonly Lineup[]; session: Session }) {
  const [res, setRes] = useState<{ ok: boolean; text: string }>();
  const text = () => practiceConfig(map, lineups);
  const file = practiceFileName(map);
  const download = () => {
    const url = URL.createObjectURL(new Blob([text()], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url; a.download = file; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(text()); setRes({ ok: true, text: 'Copied.' }); } catch { setRes({ ok: false, text: "Couldn't copy." }); }
  };
  const install = async () => {
    const r = await session.installPractice(map);
    setRes(r.ok ? { ok: true, text: `Saved: ${r.path}. In CS2, on a practice server: exec ${file.replace(/\.cfg$/, '')}` } : { ok: false, text: r.error ?? 'Not saved.' });
  };
  return (
    <div className="card mt" data-testid="practice-card">
      <div className="card-h"><h3>Practice config</h3><span className="muted small">{lineups.length} lineups · private server</span></div>
      <p style={{ margin: '0 0 8px', color: 'var(--ink2)' }}>
        A <code>{file}</code> for your own practice server: grenade practice settings (infinite grenades, trajectories, buy anywhere) and one command per lineup that puts you on the throw spot, facing the landing spot, grenade in hand.
      </p>
      <p style={{ margin: 0, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button type="button" className="btn" onClick={download} data-testid="practice-download">Download</button>
        <button type="button" className="btn" onClick={() => void copy()} data-testid="practice-copy">Copy</button>
        {session.canInstallPractice && <button type="button" className="btn primary" onClick={() => void install()} data-testid="practice-install">Put it in CS2's cfg folder</button>}
      </p>
      {res && <div className={'result ' + (res.ok ? 'ok' : 'err')} data-testid="practice-result">{res.text}</div>}
      <p className="note">It turns on sv_cheats, so it only works on a private server. Lineups without an exact spot put you close by: find the aim, then save the spot here.</p>
    </div>
  );
}

