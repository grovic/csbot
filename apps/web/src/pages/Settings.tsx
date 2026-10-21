import { CFG_FILE_NAME, PLAYER_COMPONENTS } from '@csbot/gsi';
import type { CfgInstallResult, CsbotBridge, HostInfo, LiveSnapshot } from '@csbot/protocol';
import { useCallback, useEffect, useState } from 'react';
import type { SourceKind } from '../data/source.ts';

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
      <div className="card-h"><h3>This PC (host)</h3><span className="muted small">{info ? 'csbot ' + info.version : ''}</span></div>
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

function BrowserCard() {
  return (
    <div className="card" data-testid="browser-card">
      <div className="card-h"><h3>Hosting</h3><span className="muted small">browser</span></div>
      <p style={{ margin: 0, color: 'var(--ink2)' }}>
        This is the web app. Reading CS2 needs the csbot desktop app on the gaming PC: it receives the game's GSI updates on localhost and runs the engine.
        Joining your squad's room from the browser arrives in M2.
      </p>
      <p className="note">Without a host, this page shows a demo: a fictional match replayed through the real engine.</p>
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

export function Settings({ snap, kind }: { snap?: LiveSnapshot; kind: SourceKind }) {
  const bridge = kind === 'desktop' ? window.csbot : undefined;
  return (
    <div className="grid2" data-testid="settings">
      {bridge ? <HostCard bridge={bridge} /> : <BrowserCard />}
      <GsiStatus snap={snap} />
      <div className="card" style={{ gridColumn: '1/-1' }}>
        <div className="card-h"><h3>Fair play</h3></div>
        <div className="fair">{FAIR.map(f => <div key={f}><span className="ic ok">✓</span>{f}</div>)}</div>
      </div>
    </div>
  );
}
