import { formatCode } from '@csbot/room';
import type { SessionView } from '../data/session.ts';
import type { Route } from '../hooks.ts';
import { mapName, modeName } from '../format.ts';
import { IconBot, IconGear, IconVoice } from './Icons.tsx';

const CONN = {
  waiting: { dot: 'off', text: 'Waiting for CS2' },
  live: { dot: 'ok', text: 'GSI live' },
  stale: { dot: 'warn', text: 'GSI silent' },
} as const;

function RoomChip({ view, route }: { view: SessionView; route: Route }) {
  if (view.join) return null;
  const room = view.screen?.room;
  const on = route === 'room' ? ' on' : '';
  if (!room && view.role === 'solo') {
    return <a className={'room-chip' + on} href="#/room" data-testid="room-chip" title="Host or join a room"><i className="dot off" /><span className="rc-code">No room</span></a>;
  }
  const code = room?.code ?? view.code;
  if (!code) return null;
  const status = view.role === 'member' ? view.link?.status ?? 'connecting' : 'approved';
  const dot = status === 'approved' ? 'ok' : status === 'host-offline' ? 'warn' : 'off';
  const role = room?.members.find(m => m.id === room.you)?.role ?? 'member';
  const online = room ? room.members.filter(m => m.online).length : 0;
  return (
    <a className={'room-chip' + on} href="#/room" data-testid="room-chip" data-status={status} title={`Room ${formatCode(code)} · hosted by ${room?.hostName ?? 'the admin'}`}>
      <i className={'dot ' + dot} />
      <span className="rc-code">Room {formatCode(code)}</span>
      {room && <span className="rc-n">{online} online</span>}
      <span className={'rb ' + role}>{role.toUpperCase()}</span>
    </a>
  );
}

export function Header({ view, route }: { view: SessionView; route: Route }) {
  const snap = view.screen?.live;
  const m = snap?.match;
  const conn = snap ? CONN[snap.connection.gsi] : CONN.waiting;
  const src = snap?.connection.source;
  const ours = m?.ourSide, theirs = ours === 'CT' ? 'T' : ours === 'T' ? 'CT' : undefined;
  const live = !!m && snap?.connection.gsi === 'live' && !['gameover', 'idle'].includes(m.clock.phase);
  return (
    <header className="hdr">
      <div className="brand"><span className="logo" />csbot</div>
      <nav className="nav" aria-label="Pages">
        <a href="#/scout" className={route === 'scout' ? 'on' : ''}>Scout</a>
        <a href="#/live" className={route === 'live' ? 'on' : ''}>Live <i className={'live-dot' + (live ? '' : ' off')} /></a>
        <a href="#/debrief" className={route === 'debrief' ? 'on' : ''}>Debrief</a>
      </nav>
      <div className="scorebox" data-testid="scorebox">
        {m ? (
          <>
            {ours && <span className={'side-tag us ' + ours.toLowerCase()}>{ours}</span>}
            <span>You</span>
            <span className="n" data-testid="score-us">{m.score.us}</span>
            <span className="muted">:</span>
            <span className="n" data-testid="score-them">{m.score.them}</span>
            <span>Enemy</span>
            {theirs && <span className={'side-tag ' + theirs.toLowerCase()}>{theirs}</span>}
            <span className="rnd">Round {m.round || '–'} · {mapName(m.map)}{m.mode ? ' · ' + modeName(m.mode) : ''}</span>
          </>
        ) : (
          <span className="muted">No match yet</span>
        )}
      </div>
      <div className="hdr-right">
        <RoomChip view={view} route={route} />
        {!(view.role === 'member' && !snap) && <a className="conn-chip" href="#/settings" title={view.role === 'member' ? "The host's game connection (Valve GSI)" : 'Game connection (Valve GSI)'} data-testid="conn-chip">
          <i className={'dot ' + conn.dot} />
          <span className="ct-txt">{conn.text}</span>
          {src === 'demo' && <span className="badge">DEMO</span>}
          {src === 'replay' && <span className="badge warn">REPLAY</span>}
        </a>}
        <button className="icon-btn" type="button" disabled title="Voice callouts arrive in M5" aria-label="Voice callouts (arrives in M5)"><IconVoice /></button>
        <a className={'icon-btn' + (route === 'coach' ? ' on' : '')} href="#/coach" title="Coach" aria-label="Coach"><IconBot /></a>
        <a className={'icon-btn' + (route === 'settings' ? ' on' : '')} href="#/settings" title="Settings" aria-label="Settings"><IconGear /></a>
      </div>
    </header>
  );
}
