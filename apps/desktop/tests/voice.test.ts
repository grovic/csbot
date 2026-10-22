import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GEOS } from '@csbot/engine';
import type { VoiceEvent } from '@csbot/protocol';
import { afterAll, describe, expect, it } from 'vitest';
import { fakeShortcuts } from '../src/hotkeys.ts';
import { commandFor, describeCommand, voicePhrases } from '../src/voice/grammar.ts';
import { PushToTalk } from '../src/voice/ptt.ts';
import { FakeRecognizer, SpeechHelper } from '../src/voice/recognizer.ts';

describe('push-to-talk phrases', () => {
  const mirage = voicePhrases('de_mirage');

  it('turns counts, clears, check-ins and questions into commands', () => {
    expect(commandFor('three B apps', mirage)).toEqual({ kind: 'intel', zone: 'bapps', count: 3 });
    expect(commandFor('B apartments two', mirage)).toEqual({ kind: 'intel', zone: 'bapps', count: 2 });
    expect(commandFor('palace clear', mirage)).toEqual({ kind: 'intel', zone: 'palace', count: 0 });
    expect(commandFor('clear A', mirage)).toEqual({ kind: 'intel', zone: 'asite', count: 0 });
    expect(commandFor('five  top mid', mirage)).toEqual({ kind: 'intel', zone: 'topmid', count: 5 });
    expect(commandFor('On my spot', mirage)).toEqual({ kind: 'checkin', state: 'spot' });
    expect(commandFor('rotating to B', mirage)).toEqual({ kind: 'checkin', state: 'rotate', site: 'B' });
    expect(commandFor('coach should we save this round', mirage)).toEqual({ kind: 'question', text: 'Should we save this round?' });
    expect(commandFor('coach', mirage)).toBeUndefined();
    expect(commandFor('three bananas', mirage)).toBeUndefined();
  });

  it('every map: one meaning per phrase, every zone sayable, nothing outside the map', () => {
    for (const [map, geo] of Object.entries(GEOS)) {
      const ps = voicePhrases(map);
      const texts = ps.map(p => p.text.toLowerCase());
      expect(new Set(texts).size, map).toBe(texts.length);
      const zones = new Set(ps.flatMap(p => (p.cmd.kind === 'intel' ? [p.cmd.zone] : [])));
      expect([...zones].sort(), map).toEqual(geo.zones.map(z => z.id).sort());
      expect(ps.length, map).toBeLessThan(1500);
    }
    // Without a map: check-ins only.
    expect(voicePhrases(undefined).every(p => p.cmd.kind === 'checkin')).toBe(true);
  });

  it('reads a command back the way the toast says it', () => {
    expect(describeCommand({ kind: 'intel', zone: 'bapps', count: 3 }, 'de_mirage')).toBe('3 B Apps');
    expect(describeCommand({ kind: 'intel', zone: 'bapps', count: 0 }, 'de_mirage')).toBe('B Apps clear');
    expect(describeCommand({ kind: 'checkin', state: 'rotate', site: 'A' }, 'de_mirage')).toBe('Rotating → A');
  });
});

describe('push-to-talk controller', () => {
  function setup(lines: string[]) {
    const shortcuts = fakeShortcuts();
    const events: VoiceEvent[] = [];
    const rec = new FakeRecognizer(lines);
    const ptt = new PushToTalk({ shortcuts, recognizer: () => rec, onEvent: e => events.push(e) });
    return { shortcuts, events, rec, ptt };
  }

  it('is off until enabled, then listens once per press and acts on what it understood', async () => {
    const { shortcuts, events, rec, ptt } = setup(['three B apps', 'mumble', 'coach should we save']);
    expect(await ptt.press()).toBeUndefined();
    expect(await ptt.setEnabled(true)).toEqual({ ok: true });
    expect([...shortcuts.registered.keys()]).toEqual(['num0']);
    ptt.setMap('de_mirage');
    await new Promise(r => setTimeout(r, 0));
    expect(rec.phrases).toContain('three B apps');
    expect(await ptt.press()).toEqual({ state: 'heard', text: 'three B apps', command: { kind: 'intel', zone: 'bapps', count: 3 }, said: '3 B Apps' });
    expect(await ptt.press()).toEqual({ state: 'none', text: 'mumble' });
    expect((await ptt.press())?.command).toEqual({ kind: 'question', text: 'Should we save?' });
    expect(await ptt.press()).toEqual({ state: 'none' });
    expect(events.filter(e => e.state === 'listening')).toHaveLength(4);
    expect(ptt.status()).toMatchObject({ enabled: true, key: 'Num0' });
    expect(ptt.status().examples[0]).toMatch(/^three /);
  });

  it('changes key, refuses a taken key, and lets go of the key when switched off', async () => {
    const { shortcuts, ptt } = setup([]);
    expect(await ptt.setEnabled(true, 'F9')).toEqual({ ok: true });
    expect([...shortcuts.registered.keys()]).toEqual(['F9']);
    expect(await ptt.setEnabled(true, 'Nope')).toEqual({ ok: false, error: 'Unknown key.' });
    shortcuts.register = () => false;
    expect(await ptt.setEnabled(true, 'Num+')).toEqual({ ok: false, error: 'Num+ is taken by another app.' });
    expect(await ptt.setEnabled(false)).toEqual({ ok: true });
    expect(shortcuts.registered.size).toBe(0);
    expect(ptt.status().enabled).toBe(false);
  });

  it('a helper that cannot start leaves it off with the reason', async () => {
    const shortcuts = fakeShortcuts();
    const ptt = new PushToTalk({ shortcuts, recognizer: () => ({ start: async () => { throw new Error('No en-US speech recognizer on this PC.'); }, setPhrases: async () => {}, listen: async () => undefined, dispose: () => {} }), onEvent: () => {} });
    expect(await ptt.setEnabled(true)).toEqual({ ok: false, error: 'No en-US speech recognizer on this PC.' });
    expect(shortcuts.registered.size).toBe(0);
    expect(ptt.status().error).toMatch(/No en-US/);
  });
});

// The real Windows recognizer, fed WAV files spoken by Windows' own voice (no microphone involved).
const PS = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
function hasRecognizer(): boolean {
  if (process.platform !== 'win32' || !fs.existsSync(PS)) return false;
  try {
    const out = execFileSync(PS, ['-NoProfile', '-NonInteractive', '-Command',
      "Add-Type -AssemblyName System.Speech; ([System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() | Where-Object { $_.Culture.Name -eq 'en-US' }).Count; (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices().Count"],
    { encoding: 'utf8', timeout: 20_000, windowsHide: true });
    const [rec, voices] = out.trim().split(/\s+/).map(Number);
    return rec! > 0 && voices! > 0;
  } catch { return false; }
}

describe.skipIf(!hasRecognizer())('the Windows speech helper (WAVs spoken by Windows TTS)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csbot-voice-'));
  const helper = new SpeechHelper({ dir });
  afterAll(() => { helper.dispose(); setTimeout(() => fs.rmSync(dir, { recursive: true, force: true }), 2000).unref(); });

  function say(name: string, text: string): string {
    const file = path.join(dir, `${name}.wav`);
    execFileSync(PS, ['-NoProfile', '-NonInteractive', '-Command',
      `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SetOutputToWaveFile('${file}'); $s.Speak('${text}'); $s.Dispose()`],
    { timeout: 20_000, windowsHide: true });
    return file;
  }

  it('recognizes intel, a clear, a check-in and a question on Mirage', { timeout: 60_000 }, async () => {
    const phrases = voicePhrases('de_mirage');
    await helper.start();
    await helper.setPhrases(phrases.map(p => p.text), 'coach');
    const cases: [string, unknown][] = [
      ['three B apps', { kind: 'intel', zone: 'bapps', count: 3 }],
      ['palace clear', { kind: 'intel', zone: 'palace', count: 0 }],
      ['rotating B', { kind: 'checkin', state: 'rotate', site: 'B' }],
    ];
    for (const [i, [text, cmd]] of cases.entries()) {
      const h = await helper.listen(say(`p${i}`, text));
      expect(h?.text).toBe(text);
      expect(h!.confidence).toBeGreaterThan(0.55);
      expect(commandFor(h!.text, phrases)).toEqual(cmd);
    }
    const q = await helper.listen(say('q', 'coach where do they usually go on a force buy'));
    expect(q?.grammar).toBe('question');
    expect(commandFor(q!.text, phrases)?.kind).toBe('question');
    // Silence: nothing heard.
    expect(await helper.listen(say('s', ' '))).toBeUndefined();
  });
});
