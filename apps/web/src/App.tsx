import { useMemo } from 'react';
import { Header } from './components/Header.tsx';
import { LinkStatusView, isBlocking } from './components/LinkStatus.tsx';
import { Session } from './data/session.ts';
import { useHashRoute, useSession } from './hooks.ts';
import { Join } from './pages/Join.tsx';
import { Live } from './pages/Live.tsx';
import { Placeholder } from './pages/Placeholder.tsx';
import { RoomPage } from './pages/Room.tsx';
import { Settings } from './pages/Settings.tsx';

export function App() {
  const session = useMemo(() => new Session(), []);
  const v = useSession(session);
  const route = useHashRoute();
  const live = v.screen?.live;
  const blocking = isBlocking(v);

  let page: React.ReactNode = null;
  if (v.join) page = <Join view={v} session={session} />;
  else if (blocking) page = null; // LinkStatusView renders the full-page state
  else if (route === 'room') page = <RoomPage view={v} session={session} />;
  else if (route === 'settings') page = <Settings snap={live} kind={v.kind} />;
  else if (route === 'scout') page = <Placeholder milestone="Coming in M3" title="Scout" text="Matchup, the 3 things to know, enemy player cards and the map veto, built from FACEIT, Steam and demo history." />;
  else if (route === 'debrief') page = <Placeholder milestone="Coming in M6" title="Debrief" text="Result, buy-read accuracy, enemy money per round and what to work on next, built from the match demo." />;
  else if (route === 'coach') page = <Placeholder milestone="Coming in M5" title="Coach" text="Chat with the coach, plus every detailed panel: round reasoning, economy, scouting data and the call log." />;
  else if (live) page = <Live snap={live} receivedAt={v.receivedAt} rate={v.rate} kind={v.kind} role={v.role} room={v.screen?.room} />;

  return (
    <div className="app" data-source={v.kind} data-role={v.role}>
      <Header view={v} route={route} />
      <main className="main">
        {v.role === 'member' && !v.join && <LinkStatusView view={v} session={session} />}
        {page}
      </main>
    </div>
  );
}
