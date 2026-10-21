import { describe, expect, it } from 'vitest';
import { diffStates, type GsiEvent } from './events.ts';
import { spectatorGuard } from './guard.ts';
import { anonymize, readRecording, toLine } from './recording.ts';
import { startGsiServer } from './server.ts';
import { parseRoundWin, toGameState } from './state.ts';
import { FIRST_HALF, syntheticMatch } from './synthetic.ts';
import type { GsiPayload } from './types.ts';

const ME = '76561198000000001', MATE = '76561198000000002';

describe('normalized state', () => {
  it('parses round wins, the round number and countdowns', () => {
    const s = toGameState({ map: { name: 'de_mirage', round: 8, round_wins: { '1': 'ct_win_elimination', '8': 't_win_bomb', '9': 'garbage' } }, phase_countdowns: { phase: 'live', phase_ends_in: '97.4' } });
    expect(s.round).toBe(9);
    expect(s.roundWins[1]).toEqual({ winner: 'CT', reason: 'elimination' });
    expect(s.roundWins[8]).toEqual({ winner: 'T', reason: 'bomb' });
    expect(s.roundWins[9]).toBeUndefined();
    expect(s.countdown).toEqual({ phase: 'live', endsIn: 97.4 });
  });

  it('knows when GSI follows a teammate (we are dead and watching)', () => {
    const s = toGameState({ provider: { steamid: ME }, player: { steamid: MATE, team: 'CT', state: { health: 64 }, position: '-300.5, 120, 64' } });
    expect(s.player?.observing).toBe(true);
    expect(s.player?.alive).toBe(true);
    expect(s.player?.position).toEqual([-300.5, 120, 64]);
  });

  it('rejects malformed round-win codes', () => {
    expect(parseRoundWin('ct_win_surrender')).toBeUndefined();
  });
});

describe('spectator guard', () => {
  const base: GsiPayload = { provider: { steamid: ME }, allplayers: { a: 1 }, allgrenades: {}, bomb: { position: '1,2,3' }, previously: {} };

  it('drops spectator-only components from every payload', () => {
    const { payload, dropped } = spectatorGuard(base, { ourSide: 'CT' });
    expect(payload.allplayers).toBeUndefined();
    expect(payload.allgrenades).toBeUndefined();
    expect(payload.bomb).toBeUndefined();
    expect(payload.previously).toBeUndefined();
    expect(dropped).toEqual(['allplayers', 'allgrenades', 'bomb']);
  });

  it('keeps a teammate position and drops an enemy position', () => {
    const mate = spectatorGuard({ ...base, player: { steamid: MATE, team: 'CT', position: '1, 2, 3' } }, { ourSide: 'CT' });
    expect(mate.payload.player?.position).toBe('1, 2, 3');
    const enemy = spectatorGuard({ ...base, player: { steamid: MATE, team: 'T', position: '1, 2, 3', forward: '0, 1, 0' } }, { ourSide: 'CT' });
    expect(enemy.payload.player?.position).toBeUndefined();
    expect(enemy.payload.player?.forward).toBeUndefined();
    expect(enemy.dropped).toContain('player.position');
  });

  it('drops positions while our side is unknown', () => {
    const r = spectatorGuard({ player: { steamid: MATE, team: 'CT', position: '1, 2, 3' } }, {});
    expect(r.payload.player?.position).toBeUndefined();
  });

  it('does not mutate the input', () => {
    const p: GsiPayload = { allplayers: {}, player: { team: 'T', position: '1,2,3' } };
    spectatorGuard(p, { ourSide: 'CT' });
    expect(p.allplayers).toBeDefined();
    expect(p.player?.position).toBe('1,2,3');
  });
});

describe('events over a synthetic half', () => {
  const rec = syntheticMatch({ tick: 2 });
  const events: GsiEvent[] = [];
  let prev;
  for (const { t, p } of rec) { const s = toGameState(p, t); events.push(...diffStates(prev, s)); prev = s; }
  const of = <T extends GsiEvent['type']>(type: T) => events.filter((e): e is Extract<GsiEvent, { type: T }> => e.type === type);

  it('emits one round end per round with the right winner and reason', () => {
    const ends = of('roundEnd');
    expect(ends).toHaveLength(FIRST_HALF.length);
    ends.forEach((e, i) => {
      expect(e.round).toBe(i + 1);
      expect(e.winner).toBe(FIRST_HALF[i]!.winner === 'us' ? 'CT' : 'T');
      expect(e.reason).toBe(FIRST_HALF[i]!.reason);
    });
  });

  it('emits freeze time and live for every round, in order', () => {
    expect(of('freezeStart').map(e => e.round)).toEqual(FIRST_HALF.map((_, i) => i + 1));
    expect(of('roundLive').map(e => e.round)).toEqual(FIRST_HALF.map((_, i) => i + 1));
  });

  it('emits bomb events and deaths', () => {
    const planted = FIRST_HALF.filter(r => r.planted).length;
    expect(of('bomb').filter(e => e.state === 'planted')).toHaveLength(planted);
    expect(of('died')).toHaveLength(FIRST_HALF.filter(r => r.died).length);
  });

  it('emits money changes when we buy and when we get paid', () => {
    expect(of('money').length).toBeGreaterThanOrEqual(FIRST_HALF.length * 2);
  });

  it('starts with the map event', () => {
    expect(events[0]).toEqual({ type: 'map', name: 'de_mirage', mode: 'competitive' });
  });
});

describe('recordings', () => {
  it('round-trips and survives a torn last line', () => {
    const text = toLine({ provider: { steamid: ME } }, 1) + toLine({ map: { name: 'de_mirage' } }, 2) + '{"t":3,"p":{"map"';
    const rec = readRecording(text);
    expect(rec.map(r => r.t)).toEqual([1, 2]);
  });

  it('anonymizes Steam IDs, names and tokens', () => {
    const rec = anonymize([{ t: 1, p: { provider: { steamid: ME }, player: { steamid: ME, name: 'RealName' }, auth: { token: 'secret' } } }]);
    expect(JSON.stringify(rec)).not.toContain(ME);
    expect(JSON.stringify(rec)).not.toContain('RealName');
    expect(JSON.stringify(rec)).not.toContain('secret');
  });
});

describe('GSI server', () => {
  it('accepts payloads with the right token and rejects the rest', async () => {
    const got: GsiPayload[] = [], rejected: string[] = [];
    const srv = await startGsiServer({ port: 0, token: 'tok', onPayload: p => got.push(p), onRejected: r => rejected.push(r) });
    const post = (body: string) => fetch(`http://127.0.0.1:${srv.port}/`, { method: 'POST', body });
    await post(JSON.stringify({ auth: { token: 'tok' }, map: { name: 'de_mirage' } }));
    await post(JSON.stringify({ auth: { token: 'nope' } }));
    await post('not json');
    const get = await fetch(`http://127.0.0.1:${srv.port}/`);
    await srv.close();
    expect(get.status).toBe(200);
    expect(got).toHaveLength(1);
    expect(got[0]?.map?.name).toBe('de_mirage');
    expect(rejected.sort()).toEqual(['json', 'token']);
  });
});

describe('product GSI cfg', () => {
  it('requests only player components', async () => {
    const { gsiConfig, SPECTATOR_COMPONENTS } = await import('./cfg.ts');
    const cfg = gsiConfig({ uri: 'http://127.0.0.1:47400', token: 'tok_12345678' });
    expect(cfg).toContain('"player_state"');
    for (const c of SPECTATOR_COMPONENTS) expect(cfg).not.toContain(`"${c}"`);
    expect(cfg).not.toContain('phase_countdowns');
    expect(() => gsiConfig({ uri: 'http://127.0.0.1:1', token: 'tok_12345678', components: ['allplayers_position'] })).toThrow(/spectator/);
    expect(() => gsiConfig({ uri: 'http://127.0.0.1:1', token: 'bad"token' })).toThrow();
  });
});

describe('synthetic match', () => {
  it('lean mode drops round_wins and phase_countdowns', () => {
    const rec = syntheticMatch({ lean: true });
    expect(rec.some(r => r.p.map?.round_wins || r.p.phase_countdowns)).toBe(false);
  });
  it('follows a teammate after dying', () => {
    const rec = syntheticMatch();
    const watching = rec.filter(r => r.p.player?.steamid !== r.p.provider?.steamid);
    expect(watching.length).toBeGreaterThan(0);
    expect(watching.every(r => r.p.player?.team === 'CT')).toBe(true);
  });
});
