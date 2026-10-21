// Synthetic GSI payload stream for a fictional match, shaped like what a playing CS2 client sends.
// Used by tests, the replayer, the desktop dev mode and the web demo until real recordings exist.
// All names and Steam IDs are fictional.

import type { RoundReason } from './state.ts';
import type { GsiPayload, GsiPlayer, Side } from './types.ts';
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

/** Second half (we play the other side). With FIRST_HALF the match ends 13–8. */
export const SECOND_HALF: readonly SyntheticRound[] = [
  { winner: 'them', reason: 'elimination', died: true }, { winner: 'them', reason: 'elimination', kills: 1, died: true },
  { winner: 'us', reason: 'bomb', planted: true, kills: 2 }, { winner: 'us', reason: 'elimination', kills: 1 },
  { winner: 'them', reason: 'defuse', planted: true, died: true }, { winner: 'us', reason: 'bomb', planted: true, kills: 1 },
  { winner: 'them', reason: 'time', died: true }, { winner: 'us', reason: 'elimination', kills: 3 },
  { winner: 'us', reason: 'elimination', kills: 1 },
];

export const FULL_MATCH: readonly SyntheticRound[] = [...FIRST_HALF, ...SECOND_HALF];

/** Fictional teammates the client follows after dying (in competitive you can only watch your own team). */
export const SYNTHETIC_MATES: readonly { steamid: string; name: string }[] = [
  { steamid: '76561198000000002', name: 'kairo' },
  { steamid: '76561198000000003', name: 'nyx' },
  { steamid: '76561198000000004', name: 'mbt' },
  { steamid: '76561198000000005', name: 'zeph' },
];

export interface SyntheticOptions {
  token?: string;
  me?: string;
  name?: string;
  /** Our side in the first half. */
  ourSide?: Side;
  map?: string;
  rounds?: readonly SyntheticRound[];
  start?: number;
  /** Seconds between ticks inside a phase (real CS2 sends ~4/s; tests can go coarser). */
  tick?: number;
  /**
   * Leave out map.round_wins and phase_countdowns, which a playing client may not receive
   * (csbot's cfg doesn't request them). The tracker must work from transitions alone.
   */
  lean?: boolean;
  /** Rounds per half (12 in competitive). */
  halfLength?: number;
}

const other = (s: Side): Side => (s === 'CT' ? 'T' : 'CT');

export function syntheticMatch(o: SyntheticOptions = {}): RecordedPayload[] {
  const me = o.me ?? '76561198000000001', firstSide = o.ourSide ?? 'CT', half = o.halfLength ?? 12;
  const rounds = o.rounds ?? FIRST_HALF, tick = o.tick ?? 2;
  let t = o.start ?? Date.UTC(2026, 9, 21, 20, 0, 0);
  const out: RecordedPayload[] = [];
  const score = { us: 0, them: 0 }, streak = { us: 0, them: 0 };
  const roundWins: Record<string, string> = {};
  const stats = { kills: 0, assists: 0, deaths: 0, mvps: 0 };
  const mateStats = SYNTHETIC_MATES.map(() => ({ kills: 0, assists: 0, deaths: 0, mvps: 0, money: 800 }));
  let money = 800, rifle = false, ourSide = firstSide, dmg = 0;

  interface Extra { health?: number; money?: number; bomb?: string; win?: Side; observe?: number; roundKills?: number; mapPhase?: string }
  const payload = (r: number, roundPhase: string, cd: { phase: string; endsIn: number }, x: Extra = {}): GsiPayload => {
    const them = other(ourSide);
    const teamOf = (s: Side) => (s === ourSide ? { score: score.us, consecutive_round_losses: streak.us } : { score: score.them, consecutive_round_losses: streak.them });
    const weapons: GsiPlayer['weapons'] = {
      weapon_0: { name: 'weapon_knife', type: 'Knife', state: 'holstered' },
      weapon_1: { name: ourSide === 'CT' ? 'weapon_usp_silencer' : 'weapon_glock', type: 'Pistol', state: rifle ? 'holstered' : 'active' },
      ...(rifle ? { weapon_2: { name: ourSide === 'CT' ? 'weapon_m4a1' : 'weapon_ak47', type: 'Rifle', state: 'active' } } : {}),
    };
    let player: GsiPlayer;
    if (x.observe !== undefined) {
      const mate = SYNTHETIC_MATES[x.observe % SYNTHETIC_MATES.length]!, ms = mateStats[x.observe % SYNTHETIC_MATES.length]!;
      player = { steamid: mate.steamid, name: mate.name, team: ourSide, activity: 'playing', observer_slot: (x.observe % 4) + 2,
        state: { health: 64, armor: 80, helmet: true, flashed: 0, smoked: 0, burning: 0, money: ms.money, round_kills: 1, round_killhs: 0, round_totaldmg: 112, equip_value: 5100 },
        match_stats: { kills: ms.kills, assists: ms.assists, deaths: ms.deaths, mvps: ms.mvps, score: ms.kills * 2 + ms.assists } };
    } else {
      player = { steamid: me, name: o.name ?? 'rdx', team: ourSide, activity: 'playing', observer_slot: 1, weapons,
        state: { health: x.health ?? 100, armor: 100, helmet: true, flashed: 0, smoked: 0, burning: 0, money: x.money ?? money,
          round_kills: x.roundKills ?? 0, round_killhs: 0, round_totaldmg: dmg, equip_value: rifle ? 5000 : 1000 },
        match_stats: { ...stats, score: stats.kills * 2 + stats.assists } };
    }
    return {
      provider: { name: 'Counter-Strike: Global Offensive', appid: 730, version: 14100, steamid: me, timestamp: Math.floor(t / 1000) },
      map: { mode: 'competitive', name: o.map ?? 'de_mirage', phase: x.mapPhase ?? 'live', round: r - 1,
        team_ct: { ...teamOf('CT'), timeouts_remaining: 1 }, team_t: { ...teamOf('T'), timeouts_remaining: 1 },
        ...(o.lean ? {} : { round_wins: { ...roundWins } }) },
      round: { phase: roundPhase, ...(x.bomb ? { bomb: x.bomb } : {}), ...(x.win ? { win_team: x.win } : {}) },
      player,
      ...(o.lean ? {} : { phase_countdowns: { phase: cd.phase, phase_ends_in: cd.endsIn.toFixed(1) } }),
      auth: { token: o.token ?? 'csbot-dev' },
    };
  };
  const push = (p: GsiPayload, dt: number) => { out.push({ t, p }); t += dt * 1000; };

  rounds.forEach((rd, i) => {
    const r = i + 1;
    if (i > 0 && i % half === 0) {
      // Halftime: sides swap, money and loss bonus reset.
      ourSide = other(ourSide); money = 800; rifle = false; streak.us = 0; streak.them = 0;
      for (const ms of mateStats) ms.money = 800;
    }
    const startMoney = money;
    // Spend like a player: pistol kit, refill a kept rifle, full buy, or save.
    const kept = rifle;
    const spend = i % half === 0 ? 650 : kept ? Math.min(startMoney, 1100) : startMoney >= 4400 ? 4100 : startMoney >= 3100 ? 3000 : 300;
    const buysRifle = !kept && startMoney >= 3100 && i % half !== 0;
    const afterBuy = Math.max(0, startMoney - spend);
    for (let s = 20; s > 0; s -= tick) {
      const bought = s <= 16;
      if (bought && buysRifle) rifle = true;
      push(payload(r, 'freezetime', { phase: 'freezetime', endsIn: s }, { money: bought ? afterBuy : startMoney }), tick);
    }
    dmg = 0;
    const liveFor = rd.planted ? 44 : rd.reason === 'time' ? 115 : 38;
    const mate = i % SYNTHETIC_MATES.length;
    let dead = false;
    for (let s = 0; s < liveFor; s += tick * 4) {
      const dies = !!rd.died && s > liveFor / 2;
      if (!dead && s > liveFor / 3) dmg = 40 + 30 * (rd.kills ?? 0);
      const kills = s > liveFor / 3 ? (rd.kills ?? 0) : 0;
      if (dies && !dead) { dead = true; push(payload(r, 'live', { phase: 'live', endsIn: 115 - s }, { money: afterBuy, health: 0, roundKills: kills }), tick); continue; }
      push(payload(r, 'live', { phase: 'live', endsIn: 115 - s }, dead ? { observe: mate } : { money: afterBuy, roundKills: kills }), tick * 4);
    }
    if (rd.planted) {
      for (let s = 40; s > 20; s -= tick * 4) push(payload(r, 'live', { phase: 'bomb', endsIn: s }, dead ? { observe: mate, bomb: 'planted' } : { money: afterBuy, bomb: 'planted', roundKills: rd.kills ?? 0 }), tick * 4);
    }
    const usWon = rd.winner === 'us';
    const winSide: Side = usWon ? ourSide : other(ourSide);
    roundWins[String(r)] = `${winSide.toLowerCase()}_win_${rd.reason}`;
    if (usWon) { score.us++; streak.us = Math.max(0, streak.us - 1); streak.them = Math.min(5, streak.them + 1); }
    else { score.them++; streak.them = Math.max(0, streak.them - 1); streak.us = Math.min(5, streak.us + 1); }
    stats.kills += rd.kills ?? 0; if (rd.died) { stats.deaths++; rifle = false; } if (usWon && (rd.kills ?? 0) >= 2) stats.mvps++;
    mateStats.forEach((ms, k) => {
      ms.kills += (r + k) % 3 === 0 ? 2 : (r + k) % 2; ms.deaths += usWon ? (r + k) % 4 === 0 ? 1 : 0 : 1; ms.assists += (r * (k + 1)) % 5 === 0 ? 1 : 0;
      ms.money = Math.min(16000, Math.max(0, ms.money - 3800) + (usWon ? 3250 : 1900) + 300 * ((r + k) % 2));
    });
    money = Math.min(16000, afterBuy + (usWon ? (rd.reason === 'defuse' || rd.reason === 'bomb' ? 3500 : 3250) : 1400 + 500 * Math.max(0, streak.us - 1)) + (rd.kills ?? 0) * 300);
    const bomb = rd.planted ? (rd.reason === 'defuse' ? 'defused' : rd.reason === 'bomb' ? 'exploded' : 'planted') : undefined;
    const last = i === rounds.length - 1;
    for (let s = 7; s > 0; s -= tick * 2) {
      push(payload(r, 'over', { phase: 'over', endsIn: s }, dead ? { observe: mate, bomb, win: winSide } : { money, bomb, win: winSide, roundKills: rd.kills ?? 0 }), tick * 2);
    }
    if (last) push(payload(r + 1, 'over', { phase: 'over', endsIn: 0 }, { money, win: winSide, mapPhase: 'gameover' }), tick);
  });
  return out;
}
