import type { CoachView, LiveSnapshot, RoomView, ScoutView } from '@csbot/protocol';
import { CallCard } from '../components/CallCard.tsx';
import { MapPanel } from '../components/MapPanel.tsx';
import { PhaseBanner } from '../components/PhaseBanner.tsx';
import { Scoreboard } from '../components/Scoreboard.tsx';
import { Ticker } from '../components/Ticker.tsx';
import { Tiles } from '../components/Tiles.tsx';
import type { Role, Session } from '../data/session.ts';
import type { SourceKind } from '../data/source.ts';
import { DesktopLink } from '../components/DesktopLink.tsx';

function Waiting({ kind, role, room }: { kind: SourceKind; role: Role; room?: RoomView }) {
  if (role === 'member') {
    const host = room?.hostName ?? 'the host';
    return (
      <div className="card onboard" data-testid="waiting">
        <div className="kick"><span className="pulse" /> &nbsp;Room</div>
        <h2>Connected · waiting for {host}'s game</h2>
        <div className="sub">This page fills in when {host}'s CS2 sends its first update: the call, the enemy money read and the map.</div>
      </div>
    );
  }
  return (
    <div className="card onboard" data-testid="waiting">
      <div className="kick"><span className="pulse" /> &nbsp;Live</div>
      <h2>Waiting for CS2</h2>
      <div className="sub">csbot reads the game through Valve's official Game State Integration. Nothing else.</div>
      <ol>
        <li>Install the GSI config: <a href="#/settings">Settings → Install GSI config</a> (once).</li>
        <li>Launch CS2. If it was already running, restart it so it loads the config.</li>
        <li>Start or join a match. This page fills in as soon as the first update arrives.</li>
      </ol>
      {kind !== 'desktop' && (
        <p className="note">
          This browser has no host connection. Hosting needs the csbot desktop app: <DesktopLink />. Or <a href="./" data-testid="try-demo">try the demo</a> to see a fictional match.
        </p>
      )}
    </div>
  );
}

/** Between rounds the call is already the next round's: show that round's enemy estimate and forecast with it. */
export function ahead(s: LiveSnapshot): LiveSnapshot {
  const n = s.next;
  if (!n || s.call?.round !== n.round) return s;
  const { forecast: _f, ...rest } = s;
  return { ...rest, enemy: n.enemy, ...(n.forecast ? { forecast: n.forecast } : {}) };
}

export function Live({ snap, receivedAt, rate, kind, role, room, scout, coach, session }: { snap: LiveSnapshot; receivedAt: number; rate: number; kind: SourceKind; role: Role; room?: RoomView; scout?: ScoutView; coach?: CoachView; session?: Session }) {
  if (snap.connection.gsi === 'waiting' || !snap.match) return <Waiting kind={kind} role={role} room={room} />;
  const view = ahead(snap);
  return (
    <section data-testid="live">
      {snap.connection.gsi === 'stale' && (
        <div className="chip warn" style={{ marginBottom: 10 }} data-testid="stale">No game update for a while. Is CS2 still running?</div>
      )}
      <div className="live-main">
        <div className="now">
          <PhaseBanner snap={snap} receivedAt={receivedAt} rate={rate} />
          <CallCard snap={view} room={room} coach={coach} />
          <Tiles snap={view} webMember={role === 'member' && kind === 'member'} />
          <Ticker snap={snap} />
        </div>
        <MapPanel snap={view} room={room} receivedAt={receivedAt} rate={rate}
          {...(session ? {
            onIntel: (z: string, n: number) => session.logIntel(z, n), ...(session.intelBlock() ? { intelBlock: session.intelBlock() } : {}),
            onCheckIn: (st: 'spot' | 'rotate', site?: 'A' | 'B') => session.checkIn(st, site), ...(session.checkInBlock() ? { checkInBlock: session.checkInBlock() } : {}),
          } : {})} />
      </div>
      <Scoreboard snap={view} inRoom={!!room && role !== 'demo'} scout={scout} />
    </section>
  );
}
