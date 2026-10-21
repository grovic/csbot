import { formatCode } from '@csbot/room';
import { useState } from 'react';
import type { Session, SessionView } from '../data/session.ts';

/** Opened from an invite link: type a name, join. Nothing to install, no account. */
export function Join({ view, session }: { view: SessionView; session: Session }) {
  const j = view.join!;
  const [name, setName] = useState(j.name);
  if (j.invalid || !j.invite) {
    return (
      <div className="card onboard" data-testid="join-invalid">
        <div className="kick">Join a room</div>
        <h2>This invite link is incomplete</h2>
        <div className="sub">Ask the admin to copy the link again from their csbot Room page. It ends with <code>#/r/CODE?k=…</code>.</div>
      </div>
    );
  }
  const submit = (e: React.FormEvent) => { e.preventDefault(); session.submitName(name); };
  return (
    <form className="card onboard join" data-testid="join" onSubmit={submit}>
      <div className="kick">Join room</div>
      <div className="big-code">{formatCode(j.invite.code)}</div>
      <div className="sub">Your squad's live calls, on this screen. No account and nothing to install.</div>
      <label className="field">
        <span>Your FACEIT nickname</span>
        <input data-testid="join-name" value={name} maxLength={24} autoFocus placeholder="so scouting knows it's you"
          onChange={e => setName(e.target.value)} autoComplete="nickname" />
      </label>
      <button className="btn primary big" type="submit" data-testid="join-submit" disabled={!name.trim()}>Join</button>
      <p className="note">The admin lets you in. Your screen connects straight to their csbot; the room key in the link never leaves your devices.</p>
    </form>
  );
}
