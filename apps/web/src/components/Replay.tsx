// 2D round replay from the match demo (after the match only): everyone's movement, kills, smokes,
// molotovs and the plant, on csbot's own map outline. Plays at 1-4×, scrubs with a slider.
import { GEOS, worldToMap } from '@csbot/engine';
import type { DemoReplay, ReplayRound } from '@csbot/protocol';
import { useEffect, useMemo, useRef, useState } from 'react';

const SMOKE_R = 144, FIRE_R = 120; // world units
const SPEEDS = [1, 2, 4] as const;
const WEAPONS: Record<string, string> = { ak47: 'AK-47', m4a1_silencer: 'M4A1-S', m4a1: 'M4A4', usp_silencer: 'USP-S', hkp2000: 'P2000', glock: 'Glock', deagle: 'Deagle', awp: 'AWP', ssg08: 'Scout', galilar: 'Galil', famas: 'FAMAS', mp9: 'MP9', mac10: 'MAC-10', p250: 'P250', tec9: 'Tec-9', fiveseven: 'Five-SeveN', cz75a: 'CZ75', hegrenade: 'HE', inferno: 'fire', knife: 'knife' };
const weapon = (w?: string) => (w ? WEAPONS[w.replace(/^weapon_/, '')] ?? w.replace(/^weapon_/, '').replace(/_/g, ' ') : '→');

function at(r: ReplayRound, i: number, t: number): { x: number; y: number; z: number; hp: number } {
  const f = Math.max(0, Math.min(r.frames.length - 1, t * r.hz));
  const a = r.frames[Math.floor(f)]!, b = r.frames[Math.min(r.frames.length - 1, Math.floor(f) + 1)]!;
  const k = f - Math.floor(f), o = i * 4;
  const lerp = (u: number, v: number) => u + (v - u) * k;
  return { x: lerp(a[o]!, b[o]!), y: lerp(a[o + 1]!, b[o + 1]!), z: lerp(a[o + 2]!, b[o + 2]!), hp: a[o + 3]! };
}

export function Replay({ replay, me, label }: { replay: DemoReplay; me?: string; label?: string }) {
  const geo = GEOS[replay.map];
  const [ri, setRi] = useState(0);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(2);
  const r = replay.rounds[ri];
  const raf = useRef<number>(undefined);
  useEffect(() => {
    if (!playing || !r) return;
    let last = performance.now();
    const step = (now: number) => {
      const dt = ((now - last) / 1000) * speed;
      last = now;
      setT(x => { const n = x + dt; if (n >= r.duration) { setPlaying(false); return r.duration; } return n; });
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [playing, speed, r]);
  const mySide = useMemo(() => r?.players.find(p => p.steamid === me)?.side, [r, me]);
  if (!geo || !r) return <p className="muted">No replay for this map.</p>;
  const s = geo.world.s;
  const m = (x: number, y: number, z: number) => worldToMap(geo, x, y, z);
  const feed = r.kills.filter(k => k.t <= t).slice(-5);
  const name = (id?: string) => r.players.find(p => p.steamid === id)?.name ?? '?';
  const pick = (i: number) => { setRi(i); setT(0); setPlaying(false); };
  return (
    <div className="replay" data-testid="replay">
      <div className="replay-rounds" role="group" aria-label="Round">
        {replay.rounds.map((x, i) => (
          <button key={x.round} type="button" className={'rr' + (i === ri ? ' on' : '')} onClick={() => pick(i)} data-testid="replay-round">{x.round}</button>
        ))}
      </div>
      <svg viewBox="0 0 1000 1000" className="replay-map" role="img" aria-label={`Round ${r.round} replay`}>
        <path d={geo.floor} fill="#20252d" fillRule="evenodd" stroke="#3a4250" strokeWidth={4} />
        {geo.zones.filter(z => z.site).map(z => <text key={z.id} x={z.at[0]} y={z.at[1]} className="site">{z.site}</text>)}
        {r.nades.filter(n => n.t <= t && (n.kind === 'smoke' || n.kind === 'molotov') && t <= n.t + (n.duration ?? (n.kind === 'smoke' ? 18 : 7))).map((n, i) => {
          const [x, y] = m(n.x, n.y, n.z);
          return <circle key={`n${i}`} cx={x} cy={y} r={(n.kind === 'smoke' ? SMOKE_R : FIRE_R) * s} className={'nade ' + n.kind} />;
        })}
        {r.nades.filter(n => (n.kind === 'flash' || n.kind === 'he') && n.t <= t && t <= n.t + 0.6).map((n, i) => {
          const [x, y] = m(n.x, n.y, n.z);
          return <circle key={`f${i}`} cx={x} cy={y} r={60 * s} className={'nade ' + n.kind} />;
        })}
        {r.plant && r.plant.t <= t && (() => { const [x, y] = m(r.plant.x, r.plant.y, r.plant.z); return <rect x={x - 8} y={y - 8} width={16} height={16} className="bomb" data-testid="replay-bomb" />; })()}
        {r.players.map((p, i) => {
          const q = at(r, i, t);
          const [x, y] = m(q.x, q.y, q.z);
          const ours = mySide ? p.side === mySide : p.side === 'CT';
          const cls = 'pl ' + p.side.toLowerCase() + (ours ? ' ours' : '') + (p.steamid === me ? ' me' : '') + (q.hp > 0 ? '' : ' dead');
          return q.hp > 0
            ? <g key={p.steamid} className={cls}><circle cx={x} cy={y} r={11} /><text x={x} y={y - 16}>{p.name}</text></g>
            : <g key={p.steamid} className={cls}><text x={x} y={y} className="x">✕</text></g>;
        })}
      </svg>
      <div className="replay-bar">
        <button type="button" className="btn small" onClick={() => { if (t >= r.duration) setT(0); setPlaying(v => !v); }} data-testid="replay-play">{playing ? 'Pause' : 'Play'}</button>
        <input type="range" min={0} max={r.duration} step={0.25} value={t} onChange={e => { setT(Number(e.target.value)); setPlaying(false); }} aria-label="Time" data-testid="replay-time" />
        <span className="muted small tnum" data-testid="replay-clock">{Math.floor(t / 60)}:{String(Math.floor(t % 60)).padStart(2, '0')}</span>
        <div className="seg">{SPEEDS.map(v => <button key={v} type="button" className={speed === v ? 'on' : ''} onClick={() => setSpeed(v)}>{v}×</button>)}</div>
      </div>
      <ul className="killfeed" data-testid="replay-feed">
        {feed.map(k => <li key={`${k.t}-${k.victim}`}><span className="muted tnum">{Math.floor(k.t)}s</span> {name(k.killer)} <span className="muted">{weapon(k.weapon)}</span> {name(k.victim)}</li>)}
      </ul>
      {label && <p className="note">{label}</p>}
    </div>
  );
}
