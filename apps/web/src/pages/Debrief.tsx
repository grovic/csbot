// Debrief (M6): the match csbot recorded, what the demo says really happened, and what to work on.
import { GEOS, worldToMap } from '@csbot/engine';
import { debriefStats, type DebriefStats } from '@csbot/debrief';
import type { BuyKind, DebriefView, DemoReplay, MatchRecord, MatchSummary } from '@csbot/protocol';
import { useEffect, useState } from 'react';
import { Replay } from '../components/Replay.tsx';
import { debriefOf, type Session, type SessionView } from '../data/session.ts';
import { fmt$, mapName, pct } from '../format.ts';

const BUY_LABEL: Record<BuyKind, string> = { pistol: 'Pistol', eco: 'Eco', force: 'Force', half: 'Half buy', full: 'Full buy' };
const ratio = (a: number, b: number) => (b ? pct(a / b) : '—');
const when = (t: number) => new Date(t).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function Kpis({ rec, st }: { rec: MatchRecord; st: DebriefStats }) {
  const won = rec.score.us > rec.score.them, tie = rec.score.us === rec.score.them;
  const t = st.truth;
  return (
    <div className="kpis" data-testid="debrief-kpis">
      <div className="card kpi" data-testid="debrief-result">
        <div className="lbl">Result · {mapName(rec.map)}</div>
        <div className={'val ' + (tie ? '' : won ? 'win' : 'loss')}>{tie ? 'Draw' : won ? 'Win' : 'Loss'} {rec.score.us}–{rec.score.them}</div>
        <div className="sub">{rec.finished ? when(rec.startedAt) : 'Match not finished (csbot closed or left early)'}</div>
      </div>
      <div className="card kpi" data-testid="debrief-rating">
        <div className="lbl">Your rating</div>
        <div className="val">{st.rating?.toFixed(2) ?? '—'}</div>
        <div className="sub">{st.kpr !== undefined ? `${st.kpr} kills/round · ADR ${st.adr}` : 'from your own game data'} · HLTV 1.0 style</div>
      </div>
      <div className="card kpi" data-testid="debrief-buyread">
        <div className="lbl">Enemy buy read</div>
        <div className="val">{t ? ratio(t.buyRead.correct, t.buyRead.total) : '—'}</div>
        <div className="sub">{t ? `right in ${t.buyRead.correct}/${t.buyRead.total} rounds · money in band ${ratio(t.band.inside, t.band.total)}` : 'needs the match demo'}</div>
      </div>
      <div className="card kpi" data-testid="debrief-siteread">
        <div className="lbl">Site read (CT)</div>
        <div className="val">{t && t.siteRead.total ? ratio(t.siteRead.correct, t.siteRead.total) : '—'}</div>
        <div className="sub">{t ? (t.siteRead.total ? `right site in ${t.siteRead.correct}/${t.siteRead.total} plants · openings won ${t.openings.won}/${t.openings.total}` : 'no plants on your CT rounds') : 'needs the match demo'}</div>
      </div>
    </div>
  );
}

function WorkOn({ rec, session, canWrite }: { rec: MatchRecord; session: Session; canWrite: boolean }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const w = rec.workOn;
  const write = async () => {
    setBusy(true); setErr(undefined);
    setErr(await session.writeWorkOn(rec.id));
    setBusy(false);
  };
  return (
    <div className="card" data-testid="workon">
      <div className="card-h"><h3>Work on next</h3><span className="muted small">{w ? `Claude${w.model && w.model !== 'fictional' ? ` · ${w.model}` : ''} · from csbot's numbers` : 'written by your Claude Code'}</span></div>
      {w ? (
        <>
          <div className="h4">Team</div>
          <ol className="ul">{w.team.map(x => <li key={x}>{x}</li>)}</ol>
          {w.you.length > 0 && <><div className="h4">You</div><ul className="ul">{w.you.map(x => <li key={x}>{x}</li>)}</ul></>}
        </>
      ) : <p className="muted" style={{ margin: '6px 0' }}>No notes yet for this match.</p>}
      {canWrite && (
        <p style={{ marginTop: 10 }}>
          <button className="btn" type="button" disabled={busy} onClick={() => void write()} data-testid="workon-write">{busy ? 'Claude is writing…' : w ? 'Write again' : 'Write with Claude'}</button>
          <span className="muted small" style={{ marginLeft: 8 }}>one call on your Claude plan</span>
        </p>
      )}
      {err && <div className="result err" data-testid="workon-error">{err}</div>}
    </div>
  );
}

/** Their money per round: the estimate band (whisker) and, with the demo, what they really had (dot). */
function EnemyMoney({ rec, st }: { rec: MatchRecord; st: DebriefStats }) {
  const rounds = rec.rounds.filter(r => r.enemy || st.truth?.enemyMoney.some(e => e.round === r.round));
  if (!rounds.length) return null;
  const W = 720, H = 180, pad = 26, max = 9000;
  const x = (i: number) => pad + (i + 0.5) * ((W - pad * 2) / rounds.length);
  const y = (v: number) => H - pad - (Math.min(v, max) / max) * (H - pad * 2);
  return (
    <div className="card" data-testid="enemy-money">
      <div className="card-h"><h3>Enemy money per round</h3><span className="muted small">band = csbot's estimate{st.truth ? ' · dot = the demo' : ''}</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} className="moneychart" role="img" aria-label="Enemy money per round">
        {[0, 2000, 4000, 6000, 8000].map(v => (
          <g key={v}><line x1={pad} x2={W - pad} y1={y(v)} y2={y(v)} className="grid" /><text x={2} y={y(v) + 3} className="axis">{v / 1000}k</text></g>
        ))}
        {rounds.map((r, i) => {
          const tr = st.truth?.enemyMoney.find(e => e.round === r.round);
          const inside = tr && r.enemy ? tr.truth >= r.enemy.lo - 50 && tr.truth <= r.enemy.hi + 50 : undefined;
          return (
            <g key={r.round} data-round={r.round}>
              {r.enemy && <line x1={x(i)} x2={x(i)} y1={y(r.enemy.lo)} y2={y(r.enemy.hi)} className="band" />}
              {tr && <circle cx={x(i)} cy={y(tr.truth)} r={3.6} className={'truth' + (inside === false ? ' off' : '')}><title>{`Round ${r.round}: really ${fmt$(tr.truth)} (${tr.truthBuy})${r.enemy ? ` · estimate ${fmt$(r.enemy.lo)}–${fmt$(r.enemy.hi)} (${r.enemy.read})` : ''}`}</title></circle>}
              {(i === 0 || r.round % 5 === 0 || r.round === 13) && <text x={x(i)} y={H - 6} className="axis" textAnchor="middle">{r.round}</text>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function Splits({ st }: { st: DebriefStats }) {
  const buys = (Object.entries(st.byBuy) as [BuyKind, { played: number; won: number }][]).sort((a, b) => b[1].played - a[1].played);
  return (
    <div className="card" data-testid="debrief-splits">
      <div className="card-h"><h3>Rounds won</h3><span className="muted small">by side and by our buy</span></div>
      <div className="bars" style={{ ['--lw' as string]: '90px' }}>
        {(['CT', 'T'] as const).map(s => (
          <div key={s} className="br"><span className="bl">{s} side</span><div className="bt"><div className="bf" style={{ width: `${st.bySide[s].played ? (st.bySide[s].won / st.bySide[s].played) * 100 : 0}%` }} /></div><span className="bv">{st.bySide[s].won}/{st.bySide[s].played}</span></div>
        ))}
        {buys.map(([k, t]) => (
          <div key={k} className="br" data-buy={k}><span className="bl">{BUY_LABEL[k]}</span><div className="bt"><div className="bf" style={{ width: `${t.played ? (t.won / t.played) * 100 : 0}%` }} /></div><span className="bv">{t.won}/{t.played}</span></div>
        ))}
      </div>
      <p className="note">{st.planChanges} plan changes from intel · {st.intel} intel logged in the room.</p>
    </div>
  );
}

function Deaths({ rec, st }: { rec: MatchRecord; st: DebriefStats }) {
  const geo = GEOS[rec.map];
  const deaths = st.truth?.myDeaths ?? [];
  if (!geo || !deaths.length) return null;
  return (
    <div className="card" data-testid="debrief-deaths">
      <div className="card-h"><h3>Where you died</h3><span className="muted small">{deaths.length} deaths · from the demo</span></div>
      <svg viewBox="0 0 1000 1000" className="deathmap" role="img" aria-label="Where you died">
        <path d={geo.floor} fill="#20252d" fillRule="evenodd" stroke="#3a4250" strokeWidth={4} />
        {geo.zones.filter(z => z.site).map(z => <text key={z.id} x={z.at[0]} y={z.at[1]} className="site">{z.site}</text>)}
        {deaths.map(d => { const [mx, my] = worldToMap(geo, d.x, d.y, d.z); return <g key={`${d.round}-${d.t}`}><text x={mx} y={my} className="x">✕</text><title>{`Round ${d.round}, ${Math.round(d.t)} s in${d.weapon ? `, ${d.weapon}` : ''}`}</title></g>; })}
      </svg>
    </div>
  );
}

function RoundsTable({ rec }: { rec: MatchRecord }) {
  const truth = rec.truth;
  return (
    <div className="card" data-testid="debrief-rounds">
      <div className="card-h"><h3>Round by round</h3><span className="muted small">csbot's reads at the time{truth ? ' · demo truth' : ''}</span></div>
      <div className="scroll-x">
        <table className="t">
          <thead><tr><th>#</th><th>Side</th><th>Result</th><th>Our buy</th><th>Enemy read</th>{truth && <th>Really</th>}<th>Forecast</th><th>Call</th><th className="r">Intel</th><th className="r">You</th></tr></thead>
          <tbody>
            {rec.rounds.map(r => {
              const d = truth?.rounds.find(x => x.round === r.round);
              const enemies = d?.players.filter(p => p.side !== r.side) ?? [];
              const avg = enemies.length ? enemies.reduce((s, p) => s + p.startMoney, 0) / enemies.length : undefined;
              const site = r.forecast ? (r.forecast.site.B >= r.forecast.site.A ? 'B' : 'A') : undefined;
              return (
                <tr key={r.round} className={r.winner === 'us' ? 'won' : r.winner === 'them' ? 'lost' : ''} data-round={r.round}>
                  <td>{r.round}</td><td>{r.side}</td>
                  <td>{r.winner === 'us' ? 'Won' : r.winner === 'them' ? 'Lost' : '—'}{r.reason ? <span className="muted"> · {r.reason}</span> : null}</td>
                  <td>{r.ourBuy ? BUY_LABEL[r.ourBuy] : '—'}</td>
                  <td>{r.enemy ? <>{r.enemy.read} <span className="muted">{fmt$(r.enemy.lo)}–{fmt$(r.enemy.hi)}</span></> : '—'}</td>
                  {truth && <td>{avg !== undefined ? fmt$(avg) : '—'}{d?.plantSite ? <span className="muted"> · plant {d.plantSite}</span> : null}</td>}
                  <td>{r.forecast && site ? `${r.forecast.enemy === 'CT' ? 'light' : 'hit'} ${site} ${pct(r.forecast.site[site])}` : '—'}</td>
                  <td className="callcell" title={r.call?.head}>{r.call ? <>{r.call.head}{r.call.planChanged ? <span className="chip est">changed</span> : null}{r.call.source === 'claude' ? <span className="muted"> · Claude</span> : null}</> : '—'}</td>
                  <td className="r">{r.intel || ''}</td>
                  <td className="r">{r.me ? `${r.me.kills}k ${r.me.damage}${r.me.died ? ' ✕' : ''}` : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DemoCard({ view, session, rec }: { view: DebriefView; session: Session; rec: MatchRecord }) {
  const [err, setErr] = useState<string>();
  const [over, setOver] = useState(false);
  const can = session.canDebrief;
  const st = view.demo?.status ?? 'none';
  const add = async (file?: string) => { setErr(undefined); setErr(await session.ingestDemo(file)); };
  return (
    <div className={'card demo-drop' + (over ? ' over' : '')} data-testid="demo-card"
      onDragOver={e => { if (can) { e.preventDefault(); setOver(true); } }} onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; const p = f ? session.pathForFile(f) : undefined; if (p) void add(p); }}>
      <div className="card-h"><h3>Match demo</h3><span className="muted small" data-testid="demo-status" data-status={rec.truth ? 'ready' : st}>{rec.truth ? `read: ${rec.truth.source.file}` : st === 'parsing' ? 'reading…' : 'not added'}</span></div>
      <p style={{ margin: '4px 0 8px', color: 'var(--ink2)' }}>
        The demo shows what really happened: their money, the plant sites, where everyone died. csbot reads it on this PC; nothing is uploaded.
      </p>
      <ul className="ul small">
        <li><b>Valve matchmaking or Premier:</b> in CS2, Watch → Your Matches → Download. It lands in the replays folder.</li>
        <li><b>FACEIT:</b> download the demo from the match room (.dem, .dem.gz or .dem.zst all work).</li>
      </ul>
      {can ? (
        <p style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" type="button" onClick={() => void add()} data-testid="demo-add">Add a demo…</button>
          <button className="btn" type="button" onClick={() => session.openReplays()} disabled={!view.demo?.replaysDir}>Open the replays folder</button>
          <span className="muted small" style={{ alignSelf: 'center' }}>or drop a .dem file here</span>
        </p>
      ) : <p className="note">Demos are read by the csbot desktop app that recorded the match.</p>}
      {(err || (st === 'error' && view.demo?.detail)) && <div className="result err" data-testid="demo-error">{err ?? view.demo?.detail}</div>}
    </div>
  );
}

function Progress({ matches, session, current, canPick }: { matches: MatchSummary[]; session: Session; current?: string; canPick: boolean }) {
  if (!matches.length) return null;
  const rated = matches.filter(m => m.rating !== undefined).slice(0, 12).reverse();
  const won = matches.filter(m => m.finished && m.score.us > m.score.them).length, done = matches.filter(m => m.finished).length;
  const byMap = new Map<string, { w: number; n: number }>();
  for (const m of matches.filter(x => x.finished)) { const t = byMap.get(m.map) ?? { w: 0, n: 0 }; t.n++; if (m.score.us > m.score.them) t.w++; byMap.set(m.map, t); }
  const W = 300, H = 60;
  const pts = rated.map((m, i) => [8 + (i * (W - 16)) / Math.max(1, rated.length - 1), H - 8 - ((Math.min(2, m.rating!) - 0.4) / 1.6) * (H - 16)] as const);
  return (
    <div className="card" data-testid="debrief-progress">
      <div className="card-h"><h3>Progress</h3><span className="muted small">{matches.length} matches on this PC · won {won}/{done}</span></div>
      {rated.length > 1 && (
        <svg viewBox={`0 0 ${W} ${H}`} className="spark" aria-label="Rating over the last matches">
          <line x1={0} x2={W} y1={H - 8 - ((1 - 0.4) / 1.6) * (H - 16)} y2={H - 8 - ((1 - 0.4) / 1.6) * (H - 16)} className="grid" />
          <polyline points={pts.map(p => p.join(',')).join(' ')} className="line" />
          {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={2.5} />)}
        </svg>
      )}
      <div className="bars" style={{ ['--lw' as string]: '80px' }}>
        {[...byMap].sort((a, b) => b[1].n - a[1].n).map(([map, t]) => (
          <div key={map} className="br"><span className="bl">{mapName(map)}</span><div className="bt"><div className="bf" style={{ width: `${(t.w / t.n) * 100}%` }} /></div><span className="bv">{t.w}/{t.n}</span></div>
        ))}
      </div>
      <table className="t" style={{ marginTop: 8 }}>
        <tbody>
          {matches.slice(0, 10).map(m => (
            <tr key={m.id} className={m.id === current ? 'sel' : ''} data-testid="match-row">
              <td>{canPick ? <button className="lnk" type="button" onClick={() => session.selectMatch(m.id)}>{mapName(m.map)}</button> : mapName(m.map)}</td>
              <td>{m.score.us}–{m.score.them}{m.finished ? '' : ' (unfinished)'}</td>
              <td className="r">{m.rating?.toFixed(2) ?? ''}</td>
              <td className="muted small">{when(m.startedAt)}{m.hasDemo ? ' · demo' : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The round replay, loaded when asked for (a whole match is a few MB). */
function ReplayCard({ rec, session, available, fictional }: { rec: MatchRecord; session: Session; available: boolean; fictional: boolean }) {
  const [replay, setReplay] = useState<DemoReplay | null>();
  const [open, setOpen] = useState(false);
  useEffect(() => { setReplay(undefined); setOpen(false); }, [rec.id]);
  useEffect(() => { if (open && replay === undefined) void session.getReplay(rec.id).then(r => setReplay(r ?? null)); }, [open, replay, rec.id, session]);
  if (!available) return null;
  return (
    <div className="card" data-testid="replay-card">
      <div className="card-h"><h3>Round replay</h3><span className="muted small">from the demo · after the match only</span></div>
      {!open ? (
        <p style={{ margin: '6px 0' }}><button className="btn" type="button" onClick={() => setOpen(true)} data-testid="replay-open">Open the 2D replay</button></p>
      ) : replay === undefined ? <p className="muted">Loading…</p> : replay === null ? <p className="muted">No replay kept for this match.</p> : (
        <Replay replay={replay} {...(rec.me ? { me: rec.me.steamid } : {})} {...(fictional ? { label: 'Fictional movement made from csbot’s own plans and setups.' } : {})} />
      )}
    </div>
  );
}

export function Debrief({ view, session }: { view: SessionView; session: Session }) {
  const d = debriefOf(view);
  const rec = d.record;
  if (!rec) {
    return (
      <div className="card onboard" data-testid="debrief-empty">
        <div className="kick">Debrief</div>
        <h2>No match recorded yet</h2>
        <div className="sub">
          {view.role === 'member' ? "The host's csbot sends the debrief here after a match." : 'csbot records every match it is open for: rounds, buys, its reads and calls. The debrief appears here after your first round.'}
        </div>
      </div>
    );
  }
  const st = debriefStats(rec);
  const demo = view.role === 'demo';
  return (
    <section data-testid="debrief">
      {demo && <div className="chip est" style={{ marginBottom: 10 }} data-testid="debrief-fictional">Demo: a fictional match, demo truth and notes</div>}
      <Kpis rec={rec} st={st} />
      <div className="grid2 mt">
        <WorkOn rec={rec} session={session} canWrite={session.canDebrief} />
        <Splits st={st} />
      </div>
      <div className="mt"><EnemyMoney rec={rec} st={st} /></div>
      <div className="grid2 mt">
        <Deaths rec={rec} st={st} />
        <DemoCard view={d} session={session} rec={rec} />
      </div>
      <div className="mt"><ReplayCard rec={rec} session={session} available={demo || !!d.replay} fictional={demo} /></div>
      <div className="mt"><RoundsTable rec={rec} /></div>
      <div className="mt"><Progress matches={d.matches} session={session} current={rec.id} canPick={session.canDebrief} /></div>
    </section>
  );
}
