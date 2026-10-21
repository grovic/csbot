import { describe, expect, it } from 'vitest';
import { fakeShortcuts, hotkeysFor, IntelAggregator, IntelHotkeys, type ShortcutApi, type TimerApi } from '../src/hotkeys.ts';

/** Manual clock: timers fire only when the test advances time. */
function manualTimers() {
  let now = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const api: TimerApi = {
    set: (fn, ms) => { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; },
    clear: h => { timers.delete(h as number); },
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [id, t] of [...timers].sort((a, b) => a[1].at - b[1].at)) if (t.at <= now) { timers.delete(id); t.fn(); }
  };
  return { api, advance, pending: () => timers.size };
}

describe('intel hotkeys: key presses to intel', () => {
  it('counts quick presses and logs once after a quiet 1.5 s', () => {
    const logs: [string, number][] = [];
    const clock = manualTimers();
    const agg = new IntelAggregator((z, n) => logs.push([z, n]), { timers: clock.api });
    agg.press({ zone: 'bapps', kind: 'sighting' });
    clock.advance(400);
    agg.press({ zone: 'bapps', kind: 'sighting' });
    clock.advance(400);
    agg.press({ zone: 'bapps', kind: 'sighting' });
    clock.advance(1400);
    expect(logs).toEqual([]); // still within 1.5 s of the last press
    clock.advance(200);
    expect(logs).toEqual([['bapps', 3]]);
  });

  it('caps at 5, keeps zones apart, and logs a clear right away (dropping a pending count)', () => {
    const logs: [string, number][] = [];
    const clock = manualTimers();
    const agg = new IntelAggregator((z, n) => logs.push([z, n]), { timers: clock.api });
    for (let i = 0; i < 8; i++) agg.press({ zone: 'aramp', kind: 'sighting' });
    agg.press({ zone: 'topmid', kind: 'sighting' });
    agg.press({ zone: 'topmid', kind: 'clear' });
    expect(logs).toEqual([['topmid', 0]]);
    clock.advance(1500);
    expect(logs).toEqual([['topmid', 0], ['aramp', 5]]);
    expect(clock.pending()).toBe(0);
  });
});

describe('intel hotkeys: registration', () => {
  it('has Num7/8/9 sightings and Num1/2/3 clears on Mirage, nothing on maps without a model', () => {
    expect(hotkeysFor('de_mirage').map(d => `${d.key}:${d.zone}:${d.kind}`)).toEqual([
      'Num7:aramp:sighting', 'Num8:topmid:sighting', 'Num9:bapps:sighting', 'Num1:aramp:clear', 'Num2:topmid:clear', 'Num3:bapps:clear',
    ]);
    expect(hotkeysFor('de_inferno')).toEqual([]);
  });

  it('registers only while enabled, follows the map, and unregisters on dispose', () => {
    const sc = fakeShortcuts();
    const logs: [string, number][] = [];
    const hk = new IntelHotkeys({ shortcuts: sc, log: (z, n) => logs.push([z, n]) });
    hk.setMap('de_mirage');
    expect(sc.registered.size).toBe(0); // off by default
    hk.setEnabled(true);
    expect([...sc.registered.keys()].sort()).toEqual(['num1', 'num2', 'num3', 'num7', 'num8', 'num9']);
    expect(hk.status()).toMatchObject({ enabled: true, keys: expect.arrayContaining([{ key: 'Num9', zone: 'bapps', zoneName: 'B Apps', kind: 'sighting' }]) });
    sc.registered.get('num3')!(); // Num3: B Apps clear
    expect(logs).toEqual([['bapps', 0]]);
    hk.setMap('de_inferno');
    expect(sc.registered.size).toBe(0);
    expect(hk.status()).toEqual({ enabled: true, keys: [], error: 'No map model for this map yet.' });
    hk.setMap('de_mirage');
    expect(sc.registered.size).toBe(6);
    hk.setEnabled(false);
    expect(sc.registered.size).toBe(0);
    hk.setEnabled(true);
    hk.dispose();
    expect(sc.registered.size).toBe(0);
    expect(hk.status().enabled).toBe(false);
  });

  it('reports keys another app holds and keeps the rest working', () => {
    const taken = new Set(['num8']);
    const registered = new Set<string>();
    const sc: ShortcutApi = {
      register: acc => { if (taken.has(acc)) return false; registered.add(acc); return true; },
      unregister: acc => { registered.delete(acc); },
    };
    const hk = new IntelHotkeys({ shortcuts: sc, log: () => {} });
    hk.setMap('de_mirage');
    hk.setEnabled(true);
    expect(registered.size).toBe(5);
    expect(hk.status().error).toBe('Num8 is taken by another app.');
  });
});
