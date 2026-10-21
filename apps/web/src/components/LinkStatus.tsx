// A member's connection to the host. Exactly one element carries data-testid="link-status":
// a full page when there's nothing else to show, a banner over the last screen otherwise,
// and a hidden marker once approved (tests and the desktop e2e read data-status).

import { formatCode } from '@csbot/room';
import type { Session, SessionView } from '../data/session.ts';
import { useTicker } from '../hooks.ts';

const FINAL = new Set(['denied', 'removed', 'ended']);

/** Full-page link state (nothing else on screen). */
export function isBlocking(v: SessionView): boolean {
  if (v.role !== 'member' || v.join || !v.link) return false;
  if (FINAL.has(v.link.status)) return true;
  if (v.link.status === 'approved') return false;
  return !v.screen; // connecting / pending / host-offline with nothing to show yet
}

export function LinkStatusView({ view, session }: { view: SessionView; session: Session }) {
  const link = view.link ?? { status: 'connecting' as const, since: Date.now() };
  const host = view.screen?.room?.hostName;
  const code = view.code ? formatCode(view.code) : '';
  const now = useTicker(1000, link.status === 'connecting' || link.status === 'host-offline');
  const slow = now - link.since > 10_000;

  if (link.status === 'approved') return <span data-testid="link-status" data-status="approved" hidden />;

  if (!isBlocking(view)) {
    // Banner over the last screen.
    const text = link.status === 'host-offline' ? 'Host offline · reconnecting. This is the last screen they sent.'
      : link.status === 'pending' ? `Waiting for ${host ?? 'the admin'} to let you in`
      : 'Reconnecting to the host…';
    return (
      <div className={'linkbar ' + link.status} data-testid="link-status" data-status={link.status} role="status">
        <span className="pulse" />{text}
        {session.canTakeOver(now) && (
          <button className="btn small" type="button" onClick={() => session.takeOver()} data-testid="take-over"
            title="Host the room from this PC: same link, same members, the match read continues from your own game data">Take over as host</button>
        )}
      </div>
    );
  }

  const final = FINAL.has(link.status);
  const title = {
    connecting: 'Looking for the host…',
    pending: `Waiting for ${host ?? 'the admin'} to let you in`,
    'host-offline': 'Host offline · reconnecting',
    denied: 'Not let in',
    removed: 'Removed from the room',
    ended: 'Room closed',
    approved: '',
  }[link.status];
  const detail = link.detail ?? (link.status === 'connecting'
    ? 'Connecting straight to the host\'s csbot. No account, no server in between.'
    : link.status === 'pending' ? 'The admin sees your name and lets you in. This page updates by itself.'
    : link.status === 'host-offline' ? 'The admin\'s csbot is closed or offline. This page reconnects by itself.'
    : '');
  return (
    <div className="card onboard linkpage" data-testid="link-status" data-status={link.status}>
      <div className="kick">{!final && <span className="pulse" />} Room {code}</div>
      <h2>{title}</h2>
      {detail && <div className="sub">{detail}</div>}
      {view.netError && <div className="result err" data-testid="net-error">{view.netError}</div>}
      {link.status === 'connecting' && slow && !view.netError && (
        <p className="note" data-testid="slow-hint">
          Is the admin's csbot open? The room only exists while their desktop app runs. If it is open, ask them to copy the invite link again: an old or mistyped link can't find the room.
        </p>
      )}
      {final && (
        <p style={{ marginTop: 16 }}>
          <button className="btn primary" type="button" onClick={() => session.backFromRoom()} data-testid="link-back">
            {view.device === 'desktop' ? 'Back to this PC' : 'Back to the join screen'}
          </button>
        </p>
      )}
    </div>
  );
}
