import type { LiveSnapshot } from '@csbot/protocol';
import { fmtK, mapName, pct, READ_BIG } from '../format.ts';

function noForecastReason(s: LiveSnapshot): string {
  const m = s.match;
  if (!m) return 'Arrives with the first round';
  if (m.map !== 'de_mirage') return `No forecast for ${mapName(m.map)} yet (map models arrive in M4)`;
  if (m.ourSide === 'T') return 'Forecast covers Mirage CT side for now';
  if (!s.enemy) return 'Arrives at freeze time';
  return 'No forecast this round';
}

function youFallback(s: LiveSnapshot, webMember: boolean): string {
  if (webMember && !s.me) return 'Share your own game data from the csbot desktop app';
  switch (s.match?.clock.phase) {
    case 'gameover': return 'Match over';
    case 'halftime': return 'Halftime · money resets';
    case 'warmup': return 'Buy advice starts after warmup';
    default: return s.me ? 'Arrives at freeze time' : 'Waiting for your data';
  }
}

export function Tiles({ snap, webMember = false }: { snap: LiveSnapshot; webMember?: boolean }) {
  const e = snap.enemy, f = snap.forecast, y = snap.youTile, planted = !!snap.match?.bombPlanted;
  const site = f ? (f.site.B >= f.site.A ? 'B' : 'A') : undefined;
  const sp = f && site ? f.site[site] : 0;
  return (
    <div className="tiles3" data-testid="tiles">
      <div className="tl" data-testid="tile-enemy">
        <div className="lb"><i className="key t" />Enemy buy</div>
        {e ? (
          <>
            <div className="vl">{READ_BIG[e.read]}{e.read !== 'pistol' && <small>{pct(e.buy[e.read])}</small>}</div>
            <div className="sb">~{fmtK(e.lo)}–{fmtK(e.hi)} each · estimate</div>
          </>
        ) : (
          <><div className="vl none">—</div><div className="sb">Arrives at freeze time</div></>
        )}
      </div>

      <div className="tl" data-testid="tile-hit">
        <div className="lb"><i className="key t" />{planted ? 'Bomb planted' : 'Likely hit'}</div>
        {planted ? (
          <>
            <div className="vl">{f && site ? <>{site}?<small>forecast {pct(sp)}</small></> : '—'}</div>
            <div className="sb">The game doesn't tell players the bomb site</div>
          </>
        ) : f && site ? (
          <>
            <div className="vl">{site} site<small>{pct(sp)}</small></div>
            <div className="split" aria-label={`A ${pct(f.site.A)}, B ${pct(f.site.B)}`}>
              <i className={site === 'A' ? 'max' : ''} style={{ width: f.site.A * 100 + '%' }} />
              <i className={site === 'B' ? 'max' : ''} style={{ width: f.site.B * 100 + '%' }} />
            </div>
            <div className="sb">A {pct(f.site.A)} · B {pct(f.site.B)} · {f.topPlan.name} · estimate</div>
          </>
        ) : (
          <><div className="vl none">—</div><div className="sb">{noForecastReason(snap)}</div></>
        )}
      </div>

      <div className="tl" data-testid="tile-you">
        <div className="lb"><i className="key ct" />{y?.label ?? 'Your buy'}</div>
        {y ? (
          <><div className="vl">{y.value}</div><div className="sb">{y.sub}</div></>
        ) : (
          <><div className="vl none">—</div><div className="sb">{youFallback(snap, webMember)}</div></>
        )}
      </div>
    </div>
  );
}
