import { formatCode, HOST_ID } from '@csbot/room';
import type { RoomMember, RoomPermissions, RoomView } from '@csbot/protocol';
import { useEffect, useState } from 'react';
import type { Session, SessionView } from '../data/session.ts';
import { useTicker } from '../hooks.ts';

const DEVICE = { host: 'desktop app · host', desktop: 'desktop app', web: 'browser' } as const;
const ago = (at: number, now: number) => { const s = Math.max(0, Math.round((now - at) / 1000)); return s < 60 ? `${s} s ago` : `${Math.round(s / 60)} min ago`; };

function NoRoom({ view, session }: { view: SessionView; session: Session }) {
  const [link, setLink] = useState('');
  const [name, setName] = useState(view.screen?.live.me?.name ?? '');
  const [err, setErr] = useState<string>();
  if (view.kind !== 'desktop') {
    return (
      <div className="card onboard" data-testid="room-howto">
        <div className="kick">Room</div>
        <h2>Join your squad's room</h2>
        <div className="sub">Ask the teammate who hosts (the admin) for the invite link and open it. That's all: no account, nothing to install.</div>
        <p className="note">Hosting a room needs the csbot desktop app on the admin's gaming PC.</p>
      </div>
    );
  }
  const join = (e: React.FormEvent) => { e.preventDefault(); setErr(session.joinWithLink(link, name)); };
  return (
    <div className="grid2" data-testid="room-none">
      <div className="card">
        <div className="card-h"><h3>Host a room</h3></div>
        <p className="lead">Your squad sees your calls, each with their own job. They only need the link: no account, no server, nothing to install in a browser.</p>
        <button className="btn primary big" type="button" onClick={() => session.createRoom()} data-testid="create-room">Create a room</button>
      </div>
      <form className="card" onSubmit={join}>
        <div className="card-h"><h3>Join a room</h3></div>
        <p className="lead">Paste the invite link from your admin. Your own game data goes to their room from this PC.</p>
        <div className="joinrow">
          <input className="inp" data-testid="join-link-input" value={link} onChange={e => setLink(e.target.value)} placeholder="https://…/#/r/CODE?k=…" spellCheck={false} />
          <input className="inp name" data-testid="join-link-name" value={name} onChange={e => setName(e.target.value)} placeholder="Your FACEIT nickname" maxLength={24} />
          <button className="btn primary" type="submit" data-testid="join-link-submit" disabled={!link.trim()}>Join</button>
        </div>
        {err && <div className="result err">{err}</div>}
      </form>
    </div>
  );
}

function CopyInvite({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async (e: React.MouseEvent<HTMLButtonElement>) => {
    const input = e.currentTarget.parentElement?.querySelector('input');
    try { await navigator.clipboard.writeText(link); }
    catch { input?.select(); try { document.execCommand('copy'); } catch { /* the text stays selected */ } }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="invite">
      <input className="inp code" readOnly value={link} data-testid="invite-link" onFocus={e => e.currentTarget.select()} aria-label="Invite link" />
      <button className="btn primary" type="button" onClick={copy} data-testid="copy-invite">{copied ? 'Copied ✓' : 'Copy invite link'}</button>
    </div>
  );
}

/** Local state that follows the room but updates at once on input (the room confirms a moment later). */
function useOptimistic<T>(value: T): [T, (v: T) => void] {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  return [local, setLocal];
}

function SlotSelect({ room, member, editable, onChange }: { room: RoomView; member: RoomMember; editable: boolean; onChange: (s: string | null) => void }) {
  const [value, setValue] = useOptimistic(member.slot ?? '');
  return (
    <select className="sel" data-testid="slot-select" value={value} disabled={!editable}
      onChange={e => { setValue(e.target.value); onChange(e.target.value || null); }}
      aria-label={`Slot for ${member.name}`}>
      <option value="">no slot</option>
      {room.slots.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
    </select>
  );
}

function Perm({ id, title, desc, on, enabled, onChange }: { id: string; title: string; desc: string; on: boolean; enabled: boolean; onChange: (v: boolean) => void }) {
  const [value, setValue] = useOptimistic(on);
  return (
    <label className="perm">
      <span><span className="pt">{title}</span><span className="muted small">{desc}</span></span>
      <span className="toggle"><input type="checkbox" data-testid={id} checked={value} disabled={!enabled}
        onChange={e => { setValue(e.target.checked); onChange(e.target.checked); }} />{value ? 'on' : 'off'}</span>
    </label>
  );
}

export function RoomPage({ view, session }: { view: SessionView; session: Session }) {
  const room = view.screen?.room;
  const now = useTicker(5000);
  if (!room) return <NoRoom view={view} session={session} />;
  const me = room.members.find(m => m.id === room.you);
  const demo = view.role === 'demo';
  const admin = view.role === 'host';
  const online = room.members.filter(m => m.online).length;
  const live = view.screen!.live;
  const gsi = live.connection.gsi;
  const perms = room.permissions;
  const setPerm = (p: Partial<RoomPermissions>) => session.setPermissions(p);

  return (
    <div className="roompage" data-testid="room-page">
      <div className="room-top">
        <div className="card">
          <div className="card-h"><h3>Room</h3><span className="chip"><i className="dot ok" />direct · encrypted</span></div>
          <div className="big-code" data-testid="room-code">{formatCode(room.code)}</div>
          <div className="muted small">Hosted by {room.hostName} · {online} of {room.members.length} online</div>
          {admin && view.inviteLink && (
            <>
              <CopyInvite link={view.inviteLink} />
              <div className="note">Send this link to your squad. They open it in a browser (or paste it in their csbot app), type a name, and you let them in. The key after <code>#</code> never leaves your devices, and their screens connect straight to this PC.</div>
            </>
          )}
          {demo && <div className="note">Demo room with fictional players. Hosting a real room needs the csbot desktop app.</div>}
          {view.role === 'member' && (
            <div className="mt"><button className="btn" type="button" onClick={() => session.leaveRoom()} data-testid="leave-room">Leave room</button></div>
          )}
        </div>
        <div className="card">
          <div className="card-h"><h3>Host</h3><span className="rolebadge admin">ADMIN · {room.hostName}</span></div>
          <div className="conn-row"><span className={'ic ' + (gsi === 'live' ? 'ok' : gsi === 'stale' ? 'warn' : 'off')}>{gsi === 'live' ? '✓' : gsi === 'stale' ? '!' : '·'}</span>
            <div><div className="ttl">Game · Valve GSI</div><div className="d">{gsi === 'live' ? `Receiving ${room.hostName}'s CS2` : gsi === 'stale' ? 'No game update for a while' : `Waiting for ${room.hostName}'s CS2`}</div></div><span /></div>
          <div className="conn-row"><span className="ic ok">✓</span>
            <div><div className="ttl">Room network</div><div className="d">
              {online} device{online === 1 ? '' : 's'} connected, directly to the host · handshake through {view.signaling === 'ws' ? 'a self-hosted relay' : 'public Nostr relays (no account)'}
            </div></div><span /></div>
          <div className="conn-row"><span className="ic ok">✓</span>
            <div><div className="ttl">Calls</div><div className="d">Made once on the host and sent to every screen. Claude Code calls arrive in M5.</div></div><span /></div>
          {admin && (
            <div className="mt"><button className="btn danger" type="button" onClick={() => session.endRoom()} data-testid="end-room">End room for everyone</button></div>
          )}
        </div>
      </div>

      {admin && (
        <div className="card mt" data-testid="pending">
          <div className="card-h"><h3>Waiting to join</h3><span className="muted small">{room.pending.length ? 'let in only people you know' : 'nobody right now'}</span></div>
          {room.pending.length === 0 && <div className="muted small">When someone opens your invite link, they show up here.</div>}
          {room.pending.map(p => (
            <div className="pend" key={p.id} data-testid="pending-row" data-request-id={p.id}>
              <b>{p.name}</b><span className="muted small">{DEVICE[p.device]} · asked {ago(p.at, now)}</span>
              <span className="acts">
                <button className="btn primary" type="button" data-testid="approve" onClick={() => session.approve(p.id)}>Let in</button>
                <button className="btn" type="button" data-testid="deny" onClick={() => session.deny(p.id)}>Decline</button>
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="card mt">
        <div className="card-h"><h3>Members</h3><span className="muted small">a slot gives each player their own job in every call · one player per slot</span></div>
        <div className="tw">
          <table className="t" data-testid="members">
            <thead><tr><th>Player</th><th>Role</th><th>Device</th><th>Shares own GSI</th><th>Status</th><th>Slot</th>{admin && <th />}</tr></thead>
            <tbody>
              {room.members.map(m => {
                const self = m.id === room.you;
                const editable = !demo && (admin || (self && perms.editSlot && m.id !== HOST_ID));
                return (
                  <tr key={m.id} className={self ? 'me-row' : ''} data-testid="member-row" data-member-id={m.id}>
                    <td><b>{m.name}</b>{self && <span className="muted"> (you)</span>}</td>
                    <td><span className={'rolebadge ' + m.role}>{m.role.toUpperCase()}</span></td>
                    <td>{DEVICE[m.device]}</td>
                    <td>{m.sharesGsi ? <span className="ok-t">✓ yes</span> : <span className="muted">{m.device === 'web' ? 'no (browser)' : 'not yet'}</span>}</td>
                    <td>{m.device === 'host' ? <span className="srcd"><i />hosting</span> : m.online ? <span className="srcd"><i />online</span> : <span className="srcd off"><i />offline</span>}</td>
                    <td><SlotSelect room={room} member={m} editable={editable} onChange={s => session.setSlot(m.id, s)} /></td>
                    {admin && <td>{m.id !== HOST_ID && <button className="btn" type="button" data-testid="remove" onClick={() => session.remove(m.id)}>Remove</button>}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid2 mt">
        <div className="card">
          <div className="card-h"><h3>Permissions</h3><span className="muted small">{admin ? 'you can change these' : 'set by the admin'}</span></div>
          <Perm id="perm-intel" title="Members log intel" desc="map clicks and hotkeys feed the shared forecast (M4)" on={perms.intel} enabled={admin} onChange={v => setPerm({ intel: v })} />
          <Perm id="perm-ask" title="Members ask the coach" desc="uses the host's Claude plan, with a quota per member (M5)" on={perms.ask} enabled={admin} onChange={v => setPerm({ ask: v })} />
          <Perm id="perm-editSlot" title="Members pick their own slot" desc="otherwise only the admin assigns slots" on={perms.editSlot} enabled={admin} onChange={v => setPerm({ editSlot: v })} />
          <Perm id="tournament-toggle" title="Tournament mode (whole room)" desc="turns off live calls and the forecast on every screen" on={room.tournament} enabled={admin} onChange={v => session.setTournament(v)} />
        </div>
        {view.role === 'member' ? (
          <div className="card" data-testid="your-device">
            <div className="card-h"><h3>Your device</h3><span className="rolebadge member">MEMBER</span></div>
            {view.device === 'desktop' ? (
              <div className="cfg">
                <span className="k">Share your GSI</span>
                <span className="v">{me?.sharesGsi ? <><span className="ok-t">✓</span> Your csbot sends your own money, K/A/D and weapon to the room. Enemy data never.</> : 'Starts when CS2 sends its first update to this PC.'}</span>
                <span className="k">Your slot</span><span className="v">{room.slots.find(s => s.id === me?.slot)?.label ?? 'none yet'}</span>
              </div>
            ) : (
              <div className="cfg">
                <span className="k">This browser</span><span className="v">Shows the room. It can't read your game.</span>
                <span className="k">Your money tile</span><span className="v">Install the csbot desktop app to share your own game data with the room.</span>
                <span className="k">Your slot</span><span className="v">{room.slots.find(s => s.id === me?.slot)?.label ?? 'none yet'}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="card">
            <div className="card-h"><h3>How the room works</h3></div>
            <ul className="plain">
              <li>Everyone sees the same call; each screen highlights its own job (YOU), map spot and scoreboard row.</li>
              <li>Members with the desktop app share their own game data: their money tile and live scoreboard row.</li>
              <li>Spectator-only data is dropped from every device, room-wide.</li>
              <li>The room lives as long as this app runs. Approved members get back in by themselves.</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
