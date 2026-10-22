import { parseSetpos, sanitizeTeam } from '@csbot/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { walkableAt } from './geometry.ts';
import { GEOS, LINEUPS, lineupsFor, PLAYBOOKS } from './maps/index.ts';
import { lineupSpot, practiceConfig, practiceFileName } from './practice.ts';
import { applyTeam, builtinLineups, teamLineups } from './team.ts';

afterEach(() => applyTeam(undefined));

describe('starter lineups', () => {
  it('every map has some, on the floor, each linked only to setups of its side', () => {
    for (const [map, geo] of Object.entries(GEOS)) {
      const ls = LINEUPS[map]!;
      expect(ls.length, map).toBeGreaterThanOrEqual(6);
      expect(new Set(ls.map(l => l.id)).size, map).toBe(ls.length);
      for (const l of ls) {
        expect(walkableAt(geo, l.from[0], l.from[1]), `${map}/${l.id} from`).toBe(true);
        const setups = PLAYBOOKS[map]!.setups;
        for (const s of l.setups ?? []) expect(setups.find(x => x.id === s)?.side, `${map}/${l.id} → ${s}`).toBe(l.side);
      }
      // Both sides have utility.
      expect(ls.some(l => l.side === 'T') && ls.some(l => l.side === 'CT'), map).toBe(true);
    }
  });

  it("a setup's call lists its lineups", () => {
    expect(lineupsFor('de_mirage', 'tExecA').map(l => l.id)).toEqual(['window', 'stairs', 'jungle', 'ctsmoke', 'firebox']);
    expect(lineupsFor('de_mirage', undefined)).toEqual([]);
  });

  it("the team's lineups replace the starter list for that map only", () => {
    const team = sanitizeTeam({ playbooks: {}, antistrats: [], lineups: { de_mirage: [{ id: 'ours', name: 'Our window', kind: 'smoke', side: 'T', from: [700, 300], to: [500, 400], setups: ['tExecA'] }] } });
    applyTeam(team);
    expect(lineupsFor('de_mirage', 'tExecA').map(l => l.name)).toEqual(['Our window']);
    expect(LINEUPS.de_dust2).toEqual(builtinLineups('de_dust2'));
    expect(teamLineups(undefined, 'de_mirage')).toBe(builtinLineups('de_mirage'));
  });
});

describe('practice config', () => {
  it('teleports near the throw spot (callout floor height), facing the landing spot', () => {
    const window = builtinLineups('de_mirage').find(l => l.id === 'window')!;
    const s = lineupSpot('de_mirage', window)!;
    expect(s.exact).toBe(false);
    // Mirage's T spawn is in the east, window to the west of it: facing roughly west (yaw near ±180).
    expect(Math.abs(s.ang[1])).toBeGreaterThan(120);
    const tspawnZ = GEOS.de_mirage!.zones.find(z => z.id === 'tspawn')!.z!;
    expect(s.pos[2]).toBeCloseTo(tspawnZ + 16, 0);
  });

  it('uses your exact spot when you saved one', () => {
    const exact = parseSetpos('setpos 1216.031250 -211.968750 -159.968750;setang -48.000000 -144.500000 0.000000')!;
    expect(exact).toEqual({ pos: [1216.03, -211.97, -159.97], ang: [-48, -144.5] });
    const s = lineupSpot('de_mirage', { ...builtinLineups('de_mirage')[0]!, exact });
    expect(s).toEqual({ pos: [1216.03, -211.97, -159.97], ang: [-48, -144.5], exact: true });
    expect(parseSetpos('getpos')).toBeUndefined();
  });

  it('writes a console-safe .cfg with one alias per lineup', () => {
    const ls = [...builtinLineups('de_mirage').slice(0, 2), { ...builtinLineups('de_mirage')[2]!, name: 'Jungle "quoted"; smoke' }];
    const cfg = practiceConfig('de_mirage', ls, new Date('2026-10-22T10:00:00Z'));
    expect(practiceFileName('de_mirage')).toBe('csbot_de_mirage.cfg');
    expect(cfg).toContain('sv_cheats 1');
    expect(cfg).toContain('exec csbot_de_mirage');
    expect(cfg.match(/^alias lineup\d+ /gm)).toHaveLength(3);
    expect(cfg).toMatch(/^alias lineup1 "setpos -?[\d.]+ -?[\d.]+ -?[\d.]+; setang -20 -?[\d.]+ 0; give weapon_smokegrenade; use weapon_smokegrenade; echo lineup1 Window smoke \(T\) - Jumpthrow - near"$/m);
    // Names can't break out of the alias.
    const line3 = cfg.split('\n').find(l => l.startsWith('alias lineup3'))!;
    expect(line3.match(/"/g)).toHaveLength(2);
    expect(line3).toContain('Jungle quoted smoke');
    expect(cfg).toContain('alias csbot_list "echo lineup1');
    // Molotovs: a molotov on T, an incendiary on CT.
    const ct = practiceConfig('de_mirage', builtinLineups('de_mirage').filter(l => l.kind === 'molotov' && l.side === 'CT'));
    expect(ct).toContain('give weapon_incgrenade');
  });

  it('Nuke: a lineup on the lower floor teleports on the lower floor', () => {
    const geo = GEOS.de_nuke!;
    const ramp = builtinLineups('de_nuke').find(l => l.id === 'rampmolly')!;
    const bsite = geo.zones.find(z => z.id === 'bsite')!;
    expect(bsite.level).toBe(1);
    const s = lineupSpot('de_nuke', ramp)!;
    expect(s.pos[2]).toBeLessThan(geo.zones.find(z => z.id === 'asite')!.z!);
  });
});
