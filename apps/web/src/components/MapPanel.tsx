import { heatGrid, MIRAGE } from '@csbot/engine';
import type { LiveSnapshot } from '@csbot/protocol';
import { useEffect, useMemo, useRef } from 'react';
import { mapName } from '../format.ts';

const G = 160;
const HIDE_LABEL = new Set(['kitchen', 'ticket', 'tramp', 'tapps']);
const LABEL_POS: Record<string, readonly [number, number]> = {
  mid: [600, 442], under: [505, 290], ctspawn: [180, 625], asite: [460, 830], bsite: [330, 108], market: [215, 455], window: [342, 480], short: [320, 345],
};
const center = (r: readonly number[]) => [r[0]! + r[2]! / 2, r[1]! + r[3]! / 2] as const;

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

export function MapPanel({ snap }: { snap: LiveSnapshot }) {
  const m = snap.match;
  const f = snap.forecast && snap.forecast.map === MIRAGE.id ? snap.forecast : undefined;
  const img = useHeatImage(f?.plans, f?.liveT ?? 0);
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
  return (
    <div className="mapcol" data-testid="map">
      <div className="map">
        <MapBase />
        {img && <HeatCanvas img={img} />}
        <div className="map-html">
          <Labels />
          {spots.map(s => {
            const me = s.player === snap.youHandle;
            return (
              <div key={s.player} className={'mk' + (me ? ' me' : '')} style={{ left: s.at[0] / 10 + '%', top: s.at[1] / 10 + '%' }}
                title={`${me ? 'You' : s.player} · ${s.label} · planned spot`} data-testid={me ? 'marker-you' : undefined}>
                <i>{me ? 'YOU' : ''}</i>
                <span>{me ? s.label : `${s.player} · ${s.label}`}</span>
              </div>
            );
          })}
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
        {f && <span className="chip est" title="From the enemy buy read only. Intel from the room updates it in M4.">from the buy read</span>}
      </div>
      {spots.length > 0 && (
        <div className="mapkey">{snap.youHandle && <span><i className="k-you" />your planned spot</span>}<span><i className="k-plan" />{snap.youHandle ? "teammates' planned spots (playbook)" : 'planned spots (playbook)'}</span></div>
      )}
    </div>
  );
}
