import type { LiveSnapshot } from '@csbot/protocol';

export function Ticker({ snap }: { snap: LiveSnapshot }) {
  const t = snap.ticker[0];
  return (
    <div className="ticker" data-testid="ticker">
      <span className="tg">{t ? t.tag : 'LATEST'}</span>
      <span className="tx">{t ? t.text : 'Nothing yet'}</span>
    </div>
  );
}
