// Small pieces shared by the Scout page, the Live enemy panel and Settings.

import type { DataSourceState, ScoutPlayer, ScoutView } from '@csbot/protocol';

export const initials = (n: string) => n.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?';

export function Avatar({ name }: { name: string }) {
  return <span className="avatar" aria-hidden="true">{initials(name)}</span>;
}

/** "likely AWP" when guessed from stats, "AWP" from demos. */
export function roleText(p: ScoutPlayer): string | undefined {
  if (!p.role) return undefined;
  if (p.role.source === 'stats') return `likely ${p.role.label}`;
  if (p.role.source === 'ai') return `${p.role.label} (AI guess)`;
  return p.role.label;
}

export function ThreatBar({ p, label = true }: { p: ScoutPlayer; label?: boolean }) {
  const t = p.threat;
  if (!t) return null;
  const tip = 'Threat ' + t.score + ' = ' + t.parts.map(x => `${x.label} ${Math.round(x.value * 100)} × ${Math.round(x.weight * 100)}%`).join(' + ');
  return (
    <div className="thr2" title={tip} data-testid="threat">
      {label && <span className="muted small">threat</span>}
      <div className="trk"><i style={{ width: `${t.score}%` }} /></div>
      <span className="num">{t.score}</span>
    </div>
  );
}

export function Form({ recent }: { recent?: ('W' | 'L')[] }) {
  if (!recent?.length) return null;
  return (
    <span className="form" title="Last matches, most recent first">
      {recent.map((r, i) => <i key={i} className={r === 'W' ? 'w' : 'l'}>{r}</i>)}
    </span>
  );
}

export function PartyBadge({ party }: { party?: string }) {
  if (!party) return null;
  return <span className={'party p' + party} title={`Premade ${party}: queues with the other ${party} players`}>{party}</span>;
}

const SRC_TEXT: Record<DataSourceState, string> = { live: 'live', sample: 'sample', 'missing-key': 'no key', error: 'error', off: 'off' };

export function SourceChips({ scout }: { scout: ScoutView }) {
  const s = scout.sources;
  const cls = (st: DataSourceState) => (st === 'live' ? 'ok' : st === 'sample' ? 'sample' : st === 'error' || st === 'missing-key' ? 'warn' : 'off');
  const claude = s.claude === 'off' ? 'not on the host' : s.claude === 'error' ? 'error' : "the host's Claude Code";
  return (
    <span className="srcchips">
      <span className={'srcchip ' + cls(s.faceit)} data-state={s.faceit}><i />FACEIT · {SRC_TEXT[s.faceit]}</span>
      <span className={'srcchip ' + cls(s.steam)} data-state={s.steam}><i />Steam · {SRC_TEXT[s.steam]}</span>
      <span className={'srcchip ' + cls(s.claude)} data-state={s.claude}><i />AI · {claude}</span>
    </span>
  );
}

export const elo = (n?: number) => (n === undefined ? '–' : n.toLocaleString('en-US'));
export const kd = (n?: number) => (n === undefined ? '–' : n.toFixed(2));
