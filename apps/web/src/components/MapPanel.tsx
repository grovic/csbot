import { GEOS, gridCells, heatGrid, MAPS, positionOnRoute, slotsFor, zoneAt, type GeoZone, type MapGeo } from '@csbot/engine';
import type { IntelView, LiveSnapshot, RoomView, SquadMarker } from '@csbot/protocol';
import { useEffect, useMemo, useRef, useState } from 'react';
import { clockStr, mapName } from '../format.ts';
import { useTicker } from '../hooks.ts';

const G = 160;
/** Intel pins fade over this many seconds (they stay visible, dimmed, for the rest of the round). */
const FADE_S = 25;
/** Zones smaller than this many lookup cells get no label (they still take clicks and hovers). */
const LABEL_MIN_CELLS = 260;

interface ZoneInfo { zone: GeoZone; index: number; cells: number }
/** The part of the 0..1000 map square the map occupies (map units), so the panel can crop to it. */
export interface View { x: number; y: number; w: number; h: number }

const viewCache = new WeakMap<MapGeo, View>();
export function viewOf(geo: MapGeo): View {
  let v = viewCache.get(geo);
  if (v) return v;
  const n = geo.grid.size, cells = gridCells(geo), k = 1000 / n;
  let x0 = n, y0 = n, x1 = 0, y1 = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) if (cells[j * n + i]) { x0 = Math.min(x0, i); y0 = Math.min(y0, j); x1 = Math.max(x1, i); y1 = Math.max(y1, j); }
  const pad = 14;
  const x = Math.max(0, x0 * k - pad), y = Math.max(0, y0 * k - pad);
  v = { x, y, w: Math.min(1000, (x1 + 1) * k + pad) - x, h: Math.min(1000, (y1 + 1) * k + pad) - y };
  viewCache.set(geo, v);
  return v;
}
/** CSS position of a map point inside the cropped panel. */
const pos = (v: View, x: number, y: number) => ({ left: ((x - v.x) / v.w) * 100 + '%', top: ((y - v.y) / v.h) * 100 + '%' });

const infoCache = new WeakMap<MapGeo, ZoneInfo[]>();
/** Zones with their size, biggest first. */
function zoneInfo(geo: MapGeo): ZoneInfo[] {
  let info = infoCache.get(geo);
  if (info) return info;
  const counts = new Array<number>(geo.zones.length).fill(0);
  for (const v of gridCells(geo)) if (v) counts[v - 1]!++;
  info = geo.zones.map((zone, index) => ({ zone, index, cells: counts[index]! })).sort((a, b) => b.cells - a.cells);
  infoCache.set(geo, info);
  return info;
}

/** Where the lower level sits (Nuke): the box around its zones, for its caption. */
function lowerLevel(geo: MapGeo): { name: string; x: number; y: number } | undefined {
  const lower = geo.zones.filter(z => z.level);
  const name = geo.world.levels[1]?.name;
  if (!lower.length || !name) return undefined;
  return { name, x: Math.min(...lower.map(z => z.at[0])) - 30, y: Math.min(...lower.map(z => z.at[1])) - 60 };
}

function MapBase({ geo, view: v }: { geo: MapGeo; view: View }) {
  const low = lowerLevel(geo);
  return (
    <svg viewBox={`${v.x} ${v.y} ${v.w} ${v.h}`} preserveAspectRatio="none" aria-hidden data-testid="map-floor" data-map={geo.id}>
      <path d={geo.floor} fill="#20252d" fillRule="evenodd" stroke="#3a4250" strokeWidth={4} strokeLinejoin="round" />
      <g>{geo.zones.filter(z => z.site).map(z => <path key={z.id} d={z.path} fill="#2a313c" fillRule="evenodd" />)}</g>
      <g fill="none" stroke="#2d343f" strokeWidth={1.4}>{geo.zones.map(z => <path key={z.id} d={z.path} />)}</g>
      <circle cx={geo.spawn.T[0]} cy={geo.spawn.T[1]} r={7} fill="#c98500" opacity={0.85} />
      <circle cx={geo.spawn.CT[0]} cy={geo.spawn.CT[1]} r={7} fill="#3987e5" opacity={0.85} />
      {low && <text x={low.x} y={low.y} fill="#6b7280" fontSize={22} fontWeight={700} letterSpacing={2}>{low.name.toUpperCase()} LEVEL</text>}
    </svg>
  );
}

function Labels({ geo, view }: { geo: MapGeo; view: View }) {
  return (
    <>
      {zoneInfo(geo).filter(i => i.zone.site || i.cells >= LABEL_MIN_CELLS).map(({ zone: z }) => (
        <div key={z.id} className={'zlabel' + (z.site ? ' site' : '')} style={pos(view, z.at[0], z.at[1])}>{z.name}</div>
      ))}
    </>
  );
}

/** Heat image (G×G RGBA) from the plan forecast. Same color ramp as the prototype. */
function useHeatImage(map: string | undefined, enemy: 'CT' | undefined, plans: Record<string, number> | undefined, t: number): ImageData | undefined {
  const key = plans ? map + (enemy ?? 'T') + Object.entries(plans).map(([k, v]) => k + v.toFixed(3)).join() + '|' + Math.round(t) : '';
  return useMemo(() => {
    const model = map ? (enemy === 'CT' ? MAPS[map]?.ct : MAPS[map]) : undefined;
    if (!plans || !model) return undefined;
    const heat = heatGrid(model, plans, Math.round(t), { size: G });
    const img = new ImageData(G, G);
    const d = img.data;
    for (let n = 0; n < G * G; n++) {
      const v = heat[n]!, o = n * 4;
      if (v < 0.03) { d[o + 3] = 0; continue; }
      d[o] = 201 + 54 * v; d[o + 1] = 133 + 81 * v; d[o + 2] = 120 * v; d[o + 3] = 255 * (0.16 + 0.74 * v);
    }
    return img;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

function HeatCanvas({ img, geo, view: v }: { img: ImageData; geo: MapGeo; view: View }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const small = useMemo(() => { const c = document.createElement('canvas'); c.width = c.height = G; return c; }, []);
  const floor = useMemo(() => new Path2D(geo.floor), [geo]);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const paint = () => {
      const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      small.getContext('2d')!.putImageData(img, 0, 0);
      const ctx = cv.getContext('2d')!;
      const sx = w / v.w, sy = h / v.h;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(small, -v.x * sx, -v.y * sy, 1000 * sx, 1000 * sy);
      // Clip the blur to the floor.
      ctx.globalCompositeOperation = 'destination-in';
      ctx.setTransform(sx, 0, 0, sy, -v.x * sx, -v.y * sy);
      ctx.fillStyle = '#000';
      ctx.fill(floor, 'evenodd');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
    };
    paint();
    const ro = new ResizeObserver(paint);
    ro.observe(cv);
    return () => ro.disconnect();
  }, [img, small, floor, v]);
  return <canvas ref={ref} data-testid="heat" aria-hidden />;
}

/** Who plays each slot: the room member assigned to it, else the slot's label. */
function slotNamer(room?: RoomView, map?: string, side?: 'CT' | 'T', mode?: string) {
  const byslot = new Map((room?.members ?? []).filter(m => m.slot).map(m => [m.slot!, m.name]));
  // Without a room (solo), the playbook's own position names.
  const label = new Map((room?.slots ?? slotsFor(map, side, mode)).map(s => [s.id, s.label]));
  return (slot: string) => byslot.get(slot) ?? label.get(slot) ?? slot;
}

const initials = (names: string[]) => names.map(n => n.trim().slice(0, 2).toUpperCase()).join('+');

/** Seconds since the round went live, at the snapshot (the forecast carries it; else the round clock). */
function liveSeconds(snap: LiveSnapshot, roundTime: number): number | undefined {
  if (snap.forecast?.liveT !== undefined) return snap.forecast.liveT;
  const c = snap.match?.clock;
  return c?.phase === 'live' && c.endsIn !== undefined ? Math.max(0, roundTime - c.endsIn) : undefined;
}

/** Pins at each zone with intel this round: count (✓ clear), who saw it, dimmed with age. */
function IntelPins({ geo, view, intel, now, roundTime }: { geo: MapGeo; view: View; intel: IntelView[]; now?: number; roundTime: number }) {
  return (
    <>
      {intel.map((it, i) => {
        const z = geo.zones.find(x => x.id === it.zone);
        if (!z) return null;
        // Alternate above/below the zone label so neighbouring pins don't sit on it.
        const dy = i % 2 ? 30 : -30;
        const age = now === undefined ? 0 : Math.max(0, now - it.t);
        const opacity = Math.max(0.4, 1 - (age / FADE_S) * 0.6);
        const what = it.count ? `${it.count} at ${it.zoneName}` : `${it.zoneName} clear`;
        return (
          <div key={it.zone + it.t} className={'ipin' + (it.count ? '' : ' clear')} style={{ ...pos(view, z.at[0], z.at[1] + dy), opacity }}
            title={`${it.by.join(' + ')}: ${what} · ${clockStr(roundTime - it.t)}`} data-testid="intel-pin" data-zone={it.zone} data-count={it.count}>
            <b>{it.count ? it.count : '✓'}</b><span>{initials(it.by)}</span>
          </div>
        );
      })}
    </>
  );
}

interface Pop { zone: string; x: number; y: number }

/**
 * Click anywhere in a zone during a live round: how many enemies (or clear), shared with the room.
 * Each zone also has a small button at its label (keyboard and screen readers).
 * `block` is why intel can't be logged right now (the click then shows it instead of the choices).
 */
function IntelLayer({ geo, view: v, block, onIntel, clockLeft }: { geo: MapGeo; view: View; block?: string; onIntel: (zone: string, count: number) => Promise<string | undefined>; clockLeft?: number }) {
  const [pop, setPop] = useState<Pop>();
  const [hover, setHover] = useState<string>();
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const errTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const zoneName = (id: string) => geo.zones.find(z => z.id === id)?.name ?? id;

  const showErr = (e: string) => {
    setErr(e);
    clearTimeout(errTimer.current);
    errTimer.current = setTimeout(() => setErr(undefined), 4500);
  };
  useEffect(() => () => clearTimeout(errTimer.current), []);

  const choose = async (count: number) => {
    if (!pop || busy) return;
    setBusy(true);
    const e = await onIntel(pop.zone, count);
    setBusy(false);
    setPop(undefined);
    if (e) showErr(e);
  };

  // Keys while the popover is open: 1-5 enemies, 0 clear, Esc cancels.
  useEffect(() => {
    if (!pop) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setPop(undefined); return; }
      if (/^[0-5]$/.test(e.key)) { e.preventDefault(); void choose(Number(e.key)); }
    };
    const onDown = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.intel-pop, .zhit, .zcatch')) setPop(undefined); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onDown); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pop, busy]);

  const at = (ev: React.MouseEvent) => {
    const r = wrap.current!.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top, mx: v.x + ((ev.clientX - r.left) / r.width) * v.w, my: v.y + ((ev.clientY - r.top) / r.height) * v.h };
  };
  const open = (zone: string, ev: React.MouseEvent) => {
    if (block) { setPop(undefined); showErr(block); return; }
    const p = at(ev);
    setErr(undefined);
    setPop({ zone, x: p.x, y: p.y });
  };
  const onMapClick = (ev: React.MouseEvent) => {
    const p = at(ev);
    const z = zoneAt(geo, p.mx, p.my);
    if (z) open(z.id, ev); else setPop(undefined);
  };
  const onMove = (ev: React.MouseEvent) => { const p = at(ev); setHover(zoneAt(geo, p.mx, p.my)?.id); };

  const w = wrap.current?.getBoundingClientRect();
  const left = pop && w ? Math.max(4, Math.min(pop.x + 8, w.width - 236)) : 0;
  const top = pop && w ? Math.max(4, Math.min(pop.y + 8, w.height - 96)) : 0;
  const lit = geo.zones.find(z => z.id === (pop?.zone ?? hover));
  return (
    <div className={'zlayer' + (block ? ' blocked' : '')} ref={wrap}>
      {lit && (
        <svg className="zhl" viewBox={`${v.x} ${v.y} ${v.w} ${v.h}`} preserveAspectRatio="none" aria-hidden>
          <path d={lit.path} fillRule="evenodd" />
        </svg>
      )}
      <div className="zcatch" onClick={onMapClick} onMouseMove={onMove} onMouseLeave={() => setHover(undefined)} title={lit?.name} />
      {zoneInfo(geo).map(({ zone: z }) => (
        <button key={z.id} type="button" className={'zhit' + (pop?.zone === z.id ? ' on' : '')}
          style={pos(v, z.at[0], z.at[1])}
          onClick={e => { e.stopPropagation(); open(z.id, e); }} onMouseEnter={() => setHover(z.id)}
          data-testid="map-zone" data-zone={z.id} aria-label={`${z.name}: log intel`} />
      ))}
      {lit && !pop && <div className="zname" style={pos(v, lit.at[0], lit.at[1])}>{lit.name}</div>}
      {pop && (
        <div className="intel-pop" style={{ left, top }} data-testid="intel-pop" role="dialog" aria-label={`Intel at ${zoneName(pop.zone)}`}>
          <div className="ttl">Enemies at <b>{zoneName(pop.zone)}</b>{clockLeft !== undefined ? ` · ${clockStr(clockLeft)}` : ''} · shared with the room</div>
          <div className="opts">
            {[1, 2, 3, 4, 5].map(k => (
              <button key={k} type="button" disabled={busy} onClick={() => void choose(k)} data-testid="intel-count" data-count={k}>{k}</button>
            ))}
            <button type="button" className="clear" disabled={busy} onClick={() => void choose(0)} data-testid="intel-count" data-count={0}>Clear</button>
          </div>
          <div className="foot"><span className="muted small">keys 1-5, 0 clear, Esc</span><button type="button" className="lnk" onClick={() => setPop(undefined)}>Cancel</button></div>
        </div>
      )}
      {err && <div className="intel-err" data-testid="intel-error" role="alert">{err}</div>}
    </div>
  );
}

/** Our squad: planned (dashed), on their spot (solid), rotating along the route with a countdown, dead (✕). */
function SquadMarkers({ squad, view, youHandle, hostNow }: { squad: SquadMarker[]; view: View; youHandle?: string; hostNow: () => number }) {
  const moving = squad.some(m => m.state === 'rotating');
  useTicker(200, moving);
  const now = hostNow();
  return (
    <>
      {squad.map(m => {
        const me = m.slot === youHandle;
        let at: readonly [number, number] = m.at, text = m.label, arrived = false;
        if (m.state === 'rotating' && m.route?.length && m.since !== undefined) {
          const t = Math.max(0, (now - m.since) / 1000);
          const end = m.route[m.route.length - 1]![2];
          at = positionOnRoute(m.route, t);
          arrived = t >= end;
          text = arrived ? `at ${m.to}` : `→ ${m.to} · ${Math.ceil(end - t)} s`;
        }
        if (m.state === 'dead') text = 'dead';
        if (m.state === 'spot') text = `${m.label} · on spot`;
        const cls = 'mk ' + m.state + (arrived ? ' arrived' : '') + (me ? ' me' : '') + (m.open ? ' open' : '');
        const who = me ? 'You' : m.name;
        return (
          <div key={m.slot} className={cls} style={pos(view, at[0], at[1])}
            title={`${who} · ${m.state === 'planned' ? `${m.label} · planned spot` : text}${m.open ? ' · not in the room' : ''}`}
            data-testid={me ? 'marker-you' : 'marker'} data-slot={m.slot} data-state={m.state}>
            <i>{m.state === 'dead' ? '✕' : me ? 'YOU' : ''}</i>
            <span>{me ? text : `${m.name} · ${text}`}</span>
          </div>
        );
      })}
    </>
  );
}

/** "On my spot" and rotations for our own marker, in a room. */
function CheckInBar({ block, onCheckIn }: { block?: string; onCheckIn: (state: 'spot' | 'rotate', site?: 'A' | 'B') => Promise<string | undefined> }) {
  const [err, setErr] = useState<string>();
  const go = async (state: 'spot' | 'rotate', site?: 'A' | 'B') => {
    const e = await onCheckIn(state, site);
    setErr(e);
    if (e) setTimeout(() => setErr(undefined), 4000);
  };
  return (
    <div className="checkin" data-testid="checkin">
      <span className="muted small">Your marker</span>
      <button type="button" className="btn small" disabled={!!block} title={block} onClick={() => void go('spot')} data-testid="checkin-spot">On my spot</button>
      <button type="button" className="btn small" disabled={!!block} title={block} onClick={() => void go('rotate', 'A')} data-testid="checkin-a">Rotating → A</button>
      <button type="button" className="btn small" disabled={!!block} title={block} onClick={() => void go('rotate', 'B')} data-testid="checkin-b">Rotating → B</button>
      {err && <span className="err small" role="alert" data-testid="checkin-error">{err}</span>}
    </div>
  );
}

export function MapPanel({ snap, room, intelBlock, onIntel, receivedAt, rate = 1, checkInBlock, onCheckIn }: {
  snap: LiveSnapshot;
  room?: RoomView;
  /** Why intel can't be logged right now (undefined = it can). */
  intelBlock?: string;
  onIntel?: (zone: string, count: number) => Promise<string | undefined>;
  /** When this snapshot arrived and how fast host time runs (rotations move on the host's clock). */
  receivedAt?: number;
  rate?: number;
  checkInBlock?: string;
  onCheckIn?: (state: 'spot' | 'rotate', site?: 'A' | 'B') => Promise<string | undefined>;
}) {
  const m = snap.match;
  const geo = m?.map ? GEOS[m.map] : undefined;
  const base = m?.map ? MAPS[m.map] : undefined;
  // The plans behind the forecast: their attack on our CT halves, their setups on our T halves.
  const model = snap.forecast?.enemy === 'CT' ? base?.ct : base;
  const roundTime = base?.roundTime ?? 115;
  const f = snap.forecast && model && snap.forecast.map === model.id ? snap.forecast : undefined;
  const [ahead, setAhead] = useState(0);
  const now = liveSeconds(snap, roundTime);
  const img = useHeatImage(m?.map, f?.enemy, f?.plans, (f?.liveT ?? 0) + (f?.liveT !== undefined ? ahead : 0));

  if (!m || !geo) {
    return (
      <div className="mapcol" data-testid="map">
        <div className="map">
          <div className="map-empty"><div className="box">
            <b>{m ? `No map for ${mapName(m.map)}` : 'No map yet'}</b>
            {m ? 'csbot has the seven competitive maps. This one is not among them.' : 'The map appears when the match starts.'}
          </div></div>
        </div>
      </div>
    );
  }

  const view = viewOf(geo);
  const spots = snap.setupSpots ?? [];
  const who = slotNamer(room, m.map, m.ourSide, m.mode);
  const intel = snap.intel ?? [];
  const clockLeft = m.clock.phase === 'live' && m.clock.endsIn !== undefined ? m.clock.endsIn : undefined;
  return (
    <div className="mapcol" data-testid="map">
      <div className={'map' + (onIntel && !intelBlock ? ' can-intel' : '')} style={{ aspectRatio: `${view.w} / ${view.h}`, maxWidth: Math.round(560 * Math.min(1, view.w / view.h)) }}>
        <MapBase geo={geo} view={view} />
        {img && <HeatCanvas img={img} geo={geo} view={view} />}
        {/* Zones under the markers layer (which lets clicks through); the popover still floats above. */}
        {onIntel && <IntelLayer geo={geo} view={view} {...(intelBlock ? { block: intelBlock } : {})} onIntel={onIntel} {...(clockLeft !== undefined ? { clockLeft } : {})} />}
        <div className="map-html">
          <Labels geo={geo} view={view} />
          {snap.squad ? (
            <SquadMarkers squad={snap.squad} view={view} {...(snap.youHandle ? { youHandle: snap.youHandle } : {})}
              hostNow={() => snap.at + (receivedAt !== undefined ? (Date.now() - receivedAt) * rate : 0)} />
          ) : spots.map(s => {
            const me = s.player === snap.youHandle;
            return (
              <div key={s.player} className={'mk' + (me ? ' me' : '')} style={pos(view, s.at[0], s.at[1])}
                title={`${me ? 'You' : who(s.player)} · ${s.label} · planned spot`} data-testid={me ? 'marker-you' : 'marker'} data-slot={s.player}>
                <i>{me ? 'YOU' : ''}</i>
                <span>{me ? s.label : `${who(s.player)} · ${s.label}`}</span>
              </div>
            );
          })}
          <IntelPins geo={geo} view={view} intel={intel} {...(now !== undefined ? { now } : {})} roundTime={roundTime} />
        </div>
        {!f && (
          <div className="map-empty bottom"><div className="box" data-testid="map-note">
            <b>{m.mode === 'scrimcomp2v2' ? 'Wingman: one site, no forecast' : !base ? `No forecast for ${geo.name} yet` : 'Forecast arrives at freeze time'}</b>
            {m.mode === 'scrimcomp2v2' ? 'Two players on one site: the map shows intel and your markers.' : !base ? 'The map and intel work; enemy plans for it come in an update.' : m.ourSide === 'T' ? 'It starts from the enemy buy read: where their CTs likely hold.' : 'It starts from the enemy buy read.'}
          </div></div>
        )}
      </div>
      <div className="mapbar">
        <span className="cap"><i className="ramp" />{f?.enemy === 'CT' ? 'estimated defenders, not game data' : 'estimated enemy presence, not game data'}</span>
        {f?.liveT !== undefined && (
          <div className="seg" data-testid="forecast-seg" role="group" aria-label="Forecast time">
            <button type="button" className={ahead === 0 ? 'on' : ''} onClick={() => setAhead(0)}>Now</button>
            <button type="button" className={ahead === 10 ? 'on' : ''} onClick={() => setAhead(10)} title="Where they're likely to be 10 seconds from now">+10 s</button>
          </div>
        )}
        {f && (f.basis === 'intel'
          ? <span className="chip est" data-testid="forecast-basis" data-basis="intel" title="The buy read, updated by the room's intel this round">updated by intel</span>
          : <span className="chip est" data-testid="forecast-basis" data-basis="prior" title="From the enemy buy read only. Click a zone during the round to log intel.">from the buy read</span>)}
      </div>
      {onIntel && !intelBlock && <div className="maphint muted small">Click where you see enemies. Everyone's forecast updates.</div>}
      {onCheckIn && room && <CheckInBar {...(checkInBlock ? { block: checkInBlock } : {})} onCheckIn={onCheckIn} />}
      {snap.squad ? (
        <div className="mapkey"><span><i className="k-plan" />planned</span><span><i className="k-spot" />on spot</span><span><i className="k-rot" />rotating</span><span>✕ dead</span><span className="muted">reported by each player, not game data</span></div>
      ) : spots.length > 0 && (
        <div className="mapkey">{snap.youHandle && <span><i className="k-you" />your planned spot</span>}<span><i className="k-plan" />{snap.youHandle ? "teammates' planned spots (playbook)" : 'planned spots (playbook)'}</span></div>
      )}
    </div>
  );
}
