import { useEffect, useMemo, useState } from 'react';
import { Header } from './components/Header.tsx';
import { LinkStatusView, isBlocking } from './components/LinkStatus.tsx';
import { coachOf, scoutOf, Session } from './data/session.ts';
import { useHashRoute, useSession } from './hooks.ts';
import { CoachPage } from './pages/Coach.tsx';
import { Join } from './pages/Join.tsx';
import { Live } from './pages/Live.tsx';
import { Debrief } from './pages/Debrief.tsx';
import { PlaybookPage } from './pages/Playbook.tsx';
import { RoomPage } from './pages/Room.tsx';
import { Scout } from './pages/Scout.tsx';
import { Settings } from './pages/Settings.tsx';
import { usePushToTalkCues, useVoiceCallouts } from './voice.ts';
import type { SessionView } from './data/session.ts';

/** Push-to-talk's toast: listening, what it understood, or why not. Fades 4 s after the last step. */
function VoiceToast({ v }: { v: SessionView['voice'] }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!v || v.state === 'listening') return;
    const t = setTimeout(() => tick(x => x + 1), Math.max(0, v.at + 4000 - Date.now()));
    return () => clearTimeout(t);
  }, [v]);
  if (!v || (v.state !== 'listening' && Date.now() - v.at > 4000)) return null;
  const text = v.state === 'listening' ? 'Listening…'
    : v.state === 'heard' ? v.said ?? v.text
    : v.state === 'none' ? (v.text ? `Didn't catch that: “${v.text}”` : "Didn't hear anything")
    : v.error ?? 'Push-to-talk failed';
  return <div className={'voice-toast ' + v.state} role="status" data-testid="voice-toast" data-state={v.state}><span className="mic" aria-hidden="true" />{text}{v.state === 'error' && v.said ? <span className="muted"> · {v.said}</span> : null}</div>;
}

export function App() {
  const session = useMemo(() => new Session(), []);
  const v = useSession(session);
  const route = useHashRoute();
  const live = v.screen?.live;
  const blocking = isBlocking(v);
  useVoiceCallouts(v);
  usePushToTalkCues(v);

  let page: React.ReactNode = null;
  if (v.join) page = <Join view={v} session={session} />;
  else if (blocking) page = null; // LinkStatusView renders the full-page state
  else if (route === 'room') page = <RoomPage view={v} session={session} />;
  else if (route === 'settings') page = <Settings snap={live} kind={v.kind} scout={scoutOf(v)} session={session} />;
  else if (route === 'scout') page = <Scout view={v} session={session} />;
  else if (route === 'debrief') page = <Debrief view={v} session={session} />;
  else if (route === 'playbook') page = <PlaybookPage view={v} session={session} />;
  else if (route === 'coach') page = <CoachPage view={v} session={session} />;
  else if (live) page = <Live snap={live} receivedAt={v.receivedAt} rate={v.rate} kind={v.kind} role={v.role} room={v.screen?.room} scout={scoutOf(v)} coach={coachOf(v)} session={session} />;

  return (
    <div className="app" data-source={v.kind} data-role={v.role}>
      <Header view={v} route={route} />
      <main className="main">
        {v.notice && (
          <div className="linkbar notice" data-testid="notice" role="status">
            {v.notice}<button className="btn small" type="button" onClick={() => session.dismissNotice()}>OK</button>
          </div>
        )}
        {v.role === 'member' && !v.join && <LinkStatusView view={v} session={session} />}
        {page}
      </main>
      <VoiceToast v={v.voice} />
    </div>
  );
}
