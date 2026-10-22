// Scout: who you're playing, read in a minute before the match.
// Versus → 3 things to know → briefing → their players → map veto → your team.
// Every number is computed from FACEIT/Steam data; the AI only words the briefing and the tips.

import type { ScoutMapRow, ScoutPlayer, ScoutView } from '@csbot/protocol';
import { useState } from 'react';
import { Avatar, elo, Form, kd, PartyBadge, roleText, SourceChips, ThreatBar } from '../components/ScoutBits.tsx';
import { DEMO_ME } from '../data/demoScout.ts';
import { scoutOf, type Session, type SessionView } from '../data/session.ts';
import { mapName } from '../format.ts';

const LITTLE_DATA = 25;
const ago = (at?: number) => {
  if (!at) return '';
  const m = Math.round((Date.now() - at) / 60_000);
  return m < 1 ? 'just now' : m < 90 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};
const pct = (n?: number) => (n === undefined ? '–' : `${Math.round(n)}%`);

// ------------------------------------------------------------------ empty, loading, error

function ScoutForm({ session, compact = false }: { session: Session; compact?: boolean }) {
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!link.trim()) { setErr('Paste the link of your FACEIT match room.'); return; }
    setBusy(true); setErr(undefined);
    const error = await session.scoutMatch(link);
    setBusy(false);
    if (error) setErr(error); else setLink('');
  };
  return (
    <form className={'scoutform' + (compact ? ' compact' : '')} onSubmit={submit}>
      <div className="joinrow">
        <input className="inp" value={link} onChange={e => setLink(e.target.value)} placeholder="https://www.faceit.com/en/cs2/room/1-…" aria-label="FACEIT match room link" data-testid="scout-match-input" />
        <button className="btn primary" type="submit" disabled={busy} data-testid="scout-match-submit">{busy ? 'Scouting…' : 'Scout match'}</button>
        <button className="btn" type="button" onClick={() => { setErr(undefined); void session.scoutSample(); }} data-testid="scout-sample">Try the sample match</button>
      </div>
      {err && <div className="result err" data-testid="scout-error">{err}</div>}
    </form>
  );
}

/** Premier and other Valve matches: the players come from the console's `status`, pasted by the host. */
function StatusForm({ session, compact = false }: { session: Session; compact?: boolean }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) { setErr('Paste what status printed in the console.'); return; }
    setBusy(true); setErr(undefined);
    const error = await session.scoutStatus(text);
    setBusy(false);
    if (error) setErr(error); else setText('');
  };
  return (
    <form className={'scoutform status-form' + (compact ? ' compact' : '')} onSubmit={submit} data-testid="status-form">
      <div className="muted small">Premier or another Valve match: in CS2, open the console, type <code>status</code>, select what it prints, copy it (Ctrl+C) and paste it here.</div>
      <textarea className="inp" rows={compact ? 3 : 4} value={text} onChange={e => setText(e.target.value)} placeholder="# userid name uniqueid … (the output of status)" aria-label="Output of the status command" data-testid="status-input" spellCheck={false} />
      <div><button className="btn" type="submit" disabled={busy} data-testid="status-submit">{busy ? 'Looking them up…' : 'Read the players'}</button></div>
      {err && <div className="result err" data-testid="status-error">{err}</div>}
    </form>
  );
}

/** Premier: players csbot can't place yet. The host marks them; once a team has five, the rest are sorted. */
function Unsorted({ scout, session, host }: { scout: ScoutView; session: Session; host: boolean }) {
  const list = scout.unsorted ?? [];
  if (!list.length) return null;
  return (
    <div className="card unsorted" data-testid="unsorted">
      <div className="card-h"><h3>Who's on your team?</h3><span className="muted small">{scout.us.players.length} of 5 known</span></div>
      <p className="muted small" style={{ margin: '0 0 8px' }}>Valve's matchmaking doesn't say who's on which team. csbot knows you, teammates you've watched after dying and room members{host ? '; mark the others. Once a team has five, the rest go to the other side.' : '. The host sorts the others.'}</p>
      {list.map(p => (
        <div className="unsorted-row" key={p.id} data-testid="unsorted-row" data-nick={p.nickname}>
          <Avatar name={p.nickname} />
          <span className="pc-name">{p.nickname}</span>
          <span className="muted small">{p.level ? `lvl ${p.level} · ${elo(p.elo)}` : scout.sources.faceit === 'live' ? 'no FACEIT account' : 'FACEIT not checked'}{p.steam?.cs2Hours !== undefined ? ` · ${p.steam.cs2Hours.toLocaleString('en-US')} h` : ''}</span>
          {host && <span className="unsorted-btns">
            <button className="btn small" type="button" onClick={() => void session.setPremierSide(p.steamid ?? p.id, 'us')} data-testid="mark-us">My team</button>
            <button className="btn small" type="button" onClick={() => void session.setPremierSide(p.steamid ?? p.id, 'them')} data-testid="mark-them">Opponent</button>
          </span>}
        </div>
      ))}
    </div>
  );
}

/** Shown when csbot couldn't tell which team is the host's (or the host swapped it): a way to fix it. */
function SideNote({ scout, session }: { scout: ScoutView; session: Session }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const swap = async () => { setBusy(true); setErr(undefined); const e = await session.swapScoutSides(); setBusy(false); if (e) setErr(e); };
  const text = scout.sideBy === 'manual'
    ? <>You swapped the teams for this match.</>
    : <><b>Is {scout.us.name} your team?</b> csbot couldn't tell: CS2 isn't running and your FACEIT nickname isn't on either roster. Set it in Settings → Data sources so this is automatic.</>;
  return (
    <div className="result warn side-note" data-testid="side-note">
      <span>{text}</span>
      <button className="btn" type="button" disabled={busy} onClick={() => void swap()} data-testid="swap-sides">{busy ? 'Swapping…' : 'Swap teams'}</button>
      {err && <span className="err-text">{err}</span>}
    </div>
  );
}

function RecentList({ scout, session, compact = false }: { scout: ScoutView; session: Session; compact?: boolean }) {
  const [busy, setBusy] = useState<string>();
  const [err, setErr] = useState<string>();
  const recent = scout.recent ?? [];
  if (!recent.length) return null;
  const pick = async (id: string) => { setBusy(id); setErr(undefined); const e = await session.scoutMatch(id); setBusy(undefined); if (e) setErr(e); };
  return (
    <div className={'recent' + (compact ? ' compact' : '')} data-testid="recent-matches">
      <div className="muted small">Your recent FACEIT matches{scout.account?.nickname ? ` (${scout.account.nickname})` : ''}</div>
      <div className="recent-list">
        {recent.map(m => (
          <button key={m.id} type="button" className={'recent-m' + (m.live ? ' live' : '') + (scout.matchId === m.id ? ' on' : '')} disabled={!!busy}
            onClick={() => void pick(m.id)} data-testid="recent-match" data-id={m.id} data-live={m.live ? '1' : '0'}>
            {m.live ? <span className="rb live">LIVE</span> : m.won === undefined ? <span className="rb">–</span> : <span className={'rb ' + (m.won ? 'w' : 'l')}>{m.won ? 'W' : 'L'}</span>}
            <span className="vs">{m.vs ? `vs ${m.vs}` : m.status.toLowerCase()}</span>
            <span className="muted small">{busy === m.id ? 'scouting…' : m.startedAt ? new Date(m.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''}</span>
          </button>
        ))}
      </div>
      {err && <div className="result err">{err}</div>}
    </div>
  );
}

function Empty({ view, session, scout }: { view: SessionView; session: Session; scout: ScoutView }) {
  if (view.role === 'member') {
    return (
      <div className="card onboard" data-testid="scout-empty">
        <div className="kick">Scout</div>
        <h2>The host hasn't scouted this match yet</h2>
        <div className="sub">When {view.screen?.room?.hostName ?? 'the admin'} scouts the match, the enemy players, the map veto and the briefing show up here.</div>
      </div>
    );
  }
  if (!session.canScout) {
    return (
      <div className="card onboard" data-testid="scout-empty">
        <div className="kick">Scout</div>
        <h2>Scouting runs on the host</h2>
        <div className="sub">The csbot desktop app fetches FACEIT and Steam data for both teams and writes a briefing. Teammates see it in the room.</div>
      </div>
    );
  }
  const noKey = scout.sources.faceit === 'missing-key' || scout.sources.faceit === 'off';
  return (
    <div className="card onboard wide" data-testid="scout-empty">
      <div className="kick">Scout</div>
      <h2>Scout your next match</h2>
      <div className="sub">Paste the link of your FACEIT match room. csbot looks up all ten players (FACEIT and Steam), compares the map pool and writes a briefing.</div>
      {scout.status === 'error' && scout.error && <div className="result err" data-testid="scout-error">{scout.error}</div>}
      <ScoutForm session={session} />
      <RecentList scout={scout} session={session} />
      {!noKey && !scout.account && <p className="note">Add your FACEIT nickname in <a href="#/settings">Settings</a> to list your recent matches here; a live match then gets scouted by itself.</p>}
      {noKey && <p className="note">Real matches need your FACEIT API key: <a href="#/settings">Settings → Data sources</a>. The sample match works without one.</p>}
      {session.canScoutStatus
        ? <><div className="or-line"><span>or</span></div><StatusForm session={session} /></>
        : <p className="note">Premier doesn't publish rosters: paste the console's status in the desktop app, or csbot learns opponents from the demo after the match.</p>}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="skel" data-testid="scout-loading" aria-busy="true">
      <div className="card sk h120" />
      <div className="know3"><div className="card sk h90" /><div className="card sk h90" /><div className="card sk h90" /></div>
      <div className="pcards">{[0, 1, 2, 3, 4].map(i => <div key={i} className="card sk h160" />)}</div>
      <p className="muted small" style={{ marginTop: 10 }}>Looking up both teams on FACEIT and Steam…</p>
    </div>
  );
}

// ------------------------------------------------------------------ sections

function stackWords(players: ScoutPlayer[]): string {
  const sizes = new Map<string, number>();
  for (const p of players) if (p.party) sizes.set(p.party, (sizes.get(p.party) ?? 0) + 1);
  const words = [...sizes.values()].sort((a, b) => b - a).map(n => (n === 2 ? 'duo' : `${n}-stack`));
  return words.length ? words.join(' + ') : 'no premades found';
}

function teamMapRate(rows: ScoutMapRow[], map: string | undefined, side: 'us' | 'them'): string {
  const r = map ? rows.find(x => x.map === map) : undefined;
  return r && r[side].matches ? ` · ${r[side].winRate}% on ${mapName(map)}` : '';
}

function Versus({ scout }: { scout: ScoutView }) {
  const inRoom = scout.us.players.filter(p => p.room && p.room !== 'random').length;
  const randoms = scout.us.players.filter(p => p.room === 'random').length;
  const wc = scout.winChance;
  const kicker = scout.platform === 'sample' ? 'Sample match · FACEIT 5v5' : scout.platform === 'faceit' ? 'FACEIT 5v5' : scout.platform === 'premier' ? 'Premier · from status' : 'Match';
  return (
    <div className="card vs" data-testid="versus">
      <div className="vs-side">
        <div className="vs-name"><i className="key ct" />{scout.us.name}</div>
        <div className="vs-elo">{elo(scout.us.avgElo)}</div>
        <div className="muted small">avg ELO · {inRoom} in room{randoms ? ` + ${randoms} random` : ''}{teamMapRate(scout.maps, scout.map, 'us')}</div>
      </div>
      <div className="vs-mid">
        <div className="kicker">{kicker}</div>
        <div className="vs-map">{scout.map ? mapName(scout.map) : 'Map not picked yet'}</div>
        {wc ? (
          <div className="wc" data-testid="win-chance">
            <div className="wc-bar"><i style={{ width: `${wc.value * 100}%` }} /><i style={{ width: `${(1 - wc.value) * 100}%` }} /></div>
            <div className="wc-lbl"><span>Win chance <b>{Math.round(wc.value * 100)}%</b></span><span>{wc.basis}</span></div>
          </div>
        ) : <div className="muted small">{scout.unsorted?.length ? 'Win chance once the teams are sorted' : "Win chance needs both teams' ELO"}</div>}
      </div>
      <div className="vs-side r">
        <div className="vs-name">{scout.them.name}<i className="key t" /></div>
        <div className="vs-elo">{elo(scout.them.avgElo)}</div>
        <div className="muted small">avg ELO · {stackWords(scout.them.players)}{teamMapRate(scout.maps, scout.map, 'them')}</div>
      </div>
    </div>
  );
}

function Things({ scout }: { scout: ScoutView }) {
  const ai = scout.report.status === 'ready' && scout.report.things?.length ? scout.report.things : undefined;
  const items = ai ?? scout.facts;
  if (!items.length) return null;
  return (
    <div className="know3" data-testid="things" data-source={ai ? 'ai' : 'data'}>
      {items.slice(0, 3).map((t, i) => (
        <div className="know" key={i}>
          <div className="kn">{i + 1} · {ai ? 'from the briefing' : 'from the data'}</div>
          <div className="kt">{t}</div>
        </div>
      ))}
    </div>
  );
}

function Briefing({ scout, session, host }: { scout: ScoutView; session: Session; host: boolean }) {
  const r = scout.report;
  const off = r.status === 'off' || scout.sources.claude === 'off';
  const status = off ? 'off' : r.status;
  const canRun = host && !off && status !== 'running';
  const [refusal, setRefusal] = useState<string>();
  const run = async () => { setRefusal(undefined); setRefusal(await session.runScoutReport()); };
  return (
    <div className="card brief" data-testid="report-status" data-status={status}>
      <div className="card-h">
        <h3>Briefing <span className="muted small" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>· written by the host's Claude Code from the numbers on this page</span></h3>
        {canRun && <button className="btn" type="button" onClick={() => void run()} data-testid="scout-run-report">{status === 'idle' ? 'Write briefing' : 'Run again'}</button>}
      </div>
      {refusal && <div className="result err" data-testid="report-refusal">{refusal}</div>}
      {status === 'running' && <div className="brief-run"><span className="pulse" />The host's Claude Code is writing the briefing…</div>}
      {status === 'off' && <div className="muted">Claude Code isn't installed on the host. Everything else on this page works without it.</div>}
      {status === 'error' && <div className="result err">{r.error ?? 'The briefing failed.'}</div>}
      {status === 'idle' && <div className="muted">{host ? 'Not written yet. One call to your own Claude Code, once per match.' : "The host hasn't written it yet."}</div>}
      {status === 'ready' && (
        <div className="brief-body">
          <p className="brief-sum" data-testid="report-summary">{r.summary}</p>
          <div className="brief-cols">
            {!!r.plan?.length && <div><div className="h4">Game plan</div><ul className="ul">{r.plan.map((p, i) => <li key={i}>{p}</li>)}</ul></div>}
            {r.veto && <div><div className="h4">Veto</div><p className="brief-veto">{r.veto}</p></div>}
          </div>
          <div className="muted small">{[r.model, r.ms ? `${(r.ms / 1000).toFixed(1)} s` : undefined, r.at ? ago(r.at) : undefined].filter(Boolean).join(' · ')}</div>
        </div>
      )}
    </div>
  );
}

function EnemyCard({ p, sel, onSelect }: { p: ScoutPlayer; sel: boolean; onSelect: () => void }) {
  const role = roleText(p);
  return (
    <button type="button" className={'pc' + (sel ? ' sel' : '')} onClick={onSelect} data-testid="enemy-card" data-nick={p.nickname} aria-pressed={sel}>
      <div className="pc-top">
        <Avatar name={p.nickname} />
        <div style={{ minWidth: 0 }}>
          <div className="pc-name">{p.nickname} <PartyBadge party={p.party} /></div>
          <div className="pc-sub">{[role, p.level ? `lvl ${p.level}` : undefined, elo(p.elo)].filter(Boolean).join(' · ')}</div>
        </div>
      </div>
      <ThreatBar p={p} />
      <div className="pc-stats"><span><em>K/D</em>{kd(p.stats.kd)}</span>{p.keyStat && p.keyStat !== `${kd(p.stats.kd)} K/D` && <span className="ks">{p.keyStat}</span>}</div>
      {!!p.flags.length && <div className="flags">{p.flags.map(f => <span key={f} className={'flag' + (/ban/i.test(f) ? ' bad' : '')}>{f}</span>)}</div>}
      {p.tip && <div className="pc-tip">{p.tip}</div>}
    </button>
  );
}

function EnemyDetail({ p, map, onMove }: { p: ScoutPlayer; map?: string; onMove?: () => void }) {
  const maps = Object.entries(p.maps).sort((a, b) => b[1].matches - a[1].matches);
  const s = p.steam;
  return (
    <div className="card pdetail" data-testid="enemy-detail" data-nick={p.nickname}>
      <div>
        <div className="card-h" style={{ marginBottom: 6 }}><h3>{p.nickname} · profile</h3>{roleText(p) && <span className="role">{roleText(p)}</span>}{onMove && <button className="btn small" type="button" onClick={onMove} data-testid="move-us">On my team</button>}</div>
        <div className="cfg">
          <span className="k">FACEIT</span><span className="v">lvl {p.level ?? '–'} · {elo(p.elo)} ELO · {p.stats.matches?.toLocaleString('en-US') ?? '–'} matches</span>
          <span className="k">Overall</span><span className="v">{pct(p.stats.winRate)} wins · {kd(p.stats.kd)} K/D · {pct(p.stats.hs)} HS{p.stats.adr !== undefined ? ` · ${Math.round(p.stats.adr)} ADR` : ''}</span>
          <span className="k">Form</span><span className="v">{p.stats.recent ? <Form recent={p.stats.recent} /> : '–'}</span>
          {p.party && <><span className="k">Premade</span><span className="v">party {p.party}</span></>}
          <span className="k">Steam</span><span className="v">{s ? steamLine(s) : 'not checked'}</span>
        </div>
        {!!p.flags.length && <div className="flags" style={{ marginTop: 10 }}>{p.flags.map(f => <span key={f} className={'flag' + (/ban/i.test(f) ? ' bad' : '')}>{f}</span>)}</div>}
        {p.tip && <div className="youline sm"><span className="yb">TIP</span><span>{p.tip}</span></div>}
      </div>
      <div>
        <div className="card-h" style={{ marginBottom: 6 }}><h3>By map</h3><span className="muted small">FACEIT 5v5</span></div>
        {maps.length ? (
          <div className="tw scroll-x"><table className="t">
            <thead><tr><th>Map</th><th className="r">Matches</th><th className="r">Win</th><th className="r">K/D</th></tr></thead>
            <tbody>{maps.map(([m, x]) => (
              <tr key={m} className={m === map ? 'me-row' : ''}><td>{mapName(m)}</td><td className="r">{x.matches}</td><td className="r">{Math.round(x.winRate)}%</td><td className="r">{kd(x.kd)}</td></tr>
            ))}</tbody>
          </table></div>
        ) : <div className="muted small">No map stats.</div>}
      </div>
      <div>
        <div className="card-h" style={{ marginBottom: 6 }}><h3>Where he plays</h3></div>
        <div className="mini-ph">Positions per side come from his demos: <b>M4</b>.</div>
      </div>
    </div>
  );
}

function steamLine(s: NonNullable<ScoutPlayer['steam']>): string {
  const bits: string[] = [];
  if (s.accountAgeYears !== undefined) bits.push(s.accountAgeYears >= 1 ? `account ${s.accountAgeYears} yrs` : `account ${Math.max(1, Math.round(s.accountAgeYears * 12))} months`);
  bits.push(s.cs2Hours !== undefined ? `${s.cs2Hours.toLocaleString('en-US')} h in CS2` : 'CS2 hours hidden');
  const bans = (s.vacBans ?? 0) + (s.gameBans ?? 0);
  bits.push(bans ? `${bans} ban${bans > 1 ? 's' : ''}` : 'no bans');
  if (s.private) bits.push('private profile');
  return bits.join(' · ');
}

const ACTION: Record<NonNullable<ScoutMapRow['action']>, string> = {
  ban: 'Your ban', 'their-ban': "They'll likely ban", pick: 'Pick', 'their-pick': 'Their pick', decider: 'Decider', neutral: 'Neutral',
};
const edgeBg = (d: number) => { const a = Math.min(0.55, (Math.abs(d) / 22) * 0.55); return d >= 0 ? `rgba(57,135,229,${a})` : `rgba(227,73,72,${a})`; };

function Veto({ scout }: { scout: ScoutView }) {
  return (
    <div className="card" data-testid="veto">
      <div className="card-h"><h3>Map veto</h3><span className="muted small">their win rate · yours (matches) · your edge</span></div>
      <div className="vgrid">
        {scout.maps.map(r => {
          const action = r.action ?? 'neutral';
          const little = r.us.matches < LITTLE_DATA || r.them.matches < LITTLE_DATA;
          return (
            <div key={r.map} className={'vt ' + action + (r.map === scout.map ? ' here' : '')} data-testid="veto-map" data-map={r.map} data-action={action}>
              <div className="vt-name">{mapName(r.map)}<span className="edge" style={{ background: edgeBg(r.edge) }}>{r.edge > 0 ? '+' : ''}{r.edge}</span></div>
              <div className="vt-row">them {r.them.winRate}% ({r.them.matches})</div>
              <div className="vt-row">you {r.us.winRate}% ({r.us.matches})</div>
              <span className="vt-act">{ACTION[action]}{little ? ' · little data' : ''}</span>
              {r.map === scout.map && <span className="vt-here">this match</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OurCard({ p, me, onMove }: { p: ScoutPlayer; me: boolean; onMove?: () => void }) {
  const room = p.room ?? 'random';
  return (
    <div className="oc" data-testid="our-card" data-nick={p.nickname}>
      <div className="pc-top">
        <Avatar name={p.nickname} />
        <div style={{ minWidth: 0 }}>
          <div className="pc-name">{p.nickname}{me && <> <span className="yb">YOU</span></>}</div>
          <div className="pc-sub">lvl {p.level ?? '–'} · {elo(p.elo)} · {kd(p.stats.kd)} K/D</div>
        </div>
      </div>
      <div style={{ marginTop: 8 }}><span className={'rolebadge ' + room}>{room === 'random' ? 'RANDOM · NOT IN ROOM' : room.toUpperCase()}</span></div>
      <div className="sug"><span className="sl">Role</span>{roleText(p) ?? 'not enough data yet'}</div>
      <div className="sug"><span className="sl">Form</span>{p.stats.recent ? <Form recent={p.stats.recent} /> : '–'}</div>
      {!!p.flags.length && <div className="flags" style={{ marginTop: 6 }}>{p.flags.map(f => <span key={f} className="flag">{f}</span>)}</div>}
      {onMove && <button className="lnk small" type="button" onClick={onMove} data-testid="move-them">Not on my team</button>}
    </div>
  );
}

// ------------------------------------------------------------------ page

export function Scout({ view, session }: { view: SessionView; session: Session }) {
  const scout = scoutOf(view);
  const [selected, setSelected] = useState<string>();
  const host = session.canScout;
  const ready = scout.them.players.length > 0 || !!scout.unsorted?.length;
  // Premier: the host moves players between teams (Valve doesn't say who's on which).
  const sortable = host && scout.platform === 'premier' && session.canScoutStatus;
  const move = (p: ScoutPlayer, side: 'us' | 'them') => { if (p.steamid) void session.setPremierSide(p.steamid, side); };
  // The demo's live match and its sample scout use different fictional ids: the demo host is rdx.
  const meId = view.role === 'demo' ? DEMO_ME : view.screen?.live.me?.steamid;

  let body: React.ReactNode;
  if (!ready && scout.status === 'loading') body = <Skeleton />;
  else if (!ready) body = <Empty view={view} session={session} scout={scout} />;
  else {
    const sel = scout.them.players.find(p => p.nickname === selected) ?? scout.them.players[0];
    body = (
      <>
        <div className="scout-top">
          {scout.platform === 'sample' && <span className="chip sample" data-testid="sample-chip">Sample match · fictional players</span>}
          <SourceChips scout={scout} />
          {scout.platform === 'faceit' && scout.matchUrl && <a className="small" href={scout.matchUrl} target="_blank" rel="noreferrer">FACEIT room ↗</a>}
          {scout.fetchedAt && <span className="muted small">scouted {ago(scout.fetchedAt)}</span>}
          {scout.status === 'loading' && <span className="chip"><span className="pulse" /> updating…</span>}
          {host && (
            <details className="another">
              <summary>Scout another match</summary>
              <ScoutForm session={session} compact />
              <RecentList scout={scout} session={session} compact />
              {session.canScoutStatus && <StatusForm session={session} compact />}
            </details>
          )}
        </div>
        {scout.status === 'error' && scout.error && <div className="result err" data-testid="scout-error">{scout.error}</div>}
        {host && scout.platform === 'faceit' && (scout.sideBy === 'guess' || scout.sideBy === 'manual') && <SideNote scout={scout} session={session} />}
        <Versus scout={scout} />
        <Things scout={scout} />
        <Unsorted scout={scout} session={session} host={!!sortable} />
        {!scout.unsorted?.length && <Briefing scout={scout} session={session} host={host} />}
        {sel && <>
          <div className="sec-h"><h2>Their players</h2><span className="muted small">sorted by threat · click a card for the details</span></div>
          <div className="pcards">
            {scout.them.players.map(p => <EnemyCard key={p.id} p={p} sel={p === sel} onSelect={() => setSelected(p.nickname)} />)}
          </div>
          <EnemyDetail p={sel} map={scout.map} {...(sortable ? { onMove: () => move(sel, 'us') } : {})} />
        </>}
        <div className="grid2 mt veto-row">
          <Veto scout={scout} />
          <div className="card">
            <div className="card-h"><h3>How they play {scout.map ? mapName(scout.map) : 'the map'}</h3><span className="muted small">needs their demos</span></div>
            <div className="mini-ph">Their T-side plans and CT setups come from their recent demos: <b>M4</b>. Until then the Live forecast uses general priors for their buy.</div>
          </div>
        </div>
        <div className="sec-h"><h2>Your team</h2><span className="muted small">room status · roles · form</span></div>
        <div className="ours">{scout.us.players.map(p => { const me = !!meId && p.steamid === meId; return <OurCard key={p.id} p={p} me={me} {...(sortable && !me ? { onMove: () => move(p, 'them') } : {})} />; })}</div>
      </>
    );
  }
  return (
    <section className="scout" data-testid="scout-page">
      <span data-testid="scout-status" data-status={scout.status} hidden />
      {body}
    </section>
  );
}
