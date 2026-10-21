import { useMemo } from 'react';
import { Header } from './components/Header.tsx';
import { pickSource } from './data/index.ts';
import { useHashRoute, useSnapshot } from './hooks.ts';
import { Live } from './pages/Live.tsx';
import { Placeholder } from './pages/Placeholder.tsx';
import { Settings } from './pages/Settings.tsx';

export function App() {
  const source = useMemo(() => pickSource(), []);
  const got = useSnapshot(source);
  const route = useHashRoute();
  return (
    <div className="app" data-source={source.kind}>
      <Header snap={got?.snap} route={route} />
      <main className="main">
        {route === 'live' && got && <Live snap={got.snap} receivedAt={got.receivedAt} rate={source.rate()} kind={source.kind} />}
        {route === 'scout' && (
          <Placeholder milestone="Coming in M3" title="Scout" text="Matchup, the 3 things to know, enemy player cards and the map veto, built from FACEIT, Steam and demo history." />
        )}
        {route === 'debrief' && (
          <Placeholder milestone="Coming in M6" title="Debrief" text="Result, buy-read accuracy, enemy money per round and what to work on next, built from the match demo." />
        )}
        {route === 'coach' && (
          <Placeholder milestone="Coming in M5" title="Coach" text="Chat with the coach, plus every detailed panel: round reasoning, economy, scouting data and the call log." />
        )}
        {route === 'settings' && <Settings snap={got?.snap} kind={source.kind} />}
      </main>
    </div>
  );
}
