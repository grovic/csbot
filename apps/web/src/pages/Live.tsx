import type { LiveSnapshot } from '@csbot/protocol';
import { CallCard } from '../components/CallCard.tsx';
import { MapPanel } from '../components/MapPanel.tsx';
import { PhaseBanner } from '../components/PhaseBanner.tsx';
import { Scoreboard } from '../components/Scoreboard.tsx';
import { Ticker } from '../components/Ticker.tsx';
import { Tiles } from '../components/Tiles.tsx';
import type { SourceKind } from '../data/source.ts';

function Waiting({ kind }: { kind: SourceKind }) {
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
          This browser has no host connection. Hosting needs the csbot desktop app. <a href="./" data-testid="try-demo">Try the demo</a> to see a fictional match.
        </p>
      )}
    </div>
  );
}

export function Live({ snap, receivedAt, rate, kind }: { snap: LiveSnapshot; receivedAt: number; rate: number; kind: SourceKind }) {
  if (snap.connection.gsi === 'waiting' || !snap.match) return <Waiting kind={kind} />;
  return (
    <section data-testid="live">
      {snap.connection.gsi === 'stale' && (
        <div className="chip warn" style={{ marginBottom: 10 }} data-testid="stale">No game update for a while. Is CS2 still running?</div>
      )}
      <div className="live-main">
        <div className="now">
          <PhaseBanner snap={snap} receivedAt={receivedAt} rate={rate} />
          <CallCard snap={snap} />
          <Tiles snap={snap} />
          <Ticker snap={snap} />
        </div>
        <MapPanel snap={snap} />
      </div>
      <Scoreboard snap={snap} />
    </section>
  );
}
