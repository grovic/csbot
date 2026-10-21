import type { LiveSnapshot, PlayerRow, RoundRecord, ScoutView, Side } from '@csbot/protocol';
import { lossBonus } from '@csbot/engine';
import { fmt$ } from '../format.ts';
import { ReasonIcon } from './Icons.tsx';
import { elo, kd, PartyBadge, roleText, ThreatBar } from './ScoutBits.tsx';

const OT_HALF = 3;
const HOW = { elimination: 'elimination', bomb: 'bomb exploded', defuse: 'bomb defused', time: 'time ran out' } as const;

interface HalfDef { label: string; from: number; to: number; ot?: boolean }

function halves(half: number, last: number): HalfDef[] {
  const out: HalfDef[] = [{ label: '1st half', from: 1, to: half }, { label: '2nd half', from: half + 1, to: 2 * half }];
  for (let start = 2 * half + 1, n = 1; start <= last; start += 2 * OT_HALF, n++) {
    out.push({ label: `OT ${n}`, from: start, to: start + 2 * OT_HALF - 1, ot: true });
  }
  return out;
}

function sideOfHalf(h: HalfDef, byRound: Map<number, RoundRecord>, cur: number, curSide?: Side): Side | undefined {
  for (let r = h.from; r <= h.to; r++) { const s = byRound.get(r)?.ourSide; if (s) return s; }
  if (cur >= h.from && cur <= h.to) return curSide;
  return undefined;
}

function RoundStrip({ snap }: { snap: LiveSnapshot }) {
  const m = snap.match!;
  const byRound = new Map(m.history.map(r => [r.round, r]));
  const last = Math.max(m.round, ...m.history.map(r => r.round), 2 * m.halfLength);
  const inProgress = !['over', 'gameover', 'halftime'].includes(m.clock.phase);
  const hs = halves(m.halfLength, last);
  const first = sideOfHalf(hs[0]!, byRound, m.round, m.ourSide);
  return (
    <div className="rounds" data-testid="round-strip">
      {hs.map((h, i) => {
        let side = sideOfHalf(h, byRound, m.round, m.ourSide);
        if (!side && i === 1 && first) side = first === 'CT' ? 'T' : 'CT';
        const rounds = Array.from({ length: h.to - h.from + 1 }, (_, k) => h.from + k);
        return (
          <div key={h.label} className={'rhalf' + (h.ot ? ' ot' : '')}>
            <div className="rhalf-h">{h.label}{side ? ` · you ${side}` : ''}</div>
            <div className="cells">
              {rounds.map(r => {
                const rec = byRound.get(r);
                const cur = !rec && inProgress && r === m.round;
                const title = rec ? `R${r}: ${rec.winner === 'us' ? 'your team' : 'enemy'} won · ${HOW[rec.reason]}${rec.inferred ? ' (reason inferred from phase changes)' : ''}` : `R${r}`;
                return (
                  <div key={r} className={'rc' + (rec ? ' ' + rec.winner : '') + (cur ? ' cur' : '') + (rec?.inferred ? ' inf' : '')} title={title} data-round={r} data-winner={rec?.winner}>
                    {rec && <ReasonIcon reason={rec.reason} />}
                  </div>
                );
              })}
            </div>
            <div className="cells">{rounds.map(r => <div key={r} className="rn">{r}</div>)}</div>
          </div>
        );
      })}
    </div>
  );
}

function SourceCell({ r }: { r: PlayerRow }) {
  if (r.source === 'host') return <span className="srcd"><i />host GSI</span>;
  if (r.source === 'room') return <span className="srcd link"><i />room</span>;
  return <span className="srcd spec" title="Last seen while you watched this teammate after dying"><i />seen R{r.seenRound ?? '?'}</span>;
}

function EnemyPlayers({ scout }: { scout: ScoutView }) {
  return (
    <div className="tw">
      <div className="scroll-x"><table className="t enemy-tbl" data-testid="enemy-players">
        <thead><tr><th>Player</th><th>Role</th><th className="r">Level · ELO</th><th className="r">K/D</th><th>Threat</th></tr></thead>
        <tbody>
          {scout.them.players.map(p => (
            <tr key={p.id} data-nick={p.nickname}>
              <td>{p.nickname}<PartyBadge party={p.party} /></td>
              <td>{roleText(p) ? <span className="role">{roleText(p)}</span> : <span className="muted">–</span>}</td>
              <td className="r">{p.level ?? '–'} · {elo(p.elo)}</td>
              <td className="r">{kd(p.stats.kd)}</td>
              <td><ThreatBar p={p} label={false} /></td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}

export function Scoreboard({ snap, inRoom = false, scout }: { snap: LiveSnapshot; inRoom?: boolean; scout?: ScoutView }) {
  const m = snap.match;
  if (!m) return null;
  const played = m.history.length;
  const ours = m.ourSide, theirs = ours === 'CT' ? 'T' : ours === 'T' ? 'CT' : undefined;
  const e = snap.enemy;
  const anyInferred = m.history.some(r => r.inferred);
  return (
    <div className="card sboard" data-testid="scoreboard">
      <div className="card-h">
        <h3>Scoreboard</h3>
        <span className="muted small">after {played} round{played === 1 ? '' : 's'} · round {m.round || '–'} {m.clock.phase === 'over' ? 'finished' : m.clock.phase === 'gameover' ? '· match over' : 'in progress'}</span>
      </div>
      <RoundStrip snap={snap} />
      <div className="legend" style={{ marginTop: 2 }}>
        <span><i className="key ct" />your team won</span><span><i className="key t" />enemy won</span>
        <span><ReasonIcon reason="elimination" />elimination</span><span><ReasonIcon reason="bomb" />bomb</span>
        <span><ReasonIcon reason="defuse" />defuse</span><span><ReasonIcon reason="time" />time</span>
        {anyInferred && <span><i className="infd" />reason inferred from phase changes</span>}
      </div>
      <div className="teams">
        <div>
          <div className="team-h">{ours && <span className={'side-tag ' + ours.toLowerCase()}>{ours}</span>}Your team<span className="n">{m.score.us}</span></div>
          <div className="tw">
            <div className="scroll-x"><table className="t" data-testid="our-team">
              <thead><tr><th>Player</th><th className="r">Money</th><th className="r">K</th><th className="r">A</th><th className="r">D</th><th className="r">ADR</th><th className="r">MVP</th><th>Data</th></tr></thead>
              <tbody>
                {snap.scoreboard.map(r => (
                  <tr key={r.steamid} className={r.isMe ? 'me-row' : ''}>
                    <td>{r.isMe ? <b>{r.name} (you)</b> : r.name}</td>
                    <td className="r">{fmt$(r.money)}</td><td className="r">{r.kills}</td><td className="r">{r.assists}</td><td className="r">{r.deaths}</td>
                    <td className="r">{r.adr ?? '–'}</td><td className="r">{r.mvps ?? '–'}</td><td><SourceCell r={r} /></td>
                  </tr>
                ))}
                {snap.scoreboard.length < 5 && (
                  <tr className="empty-row"><td colSpan={8}>{inRoom
                    ? 'Teammates appear when they share their game data from the csbot desktop app, or when someone watches them after dying.'
                    : 'Teammates appear when you watch them after dying, or live when they join your room with the desktop app.'}</td></tr>
                )}
              </tbody>
            </table></div>
          </div>
        </div>
        <div>
          <div className="team-h">{theirs && <span className={'side-tag ' + theirs.toLowerCase()}>{theirs}</span>}Enemy<span className="n">{m.score.them}</span></div>
          <div className="enemy-box" data-testid="enemy-box">
            <div className="money">
              {e ? <>Est. {fmt$(e.lo)}–{fmt$(e.hi)} each · next loss pays {fmt$(lossBonus(e.streak + 1))}{e.saved ? ' · saved last round' : ''}</> : <>Money estimate starts at freeze time</>}
              <span className="chip est">estimate</span>
            </div>
            {scout?.them.players.length
              ? <EnemyPlayers scout={scout} />
              : <div>Scout the match on the <a href="#/scout">Scout</a> page to see who you're playing: role, level, ELO and threat.</div>}
            <div className="muted small">{scout?.them.players.length ? 'Profiles from scouting (FACEIT and Steam). ' : ''}The game doesn't send enemy stats to players. Their full scoreboard comes from the demo after the match.</div>
          </div>
        </div>
      </div>
      <div className="legend">
        <span className="srcd"><i />host GSI: the host PC's own game data</span>
        <span className="srcd link"><i />room: a member's own game data, shared from their desktop app</span>
        <span className="srcd spec"><i />seen while spectating a teammate after dying</span>
      </div>
    </div>
  );
}
