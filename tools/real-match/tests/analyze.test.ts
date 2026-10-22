import { describe, expect, it } from 'vitest';
import { analyze, matchesIn, stat, type Event, type Sample } from '../src/analyze.ts';

const phase = (t: number, round: number, p: string) => ({ t, ev: 'phase', round, phase: p, map: 'de_mirage', mode: 'competitive' });
const shown = (t: number, id: string, device: string, key: string) => ({ t, ev: 'shown', id, name: id === 'host' ? 'rdx' : id, device, key });

/** Three rounds on Mirage with the host and one web member (kairo), all fictional. */
function run(): { samples: Sample[]; events: Event[] } {
  const events: Event[] = [
    { t: 0, ev: 'start', version: '0.20.0', lowMemory: true },
    { t: 500, ev: 'window', what: 'ready', visible: true, minimized: false },
    phase(1000, 1, 'freezetime'), phase(21_000, 1, 'live'), phase(80_000, 1, 'over'),
    shown(80_100, 'host', 'host', '2:pre:engine'), shown(80_300, 'kairo', 'web', '2:pre:engine'),
    { t: 83_600, ev: 'coach', trigger: 'freeze', round: 2, status: 'ok', ms: 3500, model: 'claude-sonnet', costUsd: 0.04 },
    shown(83_600, 'host', 'host', '2:pre:claude'), shown(83_800, 'kairo', 'web', '2:pre:claude'),
    phase(87_000, 2, 'freezetime'), phase(107_000, 2, 'live'), phase(170_000, 2, 'over'),
    shown(170_050, 'host', 'host', '3:pre:engine'), shown(170_200, 'kairo', 'web', '3:pre:engine'),
    { t: 175_000, ev: 'coach', trigger: 'freeze', round: 3, status: 'ok', ms: 4900, model: 'claude-sonnet', costUsd: 0.09 },
    shown(175_000, 'host', 'host', '3:pre:claude'), shown(175_300, 'kairo', 'web', '3:pre:claude'),
    phase(177_000, 3, 'freezetime'),
    { t: 180_000, ev: 'offline', id: 'kairo', name: 'kairo', device: 'web' }, { t: 182_500, ev: 'online', id: 'kairo', name: 'kairo', device: 'web' },
    { t: 190_000, ev: 'window', what: 'minimize', visible: true, minimized: true },
    phase(197_000, 3, 'live'), phase(260_000, 3, 'gameover'),
    { t: 261_000, ev: 'faceitRecent', matches: [{ id: '1-x', status: 'ONGOING', live: true }] },
  ];
  const samples: Sample[] = [];
  for (let t = 0; t <= 262_000; t += 1000) {
    const s = t / 1000;
    samples.push({ t, procs: [
      { pid: 1, type: 'Browser', cpuTotal: s * 0.01, ws: 120_000, priv: 50_000 },
      { pid: 2, type: 'Tab', cpuTotal: s * 0.01, ws: 150_000, priv: t > 200_000 ? 110_000 : 100_000 },
    ] });
  }
  return { samples, events };
}

describe('the V1 numbers from a measurement run', () => {
  const [m] = analyze(run().samples, run().events, { cores: 4 });

  it('finds the match and its rounds', () => {
    expect(m).toMatchObject({ map: 'de_mirage', mode: 'competitive', rounds: 3, finished: true, from: 1000, to: 260_000 });
  });

  it('memory and CPU while the match is on, and how long the window was on screen', () => {
    expect(m!.footprint).toMatchObject({ privPeakMB: 156.3, wsPeakMB: 263.7, cpuMachinePct: 0.5, pass: { memory: true, cpu: true } });
    expect(m!.footprint!.privAvgMB).toBeGreaterThan(146);
    expect(m!.footprint!.byType.Tab!.privAvgMB).toBeGreaterThan(97);
    // Visible from 1 s to 190 s of a 1-260 s match.
    expect(m!.footprint!.windowVisible).toBeCloseTo((190_000 - 1000) / (260_000 - 1000), 2);
  });

  it('times the next round\'s call on every screen from the round end', () => {
    expect(m!.calls.roundEnds).toBe(2);
    const host = m!.calls.screens.find(s => s.id === 'host')!;
    const kairo = m!.calls.screens.find(s => s.id === 'kairo')!;
    expect(host.firstCall).toEqual({ n: 2, p50: 0.05, p95: 0.1, max: 0.1 });
    expect(host.claudeCall).toEqual({ n: 2, p50: 3.6, p95: 5, max: 5 });
    expect(kairo.claudeCall.max).toBe(5.3);
    expect(m!.calls).toMatchObject({ claudeCallP95: 5.3, pass: true });
  });

  it('the coach, the room and FACEIT', () => {
    expect(m!.coach).toMatchObject({ requests: 2, byStatus: { ok: 2 }, ms: { n: 2, max: 4.9 }, costUsd: 0.09, model: 'claude-sonnet' });
    expect(m!.room).toEqual({ members: ['kairo'], reconnects: [{ name: 'kairo', seconds: 2.5 }], reconnectP95: 2.5 });
    expect(m!.faceit).toEqual({ seen: true, liveStatuses: ['ONGOING'] });
  });

  it("leaves out round ends before a half's first round (sides swap, no early call)", () => {
    const ev: Event[] = [phase(0, 12, 'live'), phase(10, 12, 'over'), shown(5000, 'host', 'host', '13:pre:engine'), phase(30_000, 13, 'freezetime')];
    expect(analyze([], ev, { cores: 4 })[0]!.calls).toMatchObject({ roundEnds: 0 });
  });

  it('a late call fails the check', () => {
    const ev: Event[] = [phase(0, 4, 'live'), phase(1000, 4, 'over'), shown(11_000, 'host', 'host', '5:pre:engine'), phase(8000, 5, 'freezetime')];
    expect(analyze([], ev, { cores: 4 })[0]!.calls).toMatchObject({ roundEnds: 1, firstCallP95: 10, pass: false });
  });
});

describe('helpers', () => {
  it('splits a run into matches on a new map or a restart', () => {
    const nuke = (t: number, round: number, p: string) => ({ ...phase(t, round, p), map: 'de_nuke' });
    const ev: Event[] = [phase(0, 1, 'freezetime'), phase(10, 2, 'live'), nuke(20, 1, 'freezetime'), nuke(30, 2, 'gameover'), phase(40, 1, 'freezetime'), phase(50, 3, 'live'), phase(60, 1, 'freezetime')];
    expect(matchesIn(ev).map(m => [m.map, m.from, m.to, m.finished])).toEqual([['de_mirage', 0, 10, false], ['de_nuke', 20, 30, true], ['de_mirage', 40, 50, false], ['de_mirage', 60, 60, false]]);
  });
  it('nearest-rank percentiles', () => {
    expect(stat([])).toEqual({ n: 0 });
    expect(stat([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toEqual({ n: 10, p50: 5, p95: 10, max: 10 });
  });
});
