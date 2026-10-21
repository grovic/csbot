import type { BuyRead, Phase } from '@csbot/protocol';

export const fmt$ = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
/** $1,450 → $1.4k; under $1k stays exact. */
export const fmtK = (n: number) => (n >= 1000 ? '$' + (Math.floor(n / 100) / 10).toFixed(1).replace(/\.0$/, '') + 'k' : '$' + Math.round(n));
export const pct = (p: number) => Math.round(p * 100) + '%';

export function clockStr(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

const MAP_NAMES: Record<string, string> = {
  de_mirage: 'Mirage', de_inferno: 'Inferno', de_nuke: 'Nuke', de_ancient: 'Ancient', de_anubis: 'Anubis',
  de_dust2: 'Dust II', de_cache: 'Cache', de_train: 'Train', de_vertigo: 'Vertigo', de_overpass: 'Overpass', cs_office: 'Office', cs_italy: 'Italy',
};
export function mapName(id?: string): string {
  if (!id) return 'Unknown map';
  return MAP_NAMES[id] ?? id.replace(/^(de|cs|ar|gd)_/, '').replace(/^\w/, c => c.toUpperCase());
}

const MODE_NAMES: Record<string, string> = { competitive: 'Competitive', scrimcomp2v2: 'Wingman', casual: 'Casual', deathmatch: 'Deathmatch', premier: 'Premier' };
export const modeName = (m?: string) => (m ? MODE_NAMES[m] ?? m.replace(/^\w/, c => c.toUpperCase()) : '');

export const READ_BIG: Record<BuyRead, string> = { eco: 'ECO', force: 'FORCE', half: 'HALF', full: 'FULL', pistol: 'PISTOL' };

export const PHASE_UI: Record<Phase, { cls: string; label: string; hint: string }> = {
  idle: { cls: 'neutral', label: 'WAITING', hint: 'Waiting for the next round' },
  warmup: { cls: 'neutral', label: 'WARMUP', hint: 'The match starts after warmup' },
  freezetime: { cls: 'freezetime', label: 'FREEZE TIME', hint: 'Buy, then take your spot' },
  live: { cls: 'live', label: 'ROUND LIVE', hint: 'Play your spot · the call updates here' },
  bomb: { cls: 'bomb', label: 'BOMB PLANTED', hint: 'Bomb timer' },
  over: { cls: 'over', label: 'ROUND OVER', hint: 'Next round in' },
  halftime: { cls: 'neutral', label: 'HALFTIME', hint: 'Sides swap · enemy money resets' },
  gameover: { cls: 'neutral', label: 'MATCH OVER', hint: 'The debrief is ready' },
  paused: { cls: 'neutral', label: 'PAUSED', hint: 'Match paused' },
};
