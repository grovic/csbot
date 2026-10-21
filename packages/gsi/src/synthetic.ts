// Synthetic GSI payload stream for a fictional match, shaped like what a playing CS2 client sends.
// Used by tests, the replayer and the desktop dev mode until real recordings exist.

import type { RoundReason } from './state.ts';
import type { GsiPayload, Side } from './types.ts';
import type { RecordedPayload } from './recording.ts';

export interface SyntheticRound { winner: 'us' | 'them'; reason: RoundReason; planted?: boolean; kills?: number; died?: boolean }

export const FIRST_HALF: readonly SyntheticRound[] = [
  { winner: 'us', reason: 'elimination', kills: 2 }, { winner: 'us', reason: 'elimination', kills: 1 },
  { winner: 'them', reason: 'bomb', planted: true, died: true }, { winner: 'us', reason: 'defuse', planted: true, kills: 1 },
  { winner: 'us', reason: 'elimination', kills: 2 }, { winner: 'them', reason: 'elimination', died: true },
  { winner: 'them', reason: 'bomb', planted: true, died: true }, { winner: 'us', reason: 'time', kills: 1 },
  { winner: 'us', reason: 'elimination', kills: 1 }, { winner: 'them', reason: 'bomb', planted: true, died: true, kills: 1 },
  { winner: 'us', reason: 'defuse', planted: true, kills: 2 }, { winner: 'us', reason: 'elimination', kills: 1 },
];

export interface SyntheticOptions {
  token?: string;
  me?: string;
  name?: string;
  ourSide?: Side;
  map?: string;
  rounds?: readonly SyntheticRound[];
  start?: number;
  /** Seconds between ticks inside a phase (real CS2 sends ~4/s; tests can go coarser). */
  tick?: number;
}

export function syntheticMatch(o: SyntheticOptions = {}): RecordedPayload[] {
  const me = o.me ?? '76561198000000001', ourSide = o.ourSide ?? 'CT', them: Side = ourSide === 'CT' ? 'T' : 'CT';
  const rounds = o.rounds ?? FIRST_HALF, tick = o.tick ?? 2;
  let t = o.start ?? Date.UTC(2026, 9, 21, 20, 0, 0);
  const out: RecordedPayload[] = [];
  const score = { us: 0, them: 0 }, streak = { us: 0, them: 0 };
  const roundWins: Record<string, string> = {};
  const stats = { kills: 0, assists: 0, deaths: 0, mvps: 0 };
  let money = 800;

  const payload = (r: number, roundPhase: string, cd: { phase: string; endsIn: number }, extra: { health?: number; money?: number; bomb?: string; win?: Side } = {}): GsiPayload => {
    const teamOf = (s: Side) => (s === ourSide ? { score: score.us, consecutive_round_losses: streak.us } : { score: score.them, consecutive_round_losses: streak.them });
    return {
      provider: { name: 'Counter-Strike: Global Offensive', appid: 730, version: 14100, steamid: me, timestamp: Math.floor(t / 1000) },
      map: { mode: 'competitive', name: o.map ?? 'de_mirage', phase: 'live', round: r - 1, team_ct: { ...teamOf('CT'), timeouts_remaining: 1 }, team_t: { ...teamOf('T'), timeouts_remaining: 1 }, round_wins: { ...roundWins } },
      round: { phase: roundPhase, ...(extra.bomb ? { bomb: extra.bomb } : {}), ...(extra.win ? { win_team: extra.win } : {}) },
      player: { steamid: me, name: o.name ?? 'rdx', team: ourSide, activity: 'playing',
        state: { health: extra.health ?? 100, armor: 100, helmet: true, flashed: 0, smoked: 0, burning: 0, money: extra.money ?? money, round_kills: 0, round_killhs: 0, round_totaldmg: 0, equip_value: 4600 },
        match_stats: { ...stats, score: stats.kills * 2 + stats.assists } },
      phase_countdowns: { phase: cd.phase, phase_ends_in: cd.endsIn.toFixed(1) },
      auth: { token: o.token ?? 'csbot-dev' },
    };
  };
  const push = (p: GsiPayload, dt: number) => { out.push({ t, p }); t += dt * 1000; };

  rounds.forEach((rd, i) => {
    const r = i + 1;
    for (let s = 20; s > 0; s -= tick) push(payload(r, 'freezetime', { phase: 'freezetime', endsIn: s }, { money: s <= 16 ? Math.max(0, money - 4200) : money }), tick);
    const afterBuy = Math.max(0, money - 4200);
    const liveFor = rd.planted ? 44 : rd.reason === 'time' ? 115 : 38;
    for (let s = 0; s < liveFor; s += tick * 4) push(payload(r, 'live', { phase: 'live', endsIn: 115 - s }, { money: afterBuy, health: rd.died && s > liveFor / 2 ? 0 : 100 }), tick * 4);
    if (rd.planted) for (let s = 40; s > 20; s -= tick * 4) push(payload(r, 'live', { phase: 'bomb', endsIn: s }, { money: afterBuy, bomb: 'planted', health: rd.died ? 0 : 100 }), tick * 4);
    const usWon = rd.winner === 'us';
    const winSide: Side = usWon ? ourSide : them;
    roundWins[String(r)] = `${winSide.toLowerCase()}_win_${rd.reason}`;
    if (usWon) { score.us++; streak.us = Math.max(0, streak.us - 1); streak.them = Math.min(5, streak.them + 1); }
    else { score.them++; streak.them = Math.max(0, streak.them - 1); streak.us = Math.min(5, streak.us + 1); }
    stats.kills += rd.kills ?? 0; if (rd.died) stats.deaths++; if (usWon && (rd.kills ?? 0) >= 2) stats.mvps++;
    money = Math.min(16000, afterBuy + (usWon ? (rd.reason === 'defuse' ? 3500 : 3250) : 1400 + 500 * Math.max(0, streak.us - 1)) + (rd.kills ?? 0) * 300);
    const bomb = rd.planted ? (usWon ? 'defused' : 'exploded') : undefined;
    for (let s = 7; s > 0; s -= tick * 2) push(payload(r, 'over', { phase: 'over', endsIn: s }, { money, bomb, win: winSide, health: rd.died ? 0 : 100 }), tick * 2);
  });
  return out;
}
