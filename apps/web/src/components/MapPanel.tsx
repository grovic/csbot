import { heatGrid, MIRAGE, slotsFor } from '@csbot/engine';
import type { IntelView, LiveSnapshot, RoomView } from '@csbot/protocol';
import { useEffect, useMemo, useRef, useState } from 'react';
import { clockStr, mapName } from '../format.ts';

const G = 160;
const HIDE_LABEL = new Set(['kitchen', 'ticket', 'tramp', 'tapps']);
const LABEL_POS: Record<string, readonly [number, number]> = {
  mid: [600, 442], under: [505, 290], ctspawn: [180, 625], asite: [460, 830], bsite: [330, 108], market: [215, 455], window: [342, 480], short: [320, 345],
};
const center = (r: readonly number[]) => [r[0]! + r[2]! / 2, r[1]! + r[3]! / 2] as const;
const zoneName = (id: string) => { const z = MIRAGE.zones.find(x => x.id === id); return z?.name || id; };
/** Zones you can log intel on, biggest first so smaller zones sit on top and win the click. */
const CLICK_ZONES = [...MIRAGE.zones].sort((a, b) => b.rect[2] * b.rect[3] - a.rect[2] * a.rect[3]);
/** Intel pins fade over this many seconds (they stay visible, dimmed, for the rest of the round). */
const FADE_S = 25;

function MapBase() {
  return (
    <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden>
      <g>{MIRAGE.zones.map(z => <rect key={'o' + z.id} x={z.rect[0]} y={z.rect[1]} width={z.rect[2]} height={z.rect[3]} rx={8} fill="#363d4a" stroke="#363d4a" strokeWidth={10} />)}</g>
      <g>{MIRAGE.zones.map(z => <rect key={'f' + z.id} x={z.rect[0]} y={z.rect[1]} width={z.rect[2]} height={z.rect[3]} rx={8} fill={z.site ? '#252b35' : '#20252d'} />)}</g>
      <rect x={395} y={690} width={130} height={110} rx={10} fill="#2b323d" />
      <rect x={150} y={125} width={150} height={110} rx={10} fill="#2b323d" />
      <rect x={855} y={372} width={6} height={40} rx={3} fill="#c98500" />
      <rect x={100} y={572} width={6} height={40} rx={3} fill="#3987e5" />
    </svg>
  );
}

function Labels() {
  return (
    <>
      {MIRAGE.zones.filter(z => z.name && !HIDE_LABEL.has(z.id)).map(z => {
        const c = LABEL_POS[z.id] ?? center(z.rect);
        return <div key={z.id} className={'zlabel' + (z.site ? ' site' : '')} style={{ left: c[0] / 10 + '%', top: c[1] / 10 + '%' }}>{z.name}</div>;
      })}
    </>
  );
}

/** Heat image (G×G RGBA) from the plan forecast. Same color ramp as the prototype. */
function useHeatImage(plans: Record<string, number> | undefined, t: number): ImageData | undefined {
  const key = plans ? Object.entries(plans).map(([k, v]) => k + v.toFixed(3)).join() + '|' + Math.round(t) : '';
  return useMemo(() => {
    if (!plans) return undefined;
    const heat = heatGrid(MIRAGE, plans, Math.round(t), { size: G });
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

function HeatCanvas({ img }: { img: ImageData }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const small = useMemo(() => { const c = document.createElement('canvas'); c.width = c.height = G; return c; }, []);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const paint = () => {
      const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      small.getContext('2d')!.putImageData(img, 0, 0);
      const ctx = cv.getContext('2d')!;
      ctx.clearRect(0, 0, w, h);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(small, 0, 0, w, h);
      // Clip the blur to walkable zones.
      ctx.globalCompositeOperation = 'destination-in';
      ctx.fillStyle = '#000';
      const sx = w / 1000, sy = h / 1000;
      ctx.beginPath();
      for (const z of MIRAGE.zones) {
        const [x, y, zw, zh] = z.rect;
        if (ctx.roundRect) ctx.roundRect(x * sx, y * sy, zw * sx, zh * sy, 8 * sx); else ctx.rect(x * sx, y * sy, zw * sx, zh * sy);
      }
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    };
    paint();
    const ro = new ResizeObserver(paint);
    ro.observe(cv);
    return () => ro.disconnect();
  }, [img, small]);
  return <canvas ref={ref} data-testid="heat" aria-hidden />;
}

/** Who plays each slot: the room member assigned to it, else the slot's label. */
function slotNamer(room?: RoomView, map?: string) {
  const byslot = new Map((room?.members ?? []).filter(m => m.slot).map(m => [m.slot!, m.name]));
  // Without a room (solo), the playbook's own position names.
  const label = new Map((room?.slots ?? slotsFor(map)).map(s => [s.id, s.label]));
  return (slot: string) => byslot.get(slot) ?? label.get(slot) ?? slot;
}

const initials = (names: string[]) => names.map(n => n.trim().slice(0, 2).toUpperCase()).join('+');

/** Seconds since the round went live, at the snapshot (the forecast carries it; else the round clock). */
function liveSeconds(snap: LiveSnapshot): number | undefined {
  if (snap.forecast?.liveT !== undefined) return snap.forecast.liveT;
  const c = snap.match?.clock;
  return c?.phase === 'live' && c.endsIn !== undefined ? Math.max(0, MIRAGE.roundTime - c.endsIn) : undefined;
}

/** Pins at each zone with intel this round: count (✓ clear), who saw it, dimmed with age. */
function IntelPins({ intel, now }: { intel: IntelView[]; now?: number }) {
  return (
    <>
      {intel.map((it, i) => {
        const z = MIRAGE.zones.find(x => x.id === it.zone);
        if (!z) return null;
        const c = center(z.rect);
        // Alternate above/below the zone centre so neighbouring pins don't sit on the labels.
        const dy = i % 2 ? 34 : -36;
        const age = now === undefined ? 0 : Math.max(0, now - it.t);
        const opacity = Math.max(0.4, 1 - (age / FADE_S) * 0.6);
        const what = it.count ? `${it.count} at ${it.zoneName}` : `${it.zoneName} clear`;
        return (
          <div key={it.zone + it.t} className={'ipin' + (it.count ? '' : ' clear')} style={{ left: c[0] / 10 + '%', top: (c[1] + dy) / 10 + '%', opacity }}
            title={`${it.by.join(' + ')}: ${what} · ${clockStr(MIRAGE.roundTime - it.t)}`} data-testid="intel-pin" data-zone={it.zone} data-count={it.count}>
            <b>{it.count ? it.count : '✓'}</b><span>{initials(it.by)}</span>
          </div>
        );
      })}
    </>
  );
}

interface Pop { zone: string; x: number; y: number }

/**
 * Click a zone during a live round: how many enemies (or clear), shared with the room.
 * `block` is why intel can't be logged right now (the click then shows it instead of the choices).
 */
function IntelLayer({ block, onIntel, clockLeft }: { block?: string; onIntel: (zone: string, count: number) => Promise<string | undefined>; clockLeft?: number }) {
  const [pop, setPop] = useState<Pop>();
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const errTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

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
    const onDown = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.intel-pop, .zhit')) setPop(undefined); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onDown); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pop, busy]);

  const click = (zone: string, ev: React.MouseEvent) => {
    if (block) { setPop(undefined); showErr(block); return; }
    const r = wrap.current!.getBoundingClientRect();
    setErr(undefined);
    setPop({ zone, x: ev.clientX - r.left, y: ev.clientY - r.top });
  };

  const w = wrap.current?.getBoundingClientRect();
  const left = pop && w ? Math.max(4, Math.min(pop.x + 8, w.width - 236)) : 0;
  const top = pop && w ? Math.max(4, Math.min(pop.y + 8, w.height - 96)) : 0;
  return (
    <div className="zlayer" ref={wrap}>
      {CLICK_ZONES.map(z => (
        <button key={z.id} type="button" className={'zhit' + (pop?.zone === z.id ? ' on' : '') + (block ? ' blocked' : '')}
          style={{ left: z.rect[0] / 10 + '%', top: z.rect[1] / 10 + '%', width: z.rect[2] / 10 + '%', height: z.rect[3] / 10 + '%' }}
          onClick={e => click(z.id, e)} data-testid="map-zone" data-zone={z.id}
          aria-label={`${z.name || z.id}: log intel`} title={z.name || undefined}>
          {z.name && <span className="zname">{z.name}</span>}
        </button>
      ))}
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

export function MapPanel({ snap, room, intelBlock, onIntel }: {
  snap: LiveSnapshot;
  room?: RoomView;
  /** Why intel can't be logged right now (undefined = it can). */
  intelBlock?: string;
  onIntel?: (zone: string, count: number) => Promise<string | undefined>;
}) {
  const m = snap.match;
  const f = snap.forecast && snap.forecast.map === MIRAGE.id ? snap.forecast : undefined;
  const [ahead, setAhead] = useState(0);
  const now = liveSeconds(snap);
  const img = useHeatImage(f?.plans, (f?.liveT ?? 0) + (f?.liveT !== undefined ? ahead : 0));
  const isMirage = m?.map === MIRAGE.id;

  if (!m || !isMirage) {
    return (
      <div className="mapcol" data-testid="map">
        <div className="map">
          <div className="map-empty"><div className="box">
            <b>{m ? `No map model for ${mapName(m.map)} yet` : 'No map yet'}</b>
            {m ? 'Map models (zones, routes, plan priors) are built from demos in M4. Mirage has a schematic model today.' : 'The map appears when the match starts.'}
          </div></div>
        </div>
      </div>
    );
  }

  const spots = snap.setupSpots ?? [];
  const who = slotNamer(room, snap.match?.map);
  const intel = snap.intel ?? [];
  const clockLeft = m.clock.phase === 'live' && m.clock.endsIn !== undefined ? m.clock.endsIn : undefined;
  return (
    <div className="mapcol" data-testid="map">
      <div className={'map' + (onIntel && !intelBlock ? ' can-intel' : '')}>
        <MapBase />
        {img && <HeatCanvas img={img} />}
        {/* Zones under the markers layer (which lets clicks through); the popover still floats above. */}
        {onIntel && <IntelLayer {...(intelBlock ? { block: intelBlock } : {})} onIntel={onIntel} {...(clockLeft !== undefined ? { clockLeft } : {})} />}
        <div className="map-html">
          <Labels />
          {spots.map(s => {
            const me = s.player === snap.youHandle;
            return (
              <div key={s.player} className={'mk' + (me ? ' me' : '')} style={{ left: s.at[0] / 10 + '%', top: s.at[1] / 10 + '%' }}
                title={`${me ? 'You' : who(s.player)} · ${s.label} · planned spot`} data-testid={me ? 'marker-you' : 'marker'} data-slot={s.player}>
                <i>{me ? 'YOU' : ''}</i>
                <span>{me ? s.label : `${who(s.player)} · ${s.label}`}</span>
              </div>
            );
          })}
          <IntelPins intel={intel} {...(now !== undefined ? { now } : {})} />
        </div>
        {!f && (
          <div className="map-empty bottom"><div className="box" data-testid="map-note">
            <b>{m.ourSide === 'T' ? 'Forecast covers Mirage CT side for now' : 'Forecast arrives at freeze time'}</b>
            {m.ourSide === 'T' ? 'Enemy CT setups get modeled from demos in M4.' : 'It starts from the enemy buy read.'}
          </div></div>
        )}
      </div>
      <div className="mapbar">
        <span className="cap"><i className="ramp" />estimated enemy presence, not game data</span>
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
      {onIntel && !intelBlock && <div className="maphint muted small">Click a zone to log what you see. Everyone's forecast updates.</div>}
      {spots.length > 0 && (
        <div className="mapkey">{snap.youHandle && <span><i className="k-you" />your planned spot</span>}<span><i className="k-plan" />{snap.youHandle ? "teammates' planned spots (playbook)" : 'planned spots (playbook)'}</span></div>
      )}
    </div>
  );
}
