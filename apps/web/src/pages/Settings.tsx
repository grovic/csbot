import { CFG_FILE_NAME, PLAYER_COMPONENTS } from '@csbot/gsi';
import type { CfgInstallResult, CsbotBridge, DataSourceState, HostInfo, LiveSnapshot, ScoutView } from '@csbot/protocol';
import { useCallback, useEffect, useState } from 'react';
import type { Session } from '../data/session.ts';
import type { SourceKind } from '../data/source.ts';
import { DesktopLink } from '../components/DesktopLink.tsx';

/** The desktop host adds its auto-update state to getInfo (not in HostInfo yet). */
type UpdateStatus = { version: string; state: 'off' | 'checking' | 'up-to-date' | 'downloading' | 'ready' | 'error'; available?: string; error?: string };
const updateText = (u?: UpdateStatus): string | undefined => {
  if (!u) return undefined;
  switch (u.state) {
    case 'up-to-date': return 'up to date';
    case 'checking': return 'checking for updates…';
    case 'downloading': return `downloading ${u.available ?? 'an update'}…`;
    case 'ready': return `update ${u.available ?? ''} ready, restart csbot to install`.replace('  ', ' ');
    case 'error': return "couldn't check for updates";
    default: return undefined;
  }
};

const ago = (at: number | undefined, now: number) => {
  if (!at) return 'never';
  const s = Math.max(0, Math.round((now - at) / 1000));
  return s < 2 ? 'just now' : s < 90 ? `${s} s ago` : `${Math.round(s / 60)} min ago`;
};

function GsiStatus({ snap }: { snap?: LiveSnapshot }) {
  const c = snap?.connection;
  const state = c?.gsi ?? 'waiting';
  const icon = state === 'live' ? 'ok' : state === 'stale' ? 'warn' : 'off';
  return (
    <div className="card" data-testid="gsi-status">
      <div className="card-h"><h3>Game connection</h3><span className="muted small">Valve GSI</span></div>
      <div className="conn-row">
        <span className={'ic ' + icon}>{state === 'live' ? '✓' : state === 'stale' ? '!' : '·'}</span>
        <div>
          <div className="ttl">{state === 'live' ? 'Receiving game updates' : state === 'stale' ? 'No update for a while' : 'Waiting for the first update'}</div>
          <div className="d">
            {c && snap ? <>{c.payloads.toLocaleString('en-US')} updates · last {ago(c.lastPayloadAt, snap.at)} · source: {c.source}</> : 'No data yet'}
          </div>
        </div>
        <span />
      </div>
      <div className="conn-row">
        <span className="ic ok">✓</span>
        <div>
          <div className="ttl">Spectator guard</div>
          <div className="d">Spectator-only data dropped this session: {c?.guardDropped ?? 0}. A playing client shouldn't send any.</div>
        </div>
        <span />
      </div>
    </div>
  );
}

function HostCard({ bridge }: { bridge: CsbotBridge }) {
  const [info, setInfo] = useState<HostInfo>();
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<CfgInstallResult>();
  const [err, setErr] = useState<string>();
  const refresh = useCallback(() => bridge.getInfo().then(setInfo, (e: unknown) => setErr(String(e))), [bridge]);
  useEffect(() => { void refresh(); }, [refresh]);
  const install = async () => {
    setBusy(true);
    setRes(undefined);
    try { setRes(await bridge.installCfg()); await refresh(); }
    catch (e) { setRes({ ok: false, error: String(e) }); }
    finally { setBusy(false); }
  };
  const target = info?.cfgPath ?? `<CS2 folder>\\game\\csgo\\cfg\\${CFG_FILE_NAME}`;
  const status = info?.cfgStatus;
  return (
    <div className="card" data-testid="host-card">
      <div className="card-h"><h3>This PC (host)</h3><span className="muted small" data-testid="app-version">{info ? `csbot ${info.version}${updateText((info as HostInfo & { update?: UpdateStatus }).update) ? ` · ${updateText((info as HostInfo & { update?: UpdateStatus }).update)}` : ''}` : ''}</span></div>
      {err && <div className="result err">{err}</div>}
      <div className="cfg">
        <span className="k">GSI endpoint</span><span className="v"><code>{info?.gsiUrl ?? '…'}</code> (this PC only)</span>
        <span className="k">CS2 folder</span><span className="v">{info ? info.cs2Path ?? 'not found' : '…'}</span>
        <span className="k">GSI config</span>
        <span className="v" data-testid="cfg-status">{!info ? '…' : status === 'current' ? <span className="chip">installed</span>
          : status === 'outdated' ? <span className="chip warn">outdated: update it</span> : <span className="chip warn">not installed</span>}</span>
        <span className="k">Recordings</span><span className="v"><code>{info?.recordingsDir ?? '…'}</code></span>
      </div>
      {info?.portFallback && (
        <div className="result err" data-testid="port-fallback">
          Port {info.portFallback.wanted} is used by another program, so csbot now listens on {info.portFallback.actual} and keeps that port. Update the GSI config once.
        </div>
      )}
      <div className="note" style={{ marginTop: 14 }}>
        <b style={{ color: 'var(--ink)' }}>Install GSI config</b> writes one file, <code>{target}</code>. It asks CS2 for your own player data only:
        {' '}{PLAYER_COMPONENTS.join(', ')}. No spectator data, no enemy data. Restart CS2 after installing.
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <button className="btn primary" type="button" onClick={install} disabled={busy || !info?.cs2Path} data-testid="install-cfg">
          {busy ? 'Installing…' : status === 'current' ? 'Reinstall GSI config' : status === 'outdated' ? 'Update GSI config' : 'Install GSI config'}
        </button>
        <button className="btn" type="button" onClick={() => void bridge.openRecordings()}>Open recordings folder</button>
      </div>
      {res && (
        <div className={'result ' + (res.ok ? 'ok' : 'err')} data-testid="install-result">
          {res.ok ? `Installed: ${res.path ?? CFG_FILE_NAME}` : `Not installed: ${res.error ?? 'unknown error'}`}
        </div>
      )}
    </div>
  );
}

/** Numpad intel hotkeys (desktop host): off by default, because a global hotkey takes the key from CS2. */
function HotkeysCard({ bridge }: { bridge: CsbotBridge }) {
  const [hk, setHk] = useState<HostInfo['intelHotkeys']>();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const refresh = useCallback(() => bridge.getInfo().then(i => setHk(i?.intelHotkeys), () => undefined), [bridge]);
  useEffect(() => { void refresh(); }, [refresh]);
  const toggle = async (on: boolean) => {
    setBusy(true); setErr(undefined);
    try {
      const r = await bridge.setIntelHotkeys!(on);
      if (!r.ok) setErr(r.error ?? "Couldn't change the hotkeys.");
    } catch (e) { setErr(String((e as Error)?.message ?? e)); }
    await refresh();
    setBusy(false);
  };
  const on = !!hk?.enabled;
  return (
    <div className="card" data-testid="hotkeys-card">
      <div className="card-h"><h3>Intel hotkeys</h3><span className="muted small">numpad · this PC</span></div>
      <label className="toggle-row">
        <input type="checkbox" checked={on} disabled={busy} onChange={e => void toggle(e.target.checked)} data-testid="hotkeys-toggle" />
        <span><b>{on ? 'On' : 'Off'}</b> · Numpad keys log intel without leaving the game. Off by default: a global hotkey takes that key away from CS2 while csbot runs.</span>
      </label>
      {(err || hk?.error) && <div className="result err">{err ?? hk?.error}</div>}
      {hk && hk.keys.length > 0 && (
        <ul className="hotkeys" data-testid="hotkeys-list" data-enabled={on ? '1' : '0'}>
          {hk.keys.map(k => (
            <li key={k.key}><kbd>{k.key}</kbd><span>{k.zoneName} {k.kind === 'clear' ? 'clear' : 'seen'}</span>{k.kind === 'sighting' && <span className="muted small">press 1-5× for the count</span>}</li>
          ))}
        </ul>
      )}
      <p className="note">Hotkeys only listen for the key on this PC. csbot never sends keys or input to the game.</p>
    </div>
  );
}

function BrowserCard({ member }: { member: boolean }) {
  return (
    <div className="card" data-testid="browser-card">
      <div className="card-h"><h3>{member ? 'This browser' : 'Hosting'}</h3><span className="muted small">browser</span></div>
      <p style={{ margin: 0, color: 'var(--ink2)' }}>
        {member
          ? "You joined a room: everything here comes from the host's csbot. A browser can't read your own game; install the csbot desktop app to share your money and stats with the room."
          : "This is the web app. Reading CS2 needs the csbot desktop app on the gaming PC: it receives the game's GSI updates on localhost and runs the engine. Teammates join the host's room by opening the invite link."}
      </p>
      {!member && <p className="note">Without a host, this page shows a demo: a fictional match replayed through the real engine.</p>}
      <p className="note"><DesktopLink /> (Windows, free, updates itself). Windows may warn about an unknown publisher during the beta: More info → Run anyway.</p>
    </div>
  );
}

const KEY_STATE: Record<DataSourceState, string> = {
  live: 'connected', 'missing-key': 'no key yet', error: "the key didn't work", sample: 'using the sample match', off: 'off',
};
const CLAUDE_STATE: Record<DataSourceState, string> = {
  live: 'found on this PC', off: 'not installed on this PC', error: 'the last call failed', sample: 'the demo shows a recorded briefing', 'missing-key': 'not signed in',
};
const stateCls = (st: DataSourceState) => (st === 'live' ? 'ok' : st === 'sample' ? 'sample' : st === 'error' || st === 'missing-key' ? 'warn' : 'off');

function KeyRow({ service, label, help, state, session }: { service: 'faceit' | 'steam'; label: string; help: React.ReactNode; state: DataSourceState; session: Session }) {
  const [val, setVal] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ ok: boolean; text: string }>();
  const save = async (key: string | null) => {
    setBusy(true); setRes(undefined);
    const r = await session.setApiKey(service, key);
    setBusy(false);
    if (r.ok) { setVal(''); setRes({ ok: true, text: key ? 'Saved on this PC.' : 'Key removed.' }); }
    else setRes({ ok: false, text: r.error ?? 'Could not save the key.' });
  };
  return (
    <div className="keyrow">
      <span className="kname">{label}</span>
      <div>
        <div className="krow">
          <span className={'srcchip ' + stateCls(state)} data-testid={`source-${service}`} data-state={state}><i />{KEY_STATE[state]}</span>
          <span className="muted small">{help}</span>
        </div>
        <form className="krow" style={{ marginTop: 6 }} onSubmit={e => { e.preventDefault(); if (val.trim()) void save(val.trim()); }}>
          <input className="inp" type="password" autoComplete="off" spellCheck={false} value={val} onChange={e => setVal(e.target.value)}
            placeholder={state === 'live' ? 'Paste a new key to replace it' : `Paste your ${label} API key`} aria-label={`${label} API key`} data-testid={`key-${service}`} />
          <button className="btn primary" type="submit" disabled={busy || !val.trim()} data-testid={`key-${service}-save`}>Save</button>
          {state !== 'missing-key' && state !== 'off' && <button className="btn" type="button" disabled={busy} onClick={() => void save(null)} data-testid={`key-${service}-clear`}>Clear</button>}
        </form>
        {res && <div className={'result ' + (res.ok ? 'ok' : 'err')}>{res.text}</div>}
      </div>
    </div>
  );
}

/** Your FACEIT nickname: lists your recent matches on the Scout page and spots a live one. */
function NicknameRow({ scout, session }: { scout: ScoutView; session: Session }) {
  const [nick, setNick] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const a = scout.account;
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nick.trim()) return;
    setBusy(true); setErr(undefined);
    const r = await session.setFaceitNickname(nick.trim());
    setBusy(false);
    if (r.ok) setNick(''); else setErr(r.error);
  };
  return (
    <div className="keyrow">
      <span className="kname">Your FACEIT</span>
      <div>
        <div className="krow">
          {a?.status === 'ok'
            ? <span className="srcchip ok" data-testid="faceit-account" data-state="ok"><i />{a.nickname}{a.level ? ` · lvl ${a.level}` : ''}{a.elo ? ` · ${a.elo.toLocaleString('en-US')} ELO` : ''}</span>
            : <span className="srcchip" data-testid="faceit-account" data-state={a?.status ?? 'none'}><i />{a ? (a.status === 'not-found' ? `${a.nickname}: not found` : a.nickname) : 'not set'}</span>}
          <span className="muted small">your recent matches on Scout; a live one gets scouted by itself</span>
        </div>
        <form className="joinrow" onSubmit={save} style={{ marginTop: 6 }}>
          <input className="inp" value={nick} onChange={e => setNick(e.target.value)} placeholder="Your FACEIT nickname" maxLength={32} data-testid="faceit-nickname" />
          <button className="btn" type="submit" disabled={busy || !nick.trim()} data-testid="faceit-nickname-save">{busy ? 'Checking…' : 'Save'}</button>
          {a && <button className="btn" type="button" onClick={() => void session.setFaceitNickname(null)}>Clear</button>}
        </form>
        {(err || a?.error) && <div className="result err">{err ?? a?.error}</div>}
      </div>
    </div>
  );
}

function DataSources({ scout, session, host }: { scout: ScoutView; session: Session; host: boolean }) {
  const s = scout.sources;
  return (
    <div className="card" data-testid="data-sources">
      <div className="card-h"><h3>Data sources</h3><span className="muted small">scouting</span></div>
      {host ? (
        <>
          <KeyRow service="faceit" label="FACEIT" state={s.faceit} session={session}
            help={<>rosters and stats · free key at <a href="https://developers.faceit.com/" target="_blank" rel="noreferrer">developers.faceit.com</a></>} />
          <KeyRow service="steam" label="Steam" state={s.steam} session={session}
            help={<>account age, bans, CS2 hours · free key at <a href="https://steamcommunity.com/dev/apikey" target="_blank" rel="noreferrer">steamcommunity.com/dev/apikey</a></>} />
          <div className="keyrow">
            <span className="kname">Claude Code</span>
            <div className="krow">
              <span className={'srcchip ' + stateCls(s.claude)} data-testid="source-claude" data-state={s.claude}><i />{CLAUDE_STATE[s.claude]}</span>
              <span className="muted small">writes the briefing with your own Claude Code login</span>
            </div>
          </div>
          <NicknameRow scout={scout} session={session} />
          <p className="note">Keys are stored encrypted on this PC and only used by this app. They never go to the room or to teammates.</p>
        </>
      ) : (
        <>
          <p style={{ margin: 0, color: 'var(--ink2)' }}>Scouting runs on the host's desktop app: it holds the FACEIT and Steam keys and runs Claude Code. This screen shows what the host shares.</p>
          <div className="krow" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
            <span className={'srcchip ' + stateCls(s.faceit)} data-testid="source-faceit" data-state={s.faceit}><i />FACEIT · {KEY_STATE[s.faceit]}</span>
            <span className={'srcchip ' + stateCls(s.steam)} data-testid="source-steam" data-state={s.steam}><i />Steam · {KEY_STATE[s.steam]}</span>
            <span className={'srcchip ' + stateCls(s.claude)} data-testid="source-claude" data-state={s.claude}><i />Claude Code · {CLAUDE_STATE[s.claude]}</span>
          </div>
        </>
      )}
    </div>
  );
}

const FAIR = [
  'Live data only from official Valve GSI',
  'No memory reading, injection or in-game overlay',
  'No packet capture, no screen capture of the game',
  'No input automation. csbot never presses keys',
  'Spectator-only GSI data is dropped while a match is live',
  'Enemy money and positions are always labeled estimates',
];

export function Settings({ snap, kind, scout, session }: { snap?: LiveSnapshot; kind: SourceKind; scout: ScoutView; session: Session }) {
  const bridge = kind === 'desktop' ? window.csbot : undefined;
  return (
    <div className="grid2" data-testid="settings">
      {bridge ? <HostCard bridge={bridge} /> : <BrowserCard member={kind === 'member'} />}
      <GsiStatus snap={snap} />
      {bridge?.setIntelHotkeys && session.isHostSide && <div style={{ gridColumn: '1/-1' }}><HotkeysCard bridge={bridge} /></div>}
      <div style={{ gridColumn: '1/-1' }}><DataSources scout={scout} session={session} host={session.canScout} /></div>
      <div className="card" style={{ gridColumn: '1/-1' }}>
        <div className="card-h"><h3>Fair play</h3></div>
        <div className="fair">{FAIR.map(f => <div key={f}><span className="ic ok">✓</span>{f}</div>)}</div>
      </div>
    </div>
  );
}
